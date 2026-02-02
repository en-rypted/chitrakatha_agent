import express from 'express';
import http from 'http';
import cors from 'cors';
import io from 'socket.io-client';
import fs from 'fs';
import path from 'path';
import ip from 'ip';
import os from 'os';
import { fileURLToPath } from 'url';

// Import Streaming Logic
import { prepareStream, handleStreamRequest, activeStreams } from './streamHandler.js';

// Configuration
const DEFAULT_PORT = 3000;
const PORT = process.env.PORT || DEFAULT_PORT;
const SERVER_URL = process.env.SERVER_URL || 'https://chitrakatha-backend.onrender.com'; // Main Signaling Server

const app = express();
app.use(cors());
app.use(express.json());

// Global error handlers to prevent crashes from stream errors
process.on('uncaughtException', (err) => {
    if (err.message && err.message.includes('closed prematurely')) {
        console.log('[Agent] Stream closed (handled globally)');
    } else {
        console.error('[Agent] Fatal Error:', err.message);
        console.error(err.stack);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Agent] Unhandled Rejection at:', promise, 'reason:', reason);
});


// Serve Downloads Statically (for Playback) - from temp directory
const DOWNLOADS_DIR = path.join(os.tmpdir(), 'chitrakatha_downloads');
app.use('/downloads', express.static(DOWNLOADS_DIR));

// State
let socket = null;
let activeFile = null; // Legacy: kept for simple file picking if needed, or we adapt
let currentRoom = null;

// Setup global callback for metadata updates
global.metadataUpdateCallback = (streamId, metadata) => {
    console.log(`[Agent] Metadata update for stream ${streamId}: duration=${metadata.duration}s`);

    // Emit to room if connected
    if (socket && currentRoom) {
        socket.emit('torrent_metadata_update', {
            roomId: currentRoom,
            streamId: streamId,
            duration: metadata.duration,
            streams: metadata.streams || []
        });
        console.log(`[Agent] Emitted metadata update to room ${currentRoom}`);
    }
};

// Helper: Get Local LAN IP
const getLocalIp = () => {
    // 1. Environment Variable (Highest Priority)
    if (process.env.AGENT_IP) return process.env.AGENT_IP;

    // 2. Config File (agent-config.json in same folder as exe)
    try {
        const configPath = path.join(process.cwd(), 'agent-config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.AGENT_IP) return config.AGENT_IP;
        }
    } catch (err) {
        console.error("Error reading config file:", err.message);
    }

    // 3. Auto-detect (Default)
    return ip.address();
};

// --- API Endpoints ---

// 1. Status Check
app.get('/status', (req, res) => {
    res.json({
        online: true,
        version: '1.0.0',
        port: PORT,
        room: currentRoom,
        room: currentRoom,
        ip: getLocalIp(),
        activeFile: activeFile || null
    });
});

// 2. UNIFIED PLAY ENDPOINT (Replaces Select File)
app.post('/play', async (req, res) => {
    const { url, type } = req.body; // type: 'file' | 'url' | 'magnet'

    if (!url) return res.status(400).json({ error: 'URL/Path required' });

    try {
        console.log(`[Agent] preparing stream for: ${url} (${type})`);
        const metadata = await prepareStream(url, type);

        // Update global active file for status checks (legacy compatibility)
        activeFile = {
            id: metadata.id,
            name: metadata.name,
            size: metadata.size,
            duration: metadata.duration,
            type: 'video/mp4' // We standardise on MP4 for streaming
        };

        // If connected, announce to room (Sync)
        if (socket && currentRoom) {
            socket.emit('agent_file_announce', {
                roomId: currentRoom,
                file: {
                    id: metadata.id,
                    name: metadata.name,
                    size: metadata.size,
                    duration: metadata.duration,
                    streams: metadata.streams,
                    ip: getLocalIp(),
                    port: PORT
                }
            });
        }

        res.json({
            success: true,
            streamId: metadata.id,
            name: metadata.name,
            duration: metadata.duration,
            streams: metadata.streams
        });

    } catch (err) {
        console.error("[Agent] Play Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Legacy Endpoint for older clients (maps to new logic mainly for local files)
app.post('/select-file', async (req, res) => {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'FilePath required' });

    try {
        // Redirect to new logic
        // We assume it's a file
        console.log(`[Agent] Legacy select-file called for: ${filePath}`);
        const metadata = await prepareStream(filePath, 'file');

        activeFile = {
            id: metadata.id,
            name: metadata.name,
            size: metadata.size,
            type: 'video/mp4'
        };

        // Announce
        if (socket && currentRoom) {
            socket.emit('agent_file_announce', {
                roomId: currentRoom,
                file: {
                    id: metadata.id,
                    name: metadata.name,
                    size: metadata.size,
                    ip: getLocalIp(),
                    port: PORT
                }
            });
        }

        // Return legacy structure expected by client
        res.json({ success: true, file: activeFile });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Join Room (Triggered by Frontend)
app.post('/join-room', (req, res) => {
    const { roomId, serverUrl } = req.body;
    if (!roomId) return res.status(400).json({ error: 'RoomID required' });

    // Connect if not connected
    if (!socket) {
        console.log(`[Agent] Connecting to Signaling Server: ${serverUrl || SERVER_URL}`);
        socket = io(serverUrl || SERVER_URL);

        socket.on('connect', () => {
            console.log(`[Agent] Connected to Cloud Server with ID: ${socket.id}`);
            socket.emit('join_room', roomId);
            currentRoom = roomId;
        });

        socket.on('disconnect', () => {
            console.log('[Agent] Disconnected from Cloud Server');
            currentRoom = null;
        });

        // Listen for other agents? (Currently via Browser primarily, simplest flow)
    } else {
        if (currentRoom !== roomId) {
            socket.emit('join_room', roomId);
            currentRoom = roomId;
        }
    }

    res.json({ success: true, roomId });
});

// 4. Stream Endpoint (Delegated to StreamHandler)
app.get('/stream/:fileId', (req, res) => {
    const { fileId } = req.params;
    handleStreamRequest(req, res, fileId);
});

// 5. Metadata Endpoint (For polling updated duration)
app.get('/metadata/:streamId', (req, res) => {
    const { streamId } = req.params;
    const streamData = activeStreams.get(streamId);

    if (!streamData) {
        return res.status(404).json({ error: 'Stream not found' });
    }

    res.json({
        streamId: streamId,
        duration: streamData.duration || 0,
        name: streamData.name,
        size: streamData.size,
        streams: streamData.streams || []
    });
});

// Handle Preflight
app.options('/stream/:fileId', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.sendStatus(204);
});

// 5. Start Download (Agent-to-Agent)
app.post('/start-download', async (req, res) => {
    const { targetUrl, fileName } = req.body;

    if (!targetUrl || !fileName) {
        return res.status(400).json({ error: 'Target URL and FileName required' });
    }

    // Use writable directory (not __dirname which is read-only in pkg)
    const downloadDir = path.join(os.tmpdir(), 'chitrakatha_downloads');
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
    }

    const safeName = path.basename(fileName);
    const savePath = path.join(downloadDir, safeName);
    const file = fs.createWriteStream(savePath);

    console.log(`[Agent] Starting download: ${targetUrl} -> ${savePath}`);

    try {
        http.get(targetUrl, (response) => {
            if (response.statusCode !== 200 && response.statusCode !== 206) {
                return res.status(502).json({ error: `Remote returned ${response.statusCode}` });
            }

            let totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;
            let lastProgressEmit = 0;
            let lastSpeedCheck = Date.now();
            let lastDownloadedSize = 0;
            let currentSpeed = 0; // Maintain speed between chunks
            let startTime = Date.now();

            response.on('data', (chunk) => {
                downloadedSize += chunk.length;

                // Calculate speed every 250ms (was 1s) to catch faster local transfers
                const now = Date.now();
                const timeDiff = (now - lastSpeedCheck) / 1000; // seconds

                if (timeDiff >= 0.25) {
                    const bytesDiff = downloadedSize - lastDownloadedSize;
                    currentSpeed = bytesDiff / timeDiff; // bytes per second
                    lastSpeedCheck = now;
                    lastDownloadedSize = downloadedSize;
                }

                // If speed is 0 but we have downloaded something in a very short time, estimate it
                if (currentSpeed === 0 && timeDiff > 0 && downloadedSize > 0) {
                    currentSpeed = downloadedSize / ((now - startTime) / 1000 || 0.001);
                }

                // Emit progress every 5% or 1MB
                const progress = (downloadedSize / totalSize) * 100;
                if (progress - lastProgressEmit >= 5 || downloadedSize - lastProgressEmit >= 1024 * 1024) {
                    lastProgressEmit = progress;
                    if (socket && currentRoom) {
                        socket.emit('agent_download_progress', {
                            roomId: currentRoom,
                            fileName: safeName,
                            progress: Math.round(progress),
                            downloaded: downloadedSize,
                            total: totalSize,
                            speed: Math.round(currentSpeed / 1024 / 1024 * 100) / 100 // MB/s
                        });
                    }
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log(`[Agent] Download complete: ${safeName}`);

                // Emit 100% completion
                if (socket && currentRoom) {
                    socket.emit('agent_download_progress', {
                        roomId: currentRoom,
                        fileName: safeName,
                        progress: 100,
                        downloaded: totalSize,
                        total: totalSize
                    });
                }
            });

            // Ack immediately that download started
            res.json({ success: true, message: 'Download started', savePath });

        }).on('error', (err) => {
            fs.unlink(savePath, () => { });
            console.error(`[Agent] Download error: ${err.message}`);
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀 Local Agent running!
    ---------------------

    Port:   ${PORT}
    IP:     ${getLocalIp()} (LAN)
    * To override IP:
      1. Set AGENT_IP env var, OR
      2. Create 'agent-config.json' with {"AGENT_IP": "..."}
    Status: http://localhost:${PORT}/status
    `);
});

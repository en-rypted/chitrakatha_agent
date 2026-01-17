const express = require('express');
const http = require('http');
const cors = require('cors');
const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const ip = require('ip');
const os = require('os');

// Configuration
const DEFAULT_PORT = 3000;
const PORT = process.env.PORT || DEFAULT_PORT;
const SERVER_URL = 'https://chitrakatha-backend.onrender.com'; // Main Signaling Server

const app = express();
app.use(cors());
app.use(express.json());

// Serve Downloads Statically (for Playback) - from temp directory
const DOWNLOADS_DIR = path.join(os.tmpdir(), 'chitrakatha_downloads');
app.use('/downloads', express.static(DOWNLOADS_DIR));

// State
let socket = null;
let activeFile = null; // { id, path, name, size, type }
let currentRoom = null;

// Helper: Get Local LAN IP
const getLocalIp = () => ip.address();

// --- API Endpoints ---

// 1. Status Check
app.get('/status', (req, res) => {
    res.json({
        online: true,
        version: '1.0.0',
        port: PORT,
        room: currentRoom,
        ip: getLocalIp(),
        activeFile: activeFile ? { name: activeFile.name, size: activeFile.size } : null
    });
});

// 2. Select File (Simulation for MVP: Scans a 'shared' folder or accepts path)
app.post('/select-file', (req, res) => {
    // strict "No Browser" generic file picker is hard in pure Node without Electron.
    // For this MVP, we will accept a raw path OR look in a ./shared folder
    const { filePath } = req.body;

    if (!filePath) {
        return res.status(400).json({ error: 'FilePath required' });
    }

    try {
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const stats = fs.statSync(filePath);

        // Detect MIME Type
        const ext = path.extname(filePath).toLowerCase();
        let mimeType = 'application/octet-stream';
        if (ext === '.mp4') mimeType = 'video/mp4';
        else if (ext === '.mkv') mimeType = 'video/x-matroska'; // Note: Browsers struggle with MKV directly
        else if (ext === '.webm') mimeType = 'video/webm';
        else if (ext === '.avi') mimeType = 'video/x-msvideo';

        console.log(`[Agent] Detected MIME: ${mimeType} for extension: ${ext}`);

        activeFile = {
            id: Date.now().toString(), // Simple ID
            path: filePath,
            name: path.basename(filePath),
            size: stats.size,
            type: mimeType
        };

        console.log(`[Agent] File selected: ${activeFile.name}`);

        // If connected, announce to room
        if (socket && currentRoom) {
            socket.emit('agent_file_announce', {
                roomId: currentRoom,
                file: {
                    id: activeFile.id,
                    name: activeFile.name,
                    size: activeFile.size,
                    ip: getLocalIp(),
                    port: PORT
                }
            });
        }

        res.json({ success: true, file: activeFile });

    } catch (err) {
        console.error(err);
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

// 4. Stream File (The Transfer Logic)
app.get('/stream/:fileId', (req, res) => {
    const { fileId } = req.params;

    // Explicit CORS for Media
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    // Security: Only allow if it matches active file (Simplest 'token')
    if (!activeFile || activeFile.id !== fileId) {
        console.log(`[Agent] Stream 404: ActiveFile=${activeFile?.id} Request=${fileId}`);
        return res.status(404).json({ error: 'File not active or not found' });
    }

    console.log(`[Agent] Streaming: ${activeFile.name} (${activeFile.type}) to ${req.ip} Range: ${req.headers.range || 'Full'}`);

    const fileSize = activeFile.size;
    const range = req.headers.range;

    if (range) {
        // Handle Range Requests (Resume/Seek)
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize) {
            res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
            return;
        }

        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(activeFile.path, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': activeFile.type,
            'Access-Control-Allow-Origin': '*' // Helper ensure
        };

        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': activeFile.type,
            'Access-Control-Allow-Origin': '*'
        };
        res.writeHead(200, head);
        fs.createReadStream(activeFile.path).pipe(res);
    }
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

            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;
            let lastProgressEmit = 0;
            let startTime = Date.now();
            let lastSpeedCheck = Date.now();
            let lastDownloadedSize = 0;

            response.on('data', (chunk) => {
                downloadedSize += chunk.length;

                // Calculate speed every second
                const now = Date.now();
                const timeDiff = (now - lastSpeedCheck) / 1000; // seconds
                let speed = 0;

                if (timeDiff >= 1) {
                    const bytesDiff = downloadedSize - lastDownloadedSize;
                    speed = bytesDiff / timeDiff; // bytes per second
                    lastSpeedCheck = now;
                    lastDownloadedSize = downloadedSize;
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
                            speed: Math.round(speed / 1024 / 1024 * 100) / 100 // MB/s
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
    Status: http://localhost:${PORT}/status
    `);
});

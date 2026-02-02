import { PassThrough } from 'stream';
import WebTorrent from 'webtorrent';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import path from 'path';
import fs from 'fs';
import os from 'os';
import rangeParser from 'range-parser';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import ffprobePath from 'ffprobe-static';

// Define DOWNLOAD_DIR early
const DOWNLOADS_DIR = path.join(os.tmpdir(), 'chitrakatha_streams');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    try {
        fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    } catch (err) {
        console.error('[StreamHandler] Failed to create download dir:', err);
    }
}

// Configure FFmpeg & FFprobe
const actualFfmpegPath = ffmpegPath.path || ffmpegPath;
ffmpeg.setFfmpegPath(actualFfmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

// Helper: Get Metadata
const getMetadata = (input) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(input, (err, metadata) => {
            if (err) {
                console.error("[StreamHandler] ffprobe error:", err.message);
                resolve({ duration: 0, streams: [] }); // Fallback
            } else {
                const duration = metadata.format.duration || 0;
                const streams = metadata.streams.map(s => ({
                    index: s.index,
                    codec_type: s.codec_type,
                    codec_name: s.codec_name,
                    tags: s.tags
                }));
                resolve({ duration, streams });
            }
        });
    });
};

// Singleton Torrent Client
const WebTorrentClass = WebTorrent.default || WebTorrent;
const client = new WebTorrentClass({
    utp: false
});

// Store active streams
export const activeStreams = new Map();

// Helper: Detect if transcoding is needed (simplistic check for now)
const needsTranscoding = (filename) => {
    const ext = path.extname(filename).toLowerCase();
    return ext === '.mkv' || ext === '.avi' || ext === '.wmv' || ext === '.flv';
};




// 1. Prepare Stream (Resolve Torrent/URL -> StreamId)
export const prepareStream = async (input, type) => {
    const id = Date.now().toString();

    if (type === 'magnet' || input.startsWith('magnet:?')) {
        return new Promise(async (resolve, reject) => {
            console.log(`[StreamHandler] Adding torrent: ${input.substring(0, 50)}...`);

            const onTorrentReady = async (torrent) => {
                console.log(`[StreamHandler] Torrent ready: ${torrent.name}`);
                const file = torrent.files.find(f => {
                    return f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.webm') || f.name.endsWith('.avi');
                });

                if (!file) {
                    reject(new Error('No video file found in torrent'));
                    return;
                }

                file.select();

                // Store with initial duration = 0
                activeStreams.set(id, {
                    type: 'torrent',
                    torrentId: torrent.infoHash,
                    file: file,
                    name: file.name,
                    size: file.length,
                    duration: 0,
                    streams: []
                });

                // Return immediately for fast stream start
                resolve({
                    id,
                    name: file.name,
                    size: file.length,
                    duration: 0,
                    streams: []
                });

                // Start background metadata extraction (non-blocking)
                extractTorrentMetadataInBackground(id, torrent, file, global.metadataUpdateCallback);
            };

            try {
                // Check if torrent already exists
                const existingTorrent = await client.get(input);
                if (existingTorrent) {
                    console.log(`[StreamHandler] Torrent already exists: ${existingTorrent.infoHash}`);
                    if (existingTorrent.ready) {
                        onTorrentReady(existingTorrent);
                    } else {
                        console.log('[StreamHandler] Waiting for existing torrent metadata...');
                        existingTorrent.once('ready', () => onTorrentReady(existingTorrent));
                    }
                } else {
                    client.add(input, { path: DOWNLOADS_DIR }, (torrent) => {
                        console.log(`[StreamHandler] Torrent added and metadata received: ${torrent.name}`);
                        onTorrentReady(torrent);
                    });
                }
            } catch (err) {
                console.error('[StreamHandler] Error in prepareStream:', err);
                reject(err);
            }
        });

    } else if (type === 'url' || input.startsWith('http')) {
        const metadata = await getMetadata(input);
        console.log(`[StreamHandler] Remote Metadata: ${metadata.duration}s`);

        activeStreams.set(id, {
            type: 'url',
            url: input,
            name: 'Remote Stream',
            size: 0,
            duration: metadata.duration,
            streams: metadata.streams
        });
        return { id, name: 'Remote Stream', duration: metadata.duration, streams: metadata.streams };

    } else if (type === 'file') {
        if (!fs.existsSync(input)) throw new Error('File not found');
        const stats = fs.statSync(input);

        const metadata = await getMetadata(input);
        console.log(`[StreamHandler] Local Metadata: ${metadata.duration}s`);

        activeStreams.set(id, {
            type: 'file',
            path: input,
            name: path.basename(input),
            size: stats.size,
            duration: metadata.duration,
            streams: metadata.streams
        });
        return { id, name: path.basename(input), size: stats.size, duration: metadata.duration, streams: metadata.streams };
    }

    throw new Error('Unsupported input type');
};

// Background Metadata Extraction for Torrents
export const extractTorrentMetadataInBackground = async (streamId, torrent, file, callback) => {
    console.log(`[StreamHandler] Starting background metadata extraction for stream ${streamId}...`);

    // Retry logic: try up to 5 times with increasing delays
    const maxRetries = 5;
    const delays = [10000, 20000, 30000, 40000, 50000]; // 10s, 20s, 30s, 40s, 50s

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));

        console.log(`[StreamHandler] Metadata extraction attempt ${attempt + 1}/${maxRetries}...`);

        // Try different path constructions
        const possiblePaths = [
            path.join(DOWNLOADS_DIR, file.path),
            path.join(DOWNLOADS_DIR, torrent.name, file.path),
            path.join(torrent.path || DOWNLOADS_DIR, file.path)
        ];

        let filePath = null;
        for (const testPath of possiblePaths) {
            if (fs.existsSync(testPath)) {
                filePath = testPath;
                console.log('[StreamHandler] Found torrent file at:', filePath);
                break;
            }
        }

        if (filePath) {
            try {
                const metadata = await getMetadata(filePath);
                if (metadata && metadata.duration > 0) {
                    console.log(`[StreamHandler] Successfully extracted metadata - duration: ${metadata.duration}s`);

                    // Update activeStreams
                    const streamData = activeStreams.get(streamId);
                    if (streamData) {
                        streamData.duration = metadata.duration;
                        streamData.streams = metadata.streams || [];
                        activeStreams.set(streamId, streamData);
                    }

                    // Notify via callback (for socket emission)
                    if (callback) {
                        callback(streamId, metadata);
                    }

                    return; // Success, exit function
                }
            } catch (err) {
                console.log(`[StreamHandler] Metadata extraction failed on attempt ${attempt + 1}:`, err.message);
            }
        } else {
            console.log(`[StreamHandler] Torrent file not found on attempt ${attempt + 1}`);
        }
    }

    console.log(`[StreamHandler] Failed to extract metadata after ${maxRetries} attempts`);
};


// 2. Serve Stream
export const handleStreamRequest = (req, res, id) => {
    const streamData = activeStreams.get(id);
    if (!streamData) return res.status(404).send('Stream not found');

    const canTranscode = streamData.type === 'file' ? needsTranscoding(streamData.name) : false;
    const isTorrent = streamData.type === 'torrent';

    // Transcode if needed OR if it's a torrent (for stability, we often transcode torrents to ensure smooth playback vs seeking issues with direct file stream)
    // However, for MP4 torrents we might want direct stream? 
    // Let's stick to the previous logic: Transcode if it's a "bad" format, OR if it's a URL (proxy), OR if it's a Torrent that needs transcoding.
    // Actually, users reported "Broadcast" issues. Let's spawn individual FFmpeg processes for TRANSCODING cases.

    // Simplification: 
    // - URL -> Proxy (FFmpeg copy)
    // - File/Torrent (Non-supported format) -> Transcode
    // - File/Torrent (Supported format) -> Direct Stream

    const shouldTranscode = (streamData.type === 'url') ||
        (streamData.type === 'file' && canTranscode) ||
        (streamData.type === 'torrent' && needsTranscoding(streamData.name));

    if (shouldTranscode) {
        console.log(`[StreamHandler] Starting Transcode/Proxy for: ${streamData.name}`);

        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Access-Control-Allow-Origin': '*',
            'Connection': 'keep-alive'
        });

        // Create Source Stream
        let sourceStream;
        if (streamData.type === 'torrent') {
            sourceStream = streamData.file.createReadStream();
        } else if (streamData.type === 'file') {
            sourceStream = fs.createReadStream(streamData.path);
        } else if (streamData.type === 'url') {
            sourceStream = streamData.url;
        }

        // Use a PassThrough stream to isolate the source from potential ffmpeg kill errors
        const intermediateStream = new PassThrough();

        // Handle errors on the source stream
        // Manual pumping to avoid .pipe() error propagation from streamx
        const onData = (chunk) => {
            if (!intermediateStream.write(chunk)) {
                sourceStream.pause();
                intermediateStream.once('drain', () => sourceStream.resume());
            }
        };

        const onEnd = () => {
            intermediateStream.end();
        };

        const onError = (err) => {
            if (err.message === 'Writable stream closed prematurely') {
                console.log('[StreamHandler] Source stream closed (expected)');
            } else {
                console.error('[StreamHandler] Source Stream Error:', err.message);
            }
        };

        if (sourceStream) {
            sourceStream.on('data', onData);
            sourceStream.on('end', onEnd);
            sourceStream.on('error', onError);
        }

        // Handle errors on intermediate stream (this is what ffmpeg reads from)
        intermediateStream.on('error', (err) => {
            if (err.message === 'Writable stream closed prematurely') {
                console.log('[StreamHandler] Intermediate stream closed (expected)');
            } else {
                console.error('[StreamHandler] Intermediate Stream Error:', err.message);
            }
        });

        const command = ffmpeg(intermediateStream)
            .videoCodec('copy') // Try copy first for speed (containers like mkv -> mp4)
            .audioCodec('aac')
            .format('mp4')
            .outputOptions([
                '-movflags frag_keyframe+empty_moov',
                '-strict experimental',
                '-reset_timestamps 1'
            ])
            .on('error', (err) => {
                if (err.message !== 'Output stream closed') {
                    console.error('[StreamHandler] FFmpeg Error:', err.message);
                }
            });

        const ffStream = command.pipe();

        // Handle FFmpeg output stream errors
        ffStream.on('error', (err) => {
            if (err.message === 'Writable stream closed prematurely' || err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                console.log('[StreamHandler] FFmpeg output stream closed (expected)');
            } else {
                console.error('[StreamHandler] FFmpeg Output Stream Error:', err.message);
            }
        });

        // Handle response stream errors to prevent crash
        res.on('error', (err) => {
            if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.message.includes('closed prematurely')) {
                console.log('[StreamHandler] Response stream closed by client (expected)');
            } else {
                console.error('[StreamHandler] Response Stream Error:', err.message);
            }
        });

        ffStream.pipe(res);

        req.on('close', () => {
            console.log('[StreamHandler] Client disconnected, killing ffmpeg process');

            // Clean up all streams
            // Clean up all streams
            if (sourceStream) {
                // Remove listeners to prevent further events
                if (typeof onData !== 'undefined') sourceStream.removeListener('data', onData);
                if (typeof onEnd !== 'undefined') sourceStream.removeListener('end', onEnd);
                if (typeof onError !== 'undefined') sourceStream.removeListener('error', onError);

                if (typeof sourceStream.unpipe === 'function') sourceStream.unpipe();
                if (typeof sourceStream.destroy === 'function') sourceStream.destroy();
            }
            if (intermediateStream) {
                if (typeof intermediateStream.destroy === 'function') intermediateStream.destroy();
            }

            command.kill();
        });

        return;
    }

    // --- DIRECT STREAM (Seeking Supported) ---
    const range = req.headers.range;

    if (streamData.type === 'torrent') {
        // Add error handler on response to prevent crash
        res.on('error', (err) => {
            if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.message.includes('closed prematurely')) {
                console.log('[StreamHandler] Client disconnected during direct stream (expected)');
            } else {
                console.error('[StreamHandler] Response Error:', err.message);
            }
        });

        if (!range) {
            res.writeHead(200, {
                'Content-Length': streamData.size,
                'Content-Type': 'video/mp4',
                'Access-Control-Allow-Origin': '*'
            });
            const torrentStream = streamData.file.createReadStream();

            // Handle torrent stream errors
            torrentStream.on('error', (err) => {
                if (err.message.includes('closed prematurely') || err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                    console.log('[StreamHandler] Torrent stream closed (expected)');
                } else {
                    console.error('[StreamHandler] Torrent Stream Error:', err.message);
                }
            });

            torrentStream.pipe(res);
        } else {
            const parts = rangeParser(streamData.size, range);
            if (parts === -1 || parts === -2) return res.status(416).send('Range Not Satisfiable');
            const start = parts[0].start;
            const end = parts[0].end;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${streamData.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start) + 1,
                'Content-Type': 'video/mp4',
                'Access-Control-Allow-Origin': '*'
            });
            const torrentStream = streamData.file.createReadStream({ start, end });

            // Handle torrent stream errors
            torrentStream.on('error', (err) => {
                if (err.message.includes('closed prematurely') || err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                    console.log('[StreamHandler] Torrent range stream closed (expected)');
                } else {
                    console.error('[StreamHandler] Torrent Range Stream Error:', err.message);
                }
            });

            torrentStream.pipe(res);
        }
    } else if (streamData.type === 'file') {
        const fileSize = streamData.size;
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const fileStream = fs.createReadStream(streamData.path, { start, end });
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start) + 1,
                'Content-Type': 'video/mp4',
                'Access-Control-Allow-Origin': '*'
            });
            fileStream.pipe(res);
        } else {
            res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4', 'Access-Control-Allow-Origin': '*' });
            fs.createReadStream(streamData.path).pipe(res);
        }
    }
};

# Chitrakatha Local Agent 🚀

This is the standalone **Local Transfer Agent** for the Chitrakatha Watch Party app. It enables high-speed, direct peer-to-peer file streaming over your local network (LAN), bypassing browser limitations.

## ✨ Features
*   **Direct Streaming**: Share files from your disk without uploading to a cloud server.
*   **LAN Transfer**: High-speed transfers (10-50+ MB/s) depending on your Wi-Fi/Ethernet.
*   **Format Support**: Smartly detects and streams `.mp4`, `.mkv`, `.webm`, and `.avi`.
*   **Auto-Discovery**: Automatically connects to the current watch party room.

## 📥 Installation

### Option 1: Download Executable (Recommended for Users)
Download the latest `chitrakatha_agent.exe` from the [Releases Page](../../releases).
*No Node.js or setup required.*

### Option 2: Run from Source (For Developers)
1.  **Clone this repo**:
    ```bash
    git clone https://github.com/en-rypted/chitrakatha_agent.git
    cd local-agent
    ```
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Start the Agent**:
    ```bash
    npm start
    ```

## 🛠️ How to Use

1.  **Start the Agent**: Double-click `chitrakatha_agent.exe` (or run `npm start`).
    *   You should see a terminal window saying "🚀 Local Agent running!".
2.  **Open Chitrakatha**: Go to the Watch Party website in your browser.
3.  **Select "Local Agent"**: In the file transfer panel, switch to the "Local Agent" tab.
    *   The status should turn **Green** (Online).
4.  **Select a File**: Click "Select File from Disk" and choose your video.
5.  **Watch Together**:
    *   **Host**: The video plays instantly.
    *   **Viewers**: Click "Download & Play". The video streams directly from the host's computer to the viewer's computer.

## ⚙️ Configuration
The agent runs on **Port 5178** by default.
To change the port, set the `PORT` environment variable:
```bash
PORT=6000 npm start
```

## 🐛 Troubleshooting

*   **red "Not Detected" Status**:
    *   Ensure the agent terminal is open and running.
    *   Check if your browser is blocking local connections (try disabling ad-blockers for localhost).
*   **"Connection Refused"**:
    *   Allow the agent through your **Windows Firewall** (Private Networks) when prompted.
*   **Video not playing**:
    *   Ensure both Host and Viewer are on the **same LAN** (Wi-Fi network).

## 🏗️ Architecture
*   **Tech Stack**: Node.js, Express, Socket.io Client.
*   **Binding**: Binds to `0.0.0.0` to allow external LAN connections.
*   **CORS**: Explicitly allows `Access-Control-Allow-Origin: *` to let the web app fetch streams.

---
Built with ❤️ for Chitrakatha.

# Chitrakatha Local Agent 🚀

This is the standalone **Local Transfer Agent** for the Chitrakatha Watch Party app. It enables high-speed, direct peer-to-peer file streaming over your local network (LAN), bypassing browser limitations.

## ✨ Features
*   **Torrent Streaming**: Stream torrents instantly via magnet links - no waiting for full downloads!
*   **Background Metadata Extraction**: Torrents start playing immediately, duration appears within 10-60 seconds
*   **Direct File Streaming**: Share files from your disk without uploading to a cloud server
*   **LAN Transfer**: High-speed transfers (10-50+ MB/s) depending on your Wi-Fi/Ethernet
*   **Smart Transcoding**: Automatic conversion of `.mkv`, `.avi`, `.wmv` to browser-compatible formats
*   **Enhanced Stability**: Crash-resistant with comprehensive error handling for disconnects
*   **Auto-Discovery**: Automatically connects to the current watch party room

## 📥 Installation

### Option 1: Download Executable (Recommended for Users)
Download the latest `chitrakatha_agent.exe` from the [Releases Page](../../releases).
*No Node.js or setup required.*

### Option 2: Run from Source (For Developers)
1.  **Clone this repo**:
    ```bash
    git clone https://github.com/en-rypted/chitrakatha_agent.git
    cd chitrakatha_agent
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
The agent runs on **Port 3002** by default.

### Change Port
You can configure the port in three ways:
1. **Via Web UI**: Enter the port number in the "Agent" input field in the header
2. **Environment Variable**: `PORT=3003 npm start`
3. **Config File**: Create `agent-config.json` with `{"PORT": 3003}`

### Set Custom IP (for VPN)
For internet streaming via ZeroTier/Tailscale:
1. Create or edit `agent-config.json`
2. Set your VPN IP: `{"AGENT_IP": "10.147.17.5"}`

## 🐛 Troubleshooting

*   **red "Not Detected" Status**:
    *   Ensure the agent terminal is open and running.
    *   Check if your browser is blocking local connections (try disabling ad-blockers for localhost).
*   **"Connection Refused"**:
    *   Allow the agent through your **Windows Firewall** (Private Networks) when prompted.
*   **Video not playing**:
    *   Ensure both Host and Viewer are on the **same LAN** (Wi-Fi network).

## 🏗️ Architecture
*   **Tech Stack**: Node.js, Express, Socket.io Client, WebTorrent, FFmpeg
*   **Stream Handling**: Multi-format support with automatic transcoding
*   **Torrent Engine**: WebTorrent for efficient P2P streaming
*   **Metadata Extraction**: Background FFprobe processing with retry logic
*   **CORS**: Explicitly allows `Access-Control-Allow-Origin: *` for web app access

## 🌐 Using over the Internet (VPN Guide)

To use this agent securely over the internet, we recommend **ZeroTier**.

### Phase 1: Setup ZeroTier Network
1.  Go to [zerotier.com](https://my.zerotier.com) and Create an Account.
2.  Click **"Create A Network"**.
3.  Copy the **Network ID** (e.g., `8056c2e21c000001`).
4.  In Network Settings, ensure **Access Control** is set to **Private**.

### Phase 2: Install & Join (On BOTH Computers)
1.  Download & Install ZeroTier on both Host and Viewer computers.
2.  Open ZeroTier (look for the icon in the **System Tray / Show Hidden Icons** menu).
3.  Right-click -> **"Join Network"**.
4.  Paste your **Network ID** and click Join.
5.  **Important:** Go back to the ZeroTier Website Dashboard, scroll to "Members", and check the **Auth** box for both computers.

### Phase 3: Configure Local Agent (Host PC Only)
1.  In the ZeroTier Dashboard, find the **Managed IP** for your Host PC (e.g., `10.147.17.5`).
2.  Open the folder where you installed this agent.
3.  Open `agent-config.json` with Notepad (create it if missing).
4.  Update the IP to your **ZeroTier IP**:
    ```json
    {
        "AGENT_IP": "10.147.17.5"
    }
    ```
5.  Save the file and **Restart the Agent**.

---
Built with ❤️ for Chitrakatha.

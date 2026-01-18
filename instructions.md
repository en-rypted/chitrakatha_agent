# Chitrakatha Agent - Instructions

## How to use
1.  Double-click the **Chitrakatha Agent** shortcut on your desktop.
2.  It will open a terminal window showing:
    *   **Port:** 3000
    *   **IP:** Your Local IP (e.g., 192.168.1.5)

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
3.  Open `agent-config.json` with Notepad.
4.  Update the IP to your **ZeroTier IP**:
    ```json
    {
        "AGENT_IP": "10.147.17.5"
    }
    ```
5.  Save the file and **Restart the Agent**.

Your agent is now securely accessible over the internet!

## Troubleshooting
*   **Firewall:** The installer added a firewall rule for you. If blocked, allow `chitrakatha_agent.exe` manually.
*   **Active Directory/SmartScreen Warning:** If Windows warns "Windows protected your PC":
    1.  Click **"More Info"**.
    2.  Click **"Run Anyway"**.
    *   *Why?* This app is not digitally signed (which costs money). It is perfectly safe.
*   **Crash:** If the window closes immediately, check `agent-config.json` for syntax errors.

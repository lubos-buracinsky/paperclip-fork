#!/bin/bash
# Install slack-bridge as a macOS launchd service
# Usage: bash setup-autostart.sh
#
# Tokens are loaded from Infisical at runtime (komfi-internal-apps, dev env).
# To add more workspaces, add their token env vars to Infisical:
#   SLACK_APP_TOKEN_CLIENTX, SLACK_BOT_TOKEN_CLIENTX, etc.

PLIST_NAME="com.komfi.slack-bridge"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
BRIDGE_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_PATH="/opt/homebrew/bin/node"
NPX_PATH="/opt/homebrew/bin/npx"
BIN_DIR="/opt/homebrew/bin"

cat > "$PLIST_PATH" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NPX_PATH}</string>
        <string>infisical</string>
        <string>run</string>
        <string>--env</string>
        <string>dev</string>
        <string>--</string>
        <string>${NODE_PATH}</string>
        <string>${BRIDGE_DIR}/index.mjs</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${BRIDGE_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${BIN_DIR}:/usr/local/bin:/usr/bin:/bin</string>
        <key>INFISICAL_API_URL</key>
        <string>https://eu.infisical.com/api</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${HOME}/slack-bridge.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/slack-bridge.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH"
echo "Installed and started: ${PLIST_NAME}"
echo "Log: ~/slack-bridge.log"

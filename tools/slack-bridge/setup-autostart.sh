#!/bin/bash
# Install slack-bridge as a macOS launchd service
# Usage: bash setup-autostart.sh

PLIST_NAME="com.komfi.slack-bridge"
PLIST_PATH="/Users/lubee/Library/LaunchAgents/.plist"
BRIDGE_DIR=""
NODE_PATH="/opt/homebrew/bin/node"
NPX_PATH="/opt/homebrew/bin/npx"
BIN_DIR="."

cat > "" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string></string>
    <key>ProgramArguments</key>
    <array>
        <string></string>
        <string>infisical</string>
        <string>run</string>
        <string>--env</string>
        <string>dev</string>
        <string>--</string>
        <string></string>
        <string>/index.mjs</string>
    </array>
    <key>WorkingDirectory</key>
    <string></string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>:/usr/local/bin:/usr/bin:/bin</string>
        <key>INFISICAL_API_URL</key>
        <string>https://eu.infisical.com/api</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/lubee/slack-bridge.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/lubee/slack-bridge.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "" 2>/dev/null
launchctl load ""
echo "Installed and started: "
echo "Log: ~/slack-bridge.log"

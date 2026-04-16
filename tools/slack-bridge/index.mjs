import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { WORKSPACES, PAPERCLIP_CLI, POLL_INTERVAL_MS } from "./config.mjs";

// --- Shared caches (channel/user names are global across workspaces) ---

const channelNames = new Map();
async function getChannelName(slack, id) {
  if (channelNames.has(id)) return channelNames.get(id);
  try {
    const info = await slack.conversations.info({ channel: id });
    channelNames.set(id, info.channel.name);
    return info.channel.name;
  } catch { return id; }
}

const userNames = new Map();
async function getUserName(slack, id) {
  if (userNames.has(id)) return userNames.get(id);
  try {
    const info = await slack.users.info({ user: id });
    const name = info.user.real_name || info.user.name;
    userNames.set(id, name);
    return name;
  } catch { return id; }
}

function getImageFiles(event) {
  if (!event.files || event.files.length === 0) return [];
  return event.files
    .filter(f => f.mimetype && f.mimetype.startsWith("image/"))
    .map(f => ({ name: f.name || "image", url: f.url_private, mimetype: f.mimetype }));
}

const PAPERCLIP_API = "http://localhost:3100";

function getPaperclipBoardToken() {
  try {
    const authPath = join(homedir(), ".paperclip", "auth.json");
    const auth = JSON.parse(readFileSync(authPath, "utf-8"));
    const cred = auth.credentials?.[PAPERCLIP_API] || auth.credentials?.["http://localhost:3100"];
    return cred?.token || null;
  } catch { return null; }
}

async function uploadSlackImage(botToken, file, companyId) {
  try {
    const res = await fetch(file.url, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!res.ok) {
      console.error(`Failed to download ${file.name}: ${res.status}`);
      return null;
    }
    const boardToken = getPaperclipBoardToken();
    if (!boardToken) {
      console.error("No Paperclip board token found in ~/.paperclip/auth.json");
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: file.mimetype }), file.name);
    const upload = await fetch(`${PAPERCLIP_API}/api/companies/${companyId}/assets/images`, {
      method: "POST",
      headers: { Authorization: `Bearer ${boardToken}` },
      body: form,
    });
    if (!upload.ok) {
      console.error(`Failed to upload ${file.name}: ${upload.status} ${await upload.text()}`);
      return null;
    }
    const asset = await upload.json();
    return { name: file.name, path: asset.contentPath };
  } catch (e) {
    console.error(`Image transfer failed for ${file.name}:`, e.message);
    return null;
  }
}

async function transferImages(botToken, event, companyId) {
  const files = getImageFiles(event);
  if (files.length === 0) return "";
  const results = await Promise.all(files.map(f => uploadSlackImage(botToken, f, companyId)));
  return results
    .filter(Boolean)
    .map(r => `![${r.name}](${r.path})`)
    .join("\n");
}

// --- Routing ---

function resolveRouting(wsConfig, channelId) {
  if (wsConfig.routing === "triage") return wsConfig.triage;
  if (wsConfig.routing === "direct") return wsConfig.channels?.[channelId] || null;
  return null;
}

// --- Paperclip CLI ---

function createIssue(description, routing) {
  try {
    const result = execSync(
      `${PAPERCLIP_CLI} issue create -C ${routing.companyId} ` +
      `--description "${description.replace(/"/g, '\\"')}" ` +
      `--assignee-agent-id ${routing.assigneeAgentId} ` +
      `--project-id ${routing.projectId} --priority medium --status todo --json`,
      { encoding: "utf-8", timeout: 30000 }
    );
    return JSON.parse(result);
  } catch (e) {
    console.error("Failed to create issue:", e.message);
    return null;
  }
}

function addComment(issueId, text) {
  try {
    execSync(
      `${PAPERCLIP_CLI} issue comment ${issueId} --comment "${text.replace(/"/g, '\\"')}" `,
      { encoding: "utf-8", timeout: 30000 }
    );
    return true;
  } catch (e) {
    console.error("Failed to add comment:", e.message);
    return false;
  }
}

function getNewAgentComments(companyId) {
  try {
    const result = execSync(
      `${PAPERCLIP_CLI} activity list -C ${companyId} --json`,
      { encoding: "utf-8", timeout: 30000 }
    );
    const activities = JSON.parse(result);
    const comments = [];
    for (const a of activities) {
      if (a.action === "issue.comment_added" && a.agentId && a.details) {
        comments.push({
          id: a.id,
          issueId: a.entityId,
          identifier: a.details.identifier,
          snippet: a.details.bodySnippet || "",
          agentId: a.agentId,
        });
      }
    }
    return comments;
  } catch { return []; }
}

// --- Per-workspace polling ---

async function pollCompletedIssues(ws) {
  if (ws.pendingCheckmarks.size === 0 && ws.threadToIssue.size === 0) return;

  // Collect unique company IDs from this workspace's pending issues
  const companyIds = new Set();
  for (const { routing } of ws.pendingCheckmarks.values()) {
    companyIds.add(routing.companyId);
  }

  // Post new agent comments to Slack threads FIRST (before cleaning up done issues)
  for (const companyId of companyIds) {
    try {
      const comments = getNewAgentComments(companyId);
      for (const c of comments) {
        if (ws.postedAgentComments.has(c.id)) continue;

        for (const [ts, issueId] of ws.threadToIssue) {
          if (issueId === c.issueId && c.snippet) {
            const pending = ws.pendingCheckmarks.get(issueId);
            if (pending) {
              try {
                await ws.slack.chat.postMessage({
                  channel: pending.channel,
                  thread_ts: ts,
                  text: c.snippet,
                });
                console.log(`  [${ws.name}] -> slack thread ${c.identifier}`);
              } catch (e) {
                console.error("Failed to post to thread:", e.message);
              }
            }
            ws.postedAgentComments.add(c.id);
            break;
          }
        }
      }
    } catch {}
  }

  // Then check for done/blocked status and clean up maps
  for (const companyId of companyIds) {
    try {
      const result = execSync(
        `${PAPERCLIP_CLI} issue list -C ${companyId} --json`,
        { encoding: "utf-8", timeout: 30000 }
      );
      const issues = JSON.parse(result);

      for (const issue of issues) {
        if (!ws.pendingCheckmarks.has(issue.id)) continue;
        const { channel, ts, identifier, routing } = ws.pendingCheckmarks.get(issue.id);

        if (issue.status === "done") {
          console.log(`  [${ws.name}] done ${identifier}`);
          try { await ws.slack.reactions.remove({ channel, name: "eyes", timestamp: ts }); } catch {}
          try { await ws.slack.reactions.add({ channel, name: "white_check_mark", timestamp: ts }); } catch {}
          ws.pendingCheckmarks.delete(issue.id);
          ws.threadToIssue.delete(ts);

        } else if (issue.status === "blocked" && !ws.notifiedBlocked.has(issue.id)) {
          console.log(`  [${ws.name}] blocked ${identifier}`);
          try { await ws.slack.reactions.add({ channel, name: "warning", timestamp: ts }); } catch {}

          const comments = getNewAgentComments(routing.companyId);
          const agentComment = comments.find(c => c.issueId === issue.id);
          if (agentComment) {
            const notifyUser = routing.notifyUserId ? `<@${routing.notifyUserId}> ` : "";
            const commentText = agentComment.snippet;
            try {
              await ws.slack.chat.postMessage({
                channel,
                thread_ts: ts,
                text: `${notifyUser}:warning: *${identifier}* je blokovaný:\n${commentText}\n\n${routing.webUrlBase}${identifier}`,
              });
            } catch (e) {
              console.error("Failed to reply:", e.message);
            }
          }
          ws.notifiedBlocked.add(issue.id);
        }
      }
    } catch (e) {
      console.error(`[${ws.name}] Poll error:`, e.message);
    }
  }
}


// --- Per-workspace reaction handler ---

function createReactionHandler(ws) {
  const processedReactions = new Set();

  return async ({ event, ack }) => {
    await ack();
    const triggerEmoji = ws.config.triggerEmoji || "robot_face";
    if (event.reaction !== triggerEmoji) return;
    if (event.item?.type !== "message") return;

    const channel = event.item.channel;
    const ts = event.item.ts;
    const reactionKey = `${channel}:${ts}:${triggerEmoji}`;
    if (processedReactions.has(reactionKey)) return;
    processedReactions.add(reactionKey);

    const routing = resolveRouting(ws.config, channel);
    if (!routing) return;

    // Try to fetch as root channel message
    let msg = null;
    try {
      const history = await ws.slack.conversations.history({
        channel,
        latest: ts,
        oldest: ts,
        inclusive: true,
        limit: 1,
      });
      msg = history.messages?.[0];
    } catch {}

    // If this is a thread reply, add comment to the corresponding issue
    if (msg && msg.thread_ts && msg.thread_ts !== ts) {
      const parentTs = msg.thread_ts;
      const issueId = ws.threadToIssue.get(parentTs);
      if (issueId) {
        const userName = await getUserName(ws.slack, msg.user);
        const text = msg.text || "(no text)";
        const imagesMd = await transferImages(ws.botToken, msg, routing.companyId);
        console.log(`  [${ws.name}] :${triggerEmoji}: on thread reply -> comment on issue`);
        addComment(issueId, `**${userName} (Slack):** ${text}${imagesMd ? "\n" + imagesMd : ""}`);
        try { await ws.slack.reactions.add({ channel, name: "eyes", timestamp: ts }); } catch {}
      }
      return;
    }

    // If not found via history, try to find it as a thread reply of an existing issue
    if (!msg) {
      for (const [parentTs, issueId] of ws.threadToIssue) {
        try {
          const replies = await ws.slack.conversations.replies({ channel, ts: parentTs });
          const found = replies.messages?.find(m => m.ts === ts);
          if (found) {
            const userName = await getUserName(ws.slack, found.user);
            const text = found.text || "(no text)";
            const imagesMd = await transferImages(ws.botToken, found, routing.companyId);
            console.log(`  [${ws.name}] :${triggerEmoji}: on thread reply -> comment on issue`);
            addComment(issueId, `**${userName} (Slack):** ${text}${imagesMd ? "\n" + imagesMd : ""}`);
            try { await ws.slack.reactions.add({ channel, name: "eyes", timestamp: ts }); } catch {}
            return;
          }
        } catch {}
      }
      return;
    }

    // Root message: create new issue
    const userName = await getUserName(ws.slack, msg.user);
    const text = msg.text || "(no text)";
    const imagesMd = await transferImages(ws.botToken, msg, routing.companyId);
    const channelName = await getChannelName(ws.slack, channel);

    console.log(`[${ws.name}/${channelName}] :${triggerEmoji}: -> ${userName}: ${text.substring(0, 100)}`);

    const description = [
      "## Ze Slacku", "",
      `**Kanal:** #${channelName}`,
      `**Od:** ${userName}`,
      `**Cas:** ${new Date(parseFloat(ts) * 1000).toISOString()}`,
      `**Trigger:** :${triggerEmoji}: reakce`,
      "", "## Zprava", "", text, ...(imagesMd ? ["", "## Obrazky", "", imagesMd] : []),
    ].join("\n");

    const issue = createIssue(description, routing);
    if (issue) {
      console.log(`  [${ws.name}] -> ${issue.identifier}`);
      try { await ws.slack.reactions.add({ channel, name: "eyes", timestamp: ts }); } catch {}
      ws.pendingCheckmarks.set(issue.id, { channel, ts, identifier: issue.identifier, routing });
      ws.threadToIssue.set(ts, issue.id);
    }
  };
}

// --- Per-workspace message handler ---

function createMessageHandler(ws) {
  const processed = new Set();

  return async ({ event, body, ack }) => {
    await ack();
    if (event.bot_id) return;
    if (event.subtype && event.subtype !== "file_share") return;
    if (ws.config.watchChannels.length > 0 && !ws.config.watchChannels.includes(event.channel)) return;
    if (processed.has(event.ts)) return;
    processed.add(event.ts);
    if (processed.size > 1000) {
      const arr = [...processed];
      arr.slice(0, arr.length - 1000).forEach(ts => processed.delete(ts));
    }

    const routing = resolveRouting(ws.config, event.channel);
    if (!routing) return; // unknown channel in direct mode

    const userName = await getUserName(ws.slack, event.user);
    const text = event.text || "(no text)";

    // Channels that require explicit :robot_face: reaction to create issue/comment
    const reactionOnly = (ws.config.reactionTriggerChannels || []).includes(event.channel);

    const imagesMd = await transferImages(ws.botToken, event, routing.companyId);

    // Thread reply -> add comment to existing issue (skip for reaction-only channels)
    if (event.thread_ts && ws.threadToIssue.has(event.thread_ts)) {
      if (reactionOnly) return; // wait for :robot_face: reaction
      const issueId = ws.threadToIssue.get(event.thread_ts);
      console.log(`  [${ws.name}] thread reply -> comment on issue`);
      addComment(issueId, `**${userName} (Slack):** ${text}${imagesMd ? "\n" + imagesMd : ""}`);
      return;
    }

    // New message -> create issue (skip for reaction-only channels)
    if (reactionOnly) {
      console.log(`  [${ws.name}] reaction-only channel, waiting for :${ws.config.triggerEmoji || "robot_face"}: trigger`);
      return;
    }

    const channelName = await getChannelName(ws.slack, event.channel);
    console.log(`[${ws.name}/${channelName}] ${userName}: ${text.substring(0, 100)}`);

    const description = [
      "## Ze Slacku", "",
      `**Kanal:** #${channelName}`,
      `**Od:** ${userName}`,
      `**Cas:** ${new Date(parseFloat(event.ts) * 1000).toISOString()}`,
      "", "## Zprava", "", text, ...(imagesMd ? ["", "## Obrazky", "", imagesMd] : []),
    ].join("\n");

    const issue = createIssue(description, routing);
    if (issue && imagesMd) console.log(`  [${ws.name}] uploaded ${getImageFiles(event).length} image(s)`);
    if (issue) {
      console.log(`  [${ws.name}] -> ${issue.identifier}`);
      try { await ws.slack.reactions.add({ channel: event.channel, name: "eyes", timestamp: event.ts }); } catch {}
      ws.pendingCheckmarks.set(issue.id, { channel: event.channel, ts: event.ts, identifier: issue.identifier, routing });
      ws.threadToIssue.set(event.ts, issue.id);
    }
  };
}

// --- Startup ---

const connections = [];

for (const wsConfig of WORKSPACES) {
  const appToken = process.env[wsConfig.appTokenEnv];
  const botToken = process.env[wsConfig.botTokenEnv];

  if (!appToken || !botToken) {
    console.error(`[${wsConfig.name}] Missing ${wsConfig.appTokenEnv} or ${wsConfig.botTokenEnv}, skipping`);
    continue;
  }

  const slack = new WebClient(botToken);
  const socket = new SocketModeClient({ appToken });

  const ws = {
    name: wsConfig.name,
    config: wsConfig,
    slack,
    socket,
    botToken,
    pendingCheckmarks: new Map(),
    threadToIssue: new Map(),
    notifiedBlocked: new Set(),
    postedAgentComments: new Set(),
  };

  socket.on("message", createMessageHandler(ws));
  socket.on("reaction_added", createReactionHandler(ws));
  socket.on("connected", () => {
    console.log(`[${ws.name}] Connected (${wsConfig.routing} routing)`);
  });
  socket.on("error", (err) => console.error(`[${ws.name}] Socket error:`, err.message));

  setInterval(() => pollCompletedIssues(ws), POLL_INTERVAL_MS);
  await socket.start();
  connections.push(ws);
}

if (connections.length === 0) {
  console.error("No workspaces connected. Check your environment variables.");
  process.exit(1);
}

console.log(`Slack bridge started: ${connections.map(c => c.name).join(", ")}. Polling every ${POLL_INTERVAL_MS / 1000}s.`);

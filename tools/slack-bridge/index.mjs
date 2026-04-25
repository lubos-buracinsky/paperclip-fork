import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { WORKSPACES, PAPERCLIP_CLI, POLL_INTERVAL_MS } from "./config.mjs";

// --- State file (per-channel last seen ts for post-mortem backfill) ---

const STATE_FILE = join(homedir(), ".slack-bridge-state.json");
const BACKFILL_FALLBACK_HOURS = 24;

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch { return {}; }
}

function saveState(state) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("Failed to persist state:", e.message);
  }
}

const state = loadState();

function stateKey(wsName, channel) { return `${wsName}:${channel}`; }

function getLastSeen(wsName, channel) {
  return state[stateKey(wsName, channel)] || null;
}

function updateLastSeen(wsName, channel, ts) {
  const key = stateKey(wsName, channel);
  const prev = state[key];
  if (!prev || parseFloat(ts) > parseFloat(prev)) {
    state[key] = ts;
    saveState(state);
  }
}

// Per-workspace runtime state (pendingCheckmarks/threadToIssue/notifiedBlocked)
// MUST survive restarts: the bridge daemon respawns on websocket errors, and
// without persistence the in-memory Maps reset → status notifications and thread
// replies for issues created before the restart silently stop working.

function wsStateKey(wsName) { return `_ws:${wsName}`; }

function loadWorkspaceState(wsName) {
  const raw = state[wsStateKey(wsName)] || {};
  return {
    pendingCheckmarks: new Map(raw.pendingCheckmarks || []),
    notifiedBlocked: new Set(raw.notifiedBlocked || []),
    threadToIssue: new Map(raw.threadToIssue || []),
  };
}

function persistWs(ws) {
  state[wsStateKey(ws.name)] = {
    pendingCheckmarks: [...ws.pendingCheckmarks],
    notifiedBlocked: [...ws.notifiedBlocked],
    threadToIssue: [...ws.threadToIssue],
  };
  saveState(state);
}

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

function deriveTitle(text) {
  const firstLine = (text || "")
    .split("\n")
    .map(l => l.trim())
    .find(l => l && !l.startsWith("#") && !l.startsWith("**") && !l.startsWith("!["));
  const candidate = firstLine || "Zprava ze Slacku";
  return candidate.length > 80 ? candidate.slice(0, 77) + "..." : candidate;
}

function createIssue(description, routing, titleSource) {
  const title = deriveTitle(titleSource ?? description);
  try {
    const result = execSync(
      `${PAPERCLIP_CLI} issue create -C ${routing.companyId} ` +
      `--title "${title.replace(/"/g, '\\"')}" ` +
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

function getLatestAgentCommentForIssue(companyId, issueId) {
  try {
    const result = execSync(
      `${PAPERCLIP_CLI} activity list -C ${companyId} --json`,
      { encoding: "utf-8", timeout: 30000 }
    );
    const activities = JSON.parse(result);
    let best = null;
    let bestTime = -1;
    for (const a of activities) {
      if (a.action !== "issue.comment_added") continue;
      if (a.entityId !== issueId) continue;
      if (!a.agentId || !a.details?.bodySnippet) continue;
      const t = new Date(a.createdAt || a.timestamp || a.updatedAt || 0).getTime() || 0;
      if (t >= bestTime) {
        bestTime = t;
        best = {
          id: a.id,
          issueId: a.entityId,
          identifier: a.details.identifier,
          snippet: a.details.bodySnippet || "",
          commentId: a.details.commentId || null,
          agentId: a.agentId,
        };
      }
    }
    return best;
  } catch { return null; }
}

// Server's bodySnippet may be 120-char truncated on older deploys → fetch full
// body via authenticated API. Returns null on any failure (caller falls back
// to snippet).
async function fetchAgentCommentBody(issueId, commentId) {
  try {
    const token = getPaperclipBoardToken();
    if (!token) return null;
    const res = await fetch(`${PAPERCLIP_API}/api/issues/${issueId}/comments?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const comments = await res.json();
    if (!Array.isArray(comments)) return null;
    const target = commentId
      ? comments.find(c => c.id === commentId)
      : [...comments]
          .filter(c => c.authorAgentId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    return target?.body || null;
  } catch { return null; }
}

// --- Slack Block Kit formatting ---

function mdToSlackMrkdwn(text) {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/__([^_\n]+)__/g, "*$1*")
    .replace(/^(\s*)-\s+/gm, "$1• ");
}

function chunkText(text, limit) {
  if (text.length <= limit) return [text];
  const out = [];
  for (let i = 0; i < text.length; i += limit) out.push(text.slice(i, i + limit));
  return out;
}

function messageToBlocks(text) {
  const blocks = [];
  const lines = (text || "").split("\n");
  let buffer = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const content = buffer.join("\n").trim();
    if (content) {
      for (const chunk of chunkText(mdToSlackMrkdwn(content), 2900)) {
        blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (headerMatch) {
      flushBuffer();
      blocks.push({
        type: "header",
        text: { type: "plain_text", text: headerMatch[1].slice(0, 150), emoji: true },
      });
    } else {
      buffer.push(line);
    }
  }
  flushBuffer();
  return blocks;
}

function buildStatusBlocks({ statusEmoji, statusLabel, identifier, webUrl, mention, body }) {
  const contextText = `${mention ? mention + " " : ""}:${statusEmoji}: <${webUrl}|*${identifier}*> — ${statusLabel}`;
  return [
    { type: "context", elements: [{ type: "mrkdwn", text: contextText }] },
    ...messageToBlocks(body),
  ];
}

// --- Per-workspace polling ---

async function pollCompletedIssues(ws) {
  if (ws.pendingCheckmarks.size === 0 && ws.threadToIssue.size === 0) return;

  const companyIds = new Set();
  for (const { routing } of ws.pendingCheckmarks.values()) {
    companyIds.add(routing.companyId);
  }

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
        const webUrl = `${routing.webUrlBase}${identifier}`;

        if (issue.status === "done") {
          console.log(`  [${ws.name}] done ${identifier}`);
          try { await ws.slack.reactions.remove({ channel, name: "eyes", timestamp: ts }); } catch {}
          try { await ws.slack.reactions.add({ channel, name: "white_check_mark", timestamp: ts }); } catch {}

          const last = getLatestAgentCommentForIssue(routing.companyId, issue.id);
          if (last?.snippet) {
            const fullBody = await fetchAgentCommentBody(issue.id, last.commentId);
            const blocks = buildStatusBlocks({
              statusEmoji: "white_check_mark",
              statusLabel: "hotovo",
              identifier,
              webUrl,
              body: fullBody || last.snippet,
            });
            try {
              await ws.slack.chat.postMessage({
                channel,
                thread_ts: ts,
                text: `${identifier} — hotovo`,
                blocks,
                unfurl_links: false,
                unfurl_media: false,
              });
            } catch (e) {
              console.error("Failed to post done summary:", e.message);
            }
          }

          ws.pendingCheckmarks.delete(issue.id);
          ws.threadToIssue.delete(ts);
          persistWs(ws);

        } else if (issue.status === "blocked" && !ws.notifiedBlocked.has(issue.id)) {
          console.log(`  [${ws.name}] blocked ${identifier}`);
          try { await ws.slack.reactions.add({ channel, name: "warning", timestamp: ts }); } catch {}

          const last = getLatestAgentCommentForIssue(routing.companyId, issue.id);
          if (last?.snippet) {
            const fullBody = await fetchAgentCommentBody(issue.id, last.commentId);
            const mention = routing.notifyUserId ? `<@${routing.notifyUserId}>` : "";
            const blocks = buildStatusBlocks({
              statusEmoji: "warning",
              statusLabel: "blokovaný",
              identifier,
              webUrl,
              mention,
              body: fullBody || last.snippet,
            });
            try {
              await ws.slack.chat.postMessage({
                channel,
                thread_ts: ts,
                text: `${identifier} — blokovaný`,
                blocks,
                unfurl_links: false,
                unfurl_media: false,
              });
            } catch (e) {
              console.error("Failed to post blocked summary:", e.message);
            }
          }
          ws.notifiedBlocked.add(issue.id);
          persistWs(ws);
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

    const issue = createIssue(description, routing, text);
    if (issue) {
      console.log(`  [${ws.name}] -> ${issue.identifier}`);
      try { await ws.slack.reactions.add({ channel, name: "eyes", timestamp: ts }); } catch {}
      ws.pendingCheckmarks.set(issue.id, { channel, ts, identifier: issue.identifier, routing });
      ws.threadToIssue.set(ts, issue.id);
      persistWs(ws);
    }
  };
}

// --- Message processing (shared by live events and backfill) ---

async function processMessageEvent(ws, event, { source = "live" } = {}) {
  if (event.bot_id) return;
  if (event.subtype && event.subtype !== "file_share") return;
  if (ws.config.watchChannels.length > 0 && !ws.config.watchChannels.includes(event.channel)) return;
  if (ws.processed.has(event.ts)) return;
  ws.processed.add(event.ts);
  if (ws.processed.size > 1000) {
    const arr = [...ws.processed];
    arr.slice(0, arr.length - 1000).forEach(ts => ws.processed.delete(ts));
  }

  const routing = resolveRouting(ws.config, event.channel);
  if (!routing) return;

  // lastSeen is updated only AFTER successful processing. If createIssue/addComment
  // fails (e.g., paperclip API down), lastSeen stays at old value so the next
  // reconnect's backfill re-scans and re-tries this message. On persistent failure
  // the backfill keeps retrying on each reconnect until the API is back.

  const userName = await getUserName(ws.slack, event.user);
  const text = event.text || "(no text)";

  const reactionOnly = (ws.config.reactionTriggerChannels || []).includes(event.channel);

  const imagesMd = await transferImages(ws.botToken, event, routing.companyId);

  if (event.thread_ts && ws.threadToIssue.has(event.thread_ts)) {
    if (reactionOnly) {
      updateLastSeen(ws.name, event.channel, event.ts);
      return;
    }
    const issueId = ws.threadToIssue.get(event.thread_ts);
    console.log(`  [${ws.name}] thread reply -> comment on issue${source === "backfill" ? " (backfill)" : ""}`);
    const ok = addComment(issueId, `**${userName} (Slack):** ${text}${imagesMd ? "\n" + imagesMd : ""}`);
    if (ok) updateLastSeen(ws.name, event.channel, event.ts);
    else console.error(`  [${ws.name}] comment dropped — will retry on reconnect (lastSeen unchanged)`);
    return;
  }

  if (reactionOnly) {
    if (source === "live") {
      console.log(`  [${ws.name}] reaction-only channel, waiting for :${ws.config.triggerEmoji || "robot_face"}: trigger`);
    }
    updateLastSeen(ws.name, event.channel, event.ts);
    return;
  }

  const channelName = await getChannelName(ws.slack, event.channel);
  const tag = source === "backfill" ? " (backfill)" : "";
  console.log(`[${ws.name}/${channelName}]${tag} ${userName}: ${text.substring(0, 100)}`);

  const description = [
    "## Ze Slacku", "",
    `**Kanal:** #${channelName}`,
    `**Od:** ${userName}`,
    `**Cas:** ${new Date(parseFloat(event.ts) * 1000).toISOString()}`,
    ...(source === "backfill" ? [`**Zdroj:** backfill (post-mortem)`] : []),
    "", "## Zprava", "", text, ...(imagesMd ? ["", "## Obrazky", "", imagesMd] : []),
  ].join("\n");

  const issue = createIssue(description, routing, text);
  if (!issue) {
    console.error(`  [${ws.name}] issue create dropped — will retry on reconnect (lastSeen unchanged)`);
    return;
  }
  if (imagesMd) console.log(`  [${ws.name}] uploaded ${getImageFiles(event).length} image(s)`);
  console.log(`  [${ws.name}] -> ${issue.identifier}`);
  try { await ws.slack.reactions.add({ channel: event.channel, name: "eyes", timestamp: event.ts }); } catch {}
  ws.pendingCheckmarks.set(issue.id, { channel: event.channel, ts: event.ts, identifier: issue.identifier, routing });
  ws.threadToIssue.set(event.ts, issue.id);
  persistWs(ws);
  updateLastSeen(ws.name, event.channel, event.ts);
}

function createMessageHandler(ws) {
  return async ({ event, ack }) => {
    await ack();
    await processMessageEvent(ws, event, { source: "live" });
  };
}

// --- Post-mortem backfill (direct routing only) ---

async function backfillChannel(ws, channel) {
  const lastSeen = getLastSeen(ws.name, channel);
  const isTriage = ws.config.routing === "triage";

  // First-time triage: do NOT bulk-import history (could create 24h of stale issues
  // across every channel the bot joined). Initialize lastSeen to now so subsequent
  // reconnects catch only the gap.
  if (!lastSeen && isTriage) {
    updateLastSeen(ws.name, channel, String(Date.now() / 1000));
    console.log(`[${ws.name}] backfill: triage init ${channel} to now (no history import)`);
    return;
  }

  const fallback = (Date.now() / 1000) - BACKFILL_FALLBACK_HOURS * 3600;
  const oldest = lastSeen ? parseFloat(lastSeen) : fallback;

  console.log(`[${ws.name}] backfill scan ${channel} oldest=${oldest} lastSeen=${lastSeen || "none"}`);

  let cursor = undefined;
  let batches = 0;
  let totalFetched = 0;
  const collected = [];
  do {
    let res;
    try {
      res = await ws.slack.conversations.history({
        channel,
        oldest: String(oldest),
        limit: 200,
        cursor,
      });
    } catch (e) {
      console.error(`[${ws.name}] backfill history failed for ${channel}:`, e.message);
      return;
    }
    if (!res.ok) {
      console.error(`[${ws.name}] backfill history !ok for ${channel}:`, res.error);
      return;
    }
    const msgs = res.messages || [];
    totalFetched += msgs.length;
    for (const msg of msgs) {
      if (parseFloat(msg.ts) > parseFloat(lastSeen || "0")) collected.push(msg);
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    batches++;
  } while (cursor && batches < 5);

  collected.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
  console.log(`[${ws.name}] backfill ${channel}: fetched=${totalFetched} eligible=${collected.length}`);
  if (collected.length === 0) return;

  for (const msg of collected) {
    await processMessageEvent(ws, { ...msg, channel }, { source: "backfill" });
  }
}

async function listTriageChannels(ws) {
  const out = [];
  let cursor;
  do {
    let res;
    try {
      res = await ws.slack.users.conversations({
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor,
      });
    } catch (e) {
      console.error(`[${ws.name}] listTriageChannels failed:`, e.message);
      return out;
    }
    if (!res.ok) {
      console.error(`[${ws.name}] listTriageChannels !ok:`, res.error);
      return out;
    }
    for (const c of res.channels || []) out.push(c.id);
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

async function backfillWorkspace(ws) {
  let channelIds;
  if (ws.config.routing === "direct") {
    channelIds = Object.keys(ws.config.channels || {});
  } else if (ws.config.routing === "triage") {
    channelIds = await listTriageChannels(ws);
  } else {
    console.log(`[${ws.name}] backfill skipped (unknown routing=${ws.config.routing})`);
    return;
  }

  console.log(`[${ws.name}] backfill starting for ${channelIds.length} channel(s) (${ws.config.routing} routing)`);
  for (const channel of channelIds) {
    try { await backfillChannel(ws, channel); }
    catch (e) { console.error(`[${ws.name}] backfill error in ${channel}:`, e.message); }
  }
  console.log(`[${ws.name}] backfill done`);
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

  const restored = loadWorkspaceState(wsConfig.name);
  const ws = {
    name: wsConfig.name,
    config: wsConfig,
    slack,
    socket,
    botToken,
    pendingCheckmarks: restored.pendingCheckmarks,
    threadToIssue: restored.threadToIssue,
    notifiedBlocked: restored.notifiedBlocked,
    processed: new Set(),
    backfillRunning: false,
  };
  if (restored.pendingCheckmarks.size || restored.notifiedBlocked.size) {
    console.log(`[${wsConfig.name}] restored state: pending=${restored.pendingCheckmarks.size} blocked=${restored.notifiedBlocked.size} threads=${restored.threadToIssue.size}`);
  }

  socket.on("message", createMessageHandler(ws));
  socket.on("reaction_added", createReactionHandler(ws));
  socket.on("connected", () => {
    console.log(`[${ws.name}] Connected (${wsConfig.routing} routing)`);
    if (ws.backfillRunning) return;
    ws.backfillRunning = true;
    backfillWorkspace(ws)
      .catch(e => console.error(`[${ws.name}] backfill crashed:`, e.message))
      .finally(() => { ws.backfillRunning = false; });
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

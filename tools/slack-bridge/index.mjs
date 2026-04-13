import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { execSync } from "node:child_process";

const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const WATCH_CHANNELS = (process.env.WATCH_CHANNELS || "").split(",").filter(Boolean);
const CEO_AGENT_ID = "9a5b9dc6-068c-4702-b3ff-d97fb162c290";
const COMPANY_ID = "a9d33dc4-ba89-4162-8550-178a7d639a7b";
const PAPERCLIP_CLI = "/opt/homebrew/bin/paperclipai";
const POLL_INTERVAL_MS = 60_000;

if (!SLACK_APP_TOKEN || !SLACK_BOT_TOKEN) {
  console.error("Missing SLACK_APP_TOKEN or SLACK_BOT_TOKEN");
  process.exit(1);
}

const slack = new WebClient(SLACK_BOT_TOKEN);
const socket = new SocketModeClient({ appToken: SLACK_APP_TOKEN });

// Track: issueId -> { channel, ts, identifier }
const pendingCheckmarks = new Map();
// Track: slackParentTs -> issueId (for thread replies)
const threadToIssue = new Map();
const notifiedBlocked = new Set();
// Track which agent comments we already posted to Slack (avoid echo)
const postedAgentComments = new Set();
const processed = new Set();

const channelNames = new Map();
async function getChannelName(id) {
  if (channelNames.has(id)) return channelNames.get(id);
  try {
    const info = await slack.conversations.info({ channel: id });
    channelNames.set(id, info.channel.name);
    return info.channel.name;
  } catch { return id; }
}

const userNames = new Map();
async function getUserName(id) {
  if (userNames.has(id)) return userNames.get(id);
  try {
    const info = await slack.users.info({ user: id });
    const name = info.user.real_name || info.user.name;
    userNames.set(id, name);
    return name;
  } catch { return id; }
}


async function getFileUrls(event) {
  if (!event.files || event.files.length === 0) return [];
  return event.files
    .filter(f => f.mimetype && f.mimetype.startsWith("image/"))
    .map(f => ({ name: f.name || "image", url: f.url_private }));
}

function createIssue(title, description) {
  try {
    const result = execSync(
      `${PAPERCLIP_CLI} issue create -C ${COMPANY_ID} ` +
      `--title "${title.replace(/"/g, '\\"')}" ` +
      `--description "${description.replace(/"/g, '\\"')}" ` +
      `--assignee-agent-id ${CEO_AGENT_ID} ` +
      `--project-id 8200d832-3101-4548-bb73-a3acc878bdaa --priority medium --status todo --json`,
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

function getNewAgentComments() {
  try {
    const result = execSync(
      `${PAPERCLIP_CLI} activity list -C ${COMPANY_ID} --json`,
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

async function pollCompletedIssues() {
  if (pendingCheckmarks.size === 0 && threadToIssue.size === 0) return;

  try {
    const result = execSync(
      `${PAPERCLIP_CLI} issue list -C ${COMPANY_ID} --json`,
      { encoding: "utf-8", timeout: 30000 }
    );
    const issues = JSON.parse(result);

    for (const issue of issues) {
      if (!pendingCheckmarks.has(issue.id)) continue;
      const { channel, ts, identifier } = pendingCheckmarks.get(issue.id);

      if (issue.status === "done") {
        console.log(`  done ${identifier}`);
        try { await slack.reactions.remove({ channel, name: "eyes", timestamp: ts }); } catch {}
        try { await slack.reactions.add({ channel, name: "white_check_mark", timestamp: ts }); } catch {}
        pendingCheckmarks.delete(issue.id);
        threadToIssue.delete(ts);

      } else if (issue.status === "blocked" && !notifiedBlocked.has(issue.id)) {
        console.log(`  blocked ${identifier}`);
        try { await slack.reactions.add({ channel, name: "warning", timestamp: ts }); } catch {}

        // Find last agent comment for this issue
        const comments = getNewAgentComments();
        const agentComment = comments.find(c => c.issueId === issue.id);
        if (agentComment) {
          try {
            await slack.chat.postMessage({
              channel,
              thread_ts: ts,
              text: `<@U017DCMA1SS> :warning: *${identifier}* je blokovaný:\n${agentComment.snippet.substring(0, 300)}\n\nhttp://100.81.141.101:3100/KOM/issues/${identifier}`,
            });
          } catch (e) {
            console.error("Failed to reply:", e.message);
          }
        }
        notifiedBlocked.add(issue.id);
      }
    }
  } catch (e) {
    console.error("Poll error:", e.message);
  }

  // Check for new agent comments on tracked issues -> post to Slack thread
  try {
    const comments = getNewAgentComments();
    for (const c of comments) {
      if (postedAgentComments.has(c.id)) continue;

      // Find the Slack thread for this issue
      for (const [ts, issueId] of threadToIssue) {
        if (issueId === c.issueId && c.snippet) {
          // Find channel from pendingCheckmarks
          const pending = [...pendingCheckmarks.values()].find(p => p.ts === ts);
          if (pending) {
            try {
              await slack.chat.postMessage({
                channel: pending.channel,
                thread_ts: ts,
                text: c.snippet.substring(0, 500),
              });
              console.log(`  -> slack thread ${c.identifier}`);
            } catch (e) {
              console.error("Failed to post to thread:", e.message);
            }
          }
          postedAgentComments.add(c.id);
          break;
        }
      }
    }
  } catch {}
}

setInterval(pollCompletedIssues, POLL_INTERVAL_MS);

socket.on("message", async ({ event, body, ack }) => {
  await ack();
  if (event.bot_id || event.subtype) return;
  if (WATCH_CHANNELS.length > 0 && !WATCH_CHANNELS.includes(event.channel)) return;
  if (processed.has(event.ts)) return;
  processed.add(event.ts);
  if (processed.size > 1000) {
    const arr = [...processed];
    arr.slice(0, arr.length - 1000).forEach(ts => processed.delete(ts));
  }

  const userName = await getUserName(event.user);
  const text = event.text || "(no text)";
  const files = await getFileUrls(event);
  const imagesMd = files.map(f => "![" + f.name + "](" + f.url + ")").join("\n");

  // Thread reply -> add comment to existing issue
  if (event.thread_ts && threadToIssue.has(event.thread_ts)) {
    const issueId = threadToIssue.get(event.thread_ts);
    console.log(`  thread reply -> comment on issue`);
    addComment(issueId, `**${userName} (Slack):** ${text}${imagesMd ? "\n" + imagesMd : ""}`);
    return;
  }

  // New message -> create issue
  const channelName = await getChannelName(event.channel);
  console.log(`[${channelName}] ${userName}: ${text.substring(0, 100)}`);

  const title = text.length > 80 ? text.substring(0, 77) + "..." : text;
  const description = [
    "## Ze Slacku", "",
    `**Kanal:** #${channelName}`,
    `**Od:** ${userName}`,
    `**Cas:** ${new Date(parseFloat(event.ts) * 1000).toISOString()}`,
    "", "## Zprava", "", text, ...(imagesMd ? ["", "## Obrazky", "", imagesMd] : []),
  ].join("\n");

  const issue = createIssue(title, description);
  if (issue) {
    console.log(`  -> ${issue.identifier}`);
    try { await slack.reactions.add({ channel: event.channel, name: "eyes", timestamp: event.ts }); } catch {}
    pendingCheckmarks.set(issue.id, { channel: event.channel, ts: event.ts, identifier: issue.identifier });
    threadToIssue.set(event.ts, issue.id);
  }
});

socket.on("connected", () => {
  console.log("Slack bridge connected. Threads enabled.");
  console.log(`Polling every ${POLL_INTERVAL_MS / 1000}s`);
});

socket.on("error", (err) => console.error("Socket error:", err.message));

await socket.start();

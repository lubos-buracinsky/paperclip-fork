<p align="center">
  <img src="doc/assets/header.png" alt="Paperclip — runs your business" width="720" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="https://paperclip.ing/docs"><strong>Docs</strong></a> &middot;
  <a href="https://github.com/paperclipai/paperclip"><strong>GitHub</strong></a> &middot;
  <a href="https://discord.gg/m4HZY7xNG3"><strong>Discord</strong></a>
</p>

<p align="center">
  <a href="https://github.com/paperclipai/paperclip/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/paperclipai/paperclip/stargazers"><img src="https://img.shields.io/github/stars/paperclipai/paperclip?style=flat" alt="Stars" /></a>
  <a href="https://discord.gg/m4HZY7xNG3"><img src="https://img.shields.io/discord/000000000?label=discord" alt="Discord" /></a>
</p>

<br/>

<div align="center">
  <video src="https://github.com/user-attachments/assets/773bdfb2-6d1e-4e30-8c5f-3487d5b70c8f" width="600" controls></video>
</div>

<br/>

---

## Komfi Fork

Toto je fork [paperclipai/paperclip](https://github.com/paperclipai/paperclip) s custom úpravami pro Komfi. Níže vše specifické pro tento fork; původní upstream dokumentace pokračuje v sekci **"What is Paperclip?"**.

### Custom komponenty

- **Token usage charts** — per-agent breakdown v dashboard UI
- **Fork version badge** — commit hash v sidebaru
- **Slack bridge** — daemon v `tools/slack-bridge/` pro Slack → Paperclip issue creation

### Slack bridge (`tools/slack-bridge/`)

Node.js daemon (Socket Mode) který sleduje Slack kanály a vytváří Paperclip issues ze zpráv.

**Setup na novém stroji:**
```bash
cd tools/slack-bridge
npm install
npx infisical init  # vybrat komfi-internal-apps
bash setup-autostart.sh  # nastaví macOS launchd autostart
```

**Prerekvizity:**
- Infisical CLI + přihlášení (`npx infisical login`)
- Secrets v Infisical (dev env): `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`
- Slack app "Poslíček" pozvaný do relevantních kanálů
- Infisical domain: `https://eu.infisical.com/api`

**Chování:**
- 👀 emoji na novou zprávu = issue vytvořen (přiřazeno CEO, projekt Geo Apps)
- ✅ emoji = issue dokončen (deploy proběhl)
- ⚠️ emoji + thread reply = issue blocked (s poslední zprávou agenta)
- Thread replies se přeposílají jako komentáře na issue
- Obrázky ze Slacku se přidávají do issue popisu
- Polling hotových/blocked issues každých 60s

**Autostart:** macOS launchd service `com.komfi.slack-bridge`, plist v `~/Library/LaunchAgents/`

### MCP servery pro agenty

Notion MCP server nakonfigurovaný v `~/.claude.json`:
```bash
claude mcp add -s user -e NOTION_TOKEN=<token> -- notion /opt/homebrew/bin/npx @notionhq/notion-mcp-server
```
Pozor: env var je `NOTION_TOKEN` (MCP server to vyžaduje literal). Hodnota je `PAPERCLIP_TOKEN_RW` z Infisical (Notion integration name nesmí obsahovat "notion", proto náš Infisical key je `PAPERCLIP_TOKEN_*`).

### GStack tým

Import: `npx companies.sh add paperclipai/companies/gstack --target existing -C <company-id>`

Pipeline: CEO → CTO (implementuje) → Staff Engineer (review) → Release Engineer (batch merge) → QA Engineer (Playwright)

**Heartbeat:** `on_assignment` pro všechny agenty — probudí se automaticky při přiřazení issue.

**Release Engineer:** batch mode — čeká na dokončení všech issues, pak mergne najednou.

**Agenti píšou česky** — instrukce v AGENTS.md.

**GStack skills:** `git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack`

### Secrets management

- **Infisical** (eu.infisical.com) — centrální secrets pro Komfi (projekt `komfi-internal-apps`, dev env)
  - `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN` — Slack bridge daemon
  - `PAPERCLIP_TOKEN_RW`, `PAPERCLIP_TOKEN_RO` — Notion integration tokeny (R/W pro CEO/CoS, R/O pro ostatní agenty). MCP server v `~/.claude.json` používá R/W literal. Pozor: Notion integration name nesmí obsahovat "notion", proto "paperclip-*".
  - Infisical Machine Identity credentials — přístup agentů k Airtable
- **Paperclip Secrets** (encrypted v DB) — per-agent secret_ref
  - `infisical-client-id`, `infisical-client-secret` — injektované do agent env vars

### Backup systém

| Co | Frekvence | Kam |
|----|-----------|-----|
| Struktura firem (agenti, skills, projekty, issues) | Denně 2:00 | Git repo `paperclip-company-backup` |
| Paperclip config + backup skript + launchd plist | Denně 2:00 | Stejný git repo (`config/remote-mac/`) |
| DB dump (konverzace, run historie, costs) | Denně (Paperclip interně) | Lokálně `~/.paperclip/.../backups/` |

Cron: `0 2 * * *` na remote Macu. Log: `~/paperclip-backup.log`.

### Automatický upstream sync

Cron: `0 3 * * 0` (neděle 3:00) — fetch upstream, rebase, build, push.

Pokud rebase selže → abortne, zapíše `syncStatus: rebase_conflict` do `update-status.json`.

Log: `~/paperclip-upstream-sync.log`. Skript: `~/bin/paperclip-upstream-sync.sh`.

### Rebase s upstreamem (manuální)

```bash
cd ~/paperclip
git fetch upstream
git rebase upstream/master
bash scripts/generate-fork-version.sh
pnpm install && pnpm build
git push origin master --force-with-lease
```

### Remote Mac setup

- Tailscale IP: `100.81.141.101`, user `_maxxy`
- SSH: `ssh -o IdentityFile=~/.ssh/id_ed25519 _maxxy@100.81.141.101`
- Paperclip UI: `http://100.81.141.101:3100` (authenticated mode)
- Playwright + Chromium nainstalované pro QA agenta

### Komfi Skills

Pro migraci secrets do Infisical, audit env proměnných nebo refactor GitHub Actions workflows použij skill **infisical** z repo `komfi-health/komfi-llm-set-up` (složka `claude/skills/infisical/`).

Skill se aktivuje příkazem: migruj na infisical, secrets audit, infisical setup.

---

## What is Paperclip?

# Open-source orchestration for zero-human companies

**If OpenClaw is an _employee_, Paperclip is the _company_**

Paperclip is a Node.js server and React UI that orchestrates a team of AI agents to run a business. Bring your own agents, assign goals, and track your agents' work and costs from one dashboard.

It looks like a task manager — but under the hood it has org charts, budgets, governance, goal alignment, and agent coordination.

**Manage business goals, not pull requests.**

|        | Step            | Example                                                            |
| ------ | --------------- | ------------------------------------------------------------------ |
| **01** | Define the goal | _"Build the #1 AI note-taking app to $1M MRR."_                    |
| **02** | Hire the team   | CEO, CTO, engineers, designers, marketers — any bot, any provider. |
| **03** | Approve and run | Review strategy. Set budgets. Hit go. Monitor from the dashboard.  |

<br/>

> **COMING SOON: Clipmart** — Download and run entire companies with one click. Browse pre-built company templates — full org structures, agent configs, and skills — and import them into your Paperclip instance in seconds.

<br/>

<div align="center">
<table>
  <tr>
    <td align="center"><strong>Works<br/>with</strong></td>
    <td align="center"><img src="doc/assets/logos/openclaw.svg" width="32" alt="OpenClaw" /><br/><sub>OpenClaw</sub></td>
    <td align="center"><img src="doc/assets/logos/claude.svg" width="32" alt="Claude" /><br/><sub>Claude Code</sub></td>
    <td align="center"><img src="doc/assets/logos/codex.svg" width="32" alt="Codex" /><br/><sub>Codex</sub></td>
    <td align="center"><img src="doc/assets/logos/cursor.svg" width="32" alt="Cursor" /><br/><sub>Cursor</sub></td>
    <td align="center"><img src="doc/assets/logos/bash.svg" width="32" alt="Bash" /><br/><sub>Bash</sub></td>
    <td align="center"><img src="doc/assets/logos/http.svg" width="32" alt="HTTP" /><br/><sub>HTTP</sub></td>
  </tr>
</table>

<em>If it can receive a heartbeat, it's hired.</em>

</div>

<br/>

## Paperclip is right for you if

- ✅ You want to build **autonomous AI companies**
- ✅ You **coordinate many different agents** (OpenClaw, Codex, Claude, Cursor) toward a common goal
- ✅ You have **20 simultaneous Claude Code terminals** open and lose track of what everyone is doing
- ✅ You want agents running **autonomously 24/7**, but still want to audit work and chime in when needed
- ✅ You want to **monitor costs** and enforce budgets
- ✅ You want a process for managing agents that **feels like using a task manager**
- ✅ You want to manage your autonomous businesses **from your phone**

<br/>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🔌 Bring Your Own Agent</h3>
Any agent, any runtime, one org chart. If it can receive a heartbeat, it's hired.
</td>
<td align="center" width="33%">
<h3>🎯 Goal Alignment</h3>
Every task traces back to the company mission. Agents know <em>what</em> to do and <em>why</em>.
</td>
<td align="center" width="33%">
<h3>💓 Heartbeats</h3>
Agents wake on a schedule, check work, and act. Delegation flows up and down the org chart.
</td>
</tr>
<tr>
<td align="center">
<h3>💰 Cost Control</h3>
Monthly budgets per agent. When they hit the limit, they stop. No runaway costs.
</td>
<td align="center">
<h3>🏢 Multi-Company</h3>
One deployment, many companies. Complete data isolation. One control plane for your portfolio.
</td>
<td align="center">
<h3>🎫 Ticket System</h3>
Every conversation traced. Every decision explained. Full tool-call tracing and immutable audit log.
</td>
</tr>
<tr>
<td align="center">
<h3>🛡️ Governance</h3>
You're the board. Approve hires, override strategy, pause or terminate any agent — at any time.
</td>
<td align="center">
<h3>📊 Org Chart</h3>
Hierarchies, roles, reporting lines. Your agents have a boss, a title, and a job description.
</td>
<td align="center">
<h3>📱 Mobile Ready</h3>
Monitor and manage your autonomous businesses from anywhere.
</td>
</tr>
</table>

<br/>

## Problems Paperclip solves

| Without Paperclip                                                                                                                     | With Paperclip                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ❌ You have 20 Claude Code tabs open and can't track which one does what. On reboot you lose everything.                              | ✅ Tasks are ticket-based, conversations are threaded, sessions persist across reboots.                                                |
| ❌ You manually gather context from several places to remind your bot what you're actually doing.                                     | ✅ Context flows from the task up through the project and company goals — your agent always knows what to do and why.                  |
| ❌ Folders of agent configs are disorganized and you're re-inventing task management, communication, and coordination between agents. | ✅ Paperclip gives you org charts, ticketing, delegation, and governance out of the box — so you run a company, not a pile of scripts. |
| ❌ Runaway loops waste hundreds of dollars of tokens and max your quota before you even know what happened.                           | ✅ Cost tracking surfaces token budgets and throttles agents when they're out. Management prioritizes with budgets.                    |
| ❌ You have recurring jobs (customer support, social, reports) and have to remember to manually kick them off.                        | ✅ Heartbeats handle regular work on a schedule. Management supervises.                                                                |
| ❌ You have an idea, you have to find your repo, fire up Claude Code, keep a tab open, and babysit it.                                | ✅ Add a task in Paperclip. Your coding agent works on it until it's done. Management reviews their work.                              |

<br/>

## Why Paperclip is special

Paperclip handles the hard orchestration details correctly.

|                                   |                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Atomic execution.**             | Task checkout and budget enforcement are atomic, so no double-work and no runaway spend.                      |
| **Persistent agent state.**       | Agents resume the same task context across heartbeats instead of restarting from scratch.                     |
| **Runtime skill injection.**      | Agents can learn Paperclip workflows and project context at runtime, without retraining.                      |
| **Governance with rollback.**     | Approval gates are enforced, config changes are revisioned, and bad changes can be rolled back safely.        |
| **Goal-aware execution.**         | Tasks carry full goal ancestry so agents consistently see the "why," not just a title.                        |
| **Portable company templates.**   | Export/import orgs, agents, and skills with secret scrubbing and collision handling.                          |
| **True multi-company isolation.** | Every entity is company-scoped, so one deployment can run many companies with separate data and audit trails. |

<br/>

## What Paperclip is not

|                              |                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Not a chatbot.**           | Agents have jobs, not chat windows.                                                                                  |
| **Not an agent framework.**  | We don't tell you how to build agents. We tell you how to run a company made of them.                                |
| **Not a workflow builder.**  | No drag-and-drop pipelines. Paperclip models companies — with org charts, goals, budgets, and governance.            |
| **Not a prompt manager.**    | Agents bring their own prompts, models, and runtimes. Paperclip manages the organization they work in.               |
| **Not a single-agent tool.** | This is for teams. If you have one agent, you probably don't need Paperclip. If you have twenty — you definitely do. |
| **Not a code review tool.**  | Paperclip orchestrates work, not pull requests. Bring your own review process.                                       |

<br/>

## Quickstart

Open source. Self-hosted. No Paperclip account required.

```bash
npx paperclipai onboard --yes
```

That quickstart path now defaults to trusted local loopback mode for the fastest first run. To start in authenticated/private mode instead, choose a bind preset explicitly:

```bash
npx paperclipai onboard --yes --bind lan
# or:
npx paperclipai onboard --yes --bind tailnet
```

If you already have Paperclip configured, rerunning `onboard` keeps the existing config in place. Use `paperclipai configure` to edit settings.

Or manually:

```bash
git clone https://github.com/paperclipai/paperclip.git
cd paperclip
pnpm install
pnpm dev
```

This starts the API server at `http://localhost:3100`. An embedded PostgreSQL database is created automatically — no setup required.

> **Requirements:** Node.js 20+, pnpm 9.15+

<br/>

## FAQ

**What does a typical setup look like?**
Locally, a single Node.js process manages an embedded Postgres and local file storage. For production, point it at your own Postgres and deploy however you like. Configure projects, agents, and goals — the agents take care of the rest.

If you're a solo-entreprenuer you can use Tailscale to access Paperclip on the go. Then later you can deploy to e.g. Vercel when you need it.

**Can I run multiple companies?**
Yes. A single deployment can run an unlimited number of companies with complete data isolation.

**How is Paperclip different from agents like OpenClaw or Claude Code?**
Paperclip _uses_ those agents. It orchestrates them into a company — with org charts, budgets, goals, governance, and accountability.

**Why should I use Paperclip instead of just pointing my OpenClaw to Asana or Trello?**
Agent orchestration has subtleties in how you coordinate who has work checked out, how to maintain sessions, monitoring costs, establishing governance - Paperclip does this for you.

(Bring-your-own-ticket-system is on the Roadmap)

**Do agents run continuously?**
By default, agents run on scheduled heartbeats and event-based triggers (task assignment, @-mentions). You can also hook in continuous agents like OpenClaw. You bring your agent and Paperclip coordinates.

<br/>

## Development

```bash
pnpm dev              # Full dev (API + UI, watch mode)
pnpm dev:once         # Full dev without file watching
pnpm dev:server       # Server only
pnpm build            # Build all
pnpm typecheck        # Type checking
pnpm test:run         # Run tests
pnpm db:generate      # Generate DB migration
pnpm db:migrate       # Apply migrations
```

See [doc/DEVELOPING.md](doc/DEVELOPING.md) for the full development guide.

<br/>

## Roadmap

- ✅ Plugin system (e.g. add a knowledge base, custom tracing, queues, etc)
- ✅ Get OpenClaw / claw-style agent employees
- ✅ companies.sh - import and export entire organizations
- ✅ Easy AGENTS.md configurations
- ✅ Skills Manager
- ✅ Scheduled Routines
- ✅ Better Budgeting
- ✅ Agent Reviews and Approvals
- ⚪ Multiple Human Users
- ⚪ Cloud / Sandbox agents (e.g. Cursor / e2b agents)
- ⚪ Artifacts & Work Products
- ⚪ Memory & Knowledge
- ⚪ Enforced Outcomes
- ⚪ MAXIMIZER MODE
- ⚪ Deep Planning
- ⚪ Work Queues
- ⚪ Self-Organization
- ⚪ Automatic Organizational Learning
- ⚪ CEO Chat
- ⚪ Cloud deployments
- ⚪ Desktop App

<br/>

## Community & Plugins

Find Plugins and more at [awesome-paperclip](https://github.com/gsxdsm/awesome-paperclip)

## Telemetry

Paperclip collects anonymous usage telemetry to help us understand how the product is used and improve it. No personal information, issue content, prompts, file paths, or secrets are ever collected. Private repository references are hashed with a per-install salt before being sent.

Telemetry is **enabled by default** and can be disabled with any of the following:

| Method               | How                                                     |
| -------------------- | ------------------------------------------------------- |
| Environment variable | `PAPERCLIP_TELEMETRY_DISABLED=1`                        |
| Standard convention  | `DO_NOT_TRACK=1`                                        |
| CI environments      | Automatically disabled when `CI=true`                   |
| Config file          | Set `telemetry.enabled: false` in your Paperclip config |

## Contributing

We welcome contributions. See the [contributing guide](CONTRIBUTING.md) for details.

<br/>

## Community

- [Discord](https://discord.gg/m4HZY7xNG3) — Join the community
- [GitHub Issues](https://github.com/paperclipai/paperclip/issues) — bugs and feature requests
- [GitHub Discussions](https://github.com/paperclipai/paperclip/discussions) — ideas and RFC

<br/>

## License

MIT &copy; 2026 Paperclip

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=paperclipai/paperclip&type=date&legend=top-left)](https://www.star-history.com/?repos=paperclipai%2Fpaperclip&type=date&legend=top-left)

<br/>

---

<p align="center">
  <img src="doc/assets/footer.jpg" alt="" width="720" />
</p>

<p align="center">
  <sub>Open source under MIT. Built for people who want to run companies, not babysit agents.</sub>
</p>

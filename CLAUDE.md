# paperclip

## Komfi fork

Toto je fork [paperclipai/paperclip](https://github.com/paperclipai/paperclip) s custom úpravami pro Komfi.

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
Pozor: env var je `NOTION_TOKEN` (ne `NOTION_API_TOKEN`). Token uložen v Infisical.

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
  - `NOTION_API_TOKEN` — Notion MCP server (v `~/.claude.json` jako `NOTION_TOKEN`)
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

## Komfi Skills

Pro migraci secrets do Infisical, audit env proměnných nebo refactor GitHub Actions workflows použij skill **infisical** z repo `komfi-health/komfi-llm-set-up` (složka `claude/skills/infisical/`).

Skill se aktivuje příkazem: migruj na infisical, secrets audit, infisical setup.

# paperclip

## Komfi fork

Toto je fork [paperclipai/paperclip](https://github.com/paperclipai/paperclip) s custom úpravami pro Komfi.

### Custom komponenty

- **Token usage charts** — per-agent breakdown v dashboard UI
- **Update banner** — detekce upstream + fork updatů
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

**Chování:**
- 👀 emoji na novou zprávu = issue vytvořen
- ✅ emoji = issue dokončen (deploy proběhl)
- Žádné thread reply

### MCP servery pro agenty

Notion MCP server je nakonfigurovaný v `~/.claude.json`:
```bash
claude mcp add -s user -e NOTION_API_TOKEN=<token> -- notion npx @notionhq/notion-mcp-server
```
Token uložen v Infisical (`NOTION_API_TOKEN`).

### GStack tým

Import: `npx companies.sh add paperclipai/companies/gstack --target existing -C <company-id>`

Pipeline: CEO → CTO → Staff Engineer (review) → Release Engineer (batch merge) → QA Engineer (Playwright)

### Rebase s upstreamem

```bash
git fetch paperclip
git rebase paperclip/master
bash scripts/generate-fork-version.sh
git push fork <branch>:master --force-with-lease
```

## Komfi Skills

Pro migraci secrets do Infisical, audit env proměnných nebo refactor GitHub Actions workflows použij skill **infisical** z repo `komfi-health/komfi-llm-set-up` (složka `claude/skills/infisical/`).

Skill se aktivuje příkazem: migruj na infisical, secrets audit, infisical setup.

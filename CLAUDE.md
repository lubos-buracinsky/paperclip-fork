# paperclip (Komfi fork)

Fork [paperclipai/paperclip](https://github.com/paperclipai/paperclip) s Komfi úpravami (Slack bridge daemon, token usage charts, fork version badge).

## Skills / routing

- **infisical** (z `komfi-health/komfi-llm-set-up`) — secrets migrace, audit env proměnných, refactor GitHub Actions. Trigger: "migruj na infisical", "secrets audit", "infisical setup".

## Kritické invariants

- **NOTION_TOKEN env var** v `~/.claude.json` MCP config musí být literal `NOTION_TOKEN` (ne `NOTION_API_TOKEN`). Hodnota je `PAPERCLIP_TOKEN_RW` z Infisical (Notion integration name nesmí obsahovat "notion", proto prefix `PAPERCLIP_TOKEN_*`).
- **Upstream rebase safety** — fork syncuje `paperclip/master` každou neděli 3:00 cronem. Jakékoli změny v upstream souborech (kód, `README.md`) musí jít do minimálně konfliktní sekce; vlastní Komfi obsah preferuj do vlastních složek (`tools/slack-bridge/`, `scripts/generate-fork-version.sh`) nebo top-of-file sekce.
- **Agenti píšou česky** — instrukce v `AGENTS.md`, neporušovat.
- **Infisical projekt** — `komfi-internal-apps`, env `dev`, domain `https://eu.infisical.com/api`. Secrets nikdy neprintovat do chatu ani do stdoutu CLI (viz user security rules).
- **Slack bridge autostart** — macOS launchd service `com.komfi.slack-bridge` (plist v `~/Library/LaunchAgents/`); neupravovat bez vědomí uživatele.

## Klíčové příkazy

- `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm test:run`
- `pnpm db:generate` / `pnpm db:migrate`
- Upstream sync (manuální): viz README.md "Rebase s upstreamem"

Architektura, Slack bridge setup, backup systém, MCP config, secrets management, remote Mac setup, deploy workflow — viz `README.md` sekce **"Komfi Fork"** (a pro upstream viz zbytek `README.md`).

# paperclip (Komfi fork)

Fork [paperclipai/paperclip](https://github.com/paperclipai/paperclip) s Komfi úpravami (Slack bridge daemon, token usage charts, fork version badge).

## Skills / routing

- **infisical** (z `komfi-health/komfi-llm-set-up`) — secrets migrace, audit env proměnných, refactor GitHub Actions. Trigger: "migruj na infisical", "secrets audit", "infisical setup".

## Kritické invariants

- **NOTION_TOKEN env var** v `~/.claude.json` MCP config musí být literal `NOTION_TOKEN` (ne `NOTION_API_TOKEN`). Hodnota je `PAPERCLIP_TOKEN_RW` z Infisical (Notion integration name nesmí obsahovat "notion", proto prefix `PAPERCLIP_TOKEN_*`).
- **Upstream rebase safety** — fork syncuje `paperclip/master` každou neděli 3:00 cronem. Jakékoli změny v upstream souborech (kód, `README.md`) musí jít do minimálně konfliktní sekce; vlastní Komfi obsah preferuj do vlastních složek (`tools/slack-bridge/`, `scripts/generate-fork-version.sh`) nebo top-of-file sekce.
- **Nikdy nepushovat do oficiálního paperclip remote** — veškeré změny, PR, branche, issues patří jen do `lubos-buracinsky/paperclip` (Komfi fork) nebo `komfi-health/*` orgu. Zákaz `git push` do `paperclipai/paperclip`, zákaz `gh pr create --repo paperclipai/paperclip`, zákaz issue/PR komentářů v `paperclipai/*`. Platí i když vidíš zajímavý upstream bug — ohlas ho lokálně, neřeš upstream. Jediná povolená interakce s upstream remotem je `git fetch` / `git rebase` v rámci plánovaného nedělního syncu.
- **Agenti píšou česky** — instrukce v `AGENTS.md`, neporušovat.
- **Infisical projekt** — `komfi-internal-apps`, env `dev`, domain `https://eu.infisical.com/api`. Secrets nikdy neprintovat do chatu ani do stdoutu CLI (viz user security rules).
- **Lokálně neběží nic z Paperclip infry** — žádný Paperclip server, slack-bridge daemon, launchd služby (`com.komfi.slack-bridge`), CLI `paperclipai`, `.paperclip/.env`. Všechno (API, UI, slack-bridge, backupy, upstream sync cron) běží na remote Macu `100.81.141.101` (SSH `_maxxy@`). Tento stroj je **pouze dev worktree** pro code změny a **správu remote přes SSH**. Kdyby se tu něco z toho objevilo (proces, plist, binary), je to omyl — smazat, nerozšiřovat.

## Klíčové příkazy

- `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm test:run`
- `pnpm db:generate` / `pnpm db:migrate`
- Upstream sync (manuální): viz README.md "Rebase s upstreamem"

Architektura, Slack bridge setup, backup systém, MCP config, secrets management, remote Mac setup, deploy workflow — viz `README.md` sekce **"Komfi Fork"** (a pro upstream viz zbytek `README.md`).

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

## Ship / deploy flow (override gstack)

gstack `/ship` ani `/land-and-deploy` **nespouštět klasicky** — fork nemá vlastní VERSION/CHANGELOG (upstream-maintained) ani malé feature branche. `pcl-2026-04` je long-lived dev branch, ne feature branch. Když uživatel řekne "ship", `/ship`, `/land-and-deploy`, "nasaď to":

1. **Ship** = `git push origin <branch>` (typicky `pcl-2026-04`). Bez VERSION bumpu, CHANGELOGu, squashe ani gstack review skillů.
2. **Deploy** = remote Mac si pullne: buď manuálně (`ssh _maxxy@100.81.141.101`, `cd ~/paperclip && git pull && pnpm install && pnpm build` + restart postižených služeb, např. `launchctl kickstart -k gui/$(id -u)/com.komfi.slack-bridge`), nebo auto přes nedělní upstream-sync cron.
3. **PR** jen když uživatel explicitně požádá. Potom **vždy** `gh pr create --repo lubos-buracinsky/paperclip-fork --base master --head <branch> ...` — explicit `--repo` je povinný, protože `gh` default target je chybně `paperclipai/paperclip` (upstream) a push tam je tvrdý zákaz.
4. **Review** (pokud uživatel chce) = navrhni `/review` nebo `/codex` samostatně, ne jako součást ship flow.

## Klíčové příkazy

- `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm test:run`
- `pnpm db:generate` / `pnpm db:migrate`
- Upstream sync (manuální): viz README.md "Rebase s upstreamem"

Architektura, Slack bridge setup, backup systém, MCP config, secrets management, remote Mac setup, deploy workflow — viz `README.md` sekce **"Komfi Fork"** (a pro upstream viz zbytek `README.md`).

# MCP Watchtower

> **Don't install a dead MCP server.**

Third-party audits found [roughly half of public MCP servers abandoned](https://rapidclaw.dev/blog/mcp-servers-dead-what-it-means-2026) — zero commits for months, broken installers, unreachable endpoints. Yet no registry shows you a pulse: dead servers sit next to live ones with equal weight.

Watchtower scans the MCP ecosystem continuously and gives every server a public health score: **ALIVE** / **FADING** / **DEAD**.

![status](https://img.shields.io/badge/servers_tracked-2%2C636-3df5a8) ![scan](https://img.shields.io/badge/scan-rolling_hourly-3df5a8)

## What you get

- **Leaderboard** — the healthiest servers, ranked ([live site](site/index.html))
- **Graveyard** — dead and deleted servers you should not depend on
- **Health badges** — embed a live `MCP health: 92 · alive` badge in your README
- **Raw data** — `data/servers.json`, regenerated on every scan, free to build on

## Run it yourself

```bash
# zero dependencies, Node 18+
node scanner.mjs --limit 55          # unauthenticated: 60 req/h GitHub cap
GITHUB_TOKEN=ghp_xxx node scanner.mjs --limit 2000   # 5000 req/h
```

Results merge into `data/servers.json` across runs, so coverage grows every run. The scanner also re-renders `site/index.html` (single file, no build step) and one SVG badge per repo in `data/badges/`.

## Scoring (public & debatable — open an issue)

| Signal | Weight | Why |
|---|---|---|
| Push recency | up to 70 | The dominant death signal: dead-server audit medians show ~142 days since last commit |
| Community confidence | up to 15 | Log-scaled stars. Popularity ≠ health — it can never rescue a stale repo |
| Maintenance hygiene | up to 15 | License, issues enabled, description, not a fork, controlled issue backlog |

Verdicts: **ALIVE ≥ 70** · **FADING 40–69** · **DEAD < 40** · archived → 3 · repo deleted → **GONE**.

Honesty note: scores measure *maintenance signals*, not code quality. Read the code before production use.

## Why this exists

The MCP ecosystem fragmented across three registries (15,930+ / ~7,300 / ~2,000 listings) and none of them surface last-commit dates or endpoint uptime. After the April 2026 SDK vulnerability wave, "is this dependency alive?" became a supply-chain question. Watchtower is the missing trust layer.

## Roadmap

- [ ] Endpoint liveness probes (does the server actually start?)
- [ ] Spec-version compatibility detection
- [ ] Watch lists + alerts when a dependency starts fading (team tier)
- [ ] Registry partnerships — health signals where developers already search

## License

MIT

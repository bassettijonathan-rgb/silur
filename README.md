# Silur

A browser-based "deep-time detective" game: a hidden, physically modelled planetary history is generated, then you
reconstruct it from noisy, biased evidence (strata, fossils, geochemical proxies) on a field-season budget. Some
worlds hosted a long-extinct industrial civilization (after Schmidt & Frank 2018's *Silurian hypothesis*); natural
processes can mimic its signatures, and you are never told which kind of world you are in.

See **[DESIGN.md](DESIGN.md)** for the model, architecture and milestone plan.

## Status

| milestone | state |
|---|---|
| M1 Earth-system box models (carbon cycle, climate, ice, sea level, O₂/P) | done |
| M2 Sedimentation / erosion / bioturbation on the grid | done |
| M3 Biosphere: clades, extinction selectivity, taphonomy | done |
| M4 Natural catastrophes + playable vertical slice | next |
| M5–M8 | planned (see DESIGN.md §11) |

## Commands

```
npm install
npm test                       # vitest: science validation + architecture tests
npm run typecheck && npm run lint
npx tsx tools/run-earth.ts alpha 250 100   # print an Earth-system run (seed, Myr, step kyr)
npx tsx tools/run-strat.ts alpha standard foreland   # Earth + strata profile (seed, preset, template)
npx tsx tools/run-bio.ts alpha standard             # diversity curve + extinction selectivity
npx tsx tools/depcheck.ts      # check the layer boundaries
npm run dev                    # game shell;  /dev/earth.html and /dev/strat.html = debug plots / map+column viewer (developer only)
```

## Layout

```
src/shared       pure types, RNG, TimePlan, Forcing channels, config
src/truth        Layer 1 — hidden history generator (worker only)
src/observation  Layer 2 — the only door to the truth (worker only)
src/client       main-thread proxy to the worker
src/game, ui     Layer 3 — never imports truth/observation (enforced by tests/architecture)
tools, dev       CLI helpers and developer-only debug pages
```

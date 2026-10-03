# Silur

A browser-based "deep-time detective" game: a hidden, physically modelled planetary history is generated, then you
reconstruct it from noisy, biased evidence (strata, fossils, geochemical proxies) on a field-season budget. Some
worlds hosted a long-extinct industrial civilization (after Schmidt & Frank 2018's *Silurian hypothesis*); natural
processes can mimic its signatures, and you are never told which kind of world you are in.

See **[DESIGN.md](DESIGN.md)** for the model, architecture and milestone plan, and the "as built" notes (§13) for what each milestone actually measured.

**Playing:** `npm run dev`, pick a difficulty, generate a world (the dev preset takes ≈ 3 s, the standard 64×64 / 250 Myr world ≈ 35–45 s), then drill, survey, assay, date, correlate and finally submit. The hidden history exists only inside a Web Worker; the page never imports it (three independent tests enforce that).

## Status

| milestone | state |
|---|---|
| M1 Earth-system box models (carbon cycle, climate, ice, sea level, O₂/P) | done |
| M2 Sedimentation / erosion / bioturbation on the grid | done |
| M3 Biosphere: clades, extinction selectivity, taphonomy | done |
| M4 Natural catastrophes + playable vertical slice (map → drill → core → assays) | done |
| M5 Hidden civilization, mimicry, ideal-observer solvability gate | done |
| M6 Full investigation UI: outcrops, dating, fossils, correlation, age models, notebook, save/load | done |
| M7 Submission, proper scoring, preservation audit, reveal, calibration history | done |
| M8 Bot-player balancing and score ladder, difficulty presets, polish | done |

## Commands

```
npm install
npm test                       # vitest: science validation + architecture tests
npm run typecheck && npm run lint
npx tsx tools/run-earth.ts alpha 250 100   # print an Earth-system run (seed, Myr, step kyr)
npx tsx tools/run-strat.ts alpha standard foreland   # Earth + strata profile (seed, preset, template)
npx tsx tools/run-world.ts alpha standard             # whole world: truth catalog + timings
npx tsx tools/run-bio.ts alpha standard             # diversity curve + extinction selectivity
npx tsx tools/build-signatures.ts 200               # rebuild the ideal observer's signature library (needed after physics changes)
npx tsx tools/probe-gate.ts 20 dev                  # how often the solvability gate passes and how the ideal observer does
npx tsx tools/run-bots.ts 40 dev normal         # balancing: play bot players over 40 worlds, print the score ladder (n, preset, easy|normal|hard, first seed, budget)
npx tsx tools/depcheck.ts      # check the layer boundaries
npm run dev                    # the game (worker generates a world in ~20 s);  /dev/earth.html and /dev/strat.html = debug plots / map+column viewer (developer only)
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

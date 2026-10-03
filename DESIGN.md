# Silur — Design

A browser-based "deep-time detective" game. A hidden, physically modelled planetary history is generated, then
the player reconstructs it from noisy, biased evidence (strata, fossils, geochemical proxies) on a budget.
Some worlds hosted a long-extinct industrial civilization (after Schmidt & Frank 2018); natural processes can
mimic its signatures, and the player is never told which kind of world they are in.

**Sections:** 0 summary · 1 flagged decisions · 2 principles · 3 architecture · 4 truth layer · 5 mimicry &
solvability · 6 observation layer · 7 game/UI · 8 key types · 9 tooling · 10 science validation matrix ·
11 milestones · 12 risks · 13 status.

---

## 0. One-paragraph summary

Silur generates, inside a Web Worker, a full hidden history of an Earth-like planet region (~250 Myr, 64×64 cells):
a coupled carbon / climate / ocean-O₂ / sea-level box model drives sedimentation, erosion and bioturbation on a
grid, while a birth–death biosphere with trait-dependent extinction is filtered through taphonomy. Natural
catastrophes (LIP, impact, clathrate, supernova, glaciation, OAE) and — in some worlds — a short-lived industrial
civilization all act **only through the same physical forcing channels**. The player (main thread) holds *no*
truth: they spend a budget on actions sent to an **observation service** in the worker, which returns noisy,
biased measurements. At the end they submit a timeline and calibrated cause probabilities, scored with proper
scoring rules and compared against an **ideal-observer** baseline.

---

## 1. Decisions to flag (deviations / choices — approve or overrule)

| # | Topic | My recommendation | Alternative / why I deviate |
|---|---|---|---|
| D1 | **Truth isolation** | Truth *lives only in the worker*; main thread gets only measurement messages. Import-graph test **plus** a bundle-graph test (build the main bundle, assert no truth module ids). | Your brief asks only for module boundaries + an import test. Runtime isolation is stronger and nearly free given the worker requirement. Reveal/score is the one gated export. |
| D2 | **What a layer stores** | Extensive *tracer masses/moments* (kg m⁻²: clastic, CaCO₃, organic C, Ir, Hg, charcoal, δ13C·m_C, …), not finished proxy values. Proxies = ratios computed at observation time. | Storing δ13C directly makes mixing, dilution and condensation wrong. Mass-based storage gives bioturbation, sedimentation-rate dilution of Ir/Hg, and condensed sections *for free* and consistently. |
| D3 | **Time axis** | Pre-computed non-uniform `TimePlan`: base dt 100 kyr (configurable), refined to 100 yr–10 kyr inside scheduled event windows. Earth-system ODEs use adaptive RK45 *inside* each step. | You said "sub-stepping for short events"; a pre-planned grid is the same idea but makes layer ages exact (layers store step indices, not floats) and bounds memory. |
| D4 | **Event taxonomy** | *Forced* events (scheduled at world gen: LIP, impact, clathrate, supernova, civilization, ash eruptions) vs *emergent* episodes (OAE, glaciation, hyperthermals) **detected post-hoc from state** by a segmenter into a truth catalog with causal links. | OAEs and glaciations should be *outcomes* of the box model, not scripted. A scripted OAE could not respond to its causes (warming, P recycling). |
| D5 | **Ideal observer** | Simulation-based Bayesian comparison on summary statistics (KDE/naive-Bayes over a pre-built *signature library*), cross-checked by a regularized logistic classifier. Documented honestly as "approximately ideal" — its quality is bounded by its summary stats. | A truly ideal observer is intractable; this is the standard ABC-style compromise, and every added statistic can only tighten it. |
| D6 | **Scoring** | Cause: **floored log score** (p ≥ 0.01) reported in bits vs. uniform baseline *and vs. the ideal observer's own score* on that world. Ages: **interval score** on 80 % intervals (proper). Missed-event penalty weighted by detectability-in-principle. Brier shown as secondary. | Log score is unbounded; the floor bounds it. "Ideal observer would have scored X bits" turns unsolvable-ish worlds into fair ones. |
| D7 | **Milankovitch cycles** | **Deferred past M8.** | At ≥50 kyr steps 20/40/100-kyr cycles alias. They'd make a great cyclostratigraphy mechanic (count cycles = time), but need a 5 kyr grid → ~20× cost. Post-M8 stretch via a "cyclicity" layer attribute. |
| D8 | **UI tech** | Canvas2D for map / columns / correlation / plots; **plain DOM** for notebook, forms, submission. No UI framework. | Text entry, tables, sliders in Canvas is pain with no benefit. Still TS + Vite, no React. |
| D9 | **Determinism** | Guarantee = same seed + same `modelVersion` + same JS engine. Per-subsystem forked RNG streams; stateless counter-based hashing for all observation noise. Golden-hash test in CI. | JS `Math.exp/log/pow/sin` are not bit-identical across engines. Optional `det.ts` shim (pure +−×÷√) is available later if cross-browser identity matters. |
| D10 | **Locality of N / nutrient proxies** | δ15N from fertilizer is a *local* signal near river mouths (coastal, deltaic, shelf cells); OAE denitrification / N₂-fixation shifts are *global* and can go either sign. | Realistic and creates the mimic: δ15N alone cannot say "civilization". |
| D11 | **Unsolvable worlds** | Default: generator rejects/regenerates worlds failing the solvability gate. Difficulty can allow a fraction of "murky" worlds; reveal shows ideal-observer posterior so a 50/50 answer there is correct play. | Rejecting all of them removes a lesson (sometimes the right answer is "I can't tell"). |
| D12 | **Field-area realism** | Each world picks a *tectonic template* (passive margin → inversion, foreland basin, intracratonic dome) ending with an exhumation phase, plus a paleolatitude track. | Without uplift/exhumation there is no outcrop. Paleolatitude gives carbonate/evaporite/coal/glacial belts and diversity gradients cheaply. |
| D13 | **"Synthetic compounds"** | A noisy *persistent-organics index* channel with a natural false-positive rate (wildfire PAHs, diagenesis, lab contamination). Detection is evidence, never proof. | Your "no unique alien marker" rule: a perfectly specific marker would trivialise the game. |
| D14 | **Memory / speed** | Budget: Standard preset ≤ ~250 MB typed arrays, ≤ ~45 s generation (worker). Small preset (32×32, 150 Myr) for dev/tests. Layer-merge compaction held in reserve if profiling demands it. | Naive per-step layering at 64×64 × 2500+ steps is the biggest technical risk (see §12). |
| D15 | **Alien-ness** | Sample planet traits (stellar brightening rate, ECS, pCO₂ baseline, ocean fraction, ecological body plans). Biota are generic trait bundles with generated morphotype names — **no Earth taxonomy**. | Prevents the player pattern-matching to Earth's real record. |
| D16 | **Signature library** | Built offline by a script (`tools/build-signatures`), versioned by hash of model code; shipped as JSON. Used by solvability gate. | Running thousands of box-model draws at generation time would be too slow. |

---

## 2. Principles

1. **Truth is a forward simulation, never a lookup table.** Every anomaly the player can see must trace to a physical channel.
2. **Mass balance everywhere** (carbon, isotopes, sediment, tracers) with tests that check conservation.
3. **Tweakable by you.** Parameters live in typed `*.params.ts` files with units, ranges and citations in comments. Registries (tracers, facies, event types, stressors) are single arrays — adding one is a one-file change. Each module has a README paragraph on top.
4. **Seeded and forkable.** `rng.fork("biosphere")` ⇒ changing one subsystem doesn't reshuffle the others.
5. **Observation is the only door** — and it charges for each step through it.

---

## 3. Architecture

### 3.1 Module map

```
src/
  shared/        pure types, units, config, RNG + hashing, protocol messages, Reveal types
  truth/         LAYER 1 (worker only)
    earth/       carbonate chemistry, carbon cycle, climate, ocean O2/P, ice & sea level
    geo/         paleogeography (latitude), tectonic templates, landscape (flow routing, erosion)
    strat/       facies, sedimentation, carbonate factory, compaction, bioturbation, ColumnStore
    bio/         species, clades, speciation/extinction, stressors, community, taphonomy
    events/      lip, impact, clathrate, supernova, ash eruptions, segmenter (OAE, glaciation…)
    agents/      civilization (+ later: terraforming, probe) behind an Agent interface
    world.ts     generate(config, onProgress) → World
  observation/   LAYER 2 (worker only; the only importer of truth besides worker/)
    service.ts   execute(Action) → Measurement   (budget, caching, determinism)
    instruments/ noise models: isotopes, trace elements, radiometric, fossils, lithology
    solvability/ signature library, summary stats, ideal observer
    reveal.ts    sealed until submission; scoring + RevealPayload
  worker/        worker entry; owns World + service; speaks protocol
  client/        main-thread ObservationClient (promise API over postMessage); imports shared/ only
  game/          LAYER 3 state: player data store, age model, notebook, submission builder
  ui/            Canvas2D views + DOM panels
tools/           build-signatures, depcheck
tests/           unit, science, architecture, golden
```

### 3.2 Dependency rules (enforced)

| importer ↓ / imports → | shared | truth | observation | worker | client | game | ui |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| truth | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| observation | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| worker | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| client | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| game / ui | ✓ | **✗** | **✗** | ✗ | ✓ | ✓ | ✓ |

Enforcement, three independent guards:
1. **`tests/architecture/imports.test.ts`** — parses every file with the TypeScript compiler API, collects static `import`, `export … from`, dynamic `import()` and `require`, resolves them (incl. path aliases), fails on any forbidden edge. Also fails on `import type` from truth in game/ui (types must come from `shared/`).
2. **`tests/architecture/bundle.test.ts`** — runs a Vite production build of the main-thread entry programmatically and asserts the module list contains nothing under `src/truth` or `src/observation`.
3. ESLint `no-restricted-imports` per directory for editor-time feedback.

### 3.3 Worker protocol (in `shared/protocol.ts`)

```
→ worker   { kind:'generate', config }                 ← { kind:'progress', stage, frac } … { kind:'ready', worldId, publicInfo }
→ worker   { kind:'act', action: Action }              ← { kind:'result', measurement | error:'insufficient_budget' }
→ worker   { kind:'submit', submission: Submission }   ← { kind:'revealed', score, reveal: RevealPayload }
```
`publicInfo` = grid size, cell size, present-day topography, start budget, instrument list. Nothing else. `reveal` is refused unless a submission was accepted (flag in the service; tested).

---

## 4. Layer 1 — Truth

### 4.1 Time

`TimePlan { n; ageTopMa: Float64Array; ageBaseMa: Float64Array; dtYr: Float64Array; tag: Uint8Array }`, oldest→present.
Built after the event schedule is drawn (events know their own refinement needs):

| window | dt |
|---|---|
| background | 100 kyr (cfg 50–500) |
| LIP emplacement / ocean-recovery tails | 10 kyr |
| clathrate onset → peak → recovery | 0.5 kyr → 2 kyr → 5 kyr |
| bolide / supernova (instant) | boundary step + 1 kyr post-event step (ODE sub-steps internally) |
| civilization | 100–200 yr over its duration + 1 kyr tail |

Guard: `maxSteps` (default 6000); the planner coarsens low-priority windows if exceeded.
"Now" = final step; ages are reported as Ma before present.

### 4.2 Earth system (M1)

One global model, integrated by adaptive Dormand–Prince RK45 between plan steps. All inputs from events/agents arrive through **`Forcing` channels** (§4.8) — the model never learns *who* is forcing it.

**State vector (≈14):** atmospheric C; surface-ocean DIC, ALK; deep-ocean DIC, ALK; ocean PO₄; deep-ocean O₂ (can go negative = "sulfidic debt"); atmospheric O₂; crustal organic C and carbonate C reservoirs (slow); δ13C of atm/surface/deep carbon (as isotope moments); two-layer temperature (surface, deep); ice volume.

| Process | Formulation | Source / note |
|---|---|---|
| Carbonate chemistry | Newton solve for [H⁺] from DIC, ALK, T, S with T-dependent K₀, K₁, K₂, K_sp (calcite, aragonite) → pCO₂, pH, Ω | Lueker/Millero-style fits; test vs modern surface ocean |
| Degassing | `F_volc(t)` slow random walk + LIP forcing | |
| Silicate weathering | `k·U·exp((T−T₀)/τ_T)·(pCO₂/pCO₂₀)^β·f_runoff`, β≈0.3–0.5 (Walker–Hays–Kasting) | the stabilising feedback |
| Carbonate / organic-C weathering | ∝ reservoir × T/runoff factors; organic weathering consumes O₂ | COPSE-style |
| Carbonate burial | shelf (∝ flooded shelf area(sea level) × Ω-dependent production) + pelagic (fraction preserved set by deep-Ω / CCD) | links sea level ↔ carbon ↔ CCD |
| Organic burial | export production (∝ PO₄) × burial efficiency (≈0.5 % oxic → ≈3–5 % anoxic) | |
| P cycle | riverine input ∝ weathering; recycling efficiency rises under anoxia (C:P 106 → 250+) | Van Cappellen & Ingall positive feedback ⇒ OAEs can self-sustain |
| Deep-ocean O₂ | ventilation × (O₂sat(T) − O₂) − respiration of exported organics; overturn weakens with warmth | gives anoxia thresholds |
| Atmospheric O₂ | burial(org) − weathering(org) − pyrite; very slow; sets **fire probability** (Belcher–McElwain window) | drives charcoal |
| Carbon isotopes | mass balance with ε_p ≈ 25 ‰ (mildly pCO₂-dependent), carbonate offset ≈ +1 ‰, input δ ≈ −5 ‰ | steady-state analytic check |
| Temperature | `F = 5.35 ln(C/C₀) + F_solar(t) + F_aerosol + F_other`, ECS ≈ 2–4.5 K/2×CO₂ (sampled), two-layer energy balance (τ_surf≈10 yr, τ_deep≈1–3 kyr), ice-albedo feedback | |
| δ18O | `δ18O_c = δ18O_sw + g(T)` (Craig/Epstein quadratic, ≈ −0.23 ‰ K⁻¹), `δ18O_sw` rises ≈ 0.011 ‰ per m of ice-equivalent sea level | **T and ice volume are deliberately confounded** |
| Ice volume | relaxation to `V_eq(T, polarLand(t))` with hysteresis, τ ≈ 10–30 kyr | |
| Sea level (eustatic) | tectonic eustasy (OU process, ±100 m, Myr scale) + ice (≤ ~120 m) + steric (≈0.4 m K⁻¹) | |
| Nitrogen (diagnostic only) | δ15N shift from denitrification fraction (+) and N₂-fixation (−) | no full N reservoir |
| Sulfur (diagnostic) | pyrite-S ∝ organic flux × euxinic fraction; SO₂ spikes from forcing | δ34S stretch goal |

Planet sampling (D15): stellar brightening 0–1 %/100 Myr, ECS, baseline pCO₂ (lognormal 400–3000 ppm), ocean fraction, polarLand random walk.

### 4.3 Paleogeography & tectonics

- Region paleolatitude track `φ(t)` (random walk, ≈ 0.1–0.5 °/Myr) → local temperature offset, humidity band, carbonate-belt and evaporite-belt factors, glacial potential.
- Tectonic template per world (D12): `passive-margin→inversion`, `foreland`, `intracratonic-dome`. Produces a basement elevation field `h_b(x,y,t)`:
  thermal subsidence (McKenzie-style `1−exp(−t/τ)`, τ≈60 Myr), flexural-style foreland subsidence moving with a thrust front, orogenic uplift episodes (sediment sources), regional tilt, final exhumation (last 10–30 Myr).
- **Local Airy isostasy:** sediment load subsidence ≈ 0.4–0.5 × thickness (so basins stay filled), erosion unloading rebounds likewise.

### 4.4 Surface processes & sedimentation (M2)

Per cell, per step:

1. Update basement elevation (tectonics + isostasy); surface = basement + compacted column thickness.
2. **Relative sea level & water depth** `d = SL − z_surf`.
3. **Landscape (subaerial):** priority-flood pit filling → D8 routing → drainage area `A`; detachment-limited stream power `E = K·A^m·S^n·f_climate·f_cover` + hillslope diffusion; `f_cover` (vegetation) is an input channel (the civ can lower it). Eroded mass is routed downstream; capacity-limited floodplain deposition; remainder reaches the coast.
4. **Marine redistribution:** coarse fraction deposits near mouth (delta/shoreface); fines carried seaward with exponential decay; shoreface/storm-wave-base erosion (ravinement) when transgressing.
5. **Carbonate factory:** production `G(z) = G_max·tanh(I₀e^{−kz}/I_k)` (Bosscher & Schlager) × T-factor × Ω-factor × (1 − terrigenous inhibition); pelagic carbonate rain above the CCD (CCD from deep-ocean Ω), clay below.
6. **Evaporites:** arid latitude band + restricted basin (barrier fraction) + low terrigenous flux.
7. **Facies assignment** from `(d, supply, carbonate production, aridity, restriction, paleolat, slope)`:

| facies (registry) | typical conditions |
|---|---|
| alluvial/fluvial | z > SL, steep/active channel |
| terrestrial (paleosol, aeolian, coal swamp) | z > SL, low slope, humid→coal, arid→aeolian |
| glacial diamict | high paleolat/relief + glaciation |
| evaporite | arid, restricted, shallow |
| deltaic | coastal, high terrigenous flux |
| shelf siliciclastic | 0–200 m, terrigenous |
| shelf carbonate | 0–100 m, clear water, warm, Ω high |
| deep marine (pelagic/hemipelagic/turbidite) | > 200 m; turbidites from slope instability on high-flux margins |

   **Walther's law is emergent**: shoreline migrates laterally with sea level/tectonics and environment is assigned from local water depth, so vertical successions mirror lateral belts. Test enforces an allowed-transition matrix (§10).
8. **Bioturbation (Berger–Heath well-mixed layer).** Each column keeps a mixed layer of thickness `L` (cm–dm; depends on facies, O₂ at the seafloor, and the biosphere's burrowing traits). New sediment mixes in; material below `L` is expelled into the permanent stack with the mixed composition. Anoxic/terrestrial: `L≈0` (laminites preserved). Layers record `ageMean` and `ageSigma` (mass-weighted), so a smeared bed knows it is smeared.
9. **Compaction:** stored thickness is *decompacted solid thickness*; compacted thickness via Sclater–Christie porosity–depth (`φ=φ₀e^{−z/λ}` per lithology) computed layer-wise by observation; dynamics use an O(1) column-averaged approximation (Newton on `S = H − φ₀λ(1−e^{−H/λ})`).
10. **Erosion pops the stack** (partial layers scale all extensive fields) and logs an `ErasedInterval {cell, tErode, ageFrom, ageTo, thickness}` — this is what makes **unconformities** and the reveal's "destroyed evidence" list.

### 4.5 Column & layer data model

```ts
// Registries — add an entry to extend the model
const TRACERS = ['clastic','caco3','orgC','evap','Ir','Hg','S_pyrite','charcoal',
  'shockedQz','spherules','Fe60','persistOrg','ash','ashAgeMoment',
  'd13C_carb_m','d13C_org_m','d18O_carb_m','N','d15N_m'] as const;

class ColumnStore {            // one per cell, struct-of-arrays, capacity-doubling typed arrays
  n: number;                   // number of layers, bottom = 0
  stepTop: Uint32Array;        // TimePlan indices of first/last contributing step
  stepBase: Uint32Array;
  ageMean: Float32Array; ageSigma: Float32Array;   // Ma, after mixing
  facies: Uint8Array;  flags: Uint16Array;         // event / Lagerstätte / anoxic / ash…
  solidM: Float32Array;        // decompacted solid thickness
  tracers: Float32Array;       // n × NT, kg m⁻² (extensive ⇒ mixing is linear)
  env: Uint8Array;             // n × k quantised: water depth bin, bottom O2, sed rate bin, paleolat band
  mixed: MixedLayer;           // current well-mixed layer (not yet in the stack)
}
```
Memory budget: ≈ 75 B/layer; Standard ≈ 3–4 M layers → ~250 MB.

### 4.6 Biosphere (M3)

- **Species** (typed-array table): `clade, parent, tBirth, tDeath, traits` — traits: realm (marine/terrestrial/freshwater), calcifying (and mineralogy: aragonite / HMC / LMC / none), hard-part type (none / chitinous / carbonate / phosphatic / silica), body size (log), habitat breadth, thermal optimum + tolerance, depth preference, trophic level, metabolic rate (ecto/endo), burrower, insularity, range size, generation time.
- **Diversification:** per-step speciation `λ = λ₀·(1 − N_guild/K_guild)·f(env)` (diversity-dependent ⇒ recovery lags and overshoots after extinctions) and extinction hazard
  `h = h₀·exp(Σ_s β_s·v_s(traits)·I_s(t))` where `I_s(t)` are **stressor time series** produced from forcing channels + earth state:

| stressor | vulnerability `v_s` (who dies) |
|---|---|
| ocean acidification / low Ω | calcifiers (aragonite > HMC > LMC), planktonic larvae |
| warming | narrow thermal tolerance, low-latitude stenotherms, large body |
| cooling / glaciation | warm-adapted, shallow-shelf habitat loss (area ∝ shelf flooding; species–area z≈0.25) |
| anoxia / euxinia | benthic, deep-shelf, high-metabolism |
| light loss (impact winter, volcanic winter) | photoautotrophs, large endotherms, narrow ranges; survivors: burrowers, small, detritivores |
| UV (ozone loss; supernova) | shallow-water & exposed terrestrial, unprotected phytoplankton |
| fire | forest/terrestrial, low mobility |
| habitat conversion / hunting (civilization) | **large terrestrial animals, narrow range, insular** |

  Same machinery serves natural and agent causes ⇒ selectivity patterns genuinely overlap (impact winter ↔ hunting: both kill large terrestrials).
- **Phylogeny kept** (parent pointers) so "lineages with no clear ancestors" (terraforming) is a later, detectable oddity.
- **Community at (cell, time window):** species alive in the window, compatible with local environment (depth, substrate, paleolatitude, O₂), abundances from a seeded lognormal rank-abundance.
- **Taphonomy** (computed lazily at observation time, seeded by `hash(seed, cell, layer, sampleIdx)`):
  `P(found) = 1 − exp(−V · abundance · p_hard · f_env · f_burial · f_diagenesis · f_exceptional)`
  - `p_hard`: mineralised carbonate ≫ phosphatic ≫ chitinous ≫ soft (≈0 except Lagerstätten).
  - `f_env`: marine shelf high; terrestrial/fluvial low; deep marine low-and-pelagic-only; acidic/aragonite dissolution reduces aragonitic hard parts (diagenetic loss, grows with burial depth).
  - `f_burial`: rapid burial boosts, slow exposure on sediment surface destroys.
  - `f_exceptional`: rare (cell, window) combos with anoxic bottom water + rapid burial are flagged Lagerstätten (soft-bodied fraction becomes preservable).
  - **Emergent biases to test:** Signor–Lipps smearing of last occurrences, apparent Lazarus taxa, facies-controlled apparent turnover, hiatus-produced fake "extinction" steps.

### 4.7 Event catalog & signatures

All **forced** events are drawn at world creation from Poisson processes (rates set by difficulty); each declares: time, duration, a `Forcing` time function, and a *preservation footprint* (what deposits where).

| event | forcing channels | primary signatures (sign/magnitude) | confusable with |
|---|---|---|---|
| **LIP** | CO₂ (10³–10⁴ Pg C over 0.5–2 Myr, δ ≈ −5 to −30 ‰ if thermogenic), SO₂ (early cooling), Hg flux ×3–50, ash | Hg/TOC ↑, δ13C −2…−5 ‰, warming then cooling, OAE follows, selective extinction (calcifiers, warm stenotherms) | clathrate; civilization (Hg from coal) |
| **Bolide** (D by power law; global only if ≳ 8–10 km) | dust/soot (light↓ for months–years), SO₄ aerosol, acid rain pulse, fire | **thin global layer**: Ir 1–50 ppb (concentration ∝ 1/sed. rate), spherules, shocked quartz, charcoal; tsunami deposits in nearby shelf cells; ejecta ∝ r⁻³ | LIP (Hg) – distinguished by Ir/shocked quartz |
| **Clathrate release** | CO₂ 2–5 × 10³ Pg C at δ ≈ −60 ‰ over 1–20 kyr | **PETM-like**: CIE −2…−6 ‰ in ≲20 kyr, +4–7 K, CCD shoals (dissolution clay), recovery e-fold ≈ 50–120 kyr | **civilization** (same CIE, different carbon mass/source δ) |
| **Nearby supernova** | ⁶⁰Fe (t½ 2.6 Myr ⇒ detectable only for young events), UV/ozone loss | Fe60 pulse (if recent), UV-selective extinction | impact (selective extinction) |
| **Glaciation** (emergent) | — | δ18O ↑ (ice + cooling, confounded), sea level −50…−120 m ⇒ shelf unconformities, diamicts at high paleolat | tectonic sea-level fall |
| **OAE** (emergent) | — | black shale, TOC ↑, S ↑ (euxinia), δ13C positive excursion (org burial), δ15N shift (either sign), benthic extinction | local restriction/basin stagnation |
| **Ash eruptions** (background) | — | volcanic ash beds, zircon U–Pb ages | — |

Segmenter (D4) scans earth + stress series each run and writes the catalog `TruthEvent {id, type, class:'forced'|'emergent', ageMa[min,max], magnitude, cause, parents[]}`.

### 4.8 Forcing channels (the "same physical channels" rule)

`Forcing(t)` is a record of rates only — no event identity:

```ts
interface Forcing {
  carbonEmission: number;   d13CofEmission: number;   // Pg C yr⁻¹, ‰
  sulfurEmission: number;   mercuryEmission: number;
  aerosolOpticalDepth: number;  lightReduction: number;  // winter / dust
  fireIgnition: number;     soot: number;
  acidPulse: number;
  ozoneLoss: number;        fe60Flux: number;
  landCoverLoss: number;    sedimentFluxMultiplier: number;    // land-use ⇄ natural uplift/aridification
  nutrientRunoff: number;   nutrientRunoffD15N: number;        // local near river mouths
  persistentOrgFlux: number;                                   // wildfire PAH, combustion, polymers…
  harvestPressure: number;  habitatConversion: number;         // biosphere only
  ejecta: EjectaField|null; // spatial: Ir, spherules, shocked quartz, tsunami (distance to crater)
}
```
`events/*` and `agents/*` return `Forcing`; `earth/`, `strat/`, `bio/` consume it. A tripwire test greps that no module outside `events/` and `agents/` branches on an event type.

### 4.9 Hidden agents (M5)

`interface Agent { id; schedule(rng, world): AgentPlan; forcing(t): Forcing; }`. Civilization plan:

- Duration ~ lognormal (median ~1.5 kyr; range 300–8000 yr); onset anywhere with ≥ ~1 Myr of record after it.
- Fossil-carbon emissions: logistic rise to 5–30 Pg C yr⁻¹, then decline/collapse; total 1–8 × 10³ Pg C at δ ≈ −25 ‰.
- Fertilizer: `nutrientRunoff` + `d15N` near river mouths; coastal eutrophication → local hypoxia.
- Land use: `landCoverLoss`, `sedimentFluxMultiplier` ×1.5–5 over catchments with population.
- Mercury & soot from combustion; `persistentOrgFlux` with tiny preservation (D13).
- Biosphere: `harvestPressure` + `habitatConversion` ⇒ large terrestrial, narrow-range, insular taxa.
- Duration ≪ step: the whole thing is ~10–50 fine layers per cell, then **bioturbation smears and sedimentation-rate dilutes** it.

Later scenarios (post-M8, same interface): ancient terraforming (phylogeny oddities), crashed probe (fragments displaced by erosion/tectonics; tracer = `fragments` with extreme low preservation).

---

## 5. Mimicry & solvability (M5)

**Mimic rule (testable).** For every agent channel there is a registered `MimicPair {agentChannel, naturalCause, sharedProxies[]}`; e.g.

| agent signature | natural mimic | shared proxy |
|---|---|---|
| fossil-C burning CIE | clathrate / thermogenic LIP | δ13C, δ18O, warming |
| coal-burning Hg | LIP | Hg, Hg/TOC |
| soot/charcoal | impact fires, LIP coal combustion | charcoal, persistent organics |
| fertilizer δ15N | OAE denitrification/N₂-fixation | δ15N |
| sediment flux ↑ | uplift, aridification | accumulation rate, grain size |
| large-terrestrial extinction | impact winter | extinction selectivity |
| island-taxa loss | sea-level fall / fragmentation | range-size selectivity |

**Mimic injection.** `mimicFrequency` (difficulty) controls how often natural events from mimic classes are added to *every* world (civ or not), plus "decoy" combos (e.g. clathrate + OAE) in no-civ worlds.

**Ideal observer (approximately ideal, D5).**
1. *Inputs:* perfect access = noise-free-as-instrument-allows measurements of every cell, every proxy, at best-preserved horizons (budget ∞, no placement error).
2. *Features per candidate anomaly:* CIE magnitude/shape/onset, δ18O step, Δ(δ15N) near-vs-far-from-river, Hg/TOC, Ir, charcoal, persistent-organics detections, sediment-flux anomaly, extinction-selectivity vector (correlation of loss with body size, realm, range, insularity, calcification), Δ-age-uncertainty.
3. *Likelihood:* class-conditional KDE from the **signature library** (thousands of single-event simulations with random parameters and preservation levels), naive-Bayes combination plus a logistic classifier on the same features as cross-check.
4. *Output:* posterior over causes per anomaly and `P(civilization present)` for the world.

**Gates.**
- *Population test (Vitest):* over N = 200 civ/mimic pairs, joint AUC ≥ `solvabilityAUC` (default 0.85) **and** every single proxy's AUC < 0.9 (proves no free marker) — and the overlap bound is also checked from the other side (joint AUC < 0.99, else the mimics aren't mimicking).
- *Per-world gate:* ideal-observer posterior on the true cause ≥ `worldPosteriorMin` (default 0.7) for each major anomaly, else regenerate (D11) or flag `murky`.
- The reveal prints the ideal observer's posterior and bit-score next to the player's.

**Difficulty knobs (`DifficultyParams`)**: `preservation` (erosion rate, bioturbation depth, diagenesis), `eventDensity`, `mimicFrequency`, `noiseScale`, `civBaseRate` (hidden from player; default 0.4), `solvabilityAUC`, `murkyFraction`, `budget`.

---

## 6. Layer 2 — Observation

### 6.1 Actions (all deterministic; `result = f(worldSeed, action)`)

| action | returns | cost (budget units, tunable) |
|---|---|---|
| `reconnaissance(cell)` — free tier | cell elevation, coarse surface lithology class (misclassification noise), vegetation/exposure fraction | 0 (map layer) / 1 for zoomed |
| `surveyOutcrop(cell)` | measured section through the exposed interval (thickness = f(local relief, erosion rate, cover)); lithology log at ≥ 10 cm; contacts incl. flagged-possible unconformities; no age | 2 |
| `drillCore(cell, depth)` | lithology log (core loss/recovery ~90 %), facies, bed thickness, visible ash beds & event-like beds (mm–cm), depth in core | 5 + 0.02/m |
| `assayProxy(core|outcrop, proxy, depths[])` | δ13C, δ18O, δ15N, Ir, Hg, S, TOC, charcoal, persistent-organics, ⁶⁰Fe | per sample, proxy-dependent (δ13C cheap, Ir/Fe60 expensive) |
| `dateAsh(ashBedRef)` | U–Pb age ± 2σ | 15 |
| `identifyFossils(sampleRef)` | morphotype list with counts, preservation grade; lumping/splitting and mis-ID errors | 3 |

Re-requesting an identical action returns the identical result at no charge (cache by key).

### 6.2 What the instruments model

- **Analytical noise:** δ13C ±0.1 ‰, δ18O ±0.15 ‰, δ15N ±0.3 ‰, Ir ±10 % rel. with detection limit ~0.02 ppb, Hg ±5 %, S ±3 %, charcoal Poisson counts; scaled by `noiseScale`.
- **Sampling error:** depth uncertainty ± few cm; finite sample volume integrates over a window; core-loss gaps.
- **Diagenesis:** δ18O drifts light with burial depth/age (≈ −0.5 ‰ km⁻¹ plus recrystallisation resets), aragonite loss, organic maturation.
- **Radiometric:** U–Pb random σ ≈ 0.05–0.2 % + decay-constant systematics ≈ 0.1 %; ~5 % inherited-zircon (too old) and ~5 % Pb-loss (too young) outliers; mixed-ash beds blend ages through the `ashAgeMoment` tracer.
- **Never exposed:** true age, true facies label, tracer masses, event labels.
- **Noise determinism:** stateless counter-hash `noise(seed, kind, cell, depthKey, proxy)` — independent of action order.

---

## 7. Layer 3 — Game / UI

Everything the game knows is in `PlayerData` (JSON-serialisable): purchased measurements, columns, notebook, age models, submission draft.

- **Map view (Canvas2D):** topography hillshade, rivers/coast, per-cell exposure quality (free), icons for visited/drilled cells; layers toggles. No ages shown until player-derived.
- **Core/column viewer:** lithology column (colour+pattern per facies), bed thicknesses, fossil markers, proxy curves vs depth (error bars, detection limits), ash beds, flagged contacts; brush to request more samples (cost preview).
- **Correlation tool:** side-by-side columns; tie-lines on ash beds, proxy excursions, fossil first/last occurrences; piecewise-linear age–depth model through dated ash with uncertainty envelope; shows implied sedimentation rate, hiatus candidates (flat age-depth segments). Optional "suggest tie" via dynamic time warping on the player's own proxy series (player-side only).
- **Field notebook (DOM):** hypotheses `{claim, evidence refs, p(confidence), status}`, free text, sketches via pinning column intervals.
- **Submission (DOM+canvas timeline):** list of events `{type, ageMin, ageMax (80 % interval), causeProbabilities over candidate set incl. "unknown natural" and "civilization", overall confidence}` plus a headline `P(civilization existed)`.
- **Scoring (computed in worker, §3.3):** see D6. Event matching = optimal assignment on type + age-interval overlap. Missed events weighted by detectability-in-principle from the preservation audit (so events erased before arrival cost nothing). False positives cost.
- **Reveal:** side-by-side true vs reconstructed timeline (proxy curves, extinction curve, event bars), per-event preservation audit (`deposited? still preserved? exposed? sampled?` — from the bit-matrix `events × cells` computed at world finalisation), list of destroyed evidence (`ErasedInterval`s), ideal-observer posterior, your calibration (reliability diagram across your last games, local storage).

Save/load: `world = {config, modelVersion, worldHash}` (tiny; regenerated from seed — warns on version/hash mismatch), `playerData` JSON.

---

## 8. Key types (sketch)

```ts
type EventType = 'lip'|'bolide'|'clathrate'|'supernova'|'glaciation'|'oae'|'civilization'|'terraform'|'probe';
type Cause    = Exclude<EventType,'glaciation'|'oae'> | 'tectonic' | 'unknown_natural';
interface TruthEvent  { id; type: EventType; cls:'forced'|'emergent'; ageMa:[number,number];
                        magnitude:number; cause?: Cause; parents:number[]; }
interface PreservationAudit { deposited: BitMatrix; preserved: BitMatrix; exposed: BitMatrix; }  // events × cells
interface Submission { events: {type; ageMa:[number,number]; causes: Record<Cause,number>; conf:number}[];
                       pCivilization: number; }
interface ScoreReport { causeBits; ageIntervalScore; missed: …; falsePositives: …; idealObserverBits; brier; }
```

---

## 9. Tech & tooling

- TypeScript (strict), Vite, Canvas2D, Vitest, ESLint. No runtime deps beyond maybe none (own RNG, KDE, ODE). Dev dep `typescript` also powers the import-graph test.
- RNG: `xoshiro128**` (or `sfc32`) seeded by `cyrb128(seed)`; `fork(label)`; stateless `hash32(...keys)` for observation noise.
- Typed arrays everywhere on hot paths; no allocation inside the per-cell inner loop.
- Worker: generation reports `progress(stage, frac)`; main thread shows a staged progress bar (Earth system → tectonics → stratigraphy → biosphere → catalog → solvability).
- Presets: `dev` (32×32, 100 Myr, coarse dt), `standard` (64×64, 250 Myr), `large` (96×96).
- Performance targets: Standard ≤ 45 s generation on a mid laptop; observation call ≤ 50 ms; Vitest "fast" suite < 20 s on `dev` preset.

---

## 10. Science validation matrix (each is an automated test unless noted)

| Requirement | Test | Acceptance |
|---|---|---|
| Carbon conservation | closed system, no sources/sinks | total C drift < 1e-9 rel. |
| δ13C steady state | analytic `δ_ocean = δ_in + f_org·ε_p` | within 0.05 ‰ |
| Carbonate chemistry | modern surface ocean | pCO₂ 300–450 µatm, pH 8.0–8.2 |
| Weathering feedback | step in degassing | pCO₂ returns toward baseline, e-fold 100 kyr–1 Myr |
| δ18O thermometer | ΔT = 5 K | Δδ18O ≈ −1.15 ‰ ± 0.2 |
| **Clathrate → PETM-like** | 4500 Pg C, −60 ‰ over 10 kyr (ECS 4 K, pCO₂ 500 ppm background) | CIE −2…−6 ‰ in < 20 kyr; ΔT +3…+7 K; CCD shoals > 1 km; CIE e-fold 80–300 kyr (≈ carbon residence time = inventory / burial flux ≈ 200 kyr) |
| Facies successions | transgression–regression cycle | vertical transitions ⊂ allowed matrix unless across hiatus; 0 forbidden jumps |
| Unconformities | sea-level fall exposes shelf | age gap recorded; `ErasedInterval` thickness matches removed stack |
| **Impact layer** | D = 12 km at distal cell | layer < 1 cm, Ir ≥ 1 ppb, spherules > 0, correlated across ≥ 90 % of depositing cells at same step index |
| Ir dilution/condensation | same impact in fast vs starved cell | Ir concentration ratio ≈ inverse ratio of sed. rate (±25 %) |
| **Bioturbation smears** | 1 kyr pulse, L = 10 cm, 5 cm/kyr | FWHM ≥ L/slope-derived width; peak amplitude falls ≥ 3×; area (mass) conserved ±1 % |
| Tracer mass balance | any run | Σ tracer in stack + eroded + exported = Σ delivered |
| **Fossil bias** | fixed pool | P(found) ordered: hard-bodied marine buried fast ≫ terrestrial soft-bodied; rank correlation ≥ 0.9 |
| Signor–Lipps | sudden extinction | observed last-occurrence spread > 0 and mean earlier than truth |
| Selectivity | each stressor | acidification: calcifier odds ratio > 3; impact winter: large-terrestrial OR > 3; civ: large-terrestrial & insular OR > 3 |
| Determinism | same seed twice; different action order | bit-identical world hash; identical measurements |
| Architecture | import graph, bundle graph, reveal-sealed | pass/fail as §3.2 |
| **Ideal observer** | 200 civ/mimic pairs | joint AUC ≥ 0.85; each single proxy AUC < 0.9 |
| Performance | `standard` preset | build ≤ 45 s, memory ≤ 300 MB (manual/nightly) |

---

## 11. Milestones (commit at the end of each)

| M | Deliverable | Exit criteria |
|---|---|---|
| **M1** Earth system | `shared/` (rng, units, config), `earth/` carbonate chem, carbon cycle + P + O₂ + isotopes, climate, ice, sea level, `TimePlan`, `Forcing` type; CLI script printing time series (`tools/run-earth.ts`); small ASCII/Canvas debug plot page | all M1 rows in §10 pass; deterministic hash; 250 Myr runs < 3 s |
| **M2** Stratigraphy | paleogeography, tectonic templates, landscape routing/erosion, facies, carbonate factory, tracers, `ColumnStore`, mixed-layer bioturbation, compaction, `ErasedInterval` log; debug column + map viewer | facies, unconformity, mass-balance, bioturbation tests pass; memory/time measured on `standard` |
| **M3** Biosphere | species table, diversification, stressors, extinction selectivity, community, taphonomy, Lagerstätten | selectivity, fossil-bias, Signor–Lipps tests pass |
| **M4** Natural events + **vertical slice** | LIP, bolide, clathrate, supernova, ash eruptions, segmenter (OAE, glaciation), truth catalog; worker + protocol; **minimal playable slice**: map → drill → core viewer → assay proxies, budget counter | impact + PETM tests pass; end-to-end in browser with progress bar; truth-isolation tests pass |
| **M5** Hidden agents & solvability | `Agent` interface, civilization, mimic registry, mimic injection, signature library tool, ideal observer, solvability gate, difficulty knobs | population AUC test passes; world gate rejects/flags correctly |
| **M6** Full investigation UI | outcrop survey, dating, fossil ID, correlation tool + age model, notebook, save/load | playtest checklist; all UI imports pass architecture tests |
| **M7** Submission, scoring, reveal | submission editor, scoring (log/interval/Brier), preservation audit, reveal view, calibration history | unit tests of scoring propriety (expected score maximised by honest belief); reveal sealed before submit |
| **M8** Balancing & polish | tune cost/noise/event rates via automated bot players (random, greedy, ideal-observer-informed) over 100s of seeds; difficulty presets; perf pass; docs | bot score ladder: random < greedy < informed < ideal; median solve rate per difficulty in target band |

---

## 12. Risks & open questions

1. **Memory/time of layered grid** (D14): mitigations — dev preset, quantised env bytes, tracer subset per facies, layer merging below the mixing zone (flag `mergeDeep`), `maxSteps` guard. I will profile at the end of M2 before committing to the 64×64 default.
2. **Ideal observer validity** (D5): quality bounded by chosen summary stats; I will report its AUC ceiling honestly and extend features until separation saturates.
3. **Tuning plausibility vs. fun:** many parameters are ranges from literature; M8 uses bot play to tune, not intuition.
4. **Scope creep:** orbital cycles (D7), δ34S, terraforming, probe, DTW suggestions are explicitly post-M8.
5. **Browser support:** Chromium/Firefox/Safari with module workers; no SharedArrayBuffer needed.
6. **Open question for you (answer at approval, defaults in brackets):** (a) civilization base rate [0.4]; (b) Standard span [250 Myr]; (c) log score as primary [yes]; (d) UI framework-free [yes]; (e) project name "Silur" [yes].

---

## 13. Status

Design approved. Implementation proceeds milestone by milestone (M1 → M8), with a commit at the end of each.
Open questions in §12.6 were accepted at their stated defaults.

### M1 — as built (deviations from the plan above, and why)

- **Integrator.** Adaptive Rosenbrock ROS2 (L-stable, 2nd order) with a finite-difference Jacobian and dense LU, not
  Dormand–Prince RK45: the atmosphere/surface-ocean modes (~10 yr) are stiff next to the 100 kyr plan step, and an
  explicit method would need ~10⁴ substeps per step. 250 Myr at 100 kyr steps runs in ≈ 1 s.
- **State.** 15 variables (atmospheric C; surface & deep DIC and alkalinity; PO₄; deep O₂; atmospheric O₂; crustal
  organic C; δ¹³C of atmosphere, surface and deep DIC; surface & deep temperature; ice volume). Isotopes are carried as
  δ values per pool (`M dδ/dt = Σ J(δ_in − δ)`), not as moments — same physics, better scaled for the solver.
- **Baseline calibration** (`calibrate.ts`) builds an exact steady state: surface chemistry from (pCO₂, Ω) in closed
  form, shelf-carbonate coefficient from the alkalinity balance, then spin-up with the slowest reservoirs frozen to
  settle the deep ocean / P / O₂ / isotopes. You change a number in `planet.ts` and the baseline re-closes itself.
- **Added: terrestrial organic burial** suppressed by wildfire in an O₂-rich atmosphere. Without it atmospheric O₂ drifted
  to 35–50 % over 250 Myr; with it the sampled planets stay at ≈ 19–23 %.
- **Added: saturating productivity** (`2P/(1+P)`; nitrogen/light limitation) and baseline export scaled with ocean
  mixing so a planet's *baseline* deep-ocean oxygenation does not depend on its sampled overturn rate. Both removed
  runaway euxinia in a third of sampled planets.
- **Slow drivers** (degassing, uplift, polar land, tectonic eustasy) are Ornstein–Uhlenbeck processes with 25–80 Myr
  correlation times, so each world has only ~3–4 independent "climate eras" — intended (greenhouse / icehouse epochs).
- **PETM recovery** is slower than I first wrote in §10 (e-fold ≈ 200 kyr, not 50–150): it follows directly from the
  carbon inventory (~5×10⁴ Pg) divided by the total burial flux (~0.25 Pg C yr⁻¹). Real PETM CIE recovery is ~150–200 kyr.
  A 3000 Pg C release warms only ~2.5 K here (airborne fraction ≈ 20 % after carbonate compensation); a PETM-sized +4–5 K
  needs ~4500–5000 Pg C or a higher ECS. Test updated accordingly.
- **Dev tooling.** `tools/depcheck.ts` (import-graph checker, also a CLI), `tools/run-earth.ts` (sparkline table),
  `dev/earth.html` (Canvas debug page; deliberately outside `src/`, its own Vite entry, proven by the bundle test to
  be the *only* place truth is bundled).

### M2 — as built (deviations from the plan above, and why)

**Measured at the `standard` preset (64×64, 250 Myr, 2500 steps; all three tectonic templates):** Earth system ≈ 0.9 s,
stratigraphy 10–13 s, 0.7–1.1 M layers, ≈ 80–190 MB of typed arrays (peak RSS ≈ 450 MB during generation, before trimming).
Comfortably inside the D14 budget (≤ 250 MB, ≤ 45 s), so 64×64 stays the default and the "layer-merge in reserve" is
already in use (see below).

- **Layer record.** Layers store `formed` (step index), `ageMean` and `ageSigma` (mass-weighted, after mixing) rather than
  `stepTop/stepBase`: a bioturbated layer is a blend of times, so a mean ± spread is the honest description. Hiatus is an explicit
  `HIATUS` flag plus a `gap` count of skipped steps, not something inferred from ages.
- **Bioturbation** is the Berger–Heath mixed layer exactly as designed (`strat/column.ts`). The mixed layer is *frozen* into
  rock whenever deposition stops or erosion bites (an exposed surface lithifies). `lmix` is in solid-rock metres.
- **Layer merging is on by default** (design had it in reserve): adjacent same-facies *background* beds are merged up to 10 m
  of solid rock. Refined-step beds and the two steps after them carry `KEEP` and never merge, so event smears survive.
  Without merging: 2.4–2.9 M layers / ~490 MB; with 2 m: same order; with 10 m: 0.7–1.1 M.
- **Compaction** is computed from per-column lithology totals (mud, sand, carbonate, evaporite, organic) with
  Sclater–Christie curves — exact bookkeeping under deposition, erosion and merging, O(1) per step. Layerwise compaction
  (`layerThickness`) is for the observation layer / viewers.
- **Isostasy** is a single factor: surface = basement + (1 − 0.35) × compacted sediment.
- **Landscape.** D8 routing with *no* pit filling: closed depressions are sinks that fill and then spill over time.
  Detachment-limited stream power for land with slope above 0.0015, floodplain deposition below it. Sediment is split
  into sand and mud; sand drops near the river mouth, mud travels on; marine deposition is capped by accommodation
  (sediment cannot fill above sea level), which is what makes shorelines prograde. The map is a closed system.
- **Facies.** Eight facies as designed. A facies jump the time step cannot resolve (not a Walther neighbour) is stamped
  `DROWN` (condensed surface) instead of being passed off as continuous. Test: continuous successions obey the adjacency
  matrix (< 2 % exceptions) and an imposed sea-level cycle leaves transgressive–regressive packages.
- **Carbonates.** Shelf factory (`strat/factory.ts`: light curve × temperature × saturation × terrigenous poisoning) with a
  20 % cool-water floor (without it, high-latitude shelves drowned and every basin turned into pelagic ooze); pelagic rain
  above the Earth system's CCD; evaporites in arid, restricted shallow cells and playa sinks.
- **Exhumation** (last ≤ 35 Myr of regional uplift) is a parameter (`exhumeMyr`, 0 = off). Tests turn it off so the record
  survives to be inspected; real worlds keep it on, which is what exposes old rock at the surface.
- **Tracer deposition** already uses the Earth-system history (δ13C, δ18O with latitude-dependent temperature, δ15N with a local
  river-mouth nutrient anomaly, Hg, charcoal vs the O₂-controlled fire index, pyrite-S vs euxinia, ⁶⁰Fe, persistent organics)
  and has a `StratSource` hook for event deposits (ejecta, ash, tsunamites) — M4 plugs into it. An end-to-end test shows a
  clathrate pulse arriving as a > 1.5 ‰ negative δ13C excursion in shelf carbonates.
- **Accounting.** `tally` records everything delivered to and removed from the columns; tests check every tracer balances,
  that routing conserves clastic mass (delivered = eroded + basement + dust), and that the erosion log accounts for every
  metre of rock removed. `envHistory` keeps the facies of every cell at every step (10 MB) for the reveal.
- **Not yet modelled** (candidates for M4/M8): wave-base/ravinement erosion of the shelf, turbidites, hillslope diffusion,
  ash falls, impacts, tsunamites, and the biosphere's effect on bioturbation depth and organic burial (M3).
- **Known rough edges.** Foreland and intracratonic templates still make carbonate-heavy columns up to ~10 km thick in the
  deepest spot; glacial diamict can dominate a long icehouse at high palaeolatitude. Both are tuning, not structure, and are
  on the M8 balancing list.

### M3 — as built (deviations from the plan above, and why)

**Measured (standard preset):** biosphere 0.2 s, ≈ 21 000 species over 250 Myr with ≈ 500 → 1000 living; M2 timings and memory unchanged.

- **Hazards are dose-based, not `exp(β·v·I)`** (a change from §4.6). Hazard per year = `h_base + Σ_s v_s · I_s / τ_s + thermal`, where `τ_s` is a
  *lethal time* (years of full-strength exposure to kill 63 % of fully vulnerable species): light 0.5 yr, UV 30 yr, fire 30 yr,
  harvest 3 kyr, habitat conversion 10 kyr, acidification 400 kyr, anoxia 300 kyr, shelf loss 600 kyr, thermal excess 400 kyr. A year of
  darkness and a hundred thousand years of acid ocean therefore act on the same variable-length time grid with the same arithmetic.
  Event modules (M4/M5) must give the `Forcing` intensity *averaged over the step*, so that intensity × step length = dose.
- **Slow change is not a stressor.** Acidification and shelf loss are measured against a 3-Myr running baseline; species' thermal niches
  track global temperature with a 5-Myr e-folding time through speciation offsets. Only *rapid* change kills.
- **Selectivity (tested, odds ratios > 3):** acidification → calcifiers, aragonite worst, land untouched; impact winter → big endotherms and
  autotrophs, burrowers/detritivores spared (OR < 0.5); hunting + land conversion → big land animals and island endemics; anoxia →
  benthic deep-shelf life, not plankton; fast warming → thermal specialists.
- **Standing biosphere** via a 40-Myr benign burn-in; survivors become phylogeny roots (`parent = −1`, `birth = BEFORE_RECORD`). Late
  clades (land plants, arthropod-likes, big endotherms) originate at fractions of the history drawn per archetype, so large land animals
  appear mid-history rather than at t = 0.
- **Clades** are built from 18 archetypes × random perturbation (40 clades) — every world has calcifiers of several mineralogies,
  soft-bodied life, burrowers, plants, small and large land animals, freshwater forms and island endemics, but *which* survive is chance
  (a world can lose its aragonite-builders in the burn-in, which is fine and tested around).
- **Fossils** (`community.ts`, `taphonomy.ts`): `communityAt(bio, stepFrom, stepTo, EnvContext)` and `drawAssemblage(…, individuals, key)` are
  pure functions of the environment of a layer (facies, depth, O₂, palaeolatitude, sedimentation rate, burial depth, age, Lagerstätte
  flag) — the observation layer will pass in what the layer's `env` bytes and compaction give. Emergent biases verified: hard ≫ soft
  (orders of magnitude), marine shelf ≫ land, fast burial helps, aragonite dissolves with depth and age, Lagerstätten rescue soft bodies,
  Signor–Lipps (last occurrences earlier than true extinction, with spread; some victims never seen).
- **Strata hooks.** (1) `simulateStrata({ bioturbationIndex })` — marine burrower richness relative to the start scales mixing depth
  (`0.25 + 0.75·index`): fewer burrowers ⇒ less time-averaging. (2) Rare `LAGERSTATTE` layers (3 % of qualifying cell-steps): marine, bottom
  water < 10 µmol/kg, sedimentation > 30 m/Myr. (3) Bottom-water oxygen is now depth-resolved on the shelf: an expanded oxygen-minimum zone
  reaches the outer shelf when the deep ocean is poorly ventilated.
- **Not yet:** nothing in a no-event world causes a mass extinction (largest single-step loss ≈ 2–4 %) — that is M4's job through
  `Forcing`; the biosphere does not yet feed back on organic burial.

### M4 — as built (deviations from the plan above, and why)

**Measured (standard preset, seed `alpha`):** whole world in ≈ 23 s (Earth 1.2 s, biosphere 0.3 s, strata ≈ 22 s, 3 450 steps incl. event windows),
≈ 1.9 M layers, 21 000 species; in a real browser the worker reports smooth progress and finishes in ≈ 22 s. 158 tests.

- **Events** (`src/truth/events/`): LIP, bolide, clathrate, supernova (forced) and ash eruptions (background), drawn as Poisson processes
  (per Myr × `eventDensity`: LIP 0.012, global bolide 0.012, regional impacts 0.03, clathrate 0.012, supernova 0.004, ash 0.4 + 2 per LIP-Myr).
  Rates go through `Forcing` as **step averages** (`avgOverStep`: intensity × step = dose); instantaneous deposits (ejecta clay + Ir/spherules/shocked
  quartz/charcoal, tsunamites, ash beds, ⁶⁰Fe) go through one `EventSource` (a `StratSource`, now given `{waterDepth, x, y}`).
- **Calibration to the real record:** global Ir fluence 70·D³ ng m⁻² (≈ 8 ppb in a 3-mm distal clay for D = 10 km), proximal ejecta ∝ r⁻³, ⁶⁰Fe with
  2.6-Myr half-life (undetectable beyond ~25 Myr), clathrate 2–5·10³ Pg C at −60 ‰, **LIPs 1.5·10⁴–1.2·10⁵ Pg C in sharp pulses plus a phosphorus
  pulse** (an early draw of 10³–10⁴ Pg gave a 1 K blip and no OAEs; the larger, pulsed LIPs now produce hyperthermals, OAEs and extinctions).
  A 12-km impact kills ≈ 40–70 % of species, with large endotherms and autotrophs hit and burrowers spared.
- **Two M3 constants changed:** UV lethal time 30 yr → 3000 yr (a 30 % ozone loss for kyr was 100 % lethal), and only acute darkness (`lightReduction`)
  drives the light stressor — a chronic volcanic aerosol veil dims the planet but is not lethal (LIP steps of 10 kyr × 0.01 intensity wiped out all life).
- **Segmenter + catalog** (`segmenter.ts`, `catalog.ts`): OAE (anoxic > 0.25), glaciation (ice > 0.3), hyperthermal (> 2.5 K over a 3-Myr baseline) and
  extinction pulses (clustered excess deaths, > 4σ over background and ≥ 6 % of species). Causal links by "effect starts after cause began, no later
  than a lag after it ended" (1.5 Myr; 0.5 Myr for extinctions); effects inherit the cause. Ash eruptions are kept separately (`World.ashes`).
- **World** (`truth/world.ts`): `generateWorld(config, progress, options)`; `options` (explicit schedule, template, exhumation, latitude) exists for tests
  and scenario worlds. `worldHash` fingerprints a world.
- **Observation** (`src/observation/`): `drill` (cost 5 + 0.02/m, ×3 offshore, ≤ 1500 m; per-core depth stretch ≈ 0.4 %, ≈ 8 % core loss that is *cut out*
  of the bed list so lost intervals leak nothing) and `assay` (per-sample cost; 6-cm samples). Rock names come from composition (limestone … tuff,
  diamictite from texture); notes are what a geologist sees ("volcanic ash bed", "thin clay-rich layer", "chaotic graded sand bed", "sharp contact").
  Instruments: Gaussian/relative noise, detection limits, Poisson counting, δ¹⁸O diagenesis (≈ −0.5 ‰ per km burial, drift with age, per-sample overprint),
  ⁶⁰Fe decay, 3 % contamination for persistent organics. Free map: noisy topography, remote-sensed surface rock (15 % wrong), exposure.
  Noise is stateless-hash based — verified order-independent; repeating an action is free.
- **Bioturbation blurs event beds into older sediment too** (a 1-kyr impact step mixes with the ~8 cm of older mud below it), so the ejecta layer's mean
  age is ~50–100 kyr older than the impact and Ir peaks are a few ppb at best. This is realistic, and tests allow for it.
- **Worker/client:** `WorkerHost` (pure class) + 10-line `worker.ts`; `ObservationClient` over a `Transport`; tests wire them in-process with structured
  cloning of every message. `submit` is refused (`sealed`) until M7. The build emits the worker as a separate asset.
- **Architecture tests strengthened:** the bundle test now proves the main-thread chunks contain no truth/observation *modules or code strings* and that the
  worker asset does contain them (positive control).
- **UI** (`src/ui`, `src/game`): map (topography / remote-sensed rock / exposure), drill, core log with lost-core shading and note ticks, assay curves with
  1σ bars, budget, progress bar. Plain DOM + Canvas2D.
- **Known rough edges / M8 list:** (1) after the final exhumation phase ~30 % of the map is bare basement and several cells carry < 20 m of rock — the
  sedimentary cover needs to be thicker and more continuous for good play; (2) LIPs and big impacts are common enough that some worlds have 4–5 of them;
  (3) the 15 % remote-sensing error looks like salt-and-pepper noise; spatially correlated error would be kinder; (4) no OAE appears unless a LIP/clathrate
  drives one (intended, but rare in short runs).

### M5 — as built (deviations from the plan above, and why)

**Measured:** a gated standard world takes ≈ 31 s (≈ 22 s generation + ≈ 9 s ideal-observer assessment; the gate passed the first draw in 3 of 3 standard
and 14 of 20 dev worlds, mean 1.45 draws); the library holds 200 mini-world samples per cause class (105 KB). 182 tests.

- **The civilization** (`truth/agents/civilization.ts`) is an `Agent` that returns ordinary `Forcing` and TimePlan windows: fossil-carbon burning (1–8·10³ Pg C at
  δ13C ≈ −25 ‰, logistic rise → abrupt collapse), Hg, fire/soot, persistent organics, fertiliser P with a δ15N that can go either way (−2…+12 ‰), land-use
  channels (erosion multiplier, cover loss, habitat conversion) that persist 1–3 kyr after the collapse, and harvest pressure. Duration lognormal (median 1.5 kyr,
  0.3–8 kyr). Step averages are integrated numerically (24–4000 samples) so total carbon is exact for any step length. Probability `civBaseRate` per world.
- **No unique marker (tested):** every channel the civilization uses is also used by some natural event. That needed two additions: impacts now have a `soot`
  channel, and the natural **aridification pulse** (new forced event, 20–300 kyr of faster erosion, cover loss, habitat loss and a predation-like
  `harvestPressure`) mimics land use. The hazard/stressor model decides who dies; the agent just supplies pressure.
- **Mimics** (`events/mimics.ts`): a registry of eight agent-signature/natural-look-alike pairs with their shared proxies, and `injectMimics` adding
  Poisson(3·`mimicFrequency`) look-alikes to *every* world: small fast clathrate releases, short thermogenic LIP bursts (δ13C −12…−28 ‰, Hg ×4–25), 3–9 km impacts
  (fire, winter) and aridification.
- **Calibration fixes found on the way** (all affect earlier milestones): mercury background flux was 10⁵ times too small (now 5 µg m⁻² yr⁻¹ → ~20 ppb in shelf
  mud); fire lethality was calibrated for a one-year fire and annihilated land life under a kyr-long civilization (τ_fire 30 → 1000 yr, intensity ×0.2); harvest τ
  3000 → 1500 yr; and a latent crash — ~2 % of sampled planets could not calibrate (pelagic burial exceeded total carbonate burial) — is fixed and tested over 150 planets.
- **Ideal observer** (`observation/solvability/`): 14 rock-record features measured as an unlimited-budget geologist would (carbon-isotope excursion from carbonate
  or organic matter, δ18O, Hg/TOC, Ir, charcoal, persistent organics, δ15N, terrigenous fraction, ash, excursion width, and extinction selectivity among
  fossilisable species), a Gaussian naive-Bayes model fitted to the library, tempered ×0.5 for correlated features. Mini-worlds (10×10, 16 Myr, one event, real
  pipeline, 0.13 s each) fill the library via `tools/build-signatures.ts`; `signatures.json` records `modelVersion` and a test fails if it is stale.
- **Population test:** civilization vs. mimic worlds (60 pairs, independent seeds): joint AUC ≈ 0.9 (≥ 0.85 required, < 0.99 required), **every single feature < 0.9**
  (widest: excursion width 0.88, extinction selectivity 0.80), and every mimic class overlaps the civilization in ≥ 3 features. Without the calibration fixes above the
  separation was 0.98–1.00 because the civilization wiped out all land life.
- **Gate (changed from the plan):** the plan required the true-cause posterior ≥ 0.6 for *every* major anomaly; in real worlds (≈ 20 forced events, overlapping
  windows) that rejected 13 of 16 worlds. The gate now asks the headline question: the ideal observer must call "civilization present" with p ≥ `worldPosteriorMin`
  (0.6) when there is one, and p ≤ 0.4 when there is not (noisy-OR over major anomalies with the world's prior mix of causes). On 40 full worlds the ideal observer
  gets this right 72 % of the time (AUC 0.82), so ≈ 70 % of draws pass; failures are mostly civilizations erased by erosion/uplift or buried among look-alikes — "unsolvable
  in principle". Rejected worlds are redrawn (`attempt` salts the RNG, so the accepted world is still a pure function of the seed), up to `maxTries` (4), then flagged
  murky; `murkyFraction` deliberately leaves some worlds murky. **Selection effect:** accepted worlds are, by construction, ones the ideal observer gets right.
  `minTruePosterior` over major anomalies is reported but no longer gates.
- **Worker:** the default world factory is now `generateSolvableWorld`; the verdict is kept in the host (`lastSolvability`) until the reveal (M7). New stage `solvability`.
- **Known limits:** (1) the ideal observer reads rock features through the truth tracers (noise-free) — it bounds a perfect player, not a real one; (2) its power stems from
  14 features; if a human ever beats it a feature is missing; (3) mini-world libraries do not include confounding neighbours, which is why full-world accuracy (72 %) is
  lower than the mini-world AUC suggests; (4) the redraw loop makes standard-world generation 31 s typical, ≈ 60–90 s worst case (the progress bar restarts per draw).

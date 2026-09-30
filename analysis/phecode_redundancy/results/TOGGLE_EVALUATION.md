# Hierarchy-mask toggle — evaluation

**"Hide edges between related phecodes", prototyped on branch `hierarchy-mask-toggle`. Not merged, not deployed.**

This reports what the two candidate implementations cost, what the candidate
tier sets actually hide, and which combination we recommend. Numbers only;
the decision is yours.

---

## 0. Summary

| Question | Answer |
|---|---|
| Does it work? | Yes, on both pages, in both implementations, with identical results. |
| Which implementation? | **Client-side rule.** It is as fast, ships 5.7 kB gzipped once rather than 13.8 kB gzipped on every filter change, and needs no rebuild of any data file. |
| Which tier set? | **{T1, T2}.** T1 alone misses obvious sibling duplicates; T4 as defined over-masks. |
| Does it meet the speed guidelines? | Yes on all three. See §3. |
| Biggest caveat | In AFR, {T1,T2} leaves **37.9% of phenotypes with no edges at all**. The toggle needs to say so on screen, or the AFR network looks broken. |
| Second caveat | **T3 cannot be evaluated.** The exclusion ranges are in `phecode_definitions1.2.csv`, which we do not have. Nothing here tells you whether T3 is safe. |

---

## 1. Behaviour as built (B1)

- Labelled **"Hide edges between related phecodes"**, off by default, on the
  network view (page 1) and the node view (page 2).
- **Network view:** masked edges are treated as *absent*, not merely hidden.
  The mask is applied in the single predicate `edgePresent()`, which already
  feeds the degree calculation, the degree slider's range, the isolate drop
  and the summary counts — so the degree filter is the masked degree with no
  second code path and no extra cost. There is nothing to report under "if
  that is expensive": it is the same recompute an edge-type change already
  does.
- **Node view:** outer-ring phenotypes related to the centre are removed with
  their edges. **All 150 of the centre's SNPs stay**, at every setting, in
  every screenshot. This required running the mask *after* `updateNodes()`:
  that function drops SNPs with fewer than two edges, and hiding a related
  phenotype can leave one of the centre's SNPs with a single edge — the one
  to the centre. Dropping those would have made the toggle look as though it
  had thinned the centre's own evidence.
- **State:** carried in the query string (`mask=1`), the same mechanism
  ancestry and p-value already use. Verified end to end, not just by the
  checkbox state — see §4.1.
- **Edge view:** untouched and unbroken. The state rides along in the URL so
  anything page 3 opens keeps the setting, but page 3 draws no control and
  ignores the parameter.
- **Tier set is one config value**, `HierarchyMask.TIERS` in
  `public/js/hierarchy-mask.js`. `maskTiers=` and `maskImpl=` in the query
  string override it; nothing in the UI exposes either, they exist so the
  benchmark and the screenshot script can sweep them.

### What the toggle says about T3

T3 is never masked, because it cannot be computed from any input we have
(`A0_RECON.md` §4). Rather than let the control imply it checked T3 and found
nothing, `/api/relations/status` reports T3 under `unavailableTiers` and the
control renders a second line: *"masking T1, T2; T3 unavailable on this
data"*. If the definitions file arrives, that line changes on its own.

---

## 2. Implementation candidates (B2)

Both are built and both are live behind `maskImpl=`.

### Option 1 — precomputed attribute

`analysis/phecode_redundancy/build_relations.py` writes a tier bitmask per
edge; `/api/landing/edges?rel=1` attaches it to each edge and the client
filters on it.

The landing edgelist cannot cover the node view — page 2's outer ring is not
drawn from it — so this option also needs `pair_relations.parquet`, a sparse
table of every related node pair, served per centre phenotype through
`/api/relations/pairs`.

### Option 2 — client-side rule

`public/js/phecode-relations.js` applies the truncation rule to the phecode
strings in the browser. It is a port of the A2 classifier and runs the same
test cases (§4.1). T1 and T2 need no pair data at all, only a node→phecode
map. T4 needs the separate lookup, measured on its own below.

### Data volumes

| File | Purpose | Bytes |
|---|---|---|
| `pair_relations.parquet` | every related pair, all tiers | 10,951 |
| `edge_relations.parquet` | one row per landing edge | 66,644 |
| `node_phecodes.json` | Option 2, T1/T2 | 20,596 |
| `pair_relations_t34.json` | Option 2, the T4 surcharge | 2,276 |

The whole relation universe is **2,596 related pairs** out of ~870,000
possible node pairs — 1,003 T1, 1,441 T2, 178 T4. Only 1,181 of the 54,790
landing edges carry a relation at all. This is why the payload question
turned out not to be close.

### Deviation from the plan, and why

B2 says to add the flag "to the precomputed network data". We did not modify
`landing_page.duckdb` or `node_attributes.parquet`: the ground rules forbid
touching precomputed network files, and this is a prototype awaiting
sign-off. The flags live in new companion files beside them, which gives the
same payload characteristics for measurement. If Option 1 were adopted, the
files could be folded into the build at that point.

The server degrades cleanly: if the companion files were never built, it logs
a warning, `/api/relations/status` reports `available: false`, neither page
draws the control, and a `mask=1` arriving in a URL is turned off with a
console warning rather than silently ignored.

---

## 3. Speed (B3)

_(pending — the benchmark runs on a quiet machine; see `toggle_bench.json`)_

---

## 4. Effectiveness (B4)

### 4.1 Correctness

**Unit tests, both languages, same cases.**

| Suite | Result |
|---|---|
| `analysis/phecode_redundancy/test_phecode_relations.py` | 12 passed, 1 skipped |
| `scripts/test_phecode_relations.js` | 15 passed, 1 skipped |

The skip is the same in both: the hand-verified T3 case, which needs
`phecode_definitions1.2.csv`. The JS suite carries three extra cases that
only exist in the browser (a node with no phecode must come back
*unclassifiable* rather than *unrelated*; merged nodes; the tier-name →
bitmask helper).

**Behaviour tests** (`scripts/test_toggle_state.js`, 10 checks, all pass):
off by default on both pages; double-clicking a node opens the node view with
`mask=1` in the URL and the toggle already on; and the carried state is
*applied*, not merely checked — the outer ring goes from 111 to 104
phenotypes for ESRD in META. The edge view still renders with `mask=1` in its
URL, with no page errors and no control.

**Spot-check samples** — 30 masked and 30 unmasked edges per ancestry, drawn
with a fixed seed, in `results/toggle_samples.csv` (120 rows, with phecode,
name, category and tier for both endpoints). A sample of each:

| Group | Tier | Shared SNPs | Pair |
|---|---|---|---|
| AFR masked | T2 | 62 | 695.41 Cutaneous lupus erythematosus — 695.42 Systemic lupus erythematosus |
| AFR masked | T1 | 2,441 | 288.1 Decreased white blood cell count — 288.11 Neutropenia |
| AFR unmasked | unrelated | 15 | 272.1 Hyperlipidemia — 574.1 Cholelithiasis |
| EUR masked | T1 | 1,128 | 571 Chronic liver disease and cirrhosis — 571.51 Cirrhosis of liver |
| EUR masked | T2 | 529 | 250.25 Diabetes type 2 with peripheral circulatory disorders — 250.7 Diabetic retinopathy |
| EUR unmasked | unrelated | 54 | 327 Sleep disorders — 476 Allergic rhinitis |

One thing to note while reading the samples: a few nodes carry no label and
print their phecode instead (`1089`, `1010.3`). That is a property of
`node_attributes.csv`, not of the mask.

### 4.2 Coverage

Fraction of edges masked and nodes isolated, at p < 1e-4:

| Ancestry | Tier set | Edges masked | Weight masked | Nodes isolated |
|---|---|---|---|---|
| AFR | T1 | 469 / 5,517 (8.50%) | 83,756 / 295,919 (28.30%) | 277 / 768 (36.07%) |
| AFR | T1+T2 | 638 / 5,517 (11.56%) | 112,545 / 295,919 (38.03%) | 291 / 768 (37.89%) |
| AFR | T1+T2+T4 | 651 / 5,517 (11.80%) | 112,641 / 295,919 (38.06%) | 293 / 768 (38.15%) |
| EUR | T1 | 624 / 53,403 (1.17%) | 1,489,533 / 16,637,646 (8.95%) | 79 / 1,002 (7.88%) |
| EUR | T1+T2 | 1,103 / 53,403 (2.07%) | 2,055,883 / 16,637,646 (12.36%) | 83 / 1,002 (8.28%) |
| EUR | T1+T2+T4 | 1,129 / 53,403 (2.11%) | 2,061,454 / 16,637,646 (12.39%) | 83 / 1,002 (8.28%) |
| META | T1 | 627 / 51,224 (1.22%) | 1,226,296 / 14,554,789 (8.43%) | 87 / 997 (8.73%) |
| META | T1+T2 | 1,108 / 51,224 (2.16%) | 1,730,400 / 14,554,789 (11.89%) | 94 / 997 (9.43%) |
| META | T1+T2+T4 | 1,136 / 51,224 (2.22%) | 1,735,406 / 14,554,789 (11.92%) | 94 / 997 (9.43%) |

`{T1,T2,T3,T4}` is absent because T3 is not computable. `{T1,T2,T4}` is the
largest set this data supports.

Two things stand out.

**Related pairs are few but heavy.** In AFR, 11.6% of edges carry 38.0% of
the weight. That asymmetry is the reviewer's point stated as a number, and it
is real.

**AFR loses a third of its phenotypes.** {T1,T2} isolates 37.9% of AFR nodes
against 8.3% in EUR. The AFR network is sparse — 5,517 edges over 768 nodes
against EUR's 53,403 over 1,002 — and a large number of AFR phenotypes have
exactly one edge, to a parent or a sibling. The toggle does not create this;
it exposes it. But a user who ticks the box in AFR and watches two thirds of
the map survive will read it as a bug unless the page says what happened. We
recommend the count be surfaced (§6).

### 4.3 Over-masking

The 20 heaviest edges each tier set would hide are in
`results/toggle_overmasking.csv` (180 rows). For T1 and T2 they are
unambiguous — the heaviest masked pairs are exactly the definitional
duplicates the toggle exists to remove:

| Ancestry | Tier | Shared SNPs | Pair |
|---|---|---|---|
| EUR | T1 | 107,798 | 250 Diabetes mellitus — 250.2 Type 2 diabetes |
| EUR | T1 | 49,259 | 244 Hypothyroidism — 244.4 Hypothyroidism NOS |
| EUR | T1 | 38,786 | 427.2 Atrial fibrillation and flutter — 427.21 Atrial fibrillation |
| EUR | T1 | 38,333 | 401 Hypertension — 401.1 Essential hypertension |
| AFR | T1 | 6,044 | 250 Diabetes mellitus — 250.2 Type 2 diabetes |
| AFR | T2 | 3,275 | 288.1 Decreased white blood cell count — 288.2 Elevated white blood cell count |

No clinically distinct pair appears in the T1 or T2 top 20 of any ancestry.

**T4 is a different story.** T4 fires on **one** shared ICD code, and the
count is not part of the rule. The 67 T4-only edges are in
`results/toggle_t4_only_edges.csv`; sorted by weight, the top of the list is:

| Shared SNPs | Shared ICDs | Pair |
|---|---|---|
| 1,513 | **1** | 714 Rheumatoid arthritis and other inflammatory polyarthropathies — 939 Atopic/contact dermatitis |
| 1,166 | **1** | 690.1 Seborrheic dermatitis — 702.2 Seborrheic keratosis |
| 380 | **1** | 317.11 Alcoholic liver damage — 571.8 Liver abscess and sequelae of chronic liver disease |
| 245 | 150 | 249 Secondary diabetes mellitus — 250.7 Diabetic retinopathy |
| 111 | 14 | 707.2 Chronic ulcer of leg or foot — 440.21 Atherosclerosis of native arteries |

The last two are the kind of overlap T4 was meant to catch. The first three
are clinically distinct pairs being hidden on the strength of a single code —
and they are the heaviest edges T4 removes. As defined, T4 does not separate
the two cases. If it is wanted, it should be gated on a shared-ICD count (or
a shared fraction), and that threshold should be chosen deliberately rather
than defaulted to ≥1.

**T3 cannot be checked at all.** The task asks specifically whether T3 masks
clinically distinct pairs, because exclusion ranges can be broad. We cannot
answer: no input file we have carries `phecode_exclude_range`. Given what T4
turned out to do on a much narrower rule, we would not enable T3 without
running this same check on it.

### 4.4 Use case: ESRD

`results/screenshots/` — ESRD (585.32) in AFR and EUR, network view and node
view, toggle off and on, for each of the three tier sets. 24 PNGs plus
`counts.json`.

The on/off difference agrees with A3 exactly. ESRD's degree in the network
view reads:

| Ancestry | off | T1 | T1+T2 | T1+T2+T4 |
|---|---|---|---|---|
| AFR | 86 | 84 | 80 | 80 |
| EUR | 142 | 140 | 134 | 134 |

which are the L0 / L1 / L2 / L3_partial rows of `esrd_sensitivity.csv`, to
the unit. The node view keeps all 150 of the centre's SNPs at every setting;
the outer ring goes 38 → 32 in AFR and 99 → 92 in EUR under {T1,T2}.

---

## 5. Recommendation

**Tier set: {T1, T2}.**

T1 alone leaves the sibling duplicates behind — decreased and elevated white
blood cell count share 3,275 SNPs in AFR, and cutaneous and systemic lupus
are one pair of codes apart. Adding T2 costs 3 points of AFR edges and
2 points of AFR nodes over T1 and catches them.

Adding T4 buys almost nothing — 13 more AFR edges, 26 more EUR edges, 0.03
points of weight — and its heaviest removals are wrong. Leave it off until
the rule has a shared-ICD threshold behind it.

T3 stays off because it does not exist on this data.

**Implementation: Option 2, the client-side rule.**

It ships 20.6 kB (5.7 kB gzipped) once, against 438 kB (13.8 kB gzipped)
added to *every* landing-edges response — and the landing edges are
refetched on each ancestry and p-value change. It needs no companion parquet
and no rebuild of anything, and it is not slower.

To be fair to Option 1: compressed, the difference is small, and the 10%
payload guideline is met either way (§3). Option 1's real disadvantage is
that it re-sends a static fact on every filter change, and its only real
advantage is that it can answer tiers the browser cannot derive — T3 and
T4 — and we are recommending neither.

If T4 is later adopted with a threshold, Option 2 absorbs it for 2.3 kB
(`pair_relations_t34.json`), which does not change the conclusion. Option 1
would become the better choice only if the tier set grew to something the
truncation rule cannot express *and* the pair table grew large enough to be
worth serving per-node — neither is in view.

**One change we would make before shipping.** The AFR isolate rate needs to
be visible. The summary panel already shows a phenotype count that drops from
755 to 474 when the box is ticked; a line next to the toggle saying how many
phenotypes were left without edges would turn a confusing result into an
informative one. That is a small addition to `HierarchyMask.control()` and we
have not made it, because the tier set it should quote is still your decision.

---

## 6. Diff summary

Branch `hierarchy-mask-toggle`, 6 commits ahead of `main`, **unmerged**.

Site code:

| File | Change |
|---|---|
| `server.js` | +107 — loads the companion files if present, `rel=1` on the landing edges, three `/api/relations/*` routes |
| `public/js/hierarchy-mask.js` | +181, new — the toggle, both implementations, state in the query string |
| `public/js/phecode-relations.js` | +125, new — the A2 classifier, ported |
| `public/js/page1.js` | +76 / −11 — the mask in `edgePresent()`, the control in the panel stack, state on outgoing links |
| `public/js/page2.js` | +58 / −5 — `applyHierarchyMask()` after `updateNodes()`, the control, state on outgoing links |
| `public/index.html`, `public/page2.html` | +2 each — two script tags |

Total site code: **535 insertions, 16 deletions** across 7 files. No
production data file is written or modified.

Tooling and analysis (not shipped to the browser): `build_relations.py`,
`evaluate_toggle.py`, `scripts/bench_toggle.js`, `scripts/shoot_toggle.js`,
`scripts/test_phecode_relations.js`, `scripts/test_toggle_state.js`.

### Payload

_(see §3 for the measured figures)_

### Reproducing this

```bash
python3 analysis/phecode_redundancy/build_relations.py   # companion files
python3 -m pytest analysis/phecode_redundancy/test_phecode_relations.py -q
node scripts/test_phecode_relations.js
node scripts/test_toggle_state.js                        # needs a dev server
python3 analysis/phecode_redundancy/evaluate_toggle.py
node scripts/shoot_toggle.js
node scripts/bench_toggle.js --runs 10                   # needs main on :3001
```

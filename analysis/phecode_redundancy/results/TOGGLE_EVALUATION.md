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
| Which implementation? | **Client-side rule.** It is as fast, ships 5.7 kB gzipped once rather than 14.9 kB gzipped on every filter change, and needs no rebuild of any data file. |
| Which tier set? | **{T1, T2}.** T1 alone misses obvious sibling duplicates; T4 as defined over-masks. |
| Does it meet the speed guidelines? | Yes on all three, with room. The toggle is *faster* than every filter the pages already have. See §3. |
| Biggest caveat | In AFR, {T1,T2} leaves **37.9% of phenotypes with no edges at all**. The toggle needs to say so on screen, or the AFR network looks broken. |
| Why not T3? | It hides psoriasis–ankylosing spondylitis (9,728 shared SNPs) and psoriasis–rheumatoid arthritis (9,569). `phecode_exclude_range` means "do not use as controls for each other", and two diseases land in each other's range *because* they share biology. See §4.3. |

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

### What the toggle says about which tiers it is using

`/api/relations/status` reports the tiers the server can answer and any it
cannot, and the control renders a second line from them: *"masking T1, T2"*
on the current data, or *"masking T1, T2; T3 unavailable on this data"* on a
deploy without `phecode_definitions1.2.csv`. The point is that the control
never implies it checked a tier and found nothing when it could not check
at all. Nothing needed changing when the definitions file arrived; the line
updated itself.

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
| `pair_relations.parquet` | every related pair, all tiers | 31,773 |
| `edge_relations.parquet` | one row per landing edge | 67,605 |
| `node_phecodes.json` | Option 2, T1/T2 | 20,596 |
| `pair_relations_t34.json` | Option 2, the T3+T4 surcharge | 104,742 |
| | | |
| `/api/relations/lookup` (served, gzipped) | Option 2, T1/T2 | 5,683 |
| `/api/relations/lookup?tiers=all` (served, gzipped) | Option 2, all tiers | 39,311 |
| `/api/landing/edges` **+** `rel=1` (served, gzipped, **per request**) | Option 1 | +14,916 |

The whole relation universe is **8,527 related pairs** out of ~870,000
possible node pairs — 1,003 T1, 1,441 T2, 8,382 T3, 178 T4 (tiers overlap).
2,312 of the 54,790 landing edges carry a relation at all.

T3 dominates that count and is the only thing that makes Option 2's
surcharge non-trivial: without it the extra lookup is 2.3 kB, with it
104.7 kB. Since we are not recommending T3, Option 2 ships 20.6 kB and
nothing else.

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

`scripts/bench_toggle.js --runs 10`, raw numbers in `results/toggle_bench.json`.
Machine was otherwise idle. `main` ran on :3001 and the feature branch on
:3000, so before/after is two real servers rather than a feature flag.

**How latency is measured.** Fire the control, then stop the clock once
mutations inside the `<svg>` have quiesced for two animation frames. Every
operation below — toggle, ancestry switch, p-value switch — is timed to that
same finish line, because the guideline is a comparison between them and a
comparison is only worth reading if both ends are measured the same way.
Page 2's p-value sliders debounce for 200 ms before refetching, and that sits
inside their figures, because it sits inside what the user waits through.

### Toggle latency vs the existing filters

Median (p90) of 10 runs, milliseconds.

**Network view (page 1)**

| Config | Implementation | Toggle on | Toggle off | Ancestry switch | P-value switch |
|---|---|---|---|---|---|
| default: META, 1e-04, total | baseline | — | — | 600 (644) | 574 (594) |
| | precomputed | **356 (365)** | 362 | 652 (683) | 630 (657) |
| | client | **367 (391)** | 361 | 588 (632) | 543 (548) |
| densest: EUR, 1e-04, total | baseline | — | — | 632 (656) | 516 (547) |
| | precomputed | **395 (405)** | 299 | 616 (631) | 563 (605) |
| | client | **425 (441)** | 306 | 557 (584) | 523 (603) |

**Node view (page 2)**, EUR at 1e-04

| Phenotype | Implementation | Toggle on | Toggle off | P-value switch |
|---|---|---|---|---|
| Type 2 diabetes (deg 481) | baseline | — | — | 1046 (1125) |
| | precomputed | **279 (290)** | 274 | 1057 (1073) |
| | client | **277 (294)** | 274 | 1082 (1117) |
| Diabetes mellitus (deg 476) | baseline | — | — | 1063 (1107) |
| | precomputed | **277 (279)** | 279 | 1049 (1080) |
| | client | **280 (299)** | 274 | 1056 (1090) |
| Coronary atherosclerosis (deg 399) | baseline | — | — | 848 (863) |
| | precomputed | **169 (196)** | 190 | 848 (866) |
| | client | **167 (196)** | 189 | 851 (867) |
| ESRD (585.32) | baseline | — | — | 685 (692) |
| | precomputed | **97 (116)** | 98 | 696 (700) |
| | client | **96 (127)** | 101 | 692 (705) |

**The toggle is faster than every filter the pages already have, in every
configuration, on both implementations.** Worst case is 425 ms (client, page
1, densest) against 557 ms for an ancestry switch in the same view. On page
2 the margin is wider: 97–280 ms against 685–1,082 ms, because the toggle
re-renders from rows already in the browser while the p-value slider
refetches.

The two implementations are within noise of each other everywhere. On page 1
the client rule is 10–30 ms slower, which is the truncation rule running over
54,790 edges instead of reading a served integer; on page 2 they are
identical. Neither difference would be visible.

Toggling **off** is consistently a little cheaper than toggling on, and on
page 1's densest config markedly so (299 vs 395 ms) — restoring edges costs
less than removing them and recomputing degrees.

### Initial load and payload

Median (p90) of 10 runs; payload is what the browser actually transferred.

| Page | Build | Cold load | Warm load | Transferred | vs baseline | Requests |
|---|---|---|---|---|---|---|
| page 1 | baseline | 1432 (1643) | 1286 (1401) | 523,782 B | — | 6 |
| | precomputed | 1516 (1558) | 1336 (1479) | 538,563 B | **+2.82%** | 9 |
| | client | 1425 (1468) | 1288 (1367) | 535,032 B | **+2.15%** | 10 |
| page 2 | baseline | 2054 (2059) | 1043 (2052) | 219,478 B | — | 6 |
| | precomputed | 2060 (2065) | 2049 (2060) | 226,418 B | **+3.16%** | 10 |
| | client | 2064 (2072) | 2058 (2066) | 231,236 B | **+5.36%** | 10 |

**Payload is well inside the 10% guideline** on both options and both pages.
Note the ordering flips between pages: on page 1 the client rule is cheaper
(it fetches one 20.6 kB lookup instead of a 438 kB `rel=1` edge payload),
while on page 2 it is dearer (it fetches the whole node→phecode map where the
precomputed option fetches only the centre's own related pairs).

**The warm page-2 row needs explaining, and it is not a regression.** Warm
load reads 1,043 ms on baseline against ~2,050 ms on both feature builds,
which looks like a 1 s regression. It is an artefact of `networkidle0`. A
focused 20-run rerun measuring three signals:

| Build | networkidle0 | networkidle2 | DOMContentLoaded |
|---|---|---|---|
| baseline | 1041 (p90 1045) | 694 (709) | 53 (59) |
| precomputed | 2068 (2077) | 694 (716) | 39 (57) |
| client | 2066 (2073) | 695 (743) | 49 (63) |

`networkidle2` and `DOMContentLoaded` are **identical across all three**. The
toggle issues `/api/relations/status` and then, depending on the
implementation, a lookup or a pairs request — two serialized round trips.
Each resets `networkidle0`'s 500 ms idle timer, and on this page that pushes
detection into a second idle window. Nothing the user perceives changes.

If you want the artefact gone as well as the non-regression: fold the tier
list into the lookup response so the client makes one request instead of two,
or issue them in parallel. We have not done it, because it optimises a
measurement rather than the page.

### Memory

| Config | Implementation | Heap before toggle | Heap after |
|---|---|---|---|
| default (META) | precomputed | 8.80 MB | 8.78 MB |
| default (META) | client | 8.64 MB | 8.65 MB |
| densest (EUR) | precomputed | 30.80 MB | 17.63 MB |
| densest (EUR) | client | 25.19 MB | 17.55 MB |

`performance.memory` is not available on the baseline build's runs, so there
is no before/after comparison against `main` — only before/after toggling
within each feature build. On the default config the toggle costs nothing
measurable. On the densest config the heap is *lower* after toggling, which
is garbage collection timing rather than a real saving; these numbers are too
noisy to support any claim beyond "no leak or blow-up was observed".

### Errors

Zero page errors across every run of every configuration, on both
implementations and both pages.

### Against the acceptance guidelines

| Guideline | Result |
|---|---|
| Toggle latency no worse than the existing ancestry/threshold filters | **Met, with room.** Worst case 425 ms against 557 ms for the filter it is compared to. |
| No measurable regression in initial load | **Met.** Cold load is within noise on both pages; the warm page-2 gap is a `networkidle0` artefact and vanishes under two other signals. |
| Payload increase under 10% | **Met.** +2.15% to +5.36% depending on page and option. |

Neither option misses a guideline, so there is nothing to flag under B3.

---

## 4. Effectiveness (B4)

### 4.1 Correctness

**Unit tests, both languages, same cases.**

| Suite | Result |
|---|---|
| `analysis/phecode_redundancy/test_phecode_relations.py` | 17 passed, 0 skipped |
| `scripts/test_phecode_relations.js` | 16 passed, 0 skipped |

Nothing is skipped any more: the hand-verified T3 case is 585.32 against
587 (kidney replaced by transplant), which is T3 and nothing else, and it
runs in both languages — against the definitions file in Python and through
a stub lookup table in JS. The JS suite carries three extra cases that only
exist in the browser (a node with no phecode must come back
*unclassifiable* rather than *unrelated*; merged nodes; the tier-name →
bitmask helper); the Python suite carries four extra covering T3's
semantics, including that a code's own exclusion range contains itself and
so identity has to be guarded.

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
| AFR | T1 | 469 / 5,517 (8.50%) | 28.3% | 277 / 768 (36.1%) |
| AFR | T1+T2 | 638 / 5,517 (11.56%) | 38.0% | 291 / 768 (37.9%) |
| AFR | T1+T2+T4 | 651 / 5,517 (11.80%) | 38.1% | 293 / 768 (38.2%) |
| AFR | **T1+T2+T3+T4** | **1,050 / 5,517 (19.03%)** | **47.5%** | **318 / 768 (41.4%)** |
| EUR | T1 | 624 / 53,403 (1.17%) | 9.0% | 79 / 1,002 (7.9%) |
| EUR | T1+T2 | 1,103 / 53,403 (2.07%) | 12.4% | 83 / 1,002 (8.3%) |
| EUR | T1+T2+T4 | 1,129 / 53,403 (2.11%) | 12.4% | 83 / 1,002 (8.3%) |
| EUR | **T1+T2+T3+T4** | **2,172 / 53,403 (4.07%)** | **16.0%** | **85 / 1,002 (8.5%)** |
| META | T1 | 627 / 51,224 (1.22%) | 8.4% | 87 / 997 (8.7%) |
| META | T1+T2 | 1,108 / 51,224 (2.16%) | 11.9% | 94 / 997 (9.4%) |
| META | T1+T2+T4 | 1,136 / 51,224 (2.22%) | 11.9% | 94 / 997 (9.4%) |
| META | **T1+T2+T3+T4** | **2,241 / 51,224 (4.37%)** | **15.8%** | **99 / 997 (9.9%)** |

Adding T3 roughly doubles the masked edges in every ancestry and takes AFR
from 38% to 47.5% of masked weight.

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

**T3 masks clinically distinct pairs, and this is the decisive finding.**
The task asks about this specifically, because exclusion ranges can be
broad. They are broader than "broad": they are **block-wide**. Every phecode
in 580–590.99 carries that exact range, so T3 fires between any two codes in
a block regardless of how different they are. The 2,547 T3-only edges are in
`results/toggle_t3_only_edges.csv`; the heaviest are:

| Shared SNPs | Pair | Exclusion ranges |
|---|---|---|
| 17,175 | 172 Skin cancer — 173 Neoplasm of uncertain behavior of skin | `172-173.99` / `172-173.99` |
| 16,485 | 172.2 Other non-epithelial cancer of skin — 173 Neoplasm of uncertain behavior of skin | `172-173.99` / `172-173.99` |
| 15,052 | 172.1 Melanomas of skin — 173 Neoplasm of uncertain behavior of skin | `172-173.99` / `172-173.99` |
| **9,728** | **696.41 Psoriasis vulgaris — 715.2 Ankylosing spondylitis** | `690-697.99, 714-714.99` / `714-716.00, 696-696.99` |
| **9,704** | **696 Psoriasis and related disorders — 715.2 Ankylosing spondylitis** | as above |
| **9,569** | **696 Psoriasis and related disorders — 714.1 Rheumatoid arthritis** | as above |

The skin-neoplasm pairs are arguably fair game. The psoriasis ones are not.
Psoriasis and ankylosing spondylitis are distinct diseases with a
well-established shared genetic basis, and psoriasis–rheumatoid arthritis is
in the same category. T3 would hide both.

The reason is worth stating plainly, because it is structural rather than a
quirk of these three pairs. **`phecode_exclude_range` answers a different
question from the one the toggle asks.** It exists to say "do not use these
patients as controls for that phenotype" — and two diseases land in each
other's exclusion range precisely *because* they overlap clinically and
genetically. 715.2's range explicitly lists `696-696.99`. Using the column as
a redundancy filter therefore removes the pleiotropy the network exists to
show. It is not a broken rule being applied badly; it is a well-built rule
for another purpose.

We recommend against T3 on that basis, not on the coverage numbers.

### 4.4 Use case: ESRD

`results/screenshots/` — ESRD (585.32) in AFR and EUR, network view and node
view, toggle off and on, for each of the four tier sets. 32 PNGs plus
`counts.json`.

The on/off difference agrees with A3 exactly. ESRD's degree in the network
view reads:

| Ancestry | off | T1 | T1+T2 | T1+T2+T4 | T1+T2+T3+T4 |
|---|---|---|---|---|---|
| AFR | 86 | 84 | 80 | 80 | 69 |
| EUR | 142 | 140 | 134 | 134 | 129 |

which are the L0 / L1 / L2 / L3 rows of `esrd_sensitivity.csv`, to the unit.
The node view keeps all 150 of the centre's SNPs at every setting; the outer
ring goes 38 → 32 in AFR and 99 → 92 in EUR under {T1,T2}, and 38 → 22 / 99 →
87 under the full set.

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

T3 stays off for the reason in §4.3: the column it is built from marks pairs
that should not serve as each other's controls, which is close to the
opposite of marking pairs that are the same illness recorded twice. It is
also the most expensive tier to ship — it takes Option 2's lookup from
20.6 kB to 125 kB — though that would not be a reason to drop it on its own.

**Implementation: Option 2, the client-side rule.**

It ships 20.6 kB (5.7 kB gzipped) once, against 438 kB (14.9 kB gzipped)
added to *every* landing-edges response — and the landing edges are
refetched on each ancestry and p-value change. It needs no companion parquet
and no rebuild of anything, and it is not slower.

To be fair to Option 1: compressed, the difference is small, and the 10%
payload guideline is met either way (§3). Option 1's real disadvantage is
that it re-sends a static fact on every filter change, and its only real
advantage is that it can answer tiers the browser cannot derive — T3 and
T4 — and we are recommending neither.

If T4 is later adopted with a threshold, Option 2 absorbs it for 2.3 kB,
which does not change the conclusion. T3 is the one case where the choice
would be close: it takes Option 2's lookup to 125 kB (39.3 kB gzipped)
against Option 1's 14.9 kB gzipped per request, so Option 1 wins after about
three filter changes in a session. We are not recommending T3, so this does
not arise, but it is the condition under which the answer flips.

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

| Page | Precomputed | Client |
|---|---|---|
| page 1 | +14,781 B (+2.82%) | +11,250 B (+2.15%) |
| page 2 | +6,940 B (+3.16%) | +11,758 B (+5.36%) |

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

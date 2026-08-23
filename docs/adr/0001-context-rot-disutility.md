# ADR-0001: Context Rot as a Consumer-Side Disutility over the Solver Frontier

**Status:** Accepted — framing, functional form, and defaults ruled by Daniel, 2026-08-23
**Scope:** knapsack public surface (frontier contract) + consumer integration contract (agent-kernel)
**Cross-references:** agent-kernel ADR-0005 Am. II (the solver is a knapsack); ADR-0004 Am. I / A2 (per-model rot fitting); ADR-0002e (decision ledger, calibration corpus); ADR-0003 (rot report, refit pipeline); knapsack `docs/future-work.md` (R1–R4, I1)

---

## 1. Context and problem

LLMs degrade as the context window fills — a phenomenon the field now calls **context rot**. The degradation is nonlinear and empirically two-regime: a shallow near-linear decline up to some knee length, then a much steeper collapse toward an accuracy floor. Research anchors:

| source | finding |
|---|---|
| Chroma, *Context Rot* (Hong, Troynikov, Huber — Jul 2025) | all 18 tested frontier models degrade at every length increment, even on trivial retrieval/replication tasks; distractors and semantic ambiguity accelerate the decline; no safe plateau |
| NVIDIA RULER (Hsieh et al., arXiv 2404.06654, COLM 2024) | effective context is typically 50–65% of the claimed window; only half of evaluated models handle 32K on composite tasks; near-perfect vanilla NIAH coexists with severe composite degradation |
| Critical-threshold study (arXiv 2601.15300) | stable-to-shallow decay up to ~40% of window, then a cliff: −45.5 F1 over a ~10% band (~43% of max context for a 128K model), no recovery beyond |
| Adobe NoLiMa (Modarressi et al., arXiv 2502.05167, ICML 2025) | associative/multi-hop reasoning rots much faster than literal retrieval: 11 of 12 models below 50% of short-context baseline by 32K; GPT-4o 99.3% → 69.7% |
| Liu et al., *Lost in the Middle* (TACL 2024) | positional U-shape (evidence at the middle of the window is recalled worst) — an orthogonal axis, out of scope here (see §9) |

Rot is per-model, per-task-family, and monotone-worsening in total length. Every anchor agrees on the shallow-then-steep shape; none supports a plateau.

The deployed consumer (agent-kernel) solves a per-turn multiple-choice knapsack: groups = context items, options = render representations, weight = tokens, capacity Λ. This ADR answers one question: **where and how does rot enter that optimization?**

Three structural facts force the answer:

1. **A naive global multiplier is inert.** Scaling all profits by a constant preserves the argmax. Rot changes decisions only through coupling to *total rendered length*.
2. **Length-coupled rot is non-separable.** MCKP requires the objective to decompose per group plus one capacity constraint; rot as a function of total length violates that. Placing it inside the objective would break the problem class and force approximation inside the exact kernel.
3. **The solver already computes the answer's raw material and throws it away.** The exact DP's final value row is the complete Pareto frontier P\*(w) = best achievable profit at every weight budget w ≤ C. That row *is* the tradeoff surface rot needs to act on.

## 2. Governing principle

agent-kernel ADR-0004 Am. I, centerpiece: **the option space carries the policy; the solver carries the tradeoff.**

Rot is policy: per-model (0004/A2), refit from ledger evidence (0002e), versioned. The frontier is the tradeoff. Therefore:

> **Rot lives in the consumer; the solver exposes the frontier.**

Optimality semantics becomes two-layer and honest: **knapsack layer exact, rot layer calibrated.** The solver certifies P\*; the consumer certifies the operating point given ρ. No end-to-end "provably optimal against rot" claim is made or implied — the rot curve is empirical, and the architecture keeps that conditionality where it can be seen.

## 3. The frontier contract (knapsack side)

The solver gains one optional result surface:

- **`result.frontier`** — the Pareto frontier of the exact DP's final value row: the set of kinks (w, P\*(w)) at which the achievable profit strictly increases, emitted in increasing w, **including the low end down to w = 0**. Purge (w=0), single-item, and sparse layouts are first-class points, not afterthoughts.
- Contract invariants:
  - **Kinks only, with proof of sufficiency** (Proposition 2, §4): for monotone rot, no non-kink point can be optimal, so emitting kinks is lossless. The frontier is certified by the same DP that certifies the optimum — every point is exact, none sampled.
  - **Escape hatch:** a flag to emit the full value row (all w ≤ C, not just kinks) for non-monotone consumer utilities. The row is already computed and discarded today; exposure is an API decision, not new computation.
  - **Granularity note:** kinks are integer weights; the frontier is exact over integers, with no interpolation implied between kinks.
- **Reconstruction:** the frontier yields an operating point w\*, not a layout. The consumer re-solves with `capacity: w\*` — exact, deterministic, µs-scale — to obtain the choice vector. Open (ruled unresolved): whether the re-solve should prefer *smallest weight* among equal-value layouts (input-order tie-break does not guarantee it); v1 leaves tie-break as-is and documents it.

The solver remains integer-pure and rot-blind: no floats, no callbacks, no ρ validation API. This is deliberate — under the rejected framing B (rot callback into the solver), every ρ refit would become a solver-input revision, and spline validation (convexity checks, knot ordering) would have to live inside the kernel. Under A, a refit is a version bump in the consumer's parameter sets.

## 4. Consumer utility and the sufficiency propositions

Consumer-side objective, evaluated over the exposed frontier:

> **U(w) = ρ(w) · P\*(w) + H(C − w)**

- ρ: monotone non-increasing retention factor, ρ(0) = 1 (the rot model; §5)
- H: headroom price on unused capacity (§7.2; identically zero in v1)

**Proposition 1 (sufficiency).** For any utility that factors as f(P\*(w), w), the optimum over layouts equals the maximum over frontier points of U(w). The frontier is a sufficient statistic: compute once, obtain the exact rot-aware optimum for *any* monotone ρ, current or future — refits never require a re-solve to stay correct.

**Proposition 2 (kink sufficiency).** If ρ is monotone non-increasing and H is non-decreasing in slack (both true by construction), then between adjacent kinks the utility is maximized at the left kink. Proof sketch: between kinks P\* is constant while ρ can only fall and H-slack can only shrink with w; hence U is non-increasing on the interval. Corollary: exposing only kinks is lossless. *(Note: no convexity, no unimodality is assumed or needed — the scan is exhaustive over kinks; U(w) over an integer frontier is generally sawtooth, and correctness never leans on smoothness.)*

The scan itself is the **equimarginal stop rule**: keep extending context while the marginal profit density of the next frontier segment exceeds the marginal rot tax −ρ′·(local value); the operating point is where they cross. This is the proactive twin of agent-kernel ADR-0005 v1.1's budget-relief rule (drop worst utility-per-token): same currency, applied before the knee instead of after it.

**What P\* cannot see (stated honestly):** sufficiency holds only for utilities that depend on the layout through (total profit, total weight). Positional rot (lost-in-the-middle), content-dependent rot, and cache invalidation costs do not factor this way (§7.3, §9).

## 5. Functional form: monotone PWL spline, concave in the operating region

The rot curve enters as a **monotone non-increasing piecewise-linear retention spline** on [0, C]:

- knots 0 = w₀ < w₁ < … < w_m, values ρ(w₀) = 1 ≥ ρ(w₁) ≥ … ≥ ρ(w_m) > 0;
- slopes non-increasing in algebraic value (−s₁ then −s₂, with s₁ ≤ s₂): **concave ρ = convex loss g = 1 − ρ** — the shallow-then-steep empirical shape;
- **m is a fitting resolution, not a commitment**: m = 2 (a hinge) is the minimal member; knots are added by refit as the calibration corpus grows, with no API change on either side of the boundary.

Contract vs discipline (explicit, to prevent future "fixes"): **the scan requires only monotonicity; convexity/concavity is never load-bearing for correctness.** Curvature earns its keep as parsimony and legibility: low-parameter fits, well-posed interior operating points (marginal rot cost rising against declining marginal frontier density), and an operational reading of the knee knot — **t\* is the model's effective context length, fitted from our own ledger rather than imported from a benchmark.**

Fit discipline: convex regression with ordered slopes, domain clamped to the operating region (before the accuracy floor flattens the curve — a concave tail must not leak into the fit), versioned parameter sets, prior-divergence guards per ADR-0003. Fitted **per LLM model** (0004/A2); pooled fits only as flagged fallback priors.

Terminology is pinned in §10 to prevent retention-space/loss-space sign confusion — this thread's own history demonstrates the hazard (a "convex non-increasing ρ" is the mirror of a "convex loss" and models front-loaded damage, the opposite of the evidence).

**Rejected:** smooth functional forms (exponential etc.) in v1 — PWL keeps fitting legible, knots quotable, and the scan trivially exact over integers; and the **hard haircut** default (halve the capacity, no rot term) — it discards the healthy 40–60% band, offers no graduated choice, and is the accumulator's blunt instrument.

## 6. Defaults: rot-default-v1

Callers who never manage per-model fits still get a conservative, literature-derived default hinge, normalized to window fraction x = w/C:

| parameter | value | anchor |
|---|---|---|
| knee t\* | 0.40·C | threshold study knee ≈43%, cliff over a ~10% band; RULER effective length 50–65% |
| ρ(t\*) | 0.95 | mid-tier RULER composites −3 to −7 points by mid-window; Chroma: nonzero loss at every increment, so s₁ = 0 is not defensible |
| ρ(C) | 0.50 | threshold study −45.5 F1 past the knee, no recovery; NoLiMa 11/12 models below half by 32K |
| implied slopes | s₁ = 0.125, s₂ = 0.75 per window-fraction (s₂/s₁ = 6) | |

Read aloud: *expect to lose 5% of context value by the knee, and half of it by a full window.* **Asymmetric-loss principle:** underestimating rot parks the operating point past a cliff (first-order loss); overestimating it merely shortens context slightly (second-order near the flat optimum). The default therefore calibrates against mid-tier composite benchmarks (agent-like: distractor-rich, multi-source), not best-case NIAH retrieval.

**Where defaults live:** consumer-side, in agent-kernel's versioned parameter sets — the exact slot 0004/A2 created (per-model fits; default = pooled fallback prior). One entry: three numbers, overridable per model. As 0002e ledger + 0003 rot report accumulate, `rot-default-v1` demotes to bootstrap prior; version pins keep old ledgers recomputable. The knapsack repo ships no ρ, no model zoo, and no benchmark-derived numbers in code.

## 7. Decision analysis: the forces your questions exposed

### 7.1 Negative-value items early in the render

Eviction decomposes into (a) the item's own |pᵢ| (already in profits; purge floor excludes them from P\* automatically), (b) rot relief ≈ −ρ′ · (value of what remains) (computed exactly by the scan), and (c) cache invalidation of the suffix (cross-turn state; approximated per-option today via the backward-consistent option surface, graded by ledger divergence classification).

Below the knee, s₁ is shallow, relief is small, and cache coherence rationally wins — the deadwood stays for good reason. Beyond the knee, s₂ is steep and almost any re-prefill is worth paying. **Same item, opposite correct decision; the rot slope at the operating point is the switch.**

### 7.2 Headroom (future compaction opportunity)

Retention option value (keep the item, keep the compaction option alive) is per-item and belongs in profits — it usually argues for *fuller* renders now (better distillate source). The truly length-coupled force is **headroom**: tomorrow's turns append irreversible content, and sitting at C today forces cliff-regime cuts under pressure tomorrow (untrusted fresh summaries, emergency purges of standing-value items). H(C − w) prices this; v1 sets H = 0 and names it as the knob for the cross-turn approximation. Single-point solves make headroom structurally invisible; the frontier makes it choosable.

### 7.3 Cache coupling — the one-bit surprise

Cache validity is prefix-structured: process groups in render order with DP state (w, diverged?), charging diverged-suffix weights at re-prefill price — **one extra boolean of state, integer arithmetic throughout, certificate intact**. The coupling ADR-0005 flagged as violating classical independence costs one bit to absorb exactly. Deferred as named future work **F2: cache-prefix-augmented DP** (build-when: ledger shows per-option cache approximation mispricing evictions), with the frontier contract then exposing the cache-adjusted P̃\*(w) so both layers keep talking about the same object.

## 8. Decision

**Accepted:** framing A — consumer-side rot over an exposed, certified solver frontier.

| decision | ruling |
|---|---|
| Architecture | A: frontier in the solver, rot in the consumer. B (solver-side rot callback) rejected: policy leaks into the kernel, certificate becomes conditional on an unverifiable empirical curve, every refit a solver-input revision. C (rot priced inside the solve) rejected in principle: non-separable, forces approximation inside the exact kernel. D (status-quo density relief only) rejected: unobservable, not optimal, already flagged by ADR-0005. |
| Functional form | monotone non-increasing PWL retention spline; concave ρ (convex loss) in the operating region as the *recommended* fit; m = 2 hinge is the minimal member; curvature is fitting discipline, never load-bearing for correctness |
| Defaults | `rot-default-v1`: t\* = 0.40·C, ρ(t\*) = 0.95, ρ(C) = 0.50 (s₁ = 0.125, s₂ = 0.75) — conservative by the asymmetric-loss principle, consumer-side, versioned, overridable |
| Scope boundary | length-coupled rot only; positional and content-dependent rot out of scope (§9) |
| Terminology | retention-space vs loss-space pinned (§10) |

## 9. Consequences and future work

**Immediate:** `result.frontier` (kinks, low-w coverage, full-row escape hatch) is the knapsack implementation task — a change of result surface only, no algorithm change; default hinge + scan + re-solve reconstruction land consumer-side in agent-kernel's parameter sets; rot observability per 0004/A2 gives the instrument that grades the model.

**The honest boundary of this ADR:** P\*(w) cannot see *where* tokens sit or *what* they cost to keep cached. Three exits, each named and triggered by evidence, not speculatively built:

- **R2 — cache-prefix-augmented DP** (§7.3): one state bit absorbs suffix re-pricing exactly; trigger = ledger divergence showing the per-option cache approximation misprices evictions. Exposed frontier becomes cache-adjusted P̃\*(w).
- **R3 — per-zone frontiers** for positional rot (lost-in-the-middle): requires a different object (frontier over zone-vectors), a genuinely different animal; trigger = positional rot observability from the ledger.
- **R4 — cross-turn DP** as the named rejected-general frame: state = content inventory, decisions = renders/transforms, transitions = turn growth. Transition dynamics unestimable today; ruled mechanisms (hysteresis, transaction costs, turnover caps) are its pragmatic stand-ins. The ADR family treats single-turn frontier + consumer ρ/H as the composable myopic approximation — and says so, rather than pretending to solve it.

**Risks logged:** frontier emission at every solve vs on-demand (cost is trivial — the row exists — but surface area grows); kink density at pathological shapes (cap + pointer-to-full-row); ρ misfit direction asymmetry (§6 principle governs); mimetic drift if the default never gets refit (ledger observability is the antidote); two-layer honesty requires consumers to state ρ version alongside any optimality claim.

## 10. Terminology pin

- **Retention space** (ρ-space): ρ(w) ∈ (0, 1], ρ(0) = 1, non-increasing. Slopes negative or zero. *Concave ρ = shallow-then-steep decay = convex loss.* **Loss space** (g-space): g(w) = 1 − ρ(w), non-decreasing, g(0) = 0. *Convex g ⇔ concave ρ.* The two spaces carry identical information with mirrored curvature adjectives — the hazard is real; this ADR writes retention space with explicit numeric slopes (−s₁, −s₂, s₁ ≤ s₂) to eliminate ambiguity.
- **Knee** t\*: the knot where slope steepens. **Operating point** w\*: the frontier point the consumer's scan selects. **Frontier** P\*(w): the DP's final value row, kinks only by default.
- The solver is **exact, not greedy**: greedy appears only inside the LP bound's density walk (certified-integral fast path; exact DP decides otherwise — `dpRequired` flag). The consumer's relief rule (drop-worst-density, ADR-0005 v1.1) is a separate, ruled heuristic in agent-kernel, not this solver's algorithm. No conflation.

## 11. References

1. Hong, Troynikov, Huber. *Context Rot: How Increasing Input Tokens Impacts LLM Performance.* Chroma Research, Jul 2025.
2. Hsieh et al. *RULER: What's the Real Context Size of Your Long-Context Language Models?* arXiv:2404.06654, COLM (Status F) 2024.
3. *Critical-threshold study.* arXiv:2601.15300 (2026) — knee ~43%, −45. F1 over ~10% band, no recovery.
4. Modarressi et al. *NoLiMa: Long-Context Evaluation Beyond Literal Matching.* arXiv:2502.05167, ICML 2025.
5. Liu et al. *Lost in the Middle: How Language Models Use Long Contexts.* TACL 2024.
6. agent-kernel ADR-0005 Amendment II (2026-08-21) — the solver is a per-turn MCKP; coupled costs and cross-turn linkage flagged.
7. agent-kernel ADR-0004 Amendment I (2026-08-21) — per-model rot fitting (A2); option-space-carries-policy centerpiece.
8. agent-kernel ADR-0002e (2026-08-21) — decision ledger and calibration corpus.
9. agent-kernel ADR-0003 (2026-08-21) — analysis/tuning layer; rot report; refit pipeline with prior-divergence guards.

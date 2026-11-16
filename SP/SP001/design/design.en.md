# SP001 Capability Baseline, Core Boundaries and Release Scope — Formal Design

| Item | Value |
| --- | --- |
| Requirements | SP001 (4: capability-baseline / evaluation-suite / core-boundaries / release-scope) |
| Version | v1 |
| Status | **draft — pending user approval** |
| Updated | 2026-11-16 |
| Execution basis | This file. `design.zh.md` is an equivalent Chinese version with identical ACs and decisions |
| Material sources | USER_CONFIRMED (user decisions of 2026-11-16 + `AGENTS.md` + `docs/iteration-plan.md` r3) │ MODEL_PROPOSED (everything in this document not marked as user-confirmed) │ OPEN (see §6) |

> **Structural note (MODEL_PROPOSED)**: SP001's four requirements interlock (baseline defines "the level" → boundaries decide feasibility → evaluation decides proof → release scope decides delivery). Splitting them into four separate designs would create heavy duplication and contradictions. This iteration therefore uses **one iteration-level design plus four requirement documents**, each linking to its section here. This is the first SP actually started in this repo, so this layout sets the precedent for later iterations; it can be reverted to "one `design/` per slug" before approval if you prefer.

---

## 1. Background and Goals

### 1.1 Problem statement

You require the new repo's TUI to "reach the TUI level of `D:\extra_project\buding-worker-space`", but that repo is **not open source** and its code must not be used directly. Three questions must be answered before any implementation:

1. **What is "the level"?** An adjective cannot be accepted. The reference product is 600k lines / 2,360 files; using "the same amount" as the bar is neither measurable nor schedulable.
2. **Is it reachable?** If part of the reference "level" is non-transferable (e.g. a self-built terminal rendering engine), copying its shape both violates the source boundary and is infeasible.
3. **How do we prove it?** "The feature menu has 92 commands" is not evidence of effectiveness.

### 1.2 What this iteration delivers

A **versioned capability manifest** (breaking "the level" into 85 checkable items), a set of **responsibility boundaries and invariants** (deciding which capabilities are reachable within 21 iterations), an **evaluation-suite specification** (deciding how proof is produced), and a **release-scope definition** (deciding how it ships). All specification, no code.

### 1.3 Goals

- G1: Turn "reach the reference Agent's TUI level" into an acceptance-checkable CAP manifest covering layers L1–L4, without dropping any capability the user has confirmed as mandatory.
- G2: Define boundaries and invariants for Core / Provider / Tools / Storage / Host so that the TUI, Desktop and VS Code ends can share one Core without any end becoming a prerequisite for the others.
- G3: Define an automatically assertable evaluation-suite specification with blind tests and budget caps, so later iterations can genuinely measure effect.
- G4: Define release shape, platform matrix, runtime conditions and open decisions, surfacing user decisions early instead of letting later iterations each assume.
- G5: Leave a source ledger proving this repo copied no closed-source code.

### 1.4 Non-Goals

- No product code; no change to existing `src/tui` runtime behaviour.
- Do not run the reference Agent; do not collect its success rate, latency or cost. **No reference-product effect baseline exists this iteration.**
- Do not select the concrete terminal UI framework package or version (SP002 decides; this iteration only fixes the acceptance method).
- Do not define API fields, event schemas, storage schemas or permission-rule syntax.
- Do not introduce a plugin framework, microservices or a resident gateway process.
- No Git commit, merge, push, publish or remote configuration.

### 1.5 Anti-Goals (ways this design refuses to look finished)

- A1: Command counts, line counts and menu-entry counts are not acceptance evidence.
- A2: "All 85 manifest items ticked" does not mean the reference level is reached — the manifest proves existence only; effect comes from the evaluation suite.
- A3: mock/fixture results never stand in for live Provider or real installation evidence.
- A4: A missing reference baseline never justifies lowering thresholds or deleting tasks — record UNVERIFIED with recovery conditions instead.
- A5: Old-repo code is never "laundered" into a new implementation by renaming or file-by-file rewriting.

### 1.6 Constraints

| Constraint | Source |
| --- | --- |
| Node.js >= 22.18 + TypeScript; **Bun forbidden** | `AGENTS.md` + your 2026-11-16 addition |
| Core depends on no UI/terminal framework; a terminal UI framework is allowed only in the TUI rendering layer, and only if MIT | your 2026-11-16 decision |
| Sole user-data root `~/.budingx` (resolved via `os.homedir()`); reading/writing/falling back to/migrating `~/.claude` is forbidden | `AGENTS.md` |
| Old repo is read-only; no copying of source, prompts, internal SDK types, global state, bundles, config or history | `AGENTS.md` + [Independent development boundary](../../../docs/independent-development.md) |
| Single repo, modular: product modules live under `src/`, each module builds and packages independently | `AGENTS.md` |
| Main branch `master`; no branch, commit, push or publish without explicit authorisation | `AGENTS.md` |

---

## 2. Current State

### 2.1 Existing files and code (verified)

| Path | Fact |
| --- | --- |
| `src/tui/src/cli.ts` | 152 lines. readline line-oriented input; 6 slash commands (`/help /config /model /endpoint /clear /exit`); Ctrl+C cancels; session in memory only |
| `src/tui/src/provider.ts` | 121 lines. OpenAI-compatible `POST {baseUrl}/chat/completions` SSE streaming; explicitly rejects tool_calls; timeout via `AbortSignal.timeout` + `AbortSignal.any` |
| `src/tui/src/config.ts` | 56 lines. Config from CLI args + `BUDINGX_*` env vars; base URL forced to HTTPS (loopback excepted), rejecting credentials/query/fragment |
| `src/tui/test/{cli,runtime}.test.mjs` | Node test runner; 127 + 127 lines |
| `src/tui/package.json` | Name `budingx`, version 0.1.1, MIT, `bin: budingx → dist/cli.js`, `engines.node >= 22.18.0`, **no runtime third-party dependencies** |
| Root `package.json` | Private maintenance repo; real scripts `build` / `start` / `test:tui` / `test:release` / `test` / `publish` / `version:prepare` / `release:sync` |
| `docs/iteration-plan.md` | r3, 21-iteration roadmap; SP001 defined as "capability inventory, baseline and core boundaries" |
| `docs/agent-capability-matrix.md` | r2, capability and acceptance matrix (MODEL_PROPOSED) |
| `docs/architecture.md` | Logical boundary draft (DRAFT; not yet mapped to directories or invariants) |
| `SP/` | Only `README.md` and `templates/`; **no actual SP directory existed before this one** |

### 2.2 Reference baseline (read-only survey results, MODEL_PROPOSED)

A read-only survey of `D:\extra_project\buding-worker-space` (`budingx` 0.5.0, private, not open source). No source content read, no `.env` read, nothing run, nothing written. Summary of facts:

| Dimension | Fact |
| --- | --- |
| Scale | `src/` 2,360 TS/TSX files / 602,826 lines; `adapters/` ≈19k lines; `desktop/` ≈119k lines |
| TUI interactive layer | components + ink + screens + hooks + commands + keybindings + vim ≈ **871 files / 166k lines** |
| Tool layer | 58 tool directories / 227 files / 54,630 lines |
| Command surface | 92 command directories + 20 standalone command files |
| Rendering | React 19 + Ink 6, but with a **self-built rendering engine of ≈20k lines** (reconciler, layout, ANSI parsing, terminal event layer, alternate screen, selection and search highlight) |
| Permissions | 7 permission modes + rule parsing / filesystem rules / command rules / shadowed-rule detection / denial tracking + sandbox adapter |
| Hooks | 28 lifecycle events × 4 handler kinds (command / agent / prompt / HTTP) + SSRF guard |
| Context | compaction family (manual / auto / micro / session-memory) + cost and token tracking |
| Persistence | JSONL session storage, branching/fork/rewind, file-history snapshots, 11 data migrations, backups |
| Headless output | `--print` with `text` / `json` / `stream-json`; `--input-format`, `--json-schema`, `--include-partial-messages`, `--include-hook-events`, `--replay-user-messages`, `--max-turns`, `--max-budget-usd`, `--no-session-persistence`, `--resume` / `--fork-session` / `--from-pr`; exit codes 0/1 + exit-reason enum |
| Multiple ends | local API/WS server (175 files / 63k lines / 28 API groups), stdio host, Electron desktop, VS Code extension, IM sidecar (5 channels) |
| User-data root | `~/.claude` (overridable via `CLAUDE_CONFIG_DIR`) — **conflicts with this repo's rule; the new repo must use `~/.budingx`** |

### 2.3 Gap (real conclusion)

The new repo's `src/tui` is 4 source files / 329 lines. It is roughly 166k lines away from the baseline's L1 interactive layer and has not started L2/L3/L4. Only two things align today: the Node version constraint and the user-data-root isolation rule (and here the new repo is *stricter*, since the baseline uses `~/.claude` and the new repo uses `~/.budingx`).

**Therefore "reach the same level" is not something SP001 can deliver — it is the target of SP002–SP021. SP001's job is to turn that sentence into a per-iteration checklist and boundaries.**

### 2.4 Assumptions (to be re-checked in later iterations)

- AS-1: Baseline capabilities can be implemented equivalently without an equivalent shape. Basis: the baseline built its own renderer precisely to fill gaps in an off-the-shelf rendering library, so switching to an upstream MIT library with equivalent capability should cost far less. **Risk**: the upstream library may lack capability — SP002's selection gate must prove equivalence, not assume it.
- AS-2: 21 iterations (SP001–SP021) suffice for the 53 mandatory capabilities. **Not scheduling-verified**; see §6 R1.
- AS-3: Manifest granularity (user-visible capability level) is a suitable acceptance unit. Finer granularity degenerates into an implementation list.

---

## 3. Solution

### 3.1 Capability baseline (capability-baseline)

**Artifact**: [Capability manifest v1](../capability-baseline/capability-manifest.md), 85 items, stable CAP IDs.

**Definitions** (written into the manifest; no later iteration may rewrite them unilaterally):

1. Coverage = number of mandatory items with acceptance PASS ÷ **53** (total mandatory). `Suggested` / `Optional` / `Out of scope` stay out of the denominator but remain on the gap list.
2. The manifest proves only existence; quality comes from the [evaluation suite](#33-evaluation-suite-evaluation-suite).
3. Count-style metrics (92 commands, 58 tools, 166k lines) are background facts, **never acceptance evidence**.

**Layers and ownership** (every CAP item names its owning SP): L1 interaction → SP002/003/006; L2 tools → SP003/004/006/013/014/015/016/019; L3 agent → SP002/003/004/005/006/007; L4 platform → SP005/008/009/010/011/013/016/017/018/019/020/021.

**Change rules**: IDs are never reused and never re-meaninged; a semantic change adds an ID and marks the old one `DEPRECATED`; ownership changes go through the iteration summary change log; sealed items cannot be modified.

**Coverage of the user-confirmed scope** (AC-06): teams (CAP-L2-11 / L4-17), browser (CAP-L2-15), Computer Use (CAP-L2-16), remote (CAP-L2-18 / L4-11 / L4-12), IM (CAP-L4-15) and scheduled tasks (CAP-L2-17 / L4-16) are all `Mandatory`, none demoted to a candidate.

### 3.2 Core boundaries (core-boundaries)

**Directory blueprint** (proposed, not current):

```text
src/
  core/        # agent loop, context budget, tool dispatch, terminal states — zero UI deps
  provider/    # public model protocol adapters; vendor-private types never leave this layer
  tools/       # tool implementations, input validation, output caps; invoked via approval interface
  storage/     # session/config/credential stores; sole data root ~/.budingx
  host/        # host contract (in-process / stdio / WS) reused by TUI, Desktop, VS Code
  tui/         # terminal host and rendering layer; the only place a terminal UI framework may appear
  # later iterations — names registered now, no empty projects created:
  desktop/     # SP008 desktop workbench
  vscode/      # SP009 VS Code extension
  gateway/     # SP016 remote gateway
  adapters/    # SP017/SP018 IM channels
  scheduler/   # SP019 scheduled tasks
  mobile/      # future mobile access (native apps are out of the 21-iteration scope)
```

**Naming ownership** (outcome of T-003 step 1, 2026-11-16): module names are reconciled with the earlier suggestion in [Repository layout](../../../docs/repository-layout.md) — the earlier `providers/` is normalised to `provider/`, matching this repo's existing singular `src/tui/`; the earlier `protocol/` is normalised to `host/` (this repo's "host and transport protocol contract" layer), with the remote gateway kept separate as `gateway/` (SP016). Both normalisations exist so that one responsibility never ends up under two directory names.

**Invariants** — every later implementation must make each one checkable:

| # | Invariant | How it gets checked (in later iterations) |
| --- | --- | --- |
| I-01 | `core/` must not import any UI / terminal / browser library | dependency allowlist + lint rule |
| I-02 | Vendor-private request/response types must not appear in `core/` public interfaces | type review |
| I-03 | User data only via the `~/.budingx` root resolved by `os.homedir()`; no read/write/fallback of `~/.claude` | path review + isolated temp-home test |
| I-04 | One writer per session at a time; a second writer is explicitly rejected, never silently overwritten | concurrency test |
| I-05 | Credentials are not written to ordinary shared JSON and never logged (redacted) | on-disk check + log review |
| I-06 | Cancellation propagates from UI to provider, tools, child processes and subagents; a rejected prompt leaves the session usable | cancellation-path test |
| I-07 | Tool output has a cap; overflow is truncated and marked, never silently dropped | output-cap test |
| I-08 | Repo instructions, web pages, tool output, skills and model returns are untrusted input and never raise authorisation | prompt-injection negative cases |
| I-09 | Node-only: no Bun; `engines.node >= 22.18` | dependency-tree check |
| I-10 | The TUI is not a runtime prerequisite for other ends; each end runs standalone and reuses the same Core contract | three-end standalone install smoke |
| I-11 | In-process state is not shared across ends as an implicit global; cross-end sharing goes through explicit storage contracts only | contract review |
| I-12 | The old repo's agent loop, prompts, SDK types, global state and bundles never enter this repo | source review + ledger |

**Contract directions** (responsibility only, no fields):

| Contract | Defined by | Consumed by | Failure ownership |
| --- | --- | --- | --- |
| Provider adapter | `provider/` | `core/` | provider normalises upstream errors into diagnosable states; core never sees vendor semantics |
| Tool execution | `tools/` (supplies the `Tool` contract) | `core/` | tools own validation and output caps; core owns dispatch and terminal state |
| Approval / permission | policy in `tools/` + ask interface in `core/` | host implements the interaction | host owns presentation; core owns continuing after a refusal |
| Storage | `storage/` | `core/` + hosts | storage owns atomic write / backup / migration and rejects concurrent writers |
| Host | `host/` | `tui` / desktop / VS Code | host owns lifecycle and transport; core is unaware of host type |

**Minimum end-agnostic and cancellable requirements** (SP002–SP007 must preserve these): core must not read/write the terminal, must not call `process.exit` directly, must not depend on host globals; every long operation accepts a cancellation signal.

**Reuse of this repo's existing assets** (AC-12): `src/tui/src/config.ts` config loading and base-URL validation, `src/tui/src/provider.ts` SSE framing and error normalisation, and `src/tui/src/cli.ts` terminal-safe output (`stripVTControlCharacters` plus control-character filtering) can serve as the starting point for `provider/` and `core/`; SP002 performs one explicit migration rather than starting over.

### 3.3 Evaluation suite (evaluation-suite)

**Task schema** (mandatory per task): `id`, category, language, repository size, initial snapshot (version + content hash), instruction, automatically assertable expected result, allowed modification scope, external dependencies, budget (time / tokens / cost / turns), failure category, blind flag.

**Quotas** (inherited from roadmap r3): ≥30 basic coding tasks, ≥30 advanced/cross-end combination tasks, ≥20 blind tasks (≥10 basic, ≥10 advanced). Protection cases (permissions, isolation, cancellation, security) are listed separately and **do not count toward the blind denominator**.

**Categories**: locate-and-explain, cross-file repair, feature development, test-failure repair, refactoring, long context, cancel-and-resume, permission and adversarial input, Windows paths and oversized repositories, non-English content, advanced combinations (teams / browser / desktop / remote / IM / scheduled).

**Scoring**: test pass, diff correctness and goal attainment. **Never the model's self-reported "done".**

**Failure categories**: wrong localisation, wrong modification, authorisation violation, ineffective loop, budget exceeded, hallucinated success (claims completion while assertions fail).

**Budget caps** (initially fixed; effective from SP002, adjustable once with a recorded version after observing distributions):

| Category | Wall-clock cap per task | Model-turn cap | Cost cap |
| --- | --- | --- | --- |
| Basic coding | 10 minutes | 30 turns | priced per the user's own credentials, plus a global daily cap |
| Advanced combination | 20 minutes | 50 turns | same |
| Protection / negative | 5 minutes | 10 turns | same |

**Blind-test discipline**: blind tasks must not be used for repeated tuning before sealing; after analysing failures they enter the next version's regression set, and a **new independent blind set is reserved** at the same time.

**Statistical discipline**: four mandatory reports — number of independent tasks, correlation across repeated runs, per-group results, and variability intervals. When the result interval straddles the 5-percentage-point threshold, the verdict is "**insufficient evidence**"; expand the sample or keep running. Point estimates alone are forbidden.

**Reference-product baseline gap** (the most important fact of this iteration):

- You chose a static survey without running the reference Agent ⇒ **no reference success-rate baseline exists**.
- Therefore the "≤ 5 percentage-point drop against the reference on the comparable set" gate is **not computable this iteration**.
- What this iteration can deliver: the evaluation-suite specification, task inventory, assertion semantics, budgets and blind discipline, plus the new repo's own repeatable measurement capability (the runner arrives with SP002+ code).
- Recovery condition: separate authorisation to run the reference Agent + usable credentials + the reference version and entry point pinned (currently `budingx` 0.5.0; the exact commit was not collected).
- Until then, the words "aligned with the reference Agent" or "reached the same effect level" are **forbidden** in documents, reports and commit messages.

### 3.4 Release scope (release-scope)

| Item | Conclusion | Status |
| --- | --- | --- |
| Artifact shape | npm-published TUI (primary), desktop app (SP008), VS Code extension (SP009) | MODEL_PROPOSED |
| npm package name | Published `budingx` (0.1.1) is a bootstrap preview. The full Agent artifact **defaults to a new package name published in parallel**, pending your decision | **OPEN-01** |
| Supported platforms | **Verified: Windows** (the existing release pipeline only dry-ran on Windows/Linux; the product itself is not certified on macOS/Linux). Planned: verified one by one after SP011 packaging engineering | **OPEN-02** |
| Runtime conditions | Node >= 22.18; Bun forbidden; terminals need TTY, and capability detection plus fallback paths must be explicit | USER_CONFIRMED |
| Model access | Credentials injected via environment variables or the system keychain — never in the package, logs, or ordinary shared JSON | MODEL_PROPOSED |
| User data | Sole root `~/.budingx`; never read `~/.claude`; no user data shipped inside the package | USER_CONFIRMED |
| Third-party licences | Every added dependency (including the terminal UI framework) registered in `THIRD-PARTY-NOTICES.md`; must be MIT or an equivalent redistributable licence | USER_CONFIRMED |
| Release authorisation | Each release needs separate authorisation; without it, no publish, no version bump, no tag push | USER_CONFIRMED |
| Receipt requirements | Every release needs a registry receipt + provenance + a clean-environment isolated install smoke | USER_CONFIRMED |
| Artifact independence | Runnable after install without the source tree, Bun or dev dependencies | MODEL_PROPOSED |

**Release cadence**: SP006 establishes the npm dry-run skeleton (no upload) → SP011 completes the "one `npm run publish`" gate and artifact identity → SP020 re-verifies the full-capability artifact → SP021 performs the full-substitution acceptance.

**Four items requiring your decision** (details in the [release-scope requirements](../release-scope/requirements.md) open questions): package-name strategy, platform expansion, publishing account and signing ownership, desktop/extension distribution channel.

### 3.5 Source ledger and handling decisions

| Source | Location | Licence / access | Handling decision this iteration |
| --- | --- | --- | --- |
| Reference Agent (baseline) | `D:\extra_project\buding-worker-space`, `budingx` 0.5.0 | Private, **not open source** | Read-only observation of user-visible behaviour and directory-scale statistics only. **No copying** of source, prompts, internal SDK types, global state, bundles, config or history; **no file-by-file rewriting** passed off as independent; `.env` never read. The manifest's "baseline evidence" column records only the existence of capabilities and scale statistics |
| This repo's existing TUI | `src/tui` (`budingx` 0.1.1, MIT) | Own | Directly reuse config loading, SSE framing and terminal-safe output as the starting point for Provider/Core contracts |
| Public protocols | OpenAI-compatible Chat Completions, Anthropic Messages, MCP | Public protocols, each under its own terms | Used as interoperability contract references; no vendor-private types introduced |
| Terminal UI framework | Selection pending in SP002 | Must be confirmed MIT | Register in `THIRD-PARTY-NOTICES.md` after selection; must not enter dependencies before confirmation |
| This repo's skills and docs | `skills/`, `docs/` | MIT | Reuse the existing SDD process and documentation conventions |

Engineering isolation is not a legal clean-room certification (see [Independent development and reuse boundary](../../../docs/independent-development.md)).

---

## 4. Change Set

### 4.1 New this iteration (proposed)

```text
SP/SP001/requirements-summary.md                       # iteration summary (index)
SP/SP001/design/design.zh.md                           # Chinese equivalent
SP/SP001/design/design.en.md                           # this file (execution basis)
SP/SP001/design/plan.zh.md                             # implementation plan
SP/SP001/design/plan.en.md                             # English equivalent
SP/SP001/capability-baseline/requirements.md
SP/SP001/capability-baseline/STATUS.md
SP/SP001/capability-baseline/capability-manifest.md    # capability manifest v1 (core artifact)
SP/SP001/evaluation-suite/requirements.md
SP/SP001/evaluation-suite/STATUS.md
SP/SP001/core-boundaries/requirements.md
SP/SP001/core-boundaries/STATUS.md
SP/SP001/release-scope/requirements.md
SP/SP001/release-scope/STATUS.md
scripts/spec/check-spec.mjs                           # proposed new: self-consistency checks for the manifest and task inventory
scripts/spec/check-spec.test.mjs                      # proposed new: self-test of the checker
```

### 4.2 Modified this iteration (proposed)

| File | Change | Reason |
| --- | --- | --- |
| `package.json` | Add `spec:check` / `spec:test`, and fold `spec:test` into `test` | Make specification self-consistency a gate |
| `docs/index.md` | Add an SP001 entry link | Documentation navigation reachability |
| `docs/iteration-plan.md` | Mark SP001 as started (specification iteration) under "entry point for follow-up agents" | Roadmap status sync |
| `docs/current-status.md` | Note SP001's specification iteration in progress, no implementation started | Status docs must not claim delivery |
| `docs/agent-capability-matrix.md` | Link to capability manifest v1 | Align matrix with manifest |
| `docs/repository-layout.md` | Reconcile with the §3.2 blueprint (including the `providers/`→`provider/` and `protocol/`→`host/` normalisation) | Remove the naming conflict between two documents |
| `docs/development.md` | Register `npm run spec:check` | Command discoverability |

> **The only new code this iteration is the specification self-consistency check** (maintenance tooling, not product code). Document reachability is already covered by the repo's existing local-file-link check at `scripts/skills/integrity.test.mjs`, which includes `SP/**/*.md`, so no second link checker is warranted. The new check targets "a mandatory capability is silently demoted" — that risk fails no other test, so it needs a dedicated gate.

### 4.3 Verification (commands that really exist)

| Check | Command | cwd |
| --- | --- | --- |
| Specification self-consistency (manifest / task inventory) | `npm run spec:check` | repo root |
| Checker self-test (detects deliberate breakage) | `npm run spec:test` | repo root |
| No regression in existing maintenance tests (includes the document link-integrity check) | `npm test` | repo root |
| No commit / nothing pushed | `git status --short` | repo root |

> `npm test` currently covers `skills:test` (which includes the link-integrity check above) + `spec:test` + `test:tui` + `test:release`; `test:tui` runs `npm run build` (tsc) first. Since this iteration adds no product code, these gates must keep passing. Known blind spot: the link check strips fenced code blocks but not inline code spans, so a link-syntax example written inline in prose is misreported as broken — this iteration avoids it by putting examples inside fences, and extending the check is a shared-maintenance behaviour change needing separate authorisation.

---

## 5. AC Mapping

| AC | Requirement | Design section | Verification | Status |
| --- | --- | --- | --- | --- |
| AC-01…AC-10 (baseline) | [capability-baseline](../capability-baseline/requirements.md) | §3.1, §3.5 | manual manifest review + link check | UNVERIFIED (pending approval) |
| AC-01…AC-12 (evaluation) | [evaluation-suite](../evaluation-suite/requirements.md) | §3.3 | manual review of spec and task inventory | UNVERIFIED |
| AC-01…AC-13 (boundaries) | [core-boundaries](../core-boundaries/requirements.md) | §3.2 | manual design review | UNVERIFIED |
| AC-01…AC-12 (release) | [release-scope](../release-scope/requirements.md) | §3.4 | manual design review | UNVERIFIED |

ACs map one-to-one onto design sections with no orphan ACs. **No AC is verified as PASS in this iteration**; all verification is recorded in the corresponding `STATUS.md`, and anything not executed stays `UNVERIFIED`.

---

## 6. Risks and Open Items

| ID | Type | Content | Handling |
| --- | --- | --- | --- |
| R1 | Risk | Whether 53 mandatory capabilities fit in 21 iterations is not schedule-verified; the baseline's TUI layer alone is ~166k lines | Slice each iteration's exit gate by manifest; if one iteration cannot land, append an SP number rather than shrink mandatory scope |
| R2 | Risk | Replacing the baseline's self-built renderer with an upstream terminal framework may lack equivalent capability (selection / search highlight / layout / alternate screen) | SP002 selection carries a **measured gate**: prove equivalence item by item against CAP-L1-01/02/03/04/05/14/15's acceptance methods; only then introduce controlled extensions |
| R3 | Risk | No reference effect baseline ⇒ the effect dimension is unprovable | Written into §3.3 and AC-09; recovery conditions stated; "aligned" wording forbidden |
| R4 | Risk | A task set written after the feature exists becomes a test written to fit the implementation | Task definitions must be version-frozen before the corresponding feature starts |
| R5 | Risk | The `budingx` name is taken, colliding with the full Agent artifact naming | OPEN-01 is yours to decide; default drafting uses a new name |
| R6 | Risk | Manifest granularity mismatching implementation granularity causes acceptance disputes | Manifest changes go through the iteration summary change log, never silent edits |
| R7 | Risk | A static survey cannot find capabilities that exist but do not work | That class of problem surfaces through the evaluation suite and real-process smoke, not through the manifest |
| O1 | OPEN | npm package-name strategy | Your decision; default drafting uses a new name |
| O2 | OPEN | Platform scope beyond Windows | Your decision; default claims only Windows as verified |
| O3 | OPEN | Publishing account and signing ownership | Default: keep the existing Trusted Publishing path and account |
| O4 | OPEN | Desktop/extension distribution channel (store listing) | Default: guarantee installable artifacts only |
| O5 | OPEN | Authorisation and timing for collecting the reference effect baseline | Default: request separately at SP002 or later |
| O6 | OPEN | Whether Core becomes its own npm package | Default: same-repo `src/core` directory, confirmed at SP002 |
| O7 | OPEN | Concurrency model for cross-end shared storage | Default: single writer per session + read-only observation, landed at SP010 |
| O8 | OPEN | Concrete terminal UI framework selection | Decided at SP002, with licence registration |

---

## 7. Delivery and Next Steps

- This iteration delivers specification and manifests only, **no product code**.
- Next steps (two things needed from you first):
  1. Approve this design (v1) and the ACs of the four requirements;
  2. Decide O1 (package name), O2 (platforms) and O5 (authorisation to run the reference Agent) — O1/O2 belong to release scope; O5 decides whether the evaluation can exist at all.
- After approval, execute `plan.en.md`; execution still grants no Git commit, merge, push or publish authorisation by itself.

# SP001 Implementation Plan — Capability Baseline, Core Boundaries and Release Scope

> **For agentic workers:** execute this plan task-by-task using `superpowers:executing-plans` or `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Git note:** `AGENTS.md` binds commit / merge / push to separate user authorisation. This plan contains **no** commit steps; each task ends with "record status" unless you are separately authorised.

**Goal:** Deliver SP001's specification artifacts — an 85-item capability manifest, the evaluation-suite specification and task inventory, the core boundaries and invariants, and the release scope with its open decisions — with no broken links anywhere between the related documents.

**Architecture:** This iteration is specification-only and writes no product code. The specification is organised as "one iteration-level design + four requirement documents + one capability manifest". The only new code is a relative-link checker for documentation (well under 100 lines), which provides executable evidence that the documents are reachable. All changes are Markdown plus one npm script.

**Tech stack:** Node.js >= 22.18 (built-in `node:fs` / `node:path` / `node:test`, no third-party dependencies), ESM, TypeScript not involved (no product code changes), Markdown (UTF-8).

**Spec source:** [`design.en.md`](design.en.md) (this plan's basis) / [`design.zh.md`](design.zh.md). Requirement documents live in `SP/SP001/<slug>/requirements.md`.

**Plan location note:** `superpowers:writing-plans` defaults to `docs/superpowers/plans/`, but this repo's [SP record convention](../../../skills/buding-sdd/references/sp-records.md) requires the iteration directory, so the repo convention wins.

---

## Global Constraints (implicitly included by every task)

| # | Constraint |
| --- | --- |
| G1 | Node.js >= 22.18.0; **Bun forbidden** (no bun in the dependency tree) |
| G2 | Sole user-data root `~/.budingx` (via `os.homedir()`); reading / writing / falling back to / migrating `~/.claude` is forbidden |
| G3 | Old repo `D:\extra_project\buding-worker-space` is read-only; no copying of source, prompts, internal SDK types, global state, bundles, config or history; no file-by-file rewriting passed off as independent |
| G4 | "Reaches the reference Agent's level" may only be stated as **capability-manifest coverage**; until a reference effect baseline exists, the wording "aligned" / "same effect level" is forbidden |
| G5 | Every relative link in the docs must resolve; every command must really exist; no invented npm scripts |
| G6 | Maintenance files are UTF-8 / Markdown; JS uses 2-space indent, ESM, no semicolons |
| G7 | Checks that were not executed are recorded as `UNVERIFIED`; zero tests or all-skip never counts as `PASS` |
| G8 | This iteration does not stage, commit, push, publish, create branches or change remotes (no authorisation) |

## Review Focus

Five failure modes the specification implies that no single task's checks cover:

1. **A mandatory capability is silently demoted** — a `必交` row becomes `建议`/`可选`; downstream acceptance computes against the fixed denominator of 53 and misses it, and no test fails.
2. **An unproven baseline is written up as a conclusion** — the documents say "aligned with the reference Agent" / "reached the same effect level" although the reference was never run.
3. **Core gains a terminal/UI dependency** — `src/core/` imports a terminal rendering library, breaking I-01 and preventing Desktop/VS Code from reusing Core.
4. **`~/.claude` is touched, or a user path is hardcoded** — a read/fallback of `~/.claude` appears, or a username/drive letter is written into docs or code.
5. **The package-name conflict is resolved by publishing** — shipping under `budingx` before OPEN-01 is decided overwrites the user's installed 0.1.1 preview.

Each of the five has a corresponding check in T-001, T-002, T-003 and T-008.

---

### Task T-001: Capability manifest v1

**Files:**
- Create: `SP/SP001/capability-baseline/capability-manifest.md`
- Modify: `SP/SP001/capability-baseline/requirements.md` (link to the manifest)

**Interfaces:**
- Consumes: the read-only survey facts (reference baseline directory structure and scale statistics, see `design.en.md` §2.2).
- Produces: **CAP ID namespace** `CAP-L{1|2|3|4}-{nn}`; **necessity enum** `必交 / 建议 / 可选 / 范围外`; **coverage denominator = count of mandatory items = 53**; a five-part row tuple `(layer, target state, owning SP, acceptance method, necessity)`.

- [ ] **Step 1: Write the table header and column meanings**, including the "what this manifest is" and "column meanings" sections, and state the coverage definition plus "counts are not acceptance evidence".
- [ ] **Step 2: Fill in 87 rows across layers L1–L4**, each with CAP ID, capability, baseline evidence, target state, owning SP, acceptance method and necessity. Baseline evidence records only the existence of a capability and scale statistics — never implementation detail beyond a source location.
- [ ] **Step 3: Check the user-confirmed mandatory scope**: teams, browser, Computer Use, remote, IM and scheduled tasks are all `必交` with an owning SP (AC-06).
- [ ] **Step 4: Check that reference-specific capabilities were not dropped**: voice input, plugin system, notebook editing, PR integration, tool search and the rest all appear explicitly as `可选` or `范围外` with a reason (AC-05).
- [ ] **Step 5: Compute and freeze the denominator**: 53 mandatory, 22 suggested, 9 optional, 1 out of scope (85 total); state that suggested/optional stay out of the denominator but remain on the gap list (AC-03). **The counts must be computed by a script, never estimated by eye.**
- [ ] **Step 6: Check ID uniqueness, no duplicated semantics, no empty cells** (AC-02, AC-04).
- [ ] **Step 7: Check every row's acceptance method belongs to the technology-map evidence classes** (`logic / protocol fixture / real process / UI / live Provider / install / manual`), and that no fixture is presented as live (AC-07).
- [ ] **Step 8: Check the manifest contains no "counts equal acceptance" statement**, and says so explicitly in the statistics section (AC-08).
- [ ] **Step 9: Write the source and handling-decision table**; the old-repo row must state "read-only behaviour and structure observation only; no copying of code / prompts / types / bundles / config / history" (AC-01).
- [ ] **Step 10: Record status** in `SP/SP001/capability-baseline/STATUS.md`: completed items, remaining items, verification results, evidence locations; anything not executed stays `UNVERIFIED`.

### Task T-002: Evaluation-suite specification and task inventory

**Files:**
- Create: `SP/SP001/evaluation-suite/task-inventory.md`
- Modify: `SP/SP001/evaluation-suite/requirements.md` (link to the inventory)

**Interfaces:**
- Consumes: the manifest's task categories and owning SPs; the quantities already fixed by roadmap r3 (30 + 30 + 20, ≥3 runs per task, the 5-percentage-point threshold).
- Produces: **TASK ID namespace** `TASK-B{nn}` (basic coding) and `TASK-A{nn}` (advanced combination); **blind flag** `blind: true/false`; **protection-case namespace** `PROT-{nn}`; **budget table** (wall-clock / turns / cost cap per category); **failure-category enum** (wrong localisation, wrong modification, authorisation violation, ineffective loop, budget exceeded, hallucinated success).

- [ ] **Step 1: Write the task schema field table**: `id`, category, language, repository size, initial snapshot (version + content hash), instruction, automatically assertable expected result, allowed modification scope, external dependencies, budget, failure category, blind flag — with the semantics and filling rules of each (AC-01).
- [ ] **Step 2: Write the taxonomy and quota table**, and state that protection cases **do not count toward the blind denominator** (AC-02, AC-10).
- [ ] **Step 3: List 60 task slots** (30 `TASK-B` + 30 `TASK-A`), each with at least: title, category, language, repository-size tier, assertion direction (test / diff / exit code / artifact), budget tier, blind flag. At least 20 carry `blind: true`, and blind tasks do not overlap with tuning tasks (AC-02, AC-03).
- [ ] **Step 4: Write the failure-category definitions**, giving a criterion for each of the six (AC-04).
- [ ] **Step 5: Write the scoring rules**, explicitly forbidding scoring by the model's self-reported completion and accepting only tests, diff correctness and goal attainment (AC-05).
- [ ] **Step 6: Write the budget cap table** and state that exceeding a cap is a failure recorded as such, not something to be retried away (AC-06).
- [ ] **Step 7: Write the blind-test discipline**: no tuning against blind tasks before sealing; after failure analysis they enter the regression set and a new independent blind set is reserved (AC-07).
- [ ] **Step 8: Write the four mandatory statistical reports**: independent task count, correlation across repeated runs, per-group results, variability intervals; straddling the threshold yields "insufficient evidence" (AC-08).
- [ ] **Step 9: Write the reference-baseline gap and its recovery condition**, and ban "aligned" wording across this iteration's documents (AC-09).
- [ ] **Step 10: Check scenario coverage**: Windows paths, oversized repositories, non-English content and long context each own at least one task (AC-11).
- [ ] **Step 11: Write the snapshot versioning and reproducibility requirement** (snapshot carries a version and a content hash; the same version is re-runnable) (AC-12).
- [ ] **Step 12: Record status** in `SP/SP001/evaluation-suite/STATUS.md`.

### Task T-003: Core boundaries and invariants

**Files:**
- Modify: `SP/SP001/core-boundaries/requirements.md` (body references design §3.2)
- Artifact locations: `SP/SP001/design/design.zh.md` §3.2 and `design.en.md` §3.2 (already contain the directory blueprint, I-01…I-12, contract directions, end-agnostic requirements and reuse list)

**Interfaces:**
- Consumes: the logical boundary draft in `docs/architecture.md`; the data-root and module rules in `AGENTS.md`.
- Produces: **directory blueprint** `src/{core,provider,tools,storage,host,tui}`; **invariant list** I-01…I-12 (each with the iteration that makes it checkable); **contract-direction table** (definer / consumer / failure ownership); **reuse list** (the three reusable points in `src/tui`: config, provider, cli).

- [ ] **Step 1: Reconcile the directory blueprint with `docs/repository-layout.md`**; on conflict, `AGENTS.md`'s single-repo layout wins and that document is updated to match.
- [ ] **Step 2: Check I-01…I-12 one by one**, each needing both a rule text and a "how it becomes checkable (which iteration owns it)" column; a row missing either is incomplete (AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11).
- [ ] **Step 3: Check the contract table fixes responsibility only, not fields** — five contracts, each with definer, consumer and failure ownership (AC-01).
- [ ] **Step 4: Check the "reuse this repo's existing assets" note names three concrete files and their reusable content** (config loading and base-URL validation / SSE framing and error normalisation / terminal-safe output), and states that SP002 performs one explicit migration (AC-12).
- [ ] **Step 5: Check the "never migrate" list** records all five items: the old repo's agent loop, prompts, SDK types, global state and bundles (AC-13).
- [ ] **Step 6: Check the end-agnostic and cancellable requirements are directly quotable downstream** (core does not touch the terminal, does not call `process.exit`, does not depend on host globals; long operations accept a cancellation signal).
- [ ] **Step 7: Record status** in `SP/SP001/core-boundaries/STATUS.md`, registering OPEN-01/02/03 (whether Core becomes its own package, the cross-end concurrency model, terminal framework selection) as pending decisions.

### Task T-004: Release scope and open decisions

**Files:**
- Modify: `SP/SP001/release-scope/requirements.md` (body references design §3.4)

**Interfaces:**
- Consumes: `docs/npm-release-plan.md`, `docs/versioning.md`, `skills/buding-npm-release`, the existing `scripts/release/*` and `.github/workflows/publish-tui.yml`.
- Produces: **release-scope table** (artifact shape / package name / platforms / runtime conditions / credentials / user data / licences / authorisation / receipts / artifact independence); **open decisions OPEN-01…OPEN-04**, each with "impact + default handling + decision owner".

- [ ] **Step 1: Write the artifact-shape and owning-iteration table**, each end with exit conditions (AC-01).
- [ ] **Step 2: Write the npm package-name strategy**: the published `budingx` 0.1.1 is a bootstrap preview; the full Agent artifact is drafted under a new name by default, and OPEN-01 spells out the user-visible impact of both options (AC-02).
- [ ] **Step 3: Write the three-state platform matrix** (verified / planned / unsupported) with the evidence requirement per state; only Windows is claimed as verified today (AC-03).
- [ ] **Step 4: Write the runtime conditions**: Node >= 22.18, Bun forbidden, terminal TTY capability requirements and fallback paths (AC-04).
- [ ] **Step 5: Write the credential and user-data boundaries** (AC-05, AC-06).
- [ ] **Step 6: Write the third-party licence and release-contents-list requirements**, stating that added dependencies must be registered in `THIRD-PARTY-NOTICES.md` under MIT or an equivalent redistributable licence (AC-07).
- [ ] **Step 7: Write the release authorisation and receipt requirements** — each release separately authorised; receipts include a registry receipt + provenance + a clean-environment isolated install smoke (AC-08, AC-10).
- [ ] **Step 8: Explicitly separate "0.1.1 is published" from "full substitution concluded"**, stating the current package is not capability-acceptance evidence (AC-09).
- [ ] **Step 9: Write the artifact-independence requirement**: installable and runnable without the source tree, Bun or dev dependencies (AC-12).
- [ ] **Step 10: Check all four open decisions carry impact and default handling, with the owner marked as the user** (AC-11).
- [ ] **Step 11: Record status** in `SP/SP001/release-scope/STATUS.md`.
### Task T-005: Specification self-consistency gate and document link check

> **No second link checker**: the repo already ships a local-file-link check in `scripts/skills/integrity.test.mjs` (from line 64), covering `README.md`, `AGENTS.md`, `CLAUDE.md`, `THIRD-PARTY-NOTICES.md`, `skills/README.md`, `docs/**/*.md`, `SP/**/*.md`, project skill bodies and the generated discovery entries. A second checker is duplicated work.
> **But specification self-consistency needs a new script**: Review Focus item 1 states that a silently demoted mandatory capability produces "no failing test". That gap must be closed with an executable check, otherwise the risk entry is decorative.

**Files:**
- Create: `scripts/spec/check-spec.mjs` (self-consistency checks for the manifest and the task inventory)
- Create: `scripts/spec/check-spec.test.mjs` (self-test of the checker)
- Modify: `package.json` (add `spec:check`, `spec:test`, and fold `spec:test` into `test`)
- Modify: `docs/development.md` (register the new commands)
- Reuse (**not modified**): `scripts/skills/integrity.test.mjs`

**Interfaces:**
- Consumes: `SP/SP001/capability-baseline/capability-manifest.md`, `SP/SP001/evaluation-suite/task-inventory.md`.
- Produces: `checkManifest(text) -> { failures, stats }`, `checkInventory(text) -> { failures, stats }`, `checkSpec(root) -> { failures, manifest, inventory }`; the CLI `npm run spec:check` exits 0 with the computed statistics on success, and exits 1 listing every problem on failure.

- [ ] **Step 1: Implement the manifest check**: 7 columns per row with no empty cells; CAP IDs unique and shaped `CAP-L{1-4}-nn`; necessity and acceptance-method values legal; owning SP is `SP\d{3}` or (for optional / out-of-scope only) `—`; **the declared statistics must equal the computed ones (declared values are parsed from the document, never hardcoded)**; the coverage denominator must equal the computed mandatory count; the ten user-confirmed mandatory capabilities (team, browser, Computer Use, remote, IM, scheduled) must not be demoted.
- [ ] **Step 2: Implement the task-inventory check**: 30 basic / 30 advanced / 12 protection; numbering continuous with no gaps; 9 columns per row (4 for protection cases) with no empty cells; assertion direction is `T/D/X/A/E` or a `+` combination of them; size `S/M/L`; budget tier matches the group; 20 blind tests (10 basic + 10 advanced); category quotas match the taxonomy in the document; the four scenarios Windows paths / oversized repository / non-English content / long context are covered.
- [ ] **Step 3: Write the checker's self-test**: the real inventories must produce zero failures; and **deliberately broken copies** must be reported — demoting one mandatory capability, corrupting a declared statistic, breaking the blind-test count and deleting a task all have to be detected. **Without this, a broken checker keeps reporting "all good" forever.**
- [ ] **Step 4: Wire npm**: add `spec:check` and `spec:test` to `package.json`, fold `spec:test` into `test`, and register the commands in `docs/development.md`.
- [ ] **Step 5: Make this iteration's documents pass the existing link check**: run `npm test` and fix each failure on the **document side** — Markdown link-syntax examples in prose must live inside fenced code blocks (the existing check strips fences), otherwise they are treated as real links and reported as broken. Correct form (inside a fence):

```markdown
[relative link](./exists.md)
![image link](./rel.png)
```

    The wrong form: putting the same syntax inside an inline code span (backticks) instead of a fence is reported as a broken link

- [ ] **Step 6: Record the existing link check's known blind spot (not fixed this iteration)**: it strips fenced code blocks but **not inline code spans**. Extending it is a shared-maintenance behaviour change (it could mask real broken links) and needs separate authorisation, so it is logged as a later-iteration open item.
- [ ] **Step 7: Record status**: write the actual command, cwd, counts and results into the change log of `SP/SP001/requirements-summary.md` and the relevant `STATUS.md` files.

### Task T-006: Iteration summary and STATUS records

**Files:**
- Create: `SP/SP001/requirements-summary.md`
- Create: `SP/SP001/{capability-baseline,evaluation-suite,core-boundaries,release-scope}/STATUS.md`

**Interfaces:**
- Consumes: the four requirement documents, the manifest, the task inventory and the actual execution results.
- Produces: the iteration summary (goals / boundaries / dependencies / requirement index / exit gate / handover / change log); one STATUS per requirement (lifecycle, current scope and basis, progress, verification and acceptance, integration and release, handover and history).

- [ ] **Step 1: Write `requirements-summary.md`**. Every row of the requirement index must carry: source/identity, acceptance-goal summary, responsibility scope, stage, links to requirement/design/plan/STATUS, verification status, integration status, next step. **The verification column is `UNVERIFIED` throughout** — never pre-fill PASS.
- [ ] **Step 2: Write the four `STATUS.md` files**, each stating: requirement/AC links, design and plan versions (`design.zh.md` v1 / `design.en.md` v1, draft), baseline (current HEAD and environment), current approved scope (specification only; implementation not approved), completed/remaining/blocked, verification results (distinguishing logic fixtures / manual review / not executed), integration and release (all not executed), and handover/history.
- [ ] **Step 3: Record the user's authorisation wording** (the four 2026-11-16 decisions plus the Node-only addition), each marked USER_CONFIRMED.
- [ ] **Step 4: Write the handover paragraph**: which files the next agent reads first, the earliest incomplete step, remaining risks, and that an existing authorisation for the same version is not requested again.

### Task T-007: Repository documentation sync

**Files:**
- Modify: `docs/index.md`, `docs/current-status.md`, `docs/iteration-plan.md`, `docs/agent-capability-matrix.md`

- [ ] **Step 1**: add an SP001 entry to `docs/index.md` pointing at `SP/SP001/requirements-summary.md`.
- [ ] **Step 2**: in `docs/current-status.md`, state that SP001 is a specification iteration, that the manifest / boundaries / evaluation / release-scope specifications are delivered, that **no product implementation has started**, and that the remaining roadmap iterations are still PLANNED.
- [ ] **Step 3**: in `docs/iteration-plan.md`'s "entry point for follow-up agents", mark SP001 as started (specification iteration) with the manifest version; do not rewrite the r1–r3 historical conclusions.
- [ ] **Step 4**: in `docs/agent-capability-matrix.md`, add a link to capability manifest v1 and state the relationship (the matrix is the acceptance view; the manifest is the capability view).
- [ ] **Step 5**: run `npm test`, expecting everything to pass (`skills:test` includes the document link-integrity check).

### Task T-008: Full verification and delivery record

**Files:**
- Modify: `SP/SP001/requirements-summary.md` (acceptance and handover section)

- [ ] **Step 1**: run `npm test` and record the actual pass count, split by `skills:test` / `test:tui` / `test:release`.
- [ ] **Step 2**: run `node --test scripts/skills/*.test.mjs` and `node --test scripts/spec/*.test.mjs`, recording each count (the former includes the document link-integrity check, the latter self-tests the specification checker).
- [ ] **Step 3**: confirm `npm test` passes overall and record the counts for the four segments (`skills:test` / `spec:test` / `test:tui` / `test:release`).
- [ ] **Step 4**: walk every AC of the four requirements (10 baseline + 12 evaluation + 13 boundaries + 12 release = 47), recording `PASS` / `FAIL` / `UNVERIFIED` / `NOT_APPLICABLE` with its basis; anything not actually checked stays `UNVERIFIED`.
- [ ] **Step 5**: check the five Review Focus items (no mandatory capability demoted / no unproven baseline written as a conclusion / Core free of UI dependencies / `~/.claude` untouched / no publish before the package-name conflict is decided), recording each conclusion.
- [ ] **Step 6**: write the results into the summary's "acceptance and handover" section: what was executed, the results, unverified items, risks, next-iteration inputs, and the Git/release status (all not executed).
- [ ] **Step 7**: check `git status --short` to confirm no user files were clobbered and nothing was staged, committed or pushed.

---

## Plan self-review (writing-plans checklist)

1. **Spec coverage**: design §3.1→T-001; §3.2→T-003; §3.3→T-002; §3.4→T-004; §3.5→T-001 step 9 + T-003 step 5; §4→T-005/T-006/T-007; §5's 47 ACs→T-008 step 4; §6's risks and open items→each STATUS's pending and blocked sections. **No gaps.**
2. **Step granularity**: every step yields one decidable result; no "TBD" or "handle edge cases" steps; this iteration's tasks are documentation tasks, so there are no function bodies to transcribe.
3. **Type consistency**: CAP ID space, TASK ID space, invariant numbers I-01…I-12, AC numbers and OPEN numbers are spelled identically across design, requirements, plan and manifest.
4. **Review Focus**: each of the five has an owning step — mandatory not demoted→T-001 step 3; unproven baseline→T-002 step 9 and T-008 step 5; Core free of UI deps→T-003 step 2 and T-008 step 5; `~/.claude` untouched→T-003 step 2 and T-008 step 5; package-name conflict→T-004 step 2 and T-008 step 5.
5. **Proportion**: the plan is comparable in length to the design; document body text is not copied into the plan.

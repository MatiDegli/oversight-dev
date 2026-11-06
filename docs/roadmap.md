# Oversight roadmap

Status: approved by the maintainer on 2026-11-05; base main 498639ff. This plans the work after the hackathon and does not change today's rules until the fronts it names land.

## Goal

A person opens any repository, in any language, on Windows, Linux or macOS. Many agents work on it in parallel. Each agent is either a native agent on any model or a hosted CLI (Claude Code, Codex, Muse Code). The person controls the agents through workflows, policies and gates they configure, and has every IDE essential at hand (editor, terminal, search, git, language intelligence) without leaving Oversight.

## Principles (what stays Oversight)

1. **Control is the product.** Every agent action passes a policy the person can see and change. Each limit is either an *authority invariant* or a *default*:
   - Only two rules are fixed: authority comes only from the person (no agent gives itself or another agent more authority than the person configured); every loosening is visible, logged and reversible. Status still comes from tool calls, never agent text.
   - Personal approval and person-only locks, modes, rules and grants are defaults, available from M5 as settings; the person can set rules up to approving everything and delegate to a lead per workflow or plan, revocably. Tests, independent review and evidence gates are on by default, configurable per repository, workflow or block (available from M5), labeled "untested", "review off" and "evidence incomplete" when loosened. Unknown results never show as passing.
   - Defaults are configurable and are never ceilings. Examples: steps, tool-output caps, seats, timeouts, graph loading. Each new setting is available from its named milestone, not today; default = today's behavior until that front lands. Every loosening is the person's act, visibly indicated, logged and revocable. Provider terms, law and licenses still bind, and unavailable capabilities remain unavailable with reasons. These product settings do not change the rules for developing Oversight.
2. **Not restrictive.** Any model, harness, language or repository. Limits come from the person's policy and the sandbox, never from hard-coded product choices.
3. **Execution needs a boundary or explicit trust.** A command runs only when one of two things holds:
   - the platform's sandbox is qualified, with verified cleanup; or
   - the person has explicitly trusted that repository for unsandboxed execution, with the exposure disclosed and the same verified cleanup (process tree, ports and temporary state) as the sandboxed path (available from M1). Native Windows already executes trusted code as the person today; today's informational prompt is not this new grant.
   Sandbox and ask are defaults. The person may grant trusted execution, network, installs and protected paths per repository, workflow, block or run, visibly labeled "unsandboxed" outside the sandbox (available from M1 for repository trust, M5 for workflow/block grants). Cleanup failure blocks by default; a person-authorized run exception is labeled "cleanup unverified" (available from M1, extended in M3).
   Commands covered here: repository tests and builds, hosted CLIs, workflow actions and MCP servers. Shell, network, installs and protected paths reach agents through the sandbox, or unsandboxed only under the person's explicit trust grant; always policy-gated, defaulting to ask. This includes the M4 native shell in an M1-trusted repository before M3 qualifies the platform (amends decision 2).
4. **One event log, bounded.** Terminal sessions, hosted agents, tools, approvals and the inputs to every policy decision all land in the append-only log. Its ingestion and memory are bounded whatever the language (see Bounded event log). Capture is bounded and redacted by default; capture, retention, step and output limits are configurable when their capture fronts land (M2/M4), with visible capture/limit indicators. Agent self-reports are separate and labeled; status still comes from tool calls.
5. **Hosted harnesses are hosted, not wrapped.**
   - What Oversight controls for Claude Code, Codex CLI and Muse Code: the worktree, the sandbox, permissions through each CLI's native config and hooks, event capture from its JSON stream or ACP, approvals and gates.
   - Unmodified by default: Oversight adds no second system prompt or duplicate tool set, and never reads or stores the CLIs' credentials. The person may add their own instructions or tools per workflow (available from M2, workflow editing from M5), visibly indicated and revocable.
   - Running the unmodified CLI under the person's own login is the path Anthropic's published terms allow for Claude subscriptions. Agent SDK and `-p` use under a subscription remains ambiguous there, and Meta's terms are unconfirmed. Each harness is checked against its provider's terms before it ships.
6. **Rust where it pays.** Use Rust at the OS boundary and on measured hot paths. Elsewhere, rewrite only after measuring.

## Milestones

Each milestone starts when its gate holds and a slot is free. Milestones run in parallel unless the gate says otherwise. Work splits into fronts by cohesive change, with the usual review. Execution features follow principle 3 on every platform.

**M0 · Post-hackathon baseline.** Gate: none.
- CI green on the development repository: close the load flakes, UI load flakes in coldStartDepth and PreviewChat, the preview refusal reason and the Vite preview pool fixes. The cold-start guard and its regression test exist (`frontend/src/app/App.tsx:109`, `frontend/src/app/preview/PreviewChat.browser.test.ts:505`), so verify before assuming a defect.
- Cargo fmt, clippy and test in `make check` (today outside the shared gates, `Makefile:193`).
- Rewrite the AGENTS.md and PRODUCT.md rules that were for the hackathon only, per the decisions below.
- A release process: versioning, changelog, tags on the development repository while the submission repository stays frozen for judging.

**M1 · Real repositories, any language.** Gate: M0's rules rewrite. Execution per principle 3.
- Open any repository on every platform. Today arbitrary POSIX paths are refused (`backend/src/oversight/workspace/source.py:355`) and Windows needs a validated `.venv`. Add recent repositories and a remembered last repository.
- Per-repository workspace trust (principle 3), set by the person and shown in the review; off by default, disclosed, labeled "unsandboxed", with verified process, port and temporary-state cleanup (available from M1).
- The session design of `docs/own-repository.md:13-19`: session branches, following external commits, an overlay for personal edits, and guarded integration into the original. Guarded integration (a pointer click with no shortcut, or rules under its own standing grant, off by default and revocable; `docs/own-repository.md:27-31`) replaces required manual export; export, following external commits and recovery retry become configurable, with visible session/recovery settings (available from M1).
- Acceptance tests for:
  - reopen;
  - crash recovery;
  - pending changes across restart;
  - external commits;
  - conflicting personal edits;
  - in-app recovery from quarantine, without weakening it. Today reopening can discard pending work or need a manual directory delete (`desktop/README.md:66`).
- Per-repository test and build commands for any toolchain (pytest, vitest/jest, cargo, go, JUnit), set and versioned by the person by default. The person may grant agent edits, labeled "command editing delegated" (available from M1).
- A language-agnostic graph and context layer: tree-sitter (MIT) first, then LSP call hierarchy where available.
- A per-language evidence-capability contract. For each language and toolchain it states which checks are supported, which are unavailable, and where test reports come from. Today test-file recognition and shortcut parsing are Python-only (`backend/src/oversight/changes/_shortcuts_common.py:59`, `backend/src/oversight/changes/_shortcut_detector.py:67`). Where a needed check is unsupported, the person approves instead, and automatic rules qualify per language. Semantic detector ports beyond the first languages are deferred; they are not a prerequisite for opening a repository.
- File operations for native agents: create, with conflict detection when the file is no longer absent; rename and delete. Each is tracked as a proposal like any edit. Today the tools cannot create a file: edit_file needs non-empty existing text and an earlier read (`backend/src/oversight/agents/tools.py:47`, `backend/src/oversight/agents/tools.py:493`). Basic feature work must not depend on the shell. AGENTS.md's tool list changes with it, his call.
- Lead threads and the queue survive a restart (`backend/src/oversight/runtime_queue.py:49`, `ARCHITECTURE.md:497`).
- Windows native acceptance moves here, next to the first usable repository flow; macOS acceptance follows its sandbox in M3.
- Preview concurrency, drafts, retention and capability profiles; admission budgets and safely resolved source locations: configurable; default = today's behavior; indicator "custom preview/source settings" (available from M1; sandbox extensions from M3).

**M2 · Any model, any harness.** Gate: M0. The contract changes are his. Hosted-CLI capture also needs the bounded event log and the Secrets gate.
- An extensible provider contract. Built-in adapters cover Anthropic, OpenAI, Google, Meta, OpenRouter, any OpenAI-compatible endpoint and local models (Ollama, LM Studio, vLLM), and a person can add their own. Each adapter declares:
  - authentication;
  - tool protocol;
  - reasoning control;
  - price;
  - which features it supports, negotiated before use.
- It covers every model-using role, not only lead, coder and reviewer. Decision and example calls are included; today they pin Spark Open (`backend/src/oversight/agents/decision.py:219`) and the contracts restrict provider identities (`contracts/src/oversight_contracts/events.py:55`).
- Keys in the OS keychain (Windows Credential Manager, macOS Keychain, Secret Service) by default, with `.env` as the development fallback; the person may choose `.env` or another supported store per repository, visibly showing the store (available from M2). Hosted CLI credentials remain with each unmodified CLI.
- Hosted agents: Claude Code, Codex CLI, Muse Code, then Gemini CLI and others through ACP. Each one gets:
  - a versioned compatibility test;
  - checked permission and event coverage;
  - refusal by default when the policy cannot be enforced on it; where enforcement is partial, a person-selected policy labeled "partial enforcement" (available from M2). Provider terms still apply.
- Agent profiles: a model or harness, plus tools, policy, instructions and limits. Profiles are assignable per role and per workflow node.
- Role, model and reasoning choices per app, workflow or run: configurable; default = today's behavior; indicator "custom agent profile" (available from M2).
- Granted agent patch, create, rename and delete file operations: configurable; default = today's behavior; indicator "file operations delegated" (available from M2; create/rename/delete capability from M1).
- Import of the person's existing setup: AGENTS.md and CLAUDE.md, `.mcp.json`, skills and rules.
- A usage and cost ledger for every agent kind:
  - subscription CLIs (Claude Code through OAuth, Codex through ChatGPT) are priced as list-price equivalents under a dated price book, never as bills;
  - agent-hours: parallel agents add, one agent's intervals are unioned, and a parent that only waits adds nothing;
  - unknown stays unknown, never zero; provisional cost reserves with reconciliation: configurable; default = today's behavior; indicator "cost uncertain" (available from M2);
  - the brake and pace work on these equivalents and on each subscription's limits; price books, budgets and pace are configurable beside the existing configurable brake, with visible ledger settings (available from M2);
  - live hourly and daily views, spend projections, and fixed-context accounting (`docs/additions.md:315`, `docs/additions.md:681`);
  - optional, opt-in import of CLI history from outside Oversight, which stores no prompts or responses.
- When the ledger is built is decision 11.

**M3 · Sandbox.** Gate: a one-page security plan with an independent review. It starts with M0, not after M1 and M2.
- Close today's containment gaps first, with the existing launcher where that is fastest:
  - no filesystem isolation for run_tests and the shop adapter (`docs/isolation.md:130`, `docs/isolation.md:398`);
  - Windows running trusted code as the person (`docs/isolation.md:221`).
  Replacing the launcher is not a prerequisite.
- A cross-platform sandbox:
  - Linux: Landlock, seccomp and namespaces;
  - macOS: Seatbelt;
  - Windows: AppContainer or a restricted token plus Jobs, after a spike;
  - all platforms: a network allowlist proxy, and protected paths (`.git/hooks`, `.git/config`, the agent configs).
  The implementation (Rust helper, bubblewrap or both) is decision 7.
- It covers every execution path: tests, the shop adapter, preview, the agent shell, workflow actions, MCP servers and hosted CLIs.
- Hosted CLIs: composition with each CLI's own sandbox is tested per harness. A CLI's own protection is turned off only where tests prove ours covers it, including keeping the CLI's authentication apart from its tool children's access to credentials.
- Policy per profile (filesystem, network, processes), with escalation requests surfaced as approvals. Role-based filesystem access, approved exits and repository access memory (`docs/additions.md:189`, `docs/additions.md:362`).
- Preview concurrency, drafts, retention and capability profiles; admission budgets and safely resolved source locations: configurable; default = today's behavior; indicator "custom sandbox preview/source settings" (available from M3). The implementation comparison grants no license exception today.

**M4 · Terminal and shell.** Gate for the person's terminal: its security plan reviewed. It can start alongside M0, but its output reaches the log only after the bounded event log lands. Gate for the agent shell: M3 qualification or the person's explicit M1 repository trust grant; sandbox and ask by default.
- Person terminal: xterm.js (MIT) in the dock, and a PTY host in Rust (portable-pty, MIT). Unsandboxed by default, labeled "unsandboxed"; a sandboxed option once M3 qualifies (available from M4), with remote access only later in M9, labeled "remote".
  - It reuses the shared authority policy: 127.0.0.1 only, a per-session token, Host and Origin checks, authentication and same-authority checks on unsafe HTTP and every WebSocket (DECISIONS.md:318, DECISIONS.md:583, DECISIONS.md:591), and it dies with the server.
  - It has tabs and splits, and opens in main or in any agent's worktree.
  - A person can send selected terminal output to an agent as context.
- Agent shell tool for native agents:
  - it runs inside the sandbox under allow, ask and deny command patterns, defaulting to ask; or in an explicitly M1-trusted repository, labeled "unsandboxed", even before M3 qualifies (available from M4);
  - its output streams to a live terminal pane and the event log, with redaction (see Secrets).
- Tasks and run configurations (build, dev server, scripts), generalizing preview launch selection. This includes:
  - general launch detection;
  - reviewed-self execution;
  - Windows preview;
  - simultaneous previews;
  - preview auto-open (`frontend/src/app/preview/previewOpening.ts:76`).

**M5 · Workflow control end to end.** Gates, by part:
- The canvas, plan editing and workflow files: M0.
- Executable workflow actions: approved action contracts plus M1's durable recovery. Today the dispatcher starts with an empty queue after a restart, and plan subtasks are agent work, not separately identified actions (`backend/src/oversight/runtime_queue.py:49`, `contracts/src/oversight_contracts/plans.py:26`). Each action records a durable intent and its outcome. An interrupted external action is reconciled before any retry.
- Hosted-agent and profile nodes: also M2.
- Automatic partitioning: the stricter gate below.
- From `docs/additions.md:272` and `docs/additions.md:728`:
  - plan editing in the UI, with stable identities across edits;
  - person-only locks by default; person-configured delegation (available from M5);
  - observe, guided and strict modes, person-owned by default and configurable by the person (available from M5);
  - optional gates; tests, independent review and evidence gates on by default, configurable per repository, workflow or block, labeled "untested", "review off", "evidence incomplete"; unknown never passes (available from M5);
  - action nodes: tests, review, lint, a sandboxed command, ask the person, run a hosted agent, wait for merge;
  - a visible merge queue and waiting stages;
  - evidence checklists and agent todo lists;
  - the native agent's todo list is 2–6 verifiable goals derived from the instruction, each with a checkable done-condition (a test that must pass, a file or symbol that must or must not change). The person sees and edits them; the harness marks goals met from tool calls, never text. Finish with open goals gets one reminder then "goals unmet"; no-progress stopping counts goals met. On by default in the harness pack once measured with the eval; goal count, required OK and block-or-label are configurable (available from M5), with a visible goal-policy indicator. Hosted CLIs keep their own todo lists, shown, not wrapped;
  - halted-agent continuation, revision context and visible handoffs (`docs/additions.md:232`).
- **Automatic partitioning:**
  - It ships only with complete server-owned evidence, with explicit uncertainty that covers imports and inheritance (`backend/src/oversight/changes/_partition.py:1`).
  - Its fallback is conservative by default: one agent wherever independence is not established. The person may choose manual zones or overlap, labeled "independence unverified" (available from M5); the automatic splitter still needs its evidence gate.
  - The split benchmark must pass first.
  - Until then, leads keep the whole-graph zone (`backend/src/oversight/runtime_leads.py:263`).
- Workflows as versioned repository files (for example `.oversight/workflows/*.yaml`), a library, and contextual selection.
- Hooks and policy as configuration:
  - event-to-action rules (pre-tool, post-edit, pre-merge);
  - a rule and gate editor that replaces the code tables (`backend/src/oversight/changes/_assessment.py:34`, `backend/src/oversight/changes/_protected_paths.py:20`);
  - broader grant scopes, protected-path grants, expiry and free-text grants (`docs/additions.md:941`), person-owned by default; lead delegation per workflow or plan is revocable, and rules can approve everything by the person's choice (available from M5);
  - person-drawn zones and approved growth (`docs/additions.md:263`).
- Repository memory, rules files, skills and review lessons (`docs/additions.md:944`).
- **Checkpoints and rewind**, with bounded semantics:
  - a filesystem checkpoint per agent step (a commit in its worktree) and a conversation checkpoint;
  - resume through each harness's own session support;
  - retention rules; checkpoint cadence, retention and retry are configurable, with visible recovery settings (available from M5);
  - external side effects are listed, never claimed as undone.
  - Run forking comes from the same mechanism.
- Grant scopes and expiry: configurable; default = today's behavior; indicator "custom grants" (available from M5).
- Rearming automatic review after personal intervention: configurable; default = today's behavior; indicator "review resumed" (available from M5).
- Revision comments, replacement agents and conflict-resolution choices: configurable; default = today's behavior; indicator "custom revision policy" (available from M5).
- Queue capacity, priority and staged waves: configurable; default = today's behavior; indicator "custom queue" (available from M5).
- Plan composition, amendment, hold and replan: configurable; default = today's behavior; indicator "custom plan policy" (available from M5).
- Queued or interrupting lead steering and wake policy: configurable; default = today's behavior; indicator "custom steering/wakes" (available from M5).
- Stop confirmation and retention: configurable; default = today's behavior (confirm and retain); indicator "custom Stop policy" (available from M5).
- Nested capacity and wakes exposed independently: configurable; default = today's behavior; indicator "custom nested capacity/wakes" (available from M5).
- Approve: security packet point 12(c), approved 2026-11-06 at 09:54 ART, supersedes the
  pointer-only and off-by-default keyboard guidance. The focused held-Enter front ships enabled
  at a fixed one-second duration alongside pointer approval. The person can disable it and adjust
  its duration once recorded settings contracts and history land; those controls remain pending.
  No global approval shortcut, Ctrl+Enter or Ctrl K approval command is introduced.
  - Maintainer proposal (not an implemented contract): application/person scope, shared by all
    review surfaces, persisted in the selected environment file through GET/PUT `/settings`, never
    browser storage. Proposed allowlisted fields `OVERSIGHT_APPROVE_HOLD_ENABLED` (boolean,
    default true) and `OVERSIGHT_APPROVE_HOLD_MS` (positive integer milliseconds, default 1000).
    Reject zero, negatives, fractions, non-finite numbers and invalid booleans; no arbitrary maximum.
    Return stored and effective values plus file/environment/default provenance and an explicit
    application boundary. Environment overrides must be visible and must never be reported as a
    successful effective change when only the file changed. Maintainer review owns exact API
    names, scope, schema, CAS revision and the event envelope; F1/F3 settings plans remain the boundary.
  - Save shows an exact diff, consequence and scope before the person's confirmation. Proposed
    application: the next fresh gesture after a durably recorded save; cancel any hold in progress,
    never reinterpret elapsed time. Show a persistent "Keyboard approval off" or custom duration
    indicator beside Approve and update the accessible instructions from the effective snapshot.
    Retain pointer approval. A shorter duration explicitly discloses reduced accidental-merge protection.
  - A dedicated settings receipt records revision, person/provenance, scope, before/after stored
    and effective values, application boundary and any restored receipt. Commit it before UI
    confirmation; define file/event failure recovery so no unrecorded change silently takes effect.
    History and Restore use revision-bound comparisons, record a new receipt, preserve intervening
    edits and allow removal of an override to restore the default. Restore cancels active holds too.
    Do not reuse `merge_mode.changed`; a maintainer-owned settings contract is required.
  - Criteria, in order: keyboard access works immediately; deliberate holding preserves accidental-
    merge protection; disabling and duration control remain approved settings work, deferred because
    persistence, receipts and Restore require contracts.
- Settings themselves: every save gets a receipt, history, diff and Restore, with provenance (file, environment, default) and next-run application; this front precedes agent settings proposals (available from M5).
- Every setting can be suggested, prepared or applied by an agent within the person's grants, never widening its own authority. Otherwise a typed, revision-bound proposal needs the person's click on an Oversight-rendered card (exact change, scope, what loosens, indicator; never stealing focus) or their own chat message bound to that visible proposal, never file content, tool output or another agent; receipt and Undo follow. Words suffice except safety loosening (grants, tests off, unsandboxed execution, secret access), which asks for one click unless the person enables words for it. The settings-proposal front follows M5's contracts and settings-history fronts and the maintainer's contract review (available from M5).
- **Policy dry-run:** replay recorded decision inputs against a proposed rule or gate. It needs principle 4's captured inputs, not just the log.

**M6 · IDE essentials.** Gate: none for the first items. LSP benefits from M1.
- File create, rename and delete for the person; editor tabs and splits; quick open; a command palette; remappable keybindings; a settings file with profiles; structured settings recommendations in Chat.
- Every default from principle 1 exposed in settings: steps (capped at 100 today, `backend/src/oversight/settings.py:250`), tool-output limits (`backend/src/oversight/agents/tools.py:39`) and optional graph loading (`docs/additions.md:288`).
- Reverting personal and historical merges: configurable; default = today's behavior; indicator "custom revert scope" (available from M6).
- Merge target, strategy and message template: configurable; default = today's behavior; indicator "custom merge settings" (available from M6).
- Coordinated multi-file editing and grouped commits: configurable; default = today's behavior; indicator "grouped edits/commits" (available from M6).
- Layout, startup, tabs and navigation profiles: configurable; default = today's behavior; indicator "custom workspace profile" (available from M6).
- Graph visibility, filters, selection, arrangement and scale: configurable; default = today's behavior; indicator "custom graph view" (available from M6).
- Attention behavior (unfolding, notices): configurable; default = today's behavior, no focus theft; indicator "custom attention settings" (available from M6).
- Presentation and motion: configurable; default = today's behavior, following the OS motion setting; indicator "custom presentation/motion" (available from M6).
- Time zone and format (OS time zone by default) and original replay gaps: configurable; default = today's behavior; indicator "custom time/replay settings" (available from M6).
- Fast project search and replace (ripgrep-class, Rust); optional local semantic index.
- LSP through a backend proxy (diagnostics, definition, references, hover, rename), feeding agents' symbol tools in every language.
- A source control view: changes, staging, commit, branches, history, blame, GitHub PRs.
- The review loop, complete: accept per hunk, and comments anchored to a revision, file and line that go back to the agent. Hosted CLIs receive them through their own user-message or resume interface. Today a revision request carries one general comment and decision-card answers, with no anchors (`contracts/src/oversight_contracts/commands.py:104`). The first compare-and-merge flow for parallel attempts comes with it.
- MCP client for agents (configured servers, run per principle 3).
- The manual review request and dictation endpoints, which return 501 today.
- Design polish from the backlog: Day theme, live theme switching, the planned review and graph animations.
- Debugging (DAP), later in the milestone.

**M7 · Rust core and scale, measured.** Gate: profiles of the real paths under load.
- These come through M3, M4 and M6: the sandbox, the PTY host, the watcher, search and indexing.
- Measure the event store with SSE, the git and test layer, and graph extraction. Move what the numbers justify into one Rust core process (local IPC) or PyO3 modules.
- Incremental engine, worktree pool, git scaling, batched merges and sparse worktrees (`docs/additions.md:158`).
- Provider calls, prompts, policy orchestration and React stay where they are.
- Runtime locations, identifiers and Git identity policies: configurable; default = today's behavior; indicator "custom runtime/Git identity" (available from M7).

**M8 · Platforms and distribution.** Gate: M3 per platform.
- macOS port and signing; Linux AppImage or deb.
- Auto-update (Tauri updater) and signed builds.
- Opt-in crash reports.
- Desktop background sessions, readiness and shutdown budgets, native window preferences and installer consent: configurable; default = today's behavior; indicator "custom desktop settings" (available from M8).

**M9 · Remote, team and extensions (later).**
- SSH remote worktrees, cloud and background agents, shareable runs, team policies, and phone review and approvals.
- A general plugin API (actions, workflow nodes, panels, hooks), once the workflow contracts are stable.
- A workflow marketplace.
- Explicit HTTPS authorities only after authentication exists: configurable; default = today's behavior, loopback only; indicator "remote authority" (available from M9).

**M10 · Evidence and review intelligence (Oversight's edge).** Gate: an evidence-quality acceptance before any of it widens automatic merge policies. Historical paid detection arms failed their criteria (`tools/eval/detection/RESULTS.md:22`), and current results must be re-verified, not inherited.
- Examples-before-code admission (`docs/additions.md:816`).
- Executable pins, lenses and node explanations.
- One-hop initial context.
- Deeper overlap facts and start-box warnings.
- Coverage: per test and graph-selected.
- A dependency guard: existence, license, vulnerabilities.
- Repository hooks and formatter diffs as evidence.
- Counterexample agents, executable disagreement and independent attempts (`docs/additions.md:345`, `docs/additions.md:347`).
- Decision probabilities and learning from past answers, after M6's review loop works: a person must be able to inspect, annotate, revise and compare real changes first.
- Retrospectives.
- Benchmarks UI, real-repository benchmarks and canary workflows.
- Generic generative-view composition, after the same review loop.

**Malfunctions track (continuous, high priority in every sweep).**
- A long suite blocks Approve behind main's locks.
- Unverified preview cleanup quarantines Git and Approve.
- Preview refusals: the numeric-loopback shop adapter and the reviewed self application.
- Shape-analysis timeouts leave worker threads running (DECISIONS.md:3332).
- Behavior evidence misses file effects and randomness (`tools/eval/detection/RESULTS.md:60`).
- Interrupted accounting can need manual settlement.
- Graph and editor colors only change after a reload.
- The workflow panel shows "Not known".
- Every item is closed with a regression test, and historical results are kept apart from current verification.

**Bounded event log (cross-cutting, gates M2 capture and M4 capture).**
- Today the store's ingestion queue is unbounded, and it keeps every committed event in memory twice, serialized and parsed (`backend/src/oversight/events/store.py:218`, `backend/src/oversight/events/store.py:497`). Sustained CLI or terminal output needs a resource design before capture ships.
- Bounded ingestion with backpressure, historical reads from disk, and acceptance tests for long runs and slow SSE clients.
- Required in any language. Moving the store to Rust stays conditional on M7's measurements.

**Secrets (cross-cutting, gates M2 capture and M4).**
- Filename filtering is not redaction (DECISIONS.md:3084). Credentials stay isolated from tool children.
- Configurable exclusion and redaction apply to model requests, the event log, terminal capture, exports and reviewer diffs. Agent access to secret files needs an explicit person grant, visibly labeled "secret access granted", logged and revocable (available from M2); filename refusal stays today.
- Any remaining exposure is disclosed before a new capture path ships.

## Planned capabilities: where each goes

Each planned capability family maps to a milestone or an explicit deferral:
- M1: session branches and integration; native-agent file create, rename and delete; per-language evidence capabilities; non-Python repositories, JUnit and the TypeScript graph; lead persistence; desktop qualification; remembered repository; clone-mode sources; in-app discard; log viewing.
- M2: outside agents; local models; usage views and projections.
- M3: role-based sandbox; isolated tests and probes; WSL, Windows and macOS isolation.
- M4: human terminal; preview items.
- M5:
  - workflow zones, edit, locks, modes, action nodes;
  - saved flows and libraries;
  - fresh-context plan review and related-doc evidence;
  - grants; protected-area plans; zones;
  - merge queue and waiting stages; checklists and todos; continuation and handoffs;
  - memory, rules, standing instructions and review lessons;
  - run forking.
- M6: file operations for the person, anchored review comments and compare-and-merge, history and Changes navigation, the Plan tab; optional graph and semantic groups; map names; named cursors; manual review and dictation; design polish; scripted-agent provenance labels; settings recommendations.
- M7: incremental engine, runtime tracing, worktree pool, git scaling.
- M9: team and PR integrations, shareable runs, marketplace, live phone review.
- M10: examples-before-code, pins and lenses, explanations, one-hop context, overlap facts, coverage, dependency guard, repository hooks as evidence, counterexamples, specialist engine, independent attempts beyond M6's first compare-and-merge, disagreement, probe generation, decision probabilities, learning from answers, retrospectives and exported decision pairs, benchmarks and canary, typed-primitives generative views (after M6's review loop) and reference-view release qualification.
- Deferred or declined:
  - RAG is not planned now beyond evals; opt-in if ever scheduled.
  - Automated video takes and gallery captures stay outside the repository.
  - The training room and fine-tuning are not planned now (`docs/additions.md:427`); opt-in if ever scheduled.

## Decisions

All 12 decisions were approved as recommended by the maintainer on 2026-11-05; each lists the choice first and the alternative considered (or what was not chosen where no alternative was approved). The 2026-11-05 settings ruling amends the product limits in place below; authority, visible/logged/reversible loosening, provider terms, law and licenses stay fixed.

1. **Rust scope.**
   - Choice: targeted. Rust for the OS boundary (sandbox, PTY, watcher, search, desktop) plus measured migrations; Python keeps orchestration and providers.
   - Alternative: a full backend rewrite as the goal. It means months, and the risk to roughly 13k pytest checks.
2. **Agent shell.**
   - Choice: native agents get a shell tool inside the sandbox by default once M3 qualifies, or in an explicitly M1-trusted repository before qualification, labeled "unsandboxed"; policy-gated, defaulting to ask (available from M4).
   - Alternative: keep no shell.
3. **Person's terminal.**
   - Choice: unsandboxed by default, as in any IDE, under the shared authority policy (available from M4); sandboxed option once M3 qualifies, remote only later in M9, labeled.
   - Alternative: sandboxed by default.
4. **Key storage.**
   - Choice: the OS keychain by default, with `.env` as the development fallback; `.env` or another supported store by the person's per-repository choice (available from M2).
   - Alternative: `.env` only.
5. **Model SDKs.**
   - Choice: the OpenAI SDK for compatible endpoints, plus the official Anthropic and Google SDKs for native features (caching, thinking), behind the provider contract. No LiteLLM.
   - Alternative: OpenAI-compatible only.
6. **Extensions.**
   - Choice: MCP now (M6), and a plugin API once the workflow contracts are stable (M9).
   - Alternative: VS Code extension compatibility (Open VSX). That would mean hosting a VS Code extension host, which is very large.
7. **Sandbox implementation.**
   - Choice: decide in M3's security plan, comparing a narrow bubblewrap exception (LGPL, a separate binary) against a Rust helper using Landlock and seccomp crates, on security coverage and maintenance. Close today's gaps first with the existing launcher.
   - Alternative: rule out bubblewrap now on license grounds.
8. **Platform order.**
   - Choice: Linux and Windows first, with Windows acceptance in M1; macOS when its M3 sandbox is ready.
   - Alternative: macOS earlier, for reach.
9. **Order after M0.**
   - Choice:
     - M1, M2 and M3 in parallel from the start;
     - the person's terminal (M4) once its security plan is reviewed;
     - M5's canvas and editing in parallel; its executable actions after M1's recovery and the action contracts; hosted nodes after M2;
     - the agent shell after M3 qualifies or under explicit M1 repository trust, labeled "unsandboxed" (available from M4);
     - M6 progressively;
     - M10 after its evidence gate.
   - Execution features ship per platform under principle 3.
   - Not chosen: run the milestones sequentially, delaying independent work behind earlier deliveries.
10. **Hackathon rules.**
    - Choice:
      - "All code new since kickoff" ends.
      - Third-party code comes in only as licensed dependencies.
      - The cross-provider review on every merge stays.
      - The freeze rule stays until he lifts it.
    - Not chosen: retain the hackathon-only rules after judging, limiting the broader product.
11. **Usage ledger timing.**
    - Choice: build the M2 usage and cost ledger as a backend module with its tests and fixtures (log parsers, dated price books, agent-hours, unknown never zero) after judging ends and the GitHub freeze lifts; until then only its specification and the hosted-agent capture are built.
    - Alternative: start the ledger now.
12. **Trusted mode before the sandbox.**
    - Choice: allow per-repository explicit trust for unsandboxed execution, off by default, disclosed, labeled "unsandboxed" and with verified cleanup (available from M1). The person may grant shell, network, installs and protected paths per repository, workflow, block or run, always policy-gated and defaulting to ask; workflow/block settings are available from M5. Cleanup failures block by default; a person-authorized run exception says "cleanup unverified" (available from M1, extended in M3). Real users can then use M1 and M2 before M3 qualifies their platform; today's native Windows behavior remains qualified separately.
    - Alternative: block execution until the sandbox is qualified.

# Oversight roadmap

Status: approved by the maintainer on 2026-11-05; base main 498639ff. Canvas, WSL and Linux own-repository admission plans approved on 2026-11-06, recorded against main c943a5ae. This plans the work after the hackathon and does not change today's rules until the fronts it names land.

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

**M1 · WSL repositories and Linux admission fronts.** Approved 2026-11-06. Planned, not delivered; this extends M1 without waiting for general language support. Sizes S/M/L are relative; dependency order follows below, with 2a independent of F1-B.
- Product criteria, in order: automatic setup makes opening comfortable; a Linux backend in the selected distro fits the maintainer's repository/agent workflow; prefetch, distro, cache/retry and lifecycle budgets remain person-configurable. Expose settings only as their implementation lands.
- **F1-B · authenticated callers and credential handoff — M.** Gate: complete the private framed IPC and caller authentication before desktop WSL work. Keep diagnostic stderr separate; send a fresh per-launch credential only over the child's private pipe, never argv/files/environment/logs or repository descendants. Preserve Host/Origin checks (`ARCHITECTURE.md:26`); final contracts go to the maintainer.
- **2a · Linux own-repository admission — three L slices, then M.** Gate: its approved plan and contract review, no F1-B dependency. Backend-only native Linux/WSL source launches preserve disposable COPY, unchanged originals and no automatic writeback (`docs/own-repository.md:9`). Deliver these four slices in order, splitting each L into small changes; public enablement comes last:
  1. **Admission and Git layouts — L.** Replace recursive metadata traversal (`backend/src/oversight/workspace/source_posix.py:282`) with bounded HEAD/index/config/ref/info-attributes witnesses, without walking objects. Accept linked `.git`-file worktrees, `.git/worktrees`, shallow clones, hard-linked local-clone objects and large loose-object stores. Validate gitdir/commondir identities and shared/worktree config before queries, using no-includes inspection (`backend/src/oversight/workspace/source_config.py:57`); warn about stale locks without deleting them, retry changed witnesses. Keep no-follow/hash checks, private staging and refusal of source links, special files, transforms and unrepresentable snapshots until verified COPY handling exists.
  2. **Environments and isolation — L.** Discover `OVERSIGHT_REPOSITORY_VENV` → `.venv` → `venv/`, including external Poetry/pyenv environments. Qualify CPython 3.8+ with no upper pin; warn, never refuse solely for end-of-life. Use bounded isolated executable/version/abiflags/purelib/platlib probes, including venv bases under `-S` and `python3.13t`. Older minors need postponed annotations, evaluated-cast/observer compatibility, updated probes and pytest>=8.2,<8.4 with pluggy>=1.5,<1.6; probe modern compatible versions. Generalize async preparation, `-I/-S`, editable mapping and POSIX import guards. Defer system-site-packages until extra roots can be validated/remapped. Unsupported environments keep graph access; never install or substitute.
  3. **Shared recovery and audit — L.** Startup order: placements → lock → previous-runtime guard → disclosure → inventory/validation/staging/reverification → journaled reset/publication → fresh raw-byte Git bootstrap, with hooks/transforms disabled and dirty/untracked inputs/deletions preserved. Port changed-main/ambiguous-reset protection and shell-quoted binary export/check/manual-apply guidance (`backend/src/oversight/workspace/source_nt.py:865`, `backend/src/oversight/workspace/source_nt.py:907`). Unmerged/dirty agent worktree discard asks with No as default; noninteractive authority is process-only, bound to exact main plus a digest of refs/dirty/untracked bytes, rechecked before destruction and never read from `.env`.
  4. **CLI, runtime and factory integration plus documentation — M.** Add `serve --repository PATH`: lexically absolutize against cwd, preserving case and checking traversal before normalization; flag > environment > `.env`, selected before `Settings.load` for factory/`--reload`. This supersedes the no-source-selection-CLI text in `DECISIONS.md:5039` when implemented. Platform dispatch replaces Windows-only composition (`backend/src/oversight/app.py:269`, `backend/src/oversight/workspace/core.py:627`). The approved `docs/own-repository.md` edit lands here, not in this recording front.
- **2a placement and policies.** Let B be the pre-selection runtime setting (default `REPO_ROOT/.runtime`, `backend/src/oversight/settings.py:93`): demo uses B; profiles use B/profiles/name/.runtime; repositories use B/sources/sha256(exact-case-absolute-path)/.runtime with stored identity verification. Switching preserves every source's runtime and agent work. All sources share `OVERSIGHT_LEDGER_DIR` (default B), including provider/decision ledgers, unknowns, recovery markers and `ledger.lock`, so spending never resets on selection.
- **2a filesystem and trust.** Admit verified user-private groups including primary GID (`umask 002`); other writers need a warning-backed person setting. DrvFs needs `metadata,umask=022` or explicit writer-risk acceptance; allow boolean `core.symlinks`, warn on case-insensitive directories and retain actual names/exact-case keys. Runtime, locks and SQLite stay on Linux; admission budgets become settings. Refuse running Oversight development worktrees, aliases/shared-common-directory identities and reviewed-self admission/execution. Disclose actual UID/root, providers and exposure; trust stays informational (`AGENTS.md:55`, `AGENTS.md:62`, `AGENTS.md:63`).
- **2a audit and test gate.** Propose `source.admission` receipts for selection, policies/providers, warnings, environment/limits, discard authority and reversal; reuse `run.started.workspace` and `error`. Before the store exists, redacted append/fsynced attempt IDs go to a private `oversight/startup-audit` directory under the person's Linux state directory (XDG state home); import after the next `run.started`, deduplicate and acknowledge only after commit. Failed persistence refuses loosening. Final contract diff goes to the maintainer (`AGENTS.md:38`). Extend closed refusals with missing-git, source-permissions, unsafe-git-config, source-changed, source-budget-exceeded, runtime-unavailable, running-oversight-source and previous-session-pending; retain existing categories. Environment/isolation failures mean tests unavailable.
- **2a execution and acceptance gate.** Readiness/probes/suites use IsolatedRunner, overriding own-suite best-effort fallback: network/PID isolation, no filesystem isolation (`AGENTS.md:61`). Blocked namespaces leave graph access and diagnosis/remedy, including AppArmor's `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` with restoration of the previous value. Unsandboxed tests need a separate maintainer AGENTS.md change. Keep whole-repository discovery and person-owned frozen timeouts (`AGENTS.md:60`). Fake-only tests cover Git layouts/mutation, crash/reopen/cancel, originals, consent, shared spending and switching away/back with work preserved; cached uv matrix: 3.8/3.9/3.10/3.12/3.13t/3.14 venvs, focused tests under the 3.12 backend within 20 minutes. DrvFs CI is simulated; acceptance needs native Linux/WSL and real `/mnt/c`, Windows dispatch regressions, full merged-tree verification and two cross-provider reviewers, one Opus.
- **2b · desktop WSL selection — M selection scope.** Gate: F1-B and 2a. Extend File > Open repository… and SelectedSource for `\\wsl.localhost\<distro>\...` and `\\wsl$\<distro>\...`; validate registered distro, reject traversal/other UNC hosts, map to distro plus absolute Linux path and key runtime on exact case. Preserve native drive/case restrictions (`desktop/core/src/source.rs:32`). Refuse WSL1 with conversion guidance, absent WSL/distro with install guidance, missing Git with distro-specific guidance and unsupported CPU/libc with a supported glibc x86_64 remedy; probe the payload's actual glibc minimum. Disclose actual distro user/UID, including root; WSL2 is no filesystem sandbox.
- **Payload and distribution — L, or M plus a notices slice.** Gate: selection requirements plus the decisions “Follow the newest stable CPython when dependencies support it”, “CPython license scope for the desktop distribution” and “License policy by terms” must land before publication. Stage Linux CI artifacts from the same commit: backend-pinned CPython (never distro Python), noneditable backend/contracts wheels, hashed locked dependencies, assets and component notices. The separate 3.15 upgrade is not part of this plan. Generate the app's release URL/SHA-256 pin; CI uploads candidates with read-only release permissions, and the maintainer publishes beside the installer on development releases/tags.
- **Payload ownership gate.** Download atomically to `%LOCALAPPDATA%\Oversight\cache\wsl\<commit>-<hash>`; verify before safe extraction (no traversal/links), deploy privately to `oversight/runtime/<commit>-<hash>` under the distro user's Linux data directory (XDG data home), reverify and publish atomically. Refuse mismatches; offline first use offers retry or a person-chosen archive under the same pin. Updates remove superseded owned payloads only after shutdown; uninstall removes recorded deployments but preserves settings/workspaces. Unavailable distros get visible deferred removal and exact manual recovery instructions; deletion needs ownership evidence.
- **Transport and lifecycle — L.** Gate: F1-B, 2b and verified payload. Prefer length-prefixed validated HTTP/SSE over owned child stdio; parse failure is transport loss, stderr alone carries diagnostics including `wsl.exe` output. An owned proxy preserves `http://127.0.0.1:8710`, independent of localhost forwarding/mirrored networking, with proxy/Linux listener ownership, authenticated health, matching commit and SSE resume. Launch system `wsl.exe` with explicit distro/argv, async ownership/timeouts and readiness/cancel/crash/close/switch supervision.
- **WSL cleanup gate.** Windows Jobs stop `wsl.exe`, not all Linux descendants: a Linux child subreaper supervises a separate backend session/process group, with PR_SET_PDEATHSIG tied to the supervisor. EOF/signal/backend exit triggers TERM, five seconds, KILL and bounded adopted-descendant reap; escaped `setsid` survivors mean failed cleanup. Persist process-group/leader start-time identity in `oversight/state` under the distro user's Linux data directory (XDG data home); an owned fallback `wsl.exe -d <distro> --exec` reaper rechecks identity (refusing reused PIDs) before the same cleanup. Never use `wsl --shutdown` or `--terminate`. Visible configurable budgets cover distro start, download stall detection, deploy/reverify, then the 120-second readiness from backend launch.
- **WSL state and accounting gate.** Linux event log, locks and local state remain on the Linux filesystem, never locked/renamed through `/mnt/c`. The installation's shared provider/decision ledgers, unknowns and `.unreliable` marker stay on Windows (`desktop/README.md:62`): private-channel reserve/settle and settings saves execute there under Windows ownership/`ledger.lock`. Channel failure allows paid runs with a WSL-local ledger seeded from last-known totals, labeled as separately tracked; reconnect merges entries exactly once under the Windows lock. Log failure and reconciliation; the spending brake keeps counting.
- **Installer, settings and acceptance — M.** Gate: verified transport/lifecycle/payload and native evidence. Prefetch automatic/on/off: automatic checks WSL support when WSL plus any distro exists, otherwise unchecked; checked pre-downloads and offline falls back to first use. Unchecked still permits WSL. Read the single Windows `.env` in place via `/mnt/c` and `OVERSIGHT_ENV_FILE`, never copy or write it from Linux; preserve reopen guards. Rust units cover mapping/verification/launch errors/timeouts; fake-only CI covers framing/SSE, credential leakage, cleanup/update/uninstall. Maintainer-machine Windows+WSL acceptance covers networking modes, settings reload, crashes and switching. Lifecycle/authority fronts require full verification and two cross-provider reviewers, one Opus.

**M2 · Any model, any harness.** Gate: M0. The contract changes are his. Hosted-CLI capture also needs the bounded event log and the Secrets gate.
- An extensible provider contract. Built-in adapters cover Anthropic, OpenAI, Google, Meta, OpenRouter, any OpenAI-compatible endpoint and local models (Ollama, LM Studio, vLLM), and a person can add their own. Each adapter declares:
  - authentication;
  - tool protocol;
  - reasoning control;
  - price;
  - which features it supports, negotiated before use.
- It covers every model-using role, not only lead, coder and reviewer. Decision and example calls are included; today they pin Spark Open (`backend/src/oversight/agents/decision.py:219`) and the contracts restrict provider identities (`contracts/src/oversight_contracts/events.py:55`).
- **Ordered per-role model fallback** (planned; available from M2).
  - The person configures an ordered model list for each role. No capacity, quota exhausted or persistent 5xx triggers the next eligible model; when none is left, wait or stop, default wait. Existing spending and authority controls still apply.
  - Cross-provider review stays the default. If its reviewer is unavailable, same-provider review requires the person's explicit choice as a loosening: visible, recorded in the event log and reversible; agents cannot authorize it.
  - C: fewer manual model changes while work waits; H: keep the maintainer's parallel agents moving across roles; K: person-owned order per role, wait/stop selection and an explicit reversible review exception.
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
  - live hourly and daily views, spend projections, and fixed-context accounting (`docs/additions.md:325`, `docs/additions.md:698`);
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
- Policy per profile (filesystem, network, processes), with escalation requests surfaced as approvals. Role-based filesystem access, approved exits and repository access memory (`docs/additions.md:201`, `docs/additions.md:372`).
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
- Plan editing and workflow files: M0; the persistent workspace canvas has its own milestone immediately after M5 below.
- Executable workflow actions: approved action contracts plus M1's durable recovery. Today the dispatcher starts with an empty queue after a restart, and plan subtasks are agent work, not separately identified actions (`backend/src/oversight/runtime_queue.py:49`, `contracts/src/oversight_contracts/plans.py:26`). Each action records a durable intent and its outcome. An interrupted external action is reconciled before any retry.
- Hosted-agent and profile nodes: also M2.
- Automatic partitioning: the stricter gate below.
- From `docs/additions.md:282` and `docs/additions.md:745`:
  - plan editing in the UI, with stable identities across edits;
  - person-only locks by default; person-configured delegation (available from M5);
  - observe, guided and strict modes, person-owned by default and configurable by the person (available from M5);
  - optional gates; tests, independent review and evidence gates on by default, configurable per repository, workflow or block, labeled "untested", "review off", "evidence incomplete"; unknown never passes (available from M5);
  - action nodes: tests, review, lint, a sandboxed command, ask the person, run a hosted agent, wait for merge;
  - a visible merge queue and waiting stages;
  - evidence checklists and agent todo lists;
  - the native agent's todo list is 2–6 verifiable goals derived from the instruction, each with a checkable done-condition (a test that must pass, a file or symbol that must or must not change). The person sees and edits them; the harness marks goals met from tool calls, never text. Finish with open goals gets one reminder then "goals unmet"; no-progress stopping counts goals met. On by default in the harness pack once measured with the eval; goal count, required OK and block-or-label are configurable (available from M5), with a visible goal-policy indicator. Hosted CLIs keep their own todo lists, shown, not wrapped;
  - halted-agent continuation, revision context and visible handoffs (`docs/additions.md:242`).
- **Automatic partitioning:**
  - It ships only with complete server-owned evidence, with explicit uncertainty that covers imports and inheritance (`backend/src/oversight/changes/_partition.py:1`).
  - Its fallback is conservative by default: one agent wherever independence is not established. The person may choose manual zones or overlap, labeled "independence unverified" (available from M5); the automatic splitter still needs its evidence gate.
  - The split benchmark must pass first.
  - Until then, leads keep the whole-graph zone (`backend/src/oversight/runtime_leads.py:263`).
- Workflows as versioned repository files (for example `.oversight/workflows/*.yaml`), a library, and contextual selection.
- **Versioned gates and workflows with one-click rollback** (planned; available from M5).
  - The current version is the default. The person returns to the previous version in one action, per repository or per workflow.
  - Returning to an earlier version is a loosening: visible, recorded in the event log and reversible. Authority stays with the person; agents cannot grant themselves a rollback.
  - C: no waiting when a new gate fails; H: give the maintainer and his parallel agents a direct return to the previous working version; K: person-owned repository/workflow selection with the current version as the safe default.
- Hooks and policy as configuration:
  - event-to-action rules (pre-tool, post-edit, pre-merge);
  - a rule and gate editor that replaces the code tables (`backend/src/oversight/changes/_assessment.py:34`, `backend/src/oversight/changes/_protected_paths.py:20`);
  - broader grant scopes, protected-path grants, expiry and free-text grants (`docs/additions.md:958`), person-owned by default; lead delegation per workflow or plan is revocable, and rules can approve everything by the person's choice (available from M5);
  - person-drawn zones and approved growth (`docs/additions.md:273`).
- Repository memory, rules files, skills and review lessons (`docs/additions.md:973`).
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

**Canvas · Persistent creative workspace (after M5's core).** Approved 2026-11-06; front 0 complete, implementation fronts planned. Placement does not serialize independent work: front 1 follows M0, workflow control fits M5, IDE integration M6; composition follows M6's review loop.
- Product criteria, in order: the familiar graph-plus-agents board lowers setup; live code/workflow/agent objects support the maintainer's working practice; per-repository boards/cameras, person grants and settings in each front keep control configurable. The three-view/startup decision belongs to “Code joins Chat and Oversight; reopen the last workspace view”.
- **0 · engine measurement — S, done: engine A (owned DOM core).** Gate met by identical prototypes: 500 objects, a live 1,000-node graph and three preview fixtures. Against React Flow: drag 30 vs 47 ms, marquee 42 vs 72 ms, heap after pan 36 vs 58 MiB, about 2.5 vs 63 KB gzip added. Smoothness tied (4.69% vs 4.49% frames over 20 ms on a loaded host); this is comparison evidence, not quiet-host target acceptance. The measurement-only spike never lands. Keep camera/selection/connectors behind the owned interface, no fork; perfect-freehand and roughjs (MIT) supply drawing. Front 1 must find/remove the observed 100–194 ms zoom long tasks.
- **1 · core/default board/history, board store and access — L.** Gate: M0, design pass under DESIGN.md/Impeccable and implementation approval; final board-event contract diff goes to the maintainer. First Oversight board reproduces graph-plus-agents. The graph becomes removable/restorable; remember maximize, board and camera per repository. Decisions chip, status and agents rail stay outside the board. Panels/cameras change only through person navigation; graph growth offers Go there instead of automatic reframing (`frontend/src/graph/GraphView.tsx:388`). The implementing front replaces `AGENTS.md:67`; today's rule stands until then.
- **1 · persistence/access gate.** Stable object UUIDs own position/size/z-order, groups/frames/boards; connectors bind object/port IDs and grant no execution. Repository-scoped server snapshots/assets/revisions survive runs. A separate append-only board store/stream is needed because run logs are per run (`ARCHITECTURE.md:93`): WAL, one writer, increasing seq, SSE/Last-Event-ID, batched gesture transactions, periodic snapshot revisions and shared live/replay reducer pattern. Undo appends compensating events without rewinding agents. Keyboard move/resize/connect, visible focus, screen-reader outline and a phone object list with equivalent actions replace the widen-window rules at `DESIGN.md:685`, `DESIGN.md:750` and `DESIGN.md:992` when implemented.
- **2 · object library and panel drag-in — M.** Gate: front 1's stable identities/history; workflow editing also needs M5's stable workflow identities. Built-ins: graph, workflow, sticky, text, image, UI component, app view, browser, message, live editable Monaco file, diff and agent. Dragged messages/files/diffs/agents are live references (repository/run/entity, message seq, path/change revision); missing sources retain provenance, and Freeze copy explicitly makes a labeled snapshot. Repository-local persistence comes first; export is explicit and credential-free, separate from environment settings.
- **3 · previews/browser/tests/usage/connectors, presence and assignment — L.** Gate: front 2 and qualified lifecycle/isolation for each executable object. Refactor single-owner preview admission (`backend/src/oversight/workspace/preview.py:167`); Windows/reviewed-app execution and multiple previews need their own qualification, with cleanup/gateway CSP retained. Event/tool-call contact with any referenced path/entity/run lights the object in its team's color, assigned or not; dashes mean only pending changes. Drop agent, Ask an agent or plain prompt starts a person-issued scoped task, including sticky-to-task.
- **3 · browser/session gate.** Default: linked tab in the person's signed-in browser, mirrored only through browser screen-share consent. Credential-free pages that permit framing use isolated frames; desktop native webviews remember one sign-in (OS account sign-in where supported), live while focused at full zoom and snapshots otherwise. Never read another browser's cookie store. Sign-in stays in its view; no agent cookies/page content without a visible revocable object-reading grant. The optional person-installed companion extension streams the real tab/forwards input with browser control banner, only after its own plan and double review.
- **4 · granted agents, generative UI/tools and custom types — L.** Gate: front 3, M6's complete anchored review/compare-and-merge loop, qualified generated-content isolation and final maintainer contract review. Composition moves here from M10 (canvas decision 8). Amend `AGENTS.md:58` for `canvas_patch`/`browser_read` only in the implementing front. Grants cover board/region/kind/operation; default grant scope is create/edit/move/delete within a person-chosen frame. Patches are attributed, revision-checked, replayable and undoable, with no automatic focus/camera movement.
- **4 · authority/type gate.** Extend the closed catalog (`DECISIONS.md:4476`) using reference-resolving LeadViewCard and read-only WorkflowCanvas patterns. Oversight host chrome identifies type/author/team and owns Approve; generated content cannot imitate/host Oversight controls. Isolated origins/frames use CSP and validated capability messages, no person's session credential or parent API; today's preview iframe does not qualify this boundary. Assertions remain labeled generated content; evidence/status resolve from events. Types are manifest (name/icon/inputs/live refs/schema/requested capabilities/actions) plus declarative primitives or isolated-code renderer, written with `edit_file`, previewed as ordinary pending changes and added to the repository library on Approve. Save to my library reuses across repositories; export shares files under “License policy by terms”. A type sees only placed data; path/event/test/network capabilities need visible logged revocable per-type grants. Board, tool and manifest contract changes are approved in principle; final diffs return to the maintainer (`AGENTS.md:38`).
- **5 · drawing and templates — M.** Gate: front 4 plus bounded ingestion before drawing volume; use the selected MIT drawing dependencies. Each increment remains independently usable, with its settings delivered alongside it.
- **Every canvas front's performance/storage gate.** Measure production bundles on the same benchmark board: configurable targets of ≤1% frames over 20 ms on a quiet host, interactions ≤100 ms and added canvas JS ≤100 KB gzip. This replaces the proposed p95 16.7 ms target, not a claim that the spike passed. Default asset/snapshot budget 5 GB per repository, warning at 80%, pruning only by person action or chosen policy; event batching alone does not bound disk (`backend/src/oversight/events/store.py:206`, `backend/src/oversight/events/store.py:218`). Virtualize, lazy-load editors and snapshot offscreen/zoomed-out heavy objects without implicitly stopping processes. Per-object keep alive, attention-based mirror rate (smooth focused/low visible/off offscreen), suspended hidden desktop webviews, a person-set live-object count with warning and no mandatory cap; desktop shows per-object/total memory, browser shows live count because other sites' memory is not measurable.
- **Every canvas front's acceptance gate.** Fake-only live/replay, Undo/restart, isolation, keyboard/phone/outline and load evidence. Fronts 1/3/4 require full verification and two cross-provider reviewers, one Opus; 2/5 do too when touching authority/contracts/lifecycle/event-log code (`AGENTS.md:45`). Preserve shell spacing, theme/team/state tokens, neutral stickies, no amber, pending-only dashes, event-caused motion and reduced motion (`DESIGN.md:564`, `DESIGN.md:644`, `DESIGN.md:1717`, `DESIGN.md:1760`).
- **Further object directions, each configurable as delivered:** annotated preview captures anchored to revision requests; agent rooms; side-by-side attempts; idea clusters turned into linked plans/tasks; run timelines; test maps; pinned functions; acceptance examples linked to tests; decision journals linked to events; dependency/license evidence; usage/spend gauges; sandboxed credential-free web-reference snapshots labeled untrusted. Terminal objects wait for M4, voice notes for dictation. A person-written command button shows/logs its command and agents need a grant to press it; execution waits for its own approved plan.

**M6 · IDE essentials.** Gate: none for the first items. LSP benefits from M1.
- File create, rename and delete for the person; editor tabs and splits; quick open; a command palette; remappable keybindings; a settings file with profiles; structured settings recommendations in Chat.
- Every default from principle 1 exposed in settings: steps (capped at 100 today, `backend/src/oversight/settings.py:250`), tool-output limits (`backend/src/oversight/agents/tools.py:39`) and optional graph loading (`docs/additions.md:298`).
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
- Incremental engine, worktree pool, git scaling, batched merges and sparse worktrees (`docs/additions.md:170`).
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
- Examples-before-code admission (`docs/additions.md:845`).
- Executable pins, lenses and node explanations.
- One-hop initial context.
- Deeper overlap facts and start-box warnings.
- Coverage: per test and graph-selected.
- A dependency guard: existence, license, vulnerabilities.
- Repository hooks and formatter diffs as evidence.
- **The person's CI as verification evidence — large, later work** (planned; available from M10).
  - Push the agent branch, dispatch the person's workflow and feed failed-job log tails into the next revision. Verification is configurable per repository: local, CI or both; local is the default, preserving today's behavior until this lands.
  - The push is an outward action requiring the person's explicit authority and is recorded in the event log; workflow dispatch follows that authority too. Loosened verification is visible, recorded in the event log and reversible; agents cannot widen authority.
  - C: revision feedback without manually copying CI logs; H: use the repository's own verification workflow for the maintainer's agent changes; K: person-selected local/CI/both per repository and explicit authority over outward actions.
- Counterexample agents, executable disagreement and independent attempts (`docs/additions.md:355`, `docs/additions.md:357`).
- Decision probabilities and learning from past answers, after M6's review loop works: a person must be able to inspect, annotate, revise and compare real changes first.
- Retrospectives.
- Benchmarks UI, real-repository benchmarks and canary workflows.
- Generic generative-view composition moves out of M10 to canvas front 4, after M6's complete review-loop gate. M10 retains evidence intelligence and reference-view release qualification; composition no longer waits for M10's evidence gate.

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
- **Diff scan before Approve** (planned; available from M2 alongside Secrets).
  - Scan the agent's diff for secrets, private paths and the person's forbidden markers. Findings appear on the approval card as warnings, not blocks; markers are configurable per repository. The scan is on by default.
  - Turning it off is the person's loosening: visible, recorded in the event log and reversible. It matters most once applying to the repository or opening PRs exists; a scan never grants either action.
  - C: exposure warnings beside the approval decision; H: check the maintainer's agent changes before they leave the disposable workspace; K: repository-specific markers and a person-owned, reversible on/off setting.
- Any remaining exposure is disclosed before a new capture path ships.

## Planned capabilities: where each goes

Each planned capability family maps to a milestone or an explicit deferral:
- M1: session branches and integration; native-agent file create, rename and delete; per-language evidence capabilities; non-Python repositories, JUnit and the TypeScript graph; lead persistence; desktop qualification; remembered repository; clone-mode sources; in-app discard; log viewing.
- M2: outside agents; local models; ordered per-role model fallback; pre-Approve diff scan (Secrets); usage views and projections.
- M1 WSL/Linux fronts: Linux own-repository admission, desktop WSL folder selection and a matching downloaded Linux backend, with transport, lifecycle and acceptance below.
- M3: role-based sandbox; isolated tests and probes; WSL, Windows and macOS isolation. WSL2 alone does not qualify filesystem isolation.
- M4: human terminal; preview items.
- M5:
  - workflow zones, edit, locks, modes, action nodes;
  - saved flows and libraries;
  - versioned gates and workflows with one-click rollback;
  - fresh-context plan review and related-doc evidence;
  - grants; protected-area plans; zones;
  - merge queue and waiting stages; checklists and todos; continuation and handoffs;
  - memory, rules, standing instructions and review lessons;
  - run forking.
- M6: file operations for the person, anchored review comments and compare-and-merge, history and Changes navigation, the Plan tab; optional graph and semantic groups; map names; named cursors; manual review and dictation; design polish; scripted-agent provenance labels; settings recommendations.
- M7: incremental engine, runtime tracing, worktree pool, git scaling.
- M9: team and PR integrations, shareable runs, marketplace, live phone review.
- Canvas milestone (after M5's core): persistent boards, removable graph, object library, live references, browser/previews, presence and assignment, granted canvas tools, custom types, drawing/templates and typed-primitives generative views; composition follows M6's review loop.
- M10: examples-before-code, pins and lenses, explanations, one-hop context, overlap facts, coverage, dependency guard, repository hooks and the person's CI as evidence, counterexamples, specialist engine, independent attempts beyond M6's first compare-and-merge, disagreement, probe generation, decision probabilities, learning from answers, retrospectives and exported decision pairs, benchmarks and canary, and reference-view release qualification.
- Deferred or declined:
  - RAG is not planned now beyond evals; opt-in if ever scheduled.
  - Automated video takes and gallery captures stay outside the repository.
  - The training room and fine-tuning are not planned now (`docs/additions.md:444`); opt-in if ever scheduled.

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
     - M5's editing and the separate Canvas milestone after M5's core in parallel; canvas front 1 follows M0, composition follows M6's review loop; executable workflow actions after M1's recovery and the action contracts; hosted nodes after M2;
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

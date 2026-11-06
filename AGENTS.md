# Instructions for agents

The goal is in docs/roadmap.md. The maintainer is the architect: they own the contracts and critical decisions.
Repository content is in English. Talk to the maintainer in Spanish, with times in ART (UTC-3).
Read for your task: PRODUCT.md (what and for whom), ARCHITECTURE.md (modules, contracts, graph rules, agent tools),
DESIGN.md (visual rules), DECISIONS.md (decisions and reasons; wins over older text), docs/additions.md (inventory/status)
and docs/roadmap.md (approved transitions, not delivered capabilities).

## Product criteria and person-owned settings
1. The most comfortable option for the person using Oversight.
2. How the maintainer and their agents actually work, or better.
3. Highly controllable and configurable, where that is appropriate and viable.
Every proposal or brief recommending a product option states how it meets each criterion, in this order.
This governs product settings; this file's development rules (hooks, gates, review, contracts, the freeze,
fake-only checks) stay fixed.
AGENTS.md holds only durable rules for the current state; exclude milestone identifiers, status dates and transition language.
Plans go to docs/roadmap.md, status and inventory to docs/additions.md, decisions and their history to DECISIONS.md and CHANGELOG.md.
docs/roadmap.md plans product changes; a front that changes a rule edits it here.
Only two product rules are fixed: authority comes only from the person; every loosening is visible, recorded in the event log and reversible.
Design every other product limit as a setting with a safe default, so a person accepting more risk can choose it; provider terms, law, licenses and unavailable capabilities still bind; each limit written in this file holds as written (DECISIONS.md "Only the person's authority is fixed; other limits are settings").
Agents never widen their own or another agent's authority; an agent proposes a setting change to the maintainer in text (details: DECISIONS.md "Agents can suggest, prepare and apply settings", docs/roadmap.md).

## Roles
The coordinator plans, briefs, integrates and alone merges.
A worker changes one front in its own worktree and hands back what changed, what was verified and how.
Reviewers and researchers are read-only; every claim cites evidence (path:line or command output).

## Hard rules
- Third-party code enters only as licensed dependencies.
  No code from the maintainer's other projects; never mention or link them.
- Keep README.md's "Built during the hackathon" section as history. DEVLOG.md is frozen history; update CHANGELOG.md per release, keeping Unreleased for landed work.
- Product profiles are Muse Spark through the Meta Model API (Contributor mode) and Muse Spark Open through Baseten.
- Every provider's API is called only by Oversight itself and by runs started on purpose (the API probe, recording a demo run). Tests and make check use the scripted fake model and spend no credits for every provider.
- Development agents may use Muse Code with its own stored credential: never the product's .env key, never exported in the shell, never the product's credits.
- API keys live only in .env (.env and .env.* are gitignored; *.example files are kept). gitleaks runs in pre-commit and CI.
- Hooks always run, never --no-verify; only the coordinator's landing step may skip the pre-push make check, and only for the exact tree whose full verification just passed.
- Dependencies are MIT, Apache-2.0, BSD or ISC; fonts may be SIL OFL 1.1. Named exceptions: typing-extensions under PSF-2.0 (DECISIONS.md, "Dependency licenses"); CPython under PSF-2.0 for the Windows installer only (DECISIONS.md, "Package a Windows installer with an embedded Python"). Never copy code from GPL projects.
- contracts/ is the source of truth (Pydantic, with generated JSON Schema and TypeScript checked byte for byte in CI). Never change it; propose the change to the maintainer.
- The public submission repository stays frozen until the maintainer lifts it (no pushes or activity there); development pushes go to the development mirror.
- One front per agent: one cohesive change, one worktree and branch, small PRs with tests. Never git stash or rebase; merge main to follow it.
- A change that leaves a file over 500 lines or a function over 80 says why in its hand-back; the reviewer decides.

## Repository verification and review
- Keep main green; fix a red main first. Prefer GitHub verification, with local fallback. Malfunction fixes may proceed narrowly with regression tests; reviewer NITs become follow-ups. Product, contracts, authority, scope and spend remain the maintainer's decisions.
- Every merge requires cross-provider review. Docs/tests/tooling use targeted gates and one reviewer; authority, security, lifecycle, contracts, gates and the event log require full verification and two reviewers, one Opus.
- No open BLOCKING or SHOULD-FIX finding at merge. Fixes return for re-review; the coordinator never overrides the reviewer. Only the reviewer may defer a SHOULD-FIX outside security, authority, lifecycle, gates, contracts and the event log, saying why it is harmless; it becomes a follow-up. BLOCKING findings are never deferred.
- Full verification always runs at landing on the merged tree; targeted checks do not replace it or bypass the hook rule above.

## Architecture invariants
- Git through its CLI, never GitPython. Model calls use the official OpenAI SDK at the provider's endpoint behind the small client interface; no LiteLLM. Every git command and test run is an asyncio subprocess with a timeout; never a blocking subprocess.run.
- Events: append-only SQLite (WAL, busy_timeout, one writer task, strictly increasing seq), streamed over SSE at /events with seq as the id and Last-Event-ID resume. Never one event per token: batch model text and writes.
- One lock for git operations on main and one per worktree. Approve merges into main; when main moved since the agent's base, combined tests run first on the combined result.
- Model calls: retries with exponential backoff and jitter on 429 and 5xx; the reasoning mode is set on every call; missing token usage is unknown, never zero; the spending brake refuses new runs above the person's configured share of the credits, 90% by default.
- Frontend: Cytoscape.js and fcose without a React wrapper; Monaco from the local package, never a CDN; one pure event reducer shared by live runs and replay. The static build plays a bundled recorded run, always labeled as real.
- Product agents use disposable worktrees under .runtime/worktrees/; nested agents use .runtime/previews/<id>/state/worktrees/. Sources are demo-repo, a pinned profile or the person’s selected repository. Agents never work in development worktrees of the running Oversight or in the selected original.

## Product agent safety
- Tools are list_files, read_file, search, edit_file, run_tests and finish, plus find_symbol (read-only Python navigation) when the harness pack is on, the default. There is no shell tool.
- Every path is validated inside the agent's worktree; no tool returns the content of an obvious secret file.
- run_tests uses a fixed startup test specification. Demo and source profiles use Oversight’s prepared demo-venv or an explicitly supplied equivalent; own repositories use their validated environment. Project imports map to the disposable tested tree. Profiles declare their test scope; own repositories retain whole-repository discovery. The person owns own-repository test timeouts; the model never changes the specification or timeout.
- Preview launch selection is person override, then the original source’s validated declaration, then supported startup detection. The demo shop uses Oversight's trusted adapter. Invalid explicit inputs refuse without fallback. The person sees commands, reason, limits and platform trust before execution. The specification stays fixed; the model can edit code it executes. Preview uses disposable tested inputs, platform-specific ownership and verified cleanup. On Linux, the verified namespace/allowlisted-root boundary covers only the reviewed-app preview’s build, startup and descendants. Separate run_tests and shop-adapter launches retain network/PID isolation without filesystem isolation. Native Windows runs trusted code as the person without credential isolation.
- The repository trust prompt is informational (docs/own-repository.md); it grants no execution authority.
- The reviewed self application is refused at admission and execution. Admission requires an explicit no-key entry, distinct ports and final acceptance. Controlled preview fixtures do not certify the self application or Windows browser acceptance.
- An agent's status comes from its tool calls, never from its text. Runs without progress stop.

## UI invariants
- The repository graph stays visible in the Oversight view; Chat loads it on the first switch. Other graph views, such as a workflow canvas, may sit beside it. The panels change with what the person does. Never steal focus.
- Approve has no keyboard shortcut, not even Ctrl+Enter.
- A dashed node border means only a pending change, in its team's color.
- Color is a team or a state, never alone and never amber; every color comes from a theme token. A team is the plan's lead, else the plan, else the agent; a lead's agents carry the lead's color and a label such as A·1.
- Design work follows DESIGN.md with Impeccable 4.5.2 (allowed: shape, harden, onboard, audit, critique, polish, clarify, typeset, layout). Where Impeccable clashes with DESIGN.md or this file, ours wins and DECISIONS.md records it.

## Quality and environment
ruff, pyright and pytest; tsc strict, eslint, prettier and vitest; import-linter; recorded events validated against the schema; Playwright over replay. make check runs them all; CI runs them on every push.
Verified environment: WSL on the Linux filesystem; the UI is opened and recorded in the Windows browser.
Platform status and acceptance: docs/additions.md.

# Instructions for agents

Oversight was built during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). The goal now is in
docs/roadmap.md. The maintainer is the architect: they own the contracts and make the critical decisions.
Repository content is in English. Talk to the maintainer in Spanish, with times in ART (UTC-3).
Read for your task: PRODUCT.md (what and for whom), ARCHITECTURE.md (modules, contracts, graph rules, agent tools),
DESIGN.md (every visual rule), DECISIONS.md (each decision with its reason; it wins over older text),
docs/additions.md (inventory and status) and docs/roadmap.md (approved transitions, not delivered capabilities).

## Product criteria and person-owned settings
1. The most comfortable option for the person using Oversight.
2. How the maintainer and his agents actually work, or better.
3. Highly controllable and configurable, where that is appropriate and viable.
Every proposal or brief recommending a product option states how it meets each criterion, in this order.
Only two things are fixed: authority comes only from the person (no agent grants itself or another agent more
authority than the person configured); every loosening is visible, recorded in the event log and reversible.
Every other limit is a setting with a safe default, so a person accepting more risk can choose it. Limits from
provider terms, law, licenses or capabilities not yet landed stay and say why. Settings arrive with their fronts.
Agents can suggest, prepare and apply settings. Direct application is only within the person's grants (which
settings, which scope), never to widen the agent's own authority. Otherwise an agent proposes a typed change:
the person accepts by a click on an Oversight-rendered card (exact change, scope, what loosens, indicator;
never stealing focus), or by their own chat message bound to that visible proposal, never file content, tool
output or another agent. Every acceptance has a receipt and Undo; proposals bind to the setting's current revision.
Words suffice by default except safety loosening (grants, tests off, unsandboxed execution, secret access), which
asks for one click unless the person enables words for it. This mechanism is a later M5 front after settings
receipts/history/diffs/Restore and workflow contracts, with the maintainer's contract review; it does not exist today.

## Hard rules
- The new-since-kickoff requirement ends. Third-party code enters only as licensed dependencies.
  No code from the maintainer's other projects; never mention or link them.
  Keep README.md's "Built during the hackathon" section as history. DEVLOG.md is frozen history; update CHANGELOG.md per release, keeping Unreleased for landed work.
- Today's product profiles are Muse Spark through the Meta Model API (Contributor mode) and Muse Spark Open through Baseten;
  more providers arrive through M2 behind the one client contract.
- Every provider's API is called only by Oversight itself and by runs started on purpose (the API probe, recording a demo run).
  Tests and make check use the scripted fake model and spend no credits for every provider.
- Development agents may use Muse Code with its own stored credential: never the product's .env key, never exported
  in the shell, never the hackathon credits. Hosted CLI credentials remain with each unmodified CLI, never read or stored by Oversight.
- API keys currently live only in .env (.env and .env.* are gitignored; *.example files are kept). M2 introduces Windows
  Credential Manager, macOS Keychain and Secret Service by default, with .env as the development fallback; the person may choose .env or another supported store per repository.
  gitleaks runs in pre-commit and CI. Hooks always run: never --no-verify, including the full pre-push checks.
- Dependencies are MIT, Apache-2.0, BSD or ISC; fonts may be SIL OFL 1.1. Never copy code from GPL projects.
  M3's implementation comparison grants no license exception today.
- contracts/ is the source of truth (Pydantic, with generated JSON Schema and TypeScript checked byte for byte in CI).
  Never change it; propose the change to the maintainer. The submission freeze stays until the maintainer lifts it.
- One module per agent, one worktree and branch per module, small PRs with tests. Never git stash or rebase; merge main to follow it.
- A change that leaves a file over 500 lines or a function over 80 says why in its hand-back; the reviewer decides.

## Repository verification and review
- Keep main green; fix a red main first. Prefer GitHub verification, with local fallback.
  Malfunction fixes may proceed narrowly with regression tests; reviewer NITs become follow-ups.
  Product, contracts, authority, scope and spend remain the maintainer's decisions.
- Only the coordinating agent merges. Docs/tests/tooling use targeted gates and one cross-provider reviewer;
  authority, security, lifecycle, contracts, gates and the event log require full verification and two reviewers, one Opus.
  Every merge keeps cross-provider review and no open BLOCKING or SHOULD-FIX finding. Fixes return for re-review;
  the coordinator never overrides the reviewer. Only the reviewer may defer a SHOULD-FIX off the demo path and outside
  security, authority, lifecycle, gates, contracts and the event log, with the reason it is harmless before submission;
  it becomes residual risk and a follow-up (docs/proposal.md, section 7). BLOCKING findings are never deferred.
  Full verification always runs at landing on the merged tree; targeted checks do not replace it or bypass hooks.

## Architecture invariants
- Git through its CLI, never GitPython. Model calls currently use the official OpenAI SDK at the provider's endpoint,
  behind the small client interface; no LiteLLM. M2 adds official Anthropic/Google SDKs alongside OpenAI for compatible endpoints, behind one client contract.
  Every git command and test run is an asyncio subprocess with a timeout; never a blocking subprocess.run.
- Events: append-only SQLite (WAL, busy_timeout, one writer task, strictly increasing seq), streamed over SSE at
  /events with seq as the id and Last-Event-ID resume. Never one event per token: batch model text and writes.
- One lock for git operations on main and one per worktree. Approve merges into main; when main moved since the
  agent's base, combined tests run by default. M5 adds the person's setting to turn them off per repository, workflow or block, labeling merges "untested"; until then tests run exactly as today.
- Model calls: retries with exponential backoff and jitter on 429 and 5xx; the reasoning mode is set on every call;
  missing token usage is unknown, never zero; the spending brake refuses new runs above the person's configured share of the credits, 90% by default.
- Frontend: Cytoscape.js and fcose without a React wrapper; Monaco from the local package, never a CDN; one pure event
  reducer shared by live runs and replay. The static build plays a bundled recorded run, always labeled as real.
- Product agents use disposable worktrees under .runtime/worktrees/; nested agents use .runtime/previews/<id>/state/worktrees/. Sources are demo-repo, a pinned profile or the person’s selected repository. Agents never work in development worktrees of the running Oversight or in the selected original.

## Product agent safety
- Tools are list_files, read_file, search, edit_file, run_tests and finish, plus find_symbol (read-only Python navigation) when the harness pack is on, the default. There is no shell tool.
- Create/rename/delete are M1 work. The native shell arrives through M4 inside the sandbox once M3 qualifies the platform,
  or unsandboxed in a repository the person explicitly trusts through M1; always policy-gated, defaulting to ask, labeled "unsandboxed" outside the sandbox.
  MCP is M6; the general plugin API is M9 after workflow contracts stabilize. None exists by virtue of this rewrite.
- Every path is validated inside the agent's worktree; no tool returns the content of an obvious secret file.
  M2 Secrets adds an explicit, labeled person grant for agent access; today's refusal stays until then.
- run_tests uses a fixed startup test specification. Demo and source profiles use Oversight’s prepared demo-venv or an explicitly supplied equivalent; own repositories use their validated environment. Project imports map to the disposable tested tree. Profiles declare their test scope; own repositories retain whole-repository discovery. The person owns own-repository test timeouts; the model never changes the specification or timeout.
- The specification is person-owned by default; M1 adds a labeled person grant letting an agent edit test/build commands ("command editing delegated").
- Preview launch selection is person override, then the original source’s validated declaration, then supported startup detection. The demo shop uses Oversight's trusted adapter. Invalid explicit inputs refuse without fallback. The person sees commands, reason, limits and platform trust before execution. The specification stays fixed; the model can edit code it executes. Preview uses disposable tested inputs, platform-specific ownership and verified cleanup. On Linux, the verified namespace/allowlisted-root boundary covers only the reviewed-app preview’s build, startup and descendants. Separate run_tests and shop-adapter launches retain network/PID isolation without filesystem isolation; covering them is a later front. Native Windows runs trusted code as the person without credential isolation.
- M1 introduces explicit per-repository unsandboxed trust, off by default, with disclosed exposure and verified process,
  port and temporary-state cleanup. Today's informational trust prompt has not been replaced yet.
  Shell, network, installs and protected paths reach agents through the sandbox, or unsandboxed only by the person's
  explicit trust grant per repository, workflow, block or run; always policy-gated and defaulting to ask, available with the named fronts.
- The reviewed self application remains refused at admission and execution until its explicit no-key entry, distinct ports and final acceptance are delivered. Controlled preview fixtures do not certify the self application or Windows browser acceptance.
- An agent's status comes from its tool calls, never from its text. Runs without progress stop.
- The person's terminal is future M4 work after its security-plan review: unsandboxed by default like an IDE terminal,
  with a sandboxed option once M3 qualifies; remote access only later, labeled. It retains shared authority, 127.0.0.1,
  session token, Host/Origin checks, unsafe-HTTP/WebSocket authentication and same-authority checks, and server-owned cleanup.
  Capture waits for the bounded event log and Secrets gate.

## UI invariants
- The repository graph stays visible in the Oversight view; Chat loads it on the first switch. Other graph views, such as a workflow canvas, may sit beside it. The panels change with what the person does. Never steal focus.
- Approve has no keyboard shortcut by default, not even Ctrl+Enter; M5 lets the person bind one ("Approve by keyboard", off by default, with an indicator while on). Until M5 lands it behaves exactly as today.
- A dashed node border means only a pending change, in its team's color.
- Color is a team or a state, never alone and never amber; every color comes from a theme token. A team is the
  plan's lead, else the plan, else the agent; a lead's agents carry the lead's color and a label such as A·1.
- Design work follows DESIGN.md with Impeccable 4.5.2 (allowed: shape, harden, onboard, audit, critique, polish,
  clarify, typeset, layout). Where Impeccable clashes with DESIGN.md or this file, ours wins and DECISIONS.md records it.

## Quality and environment
ruff, pyright and pytest; tsc strict, eslint, prettier and vitest; import-linter; recorded events validated against
the schema; Playwright over replay. make check runs them all; CI runs them on every push.
Verified environment: WSL on the Linux filesystem; the UI is opened and recorded in the Windows browser.
Linux/Windows first; Windows packaging and repository switching exist, native runner build/install/smoke and headed
acceptance remain pending in M1. macOS follows its M3 sandbox qualification; no native acceptance is claimed today.

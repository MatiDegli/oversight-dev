# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **The supervising developer.** One person who hands tasks to coding agents on a repository (currently Python)
  and decides what reaches main. They want control: nothing merges without their decision or a rule
  they set, and every decision rests on facts they can check without reading the code, such as what
  a change does differently, how far it reaches on the graph, and what its tests prove. The graph
  exists for this person, not for the agents.
- **The power vibe coder.** Runs many agents at once and wants speed. They keep several agents
  working while only the decisions that matter reach them: a change that passes every rule merges
  by itself with its reasons and a Revert, and the rest arrives as a short question with an example.
- **Hackathon judges (historical audience).** The submission was designed for evaluation through a
  3-minute demo video and a static build that replays a real recorded run in the browser, with no
  backend and no setup.

## Product Purpose

Oversight is a small, focused web IDE for agentic development. Today it works on Python projects;
broader language support comes through M1. The repository is shown as a live graph of modules,
classes, functions and methods parsed from source. Coding agents currently use Muse Spark through
the Meta Model API (Contributor mode) and Muse Spark Open through Baseten, each in its own git worktree.
More providers arrive through M2 behind one client contract. The approved destination is in
docs/roadmap.md. Success is a person who can
let several agents work in parallel and still know, at any moment, what each one is touching and
what a change may affect. A change reaches main only with your approval or by meeting rules you set; its
review then shows the rules and grants that let it in, and Revert undoes it in one step when it
applies cleanly.

Status, 2026-11-01: rules activation is open following the maintainer's approval. Each fresh run
starts in Ask me; the person explicitly selects Merge alone when safe. Selection requires session
isolation C and an independent cross-reviewer; every merge still requires all current evidence and
transaction guards. Clean rules merges offer person-triggered Revert. Behavior diff and measured
callers remain opt-in, off by default. Activation evidence uses scripted fake models; the public
static build continues to replay the separately labeled real recording.

## Positioning

Agents write code faster than anyone can review it. Oversight is how you stop reading code without
losing control. Both audiences get it from one mechanism. Oversight runs the old and the new version
of each changed function on the same inputs and keeps what behaves differently. It measures which
callers on the graph changed as a result. Then it asks the person only about the differences the
task did not ask for. Control comes from that: nothing merges without the person's rules or their
decision, and every question carries its smallest example. Speed comes from that too: several
agents run at once, and only the questions that matter reach the person. The IDE (the live graph,
the agents' lights, the diff) is where this happens, not the pitch.

## Hackathon Operating Context (historical)

- Built during the Meta Global AI Developer Hackathon, Oct 26 to Nov 4, 2026.
- Development used WSL; the UI is opened and recorded in a Windows browser on localhost.
- The hackathon demo runs against a small Python project of our own (`demo-repo/`), copied to a fresh runtime
  workspace on every start.
- The submission was designed for judges to see the demo video and a static replay build. The build plays the bundled
  real two-agent recording, labeled from its provenance (see Evidence on Hand).

## Capabilities and Constraints

- Lead Chat shows four closed reference cards: graph highlights, exact changed files, measured
  behavior and run moments. All facts follow the displayed run state. Clicks alone open a graph
  scope, read-only diff or replay moment; Back returns to the saved paused position with Chat
  retained. Live moments show event facts and explain that rewind is available in replay.
- Watch mode: the graph and the agents panel, with live node highlighting and agent cards.
- Review mode: an inline diff in Monaco beside the graph with the impact cone; decisions Approve,
  Reject and, from level 2, Request changes. Approve accepts a pointer click or an unmodified Enter
  held for one second on the focused, enabled Approve control. Releasing early cancels; taps, Space,
  modified Enter and comment typing never approve. Focused held Enter ships enabled with a fixed
  one-second duration. The approved disable switch and adjustable duration await recorded settings
  contracts and history; neither preference is available today. No global approval shortcut exists.
- Live diff (read-only) and file view share the review panel; there is no third screen.
- Current models are Muse Spark through the Meta Model API and Muse Spark Open through Baseten.
  Calls use the official OpenAI SDK today; M2 adds native Anthropic/Google SDKs behind the same
  client contract; LiteLLM is not currently chosen. Real calls are deliberate Oversight runs only; tests and
  `make check` use scripted fake models and spend no credits for every provider. Tools are list_files, read_file, search, edit_file, run_tests and finish, plus find_symbol
  (read-only Python navigation) when the harness pack is on, the default. There is no shell tool.
- Native-agent create/rename/delete are M1 work. The native shell is M4 work, policy-gated and
  defaulting to ask: inside a sandbox once M3 qualifies the platform, or labeled "unsandboxed" in
  a repository the person explicitly trusts through M1. MCP is M6; a general plugin API is M9
  after workflow contracts stabilize. These are planned capabilities.
- Current sources are disposable copies/worktrees, never the selected original or the running
  Oversight's development worktree. Tests use the fixed startup specification and validated
  environment; M1 adds a person grant for agent edits to test/build commands, labeled
  "command editing delegated". Combined tests remain required today; M5 makes them configurable
  per repository, workflow or block, on by default, with "untested" on merges without them.
- Linux filesystem containment currently covers reviewed-app preview build/startup/descendants;
  tests and the shop adapter have network/PID isolation without filesystem isolation. Native
  Windows runs trusted code as the person without credential isolation. Reviewed-self execution
  stays refused until its no-key entry, distinct ports and final acceptance land.
- Today's repository trust prompt is informational. M1 introduces explicit per-repository
  unsandboxed trust, off by default, with exposure disclosed and verified process, port and
  temporary-state cleanup. Shell, network, installs and protected paths follow the sandbox or
  the person's explicit trust grant per repository, workflow, block or run, always policy-gated
  and defaulting to ask, as their fronts land.
- Keys currently live in `.env`, with separate development credentials and secret scanning/hooks.
  M2 adds Windows Credential Manager, macOS Keychain and Secret Service by default, `.env` as the
  development fallback and a per-repository choice of `.env` or another supported store. Hosted
  CLI credentials stay with each unmodified CLI. Obvious secret files are refused today; M2
  Secrets adds explicit, labeled person grants for agent access.
- Linux and Windows come first. Windows packaging and repository switching exist; native runner
  build/install/smoke and headed acceptance remain pending in M1 (desktop/README.md). WSL with a
  Windows browser is the verified environment. macOS follows its M3 sandbox qualification.
- The person's terminal is future M4 work after its security-plan review: unsandboxed by default,
  with a sandboxed option once M3 qualifies and remote access only later, labeled. It retains
  shared authority, 127.0.0.1, session token, Host/Origin checks, unsafe-HTTP/WebSocket authentication
  and same-authority checks, and server-owned cleanup. Capture waits for the bounded log and Secrets.
- The impact cone is bounded and always presented as "possibly affected", never as complete.
- Hackathon scope used the levels in docs/proposal.md, section 5, with level 3 and day mode subject
  to the event deadline. Post-hackathon scope follows docs/roadmap.md; the submission freeze stays
  until the maintainer lifts it.
- Terminology: agent A and agent B, change, pending change, impact cone, watch, review, live diff,
  file view, approve, request changes, reject.

## Brand Commitments

- Name: Oversight.
- Language: English, in sentence case.
- Dark by default: the product, the video and the demo are dark. Settings offers Dark, Day or
  System; day mode is less polished than dark.
- The visual system is recorded in DESIGN.md; AGENTS.md wins over both files.

## Evidence on Hand

- **Exists today (Oct 28):** the demo repository (`demo-repo/`); hand-written and scripted fixtures
  for UI tests; and the frontend with a graph, agent cards and Monaco review panels.
- The real two-agent run (`fixtures/events/recorded-demo.jsonl` and its provenance sidecar) records
  Muse Spark and Muse Spark Open, with both changes approved and merged. The static replay build
  plays it without a backend, with the provenance-derived label `Recorded run · Oct 27, 2026`.
- Reference-card implementation evidence is synthetic: production reducer events drive browser
  fixtures for all four kinds, live facts, exact-sequence replay/Back, long paths and eight
  references in dark/day at 1280/390. This does not demonstrate a real model choosing a view.
  The existing Oct 27 public recording proves `change.*`; scripted-rules supplies
  `tests.executed` evidence. `show_view` is advertised and dispatched with the moved prompt version
  (DECISIONS, November 3). Remaining release gates are the separately authorized paid probe and
  prompt validation, a real recording and bundle replacement.
- No users, testimonials, benchmarks or metrics exist yet; none may be invented.

## Product Principles

- The person decides: a change reaches main only with their approval or by meeting rules they set.
- Every product recommendation explains, in order: the most comfortable option for the person
  using Oversight; how the maintainer and his agents actually work, or better; highly controllable
  and configurable, where that is appropriate and viable (the exact criteria are in AGENTS.md).
- Authority comes only from the person; no agent widens its own or another agent's configured
  authority. Every loosening is visible, logged and reversible. Other limits become settings with
  safe defaults as their fronts land; provider terms, law, licenses and unavailable capabilities
  still constrain them, with reasons. Today's gates stay until those settings are delivered.
- From a later M5 front, agents can suggest, prepare and apply settings within the person's grants,
  never widening their own authority. Today an agent proposes a setting change to the maintainer
  in text. The M5 front adds typed, revision-bound proposals: an Oversight-rendered card
  shows the exact change, scope, loosening and indicator without stealing focus. The person accepts
  by a click or their own chat message bound to that visible proposal, never repository text,
  tool output or another agent. Acceptance has a receipt and Undo. Words suffice by default;
  safety loosening asks for one click unless the person enables words for it. Contracts and the
  preceding settings receipts/history/diffs/Restore need the maintainer's review; this is future work.
- Never steal focus: the screen changes only when the person acts.
- Show what may be affected, honestly bounded, rather than claim completeness.
- The submission evidence remains real and labeled for what it is: a replay of a real recorded run says so;
  the hand-written log, if it is ever shown, says it is hand-written, never a recording.

## Accessibility & Inclusion

- Color is never the only signal: agents carry letters, diffs carry `+` and `-`, tests carry icons.
- Six agent color families (A–F) carry visible letters so identity stays readable with color blindness.
- Text meets 4.5:1 contrast and meaningful graphics 3:1; keyboard focus is always visible; motion
  stops under `prefers-reduced-motion`.

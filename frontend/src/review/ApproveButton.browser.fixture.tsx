import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { CardDecisions } from "./CardDecisions";
import { GrantChoice } from "./GrantChoice";
import { ReviewDecisionBar } from "./ReviewDecisionBar";
import { DecisionContext } from "./DecisionContext";
import { candidateKey } from "./answers";
import { headerState } from "./ReviewHeader.fixture";

type Surface = "bar" | "card" | "grant";
type Options = { eligible: boolean; pending: boolean; revision: number; head: string; run: string };
const root = createRoot(document.body.appendChild(document.createElement("div")));
let surface: Surface = "bar";
let options: Options;
const calls: string[] = [];

function render() {
  const state = headerState("a");
  const change = state.changes["change-3"];
  if (!change?.proposal || !state.run) throw new Error("Missing fixture candidate");
  change.proposal.revision = options.revision;
  change.proposal.head_commit = options.head;
  state.run.run_id = options.run;
  const facts = state.changeFacts["change-3"]?.at(-1);
  if (!facts?.review_cards) throw new Error("Missing fixture facts");
  const cards = facts.review_cards;
  facts.revision = options.revision;
  facts.head_commit = options.head;
  for (const card of cards) card.answer = options.eligible ? "yes" : "unsure";
  const view = options.pending
    ? ({ kind: "pending", action: "approve" } as const)
    : ({ kind: "open", failure: null } as const);
  const candidate = candidateKey(state, "change-3");
  const decide = () => calls.push(candidate);
  flushSync(() => {
    root.render(
      <>
        <textarea aria-label="Outside comment" />
        <button>Outside</button>
        <DecisionContext
          value={{
            onDecide: decide,
            attempts: options.pending
              ? {
                  "change-3": {
                    phase: "pending",
                    action: "approve",
                    revision: options.revision,
                    resolution: change.resolution,
                    errorCount: state.errors.length,
                  },
                }
              : {},
          }}
        >
          {surface === "bar" ? (
            <ReviewDecisionBar
              changeId="change-3"
              candidate={candidate}
              view={view}
              cards={cards}
              onDecide={decide}
            />
          ) : surface === "card" ? (
            <CardDecisions
              cards={cards}
              answers={{}}
              candidate={candidate}
              view={view}
              onDecide={decide}
            />
          ) : (
            <GrantChoice state={state} changeId="change-3" />
          )}
        </DecisionContext>
      </>,
    );
  });
}

export const approvalTest = {
  calls,
  mount(next: Surface) {
    calls.length = 0;
    surface = next;
    options = { eligible: true, pending: false, revision: 1, head: "a".repeat(40), run: "run-1" };
    render();
  },
  update(patch: Partial<Options>) {
    options = { ...options, ...patch };
    render();
  },
  unmount() {
    flushSync(() => {
      root.render(null);
    });
  },
};

declare global {
  interface Window {
    approvalTest: typeof approvalTest;
  }
}

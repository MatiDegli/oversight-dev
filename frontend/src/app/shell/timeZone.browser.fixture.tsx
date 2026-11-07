import "../../theme/index.css";
import { createRoot } from "react-dom/client";
import { applyEvent, createInitialState } from "../../state";
import { parseEvent } from "../../transport";
import grantsLog from "../../../../fixtures/events/handwritten-inbox-grants.jsonl?raw";
import planLog from "../../../../fixtures/events/handwritten-lead-plans.jsonl?raw";
import activityLog from "../../../../fixtures/events/handwritten-level1.jsonl?raw";
import { viewScenario } from "../leadViews.browser.fixture";
import { TimeZoneSettings } from "./TimeZoneSettings";
import { Activity } from "./dock/Activity";

// eslint-disable-next-line no-restricted-imports -- Test the mounted private clock consumer without changing its production public API.
import { StandingGrants } from "../../review/StandingGrants";
// eslint-disable-next-line no-restricted-imports -- Test the mounted private clock consumer without changing its production public API.
import { CardEvidence } from "../../review/ChangeCard";

import { selectChangeCard, loadDecisionInbox, loadReviewBody } from "../../review";

import { selectConversation, loadConversationPanel } from "../../agents";
import { ChatChangeCard } from "./ChatChangeCard";
import { ChatMergeReceipt } from "./ChatMerge";
import { applyTimeZone } from "../../timeZone";

const { DecisionInbox } = await loadDecisionInbox();
const { ReviewBody } = await loadReviewBody();
const { ConversationPanel, selectLeadConversation, LeadViewCard } = await loadConversationPanel();

const fold = (log: string) =>
  log.trim().split("\n").map(parseEvent).reduce(applyEvent, createInitialState());
const grants = fold(grantsLog);
const plans = fold(planLog);
const activity = fold(activityLog);
const leadState = viewScenario().reduce(applyEvent, createInitialState());
const lead = selectLeadConversation(leadState, "agent-9");
const card = selectChangeCard(grants, "change-1");
const conversation = selectConversation(activity, "agent-1", []);
const resolution = grants.changes["change-1"]?.resolution;
const proposal = activity.decisionEvents.find((event) => event.type === "change.proposed");
if (!card || !conversation || !resolution || !proposal || !lead)
  throw new Error("Missing clock fixture");
const host = document.getElementById("root");
if (!host) throw new Error("Missing root");
// The states and this parent remain fixed; only subscribed clock leaves can update.
createRoot(host).render(
  <main className="mx-auto max-w-2xl p-4 text-text">
    <TimeZoneSettings />
    <section data-clock="activity">
      <Activity state={activity} />
    </section>
    <section data-clock="inbox">
      <DecisionInbox state={grants} />
    </section>
    <section data-clock="plans">
      <DecisionInbox state={plans} />
    </section>
    <section data-clock="grants">
      <StandingGrants state={grants} />
    </section>
    <section data-clock="card">
      <CardEvidence state={grants} changeId="change-1" card={card} />
    </section>
    <section data-clock="review">
      <ReviewBody state={grants} changeId="change-1" diff={null} showCrossReview={false} />
    </section>
    <section data-clock="conversation">
      <ConversationPanel conversation={conversation} />
    </section>
    <section data-clock="lead-conversation">
      <ConversationPanel
        conversation={lead}
        renderView={(entry) => (
          <LeadViewCard state={leadState} event={entry.event} header={lead.header} />
        )}
      />
    </section>
    <section data-clock="chat-proposal">
      <ChatChangeCard
        state={activity}
        changeId={proposal.payload.change_id}
        seq={proposal.seq}
        reviewing={false}
      />
    </section>
    <section data-clock="chat-merge">
      <ChatMergeReceipt resolution={resolution} ts="2026-10-29T18:03:00Z" />
    </section>
  </main>,
);
window.timeZoneFixture = {
  apply: applyTimeZone,
  sequences: [activity.lastSeq, grants.lastSeq, plans.lastSeq, leadState.lastSeq],
};
declare global {
  interface Window {
    timeZoneFixture: { apply: typeof applyTimeZone; sequences: number[] };
  }
}

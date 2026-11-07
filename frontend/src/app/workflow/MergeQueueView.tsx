import type { State } from "../../state";
import { mergeQueue } from "./mergeQueue";
import { ReviewAction } from "./ReviewAction";

type Candidate = ReturnType<typeof mergeQueue>[number];
export function MergeQueueView({
  state,
  planId,
  onReview,
}: {
  state: State;
  planId: string;
  onReview?: (id: string) => void;
}) {
  const candidates = mergeQueue(state, planId, !!onReview);
  return (
    <section className="merge-queue" aria-label="Merge queue">
      <h3>Merge queue</h3>
      <p>
        Observed candidates for this plan at this point in the run. Display order is not scheduler
        order.
      </p>
      <dl className="workflow-facts">
        <div>
          <dt>Scheduler position</dt>
          <dd>Not known</dd>
        </div>
        <div>
          <dt>Merge timing</dt>
          <dd>Not known</dd>
        </div>
      </dl>
      {candidates.length ? (
        <ul className="merge-candidates">
          {candidates.map((candidate) => (
            <MergeCandidate key={candidate.key} candidate={candidate} onReview={onReview} />
          ))}
        </ul>
      ) : (
        <p>No candidates observed at this point in the run.</p>
      )}
    </section>
  );
}
function MergeCandidate({
  candidate,
  onReview,
}: {
  candidate: Candidate;
  onReview?: (id: string) => void;
}) {
  return (
    <li>
      <h4>
        Step {candidate.index + 1} · {candidate.detail.task}
      </h4>
      <p className="workflow-word" data-word={candidate.detail.word}>
        {candidate.detail.word}
      </p>
      <p>
        Change <span className="workflow-data">{candidate.changeId}</span> · Proposal revision{" "}
        {candidate.revision}
      </p>
      <p>
        Plan {candidate.planId} · Revision {candidate.planRevision}
      </p>
      <p>
        Head <span className="workflow-data">{candidate.head}</span>
      </p>
      <p>Main: {candidate.main.replace("not known", "Not known")}</p>
      <dl className="workflow-gate-summary">
        {candidate.detail.gates.map((gate) => (
          <div key={gate.label}>
            <dt>{gate.label}</dt>
            <dd data-mark={gate.mark}>{gate.mark}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>Gate evidence for {candidate.changeId}</summary>
        <ol className="workflow-gates" aria-label={`Gates for ${candidate.changeId}`}>
          {candidate.detail.gates.map((gate) => (
            <li key={gate.label}>
              <span>{gate.label}</span>
              <strong data-mark={gate.mark}>{gate.mark}</strong>
              <p>{gate.detail}</p>
            </li>
          ))}
        </ol>
      </details>
      <ReviewAction id={candidate.detail.reviewId} onReview={onReview} />
    </li>
  );
}

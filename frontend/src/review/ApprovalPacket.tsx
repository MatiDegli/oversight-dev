import { useId, useRef, useState } from "react";
import type { DecisionInboxEntry, State } from "../state";
import { candidateKey, useAnswers } from "./answers";
import { useDecisions } from "./DecisionContext";
import { buildApprovalPacket, packetNotice } from "./approvalPacket";
import type { ApprovalPacketText } from "./approvalPacket";

export function ApprovalPacket({ state, entry }: { state: State; entry: DecisionInboxEntry }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <details
      className="approval-packet"
      onToggle={(event) => {
        if (event.currentTarget.open) setRevealed(true);
      }}
    >
      <summary>Approval packet</summary>
      {revealed && <PacketContent state={state} entry={entry} />}
    </details>
  );
}

function PacketContent({ state, entry }: { state: State; entry: DecisionInboxEntry }) {
  const prefix = `packet-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const candidate = candidateKey(state, entry.changeId ?? "");
  const answers = useAnswers((s) => s.drafts[candidate]);
  const grant = useAnswers((s) => s.grants[candidate]);
  const { onDecide, planActions } = useDecisions();
  const packet = buildApprovalPacket(
    state,
    entry,
    { answers, grant },
    prefix,
    !onDecide && !planActions,
  );
  const { feedback, copying, copy, refused } = usePacketCopy(packet);
  const header = packet.text.slice(
    0,
    packet.text.length - packet.sections.reduce((n, s) => n + s.text.length, 0),
  );
  return (
    <div className="packet-content">
      <p>{packetNotice}</p>
      <nav aria-label="Included packet evidence">
        {packet.sections
          .filter((s) => s.title.startsWith("Run "))
          .map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
      </nav>
      <pre aria-label="Complete approval packet" tabIndex={0}>
        {header}
        {packet.sections.map((s) => (
          <span id={s.id} key={s.id}>
            {s.text}
          </span>
        ))}
      </pre>
      <button
        type="button"
        aria-disabled={copying}
        onClick={() => {
          void copy();
        }}
      >
        Copy packet
      </button>
      <p role="status" aria-live="polite" aria-atomic="true">
        {feedback}
      </p>
      {refused && refused.text !== packet.text && (
        <section aria-label="Captured packet refused by clipboard">
          <p>Captured packet that could not be copied: {refused.target}</p>
          <pre tabIndex={0}>{refused.text}</pre>
        </section>
      )}
    </div>
  );
}

function usePacketCopy(packet: ApprovalPacketText) {
  const [feedback, setFeedback] = useState("");
  const [copying, setCopying] = useState(false);
  const [refused, setRefused] = useState<ApprovalPacketText>();
  const pending = useRef(false);
  const copy = async () => {
    if (pending.current) return;
    const captured = packet;
    pending.current = true;
    setCopying(true);
    setRefused(undefined);
    setFeedback(`Copying ${captured.target}.`);
    try {
      await navigator.clipboard.writeText(captured.text);
      setFeedback(`Copied ${captured.target}. Copying recorded no decision.`);
    } catch {
      setRefused(captured);
      setFeedback(
        `Clipboard refused ${captured.target}. Select the packet text and copy it manually. Copying records no decision.`,
      );
    } finally {
      pending.current = false;
      setCopying(false);
    }
  };
  return { feedback, copying, copy, refused };
}

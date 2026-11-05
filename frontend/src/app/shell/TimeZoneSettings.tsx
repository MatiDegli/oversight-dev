import { CircleAlert } from "lucide-react";
import { useId, useState } from "react";
import { AUTOMATIC, chooseTimeZone, useTimeZone, validTimeZone } from "../../timeZone";
import { focusRing } from "./shared";

/** Immediate browser preference, independent of live commands and startup settings. */
export function TimeZoneSettings() {
  const id = useId();
  const { preference, effectiveZone } = useTimeZone();
  const [draft, setDraft] = useState(preference === AUTOMATIC ? "" : preference);
  const [feedback, setFeedback] = useState("");
  const [invalid, setInvalid] = useState(false);
  const apply = (value: string) => {
    const result = chooseTimeZone(value);
    setInvalid(!result.valid);
    setFeedback(
      !result.valid
        ? "Time zone not recognized. Enter an IANA name such as Europe/London, or choose Automatic."
        : result.persisted
          ? ""
          : "This browser could not save your choice. It applies until this page reloads.",
    );
  };
  const applyOverride = () => {
    if (validTimeZone(draft.trim())) apply(draft);
    else {
      setInvalid(true);
      setFeedback(
        "Time zone not recognized. Enter an IANA name such as Europe/London, or choose Automatic.",
      );
    }
  };
  return (
    <section aria-labelledby={`${id}-heading`} className="mt-8 min-w-0">
      <h2 id={`${id}-heading`} className="text-(length:--title-size) font-bold">
        Time zone
      </h2>
      <p className="mt-1 text-sm text-muted">
        Automatic follows your browser or computer. This choice applies in this browser.
      </p>
      <button
        type="button"
        aria-pressed={preference === AUTOMATIC}
        onClick={() => {
          apply(AUTOMATIC);
          setDraft("");
        }}
        className={`mt-4 rounded-control aria-pressed:bg-page-raised min-h-11 border border-control-edge px-3 py-2 text-sm hover:bg-page-raised ${focusRing}`}
      >
        Automatic
      </button>
      <TimeZoneOverrideField
        id={id}
        draft={draft}
        invalid={invalid}
        onApply={applyOverride}
        onEdit={(value) => {
          setDraft(value);
          // Partial input stays editable; submit or blur explains an invalid name.
          if (value.trim() && validTimeZone(value.trim())) apply(value);
          else {
            setInvalid(false);
            setFeedback("");
          }
        }}
      />
      <p className="mt-3 text-sm wrap-anywhere text-muted" aria-live="polite">
        Effective time zone: <span className="text-text">{effectiveZone}</span> ·{" "}
        {preference === AUTOMATIC ? "Automatic" : "Override"}
      </p>
      <ZoneFeedback id={id} feedback={feedback} />
    </section>
  );
}

function TimeZoneOverrideField({
  id,
  draft,
  invalid,
  onEdit,
  onApply,
}: {
  id: string;
  draft: string;
  invalid: boolean;
  onEdit: (value: string) => void;
  onApply: () => void;
}) {
  return (
    <form
      className="mt-4 min-w-0"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <label htmlFor={`${id}-zone`} className="block text-sm font-bold">
        IANA time zone override
      </label>
      <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
        For example, Europe/London or Asia/Kolkata. Enter a valid name to apply it immediately.
      </p>
      <input
        id={`${id}-zone`}
        type="text"
        value={draft}
        placeholder="Europe/London"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
        aria-describedby={`${id}-hint ${id}-feedback`}
        onChange={(event) => {
          onEdit(event.target.value);
        }}
        onBlur={() => {
          if (draft.trim()) onApply();
        }}
        className={`mt-2 min-h-11 w-full min-w-0 rounded-card border border-control-edge bg-field px-3 py-2 text-sm text-text placeholder:text-faint ${focusRing}`}
      />
      <button
        type="submit"
        className={`mt-2 rounded-control min-h-11 border border-control-edge px-3 py-2 text-sm hover:bg-page-raised ${focusRing}`}
      >
        Apply time zone
      </button>
    </form>
  );
}

function ZoneFeedback({ id, feedback }: { id: string; feedback: string }) {
  return (
    <p
      id={`${id}-feedback`}
      role="status"
      className="mt-2 flex items-start gap-2 text-sm text-text"
    >
      {feedback && (
        <>
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 wrap-anywhere">{feedback}</span>
        </>
      )}
    </p>
  );
}

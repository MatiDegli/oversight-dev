import { useState } from "react";

/** Withdraw navigation immediately while keeping a focused control in the tab sequence. */
export function ReviewAction({
  id,
  onReview,
}: {
  id: string | null;
  onReview?: (id: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  if (!id && !focused) return null;
  return (
    <button
      type="button"
      aria-disabled={!id || undefined}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      onClick={() => {
        if (id) onReview?.(id);
      }}
    >
      Review change →
    </button>
  );
}

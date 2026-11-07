import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps, CSSProperties } from "react";
import { ApprovalHold, approvalHoldDescription } from "./holdApproval";
import "./approveButton.css";

type Props = Omit<ComponentProps<"button">, "onClick" | "onKeyDown" | "onKeyUp"> & {
  candidate: string;
  onApprove: () => void;
};

function useApprovalHold(candidate: string, disabled: boolean | undefined, onApprove: () => void) {
  const button = useRef<HTMLButtonElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const hold = useRef<ApprovalHold | null>(null);
  const latest = useRef({ candidate, disabled, onApprove });
  useLayoutEffect(() => {
    latest.current = { candidate, disabled, onApprove };
  });
  // Replace the controller on identity/eligibility changes. Cleanup also covers unmount.
  useLayoutEffect(() => {
    const control = new ApprovalHold(
      () => ({
        candidate: latest.current.candidate,
        eligible: !latest.current.disabled && !button.current?.disabled,
        focused: document.activeElement === button.current,
        visible: document.visibilityState !== "hidden" && document.hasFocus(),
      }),
      setProgress,
      () => {
        latest.current.onApprove();
      },
    );
    hold.current = control;
    const release = (event: KeyboardEvent) => {
      if (event.key === "Enter") control.cancel();
    };
    const interrupt = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        control.cancel();
    };
    window.addEventListener("blur", control.cancel);
    document.addEventListener("visibilitychange", control.cancel);
    // These listeners only cancel; they never start or complete an approval.
    document.addEventListener("keyup", release, true);
    document.addEventListener("keydown", interrupt, true);
    document.addEventListener("compositionstart", control.cancel, true);
    return () => {
      control.cancel();
      window.removeEventListener("blur", control.cancel);
      document.removeEventListener("visibilitychange", control.cancel);
      document.removeEventListener("keyup", release, true);
      document.removeEventListener("keydown", interrupt, true);
      document.removeEventListener("compositionstart", control.cancel, true);
    };
  }, [candidate, disabled]);

  return { button, progress, hold };
}

/** Shares the deliberate keyboard gesture; callers retain eligibility and command dispatch. */
export function ApproveButton({
  candidate,
  disabled,
  onApprove,
  children,
  className = "",
  "aria-describedby": describedBy,
  ...props
}: Props) {
  const description = useId();
  const { button, progress, hold } = useApprovalHold(candidate, disabled, onApprove);

  return (
    <>
      <button
        {...props}
        ref={button}
        type="button"
        disabled={disabled}
        className={`approve-hold ${className}`}
        aria-describedby={[describedBy, description].filter(Boolean).join(" ")}
        style={{ ...props.style, "--approval-progress": progress ?? 0 } as CSSProperties}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.preventDefault();
          hold.current?.press(
            {
              ...event,
              isComposing: event.nativeEvent.isComposing,
            },
            window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          );
        }}
        onKeyUp={(event) => {
          if (event.key === "Enter" || event.key === " ") event.preventDefault();
          if (event.key === "Enter") hold.current?.cancel();
        }}
        onBlur={(event) => {
          hold.current?.cancel();
          props.onBlur?.(event);
        }}
        onPointerDown={(event) => {
          hold.current?.cancel();
          props.onPointerDown?.(event);
        }}
        onClick={(event) => {
          hold.current?.cancel();
          if (event.detail > 0 && !disabled) onApprove();
        }}
      >
        {children}
      </button>
      <span id={description} className="sr-only">
        {approvalHoldDescription}
      </span>
      {progress !== null && (
        <span
          role="progressbar"
          aria-label="Hold Enter to approve and merge"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.floor(progress * 100)}
          aria-live="off"
          className="sr-only"
        />
      )}
    </>
  );
}

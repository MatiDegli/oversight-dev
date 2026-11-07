export const approvalHoldMs = 1_000;
export const approvalHoldDescription =
  "Hold Enter for 1 second to approve and merge. Release early to cancel.";

export interface HoldKey {
  key: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

export interface HoldSnapshot {
  candidate: string;
  eligible: boolean;
  focused: boolean;
  visible: boolean;
}

/** No global activation: only the focused control calls press. All interruptions cancel. */
export class ApprovalHold {
  private timer?: ReturnType<typeof setInterval>;
  private pressed = false;

  constructor(
    private readonly read: () => HoldSnapshot,
    private readonly progress: (fraction: number | null) => void,
    private readonly approve: () => void,
  ) {}

  press(key: HoldKey, reducedMotion: boolean) {
    if (key.key !== "Enter") return;
    if (key.isComposing || key.altKey || key.ctrlKey || key.metaKey || key.shiftKey) {
      this.cancel();
      return;
    }
    if (key.repeat || this.pressed) return;
    const start = this.read();
    if (!this.ready(start)) return;
    this.pressed = true;
    const began = performance.now();
    this.progress(0);
    this.timer = setInterval(
      () => {
        const current = this.read();
        if (!this.ready(current) || current.candidate !== start.candidate) {
          this.cancel();
          return;
        }
        const elapsed = performance.now() - began;
        this.progress(Math.min(elapsed / approvalHoldMs, 1));
        if (elapsed >= approvalHoldMs) {
          clearInterval(this.timer);
          this.timer = undefined;
          // Remain latched until release, even if the request fails immediately.
          this.approve();
        }
      },
      reducedMotion ? 250 : 20,
    );
  }

  cancel = () => {
    clearInterval(this.timer);
    this.timer = undefined;
    this.pressed = false;
    this.progress(null);
  };

  private ready(value: HoldSnapshot) {
    return value.eligible && value.focused && value.visible;
  }
}

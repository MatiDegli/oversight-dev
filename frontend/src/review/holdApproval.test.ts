import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApprovalHold, type HoldKey, type HoldSnapshot } from "./holdApproval";

const enter: HoldKey = {
  key: "Enter",
  repeat: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
};
let snapshot: HoldSnapshot;
const progress = vi.fn<(fraction: number | null) => void>();
const approve = vi.fn<() => void>();
let hold: ApprovalHold;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  snapshot = { candidate: "run/change/1/head", eligible: true, focused: true, visible: true };
  progress.mockClear();
  approve.mockClear();
  hold = new ApprovalHold(() => snapshot, progress, approve);
});
afterEach(() => {
  hold.cancel();
  vi.useRealTimers();
});

it.each([0, 20, 500, 999])("cancels a tap or early release after %i ms", (ms) => {
  hold.press(enter, false);
  expect(progress).toHaveBeenLastCalledWith(0);
  vi.advanceTimersByTime(ms);
  hold.cancel();
  vi.advanceTimersByTime(2_000);
  expect(progress).toHaveBeenLastCalledWith(null);
  expect(approve).not.toHaveBeenCalled();
});

it.each([false, true])("holds for a full second, exactly once (reduced=%s)", (reduced) => {
  hold.press(enter, reduced);
  vi.advanceTimersByTime(500);
  expect(progress).toHaveBeenLastCalledWith(0.5);
  hold.press({ ...enter, repeat: true }, reduced);
  vi.advanceTimersByTime(499);
  expect(approve).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(approve).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 10; i++) hold.press({ ...enter, repeat: true }, reduced);
  vi.advanceTimersByTime(5_000);
  expect(approve).toHaveBeenCalledTimes(1);
  expect(progress).toHaveBeenLastCalledWith(1);
  hold.cancel();
  hold.press(enter, reduced);
  vi.advanceTimersByTime(1_000);
  expect(approve).toHaveBeenCalledTimes(2);
});

it("does not restart the deadline on repeats", () => {
  hold.press(enter, false);
  vi.advanceTimersByTime(900);
  hold.press({ ...enter, repeat: true }, false);
  vi.advanceTimersByTime(100);
  expect(approve).toHaveBeenCalledTimes(1);
});

it.each([
  { key: " " },
  { key: "a" },
  { key: "Tab" },
  { ctrlKey: true },
  { altKey: true },
  { metaKey: true },
  { shiftKey: true },
  { isComposing: true },
  { repeat: true },
])("refuses Space, typing, modifiers, composition and inherited repeats: %j", (patch) => {
  hold.press({ ...enter, ...patch }, false);
  vi.advanceTimersByTime(2_000);
  expect(approve).not.toHaveBeenCalled();
});

it.each([
  { focused: false },
  { visible: false },
  { eligible: false },
  { candidate: "other-run/change/1/head" },
  { candidate: "run/other-change/1/head" },
  { candidate: "run/change/2/head" },
  { candidate: "run/change/1/new-head" },
])("rechecks focus, visibility, eligibility and candidate at completion: %j", (patch) => {
  hold.press(enter, false);
  vi.advanceTimersByTime(999);
  snapshot = { ...snapshot, ...patch };
  vi.advanceTimersByTime(1);
  expect(approve).not.toHaveBeenCalled();
  expect(progress).toHaveBeenLastCalledWith(null);
});

it("requires a fresh press after interruption and returning focus", () => {
  hold.press(enter, false);
  vi.advanceTimersByTime(400);
  hold.cancel();
  hold.press({ ...enter, repeat: true }, false);
  vi.advanceTimersByTime(1_000);
  expect(approve).not.toHaveBeenCalled();
  hold.press(enter, false);
  vi.advanceTimersByTime(1_000);
  expect(approve).toHaveBeenCalledTimes(1);
});

it("uses discrete quarter-second updates with reduced motion", () => {
  hold.press(enter, true);
  vi.advanceTimersByTime(249);
  expect(progress.mock.calls).toEqual([[0]]);
  vi.advanceTimersByTime(751);
  expect(progress.mock.calls).toEqual([[0], [0.25], [0.5], [0.75], [1]]);
});

it("cannot start on a disabled, unfocused or hidden control", () => {
  for (const field of ["eligible", "focused", "visible"] as const) {
    const initial = snapshot;
    snapshot = { ...snapshot, [field]: false };
    hold.press(enter, false);
    vi.advanceTimersByTime(1_000);
    snapshot = initial;
  }
  expect(approve).not.toHaveBeenCalled();
  expect(progress).not.toHaveBeenCalled();
});

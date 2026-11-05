import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { graphSync } from "./graphSync";
const frames = new Map<number, FrameRequestCallback>();
let id = 0;
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  frames.clear();
  vi.unstubAllGlobals();
});
function paint() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}

it("does no work while hidden and flushes retained history once on show with one resize", () => {
  let value = 0;
  let visible = true;
  const apply = vi.fn();
  const resize = vi.fn();
  const updates = graphSync({ read: () => value, apply, visible: () => visible, resize });
  updates.publish();
  paint();
  visible = false;
  updates.visibility();
  for (value = 1; value <= 100; value++) updates.publish();
  expect(apply.mock.calls).toEqual([[0]]);
  visible = true;
  updates.visibility();
  expect(apply.mock.calls).toEqual(Array.from({ length: 101 }, (_, i) => [i]));
  expect(resize).toHaveBeenCalledOnce();
  updates.visibility();
  expect(apply).toHaveBeenCalledTimes(101);
  expect(resize).toHaveBeenCalledOnce();
});

it("forces pending work before an imperative operation and discards it on disposal", () => {
  let value = 0;
  const apply = vi.fn();
  const updates = graphSync({ read: () => ++value, apply, visible: () => false, resize: vi.fn() });
  updates.publish();
  expect(apply).not.toHaveBeenCalled();
  updates.force();
  expect(apply).toHaveBeenCalledExactlyOnceWith(1);
  updates.publish();
  updates.dispose();
  updates.force();
  expect(apply).toHaveBeenCalledOnce();
});

it("coalesces a visible burst to one frame and cancels pending callbacks on hide and force", () => {
  let value = 0;
  let visible = true;
  const apply = vi.fn();
  const updates = graphSync({
    read: () => ++value,
    apply,
    visible: () => visible,
    resize: vi.fn(),
  });
  for (let i = 0; i < 100; i++) updates.publish();
  expect(frames.size).toBe(1);
  expect(apply).not.toHaveBeenCalled();
  paint();
  expect(apply).toHaveBeenCalledTimes(100);
  updates.publish();
  visible = false;
  updates.visibility();
  expect(frames.size).toBe(0);
  updates.force();
  expect(apply).toHaveBeenLastCalledWith(101);
  expect(frames.size).toBe(0);
});

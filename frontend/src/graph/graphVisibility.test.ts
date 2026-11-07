import { afterEach, expect, it, vi } from "vitest";
import { graphVisibility } from "./graphVisibility";

afterEach(() => vi.unstubAllGlobals());

it("observes the retained Chat stage and document, and disconnects both", () => {
  let hidden = "false";
  const stage = { getAttribute: () => hidden };
  const host = { closest: () => stage } as unknown as HTMLElement;
  const changed = vi.fn();
  let mutation: (() => void) | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", doc);
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        mutation = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const visibility = graphVisibility(host);
  const stop = visibility.observe(changed);
  expect(visibility.visible()).toBe(true);
  expect(observe).toHaveBeenCalledExactlyOnceWith(stage, {
    attributes: true,
    attributeFilter: ["data-graph-hidden"],
  });
  hidden = "true";
  mutation?.();
  expect(visibility.visible()).toBe(false);
  hidden = "false";
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(visibility.visible()).toBe(false);
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(changed).toHaveBeenCalledTimes(2);
});

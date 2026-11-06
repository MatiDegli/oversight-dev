// A real App with scripted events and intercepted transport; no provider calls.
import log from "../../../fixtures/events/handwritten-level1.jsonl?raw";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { applyEvent, createInitialState, stateStore } from "../state";
import { parseEvent } from "../transport";
import { App } from "./App";
import { InitialShellLayout, type ShellLayout } from "./shell/useShell";
import { workspacePreferenceKeys } from "./shell/workspacePreferences";

const events = log.trim().split("\n").map(parseEvent);
stateStore.setState({
  state: events
    .filter((event) => event.seq <= Number(new URLSearchParams(location.search).get("seq") ?? 20))
    .reduce(applyEvent, createInitialState()),
});
const initial = new URLSearchParams(location.search).get("initial");
const override = ["Chat", "Code", "Oversight"].includes(initial ?? "")
  ? (initial as ShellLayout)
  : undefined;
const host = document.getElementById("root");
if (!host) throw new Error("Missing fixture root");
flushSync(() => {
  createRoot(host).render(
    <InitialShellLayout value={override}>
      <App />
    </InitialShellLayout>,
  );
});

export const codeViewTest = {
  keys: workspacePreferenceKeys(),
  advance(end: number) {
    const { state, applyEvents } = stateStore.getState();
    flushSync(() => {
      applyEvents(events.filter((event) => event.seq > state.lastSeq && event.seq <= end));
    });
  },
  async editorState() {
    // eslint-disable-next-line no-restricted-syntax -- Browser proof inspects the real locally bundled Monaco instance.
    const { monaco } = await import("../editor/monaco");
    const code = monaco.editor.getEditors().find((item) => item.getModel() !== null);
    if (!code) throw new Error("Editor not mounted");
    return {
      id: code.getId(),
      model: code.getModel()?.id,
      value: code.getValue(),
      selection: code.getSelection(),
      position: code.getPosition(),
      top: code.getScrollTop(),
      left: code.getScrollLeft(),
    };
  },
};
Object.assign(window, { codeViewTest });
declare global {
  interface Window {
    codeViewTest: typeof codeViewTest;
  }
}

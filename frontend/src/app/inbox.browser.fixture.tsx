import { lazy, Suspense, useLayoutEffect, useState } from "react";
import type { ServerEvent } from "@contracts";
import { useStore } from "zustand";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import log from "../../../fixtures/events/handwritten-inbox-grants.jsonl?raw";
import { applyEvent, createInitialState, stateStore, type State } from "../state";
import { candidateKey, DecisionContext, loadDecisionInbox, useAnswers } from "../review";
import kinds from "../../../fixtures/events/handwritten-inbox-kinds.jsonl?raw";
import { parseEvent } from "../transport";
import { Frame } from "./Frame";
import type { View } from "./view";
import { clickNode, closePanel, navigateView, surfaceTab, tabbedView, viewReducer } from "./view";
const events = log.trim().split("\n").map(parseEvent);
let root: Root | undefined;
let openChange: (id: string) => void;
function Harness({ end }: { end: number }) {
  const state = events.slice(0, end).reduce(applyEvent, createInitialState());
  const [view, setView] = useState<View>(tabbedView);
  const review = (id: string) => {
    setView((current) =>
      navigateView(current, { ...current, review: id, diff: null, file: null }, state),
    );
  };
  useLayoutEffect(() => {
    openChange = review;
  });
  return (
    <Frame
      state={state}
      view={view}
      onNodeTap={(id) => {
        setView((v) => navigateView(v, clickNode(state, v, id), state));
      }}
      canOpenChange={() => true}
      onOpenChange={review}
      onReview={review}
      canReview={() => true}
      onClosePanel={() => {
        setView(closePanel);
      }}
      onOpenQueue={() => {
        setView((v) => viewReducer(v, { type: "open", tab: surfaceTab(v, "inbox") }));
      }}
      onTabAction={(action) => {
        setView((v) => viewReducer(v, action));
      }}
      replayLabel="Hand-written inbox and grants fixture"
      replayOf="hand-written fixture"
    />
  );
}
export function mountInbox(end = events.length) {
  root?.unmount();
  stateStore.setState({ state: events.slice(0, end).reduce(applyEvent, createInitialState()) });
  const host = document.createElement("div");
  host.style.height = "100vh";
  document.body.replaceChildren(host);
  root = createRoot(host);
  flushSync(() => root?.render(<Harness end={end} />));
}

export function openInboxChange(id: string) {
  flushSync(() => {
    openChange(id);
  });
}

// B8 synthetic packet proof; mutation handlers deliberately fail on accidental authority.
const PacketInbox = lazy(async () => ({ default: (await loadDecisionInbox()).DecisionInbox }));
const packetMutation = () => {
  throw new Error("Packet interaction called a decision handler");
};
function PacketHarness({ standalone, replay }: { standalone: boolean; replay: boolean }) {
  const state = useStore(stateStore, (store) => store.state);
  const [view, setView] = useState<View>(tabbedView);
  const review = (id: string) => {
    setView((v) => navigateView(v, { ...v, review: id }, state));
  };
  if (standalone)
    return (
      <DecisionContext value={replay ? {} : { onDecide: packetMutation }}>
        <Suspense>
          <PacketInbox state={state} />
        </Suspense>
      </DecisionContext>
    );
  return (
    <Frame
      state={state}
      view={view}
      onNodeTap={() => {}}
      canOpenChange={() => true}
      onOpenChange={review}
      onReview={review}
      canReview={() => true}
      onClosePanel={() => {
        setView(closePanel);
      }}
      onOpenQueue={() => {
        setView((v) => viewReducer(v, { type: "open", tab: surfaceTab(v, "inbox") }));
      }}
      onTabAction={(action) => {
        setView((v) => viewReducer(v, action));
      }}
      onDecide={replay ? undefined : packetMutation}
      replayLabel={replay ? "Hand-written packet fixture" : undefined}
    />
  );
}
export const packetTest = {
  mount(source: "grants" | "kinds" = "grants", standalone = false, replay = false) {
    root?.unmount();
    const state = (source === "grants" ? log : kinds)
      .trim()
      .split("\n")
      .map(parseEvent)
      .reduce(applyEvent, createInitialState());
    stateStore.setState({ state });
    useAnswers.setState({ drafts: {}, grants: {} });
    const host = document.createElement("div");
    host.style.height = "100vh";
    document.body.replaceChildren(host);
    root = createRoot(host);
    flushSync(() => {
      root?.render(<PacketHarness standalone={standalone} replay={replay} />);
    });
  },
  state: () => stateStore.getState().state,
  update(state: State) {
    flushSync(() => {
      stateStore.setState({ state });
    });
  },
  emit(event: ServerEvent) {
    packetTest.update(applyEvent(stateStore.getState().state, event));
  },
  draft: (id: string) => candidateKey(stateStore.getState().state, id),
  answers: useAnswers,
};

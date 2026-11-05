import type { ServerEvent } from "@contracts";
import { flowEvents } from "./planFlow.browser.fixture";
import { event, proposal, status } from "./chatAgents.fixture";
import { mountWorkflow } from "./workflowPanel.browser.fixture";
export * from "./workflowPanel.browser.fixture";

export function mergeEvents(): ServerEvent[] {
  const events = flowEvents("gates");
  const current = events.findLast((item) => item.type === "plan.updated");
  if (current?.type !== "plan.updated") throw new Error("Missing synthetic plan");
  return [
    ...events,
    event("plan.updated", {
      ...current.payload,
      revision: current.payload.revision + 1,
      subtasks:
        current.payload.subtasks?.map((task, index) =>
          index === 2
            ? {
                ...task,
                task: "Validate the extraordinarily long checkout_input_validation_with_inventory_reservations identifier and preserve accented input: acción, 数量, 🛒.",
              }
            : task,
        ) ?? null,
    }),
    status("flow-3", {
      plan_id: "plan-checkout",
      state: "ready_for_review",
      model: "legacy-profile-without-recorded-metadata",
      base_commit: null,
    }),
    proposal("flow-3"),
  ];
}
export function mountMergeQueue(layout: "Chat" | "Oversight" = "Chat") {
  return mountWorkflow({ layout, events: mergeEvents() });
}

export function mountTextCanvas(task: string, layout: "Chat" | "Oversight") {
  const events = mergeEvents().map((event) =>
    event.type === "plan.updated"
      ? {
          ...event,
          payload: {
            ...event.payload,
            subtasks: event.payload.subtasks?.map((subtask) => ({ ...subtask, task })) ?? null,
          },
        }
      : event,
  );
  return mountWorkflow({ layout, events });
}

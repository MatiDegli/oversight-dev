import type { State } from "./types";

type Team = Readonly<{ team: string; kind: "lead" | "plan" | "agent" }>;
type Teams = Readonly<{
  byAgent: Readonly<Record<string, Team>>;
  byPlan: Readonly<Record<string, Team>>;
  teamOrder: readonly string[];
}>;

const cache = new WeakMap<State, Teams>();

/** Run-local identities and first-start order, resolved over the complete accepted prefix. */
export function selectTeams(state: State): Teams {
  const cached = cache.get(state);
  if (cached) return cached;

  const observed = new Set<string>();
  const order: { id: string; plan: boolean }[] = [];
  const observe = (id: string, plan = false) => {
    order.push({ id, plan });
  };
  const agentPlan = new Map<string, string>();
  const planLead = new Map<string, string | null>();
  const leads = new Set<string>();
  // Coding ticks omit plan_id; plan-tagged ticks belong to usage-only planners (_tick.py,
  // runtime_plans.py). Retained decision envelopes already follow accepted sequence order.
  for (const event of state.decisionEvents) {
    switch (event.type) {
      case "agent.status": {
        const { agent_id, plan_id } = event.payload;
        observed.add(agent_id);
        observe(agent_id);
        if (plan_id !== null && !agentPlan.has(agent_id)) agentPlan.set(agent_id, plan_id);
        break;
      }
      case "plan.updated": {
        const { plan_id, started_by } = event.payload;
        planLead.set(plan_id, started_by);
        observe(plan_id, true);
        if (started_by !== null) {
          observed.add(started_by);
          observe(started_by);
          leads.add(started_by);
        }
        break;
      }
      case "lead.status":
        observed.add(event.payload.agent_id);
        observe(event.payload.agent_id);
        leads.add(event.payload.agent_id);
        break;
      case "change.assessed":
      case "change.facts_recorded":
      case "change.proposed":
      case "change.resolved":
      case "error":
      case "queue.updated":
      case "revert.resolved":
        break;
    }
  }

  const result = resolveTeams(observed, agentPlan, planLead, leads, order);
  cache.set(state, result);
  return result;
}

function resolveTeams(
  observed: Set<string>,
  agentPlan: Map<string, string>,
  planLead: Map<string, string | null>,
  leads: Set<string>,
  order: { id: string; plan: boolean }[],
): Teams {
  const entries = [...observed].map((id): [string, Team] => {
    const plan = agentPlan.get(id);
    const lead = plan === undefined ? null : planLead.get(plan);
    const identity: Team = leads.has(id)
      ? { team: id, kind: "lead" }
      : lead != null
        ? { team: lead, kind: "lead" }
        : plan !== undefined
          ? { team: plan, kind: "plan" }
          : { team: id, kind: "agent" };
    return [id, Object.freeze(identity)];
  });
  // Resolve before ordering: the earliest member can introduce a lead discovered later.
  const byPlan = Object.fromEntries(
    [...planLead].map(([id, lead]) => [
      id,
      Object.freeze({ team: lead ?? id, kind: lead ? ("lead" as const) : ("plan" as const) }),
    ]),
  );
  const byAgent = Object.fromEntries(entries);
  const teamOrder = [
    ...new Set(order.map(({ id, plan }) => (plan ? byPlan[id] : byAgent[id])?.team ?? id)),
  ];
  const result = Object.freeze({
    byAgent: Object.freeze(byAgent),
    byPlan: Object.freeze(byPlan),
    teamOrder: Object.freeze(teamOrder),
  });
  return result;
}

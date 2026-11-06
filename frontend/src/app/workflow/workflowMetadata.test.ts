import { expect, it } from "vitest";
import { createInitialState, projectPlanFlow } from "../../state";
import { presentationFor, presentationForPlan } from "../../teams/presentation";
import { workflowDetail } from "./workflowDetail";
import { agent, append, candidateState, evidencePlan, run } from "./workflowEvidence.testSupport";
function detail(state: ReturnType<typeof candidateState>, index = 0) {
  const row = projectPlanFlow(state, evidencePlan)[index];
  if (!row) throw new Error("Missing row");
  return workflowDetail(row, state, true);
}
it("joins the recorded profile, with reasoning labeled independently from control mode", () => {
  const state = candidateState();
  expect(detail(state)).toMatchObject({
    role: "Coding agent · recorded agent.status",
    model: "Fake",
    reasoning: "None · profile has no reasoning setting",
    mode: "Not known · workflow control mode is not recorded",
  });
  const changed = append(state, "agent.status", { ...agent, model: "absent-profile" });
  expect(detail(changed).model).toBe("absent-profile · profile not recorded");
  expect(detail(changed).reasoning).toContain("Not known");
});
it("uses profile reasoning rather than merge or tool modes", () => {
  const state = candidateState();
  const profile = run.models[0];
  if (!profile) throw new Error("Missing scripted profile");
  const withReasoning = {
    ...state,
    run: { ...run, models: [{ ...profile, reasoning: "high" }] },
  };
  expect(detail(withReasoning).reasoning).toBe("high");
  expect(detail(withReasoning).mode).toContain("not recorded");
});
it("resolves unassigned Team for both lead-owned and leadless plans before any status", () => {
  for (const lead of ["lead", null]) {
    const plan = { ...evidencePlan, started_by: lead, revision: 2 };
    const started = append(createInitialState(), "run.started", run);
    const state = append(started, "plan.updated", plan);
    const row = projectPlanFlow(state, plan)[2];
    if (!row) throw new Error("Missing waiting step");
    const result = workflowDetail(row, state, false);
    expect(result.team?.team).toBe(lead ?? plan.plan_id);
    expect(result.team?.kind).toBe(lead ? "lead" : "plan");
    expect(result.agent).toBe("Not known");
    expect(result.model).toContain("no agent status recorded");
    expect(result.role).toContain("no agent status recorded");
  }
});
it("shares plan palette and team labels with assigned agents and legacy recordings", () => {
  const state = candidateState();
  expect(presentationForPlan(state, evidencePlan.plan_id)?.letter).toBe(
    presentationFor(state, agent.agent_id)?.letter,
  );
  expect(detail(state, 2).team?.hue).toBe(detail(state).team?.hue);
  const legacy = append(state, "agent.status", {
    ...agent,
    plan_id: null,
    model: "legacy-profile",
  });
  expect(detail(legacy).model).toBe("legacy-profile · profile not recorded");
  expect(detail(legacy).team?.team).toBe("lead");
});

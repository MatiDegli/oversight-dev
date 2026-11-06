import type {
  ChangeResolved,
  ChangeStages,
  ServerEvent,
  StageTime,
  SuiteExecution,
} from "@contracts";

const phases = ["agent", "proposal", "combined", "base_probe", "head_probe"] as const;
type Phase = (typeof phases)[number];
export type StagePoint = { seq: number; ms: number | null };
type Window = {
  revision: number;
  start: StagePoint;
  receipt: StagePoint | null;
  combined: number | null;
};

/** Match parse_ts: UTC, fractional seconds, valid calendar date; floor to milliseconds. */
export function stagePoint(event: ServerEvent): StagePoint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,6})Z$/.exec(event.ts);
  const normalized = match
    ? `${match[1] ?? ""}.${match[2]?.padEnd(3, "0").slice(0, 3) ?? ""}Z`
    : "";
  const ms = Date.parse(normalized);
  const valid =
    !normalized.startsWith("0000") &&
    Number.isFinite(ms) &&
    new Date(ms).toISOString() === normalized;
  return { seq: event.seq, ms: valid ? ms : null };
}

interface StageTotal {
  known_ms: number;
  intervals: number;
  unknown: boolean;
  running: boolean;
}

/** JSON data only: no retained envelopes, classes or Maps in reducer state. */
export interface StageAcc {
  agent: StageTotal;
  checks: StageTotal;
  waiting: StageTotal;
  tests: StageTotal;
  phases: Partial<Record<Phase, { ms: number; runs: number }>>;
  problems: { seq: number; sentence: string }[];
  active: StagePoint | null;
  window: Window | null;
}

const total = (): StageTotal => ({ known_ms: 0, intervals: 0, unknown: false, running: false });
export function createStageAcc(): StageAcc {
  return {
    agent: total(),
    checks: total(),
    waiting: total(),
    tests: total(),
    phases: {},
    problems: [],
    active: null,
    window: null,
  };
}

function copyAcc(acc: StageAcc): StageAcc {
  return {
    ...acc,
    agent: { ...acc.agent },
    checks: { ...acc.checks },
    waiting: { ...acc.waiting },
    tests: { ...acc.tests },
    phases: { ...acc.phases },
    problems: [...acc.problems],
    window: acc.window ? { ...acc.window } : null,
  };
}

function add(stage: StageTotal, ms: number | null, running = false) {
  stage.intervals++;
  stage.unknown ||= ms === null;
  stage.known_ms += ms ?? 0;
  stage.running ||= running;
}

function view(stage: StageTotal): StageTime {
  return {
    ms: stage.unknown ? null : stage.known_ms,
    known_ms: stage.known_ms,
    intervals: stage.intervals,
    open: stage.running,
  };
}

class Fold {
  constructor(readonly data: StageAcc = createStageAcc()) {}

  problem(seq: number, sentence: string) {
    this.data.problems.push({ seq, sentence });
    // Stable ties preserve consume order; a late invalid start can have an earlier seq.
    this.data.problems.sort((a, b) => a.seq - b.seq);
    if (this.data.problems.length > 20) this.data.problems.length = 20;
  }

  elapsed(start: StagePoint, end: StagePoint): number | null {
    if (start.ms === null || end.ms === null || end.ms < start.ms) {
      const seq = start.ms === null ? start.seq : end.seq;
      this.problem(seq, `Timestamp goes back or is invalid at seq ${String(seq)}.`);
      return null;
    }
    return end.ms - start.ms;
  }

  status(state: string, at: StagePoint) {
    if (["starting", "working", "revising"].includes(state)) {
      this.data.active ??= at;
    } else if (this.data.active !== null) {
      add(this.data.agent, this.elapsed(this.data.active, at));
      this.data.active = null;
    }
  }

  suite(payload: SuiteExecution, at: StagePoint) {
    const duration = payload.suite.duration_ms;
    if (duration < 0) this.problem(at.seq, `Negative suite duration at seq ${String(at.seq)}.`);
    add(this.data.tests, duration >= 0 ? duration : null);
    const phase = this.data.phases[payload.phase] ?? { ms: 0, runs: 0 };
    this.data.phases[payload.phase] = {
      ms: phase.ms + (duration >= 0 ? duration : 0),
      runs: phase.runs + 1,
    };
    if (this.data.window?.revision === payload.revision && payload.phase === "combined") {
      this.data.window.combined = duration;
    }
  }

  closeWindow(
    end: StagePoint,
    reason: "resolved" | "replaced" | "open",
    resolution?: ChangeResolved,
  ) {
    const window = this.data.window;
    if (window === null) return;
    let start: StagePoint;
    if (window.receipt !== null) {
      add(this.data.checks, this.elapsed(window.start, window.receipt));
      start = window.receipt;
    } else if (reason === "open") {
      add(this.data.checks, this.elapsed(window.start, end), true);
      return;
    } else {
      start = window.start;
    }
    if (reason === "replaced") {
      add(this.data.waiting, null);
      this.problem(
        end.seq,
        `Revision ${String(window.revision)} replaced without a decision at seq ${String(end.seq)}.`,
      );
    } else if (reason === "open") {
      add(this.data.waiting, this.elapsed(start, end), true);
    } else if (resolution) {
      this.decision(window, start, end, resolution);
    }
    this.data.window = null;
  }

  decision(window: Window, start: StagePoint, end: StagePoint, resolution: ChangeResolved) {
    if (resolution.decided_by === null) {
      add(this.data.waiting, null);
      this.problem(
        end.seq,
        `No recorded decider for revision ${String(window.revision)} at seq ${String(end.seq)}.`,
      );
      return;
    }
    if (resolution.decided_by !== "person") return;
    let elapsed = this.elapsed(start, end);
    if (elapsed !== null && resolution.decision === "approved" && window.combined !== null) {
      const duration = window.combined;
      if (duration < 0) {
        elapsed = null;
        this.problem(
          end.seq,
          `Waiting unknown after negative combined suite at seq ${String(end.seq)}.`,
        );
      } else if (duration > elapsed) {
        elapsed = null;
        this.problem(end.seq, `Combined run longer than the wait at seq ${String(end.seq)}.`);
      } else {
        elapsed -= duration;
      }
    }
    add(this.data.waiting, elapsed);
  }

  consume(event: ServerEvent, at: StagePoint) {
    // Other envelopes contribute continuity and the horizon only, as in the backend fold.
    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
    switch (event.type) {
      case "agent.status":
        this.status(event.payload.state, at);
        break;
      case "change.proposed":
        this.closeWindow(at, "replaced");
        this.data.window = {
          revision: event.payload.revision,
          start: at,
          receipt: null,
          combined: null,
        };
        break;
      case "change.resolved":
        if (this.data.window?.revision !== event.payload.revision) return false;
        this.closeWindow(at, "resolved", event.payload);
        break;
      case "change.facts_recorded":
      case "change.reviewed":
      case "change.assessed":
        if (this.data.window?.revision !== event.payload.revision) return false;
        this.data.window.receipt = at;
        break;
      case "tests.executed":
        this.suite(event.payload, at);
        break;
      default:
        return false;
    }
    return true;
  }

  finish(end: StagePoint): ChangeStages {
    if (this.data.active !== null) add(this.data.agent, this.elapsed(this.data.active, end), true);
    this.closeWindow(end, "open");
    return {
      agent_work: view(this.data.agent),
      checks: view(this.data.checks),
      waiting_for_person: view(this.data.waiting),
      test_runs: view(this.data.tests),
      test_phases: phases.flatMap((phase) => {
        const counts = this.data.phases[phase];
        return counts ? [{ phase, ...counts }] : [];
      }),
      problems: this.data.problems
        .sort((a, b) => a.seq - b.seq)
        .slice(0, 20)
        .map((p) => p.sentence),
    };
  }
}

/** Backend stage_fold parity: complete committed prefix, including unrelated envelopes.
 * Approval waiting ends at the receipt less the combined suite; it may include merge queueing.
 * Stages overlap. No wall clock or playback position participates in this projection.
 */
export function foldStages(events: readonly ServerEvent[], changeId: string): ChangeStages | null {
  if (!events.length) return null;
  const fold = new Fold();
  let at: StagePoint = { seq: 0, ms: null };
  for (const [index, event] of events.entries()) {
    if (!Number.isInteger(event.seq) || event.seq !== index + 1) return null;
    at = stagePoint(event);
    if ("change_id" in event.payload && event.payload.change_id === changeId) {
      fold.consume(event, at);
    }
  }
  return fold.finish(at);
}

/** Consume into a private copy; both incremental projection and the full fold use Fold.consume. */
export function consumeStage(acc: StageAcc | undefined, event: ServerEvent, at: StagePoint) {
  const fold = new Fold(acc ? copyAcc(acc) : createStageAcc());
  return fold.consume(event, at) ? fold.data : acc;
}

/** finish closes windows and appends horizon diagnostics only on this disposable copy. */
export function finishStages(acc: StageAcc | undefined, end: StagePoint): ChangeStages {
  return new Fold(acc ? copyAcc(acc) : createStageAcc()).finish(end);
}

function sameTime(a: StageTime, b: StageTime): boolean {
  return (
    a.ms === b.ms && a.known_ms === b.known_ms && a.intervals === b.intervals && a.open === b.open
  );
}

export function sameStages(a: ChangeStages | null | undefined, b: ChangeStages | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    sameTime(a.agent_work, b.agent_work) &&
    sameTime(a.checks, b.checks) &&
    sameTime(a.waiting_for_person, b.waiting_for_person) &&
    sameTime(a.test_runs, b.test_runs) &&
    a.test_phases.length === b.test_phases.length &&
    a.test_phases.every((phase, index) => {
      const other = b.test_phases[index];
      return other?.phase === phase.phase && other.ms === phase.ms && other.runs === phase.runs;
    }) &&
    a.problems.length === b.problems.length &&
    a.problems.every((problem, index) => problem === b.problems[index])
  );
}

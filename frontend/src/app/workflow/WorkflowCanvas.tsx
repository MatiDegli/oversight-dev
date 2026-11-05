import { useId } from "react";
import type { PlanFlowRow } from "../../state";
import { truncateTask } from "./truncateTask";
import "./workflowCanvas.css";

export const stepKey = (row: Pick<PlanFlowRow, "planId" | "index">) =>
  JSON.stringify([row.planId, row.index]);

/** Stable dependency layers; no inference of identity across plan revisions. */
export function workflowCanvas(rows: PlanFlowRow[]) {
  let line = 0;
  const nodes = [...new Set(rows.map((row) => row.wave))]
    .sort((a, b) => a - b)
    .flatMap((wave) => {
      const layer = rows.filter((row) => row.wave === wave);
      const start = line;
      line += Math.ceil(layer.length / 2);
      return layer.map((row, index) => ({
        key: stepKey(row),
        row,
        x: layer.length === 1 ? 50 : index % 2 === 0 ? 25 : 75,
        y: (start + Math.floor(index / 2)) * 192,
      }));
    });
  const edges = nodes.flatMap((node) =>
    node.row.task.depends_on.flatMap((index) => {
      const from = nodes.find((parent) => parent.row.index === index);
      return from
        ? [
            {
              from: from.key,
              to: node.key,
              label: `Step ${String(node.row.index + 1)} waits for step ${String(index + 1)} to merge`,
              path: `M ${String(from.x * 10)} ${String(from.y + 144)} L ${String(node.x * 10)} ${String(node.y - 8)}`,
            },
          ]
        : [];
    }),
  );
  return { nodes, edges, height: Math.max(0, line * 192 - 48) };
}

export function WorkflowCanvas({
  rows,
  selection,
  detailId,
  onSelect,
}: {
  rows: PlanFlowRow[];
  selection: string | null;
  detailId: string;
  onSelect: (key: string) => void;
}) {
  const arrow = useId();
  const canvas = workflowCanvas(rows);
  return (
    <section aria-label="Dependency canvas">
      <p className="workflow-canvas-help">Read-only · Arrows point to steps waiting for a merge.</p>
      <div className="workflow-canvas" style={{ height: canvas.height }}>
        <svg
          viewBox={`0 0 1000 ${String(canvas.height)}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Merge dependencies"
        >
          <defs>
            <marker
              id={arrow}
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 5 3 L 0 6" />
            </marker>
          </defs>
          {canvas.edges.map((edge) => (
            <path
              key={`${edge.from}:${edge.to}`}
              d={edge.path}
              vectorEffect="non-scaling-stroke"
              markerEnd={`url(#${arrow})`}
            >
              <title>{edge.label}</title>
            </path>
          ))}
        </svg>
        <ol className="workflow-steps" aria-label="Workflow steps">
          {canvas.nodes.map(({ key, row, x, y }) => (
            <li key={key} style={{ left: `${String(x)}%`, top: y }}>
              <button
                type="button"
                className="workflow-step"
                aria-pressed={selection === key}
                aria-controls={detailId}
                aria-label={`${String(row.index + 1)} ${row.task.task} · ${row.word} · ${row.condition}`}
                onClick={() => {
                  onSelect(key);
                }}
              >
                <span className="workflow-number">{row.index + 1}</span>
                <span>{truncateTask(row.task.task)}</span>
                <span className="workflow-word" data-word={row.word}>
                  {row.word}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

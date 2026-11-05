import { useId, useMemo } from "react";
import type { PlanFlowRow } from "../../state";
import { truncateTask } from "./truncateTask";
import { useCanvasEdges } from "./useCanvasEdges";
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
        column: layer.length === 1 ? "1 / -1" : String((index % 2) + 1),
        line: start + Math.floor(index / 2) + 1,
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
            },
          ]
        : [];
    }),
  );
  return { nodes, edges };
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
  const canvas = useMemo(() => workflowCanvas(rows), [rows]);
  const host = useCanvasEdges(canvas.edges);
  return (
    <section aria-label="Dependency canvas">
      <p className="workflow-canvas-help">Read-only · Arrows point to steps waiting for a merge.</p>
      <div ref={host} className="workflow-canvas">
        <svg role="img" aria-label="Merge dependencies">
          <defs>
            <marker
              id={arrow}
              markerWidth="8"
              markerHeight="8"
              refX="8"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 8 4 L 0 8 Z" />
            </marker>
          </defs>
          {canvas.edges.map((edge) => (
            <path
              key={`${edge.from}:${edge.to}`}
              vectorEffect="non-scaling-stroke"
              markerEnd={`url(#${arrow})`}
            >
              <title>{edge.label}</title>
            </path>
          ))}
        </svg>
        <ol className="workflow-steps" aria-label="Workflow steps">
          {canvas.nodes.map(({ key, row, column, line }) => (
            <li key={key} style={{ gridColumn: column, gridRow: line }} data-step-key={key}>
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

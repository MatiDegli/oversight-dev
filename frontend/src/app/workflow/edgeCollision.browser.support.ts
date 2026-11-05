import type { Locator } from "@playwright/test";

type Point = { x: number; y: number };
type Segment = { from: Point; to: Point };

function segments(path: string): Segment[] {
  const result: Segment[] = [];
  let previous: Point | undefined;
  for (const match of path.matchAll(/([ML])\s*([\d.e+-]+)[ ,]+([\d.e+-]+)/g)) {
    const point = { x: Number(match[2]), y: Number(match[3]) };
    if (match[1] === "L" && previous) result.push({ from: previous, to: point });
    previous = point;
  }
  return result;
}

function pointDistance(point: Point, line: Segment) {
  const dx = line.to.x - line.from.x;
  const dy = line.to.y - line.from.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - line.from.x) * dx + (point.y - line.from.y) * dy) / (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(point.x - line.from.x - t * dx, point.y - line.from.y - t * dy);
}

function touches(a: Segment, b: Segment) {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const intersects =
    cross(a.from, a.to, b.from) * cross(a.from, a.to, b.to) <= 0 &&
    cross(b.from, b.to, a.from) * cross(b.from, b.to, a.to) <= 0;
  const overlaps =
    Math.max(a.from.x, a.to.x) >= Math.min(b.from.x, b.to.x) &&
    Math.max(b.from.x, b.to.x) >= Math.min(a.from.x, a.to.x) &&
    Math.max(a.from.y, a.to.y) >= Math.min(b.from.y, b.to.y) &&
    Math.max(b.from.y, b.to.y) >= Math.min(a.from.y, a.to.y);
  return (
    (intersects && overlaps) ||
    Math.min(
      pointDistance(a.from, b),
      pointDistance(a.to, b),
      pointDistance(b.from, a),
      pointDistance(b.to, a),
    ) <= 1.5
  );
}

/** Inspect actual SVG subpaths, including crossings, parallel contacts and arrowheads. */
export async function edgeContacts(panel: Locator) {
  const paths = await panel
    .locator(".workflow-canvas svg > path")
    .evaluateAll((elements) =>
      elements.map((path) => ({ d: path.getAttribute("d") ?? "", label: path.textContent })),
    );
  const lines = paths.map((path) => {
    const route = segments(path.d);
    const tip = route.at(-1)?.to;
    if (!tip) throw new Error("Missing routed dependency");
    const left = { x: tip.x - 4, y: tip.y - 8 };
    const right = { x: tip.x + 4, y: tip.y - 8 };
    return [...route, { from: left, to: tip }, { from: tip, to: right }, { from: right, to: left }];
  });
  return paths.flatMap((path, index) =>
    paths.slice(index + 1).flatMap((other, offset) => {
      const label = path.label;
      const otherLabel = other.label;
      return lines[index]?.some((a) => lines[index + offset + 1]?.some((b) => touches(a, b)))
        ? [`${label} touches ${otherLabel}`]
        : [];
    }),
  );
}

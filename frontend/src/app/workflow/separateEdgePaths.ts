export type EdgePoint = { x: number; y: number };
type Segment = { from: EdgePoint; to: EdgePoint; start: number; length: number };

function segments(points: EdgePoint[]): Segment[] {
  let start = 0;
  return points
    .slice(1)
    .map((to, index) => {
      const from = points[index] ?? to;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const segment = { from, to, start, length };
      start += length;
      return segment;
    })
    .filter((segment) => segment.length > 0);
}

function crossing(a: Segment, b: Segment) {
  const horizontal = a.from.y === a.to.y;
  if (horizontal === (b.from.y === b.to.y)) return null;
  const x = horizontal ? b.from.x : a.from.x;
  const y = horizontal ? a.from.y : b.from.y;
  const contains = (segment: Segment) =>
    x >= Math.min(segment.from.x, segment.to.x) &&
    x <= Math.max(segment.from.x, segment.to.x) &&
    y >= Math.min(segment.from.y, segment.to.y) &&
    y <= Math.max(segment.from.y, segment.to.y);
  return contains(a) && contains(b) ? { x, y } : null;
}

// Subpixel normalization also keeps translated/scrolled viewports byte-identical.
export const edgePosition = (point: EdgePoint) =>
  [point.x, point.y].map((value) => String(Math.round(value * 1000) / 1000)).join(" ");

function draw(segments: Segment[], cuts: number[]) {
  const gaps = cuts
    .sort((a, b) => a - b)
    .reduce<[number, number][]>((result, cut) => {
      const last = result.at(-1);
      if (last && cut - 5 <= last[1]) last[1] = cut + 5;
      else result.push([cut - 5, cut + 5]);
      return result;
    }, []);
  let previous: EdgePoint | undefined;
  return segments
    .flatMap((segment) => {
      const pointAt = (distance: number) => ({
        x: segment.from.x + ((segment.to.x - segment.from.x) * distance) / segment.length,
        y: segment.from.y + ((segment.to.y - segment.from.y) * distance) / segment.length,
      });
      let spans: [number, number][] = [[segment.start, segment.start + segment.length]];
      for (const [left, right] of gaps) {
        spans = spans.flatMap(([start, end]) => {
          if (right <= start || left >= end) return [[start, end]];
          return [
            ...(left > start ? [[start, left] as [number, number]] : []),
            ...(right < end ? [[right, end] as [number, number]] : []),
          ];
        });
      }
      return spans.map(([start, end]) => {
        const from = pointAt(start - segment.start);
        const to = pointAt(end - segment.start);
        const move =
          previous && Math.hypot(previous.x - from.x, previous.y - from.y) < 0.001
            ? ""
            : `M ${edgePosition(from)} `;
        previous = to;
        return `${move}L ${edgePosition(to)}`;
      });
    })
    .join(" ");
}

/** Orthogonal crossings are overpasses, never dependency junctions or shared trunks. */
export function separateEdgePaths(routes: EdgePoint[][]): string[] {
  const lines = routes.map(segments);
  const cuts = routes.map(() => [] as number[]);
  lines.forEach((line, index) => {
    lines.slice(index + 1).forEach((other, offset) => {
      for (const a of line)
        for (const b of other) {
          const point = crossing(a, b);
          if (!point) continue;
          const distance = a.start + Math.hypot(point.x - a.from.x, point.y - a.from.y);
          const length = (line.at(-1)?.start ?? 0) + (line.at(-1)?.length ?? 0);
          // Keep a complete departure and arrowhead; cut the other edge near an endpoint.
          if (distance >= 12 && length - distance >= 12) cuts[index]?.push(distance);
          else
            cuts[index + offset + 1]?.push(
              b.start + Math.hypot(point.x - b.from.x, point.y - b.from.y),
            );
        }
    });
  });
  return lines.map((line, index) => draw(line, cuts[index] ?? []));
}

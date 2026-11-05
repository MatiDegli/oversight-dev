import { expect, it } from "vitest";
import { canvasEdgeRoutes } from "./canvasEdgeRoutes";
import { separateEdgePaths } from "./separateEdgePaths";

const box = (left: number, top: number) => ({ left, right: left + 140, top, bottom: top + 144 });
const bounds = { left: 0, right: 360, top: 0, bottom: 720 };
const edges = [
  { from: "a", to: "b" },
  { from: "a", to: "c" },
  { from: "b", to: "c" },
];
const boxes = new Map([
  ["a", box(24, 0)],
  ["b", box(24, 192)],
  ["c", box(24, 576)],
]);
const points = (path: string) =>
  [...path.matchAll(/[ML] ([\d.e+-]+) ([\d.e+-]+)/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));

it("allocates distinct departure and arrival ports, including independent halves of each node", () => {
  const routes = canvasEdgeRoutes(edges, boxes, bounds, 48, 24).map((route) => points(route.d));
  expect(routes[0]?.[0]?.x).not.toBe(routes[1]?.[0]?.x);
  expect(routes[1]?.at(-1)?.x).not.toBe(routes[2]?.at(-1)?.x);
  expect(routes[0]?.at(-1)?.x).toBeGreaterThan(routes[2]?.[0]?.x ?? 0);
});

it("reserves separate bands for long departures, short connections and long arrivals", () => {
  const long = { from: "a", to: "c" };
  const short = { from: "a", to: "b" };
  const routes = canvasEdgeRoutes([short, long], boxes, bounds, 48, 24);
  const direct = points(routes[0]?.d ?? "");
  const bypass = points(routes[1]?.d ?? "");
  expect(bypass[1]?.y).toBeLessThan(144 + 48 * 0.25);
  expect(direct[1]?.y).toBeGreaterThan(144 + 48 * 0.35);
  expect(direct[1]?.y).toBeLessThan(144 + 48 * 0.55);
  expect(bypass.at(-2)?.y).toBeGreaterThan(576 - 48 * 0.35);
});

it("keeps the final arrow stroke separate from overpass subpaths and translates viewport bounds", () => {
  const original = canvasEdgeRoutes(edges, boxes, bounds, 48, 24);
  const shifted = new Map(
    [...boxes].map(([key, value]) => [
      key,
      {
        left: value.left + 10,
        right: value.right + 10,
        top: value.top + 20,
        bottom: value.bottom + 20,
      },
    ]),
  );
  expect(
    canvasEdgeRoutes(edges, shifted, { left: 10, right: 370, top: 20, bottom: 740 }, 48, 24),
  ).toEqual(original);
  for (const route of original) {
    const tip = points(route.d).at(-1);
    expect(points(route.arrow).at(-1)).toEqual(tip);
    expect(points(route.arrow)[0]?.y).toBe((tip?.y ?? 0) - 1);
  }
});

it("interrupts only the underpassing line and preserves both endpoint arrows", () => {
  const routes = separateEdgePaths([
    [
      { x: 0, y: 20 },
      { x: 100, y: 20 },
    ],
    [
      { x: 50, y: 0 },
      { x: 50, y: 100 },
    ],
  ]);
  expect(routes).toEqual(["M 0 20 L 45 20 M 55 20 L 100 20", "M 50 0 L 50 100"]);
});

it("cuts around corners and merges neighboring overpasses without reconnecting their gaps", () => {
  const routes = separateEdgePaths([
    [
      { x: 0, y: 20 },
      { x: 50, y: 20 },
      { x: 50, y: 100 },
    ],
    [
      { x: 48, y: 0 },
      { x: 48, y: 100 },
    ],
    [
      { x: 0, y: 20 },
      { x: 100, y: 20 },
    ],
  ]);
  expect(routes[0]).toBe("M 0 20 L 43 20 M 50 25 L 50 100");
});

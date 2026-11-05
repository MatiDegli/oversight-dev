import type { Core, Position } from "cytoscape";

import { getActiveTheme } from "../theme";

import { packFallback } from "./fallbackLayout";
import { startCamera } from "./camera";
import type { GraphElement } from "./elements";
import { FIT_PADDING, nodeGeometry } from "./geometry";
import { applyFrames } from "./frames";
import { growthPositions, placeAdditions } from "./place";
import { applyRoutes } from "./routes";
import type { RouteTheme } from "./routes";
import { graphProjection } from "./graphProjection";
import type { ElementSignature } from "./graphProjection";
import { writeData } from "./writes";

type GeometryTheme = Parameters<typeof nodeGeometry>[0] & RouteTheme;

// A compound's centre follows its children. Keep the last position it had as a leaf separately,
// including human drags, so removing its last child does not leave it at the frame's centre.
const leafPositions = new WeakMap<Core, Map<string, Position>>();
/**
 * The data keys a node carries only some of the time. `data()` merges, so a key the new definition
 * leaves out would keep its old value: a mark long after the focus is gone.
 */
const OPTIONAL_DATA = [
  "marks",
  "distance",
  "title",
  "count",
  "callCount",
  "exactCount",
  "possibleCount",
  "restPossible",
  "w",
  "h",
] as const;

interface AppliedProjection {
  elements: Map<string, ElementSignature>;
  moved: boolean;
  applying: boolean;
  ids: Set<string>;
}
const applied = new WeakMap<Core, AppliedProjection>();

function appliedProjection(cy: Core): AppliedProjection {
  let previous = applied.get(cy);
  if (previous) return previous;
  previous = {
    elements: new Map(),
    moved: false,
    applying: false,
    ids: new Set(cy.elements().map((e) => e.id())),
  };
  const tracked = previous;
  cy.on("position", "node", () => {
    if (!tracked.applying) tracked.moved = true;
  });
  applied.set(cy, previous);
  return previous;
}

/** Compare projection signatures; unchanged ids never enter the application loop. */
export function updateGraph(
  cy: Core,
  elements: GraphElement[],
  theme: GeometryTheme = getActiveTheme(),
): void {
  const previous = appliedProjection(cy);
  const projected = graphProjection(elements);
  const changed = [...projected.values()].filter(
    (entry) => previous.elements.get(entry.definition.data.id)?.value !== entry.value,
  );
  const removed = [...previous.ids].filter((id) => !projected.has(id));
  const geometry =
    previous.moved ||
    removed.length > 0 ||
    changed.some(
      (entry) => previous.elements.get(entry.definition.data.id)?.geometry !== entry.geometry,
    );
  if (!changed.length && !geometry) return;
  previous.applying = true;
  try {
    if (geometry)
      applyGeometry(
        cy,
        elements,
        changed.map((entry) => entry.definition),
        theme,
      );
    else
      cy.batch(() => {
        applyDefinitions(
          cy,
          changed.map((entry) => entry.definition),
        );
      });
    previous.elements = projected;
    previous.ids = new Set(projected.keys());
    previous.moved = false;
  } finally {
    previous.applying = false;
  }
}

/** The existing placement/history algorithm runs only when geometry can change. */
function applyGeometry(
  cy: Core,
  elements: GraphElement[],
  changed: GraphElement[],
  theme: GeometryTheme,
): void {
  const initial = cy.nodes().empty();
  const byId = new Map(elements.map((element) => [element.data.id, element]));
  const removed = [...(applied.get(cy)?.ids ?? [])].filter((id) => !byId.has(id));
  const remembered = leafPositions.get(cy) ?? new Map<string, Position>();
  leafPositions.set(cy, remembered);
  for (const id of remembered.keys()) if (!byId.has(id)) remembered.delete(id);
  for (const node of cy.nodes(":childless"))
    if (byId.has(node.id())) remembered.set(node.id(), { ...node.position() });
  const parents = new Set(elements.map((element) => element.data.parent));
  const restore = cy
    .nodes(":parent")
    .filter((node) => byId.has(node.id()) && !parents.has(node.id()) && remembered.has(node.id()));
  const removeObsolete = () => {
    // Detach survivors before removing a parent (which would remove its children too).
    for (const definition of changed.filter((e) => e.group === "nodes")) {
      const node = cy.getElementById(definition.data.id);
      if (node.nonempty() && node.parent().first().id() !== definition.data.parent) {
        node.move({ parent: null });
      }
    }
    const obsolete = cy.collection();
    for (const id of removed) obsolete.merge(cy.getElementById(id));
    obsolete.remove();
    for (const node of restore) {
      const position = remembered.get(node.id());
      if (position) node.position(position);
    }
    const history = growthPositions.get(cy);
    for (const [root, saved] of history ?? []) {
      if ([...saved.additions].some((id) => byId.has(id))) continue;
      for (const [id, point] of saved.positions) {
        cy.getElementById(id).position(point);
        if (byId.has(id)) remembered.set(id, { ...point });
      }
      history?.delete(root);
    }
  };
  const restoringGrowth = [...(growthPositions.get(cy)?.values() ?? [])].some(
    (saved) => ![...saved.additions].some((id) => byId.has(id)),
  );
  const needsAdditions = elements.some((e) => !applied.get(cy)?.ids.has(e.data.id));
  // Only simultaneous arrivals need the restored frame measured before the application batch.
  const restoreBeforePlacement = restoringGrowth && needsAdditions;
  if (restoreBeforePlacement) cy.batch(removeObsolete);
  const { additions, relocated } = needsAdditions
    ? placeAdditions(cy, elements, theme)
    : { additions: [], relocated: new Map<string, Position>() };
  cy.batch(() => {
    if (!restoreBeforePlacement) removeObsolete();
    for (const [id, point] of relocated) cy.getElementById(id).position(point);
    if (additions.length)
      cy.add(additions.map((definition) => ({ ...definition, data: { ...definition.data } })));
    applyDefinitions(cy, changed);
  });
  if (initial) initialLayout(cy, elements, theme);
  else settle(cy, theme);
}

/** Preserve interaction-owned classes and the full path's optional-data clearing semantics. */
function applyDefinitions(cy: Core, definitions: readonly GraphElement[]): void {
  for (const definition of definitions) {
    const element = cy.getElementById(definition.data.id);
    if (definition.group === "nodes") {
      if (element.parent().first().id() !== definition.data.parent) {
        element.move({ parent: definition.data.parent ?? null });
      }
    } else if (
      element.source().id() !== definition.data.source ||
      element.target().id() !== definition.data.target
    ) {
      element.removeClass("count-hover node-hover");
      element.move({ source: definition.data.source, target: definition.data.target });
    }
    writeData(element, definition.data, OPTIONAL_DATA);
    // Keep selection and routing state; hover survives while its geometry stays put.
    const owned = ["touching", "node-hover", "count-hover", "edge-shield", "unroutable"].filter(
      (name) => element.hasClass(name),
    );
    element.classes([...definition.classes.split(/\s+/).filter(Boolean), ...owned]);
  }
}

/** Choose the initial layout, then settle header bands and routes before choosing the camera. */
function initialLayout(cy: Core, elements: GraphElement[], theme: GeometryTheme): void {
  const preset = elements.some((element) => element.position !== undefined);
  if (cy.nodes().nonempty()) {
    // The preset keeps node positions and chooses a legible whole-graph start, or the hub at the
    // legibility floor. Without one, the layout places the nodes and fits the camera, as before.
    if (preset) cy.layout({ name: "preset", fit: false }).run();
    else {
      const fallback = { name: "fcose", animate: false, fit: true, padding: FIT_PADDING };
      cy.layout(fallback).run();
      packFallback(cy, theme);
    }
  }
  settle(cy, theme);
  // Header bands change frame bounds: choose the start camera only after they are final.
  if (preset) startCamera(cy);
}

/** After nodes are placed or moved: the frames' header bands and the edges' routes, in that order. */
export function settle(cy: Core, theme: GeometryTheme = getActiveTheme()): void {
  applyFrames(cy, theme);
  applyRoutes(cy, theme);
}

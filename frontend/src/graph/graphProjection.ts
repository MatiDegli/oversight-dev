import type { GraphElement } from "./elements";

export interface ElementSignature {
  definition: GraphElement;
  value: string;
  geometry: string;
}

/** Compute signatures from projected values, before consulting or writing Cytoscape. */
export function graphProjection(elements: readonly GraphElement[]) {
  return new Map(
    elements.map((definition): [string, ElementSignature] => {
      const { data, classes, group } = definition;
      const names = classes.split(/\s+/);
      // These classes change border/frame bounds or router membership. Pure paint classes do not.
      const structural = names.filter((name) =>
        ["module", "class", "function", "method", "cone", "possible", "imports"].includes(name),
      );
      const border =
        data.paint && names.some((name) => ["pending", "focus-read", "focus-edit"].includes(name));
      return [
        data.id,
        {
          definition,
          // Missing and explicit undefined differ for non-optional fields in writeData().
          value: JSON.stringify([
            group,
            Object.entries(data as Record<string, unknown>).map(([key, value]) => [
              key,
              value === undefined,
              value,
            ]),
            classes,
          ]),
          geometry: JSON.stringify([
            group,
            data.kind,
            data.w,
            data.h,
            data.parent,
            data.source,
            data.target,
            structural,
            !!border,
          ]),
        },
      ];
    }),
  );
}

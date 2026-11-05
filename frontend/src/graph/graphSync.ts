/**
 * Keep publications in order: removing intermediate topology can change placement and folds.
 * Hidden views retain references only; no projection, Cytoscape write or geometry read runs.
 */
export function graphSync<T>({
  read,
  apply,
  visible,
  resize,
  equal = Object.is,
}: {
  read: () => T;
  apply: (input: T) => void;
  visible: () => boolean;
  resize: () => void;
  equal?: (a: T, b: T) => boolean;
}) {
  let pending: T[] = [];
  let previous: T | undefined;
  let wasVisible = visible();
  const flush = (force = false) => {
    if (!force && !visible()) return;
    const inputs = pending;
    pending = [];
    for (const input of inputs) apply(input);
  };
  return {
    publish: (force = false) => {
      const input = read();
      if (!force && previous !== undefined && equal(previous, input)) return;
      previous = input;
      pending.push(input);
      flush();
    },
    visibility: () => {
      const shown = visible();
      if (shown && !wasVisible) {
        resize();
        flush();
      }
      wasVisible = shown;
    },
    force: () => {
      flush(true);
    },
    dispose: () => {
      pending = [];
    },
  };
}

/**
 * Keep publications in order: removing intermediate topology can change placement and folds.
 * Hidden views retain references only; no projection, Cytoscape write or geometry read runs.
 */
export function graphSync<T>({
  read,
  apply,
  visible,
  resize,
}: {
  read: () => T;
  apply: (input: T) => void;
  visible: () => boolean;
  resize: () => void;
}) {
  let pending: T[] = [];
  let wasVisible = visible();
  const flush = (force = false) => {
    if (!force && !visible()) return;
    const inputs = pending;
    pending = [];
    for (const input of inputs) apply(input);
  };
  return {
    publish: () => {
      pending.push(read());
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

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
  replace,
}: {
  read: () => T;
  apply: (input: T) => void;
  visible: () => boolean;
  resize: () => void;
  equal?: (a: T, b: T) => boolean;
  replace?: (a: T, b: T) => boolean;
}) {
  let pending: T[] = [];
  let previous: T | undefined;
  let frame: number | undefined;
  const cancel = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  let wasVisible = visible();
  const flush = (force = false) => {
    if (!force && !visible()) return;
    cancel();
    const inputs = pending;
    pending = [];
    for (const input of inputs) apply(input);
  };
  return {
    publish: (force = false) => {
      const input = read();
      if (!force && previous !== undefined && equal(previous, input)) return;
      previous = input;
      const last = pending.at(-1);
      if (!force && last !== undefined && replace?.(last, input))
        pending[pending.length - 1] = input;
      else pending.push(input);
      if (visible() && frame === undefined)
        frame = requestAnimationFrame(() => {
          frame = undefined;
          flush();
        });
    },
    visibility: () => {
      const shown = visible();
      if (!shown) cancel();
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
      cancel();
      pending = [];
    },
  };
}

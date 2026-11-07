/** Read the shell's retained-stage flag without importing graph code into the lazy shell. */
export function graphVisibility(host: HTMLElement) {
  const stage = host.closest("[data-graph-hidden]");
  return {
    visible: () =>
      stage?.getAttribute("data-graph-hidden") !== "true" && document.visibilityState !== "hidden",
    observe: (changed: () => void) => {
      const observer = stage ? new MutationObserver(changed) : undefined;
      if (stage)
        observer?.observe(stage, { attributes: true, attributeFilter: ["data-graph-hidden"] });
      document.addEventListener("visibilitychange", changed);
      return () => {
        observer?.disconnect();
        document.removeEventListener("visibilitychange", changed);
      };
    },
  };
}

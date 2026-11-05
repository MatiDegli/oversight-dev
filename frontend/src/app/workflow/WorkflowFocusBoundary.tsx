import { Component, type ReactNode, type RefObject } from "react";

type Props = {
  host: RefObject<HTMLElement | null>;
  fallback: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
};

/** Snapshot actual focus before DOM removal, never a control abandoned earlier. */
export class WorkflowFocusBoundary extends Component<Props, never, Element | null> {
  override getSnapshotBeforeUpdate() {
    const focused = document.activeElement;
    return this.props.host.current?.contains(focused) ? focused : null;
  }

  override componentDidUpdate(_previous: Props, _state: never, focused: Element | null) {
    if (focused && !focused.isConnected && document.activeElement === document.body)
      this.props.fallback.current?.focus({ preventScroll: true });
  }

  override render() {
    return this.props.children;
  }
}

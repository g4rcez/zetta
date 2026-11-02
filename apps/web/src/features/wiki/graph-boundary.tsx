import { Component, type ReactNode } from "react";

/** A drawing library that fails to load or to start (an old browser, no WebGL) must not take the page with it. */
export class GraphBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

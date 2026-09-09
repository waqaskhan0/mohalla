'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary.
 *
 * Without one, a render error in any component blanks the entire page with no
 * explanation — the worst possible outcome for a moderator working through a
 * queue, because it is indistinguishable from the tool being down.
 *
 * The message is rendered as text, never as markup, and no stack trace is shown
 * to the viewer. The stack goes to the console for a developer.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only sink available here: this runs in the browser,
    // and an admin client must not post error text to an endpoint of its own -
    // a component stack from this portal can carry the very user-generated
    // content the render choked on. A developer reads it locally.
    console.error('[admin] render error', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main>
        <div className="card" role="alert">
          <strong>Something went wrong.</strong>
          <p className="muted">
            This page failed to render. Reload to try again. If it keeps happening, report the
            message below.
          </p>
          <p className="mono">{error.message}</p>
        </div>
      </main>
    );
  }
}

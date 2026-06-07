// ───────────────────────────────────────────────────────────────────────────
// ErrorBoundary — converts an otherwise-blank crash into a readable on-screen
// report. Without this, any uncaught render/effect error unmounts the whole
// React tree and leaves just the dark page background.
// ───────────────────────────────────────────────────────────────────────────

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Also log to the console for the full stack / source-mapped frames.
    console.error('[NetJEPA] render crash:', error, info);
    this.setState({ info });
  }

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0a0e14',
          color: '#e6edf3',
          font: '13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
          padding: '32px',
          overflow: 'auto',
        }}
      >
        <h1 style={{ color: '#ff6b6b', fontSize: 16, marginBottom: 12 }}>
          Net-JEPA UI crashed during render
        </h1>
        <div style={{ color: '#ffa657', marginBottom: 16 }}>
          {error.name}: {error.message}
        </div>
        <details open style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', color: '#7d8590' }}>Stack</summary>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#7d8590', marginTop: 8 }}>{error.stack}</pre>
        </details>
        {info?.componentStack && (
          <details>
            <summary style={{ cursor: 'pointer', color: '#7d8590' }}>Component stack</summary>
            <pre style={{ whiteSpace: 'pre-wrap', color: '#7d8590', marginTop: 8 }}>
              {info.componentStack}
            </pre>
          </details>
        )}
        <p style={{ color: '#7d8590', marginTop: 20 }}>
          Full details (with source-mapped line numbers) are in the browser console.
        </p>
      </div>
    );
  }
}

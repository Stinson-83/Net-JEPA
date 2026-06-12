import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[Net-JEPA] render crash:', error, info); }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="grid h-screen place-items-center nj-space p-8">
        <div className="nj-glass max-w-lg rounded-[var(--nj-r)] p-6">
          <h1 className="text-[15px] font-semibold" style={{ color: 'var(--nj-bad)' }}>The interface hit an error</h1>
          <p className="mt-2 text-[12px] text-[var(--nj-text-muted)]">{error.name}: {error.message}</p>
          <pre className="nj-scroll mt-3 max-h-60 overflow-auto whitespace-pre-wrap text-[10.5px] text-[var(--nj-text-faint)]">{error.stack}</pre>
        </div>
      </div>
    );
  }
}

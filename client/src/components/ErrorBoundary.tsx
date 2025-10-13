import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    // Don't show error UI for Vite HMR WebSocket errors - these are expected in Replit
    if (error?.message?.includes('WebSocket') || error?.message?.includes('localhost:undefined')) {
      console.warn('Suppressed Vite HMR WebSocket error');
      return { hasError: false };
    }
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    // Only log non-Vite errors
    if (!error.message?.includes('WebSocket') && !error.message?.includes('localhost:undefined')) {
      console.error('ErrorBoundary caught error:', error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center p-8">
            <h1 className="text-2xl font-bold text-destructive mb-4">Something went wrong</h1>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

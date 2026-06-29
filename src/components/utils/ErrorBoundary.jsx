import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { logger } from "@/lib/logger";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, isStaleChunk: false };
  }

  static getDerivedStateFromError(error) {
    // A "Failed to fetch dynamically imported module" TypeError happens when
    // the dev server restarts and the browser's in-memory module graph holds a
    // chunk URL the restarted server no longer serves. Auto-reload once to
    // re-fetch a fresh module graph instead of dead-ending on the error screen.
    const isStaleChunk = error?.name === 'TypeError' &&
      /Failed to fetch dynamically imported module/.test(error?.message || '');
    return { hasError: true, error, isStaleChunk };
  }

  componentDidCatch(error, errorInfo) {
    if (this.state.isStaleChunk) {
      const key = `vite-chunk-reloaded:${window.location.pathname}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
        return;
      }
      sessionStorage.removeItem(key);
    }
    logger.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // While the stale-chunk reload is in flight, show a loading state instead
      // of the error card so the user doesn't see a flash of the error screen.
      if (this.state.isStaleChunk) {
        return (
          <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <RefreshCw className="h-6 w-6 animate-spin text-navy-600" />
              <p className="text-sm">Refreshing…</p>
            </div>
          </div>
        );
      }
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
          <Card className="max-w-md border-red-300">
            <CardContent className="p-8 text-center">
              <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-slate-900 mb-2">Something went wrong</h2>
              <p className="text-sm text-slate-600 mb-4">
                An unexpected error occurred. Please reload the page; if it keeps
                happening, contact your administrator.
              </p>
              {import.meta.env?.DEV && this.state.error?.message && (
                <p className="text-xs text-slate-400 mb-4 break-words">{this.state.error.message}</p>
              )}
              <Button onClick={() => window.location.reload()} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Reload Page
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
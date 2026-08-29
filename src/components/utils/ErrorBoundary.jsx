import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { logger } from "@/lib/logger";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, isStaleChunk: false, isDisconnectedChunk: false };
    this.handleBackOnline = this.handleBackOnline.bind(this);
  }

  static getDerivedStateFromError(error) {
    // A "Failed to fetch dynamically imported module" TypeError happens when
    // the dev server restarts and the browser's in-memory module graph holds a
    // chunk URL the restarted server no longer serves. Auto-reload once to
    // re-fetch a fresh module graph instead of dead-ending on the error screen.
    // Detect a failed dynamic import — the browser reports this as a TypeError
    // when a Vite dev-server restart leaves the in-memory module graph holding
    // a chunk URL the restarted server no longer serves. Some browsers phrase
    // it "Failed to fetch" and others "error loading" a dynamically imported
    // module, so match on the common "dynamically imported module" substring.
    const msg = error?.message || String(error || '');
    const name = error?.name || '';
    const isChunkError = (name === 'TypeError' &&
      /dynamically imported module/i.test(msg)) ||
      (name === 'SyntaxError' &&
      /invalid or unexpected token|unexpected token/i.test(msg)) ||
      /failed to fetch dynamically imported module/i.test(msg);
    // Same TypeError with no connection is not a stale module graph — the network is
    // gone and this route's chunk was never downloaded. Reloading can't fix
    // that (it would only tear the app down), so show the connection card and
    // auto-retry when connectivity returns.
    const isDisconnectedChunk = isChunkError &&
      typeof navigator !== 'undefined' && navigator.onLine === false;
    return { hasError: true, error, isStaleChunk: isChunkError && !isDisconnectedChunk, isDisconnectedChunk };
  }

  handleBackOnline() {
    // Chunk fetches are not retried by React.lazy, so a reload once the
    // connection returns is the recovery path.
    window.location.reload();
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.handleBackOnline);
  }

  componentDidCatch(error, errorInfo) {
    if (this.state.isDisconnectedChunk) {
      window.addEventListener('online', this.handleBackOnline);
      logger.error('Route chunk unreachable — no connection:', error, errorInfo);
      return;
    }
    if (this.state.isStaleChunk) {
      const key = `vite-chunk-reloaded:${window.location.pathname}`;
      const attempts = parseInt(sessionStorage.getItem(key) || '0', 10);
      if (attempts < 3) {
        sessionStorage.setItem(key, String(attempts + 1));
        // Hard reload (bypasses cache) to ensure fresh module URLs are fetched.
        // Preserve the existing query string (e.g. ?id=, ?tab=) and hash so
        // deep-link context survives the recovery reload — only add/replace the
        // cache-busting _r param.
        const reloadUrl = new URL(window.location.href);
        reloadUrl.searchParams.set('_r', String(Date.now()));
        window.location.href = reloadUrl.toString();
        return;
      }
      // Exhausted retries — clear key so a future navigation can try again, and
      // drop the stale-chunk flag so render() shows the real error card (with a
      // manual reload) instead of a permanent "Refreshing…" spinner.
      sessionStorage.removeItem(key);
      this.setState({ isStaleChunk: false });
    }
    logger.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.state.isDisconnectedChunk) {
        return (
          <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
            <Card className="max-w-md border-amber-300">
              <CardContent className="p-8 text-center">
                <WifiOff className="h-12 w-12 text-amber-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-900 mb-2">You&rsquo;re not connected</h2>
                <p className="text-sm text-slate-600 mb-4">
                  This page couldn&rsquo;t load because there&rsquo;s no connection.
                  Reconnect and try again — anything you&rsquo;ve typed but not yet
                  saved to a chart is still on screen.
                </p>
                <Button onClick={() => window.location.reload()} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </Button>
              </CardContent>
            </Card>
          </div>
        );
      }
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
import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorFallbackProps {
  error?: Error | null;
  onRetry?: () => void;
  title?: string;
  description?: string;
}

/**
 * Shared, user-friendly failure screen. Used by the root route's
 * `errorComponent` and by <GlobalErrorBoundary> so every unexpected
 * render failure looks the same.
 */
export function ErrorFallback({
  error,
  onRetry,
  title = "Something went wrong",
  description = "We hit an unexpected problem while loading this screen. You can try again or head back home.",
}: ErrorFallbackProps) {
  const isDev = import.meta.env.DEV;

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="w-full max-w-md text-center" role="alert">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>

        {isDev && error?.message ? (
          <p className="mt-4 break-all rounded-lg border border-border bg-surface px-3 py-2 text-left font-mono text-xs text-muted-foreground">
            {error.message}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => (onRetry ? onRetry() : window.location.reload())}
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-lime/40"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

function isChunkLoadMessage(message: string): boolean {
  return (
    /Importing a module script failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message)
  );
}

const BOOT_RETRY_KEY = "openrun:boot-retry-at";

interface Props {
  children: ReactNode;
  /** Optional label used for logging which subtree failed. */
  scope?: string;
  title?: string;
  description?: string;
}

interface State {
  error: Error | null;
}

/**
 * App-wide React error boundary. Catches render/lifecycle failures anywhere
 * below it — including the auth gate and provider tree — so a thrown error
 * shows a recoverable screen instead of a blank page.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[error-boundary${this.props.scope ? `:${this.props.scope}` : ""}]`, error, info);

    // A stale deploy chunk is not a real app bug: reload once to pick up
    // the new build instead of showing a failure screen.
    // Never in development (Vite owns reloads there), and never for an
    // aborted request such as a preload cancelled by navigation.
    if (
      typeof window !== "undefined" &&
      !import.meta.env.DEV &&
      error.name !== "AbortError" &&
      !/abort/i.test(error.message ?? "") &&
      isChunkLoadMessage(error.message ?? "")
    ) {
      try {
        const last = Number(sessionStorage.getItem(BOOT_RETRY_KEY) ?? "0");
        if (!last || Date.now() - last > 120_000) {
          sessionStorage.setItem(BOOT_RETRY_KEY, String(Date.now()));
          window.location.reload();
        }
      } catch {
        /* storage unavailable */
      }
    }
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.handleRetry}
          title={this.props.title}
          description={this.props.description}
        />
      );
    }
    return this.props.children;
  }
}

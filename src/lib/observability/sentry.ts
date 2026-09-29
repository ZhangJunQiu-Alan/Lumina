import * as Sentry from '@sentry/react';

export interface ObservabilityUser {
  id?: string;
  email?: string;
  username?: string;
}

export interface ObservabilityContext {
  [key: string]: unknown;
}

/**
 * Enterprise client-side observability setup powered by Sentry.
 * Features:
 * - Session Replay on user interactions & on-error capture
 * - Web Vitals & Browser Tracing performance monitoring
 * - Privacy-first masking of sensitive text inputs
 * - Safe no-op execution when DSN is not configured or in test environments
 */
export function initObservability(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  const mode = import.meta.env.MODE;

  // Never activate network ingestion in automated test runner
  if (!dsn || mode === 'test') {
    return;
  }

  const isProd = import.meta.env.PROD;

  Sentry.init({
    dsn,
    environment: mode || 'production',
    release: import.meta.env.VITE_APP_VERSION || 'lumina@1.0.0',
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: true,
      }),
    ],
    // Performance Web Vitals sampling: 20% in production, 100% in local staging
    tracesSampleRate: isProd ? 0.2 : 1.0,
    // Session Replay: 10% of normal sessions, 100% of sessions with unhandled errors
    replaysSessionSampleRate: isProd ? 0.1 : 0.5,
    replaysOnErrorSampleRate: 1.0,
  });
}

/**
 * Manually capture exceptions with optional contextual tags & data
 */
export function captureClientException(error: unknown, context?: ObservabilityContext): void {
  if (import.meta.env.MODE === 'test') return;

  if (error instanceof Error) {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } else {
    Sentry.captureMessage(String(error), {
      level: 'error',
      extra: context,
    });
  }
}

/**
 * Manually capture messages (info, warning, error)
 */
export function captureClientMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: ObservabilityContext,
): void {
  if (import.meta.env.MODE === 'test') return;

  Sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

/**
 * Synchronize authenticated user identity for correlation across sessions & replays
 */
export function setObservabilityUser(user: ObservabilityUser | null): void {
  if (import.meta.env.MODE === 'test') return;

  if (user && (user.id || user.email)) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
    });
  } else {
    Sentry.setUser(null);
  }
}

/**
 * Add custom breadcrumb for debugging user journeys leading up to an error
 */
export function addObservabilityBreadcrumb(message: string, category = 'ui', data?: Record<string, unknown>): void {
  if (import.meta.env.MODE === 'test') return;

  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: 'info',
  });
}

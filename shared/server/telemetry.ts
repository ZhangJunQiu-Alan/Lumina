import { getEnv } from '../runtime.ts';

export interface ServerTelemetryContext {
  endpoint?: string;
  method?: string;
  requestId?: string;
  userId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ParsedSentryDsn {
  publicKey: string;
  host: string;
  projectId: string;
  endpointUrl: string;
}

/**
 * Parse standard Sentry DSN (e.g., https://<key>@<host>/<projectId>)
 */
export function parseSentryDsn(dsn: string | undefined): ParsedSentryDsn | null {
  if (!dsn || typeof dsn !== 'string') return null;

  try {
    const url = new URL(dsn.trim());
    const publicKey = url.username;
    const host = url.host;
    const pathname = url.pathname.replace(/^\/+/, '');
    const projectId = pathname.split('/')[0];

    if (!publicKey || !host || !projectId) {
      return null;
    }

    return {
      publicKey,
      host,
      projectId,
      endpointUrl: `https://${host}/api/${projectId}/store/`,
    };
  } catch {
    return null;
  }
}

function parseStackTrace(stack: string | undefined) {
  if (!stack) return [];
  const lines = stack.split('\n').slice(1);
  return lines.map((line) => {
    const trimmed = line.trim();
    return {
      filename: trimmed,
      function: trimmed.startsWith('at ') ? trimmed.slice(3) : trimmed,
    };
  });
}

function generateEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Universal Server Telemetry Client.
 * Works seamlessly in both Node.js and Supabase Edge (Deno) environments
 * using standard Web APIs (fetch, Headers).
 */
export async function captureServerException(error: unknown, context: ServerTelemetryContext = {}): Promise<void> {
  const dsnString = getEnv('SENTRY_DSN') || getEnv('VITE_SENTRY_DSN');
  const parsed = parseSentryDsn(dsnString);
  if (!parsed) return;

  const err = error instanceof Error ? error : new Error(String(error));
  const eventId = generateEventId();
  const environment = getEnv('NODE_ENV') || 'production';
  const release = getEnv('APP_VERSION') || 'lumina-server@1.0.0';

  const tags: Record<string, string> = {
    environment,
    runtime: typeof (globalThis as any).Deno !== 'undefined' ? 'deno-edge' : 'node',
    ...(context.endpoint ? { endpoint: context.endpoint } : {}),
    ...(context.method ? { method: context.method } : {}),
    ...(context.requestId ? { request_id: context.requestId } : {}),
    ...(context.userId ? { user_id: context.userId } : {}),
    ...(context.tags || {}),
  };

  const payload = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    logger: 'lumina.server',
    level: 'error',
    environment,
    release,
    tags,
    extra: {
      ...context.extra,
      ...(context.requestId ? { request_id: context.requestId } : {}),
      ...(context.userId ? { user_id: context.userId } : {}),
    },
    exception: {
      values: [
        {
          type: err.name || 'Error',
          value: err.message || 'Unknown server error',
          stacktrace: {
            frames: parseStackTrace(err.stack),
          },
        },
      ],
    },
  };

  try {
    await fetch(parsed.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=lumina-telemetry/1.0, sentry_key=${parsed.publicKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Non-blocking telemetry delivery failure is safely suppressed
  }
}

/**
 * Universal Server Message Telemetry
 */
export async function captureServerMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context: ServerTelemetryContext = {},
): Promise<void> {
  const dsnString = getEnv('SENTRY_DSN') || getEnv('VITE_SENTRY_DSN');
  const parsed = parseSentryDsn(dsnString);
  if (!parsed) return;

  const eventId = generateEventId();
  const environment = getEnv('NODE_ENV') || 'production';
  const release = getEnv('APP_VERSION') || 'lumina-server@1.0.0';

  const tags: Record<string, string> = {
    environment,
    runtime: typeof (globalThis as any).Deno !== 'undefined' ? 'deno-edge' : 'node',
    ...(context.endpoint ? { endpoint: context.endpoint } : {}),
    ...(context.method ? { method: context.method } : {}),
    ...(context.requestId ? { request_id: context.requestId } : {}),
    ...(context.userId ? { user_id: context.userId } : {}),
    ...(context.tags || {}),
  };

  const payload = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    logger: 'lumina.server',
    level,
    message: {
      formatted: message,
    },
    environment,
    release,
    tags,
    extra: context.extra || {},
  };

  try {
    await fetch(parsed.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=lumina-telemetry/1.0, sentry_key=${parsed.publicKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Non-blocking telemetry delivery failure is safely suppressed
  }
}

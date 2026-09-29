import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.ts';

const defaultAllowedOrigins = [
  'https://localhost',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://lumina-1oi.pages.dev',
  'https://lumina.college',
];

function resolveAllowedOrigins(): Set<string> {
  const env =
    typeof process !== 'undefined' && process.env ? process.env : ((globalThis as any).Deno?.env?.toObject() ?? {});
  const appOrigin = env.APP_ORIGIN?.trim();
  const configuredOrigins = (env.LUMINA_APP_ORIGINS ?? '')
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean);

  return new Set([...defaultAllowedOrigins, ...configuredOrigins, appOrigin].filter(Boolean));
}

export const corsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const allowedOrigins = resolveAllowedOrigins();
  const origin = c.req.header('Origin');

  c.header('Vary', 'Origin');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
  c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');

  if (origin && (allowedOrigins.has(origin) || allowedOrigins.has('*'))) {
    c.header('Access-Control-Allow-Origin', origin);
  }

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  await next();
};

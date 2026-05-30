/**
 * Runtime-neutral adapters shared by the Node (Express + tsx scripts) and Deno
 * (Supabase Edge Function) entry points. Anything that must branch on the host
 * runtime lives here so the rest of the shared code stays runtime-agnostic.
 *
 * Implementation note: we reach the host globals only through a `globalThis`
 * cast so the same source type-checks under both `tsc` (no `Deno` global) and
 * `deno check` (no `process` global).
 */

interface RuntimeGlobals {
  Deno?: { env?: { get(key: string): string | undefined } };
  process?: { env?: Record<string, string | undefined> };
}

const runtimeGlobals = globalThis as unknown as RuntimeGlobals;

/** Read an environment variable regardless of host runtime. */
export function getEnv(name: string): string | undefined {
  const denoEnv = runtimeGlobals.Deno?.env;
  if (denoEnv?.get) return denoEnv.get(name);
  return runtimeGlobals.process?.env?.[name];
}

/** Parse a positive integer env var, falling back when absent or invalid. */
export function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = getEnv(name)?.trim();
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Whether AI content features (vocab/article generation) are enabled. */
export function isAiContentFeaturesEnabled(): boolean {
  return (getEnv('LUMINA_AI_FEATURES_ENABLED') ?? '').toLowerCase() === 'true';
}

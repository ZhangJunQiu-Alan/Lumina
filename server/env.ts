/**
 * Startup environment validation for the Node (Express) server.
 *
 * Imported for its side effect: it inspects `process.env` once at boot, prints
 * a single aggregated report, and exits the process if a required variable is
 * missing or malformed — so misconfiguration fails fast and loudly instead of
 * surfacing as a confusing runtime error on the first request.
 *
 * The Edge (Supabase) runtime keeps its own lighter guards (see
 * shared/server/supabase.ts); this file is intentionally Node-only.
 */
import { logger } from '../shared/server/logger.ts';

/** True when the value names a non-empty, non-whitespace string. */
function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const aiEnabled = (process.env.LUMINA_AI_FEATURES_ENABLED ?? '').toLowerCase() === 'true';

const errors: string[] = [];
const warnings: string[] = [];

// ── Supabase (always required) ──────────────────────────────────────────────
if (!present(process.env.SUPABASE_URL) && !present(process.env.VITE_SUPABASE_URL)) {
  errors.push('SUPABASE_URL (or VITE_SUPABASE_URL) is required — the Supabase project URL.');
}
if (!present(process.env.LUMINA_SUPABASE_SERVICE_ROLE_KEY) && !present(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  errors.push('SUPABASE_SERVICE_ROLE_KEY (or LUMINA_SUPABASE_SERVICE_ROLE_KEY) is required — the service-role key.');
}

// ── AI content features (required only when the master switch is on) ──────────
if (aiEnabled) {
  if (!present(process.env.GEMINI_API_KEY)) {
    errors.push('GEMINI_API_KEY is required when LUMINA_AI_FEATURES_ENABLED=true.');
  }
  if (!present(process.env.GOOGLE_TTS_API_KEY)) {
    errors.push('GOOGLE_TTS_API_KEY is required when LUMINA_AI_FEATURES_ENABLED=true.');
  }
} else {
  if (present(process.env.GEMINI_API_KEY) || present(process.env.GOOGLE_TTS_API_KEY)) {
    warnings.push(
      'GEMINI_API_KEY / GOOGLE_TTS_API_KEY are set but LUMINA_AI_FEATURES_ENABLED is not "true" — AI/TTS endpoints stay disabled.',
    );
  } else {
    warnings.push('LUMINA_AI_FEATURES_ENABLED is not "true" — AI vocab/article and TTS endpoints are disabled.');
  }
}

// ── Optional numeric values: warn (don't fail) when malformed ─────────────────
if (present(process.env.PORT) && !(Number.parseInt(process.env.PORT, 10) > 0)) {
  warnings.push(`PORT="${process.env.PORT}" is not a positive integer — falling back to 4000.`);
}

if (errors.length > 0) {
  logger.error('Environment validation failed; refusing to start.', {
    missing: errors,
    hint: 'Copy .env.example to .env and fill in the required values.',
  });
  for (const message of errors) {
    // Mirror to stderr so the failure is readable even without the JSON logger.
    process.stderr.write(`  ✗ ${message}\n`);
  }
  process.exit(1);
}

for (const message of warnings) {
  logger.warn(message);
}

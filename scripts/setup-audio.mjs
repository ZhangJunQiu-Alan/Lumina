/**
 * setup-audio.mjs
 * Run once: creates the word-audio storage bucket and adds audio URL columns.
 * Usage: node scripts/setup-audio.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── 1. Create storage bucket ─────────────────────────────────────────────────
console.log('\n① Creating word-audio bucket…');
const { error: bucketErr } = await supabase.storage.createBucket('word-audio', {
  public: true,
  fileSizeLimit: 5 * 1024 * 1024, // 5 MB per file
});
if (bucketErr && !bucketErr.message.toLowerCase().includes('already exists')) {
  console.error('   ❌ Bucket error:', bucketErr.message);
} else {
  console.log('   ✅ word-audio bucket ready (public)');
}

// ── 2. Add audio URL columns via Supabase RPC ────────────────────────────────
// PostgREST doesn't support raw DDL, so we call the management API via fetch.
// Falls back to printing the SQL if the management API is unavailable.
console.log('\n② Adding audio_uk_url / audio_us_url columns to vocabulary_items…');

const projectRef = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0];
const migrationSql = `
ALTER TABLE vocabulary_items ADD COLUMN IF NOT EXISTS audio_uk_url TEXT;
ALTER TABLE vocabulary_items ADD COLUMN IF NOT EXISTS audio_us_url TEXT;
`.trim();

// Try via Supabase Management API (requires a personal access token set as SUPABASE_ACCESS_TOKEN)
const accessToken = env.SUPABASE_ACCESS_TOKEN;
if (accessToken) {
  const mgmtRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: migrationSql }),
  });
  if (mgmtRes.ok) {
    console.log('   ✅ Columns added via Management API');
  } else {
    const body = await mgmtRes.text();
    console.error('   ❌ Management API error:', body);
    printManualInstructions(migrationSql);
  }
} else {
  console.log(
    '   ℹ️  SUPABASE_ACCESS_TOKEN not set — run the following SQL manually in Supabase Dashboard → SQL Editor:',
  );
  printManualInstructions(migrationSql);
}

function printManualInstructions(sql) {
  console.log('\n' + '─'.repeat(60));
  console.log(sql);
  console.log('─'.repeat(60));
  console.log('\nDashboard: https://supabase.com/dashboard/project/' + projectRef + '/sql/new');
}

console.log('\nSetup complete.\n');

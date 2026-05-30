import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Read .env manually
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => l.split('=').map((p) => p.trim())),
);

// --- Test Supabase ---
console.log('\n🔷 Testing Supabase...');
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

try {
  // Just check we can reach the API — query a system table
  const { error } = await supabase.from('_test_connection_').select('*').limit(1);
  // A "relation does not exist" error means we connected fine, table just doesn't exist yet
  if (!error || error.code === 'PGRST116' || error.message.includes('does not exist') || error.code === '42P01') {
    console.log('✅ Supabase: connected successfully');
  } else {
    console.log('✅ Supabase: reachable (response received)');
    console.log('   Detail:', error.message);
  }
} catch (e) {
  console.log('❌ Supabase connection failed:', e.message);
}

// --- Test Gemini (REST, same path as the server) ---
console.log('\n🔶 Testing Gemini...');
try {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: "Gemini OK"' }] }],
      }),
    },
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? response.statusText);
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim();
  console.log('✅ Gemini: connected successfully —', text);
} catch (e) {
  console.log('❌ Gemini connection failed:', e.message);
}

console.log('');

import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const dbPassword = env.SUPABASE_DB_PASSWORD;
if (!dbPassword) {
  console.error('❌ Missing SUPABASE_DB_PASSWORD in .env');
  console.error('   Find it at: Supabase Dashboard → Settings → Database → Database password');
  process.exit(1);
}

const client = new pg.Client({
  host: 'db.zhjdsvcgccdvtnicyasi.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: dbPassword,
  ssl: { rejectUnauthorized: false },
});

console.log('\n🔷 Connecting to Supabase PostgreSQL...');
await client.connect();
console.log('✅ Connected\n');

const schema = readFileSync('supabase/schema.sql', 'utf8');

console.log('🔷 Running migration...');
try {
  await client.query(schema);
  console.log('✅ Schema applied successfully\n');
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  await client.end();
  process.exit(1);
}

await client.end();

// Verify tables
const { rows } = await (async () => {
  const c = new pg.Client({
    host: 'db.zhjdsvcgccdvtnicyasi.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: dbPassword,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const r = await c.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  await c.end();
  return r;
})();

console.log('📋 Tables in public schema:');
rows.forEach((r) => console.log(`  ✅ ${r.tablename}`));
console.log('');

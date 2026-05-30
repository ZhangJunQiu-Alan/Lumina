import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../runtime.ts';

const supabaseUrl = getEnv('SUPABASE_URL') ?? getEnv('VITE_SUPABASE_URL');
const serviceRoleKey = getEnv('LUMINA_SUPABASE_SERVICE_ROLE_KEY') ?? getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing Supabase env vars: SUPABASE_URL/VITE_SUPABASE_URL and LUMINA_SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY',
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

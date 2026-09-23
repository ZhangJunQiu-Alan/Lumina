import { supabaseAdmin } from './supabase.ts';
import { resolveReviewTimeZone } from './review-domain.ts';

export async function getUserReviewTimeZone(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('daily_routine_progress')
    .select('timezone')
    .eq('user_id', userId)
    .order('local_date', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`review timezone lookup failed: ${error.message}`);
  return resolveReviewTimeZone(data?.timezone);
}

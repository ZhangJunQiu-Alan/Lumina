import {
  LEARNING_PREFERENCES_DEFAULTS,
  LEARNING_PREFERENCES_SELECT,
  isMissingUserSettingsTableError,
  mergeLearningPreferences,
  normalizeLearningPreferences,
  toLearningPreferencesRow,
  type LearningPreferencesRow,
} from '../learningPreferences.ts';
import type { LearningPreferences } from '../types.ts';
import { supabaseAdmin } from './supabase.ts';

export async function getUserLearningPreferences(userId: string): Promise<LearningPreferences> {
  const { data, error } = await supabaseAdmin
    .from('user_settings')
    .select(LEARNING_PREFERENCES_SELECT)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingUserSettingsTableError(error)) {
      return LEARNING_PREFERENCES_DEFAULTS;
    }
    throw new Error(`learning preferences lookup failed: ${error.message}`);
  }

  if (!data) return LEARNING_PREFERENCES_DEFAULTS;
  return normalizeLearningPreferences(data as LearningPreferencesRow);
}

export async function saveUserLearningPreferences(
  userId: string,
  patch: Partial<LearningPreferences>,
): Promise<LearningPreferences> {
  const currentPreferences = await getUserLearningPreferences(userId);
  const nextPreferences = mergeLearningPreferences(currentPreferences, patch);

  const { data, error } = await supabaseAdmin
    .from('user_settings')
    .upsert(
      {
        ...toLearningPreferencesRow(userId, nextPreferences),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select(LEARNING_PREFERENCES_SELECT)
    .single();

  if (error) {
    if (isMissingUserSettingsTableError(error)) {
      return nextPreferences;
    }
    throw new Error(`learning preferences save failed: ${error.message}`);
  }

  return normalizeLearningPreferences(data as LearningPreferencesRow);
}

export function resolveLearningPreferencesPatch(input: unknown): Partial<LearningPreferences> {
  const candidate =
    input && typeof input === 'object' && 'preferences' in input
      ? (input as { preferences?: unknown }).preferences
      : input;

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {};
  }

  return candidate as Partial<LearningPreferences>;
}

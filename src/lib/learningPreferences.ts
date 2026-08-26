import {
  LEARNING_PREFERENCES_DEFAULTS,
  LEARNING_PREFERENCES_SELECT,
  isMissingUserSettingsTableError,
  normalizeLearningPreferences,
  toLearningPreferencesRow,
  type LearningPreferencesRow,
} from '../../shared/learningPreferences';
import type { LearningPreferences } from '../types';
import { supabase } from './supabase';

export {
  AUTO_PLAY_GAP_OPTIONS,
  AUTO_PLAY_REPEAT_OPTIONS,
  CORRECT_ANSWER_REVEAL_OPTIONS,
  IELTS_TARGET_SCORE_OPTIONS,
  LEARNING_PREFERENCES_DEFAULTS,
  SPEECH_PLAYBACK_RATE_OPTIONS,
  WRONG_ANSWER_REVEAL_OPTIONS,
  buildReinforcementRoundTogglePatch,
  mergeLearningPreferences,
} from '../../shared/learningPreferences';

const LOCAL_LEARNING_PREFERENCES_KEY = 'lumina.learning-preferences';

function buildLocalPreferencesKey(userId: string) {
  return `${LOCAL_LEARNING_PREFERENCES_KEY}:${userId}`;
}

function getLocalLearningPreferences(userId: string): LearningPreferences | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(buildLocalPreferencesKey(userId));
    if (!raw) return null;
    return normalizeLearningPreferences(JSON.parse(raw) as Partial<LearningPreferences>);
  } catch {
    return null;
  }
}

function saveLocalLearningPreferences(userId: string, preferences: LearningPreferences) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(buildLocalPreferencesKey(userId), JSON.stringify(preferences));
  } catch {
    // Ignore storage write failures and keep in-memory state as fallback.
  }
}

export async function getLearningPreferences(userId: string): Promise<LearningPreferences> {
  const localPreferences = getLocalLearningPreferences(userId);
  const { data, error } = await supabase
    .from('user_settings')
    .select(LEARNING_PREFERENCES_SELECT)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingUserSettingsTableError(error)) {
      return localPreferences ?? LEARNING_PREFERENCES_DEFAULTS;
    }
    throw new Error(`learning preferences lookup failed: ${error.message}`);
  }

  if (!data) {
    return localPreferences ?? LEARNING_PREFERENCES_DEFAULTS;
  }

  const normalizedPreferences = normalizeLearningPreferences(data as LearningPreferencesRow);
  saveLocalLearningPreferences(userId, normalizedPreferences);
  return normalizedPreferences;
}

export async function saveLearningPreferences(
  userId: string,
  preferences: LearningPreferences,
): Promise<LearningPreferences> {
  const nextPreferences = normalizeLearningPreferences(preferences);

  const { data, error } = await supabase
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
      saveLocalLearningPreferences(userId, nextPreferences);
      return nextPreferences;
    }
    throw new Error(`learning preferences save failed: ${error.message}`);
  }

  const normalizedPreferences = normalizeLearningPreferences(data as LearningPreferencesRow);
  saveLocalLearningPreferences(userId, normalizedPreferences);
  return normalizedPreferences;
}

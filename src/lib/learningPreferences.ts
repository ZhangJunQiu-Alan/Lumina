import { supabase } from './supabase';
import type { IeltsTargetScore, LearningPreferences, PronunciationLocale, SpeechPlaybackRate } from '../types';

interface LearningPreferencesRow {
  user_id: string;
  default_pronunciation_locale: PronunciationLocale;
  ielts_target_score: number;
  speech_playback_rate: number;
  auto_play_enabled: boolean;
  auto_play_repeat_count: number;
  auto_play_repeat_gap_ms: number;
  correct_answer_reveal_ms: number;
  wrong_answer_reveal_ms: number;
  round2_enabled: boolean;
  reinforcement_round3_enabled: boolean;
  reinforcement_article_enabled: boolean;
  popover_auto_play_enabled: boolean;
  cloze_sentence_auto_play_enabled: boolean;
  memory_tip_enabled: boolean;
  updated_at: string;
}

export const LEARNING_PREFERENCES_DEFAULTS: LearningPreferences = {
  defaultPronunciationLocale: 'uk',
  ieltsTargetScore: 7,
  speechPlaybackRate: 1,
  autoPlayEnabled: false,
  autoPlayRepeatCount: 3,
  autoPlayRepeatGapMs: 1500,
  correctAnswerRevealMs: 1000,
  wrongAnswerRevealMs: 8000,
  round2Enabled: true,
  reinforcementRound3Enabled: true,
  reinforcementArticleEnabled: false,
  popoverAutoPlayEnabled: false,
  clozeSentenceAutoPlayEnabled: true,
  memoryTipEnabled: true,
};

export const SPEECH_PLAYBACK_RATE_OPTIONS = [0.6, 0.8, 1] as const;
export const IELTS_TARGET_SCORE_OPTIONS = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9] as const;
export const AUTO_PLAY_REPEAT_OPTIONS = [1, 2, 3] as const;
export const AUTO_PLAY_GAP_OPTIONS = [1000, 1500, 2500] as const;
export const CORRECT_ANSWER_REVEAL_OPTIONS = [800, 1000, 1500, 2000] as const;
export const WRONG_ANSWER_REVEAL_OPTIONS = [3000, 5000, 8000] as const;

const LOCAL_LEARNING_PREFERENCES_KEY = 'lumina.learning-preferences';
type ReinforcementRoundPreferenceKey = 'round2Enabled' | 'reinforcementRound3Enabled';

function isValidLocale(value: unknown): value is PronunciationLocale {
  return value === 'uk' || value === 'us';
}

function normalizeRepeatCount(value: unknown): 1 | 2 | 3 {
  if (value === 1 || value === 2 || value === 3) return value;
  return LEARNING_PREFERENCES_DEFAULTS.autoPlayRepeatCount;
}

function normalizeSpeechPlaybackRate(value: unknown): SpeechPlaybackRate {
  const numericValue = typeof value === 'string' ? Number(value) : value;
  if (numericValue === 0.6 || numericValue === 0.8 || numericValue === 1) return numericValue;
  return LEARNING_PREFERENCES_DEFAULTS.speechPlaybackRate;
}

function normalizeIeltsTargetScore(value: unknown): IeltsTargetScore {
  const numericValue = typeof value === 'string' ? Number(value) : value;
  return IELTS_TARGET_SCORE_OPTIONS.includes(numericValue as IeltsTargetScore)
    ? (numericValue as IeltsTargetScore)
    : LEARNING_PREFERENCES_DEFAULTS.ieltsTargetScore;
}

function normalizeGapMs(value: unknown): number {
  return AUTO_PLAY_GAP_OPTIONS.includes(value as (typeof AUTO_PLAY_GAP_OPTIONS)[number])
    ? (value as number)
    : LEARNING_PREFERENCES_DEFAULTS.autoPlayRepeatGapMs;
}

function normalizeCorrectRevealMs(value: unknown): 800 | 1000 | 1500 | 2000 {
  if (value === 800 || value === 1000 || value === 1500 || value === 2000) return value;
  return LEARNING_PREFERENCES_DEFAULTS.correctAnswerRevealMs;
}

function normalizeRevealMs(value: unknown): 3000 | 5000 | 8000 {
  if (value === 3000 || value === 5000 || value === 8000) return value;
  return LEARNING_PREFERENCES_DEFAULTS.wrongAnswerRevealMs;
}

function normalizeReinforcementRounds(
  round2EnabledValue: unknown,
  reinforcementRound3Value: unknown,
): Pick<LearningPreferences, ReinforcementRoundPreferenceKey> {
  const round2Enabled =
    typeof round2EnabledValue === 'boolean' ? round2EnabledValue : LEARNING_PREFERENCES_DEFAULTS.round2Enabled;
  const reinforcementRound3Enabled =
    typeof reinforcementRound3Value === 'boolean'
      ? reinforcementRound3Value
      : LEARNING_PREFERENCES_DEFAULTS.reinforcementRound3Enabled;

  if (!round2Enabled && !reinforcementRound3Enabled) {
    return {
      round2Enabled: LEARNING_PREFERENCES_DEFAULTS.round2Enabled,
      reinforcementRound3Enabled: LEARNING_PREFERENCES_DEFAULTS.reinforcementRound3Enabled,
    };
  }

  return {
    round2Enabled,
    reinforcementRound3Enabled,
  };
}

export function buildReinforcementRoundTogglePatch(
  current: Pick<LearningPreferences, ReinforcementRoundPreferenceKey>,
  key: ReinforcementRoundPreferenceKey,
  checked: boolean,
): Pick<LearningPreferences, ReinforcementRoundPreferenceKey> {
  const next = {
    round2Enabled: current.round2Enabled,
    reinforcementRound3Enabled: current.reinforcementRound3Enabled,
    [key]: checked,
  };

  if (!next.round2Enabled && !next.reinforcementRound3Enabled) {
    const pairedKey: ReinforcementRoundPreferenceKey =
      key === 'round2Enabled' ? 'reinforcementRound3Enabled' : 'round2Enabled';
    next[pairedKey] = true;
  }

  return next;
}

function normalizeLearningPreferences(
  input: Partial<LearningPreferences> | LearningPreferencesRow | null | undefined,
): LearningPreferences {
  const hasCamelCaseShape = Boolean(input && 'defaultPronunciationLocale' in input);
  const localeValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).defaultPronunciationLocale
    : (input as LearningPreferencesRow | null | undefined)?.default_pronunciation_locale;
  const autoPlayEnabledValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).autoPlayEnabled
    : (input as LearningPreferencesRow | null | undefined)?.auto_play_enabled;
  const speechPlaybackRateValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).speechPlaybackRate
    : (input as LearningPreferencesRow | null | undefined)?.speech_playback_rate;
  const ieltsTargetScoreValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).ieltsTargetScore
    : (input as LearningPreferencesRow | null | undefined)?.ielts_target_score;
  const repeatCountValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).autoPlayRepeatCount
    : (input as LearningPreferencesRow | null | undefined)?.auto_play_repeat_count;
  const gapMsValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).autoPlayRepeatGapMs
    : (input as LearningPreferencesRow | null | undefined)?.auto_play_repeat_gap_ms;
  const correctRevealMsValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).correctAnswerRevealMs
    : (input as LearningPreferencesRow | null | undefined)?.correct_answer_reveal_ms;
  const revealMsValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).wrongAnswerRevealMs
    : (input as LearningPreferencesRow | null | undefined)?.wrong_answer_reveal_ms;
  const round2EnabledValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).round2Enabled
    : (input as LearningPreferencesRow | null | undefined)?.round2_enabled;
  const reinforcementRound3Value = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).reinforcementRound3Enabled
    : (input as LearningPreferencesRow | null | undefined)?.reinforcement_round3_enabled;
  const reinforcementArticleValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).reinforcementArticleEnabled
    : (input as LearningPreferencesRow | null | undefined)?.reinforcement_article_enabled;
  const popoverAutoPlayValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).popoverAutoPlayEnabled
    : (input as LearningPreferencesRow | null | undefined)?.popover_auto_play_enabled;
  const clozeSentenceAutoPlayValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).clozeSentenceAutoPlayEnabled
    : (input as LearningPreferencesRow | null | undefined)?.cloze_sentence_auto_play_enabled;
  const memoryTipValue = hasCamelCaseShape
    ? (input as Partial<LearningPreferences>).memoryTipEnabled
    : (input as LearningPreferencesRow | null | undefined)?.memory_tip_enabled;
  const reinforcementRounds = normalizeReinforcementRounds(round2EnabledValue, reinforcementRound3Value);

  return {
    defaultPronunciationLocale: isValidLocale(localeValue)
      ? localeValue
      : LEARNING_PREFERENCES_DEFAULTS.defaultPronunciationLocale,
    ieltsTargetScore: normalizeIeltsTargetScore(ieltsTargetScoreValue),
    speechPlaybackRate: normalizeSpeechPlaybackRate(speechPlaybackRateValue),
    autoPlayEnabled: autoPlayEnabledValue ?? LEARNING_PREFERENCES_DEFAULTS.autoPlayEnabled,
    autoPlayRepeatCount: normalizeRepeatCount(repeatCountValue),
    autoPlayRepeatGapMs: normalizeGapMs(gapMsValue),
    correctAnswerRevealMs: normalizeCorrectRevealMs(correctRevealMsValue),
    wrongAnswerRevealMs: normalizeRevealMs(revealMsValue),
    round2Enabled: reinforcementRounds.round2Enabled,
    reinforcementRound3Enabled: reinforcementRounds.reinforcementRound3Enabled,
    reinforcementArticleEnabled:
      typeof reinforcementArticleValue === 'boolean'
        ? reinforcementArticleValue
        : LEARNING_PREFERENCES_DEFAULTS.reinforcementArticleEnabled,
    popoverAutoPlayEnabled:
      typeof popoverAutoPlayValue === 'boolean'
        ? popoverAutoPlayValue
        : LEARNING_PREFERENCES_DEFAULTS.popoverAutoPlayEnabled,
    clozeSentenceAutoPlayEnabled:
      typeof clozeSentenceAutoPlayValue === 'boolean'
        ? clozeSentenceAutoPlayValue
        : LEARNING_PREFERENCES_DEFAULTS.clozeSentenceAutoPlayEnabled,
    memoryTipEnabled:
      typeof memoryTipValue === 'boolean' ? memoryTipValue : LEARNING_PREFERENCES_DEFAULTS.memoryTipEnabled,
  };
}

function toDatabaseRow(userId: string, preferences: LearningPreferences): Omit<LearningPreferencesRow, 'updated_at'> {
  return {
    user_id: userId,
    default_pronunciation_locale: preferences.defaultPronunciationLocale,
    ielts_target_score: preferences.ieltsTargetScore,
    speech_playback_rate: preferences.speechPlaybackRate,
    auto_play_enabled: preferences.autoPlayEnabled,
    auto_play_repeat_count: preferences.autoPlayRepeatCount,
    auto_play_repeat_gap_ms: preferences.autoPlayRepeatGapMs,
    correct_answer_reveal_ms: preferences.correctAnswerRevealMs,
    wrong_answer_reveal_ms: preferences.wrongAnswerRevealMs,
    round2_enabled: preferences.round2Enabled,
    reinforcement_round3_enabled: preferences.reinforcementRound3Enabled,
    reinforcement_article_enabled: preferences.reinforcementArticleEnabled,
    popover_auto_play_enabled: preferences.popoverAutoPlayEnabled,
    cloze_sentence_auto_play_enabled: preferences.clozeSentenceAutoPlayEnabled,
    memory_tip_enabled: preferences.memoryTipEnabled,
  };
}

function isMissingUserSettingsTableError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? '';
  return (
    message.includes('user_settings') ||
    message.includes('correct_answer_reveal_ms') ||
    message.includes('round2_enabled') ||
    message.includes('popover_auto_play_enabled') ||
    message.includes('cloze_sentence_auto_play_enabled') ||
    message.includes('memory_tip_enabled') ||
    message.includes('ielts_target_score') ||
    message.includes('speech_playback_rate') ||
    message.includes('schema cache')
  );
}

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
    .select(
      `
      user_id,
      default_pronunciation_locale,
      ielts_target_score,
      speech_playback_rate,
      auto_play_enabled,
      auto_play_repeat_count,
      auto_play_repeat_gap_ms,
      correct_answer_reveal_ms,
      wrong_answer_reveal_ms,
      round2_enabled,
      reinforcement_round3_enabled,
      reinforcement_article_enabled,
      popover_auto_play_enabled,
      cloze_sentence_auto_play_enabled,
      memory_tip_enabled,
      updated_at
    `,
    )
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
        ...toDatabaseRow(userId, nextPreferences),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select(
      `
      user_id,
      default_pronunciation_locale,
      ielts_target_score,
      speech_playback_rate,
      auto_play_enabled,
      auto_play_repeat_count,
      auto_play_repeat_gap_ms,
      correct_answer_reveal_ms,
      wrong_answer_reveal_ms,
      round2_enabled,
      reinforcement_round3_enabled,
      reinforcement_article_enabled,
      popover_auto_play_enabled,
      cloze_sentence_auto_play_enabled,
      memory_tip_enabled,
      updated_at
    `,
    )
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

export function mergeLearningPreferences(
  current: LearningPreferences,
  patch: Partial<LearningPreferences>,
): LearningPreferences {
  return normalizeLearningPreferences({
    ...current,
    ...patch,
  });
}

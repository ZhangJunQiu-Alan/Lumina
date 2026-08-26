import { describe, expect, it } from 'vitest';
import {
  LEARNING_PREFERENCES_DEFAULTS,
  mergeLearningPreferences,
  normalizeLearningPreferences,
  type LearningPreferencesRow,
} from './learningPreferences';

describe('shared learning preferences', () => {
  it('normalizes a database row into app preferences', () => {
    const row: LearningPreferencesRow = {
      user_id: 'user-1',
      default_pronunciation_locale: 'us',
      ielts_target_score: 7.5,
      speech_playback_rate: 0.8,
      auto_play_enabled: true,
      auto_play_repeat_count: 2,
      auto_play_repeat_gap_ms: 2500,
      correct_answer_reveal_ms: 1500,
      wrong_answer_reveal_ms: 5000,
      round2_enabled: true,
      reinforcement_round3_enabled: false,
      reinforcement_article_enabled: true,
      popover_auto_play_enabled: true,
      cloze_sentence_auto_play_enabled: false,
      memory_tip_enabled: false,
      updated_at: '2026-06-11T00:00:00.000Z',
    };

    expect(normalizeLearningPreferences(row)).toEqual({
      defaultPronunciationLocale: 'us',
      ieltsTargetScore: 7.5,
      speechPlaybackRate: 0.8,
      autoPlayEnabled: true,
      autoPlayRepeatCount: 2,
      autoPlayRepeatGapMs: 2500,
      correctAnswerRevealMs: 1500,
      wrongAnswerRevealMs: 5000,
      round2Enabled: true,
      reinforcementRound3Enabled: false,
      reinforcementArticleEnabled: true,
      popoverAutoPlayEnabled: true,
      clozeSentenceAutoPlayEnabled: false,
      memoryTipEnabled: false,
    });
  });

  it('repairs a partial update that would disable both reinforcement rounds', () => {
    const current = {
      ...LEARNING_PREFERENCES_DEFAULTS,
      round2Enabled: true,
      reinforcementRound3Enabled: false,
    };

    const next = mergeLearningPreferences(current, {
      round2Enabled: false,
    });

    expect(next.round2Enabled).toBe(true);
    expect(next.reinforcementRound3Enabled).toBe(true);
  });
});

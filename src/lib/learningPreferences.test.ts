import { describe, expect, it, vi } from 'vitest';
import type { LearningPreferences } from '../types';
import {
  buildReinforcementRoundTogglePatch,
  LEARNING_PREFERENCES_DEFAULTS,
  mergeLearningPreferences,
} from './learningPreferences';

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

function makePreferences(round2RecallEnabled: boolean, round3DictationEnabled: boolean): LearningPreferences {
  return {
    ...LEARNING_PREFERENCES_DEFAULTS,
    reinforcementRound3Enabled: round2RecallEnabled,
    round2Enabled: round3DictationEnabled,
  };
}

function expectRoundState(
  state: Pick<LearningPreferences, 'round2Enabled' | 'reinforcementRound3Enabled'>,
  expected: { round2RecallEnabled: boolean; round3DictationEnabled: boolean },
) {
  expect(state).toMatchObject({
    reinforcementRound3Enabled: expected.round2RecallEnabled,
    round2Enabled: expected.round3DictationEnabled,
  });
}

describe('LEARNING_PREFERENCES_DEFAULTS', () => {
  it('defaults autoplay to off for users without saved preferences', () => {
    expect(LEARNING_PREFERENCES_DEFAULTS.autoPlayEnabled).toBe(false);
  });
});

describe('buildReinforcementRoundTogglePatch', () => {
  it('keeps Round 3 dictation enabled when closing Round 2 recall from both enabled', () => {
    const patch = buildReinforcementRoundTogglePatch(makePreferences(true, true), 'reinforcementRound3Enabled', false);

    expectRoundState(patch, {
      round2RecallEnabled: false,
      round3DictationEnabled: true,
    });
  });

  it('keeps Round 2 recall enabled when closing Round 3 dictation from both enabled', () => {
    const patch = buildReinforcementRoundTogglePatch(makePreferences(true, true), 'round2Enabled', false);

    expectRoundState(patch, {
      round2RecallEnabled: true,
      round3DictationEnabled: false,
    });
  });

  it('switches to Round 3 dictation when closing the only enabled Round 2 recall', () => {
    const patch = buildReinforcementRoundTogglePatch(makePreferences(true, false), 'reinforcementRound3Enabled', false);

    expectRoundState(patch, {
      round2RecallEnabled: false,
      round3DictationEnabled: true,
    });
  });

  it('switches to Round 2 recall when closing the only enabled Round 3 dictation', () => {
    const patch = buildReinforcementRoundTogglePatch(makePreferences(false, true), 'round2Enabled', false);

    expectRoundState(patch, {
      round2RecallEnabled: true,
      round3DictationEnabled: false,
    });
  });

  it('enables both rounds when opening the disabled round', () => {
    expectRoundState(
      buildReinforcementRoundTogglePatch(makePreferences(false, true), 'reinforcementRound3Enabled', true),
      {
        round2RecallEnabled: true,
        round3DictationEnabled: true,
      },
    );
    expectRoundState(buildReinforcementRoundTogglePatch(makePreferences(true, false), 'round2Enabled', true), {
      round2RecallEnabled: true,
      round3DictationEnabled: true,
    });
  });
});

describe('mergeLearningPreferences', () => {
  it('normalizes a double-disabled reinforcement round state back to both enabled', () => {
    const merged = mergeLearningPreferences(LEARNING_PREFERENCES_DEFAULTS, {
      reinforcementRound3Enabled: false,
      round2Enabled: false,
    });

    expectRoundState(merged, {
      round2RecallEnabled: true,
      round3DictationEnabled: true,
    });
  });
});

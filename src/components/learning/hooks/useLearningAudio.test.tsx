import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEARNING_PREFERENCES_DEFAULTS } from '../../../../shared/learningPreferences';
import { useLearningAudio } from './useLearningAudio';

const state = vi.hoisted(() => ({ example: vi.fn(), word: vi.fn(), speak: vi.fn() }));
vi.mock('../../../contexts/LearningPreferencesContext', () => ({
  useLearningPreferences: () => ({ preferences: LEARNING_PREFERENCES_DEFAULTS }),
}));
vi.mock('../../../lib/exampleAudio', () => ({ fetchExampleAudioUrl: state.example }));
vi.mock('../../../lib/wordAudio', () => ({ fetchWordAudioUrl: state.word, primeWordAudioUrl: vi.fn() }));

class MockAudio {
  static instances: MockAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  constructor(public src: string) {
    MockAudio.instances.push(this);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  MockAudio.instances = [];
  state.example.mockResolvedValue('/sentence.mp3');
  state.word.mockResolvedValue(null);
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('speechSynthesis', { speak: state.speak });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('server audio only', () => {
  it('plays sentence audio at the selected speed and settles when finished', async () => {
    const { result } = renderHook(() => useLearningAudio());
    let playback!: Promise<void>;
    act(() => {
      playback = result.current.playExampleSentence('A sentence.', 'sentence');
    });
    await waitFor(() => expect(MockAudio.instances).toHaveLength(1));
    expect(result.current.activeExampleKey).toBe('sentence');
    expect(MockAudio.instances[0]).toMatchObject({ src: '/sentence.mp3', playbackRate: 1 });
    await act(async () => {
      MockAudio.instances[0].onended?.();
      await playback;
    });
    expect(result.current.activeExampleKey).toBeNull();
    expect(result.current.audioError).toBe('');
  });

  it('reports a missing sentence URL without browser speech', async () => {
    state.example.mockResolvedValue(null);
    const { result } = renderHook(() => useLearningAudio());
    await act(() => result.current.playExampleSentence('A sentence.', 'sentence'));
    expect(result.current.activeExampleKey).toBeNull();
    expect(result.current.audioError).toContain('无法播放例句');
    expect(state.speak).not.toHaveBeenCalled();
  });

  it('reports a playback error and resolves without browser speech', async () => {
    const { result } = renderHook(() => useLearningAudio());
    let playback!: Promise<void>;
    act(() => {
      playback = result.current.playExampleSentence('A sentence.', 'sentence');
    });
    await waitFor(() => expect(MockAudio.instances).toHaveLength(1));
    await act(async () => {
      MockAudio.instances[0].onerror?.();
      await playback;
    });
    expect(result.current.activeExampleKey).toBeNull();
    expect(result.current.audioError).toContain('无法播放例句');
    expect(state.speak).not.toHaveBeenCalled();
  });

  it('reports missing word audio without browser speech', async () => {
    const { result } = renderHook(() => useLearningAudio());
    await act(() => result.current.playAudioSequence({ word: 'example' }, 'uk', 1, 0));
    expect(result.current.audioError).toContain('无法播放 example');
    expect(state.speak).not.toHaveBeenCalled();
  });

  it('ignores a sentence request resolved after playback is stopped', async () => {
    let resolveUrl!: (url: string) => void;
    state.example.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveUrl = resolve;
      }),
    );
    const { result } = renderHook(() => useLearningAudio());
    let playback!: Promise<void>;
    act(() => {
      playback = result.current.playExampleSentence('A sentence.', 'sentence');
    });
    act(() => result.current.stopPlayback());
    await act(async () => {
      resolveUrl('/late.mp3');
      await playback;
    });
    expect(MockAudio.instances).toHaveLength(0);
    expect(result.current.activeExampleKey).toBeNull();
  });
});

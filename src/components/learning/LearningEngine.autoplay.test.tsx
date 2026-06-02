import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningPreferences, PersistedLearningSession, Word } from '../../types';
import { markReviewWordMastered } from '../../lib/reviewApi';
import { LearningEngine, type LearningSessionSnapshot } from './LearningEngine';

const testState = vi.hoisted(() => ({
  preferences: {
    defaultPronunciationLocale: 'uk',
    ieltsTargetScore: 7,
    speechPlaybackRate: 1,
    autoPlayEnabled: false,
    autoPlayRepeatCount: 1,
    autoPlayRepeatGapMs: 1000,
    correctAnswerRevealMs: 1000,
    wrongAnswerRevealMs: 8000,
    round2Enabled: true,
    reinforcementRound3Enabled: true,
    reinforcementArticleEnabled: false,
    popoverAutoPlayEnabled: false,
    clozeSentenceAutoPlayEnabled: true,
    memoryTipEnabled: true,
  } as LearningPreferences,
}));

vi.mock('../../contexts/LearningPreferencesContext', () => ({
  useLearningPreferences: () => ({
    preferences: testState.preferences,
    isLoading: false,
    loadError: '',
    savePreferences: vi.fn(),
    reloadPreferences: vi.fn(),
  }),
}));

vi.mock('../../contexts/SavedWordsContext', () => ({
  useSavedWords: () => ({
    saveWord: vi.fn(),
  }),
}));

vi.mock('../../contexts/WordPopoverContext', () => ({
  useWordPopover: () => ({
    openPopover: vi.fn(),
  }),
}));

vi.mock('../../lib/attemptBuffer', () => ({
  attemptBuffer: {
    pushAttempt: vi.fn(() => Promise.resolve()),
    flush: vi.fn(() => Promise.resolve()),
    flushKeepalive: vi.fn(),
  },
}));

vi.mock('../../lib/exampleAudio', () => ({
  fetchExampleAudioUrl: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../../lib/reviewApi', () => ({
  markReviewWordMastered: vi.fn(() => Promise.resolve()),
  markReviewWordUnknown: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../lib/round1Preload', () => ({
  preloadRound1CardResources: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../lib/round2Preload', () => ({
  preloadRound2CardResources: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../lib/vocabReportApi', () => ({
  reportVocabularyIssue: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../lib/wordAudio', () => ({
  fetchWordAudioUrl: vi.fn(() => Promise.resolve(null)),
  primeWordAudioUrl: vi.fn(),
}));

function makeWord(overrides: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    word: 'daily',
    phonetic: '/deili/',
    ipa_uk: '/deili/',
    ipa_us: '/deili/',
    pos_tags: ['adj'],
    ner_entities: [],
    chinese_definition: '每日的',
    senses: [
      {
        pos: 'adj',
        meaning_zh: '每天发生的或使用的。',
        example_sentence: 'I read a daily newspaper.',
        example_translation_zh: '我每天读报纸。',
      },
    ],
    example_sentences: ['I read a daily newspaper.'],
    morphology: { summaryZh: '', parts: [] },
    derivedWords: [],
    synonyms: [],
    antonyms: [],
    confusingPairs: [],
    memory_tip: '',
    audio_uk_url: 'https://example.com/daily-uk.mp3',
    audio_us_url: 'https://example.com/daily-us.mp3',
    ...overrides,
  };
}

function makeWords(count: number) {
  return Array.from({ length: count }, (_, index) =>
    makeWord({
      id: `w${index + 1}`,
      word: `word${index + 1}`,
      chinese_definition: `释义 ${index + 1}`,
      senses: [
        {
          pos: 'n',
          meaning_zh: `释义 ${index + 1}`,
          example_sentence: `This is word${index + 1}.`,
          example_translation_zh: '',
        },
      ],
      example_sentences: [`This is word${index + 1}.`],
      audio_uk_url: `https://example.com/word${index + 1}-uk.mp3`,
      audio_us_url: `https://example.com/word${index + 1}-us.mp3`,
    }),
  );
}

function submitRound1Word(word: string) {
  const input = screen.getByPlaceholderText('拼写');
  fireEvent.change(input, { target: { value: word } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
}

function swipeCardByText(text: string, direction: 'left' | 'right') {
  const target = screen.getAllByText(text)[0];
  const startX = direction === 'left' ? 240 : 80;
  const endX = direction === 'left' ? 80 : 240;

  fireEvent.touchStart(target, { touches: [{ clientX: startX, clientY: 120 }] });
  fireEvent.touchEnd(target, { changedTouches: [{ clientX: endX, clientY: 124 }] });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function installAudioMock() {
  const instances: Array<{
    src: string;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
    onerror: (() => void) | null;
  }> = [];

  const AudioMock = vi.fn().mockImplementation(function MockAudio(
    this: {
      defaultPlaybackRate: number;
      playbackRate: number;
      onended: (() => void) | null;
      onerror: (() => void) | null;
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
    },
    src: string,
  ) {
    const instance = {
      src,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      onended: null,
      onerror: null,
    };
    instances.push(instance);

    this.defaultPlaybackRate = 1;
    this.playbackRate = 1;
    this.onended = instance.onended;
    this.onerror = instance.onerror;
    this.play = instance.play;
    this.pause = instance.pause;
  });
  vi.stubGlobal('Audio', AudioMock);

  return { AudioMock, instances };
}

describe('LearningEngine autoplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.preferences = {
      ...testState.preferences,
      defaultPronunciationLocale: 'uk',
      speechPlaybackRate: 1,
      autoPlayEnabled: false,
      autoPlayRepeatCount: 1,
      autoPlayRepeatGapMs: 1000,
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('starts pronunciation playback when autoplay is enabled on the current card', async () => {
    const { AudioMock } = installAudioMock();

    const props = {
      type: 'round1' as const,
      words: [makeWord()],
      onComplete: vi.fn(),
    };
    const { rerender } = render(<LearningEngine {...props} />);

    expect(AudioMock).not.toHaveBeenCalled();

    testState.preferences = {
      ...testState.preferences,
      autoPlayEnabled: true,
    };
    rerender(<LearningEngine {...props} />);

    await waitFor(() => expect(AudioMock).toHaveBeenCalledTimes(1));
    expect(AudioMock).toHaveBeenCalledWith('https://example.com/daily-uk.mp3');
  });

  it.each(['round3', 'review'] as const)('does not autoplay %s dictation when autoplay is off', (type) => {
    const { AudioMock } = installAudioMock();

    render(<LearningEngine type={type} words={[makeWord()]} onComplete={vi.fn()} />);

    expect(AudioMock).not.toHaveBeenCalled();
  });

  it.each(['round3', 'review'] as const)('autoplays %s dictation when autoplay is explicitly on', async (type) => {
    testState.preferences = {
      ...testState.preferences,
      autoPlayEnabled: true,
    };
    const { AudioMock } = installAudioMock();

    render(<LearningEngine type={type} words={[makeWord()]} onComplete={vi.fn()} />);

    await waitFor(() => expect(AudioMock).toHaveBeenCalledTimes(1));
    expect(AudioMock).toHaveBeenCalledWith('https://example.com/daily-uk.mp3');
  });

  it('keeps autoplay alive after a correct round 1 answer advances and the parent echoes the session', async () => {
    testState.preferences = {
      ...testState.preferences,
      autoPlayEnabled: true,
    };
    const { AudioMock, instances } = installAudioMock();
    const words = [
      makeWord({ id: 'w1', word: 'daily', audio_uk_url: 'https://example.com/daily-uk.mp3' }),
      makeWord({ id: 'w2', word: 'fume', audio_uk_url: 'https://example.com/fume-uk.mp3' }),
    ];

    function Harness() {
      const [session, setSession] = useState<PersistedLearningSession | null>(null);
      const handleSessionChange = (snapshot: LearningSessionSnapshot) => {
        setSession({
          groupId: 'g1',
          round: snapshot.round,
          currentIndex: snapshot.currentIndex,
          queueWordIds: snapshot.queueWordIds,
          passedQueueIndices: snapshot.passedQueueIndices,
          round1ConfirmedWordIds: snapshot.round1ConfirmedWordIds,
          lastActiveAt: new Date(0).toISOString(),
          groupCompleted: false,
          completedAt: null,
        });
      };

      return (
        <LearningEngine
          type="round1"
          words={words}
          initialSession={session}
          onComplete={vi.fn()}
          onSessionChange={handleSessionChange}
        />
      );
    }

    render(<Harness />);
    await waitFor(() => expect(AudioMock).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText('拼写');
    fireEvent.change(input, { target: { value: 'daily' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    await waitFor(() => expect(AudioMock).toHaveBeenCalledTimes(2));
    expect(AudioMock).toHaveBeenLastCalledWith('https://example.com/fume-uk.mp3');
    expect(instances[1]?.pause).not.toHaveBeenCalled();
  });

  it('keeps autoplay alive after a mastered round 1 word advances and the parent echoes the session', async () => {
    testState.preferences = {
      ...testState.preferences,
      autoPlayEnabled: true,
    };
    const { AudioMock, instances } = installAudioMock();
    const words = [
      makeWord({ id: 'w1', word: 'daily', audio_uk_url: 'https://example.com/daily-uk.mp3' }),
      makeWord({ id: 'w2', word: 'fume', audio_uk_url: 'https://example.com/fume-uk.mp3' }),
    ];

    function Harness() {
      const [session, setSession] = useState<PersistedLearningSession | null>(null);
      const handleSessionChange = (snapshot: LearningSessionSnapshot) => {
        setSession({
          groupId: 'g1',
          round: snapshot.round,
          currentIndex: snapshot.currentIndex,
          queueWordIds: snapshot.queueWordIds,
          passedQueueIndices: snapshot.passedQueueIndices,
          round1ConfirmedWordIds: snapshot.round1ConfirmedWordIds,
          lastActiveAt: new Date(0).toISOString(),
          groupCompleted: false,
          completedAt: null,
        });
      };

      return (
        <LearningEngine
          type="round1"
          words={words}
          initialSession={session}
          onComplete={vi.fn()}
          onSessionChange={handleSessionChange}
        />
      );
    }

    render(<Harness />);
    await waitFor(() => expect(AudioMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getAllByRole('button', { name: '更多操作' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '标记已掌握' })[0]);

    await waitFor(() => expect(AudioMock).toHaveBeenCalledTimes(2));
    expect(AudioMock).toHaveBeenLastCalledWith('https://example.com/fume-uk.mp3');
    expect(instances[1]?.pause).not.toHaveBeenCalled();
  });

  it('toggles the round 3 phonetic hint from the corner switch', () => {
    render(<LearningEngine type="round3" words={[makeWord()]} onComplete={vi.fn()} />);

    expect(screen.getByLabelText('当前词音标')).toHaveTextContent('/deili/');

    fireEvent.click(screen.getByRole('button', { name: '隐藏 Round 3 音标' }));
    expect(screen.queryByLabelText('当前词音标')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示 Round 3 音标' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: '显示 Round 3 音标' }));
    expect(screen.getByLabelText('当前词音标')).toHaveTextContent('/deili/');
  });

  it('toggles the review phonetic hint from the corner switch', () => {
    render(<LearningEngine type="review" words={[makeWord()]} onComplete={vi.fn()} />);

    expect(screen.getByLabelText('当前词音标')).toHaveTextContent('/deili/');

    fireEvent.click(screen.getByRole('button', { name: '隐藏复习轮音标' }));
    expect(screen.queryByLabelText('当前词音标')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示复习轮音标' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: '显示复习轮音标' }));
    expect(screen.getByLabelText('当前词音标')).toHaveTextContent('/deili/');
  });

  it('shows the current sense info and sentence translation in round 3 cloze dictation', () => {
    render(<LearningEngine type="round3" words={[makeWord()]} onComplete={vi.fn()} />);

    expect(screen.getByText('adj. 每天发生的或使用的。')).toBeInTheDocument();
    expect(screen.getByText('我每天读报纸。')).toBeInTheDocument();
    expect(screen.queryByText('每日的')).not.toBeInTheDocument();
  });

  it('shows the current sense info and sentence translation in review cloze dictation', () => {
    render(<LearningEngine type="review" words={[makeWord()]} onComplete={vi.fn()} />);

    expect(screen.getByText('adj. 每天发生的或使用的。')).toBeInTheDocument();
    expect(screen.getByText('我每天读报纸。')).toBeInTheDocument();
    expect(screen.queryByText('每日的')).not.toBeInTheDocument();
  });

  it('does not render the round 1 manual entry button', () => {
    render(<LearningEngine type="round1" words={makeWords(2)} onComplete={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /\d+词(回忆|听写|完成本组)/ })).not.toBeInTheDocument();
  });

  it('auto-submits round 1 when the input exactly matches the current word', async () => {
    const words = makeWords(2);

    render(<LearningEngine type="round1" words={words} onComplete={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('拼写'), { target: { value: words[0].word } });

    await waitFor(() => expect(screen.getAllByText(words[1].word).length).toBeGreaterThan(0));
  });

  it('does not auto-submit an incomplete round 1 input', async () => {
    const words = makeWords(2);

    render(<LearningEngine type="round1" words={words} onComplete={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('拼写'), { target: { value: 'wor' } });

    expect(screen.getAllByText(words[0].word).length).toBeGreaterThan(0);
    expect(screen.queryByText(words[1].word)).not.toBeInTheDocument();
  });

  it('auto-completes round 1 after 30 confirmed words', async () => {
    const words = makeWords(31);
    const onComplete = vi.fn();

    render(<LearningEngine type="round1" words={words} onComplete={onComplete} />);

    for (const word of words.slice(0, 30)) {
      submitRound1Word(word.word);
    }

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const snapshot = onComplete.mock.calls[0]?.[0] as LearningSessionSnapshot;
    expect(snapshot.round).toBe('round1');
    expect(snapshot.round1ConfirmedWordIds).toEqual(words.slice(0, 30).map((word) => word.id));
  });

  it('only completes round 1 once and stops emitting round 1 snapshots while completing', async () => {
    const words = makeWords(31);
    const onComplete = vi.fn();
    const onSessionChange = vi.fn();

    render(<LearningEngine type="round1" words={words} onComplete={onComplete} onSessionChange={onSessionChange} />);

    for (const word of words.slice(0, 30)) {
      submitRound1Word(word.word);
    }

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(
      onSessionChange.mock.calls.some(
        (call) => (call[0] as LearningSessionSnapshot).round1ConfirmedWordIds.length >= 30,
      ),
    ).toBe(false);
  });

  it('uses the round 1 reinforcement limit as the progress target for long official queues', async () => {
    const words = makeWords(70);

    render(<LearningEngine type="round1" words={words} onComplete={vi.fn()} round1CanWaitForMoreWords />);

    for (const word of words.slice(0, 30)) {
      submitRound1Word(word.word);
    }

    await waitFor(() => {
      const progress = screen.getByRole('progressbar', { name: /这一轮进度/ });
      expect(progress).toHaveAttribute('aria-valuemax', '30');
      expect(progress).toHaveAttribute('aria-valuenow', '30');
    });
  });

  it('excludes round 1 mastered words from the 30 confirmed word limit', async () => {
    const words = makeWords(31);
    const onComplete = vi.fn();

    render(<LearningEngine type="round1" words={words} onComplete={onComplete} />);

    fireEvent.click(screen.getAllByRole('button', { name: '更多操作' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '标记已掌握' })[0]);

    await waitFor(() => expect(markReviewWordMastered).toHaveBeenCalledTimes(1));
    expect(markReviewWordMastered).toHaveBeenCalledWith({
      vocabularyItemId: 'w1',
      learningGroupId: null,
    });

    for (const word of words.slice(1, 31)) {
      submitRound1Word(word.word);
    }

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const snapshot = onComplete.mock.calls[0]?.[0] as LearningSessionSnapshot;
    expect(snapshot.round1ConfirmedWordIds).toEqual(words.slice(1, 31).map((word) => word.id));
  });

  it('moves to the next round 1 word before the mastered request resolves', async () => {
    type MasteredResponse = Awaited<ReturnType<typeof markReviewWordMastered>>;
    const masteredRequest = createDeferred<MasteredResponse>();
    vi.mocked(markReviewWordMastered).mockReturnValueOnce(
      masteredRequest.promise as ReturnType<typeof markReviewWordMastered>,
    );
    const words = makeWords(2);
    const onWordMastered = vi.fn();

    render(<LearningEngine type="round1" words={words} onComplete={vi.fn()} onWordMastered={onWordMastered} />);

    fireEvent.click(screen.getAllByRole('button', { name: '更多操作' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '标记已掌握' })[0]);

    await waitFor(() => expect(screen.getAllByText('word2').length).toBeGreaterThan(0));
    expect(onWordMastered).toHaveBeenCalledWith('w1');

    masteredRequest.resolve(undefined as MasteredResponse);
    await waitFor(() => expect(screen.getByText('已掌握 word1')).toBeInTheDocument());
  });

  it.each(['round2', 'round3'] as const)('supports touch navigation in %s using the existing card history', (type) => {
    const words = makeWords(2);
    const session: PersistedLearningSession = {
      groupId: 'g1',
      round: type,
      currentIndex: 1,
      queueWordIds: words.map((word) => word.id),
      passedQueueIndices: [0],
      round1ConfirmedWordIds: words.map((word) => word.id),
      lastActiveAt: new Date(0).toISOString(),
      groupCompleted: false,
      completedAt: null,
    };

    render(<LearningEngine type={type} words={words} initialSession={session} onComplete={vi.fn()} />);

    const currentText = type === 'round2' ? words[1].word : `n. ${words[1].chinese_definition}`;
    const previousText = type === 'round2' ? words[0].word : `n. ${words[0].chinese_definition}`;

    expect(screen.getAllByText(currentText).length).toBeGreaterThan(0);
    swipeCardByText(currentText, 'right');
    expect(screen.getAllByText(previousText).length).toBeGreaterThan(0);
  });

  it('puts an optimistically mastered round 1 word back into the round when the request fails', async () => {
    vi.mocked(markReviewWordMastered).mockRejectedValueOnce(new Error('network down'));
    const words = makeWords(2);
    const onWordMasteredRollback = vi.fn();

    render(
      <LearningEngine
        type="round1"
        words={words}
        onComplete={vi.fn()}
        onWordMasteredRollback={onWordMasteredRollback}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: '更多操作' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '标记已掌握' })[0]);

    await waitFor(() => expect(screen.getAllByText('word2').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText(/标记已掌握失败，已放回本轮/)).toBeInTheDocument());
    expect(onWordMasteredRollback).toHaveBeenCalledWith(words[0]);

    submitRound1Word(words[1].word);

    await waitFor(() => expect(screen.getAllByText('word1').length).toBeGreaterThan(0));
  });

  it('waits for more round 1 words at the queue end when official append can continue', () => {
    const words = makeWords(2);
    const onComplete = vi.fn();

    render(<LearningEngine type="round1" words={words} onComplete={onComplete} round1CanWaitForMoreWords />);

    submitRound1Word(words[0].word);
    submitRound1Word(words[1].word);

    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByText(/正在等待下一批新词预载/)).toBeInTheDocument();
  });

  it('auto-completes round 1 under 30 words when no more words can be appended', async () => {
    const words = makeWords(2);
    const onComplete = vi.fn();

    render(<LearningEngine type="round1" words={words} onComplete={onComplete} round1CanWaitForMoreWords={false} />);

    submitRound1Word(words[0].word);
    submitRound1Word(words[1].word);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const snapshot = onComplete.mock.calls[0]?.[0] as LearningSessionSnapshot;
    expect(snapshot.round1ConfirmedWordIds).toEqual(words.map((word) => word.id));
  });
});

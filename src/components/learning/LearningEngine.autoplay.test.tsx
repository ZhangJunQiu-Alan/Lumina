import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningPreferences, PersistedLearningSession, Word } from '../../types';
import { attemptBuffer } from '../../lib/attemptBuffer';
import { fetchExampleAudioUrl } from '../../lib/exampleAudio';
import { markReviewWordMastered } from '../../lib/reviewApi';
import { LearningEngine, type LearningSessionSnapshot } from './LearningEngine';
import { getWrongAnswerRequeueIndex } from './learningEngineUtils';

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
    round2ChoiceDistractors: [],
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

function makeRound2ChoiceWord(overrides: Partial<Word> = {}): Word {
  return makeWord({
    id: 'enemy-id',
    word: 'enemy',
    phonetic: '/enemi/',
    ipa_uk: '/enemi/',
    ipa_us: '/enemi/',
    pos_tags: ['n'],
    chinese_definition: '敌人；仇敌',
    senses: [
      {
        pos: 'n',
        meaning_zh: '敌人；仇敌',
        example_sentence: 'He has many enemies.',
        example_translation_zh: '他有很多敌人。',
      },
    ],
    example_sentences: ['He has many enemies.'],
    round2ChoiceDistractors: [
      {
        word: 'rival',
        pos: 'n',
        meaning_zh: '对手；竞争者',
      },
      {
        word: 'opponent',
        pos: 'n',
        meaning_zh: '反对者；对手',
      },
      {
        word: 'adversary',
        pos: 'n',
        meaning_zh: '敌手；对抗者',
      },
    ],
    audio_uk_url: 'https://example.com/enemy-uk.mp3',
    audio_us_url: 'https://example.com/enemy-us.mp3',
    ...overrides,
  });
}

function submitRound1Word(word: string) {
  const input = (screen.queryByPlaceholderText('拼写') ?? screen.getByLabelText('拼写输入')) as HTMLInputElement;
  fireEvent.change(input, { target: { value: word } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
}

function typeRound3Word(word: string) {
  fireEvent.change(screen.getByLabelText('拼写输入'), { target: { value: word } });
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

async function flushPromises(count = 5) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
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
    this.play = instance.play;
    this.pause = instance.pause;
    Object.defineProperty(this, 'onended', {
      get: () => instance.onended,
      set: (handler: (() => void) | null) => {
        instance.onended = handler;
      },
      configurable: true,
    });
    Object.defineProperty(this, 'onerror', {
      get: () => instance.onerror,
      set: (handler: (() => void) | null) => {
        instance.onerror = handler;
      },
      configurable: true,
    });
  });
  vi.stubGlobal('Audio', AudioMock);

  return { AudioMock, instances };
}

describe('LearningEngine autoplay', () => {
  it('places wrong answers after four or five intervening words', () => {
    expect(getWrongAnswerRequeueIndex(0, 10, 0)).toBe(5);
    expect(getWrongAnswerRequeueIndex(0, 10, 0.999999)).toBe(6);
    expect(getWrongAnswerRequeueIndex(8, 10, 0)).toBe(10);
  });

  it('requeues a wrong review answer after four intervening words', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const words = makeWords(7);
    const onReviewChange = vi.fn();

    render(<LearningEngine type="review" words={words} onComplete={vi.fn()} onReviewChange={onReviewChange} />);

    const input = screen.getByLabelText('拼写输入');
    fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(onReviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          words: [words[0], words[1], words[2], words[3], words[4], words[0], words[5], words[6]],
        }),
      ),
    );
  });

  it('restores a review at its saved queue position, including requeued words', () => {
    const words = makeWords(3);
    const onReviewChange = vi.fn();
    render(
      <LearningEngine
        type="review"
        words={words}
        onComplete={vi.fn()}
        initialReviewRecovery={{
          words: [words[0], words[1], words[0], words[2]],
          currentIndex: 2,
          passedQueueIndices: [0, 1],
        }}
        onReviewChange={onReviewChange}
      />,
    );
    expect(onReviewChange).toHaveBeenLastCalledWith({
      runId: expect.any(String),
      words: [words[0], words[1], words[0], words[2]],
      currentIndex: 2,
      passedQueueIndices: [0, 1],
    });
  });
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
    vi.useRealTimers();
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

  it('auto-submits round 3 when the input exactly matches without pressing Enter', async () => {
    vi.mocked(fetchExampleAudioUrl).mockResolvedValueOnce('/audio/daily-sentence.mp3');
    const { AudioMock } = installAudioMock();
    const words = [
      makeWord(),
      makeWord({
        id: 'w2',
        word: 'fume',
        pos_tags: ['n'],
        chinese_definition: '烟雾',
        senses: [
          {
            pos: 'n',
            meaning_zh: '烟雾',
            example_sentence: 'The fume filled the room.',
            example_translation_zh: '烟雾充满了房间。',
          },
        ],
        example_sentences: ['The fume filled the room.'],
      }),
    ];

    render(<LearningEngine type="round3" words={words} onComplete={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('拼写输入'), { target: { value: 'daily' } });

    await waitFor(() =>
      expect(attemptBuffer.pushAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          vocabularyItemId: 'w1',
          source: 'round3',
          wasCorrect: true,
        }),
      ),
    );
    await waitFor(() => expect(AudioMock).toHaveBeenCalledWith('/audio/daily-sentence.mp3'));
    expect(screen.queryByText('n. 烟雾')).not.toBeInTheDocument();
  });

  it('waits for round 3 correct sentence playback to finish before advancing', async () => {
    vi.mocked(fetchExampleAudioUrl).mockResolvedValueOnce('/audio/daily-sentence.mp3');
    const { AudioMock, instances } = installAudioMock();
    const words = [
      makeWord(),
      makeWord({
        id: 'w2',
        word: 'fume',
        pos_tags: ['n'],
        chinese_definition: '烟雾',
        senses: [
          {
            pos: 'n',
            meaning_zh: '烟雾',
            example_sentence: 'The fume filled the room.',
            example_translation_zh: '烟雾充满了房间。',
          },
        ],
        example_sentences: ['The fume filled the room.'],
      }),
    ];

    render(<LearningEngine type="round3" words={words} onComplete={vi.fn()} />);

    typeRound3Word('daily');

    await waitFor(() => expect(AudioMock).toHaveBeenCalledWith('/audio/daily-sentence.mp3'));
    expect(screen.getByText('adj. 每天发生的或使用的。')).toBeInTheDocument();
    expect(screen.queryByText('n. 烟雾')).not.toBeInTheDocument();

    await act(async () => {
      instances[0]?.onended?.();
    });

    await waitFor(() => expect(screen.getByText('n. 烟雾')).toBeInTheDocument());
  });

  it('advances round 3 after the correct sentence playback fallback timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchExampleAudioUrl).mockResolvedValueOnce('/audio/daily-sentence.mp3');
    const { AudioMock } = installAudioMock();
    const words = [
      makeWord(),
      makeWord({
        id: 'w2',
        word: 'fume',
        pos_tags: ['n'],
        chinese_definition: '烟雾',
        senses: [
          {
            pos: 'n',
            meaning_zh: '烟雾',
            example_sentence: 'The fume filled the room.',
            example_translation_zh: '烟雾充满了房间。',
          },
        ],
        example_sentences: ['The fume filled the room.'],
      }),
    ];

    render(<LearningEngine type="round3" words={words} onComplete={vi.fn()} />);

    typeRound3Word('daily');

    await act(async () => {
      vi.advanceTimersByTime(0);
      await flushPromises();
    });

    expect(AudioMock).toHaveBeenCalledWith('/audio/daily-sentence.mp3');
    expect(screen.queryByText('n. 烟雾')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(30000);
      await flushPromises();
    });

    expect(screen.getByText('n. 烟雾')).toBeInTheDocument();
  });

  it('renders round 2 as four-choice recall when distractors are complete', () => {
    render(<LearningEngine type="round2" words={[makeRound2ChoiceWord()]} onComplete={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: /Round2 选项/ })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: '展开释义' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '继续下一个词' })).not.toBeInTheDocument();

    const correctOption = screen.getByRole('button', { name: /n\. 敌人；仇敌/ });
    expect(correctOption).toHaveTextContent('n. 敌人；仇敌');
    expect(correctOption).not.toHaveTextContent('enemy');
    expect(screen.queryByText('rival')).not.toBeInTheDocument();
  });

  it('reveals round 2 choice answers and records a correct attempt', async () => {
    render(<LearningEngine type="round2" words={[makeRound2ChoiceWord()]} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /n\. 敌人；仇敌/ }));

    await waitFor(() => expect(attemptBuffer.pushAttempt).toHaveBeenCalledTimes(1));
    expect(attemptBuffer.pushAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        vocabularyItemId: 'enemy-id',
        source: 'round2',
        wasCorrect: true,
      }),
    );

    const correctOption = screen.getByRole('button', { name: /n\. 敌人；仇敌：enemy/ });
    expect(correctOption.className).toContain('text-[#15803D]');
    expect(screen.getByText('n. 对手；竞争者：rival')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续下一个词' })).toBeInTheDocument();
  });

  it('marks a wrong round 2 choice red while revealing the correct answer', async () => {
    render(<LearningEngine type="round2" words={[makeRound2ChoiceWord()]} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /n\. 对手；竞争者/ }));

    await waitFor(() => expect(attemptBuffer.pushAttempt).toHaveBeenCalledTimes(1));
    expect(attemptBuffer.pushAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        vocabularyItemId: 'enemy-id',
        source: 'round2',
        wasCorrect: false,
      }),
    );

    expect(screen.getByRole('button', { name: /n\. 对手；竞争者：rival/ }).className).toContain('text-apple-red');
    expect(screen.getByRole('button', { name: /n\. 敌人；仇敌：enemy/ }).className).toContain('text-[#15803D]');
  });

  it('requeues a wrong round 2 choice after four intervening words', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const firstWord = makeRound2ChoiceWord();
    const remainingWords = makeWords(6);
    const words = [firstWord, ...remainingWords];
    const onSessionChange = vi.fn();

    render(<LearningEngine type="round2" words={words} onComplete={vi.fn()} onSessionChange={onSessionChange} />);

    fireEvent.click(screen.getByRole('button', { name: /n\. 对手；竞争者/ }));
    await waitFor(() => expect(attemptBuffer.pushAttempt).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '继续下一个词' }));

    await waitFor(() =>
      expect(onSessionChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          currentIndex: 1,
          queueWordIds: [
            firstWord.id,
            remainingWords[0].id,
            remainingWords[1].id,
            remainingWords[2].id,
            remainingWords[3].id,
            firstWord.id,
            remainingWords[4].id,
            remainingWords[5].id,
          ],
        }),
      ),
    );
  });

  it('restores a persisted answer after remount without submitting it twice', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const props = {
      userId: 'alice',
      type: 'round2' as const,
      words: [makeRound2ChoiceWord()],
      initialSession: {
        groupId: 'test-group',
        round: 'round2',
        currentIndex: 0,
        queueWordIds: ['enemy-id'],
        passedQueueIndices: [],
        round1ConfirmedWordIds: [],
        lastActiveAt: '2026-08-28',
        groupCompleted: false,
        completedAt: null,
      } as PersistedLearningSession,
      onComplete: vi.fn(),
    };
    const first = render(<LearningEngine {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /n\. 对手；竞争者/ }));
    await waitFor(() => expect(attemptBuffer.pushAttempt).toHaveBeenCalledTimes(1));
    first.unmount();
    render(<LearningEngine {...props} />);
    expect(screen.getByRole('button', { name: /n\. 对手；竞争者：rival/ }).className).toContain('text-apple-red');
    expect(screen.getByRole('button', { name: '继续下一个词' })).toBeInTheDocument();
    expect(attemptBuffer.pushAttempt).toHaveBeenCalledTimes(1);
  });

  it('moves to the next round 2 word after a revealed choice is continued', async () => {
    const words = [
      makeRound2ChoiceWord(),
      makeWord({
        id: 'second-id',
        word: 'second',
        pos_tags: ['adj'],
        chinese_definition: '第二的',
        senses: [
          {
            pos: 'adj',
            meaning_zh: '第二的',
            example_sentence: 'This is the second card.',
            example_translation_zh: '这是第二张卡。',
          },
        ],
      }),
    ];

    render(<LearningEngine type="round2" words={words} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /n\. 敌人；仇敌/ }));
    fireEvent.click(screen.getByRole('button', { name: '继续下一个词' }));

    await waitFor(() => expect(screen.getAllByText('second').length).toBeGreaterThan(0));
  });

  it('falls back to the original round 2 recall card when distractors are incomplete', () => {
    render(
      <LearningEngine
        type="round2"
        words={[
          makeRound2ChoiceWord({
            round2ChoiceDistractors: [
              {
                word: 'rival',
                pos: 'n',
                meaning_zh: '对手；竞争者',
              },
            ],
          }),
        ]}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.queryAllByRole('button', { name: /Round2 选项/ })).toHaveLength(0);
    expect(screen.getByRole('button', { name: '展开释义' })).toBeInTheDocument();
  });

  it('falls back to the original round 2 recall card when old word data omits distractors', () => {
    const legacyWord = makeRound2ChoiceWord();
    delete (legacyWord as Partial<Word>).round2ChoiceDistractors;

    render(<LearningEngine type="round2" words={[legacyWord]} onComplete={vi.fn()} />);

    expect(screen.queryAllByRole('button', { name: /Round2 选项/ })).toHaveLength(0);
    expect(screen.getByRole('button', { name: '展开释义' })).toBeInTheDocument();
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

  it('auto-completes round 1 after all selected words, including more than 30', async () => {
    const words = makeWords(31);
    const onComplete = vi.fn();

    render(<LearningEngine type="round1" words={words} onComplete={onComplete} />);

    for (const word of words) {
      submitRound1Word(word.word);
      if (word !== words.at(-1)) expect(onComplete).not.toHaveBeenCalled();
    }

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const snapshot = onComplete.mock.calls[0]?.[0] as LearningSessionSnapshot;
    expect(snapshot.round).toBe('round1');
    expect(snapshot.round1ConfirmedWordIds).toEqual(words.map((word) => word.id));
  }, 10000);

  it('keeps all selected round 1 words after an earlier wrong answer is corrected', async () => {
    const words = makeWords(31);
    const onComplete = vi.fn();

    render(<LearningEngine type="round1" words={words} onComplete={onComplete} />);

    for (const [index, word] of words.entries()) {
      if (index === 5) {
        submitRound1Word('carbon');
      }
      submitRound1Word(word.word);
      if (word !== words.at(-1)) expect(onComplete).not.toHaveBeenCalled();
    }

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const snapshot = onComplete.mock.calls[0]?.[0] as LearningSessionSnapshot;
    expect(snapshot.round1ConfirmedWordIds).toHaveLength(31);
    expect(snapshot.round1ConfirmedWordIds).toContain(words[29].id);
    expect(snapshot.round1ConfirmedWordIds).toEqual(words.map((word) => word.id));
  }, 10000);

  it('only completes round 1 once and stops emitting round 1 snapshots while completing', async () => {
    const words = makeWords(31);
    const onComplete = vi.fn();
    const onSessionChange = vi.fn();

    render(<LearningEngine type="round1" words={words} onComplete={onComplete} onSessionChange={onSessionChange} />);

    for (const word of words) {
      submitRound1Word(word.word);
      if (word !== words.at(-1)) expect(onComplete).not.toHaveBeenCalled();
    }

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(
      onSessionChange.mock.calls.some(
        (call) => (call[0] as LearningSessionSnapshot).round1ConfirmedWordIds.length >= 31,
      ),
    ).toBe(false);
  }, 10000);

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

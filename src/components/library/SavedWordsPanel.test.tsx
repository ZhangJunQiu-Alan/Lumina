import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedWordsPanel } from './SavedWordsPanel';
import type { SavedWordEntry } from '../../lib/libraryApi';

const state = vi.hoisted(() => ({
  words: [] as SavedWordEntry[],
  activeIds: new Set<string>(),
  locale: 'uk',
  create: vi.fn(),
  fetchEntries: vi.fn(),
  fetchAudio: vi.fn(),
  speak: vi.fn(),
  cancelSpeech: vi.fn(),
  cleanupSaved: vi.fn(),
  deleteSaved: vi.fn(),
  cacheFresh: true,
}));

vi.mock('../../contexts/LearningPreferencesContext', () => ({
  useLearningPreferences: () => ({ preferences: { defaultPronunciationLocale: state.locale } }),
}));
vi.mock('../../lib/importFlow', () => ({
  createLearningGroupFromVocabularyEntries: state.create,
  fetchPersistedVocabularyEntriesByIds: state.fetchEntries,
}));
vi.mock('../../lib/libraryApi', () => ({
  cleanupSavedWords: state.cleanupSaved,
  deleteSavedWord: state.deleteSaved,
  fetchSavedWords: vi.fn(async () => state.words),
  fetchActiveLearningGroupWordIds: vi.fn(async () => state.activeIds),
}));
vi.mock('../../lib/libraryCache', () => ({
  getCachedSavedWords: () => ({ data: state.words, cachedAt: Date.now() }),
  isLibraryCacheFresh: () => state.cacheFresh,
  invalidateLibraryCache: vi.fn(),
  refreshSavedWords: vi.fn(async () => state.words),
  removeSavedWordFromCache: vi.fn(),
}));
vi.mock('../../lib/wordAudio', () => ({ fetchWordAudioUrl: state.fetchAudio }));
vi.mock('../../lib/browserSpeech', () => ({
  cancelBrowserSpeech: state.cancelSpeech,
  speakTextViaBrowser: state.speak,
}));

function makeWords(count: number) {
  return Array.from(
    { length: count },
    (_, index): SavedWordEntry => ({
      id: `saved-${index + 1}`,
      vocabularyItemId: `id-${index + 1}`,
      word: `word${index + 1}`,
      phonetic: '',
      meaning: `释义 ${index + 1}`,
      exampleSentence: '',
      enrichmentLevel: 'full',
      source: 'manual',
      savedAt: '2026-09-16T00:00:00Z',
      memoryState: 'new',
      nextReviewAt: null,
      lastResult: null,
      isInActiveLearningGroup: false,
    }),
  );
}

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

async function showPanel(count = 1) {
  state.words = makeWords(count);
  const onStart = vi.fn();
  const rendered = render(<SavedWordsPanel userId="user1" nextGroupNumber={3} onStartLearningGroup={onStart} />);
  await screen.findByRole('checkbox', { name: '选择 word1' });
  return { ...rendered, onStart };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.activeIds = new Set();
  state.cacheFresh = true;
  state.locale = 'uk';
  state.create.mockResolvedValue({ groupId: 'group3', words: [] });
  state.fetchEntries.mockImplementation(async (ids: string[]) => ids.map((id) => ({ id })));
  state.fetchAudio.mockResolvedValue('https://example.com/word.mp3');
  state.speak.mockResolvedValue(true);
  MockAudio.instances = [];
  vi.stubGlobal('Audio', MockAudio);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('personal vocabulary selection', () => {
  it.each([true, false])(
    'opening or reopening the panel preserves learned bookmarks (fresh cache=%s)',
    async (cacheFresh) => {
      state.cacheFresh = cacheFresh;
      state.words = makeWords(2);
      state.words[0].memoryState = 'stable_recall';
      state.words[0].isInActiveLearningGroup = true;
      state.words[1].memoryState = 'mastered';
      const onLibraryMutated = vi.fn();
      for (let visit = 0; visit < 2; visit += 1) {
        const view = render(
          <SavedWordsPanel
            userId="user1"
            nextGroupNumber={3}
            onStartLearningGroup={vi.fn()}
            onLibraryMutated={onLibraryMutated}
          />,
        );
        await screen.findByRole('button', { name: '播放 word1 的英式发音' });
        expect(screen.getByRole('button', { name: '播放 word2 的英式发音' })).toBeInTheDocument();
        view.unmount();
      }
      expect(state.cleanupSaved).not.toHaveBeenCalled();
      expect(state.deleteSaved).not.toHaveBeenCalled();
      expect(state.create).not.toHaveBeenCalled();
      expect(onLibraryMutated).not.toHaveBeenCalled();
    },
  );
  it('starts with no selection and allows a single word', async () => {
    const { onStart } = await showPanel();
    expect(screen.getByRole('button', { name: '请选择单词' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '顺序' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 word1' }));
    fireEvent.click(screen.getByRole('button', { name: '开始学习（1 词）' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('group3', []));
    expect(state.create).toHaveBeenCalledWith('user1', [{ id: 'id-1' }], {
      groupName: '个人词库 · 第 3 组 · 1 词',
      groupSourceType: 'custom',
    });
  });

  it('keeps selections across pages and search and starts with more than 30 words', async () => {
    await showPanel(37);
    const selectPage = screen.getByRole('button', { name: '全选本页单词' });
    const nextPage = screen.getByRole('button', { name: '下一页' });
    for (let page = 1; page <= 4; page += 1) {
      fireEvent.click(selectPage);
      if (page < 4) fireEvent.click(nextPage);
    }
    fireEvent.change(screen.getByRole('textbox', { name: '搜索个人词库' }), { target: { value: 'word1' } });
    expect(screen.getByRole('button', { name: '开始学习（37 词）' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '开始学习（37 词）' }));
    await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
    expect(state.fetchEntries).toHaveBeenCalledWith(state.words.map((word) => word.vocabularyItemId));
    expect(state.create.mock.calls[0][1]).toHaveLength(37);
  });

  it('clears the selection and excludes words already being studied', async () => {
    state.words = makeWords(2);
    state.words[1].isInActiveLearningGroup = true;
    render(<SavedWordsPanel userId="user1" nextGroupNumber={1} onStartLearningGroup={vi.fn()} />);
    expect(await screen.findByRole('checkbox', { name: '选择 word2' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '全选本页单词' }));
    expect(screen.getByRole('button', { name: '开始学习（1 词）' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '清空选择' }));
    expect(screen.getByRole('button', { name: '请选择单词' })).toBeDisabled();
  });

  it('rejects a stale selection without silently dropping words', async () => {
    await showPanel(2);
    fireEvent.click(screen.getByRole('button', { name: '全选本页单词' }));
    state.activeIds.add('id-2');
    fireEvent.click(screen.getByRole('button', { name: '开始学习（2 词）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('所选单词中有词已在学习');
    expect(state.create).not.toHaveBeenCalled();
  });

  it('does not create a partial group when a selected entry cannot load', async () => {
    await showPanel(2);
    state.fetchEntries.mockResolvedValue([{ id: 'id-1' }]);
    fireEvent.click(screen.getByRole('button', { name: '全选本页单词' }));
    fireEvent.click(screen.getByRole('button', { name: '开始学习（2 词）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('部分词条加载失败');
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe('personal vocabulary pronunciation', () => {
  it('plays the preferred accent without selecting a word and stops on unmount', async () => {
    state.locale = 'us';
    const { unmount } = await showPanel();
    fireEvent.click(screen.getByRole('button', { name: '播放 word1 的美式发音' }));
    await waitFor(() => expect(MockAudio.instances[0]?.play).toHaveBeenCalledOnce());
    expect(state.fetchAudio).toHaveBeenCalledWith('word1', 'us');
    expect(screen.getByRole('checkbox', { name: '选择 word1' })).not.toBeChecked();
    unmount();
    expect(MockAudio.instances[0].pause).toHaveBeenCalled();
  });

  it('ignores an old audio request after a different word is clicked', async () => {
    let resolveFirst!: (url: string) => void;
    state.fetchAudio.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    await showPanel(2);
    fireEvent.click(screen.getByRole('button', { name: '播放 word1 的英式发音' }));
    fireEvent.click(screen.getByRole('button', { name: '播放 word2 的英式发音' }));
    await waitFor(() => expect(MockAudio.instances).toHaveLength(1));
    await act(async () => resolveFirst('https://example.com/old.mp3'));
    expect(MockAudio.instances).toHaveLength(1);
    expect(screen.getByRole('button', { name: '停止 word2 的英式发音' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('falls back to browser speech after an audio error and reports failure', async () => {
    state.speak.mockResolvedValue(false);
    await showPanel();
    fireEvent.click(screen.getByRole('button', { name: '播放 word1 的英式发音' }));
    await waitFor(() => expect(MockAudio.instances).toHaveLength(1));
    act(() => MockAudio.instances[0].onerror?.());
    expect(await screen.findByRole('alert')).toHaveTextContent('无法播放 word1 的发音');
    expect(state.speak).toHaveBeenCalledWith('word1', 'uk');
  });
});

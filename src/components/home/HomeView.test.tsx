import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeOfficialLibraryOption, UserStats } from '../../types';
import { HomeView } from './HomeView';

vi.mock('animal-island-ui', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid="island-icon">{name}</span>,
}));

const SELECTED_OFFICIAL_LIBRARY_STORAGE_KEY = 'lumina.home.selectedOfficialLibraryId.v1';

function installLocalStorageStub() {
  const values = new Map<string, string>();
  const storage = {
    clear: vi.fn(() => {
      values.clear();
    }),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };

  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
  });

  return storage;
}

function makeOfficialOption(overrides: Partial<HomeOfficialLibraryOption>): HomeOfficialLibraryOption {
  return {
    libraryId: 'ielts-vocab',
    title: '雅思词汇真经',
    mode: 'sequential',
    existingGroupCount: 1,
    activeGroupId: null,
    activeRound: null,
    confirmedWordCount: 0,
    loadedWordCount: 0,
    completedMemoryWordCount: 0,
    totalWordCount: 100,
    ...overrides,
  };
}

function makeStats(overrides: Partial<UserStats> = {}): UserStats {
  return {
    todayReviewCount: 0,
    streak: 0,
    perfectCheckinDays: 0,
    stableRecallCount: 0,
    orbitDays: [],
    activityDays: [],
    selectedDate: '2026-06-03',
    selectedDayReviewWordCount: 0,
    selectedDayLearnedWordCount: 0,
    resumeCandidate: null,
    routineCard: {
      state: 'not_started',
      title: '开始今天的学习',
      subtitle: '',
      ctaLabel: '先选择学习词库',
      ctaMode: 'start_learning',
      boundLearningGroupId: null,
      lastUsedOfficialLibraryId: null,
      lastUsedOfficialMode: null,
      lastUsedOfficialGroupCount: 0,
      selectedOfficialLibraryId: null,
      officialLibraryOptions: [
        makeOfficialOption({ libraryId: 'ielts-vocab', title: '雅思词汇真经' }),
        makeOfficialOption({ libraryId: 'cet6-vocab', title: '六级词汇', existingGroupCount: 2 }),
      ],
      visibleSteps: [],
    },
    ...overrides,
  };
}

function renderHomeView(props: Partial<Parameters<typeof HomeView>[0]> = {}) {
  return render(
    <HomeView
      stats={makeStats()}
      onSelectOrbitDate={vi.fn()}
      onStart={vi.fn()}
      onOpenOfficialLibrary={vi.fn()}
      {...props}
    />,
  );
}

describe('HomeView official library selection', () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  afterEach(() => {
    cleanup();
  });

  it('restores the last selected official library after remounting', () => {
    const view = renderHomeView();

    fireEvent.click(screen.getByRole('button', { name: '雅思词汇真经' }));
    fireEvent.click(screen.getByRole('option', { name: '六级词汇' }));
    expect(screen.getByRole('button', { name: '六级词汇' })).toBeInTheDocument();

    view.unmount();
    renderHomeView();

    expect(screen.getByRole('button', { name: '六级词汇' })).toBeInTheDocument();
  });

  it('lets an explicit requested official library override the stored selection', () => {
    window.localStorage.setItem(SELECTED_OFFICIAL_LIBRARY_STORAGE_KEY, 'cet6-vocab');

    renderHomeView({ requestedOfficialLibraryId: 'ielts-vocab' });

    expect(screen.getByRole('button', { name: '雅思词汇真经' })).toBeInTheDocument();
  });

  it('shows a start label and starts the selected official library when one is available', () => {
    const onStart = vi.fn();
    const onOpenOfficialLibrary = vi.fn();

    renderHomeView({
      onStart,
      onOpenOfficialLibrary,
      stats: makeStats({
        routineCard: {
          ...makeStats().routineCard,
          ctaLabel: '先选择学习词库',
          ctaMode: 'start_learning',
          selectedOfficialLibraryId: 'ielts-vocab',
        },
      }),
    });

    expect(screen.getByRole('button', { name: '开始学习' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '先选择学习词库' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始学习' }));

    expect(onStart).toHaveBeenCalledWith({ libraryId: 'ielts-vocab', mode: 'sequential' });
    expect(onOpenOfficialLibrary).not.toHaveBeenCalled();
  });

  it('opens the official library selector when no learning library exists', () => {
    const onStart = vi.fn();
    const onOpenOfficialLibrary = vi.fn();

    renderHomeView({
      stats: makeStats({
        routineCard: {
          ...makeStats().routineCard,
          ctaLabel: '先选择学习词库',
          ctaMode: 'start_learning',
          officialLibraryOptions: [],
          selectedOfficialLibraryId: null,
        },
      }),
      onStart,
      onOpenOfficialLibrary,
    });

    fireEvent.click(screen.getByRole('button', { name: '先选择学习词库' }));

    expect(onOpenOfficialLibrary).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });
});

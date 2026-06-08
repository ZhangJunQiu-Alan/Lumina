import { describe, expect, it } from 'vitest';
import type { UserStats } from '../types';
import {
  invalidateCachedHomeOverview,
  isCachedHomeOverviewCompatibleWithActiveLearningGroup,
  readCachedHomeOverview,
  resolveHomeOverviewCacheKey,
  writeCachedHomeOverview,
} from './homeOverviewCache';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
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
    selectedDate: '2026-06-02',
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
      visibleSteps: [],
      lastUsedOfficialLibraryId: null,
      lastUsedOfficialMode: null,
      lastUsedOfficialGroupCount: 0,
      selectedOfficialLibraryId: null,
      officialLibraryOptions: [],
    },
    ...overrides,
  };
}

describe('home overview cache', () => {
  it('stores same-day home overview data as fresh within the ttl', () => {
    const storage = createStorage();
    const now = new Date('2026-06-02T12:00:00.000Z');
    const stats = makeStats({ streak: 7 });

    writeCachedHomeOverview('user-1', 'Asia/Shanghai', stats, { now, storage });

    const cached = readCachedHomeOverview('user-1', 'Asia/Shanghai', {
      now: new Date('2026-06-02T12:03:00.000Z'),
      storage,
    });
    expect(cached?.isFresh).toBe(true);
    expect(cached?.stats.streak).toBe(7);
  });

  it('keeps same-day stale data usable while marking it for revalidation', () => {
    const storage = createStorage();
    const now = new Date('2026-06-02T12:00:00.000Z');

    writeCachedHomeOverview('user-1', 'Asia/Shanghai', makeStats({ streak: 3 }), { now, storage });

    const cached = readCachedHomeOverview('user-1', 'Asia/Shanghai', {
      now: new Date('2026-06-02T12:08:00.000Z'),
      storage,
    });
    expect(cached?.isFresh).toBe(false);
    expect(cached?.stats.streak).toBe(3);
  });

  it('does not reuse cached data across routine dates', () => {
    const storage = createStorage();
    writeCachedHomeOverview('user-1', 'Asia/Shanghai', makeStats({ streak: 2 }), {
      now: new Date('2026-06-02T12:00:00.000Z'),
      storage,
    });

    const cached = readCachedHomeOverview('user-1', 'Asia/Shanghai', {
      now: new Date('2026-06-03T00:00:00.000Z'),
      storage,
    });
    expect(cached).toBeNull();
  });

  it('removes malformed cache entries', () => {
    const storage = createStorage();
    const { cacheKey } = resolveHomeOverviewCacheKey('user-1', 'Asia/Shanghai', new Date('2026-06-02T12:00:00.000Z'));
    storage.setItem(cacheKey, '{');

    expect(
      readCachedHomeOverview('user-1', 'Asia/Shanghai', {
        now: new Date('2026-06-02T12:00:00.000Z'),
        storage,
      }),
    ).toBeNull();
    expect(storage.getItem(cacheKey)).toBeNull();
  });

  it('invalidates the current routine-date entry', () => {
    const storage = createStorage();
    const now = new Date('2026-06-02T12:00:00.000Z');
    writeCachedHomeOverview('user-1', 'Asia/Shanghai', makeStats({ streak: 5 }), { now, storage });

    invalidateCachedHomeOverview('user-1', 'Asia/Shanghai', { now, storage });

    expect(readCachedHomeOverview('user-1', 'Asia/Shanghai', { now, storage })).toBeNull();
  });

  it('does not let an empty cached home overview override an active local learning group', () => {
    expect(isCachedHomeOverviewCompatibleWithActiveLearningGroup(makeStats(), 'group-1')).toBe(false);
  });

  it('allows cached home overview data that points at the active learning group', () => {
    const stats = makeStats({
      routineCard: {
        ...makeStats().routineCard,
        ctaMode: 'continue_learning',
        ctaLabel: '继续学习',
        boundLearningGroupId: 'group-1',
      },
    });

    expect(isCachedHomeOverviewCompatibleWithActiveLearningGroup(stats, 'group-1')).toBe(true);
  });
});

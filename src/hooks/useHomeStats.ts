import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
  ActivityDay,
  HomeOfficialLibraryOption,
  LearningPreferences,
  PersistedLearningSession,
  UserStats,
} from '../types';
import type { User } from '@supabase/supabase-js';
import { fetchHomeOverview, resolveBrowserTimeZone } from '../lib/homeApi';
import {
  invalidateCachedHomeOverview,
  isCachedHomeOverviewCompatibleWithActiveLearningGroup,
  readCachedHomeOverview,
  writeCachedHomeOverview,
} from '../lib/homeOverviewCache';
import { queryClient } from '../lib/queryClient';
import { queryKeys } from '../lib/queryKeys';
import { getOfficialLibraryDefinition, isOfficialLibraryId } from '../lib/officialLibrary';
import { toRoutineDateKey } from '../lib/routineDate';

export interface FetchStatsOptions {
  forceRefresh?: boolean;
  preferCache?: boolean;
}

export function buildFallbackActivityDays(timeZone: string, length = 365): ActivityDay[] {
  const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC',
    weekday: 'short',
  });

  return Array.from({ length }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (length - 1 - index));

    const dateKey = toRoutineDateKey(date, timeZone);
    const labelDate = new Date(`${dateKey}T12:00:00.000Z`);
    const [year = '0000', month = '01', day = '01'] = dateKey.split('-');

    return {
      date: `${year}-${month}-${day}`,
      weekdayLabel: weekdayFormatter.format(labelDate),
      shortDateLabel: `${month}.${day}`,
      status: 'gap' as const,
      reviewWordCount: 0,
      learnedWordCount: 0,
      attemptCount: 0,
      correctAttemptCount: 0,
      accuracy: null,
    };
  });
}

export function buildFallbackOrbitDays(timeZone: string) {
  return buildFallbackActivityDays(timeZone, 7).map((day) => ({
    date: day.date,
    weekdayLabel: day.weekdayLabel,
    shortDateLabel: day.shortDateLabel,
    status: day.status,
    reviewWordCount: day.reviewWordCount,
    learnedWordCount: day.learnedWordCount,
  }));
}

export function buildEmptyStats(): UserStats {
  const timeZone = resolveBrowserTimeZone();
  const todayKey = toRoutineDateKey(new Date(), timeZone);

  return {
    todayReviewCount: 0,
    streak: 0,
    perfectCheckinDays: 0,
    stableRecallCount: 0,
    orbitDays: buildFallbackOrbitDays(timeZone),
    activityDays: buildFallbackActivityDays(timeZone),
    selectedDate: todayKey,
    selectedDayReviewWordCount: 0,
    selectedDayLearnedWordCount: 0,
    resumeCandidate: null,
    routineCard: {
      state: 'not_started',
      title: '开始今天的学习',
      subtitle: '先完成第一轮，再进入回忆与听写',
      ctaLabel: '先选择学习词库',
      ctaMode: 'start_learning',
      boundLearningGroupId: null,
      lastUsedOfficialLibraryId: null,
      lastUsedOfficialMode: null,
      lastUsedOfficialGroupCount: 0,
      selectedOfficialLibraryId: null,
      officialLibraryOptions: [],
      visibleSteps: [
        { key: 'round1', label: '初记', status: 'current' },
        { key: 'round2', label: '回忆', status: 'upcoming' },
        { key: 'round3', label: '听写', status: 'upcoming' },
        { key: 'review', label: '复习', status: 'upcoming' },
      ],
    },
  };
}

export function applyLearningPreferencesToStats(stats: UserStats, preferences: LearningPreferences): UserStats {
  if (preferences.reinforcementRound3Enabled && preferences.round2Enabled) return stats;

  return {
    ...stats,
    routineCard: {
      ...stats.routineCard,
      visibleSteps: stats.routineCard.visibleSteps.filter((step) => {
        if (step.key === 'round2') return preferences.reinforcementRound3Enabled;
        if (step.key === 'round3') return preferences.round2Enabled;
        return true;
      }),
    },
  };
}

export interface UseHomeStatsOptions {
  user: User | null;
  activeLearningGroupId: string | null;
  activeSessionSeed: PersistedLearningSession | null;
  learningPreferences: LearningPreferences;
  isHomeRoute: boolean;
  locationPathname: string;
  locationSearch: string;
  navigate: (path: string) => void;
  onCloseSessionSettings: () => void;
}

export function useHomeStats({
  user,
  activeLearningGroupId,
  activeSessionSeed,
  learningPreferences,
  isHomeRoute,
  locationPathname,
  locationSearch,
  navigate,
  onCloseSessionSettings,
}: UseHomeStatsOptions) {
  const userIdRef = useRef<string | null>(null);
  const homeStatsInFlightRef = useRef<Promise<void> | null>(null);
  const homeStatsRequestIdRef = useRef(0);
  const hasTrustedHomeStatsRef = useRef(false);
  const homeOverviewDirtyRef = useRef(false);
  const forceNextHomeRefreshRef = useRef(false);
  const pendingLearningHomeSyncsRef = useRef<Set<Promise<void>>>(new Set());
  const homeRefreshAfterSyncRef = useRef<Promise<void> | null>(null);

  const [stats, setStats] = useState<UserStats>(buildEmptyStats);
  const [hasTrustedHomeStats, setHasTrustedHomeStats] = useState(false);
  const [isHomeStatsRefreshing, setIsHomeStatsRefreshing] = useState(false);

  const activeLearningGroupIdRef = useRef<string | null>(activeLearningGroupId);
  activeLearningGroupIdRef.current = activeLearningGroupId;
  const activeSessionSeedRef = useRef<PersistedLearningSession | null>(activeSessionSeed);
  activeSessionSeedRef.current = activeSessionSeed;

  const requestedOfficialLibraryId = useMemo(() => {
    const params = new URLSearchParams(locationSearch);
    const value = params.get('officialLibraryId');
    return isOfficialLibraryId(value) ? value : null;
  }, [locationSearch]);

  const homeStats = useMemo(() => {
    const preferenceAwareStats = applyLearningPreferencesToStats(stats, learningPreferences);
    if (!isHomeRoute || !requestedOfficialLibraryId) return preferenceAwareStats;

    const existingOption = preferenceAwareStats.routineCard.officialLibraryOptions.find(
      (option) => option.libraryId === requestedOfficialLibraryId,
    );
    const definition = getOfficialLibraryDefinition(requestedOfficialLibraryId);
    const injectedOption: HomeOfficialLibraryOption = existingOption ?? {
      libraryId: requestedOfficialLibraryId,
      title: definition.title,
      mode:
        preferenceAwareStats.routineCard.lastUsedOfficialLibraryId === requestedOfficialLibraryId
          ? (preferenceAwareStats.routineCard.lastUsedOfficialMode ?? 'sequential')
          : 'sequential',
      existingGroupCount:
        preferenceAwareStats.routineCard.lastUsedOfficialLibraryId === requestedOfficialLibraryId
          ? preferenceAwareStats.routineCard.lastUsedOfficialGroupCount
          : 0,
      activeGroupId: null,
      activeRound: null,
      confirmedWordCount: 0,
      loadedWordCount: 0,
      completedMemoryWordCount: 0,
      totalWordCount: definition.words.length,
    };

    return {
      ...preferenceAwareStats,
      routineCard: {
        ...preferenceAwareStats.routineCard,
        ctaLabel:
          preferenceAwareStats.routineCard.ctaMode === 'open_library'
            ? '开始学习'
            : preferenceAwareStats.routineCard.ctaLabel,
        ctaMode:
          preferenceAwareStats.routineCard.ctaMode === 'open_library'
            ? 'start_learning'
            : preferenceAwareStats.routineCard.ctaMode,
        selectedOfficialLibraryId: requestedOfficialLibraryId,
        officialLibraryOptions: [
          injectedOption,
          ...preferenceAwareStats.routineCard.officialLibraryOptions.filter(
            (option) => option.libraryId !== requestedOfficialLibraryId,
          ),
        ],
      },
    };
  }, [isHomeRoute, learningPreferences, requestedOfficialLibraryId, stats]);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
    homeStatsRequestIdRef.current += 1;
    homeStatsInFlightRef.current = null;
    homeOverviewDirtyRef.current = false;
    forceNextHomeRefreshRef.current = false;
    pendingLearningHomeSyncsRef.current.clear();
    homeRefreshAfterSyncRef.current = null;
    hasTrustedHomeStatsRef.current = false;
    setHasTrustedHomeStats(false);
    setIsHomeStatsRefreshing(false);
  }, [user?.id]);

  const fetchStats = useCallback(
    async (options: FetchStatsOptions = {}) => {
      if (!user) {
        homeStatsInFlightRef.current = null;
        hasTrustedHomeStatsRef.current = false;
        setHasTrustedHomeStats(false);
        setStats(buildEmptyStats());
        return;
      }

      const timeZone = resolveBrowserTimeZone();
      const mustRefreshHomeOverview = options.forceRefresh || homeOverviewDirtyRef.current;
      if (mustRefreshHomeOverview) {
        invalidateCachedHomeOverview(user.id, timeZone);
      } else {
        const cached = readCachedHomeOverview(user.id, timeZone);
        const activeGroupId = activeLearningGroupIdRef.current ?? activeSessionSeedRef.current?.groupId ?? null;
        if (cached && isCachedHomeOverviewCompatibleWithActiveLearningGroup(cached.stats, activeGroupId)) {
          if (options.preferCache || !hasTrustedHomeStatsRef.current) {
            hasTrustedHomeStatsRef.current = true;
            setHasTrustedHomeStats(true);
            setStats(cached.stats);
          }
          if (options.preferCache && cached.isFresh) {
            return;
          }
        }
      }

      if (homeStatsInFlightRef.current && !mustRefreshHomeOverview) {
        return homeStatsInFlightRef.current;
      }

      const requestId = homeStatsRequestIdRef.current + 1;
      homeStatsRequestIdRef.current = requestId;
      const request = (async () => {
        setIsHomeStatsRefreshing(true);
        try {
          const overview = await queryClient.fetchQuery({
            queryKey: queryKeys.home.overview(user.id, timeZone),
            queryFn: () => fetchHomeOverview(timeZone),
            staleTime: mustRefreshHomeOverview ? 0 : 60 * 1000,
          });
          if (userIdRef.current !== user.id || homeStatsRequestIdRef.current !== requestId) {
            return;
          }
          const fallback = buildEmptyStats();
          const nextStats: UserStats = {
            ...fallback,
            ...overview,
            orbitDays: overview.orbitDays?.length ? overview.orbitDays : fallback.orbitDays,
            activityDays: overview.activityDays?.length ? overview.activityDays : fallback.activityDays,
            routineCard: overview.routineCard ?? fallback.routineCard,
          };
          writeCachedHomeOverview(user.id, timeZone, nextStats);
          homeOverviewDirtyRef.current = false;
          hasTrustedHomeStatsRef.current = true;
          setHasTrustedHomeStats(true);
          setStats(nextStats);
        } catch (error) {
          if (userIdRef.current !== user.id || homeStatsRequestIdRef.current !== requestId) {
            return;
          }
          console.error('Failed to load user statistics:', error);
          const cached = readCachedHomeOverview(user.id, timeZone);
          if (cached) {
            hasTrustedHomeStatsRef.current = true;
            setHasTrustedHomeStats(true);
            setStats(cached.stats);
            return;
          }
          if (!hasTrustedHomeStatsRef.current) {
            setStats(buildEmptyStats());
          }
        } finally {
          if (homeStatsInFlightRef.current === request) {
            setIsHomeStatsRefreshing(false);
            homeStatsInFlightRef.current = null;
          }
        }
      })();

      homeStatsInFlightRef.current = request;
      return request;
    },
    [user],
  );

  const markHomeOverviewDirty = useCallback(() => {
    homeOverviewDirtyRef.current = true;
    const userId = userIdRef.current;
    if (userId) {
      invalidateCachedHomeOverview(userId, resolveBrowserTimeZone());
    }
  }, []);

  const trackLearningHomeSync = useCallback(
    (promise: Promise<void>) => {
      markHomeOverviewDirty();
      const trackedPromise = promise.finally(() => {
        pendingLearningHomeSyncsRef.current.delete(trackedPromise);
      });
      pendingLearningHomeSyncsRef.current.add(trackedPromise);
      void trackedPromise.catch(() => {
        // Individual sync tasks log their own failures; refresh should still continue.
      });
      return trackedPromise;
    },
    [markHomeOverviewDirty],
  );

  const waitForPendingLearningHomeSync = useCallback(async () => {
    while (pendingLearningHomeSyncsRef.current.size > 0) {
      await Promise.allSettled([...pendingLearningHomeSyncsRef.current]);
    }
  }, []);

  const refreshHomeStatsAfterLearningSync = useCallback(() => {
    if (homeRefreshAfterSyncRef.current) {
      return homeRefreshAfterSyncRef.current;
    }

    const refreshPromise = (async () => {
      await waitForPendingLearningHomeSync();
      await fetchStats({ forceRefresh: true });
    })();
    const trackedRefresh = refreshPromise.finally(() => {
      if (homeRefreshAfterSyncRef.current === trackedRefresh) {
        homeRefreshAfterSyncRef.current = null;
      }
    });
    homeRefreshAfterSyncRef.current = trackedRefresh;
    return trackedRefresh;
  }, [fetchStats, waitForPendingLearningHomeSync]);

  const navigateWithFreshHomeStats = useCallback(
    (targetPath = '/app/home') => {
      onCloseSessionSettings();
      if (targetPath.startsWith('/app/home')) {
        forceNextHomeRefreshRef.current = true;
      }
      navigate(targetPath);
      if (targetPath.startsWith('/app/home')) {
        void refreshHomeStatsAfterLearningSync();
      }
    },
    [navigate, onCloseSessionSettings, refreshHomeStatsAfterLearningSync],
  );

  const handleSelectOrbitDate = useCallback((date: string) => {
    setStats((current) => {
      const selectedDay = current.orbitDays.find((day) => day.date === date);
      if (!selectedDay) {
        return current;
      }

      return {
        ...current,
        selectedDate: selectedDay.date,
        selectedDayReviewWordCount: selectedDay.reviewWordCount,
        selectedDayLearnedWordCount: selectedDay.learnedWordCount,
      };
    });
  }, []);

  useEffect(() => {
    void fetchStats({ preferCache: true });
  }, [fetchStats]);

  useEffect(() => {
    if (!user || !isHomeRoute) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(9, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      timer = setTimeout(() => {
        void fetchStats({ forceRefresh: true });
        schedule();
      }, next.getTime() - now.getTime());
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      void fetchStats({ forceRefresh: true });
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchStats, isHomeRoute, user]);

  useEffect(() => {
    if (locationPathname.startsWith('/app/home')) {
      const shouldForceRefresh =
        forceNextHomeRefreshRef.current || homeOverviewDirtyRef.current || pendingLearningHomeSyncsRef.current.size > 0;
      forceNextHomeRefreshRef.current = false;
      if (shouldForceRefresh) {
        void refreshHomeStatsAfterLearningSync();
        return;
      }
      void fetchStats({ preferCache: true });
    }
  }, [fetchStats, locationPathname, refreshHomeStatsAfterLearningSync]);

  const getHasPendingHomeSync = useCallback(() => pendingLearningHomeSyncsRef.current.size > 0, []);
  const getIsHomeOverviewDirty = useCallback(() => homeOverviewDirtyRef.current, []);

  return {
    stats,
    setStats,
    homeStats,
    hasTrustedHomeStats,
    isHomeStatsRefreshing,
    requestedOfficialLibraryId,
    fetchStats,
    markHomeOverviewDirty,
    trackLearningHomeSync,
    navigateWithFreshHomeStats,
    handleSelectOrbitDate,
    getHasPendingHomeSync,
    getIsHomeOverviewDirty,
  };
}

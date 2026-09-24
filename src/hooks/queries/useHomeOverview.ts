import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { fetchHomeOverview, resolveBrowserTimeZone } from '../../lib/homeApi';
import type { UserStats } from '../../types';

export interface UseHomeOverviewOptions {
  timeZone?: string;
  enabled?: boolean;
  initialData?: UserStats;
}

export function useHomeOverviewQuery(userId?: string, options: UseHomeOverviewOptions = {}) {
  const timeZone = options.timeZone || resolveBrowserTimeZone();

  return useQuery({
    queryKey: queryKeys.home.overview(userId || '', timeZone),
    queryFn: () => fetchHomeOverview(timeZone),
    enabled: Boolean(userId) && (options.enabled ?? true),
    initialData: options.initialData,
    staleTime: 60 * 1000,
  });
}

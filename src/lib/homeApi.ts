import type { ActivityDay, UserStats } from '../types';
import { apiFetch } from './api';

export function resolveBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export async function fetchHomeOverview(timeZone = resolveBrowserTimeZone()): Promise<UserStats> {
  const search = new URLSearchParams({ timezone: timeZone });
  const response = await apiFetch(`/api/home/overview?${search.toString()}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  return payload.data as UserStats;
}

export async function fetchUserActivityHeatmap(timeZone = resolveBrowserTimeZone()): Promise<ActivityDay[]> {
  const search = new URLSearchParams({ timezone: timeZone });
  const response = await apiFetch(`/api/user/activity-heatmap?${search.toString()}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  return payload.data as ActivityDay[];
}

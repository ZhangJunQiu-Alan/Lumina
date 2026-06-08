export function shouldForceHomeRefreshForNavigation(
  currentPath: string,
  targetPath: string,
  hasDirtyHomeOverview: boolean,
) {
  if (!targetPath.startsWith('/app/home')) return false;
  return hasDirtyHomeOverview || currentPath.startsWith('/app/session');
}

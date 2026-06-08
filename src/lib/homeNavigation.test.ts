import { describe, expect, it } from 'vitest';
import { shouldForceHomeRefreshForNavigation } from './homeNavigation';

describe('home navigation refresh policy', () => {
  it('forces a home refresh when leaving the learning session for home', () => {
    expect(shouldForceHomeRefreshForNavigation('/app/session', '/app/home', false)).toBe(true);
  });

  it('forces a home refresh when cached home overview is dirty', () => {
    expect(shouldForceHomeRefreshForNavigation('/app/library', '/app/home', true)).toBe(true);
  });

  it('keeps ordinary non-home navigation cache-neutral', () => {
    expect(shouldForceHomeRefreshForNavigation('/app/session', '/app/library', true)).toBe(false);
  });
});

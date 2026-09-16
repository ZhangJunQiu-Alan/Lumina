import { describe, expect, it } from 'vitest';
import { getLibraryGroupProgress } from './libraryGroupProgress';

describe('personal group round progress', () => {
  const base = {
    round: 'round2' as const,
    wordCount: 3,
    queue: ['a', 'b', 'c', 'a'],
    passedIndices: [1, 2, 3],
    confirmedIds: [],
  };
  it('counts distinct words rather than repeated retry queue entries', () => {
    expect(getLibraryGroupProgress(base)).toEqual({ completed: 3, total: 3 });
    expect(getLibraryGroupProgress({ ...base, passedIndices: [1, 2] })).toEqual({ completed: 2, total: 3 });
    expect(getLibraryGroupProgress({ ...base, passedIndices: [0, 0, 3, -1, 9, '2'] })).toEqual({
      completed: 1,
      total: 3,
    });
  });
  it('uses confirmed words for the first round and excludes stale ids', () => {
    expect(getLibraryGroupProgress({ ...base, round: 'round1', confirmedIds: ['a', 'a', 'b', 'gone'] })).toEqual({
      completed: 2,
      total: 3,
    });
  });
  it('handles new groups and unavailable historical progress without guessing', () => {
    expect(getLibraryGroupProgress({ ...base, round: null, queue: null })).toEqual({ completed: 0, total: 3 });
    expect(getLibraryGroupProgress({ ...base, queue: null })).toBeNull();
    expect(getLibraryGroupProgress({ ...base, round: 'article' })).toBeNull();
  });
});

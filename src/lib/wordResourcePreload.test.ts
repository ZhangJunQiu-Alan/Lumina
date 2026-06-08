import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWordAudioUrl, primeWordAudioUrl } from './wordAudio';
import { lookupWord } from './wordLookup';
import { preloadClickableWordLookups, preloadClickableWordResources } from './wordResourcePreload';

vi.mock('./wordAudio', () => ({
  fetchWordAudioUrl: vi.fn(() => Promise.resolve('/audio/direct.mp3')),
  primeWordAudioUrl: vi.fn(),
}));

vi.mock('./wordLookup', () => ({
  lookupWord: vi.fn(() =>
    Promise.resolve({
      vocabulary_item: {
        word: 'oxygen',
        audio_uk_url: '/audio/uk.mp3',
        audio_us_url: '/audio/us.mp3',
      },
    }),
  ),
}));

const mockedFetchWordAudioUrl = vi.mocked(fetchWordAudioUrl);
const mockedPrimeWordAudioUrl = vi.mocked(primeWordAudioUrl);
const mockedLookupWord = vi.mocked(lookupWord);

describe('wordResourcePreload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preloads lookup-only words without fetching direct audio', async () => {
    await preloadClickableWordLookups(['oxygen'], 'uk');

    expect(mockedLookupWord).toHaveBeenCalledWith('oxygen');
    expect(mockedPrimeWordAudioUrl).toHaveBeenCalledWith('oxygen', 'uk', '/audio/uk.mp3');
    expect(mockedFetchWordAudioUrl).not.toHaveBeenCalled();
  });

  it('preloads full resources with direct audio for high-value words', async () => {
    await preloadClickableWordResources(['oxygen'], 'uk');

    expect(mockedLookupWord).toHaveBeenCalledWith('oxygen');
    expect(mockedFetchWordAudioUrl).toHaveBeenCalledWith('oxygen', 'uk');
    expect(mockedPrimeWordAudioUrl).toHaveBeenCalledWith('oxygen', 'uk', '/audio/uk.mp3');
  });
});

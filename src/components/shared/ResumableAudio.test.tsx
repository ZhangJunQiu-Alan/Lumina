import { fireEvent, render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ResumableAudio } from './ResumableAudio';

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
it('saves on interruption and restores the position without autoplay', () => {
  const first = render(<ResumableAudio src="https://example.com/audio.mp3" storageKey="alice.paper.section" />);
  const media = first.container.querySelector('audio')!;
  media.currentTime = 42;
  window.dispatchEvent(new Event('lumina:pause'));
  expect(JSON.parse(localStorage.getItem('alice.paper.section')!).seconds).toBe(42);
  expect(media.pause).toHaveBeenCalled();
  first.unmount();
  const second = render(<ResumableAudio src="https://example.com/audio.mp3" storageKey="alice.paper.section" />);
  const restored = second.container.querySelector('audio')!;
  Object.defineProperty(restored, 'duration', { value: 100 });
  fireEvent.loadedMetadata(restored);
  expect(restored.currentTime).toBe(42);
  expect(restored.autoplay).toBe(false);
  second.unmount();
});

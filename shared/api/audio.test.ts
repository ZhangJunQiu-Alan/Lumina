import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ generate: vi.fn(), quota: vi.fn() }));
vi.mock('../server/supabase.ts', () => ({ supabaseAdmin: {} }));
vi.mock('./middleware/auth.ts', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    c.set('userId', 'audio-test-user');
    await next();
  },
}));
vi.mock('./middleware/rateLimit.ts', () => ({
  requireAiContentFeatures: async (_c: any, next: () => Promise<void>) => next(),
  requireExpensiveQuota: () => async (_c: any, next: () => Promise<void>) => {
    state.quota();
    await next();
  },
}));
vi.mock('../server/exampleAudio.ts', () => ({
  getOrCreateExampleAudio: state.generate,
  ExampleAudioValidationError: class extends Error {},
}));

import { app } from './app.ts';

beforeEach(() => {
  vi.clearAllMocks();
  state.generate.mockResolvedValue('https://audio.example/sentence.mp3');
});

for (const path of ['/api/example-audio', '/api/audio/example-audio']) {
  describe(path, () => {
    it('validates and passes sentence text and locale to the audio service', async () => {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '  This is a sentence.  ', locale: 'uk' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: 'https://audio.example/sentence.mp3' });
      expect(state.generate).toHaveBeenCalledWith('This is a sentence.', 'uk');
      expect(state.quota).toHaveBeenCalledOnce();
    });

    it.each([{}, { text: 'A sentence.', locale: 'invalid' }])('rejects invalid input with 400', async (body) => {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(state.generate).not.toHaveBeenCalled();
    });
  });
}

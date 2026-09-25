import { describe, expect, it } from 'vitest';
import {
  captureServerException,
  captureServerMessage,
  parseSentryDsn,
} from './telemetry.ts';

describe('Task 3.1: Server-Side Telemetry & Sentry Integration', () => {
  describe('DSN Parser', () => {
    it('parses valid Sentry DSN URLs correctly', () => {
      const dsn = 'https://abc123publicKey@o456789.ingest.sentry.io/9876543';
      const parsed = parseSentryDsn(dsn);

      expect(parsed).not.toBeNull();
      expect(parsed?.publicKey).toBe('abc123publicKey');
      expect(parsed?.host).toBe('o456789.ingest.sentry.io');
      expect(parsed?.projectId).toBe('9876543');
      expect(parsed?.endpointUrl).toBe('https://o456789.ingest.sentry.io/api/9876543/store/');
    });

    it('returns null for empty, missing, or malformed DSNs', () => {
      expect(parseSentryDsn('')).toBeNull();
      expect(parseSentryDsn(undefined)).toBeNull();
      expect(parseSentryDsn('not-a-valid-url')).toBeNull();
      expect(parseSentryDsn('https://missing-public-key.com')).toBeNull();
    });
  });

  describe('Server Telemetry Ingestion Guard', () => {
    it('executes safely as no-op when SENTRY_DSN is unset without throwing', async () => {
      const error = new Error('Database connection timeout');
      await expect(
        captureServerException(error, {
          endpoint: '/api/review/attempt',
          method: 'POST',
          requestId: 'req-abc',
          userId: 'user-xyz',
        }),
      ).resolves.toBeUndefined();
    });

    it('handles captureServerMessage safely when unconfigured', async () => {
      await expect(
        captureServerMessage('High memory usage detected', 'warning', {
          tags: { cluster: 'node-worker-1' },
        }),
      ).resolves.toBeUndefined();
    });
  });
});

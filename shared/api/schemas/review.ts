import { z } from 'zod';
import { idSchema, optionalIdSchema, timeZoneSchema } from './common.ts';

export const ReviewAttemptSchema = z.object({
  vocabularyItemId: idSchema,
  learningGroupId: optionalIdSchema,
  source: z.enum(['round2', 'round3', 'review']),
  wasCorrect: z.boolean(),
  elapsedMs: z.coerce.number().min(0).default(0),
  timestamp: z.coerce.number().optional(),
});

export const BatchReviewAttemptSchema = z.object({
  attempts: z.array(ReviewAttemptSchema).min(0),
});

export const MarkUnknownSchema = z.object({
  vocabularyItemId: idSchema,
  learningGroupId: optionalIdSchema,
  timestamp: z.coerce.number().optional(),
});

export const MarkMasteredSchema = z.object({
  vocabularyItemId: idSchema,
  learningGroupId: optionalIdSchema,
});

export const ReviewSessionStartSchema = z.object({
  timeZone: timeZoneSchema,
});

export const ReviewSessionCompleteSchema = z.object({
  timeZone: timeZoneSchema,
});

export type ReviewAttemptInput = z.infer<typeof ReviewAttemptSchema>;
export type BatchReviewAttemptInput = z.infer<typeof BatchReviewAttemptSchema>;
export type MarkUnknownInput = z.infer<typeof MarkUnknownSchema>;
export type MarkMasteredInput = z.infer<typeof MarkMasteredSchema>;

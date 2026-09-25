import { z } from 'zod';
import { idSchema } from './common.ts';

export const IeltsReadingAttemptSchema = z
  .object({
    testId: idSchema,
    passageIndex: z.coerce.number().int().min(0).optional(),
    elapsedMs: z.coerce.number().int().min(0).default(0),
    responses: z.array(z.record(z.string(), z.any())).default([]),
  })
  .passthrough();

export const IeltsListeningAttemptSchema = z
  .object({
    testId: idSchema,
    sectionIndex: z.coerce.number().int().min(0).optional(),
    elapsedMs: z.coerce.number().int().min(0).default(0),
    responses: z.array(z.record(z.string(), z.any())).default([]),
  })
  .passthrough();

export type IeltsReadingAttemptInput = z.infer<typeof IeltsReadingAttemptSchema>;
export type IeltsListeningAttemptInput = z.infer<typeof IeltsListeningAttemptSchema>;

import { z } from 'zod';
import { idSchema, timeZoneSchema } from './common.ts';

export const CoreLearningRoundSchema = z.enum(['round1', 'round2', 'round3']);

export const OfficialStartSchema = z.object({
  mode: z.enum(['sequential', 'shuffle'], { message: 'Unknown study mode' }),
  timeZone: timeZoneSchema,
});

export const SaveLearningSessionSchema = z.object({
  round: CoreLearningRoundSchema,
  currentIndex: z.coerce.number().int().min(0).default(0),
  queueWordIds: z.array(idSchema).default([]),
  passedQueueIndices: z.array(z.coerce.number().int().min(0)).default([]),
  round1ConfirmedWordIds: z.array(idSchema).default([]),
  timeZone: timeZoneSchema,
});

export const CompleteLearningRoundSchema = z.object({
  round: CoreLearningRoundSchema,
  confirmedWordIds: z.array(idSchema).default([]),
  timeZone: timeZoneSchema,
});

export type OfficialStartInput = z.infer<typeof OfficialStartSchema>;
export type SaveLearningSessionInput = z.infer<typeof SaveLearningSessionSchema>;
export type CompleteLearningRoundInput = z.infer<typeof CompleteLearningRoundSchema>;

import { z } from 'zod';

export const LearningPreferencesPatchSchema = z
  .object({
    soundEffectsEnabled: z.boolean().optional(),
    pronunciationSpeed: z.enum(['slow', 'normal', 'fast']).optional(),
    dailyNewWordTarget: z.number().int().min(5).max(100).optional(),
    dailyReviewTarget: z.number().int().min(5).max(200).optional(),
    targetDailyMinutes: z.number().int().min(5).max(180).optional(),
    targetDaysPerWeek: z.number().int().min(1).max(7).optional(),
    articleAccent: z.enum(['uk', 'us']).optional(),
    primaryOfficialLibraryId: z.string().nullable().optional(),
  })
  .passthrough();

export type LearningPreferencesPatchInput = z.infer<typeof LearningPreferencesPatchSchema>;

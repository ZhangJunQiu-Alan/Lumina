import { z } from 'zod';
import { idSchema, timeZoneSchema } from './common.ts';

export const SaveWordSchema = z.object({
  vocabularyItemId: idSchema,
  source: z.enum(['reading_popup', 'manual']).default('reading_popup'),
});

export const CreateGroupFromSavedWordsSchema = z.object({
  vocabularyItemIds: z.array(idSchema).min(1, 'Invalid vocabulary item IDs'),
});

export const DiscardActiveOfficialGroupSchema = z.object({
  groupId: idSchema,
  timeZone: timeZoneSchema,
});

export const ReorderActiveOfficialGroupSchema = z.object({
  groupId: idSchema,
  mode: z.enum(['sequential', 'shuffle'], { message: 'Unknown study mode' }),
});

export type SaveWordInput = z.infer<typeof SaveWordSchema>;
export type CreateGroupFromSavedWordsInput = z.infer<typeof CreateGroupFromSavedWordsSchema>;
export type DiscardActiveOfficialGroupInput = z.infer<typeof DiscardActiveOfficialGroupSchema>;
export type ReorderActiveOfficialGroupInput = z.infer<typeof ReorderActiveOfficialGroupSchema>;

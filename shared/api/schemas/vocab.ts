import { z } from 'zod';
import { idSchema, optionalIdSchema } from './common.ts';

export const VocabEnrichSchema = z.object({
  words: z.array(z.string().trim().min(1, 'Word cannot be empty')).min(1, 'Missing words array'),
  source: z.string().trim().optional(),
});

export const VocabLiteEnrichSchema = z.object({
  word: z.string().trim().min(1, 'Missing word'),
  source: z.string().trim().optional(),
});

export const VocabLemmatizeSchema = z.object({
  word: z.string().trim().min(1, 'Missing word'),
  source: z.string().trim().optional(),
});

export const VocabLemmatizeBatchSchema = z.object({
  words: z.array(z.string().trim().min(1, 'Word cannot be empty')).min(1, 'Missing words array'),
  source: z.string().trim().optional(),
});

export const VocabLookupSchema = z.object({
  word: z.string().trim().min(1, 'Missing word'),
});

export const VocabularyIssueTypeSchema = z.enum(['definition', 'example', 'pronunciation', 'other']);

export const VocabReportSchema = z.object({
  vocabularyItemId: idSchema,
  wordSnapshot: z.string().nullable().optional(),
  learningGroupId: optionalIdSchema,
  sessionRound: z.string().nullable().optional(),
  issueType: VocabularyIssueTypeSchema.default('other'),
  note: z.string().nullable().optional(),
  routePath: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
});

export const VocabFullEnrichSchema = z.object({
  word: z.string().trim().min(1, 'Missing word'),
});

export const VocabPersistSchema = z.object({
  entries: z.array(z.record(z.string(), z.any())).min(1, 'Missing entries array'),
  sourceType: z.enum(['system', 'custom']).optional(),
});

export const VocabArticleSchema = z.object({
  words: z.array(z.string().trim().min(1, 'Word cannot be empty')).min(1, 'Missing words array'),
});

export type VocabEnrichInput = z.infer<typeof VocabEnrichSchema>;
export type VocabLiteEnrichInput = z.infer<typeof VocabLiteEnrichSchema>;
export type VocabLemmatizeInput = z.infer<typeof VocabLemmatizeSchema>;
export type VocabLemmatizeBatchInput = z.infer<typeof VocabLemmatizeBatchSchema>;
export type VocabLookupInput = z.infer<typeof VocabLookupSchema>;
export type VocabReportInput = z.infer<typeof VocabReportSchema>;
export type VocabFullEnrichInput = z.infer<typeof VocabFullEnrichSchema>;
export type VocabPersistInput = z.infer<typeof VocabPersistSchema>;
export type VocabArticleInput = z.infer<typeof VocabArticleSchema>;

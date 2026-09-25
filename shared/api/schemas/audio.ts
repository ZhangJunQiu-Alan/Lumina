import { z } from 'zod';

export const AudioBatchSchema = z.object({
  words: z.array(z.string().trim().min(1, 'Word cannot be empty')).min(1, 'Missing words array'),
});

export const ExampleAudioSchema = z.object({
  text: z.string().trim().min(1, 'Missing example text'),
  locale: z.enum(['uk', 'us'], { message: 'Invalid locale' }),
});

export type AudioBatchInput = z.infer<typeof AudioBatchSchema>;
export type ExampleAudioInput = z.infer<typeof ExampleAudioSchema>;

import { z } from 'zod';

export const idSchema = z.string().trim().min(1, 'ID cannot be empty');

export const optionalIdSchema = z.string().trim().min(1).nullable().optional();

export const timeZoneSchema = z.string().trim().nullable().optional();

export const nonEmptyString = (fieldName = 'Field') =>
  z.string().trim().min(1, `${fieldName} cannot be empty`);

import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';
import { logger } from '../../server/logger.ts';

export interface ApiValidationErrorIssue {
  path: string;
  message: string;
  code: string;
}

export interface ApiValidationErrorResponse {
  error: string;
  code: 'VALIDATION_ERROR';
  details: ApiValidationErrorIssue[];
  request_id?: string;
}

/**
 * Standardized Hono Zod validator middleware that enforces Lumina's API error contract
 * and logs validation failures with request correlation IDs.
 */
export function validate<Target extends keyof ValidationTargets, T extends z.ZodType<any, any, any>>(
  target: Target,
  schema: T,
  defaultErrorMessage?: string,
) {
  return zValidator(target, schema, (result, c: any) => {
    if (!result.success) {
      const errorObj = 'error' in result ? (result as any).error : undefined;
      const issues = errorObj?.issues ?? [];
      const firstIssue = issues[0];
      const errorMessage = defaultErrorMessage || firstIssue?.message || 'Invalid request parameters';

      logger.warn(`API Validation Error [${c.req.method} ${c.req.path}]: ${errorMessage}`, {
        endpoint: c.req.path,
        method: c.req.method,
        issues,
        request_id: c.get('requestId'),
      });

      return c.json(
        {
          error: errorMessage,
          code: 'VALIDATION_ERROR',
          details: issues.map((issue: any) => ({
            path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? ''),
            message: issue.message,
            code: issue.code,
          })),
          request_id: c.get('requestId'),
        },
        400,
      );
    }
  });
}

export const validateJson = <T extends z.ZodType<any, any, any>>(schema: T, defaultErrorMessage?: string) =>
  validate('json', schema, defaultErrorMessage);

export const validateQuery = <T extends z.ZodType<any, any, any>>(schema: T, defaultErrorMessage?: string) =>
  validate('query', schema, defaultErrorMessage);

export const validateParam = <T extends z.ZodType<any, any, any>>(schema: T, defaultErrorMessage?: string) =>
  validate('param', schema, defaultErrorMessage);

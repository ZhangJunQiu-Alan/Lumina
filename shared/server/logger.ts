/**
 * 工业级极简日志系统
 * 基于原生 Console 封装，支持多级日志、结构化 JSON 输出和异常自动格式化。
 * 旨在作为 Winston/Pino 的零依赖替代方案，同时保持 API 兼容。
 *
 * Note: when NODE_ENV is unset we default to production (JSON) output so the
 * Edge runtime emits structured logs without extra config; set
 * NODE_ENV=development locally for the pretty console format.
 */
import { getEnv } from '../runtime.ts';
import { captureServerException } from './telemetry.ts';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  [key: string]: any;
}

class Logger {
  private level: LogLevel = (getEnv('LOG_LEVEL') as LogLevel) || 'info';

  private shouldLog(targetLevel: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(targetLevel) >= levels.indexOf(this.level);
  }

  private format(level: LogLevel, message: string, context?: LogContext) {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...context,
    };

    // 生产环境输出 JSON，方便 ELK/Winston 等系统收集
    if ((getEnv('NODE_ENV') ?? 'production') === 'production') {
      return JSON.stringify(entry);
    }

    // 开发环境美化输出
    const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '\x1b[36m';
    const reset = '\x1b[0m';
    return `[${timestamp}] ${color}${level.toUpperCase()}${reset}: ${message} ${context ? JSON.stringify(context) : ''}`;
  }

  info(message: string, context?: LogContext) {
    if (this.shouldLog('info')) console.log(this.format('info', message, context));
  }

  warn(message: string, context?: LogContext) {
    if (this.shouldLog('warn')) console.warn(this.format('warn', message, context));
  }

  error(message: string, error?: unknown, context?: LogContext) {
    if (this.shouldLog('error')) {
      const errorDetail =
        error instanceof Error
          ? {
              error_name: error.name,
              error_message: error.message,
              stack: error.stack,
            }
          : { error };

      console.error(this.format('error', message, { ...errorDetail, ...context }));

      if (error) {
        void captureServerException(error, { message, ...context });
      }
    }
  }

  debug(message: string, context?: LogContext) {
    if (this.shouldLog('debug')) console.debug(this.format('debug', message, context));
  }
}

export const logger = new Logger();

export type AppErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'storage'
  | 'unknown';

/** Errors with messages safe to show to the person using the app. */
export class AppError extends Error {
  code: AppErrorCode;
  fields?: Record<string, string>;
  constructor(code: AppErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}

export function userMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof DOMException && err.name === 'QuotaExceededError') {
    return 'This browser is out of storage space. Remove unused images and try again.';
  }
  return fallback;
}

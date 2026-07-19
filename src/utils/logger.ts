const isDev = process.env.NODE_ENV === 'development';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  if (level === 'debug' && !isDev) return;

  const prefix = `[MB:${level.toUpperCase()}]`;
  switch (level) {
    case 'debug': console.debug(prefix, message, ...args); break;
    case 'info':  console.info(prefix, message, ...args);  break;
    case 'warn':  console.warn(prefix, message, ...args);  break;
    case 'error': console.error(prefix, message, ...args); break;
  }
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log('debug', msg, ...args),
  info:  (msg: string, ...args: unknown[]) => log('info',  msg, ...args),
  warn:  (msg: string, ...args: unknown[]) => log('warn',  msg, ...args),
  error: (msg: string, ...args: unknown[]) => log('error', msg, ...args),
} as const;

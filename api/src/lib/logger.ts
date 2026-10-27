type Level = 'debug' | 'info' | 'warn' | 'error';

const WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured JSON logs, per docs/INFRASTRUCTURE.md. Keep tokens, OTPs, card
 * data and unnecessary PII out of the `fields` passed in here.
 */
export type Logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
};

export function createLogger(level: Level = 'info', bindings: Record<string, unknown> = {}): Logger {
  const threshold = WEIGHT[level];

  const emit = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (WEIGHT[lvl] < threshold) return;
    const line = JSON.stringify({
      level: lvl,
      time: new Date().toISOString(),
      msg,
      ...bindings,
      ...fields,
    });
    if (lvl === 'error' || lvl === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
  };
}

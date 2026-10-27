/**
 * One place to report unexpected errors. It logs to the console by default; a real reporter (Sentry, in phase 7)
 * plugs in with `setErrorReporter` without touching any caller.
 */
export type ErrorContext = { source: string; [key: string]: unknown };
type Reporter = (error: unknown, context: ErrorContext) => void;

let reporter: Reporter = (error, context) => {
  console.error(`[${context.source}]`, error, context);
};

export function setErrorReporter(next: Reporter): void {
  reporter = next;
}

export function reportError(error: unknown, context: ErrorContext): void {
  try {
    reporter(error, context);
  } catch {
    // Reporting must never be the thing that breaks the page.
  }
}

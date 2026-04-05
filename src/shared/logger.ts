export class Logger {
  constructor(private readonly enabled: boolean) {}

  debug(...args: unknown[]): void {
    if (!this.enabled) {
      return;
    }

    console.debug('[ECV]', ...args);
  }

  warn(...args: unknown[]): void {
    console.warn('[ECV]', ...args);
  }
}

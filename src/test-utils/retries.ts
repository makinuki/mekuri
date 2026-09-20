// Retry scheduler double for the engine image pipeline. The engine takes its
// retry scheduler as an option, so tests inject this double: scheduled
// callbacks are captured and run by hand, and no test waits on a real timer.

export interface MockScheduledRetry {
  /** Delay the engine asked for, in milliseconds. */
  readonly delayMs: number;
  /** True once the entry ran or its canceller was called. */
  readonly cancelled: boolean;
  /** Runs the callback and consumes the entry. Consumed and cancelled entries
   * are skipped, mirroring a timer that already fired or was cleared. */
  run(): void;
}

export interface MockRetryScheduler {
  /** Every entry ever scheduled, in schedule order, consumed ones included. */
  readonly scheduled: MockScheduledRetry[];
  /** Scheduler to pass to the engine as its scheduleRetry option. */
  schedule(callback: () => void, delayMs: number): () => void;
  /** Entries neither run nor cancelled, in schedule order. */
  pending(): MockScheduledRetry[];
  /** First pending entry. Throws when nothing is pending. */
  next(): MockScheduledRetry;
  /** Runs every entry pending at call time, in schedule order. A run that
   * schedules a further retry leaves it pending for the next call. */
  runAll(): void;
}

export function mockRetryScheduler(): MockRetryScheduler {
  const scheduled: MockScheduledRetry[] = [];

  function schedule(callback: () => void, delayMs: number): () => void {
    let cancelled = false;
    const entry: MockScheduledRetry = {
      delayMs,
      get cancelled() {
        return cancelled;
      },
      run() {
        if (cancelled) return;
        cancelled = true;
        callback();
      },
    };
    scheduled.push(entry);
    return () => {
      cancelled = true;
    };
  }

  const pending = (): MockScheduledRetry[] => scheduled.filter((entry) => !entry.cancelled);

  return {
    scheduled,
    schedule,
    pending,
    next: () => {
      const entry = pending()[0];
      if (entry === undefined) throw new Error("mockRetryScheduler: no retry is pending");
      return entry;
    },
    runAll: () => {
      for (const entry of pending()) entry.run();
    },
  };
}

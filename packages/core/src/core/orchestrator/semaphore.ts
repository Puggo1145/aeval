/**
 * Counting semaphore used to share one trial-concurrency budget across
 * orchestrators running in parallel (multiple runs of a task).
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`Semaphore capacity must be a positive integer, got: ${capacity}`);
    }
    this.available = capacity;
  }

  /** Wait for a permit. The returned function releases it (idempotent). */
  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
    } else {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      const waiter = this.waiters.shift();
      if (waiter) {
        waiter();
      } else {
        this.available += 1;
      }
    };
  }
}

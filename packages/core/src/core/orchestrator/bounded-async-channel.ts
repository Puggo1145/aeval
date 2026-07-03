interface PendingProducer<T> {
  item: T;
  resolve: (accepted: boolean) => void;
}

/**
 * A small bounded async channel:
 * - `push` applies backpressure by waiting while the queue is full
 * - `close` rejects further pushes and ends iteration once the queue drains
 */
export class BoundedAsyncChannel<T> implements AsyncIterable<T> {
  private readonly queue: T[] = [];
  private readonly pendingProducers: PendingProducer<T>[] = [];
  private readonly pendingConsumers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`BoundedAsyncChannel capacity must be a positive integer, got: ${capacity}`);
    }
  }

  /**
   * Enqueue one item: deliver directly to a waiting consumer, buffer when there
   * is room, otherwise wait until space frees up or the channel closes.
   * Returns whether the channel accepted the item (false after close).
   */
  async push(item: T): Promise<boolean> {
    if (this.closed) {
      return false;
    }

    const pendingConsumer = this.pendingConsumers.shift();
    if (pendingConsumer) {
      pendingConsumer({ done: false, value: item });
      return true;
    }

    if (this.queue.length < this.capacity) {
      this.queue.push(item);
      return true;
    }

    return new Promise<boolean>((resolve) => {
      this.pendingProducers.push({ item, resolve });
    });
  }

  /**
   * Close the channel: reject subsequent pushes, wake all waiting producers
   * with `false`, and finish waiting consumers once no buffered data remains.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;

    while (this.pendingProducers.length > 0) {
      this.pendingProducers.shift()?.resolve(false);
    }

    if (this.queue.length === 0) {
      while (this.pendingConsumers.length > 0) {
        this.pendingConsumers.shift()?.({ done: true, value: undefined as T });
      }
    }
  }

  /**
   * Read the next item: prefer the buffer, then any waiting producer, then
   * report done when closed, otherwise wait for a new item or close.
   */
  async next(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) {
      const item = this.queue.shift() as T;
      this.refillFromPendingProducers();
      return { done: false, value: item };
    }

    const pendingProducer = this.pendingProducers.shift();
    if (pendingProducer) {
      pendingProducer.resolve(true);
      return { done: false, value: pendingProducer.item };
    }

    if (this.closed) {
      return { done: true, value: undefined as T };
    }

    return new Promise<IteratorResult<T>>((resolve) => {
      this.pendingConsumers.push(resolve);
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    };
  }

  /**
   * After a consumer takes an item, promote one waiting producer: hand its item
   * to a waiting consumer if any, otherwise move it into the buffer.
   */
  private refillFromPendingProducers(): void {
    if (this.closed || this.pendingProducers.length === 0) {
      return;
    }

    const pendingProducer = this.pendingProducers.shift();
    if (!pendingProducer) {
      return;
    }

    const pendingConsumer = this.pendingConsumers.shift();
    if (pendingConsumer) {
      pendingProducer.resolve(true);
      pendingConsumer({ done: false, value: pendingProducer.item });
      return;
    }

    this.queue.push(pendingProducer.item);
    pendingProducer.resolve(true);
  }
}

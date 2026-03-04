interface PendingProducer<T> {
  item: T;
  resolve: (accepted: boolean) => void;
}

/**
 * 一个轻量有界异步通道：
 * - push 在队列满时会等待（背压）
 * - close 后不再接收新元素，并在队列清空后结束迭代
 */
export class BoundedAsyncChannel<T> implements AsyncIterable<T> {
  private readonly queue: T[] = [];
  private readonly pendingProducers: PendingProducer<T>[] = [];
  private readonly pendingConsumers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  /**
   * capacity 表示最多可缓冲的元素数；达到上限后 push 进入等待。
   */
  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`BoundedAsyncChannel capacity must be a positive integer, got: ${capacity}`);
    }
  }

  /**
   * 写入一个元素：
   * - 若已有等待中的 consumer，直接交付并立即返回；
   * - 若队列未满，进入缓冲区；
   * - 若队列已满，等待直到有空间或通道被 close。
   *
   * 返回值表示该元素是否被通道接收（close 后返回 false）。
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
   * 关闭通道：
   * - 后续 push 一律拒绝；
   * - 唤醒所有等待中的 producer（返回 false）；
   * - 若当前无缓存数据，立即结束所有等待中的 consumer。
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
   * 读取下一个元素：
   * - 优先消费缓冲队列；
   * - 若无缓冲且存在等待中的 producer，直接接收该元素；
   * - 若已 close 且无数据，返回 done=true；
   * - 否则挂起等待新的元素或 close。
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

  /**
   * 暴露 AsyncIterable 接口，支持 for await...of 消费。
   */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    };
  }

  /**
   * 在 consumer 消费后尝试补位：
   * - 优先把等待中的 producer 元素交给等待中的 consumer；
   * - 否则补回内部队列，解除一个 producer 的背压。
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

/**
 * 工厂函数：创建一个有界异步通道。
 */
export function createBoundedAsyncChannel<T>(capacity: number): BoundedAsyncChannel<T> {
  return new BoundedAsyncChannel<T>(capacity);
}

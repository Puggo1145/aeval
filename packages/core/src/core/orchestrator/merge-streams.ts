import { BoundedAsyncChannel } from './bounded-async-channel.js';

const MERGE_CHANNEL_CAPACITY = 32;

export interface MergeAsyncIterablesOptions {
  /** Max sources consumed concurrently. Defaults to all sources at once. */
  concurrency?: number;
}

/**
 * Interleave items from multiple lazy async sources into one stream.
 *
 * Up to `concurrency` sources are open at a time; remaining sources start as
 * earlier ones finish. If a source throws, the merge stops opening new
 * sources, closes in-flight ones (their iterators are returned so they can
 * clean up), and rethrows the first error after draining. Abandoning the
 * merged stream likewise returns every in-flight source iterator.
 */
export async function* mergeAsyncIterables<T>(
  sources: ReadonlyArray<() => AsyncIterable<T>>,
  options: MergeAsyncIterablesOptions = {},
): AsyncGenerator<T> {
  if (sources.length === 0) {
    return;
  }

  const concurrency = Math.min(options.concurrency ?? sources.length, sources.length);
  const channel = new BoundedAsyncChannel<T>(MERGE_CHANNEL_CAPACITY);
  let nextSourceIndex = 0;
  let firstError: unknown;
  let failed = false;

  const pump = async (): Promise<void> => {
    while (!failed) {
      const index = nextSourceIndex;
      nextSourceIndex += 1;
      if (index >= sources.length) {
        return;
      }

      const iterator = sources[index]!()[Symbol.asyncIterator]();
      try {
        while (true) {
          const result = await iterator.next();
          if (result.done) {
            break;
          }

          const accepted = await channel.push(result.value);
          if (!accepted) {
            // Channel closed by consumer abandonment or a failed sibling:
            // give the source a chance to clean up, then stop.
            await iterator.return?.();
            return;
          }
        }
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
          channel.close();
        }
        return;
      }
    }
  };

  const pumps = Array.from({ length: concurrency }, () => pump());
  const allDone = Promise.allSettled(pumps).then(() => {
    channel.close();
  });

  try {
    for await (const item of channel) {
      yield item;
    }

    await allDone;
    if (failed) {
      throw firstError;
    }
  } finally {
    channel.close();
    await allDone;
  }
}

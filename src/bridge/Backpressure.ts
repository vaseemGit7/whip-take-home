export class RateLimiter {
  private windowTs: number[] = [];
  private sustainedTs: number[] = [];
  private readonly maxPerSecond = 50;
  private readonly maxQueueDepth = 100;
  private readonly sustainedThreshold = 500;
  private readonly sustainedWindowMs = 10_000;
  private readonly drainIntervalMs = 1000 / 50; // ~20ms between items

  private queue: Array<() => Promise<void>> = [];
  private draining = false;
  private readonly onAbuse: () => void;

  constructor(onAbuse: () => void) {
    this.onAbuse = onAbuse;
  }

  check(now: number): 'allow' | 'queue' | 'reject' | 'abuse' {
    // Sustained abuse window
    this.sustainedTs = this.sustainedTs.filter(t => now - t < this.sustainedWindowMs);
    this.sustainedTs.push(now);
    if (this.sustainedTs.length > this.sustainedThreshold) {
      return 'abuse';
    }

    // Per-second window
    this.windowTs = this.windowTs.filter(t => now - t < 1000);
    this.windowTs.push(now);

    if (this.windowTs.length <= this.maxPerSecond) {
      return 'allow';
    }

    if (this.queue.length >= this.maxQueueDepth) {
      return 'reject';
    }

    return 'queue';
  }

  enqueue(task: () => Promise<void>): void {
    this.queue.push(task);
    this.drain();
  }

  private drain(): void {
    if (this.draining) {
      return;
    }
    this.draining = true;

    const step = async () => {
      if (this.queue.length === 0) {
        this.draining = false;
        return;
      }
      const task = this.queue.shift()!;
      try {
        await task();
      } catch {
        // task is responsible for its own error handling
      }
      setTimeout(step, this.drainIntervalMs);
    };

    step();
  }

  triggerAbuse(): void {
    this.onAbuse();
  }
}

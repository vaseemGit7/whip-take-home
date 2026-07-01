/**
 * Backpressure — Rate Limiter Tests
 *
 * The rate limiter enforces three tiers of protection per-session:
 *   1. Normal: ≤50 messages/sec → 'allow'
 *   2. Burst:  >50 but queue has room (≤100 queued) → 'queue'
 *   3. Overload: queue full → 'reject' (host sends RATE_LIMITED error)
 *   4. Sustained abuse: >500 messages in 10s → 'abuse' → session terminated
 */

import {RateLimiter} from '../src/bridge/Backpressure';

// Control time without relying on wall-clock
function makeNow(baseMs = 0) {
  let offset = baseMs;
  return {
    tick: (ms: number) => { offset += ms; },
    now: () => offset,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('RateLimiter', () => {
  it('allows up to 50 messages per second', () => {
    const limiter = new RateLimiter(jest.fn());
    const clock = makeNow();

    const results: string[] = [];
    for (let i = 0; i < 50; i++) {
      results.push(limiter.check(clock.now()));
    }

    expect(results.every(r => r === 'allow')).toBe(true);
  });

  it('queues the 51st message within the same second', () => {
    const limiter = new RateLimiter(jest.fn());
    const clock = makeNow();

    for (let i = 0; i < 50; i++) {
      limiter.check(clock.now());
    }

    expect(limiter.check(clock.now())).toBe('queue');
  });

  it('rejects when queue depth exceeds 100', () => {
    const limiter = new RateLimiter(jest.fn());
    const clock = makeNow();

    // Saturate per-second window
    for (let i = 0; i < 50; i++) {
      limiter.check(clock.now());
    }

    // Fill the queue — fake timers prevent the drain from running
    for (let i = 0; i < 100; i++) {
      limiter.enqueue(async () => {});
    }
    // Drain dequeues the first item synchronously inside step(), so we need 101
    // enqueues to leave 100 in the queue. But with fake timers the setTimeout
    // inside drain never fires, so only the first item is dequeued via step().
    // We've enqueued 100; 1 was popped by step() → 99 remain.
    // Enqueue one more to cross the 100 threshold.
    limiter.enqueue(async () => {});

    expect(limiter.check(clock.now())).toBe('reject');
  });

  it('allows fresh messages after the 1-second window expires', () => {
    const limiter = new RateLimiter(jest.fn());
    const clock = makeNow();

    for (let i = 0; i < 50; i++) {
      limiter.check(clock.now());
    }
    expect(limiter.check(clock.now())).toBe('queue');

    // Advance time past the 1-second window
    clock.tick(1001);
    expect(limiter.check(clock.now())).toBe('allow');
  });

  it('returns abuse when more than 500 messages arrive in 10 seconds', () => {
    const limiter = new RateLimiter(jest.fn());
    const clock = makeNow();

    // 501 messages spread across 10 seconds (20ms apart)
    // Each batch of 50 crosses the per-second limit after the first 50,
    // so use 21ms spacing to stay in the sustained window (< 10s per cycle).
    let result: string = 'allow';
    for (let i = 0; i < 501; i++) {
      clock.tick(19); // ~52/sec — bursts slightly over per-second limit
      result = limiter.check(clock.now());
    }

    expect(result).toBe('abuse');
  });

  it('triggerAbuse calls the onAbuse callback', () => {
    const onAbuse = jest.fn();
    const limiter = new RateLimiter(onAbuse);

    limiter.triggerAbuse();

    expect(onAbuse).toHaveBeenCalledTimes(1);
  });

  it('does not report abuse before 500 messages in 10 seconds', () => {
    const limiter = new RateLimiter(jest.fn());
    const clock = makeNow();

    // 500 messages — threshold is > 500 so 500 itself should not trigger abuse
    let result: string = 'allow';
    for (let i = 0; i < 500; i++) {
      clock.tick(19);
      result = limiter.check(clock.now());
    }

    expect(result).not.toBe('abuse');
  });
});

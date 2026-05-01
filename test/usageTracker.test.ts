import { strict as assert } from 'assert';
import { makeContext } from './mocks/vscode';
import { UsageDelta, UsageTracker } from '../src/usageTracker';

const STORAGE_KEY = 'kimi.usageHistory.v2';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function trackerWith(deltas: UsageDelta[]): UsageTracker {
  const ctx = makeContext({ [STORAGE_KEY]: { deltas, lastSnapshot: null } });
  return new UsageTracker(ctx as any);
}

describe('UsageTracker.recordSnapshot', () => {
  it('returns null on first snapshot (no previous baseline)', () => {
    const t = new UsageTracker(makeContext() as any);
    const delta = t.recordSnapshot(100, 10, Date.now() + HOUR);
    assert.equal(delta, null);
    assert.equal(t.getDeltas().length, 0);
  });

  it('records a positive delta on the second snapshot', () => {
    const t = new UsageTracker(makeContext() as any);
    const reset = Date.now() + HOUR;
    t.recordSnapshot(100, 10, reset);
    const delta = t.recordSnapshot(150, 25, reset);
    assert.ok(delta);
    assert.equal(delta!.weeklyDelta, 50);
    assert.equal(delta!.windowDelta, 15);
    assert.equal(t.getDeltas().length, 1);
  });

  it('clamps negative weekly delta (e.g. weekly reset) to 0', () => {
    const t = new UsageTracker(makeContext() as any);
    const reset = Date.now() + HOUR;
    t.recordSnapshot(900, 50, reset);
    // weeklyUsed dropped (reset) but window also bumped a little
    const delta = t.recordSnapshot(10, 60, reset);
    assert.ok(delta);
    assert.equal(delta!.weeklyDelta, 0);
    assert.equal(delta!.windowDelta, 10);
  });

  it('treats a windowResetAt change as a fresh window (uses snap.windowUsed)', () => {
    const t = new UsageTracker(makeContext() as any);
    t.recordSnapshot(100, 80, Date.now() + HOUR);
    // Window rolled over: new reset boundary, windowUsed restarts at 5
    const delta = t.recordSnapshot(110, 5, Date.now() + 2 * HOUR);
    assert.ok(delta);
    assert.equal(delta!.weeklyDelta, 10);
    assert.equal(delta!.windowDelta, 5);
  });

  it('does not append a delta when both weekly and window are unchanged', () => {
    const t = new UsageTracker(makeContext() as any);
    const reset = Date.now() + HOUR;
    t.recordSnapshot(100, 10, reset);
    const delta = t.recordSnapshot(100, 10, reset);
    assert.equal(delta, null);
    assert.equal(t.getDeltas().length, 0);
  });
});

describe('UsageTracker.getHourlyBuckets', () => {
  it('returns N empty buckets when there is no history', () => {
    const t = trackerWith([]);
    const buckets = t.getHourlyBuckets(24);
    assert.equal(buckets.length, 24);
    buckets.forEach((b) => {
      assert.equal(b.weekly, 0);
      assert.equal(b.window, 0);
      assert.equal(b.samples, 0);
    });
  });

  it('aggregates deltas into the matching hour bin (current and previous hour)', () => {
    const hourStart = Math.floor(Date.now() / HOUR) * HOUR;
    const t = trackerWith([
      { timestamp: hourStart + 1000, weeklyDelta: 100, windowDelta: 10 },
      { timestamp: hourStart + 2000, weeklyDelta: 50, windowDelta: 5 },
      { timestamp: hourStart - HOUR + 500, weeklyDelta: 200, windowDelta: 20 }
    ]);
    const buckets = t.getHourlyBuckets(24);
    const last = buckets[buckets.length - 1];
    const prev = buckets[buckets.length - 2];
    assert.equal(last.weekly, 150);
    assert.equal(last.window, 15);
    assert.equal(last.samples, 2);
    assert.equal(prev.weekly, 200);
    assert.equal(prev.window, 20);
    assert.equal(prev.samples, 1);
  });

  it('drops deltas older than the requested window', () => {
    const hourStart = Math.floor(Date.now() / HOUR) * HOUR;
    const t = trackerWith([
      { timestamp: hourStart - 30 * HOUR, weeklyDelta: 999, windowDelta: 99 },
      { timestamp: hourStart + 1000, weeklyDelta: 5, windowDelta: 1 }
    ]);
    const buckets = t.getHourlyBuckets(24);
    const total = buckets.reduce((s, b) => s + b.weekly, 0);
    assert.equal(total, 5);
  });
});

describe('UsageTracker.getDailyBuckets', () => {
  it('returns N empty buckets when there is no history', () => {
    const t = trackerWith([]);
    const buckets = t.getDailyBuckets(7);
    assert.equal(buckets.length, 7);
    buckets.forEach((b) => assert.equal(b.samples, 0));
  });

  it('aggregates deltas into the correct day (today and yesterday, local time)', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const t = trackerWith([
      { timestamp: todayMs + 100, weeklyDelta: 30, windowDelta: 3 },
      { timestamp: todayMs + 5 * HOUR, weeklyDelta: 70, windowDelta: 7 },
      { timestamp: todayMs - 1, weeklyDelta: 10, windowDelta: 1 }
    ]);
    const buckets = t.getDailyBuckets(7);
    const last = buckets[buckets.length - 1];
    const prev = buckets[buckets.length - 2];
    assert.equal(last.weekly, 100);
    assert.equal(last.samples, 2);
    assert.equal(prev.weekly, 10);
    assert.equal(prev.samples, 1);
  });

  it('orders buckets chronologically (oldest first)', () => {
    const t = trackerWith([]);
    const buckets = t.getDailyBuckets(3);
    assert.equal(buckets.length, 3);
    // Sort the bucket keys ascending and compare — they should already match.
    const keys = buckets.map((b) => b.key);
    const sorted = [...keys].sort();
    assert.deepEqual(keys, sorted);
  });
});

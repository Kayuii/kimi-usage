import * as vscode from 'vscode';

/**
 * Auto-tracks Kimi usage by comparing successive API snapshots and storing the delta.
 * Same idea as kimi-quota-logger: poll the official quota endpoint on a schedule,
 * compute (currentUsed - previousUsed) and persist that as a usage event.
 *
 * No HTTP interception — purely state-diff based.
 */

export interface UsageDelta {
  timestamp: number;
  weeklyDelta: number;
  windowDelta: number;
}

interface Snapshot {
  weeklyUsed: number;
  windowUsed: number;
  windowResetAt: number | null;
  timestamp: number;
}

interface PersistedHistory {
  deltas: UsageDelta[];
  lastSnapshot: Snapshot | null;
}

const STORAGE_KEY = 'kimi.usageHistory.v2';
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class UsageTracker {
  private context: vscode.ExtensionContext;
  private deltas: UsageDelta[] = [];
  private lastSnapshot: Snapshot | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.load();
  }

  /**
   * Feed a new quota snapshot from the API. If we have a previous snapshot,
   * compute the delta and append it to history. Negative deltas (e.g. weekly
   * reset, rate-window reset) are clamped to zero so they don't pollute totals.
   */
  public recordSnapshot(weeklyUsed: number | null, windowUsed: number | null, windowResetAt: number | null): UsageDelta | null {
    if (weeklyUsed === null) return null;

    const now = Date.now();
    const snap: Snapshot = {
      weeklyUsed,
      windowUsed: windowUsed ?? 0,
      windowResetAt,
      timestamp: now
    };

    let delta: UsageDelta | null = null;
    if (this.lastSnapshot) {
      const weeklyDelta = Math.max(0, snap.weeklyUsed - this.lastSnapshot.weeklyUsed);
      // Window resets every few minutes; if reset boundary changed, treat as fresh window
      const windowReset = snap.windowResetAt !== this.lastSnapshot.windowResetAt;
      const windowDelta = windowReset ? snap.windowUsed : Math.max(0, snap.windowUsed - this.lastSnapshot.windowUsed);

      if (weeklyDelta > 0 || windowDelta > 0) {
        delta = { timestamp: now, weeklyDelta, windowDelta };
        this.deltas.push(delta);
        this.prune();
      }
    }

    this.lastSnapshot = snap;
    void this.persist();
    return delta;
  }

  /** Sum of weekly-quota deltas observed within the last `windowMs`. */
  public getUsageInWindow(windowMs: number): { weekly: number; window: number; samples: number } {
    const cutoff = Date.now() - windowMs;
    const filtered = this.deltas.filter((d) => d.timestamp > cutoff);
    return {
      weekly: filtered.reduce((s, d) => s + d.weeklyDelta, 0),
      window: filtered.reduce((s, d) => s + d.windowDelta, 0),
      samples: filtered.length
    };
  }

  /** Sum of weekly-quota deltas in [now-windowMs*2, now-windowMs). */
  public getUsageInPreviousWindow(windowMs: number): { weekly: number; window: number; samples: number } {
    const now = Date.now();
    const start = now - windowMs * 2;
    const end = now - windowMs;
    const filtered = this.deltas.filter((d) => d.timestamp > start && d.timestamp <= end);
    return {
      weekly: filtered.reduce((s, d) => s + d.weeklyDelta, 0),
      window: filtered.reduce((s, d) => s + d.windowDelta, 0),
      samples: filtered.length
    };
  }

  public getDeltas(): UsageDelta[] {
    return [...this.deltas];
  }

  /**
   * Bucket deltas into the last `hours` 1-hour bins ending at the current hour.
   * Returns the buckets in chronological order (oldest first) so charts render left-to-right.
   */
  public getHourlyBuckets(hours: number): Array<{ key: string; label: string; weekly: number; window: number; samples: number }> {
    const HOUR = 60 * 60 * 1000;
    const now = Date.now();
    const currentHour = Math.floor(now / HOUR) * HOUR;
    const buckets: Array<{ key: string; label: string; weekly: number; window: number; samples: number }> = [];
    for (let i = hours - 1; i >= 0; i--) {
      const start = currentHour - i * HOUR;
      const end = start + HOUR;
      const d = new Date(start);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
      const label = `${String(d.getHours()).padStart(2, '0')}:00`;
      const items = this.deltas.filter((x) => x.timestamp >= start && x.timestamp < end);
      buckets.push({
        key,
        label,
        weekly: items.reduce((s, x) => s + x.weeklyDelta, 0),
        window: items.reduce((s, x) => s + x.windowDelta, 0),
        samples: items.length
      });
    }
    return buckets;
  }

  /**
   * Bucket deltas into the last `days` 1-day bins ending today (local time).
   * Returns the buckets in chronological order (oldest first).
   */
  public getDailyBuckets(days: number): Array<{ key: string; label: string; weekly: number; window: number; samples: number }> {
    const buckets: Array<{ key: string; label: string; weekly: number; window: number; samples: number }> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const DAY = 24 * 60 * 60 * 1000;
    for (let i = days - 1; i >= 0; i--) {
      const start = todayMs - i * DAY;
      const end = start + DAY;
      const d = new Date(start);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      const items = this.deltas.filter((x) => x.timestamp >= start && x.timestamp < end);
      buckets.push({
        key,
        label,
        weekly: items.reduce((s, x) => s + x.weeklyDelta, 0),
        window: items.reduce((s, x) => s + x.windowDelta, 0),
        samples: items.length
      });
    }
    return buckets;
  }

  public clear(): void {
    this.deltas = [];
    this.lastSnapshot = null;
    void this.persist();
  }

  public dispose(): void {
    void this.persist();
  }

  // ─────────────────────────── Private ───────────────────────────

  private load(): void {
    const stored = this.context.globalState.get<PersistedHistory>(STORAGE_KEY);
    if (stored && Array.isArray(stored.deltas)) {
      this.deltas = stored.deltas;
      this.lastSnapshot = stored.lastSnapshot ?? null;
      this.prune();
    }
  }

  private persist(): Thenable<void> {
    const payload: PersistedHistory = { deltas: this.deltas, lastSnapshot: this.lastSnapshot };
    return this.context.globalState.update(STORAGE_KEY, payload);
  }

  private prune(): void {
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    this.deltas = this.deltas.filter((d) => d.timestamp > cutoff);
  }
}

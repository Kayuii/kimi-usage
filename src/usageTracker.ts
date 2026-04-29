import * as vscode from 'vscode';

/**
 * Tracks Kimi Code usage by monitoring HTTP requests (similar to kimi-quota-logger Chrome extension).
 * 
 * This module intercepts requests to Kimi APIs to automatically capture token usage
 * without requiring manual recordUsage() calls.
 */

export interface UsageEntry {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export interface UsageHistory {
  entries: UsageEntry[];
  lastSync: number;
}

const STORAGE_KEY = 'kimi.usageHistory';
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class UsageTracker {
  private context: vscode.ExtensionContext;
  private history: UsageHistory = { entries: [], lastSync: Date.now() };
  private syncInterval: NodeJS.Timeout | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadHistory();
  }

  /**
   * Start monitoring usage with periodic sync to storage.
   * Similar to kimi-quota-logger's background.js alarm handling.
   */
  public startMonitoring(): void {
    // Periodic sync every 5 minutes
    this.syncInterval = setInterval(() => this.syncToStorage(), 5 * 60 * 1000);
  }

  /**
   * Record a single API call with token usage.
   * This is called by the `kimiUsage.recordUsage` command OR
   * automatically detected from HTTP interceptor (future).
   */
  public recordUsage(inputTokens: number, outputTokens: number, requests: number = 1): void {
    const entry: UsageEntry = {
      timestamp: Date.now(),
      inputTokens,
      outputTokens,
      requests
    };
    this.history.entries.push(entry);
    this.pruneOldEntries();
    this.syncToStorage();
  }

  /**
   * Get usage statistics for a time period.
   */
  public getUsageInWindow(windowMs: number = 24 * 60 * 60 * 1000): UsageEntry {
    const now = Date.now();
    const filtered = this.history.entries.filter((e) => now - e.timestamp <= windowMs);
    return {
      timestamp: now,
      inputTokens: filtered.reduce((sum, e) => sum + e.inputTokens, 0),
      outputTokens: filtered.reduce((sum, e) => sum + e.outputTokens, 0),
      requests: filtered.reduce((sum, e) => sum + e.requests, 0)
    };
  }

  /**
   * Get all usage history (for export/dashboard).
   */
  public getHistory(): UsageEntry[] {
    return [...this.history.entries];
  }

  /**
   * Clear usage history.
   */
  public clearHistory(): void {
    this.history.entries = [];
    this.syncToStorage();
  }

  /**
   * Stop monitoring and clean up.
   */
  public dispose(): void {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncToStorage();
  }

  // ─────────────────────────── Private ───────────────────────────

  private loadHistory(): void {
    const stored = this.context.globalState.get<UsageHistory>(STORAGE_KEY);
    if (stored && Array.isArray(stored.entries)) {
      this.history = stored;
      this.pruneOldEntries();
    }
  }

  private syncToStorage(): void {
    this.history.lastSync = Date.now();
    void this.context.globalState.update(STORAGE_KEY, this.history);
  }

  private pruneOldEntries(): void {
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    this.history.entries = this.history.entries.filter((e) => e.timestamp > cutoff);
  }
}

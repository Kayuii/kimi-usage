import * as vscode from 'vscode';
import { QuotaState } from './types';
import { UsageTracker } from './usageTracker';
import { fmtHours, fmtTokens } from './utils';

export interface DashboardCallbacks {
  refresh(): void | Promise<void>;
  clearHistory(): void | Promise<void>;
  openConsole(): void;
  signOut(): void | Promise<void>;
}

type TabId = 'today' | 'week' | 'session';

export class DashboardPanel {
  private static current: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private tracker: UsageTracker | undefined;
  private callbacks: DashboardCallbacks | undefined;
  private currentTab: TabId = 'today';

  static show(
    state: QuotaState,
    context: vscode.ExtensionContext,
    tracker?: UsageTracker,
    callbacks?: DashboardCallbacks
  ): void {
    if (DashboardPanel.current) {
      if (callbacks) DashboardPanel.current.callbacks = callbacks;
      DashboardPanel.current.panel.reveal();
      DashboardPanel.current.update(state);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'kimiUsageDashboard',
      'Kimi Usage Dashboard',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    DashboardPanel.current = new DashboardPanel(panel, state, context, tracker, callbacks);
  }

  static refreshIfOpen(state: QuotaState): void {
    DashboardPanel.current?.update(state);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    state: QuotaState,
    _context: vscode.ExtensionContext,
    tracker?: UsageTracker,
    callbacks?: DashboardCallbacks
  ) {
    this.panel = panel;
    this.tracker = tracker;
    this.callbacks = callbacks;

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.command) {
        case 'refresh': await this.callbacks?.refresh(); break;
        case 'clearHistory': await this.callbacks?.clearHistory(); break;
        case 'openConsole': this.callbacks?.openConsole(); break;
        case 'signOut': await this.callbacks?.signOut(); break;
        case 'tabChanged':
          if (msg.tab === 'today' || msg.tab === 'week' || msg.tab === 'session') {
            this.currentTab = msg.tab;
          }
          break;
      }
    }, null, this.disposables);

    this.update(state);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  update(state: QuotaState): void {
    this.panel.webview.html = this.renderHtml(state);
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  private fmtNum(n: number | null | undefined): string {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString();
  }

  private pct(used: number | null, limit: number | null): number {
    if (!limit || limit <= 0 || used === null) return 0;
    return Math.min(100, Math.round((used / limit) * 100));
  }

  private renderSummaryCards(s: QuotaState): string {
    const wPct = this.pct(s.weeklyUsed, s.weeklyLimit);
    const winPct = this.pct(s.windowUsed, s.windowLimit);
    const sessTotal = s.sessionInputTokens + s.sessionOutputTokens;
    const weeklyReset = s.weeklyResetHours !== null ? fmtHours(Math.max(0, s.weeklyResetHours)) : '—';
    const winReset = s.windowResetAt ? fmtHours((s.windowResetAt - Date.now()) / 3_600_000) : '—';

    const cards: Array<{ label: string; value: string; sub: string; accent?: string }> = [
      { label: 'Weekly used', value: `${wPct}%`, sub: `${this.fmtNum(s.weeklyUsed)} / ${this.fmtNum(s.weeklyLimit)}`, accent: 'cost' },
      { label: 'Weekly resets in', value: weeklyReset, sub: '7-day cycle' },
      { label: 'Rate window used', value: `${winPct}%`, sub: `${this.fmtNum(s.windowUsed)} / ${this.fmtNum(s.windowLimit)}` },
      { label: 'Window remaining', value: this.fmtNum(s.windowRemaining), sub: `Resets in ${winReset}` },
      { label: 'Parallel limit', value: this.fmtNum(s.parallelLimit), sub: 'Concurrent requests' },
      { label: 'Session tokens', value: fmtTokens(sessTotal), sub: `${s.sessionRequests} request${s.sessionRequests === 1 ? '' : 's'}` }
    ];

    return `<div class="summary-grid">${cards
      .map(
        (c) => `<div class="summary-item">
          <div class="label">${escapeHtml(c.label)}</div>
          <div class="value ${c.accent === 'cost' ? 'cost' : ''}">${escapeHtml(c.value)}</div>
          <div class="sub muted">${escapeHtml(c.sub)}</div>
        </div>`
      )
      .join('')}</div>`;
  }

  private renderChart(buckets: Array<{ key: string; label: string; weekly: number; window: number; samples: number }>): string {
    const max = Math.max(...buckets.map((b) => b.weekly), 1);
    const maxHeight = 120;
    return `<div class="chart-bars">${buckets
      .map((b) => {
        const height = max > 0 ? Math.max((b.weekly / max) * maxHeight, 2) : 2;
        return `<div class="chart-bar-container" data-key="${escapeHtml(b.key)}">
          <div class="chart-bar weekly-bar"
               style="height: ${height}px;"
               data-weekly="${b.weekly}"
               data-window="${b.window}"
               data-samples="${b.samples}"
               title="${escapeHtml(b.label)}: ${this.fmtNum(b.weekly)} weekly tokens">
          </div>
          <div class="chart-label">${escapeHtml(b.label)}</div>
        </div>`;
      })
      .join('')}</div>`;
  }

  private renderBucketTable(
    buckets: Array<{ key: string; label: string; weekly: number; window: number; samples: number }>,
    timeHeader: string
  ): string {
    const totalSamples = buckets.reduce((s, b) => s + b.samples, 0);
    if (totalSamples === 0) {
      return `<div class="no-data" style="padding:24px;text-align:center">
        <p class="muted">No usage recorded yet for this period. Snapshots are captured on every quota refresh.</p>
      </div>`;
    }
    const rows = [...buckets].reverse(); // newest first in the table
    return `<div class="daily-table-container">
      <table class="daily-table">
        <thead>
          <tr>
            <th>${escapeHtml(timeHeader)}</th>
            <th>Weekly Δ</th>
            <th>Window Δ</th>
            <th>Samples</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (b) => `<tr>
            <td class="date-cell">${escapeHtml(b.label)}</td>
            <td class="number-cell">${this.fmtNum(b.weekly)}</td>
            <td class="number-cell">${this.fmtNum(b.window)}</td>
            <td class="number-cell">${b.samples}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
  }

  private renderChartBlock(
    title: string,
    buckets: Array<{ key: string; label: string; weekly: number; window: number; samples: number }>,
    chartId: string,
    timeHeader: string
  ): string {
    return `<div class="daily-breakdown">
      <h3>${escapeHtml(title)}</h3>
      <div class="chart-tabs">
        <button class="chart-tab active" data-metric="weekly">Weekly tokens Δ</button>
        <button class="chart-tab" data-metric="window">Window tokens Δ</button>
        <button class="chart-tab" data-metric="samples">Samples</button>
      </div>
      <div class="chart-container">
        <div class="chart-content" id="${chartId}">
          ${this.renderChart(buckets)}
        </div>
      </div>
      ${this.renderBucketTable(buckets, timeHeader)}
    </div>`;
  }

  private renderTodayTab(): string {
    const buckets = this.tracker?.getHourlyBuckets(24) ?? [];
    return this.renderChartBlock('Last 24 hours', buckets, 'hourlyChart', 'Hour');
  }

  private renderWeekTab(): string {
    const buckets = this.tracker?.getDailyBuckets(7) ?? [];
    return this.renderChartBlock('Last 7 days', buckets, 'dailyChart', 'Date');
  }

  private renderSessionTab(s: QuotaState): string {
    const total = s.sessionInputTokens + s.sessionOutputTokens;
    return `<div class="usage-summary">
      <div class="summary-grid">
        <div class="summary-item">
          <div class="label">Requests</div>
          <div class="value">${this.fmtNum(s.sessionRequests)}</div>
        </div>
        <div class="summary-item">
          <div class="label">Input tokens</div>
          <div class="value">${this.fmtNum(s.sessionInputTokens)}</div>
        </div>
        <div class="summary-item">
          <div class="label">Output tokens</div>
          <div class="value">${this.fmtNum(s.sessionOutputTokens)}</div>
        </div>
        <div class="summary-item">
          <div class="label">Total tokens</div>
          <div class="value cost">${fmtTokens(total)}</div>
          <div class="sub muted">${this.fmtNum(total)}</div>
        </div>
      </div>
      <p class="muted" style="margin-top:16px;font-size:0.9em">
        Counters are accumulated via <code>kimiUsage.recordUsage</code> calls and persisted across reloads.
        Use <code>Kimi Usage: Reset Session Counter</code> to clear them.
      </p>
    </div>`;
  }

  private renderHtml(s: QuotaState): string {
    const updated = s.lastUpdated ? new Date(s.lastUpdated).toLocaleString() : '—';
    const tab = this.currentTab;
    const totalDeltas = this.tracker?.getDeltas().length ?? 0;

    const tabClass = (id: TabId): string => (tab === id ? 'active' : '');

    const banner = s.authFailed
      ? '<div class="banner banner-error">Authentication failed. Please run <code>Kimi Usage: Sign In</code> or update your API key.</div>'
      : s.error
        ? `<div class="banner banner-error">Error: ${escapeHtml(s.error)}</div>`
        : '';

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>Kimi Usage</title>
  <style>${this.getStyles()}</style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Kimi Usage</h1>
        <div class="muted last-updated">Last updated: ${escapeHtml(updated)}</div>
      </div>
      <div class="actions">
        <button class="btn" onclick="postCmd('refresh')">Refresh</button>
        <button class="btn-secondary" onclick="postCmd('openConsole')">Console</button>
        <button class="btn-secondary" onclick="postCmd('clearHistory')" title="Clear auto-tracked history">Clear history</button>
        <button class="btn-secondary" onclick="postCmd('signOut')">Sign out</button>
      </div>
    </header>

    ${banner}

    ${this.renderSummaryCards(s)}

    <div class="tabs">
      <button id="tab-today" class="tab ${tabClass('today')}" onclick="showTab('today')">Last 24h</button>
      <button id="tab-week" class="tab ${tabClass('week')}" onclick="showTab('week')">Last 7 days</button>
      <button id="tab-session" class="tab ${tabClass('session')}" onclick="showTab('session')">Session</button>
    </div>

    <div id="today" class="tab-content ${tabClass('today')}">${this.renderTodayTab()}</div>
    <div id="week" class="tab-content ${tabClass('week')}">${this.renderWeekTab()}</div>
    <div id="session" class="tab-content ${tabClass('session')}">${this.renderSessionTab(s)}</div>

    <footer class="muted">Total log entries: ${totalDeltas} · Retained for 7 days · Snapshots are diffed between API refreshes.</footer>
  </div>
  <script>${this.getScript()}</script>
</body>
</html>`;
  }

  private getStyles(): string {
    return `
      body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
      .container { max-width: 960px; margin: 0 auto; }
      header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 16px; }
      header h1 { margin: 0 0 4px; font-size: 20px; }
      header .last-updated { font-size: 12px; }
      .muted { color: var(--vscode-descriptionForeground); }
      code { font-family: var(--vscode-editor-font-family); }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .btn, .btn-secondary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 12px; }
      .btn:hover { background: var(--vscode-button-hoverBackground); }
      .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .banner { padding: 8px 12px; margin-bottom: 16px; border-radius: 4px; }
      .banner-error { background: var(--vscode-inputValidation-errorBackground, var(--vscode-inputValidation-warningBackground)); border-left: 3px solid var(--vscode-inputValidation-errorBorder, var(--vscode-inputValidation-warningBorder)); }
      .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
      .summary-item { padding: 16px; background: var(--vscode-input-background); border-radius: 8px; border: 1px solid var(--vscode-input-border); text-align: center; }
      .summary-item .label { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
      .summary-item .value { font-size: 18px; font-weight: bold; }
      .summary-item .value.cost { color: var(--vscode-charts-green); }
      .summary-item .sub { font-size: 11px; margin-top: 4px; }
      .tabs { display: flex; margin-bottom: 16px; border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; }
      .tab { background: transparent; color: var(--vscode-foreground); border: none; padding: 8px 16px; cursor: pointer; border-bottom: 2px solid transparent; font-size: 13px; }
      .tab.active { border-bottom-color: var(--vscode-focusBorder); color: var(--vscode-focusBorder); }
      .tab-content { display: none; }
      .tab-content.active { display: block; }
      .daily-breakdown { margin-top: 8px; }
      .daily-breakdown h3 { margin: 0 0 12px; font-size: 14px; }
      .chart-tabs { display: flex; gap: 4px; margin-bottom: 12px; flex-wrap: wrap; }
      .chart-tab { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 6px 12px; font-size: 11px; cursor: pointer; transition: all 0.2s ease; }
      .chart-tab:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .chart-tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-focusBorder); }
      .chart-container { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 8px; padding: 16px; margin-bottom: 16px; height: 180px; overflow-x: auto; }
      .chart-content { width: 100%; height: 100%; display: flex; align-items: end; justify-content: center; }
      .chart-bars { display: flex; align-items: end; gap: 4px; min-width: fit-content; height: 100%; padding: 0 8px; }
      .chart-bar-container { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; min-width: 40px; height: 100%; position: relative; padding-bottom: 20px; }
      .chart-bar { width: 24px; min-height: 2px; border-radius: 2px 2px 0 0; transition: all 0.3s ease; margin-bottom: 8px; }
      .weekly-bar { background: linear-gradient(to top, var(--vscode-charts-green), var(--vscode-charts-blue)); }
      .window-bar { background: linear-gradient(to top, var(--vscode-charts-blue), var(--vscode-charts-purple)); }
      .samples-bar { background: linear-gradient(to top, var(--vscode-charts-orange), var(--vscode-charts-red)); }
      .chart-label { font-size: 10px; color: var(--vscode-descriptionForeground); text-align: center; line-height: 12px; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; }
      .daily-table-container { overflow-x: auto; margin-top: 12px; }
      .daily-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .daily-table th, .daily-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
      .daily-table th { background: var(--vscode-input-background); font-weight: bold; color: var(--vscode-foreground); }
      .daily-table tbody tr:hover { background: var(--vscode-list-hoverBackground); }
      .date-cell { font-weight: bold; color: var(--vscode-symbolIcon-functionForeground); white-space: nowrap; }
      .number-cell { text-align: right; font-family: var(--vscode-editor-font-family); }
      .no-data { padding: 40px 20px; text-align: center; color: var(--vscode-descriptionForeground); }
      footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border); font-size: 11px; }
    `;
  }

  private getScript(): string {
    return `
      const vscode = acquireVsCodeApi();
      function postCmd(cmd) { vscode.postMessage({ command: cmd }); }
      function showTab(id) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const tabBtn = document.getElementById('tab-' + id);
        const tabContent = document.getElementById(id);
        if (tabBtn && tabContent) {
          tabBtn.classList.add('active');
          tabContent.classList.add('active');
          vscode.postMessage({ command: 'tabChanged', tab: id });
        }
      }
      const METRIC_CLASS = { weekly: 'weekly-bar', window: 'window-bar', samples: 'samples-bar' };
      const METRIC_LABEL = { weekly: 'weekly Δ', window: 'window Δ', samples: 'samples' };
      function rebuildChart(container, metric) {
        const bars = container.querySelectorAll('.chart-bar');
        if (!bars.length) return;
        const values = Array.from(bars).map(b => parseFloat(b.dataset[metric]) || 0);
        const max = Math.max.apply(null, values.concat([1]));
        const maxHeight = 120;
        const cls = METRIC_CLASS[metric] || 'weekly-bar';
        bars.forEach((bar, i) => {
          const v = values[i];
          const h = max > 0 ? Math.max((v / max) * maxHeight, 2) : 2;
          bar.style.height = h + 'px';
          bar.className = 'chart-bar ' + cls;
          const lbl = bar.parentElement.querySelector('.chart-label');
          const labelText = lbl ? lbl.textContent : '';
          bar.title = labelText + ': ' + v.toLocaleString() + ' ' + (METRIC_LABEL[metric] || metric);
        });
      }
      document.addEventListener('click', function(e) {
        const t = e.target;
        if (t && t.classList && t.classList.contains('chart-tab')) {
          const block = t.closest('.daily-breakdown');
          if (!block) return;
          block.querySelectorAll('.chart-tab').forEach(x => x.classList.remove('active'));
          t.classList.add('active');
          const chart = block.querySelector('.chart-content');
          if (chart) rebuildChart(chart, t.dataset.metric);
        }
      });
    `;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] as string));
}

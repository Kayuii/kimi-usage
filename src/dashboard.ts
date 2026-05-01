import * as vscode from 'vscode';
import { Locale, makeT, resolveLocale } from './i18n';
import { QuotaState } from './types';
import { UsageTracker } from './usageTracker';
import { fmtHours, fmtTokens, getConfig } from './utils';

export interface DashboardCallbacks {
  refresh(): void | Promise<void>;
  clearHistory(): void | Promise<void>;
  openConsole(): void;
  signOut(): void | Promise<void>;
  openSettings(): void;
}

type T = (key: string, ...params: Array<string | number>) => string;

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
        case 'openSettings': this.callbacks?.openSettings(); break;
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

  private fmtNum(n: number | null | undefined, dash: string = '—'): string {
    if (n === null || n === undefined) return dash;
    return n.toLocaleString();
  }

  private pct(used: number | null, limit: number | null): number {
    if (!limit || limit <= 0 || used === null) return 0;
    return Math.min(100, Math.round((used / limit) * 100));
  }

  private renderSummaryCards(s: QuotaState, t: T): string {
    const dash = t('app.dash');
    const wPct = this.pct(s.weeklyUsed, s.weeklyLimit);
    const winPct = this.pct(s.windowUsed, s.windowLimit);
    const sessTotal = s.sessionInputTokens + s.sessionOutputTokens;
    const weeklyReset = s.weeklyResetHours !== null ? fmtHours(Math.max(0, s.weeklyResetHours)) : dash;
    const winReset = s.windowResetAt ? fmtHours((s.windowResetAt - Date.now()) / 3_600_000) : dash;
    const reqKey = s.sessionRequests === 1 ? 'card.requests.one' : 'card.requests.other';

    const cards: Array<{ label: string; value: string; sub: string; accent?: string }> = [
      { label: t('card.weeklyUsed'), value: `${wPct}%`, sub: `${this.fmtNum(s.weeklyUsed, dash)} / ${this.fmtNum(s.weeklyLimit, dash)}`, accent: 'cost' },
      { label: t('card.weeklyResetIn'), value: weeklyReset, sub: t('card.weeklyCycle') },
      { label: t('card.windowUsed'), value: `${winPct}%`, sub: `${this.fmtNum(s.windowUsed, dash)} / ${this.fmtNum(s.windowLimit, dash)}` },
      { label: t('card.windowRemaining'), value: this.fmtNum(s.windowRemaining, dash), sub: t('card.windowResetsIn', winReset) },
      { label: t('card.parallelLimit'), value: this.fmtNum(s.parallelLimit, dash), sub: t('card.parallelSub') },
      { label: t('card.sessionTokens'), value: fmtTokens(sessTotal), sub: t(reqKey, s.sessionRequests) }
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

  private renderChart(
    buckets: Array<{ key: string; label: string; weekly: number; window: number; samples: number }>,
    t: T
  ): string {
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
               title="${escapeHtml(t('chart.tooltip.weekly', b.label, this.fmtNum(b.weekly)))}">
          </div>
          <div class="chart-label">${escapeHtml(b.label)}</div>
        </div>`;
      })
      .join('')}</div>`;
  }

  private renderBucketTable(
    buckets: Array<{ key: string; label: string; weekly: number; window: number; samples: number }>,
    timeHeader: string,
    t: T
  ): string {
    const totalSamples = buckets.reduce((s, b) => s + b.samples, 0);
    if (totalSamples === 0) {
      return `<div class="no-data" style="padding:24px;text-align:center">
        <p class="muted">${escapeHtml(t('noData'))}</p>
      </div>`;
    }
    const rows = [...buckets].reverse();
    return `<div class="daily-table-container">
      <table class="daily-table">
        <thead>
          <tr>
            <th>${escapeHtml(timeHeader)}</th>
            <th>${escapeHtml(t('table.col.weeklyDelta'))}</th>
            <th>${escapeHtml(t('table.col.windowDelta'))}</th>
            <th>${escapeHtml(t('table.col.samples'))}</th>
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
    timeHeader: string,
    t: T
  ): string {
    return `<div class="daily-breakdown">
      <h3>${escapeHtml(title)}</h3>
      <div class="chart-tabs">
        <button class="chart-tab active" data-metric="weekly">${escapeHtml(t('chart.metric.weekly'))}</button>
        <button class="chart-tab" data-metric="window">${escapeHtml(t('chart.metric.window'))}</button>
        <button class="chart-tab" data-metric="samples">${escapeHtml(t('chart.metric.samples'))}</button>
      </div>
      <div class="chart-container">
        <div class="chart-content" id="${chartId}">
          ${this.renderChart(buckets, t)}
        </div>
      </div>
      ${this.renderBucketTable(buckets, timeHeader, t)}
    </div>`;
  }

  private renderTodayTab(t: T): string {
    const buckets = this.tracker?.getHourlyBuckets(24) ?? [];
    return this.renderChartBlock(t('chart.title.today'), buckets, 'hourlyChart', t('table.col.hour'), t);
  }

  private renderWeekTab(t: T): string {
    const buckets = this.tracker?.getDailyBuckets(7) ?? [];
    return this.renderChartBlock(t('chart.title.week'), buckets, 'dailyChart', t('table.col.date'), t);
  }

  private renderSessionTab(s: QuotaState, t: T): string {
    const total = s.sessionInputTokens + s.sessionOutputTokens;
    return `<div class="usage-summary">
      <div class="summary-grid">
        <div class="summary-item">
          <div class="label">${escapeHtml(t('session.requests'))}</div>
          <div class="value">${this.fmtNum(s.sessionRequests)}</div>
        </div>
        <div class="summary-item">
          <div class="label">${escapeHtml(t('session.inputTokens'))}</div>
          <div class="value">${this.fmtNum(s.sessionInputTokens)}</div>
        </div>
        <div class="summary-item">
          <div class="label">${escapeHtml(t('session.outputTokens'))}</div>
          <div class="value">${this.fmtNum(s.sessionOutputTokens)}</div>
        </div>
        <div class="summary-item">
          <div class="label">${escapeHtml(t('session.totalTokens'))}</div>
          <div class="value cost">${fmtTokens(total)}</div>
          <div class="sub muted">${this.fmtNum(total)}</div>
        </div>
      </div>
      <p class="muted" style="margin-top:16px;font-size:0.9em">${t('session.note')}</p>
    </div>`;
  }

  private renderHtml(s: QuotaState): string {
    const locale: Locale = resolveLocale(getConfig().language, vscode.env.language);
    const t = makeT(locale);
    const dash = t('app.dash');
    const updated = s.lastUpdated ? new Date(s.lastUpdated).toLocaleString() : dash;
    const tab = this.currentTab;
    const totalDeltas = this.tracker?.getDeltas().length ?? 0;

    const tabClass = (id: TabId): string => (tab === id ? 'active' : '');

    const banner = s.authFailed
      ? `<div class="banner banner-error">${t('banner.authFailed')}</div>`
      : s.error
        ? `<div class="banner banner-error">${t('banner.error', escapeHtml(s.error))}</div>`
        : '';

    return /* html */ `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>${escapeHtml(t('app.title'))}</title>
  <style>${this.getStyles()}</style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>${escapeHtml(t('app.title'))}</h1>
        <div class="muted last-updated">${escapeHtml(t('app.lastUpdated'))}: ${escapeHtml(updated)}</div>
      </div>
      <div class="actions">
        <button class="btn" onclick="postCmd('refresh')">${escapeHtml(t('btn.refresh'))}</button>
        <button class="btn-secondary" onclick="postCmd('openSettings')">${escapeHtml(t('btn.settings'))}</button>
        <button class="btn-secondary" onclick="postCmd('openConsole')">${escapeHtml(t('btn.console'))}</button>
        <button class="btn-secondary" onclick="postCmd('clearHistory')" title="${escapeHtml(t('btn.clearHistory.tooltip'))}">${escapeHtml(t('btn.clearHistory'))}</button>
        <button class="btn-secondary" onclick="postCmd('signOut')">${escapeHtml(t('btn.signOut'))}</button>
      </div>
    </header>

    ${banner}

    ${this.renderSummaryCards(s, t)}

    <div class="tabs">
      <button id="tab-today" class="tab ${tabClass('today')}" onclick="showTab('today')">${escapeHtml(t('tab.today'))}</button>
      <button id="tab-week" class="tab ${tabClass('week')}" onclick="showTab('week')">${escapeHtml(t('tab.week'))}</button>
      <button id="tab-session" class="tab ${tabClass('session')}" onclick="showTab('session')">${escapeHtml(t('tab.session'))}</button>
    </div>

    <div id="today" class="tab-content ${tabClass('today')}">${this.renderTodayTab(t)}</div>
    <div id="week" class="tab-content ${tabClass('week')}">${this.renderWeekTab(t)}</div>
    <div id="session" class="tab-content ${tabClass('session')}">${this.renderSessionTab(s, t)}</div>

    <footer class="muted">${t('footer', totalDeltas)}</footer>
  </div>
  <script>${this.getScript(t)}</script>
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

  private getScript(t: T): string {
    const labels = JSON.stringify({
      weekly: t('script.weeklyShort'),
      window: t('script.windowShort'),
      samples: t('script.samplesShort')
    });
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
      const METRIC_LABEL = ${labels};
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

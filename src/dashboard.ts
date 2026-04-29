import * as vscode from 'vscode';
import { QuotaState } from './types';
import { fmtHours } from './utils';

export class DashboardPanel {
  private static current: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static show(state: QuotaState, context: vscode.ExtensionContext): void {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal();
      DashboardPanel.current.update(state);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'kimiUsageDashboard',
      'Kimi Usage Dashboard',
      vscode.ViewColumn.Active,
      { enableScripts: false, retainContextWhenHidden: true }
    );
    DashboardPanel.current = new DashboardPanel(panel, state, context);
  }

  static refreshIfOpen(state: QuotaState): void {
    DashboardPanel.current?.update(state);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    state: QuotaState,
    _context: vscode.ExtensionContext
  ) {
    this.panel = panel;
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

  private bar(used: number, limit: number): string {
    if (limit <= 0) return '<span class="muted">no limit</span>';
    const pct = Math.min(100, Math.round((used / limit) * 100));
    const filled = Math.round(pct / 4);
    const empty = 25 - filled;
    return `<code>[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}%</code>`;
  }

  private renderHtml(s: QuotaState): string {
    const updated = s.lastUpdated ? new Date(s.lastUpdated).toLocaleString() : '—';
    const weeklyReset = s.weeklyResetHours !== null ? fmtHours(Math.max(0, s.weeklyResetHours)) : '—';
    const winReset = s.windowResetAt ? fmtHours((s.windowResetAt - Date.now()) / 3_600_000) : '—';
    const sessionTokens = s.sessionInputTokens + s.sessionOutputTokens;

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
  <title>Kimi Usage</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px 24px; }
    h1 { font-size: 1.4em; margin: 0 0 4px; }
    h2 { font-size: 1.05em; margin: 24px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .kv { display: grid; grid-template-columns: 180px 1fr; row-gap: 6px; column-gap: 16px; margin: 8px 0; }
    .kv .k { color: var(--vscode-descriptionForeground); }
    code { font-family: var(--vscode-editor-font-family); }
    .auth-warn { background: var(--vscode-inputValidation-warningBackground); padding: 8px 12px; border-left: 3px solid var(--vscode-inputValidation-warningBorder); margin-bottom: 16px; }
  </style>
</head>
<body>
  <h1>Kimi Usage</h1>
  <div class="muted">Last updated: ${escapeHtml(updated)}</div>

  ${s.authFailed ? '<div class="auth-warn">Authentication failed. Please update your API key or re-sign-in via the browser extension.</div>' : ''}
  ${s.error ? `<div class="auth-warn">Error: ${escapeHtml(s.error)}</div>` : ''}

  <h2>Weekly quota</h2>
  <div class="kv">
    <div class="k">Used / Limit</div><div>${s.weeklyUsed ?? '—'} / ${s.weeklyLimit ?? '—'}</div>
    <div class="k">Progress</div><div>${this.bar(s.weeklyUsed ?? 0, s.weeklyLimit ?? 0)}</div>
    <div class="k">Resets in</div><div>${weeklyReset}</div>
  </div>

  <h2>Rate window</h2>
  <div class="kv">
    <div class="k">Used / Limit</div><div>${s.windowUsed ?? '—'} / ${s.windowLimit ?? '—'}</div>
    <div class="k">Remaining</div><div>${s.windowRemaining ?? '—'}</div>
    <div class="k">Progress</div><div>${this.bar(s.windowUsed ?? 0, s.windowLimit ?? 0)}</div>
    <div class="k">Resets in</div><div>${winReset}</div>
    <div class="k">Parallel limit</div><div>${s.parallelLimit ?? '—'}</div>
  </div>

  <h2>This session</h2>
  <div class="kv">
    <div class="k">Requests</div><div>${s.sessionRequests}</div>
    <div class="k">Input tokens</div><div>${s.sessionInputTokens}</div>
    <div class="k">Output tokens</div><div>${s.sessionOutputTokens}</div>
    <div class="k">Total tokens</div><div>${sessionTokens}</div>
  </div>
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] as string));
}

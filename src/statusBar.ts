import * as vscode from 'vscode';
import { QuotaState } from './types';
import { fmtHours, fmtTokens } from './utils';

export class StatusBar {
  private item: vscode.StatusBarItem;
  private consoleButton: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.item.show();

    // Quick access button for Kimi Code Console
    this.consoleButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 89);
    this.consoleButton.text = '$(link-external) Kimi Console';
    this.consoleButton.tooltip = 'Open Kimi Code Console (https://www.kimi.com/code/console)';
    this.consoleButton.command = 'kimiUsage.openConsole';
    this.consoleButton.show();
  }

  dispose(): void {
    this.item.dispose();
    this.consoleButton.dispose();
  }

  private paceEmoji(usedPct: number, elapsedPct: number): string {
    const delta = usedPct - elapsedPct;
    if (delta > 10) return '🔴';
    if (delta > 0) return '🟡';
    return '🟢';
  }

  setLoading(): void {
    this.item.text = '$(sync~spin) Kimi…';
    this.item.tooltip = 'Refreshing Kimi quota…';
    this.item.color = undefined;
    this.item.command = undefined;
  }

  render(state: QuotaState, hasAuth: boolean): void {
    if (!hasAuth) {
      this.item.text = '$(key) Kimi: sign in';
      this.item.tooltip = new vscode.MarkdownString(
        '**Kimi Usage** is not configured.\n\n' +
        '- Click to sign in via OAuth (recommended)\n' +
        '- Or run `Kimi Usage: Set API Key` to paste a long-lived key'
      );
      this.item.command = 'kimiUsage.signIn';
      this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
      return;
    }

    if (state.authFailed) {
      this.item.text = '$(warning) Kimi: auth failed';
      this.item.tooltip = 'Kimi token rejected (401/403). Click to sign in again.';
      this.item.command = 'kimiUsage.signIn';
      this.item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
      return;
    }

    if (state.error) {
      this.item.text = `$(warning) Kimi: ${state.error.slice(0, 40)}`;
      this.item.tooltip = `Error: ${state.error}\nClick to retry`;
      this.item.command = 'kimiUsage.refresh';
      this.item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
      return;
    }

    let weeklyText = '…';
    let paceIcon = '$(graph)';
    let weeklyLine = 'Weekly quota: loading…';

    if (state.weeklyUsedPct !== null && state.weeklyResetHours !== null && state.weeklyLimit !== null) {
      const usedPct = state.weeklyUsedPct;
      const remainHours = Math.max(0, state.weeklyResetHours);
      const elapsedHours = 168 - remainHours;
      const elapsedPct = Math.round((elapsedHours / 168) * 100);
      const emoji = this.paceEmoji(usedPct, elapsedPct);
      weeklyText = `${usedPct}%`;
      paceIcon = emoji;
      weeklyLine =
        `**Weekly:** ${state.weeklyUsed}/${state.weeklyLimit} (${usedPct}%) ${emoji}\n\n` +
        `Time elapsed: ${elapsedPct}% of week\n\n` +
        `Resets in ${fmtHours(remainHours)}`;
    }

    let windowText = '…';
    let windowLine = '';
    if (state.windowRemaining !== null && state.windowLimit !== null && state.windowLimit > 0) {
      const winUsedPct = Math.round(((state.windowLimit - state.windowRemaining) / state.windowLimit) * 100);
      windowText = `${winUsedPct}%`;
      const winReset = state.windowResetAt
        ? fmtHours((state.windowResetAt - Date.now()) / 3_600_000)
        : '?';
      windowLine =
        `\n\n**Rate window:** ${state.windowUsed}/${state.windowLimit} (${winUsedPct}%)\n\n` +
        `Resets in ${winReset}`;
    }

    const parallelLine = state.parallelLimit
      ? `\n\nParallel limit: ${state.parallelLimit}` : '';

    const updatedLine = state.lastUpdated
      ? `\n\n_Updated ${new Date(state.lastUpdated).toLocaleTimeString()}_` : '';

    // Status bar: show weekly % and rate window %
    this.item.text = `${paceIcon} Kimi ${weeklyText} | ${windowText}`;
    const md = new vscode.MarkdownString(
      [weeklyLine, windowLine, parallelLine, updatedLine].join('')
    );
    md.isTrusted = true;
    this.item.tooltip = md;
    this.item.command = 'kimiUsage.showDashboard';
    this.item.color = undefined;
  }
}

import * as vscode from 'vscode';
import { applyUsagesToState, fetchUsages } from './apiService';
import { DashboardPanel } from './dashboard';
import {
  ensureFreshToken,
  exchangeDeviceCode,
  newDeviceId,
  requestDeviceCode
} from './oauthService';
import { StatusBar } from './statusBar';
import { defaultQuotaState, KimiDeviceCodeResponse, QuotaState } from './types';
import {
  deleteApiKey,
  deleteOAuth,
  disposeOutputChannel,
  getConfig,
  getOutputChannel,
  log,
  readApiKey,
  readOAuth,
  writeApiKey,
  writeOAuth
} from './utils';

const CONSOLE_URL = 'https://www.kimi.com/code/console';
const CACHE_KEY = 'kimi.lastFetchTimestamp';
const CACHE_GRACE_MS = 30 * 1000; // 30s grace period for fast successive refreshes

let statusBar: StatusBar;
let refreshTimer: NodeJS.Timeout | undefined;
let extensionContext: vscode.ExtensionContext;
const state: QuotaState = defaultQuotaState();
let lastFetchTimestamp: number = 0;

export async function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  log('Kimi Usage extension activated');

  state.sessionInputTokens = context.globalState.get<number>('session.inputTokens', 0);
  state.sessionOutputTokens = context.globalState.get<number>('session.outputTokens', 0);
  state.sessionRequests = context.globalState.get<number>('session.requests', 0);

  statusBar = new StatusBar();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand('kimiUsage.refresh', () => refresh(/* force */ true)),
    vscode.commands.registerCommand('kimiUsage.openConsole', () =>
      vscode.env.openExternal(vscode.Uri.parse(CONSOLE_URL))
    ),
    vscode.commands.registerCommand('kimiUsage.showDashboard', async () => {
      DashboardPanel.show(state, context);
      await refresh();
    }),
    vscode.commands.registerCommand('kimiUsage.showOutput', () => getOutputChannel().show()),
    vscode.commands.registerCommand('kimiUsage.signIn', () => signInWithOAuth()),
    vscode.commands.registerCommand('kimiUsage.signOut', () => signOut()),
    vscode.commands.registerCommand('kimiUsage.setApiKey', () => promptForApiKey()),
    vscode.commands.registerCommand('kimiUsage.resetSession', async () => {
      state.sessionInputTokens = 0;
      state.sessionOutputTokens = 0;
      state.sessionRequests = 0;
      await Promise.all([
        context.globalState.update('session.inputTokens', 0),
        context.globalState.update('session.outputTokens', 0),
        context.globalState.update('session.requests', 0)
      ]);
      await renderStatus();
      vscode.window.showInformationMessage('Kimi session counter reset.');
    }),
    vscode.commands.registerCommand(
      'kimiUsage.recordUsage',
      async (opts: { inputTokens?: number; outputTokens?: number } = {}) => {
        state.sessionInputTokens += opts.inputTokens ?? 0;
        state.sessionOutputTokens += opts.outputTokens ?? 0;
        state.sessionRequests += 1;
        await Promise.all([
          context.globalState.update('session.inputTokens', state.sessionInputTokens),
          context.globalState.update('session.outputTokens', state.sessionOutputTokens),
          context.globalState.update('session.requests', state.sessionRequests)
        ]);
        await renderStatus();
      }
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('kimiUsage.refreshIntervalMinutes')) scheduleRefresh();
    })
  );

  context.subscriptions.push({
    dispose: () => {
      if (refreshTimer) clearInterval(refreshTimer);
      disposeOutputChannel();
    }
  });

  scheduleRefresh();
  void refresh();
}

export function deactivate(): void {
  if (refreshTimer) clearInterval(refreshTimer);
}

/** Resolve a usable Bearer token: OAuth (auto-refresh) preferred, then API key fallback. */
async function resolveToken(): Promise<string | undefined> {
  const oauthToken = await ensureFreshToken(extensionContext.secrets);
  if (oauthToken) return oauthToken;
  return readApiKey(extensionContext.secrets);
}

async function renderStatus(): Promise<void> {
  const hasAuth = !!(await readOAuth(extensionContext.secrets)) || !!(await readApiKey(extensionContext.secrets));
  statusBar.render(state, hasAuth);
}

async function refresh(force: boolean = false): Promise<void> {
  const token = await resolveToken();
  if (!token) {
    await renderStatus();
    return;
  }

  // Cache-aware refresh: skip if within grace period unless forced
  const now = Date.now();
  if (!force && (now - lastFetchTimestamp) < CACHE_GRACE_MS) {
    log(`Skipping refresh: within ${CACHE_GRACE_MS}ms grace period`);
    return;
  }

  statusBar.setLoading();
  const result = await fetchUsages(token);
  lastFetchTimestamp = Date.now();

  if (result.ok && result.data) {
    applyUsagesToState(state, result.data);
  } else {
    state.error = result.error ?? 'Unknown error';
    state.authFailed = result.authFailed;
    state.lastUpdated = Date.now();
    log(`Fetch failed: ${state.error}`);
  }
  await renderStatus();
  DashboardPanel.refreshIfOpen(state);
}

function scheduleRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  const minutes = Math.max(1, getConfig().refreshIntervalMinutes);
  refreshTimer = setInterval(() => void refresh(), minutes * 60 * 1000);
}

async function promptForApiKey(): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: 'Kimi Usage – Set API Key',
    prompt: 'Paste your Kimi Code API key (sk-...). Stored securely in the OS keychain.',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-...'
  });
  if (value === undefined) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  await writeApiKey(extensionContext.secrets, trimmed);
  vscode.window.showInformationMessage('Kimi API key saved.');
  void refresh();
}

async function signInWithOAuth(): Promise<void> {
  const deviceId = newDeviceId();
  let device: KimiDeviceCodeResponse;
  try {
    device = await requestDeviceCode(deviceId);
  } catch (err) {
    vscode.window.showErrorMessage(`Kimi sign-in failed: ${(err as Error).message}`);
    return;
  }

  const verifyUrl = device.verification_uri_complete ?? device.verification_uri;
  await vscode.env.clipboard.writeText(device.user_code);
  log(`Device flow started; user_code=${device.user_code}; verify at ${verifyUrl}`);

  const open = 'Open Browser';
  const cancel = 'Cancel';
  void vscode.window.showInformationMessage(
    `Kimi sign-in: visit ${verifyUrl} and confirm the code "${device.user_code}" (already copied to clipboard).`,
    open, cancel
  ).then((choice) => {
    if (choice === open) {
      vscode.env.openExternal(vscode.Uri.parse(verifyUrl));
    }
  });

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Kimi: waiting for authorization…', cancellable: true },
    async (_progress, token) => {
      const intervalMs = Math.max(5, device.interval) * 1000;
      const deadline = Date.now() + Math.min(device.expires_in, 900) * 1000;
      while (Date.now() < deadline) {
        if (token.isCancellationRequested) {
          log('Sign-in cancelled by user');
          return;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
        try {
          const out = await exchangeDeviceCode(deviceId, device.device_code);
          if (out.kind === 'success') {
            await writeOAuth(extensionContext.secrets, out.creds);
            vscode.window.showInformationMessage('Kimi sign-in successful.');
            log('OAuth sign-in completed');
            await refresh();
            return;
          }
          if (out.kind === 'failed') {
            vscode.window.showErrorMessage(`Kimi sign-in failed: ${out.error}`);
            return;
          }
        } catch (err) {
          log(`Polling error: ${(err as Error).message}`);
        }
      }
      vscode.window.showWarningMessage('Kimi sign-in timed out. Run "Kimi Usage: Sign In" to retry.');
    }
  );
}

async function signOut(): Promise<void> {
  await Promise.all([
    deleteOAuth(extensionContext.secrets),
    deleteApiKey(extensionContext.secrets)
  ]);
  Object.assign(state, defaultQuotaState(), {
    sessionInputTokens: state.sessionInputTokens,
    sessionOutputTokens: state.sessionOutputTokens,
    sessionRequests: state.sessionRequests
  });
  await renderStatus();
  vscode.window.showInformationMessage('Kimi credentials cleared.');
}

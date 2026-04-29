import * as https from 'https';
import { KimiUsagesResponse, QuotaState } from './types';
import { log, toInt } from './utils';

const KIMI_HOST = 'api.kimi.com';
const USAGES_PATH = '/coding/v1/usages';
const REQUEST_TIMEOUT_MS = 8000;

export interface FetchResult {
  ok: boolean;
  status?: number;
  authFailed: boolean;
  error?: string;
  data?: KimiUsagesResponse;
}

/**
 * Call Kimi /coding/v1/usages with a Bearer token. Accepts either an OAuth access token
 * (from the device flow) or a long-lived API key (`sk-...`) — both go through the same
 * `Authorization: Bearer` path. The `User-Agent` MUST identify as a Kimi coding agent
 * or the API responds with `access_terminated_error`.
 */
export function fetchUsages(token: string): Promise<FetchResult> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: KIMI_HOST,
        path: USAGES_PATH,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'KimiCLI/1.6'
        }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status === 401 || status === 403) {
            resolve({ ok: false, status, authFailed: true, error: `HTTP ${status}` });
            return;
          }
          if (status >= 400) {
            resolve({ ok: false, status, authFailed: false, error: `HTTP ${status}: ${body.slice(0, 200)}` });
            return;
          }
          try {
            const data = JSON.parse(body) as KimiUsagesResponse;
            resolve({ ok: true, status, authFailed: false, data });
          } catch (e) {
            resolve({ ok: false, status, authFailed: false, error: 'Invalid JSON response' });
          }
        });
      }
    );

    req.on('error', (err) => {
      resolve({ ok: false, authFailed: false, error: err.message });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      resolve({ ok: false, authFailed: false, error: 'Request timed out' });
    });

    req.end();
  });
}

/**
 * Merge a successful API response into the QuotaState in-place.
 */
export function applyUsagesToState(state: QuotaState, data: KimiUsagesResponse): void {
  const u = data.usage;
  state.weeklyLimit = toInt(u?.limit);
  state.weeklyUsed = toInt(u?.used);
  state.weeklyUsedPct = state.weeklyLimit > 0
    ? Math.round((state.weeklyUsed / state.weeklyLimit) * 100)
    : null;

  if (u?.resetTime) {
    const ms = new Date(u.resetTime).getTime();
    if (!isNaN(ms)) {
      state.weeklyResetAt = ms;
      state.weeklyResetHours = (ms - Date.now()) / 3_600_000;
    }
  }

  const win = data.limits?.[0]?.detail;
  if (win) {
    state.windowLimit = toInt(win.limit);
    state.windowUsed = toInt(win.used);
    state.windowRemaining = toInt(win.remaining);
    state.windowResetAt = win.resetTime ? new Date(win.resetTime).getTime() : null;
  }

  state.parallelLimit = toInt(data.parallel?.limit);
  state.lastUpdated = Date.now();
  state.error = null;
  state.authFailed = false;
  log(`Updated quota: weekly ${state.weeklyUsed}/${state.weeklyLimit} (${state.weeklyUsedPct}%)`);
}

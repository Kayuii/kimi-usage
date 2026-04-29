import * as crypto from 'crypto';
import * as https from 'https';
import * as os from 'os';
import * as vscode from 'vscode';
import { KimiDeviceCodeResponse, KimiOAuthCredentials } from './types';
import { deleteOAuth, log, readOAuth, writeOAuth } from './utils';

// Mirrors the official kimi-cli OAuth client; see
// https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/auth/kimi/kimi.go
const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const OAUTH_HOST = 'auth.kimi.com';
const DEVICE_CODE_PATH = '/api/oauth/device_authorization';
const TOKEN_PATH = '/api/oauth/token';
const REFRESH_THRESHOLD_SECONDS = 300;
const HTTP_TIMEOUT_MS = 15_000;

export interface AuthorizationPending { kind: 'pending'; }
export interface AuthorizationFailed { kind: 'failed'; error: string; }
export interface AuthorizationSuccess { kind: 'success'; creds: KimiOAuthCredentials; }
export type PollOutcome = AuthorizationPending | AuthorizationFailed | AuthorizationSuccess;

interface OAuthTokenWire {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

function commonHeaders(deviceId: string): Record<string, string> {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'X-Msh-Platform': 'kimi-usage-vscode',
    'X-Msh-Version': '0.1.0',
    'X-Msh-Device-Name': os.hostname() || 'unknown',
    'X-Msh-Device-Model': `${process.platform} ${process.arch}`,
    'X-Msh-Device-Id': deviceId
  };
}

function postForm(host: string, path: string, body: URLSearchParams, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = body.toString();
    const req = https.request(
      {
        hostname: host,
        path,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(data).toString() }
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
      }
    );
    req.on('error', reject);
    req.setTimeout(HTTP_TIMEOUT_MS, () => { req.destroy(new Error('Request timed out')); });
    req.write(data);
    req.end();
  });
}

export async function requestDeviceCode(deviceId: string): Promise<KimiDeviceCodeResponse> {
  const body = new URLSearchParams({ client_id: CLIENT_ID });
  const { status, body: text } = await postForm(OAUTH_HOST, DEVICE_CODE_PATH, body, commonHeaders(deviceId));
  if (status !== 200) {
    throw new Error(`device_authorization failed: HTTP ${status} ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text) as KimiDeviceCodeResponse;
  if (!parsed.device_code || !parsed.user_code) {
    throw new Error('device_authorization response missing required fields');
  }
  return parsed;
}

export async function exchangeDeviceCode(deviceId: string, deviceCode: string): Promise<PollOutcome> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
  });
  const { body: text } = await postForm(OAUTH_HOST, TOKEN_PATH, body, commonHeaders(deviceId));
  const wire = JSON.parse(text) as OAuthTokenWire;
  if (wire.error === 'authorization_pending' || wire.error === 'slow_down') {
    return { kind: 'pending' };
  }
  if (wire.error) {
    return { kind: 'failed', error: `${wire.error}: ${wire.error_description ?? ''}`.trim() };
  }
  if (!wire.access_token) {
    return { kind: 'failed', error: 'empty access_token in response' };
  }
  return { kind: 'success', creds: wireToCredentials(wire, deviceId) };
}

export async function refreshAccessToken(creds: KimiOAuthCredentials): Promise<KimiOAuthCredentials> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken
  });
  const { status, body: text } = await postForm(OAUTH_HOST, TOKEN_PATH, body, commonHeaders(creds.deviceId));
  if (status === 401 || status === 403) {
    throw new Error(`refresh_token rejected (HTTP ${status})`);
  }
  if (status !== 200) {
    throw new Error(`refresh failed: HTTP ${status} ${text.slice(0, 200)}`);
  }
  const wire = JSON.parse(text) as OAuthTokenWire;
  if (!wire.access_token) {
    throw new Error('empty access_token in refresh response');
  }
  return wireToCredentials(wire, creds.deviceId, creds.refreshToken);
}

function wireToCredentials(wire: OAuthTokenWire, deviceId: string, fallbackRefresh = ''): KimiOAuthCredentials {
  const expiresIn = wire.expires_in ?? 0;
  return {
    accessToken: wire.access_token ?? '',
    refreshToken: wire.refresh_token ?? fallbackRefresh,
    tokenType: wire.token_type ?? 'Bearer',
    expiresAt: expiresIn > 0 ? Math.floor(Date.now() / 1000) + Math.floor(expiresIn) : 0,
    scope: wire.scope ?? 'kimi-code',
    deviceId
  };
}

export function newDeviceId(): string {
  return crypto.randomUUID();
}

/** Returns a non-expired access token, refreshing in place when necessary. */
export async function ensureFreshToken(secrets: vscode.SecretStorage): Promise<string | undefined> {
  const creds = await readOAuth(secrets);
  if (!creds) return undefined;
  const now = Math.floor(Date.now() / 1000);
  if (creds.expiresAt === 0 || creds.expiresAt - now > REFRESH_THRESHOLD_SECONDS) {
    return creds.accessToken;
  }
  try {
    const refreshed = await refreshAccessToken(creds);
    await writeOAuth(secrets, refreshed);
    log(`Refreshed Kimi access token (expires in ${refreshed.expiresAt - now}s)`);
    return refreshed.accessToken;
  } catch (err) {
    log(`Refresh failed: ${(err as Error).message}. Clearing OAuth credentials.`);
    await deleteOAuth(secrets);
    return undefined;
  }
}

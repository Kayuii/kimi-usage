import { strict as assert } from 'assert';
import nock from 'nock';
import { MemorySecretStorage } from './mocks/vscode';
import {
  ensureFreshToken,
  exchangeDeviceCode,
  newDeviceId,
  requestDeviceCode
} from '../src/oauthService';
import { writeOAuth, readOAuth } from '../src/utils';
import { KimiOAuthCredentials } from '../src/types';

const HOST = 'https://auth.kimi.com';
const DEVICE_PATH = '/api/oauth/device_authorization';
const TOKEN_PATH = '/api/oauth/token';

beforeEach(() => nock.cleanAll());

describe('oauthService.newDeviceId', () => {
  it('produces a UUID-shaped string', () => {
    const id = newDeviceId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('oauthService.requestDeviceCode', () => {
  it('returns the parsed payload on 200', async () => {
    nock(HOST).post(DEVICE_PATH).reply(200, {
      device_code: 'dc', user_code: 'ABCD-EFGH',
      verification_uri: 'https://auth.kimi.com/device',
      expires_in: 600, interval: 5
    });
    const out = await requestDeviceCode('dev-1');
    assert.equal(out.device_code, 'dc');
    assert.equal(out.user_code, 'ABCD-EFGH');
  });

  it('throws when status is non-200', async () => {
    nock(HOST).post(DEVICE_PATH).reply(500, 'oops');
    await assert.rejects(requestDeviceCode('dev-1'), /HTTP 500/);
  });

  it('throws when required fields are missing', async () => {
    nock(HOST).post(DEVICE_PATH).reply(200, { user_code: 'X' });
    await assert.rejects(requestDeviceCode('dev-1'), /missing required fields/);
  });
});

describe('oauthService.exchangeDeviceCode', () => {
  it('returns pending for authorization_pending', async () => {
    nock(HOST).post(TOKEN_PATH).reply(200, { error: 'authorization_pending' });
    const out = await exchangeDeviceCode('dev-1', 'dc');
    assert.equal(out.kind, 'pending');
  });

  it('returns pending for slow_down', async () => {
    nock(HOST).post(TOKEN_PATH).reply(200, { error: 'slow_down' });
    const out = await exchangeDeviceCode('dev-1', 'dc');
    assert.equal(out.kind, 'pending');
  });

  it('returns failed for other errors', async () => {
    nock(HOST).post(TOKEN_PATH).reply(200, { error: 'access_denied', error_description: 'no' });
    const out = await exchangeDeviceCode('dev-1', 'dc');
    assert.equal(out.kind, 'failed');
    if (out.kind === 'failed') assert.match(out.error, /access_denied/);
  });

  it('returns success and maps fields to credentials', async () => {
    nock(HOST).post(TOKEN_PATH).reply(200, {
      access_token: 'at', refresh_token: 'rt',
      token_type: 'Bearer', expires_in: 3600, scope: 'kimi-code'
    });
    const out = await exchangeDeviceCode('dev-1', 'dc');
    assert.equal(out.kind, 'success');
    if (out.kind === 'success') {
      assert.equal(out.creds.accessToken, 'at');
      assert.equal(out.creds.refreshToken, 'rt');
      assert.equal(out.creds.deviceId, 'dev-1');
      const now = Math.floor(Date.now() / 1000);
      assert.ok(out.creds.expiresAt - now > 3500 && out.creds.expiresAt - now <= 3600);
    }
  });
});

describe('oauthService.ensureFreshToken', () => {
  const baseCreds = (overrides: Partial<KimiOAuthCredentials> = {}): KimiOAuthCredentials => ({
    accessToken: 'old-at', refreshToken: 'rt', tokenType: 'Bearer',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    scope: 'kimi-code', deviceId: 'dev-1',
    ...overrides
  });

  it('returns undefined when no credentials are stored', async () => {
    const s = new MemorySecretStorage();
    const tok = await ensureFreshToken(s as any);
    assert.equal(tok, undefined);
  });

  it('returns the existing token when not near expiry', async () => {
    const s = new MemorySecretStorage();
    await writeOAuth(s as any, baseCreds());
    const tok = await ensureFreshToken(s as any);
    assert.equal(tok, 'old-at');
  });

  it('refreshes when within the threshold and persists the new creds', async () => {
    const s = new MemorySecretStorage();
    await writeOAuth(s as any, baseCreds({ expiresAt: Math.floor(Date.now() / 1000) + 60 }));
    nock(HOST).post(TOKEN_PATH).reply(200, {
      access_token: 'new-at', refresh_token: 'new-rt',
      token_type: 'Bearer', expires_in: 3600, scope: 'kimi-code'
    });
    const tok = await ensureFreshToken(s as any);
    assert.equal(tok, 'new-at');
    const stored = await readOAuth(s as any);
    assert.equal(stored?.accessToken, 'new-at');
    assert.equal(stored?.refreshToken, 'new-rt');
  });

  it('clears credentials and returns undefined when refresh is rejected', async () => {
    const s = new MemorySecretStorage();
    await writeOAuth(s as any, baseCreds({ expiresAt: Math.floor(Date.now() / 1000) + 60 }));
    nock(HOST).post(TOKEN_PATH).reply(401, 'unauthorized');
    const tok = await ensureFreshToken(s as any);
    assert.equal(tok, undefined);
    assert.equal(await readOAuth(s as any), undefined);
  });
});

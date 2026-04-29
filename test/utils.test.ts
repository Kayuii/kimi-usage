import { strict as assert } from 'assert';
import { MemorySecretStorage } from './mocks/vscode';
import {
  deleteApiKey,
  deleteOAuth,
  fmtHours,
  fmtTokens,
  readApiKey,
  readOAuth,
  toInt,
  writeApiKey,
  writeOAuth
} from '../src/utils';
import { KimiOAuthCredentials } from '../src/types';

describe('utils.toInt', () => {
  it('parses integers', () => {
    assert.equal(toInt('42'), 42);
    assert.equal(toInt('0'), 0);
  });
  it('returns 0 for invalid input', () => {
    assert.equal(toInt(undefined), 0);
    assert.equal(toInt(''), 0);
    assert.equal(toInt('abc'), 0);
  });
});

describe('utils.fmtHours', () => {
  it('formats sub-hour as minutes', () => {
    assert.equal(fmtHours(0.5), '30m');
    assert.equal(fmtHours(0.1), '6m');
  });
  it('formats hours below a day', () => {
    assert.equal(fmtHours(5), '5h');
    assert.equal(fmtHours(23.4), '23h');
  });
  it('formats multi-day spans', () => {
    assert.equal(fmtHours(25), '1d 1h');
    assert.equal(fmtHours(168), '7d 0h');
  });
});

describe('utils.fmtTokens', () => {
  it('keeps small numbers verbatim', () => {
    assert.equal(fmtTokens(0), '0');
    assert.equal(fmtTokens(999), '999');
  });
  it('formats thousands with one decimal', () => {
    assert.equal(fmtTokens(1234), '1.2k');
    assert.equal(fmtTokens(99500), '99.5k');
  });
  it('formats millions with one decimal', () => {
    assert.equal(fmtTokens(1_500_000), '1.5M');
  });
});

describe('utils.SecretStorage helpers', () => {
  it('roundtrips an API key', async () => {
    const s = new MemorySecretStorage();
    assert.equal(await readApiKey(s as any), undefined);
    await writeApiKey(s as any, 'sk-abc');
    assert.equal(await readApiKey(s as any), 'sk-abc');
    await deleteApiKey(s as any);
    assert.equal(await readApiKey(s as any), undefined);
  });

  it('roundtrips OAuth credentials as JSON', async () => {
    const s = new MemorySecretStorage();
    const creds: KimiOAuthCredentials = {
      accessToken: 'a', refreshToken: 'r', tokenType: 'Bearer',
      expiresAt: 1234567890, scope: 'kimi-code', deviceId: 'dev-1'
    };
    await writeOAuth(s as any, creds);
    assert.deepEqual(await readOAuth(s as any), creds);
    await deleteOAuth(s as any);
    assert.equal(await readOAuth(s as any), undefined);
  });

  it('returns undefined for corrupt JSON', async () => {
    const s = new MemorySecretStorage();
    await s.store('kimiUsage.oauthCredentials', 'not-json');
    assert.equal(await readOAuth(s as any), undefined);
  });
});

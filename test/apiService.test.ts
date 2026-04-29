import { strict as assert } from 'assert';
import nock from 'nock';
import { applyUsagesToState, fetchUsages } from '../src/apiService';
import { defaultQuotaState, KimiUsagesResponse } from '../src/types';

const HOST = 'https://api.kimi.com';
const PATH = '/coding/v1/usages';

describe('apiService.fetchUsages', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  it('sends Bearer token and KimiCLI User-Agent', async () => {
    const scope = nock(HOST, {
      reqheaders: {
        authorization: 'Bearer my-token',
        'user-agent': 'KimiCLI/1.6'
      }
    })
      .get(PATH)
      .reply(200, { usage: { limit: '100', used: '10' } });

    const result = await fetchUsages('my-token');
    assert.equal(result.ok, true);
    assert.equal(result.authFailed, false);
    assert.equal(result.data?.usage?.limit, '100');
    scope.done();
  });

  it('marks 401 as authFailed', async () => {
    nock(HOST).get(PATH).reply(401, 'unauthorized');
    const result = await fetchUsages('bad');
    assert.equal(result.ok, false);
    assert.equal(result.authFailed, true);
    assert.equal(result.status, 401);
  });

  it('marks 403 as authFailed', async () => {
    nock(HOST).get(PATH).reply(403, 'forbidden');
    const result = await fetchUsages('bad');
    assert.equal(result.ok, false);
    assert.equal(result.authFailed, true);
  });

  it('reports non-auth 4xx/5xx as plain error', async () => {
    nock(HOST).get(PATH).reply(500, 'boom');
    const result = await fetchUsages('any');
    assert.equal(result.ok, false);
    assert.equal(result.authFailed, false);
    assert.equal(result.status, 500);
    assert.match(result.error ?? '', /HTTP 500/);
  });

  it('reports invalid JSON as error', async () => {
    nock(HOST).get(PATH).reply(200, '{not-json');
    const result = await fetchUsages('any');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Invalid JSON response');
  });

  it('reports network errors', async () => {
    nock(HOST).get(PATH).replyWithError('boom');
    const result = await fetchUsages('any');
    assert.equal(result.ok, false);
    assert.equal(result.authFailed, false);
    assert.match(result.error ?? '', /boom/);
  });
});

describe('apiService.applyUsagesToState', () => {
  it('computes weeklyUsedPct and resetHours', () => {
    const state = defaultQuotaState();
    const future = new Date(Date.now() + 3_600_000 * 24).toISOString();
    const data: KimiUsagesResponse = {
      usage: { limit: '200', used: '50', resetTime: future },
      limits: [{ detail: { limit: '60', used: '10', remaining: '50', resetTime: future } }],
      parallel: { limit: '4' }
    };
    applyUsagesToState(state, data);
    assert.equal(state.weeklyLimit, 200);
    assert.equal(state.weeklyUsed, 50);
    assert.equal(state.weeklyUsedPct, 25);
    assert.ok(state.weeklyResetHours !== null && state.weeklyResetHours > 23.9 && state.weeklyResetHours <= 24);
    assert.equal(state.windowLimit, 60);
    assert.equal(state.windowRemaining, 50);
    assert.equal(state.parallelLimit, 4);
    assert.equal(state.error, null);
    assert.equal(state.authFailed, false);
  });

  it('handles missing fields gracefully', () => {
    const state = defaultQuotaState();
    applyUsagesToState(state, {});
    assert.equal(state.weeklyLimit, 0);
    assert.equal(state.weeklyUsedPct, null);
    assert.equal(state.error, null);
  });
});

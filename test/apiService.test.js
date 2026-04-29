"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const nock_1 = __importDefault(require("nock"));
const apiService_1 = require("../src/apiService");
const types_1 = require("../src/types");
const HOST = 'https://api.kimi.com';
const PATH = '/coding/v1/usages';
describe('apiService.fetchUsages', () => {
    beforeEach(() => {
        nock_1.default.cleanAll();
    });
    it('sends Bearer token and KimiCLI User-Agent', async () => {
        const scope = (0, nock_1.default)(HOST, {
            reqheaders: {
                authorization: 'Bearer my-token',
                'user-agent': 'KimiCLI/1.6'
            }
        })
            .get(PATH)
            .reply(200, { usage: { limit: '100', used: '10' } });
        const result = await (0, apiService_1.fetchUsages)('my-token');
        assert_1.strict.equal(result.ok, true);
        assert_1.strict.equal(result.authFailed, false);
        assert_1.strict.equal(result.data?.usage?.limit, '100');
        scope.done();
    });
    it('marks 401 as authFailed', async () => {
        (0, nock_1.default)(HOST).get(PATH).reply(401, 'unauthorized');
        const result = await (0, apiService_1.fetchUsages)('bad');
        assert_1.strict.equal(result.ok, false);
        assert_1.strict.equal(result.authFailed, true);
        assert_1.strict.equal(result.status, 401);
    });
    it('marks 403 as authFailed', async () => {
        (0, nock_1.default)(HOST).get(PATH).reply(403, 'forbidden');
        const result = await (0, apiService_1.fetchUsages)('bad');
        assert_1.strict.equal(result.ok, false);
        assert_1.strict.equal(result.authFailed, true);
    });
    it('reports non-auth 4xx/5xx as plain error', async () => {
        (0, nock_1.default)(HOST).get(PATH).reply(500, 'boom');
        const result = await (0, apiService_1.fetchUsages)('any');
        assert_1.strict.equal(result.ok, false);
        assert_1.strict.equal(result.authFailed, false);
        assert_1.strict.equal(result.status, 500);
        assert_1.strict.match(result.error ?? '', /HTTP 500/);
    });
    it('reports invalid JSON as error', async () => {
        (0, nock_1.default)(HOST).get(PATH).reply(200, '{not-json');
        const result = await (0, apiService_1.fetchUsages)('any');
        assert_1.strict.equal(result.ok, false);
        assert_1.strict.equal(result.error, 'Invalid JSON response');
    });
    it('reports network errors', async () => {
        (0, nock_1.default)(HOST).get(PATH).replyWithError('boom');
        const result = await (0, apiService_1.fetchUsages)('any');
        assert_1.strict.equal(result.ok, false);
        assert_1.strict.equal(result.authFailed, false);
        assert_1.strict.match(result.error ?? '', /boom/);
    });
});
describe('apiService.applyUsagesToState', () => {
    it('computes weeklyUsedPct and resetHours', () => {
        const state = (0, types_1.defaultQuotaState)();
        const future = new Date(Date.now() + 3600000 * 24).toISOString();
        const data = {
            usage: { limit: '200', used: '50', resetTime: future },
            limits: [{ detail: { limit: '60', used: '10', remaining: '50', resetTime: future } }],
            parallel: { limit: '4' }
        };
        (0, apiService_1.applyUsagesToState)(state, data);
        assert_1.strict.equal(state.weeklyLimit, 200);
        assert_1.strict.equal(state.weeklyUsed, 50);
        assert_1.strict.equal(state.weeklyUsedPct, 25);
        assert_1.strict.ok(state.weeklyResetHours !== null && state.weeklyResetHours > 23.9 && state.weeklyResetHours <= 24);
        assert_1.strict.equal(state.windowLimit, 60);
        assert_1.strict.equal(state.windowRemaining, 50);
        assert_1.strict.equal(state.parallelLimit, 4);
        assert_1.strict.equal(state.error, null);
        assert_1.strict.equal(state.authFailed, false);
    });
    it('handles missing fields gracefully', () => {
        const state = (0, types_1.defaultQuotaState)();
        (0, apiService_1.applyUsagesToState)(state, {});
        assert_1.strict.equal(state.weeklyLimit, 0);
        assert_1.strict.equal(state.weeklyUsedPct, null);
        assert_1.strict.equal(state.error, null);
    });
});
//# sourceMappingURL=apiService.test.js.map
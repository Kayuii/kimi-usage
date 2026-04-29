"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const nock_1 = __importDefault(require("nock"));
const vscode_1 = require("./mocks/vscode");
const oauthService_1 = require("../src/oauthService");
const utils_1 = require("../src/utils");
const HOST = 'https://auth.kimi.com';
const DEVICE_PATH = '/api/oauth/device_authorization';
const TOKEN_PATH = '/api/oauth/token';
beforeEach(() => nock_1.default.cleanAll());
describe('oauthService.newDeviceId', () => {
    it('produces a UUID-shaped string', () => {
        const id = (0, oauthService_1.newDeviceId)();
        assert_1.strict.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
});
describe('oauthService.requestDeviceCode', () => {
    it('returns the parsed payload on 200', async () => {
        (0, nock_1.default)(HOST).post(DEVICE_PATH).reply(200, {
            device_code: 'dc', user_code: 'ABCD-EFGH',
            verification_uri: 'https://auth.kimi.com/device',
            expires_in: 600, interval: 5
        });
        const out = await (0, oauthService_1.requestDeviceCode)('dev-1');
        assert_1.strict.equal(out.device_code, 'dc');
        assert_1.strict.equal(out.user_code, 'ABCD-EFGH');
    });
    it('throws when status is non-200', async () => {
        (0, nock_1.default)(HOST).post(DEVICE_PATH).reply(500, 'oops');
        await assert_1.strict.rejects((0, oauthService_1.requestDeviceCode)('dev-1'), /HTTP 500/);
    });
    it('throws when required fields are missing', async () => {
        (0, nock_1.default)(HOST).post(DEVICE_PATH).reply(200, { user_code: 'X' });
        await assert_1.strict.rejects((0, oauthService_1.requestDeviceCode)('dev-1'), /missing required fields/);
    });
});
describe('oauthService.exchangeDeviceCode', () => {
    it('returns pending for authorization_pending', async () => {
        (0, nock_1.default)(HOST).post(TOKEN_PATH).reply(200, { error: 'authorization_pending' });
        const out = await (0, oauthService_1.exchangeDeviceCode)('dev-1', 'dc');
        assert_1.strict.equal(out.kind, 'pending');
    });
    it('returns pending for slow_down', async () => {
        (0, nock_1.default)(HOST).post(TOKEN_PATH).reply(200, { error: 'slow_down' });
        const out = await (0, oauthService_1.exchangeDeviceCode)('dev-1', 'dc');
        assert_1.strict.equal(out.kind, 'pending');
    });
    it('returns failed for other errors', async () => {
        (0, nock_1.default)(HOST).post(TOKEN_PATH).reply(200, { error: 'access_denied', error_description: 'no' });
        const out = await (0, oauthService_1.exchangeDeviceCode)('dev-1', 'dc');
        assert_1.strict.equal(out.kind, 'failed');
        if (out.kind === 'failed')
            assert_1.strict.match(out.error, /access_denied/);
    });
    it('returns success and maps fields to credentials', async () => {
        (0, nock_1.default)(HOST).post(TOKEN_PATH).reply(200, {
            access_token: 'at', refresh_token: 'rt',
            token_type: 'Bearer', expires_in: 3600, scope: 'kimi-code'
        });
        const out = await (0, oauthService_1.exchangeDeviceCode)('dev-1', 'dc');
        assert_1.strict.equal(out.kind, 'success');
        if (out.kind === 'success') {
            assert_1.strict.equal(out.creds.accessToken, 'at');
            assert_1.strict.equal(out.creds.refreshToken, 'rt');
            assert_1.strict.equal(out.creds.deviceId, 'dev-1');
            const now = Math.floor(Date.now() / 1000);
            assert_1.strict.ok(out.creds.expiresAt - now > 3500 && out.creds.expiresAt - now <= 3600);
        }
    });
});
describe('oauthService.ensureFreshToken', () => {
    const baseCreds = (overrides = {}) => ({
        accessToken: 'old-at', refreshToken: 'rt', tokenType: 'Bearer',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        scope: 'kimi-code', deviceId: 'dev-1',
        ...overrides
    });
    it('returns undefined when no credentials are stored', async () => {
        const s = new vscode_1.MemorySecretStorage();
        const tok = await (0, oauthService_1.ensureFreshToken)(s);
        assert_1.strict.equal(tok, undefined);
    });
    it('returns the existing token when not near expiry', async () => {
        const s = new vscode_1.MemorySecretStorage();
        await (0, utils_1.writeOAuth)(s, baseCreds());
        const tok = await (0, oauthService_1.ensureFreshToken)(s);
        assert_1.strict.equal(tok, 'old-at');
    });
    it('refreshes when within the threshold and persists the new creds', async () => {
        const s = new vscode_1.MemorySecretStorage();
        await (0, utils_1.writeOAuth)(s, baseCreds({ expiresAt: Math.floor(Date.now() / 1000) + 60 }));
        (0, nock_1.default)(HOST).post(TOKEN_PATH).reply(200, {
            access_token: 'new-at', refresh_token: 'new-rt',
            token_type: 'Bearer', expires_in: 3600, scope: 'kimi-code'
        });
        const tok = await (0, oauthService_1.ensureFreshToken)(s);
        assert_1.strict.equal(tok, 'new-at');
        const stored = await (0, utils_1.readOAuth)(s);
        assert_1.strict.equal(stored?.accessToken, 'new-at');
        assert_1.strict.equal(stored?.refreshToken, 'new-rt');
    });
    it('clears credentials and returns undefined when refresh is rejected', async () => {
        const s = new vscode_1.MemorySecretStorage();
        await (0, utils_1.writeOAuth)(s, baseCreds({ expiresAt: Math.floor(Date.now() / 1000) + 60 }));
        (0, nock_1.default)(HOST).post(TOKEN_PATH).reply(401, 'unauthorized');
        const tok = await (0, oauthService_1.ensureFreshToken)(s);
        assert_1.strict.equal(tok, undefined);
        assert_1.strict.equal(await (0, utils_1.readOAuth)(s), undefined);
    });
});
//# sourceMappingURL=oauthService.test.js.map
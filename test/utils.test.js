"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const vscode_1 = require("./mocks/vscode");
const utils_1 = require("../src/utils");
describe('utils.toInt', () => {
    it('parses integers', () => {
        assert_1.strict.equal((0, utils_1.toInt)('42'), 42);
        assert_1.strict.equal((0, utils_1.toInt)('0'), 0);
    });
    it('returns 0 for invalid input', () => {
        assert_1.strict.equal((0, utils_1.toInt)(undefined), 0);
        assert_1.strict.equal((0, utils_1.toInt)(''), 0);
        assert_1.strict.equal((0, utils_1.toInt)('abc'), 0);
    });
});
describe('utils.fmtHours', () => {
    it('formats sub-hour as minutes', () => {
        assert_1.strict.equal((0, utils_1.fmtHours)(0.5), '30m');
        assert_1.strict.equal((0, utils_1.fmtHours)(0.1), '6m');
    });
    it('formats hours below a day', () => {
        assert_1.strict.equal((0, utils_1.fmtHours)(5), '5h');
        assert_1.strict.equal((0, utils_1.fmtHours)(23.4), '23h');
    });
    it('formats multi-day spans', () => {
        assert_1.strict.equal((0, utils_1.fmtHours)(25), '1d 1h');
        assert_1.strict.equal((0, utils_1.fmtHours)(168), '7d 0h');
    });
});
describe('utils.fmtTokens', () => {
    it('keeps small numbers verbatim', () => {
        assert_1.strict.equal((0, utils_1.fmtTokens)(0), '0');
        assert_1.strict.equal((0, utils_1.fmtTokens)(999), '999');
    });
    it('formats thousands with one decimal', () => {
        assert_1.strict.equal((0, utils_1.fmtTokens)(1234), '1.2k');
        assert_1.strict.equal((0, utils_1.fmtTokens)(99500), '99.5k');
    });
    it('formats millions with one decimal', () => {
        assert_1.strict.equal((0, utils_1.fmtTokens)(1500000), '1.5M');
    });
});
describe('utils.SecretStorage helpers', () => {
    it('roundtrips an API key', async () => {
        const s = new vscode_1.MemorySecretStorage();
        assert_1.strict.equal(await (0, utils_1.readApiKey)(s), undefined);
        await (0, utils_1.writeApiKey)(s, 'sk-abc');
        assert_1.strict.equal(await (0, utils_1.readApiKey)(s), 'sk-abc');
        await (0, utils_1.deleteApiKey)(s);
        assert_1.strict.equal(await (0, utils_1.readApiKey)(s), undefined);
    });
    it('roundtrips OAuth credentials as JSON', async () => {
        const s = new vscode_1.MemorySecretStorage();
        const creds = {
            accessToken: 'a', refreshToken: 'r', tokenType: 'Bearer',
            expiresAt: 1234567890, scope: 'kimi-code', deviceId: 'dev-1'
        };
        await (0, utils_1.writeOAuth)(s, creds);
        assert_1.strict.deepEqual(await (0, utils_1.readOAuth)(s), creds);
        await (0, utils_1.deleteOAuth)(s);
        assert_1.strict.equal(await (0, utils_1.readOAuth)(s), undefined);
    });
    it('returns undefined for corrupt JSON', async () => {
        const s = new vscode_1.MemorySecretStorage();
        await s.store('kimiUsage.oauthCredentials', 'not-json');
        assert_1.strict.equal(await (0, utils_1.readOAuth)(s), undefined);
    });
});
//# sourceMappingURL=utils.test.js.map
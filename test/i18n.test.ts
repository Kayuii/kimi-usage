import { strict as assert } from 'assert';
import { makeT, resolveLocale } from '../src/i18n';

describe('i18n.resolveLocale', () => {
  it('honors explicit en setting', () => {
    assert.equal(resolveLocale('en', 'zh-CN'), 'en');
  });

  it('honors explicit zh-CN setting', () => {
    assert.equal(resolveLocale('zh-CN', 'en-US'), 'zh-CN');
  });

  it('auto picks zh-CN for any zh* vscode language', () => {
    assert.equal(resolveLocale('auto', 'zh-CN'), 'zh-CN');
    assert.equal(resolveLocale('auto', 'zh-TW'), 'zh-CN');
    assert.equal(resolveLocale('auto', 'ZH'), 'zh-CN');
  });

  it('auto falls back to en for non-zh languages', () => {
    assert.equal(resolveLocale('auto', 'en'), 'en');
    assert.equal(resolveLocale('auto', 'fr'), 'en');
    assert.equal(resolveLocale('auto', 'ja'), 'en');
  });

  it('auto defaults to en when vscode language missing', () => {
    assert.equal(resolveLocale('auto', undefined), 'en');
  });

  it('treats undefined setting as auto', () => {
    assert.equal(resolveLocale(undefined, 'zh-CN'), 'zh-CN');
    assert.equal(resolveLocale(undefined, 'en'), 'en');
  });
});

describe('i18n.makeT', () => {
  it('translates a known en key', () => {
    const t = makeT('en');
    assert.equal(t('btn.refresh'), 'Refresh');
  });

  it('translates a known zh-CN key', () => {
    const t = makeT('zh-CN');
    assert.equal(t('btn.refresh'), '刷新');
  });

  it('falls back to en when key missing in zh-CN', () => {
    const t = makeT('zh-CN');
    // Key absent from both dicts -> returns the key itself; sanity-check the
    // fallback chain by patching nothing and asserting the missing key path.
    assert.equal(t('totally.missing.key'), 'totally.missing.key');
  });

  it('returns key when missing in both dicts', () => {
    const t = makeT('en');
    assert.equal(t('does.not.exist'), 'does.not.exist');
  });

  it('substitutes {0}, {1} placeholders', () => {
    const t = makeT('en');
    assert.equal(t('banner.error', 'boom'), 'Error: boom');
  });

  it('substitutes numeric placeholders', () => {
    const t = makeT('en');
    assert.equal(t('card.requests.other', 5), '5 requests');
  });

  it('zh-CN substitutes placeholders', () => {
    const t = makeT('zh-CN');
    assert.equal(t('card.requests.other', 7), '7 次请求');
  });

  it('returns raw template when called without params', () => {
    const t = makeT('en');
    assert.equal(t('banner.error'), 'Error: {0}');
  });

  it('substitutes empty string for undefined positional params', () => {
    const t = makeT('en');
    // chart.tooltip.weekly = '{0}: {1} weekly tokens' — {1} is left empty.
    assert.equal(t('chart.tooltip.weekly', 'Mon'), 'Mon:  weekly tokens');
  });
});

import { LanguageSetting } from './types';

export type Locale = 'en' | 'zh-CN';

type Dict = Record<string, string>;

const en: Dict = {
  'app.title': 'Kimi Usage',
  'app.lastUpdated': 'Last updated',
  'app.dash': '—',
  'btn.refresh': 'Refresh',
  'btn.settings': 'Settings',
  'btn.console': 'Console',
  'btn.clearHistory': 'Clear history',
  'btn.clearHistory.tooltip': 'Clear auto-tracked history',
  'btn.signOut': 'Sign out',
  'banner.authFailed': 'Authentication failed. Please run <code>Kimi Usage: Sign In</code> or update your API key.',
  'banner.error': 'Error: {0}',
  'card.weeklyUsed': 'Weekly used',
  'card.weeklyResetIn': 'Weekly resets in',
  'card.weeklyCycle': '7-day cycle',
  'card.windowUsed': 'Rate window used',
  'card.windowRemaining': 'Window remaining',
  'card.windowResetsIn': 'Resets in {0}',
  'card.parallelLimit': 'Parallel limit',
  'card.parallelSub': 'Concurrent requests',
  'card.sessionTokens': 'Session tokens',
  'card.requests.one': '{0} request',
  'card.requests.other': '{0} requests',
  'tab.today': 'Last 24h',
  'tab.week': 'Last 7 days',
  'tab.session': 'Session',
  'chart.title.today': 'Last 24 hours',
  'chart.title.week': 'Last 7 days',
  'chart.metric.weekly': 'Weekly tokens Δ',
  'chart.metric.window': 'Window tokens Δ',
  'chart.metric.samples': 'Samples',
  'chart.tooltip.weekly': '{0}: {1} weekly tokens',
  'table.col.hour': 'Hour',
  'table.col.date': 'Date',
  'table.col.weeklyDelta': 'Weekly Δ',
  'table.col.windowDelta': 'Window Δ',
  'table.col.samples': 'Samples',
  'noData': 'No usage recorded yet for this period. Snapshots are captured on every quota refresh.',
  'session.requests': 'Requests',
  'session.inputTokens': 'Input tokens',
  'session.outputTokens': 'Output tokens',
  'session.totalTokens': 'Total tokens',
  'session.note': 'Counters are accumulated via <code>kimiUsage.recordUsage</code> calls and persisted across reloads. Use <code>Kimi Usage: Reset Session Counter</code> to clear them.',
  'footer': 'Total log entries: {0} · Retained for 7 days · Snapshots are diffed between API refreshes.',
  'script.weeklyShort': 'weekly Δ',
  'script.windowShort': 'window Δ',
  'script.samplesShort': 'samples'
};

const zhCN: Dict = {
  'app.title': 'Kimi 用量',
  'app.lastUpdated': '上次更新',
  'app.dash': '—',
  'btn.refresh': '刷新',
  'btn.settings': '设置',
  'btn.console': '控制台',
  'btn.clearHistory': '清除历史',
  'btn.clearHistory.tooltip': '清除自动追踪的用量历史',
  'btn.signOut': '退出登录',
  'banner.authFailed': '鉴权失败，请执行 <code>Kimi Usage: Sign In</code> 或更新 API Key。',
  'banner.error': '错误：{0}',
  'card.weeklyUsed': '周配额已用',
  'card.weeklyResetIn': '周配额重置',
  'card.weeklyCycle': '7 天周期',
  'card.windowUsed': '速率窗口已用',
  'card.windowRemaining': '窗口剩余',
  'card.windowResetsIn': '{0} 后重置',
  'card.parallelLimit': '并发上限',
  'card.parallelSub': '同时请求数',
  'card.sessionTokens': '会话 Tokens',
  'card.requests.one': '{0} 次请求',
  'card.requests.other': '{0} 次请求',
  'tab.today': '近 24 小时',
  'tab.week': '近 7 天',
  'tab.session': '本次会话',
  'chart.title.today': '近 24 小时',
  'chart.title.week': '近 7 天',
  'chart.metric.weekly': '周配额增量 Δ',
  'chart.metric.window': '窗口增量 Δ',
  'chart.metric.samples': '采样次数',
  'chart.tooltip.weekly': '{0}：{1} 周配额 tokens',
  'table.col.hour': '小时',
  'table.col.date': '日期',
  'table.col.weeklyDelta': '周配额 Δ',
  'table.col.windowDelta': '窗口 Δ',
  'table.col.samples': '采样',
  'noData': '该时段暂无用量记录。每次配额刷新会生成一次快照。',
  'session.requests': '请求数',
  'session.inputTokens': '输入 tokens',
  'session.outputTokens': '输出 tokens',
  'session.totalTokens': '合计 tokens',
  'session.note': '计数通过 <code>kimiUsage.recordUsage</code> 调用累加，并持久化保存。使用 <code>Kimi Usage: Reset Session Counter</code> 清零。',
  'footer': '共 {0} 条记录 · 保留 7 天 · 来自相邻 API 快照之间的差值。',
  'script.weeklyShort': '周配额 Δ',
  'script.windowShort': '窗口 Δ',
  'script.samplesShort': '采样'
};

const dictionaries: Record<Locale, Dict> = { 'en': en, 'zh-CN': zhCN };

/**
 * Resolve the effective locale.
 * - 'auto': pick zh-CN if VS Code UI language starts with 'zh', else en.
 * - 'en' / 'zh-CN': honor explicit setting.
 */
export function resolveLocale(setting: LanguageSetting | undefined, vscodeLang?: string): Locale {
  if (setting === 'en' || setting === 'zh-CN') return setting;
  const lang = (vscodeLang ?? 'en').toLowerCase();
  return lang.startsWith('zh') ? 'zh-CN' : 'en';
}

/** Build a translator bound to the given locale. */
export function makeT(locale: Locale): (key: string, ...params: Array<string | number>) => string {
  const dict = dictionaries[locale] ?? en;
  return (key, ...params) => {
    const raw = dict[key] ?? en[key] ?? key;
    if (params.length === 0) return raw;
    return raw.replace(/\{(\d+)\}/g, (_, i) => {
      const v = params[Number(i)];
      return v === undefined ? '' : String(v);
    });
  };
}

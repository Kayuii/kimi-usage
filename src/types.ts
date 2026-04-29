// Kimi API response types and internal state shapes.

export interface KimiUsageDetail {
  limit?: string;
  used?: string;
  remaining?: string;
  resetTime?: string;
}

export interface KimiUsagesResponse {
  usage?: KimiUsageDetail;
  limits?: Array<{ detail?: KimiUsageDetail }>;
  parallel?: { limit?: string };
}

export interface QuotaState {
  weeklyLimit: number | null;
  weeklyUsed: number | null;
  weeklyUsedPct: number | null;
  weeklyResetHours: number | null;
  weeklyResetAt: number | null;

  windowLimit: number | null;
  windowUsed: number | null;
  windowRemaining: number | null;
  windowResetAt: number | null;

  parallelLimit: number | null;

  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionRequests: number;

  lastUpdated: number | null;
  error: string | null;
  authFailed: boolean;
}

export type AuthMode = 'oauth' | 'apiKey' | 'none';

export interface KimiConfig {
  refreshIntervalMinutes: number;
}

export interface KimiOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: number;
  scope: string;
  deviceId: string;
}

export interface KimiDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export function defaultQuotaState(): QuotaState {
  return {
    weeklyLimit: null,
    weeklyUsed: null,
    weeklyUsedPct: null,
    weeklyResetHours: null,
    weeklyResetAt: null,
    windowLimit: null,
    windowUsed: null,
    windowRemaining: null,
    windowResetAt: null,
    parallelLimit: null,
    sessionInputTokens: 0,
    sessionOutputTokens: 0,
    sessionRequests: 0,
    lastUpdated: null,
    error: null,
    authFailed: false
  };
}

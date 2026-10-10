import { ApiError } from './domain.ts';

// In-process fixed-window limiter. The deployment runs exactly one Node process per container
// (plus a separate worker subprocess that does not serve HTTP), so a single-process window is
// sufficient and needs no extra table or Redis. A periodic sweep prevents unbounded map growth.
type Bucket = { count: number; expires: number };
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export type RateRule = {
  action: string;
  windowMs: number;
  max: number;
};

// Defaults protect the production service; SKILLHUB_RATE_LIMIT_* overrides let QA raise ceilings
// so integration suites that create many uploads/notes in one container are not throttled.
function limit(action: string, windowMs: number, def: number, envKey?: string): RateRule {
  const raw = envKey ? process.env[envKey] : undefined;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return { action, windowMs, max: Number.isInteger(parsed) && parsed > 0 ? parsed : def };
}

export const RATE_RULES = {
  messagePost: limit('message-post', 60_000, 10, 'SKILLHUB_RATE_LIMIT_MESSAGE'),
  messagePostHour: limit('message-post-hour', 3_600_000, 60, 'SKILLHUB_RATE_LIMIT_MESSAGE_HOUR'),
  aiRetry: limit('ai-retry', 60_000, 6, 'SKILLHUB_RATE_LIMIT_AI_RETRY'),
  upload: limit('upload', 60_000, 12, 'SKILLHUB_RATE_LIMIT_UPLOAD'),
  authAttempt: limit('auth-attempt', 300_000, 30, 'SKILLHUB_RATE_LIMIT_AUTH'),
  authExchange: limit('auth-exchange', 300_000, 30, 'SKILLHUB_RATE_LIMIT_AUTH'),
} satisfies Record<string, RateRule>;

/** Throws ApiError(429) when the caller exceeds the rule; otherwise records the hit. */
export function enforceRateLimit(rule: RateRule, keyParts: string[]) {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.expires <= now) buckets.delete(k);
    lastSweep = now;
  }
  const key = rule.action + ':' + keyParts.join('|');
  const bucket = buckets.get(key);
  if (!bucket || bucket.expires <= now) {
    buckets.set(key, { count: 1, expires: now + rule.windowMs });
    return;
  }
  if (bucket.count >= rule.max) throw new ApiError(429, 'rate_limited', '操作过于频繁，请稍后再试');
  bucket.count += 1;
}

/** Best-effort network identity for unauthenticated endpoints. */
export function clientKey(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

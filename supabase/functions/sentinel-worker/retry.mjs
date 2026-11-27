export const MAX_ATTEMPTS = 4;

export function retryAfterSeconds(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
}

export function isTransientStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

export function retryDelay(attempt, retryAfter = 0, random = Math.random) {
  const backoff = Math.min(900, 60 * 2 ** Math.max(0, attempt - 1));
  return Math.min(86400, Math.max(retryAfter, backoff + Math.floor(random() * 30)));
}

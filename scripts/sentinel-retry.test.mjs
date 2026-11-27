import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isTransientStatus, MAX_ATTEMPTS, retryAfterSeconds, retryDelay } from '../supabase/functions/sentinel-worker/retry.mjs';

test('Retry-After accepts seconds and HTTP dates', () => {
  const now = Date.UTC(2026, 10, 27, 12);
  assert.equal(retryAfterSeconds('120', now), 120);
  assert.equal(retryAfterSeconds(new Date(now + 35_000).toUTCString(), now), 35);
  assert.equal(retryAfterSeconds(new Date(now - 35_000).toUTCString(), now), 0);
  assert.equal(retryAfterSeconds('invalid', now), 0);
});

test('rate limits and transient failures get bounded, jittered retries', () => {
  assert.equal(MAX_ATTEMPTS, 4);
  assert.equal(isTransientStatus(429), true);
  assert.equal(isTransientStatus(503), true);
  assert.equal(isTransientStatus(403), false);
  assert.equal(retryDelay(1, 0, () => 0), 60);
  assert.equal(retryDelay(2, 0, () => 0.5), 135);
  assert.equal(retryDelay(3, 600, () => 0), 600);
  assert.equal(retryDelay(4, 999999, () => 0), 86400);
});

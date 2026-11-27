import { strict as assert } from 'node:assert';
import test from 'node:test';
import { allowedFeedUrl, canonicalUrl, normalizeEvidence } from '../supabase/functions/sentinel-worker/evidence.mjs';

test('normalization preserves attribution and deduplicates tracking and query ordering', () => {
  const result = normalizeEvidence([
    {url:'https://example.com/report?b=2&a=3&utm_source=x#section',title:'Report',published:'20261127T132000Z',source:'Example'},
    {url:'https://example.com/report?a=3&b=2',title:'Copy'},
    {url:'javascript:alert(1)',title:'Invalid'},
  ], 'gdelt', 'other', '2026-11-27T14:00:00.000Z');
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://example.com/report?a=3&b=2');
  assert.equal(result[0].published, '2026-11-27T13:20:00.000Z');
  assert.equal(result[0].source, 'Example');
  assert.equal(result[0].provider, 'gdelt');
  assert.equal(canonicalUrl('https://user:pass@example.com/'), null);
});

test('configured feeds require an exact allowlisted HTTPS hostname', () => {
  const hosts = new Set(['feeds.example.com', '127.0.0.1']);
  assert.ok(allowedFeedUrl('https://feeds.example.com/news.xml', hosts));
  assert.equal(allowedFeedUrl('https://feeds.example.com.evil.com/news.xml', hosts), null);
  assert.equal(allowedFeedUrl('http://feeds.example.com/news.xml', hosts), null);
  assert.equal(allowedFeedUrl('https://feeds.example.com:8443/news.xml', hosts), null);
  assert.equal(allowedFeedUrl('https://127.0.0.1/', hosts), null);
});

test('RSS and Atom feeds retain source attribution and reject XML declarations with external entities', async () => {
  const {parseFeed} = await import('../supabase/functions/sentinel-worker/evidence.mjs');
  const origin = 'https://feeds.example.com/feed.xml';
  const rss = '<rss><channel><item><title>A &amp; B</title><link>https://example.com/news</link><source>Example</source></item></channel></rss>';
  const atom = '<feed><entry><title>Filing</title><link rel="self" href="/entry"/><link rel="alternate" href="/filing"/><updated>2026-11-27</updated></entry></feed>';
  assert.equal(parseFeed(rss, origin)[0].title, 'A & B');
  assert.equal(parseFeed(rss, origin)[0].source, 'Example');
  assert.equal(parseFeed(atom, origin)[0].url, 'https://feeds.example.com/filing');
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+rss, origin), /Unsupported/);
});

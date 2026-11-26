import test from 'node:test';import assert from 'node:assert/strict';import {normalize,run} from './sentinel-worker.mjs';
test('deduplicates tracking variants and rejects unsafe URLs',()=>{assert.equal(normalize([{url:'https://example.com/a?utm_source=x'},{url:'https://example.com/a#top'},{url:'javascript:alert(1)'},{url:'https://user:pass@example.com'}]).length,1)});
test('missing configuration fails closed',async()=>{await assert.rejects(run({}),/requires/)});

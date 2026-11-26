import test from 'node:test';import assert from 'node:assert/strict';import {normalize,run,selectProvider,GdeltProvider} from './sentinel-worker.mjs';
test('deduplicates tracking variants and rejects unsafe URLs',()=>{assert.equal(normalize([{url:'https://example.com/a?utm_source=x'},{url:'https://example.com/a#top'},{url:'javascript:alert(1)'},{url:'https://user:pass@example.com'}]).length,1)});
test('missing configuration fails closed',async()=>{await assert.rejects(run({}),/requires/)});
test('GDELT is default without a key',()=>assert.ok(selectProvider({}) instanceof GdeltProvider));
test('explicit Brave requires a key',()=>assert.throws(()=>selectProvider({SENTINEL_SEARCH_PROVIDER:'brave'}),/key/));
test('GDELT maps evidence',async()=>{const p=new GdeltProvider(async u=>{assert.equal(u.hostname,'api.gdeltproject.org');assert.equal(u.searchParams.get('query'),'"Acme Corp"');return new Response(JSON.stringify({articles:[{url:'https://example.com/news',title:'News',seendate:'20261126T000000Z'}]}))});const items=await p.search({name:'Acme Corp'});assert.equal(items[0].provider,'gdelt');assert.equal(items[0].published,'20261126T000000Z')});
test('GDELT errors are not empty success',async()=>{await assert.rejects(new GdeltProvider(async()=>new Response('',{status:429})).search({name:'Acme'}),/429/)});

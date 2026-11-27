import {strict as assert} from 'node:assert';
import test from 'node:test';
import {parseCsv,suggestMapping,validateRows,validateXlsxArchive} from '../news-watch/bulk.mjs';

test('import maps columns, preserves vendor identifier text and validates outcomes',()=>{
  const [header,...rows]=parseCsv('Vendor ID,Company Name,Frequency,Active\r\n00001,"Acme, Inc",weekly,yes\n2,Duplicate,daily,no\n3,Faulty,hourly,yes');
  const preview=validateRows(rows,suggestMapping(header),{category:'Suppliers',frequency:'manual',active:true},new Set(['company\u0000duplicate']),false);
  assert.equal(preview[0].values.vendor_id,'00001');
  assert.equal(preview[0].values.name,'Acme, Inc');
  assert.equal(preview[1].status,'skip');
  assert.equal(preview[2].status,'invalid');
});

test('XLSX preflight rejects truncated or unrelated files',()=>{
  assert.throws(()=>validateXlsxArchive(new ArrayBuffer(5)),/archive/);
  assert.throws(()=>validateXlsxArchive(new ArrayBuffer(60)),/archive/);
});

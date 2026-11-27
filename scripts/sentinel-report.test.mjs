import { strict as assert } from 'node:assert';
import test from 'node:test';
import { validateReport } from '../supabase/functions/sentinel-worker/report.mjs';

const report = {
  summary:{text:'A filing was collected.',sources:[1]},
  developments:[{text:'A new filing appeared.',sources:[1],kind:'verified_fact'}],
  implications:[],
  risks:[{category:'financial_stability',severity:'high',direction:'unknown',confidence:'low',text:'Impact remains uncertain.',sources:[1]}],
  opportunities:[],
  recommendations:[],
  confidence:'low',
  limitations:['Only filing metadata was collected.'],
};

test('report validation keeps severity and confidence independent', () => {
  const result = validateReport(JSON.stringify(report), 1);
  assert.equal(result.risks[0].severity, 'high');
  assert.equal(result.risks[0].confidence, 'low');
  assert.deepEqual(result.developments[0].sources, [1]);
});

test('report validation refuses fabricated source numbers and unreferenced claims', () => {
  for (const sources of [[2], [], [0], ['1']]) {
    const altered = {...report, summary:{text:'Unsupported.',sources}};
    assert.throws(() => validateReport(JSON.stringify(altered), 1), /evidence reference/);
  }
});

test('missing claim types default conservatively and uncited summaries are omitted', () => {
  const result = validateReport(JSON.stringify({...report,
    summary:'Unsupported summary text.',
    developments:[{text:'A cited headline was reported.',sources:[1]}],
  }), 1);
  assert.equal(result.summary.text,'A cited headline was reported.');
  assert.equal(result.developments[0].kind,'reported_claim');
});

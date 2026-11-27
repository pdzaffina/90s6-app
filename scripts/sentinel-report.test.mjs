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
    const validated=validateReport(JSON.stringify(altered),1);
    assert.equal(validated.summary.text,report.developments[0].text);
    assert.deepEqual(validated.summary.sources,[1]);
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

test('recommendation metadata without an action leaves the cited report available', () => {
  const result=validateReport(JSON.stringify({...report,recommendations:[{
    rationale:'Potential trend',urgency:'Monitor',impact:'Potential disruption',role:'Analyst',sources:[1],
  }]}),1);
  assert.deepEqual(result.recommendations,[]);
  assert.equal(result.risks.length,1);
});

test('a risk without citations is omitted without discarding cited findings', () => {
  const result=validateReport(JSON.stringify({...report,risks:[
    report.risks[0],{...report.risks[0],category:'regulatory_legal',sources:[]},
  ]}),1);
  assert.equal(result.risks.length,1);
  assert.match(result.limitations.at(-1),/omitted/);
  assert.throws(()=>validateReport(JSON.stringify({...report,summary:'Uncited',developments:[],risks:[]}),1),/no statements/);
});

test('secondary evidence cannot support a verified-fact badge', () => {
  const output=validateReport(JSON.stringify(report),[{source_role:'secondary'}]);
  assert.equal(output.developments[0].kind,'reported_claim');
});

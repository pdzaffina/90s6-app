import { strict as assert } from 'node:assert';
import test from 'node:test';
import { investigationTerms } from '../supabase/functions/sentinel-worker/investigation.mjs';

test('model follow-up plans permit only bounded, relevant search topics', () => {
  const plan = {searches:[
    {topic:'https://example.com',relevance:100},
    {topic:'existing',relevance:98},
    {topic:'low relevance',relevance:48},
    {topic:'factory shutdown',relevance:92},
    {topic:'regulatory filing',relevance:100},
  ]};
  assert.deepEqual(investigationTerms(JSON.stringify(plan),new Set(['existing']),70,1),['factory shutdown']);
});

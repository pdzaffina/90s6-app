export const RISK_CATEGORIES = new Set([
  'financial_stability', 'operational_continuity', 'cybersecurity', 'regulatory_legal',
  'reputation', 'supply_chain', 'geopolitical', 'strategic_competitive', 'environmental_safety',
]);
const SEVERITY = new Set(['critical','high','moderate','low','informational','unknown']);
const DIRECTION = new Set(['improving','stable','deteriorating','unknown']);
const CONFIDENCE = new Set(['high','moderate','low','insufficient_evidence']);
const KIND = new Set(['verified_fact','reported_claim','ai_interpretation']);

function text(value, limit = 900) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function validateReport(raw, evidence) {
  const evidenceCount=Array.isArray(evidence) ? evidence.length : evidence;
  if (typeof raw !== 'string' || raw.length > 80_000) throw new Error('Invalid report response');
  const body = raw.trim().replace(/^```(?:json)?\s*\n/i, '').replace(/\n?```$/, '');
  const data = JSON.parse(body);
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Invalid report response');

  let omitted = false;
  const statement = item => {
    const content = text(item?.text);
    if (!content || !Array.isArray(item.sources) || !item.sources.length
        || item.sources.some(n => !Number.isInteger(n) || n < 1 || n > evidenceCount)) return null;
    return {text:content,sources:[...new Set(item.sources)].slice(0,12)};
  };
  const section = (value, limit, convert) => {
    if (!Array.isArray(value)) return [];
    return value.slice(0,limit).flatMap(item => {
      const parsed = convert(item);
      if (parsed) return [parsed];
      omitted = true;
      return [];
    });
  };
  const developments = section(data.developments,12,item => {
    const grounded = statement(item);
    if (!grounded) return null;
    let kind=KIND.has(item.kind) ? item.kind : 'reported_claim';
    if (kind==='verified_fact'&&Array.isArray(evidence)
        && !grounded.sources.some(number=>evidence[number-1]?.source_role==='primary')) {
      kind='reported_claim';
    }
    return {...grounded,kind};
  });
  const implications = section(data.implications,8,statement);
  const risks = section(data.risks,9,item => {
    const grounded = statement(item);
    if (!grounded || !RISK_CATEGORIES.has(item.category)) return null;
    return {
      ...grounded, category:item.category,
      severity:SEVERITY.has(item.severity) ? item.severity : 'unknown',
      direction:DIRECTION.has(item.direction) ? item.direction : 'unknown',
      confidence:CONFIDENCE.has(item.confidence) ? item.confidence : 'insufficient_evidence',
    };
  });
  const opportunities = section(data.opportunities,8,statement);
  const recommendations = section(data.recommendations,8,item => {
    const grounded = statement({text:item?.text ?? item?.action,sources:item?.sources});
    if (!grounded) return null;
    const rationale=text(item.rationale), urgency=text(item.urgency,80);
    const impact=text(item.impact), role=text(item.role,100);
    return rationale&&urgency&&impact&&role ? {...grounded,rationale,urgency,impact,role} : null;
  });

  let summary = statement(data.summary);
  if (!summary) {
    const fallback = developments[0] ?? implications[0] ?? risks[0] ?? opportunities[0];
    if (!fallback) throw new Error('Report has no statements with valid evidence references');
    summary = {text:fallback.text,sources:fallback.sources};
    omitted = true;
  }
  const limitations = section(data.limitations,7,item => text(item));
  if (omitted) limitations.push('Some model output was omitted because it lacked valid citations or required details.');

  return {
    version:1, summary, developments, implications, risks, opportunities, recommendations,
    confidence:CONFIDENCE.has(data.confidence) ? data.confidence : 'insufficient_evidence',
    limitations,
  };
}

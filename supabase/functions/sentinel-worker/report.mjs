export const RISK_CATEGORIES = new Set([
  'financial_stability', 'operational_continuity', 'cybersecurity', 'regulatory_legal',
  'reputation', 'supply_chain', 'geopolitical', 'strategic_competitive', 'environmental_safety',
]);
const SEVERITY = new Set(['critical','high','moderate','low','informational','unknown']);
const DIRECTION = new Set(['improving','stable','deteriorating','unknown']);
const CONFIDENCE = new Set(['high','moderate','low','insufficient_evidence']);
const KIND = new Set(['verified_fact','reported_claim','ai_interpretation']);

function text(value, limit = 900) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing report text');
  return value.trim().slice(0, limit);
}

export function validateReport(raw, evidenceCount) {
  if (typeof raw !== 'string' || raw.length > 80_000) throw new Error('Invalid report response');
  const body = raw.trim().replace(/^```(?:json)?\s*\n/i, '').replace(/\n?```$/, '');
  const data = JSON.parse(body);
  const sources = (value, required = true) => {
    if (!Array.isArray(value) || (required && !value.length)
        || value.some(n => !Number.isInteger(n) || n < 1 || n > evidenceCount)) {
      throw new Error('Invalid evidence reference');
    }
    return [...new Set(value)].slice(0, 12);
  };
  const list = (value, limit, convert) => {
    if (!Array.isArray(value)) throw new Error('Invalid report section');
    return value.slice(0, limit).map(convert);
  };
  const enums = (value, allowed) => {
    if (!allowed.has(value)) throw new Error('Invalid risk or classification label');
    return value;
  };
  const statement = item => ({text:text(item.text),sources:sources(item.sources)});
  const risk = item => ({
    ...statement(item),
    category: enums(item.category, RISK_CATEGORIES),
    severity: enums(item.severity, SEVERITY),
    direction: enums(item.direction, DIRECTION),
    confidence: enums(item.confidence, CONFIDENCE),
  });
  const developments=list(data.developments,12,item=>({
    ...statement(item),
    kind:item.kind==null?'reported_claim':enums(item.kind,KIND),
  }));
  // Some models send an uncited summary string. Use the first cited
  // development verbatim so the report never assigns invented citations.
  const summary=typeof data.summary==='string'&&developments.length
    ? {text:developments[0].text,sources:developments[0].sources}
    : statement(data.summary);
  return {
    version: 1,
    summary,
    developments,
    implications: list(data.implications, 8, statement),
    risks: list(data.risks, 9, risk),
    opportunities: list(data.opportunities, 8, statement),
    recommendations: list(data.recommendations, 8, item => {
      const action = item.text ?? item.action;
      if (typeof action !== 'string' || !action.trim()) return null;
      return {
        ...statement({text:action,sources:item.sources}),
        rationale:text(item.rationale), urgency:text(item.urgency,80),
        impact:text(item.impact), role:text(item.role,100),
      };
    }).filter(Boolean),
    confidence: enums(data.confidence, CONFIDENCE),
    limitations: list(data.limitations, 8, item => text(item)),
  };
}

export function investigationTerms(raw, knownTerms, minimumRelevance, limit) {
  const body = raw.trim().replace(/^```(?:json)?\s*\n/i, '').replace(/\n?```$/, '');
  const result = JSON.parse(body);
  if (!Array.isArray(result.searches)) throw new Error('Invalid investigation plan');
  const searches = [];
  for (const proposal of result.searches.slice(0, 8)) {
    if (typeof proposal?.topic !== 'string' || !Number.isFinite(proposal.relevance)
        || proposal.relevance < minimumRelevance || proposal.relevance > 100
        || /https?:|www\.|[/\\@]/i.test(proposal.topic)) continue;
    const topic = proposal.topic.replace(/[^\p{L}\p{N}\s.-]/gu, ' ').trim().replace(/\s+/g, ' ').slice(0, 55);
    const key = topic.toLowerCase();
    if (!topic || knownTerms.has(key)) continue;
    knownTerms.add(key);
    searches.push(topic);
    if (searches.length >= limit) break;
  }
  return searches;
}

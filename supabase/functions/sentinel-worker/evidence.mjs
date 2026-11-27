const TRACKING_PARAMETERS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);

export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMETERS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.href.length <= 2000 ? url.href : null;
  } catch {
    return null;
  }
}

export function publicationTimestamp(value) {
  if (!value) return null;
  const expanded = String(value).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
  const time = new Date(expanded);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

export function normalizeEvidence(items, provider, sourceClass, collectedAt = new Date().toISOString()) {
  const seen = new Set();
  const evidence = [];
  for (const item of items.slice(0, 100)) {
    const url = canonicalUrl(item.url);
    const title = String(item.title ?? '').trim().slice(0, 300);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    evidence.push({
      url,
      title,
      description: String(item.description ?? '').trim().slice(0, 800),
      published: publicationTimestamp(item.published),
      collected_at: collectedAt,
      source: String(item.source || new URL(url).hostname).slice(0, 200),
      provider,
      source_classification: sourceClass,
    });
    if (evidence.length >= 30) break;
  }
  return evidence;
}

export function allowedFeedUrl(value, allowedHosts) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password
        || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,63}$/.test(url.hostname)
        || !allowedHosts.has(url.hostname)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function feedText(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, key) => {
      if (key[0] !== '#') return entities[key] ?? match;
      const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }).trim();
}

function field(entry, name) {
  return feedText(entry.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+name+'>','i'))?.[1] ?? '');
}

export function parseFeed(xml, feedUrl) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported feed');
  const atom = /<feed[\s>]/i.test(xml);
  if (!atom && (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml))) throw new Error('Invalid RSS or Atom feed');
  const entries = xml.matchAll(atom ? /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi : /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi);
  const items = [];
  for (const [, entry] of entries) {
    let link = field(entry, 'link');
    if (atom) {
      for (const [element] of entry.matchAll(/<link\b[^>]*>/gi)) {
        const relation = element.match(/\brel=["']([^"']+)["']/i)?.[1];
        if (relation && relation !== 'alternate') continue;
        link = feedText(element.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? '');
        if (link) break;
      }
    }
    if (!link) continue;
    try {
      items.push({url:new URL(link,feedUrl).href,title:field(entry,'title'),
        published:field(entry,atom?'published':'pubDate')||field(entry,'updated'),
        source:field(entry,'source').replace(/<[^>]*>/g,'')});
    } catch {
      continue;
    }
    if (items.length >= 100) break;
  }
  return items;
}

export function watchQuery(name, context) {
  const terms = value => String(value ?? '').split(',').map(term => term
    .replace(/[^\p{L}\p{N}\s.-]/gu,' ').trim().slice(0,42)).filter(Boolean).slice(0,3);
  const aliases = terms(context.alternative_names);
  const names = terms(name).slice(0,1).concat(aliases,terms(context.subsidiaries).slice(0,Math.max(0,3-aliases.length)));
  if (!names.length) throw new Error('Empty query');
  const quoted = values => values.map(value => '"'+value+'"');
  const alternatives = quoted(names);
  return [
    alternatives.length > 1 ? '('+alternatives.join(' OR ')+')' : alternatives[0],
    ...quoted(terms(context.custom_terms)),
    ...quoted(terms(context.excluded_terms)).map(term => '-'+term),
  ].join(' ');
}

const MATERIAL_FORMS = new Set(['8-K', '10-K', '10-Q', '6-K', '20-F', '40-F', 'S-1', 'F-1', 'DEF 14A']);

export function edgarEvidence(cik, data, earliest) {
  const filings = data?.filings?.recent;
  if (!Array.isArray(filings?.form) || !Array.isArray(filings?.filingDate)
      || !Array.isArray(filings?.accessionNumber) || !Array.isArray(filings?.primaryDocument)) {
    throw new Error('Invalid SEC EDGAR submissions response');
  }
  const items = [];
  for (const [index, form] of filings.form.entries()) {
    const date = filings.filingDate[index];
    const accession = filings.accessionNumber[index];
    const document = filings.primaryDocument[index];
    if (!MATERIAL_FORMS.has(String(form).replace(/\/A$/, ''))
        || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < earliest
        || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^[A-Za-z0-9_.-]+$/.test(document)
        || document === '.' || document === '..') continue;
    items.push({
      url: 'https://www.sec.gov/Archives/edgar/data/'+Number(cik)+'/'+accession.replaceAll('-', '')+'/'+document,
      title: String(data.name || 'Issuer')+' filed Form '+form,
      published: date,
      source: 'SEC EDGAR',
    });
    if (items.length >= 15) break;
  }
  return normalizeEvidence(items, 'sec-edgar', 'regulatory');
}

export function describeEvidence(items, watchName, context) {
  const compact = value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const topics = [watchName,...String(context.alternative_names||'').split(','),
    ...String(context.subsidiaries||'').split(','),...String(context.products||'').split(','),
    context.industry,context.geography].map(compact).filter(value=>value.length>2);
  return items.map(item=>{
    const suffix=' - '+item.source;
    const title=item.title.toLowerCase().endsWith(suffix.toLowerCase())?item.title.slice(0,-suffix.length):item.title;
    const storyKey=compact(title).slice(0,180);
    const titleText=' '+storyKey+' ';
    const score=topics.filter(topic=>titleText.includes(' '+topic+' ')).length;
    const regulatory=item.source_classification==='regulatory';
    const label=regulatory?'primary':'secondary';
    return {...item,story_key:storyKey,source_role:label,relevance:regulatory?'issuer filing':score?'matched watch context':'search result'};
  });
}

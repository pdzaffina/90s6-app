(() => {
  'use strict';

  const panel = document.getElementById('sentinelOperations');
  const refresh = document.getElementById('sentinelOperationsRefresh');
  const results = document.getElementById('sentinelOperationsResults');
  const message = document.getElementById('sentinelOperationsMessage');
  const timestamp = value => value ? new Date(value).toLocaleString() : 'None recorded';

  function showMetrics(data) {
    const summary = document.createElement('dl');
    const metrics = [
      ['Queued scans', data.queued],
      ['Running scans', data.running],
      ['Oldest queued scan', timestamp(data.oldest_queued_at)],
      ['Completed in 24 hours', data.complete],
      ['Partial in 24 hours', data.partial],
      ['Failed in 24 hours', data.failed],
      ['Average execution in 24 hours', data.average_seconds == null ? 'None recorded' : data.average_seconds + ' s'],
      ['Last completed scan', timestamp(data.last_complete_at)],
      ['Retry attempts on scans queued in 24 hours', data.retries],
      ['AI request failures in 24 hours', data.ai_failures],
    ];
    for (const [label, value] of metrics) {
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      summary.append(term, detail);
    }

    const heading = document.createElement('h3');
    heading.textContent = 'Provider status';
    const providers = document.createElement('ul');
    for (const provider of data.providers) {
      const item = document.createElement('li');
      const name = ({gdelt:'GDELT','google-news-rss':'Google News RSS','configured-feed':'Preferred feed','sec-edgar':'SEC EDGAR'})[provider.provider] || provider.provider;
      const lastStatus = provider.last_status === 0 ? 'Request failed'
        : provider.last_status ? 'HTTP ' + provider.last_status : 'Awaiting response history';
      item.textContent = [name, lastStatus, timestamp(provider.observed_at),
        provider.rate_limit_events + ' rate-limit responses'].join(' · ');
      providers.append(item);
    }
    if (!providers.children.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Provider history will appear after the first request.';
      providers.append(empty);
    }
    results.replaceChildren(summary, heading, providers);
  }

  async function showGdelt(){
    const section=document.createElement('section');
    const heading=document.createElement('h3');heading.textContent='GDELT local intelligence index';
    const button=document.createElement('button');button.type='button';button.className='ap-btn';button.textContent='Collect now';
    const status=document.createElement('p');status.setAttribute('role','status');
    const detail=document.createElement('div');
    section.append(heading,button,status,detail);results.append(section);
    async function update(collect=false){
      button.disabled=true;
      try{
        const {data,error}=await App.sb.rpc('sentinel_gdelt_operations',{p_collect:collect});
        if(error)throw error;
        const summary=document.createElement('p');
        summary.textContent=[Number(data.articles).toLocaleString()+' articles',(data.bytes/1048576).toFixed(1)+' MiB storage','Latest completed feed: '+timestamp(data.latest),...Object.entries(data.counts).map(([k,v])=>v+' '+k)].join(' · ');
        const history=document.createElement('ul');history.style.cssText='max-height:320px;overflow:auto;overflow-wrap:anywhere';
        for(const row of data.history){const li=document.createElement('li');li.textContent=[timestamp(row.slot),row.status,row.records+' records',row.attempts+' attempts',row.error].filter(Boolean).join(' · ');history.append(li)}
        detail.replaceChildren(summary,history);
        status.textContent=collect?'Collection requested. Queued files are processed in the background. Refresh to check progress.':'';
      }catch(e){status.textContent=e.message||'GDELT operations unavailable.'}
      finally{button.disabled=false}
    }
    button.addEventListener('click',()=>update(true));await update();
  }
  async function load() {
    refresh.disabled = true;
    message.textContent = 'Loading Sentinel operations…';
    try {
      const { data, error } = await App.sb.rpc('sentinel_operations');
      if (error) throw error;
      showMetrics(data);
      await showGdelt();
      message.textContent = '';
    } catch {
      message.textContent = 'Sentinel operations could not load. Try Refresh.';
    } finally {
      refresh.disabled = false;
    }
  }

  refresh.addEventListener('click', load);
  new MutationObserver(() => {
    if (!panel.hidden && !results.children.length && !refresh.disabled) load();
  }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
})();

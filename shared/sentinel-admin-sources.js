(() => {
  const panel = document.getElementById('sentinelSourcePanel');
  const form = panel.querySelector('form');
  const list = panel.querySelector('textarea');
  const feedback = panel.querySelector('[role="status"]');
  const submit = panel.querySelector('button');
  const organization = panel.dataset.scope === 'organization';
  let org, limit=250;
  const limitInput=panel.querySelector('#sentinelSourceLimit');

  const saved=document.createElement('section');
  const heading=document.createElement('h3');heading.textContent='Saved sources';
  const count=document.createElement('p');
  const filter=document.createElement('input');filter.type='search';filter.className='ap-input';filter.placeholder='Filter saved domains';filter.setAttribute('aria-label','Filter saved domains');
  const results=document.createElement('div');results.style.cssText='max-height:360px;overflow:auto;overflow-wrap:anywhere';
  saved.append(heading,count,filter,results);panel.append(saved);
  let persisted=[];
  function renderSaved(){
    const q=filter.value.trim().toLowerCase();
    const matches=persisted.filter(d=>d.includes(q));
    count.textContent=persisted.length+' saved sources'+(q?' · '+matches.length+' matching':'');
    results.replaceChildren();
    if(!matches.length){const empty=document.createElement('p');empty.textContent=q?'No matching sources.':'No sources saved for this scope.';results.append(empty);return;}
    const ul=document.createElement('ul');
    for(const domain of matches){const li=document.createElement('li');const a=document.createElement('a');a.textContent=domain;a.href='https://'+domain;a.target='_blank';a.rel='noopener noreferrer';li.append(a);ul.append(li)}
    results.append(ul);
  }
  filter.addEventListener('input',renderSaved);
  count.textContent='Loading saved sources…';
  function showSaved(data){persisted=Array.isArray(data)?[...data].sort():[];renderSaved();}
  function normalize(value) {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : 'https://' + value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,63}$/.test(url.hostname)) {
      throw new Error('Use public website domains or URLs.');
    }
    return url.hostname.replace(/^www\./, '');
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const domains = [...new Set(list.value.split(/[,\r\n]+/).map(value => value.trim()).filter(Boolean).map(normalize))];
      if (domains.length > limit) throw new Error('Enter up to '+limit+' unique domains.');
      const {data,error} = await App.sb.rpc('sentinel_admin_sources', {p_org:org,p_domains:domains});
      if (error) throw error;
      list.value = data.join('\n');
      showSaved(data);
      feedback.textContent = data.length+' sources saved (limit '+limit+').';
    } catch (error) {
      feedback.textContent = error.message || 'Sources could not be saved.';
    } finally {
      submit.disabled = false;
    }
  });

  panel.querySelector('#sentinelSaveLimit')?.addEventListener('click',async()=>{
    const value=Number(limitInput.value);
    if(!Number.isInteger(value)||value<1||value>1000){feedback.textContent='Choose a limit from 1 to 1000.';return;}
    const result=await App.sb.rpc('sentinel_source_limit',{p_limit:value});
    if(result.error){feedback.textContent=result.error.message;return;}
    limit=result.data;panel.querySelector('.sentinel-source-cap').textContent='Up to '+limit+' unique domains per list.';feedback.textContent='Source limit saved.';
  });
  App.onSession(async (session,profile) => {
    if (!session || !profile) return;
    org = organization ? new URLSearchParams(location.search).get('tenant') || App.activeTenantId : null;
    if (organization ? !org || !App.isTenantAdmin(org) : !profile.is_admin) return;
    const cap=await App.sb.rpc('sentinel_source_limit');
    if(cap.error){feedback.textContent=cap.error.message;return;}
    limit=cap.data;
    panel.querySelector('.sentinel-source-cap').textContent='Up to '+limit+' unique domains per list.';
    if(limitInput)limitInput.value=limit;
    const {data,error} = await App.sb.rpc('sentinel_admin_sources', {p_org:org});
    if (error) {
      feedback.textContent = 'Sources could not load.';
      count.textContent='Saved sources unavailable.';
      return;
    }
    list.value = data.join('\n');
      showSaved(data);
    submit.disabled = false;
  });
})();

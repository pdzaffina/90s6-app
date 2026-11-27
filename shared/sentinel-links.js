(() => {
  'use strict';

  function assessmentUrl(id) {
    const url = new URL('/news-watch/', location.origin);
    url.searchParams.set('section', 'assessments');
    url.searchParams.set('assessment', id);
    if (App.activeTenantId) url.searchParams.set('org', App.activeTenantId);
    return url;
  }

  function riskLabel(value) {
    try {
      const report = JSON.parse(value);
      const ranks = ['unknown','informational','low','moderate','high','critical'];
      const risk = (report.risks||[]).slice().sort((a,b)=>ranks.indexOf(b.severity)-ranks.indexOf(a.severity))[0];
      return risk ? risk.severity+' severity · '+risk.confidence.replaceAll('_',' ')+' confidence' : '';
    } catch {
      return '';
    }
  }

  async function renderLinks(parent, target, id) {
    const tenant = App.activeTenantId;
    parent.textContent = 'Loading intelligence…';
    try {
      const links = await App.sb.from('sentinel_links').select('run_id,watch_id').eq('org_id',tenant).eq(target,id).limit(50);
      if (links.error) throw links.error;
      if (!links.data.length) {
        parent.textContent = 'No accessible linked intelligence.';
        return;
      }
      const watchIds=[...new Set(links.data.map(link=>link.watch_id))];
      let query=App.sb.from('sentinel_scan_runs').select('id,watch_id,created_at,assessment')
        .eq('org_id',tenant).not('assessment','is',null).order('created_at',{ascending:false}).limit(20);
      if (target==='account_id') query=query.in('watch_id',watchIds);
      else query=query.in('id',links.data.map(link=>link.run_id));
      const [runs,watches]=await Promise.all([query,App.sb.from('sentinel_watches').select('id,name')
        .eq('org_id',tenant).in('id',watchIds)]);
      if (runs.error||watches.error) throw runs.error||watches.error;
      const names=new Map(watches.data.map(watch=>[watch.id,watch.name]));
      const list=document.createElement('ul');
      for (const run of runs.data) {
        if (!names.has(run.watch_id)) continue;
        const item=document.createElement('li');
        const link=document.createElement('a');
        link.href=assessmentUrl(run.id).href;
        link.textContent=names.get(run.watch_id)+' · '+new Date(run.created_at).toLocaleDateString();
        const risk=riskLabel(run.assessment);
        item.append(link);
        if (risk) item.append(document.createTextNode(' · '+risk));
        list.append(item);
      }
      parent.replaceChildren(list.children.length ? list : document.createTextNode('No accessible linked assessments.'));
    } catch {
      parent.textContent = 'Linked intelligence could not load.';
    }
  }

  window.SentinelLinks = {
    assessmentUrl,
    control(target,id) {
      const details=document.createElement('details');
      const summary=document.createElement('summary');
      const result=document.createElement('div');
      summary.textContent='External intelligence';
      details.append(summary,result);
      details.addEventListener('toggle',()=>{
        if (details.open) void renderLinks(result,target,id);
      });
      return details;
    },
  };
})();

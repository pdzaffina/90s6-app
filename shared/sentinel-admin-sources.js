(() => {
  const panel = document.getElementById('sentinelSourcePanel');
  const form = panel.querySelector('form');
  const list = panel.querySelector('textarea');
  const feedback = panel.querySelector('[role="status"]');
  const submit = panel.querySelector('button');
  const organization = panel.dataset.scope === 'organization';
  let org;

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
      if (domains.length > 8) throw new Error('Enter up to eight unique domains.');
      const {data,error} = await App.sb.rpc('sentinel_admin_sources', {p_org:org,p_domains:domains});
      if (error) throw error;
      list.value = data.join('\n');
      feedback.textContent = 'Sources saved.';
    } catch (error) {
      feedback.textContent = error.message || 'Sources could not be saved.';
    } finally {
      submit.disabled = false;
    }
  });

  App.onSession(async (session,profile) => {
    if (!session || !profile) return;
    org = organization ? new URLSearchParams(location.search).get('tenant') || App.activeTenantId : null;
    if (organization ? !org || !App.isTenantAdmin(org) : !profile.is_admin) return;
    const {data,error} = await App.sb.rpc('sentinel_admin_sources', {p_org:org});
    if (error) {
      feedback.textContent = 'Sources could not load.';
      return;
    }
    list.value = data.join('\n');
    submit.disabled = false;
  });
})();

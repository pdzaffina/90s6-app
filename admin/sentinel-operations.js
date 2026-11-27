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
      const name = provider.provider === 'gdelt' ? 'GDELT' : 'Google News RSS';
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

  async function load() {
    refresh.disabled = true;
    message.textContent = 'Loading Sentinel operations…';
    try {
      const { data, error } = await App.sb.rpc('sentinel_operations');
      if (error) throw error;
      showMetrics(data);
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

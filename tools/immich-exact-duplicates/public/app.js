const scan = document.querySelector('#scan');
const type = document.querySelector('#type');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const progressPanel = document.querySelector('#progress-panel');
const progress = document.querySelector('#progress');
const progressStage = document.querySelector('#progress-stage');
const progressCount = document.querySelector('#progress-count');

const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const size = (bytes) => bytes == null ? 'Unknown size' : new Intl.NumberFormat(undefined, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(bytes / 1_000_000);

const renderResults = (data) => {
  status.textContent = `${data.scanned} assets checked · ${data.groups.length} exact-match groups · ${data.externalCandidates} external candidates hashed${data.unreadableExternal ? ` · ${data.unreadableExternal} unreadable` : ''}`;
  if (data.groups.length === 0) {
    results.innerHTML = '<div class="empty">No exact duplicates found.</div>';
    return;
  }
  results.innerHTML = data.groups.map((group, index) => `
    <article>
      <div class="group-title"><strong>Match group ${index + 1}</strong><span>${group.assets.length} identical files</span></div>
      ${group.assets.map((asset) => `<div class="asset"><div><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.path)}</small></div><span>${size(asset.size)}</span></div>`).join('')}
      <details><summary>${escapeHtml(group.algorithm)} checksum</summary><code>${escapeHtml(group.checksum)}</code></details>
    </article>`).join('');
};

const updateProgress = (job) => {
  progressPanel.hidden = false;
  progressStage.textContent = job.stage;
  if (job.status === 'complete') {
    progressCount.textContent = 'Done';
    progress.max = 1;
    progress.value = 1;
  } else if (job.status === 'failed') {
    progressCount.textContent = 'Failed';
    progress.max = 1;
    progress.value = 0;
  } else if (job.total > 0) {
    progressCount.textContent = `${job.processed.toLocaleString()} / ${job.total.toLocaleString()}`;
    progress.max = job.total;
    progress.value = job.processed;
  } else {
    progressCount.textContent = `${job.processed.toLocaleString()} processed`;
    progress.removeAttribute('value');
  }
};

const watchScan = async () => {
  while (true) {
    const response = await fetch('/api/scans/current', { cache: 'no-store' });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error ?? 'Unable to read scan progress');
    if (!job) return;
    updateProgress(job);
    if (job.status === 'complete') {
      renderResults(job.result);
      scan.disabled = false;
      return;
    }
    if (job.status === 'failed') throw new Error(job.error ?? 'Scan failed');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

scan.addEventListener('click', async () => {
  scan.disabled = true;
  status.classList.remove('error');
  status.textContent = `Scanning ${type.value.toLowerCase()} checksums…`;
  results.innerHTML = '';
  try {
    const response = await fetch('/api/scans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: type.value }),
    });
    const job = await response.json();
    if (!response.ok && response.status !== 409) throw new Error(job.error ?? 'Scan failed');
    await watchScan();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
    scan.disabled = false;
  }
});

void fetch('/api/scans/current', { cache: 'no-store' })
  .then((response) => response.json())
  .then((job) => {
    if (!job) return;
    if (job.status === 'running') {
      scan.disabled = true;
      return watchScan();
    }
    updateProgress(job);
    if (job.status === 'complete') renderResults(job.result);
  });

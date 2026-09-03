// Popup logic for Paper Downloader & Smart Renamer
document.addEventListener('DOMContentLoaded', async () => {
  const paperTitle = document.getElementById('paperTitle');
  const paperAuthors = document.getElementById('paperAuthors');
  const paperJournalYear = document.getElementById('paperJournalYear');
  const paperDoi = document.getElementById('paperDoi');
  const sourceBadge = document.getElementById('sourceBadge');
  const templateSelect = document.getElementById('templateSelect');
  const filenameInput = document.getElementById('filenameInput');
  const downloadBtn = document.getElementById('downloadBtn');
  const bibtexBtn = document.getElementById('bibtexBtn');
  const unpaywallBtn = document.getElementById('unpaywallBtn');
  const statusMsg = document.getElementById('statusMsg');
  const resetFilenameBtn = document.getElementById('resetFilenameBtn');

  let currentMeta = null;

  // 1. Ask content script to sniff page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus('No active tab', 'error');
    return;
  }

  try {
    chrome.tabs.sendMessage(tab.id, { action: 'sniff_paper' }, async (response) => {
      if (chrome.runtime.lastError || !response || !response.data) {
        paperTitle.textContent = 'No paper detected on this page.';
        sourceBadge.textContent = 'None';
        return;
      }

      const sniffed = response.data;
      sourceBadge.textContent = 'Resolving...';

      // 2. Query background to get authoritative metadata
      chrome.runtime.sendMessage({ action: 'fetch_metadata', data: sniffed }, (metaRes) => {
        if (metaRes && metaRes.success && metaRes.meta) {
          currentMeta = { ...sniffed, ...metaRes.meta };
          sourceBadge.textContent = currentMeta.arxivId ? 'arXiv' : 'Crossref';
        } else {
          currentMeta = sniffed;
          sourceBadge.textContent = 'Page Meta';
        }
        renderPaper(currentMeta);
      });
    });
  } catch (e) {
    setStatus('Could not connect to page', 'error');
  }

  function renderPaper(meta) {
    paperTitle.textContent = meta.title || meta.pageTitle || 'Untitled Paper';
    paperAuthors.textContent = 'Authors: ' + (meta.authors && meta.authors.length ? meta.authors.slice(0, 3).join(', ') + (meta.authors.length > 3 ? ' et al.' : '') : (meta.firstAuthor || 'Unknown'));
    paperJournalYear.textContent = `Journal & Year: ${meta.journal || '—'} (${meta.year || '—'})`;
    paperDoi.textContent = meta.doi ? `DOI: ${meta.doi}` : (meta.arxivId ? `arXiv: ${meta.arxivId}` : 'DOI: Not detected');
    
    updateFilename();
    downloadBtn.disabled = !meta.pdfUrl && !meta.doi && !meta.arxivId;
  }

  function updateFilename() {
    if (!currentMeta) return;
    const pattern = templateSelect.value;
    const firstAuthor = currentMeta.firstAuthor || (currentMeta.authors && currentMeta.authors[0]) || 'UnknownAuthor';
    const year = currentMeta.year || new Date().getFullYear();
    const title = (currentMeta.title || 'Paper').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim().slice(0, 80);
    const journal = (currentMeta.journal || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();

    let name = pattern
      .replace('{year}', year)
      .replace('{first_author}', firstAuthor)
      .replace('{title}', title)
      .replace('{journal}', journal);

    filenameInput.value = name;
  }

  templateSelect.addEventListener('change', updateFilename);
  resetFilenameBtn.addEventListener('click', updateFilename);

  // Download action
  downloadBtn.addEventListener('click', async () => {
    if (!currentMeta) return;
    const filename = filenameInput.value.trim();
    const pdfUrl = currentMeta.pdfUrl || (currentMeta.doi ? `https://doi.org/${currentMeta.doi}` : null);
    if (!pdfUrl) {
      setStatus('No PDF URL available', 'error');
      return;
    }

    setStatus('Starting download...', '');
    chrome.runtime.sendMessage({
      action: 'trigger_download',
      data: { url: pdfUrl, filename }
    }, (res) => {
      if (res && res.success) {
        setStatus('PDF downloaded and renamed!', 'success');
      } else {
        setStatus(res?.error || 'Download failed', 'error');
      }
    });
  });

  // Copy BibTeX
  bibtexBtn.addEventListener('click', () => {
    if (!currentMeta) return;
    const bibtex = generateBibTeX(currentMeta);
    navigator.clipboard.writeText(bibtex).then(() => {
      setStatus('BibTeX copied to clipboard!', 'success');
    });
  });

  // Find Unpaywalled
  unpaywallBtn.addEventListener('click', () => {
    if (!currentMeta || (!currentMeta.doi && !currentMeta.arxivId)) {
      setStatus('No DOI or arXiv ID found to resolve', 'error');
      return;
    }
    const target = currentMeta.doi 
      ? `https://doi.org/${currentMeta.doi}` 
      : `https://arxiv.org/abs/${currentMeta.arxivId}`;
    chrome.tabs.create({ url: target });
  });

  function generateBibTeX(m) {
    const key = (m.firstAuthor || 'paper') + (m.year || '');
    return `@article{${key},\n  title={${m.title || ''}},\n  author={${(m.authors || []).join(' and ')}},\n  year={${m.year || ''}},\n  journal={${m.journal || ''}},\n  doi={${m.doi || ''}}\n}`;
  }

  function setStatus(msg, type = '') {
    statusMsg.textContent = msg;
    statusMsg.className = `status ${type}`;
  }
});

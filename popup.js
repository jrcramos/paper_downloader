// Popup UI Controller for Paper Downloader & Smart Renamer
document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements - Header & Views
  const viewTabs = document.getElementById('viewTabs');
  const tabSingleBtn = document.getElementById('tabSingleBtn');
  const tabBatchBtn = document.getElementById('tabBatchBtn');
  const batchTabCount = document.getElementById('batchTabCount');
  const singlePaperView = document.getElementById('singlePaperView');
  const batchContainer = document.getElementById('batchContainer');

  // DOM Elements - Paper Selector (Single View)
  const paperSelectorWrap = document.getElementById('paperSelectorWrap');
  const paperSelect = document.getElementById('paperSelect');
  const prevPaperBtn = document.getElementById('prevPaperBtn');
  const nextPaperBtn = document.getElementById('nextPaperBtn');

  // DOM Elements - Single Paper Card
  const paperTitle = document.getElementById('paperTitle');
  const paperAuthors = document.getElementById('paperAuthors');
  const venueText = document.getElementById('venueText');
  const paperIdentifier = document.getElementById('paperIdentifier');
  const tabPaperCountBadge = document.getElementById('tabPaperCountBadge');
  const sourceBadge = document.getElementById('sourceBadge');
  const accessBadge = document.getElementById('accessBadge');
  const citationsBadge = document.getElementById('citationsBadge');

  const templateChips = document.getElementById('templateChips');
  const subfolderPrefixText = document.getElementById('subfolderPrefixText');
  const filenameInput = document.getElementById('filenameInput');
  const resetFilenameBtn = document.getElementById('resetFilenameBtn');

  const downloadBtn = document.getElementById('downloadBtn');
  const downloadBtnText = document.getElementById('downloadBtnText');
  const bibtexBtn = document.getElementById('bibtexBtn');
  const apaCitationBtn = document.getElementById('apaCitationBtn');
  const unpaywallBtn = document.getElementById('unpaywallBtn');
  const oaBtnText = document.getElementById('oaBtnText');
  const openLinkBtn = document.getElementById('openLinkBtn');

  // DOM Elements - Batch View
  const batchSearchInput = document.getElementById('batchSearchInput');
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  const skipDuplicatesCheckbox = document.getElementById('skipDuplicatesCheckbox');
  const selectionCounter = document.getElementById('selectionCounter');
  const batchList = document.getElementById('batchList');
  const batchDownloadBtn = document.getElementById('batchDownloadBtn');
  const batchDownloadCount = document.getElementById('batchDownloadCount');
  const batchBibtexBtn = document.getElementById('batchBibtexBtn');
  const batchExportTxtBtn = document.getElementById('batchExportTxtBtn');
  const batchProgress = document.getElementById('batchProgress');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const cancelBatchBtn = document.getElementById('cancelBatchBtn');

  // DOM Elements - Batch Summary Report
  const batchSummaryCard = document.getElementById('batchSummaryCard');
  const summarySuccess = document.getElementById('summarySuccess');
  const summarySkipped = document.getElementById('summarySkipped');
  const summaryFailed = document.getElementById('summaryFailed');
  const summaryActions = document.getElementById('summaryActions');
  const copyFailedDoisBtn = document.getElementById('copyFailedDoisBtn');
  const closeSummaryCard = document.getElementById('closeSummaryCard');

  // DOM Elements - Settings Drawer
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const openOptionsPageBtn = document.getElementById('openOptionsPageBtn');
  const settingsDrawer = document.getElementById('settingsDrawer');
  const closeSettingsDrawer = document.getElementById('closeSettingsDrawer');
  const saveSubfolderCheckbox = document.getElementById('saveSubfolderCheckbox');
  const subfolderInput = document.getElementById('subfolderInput');
  const enableSciHubCheckbox = document.getElementById('enableSciHubCheckbox');
  const quickSciHubMirrorGroup = document.getElementById('quickSciHubMirrorGroup');
  const quickSciHubMirrorSelect = document.getElementById('quickSciHubMirrorSelect');
  const openSciHubBtn = document.getElementById('openSciHubBtn');
  const customTemplateInput = document.getElementById('customTemplateInput');
  const tokenCloud = document.getElementById('tokenCloud');
  const configureTemplateLink = document.getElementById('configureTemplateLink');
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');

  // State
  let allDetectedPapers = [];
  let currentPaperIndex = 0;
  let currentMeta = null;
  let activeTemplatePattern = CONFIG.DEFAULT_TEMPLATE;
  let selectedIndices = new Set();
  let userPrefs = {
    saveToSubfolder: true,
    subfolderName: CONFIG.DEFAULT_SUBFOLDER,
    maxTitleLength: CONFIG.DEFAULT_MAX_TITLE_LENGTH,
    enableSciHub: true,
    sciHubMirror: CONFIG.DEFAULT_SCIHUB_MIRROR
  };

  // Load User Preferences
  await loadPreferences();
  initTokenCloud();

  // 1. Identify Active Tab & Sniff Papers
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    showScanError('No active browser tab found');
    return;
  }

  const urlIdentifiers = sniffUrlDirectly(tab.url);

  try {
    chrome.tabs.sendMessage(tab.id, { action: 'sniff_paper' }, async (response) => {
      let sniffedPrimary = (response && response.data) ? response.data : {};
      let allPapers = (response && response.allPapers) ? response.allPapers : [];

      // Merge with URL direct identifiers if missing
      if (!sniffedPrimary.doi && urlIdentifiers.doi) sniffedPrimary.doi = urlIdentifiers.doi;
      if (!sniffedPrimary.arxivId && urlIdentifiers.arxivId) sniffedPrimary.arxivId = urlIdentifiers.arxivId;
      if (!sniffedPrimary.pmid && urlIdentifiers.pmid) sniffedPrimary.pmid = urlIdentifiers.pmid;
      if (!sniffedPrimary.url) sniffedPrimary.url = tab.url;

      if (allPapers.length === 0 && (sniffedPrimary.doi || sniffedPrimary.arxivId || sniffedPrimary.title)) {
        allPapers = [sniffedPrimary];
      }

      if (allPapers.length === 0) {
        showScanError('No academic publications or DOIs detected on this page');
        return;
      }

      allDetectedPapers = allPapers;
      currentPaperIndex = 0;

      // Update badge on toolbar icon for this tab
      chrome.runtime.sendMessage({
        action: 'update_badge_count',
        count: allDetectedPapers.length,
        tabId: tab.id
      });

      // Update in-popup count badge
      if (tabPaperCountBadge) {
        tabPaperCountBadge.textContent = allDetectedPapers.length === 1 
          ? '📄 1 Paper Found' 
          : `📚 ${allDetectedPapers.length} Papers Found`;
        tabPaperCountBadge.style.display = 'inline-flex';
      }

      // If multiple papers detected, enable Multi-Paper UI
      if (allDetectedPapers.length > 1) {
        viewTabs.style.display = 'flex';
        batchTabCount.textContent = allDetectedPapers.length;
        paperSelectorWrap.style.display = 'flex';
        initPaperSelector();
        initBatchView();
      }

      // Load first paper
      loadPaperAtIndex(0);
    });
  } catch (err) {
    if (urlIdentifiers.doi || urlIdentifiers.arxivId) {
      allDetectedPapers = [urlIdentifiers];
      chrome.runtime.sendMessage({
        action: 'update_badge_count',
        count: 1,
        tabId: tab.id
      });
      if (tabPaperCountBadge) {
        tabPaperCountBadge.textContent = '📄 1 Paper Found';
        tabPaperCountBadge.style.display = 'inline-flex';
      }
      loadPaperAtIndex(0);
    } else {
      showScanError('Could not connect to page content');
    }
  }

  // Load and resolve paper at specific index
  async function loadPaperAtIndex(index) {
    if (index < 0 || index >= allDetectedPapers.length) return;
    currentPaperIndex = index;

    if (paperSelect) {
      paperSelect.value = String(index);
      prevPaperBtn.disabled = index === 0;
      nextPaperBtn.disabled = index === allDetectedPapers.length - 1;
    }

    const paper = allDetectedPapers[index];
    currentMeta = paper;

    // Fast initial render with what we already have
    renderPaper(currentMeta);
    setSourceBadge('Resolving verified metadata...', 'pulse-dot');

    // Query Background Multi-API Cascade if not yet enriched
    if (!paper.resolved) {
      chrome.runtime.sendMessage({ action: 'fetch_metadata', data: paper }, (metaRes) => {
        if (metaRes && metaRes.success && metaRes.meta) {
          allDetectedPapers[index] = { ...paper, ...metaRes.meta, resolved: true };
          currentMeta = allDetectedPapers[index];
          const src = currentMeta.arxivId ? 'Verified arXiv' : (currentMeta.doi ? 'Verified Crossref' : 'Metadata Found');
          setSourceBadge(src, '');
        } else {
          allDetectedPapers[index].resolved = true;
          setSourceBadge('Page Metadata', '');
        }
        renderPaper(currentMeta);
        updateBatchItemRow(index);
      });
    } else {
      const src = currentMeta.arxivId ? 'Verified arXiv' : (currentMeta.doi ? 'Verified Crossref' : 'Metadata Found');
      setSourceBadge(src, '');
    }
  }

  // Populate Paper Selector Dropdown (Single View)
  function initPaperSelector() {
    paperSelect.innerHTML = '';
    allDetectedPapers.forEach((p, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      const displayTitle = p.title || p.snippet || p.doi || p.arxivId || `Paper #${idx + 1}`;
      opt.textContent = `${idx + 1}. ${displayTitle.slice(0, 65)}`;
      paperSelect.appendChild(opt);
    });

    paperSelect.addEventListener('change', () => {
      loadPaperAtIndex(parseInt(paperSelect.value, 10));
    });

    prevPaperBtn.addEventListener('click', () => {
      if (currentPaperIndex > 0) loadPaperAtIndex(currentPaperIndex - 1);
    });

    nextPaperBtn.addEventListener('click', () => {
      if (currentPaperIndex < allDetectedPapers.length - 1) loadPaperAtIndex(currentPaperIndex + 1);
    });
  }

  // View Tabs Toggle (Single vs Batch)
  tabSingleBtn.addEventListener('click', () => {
    tabSingleBtn.classList.add('active');
    tabBatchBtn.classList.remove('active');
    singlePaperView.style.display = 'block';
    batchContainer.classList.remove('active');
  });

  tabBatchBtn.addEventListener('click', () => {
    tabBatchBtn.classList.add('active');
    tabSingleBtn.classList.remove('active');
    singlePaperView.style.display = 'none';
    batchContainer.classList.add('active');
  });

  // Check if a batch is already active in background on popup open
  chrome.runtime.sendMessage({ action: 'get_batch_status' }, (res) => {
    if (res && res.batchState && res.batchState.isRunning) {
      tabBatchBtn.click();
      batchProgress.style.display = 'block';
      batchDownloadBtn.disabled = true;
      startBatchPolling();
    } else if (res && res.batchState && res.batchState.results && res.batchState.results.length > 0) {
      showBatchSummaryReport(res.batchState);
    }
  });

  // Populate Batch Manager List
  function initBatchView() {
    batchList.innerHTML = '';
    selectedIndices = new Set(allDetectedPapers.map((_, i) => i));
    updateBatchCounters();

    allDetectedPapers.forEach((paper, idx) => {
      const item = document.createElement('div');
      item.className = 'batch-item';
      item.dataset.index = String(idx);

      const displayTitle = paper.title || paper.snippet || (paper.doi ? `Paper: ${paper.doi}` : `Paper #${idx + 1}`);
      const cleanDoi = paper.doi ? ((typeof CONFIG !== 'undefined' && CONFIG.cleanDoi) ? CONFIG.cleanDoi(paper.doi) : paper.doi) : '';
      const idText = cleanDoi ? `DOI: ${cleanDoi}` : (paper.arxivId ? `arXiv:${paper.arxivId}` : (paper.pmid ? `PMID:${paper.pmid}` : ''));
      const paperUrl = (typeof CONFIG !== 'undefined' && CONFIG.getPaperUrl) ? CONFIG.getPaperUrl(paper) : (paper.doi ? `https://doi.org/${paper.doi}` : (paper.url || ''));

      item.innerHTML = `
        <input type="checkbox" class="batch-checkbox" data-index="${idx}" checked>
        <div class="batch-item-content">
          <div class="batch-item-title" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</div>
          <div class="batch-item-meta">
            ${idText ? `
              <span class="batch-doi-wrap" title="Click to copy link: ${escapeHtml(paperUrl)} (Ctrl/Cmd+click to open)">
                <span class="batch-item-doi" data-id="${escapeHtml(idText)}" data-url="${escapeHtml(paperUrl)}">${escapeHtml(idText)}</span>
                ${paperUrl ? `
                  <button class="batch-doi-open-btn" data-url="${escapeHtml(paperUrl)}" title="Open paper in new tab (${escapeHtml(paperUrl)})" aria-label="Open paper in new tab">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                  </button>
                ` : ''}
              </span>
            ` : ''}
            ${paper.year ? `<span>• ${paper.year}</span>` : ''}
          </div>
        </div>
        <div class="batch-item-actions">
          ${paperUrl ? `
            <button class="batch-icon-btn single-open-btn" data-url="${escapeHtml(paperUrl)}" title="Open paper in new tab (${escapeHtml(paperUrl)})" aria-label="Open paper in new tab">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </button>
          ` : ''}
          <button class="batch-icon-btn single-dl-btn" data-index="${idx}" title="Download this paper">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
          <button class="batch-icon-btn single-bib-btn" data-index="${idx}" title="Copy BibTeX">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        </div>
      `;

      // Checkbox event
      const cb = item.querySelector('.batch-checkbox');
      cb.addEventListener('change', () => {
        if (cb.checked) {
          selectedIndices.add(idx);
        } else {
          selectedIndices.delete(idx);
        }
        updateBatchCounters();
      });

      // DOI click to copy link (Ctrl/Cmd+click or middle-click to open)
      const doiWrap = item.querySelector('.batch-doi-wrap');
      const doiSpan = item.querySelector('.batch-item-doi');
      if (doiWrap && doiSpan) {
        doiWrap.addEventListener('click', (e) => {
          if (e.target.closest('.batch-doi-open-btn')) return;
          e.stopPropagation();
          e.preventDefault();

          if (e.ctrlKey || e.metaKey) {
            if (paperUrl) {
              chrome.tabs.create({ url: paperUrl });
              showToast('Opening paper in new tab...', 'success');
            }
            return;
          }

          if (paperUrl) {
            navigator.clipboard.writeText(paperUrl).then(() => {
              showToast(`📋 Copied link: ${paperUrl}`, 'success');
              const origText = doiSpan.dataset.id || idText;
              doiSpan.textContent = '✓ Copied link!';
              doiSpan.classList.add('copied');
              setTimeout(() => {
                doiSpan.textContent = origText;
                doiSpan.classList.remove('copied');
              }, 1500);
            }).catch(() => {
              showToast('Failed to copy link', 'error');
            });
          }
        });

        doiWrap.addEventListener('auxclick', (e) => {
          if (e.button === 1 && paperUrl) {
            e.stopPropagation();
            e.preventDefault();
            chrome.tabs.create({ url: paperUrl });
            showToast('Opening paper in new tab...', 'success');
          }
        });
      }

      // Inline open button next to DOI
      const inlineOpenBtn = item.querySelector('.batch-doi-open-btn');
      if (inlineOpenBtn) {
        inlineOpenBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (paperUrl) {
            chrome.tabs.create({ url: paperUrl });
            showToast('Opening paper in new tab...', 'success');
          }
        });
      }

      // Action toolbar Open button
      const singleOpenBtn = item.querySelector('.single-open-btn');
      if (singleOpenBtn) {
        singleOpenBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (paperUrl) {
            chrome.tabs.create({ url: paperUrl });
            showToast('Opening paper in new tab...', 'success');
          }
        });
      }

      // Individual item download button
      item.querySelector('.single-dl-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        downloadSingleBatchPaper(idx);
      });

      // Individual item BibTeX button
      item.querySelector('.single-bib-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        copySingleBatchBibtex(idx);
      });

      // Clicking row switches single view to this paper
      item.addEventListener('click', (e) => {
        if (
          e.target.tagName === 'INPUT' ||
          e.target.closest('button') ||
          e.target.closest('.batch-doi-wrap') ||
          e.target.closest('.batch-item-doi')
        ) return;
        loadPaperAtIndex(idx);
        tabSingleBtn.click();
      });

      batchList.appendChild(item);
    });

    // Select all event
    selectAllCheckbox.addEventListener('change', () => {
      const visibleCheckboxes = batchList.querySelectorAll('.batch-item:not([style*="display: none"]) .batch-checkbox');
      visibleCheckboxes.forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
        const idx = parseInt(cb.dataset.index, 10);
        if (selectAllCheckbox.checked) {
          selectedIndices.add(idx);
        } else {
          selectedIndices.delete(idx);
        }
      });
      updateBatchCounters();
    });

    // Skip duplicates toggle event
    if (skipDuplicatesCheckbox) {
      skipDuplicatesCheckbox.addEventListener('change', () => {
        if (skipDuplicatesCheckbox.checked) {
          // Uncheck all existing papers
          allDetectedPapers.forEach((paper, idx) => {
            if (paper.isExisting) {
              const cb = batchList.querySelector(`.batch-item[data-index="${idx}"] .batch-checkbox`);
              if (cb) cb.checked = false;
              selectedIndices.delete(idx);
            }
          });
        }
        updateBatchCounters();
      });
    }

    // Search filter
    batchSearchInput.addEventListener('input', () => {
      const query = batchSearchInput.value.toLowerCase().trim();
      const items = batchList.querySelectorAll('.batch-item');
      items.forEach(it => {
        const idx = parseInt(it.dataset.index, 10);
        const p = allDetectedPapers[idx];
        const text = `${p.title || ''} ${p.snippet || ''} ${p.doi || ''} ${p.arxivId || ''} ${(p.authors || []).join(' ')}`.toLowerCase();
        it.style.display = text.includes(query) ? 'flex' : 'none';
      });
    });

    // Check existing downloads in Chrome history
    checkAndMarkDuplicates();
  }

  // Check Chrome download history & physical files on disk for existing papers
  async function checkAndMarkDuplicates() {
    chrome.runtime.sendMessage({ action: 'check_duplicates', papers: allDetectedPapers }, (res) => {
      if (!res || !res.duplicatesMap) return;
      const dMap = res.duplicatesMap;

      allDetectedPapers.forEach((paper, idx) => {
        const key = paper.doi ? paper.doi.toLowerCase().trim() : String(idx);
        const isExisting = Boolean(dMap[key] || dMap[idx]);
        paper.isExisting = isExisting;

        const cb = batchList.querySelector(`.batch-item[data-index="${idx}"] .batch-checkbox`);
        if (isExisting) {
          setRowStatus(idx, 'skipped', 'Already in Downloads');
          if (skipDuplicatesCheckbox && skipDuplicatesCheckbox.checked) {
            if (cb) {
              cb.checked = false;
              selectedIndices.delete(idx);
            }
          }
        } else {
          setRowStatus(idx, 'ready', 'Ready to download');
          if (cb && !paper.userDeselected) {
            cb.checked = true;
            selectedIndices.add(idx);
          }
        }
      });
      updateBatchCounters();
    });
  }

  function updateBatchCounters() {
    selectionCounter.textContent = `${selectedIndices.size} of ${allDetectedPapers.length} selected`;
    batchDownloadCount.textContent = selectedIndices.size;
    batchDownloadBtn.disabled = selectedIndices.size === 0;
    selectAllCheckbox.checked = selectedIndices.size === allDetectedPapers.length && allDetectedPapers.length > 0;
  }

  function updateBatchItemRow(index) {
    const item = batchList.querySelector(`.batch-item[data-index="${index}"]`);
    if (!item) return;
    const paper = allDetectedPapers[index];
    const displayTitle = paper.title || paper.snippet || (paper.doi ? `Paper: ${paper.doi}` : `Paper #${index + 1}`);
    const titleEl = item.querySelector('.batch-item-title');
    if (titleEl) {
      titleEl.textContent = displayTitle;
      titleEl.title = displayTitle;
    }

    const cleanDoi = paper.doi ? ((typeof CONFIG !== 'undefined' && CONFIG.cleanDoi) ? CONFIG.cleanDoi(paper.doi) : paper.doi) : '';
    const idText = cleanDoi ? `DOI: ${cleanDoi}` : (paper.arxivId ? `arXiv:${paper.arxivId}` : (paper.pmid ? `PMID:${paper.pmid}` : ''));
    const paperUrl = (typeof CONFIG !== 'undefined' && CONFIG.getPaperUrl) ? CONFIG.getPaperUrl(paper) : (paper.doi ? `https://doi.org/${paper.doi}` : (paper.url || ''));

    const metaEl = item.querySelector('.batch-item-meta');
    let doiWrap = item.querySelector('.batch-doi-wrap');

    if (idText && !doiWrap && metaEl) {
      doiWrap = document.createElement('span');
      doiWrap.className = 'batch-doi-wrap';
      doiWrap.title = `Click to copy link: ${paperUrl} (Ctrl/Cmd+click to open)`;
      doiWrap.innerHTML = `
        <span class="batch-item-doi" data-id="${escapeHtml(idText)}" data-url="${escapeHtml(paperUrl)}">${escapeHtml(idText)}</span>
        ${paperUrl ? `
          <button class="batch-doi-open-btn" data-url="${escapeHtml(paperUrl)}" title="Open paper in new tab (${escapeHtml(paperUrl)})" aria-label="Open paper in new tab">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </button>
        ` : ''}
      `;
      metaEl.insertBefore(doiWrap, metaEl.firstChild);

      const doiSpan = doiWrap.querySelector('.batch-item-doi');
      doiWrap.addEventListener('click', (e) => {
        if (e.target.closest('.batch-doi-open-btn')) return;
        e.stopPropagation();
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          if (paperUrl) {
            chrome.tabs.create({ url: paperUrl });
            showToast('Opening paper in new tab...', 'success');
          }
          return;
        }
        if (paperUrl) {
          navigator.clipboard.writeText(paperUrl).then(() => {
            showToast(`📋 Copied link: ${paperUrl}`, 'success');
            const orig = doiSpan.dataset.id || idText;
            doiSpan.textContent = '✓ Copied link!';
            doiSpan.classList.add('copied');
            setTimeout(() => {
              doiSpan.textContent = orig;
              doiSpan.classList.remove('copied');
            }, 1500);
          }).catch(() => {
            showToast('Failed to copy link', 'error');
          });
        }
      });

      doiWrap.addEventListener('auxclick', (e) => {
        if (e.button === 1 && paperUrl) {
          e.stopPropagation();
          e.preventDefault();
          chrome.tabs.create({ url: paperUrl });
          showToast('Opening paper in new tab...', 'success');
        }
      });

      const openBtn = doiWrap.querySelector('.batch-doi-open-btn');
      if (openBtn) {
        openBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (paperUrl) {
            chrome.tabs.create({ url: paperUrl });
            showToast('Opening paper in new tab...', 'success');
          }
        });
      }
    } else if (doiWrap && idText) {
      const doiSpan = doiWrap.querySelector('.batch-item-doi');
      if (doiSpan && !doiSpan.classList.contains('copied')) {
        doiSpan.textContent = idText;
        doiSpan.dataset.id = idText;
        doiSpan.dataset.url = paperUrl;
      }
    }

    const actionsEl = item.querySelector('.batch-item-actions');
    if (actionsEl && paperUrl && !actionsEl.querySelector('.single-open-btn')) {
      const openBtn = document.createElement('button');
      openBtn.className = 'batch-icon-btn single-open-btn';
      openBtn.dataset.url = paperUrl;
      openBtn.title = `Open paper in new tab (${paperUrl})`;
      openBtn.setAttribute('aria-label', 'Open paper in new tab');
      openBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        chrome.tabs.create({ url: paperUrl });
        showToast('Opening paper in new tab...', 'success');
      });
      actionsEl.insertBefore(openBtn, actionsEl.firstChild);
    }
  }

  // Set individual item status badge
  function setRowStatus(index, status, reason = '') {
    const item = batchList.querySelector(`.batch-item[data-index="${index}"]`);
    if (!item) return;
    let badge = item.querySelector('.batch-status-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'batch-status-badge';
      const meta = item.querySelector('.batch-item-meta');
      if (meta) meta.appendChild(badge);
    }

    badge.className = `batch-status-badge ${status}`;
    if (status === 'downloaded') {
      badge.textContent = '✓ Saved';
      badge.title = 'Downloaded successfully';
    } else if (status === 'skipped') {
      badge.textContent = '⏩ Skipped';
      badge.title = reason || 'Already in Downloads';
    } else if (status === 'failed') {
      badge.textContent = '❌ Failed';
      badge.title = reason || 'Paywalled / No PDF found';
    } else if (status === 'downloading') {
      badge.textContent = '🔄 Downloading';
      badge.title = 'Processing...';
    }
  }

  // Batch Download Trigger (Delegates to Background Worker)
  batchDownloadBtn.addEventListener('click', async () => {
    if (selectedIndices.size === 0) {
      showToast('No papers selected for download', 'error');
      return;
    }

    const selectedPapers = Array.from(selectedIndices).map(i => ({
      ...allDetectedPapers[i],
      originalIndex: i
    }));

    batchDownloadBtn.disabled = true;
    batchProgress.style.display = 'block';
    if (batchSummaryCard) batchSummaryCard.style.display = 'none';
    progressText.textContent = `Queuing ${selectedPapers.length} papers...`;
    progressPercent.textContent = '0%';
    progressBarFill.style.width = '0%';

    selectedPapers.forEach(p => {
      setRowStatus(p.originalIndex, 'downloading', 'In queue...');
    });

    chrome.runtime.sendMessage({
      action: 'start_batch_download',
      papers: selectedPapers,
      options: {
        skipDuplicates: skipDuplicatesCheckbox ? skipDuplicatesCheckbox.checked : true,
        templatePattern: activeTemplatePattern,
        subfolderName: userPrefs.subfolderName,
        saveToSubfolder: userPrefs.saveToSubfolder,
        maxTitleLength: userPrefs.maxTitleLength,
        enableSciHub: userPrefs.enableSciHub !== false,
        sciHubMirror: userPrefs.sciHubMirror || quickSciHubMirrorSelect?.value || 'https://www.sci-hub.ru/'
      }
    });

    startBatchPolling();
  });

  // Cancel Batch Download
  if (cancelBatchBtn) {
    cancelBatchBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'cancel_batch_download' }, () => {
        showToast('Stopping batch download...');
        progressText.textContent = 'Cancelling batch...';
      });
    });
  }

  // Poll Background Batch Progress
  let batchPollTimer = null;
  function startBatchPolling() {
    if (batchPollTimer) clearInterval(batchPollTimer);
    batchPollTimer = setInterval(async () => {
      chrome.runtime.sendMessage({ action: 'get_batch_status' }, (res) => {
        if (!res || !res.batchState) return;
        const bs = res.batchState;

        if (bs.total > 0) {
          const pct = Math.round((bs.current / bs.total) * 100);
          progressBarFill.style.width = `${pct}%`;
          progressPercent.textContent = `${pct}%`;
          if (bs.isRunning) {
            if (bs.statusMessage) {
              progressText.textContent = `${bs.statusMessage} [${bs.current}/${bs.total}]`;
            } else {
              const currentTitle = bs.currentPaperTitle ? ` (${bs.currentPaperTitle.slice(0, 25)}...)` : '';
              progressText.textContent = `Downloading ${bs.current}/${bs.total}${currentTitle}`;
            }
          } else if (bs.isCancelled) {
            progressText.textContent = 'Batch Stopped';
          } else {
            progressText.textContent = 'Batch Complete';
          }
        }

        // Update rows
        if (bs.results && bs.results.length > 0) {
          bs.results.forEach(r => {
            setRowStatus(r.index, r.status, r.reason);
          });
        }

        if (!bs.isRunning) {
          clearInterval(batchPollTimer);
          batchPollTimer = null;
          batchDownloadBtn.disabled = false;
          batchProgress.style.display = 'none';
          showBatchSummaryReport(bs);
        }
      });
    }, 450);
  }

  // Display Batch Report Summary Card
  function showBatchSummaryReport(bs) {
    if (!batchSummaryCard) return;
    batchSummaryCard.style.display = 'block';
    summarySuccess.textContent = bs.downloadedCount;
    summarySkipped.textContent = bs.skippedCount;
    summaryFailed.textContent = bs.failedCount;

    const failedItems = (bs.results || []).filter(r => r.status === 'failed');
    if (failedItems.length > 0 && summaryActions && copyFailedDoisBtn) {
      summaryActions.style.display = 'flex';
      copyFailedDoisBtn.onclick = () => {
        const failedDois = failedItems.map(f => f.doi || f.title).filter(Boolean).join('\n');
        navigator.clipboard.writeText(failedDois).then(() => {
          showToast(`📋 Copied ${failedItems.length} failed identifiers to clipboard!`);
        });
      };
    } else if (summaryActions) {
      summaryActions.style.display = 'none';
    }

    if (bs.downloadedCount > 0) {
      showToast(`✓ Batch complete: ${bs.downloadedCount} saved into Downloads/Papers/!`, 'success');
    } else if (bs.isCancelled) {
      showToast('Batch download was cancelled', 'error');
    } else if (bs.skippedCount > 0 && bs.failedCount === 0) {
      showToast('All selected papers already exist in Downloads', 'success');
    } else {
      showToast('No papers were downloaded (paywalled)', 'error');
    }
  }

  if (closeSummaryCard) {
    closeSummaryCard.addEventListener('click', () => {
      batchSummaryCard.style.display = 'none';
    });
  }

  // Batch BibTeX Export
  batchBibtexBtn.addEventListener('click', () => {
    if (selectedIndices.size === 0) {
      showToast('No papers selected', 'error');
      return;
    }
    const selectedPapers = Array.from(selectedIndices).map(i => allDetectedPapers[i]);
    showToast(`Compiling BibTeX for ${selectedPapers.length} papers...`);

    chrome.runtime.sendMessage({ action: 'batch_fetch_bibtex', papers: selectedPapers }, (res) => {
      if (res && res.success && res.bibtex) {
        navigator.clipboard.writeText(res.bibtex).then(() => {
          showToast(`📋 Copied ${selectedPapers.length} BibTeX entries to clipboard!`, 'success');
        });
      } else {
        showToast('Failed to compile batch BibTeX', 'error');
      }
    });
  });

  // Batch Export List (.txt)
  batchExportTxtBtn.addEventListener('click', () => {
    if (selectedIndices.size === 0) {
      showToast('No papers selected', 'error');
      return;
    }
    const selectedPapers = Array.from(selectedIndices).map(i => allDetectedPapers[i]);
    const lines = selectedPapers.map((p, idx) => {
      const title = p.title || p.snippet || 'Untitled Paper';
      const auth = (p.authors && p.authors.length) ? p.authors.join(', ') : (p.firstAuthor || '');
      const yr = p.year ? `(${p.year})` : '';
      const id = p.doi ? `https://doi.org/${p.doi}` : (p.arxivId ? `https://arxiv.org/abs/${p.arxivId}` : '');
      return `${idx + 1}. ${auth} ${yr} "${title}" ${id}`.trim();
    });

    const textOutput = lines.join('\n\n');
    navigator.clipboard.writeText(textOutput).then(() => {
      showToast(`💾 Copied list of ${selectedPapers.length} papers to clipboard!`, 'success');
    });
  });

  // Helper: download single item from batch list
  function downloadSingleBatchPaper(idx) {
    const paper = allDetectedPapers[idx];
    const filename = CONFIG.formatFilename(paper, activeTemplatePattern, {
      saveToSubfolder: userPrefs.saveToSubfolder,
      subfolderName: userPrefs.subfolderName,
      maxTitleLength: userPrefs.maxTitleLength
    });

    showToast('Resolving verified PDF link...');
    chrome.runtime.sendMessage({ action: 'resolve_pdf_url', paper }, (pdfRes) => {
      if (!pdfRes || !pdfRes.url) {
        showToast(`❌ ${pdfRes?.reason || 'Paywalled (No PDF found)'}`, 'error');
        setRowStatus(idx, 'failed', pdfRes?.reason || 'Paywalled');
        return;
      }

      chrome.runtime.sendMessage({ action: 'trigger_download', data: { url: pdfRes.url, filename } }, (res) => {
        if (res && res.success) {
          chrome.runtime.sendMessage({ action: 'mark_downloaded', paper, filename });
          showToast(`✓ Downloaded: ${paper.firstAuthor || 'Paper'}`, 'success');
          setRowStatus(idx, 'downloaded');
        } else {
          showToast(res?.error || 'Download failed', 'error');
          setRowStatus(idx, 'failed', res?.error || 'Download failed');
        }
      });
    });
  }

  // Helper: copy BibTeX for single item from batch list
  function copySingleBatchBibtex(idx) {
    const paper = allDetectedPapers[idx];
    chrome.runtime.sendMessage({ action: 'fetch_bibtex', data: paper }, (res) => {
      if (res && res.success && res.bibtex) {
        navigator.clipboard.writeText(res.bibtex).then(() => {
          showToast(`📋 BibTeX copied: ${paper.title ? paper.title.slice(0, 30) + '...' : 'Paper'}`);
        });
      }
    });
  }

  // Render Paper Data into UI
  function renderPaper(meta) {
    paperTitle.textContent = meta.title || meta.pageTitle || 'Untitled Paper';

    // Render Authors chips
    paperAuthors.innerHTML = '';
    const authors = meta.authors || (meta.firstAuthor ? [meta.firstAuthor] : []);
    if (authors.length > 0) {
      authors.slice(0, 4).forEach(author => {
        const chip = document.createElement('span');
        chip.className = 'author-chip';
        chip.textContent = author;
        chip.title = author;
        paperAuthors.appendChild(chip);
      });
      if (authors.length > 4) {
        const moreChip = document.createElement('span');
        moreChip.className = 'author-chip';
        moreChip.textContent = `+${authors.length - 4} more`;
        moreChip.title = authors.slice(4).join(', ');
        paperAuthors.appendChild(moreChip);
      }
    } else {
      const chip = document.createElement('span');
      chip.className = 'author-chip';
      chip.textContent = 'Unknown Author';
      paperAuthors.appendChild(chip);
    }

    // Venue & Year
    venueText.textContent = `${meta.journal || meta.venue || 'Academic Repository'} (${meta.year || '—'})`;

    // Identifier
    const canonicalUrl = (typeof CONFIG !== 'undefined' && CONFIG.getPaperUrl) ? CONFIG.getPaperUrl(meta) : '';
    if (meta.doi) {
      paperIdentifier.textContent = `DOI: ${meta.doi}`;
      paperIdentifier.title = canonicalUrl ? `Click to copy link: ${canonicalUrl} (Ctrl+click to open)` : 'Click to copy identifier';
      paperIdentifier.style.display = 'inline-block';
    } else if (meta.arxivId) {
      paperIdentifier.textContent = `arXiv: ${meta.arxivId}`;
      paperIdentifier.title = canonicalUrl ? `Click to copy link: ${canonicalUrl} (Ctrl+click to open)` : 'Click to copy identifier';
      paperIdentifier.style.display = 'inline-block';
    } else if (meta.pmid) {
      paperIdentifier.textContent = `PMID: ${meta.pmid}`;
      paperIdentifier.title = canonicalUrl ? `Click to copy link: ${canonicalUrl} (Ctrl+click to open)` : 'Click to copy identifier';
      paperIdentifier.style.display = 'inline-block';
    } else {
      paperIdentifier.style.display = 'none';
    }

    // Citations Badge
    if (meta.citationCount !== undefined && meta.citationCount !== null) {
      citationsBadge.textContent = `★ ${meta.citationCount.toLocaleString()} citations`;
      citationsBadge.style.display = 'inline-flex';
    } else {
      citationsBadge.style.display = 'none';
    }

    // Access Badge
    if (meta.isOpenAccess) {
      accessBadge.textContent = '🟢 Open Access';
      accessBadge.className = 'badge badge-oa open';
      accessBadge.style.display = 'inline-flex';
    } else if (meta.arxivId) {
      accessBadge.textContent = '🟠 Preprint (OA)';
      accessBadge.className = 'badge badge-oa open';
      accessBadge.style.display = 'inline-flex';
    } else if (meta.doi) {
      accessBadge.textContent = '🔒 Paywalled';
      accessBadge.className = 'badge badge-oa closed';
      accessBadge.style.display = 'inline-flex';
    }

    if (openSciHubBtn) {
      openSciHubBtn.style.display = meta.doi ? 'flex' : 'none';
    }

    // Enable Download CTA
    updateFilename();
    downloadBtn.disabled = false;
  }

  // Generate Filename from Active Pattern
  function updateFilename() {
    if (!currentMeta) return;

    const formatted = CONFIG.formatFilename(currentMeta, activeTemplatePattern, {
      maxTitleLength: userPrefs.maxTitleLength
    });

    filenameInput.value = formatted;
    updateSubfolderPrefix();
  }

  function updateSubfolderPrefix() {
    if (userPrefs.saveToSubfolder && userPrefs.subfolderName) {
      subfolderPrefixText.textContent = `Downloads/${userPrefs.subfolderName}/`;
      subfolderPrefixText.parentElement.style.display = 'flex';
    } else {
      subfolderPrefixText.textContent = 'Downloads/';
    }
  }

  // Preset Template Chips
  templateChips.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      templateChips.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const templateId = btn.dataset.id;
      const found = CONFIG.TEMPLATES.find(t => t.id === templateId);
      if (found) {
        activeTemplatePattern = found.pattern;
        savePreference(CONFIG.STORAGE_KEYS.templatePattern, activeTemplatePattern);
        updateFilename();
        showToast(`Applied ${found.name.split(':')[0]}`);
      }
    });
  });

  // Reset Filename to Current Template
  resetFilenameBtn.addEventListener('click', () => {
    updateFilename();
    showToast('Reset to template pattern');
  });

  // Identifier click to copy link (or Ctrl+click to open)
  paperIdentifier.addEventListener('click', (e) => {
    if (!currentMeta) return;
    const paperUrl = (typeof CONFIG !== 'undefined' && CONFIG.getPaperUrl) ? CONFIG.getPaperUrl(currentMeta) : '';
    if ((e.ctrlKey || e.metaKey) && paperUrl) {
      chrome.tabs.create({ url: paperUrl });
      showToast('Opening paper in new tab...', 'success');
      return;
    }
    const textToCopy = paperUrl || currentMeta.doi || currentMeta.arxivId || currentMeta.pmid || '';
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        showToast(`📋 Copied link: ${textToCopy}`, 'success');
      });
    }
  });

  // Download Trigger
  downloadBtn.addEventListener('click', async () => {
    if (!currentMeta) return;

    let targetFilename = filenameInput.value.trim();
    if (!targetFilename) {
      showToast('Please specify a filename', 'error');
      return;
    }

    // Apply subfolder if enabled
    if (userPrefs.saveToSubfolder && userPrefs.subfolderName) {
      const cleanSub = CONFIG.sanitizeString(userPrefs.subfolderName, 40).replace(/[\\/]/g, '');
      if (cleanSub && !targetFilename.startsWith(cleanSub + '/')) {
        targetFilename = `${cleanSub}/${targetFilename}`;
      }
    }

    // Resolve best verified PDF URL (Never download HTML landing pages)
    downloadBtn.disabled = true;
    downloadBtn.classList.add('downloading');
    downloadBtnText.textContent = 'Resolving PDF...';

    chrome.runtime.sendMessage({ action: 'resolve_pdf_url', paper: currentMeta }, (pdfRes) => {
      if (!pdfRes || !pdfRes.url) {
        downloadBtn.disabled = false;
        downloadBtn.classList.remove('downloading');
        downloadBtnText.textContent = 'Download & Smart Rename PDF';
        showToast(`❌ ${pdfRes?.reason || 'Paywalled: No PDF found'}`, 'error');
        return;
      }

      downloadBtnText.textContent = 'Downloading PDF...';
      chrome.runtime.sendMessage({
        action: 'trigger_download',
        data: { url: pdfRes.url, filename: targetFilename }
      }, (res) => {
        downloadBtn.disabled = false;
        downloadBtn.classList.remove('downloading');

        if (res && res.success) {
          chrome.runtime.sendMessage({ action: 'mark_downloaded', paper: currentMeta, filename: targetFilename });
          downloadBtn.classList.add('success');
          downloadBtnText.textContent = '✓ Downloaded & Renamed!';
          showToast('PDF downloaded successfully!', 'success');
          setTimeout(() => {
            downloadBtn.classList.remove('success');
            downloadBtnText.textContent = 'Download & Smart Rename PDF';
          }, 3000);
        } else {
          downloadBtnText.textContent = 'Download & Smart Rename PDF';
          showToast(res?.error || 'Download failed', 'error');
        }
      });
    });
  });

  // Copy BibTeX
  bibtexBtn.addEventListener('click', () => {
    if (!currentMeta) return;
    showToast('Fetching authoritative BibTeX...');

    chrome.runtime.sendMessage({
      action: 'fetch_bibtex',
      data: currentMeta
    }, (res) => {
      if (res && res.success && res.bibtex) {
        navigator.clipboard.writeText(res.bibtex).then(() => {
          showToast('📋 BibTeX copied to clipboard!', 'success');
        });
      } else {
        showToast('Failed to fetch BibTeX', 'error');
      }
    });
  });

  // Copy APA Citation
  apaCitationBtn.addEventListener('click', () => {
    if (!currentMeta) return;
    const apa = formatApaCitation(currentMeta);
    navigator.clipboard.writeText(apa).then(() => {
      showToast('📎 APA citation copied!', 'success');
    });
  });

  // Find Open Access Full Text
  unpaywallBtn.addEventListener('click', () => {
    if (!currentMeta || !currentMeta.doi) {
      if (currentMeta && currentMeta.arxivId) {
        showToast('Preprint is already freely available on arXiv!');
        return;
      }
      showToast('No DOI available to query Unpaywall', 'error');
      return;
    }

    oaBtnText.textContent = 'Searching OA...';
    chrome.runtime.sendMessage({
      action: 'find_unpaywall',
      doi: currentMeta.doi
    }, (res) => {
      oaBtnText.textContent = 'Find Open Access';
      if (res && res.success && res.oaPdfUrl) {
        currentMeta.pdfUrl = res.oaPdfUrl;
        currentMeta.isOpenAccess = true;
        accessBadge.textContent = '🟢 OA Found!';
        accessBadge.className = 'badge badge-oa open';
        accessBadge.style.display = 'inline-flex';
        unpaywallBtn.classList.add('active-oa');
        showToast('🔓 Free Open Access PDF found & linked!', 'success');
      } else {
        showToast('No legal Open Access PDF located', 'error');
      }
    });
  });

  // Open Paper in Tab
  openLinkBtn.addEventListener('click', () => {
    if (!currentMeta) return;
    const targetUrl = currentMeta.url || (currentMeta.doi ? `https://doi.org/${currentMeta.doi}` : (currentMeta.arxivId ? `https://arxiv.org/abs/${currentMeta.arxivId}` : null));
    if (targetUrl) {
      chrome.tabs.create({ url: targetUrl });
    }
  });

  // Open Paper in Sci-Hub Tab (Bypasses bot check interactively)
  if (openSciHubBtn) {
    openSciHubBtn.addEventListener('click', () => {
      if (!currentMeta || !currentMeta.doi) {
        showToast('No DOI available for Sci-Hub', 'error');
        return;
      }
      const mirror = (userPrefs.sciHubMirror || quickSciHubMirrorSelect?.value || 'https://www.sci-hub.ru/').replace(/\/+$/, '');
      const targetUrl = `${mirror}/${currentMeta.doi}`;
      chrome.tabs.create({ url: targetUrl });
      showToast('Opening paper in Sci-Hub tab...', 'success');
    });
  }

  // Quick Settings Drawer Toggle
  openSettingsBtn.addEventListener('click', () => {
    settingsDrawer.classList.toggle('open');
  });
  closeSettingsDrawer.addEventListener('click', () => {
    settingsDrawer.classList.remove('open');
  });
  configureTemplateLink.addEventListener('click', () => {
    settingsDrawer.classList.add('open');
    customTemplateInput.focus();
  });

  // Subfolder Settings change
  saveSubfolderCheckbox.addEventListener('change', () => {
    userPrefs.saveToSubfolder = saveSubfolderCheckbox.checked;
    savePreference(CONFIG.STORAGE_KEYS.saveToSubfolder, userPrefs.saveToSubfolder);
    updateSubfolderPrefix();
  });

  subfolderInput.addEventListener('input', () => {
    userPrefs.subfolderName = subfolderInput.value.trim() || CONFIG.DEFAULT_SUBFOLDER;
    savePreference(CONFIG.STORAGE_KEYS.subfolderName, userPrefs.subfolderName);
    updateSubfolderPrefix();
  });

  // Custom Template Pattern
  customTemplateInput.addEventListener('input', () => {
    const val = customTemplateInput.value.trim();
    if (val) {
      activeTemplatePattern = val;
      savePreference(CONFIG.STORAGE_KEYS.templatePattern, activeTemplatePattern);
      templateChips.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
      updateFilename();
    }
  });

  // Options Page Button
  openOptionsPageBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Helper: Token cloud pills in settings drawer
  function initTokenCloud() {
    tokenCloud.innerHTML = '';
    CONFIG.TOKENS.forEach(t => {
      const tag = document.createElement('span');
      tag.className = 'token-tag';
      tag.textContent = `+${t.token}`;
      tag.title = `${t.label} (e.g. ${t.example})`;
      tag.addEventListener('click', () => {
        customTemplateInput.value += t.token;
        activeTemplatePattern = customTemplateInput.value.trim();
        savePreference(CONFIG.STORAGE_KEYS.templatePattern, activeTemplatePattern);
        updateFilename();
      });
      tokenCloud.appendChild(tag);
    });
  }

  // Helper: Format APA reference
  function formatApaCitation(m) {
    const authors = (m.authors && m.authors.length)
      ? (m.authors.length > 5 ? m.authors.slice(0, 5).join(', ') + ', ...' : m.authors.join(', '))
      : (m.firstAuthor || 'Unknown');
    const yr = m.year ? `(${m.year})` : '(n.d.)';
    const title = m.title ? `${m.title}.` : '';
    const journal = m.journal ? `${m.journal}.` : '';
    const doiPart = m.doi ? ` https://doi.org/${m.doi}` : '';
    return `${authors} ${yr}. ${title} ${journal}${doiPart}`;
  }

  // Helper: Toast alert
  let toastTimer = null;
  function showToast(msg, type = '') {
    if (toastTimer) clearTimeout(toastTimer);
    toastMessage.textContent = msg;
    toast.className = `toast show ${type}`;
    toastTimer = setTimeout(() => {
      toast.className = 'toast';
    }, 2600);
  }

  function setSourceBadge(text, extraClass = '') {
    sourceBadge.textContent = text;
    sourceBadge.className = `badge ${extraClass}`;
  }

  function showScanError(msg) {
    paperTitle.textContent = msg;
    paperAuthors.innerHTML = '<span class="author-chip">No publication detected</span>';
    setSourceBadge('Idle', '');
    if (tabPaperCountBadge) {
      tabPaperCountBadge.style.display = 'none';
    }
    if (tab && tab.id) {
      chrome.runtime.sendMessage({
        action: 'update_badge_count',
        count: 0,
        tabId: tab.id
      });
    }
    downloadBtn.disabled = true;
    venueText.textContent = 'Navigate to any research paper or preprint';
  }

  function sniffUrlDirectly(url) {
    if (!url) return {};
    const res = {};
    const doi = CONFIG.cleanDoi(url);
    if (doi) res.doi = doi;

    const arxivMatch = url.match(CONFIG.PATTERNS.arxiv);
    if (arxivMatch) res.arxivId = arxivMatch[1];

    const pmidMatch = url.match(CONFIG.PATTERNS.pmid);
    if (pmidMatch) res.pmid = pmidMatch[1];
    return res;
  }

  async function loadPreferences() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([
        CONFIG.STORAGE_KEYS.templatePattern,
        CONFIG.STORAGE_KEYS.saveToSubfolder,
        CONFIG.STORAGE_KEYS.subfolderName,
        CONFIG.STORAGE_KEYS.maxTitleLength,
        CONFIG.STORAGE_KEYS.enableSciHub,
        CONFIG.STORAGE_KEYS.sciHubMirror
      ], (items) => {
        if (items[CONFIG.STORAGE_KEYS.templatePattern]) {
          activeTemplatePattern = items[CONFIG.STORAGE_KEYS.templatePattern];
          customTemplateInput.value = activeTemplatePattern;

          // Highlight matching chip if matches standard preset
          const matchingChip = CONFIG.TEMPLATES.find(t => t.pattern === activeTemplatePattern);
          if (matchingChip) {
            templateChips.querySelectorAll('.chip-btn').forEach(b => {
              b.classList.toggle('active', b.dataset.id === matchingChip.id);
            });
          }
        }
        if (items[CONFIG.STORAGE_KEYS.saveToSubfolder] !== undefined) {
          userPrefs.saveToSubfolder = items[CONFIG.STORAGE_KEYS.saveToSubfolder];
          saveSubfolderCheckbox.checked = userPrefs.saveToSubfolder;
        }
        if (items[CONFIG.STORAGE_KEYS.subfolderName]) {
          userPrefs.subfolderName = items[CONFIG.STORAGE_KEYS.subfolderName];
          subfolderInput.value = userPrefs.subfolderName;
        }
        if (items[CONFIG.STORAGE_KEYS.maxTitleLength]) {
          userPrefs.maxTitleLength = items[CONFIG.STORAGE_KEYS.maxTitleLength];
        }
        userPrefs.enableSciHub = items[CONFIG.STORAGE_KEYS.enableSciHub] !== undefined
          ? items[CONFIG.STORAGE_KEYS.enableSciHub]
          : true;
        if (enableSciHubCheckbox) {
          enableSciHubCheckbox.checked = userPrefs.enableSciHub;
        }
        if (items[CONFIG.STORAGE_KEYS.sciHubMirror]) {
          userPrefs.sciHubMirror = items[CONFIG.STORAGE_KEYS.sciHubMirror];
          if (quickSciHubMirrorSelect) {
            quickSciHubMirrorSelect.value = userPrefs.sciHubMirror;
          }
        }
        if (quickSciHubMirrorGroup && enableSciHubCheckbox) {
          quickSciHubMirrorGroup.style.display = enableSciHubCheckbox.checked ? 'block' : 'none';
        }
        if (enableSciHubCheckbox) {
          enableSciHubCheckbox.addEventListener('change', () => {
            userPrefs.enableSciHub = enableSciHubCheckbox.checked;
            savePreference(CONFIG.STORAGE_KEYS.enableSciHub, userPrefs.enableSciHub);
            if (quickSciHubMirrorGroup) {
              quickSciHubMirrorGroup.style.display = userPrefs.enableSciHub ? 'block' : 'none';
            }
            showToast(userPrefs.enableSciHub ? 'Sci-Hub fallback enabled' : 'Sci-Hub fallback disabled');
          });
        }
        if (quickSciHubMirrorSelect) {
          quickSciHubMirrorSelect.addEventListener('change', () => {
            userPrefs.sciHubMirror = quickSciHubMirrorSelect.value;
            savePreference(CONFIG.STORAGE_KEYS.sciHubMirror, userPrefs.sciHubMirror);
            showToast(`Sci-Hub mirror: ${quickSciHubMirrorSelect.options[quickSciHubMirrorSelect.selectedIndex].text}`);
          });
        }
        updateSubfolderPrefix();
        resolve();
      });
    });
  }

  function savePreference(key, value) {
    chrome.storage.sync.set({ [key]: value });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});

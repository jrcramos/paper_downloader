// Background service worker for Paper Downloader & Smart Renamer
importScripts('config.js');

// Register context menus on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'paper_download_selection',
    title: '📥 Download & Smart Rename Paper',
    contexts: ['selection', 'link', 'page']
  });

  chrome.contextMenus.create({
    id: 'paper_copy_bibtex',
    title: '📋 Copy Paper BibTeX to Clipboard',
    contexts: ['selection', 'link', 'page']
  });
});

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const targetText = info.selectionText || info.linkUrl || (tab ? tab.url : '') || '';
  if (!targetText) return;

  const identifiers = extractIdentifiers(targetText);
  if (!identifiers.doi && !identifiers.arxivId && !identifiers.pmid) return;

  // Resolve metadata
  const res = await handleMetadataFetch(identifiers);
  if (!res.success || !res.meta) return;

  const meta = res.meta;

  if (info.menuItemId === 'paper_download_selection') {
    const prefs = await getStoredPreferences();
    const cleanFilename = CONFIG.formatFilename(meta, prefs.templatePattern, {
      saveToSubfolder: prefs.saveToSubfolder,
      subfolderName: prefs.subfolderName,
      maxTitleLength: prefs.maxTitleLength
    });

    const pdfRes = await resolvePdfUrlForPaper(meta, prefs);
    if (pdfRes && pdfRes.url) {
      await triggerSmartDownload({ url: pdfRes.url, filename: cleanFilename });
    }
  } else if (info.menuItemId === 'paper_copy_bibtex') {
    const bibtex = await getAuthoritativeBibTeX(meta);
    if (tab && tab.id) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (textToCopy) => {
          navigator.clipboard.writeText(textToCopy);
        },
        args: [bibtex]
      }).catch(err => console.warn('Clipboard write error:', err));
    }
  }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetch_metadata') {
    handleMetadataFetch(request.data).then(sendResponse);
    return true;
  } else if (request.action === 'trigger_download') {
    triggerSmartDownload(request.data).then(sendResponse);
    return true;
  } else if (request.action === 'fetch_bibtex') {
    getAuthoritativeBibTeX(request.data).then(bib => sendResponse({ success: true, bibtex: bib }));
    return true;
  } else if (request.action === 'find_unpaywall') {
    findUnpaywallPdf(request.doi).then(oa => sendResponse(oa));
    return true;
  } else if (request.action === 'batch_fetch_metadata') {
    handleBatchMetadataFetch(request.papers).then(sendResponse);
    return true;
  } else if (request.action === 'batch_download') {
    handleBatchDownload(request.items).then(sendResponse);
    return true;
  } else if (request.action === 'resolve_pdf_url') {
    getStoredPreferences().then(prefs => {
      resolvePdfUrlForPaper(request.paper, prefs).then(sendResponse);
    });
    return true;
  } else if (request.action === 'start_batch_download') {
    executeBatchDownload(request.papers, request.options).then(sendResponse);
    return true;
  } else if (request.action === 'cancel_batch_download') {
    activeBatchState.isCancelled = true;
    activeBatchState.isRunning = false;
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'get_batch_status') {
    sendResponse({ success: true, batchState: activeBatchState });
    return true;
  } else if (request.action === 'check_duplicates') {
    checkBatchDuplicates(request.papers || request.filenames).then(duplicatesMap => sendResponse({ success: true, duplicatesMap }));
    return true;
  } else if (request.action === 'mark_downloaded') {
    markPaperAsDownloaded(request.paper, request.filename).then(() => sendResponse({ success: true }));
    return true;
  } else if (request.action === 'update_badge_count') {
    const tabId = (sender && sender.tab) ? sender.tab.id : request.tabId;
    if (tabId) {
      updateTabBadge(tabId, request.count);
    }
    sendResponse({ success: true });
    return true;
  }
});

// Update Extension Toolbar Action Badge per Tab
function updateTabBadge(tabId, count) {
  if (!tabId) return;
  const countNum = parseInt(count, 10) || 0;
  const text = countNum > 0 ? (countNum > 999 ? '999+' : String(countNum)) : '';

  try {
    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({
      color: countNum > 0 ? '#0284c7' : '#64748b',
      tabId
    });
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({
        color: '#ffffff',
        tabId
      });
    }
  } catch (err) {
    console.warn('Could not set badge:', err);
  }
}

// Clear badge when navigating away on a tab
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    chrome.action.setBadgeText({ text: '', tabId });
  }
});

// Handle keyboard shortcut commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'quick_download') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    chrome.tabs.sendMessage(tab.id, { action: 'sniff_paper' }, async (response) => {
      if (response && response.data) {
        const metaRes = await handleMetadataFetch(response.data);
        const meta = (metaRes && metaRes.meta) ? { ...response.data, ...metaRes.meta } : response.data;
        const prefs = await getStoredPreferences();
        const filename = CONFIG.formatFilename(meta, prefs.templatePattern, {
          saveToSubfolder: prefs.saveToSubfolder,
          subfolderName: prefs.subfolderName,
          maxTitleLength: prefs.maxTitleLength
        });

        const pdfRes = await resolvePdfUrlForPaper(meta, prefs);
        if (pdfRes && pdfRes.url) {
          await triggerSmartDownload({ url: pdfRes.url, filename });
        }
      }
    });
  }
});

// Helper: extract identifiers from raw string or URL
function extractIdentifiers(text) {
  const result = {};
  const doi = CONFIG.cleanDoi(text);
  if (doi) result.doi = doi;

  const arxivMatch = text.match(CONFIG.PATTERNS.arxiv);
  if (arxivMatch) result.arxivId = arxivMatch[1];

  const pmidMatch = text.match(CONFIG.PATTERNS.pmid);
  if (pmidMatch) result.pmid = pmidMatch[1];

  return result;
}

// Cascade Metadata Resolver
async function handleMetadataFetch(data) {
  try {
    let baseMeta = { ...data };

    // 1. PMID resolution to DOI first if available
    if (!baseMeta.doi && baseMeta.pmid) {
      const pmidMeta = await fetchPubMedMetadata(baseMeta.pmid);
      if (pmidMeta) {
        baseMeta = { ...baseMeta, ...pmidMeta };
      }
    }

    // 2. Crossref authoritative query if DOI is present
    if (baseMeta.doi) {
      const crossrefMeta = await fetchCrossrefMetadata(baseMeta.doi);
      if (crossrefMeta) {
        baseMeta = { ...baseMeta, ...crossrefMeta };
        if (crossrefMeta.crossrefPdfUrl && !baseMeta.pdfUrl) {
          baseMeta.pdfUrl = crossrefMeta.crossrefPdfUrl;
        }
      }

      // Check Unpaywall & Semantic Scholar in parallel for OA PDF and citations
      const [oaInfo, s2Info] = await Promise.allSettled([
        findUnpaywallPdf(baseMeta.doi),
        fetchSemanticScholarMetadata(`DOI:${baseMeta.doi}`)
      ]);

      if (oaInfo.status === 'fulfilled' && oaInfo.value && oaInfo.value.success) {
        baseMeta.oaPdfUrl = oaInfo.value.oaPdfUrl;
        baseMeta.isOpenAccess = true;
        if (!baseMeta.pdfUrl) {
          baseMeta.pdfUrl = oaInfo.value.oaPdfUrl;
        }
      }

      if (s2Info.status === 'fulfilled' && s2Info.value) {
        baseMeta.citationCount = s2Info.value.citationCount;
        baseMeta.venue = s2Info.value.venue || baseMeta.journal;
        if (!baseMeta.pdfUrl && s2Info.value.openAccessPdf && isExplicitPdfUrl(s2Info.value.openAccessPdf.url) && !isHtmlLandingPage(s2Info.value.openAccessPdf.url)) {
          baseMeta.pdfUrl = s2Info.value.openAccessPdf.url;
        }
      }

      return { success: true, meta: baseMeta };
    }

    // 3. arXiv resolver if arXiv ID is present
    if (baseMeta.arxivId) {
      const arxivMeta = await fetchArxivMetadata(baseMeta.arxivId);
      if (arxivMeta) {
        baseMeta = { ...baseMeta, ...arxivMeta };
      }

      // Query Semantic Scholar for arXiv paper citations
      const s2Info = await fetchSemanticScholarMetadata(`ARXIV:${baseMeta.arxivId}`);
      if (s2Info) {
        baseMeta.citationCount = s2Info.citationCount;
        if (s2Info.venue) baseMeta.journal = s2Info.venue;
      }

      return { success: true, meta: baseMeta };
    }

    // Fallback: If title exists from page, query Semantic Scholar by title search
    if (baseMeta.title && baseMeta.title.length > 10) {
      const s2Title = await fetchSemanticScholarByTitle(baseMeta.title);
      if (s2Title) {
        baseMeta = { ...baseMeta, ...s2Title };
        return { success: true, meta: baseMeta };
      }
    }

    return { success: false, error: 'No authoritative metadata found' };
  } catch (err) {
    console.warn('Metadata fetch error:', err);
    return { success: false, error: err.message };
  }
}

// 1. Crossref API
async function fetchCrossrefMetadata(doi) {
  try {
    const cleanDoi = doi.trim();
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`, {
      headers: {
        'User-Agent': 'PaperDownloaderExtension/1.0 (mailto:paper_downloader_ext@academic.org)'
      }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const item = json.message;
    if (!item) return null;

    const title = item.title && item.title.length ? item.title[0] : '';
    const rawAuthors = item.author || [];
    const authors = rawAuthors.map(a => {
      if (a.name) return a.name;
      const given = a.given ? a.given.trim() : '';
      const family = a.family ? a.family.trim() : '';
      return family && given ? `${family}, ${given}` : (family || given || '');
    }).filter(Boolean);

    const firstAuthor = rawAuthors.length > 0
      ? (rawAuthors[0].family || rawAuthors[0].name || 'UnknownAuthor')
      : 'UnknownAuthor';
    const lastAuthor = rawAuthors.length > 1
      ? (rawAuthors[rawAuthors.length - 1].family || rawAuthors[rawAuthors.length - 1].name || firstAuthor)
      : firstAuthor;

    let year = '';
    if (item['published-print'] && item['published-print']['date-parts']) {
      year = item['published-print']['date-parts'][0][0];
    } else if (item['published-online'] && item['published-online']['date-parts']) {
      year = item['published-online']['date-parts'][0][0];
    } else if (item.created && item.created['date-parts']) {
      year = item.created['date-parts'][0][0];
    }

    const journal = item['container-title'] && item['container-title'].length ? item['container-title'][0] : '';

    let crossrefPdfUrl = null;
    if (item.link && Array.isArray(item.link)) {
      const pdfLinks = item.link.filter(l => 
        l.URL && (
          l['content-type'] === 'application/pdf' || 
          l['intended-application'] === 'syndication' ||
          l['intended-application'] === 'text-mining' ||
          l.URL.toLowerCase().endsWith('.pdf') ||
          l.URL.toLowerCase().includes('article-pdf') ||
          l.URL.toLowerCase().includes('/pdf/')
        ) && !isHtmlLandingPage(l.URL)
      );
      const vorLink = pdfLinks.find(l => l['content-version'] === 'vor');
      const bestLink = vorLink || pdfLinks[0];
      if (bestLink && bestLink.URL) {
        crossrefPdfUrl = bestLink.URL;
      }
    }

    return {
      doi: cleanDoi,
      title: title.replace(/\s+/g, ' ').trim(),
      authors,
      firstAuthor: firstAuthor.trim(),
      lastAuthor: lastAuthor.trim(),
      year: year ? String(year) : new Date().getFullYear().toString(),
      journal: journal.trim(),
      publisher: item.publisher || '',
      crossrefPdfUrl
    };
  } catch (e) {
    console.warn('Crossref error:', e);
    return null;
  }
}

// 2. arXiv API
async function fetchArxivMetadata(arxivId) {
  try {
    const cleanId = arxivId.replace(/^arxiv:/i, '').trim();
    const res = await fetch(`https://export.arxiv.org/api/query?id_list=${cleanId}`);
    if (!res.ok) return null;
    const xml = await res.text();

    const titleMatch = xml.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/);
    const authorMatches = xml.match(/<author>[\s\S]*?<name>(.*?)<\/name>/g) || [];
    const publishedMatch = xml.match(/<published>(\d{4})/);
    const summaryMatch = xml.match(/<summary>([\s\S]*?)<\/summary>/);

    const title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
    const authors = authorMatches.map(m => m.replace(/<[\s\S]*?>/g, '').trim());
    const firstAuthor = authors[0] ? authors[0].split(/\s+/).pop() : 'UnknownAuthor';
    const lastAuthor = authors.length > 1 ? authors[authors.length - 1].split(/\s+/).pop() : firstAuthor;
    const year = publishedMatch ? publishedMatch[1] : new Date().getFullYear().toString();

    return {
      arxivId: cleanId,
      title,
      authors,
      firstAuthor,
      lastAuthor,
      year,
      journal: 'arXiv',
      pdfUrl: `https://arxiv.org/pdf/${cleanId}.pdf`,
      summary: summaryMatch ? summaryMatch[1].trim() : ''
    };
  } catch (e) {
    console.warn('arXiv API error:', e);
    return null;
  }
}

// 3. Semantic Scholar API
async function fetchSemanticScholarMetadata(identifier) {
  try {
    const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(identifier)}?fields=title,authors,year,venue,citationCount,isOpenAccess,openAccessPdf`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('Semantic Scholar error:', e);
    return null;
  }
}

// Semantic Scholar Title Search
async function fetchSemanticScholarByTitle(title) {
  try {
    const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=1&fields=title,authors,year,venue,citationCount,externalIds,openAccessPdf`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.data || !json.data.length) return null;
    const item = json.data[0];

    const authors = (item.authors || []).map(a => a.name);
    const firstAuthor = authors[0] ? authors[0].split(/\s+/).pop() : 'UnknownAuthor';
    const doi = item.externalIds ? item.externalIds.DOI : null;
    const arxivId = item.externalIds ? item.externalIds.ArXiv : null;

    return {
      title: item.title,
      authors,
      firstAuthor,
      year: item.year ? String(item.year) : '',
      journal: item.venue || '',
      citationCount: item.citationCount,
      doi,
      arxivId,
      pdfUrl: item.openAccessPdf ? item.openAccessPdf.url : null
    };
  } catch (e) {
    return null;
  }
}

// Helper: verify if URL explicitly points to a PDF
function isExplicitPdfUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  const clean = lower.split(/[?#]/)[0];
  return clean.endsWith('.pdf') || 
         clean.includes('/pdf/') || 
         clean.includes('/pdfdirect/') || 
         lower.includes('arxiv.org/pdf') || 
         lower.includes('type=printable');
}

// Helper: detect if a URL is an HTML landing page
function isHtmlLandingPage(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.toLowerCase();
  if (lower.match(/^https?:\/\/doi\.org\/10\.\d{4,9}\/[^/]+$/)) return true;
  if (lower.includes('idp.nature.com') || lower.includes('nature.com/articles/nature') || lower.includes('nature.com/articles/ng')) return true;
  if (lower.includes('nature.com/articles/') && !lower.endsWith('.pdf')) return true;
  if (lower.includes('sciencedirect.com/science/article/') && !lower.includes('pdfft')) return true;
  if (lower.includes('cell.com/') && !lower.includes('.pdf')) return true;
  if (lower.includes('ncbi.nlm.nih.gov/pmc/articles/') && !lower.endsWith('/pdf/')) return true;
  return false;
}

// 4. Unpaywall API
async function findUnpaywallPdf(doi) {
  try {
    const prefs = await getStoredPreferences();
    const email = prefs.unpaywallEmail || CONFIG.DEFAULT_UNPAYWALL_EMAIL;
    const res = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`);
    if (!res.ok) return { success: false, error: 'Unpaywall query failed' };

    const json = await res.json();
    if (!json.is_oa) {
      return { success: false, error: 'No free Open Access copy found' };
    }

    // Check all oa_locations for an explicit PDF URL (never return HTML landing pages!)
    const locations = json.oa_locations || (json.best_oa_location ? [json.best_oa_location] : []);
    for (const loc of locations) {
      if (!loc) continue;
      const candidate = loc.url_for_pdf || (isExplicitPdfUrl(loc.url) ? loc.url : null);
      if (candidate && !isHtmlLandingPage(candidate)) {
        return {
          success: true,
          oaPdfUrl: candidate,
          hostType: loc.host_type,
          version: loc.version
        };
      }
    }

    return { success: false, error: 'Article is OA but no direct PDF link could be verified' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 5. PubMed E-utilities
async function fetchPubMedMetadata(pmid) {
  try {
    const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`);
    if (!res.ok) return null;
    const json = await res.json();
    const result = json.result && json.result[pmid];
    if (!result) return null;

    const doiObj = (result.articleids || []).find(id => id.idtype === 'doi');
    const doi = doiObj ? doiObj.value : null;
    const title = result.title ? result.title.replace(/\.$/, '') : '';
    const authors = (result.authors || []).map(a => a.name);
    const firstAuthor = authors[0] ? authors[0].split(/\s+/).pop() : 'UnknownAuthor';
    const year = result.pubdate ? result.pubdate.match(/\b(19\d\d|20\d\d)\b/)?.[1] : '';

    return {
      pmid,
      doi,
      title,
      authors,
      firstAuthor,
      year: year || '',
      journal: result.source || ''
    };
  } catch (e) {
    return null;
  }
}

// 6. Authoritative BibTeX via DOI Content Negotiation
async function getAuthoritativeBibTeX(meta) {
  if (meta.doi) {
    try {
      const res = await fetch(`https://doi.org/${encodeURIComponent(meta.doi)}`, {
        headers: {
          'Accept': 'application/x-bibtex; charset=utf-8'
        }
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.includes('@')) {
          return text.trim();
        }
      }
    } catch (e) {
      console.warn('DOI BibTeX content negotiation error:', e);
    }
  }

  // Fallback BibTeX generator
  const cleanKey = (meta.firstAuthor || 'paper').replace(/[^a-zA-Z0-9]/g, '') + (meta.year || '');
  const authorsStr = (meta.authors && meta.authors.length) ? meta.authors.join(' and ') : (meta.firstAuthor || 'Unknown');
  return `@article{${cleanKey},
  title={${meta.title || ''}},
  author={${authorsStr}},
  journal={${meta.journal || 'arXiv'}},
  year={${meta.year || ''}},
  ${meta.doi ? `doi={${meta.doi}},` : ''}
  ${meta.arxivId ? `eprint={${meta.arxivId}},\n  archivePrefix={arXiv},` : ''}
  url={${meta.url || (meta.doi ? `https://doi.org/${meta.doi}` : '')}}
}`;
}

// Active tracking of intended filenames for downloads
const intendedDownloads = new Map(); // downloadId -> filename
const pendingUrlFilenames = new Map(); // url -> filename

// Download manager with subfolder support and strict HTML rejection
async function triggerSmartDownload(data) {
  let { url, filename } = data;
  if (!url || isHtmlLandingPage(url)) {
    return { success: false, error: 'Cannot download HTML webpage as PDF' };
  }

  // Ensure subfolder is prepended if enabled in user preferences
  const prefs = await getStoredPreferences();
  if (prefs.saveToSubfolder && prefs.subfolderName) {
    const cleanSub = CONFIG.sanitizeString(prefs.subfolderName, 40).replace(/[\\/]/g, '');
    if (cleanSub && !filename.startsWith(cleanSub + '/') && !filename.startsWith(cleanSub + '\\')) {
      filename = `${cleanSub}/${filename}`;
    }
  }

  // Normalize slashes to forward slashes for Chrome's download API
  filename = filename.replace(/\\/g, '/');

  // Register URL in pending map before starting download
  pendingUrlFilenames.set(url, filename);

  return new Promise((resolve) => {
    chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        pendingUrlFilenames.delete(url);
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        if (downloadId) {
          intendedDownloads.set(downloadId, filename);
        }
        resolve({ success: true, downloadId });
      }
    });
  });
}

// Active tracking of HTML-cancelled downloads and download completions
const cancelledHtmlDownloads = new Map(); // downloadId -> reason string

// Intercept all downloads: enforce custom filename/subfolder & abort HTML downloads
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  // Look up intended filename registered by our extension
  const intendedFilename = intendedDownloads.get(downloadItem.id) || pendingUrlFilenames.get(downloadItem.url);

  // 1. If server returned HTML for a paper download, cancel and erase immediately!
  if (downloadItem.mime === 'text/html' || (intendedFilename && downloadItem.filename && (downloadItem.filename.endsWith('.htm') || downloadItem.filename.endsWith('.html')))) {
    console.warn('Prevented accidental HTML download:', downloadItem.id, downloadItem.url);
    cancelledHtmlDownloads.set(downloadItem.id, 'Server returned HTML paywall or bot challenge page instead of PDF');
    chrome.downloads.cancel(downloadItem.id, () => {
      chrome.downloads.erase({ id: downloadItem.id });
    });
    if (downloadItem.id) intendedDownloads.delete(downloadItem.id);
    pendingUrlFilenames.delete(downloadItem.url);
    return;
  }

  // 2. ENFORCE the intended smart filename and subfolder!
  if (intendedFilename) {
    suggest({
      filename: intendedFilename,
      conflictAction: 'uniquify'
    });
    // Keep in map briefly in case of redirects, then clean up
    setTimeout(() => {
      if (downloadItem.id) intendedDownloads.delete(downloadItem.id);
      pendingUrlFilenames.delete(downloadItem.url);
    }, 5000);
    return;
  }

  // Allow other downloads to proceed normally
  suggest();
});

// Await download completion to guarantee file actually finished on disk
function waitForDownloadToFinish(downloadId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let timer = null;

    function cleanup() {
      if (timer) clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
    }

    function listener(delta) {
      if (delta.id !== downloadId) return;

      if (delta.state) {
        if (delta.state.current === 'complete') {
          cleanup();
          resolve({ success: true, state: 'complete' });
          return;
        }
        if (delta.state.current === 'interrupted') {
          cleanup();
          const reason = cancelledHtmlDownloads.get(downloadId) ||
            (delta.error && delta.error.current ? `Download interrupted: ${delta.error.current}` : 'Download was interrupted');
          cancelledHtmlDownloads.delete(downloadId);
          resolve({ success: false, error: reason, state: 'interrupted' });
          return;
        }
      }

      if (delta.error && delta.error.current) {
        cleanup();
        const reason = cancelledHtmlDownloads.get(downloadId) || `Download error: ${delta.error.current}`;
        cancelledHtmlDownloads.delete(downloadId);
        resolve({ success: false, error: reason, state: 'interrupted' });
      }
    }

    chrome.downloads.onChanged.addListener(listener);

    // Initial check in case it already finished
    chrome.downloads.search({ id: downloadId }, (items) => {
      if (items && items.length > 0) {
        const item = items[0];
        if (item.state === 'complete') {
          cleanup();
          resolve({ success: true, state: 'complete' });
          return;
        }
        if (item.state === 'interrupted') {
          cleanup();
          const reason = cancelledHtmlDownloads.get(downloadId) || (item.error ? `Download failed: ${item.error}` : 'Download was interrupted');
          cancelledHtmlDownloads.delete(downloadId);
          resolve({ success: false, error: reason, state: 'interrupted' });
          return;
        }
      }
    });

    timer = setTimeout(() => {
      cleanup();
      chrome.downloads.search({ id: downloadId }, (items) => {
        if (items && items.length > 0 && items[0].state === 'complete') {
          resolve({ success: true, state: 'complete' });
        } else {
          resolve({ success: false, error: 'Download timed out', state: 'timeout' });
        }
      });
    }, timeoutMs);
  });
}

// Helper: retrieve user preferences
function getStoredPreferences() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([
      CONFIG.STORAGE_KEYS.templatePattern,
      CONFIG.STORAGE_KEYS.saveToSubfolder,
      CONFIG.STORAGE_KEYS.subfolderName,
      CONFIG.STORAGE_KEYS.maxTitleLength,
      CONFIG.STORAGE_KEYS.unpaywallEmail,
      CONFIG.STORAGE_KEYS.enableSciHub,
      CONFIG.STORAGE_KEYS.sciHubMirror
    ], (items) => {
      resolve({
        templatePattern: items[CONFIG.STORAGE_KEYS.templatePattern] || CONFIG.DEFAULT_TEMPLATE,
        saveToSubfolder: items[CONFIG.STORAGE_KEYS.saveToSubfolder] !== undefined ? items[CONFIG.STORAGE_KEYS.saveToSubfolder] : true,
        subfolderName: items[CONFIG.STORAGE_KEYS.subfolderName] || CONFIG.DEFAULT_SUBFOLDER,
        maxTitleLength: items[CONFIG.STORAGE_KEYS.maxTitleLength] || CONFIG.DEFAULT_MAX_TITLE_LENGTH,
        unpaywallEmail: items[CONFIG.STORAGE_KEYS.unpaywallEmail] || CONFIG.DEFAULT_UNPAYWALL_EMAIL,
        enableSciHub: items[CONFIG.STORAGE_KEYS.enableSciHub] !== undefined ? items[CONFIG.STORAGE_KEYS.enableSciHub] : true,
        sciHubMirror: items[CONFIG.STORAGE_KEYS.sciHubMirror] || CONFIG.DEFAULT_SCIHUB_MIRROR
      });
    });
  });
}

// Global Active Batch State
const activeBatchState = {
  isRunning: false,
  isCancelled: false,
  total: 0,
  current: 0,
  downloadedCount: 0,
  failedCount: 0,
  skippedCount: 0,
  currentPaperTitle: '',
  statusMessage: '',
  results: []
};

// Helper: Interruptible sleep that immediately breaks if batch is cancelled
async function cancellableDelay(ms, checkCancelledFn) {
  const step = 100;
  let elapsed = 0;
  while (elapsed < ms) {
    if (checkCancelledFn && checkCancelledFn()) break;
    await new Promise(r => setTimeout(r, step));
    elapsed += step;
  }
}

// Helper: Normalize string for fuzzy duplicate matching (strip all non-alphanumerics)
function normalizeFuzzy(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Check if a paper has already been downloaded and currently exists on disk
function isPaperInHistory(paper, completedDownloads = []) {
  if (!paper) return false;

  const cleanDoi = normalizeFuzzy(paper.doi);
  const cleanArxiv = normalizeFuzzy(paper.arxivId);
  const normTitle = (paper.title && paper.title.length >= 15) ? normalizeFuzzy(paper.title) : '';

  // Scan only completed downloads where Chrome confirms the file currently exists on disk
  for (const d of completedDownloads) {
    if (d.exists === false) continue;

    const fn = (d.filename || '').toLowerCase();
    if (!fn.endsWith('.pdf')) continue;

    const baseName = fn.split(/[/\\]/).pop();
    const normBase = normalizeFuzzy(baseName);
    const normUrl = normalizeFuzzy(d.url || '');

    // 1. Check DOI match (in filename or download URL)
    if (cleanDoi && cleanDoi.length > 5) {
      if (normBase.includes(cleanDoi) || normUrl.includes(cleanDoi)) {
        return true;
      }
    }

    // 2. Check arXiv ID match
    if (cleanArxiv && cleanArxiv.length > 4) {
      if (normBase.includes(cleanArxiv) || normUrl.includes(cleanArxiv)) {
        return true;
      }
    }

    // 3. Check Title match (using the authoritative title, at least 15 characters, first 24 characters)
    if (normTitle && normTitle.length >= 15) {
      const sliceLen = Math.min(normTitle.length, 24);
      const titlePrefix = normTitle.slice(0, sliceLen);
      if (normBase.includes(titlePrefix)) {
        return true;
      }
    }
  }

  return false;
}

// Mark a paper as downloaded in persistent local storage
async function markPaperAsDownloaded(paper, filename) {
  try {
    const data = await chrome.storage.local.get('downloaded_paper_history');
    const history = data.downloaded_paper_history || {};
    const key = (paper.doi || paper.arxivId || paper.title || '').toLowerCase().trim();
    if (key) {
      history[key] = {
        title: paper.title || '',
        doi: paper.doi || '',
        arxivId: paper.arxivId || '',
        filename: filename || '',
        timestamp: Date.now()
      };
      await chrome.storage.local.set({ downloaded_paper_history: history });
    }
  } catch (e) {
    console.warn('Error saving download history:', e);
  }
}

// Check if a list of papers currently exists on disk in Downloads
async function checkBatchDuplicates(items = []) {
  const prefs = await getStoredPreferences();
  const subfolder = (prefs.subfolderName || 'Papers').toLowerCase();

  // Search Chrome's completed downloads and strictly filter to files that exist on disk
  const completedDownloads = await new Promise(res => {
    chrome.downloads.search({ state: 'complete' }, (downloads) => {
      if (chrome.runtime.lastError || !downloads) return res([]);
      const valid = downloads.filter(d => {
        // Must exist on disk (not deleted or removed)
        if (d.exists === false) return false;
        const fn = (d.filename || '').toLowerCase();
        if (!fn.endsWith('.pdf')) return false;
        // If subfolder is used, prioritize files in that subfolder
        if (prefs.saveToSubfolder && subfolder) {
          const inFolder = fn.includes(`\\${subfolder}\\`) || fn.includes(`/${subfolder}/`) || fn.includes(subfolder);
          return inFolder;
        }
        return true;
      });
      res(valid);
    });
  });

  const duplicatesMap = {};

  items.forEach((item, idx) => {
    let paper = item;
    if (typeof item === 'string') {
      paper = { filename: item, title: item };
    }
    const key = paper.doi ? paper.doi.toLowerCase().trim() : String(idx);
    const isDup = isPaperInHistory(paper, completedDownloads);
    duplicatesMap[key] = isDup;
    duplicatesMap[idx] = isDup;
    if (typeof item === 'string') {
      duplicatesMap[item] = isDup;
    }
  });

  // Clean stale history entries that no longer exist on disk
  pruneStaleHistory(completedDownloads);

  return duplicatesMap;
}

// Clean up any stale records from downloaded_paper_history
async function pruneStaleHistory(completedDownloads = []) {
  try {
    const data = await chrome.storage.local.get('downloaded_paper_history');
    const history = data.downloaded_paper_history;
    if (!history || typeof history !== 'object') return;

    const existingSet = new Set();
    completedDownloads.forEach(d => {
      if (d.exists !== false) {
        const fn = (d.filename || '').toLowerCase().split(/[/\\]/).pop();
        existingSet.add(normalizeFuzzy(fn));
        if (d.url) existingSet.add(normalizeFuzzy(d.url));
      }
    });

    let modified = false;
    for (const key of Object.keys(history)) {
      const entry = history[key];
      const cleanDoi = normalizeFuzzy(entry?.doi || key);
      const cleanArxiv = normalizeFuzzy(entry?.arxivId);
      const cleanFn = normalizeFuzzy(entry?.filename);

      let found = false;
      for (const ex of existingSet) {
        if ((cleanDoi && cleanDoi.length > 5 && ex.includes(cleanDoi)) ||
            (cleanArxiv && cleanArxiv.length > 4 && ex.includes(cleanArxiv)) ||
            (cleanFn && cleanFn.length > 5 && ex.includes(cleanFn))) {
          found = true;
          break;
        }
      }
      if (!found) {
        delete history[key];
        modified = true;
      }
    }

    if (modified) {
      await chrome.storage.local.set({ downloaded_paper_history: history });
    }
  } catch (e) {
    console.warn('Error pruning history:', e);
  }
}

// Resolve best downloadable PDF URL for a paper (Never pass HTML landing pages)
async function resolvePdfUrlForPaper(paper, prefs, options = {}) {
  const { skipOa = false } = options;

  if (!skipOa) {
    // 1. Direct PDF already verified from content script or metadata
    if (paper.pdfUrl && isExplicitPdfUrl(paper.pdfUrl) && !isHtmlLandingPage(paper.pdfUrl)) {
      return { url: paper.pdfUrl, source: 'direct' };
    }

    // 2. arXiv preprint
    if (paper.arxivId) {
      return { url: `https://arxiv.org/pdf/${paper.arxivId}.pdf`, source: 'arxiv' };
    }

    // 3. bioRxiv / medRxiv direct full PDF pattern
    if (paper.doi && (paper.doi.startsWith('10.1101/') || paper.doi.startsWith('10.64898/'))) {
      return { url: `https://www.biorxiv.org/content/${paper.doi}.full.pdf`, source: 'biorxiv' };
    }

    // 4. eLife direct PDF pattern
    if (paper.doi && paper.doi.startsWith('10.7554/')) {
      const elifeMatch = paper.doi.match(/10\.7554\/(?:eLife\.)?(\d+)/i);
      if (elifeMatch) {
        return { url: `https://elifesciences.org/articles/${elifeMatch[1]}.pdf`, source: 'elife' };
      }
    }

    // 5. PLOS direct PDF pattern
    if (paper.doi && paper.doi.startsWith('10.1371/')) {
      return { url: `https://journals.plos.org/plosone/article/file?id=${paper.doi}&type=printable`, source: 'plos' };
    }

    // 6. PubMed Central direct PDF (direct PMCID or resolve DOI via NCBI ID Converter)
    let pmcid = paper.pmcid;
    if (!pmcid && paper.doi) {
      try {
        const pmcRes = await fetch(`https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${encodeURIComponent(paper.doi)}&format=json&tool=paper_downloader`, {
          signal: AbortSignal.timeout(2500)
        });
        if (pmcRes.ok) {
          const pmcJson = await pmcRes.json();
          pmcid = pmcJson.records?.[0]?.pmcid;
        }
      } catch (e) {}
    }
    if (pmcid) {
      return { url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`, source: 'pmc' };
    }

    // 7. Query Unpaywall API for verified legal Open Access PDF
    if (paper.doi) {
      const oa = await findUnpaywallPdf(paper.doi);
      if (oa && oa.success && oa.oaPdfUrl && isExplicitPdfUrl(oa.oaPdfUrl) && !isHtmlLandingPage(oa.oaPdfUrl)) {
        return { url: oa.oaPdfUrl, source: 'unpaywall' };
      }
    }

    // 8. Crossref direct syndication / publisher PDF link (OUP, Wiley, Elsevier, Springer, etc.)
    if (paper.doi) {
      let crPdf = paper.crossrefPdfUrl || (paper.pdfUrl && isExplicitPdfUrl(paper.pdfUrl) && !isHtmlLandingPage(paper.pdfUrl) ? paper.pdfUrl : null);
      if (!crPdf) {
        const cr = await fetchCrossrefMetadata(paper.doi);
        if (cr && cr.crossrefPdfUrl) {
          crPdf = cr.crossrefPdfUrl;
        }
      }
      if (crPdf && isExplicitPdfUrl(crPdf) && !isHtmlLandingPage(crPdf)) {
        return { url: crPdf, source: 'crossref' };
      }
    }
  }

  // 9. Sci-Hub & Sci-Net fallback: cascade through all mirrors unless explicitly disabled
  const trySciHub = !prefs || prefs.enableSciHub !== false;
  if (paper.doi && trySciHub) {
    const configuredMirror = (prefs && prefs.sciHubMirror ? prefs.sciHubMirror : CONFIG.DEFAULT_SCIHUB_MIRROR || 'https://www.sci-hub.ru/')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');

    // Full prioritized list of official Sci-Hub & Sci-Net mirrors
    const mirrorList = Array.from(new Set([
      configuredMirror,
      'sci-net.xyz',
      'sci-hub.st',
      'sci-hub.al',
      'sci-hub.wf',
      'www.sci-hub.ru',
      'sci-hub.ru',
      'sci-hub.su',
      'sci-hub.box',
      'sci-hub.red',
      'sci-hub.ee',
      'sci-hub.mk',
      'sci-hub.se'
    ]));

    for (let mIdx = 0; mIdx < mirrorList.length; mIdx++) {
      const mirror = mirrorList[mIdx];
      if (activeBatchState && activeBatchState.isRunning) {
        activeBatchState.statusMessage = `Trying mirror ${mIdx + 1}/${mirrorList.length} (${mirror})...`;
      }
      
      // Try HTTPS first, fall back to HTTP if mirror does not support valid SSL
      const protocols = ['https', 'http'];
      for (const proto of protocols) {
        try {
          const mirrorUrl = `${proto}://${mirror}/${paper.doi}`;
          const shRes = await fetch(mirrorUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9'
            },
            signal: AbortSignal.timeout(3500)
          });

          if (!shRes.ok) continue;

          const html = await shRes.text();

          // If this mirror requires an Altcha / bot verification challenge or login form, skip to next mirror
          if (html.includes('are you are robot') || html.includes('captcha') || html.includes('altcha') || (html.includes('name="pass"') && html.includes('action="login"'))) {
            console.warn(`Mirror ${mirror} triggered bot verification / login. Trying next mirror in cascade...`);
            continue;
          }

          const embedMatch = html.match(/<meta[^>]+name\s*=\s*["']citation_pdf_url["'][^>]+content\s*=\s*["']([^"']+)["']/i) ||
                             html.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+name\s*=\s*["']citation_pdf_url["']/i) ||
                             html.match(/<embed[^>]+src\s*=\s*["']([^"']+)["']/i) ||
                             html.match(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/i) ||
                             html.match(/href\s*=\s*["']([^"']+\.pdf[^"']*)["']/i) ||
                             html.match(/onclick\s*=\s*["']location\.href\s*=\s*['"]([^'"]+)['"]/i) ||
                             html.match(/id\s*=\s*["']buttons["'][^>]*>[\s\S]*?<a[^>]+href\s*=\s*["']([^"']+)["']/i);

          if (embedMatch && embedMatch[1]) {
            let pdfUrl = embedMatch[1].replace(/\\\//g, '/').trim();
            if (pdfUrl.startsWith('//')) pdfUrl = 'https:' + pdfUrl;
            else if (pdfUrl.startsWith('/')) pdfUrl = `${proto}://${mirror}${pdfUrl}`;
            pdfUrl = pdfUrl.split('#')[0];
            return { url: pdfUrl, source: `scihub (${mirror})` };
          }
        } catch (e) {
          // network error / timeout on this protocol, continue to next
        }
      }
    }
  }

  // Fallback direct browser link for user if bot challenge blocks background fetch
  const directMirror = (prefs && prefs.sciHubMirror ? prefs.sciHubMirror : 'https://www.sci-hub.ru/').replace(/\/+$/, '');
  const directMirrorUrl = paper.doi ? `${directMirror}/${paper.doi}` : null;

  return {
    url: null,
    reason: trySciHub
      ? 'Paywalled (Tried OA repositories & all Sci-Hub/Sci-Net mirrors; paper not yet archived or mirrors challenged)'
      : 'Paywalled (No free Open Access PDF found; Sci-Hub fallback is disabled)',
    sciHubUrl: directMirrorUrl
  };
}

// Execute Batch Download with Cancellation, Duplicate Skipping & Throttling
async function executeBatchDownload(papersToDownload = [], options = {}) {
  const { skipDuplicates = true, templatePattern, subfolderName, saveToSubfolder, maxTitleLength } = options;
  const storedPrefs = await getStoredPreferences();
  const prefs = {
    ...storedPrefs,
    ...options,
    enableSciHub: options.enableSciHub !== undefined ? options.enableSciHub : (storedPrefs.enableSciHub !== false)
  };

  // Load existing download history filtered to files that physically exist on disk
  const subfolder = ((subfolderName !== undefined ? subfolderName : prefs.subfolderName) || 'Papers').toLowerCase();
  const completedDownloads = await new Promise(res => {
    chrome.downloads.search({ state: 'complete' }, (downloads) => {
      if (chrome.runtime.lastError || !downloads) return res([]);
      const valid = downloads.filter(d => {
        if (d.exists === false) return false;
        const fn = (d.filename || '').toLowerCase();
        if (!fn.endsWith('.pdf')) return false;
        const useSubfolder = (saveToSubfolder !== undefined) ? saveToSubfolder : prefs.saveToSubfolder;
        if (useSubfolder && subfolder) {
          return fn.includes(`\\${subfolder}\\`) || fn.includes(`/${subfolder}/`) || fn.includes(subfolder);
        }
        return true;
      });
      res(valid);
    });
  });

  // Reset state
  activeBatchState.isRunning = true;
  activeBatchState.isCancelled = false;
  activeBatchState.total = papersToDownload.length;
  activeBatchState.current = 0;
  activeBatchState.downloadedCount = 0;
  activeBatchState.failedCount = 0;
  activeBatchState.skippedCount = 0;
  activeBatchState.currentPaperTitle = '';
  activeBatchState.statusMessage = '';
  activeBatchState.results = [];

  let lastWasPaywalled = false;

  for (let i = 0; i < papersToDownload.length; i++) {
    // Check cancellation
    if (activeBatchState.isCancelled) {
      break;
    }

    const paper = papersToDownload[i];
    activeBatchState.current = i + 1;
    activeBatchState.currentPaperTitle = paper.title || paper.doi || `Paper #${i + 1}`;
    activeBatchState.statusMessage = '';

    // If previous paper was paywalled, apply human-like randomized delay to prevent IP rate limits
    if (lastWasPaywalled && i > 0) {
      const minD = CONFIG.PAYWALLED_MIN_DELAY_MS || 2500;
      const maxD = CONFIG.PAYWALLED_MAX_DELAY_MS || 5000;
      const preDelayMs = Math.floor(Math.random() * (maxD - minD + 1)) + minD;
      activeBatchState.statusMessage = `⏳ Pacing (${(preDelayMs / 1000).toFixed(1)}s) to avoid bot detection...`;
      await cancellableDelay(preDelayMs, () => activeBatchState.isCancelled);
      activeBatchState.statusMessage = '';
      if (activeBatchState.isCancelled) break;
    }

    // 1. Initial check: is paper already downloaded and present on disk?
    if (skipDuplicates && isPaperInHistory(paper, completedDownloads)) {
      activeBatchState.skippedCount++;
      activeBatchState.results.push({
        index: paper.originalIndex !== undefined ? paper.originalIndex : i,
        title: paper.title || paper.snippet || paper.doi,
        doi: paper.doi || null,
        status: 'skipped',
        reason: 'Already in Downloads'
      });
      continue;
    }

    // 2. Authoritative metadata enrichment (Author, Year, Title) if not already resolved
    if (!paper.firstAuthor || !paper.year || paper.firstAuthor === 'UnknownAuthor' || !paper.authors || paper.authors.length === 0) {
      try {
        const metaRes = await handleMetadataFetch(paper);
        if (metaRes && metaRes.meta) {
          Object.assign(paper, metaRes.meta);
        }
      } catch (err) {
        console.warn('Batch metadata enrichment error for', paper.doi, err);
      }
    }

    // 3. Format authoritative smart filename with user template & subfolder
    const filename = CONFIG.formatFilename(paper, templatePattern || prefs.templatePattern, {
      saveToSubfolder: saveToSubfolder !== undefined ? saveToSubfolder : prefs.saveToSubfolder,
      subfolderName: subfolderName || prefs.subfolderName,
      maxTitleLength: maxTitleLength || prefs.maxTitleLength
    });

    // 4. Secondary check: check duplicate with enriched title / filename
    if (skipDuplicates && isPaperInHistory(paper, completedDownloads)) {
      activeBatchState.skippedCount++;
      activeBatchState.results.push({
        index: paper.originalIndex !== undefined ? paper.originalIndex : i,
        title: paper.title || paper.snippet || paper.doi,
        doi: paper.doi || null,
        filename,
        status: 'skipped',
        reason: 'Already in Downloads'
      });
      continue;
    }

    // 5. Resolve verified PDF URL (Direct OA, bioRxiv, eLife, PLOS, Unpaywall, or Sci-Hub)
    const pdfRes = await resolvePdfUrlForPaper(paper, prefs);

    if (!pdfRes || !pdfRes.url) {
      activeBatchState.failedCount++;
      activeBatchState.results.push({
        index: paper.originalIndex !== undefined ? paper.originalIndex : i,
        title: paper.title || paper.snippet || paper.doi,
        doi: paper.doi || null,
        filename,
        status: 'failed',
        reason: pdfRes?.reason || 'No PDF link available'
      });
      continue;
    }

    // 6. Trigger download with enforced filename and subfolder
    try {
      const dlRes = await triggerSmartDownload({ url: pdfRes.url, filename });
      if (dlRes && dlRes.success && dlRes.downloadId) {
        // Await actual download completion to guarantee file is on disk!
        const finishRes = await waitForDownloadToFinish(dlRes.downloadId);
        if (finishRes.success) {
          await markPaperAsDownloaded(paper, filename);
          activeBatchState.downloadedCount++;
          activeBatchState.results.push({
            index: paper.originalIndex !== undefined ? paper.originalIndex : i,
            title: paper.title || paper.snippet || paper.doi,
            doi: paper.doi || null,
            filename,
            url: pdfRes.url,
            source: pdfRes.source,
            status: 'downloaded'
          });
        } else {
          // If the download was aborted because server returned an HTML paywall,
          // and we have not tried Sci-Hub/Sci-Net mirrors yet, cascade to mirrors immediately!
          let recovered = false;
          if (pdfRes.source !== 'scihub' && paper.doi) {
            console.log(`[Batch] Download for ${paper.doi} returned HTML paywall. Cascading to Sci-Hub / Sci-Net mirrors...`);
            const mirrorRes = await resolvePdfUrlForPaper(paper, prefs, { skipOa: true });
            if (mirrorRes && mirrorRes.url) {
              const retryDl = await triggerSmartDownload({ url: mirrorRes.url, filename });
              if (retryDl && retryDl.success && retryDl.downloadId) {
                const retryFinish = await waitForDownloadToFinish(retryDl.downloadId);
                if (retryFinish.success) {
                  await markPaperAsDownloaded(paper, filename);
                  activeBatchState.downloadedCount++;
                  activeBatchState.results.push({
                    index: paper.originalIndex !== undefined ? paper.originalIndex : i,
                    title: paper.title || paper.snippet || paper.doi,
                    doi: paper.doi || null,
                    filename,
                    url: mirrorRes.url,
                    source: mirrorRes.source,
                    status: 'downloaded'
                  });
                  recovered = true;
                }
              }
            }
          }

          if (!recovered) {
            activeBatchState.failedCount++;
            activeBatchState.results.push({
              index: paper.originalIndex !== undefined ? paper.originalIndex : i,
              title: paper.title || paper.snippet || paper.doi,
              doi: paper.doi || null,
              filename,
              status: 'failed',
              reason: finishRes.error || 'Server returned HTML paywall or interrupted download'
            });
          }
        }
      } else {
        activeBatchState.failedCount++;
        activeBatchState.results.push({
          index: paper.originalIndex !== undefined ? paper.originalIndex : i,
          title: paper.title || paper.snippet || paper.doi,
          doi: paper.doi || null,
          filename,
          status: 'failed',
          reason: dlRes?.error || 'Download failed'
        });
      }
    } catch (err) {
      activeBatchState.failedCount++;
      activeBatchState.results.push({
        index: paper.originalIndex !== undefined ? paper.originalIndex : i,
        title: paper.title || paper.snippet || paper.doi,
        doi: paper.doi || null,
        filename,
        status: 'failed',
        reason: err.message
      });
    }

    // Check if this paper was retrieved via Sci-Hub / paywalled mirror
    const isPaywalled = pdfRes && pdfRes.source && pdfRes.source.startsWith('scihub');
    if (isPaywalled) {
      lastWasPaywalled = true;
      // Post-download randomized human-like delay (2.0s - 4.5s) if more papers remain
      if (i < papersToDownload.length - 1) {
        const postDelayMs = Math.floor(Math.random() * 2500) + 2000;
        activeBatchState.statusMessage = `⏳ Human delay (${(postDelayMs / 1000).toFixed(1)}s) after paywalled download...`;
        await cancellableDelay(postDelayMs, () => activeBatchState.isCancelled);
        activeBatchState.statusMessage = '';
      }
    } else {
      lastWasPaywalled = false;
      // Gentle pacing (400ms) for verified Open Access repositories
      await cancellableDelay(400, () => activeBatchState.isCancelled);
    }
  }

  activeBatchState.isRunning = false;
  activeBatchState.statusMessage = '';
  return {
    success: true,
    cancelled: activeBatchState.isCancelled,
    downloadedCount: activeBatchState.downloadedCount,
    failedCount: activeBatchState.failedCount,
    skippedCount: activeBatchState.skippedCount,
    results: activeBatchState.results
  };
}

// Batch Metadata Fetcher with concurrency limit of 4
async function handleBatchMetadataFetch(papersList = []) {
  const results = [];
  const concurrency = 4;
  const queue = [...papersList];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      try {
        const res = await handleMetadataFetch(item);
        if (res && res.success && res.meta) {
          results.push({ ...item, ...res.meta });
        } else {
          results.push(item);
        }
      } catch (e) {
        results.push(item);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, papersList.length) }, () => worker());
  await Promise.all(workers);
  return { success: true, results };
}

// Batch Download with throttling (legacy fallback)
async function handleBatchDownload(items = []) {
  let downloadedCount = 0;
  let failedCount = 0;

  for (const item of items) {
    if (!item || !item.url || !item.filename) continue;
    try {
      await triggerSmartDownload(item);
      downloadedCount++;
    } catch (e) {
      failedCount++;
    }
    await new Promise(resolve => setTimeout(resolve, 350));
  }

  return { success: true, downloadedCount, failedCount };
}

// Batch BibTeX Compiler
async function handleBatchBibtex(papersList = []) {
  const bibtexEntries = [];
  for (const paper of papersList) {
    try {
      const entry = await getAuthoritativeBibTeX(paper);
      if (entry) bibtexEntries.push(entry);
    } catch (e) {
      // Fallback
    }
  }
  return { success: true, bibtex: bibtexEntries.join('\n\n') };
}




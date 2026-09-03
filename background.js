// Background service worker for Paper Downloader & Smart Renamer
importScripts('config.js');

// Register context menu for quick download
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'paper_download_selection',
    title: 'Download & Smart Rename Paper (DOI/URL)',
    contexts: ['selection', 'link']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const targetText = info.selectionText || info.linkUrl || '';
  if (!targetText) return;
  
  // Extract DOI or query
  const doiMatch = targetText.match(CONFIG.PATTERNS.doi);
  const doi = doiMatch ? doiMatch[0] : null;
  
  if (doi) {
    const meta = await fetchCrossrefMetadata(doi);
    if (meta) {
      const cleanFilename = formatFilename(meta, CONFIG.DEFAULT_TEMPLATE);
      const pdfUrl = meta.pdfUrl || `https://doi.org/${doi}`;
      chrome.downloads.download({
        url: pdfUrl,
        filename: cleanFilename,
        saveAs: true
      });
    }
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetch_metadata') {
    handleMetadataFetch(request.data).then(sendResponse);
    return true;
  } else if (request.action === 'trigger_download') {
    triggerSmartDownload(request.data).then(sendResponse);
    return true;
  }
});

async function handleMetadataFetch(data) {
  try {
    if (data.doi) {
      const meta = await fetchCrossrefMetadata(data.doi);
      if (meta) return { success: true, meta };
    }
    if (data.arxivId) {
      const meta = await fetchArxivMetadata(data.arxivId);
      if (meta) return { success: true, meta };
    }
    return { success: false, error: 'No authoritative metadata found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function fetchCrossrefMetadata(doi) {
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const item = json.message;
    
    const title = item.title ? item.title[0] : '';
    const authors = (item.author || []).map(a => `${a.family || ''} ${a.given || ''}`.trim());
    const firstAuthor = item.author && item.author[0] ? (item.author[0].family || item.author[0].name || '') : 'Unknown';
    const year = item.created ? item.created['date-parts'][0][0] : (item['published-print'] ? item['published-print']['date-parts'][0][0] : '');
    const journal = item['container-title'] ? item['container-title'][0] : '';

    return {
      doi,
      title,
      authors,
      firstAuthor,
      year: year || new Date().getFullYear(),
      journal,
      pdfUrl: null
    };
  } catch (e) {
    console.warn('Crossref error:', e);
    return null;
  }
}

async function fetchArxivMetadata(arxivId) {
  try {
    const cleanId = arxivId.replace(/^arxiv:/i, '');
    const res = await fetch(`https://export.arxiv.org/api/query?id_list=${cleanId}`);
    const xml = await res.text();
    
    // Quick XML parse
    const titleMatch = xml.match(/<title>([\s\S]*?)<\/title>/g);
    const authorMatches = xml.match(/<author>[\s\S]*?<name>(.*?)<\/name>/g) || [];
    const publishedMatch = xml.match(/<published>(\d{4})/);

    const title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/<\/?title>/g, '').trim() : '';
    const authors = authorMatches.map(m => m.replace(/<[\s\S]*?>/g, '').trim());
    const firstAuthor = authors[0] ? authors[0].split(' ').pop() : 'Unknown';
    const year = publishedMatch ? publishedMatch[1] : '';

    return {
      arxivId: cleanId,
      title,
      authors,
      firstAuthor,
      year: year || new Date().getFullYear(),
      journal: 'arXiv',
      pdfUrl: `https://arxiv.org/pdf/${cleanId}.pdf`
    };
  } catch (e) {
    console.warn('arXiv error:', e);
    return null;
  }
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // remove forbidden chars
    .replace(/\s+/g, ' ')                  // normalize spaces
    .trim()
    .slice(0, 180);                       // prevent path limit errors
}

function formatFilename(meta, templatePattern) {
  let name = templatePattern
    .replace('{year}', meta.year || 'UnknownYear')
    .replace('{first_author}', meta.firstAuthor || 'UnknownAuthor')
    .replace('{title}', meta.title ? sanitizeFilename(meta.title) : 'Untitled')
    .replace('{journal}', meta.journal ? sanitizeFilename(meta.journal) : 'Journal');
  return sanitizeFilename(name) + (name.toLowerCase().endsWith('.pdf') ? '' : '.pdf');
}

async function triggerSmartDownload(data) {
  const { url, filename } = data;
  return new Promise((resolve) => {
    chrome.downloads.download({
      url,
      filename: sanitizeFilename(filename),
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ success: true, downloadId });
      }
    });
  });
}

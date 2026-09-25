// Content script to detect and extract academic paper metadata and PDF links
(() => {
  // Listen for messages from popup or background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'sniff_paper') {
      ensurePmcPowCookie();
      const result = sniffAllPapersOnPage();
      // Keep badge in sync
      try {
        if (chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage({
            action: 'update_badge_count',
            count: result.totalCount
          }, () => {
            if (chrome.runtime.lastError) {}
          });
        }
      } catch {}
      sendResponse({ success: true, data: result.primary, allPapers: result.papers, totalCount: result.totalCount });
    }
    return true;
  });

  // Automatic scan and badge count notification
  function autoScanAndNotifyBadge() {
    try {
      const result = sniffAllPapersOnPage();
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({
          action: 'update_badge_count',
          count: result.totalCount
        }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
      return result;
    } catch (e) {}
  }

  // 1. Initial scan on idle
  ensurePmcPowCookie();
  autoScanAndNotifyBadge();

  // 2. Retry scan after 1.5s for client-rendered SPAs
  setTimeout(autoScanAndNotifyBadge, 1500);

  // 3. Debounced MutationObserver for dynamic infinite-scroll or AJAX pagination
  let debounceTimer = null;
  let observerScans = 0;
  const domObserver = new MutationObserver(() => {
    if (observerScans >= 6) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      observerScans++;
      autoScanAndNotifyBadge();
    }, 1000);
  });

  if (document.body) {
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  function sniffAllPapersOnPage() {
    const primary = extractPrimaryPaperData();
    const papersMap = new Map(); // key: normalized DOI or arXiv ID -> paper object

    // If primary has an identifier, add it first
    if (primary.doi) {
      const normDoi = cleanDoi(primary.doi).toLowerCase();
      papersMap.set(normDoi, {
        doi: cleanDoi(primary.doi),
        title: primary.title || '',
        authors: primary.authors || [],
        firstAuthor: primary.firstAuthor || '',
        year: primary.year || '',
        journal: primary.journal || '',
        pdfUrl: primary.pdfUrl || null,
        url: primary.url || window.location.href
      });
    } else if (primary.arxivId) {
      const normArxiv = primary.arxivId.toLowerCase();
      papersMap.set('arxiv:' + normArxiv, {
        arxivId: primary.arxivId,
        title: primary.title || '',
        authors: primary.authors || [],
        firstAuthor: primary.firstAuthor || '',
        year: primary.year || '',
        journal: 'arXiv',
        pdfUrl: primary.pdfUrl || `https://arxiv.org/pdf/${primary.arxivId}.pdf`,
        url: primary.url || window.location.href
      });
    }

    // 1. Scan all <a> anchor elements on page
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach(a => {
      const href = a.href || '';
      const text = (a.innerText || '').trim();

      // Check for DOI in href
      const doiMatch = href.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i);
      if (doiMatch) {
        const clean = cleanDoi(doiMatch[0]);
        const norm = clean.toLowerCase();
        if (clean && !papersMap.has(norm)) {
          const context = extractContextAroundElement(a);
          papersMap.set(norm, {
            doi: clean,
            title: context.title || (text.length > 15 && !text.startsWith('10.') ? text : ''),
            snippet: context.snippet,
            authors: context.authors,
            year: context.year,
            url: href
          });
        }
      }

      // Check for arXiv in href
      const arxivMatch = href.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arXiv:)(\d{4}\.\d{4,5}(?:v\d+)?)/i);
      if (arxivMatch) {
        const id = arxivMatch[1];
        const key = 'arxiv:' + id.toLowerCase();
        if (!papersMap.has(key)) {
          const context = extractContextAroundElement(a);
          papersMap.set(key, {
            arxivId: id,
            title: context.title || (text.length > 15 && !text.includes(id) ? text : ''),
            snippet: context.snippet,
            journal: 'arXiv',
            pdfUrl: `https://arxiv.org/pdf/${id}.pdf`,
            url: href
          });
        }
      }
    });

    // 2. Scan text blocks across DOM (lists, articles, paragraphs, cards) for textual DOIs
    const textBlocks = document.querySelectorAll('li, article, .publication, .paper, .reference, p, tr, dd, .card, .info');
    textBlocks.forEach(block => {
      const blockText = block.innerText || '';
      if (blockText.length < 15 || blockText.length > 5000) return;

      const doiMatches = blockText.match(/\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/gi);
      if (doiMatches) {
        doiMatches.forEach(rawDoi => {
          const clean = cleanDoi(rawDoi);
          const norm = clean.toLowerCase();
          if (clean) {
            const context = extractContextAroundElement(block);
            const existing = papersMap.get(norm);
            if (!existing) {
              papersMap.set(norm, {
                doi: clean,
                title: context.title || '',
                snippet: context.snippet || blockText.slice(0, 200),
                authors: context.authors || [],
                year: context.year || '',
                url: `https://doi.org/${clean}`
              });
            } else {
              if (!existing.title && context.title) existing.title = context.title;
              if ((!existing.authors || existing.authors.length === 0) && context.authors && context.authors.length > 0) {
                existing.authors = context.authors;
              }
              if (!existing.year && context.year) existing.year = context.year;
              if (!existing.snippet && (context.snippet || blockText)) {
                existing.snippet = context.snippet || blockText.slice(0, 200);
              }
            }
          }
        });
      }
    });

    // 3. Fallback scan body text for any remaining DOIs
    const bodyText = document.body ? document.body.innerText : '';
    const allBodyDois = bodyText.match(/\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/gi) || [];
    allBodyDois.forEach(rawDoi => {
      const clean = cleanDoi(rawDoi);
      const norm = clean.toLowerCase();
      if (clean && !papersMap.has(norm)) {
        papersMap.set(norm, {
          doi: clean,
          title: '',
          snippet: '',
          url: `https://doi.org/${clean}`
        });
      }
    });

    const papersArray = Array.from(papersMap.values());

    return {
      primary: (papersArray.length > 0 && !primary.doi && !primary.arxivId) ? { ...primary, ...papersArray[0] } : primary,
      papers: papersArray,
      totalCount: papersArray.length
    };
  }

  // Helper: find enclosing publication card or container
  function getEnclosingPublicationCard(el) {
    if (!el) return null;
    let curr = el;
    while (curr && curr !== document.body) {
      if (curr.matches && (
        curr.matches('li, article, tr, .publication, .paper, .card, .item, .info, .pub, .entry') ||
        (curr.tagName === 'DIV' && (curr.parentElement?.children?.length > 1 || (curr.innerText || '').length > 60))
      )) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return el.parentElement || el;
  }

  // Helper: extract surrounding context (title, snippet, year) from around an element
  function extractContextAroundElement(el) {
    const card = getEnclosingPublicationCard(el);
    if (!card) return { title: '', snippet: '', year: '', authors: [] };

    // 1. Look for paper link with meaningful title text
    let title = '';
    const titleLink = card.querySelector('a[href*="nature.com"], a[href*="cell.com"], a[href*="science.org"], a[href*="pnas.org"], a[href*="doi.org"], a[href*="sciencedirect"], a[href*="wiley"], a.title, .title a, .paper-title a');
    if (titleLink && titleLink.innerText.trim().length > 15) {
      title = titleLink.innerText.trim();
    }

    // 2. Look for any <a> link inside the card that is not a short button (e.g. not "PDF", "Link", "DOI")
    if (!title) {
      const allLinks = Array.from(card.querySelectorAll('a'));
      for (const a of allLinks) {
        const txt = a.innerText.trim();
        if (txt.length > 20 && !txt.startsWith('http') && !txt.startsWith('10.') && !/^(pdf|doi|link|download|view|read)/i.test(txt)) {
          title = txt;
          break;
        }
      }
    }

    // 3. Look for explicit title heading or bold element
    if (!title) {
      const titleEl = card.querySelector('h1, h2, h3, h4, h5, .title, .paper-title, strong, b');
      if (titleEl && titleEl.innerText.trim().length > 15) {
        title = titleEl.innerText.trim();
      }
    }

    const text = card.innerText.trim();
    const yrMatch = text.match(/\b(19\d\d|20\d\d)\b/);
    const year = yrMatch ? yrMatch[1] : '';

    // 4. Fallback to first line that doesn't start with DOI or URL
    if (!title) {
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 15 && !l.startsWith('10.') && !l.startsWith('http'));
      if (lines.length > 0) {
        title = lines[0].slice(0, 160);
      }
    }

    return {
      title,
      snippet: text.slice(0, 240),
      year,
      authors: []
    };
  }

  function extractPrimaryPaperData() {
    const meta = {
      authors: [],
      url: window.location.href,
      pageTitle: document.title
    };

    const currentUrl = window.location.href;

    // 1. Sniff Semantic <meta> tags
    const metaTags = document.querySelectorAll('meta');
    metaTags.forEach(tag => {
      const name = (tag.getAttribute('name') || tag.getAttribute('property') || '').toLowerCase();
      const content = (tag.getAttribute('content') || '').trim();
      if (!name || !content) return;

      // DOI
      if (['citation_doi', 'dc.identifier', 'prism.doi'].includes(name)) {
        if (!meta.doi && content.match(/^10\.\d{4,9}\//)) {
          meta.doi = cleanDoi(content);
        } else if (!meta.doi) {
          const m = content.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
          if (m) meta.doi = cleanDoi(m[0]);
        }
      }
      // Title
      else if (['citation_title', 'dc.title', 'og:title', 'twitter:title'].includes(name)) {
        if (!meta.title) meta.title = content;
      }
      // Authors
      else if (['citation_author', 'dc.creator', 'author'].includes(name)) {
        if (content && !meta.authors.includes(content)) {
          meta.authors.push(content);
        }
      }
      // Date / Year
      else if (['citation_publication_date', 'citation_date', 'dc.date', 'prism.publicationdate'].includes(name)) {
        if (!meta.date) {
          meta.date = content;
          const yrMatch = content.match(/\b(19\d\d|20\d\d)\b/);
          if (yrMatch) meta.year = yrMatch[1];
        }
      }
      // Journal / Venue
      else if (['citation_journal_title', 'citation_journal_abbrev', 'prism.publicationname'].includes(name)) {
        if (!meta.journal) meta.journal = content;
      }
      // Direct PDF URL
      else if (['citation_pdf_url', 'citation_fulltext_pdf_url'].includes(name)) {
        if (!meta.pdfUrl && isValidPdfUrl(content)) {
          meta.pdfUrl = resolveAbsoluteUrl(content);
        }
      }
      // PubMed PMID
      else if (['citation_pmid'].includes(name)) {
        if (!meta.pmid) meta.pmid = content;
      }
    });

    // 2. Specific Platform Extractors
    // arXiv
    const arxivMatch = currentUrl.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arXiv:)(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    if (arxivMatch) {
      meta.arxivId = arxivMatch[1];
      meta.pdfUrl = `https://arxiv.org/pdf/${arxivMatch[1]}.pdf`;
      meta.journal = meta.journal || 'arXiv';
    }

    // bioRxiv / medRxiv
    if (currentUrl.includes('biorxiv.org') || currentUrl.includes('medrxiv.org')) {
      const bioDoiMatch = currentUrl.match(/content\/(10\.\d{4,9}\/[^v\s?#]+)(v\d+)?/i);
      if (bioDoiMatch) {
        meta.doi = meta.doi || cleanDoi(bioDoiMatch[1]);
        if (!meta.pdfUrl) {
          meta.pdfUrl = `${currentUrl.split('?')[0].replace(/\.full$/, '')}.full.pdf`;
        }
      }
      meta.journal = meta.journal || (currentUrl.includes('medrxiv') ? 'medRxiv' : 'bioRxiv');
    }

    // OpenReview
    if (currentUrl.includes('openreview.net')) {
      const forumMatch = currentUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (forumMatch) {
        meta.openReviewId = forumMatch[1];
        meta.pdfUrl = `https://openreview.net/pdf?id=${forumMatch[1]}`;
      }
    }

    // PubMed / PMC
    const pmidMatch = currentUrl.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i);
    if (pmidMatch) {
      meta.pmid = meta.pmid || pmidMatch[1];
    }
    const pmcMatch = currentUrl.match(/(?:ncbi\.nlm\.nih\.gov\/pmc|pmc\.ncbi\.nlm\.nih\.gov)\/articles\/(PMC\d+)/i);
    if (pmcMatch) {
      meta.pmcid = pmcMatch[1];
      if (!meta.pdfUrl) {
        meta.pdfUrl = `https://pmc.ncbi.nlm.nih.gov/articles/${pmcMatch[1]}/pdf/`;
      }
    }

    // Nature / Springer
    if (currentUrl.includes('nature.com/articles/')) {
      const natDoiMatch = currentUrl.match(/articles\/([a-zA-Z0-9._-]+)/);
      if (natDoiMatch && !meta.doi) {
        meta.doi = `10.1038/${natDoiMatch[1]}`;
      }
      meta.journal = meta.journal || 'Nature';
    }

    // Sci-Hub and Sci-Net mirrors direct page detection
    if (window.location.hostname.includes('sci-hub') || window.location.hostname.includes('sci-net') || window.location.hostname.includes('sci.bban.top')) {
      const shDoiMatch = currentUrl.match(/\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i);
      if (shDoiMatch) {
        meta.doi = cleanDoi(shDoiMatch[0]);
      }
      const shEmbed = document.querySelector('#pdf, embed[type="application/pdf"], iframe#pdf, #article iframe, .pdf iframe, iframe[src*=".pdf"], iframe[src*="/storage/"], embed[src*=".pdf"]');
      if (shEmbed && shEmbed.src) {
        let u = shEmbed.src.split('#')[0];
        if (u.startsWith('//')) u = window.location.protocol + u;
        else if (u.startsWith('/')) u = window.location.origin + u;
        meta.pdfUrl = u;
      }
      const shBtn = document.querySelector('#buttons a[href*=".pdf"], button[onclick*="location.href"]');
      if (shBtn) {
        if (shBtn.href) meta.pdfUrl = shBtn.href.split('#')[0];
        else {
          const m = shBtn.getAttribute('onclick')?.match(/location\.href=['"]([^'"]+)['"]/);
          if (m && m[1]) {
            let u = m[1].replace(/\\/g, '').split('#')[0];
            if (u.startsWith('//')) u = window.location.protocol + u;
            else if (u.startsWith('/')) u = window.location.origin + u;
            meta.pdfUrl = u;
          }
        }
      }
      const titleEl = document.querySelector('.article .title, #title h1');
      if (titleEl && titleEl.textContent.trim()) meta.title = titleEl.textContent.trim();
      const yearEl = document.querySelector('.article .year, #first .year');
      if (yearEl && yearEl.textContent.trim()) meta.year = yearEl.textContent.trim();
      meta.source = 'scihub';
    }

    // 3. Fallback: Sniff DOI from URL
    if (!meta.doi) {
      const urlDoiMatch = currentUrl.match(/\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i);
      if (urlDoiMatch) {
        meta.doi = cleanDoi(urlDoiMatch[0]);
      }
    }

    // 4. Direct PDF link extraction from DOM
    if (!meta.pdfUrl) {
      if (currentUrl.toLowerCase().endsWith('.pdf') || currentUrl.includes('.pdf?')) {
        meta.pdfUrl = currentUrl;
      } else {
        const pdfSelector = [
          'a[href*=".pdf"]',
          'a[href*="article-pdf"]',
          'a[href*="/advance-article-pdf/"]',
          'a.article-pdfLink',
          'a.al-link.pdf',
          'a[data-test-id="download-pdf"]',
          'a.download-pdf',
          'a.c-pdf-download__link',
          'a#pdfLink',
          'a.show-pdf',
          'a.article-dl-pdf-btn',
          'a[aria-label*="download pdf" i]',
          'a[title*="download pdf" i]',
          'a[href*="/pdf/"]'
        ].join(', ');

        const pdfElement = document.querySelector(pdfSelector);
        if (pdfElement && pdfElement.href) {
          meta.pdfUrl = resolveAbsoluteUrl(pdfElement.href);
        } else {
          const embed = document.querySelector('embed[type="application/pdf"], iframe[src*=".pdf"]');
          if (embed && (embed.src || embed.getAttribute('src'))) {
            meta.pdfUrl = resolveAbsoluteUrl(embed.src || embed.getAttribute('src'));
          }
        }
      }
    }

    // 5. Derive year from meta date if not yet extracted
    if (!meta.year && meta.date) {
      const yr = meta.date.match(/\b(19\d\d|20\d\d)\b/);
      if (yr) meta.year = yr[1];
    }

    // 6. Clean and resolve first author
    if (meta.authors && meta.authors.length) {
      const rawFirst = meta.authors[0];
      meta.firstAuthor = parseAuthorLastName(rawFirst);
      if (meta.authors.length > 1) {
        meta.lastAuthor = parseAuthorLastName(meta.authors[meta.authors.length - 1]);
      } else {
        meta.lastAuthor = meta.firstAuthor;
      }
    }

    return meta;
  }

  function cleanDoi(raw) {
    if (!raw) return '';
    let doi = raw.trim();

    // 1. Strip URL prefixes (doi.org, dx.doi.org, publisher /doi/ paths)
    doi = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
    doi = doi.replace(/^https?:\/\/[^/]+\/(?:[^/]+\/)*doi\/(?:abs\/|full\/|pdf\/)?/i, '');

    // 2. Extract DOI substring if buried in other text
    const match = doi.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i);
    if (match) {
      doi = match[0];
    } else {
      return '';
    }

    // 3. Strip query parameters, hashes, and trailing punctuation
    doi = doi.replace(/[?#].*$/, '');
    doi = doi.replace(/[.,;:)\]}>]+$/, '');

    // 4. Strip common publisher action suffixes (/full, /pdf, /abstract, /epdf, /html, etc.)
    doi = doi.replace(/\/(?:full|abstract|pdf|epdf|html|tables|figures|supplemental)(?:\.[\w+]+)?$/i, '');
    doi = doi.replace(/\.(?:full|abstract|pdf|html|htm)(?:\+html)?$/i, '');

    // 5. Oxford Academic (10.1093/...): strip trailing internal numeric article ID (e.g. /8736530)
    if (doi.startsWith('10.1093/')) {
      doi = doi.replace(/\/\d{5,}$/, '');
    }

    // 6. bioRxiv / medRxiv (10.1101 / 10.64898): ensure it stops at version (e.g. v1, v2)
    if (doi.startsWith('10.1101/') || doi.startsWith('10.64898/')) {
      const m = doi.match(/^(10\.(?:1101|64898)\/\d{4}\.\d{2}\.\d{2}\.\d+(?:v\d+)?)/i);
      if (m) doi = m[1];
    }

    // 7. Strip any remaining trailing slash or dot
    doi = doi.replace(/[./]+$/, '');
    return doi.trim();
  }

  function parseAuthorLastName(authorStr) {
    if (!authorStr) return 'UnknownAuthor';
    const trimmed = authorStr.trim();
    if (trimmed.includes(',')) {
      return trimmed.split(',')[0].trim();
    }
    const parts = trimmed.split(/\s+/);
    return parts[parts.length - 1].trim();
  }

  function isValidPdfUrl(url) {
    if (!url) return false;
    return typeof url === 'string' && url.startsWith('http');
  }

  function resolveAbsoluteUrl(relativeUrl) {
    try {
      return new URL(relativeUrl, window.location.href).href;
    } catch {
      return relativeUrl;
    }
  }

  // Fast synchronous SHA-256 for PoW computation
  function sha256Sync(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    let i, j;
    const words = [];
    const asciiBitLength = ascii.length * 8;
    const hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    words[asciiBitLength >> 5] |= 0x80 << (24 - asciiBitLength % 32);
    words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

    for (i = 0; i < ascii.length; i++) {
      words[i >> 2] |= ascii.charCodeAt(i) << (24 - (i % 4) * 8);
    }

    const w = new Array(64);
    for (i = 0; i < words.length; i += 16) {
      let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
      let e = hash[4], f = hash[5], g = hash[6], h = hash[7];

      for (j = 0; j < 64; j++) {
        if (j < 16) {
          w[j] = words[i + j] | 0;
        } else {
          const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
          const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
          w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
        }
        const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const ch = (e & f) ^ ((~e) & g);
        const temp1 = (h + s1 + ch + k[j] + w[j]) | 0;
        const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + maj) | 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) | 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) | 0;
      }

      hash[0] = (hash[0] + a) | 0;
      hash[1] = (hash[1] + b) | 0;
      hash[2] = (hash[2] + c) | 0;
      hash[3] = (hash[3] + d) | 0;
      hash[4] = (hash[4] + e) | 0;
      hash[5] = (hash[5] + f) | 0;
      hash[6] = (hash[6] + g) | 0;
      hash[7] = (hash[7] + h) | 0;
    }

    let hex = '';
    for (i = 0; i < 8; i++) {
      hex += (hash[i] >>> 0).toString(16).padStart(8, '0');
    }
    return hex;
  }

  // Pre-solve PMC Proof-of-Work challenge to ensure seamless PDF downloads
  let isSolvingPow = false;
  async function ensurePmcPowCookie() {
    if (!window.location.hostname.includes('ncbi.nlm.nih.gov')) return;
    if (document.cookie.includes('cloudpmc-viewer-pow=')) return true;
    if (isSolvingPow) return;
    isSolvingPow = true;

    try {
      const pdfAnchor = document.querySelector('a[href*="/pdf/"], a.usa-button[href*="pdf"]');
      const pdfUrl = pdfAnchor ? pdfAnchor.href : `${window.location.href.split('?')[0].replace(/\/+$/, '')}/pdf/`;

      const res = await fetch(pdfUrl, { credentials: 'include' });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/pdf')) {
        isSolvingPow = false;
        return true;
      }

      const html = await res.text();
      const challengeMatch = html.match(/POW_CHALLENGE\s*=\s*"([^"]+)"/);
      if (!challengeMatch) {
        isSolvingPow = false;
        return false;
      }

      const challenge = challengeMatch[1];
      const difficultyMatch = html.match(/POW_DIFFICULTY\s*=\s*"([^"]+)"/);
      const difficulty = parseInt(difficultyMatch ? difficultyMatch[1] : '4', 10);
      const cookieNameMatch = html.match(/POW_COOKIE_NAME\s*=\s*"([^"]+)"/);
      const cookieName = cookieNameMatch ? cookieNameMatch[1] : 'cloudpmc-viewer-pow';

      const targetPrefix = '0'.repeat(difficulty);
      let nonce = 0;
      while (true) {
        const h = sha256Sync(challenge + nonce);
        if (h.startsWith(targetPrefix)) break;
        nonce++;
        if (nonce > 500000) {
          isSolvingPow = false;
          return false;
        }
      }

      document.cookie = `${cookieName}=${challenge},${nonce}; path=/; max-age=18000; SameSite=Lax`;
      isSolvingPow = false;
      return true;
    } catch (err) {
      console.warn('PMC PoW solver failed:', err);
      isSolvingPow = false;
      return false;
    }
  }
})();



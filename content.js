// Content script to detect and extract academic paper metadata and PDF links
(() => {
  // Listen for messages from popup or background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'sniff_paper') {
      const paperData = extractPaperData();
      sendResponse({ success: true, data: paperData });
    }
    return true;
  });

  function extractPaperData() {
    const meta = {};
    const metaTags = document.querySelectorAll('meta');

    metaTags.forEach(tag => {
      const name = (tag.getAttribute('name') || tag.getAttribute('property') || '').toLowerCase();
      const content = tag.getAttribute('content');
      if (!name || !content) return;

      if (name === 'citation_doi' || name === 'dc.identifier' || name === 'prism.doi') {
        meta.doi = meta.doi || content.trim();
      } else if (name === 'citation_title' || name === 'dc.title' || name === 'og:title') {
        meta.title = meta.title || content.trim();
      } else if (name === 'citation_author') {
        meta.authors = meta.authors || [];
        meta.authors.push(content.trim());
      } else if (name === 'citation_publication_date' || name === 'citation_date' || name === 'dc.date') {
        meta.date = meta.date || content.trim();
      } else if (name === 'citation_journal_title') {
        meta.journal = meta.journal || content.trim();
      } else if (name === 'citation_pdf_url') {
        meta.pdfUrl = meta.pdfUrl || content.trim();
      }
    });

    // Fallback: extract DOI from URL or body text
    if (!meta.doi) {
      const doiMatch = (window.location.href + ' ' + document.body.innerText.slice(0, 5000)).match(/\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i);
      if (doiMatch) meta.doi = doiMatch[0];
    }

    // Fallback: extract arXiv ID
    const arxivMatch = window.location.href.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arXiv:)(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    if (arxivMatch) {
      meta.arxivId = arxivMatch[1];
    }

    // Fallback: scan for direct PDF link on page
    if (!meta.pdfUrl) {
      const pdfLink = document.querySelector('a[href*=".pdf"], a[data-test-id="download-pdf"], a.download-pdf');
      if (pdfLink) {
        meta.pdfUrl = pdfLink.href;
      }
    }

    meta.url = window.location.href;
    meta.pageTitle = document.title;
    return meta;
  }
})();

// Configuration and utility functions for Paper Downloader & Smart Renamer

const CONFIG = {
  DEFAULT_TEMPLATE: '{year} - {authors_et_al} - {title}.pdf',
  DEFAULT_SUBFOLDER: 'Papers',
  DEFAULT_MAX_TITLE_LENGTH: 80,
  DEFAULT_UNPAYWALL_EMAIL: 'paper_downloader_ext@academic.org',
  DEFAULT_SCIHUB_MIRROR: 'https://www.sci-hub.ru/',
  SCIHUB_MIRRORS: [
    'https://www.sci-hub.ru/',
    'https://sci-hub.al/',
    'https://sci-net.xyz/',
    'https://sci-hub.st/',
    'https://sci-hub.su/',
    'https://sci-hub.box/',
    'https://sci-hub.red/',
    'https://sci-hub.ee/',
    'https://sci-hub.mk/',
    'https://sci-hub.se/'
  ],
  PAYWALLED_MIN_DELAY_MS: 2500,
  PAYWALLED_MAX_DELAY_MS: 5000,

  TEMPLATES: [
    {
      id: 'standard',
      name: 'Standard: [Year] - [Author et al] - [Title]',
      pattern: '{year} - {authors_et_al} - {title}.pdf'
    },
    {
      id: 'apa',
      name: 'APA Style: [Author] ([Year]) - [Title]',
      pattern: '{first_author} ({year}) - {title}.pdf'
    },
    {
      id: 'websafe',
      name: 'Web-Safe: [Year]_[Author]_[Title]',
      pattern: '{year}_{first_author}_{title}.pdf'
    },
    {
      id: 'journal',
      name: 'Journal First: [Journal] - [Year] - [Author] - [Title]',
      pattern: '{journal} - {year} - {first_author} - {title}.pdf'
    },
    {
      id: 'zotero',
      name: 'Zotero Style: [Author]_[Year]_[Title]',
      pattern: '{first_author}_{year}_{title}.pdf'
    },
    {
      id: 'multi_author',
      name: 'Multi-Author: [Year] - [Author1, Author2] - [Title]',
      pattern: '{year} - {authors} - {title}.pdf'
    }
  ],

  TOKENS: [
    { token: '{year}', label: 'Year', example: '2024' },
    { token: '{first_author}', label: 'First Author', example: 'Vaswani' },
    { token: '{last_author}', label: 'Last Author', example: 'Polosukhin' },
    { token: '{authors_et_al}', label: 'Author et al', example: 'Vaswani et al' },
    { token: '{authors}', label: 'Top 3 Authors', example: 'Vaswani, Shazeer, Parmar' },
    { token: '{title}', label: 'Paper Title', example: 'Attention Is All You Need' },
    { token: '{journal}', label: 'Journal / Venue', example: 'NeurIPS' },
    { token: '{doi_slug}', label: 'DOI Slug', example: '10.1038_s41586-024-00000' },
    { token: '{arxiv_id}', label: 'arXiv ID', example: '1706.03762' }
  ],

  STORAGE_KEYS: {
    templatePattern: 'paper_rename_template',
    saveToSubfolder: 'paper_save_to_subfolder',
    subfolderName: 'paper_subfolder_name',
    maxTitleLength: 'paper_max_title_length',
    unpaywallEmail: 'paper_unpaywall_email',
    enableSciHub: 'paper_enable_scihub',
    sciHubMirror: 'paper_scihub_mirror',
    citationFormat: 'paper_citation_format'
  },

  PATTERNS: {
    doi: /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i,
    arxiv: /(?:arxiv\.org\/(?:abs|pdf)\/|arXiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)/i,
    pmid: /(?:pmid:?\s*|pubmed\.ncbi\.nlm\.nih\.gov\/)(\d{7,9})\b/i,
    pmcid: /\b(PMC\d{6,8})\b/i
  },

  APIS: {
    crossref: 'https://api.crossref.org/works/',
    doiResolver: 'https://doi.org/',
    semanticScholar: 'https://api.semanticscholar.org/graph/v1/paper/',
    unpaywall: 'https://api.unpaywall.org/v2/',
    openAlex: 'https://api.openalex.org/works/',
    arxiv: 'https://export.arxiv.org/api/query?id_list=',
    pubmedSummary: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi'
  },

  // Helper: Extract and clean DOI from text/URLs, stripping any trailing punctuation, action suffixes, or internal IDs
  cleanDoi(raw) {
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
  },

  // Helper: Build canonical URL for paper (DOI, arXiv, PMID, or URL)
  getPaperUrl(meta) {
    if (!meta) return '';
    if (meta.doi) {
      const clean = CONFIG.cleanDoi(meta.doi);
      const doiVal = clean || meta.doi.trim();
      return doiVal.startsWith('http') ? doiVal : `https://doi.org/${doiVal}`;
    }
    if (meta.arxivId) {
      return `https://arxiv.org/abs/${meta.arxivId}`;
    }
    if (meta.pmid) {
      return `https://pubmed.ncbi.nlm.nih.gov/${meta.pmid}/`;
    }
    return meta.url || '';
  },

  // Helper: Parse last name from author string ("Last, First" or "First Last")
  parseAuthorLastName(authorStr) {
    if (!authorStr) return 'UnknownAuthor';
    const trimmed = authorStr.trim();
    if (trimmed.includes(',')) {
      return trimmed.split(',')[0].trim();
    }
    const parts = trimmed.split(/\s+/);
    return parts[parts.length - 1].trim();
  },

  // Helper: Sanitize string for valid filenames across Windows, macOS, Linux
  sanitizeString(str, maxLength = 120) {
    if (!str) return '';
    return str
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // Remove forbidden filesystem characters
      .replace(/\s+/g, ' ')                  // Normalize multiple whitespaces
      .trim()
      .slice(0, maxLength);
  },

  // Helper: Format author et al string with clean last names
  formatAuthorsEtAl(authors, firstAuthor = 'UnknownAuthor') {
    const first = (firstAuthor && firstAuthor !== 'UnknownAuthor')
      ? CONFIG.parseAuthorLastName(firstAuthor)
      : (authors && authors.length ? CONFIG.parseAuthorLastName(authors[0]) : 'UnknownAuthor');

    if (!authors || authors.length <= 1) return first;
    if (authors.length === 2) {
      const second = CONFIG.parseAuthorLastName(authors[1]);
      return `${first} & ${second}`;
    }
    return `${first} et al`;
  },

  // Helper: Format top 3 authors
  formatAuthorsList(authors, limit = 3) {
    if (!authors || !authors.length) return 'UnknownAuthor';
    const sliced = authors.slice(0, limit).map(a => CONFIG.parseAuthorLastName(a));
    return sliced.join(', ') + (authors.length > limit ? ' et al' : '');
  },

  // Helper: Format complete filename from metadata and template pattern
  formatFilename(meta, templatePattern, options = {}) {
    const pattern = templatePattern || CONFIG.DEFAULT_TEMPLATE;
    const maxTitleLen = options.maxTitleLength || CONFIG.DEFAULT_MAX_TITLE_LENGTH;

    const year = meta.year || 'UnknownYear';
    const firstAuthor = CONFIG.sanitizeString(meta.firstAuthor || 'UnknownAuthor', 30);
    const lastAuthor = CONFIG.sanitizeString(meta.lastAuthor || firstAuthor, 30);
    const authorsEtAl = CONFIG.sanitizeString(CONFIG.formatAuthorsEtAl(meta.authors, firstAuthor), 40);
    const authorsList = CONFIG.sanitizeString(CONFIG.formatAuthorsList(meta.authors, 3), 60);
    const title = CONFIG.sanitizeString(meta.title || 'Untitled_Paper', maxTitleLen);
    const journal = CONFIG.sanitizeString(meta.journal || 'Journal', 40);
    const doiSlug = CONFIG.sanitizeString((meta.doi || '').replace(/\//g, '_'), 50);
    const arxivId = CONFIG.sanitizeString(meta.arxivId || '', 20);

    let filename = pattern
      .replace(/{year}/g, year)
      .replace(/{first_author}/g, firstAuthor)
      .replace(/{last_author}/g, lastAuthor)
      .replace(/{authors_et_al}/g, authorsEtAl)
      .replace(/{authors}/g, authorsList)
      .replace(/{title}/g, title)
      .replace(/{journal}/g, journal)
      .replace(/{doi_slug}/g, doiSlug)
      .replace(/{arxiv_id}/g, arxivId);

    // Clean up any remaining double spaces, dashes, or leftover braces
    filename = filename
      .replace(/{[a-z_]+}/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Ensure .pdf extension
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }

    // Windows MAX_PATH protection (260 total, reserve safety margin for subfolder & directory)
    const baseName = filename.slice(0, -4);
    const safeBaseName = CONFIG.sanitizeString(baseName, 180);
    filename = safeBaseName + '.pdf';

    // If subfolder is enabled, prepend subfolder
    if (options.saveToSubfolder && options.subfolderName) {
      const cleanSubfolder = CONFIG.sanitizeString(options.subfolderName, 40).replace(/[\\/]/g, '');
      if (cleanSubfolder) {
        return `${cleanSubfolder}/${filename}`;
      }
    }

    return filename;
  }
};

// Export for Node.js test environment or ES environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

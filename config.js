const CONFIG = {
  DEFAULT_TEMPLATE: '{year} - {first_author} et al - {title}.pdf',
  TEMPLATES: [
    { id: 'standard', name: 'Standard: [Year] - [Author et al] - [Title]', pattern: '{year} - {first_author} et al - {title}.pdf' },
    { id: 'apa', name: 'APA Style: [Author] ([Year]) - [Title]', pattern: '{first_author} ({year}) - {title}.pdf' },
    { id: 'websafe', name: 'Web-Safe: [Year]_[Author]_[Title]', pattern: '{year}_{first_author}_{title}.pdf' },
    { id: 'journal', name: 'Journal First: [Journal] - [Year] - [Author] - [Title]', pattern: '{journal} - {year} - {first_author} - {title}.pdf' }
  ],
  STORAGE_KEYS: {
    template: 'rename_template',
    customTemplate: 'custom_rename_template',
    downloadFolder: 'download_subfolder',
    theme: 'theme'
  },
  PATTERNS: {
    doi: /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i,
    arxiv: /(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)/i,
    pmid: /\b(?:pmid:?\s*)(\d{7,9})\b/i
  },
  APIS: {
    crossref: 'https://api.crossref.org/works/',
    semanticScholar: 'https://api.semanticscholar.org/graph/v1/paper/',
    unpaywall: 'https://api.unpaywall.org/v2/',
    arxiv: 'https://export.arxiv.org/api/query?id_list='
  }
};

if (typeof module !== 'undefined') module.exports = CONFIG;

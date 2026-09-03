# Paper Downloader & Smart Renamer — Implementation Blueprint & Architecture Plan

A specialized, lightweight Chrome extension designed to solve the common frustration of academic research: downloading papers that save with cryptic filenames (e.g. `main.pdf`, `1-s2.0-S009286742400123X-main.pdf`, `download_39824.pdf`).

---

## 1. Core Objectives
1. **Zero-Click Detection**: Detects paper titles, authors, DOI, and arXiv identifiers as soon as you open any journal, repository, or preprint page.
2. **Authoritative Metadata Verification**: Connects to free academic APIs (Crossref, Semantic Scholar, arXiv, OpenAlex) to retrieve true publication metadata rather than relying on noisy page HTML.
3. **Smart Renaming Engine**: Formats downloaded PDFs using standard, customizable templates such as:
   - `[Year] - [Author et al] - [Title].pdf`
   - `[Author] ([Year]) - [Title].pdf`
   - `[Year]_[Author]_[Title].pdf` (web-safe underscore format)
4. **Citation Export**: One-click generation and clipboard copying of clean BibTeX entries.
5. **Direct Download**: Triggers download with the exact formatted name using `chrome.downloads.download()`.

---

## 2. Technical Architecture

```
┌────────────────────────────────────────────────────────┐
│                      Web Page                          │
│  (Nature, Science, arXiv, PubMed, bioRxiv, IEEE, etc.) │
└──────────────────────────┬─────────────────────────────┘
                           │ 1. Sniffs meta tags & DOI
                           ▼
┌────────────────────────────────────────────────────────┐
│                     content.js                         │
│  - Reads <meta name="citation_*">, <meta name="dc.*">  │
│  - Scans URL & DOM for DOI / arXiv ID regex            │
│  - Locates direct PDF download hyperlinks              │
└──────────────────────────┬─────────────────────────────┘
                           │ 2. Sends extracted payload
                           ▼
┌────────────────────────────────────────────────────────┐
│                     background.js                      │
│                 (Service Worker MV3)                   │
│  - Resolves verified metadata via Crossref / arXiv API │
│  - Applies filename sanitization & template tokens     │
│  - Invokes chrome.downloads.download({ filename })     │
│  - Provides Right-Click Context Menu downloader        │
└──────────────┬──────────────────────────┬──────────────┘
               │                          │
               ▼                          ▼
┌───────────────────────────┐ ┌──────────────────────────┐
│        popup.html/js      │ │   chrome.downloads API   │
│ - Preview paper card      │ │ Saves clean renamed file │
│ - Editable filename box   │ │ to user's download dir   │
│ - Template selector       │ └──────────────────────────┘
│ - Copy BibTeX button      │
└───────────────────────────┘
```

---

## 3. Metadata Extraction Pipeline

### Priority 1: Semantic `<meta>` Tags
Top publishers (Nature, Springer, Elsevier, Wiley, bioRxiv, arXiv) provide machine-readable metadata in `<head>`:
- `citation_doi` / `dc.identifier` / `prism.doi`
- `citation_title` / `dc.title`
- `citation_author`
- `citation_publication_date` / `dc.date`
- `citation_journal_title`
- `citation_pdf_url`

### Priority 2: Text / URL Regex Sniffing
If `<meta>` tags are stripped or non-standard:
- DOI Pattern: `/\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i`
- arXiv Pattern: `/(?:arxiv\.org\/(?:abs|pdf)\/|arXiv:)(\d{4}\.\d{4,5}(?:v\d+)?)/i`
- PubMed PMID: `/\b(?:pmid:?\s*)(\d{7,9})\b/i`

### Priority 3: Crossref & Semantic Scholar REST APIs
The service worker uses `fetch()` to query Crossref:
`https://api.crossref.org/works/{doi}`
Returns:
- True verified publication title
- Complete author array (`family`, `given`)
- Official container / journal title
- Exact publication year

---

## 4. Renaming Engine & Token Specification

### Supported Tokens:
- `{year}`: 4-digit publication year (e.g. `2024`)
- `{first_author}`: Last name of first author (e.g. `Vaswani`)
- `{authors}`: First 3 authors (e.g. `Vaswani, Shazeer, Parmar`)
- `{title}`: Full or truncated paper title
- `{journal}`: Journal or preprint repository name (e.g. `Nature`, `arXiv`)
- `{doi_slug}`: Sanitized DOI suffix

### Sanitization Rules:
1. Strip all forbidden OS characters: `\ / : * ? " < > |`
2. Collapse consecutive whitespace into single spaces
3. Truncate paper title to 80 characters to prevent `MAX_PATH` errors on Windows (260 char limit)
4. Ensure `.pdf` extension is preserved

---

## 5. Roadmap & Implementation Phases

- [x] **Phase 1: Project Scaffold** — Manifest V3, directory structure, config, baseline scripts.
- [ ] **Phase 2: Full API Resolvers** — Semantic Scholar & OpenAlex fallback resolvers for non-DOI preprints.
- [ ] **Phase 3: Sci-Hub & Unpaywall Integration** — 1-click resolver for paywalled links to unpaywalled Open Access PDFs.
- [ ] **Phase 4: Automatic Download Subfolder** — Option to save all papers into a dedicated `Downloads/Papers/` folder.
- [ ] **Phase 5: User Options Page** — Custom default rename template builder and BibTeX format preferences.

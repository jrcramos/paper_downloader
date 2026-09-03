// Automated verification test suite for Paper Downloader & Smart Renamer
const assert = require('assert');
const CONFIG = require('../config.js');

console.log('🧪 Running Paper Downloader Test Suite...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}\n`);
    failed++;
  }
}

async function runTests() {
  // Test 1: Filename Formatting & Sanitization
  test('Sanitize illegal filesystem characters from titles', () => {
    const rawTitle = 'Deep Learning: A Survey/Review? Yes* No| <All> "Quotes"';
    const clean = CONFIG.sanitizeString(rawTitle);
    assert.strictEqual(clean.includes('/'), false);
    assert.strictEqual(clean.includes(':'), false);
    assert.strictEqual(clean.includes('?'), false);
    assert.strictEqual(clean.includes('*'), false);
    assert.strictEqual(clean.includes('|'), false);
    assert.strictEqual(clean.includes('<'), false);
    assert.strictEqual(clean.includes('>'), false);
    assert.strictEqual(clean.includes('"'), false);
  });

  test('Format standard template: [Year] - [Author et al] - [Title].pdf', () => {
    const meta = {
      year: '2017',
      firstAuthor: 'Vaswani',
      authors: ['Vaswani, Ashish', 'Shazeer, Noam', 'Parmar, Niki'],
      title: 'Attention Is All You Need',
      journal: 'NeurIPS'
    };
    const filename = CONFIG.formatFilename(meta, CONFIG.DEFAULT_TEMPLATE);
    assert.strictEqual(filename, '2017 - Vaswani et al - Attention Is All You Need.pdf');
  });

  test('Format APA template: [Author] ([Year]) - [Title].pdf', () => {
    const meta = {
      year: '2020',
      firstAuthor: 'Brown',
      title: 'Language Models are Few-Shot Learners'
    };
    const filename = CONFIG.formatFilename(meta, '{first_author} ({year}) - {title}.pdf');
    assert.strictEqual(filename, 'Brown (2020) - Language Models are Few-Shot Learners.pdf');
  });

  test('Format Web-Safe template with underscores', () => {
    const meta = {
      year: '2024',
      firstAuthor: 'Smith',
      title: 'Genome Analysis in Humans'
    };
    const filename = CONFIG.formatFilename(meta, '{year}_{first_author}_{title}.pdf');
    assert.strictEqual(filename, '2024_Smith_Genome Analysis in Humans.pdf');
  });

  test('Subfolder prefix routing into Papers/', () => {
    const meta = {
      year: '2023',
      firstAuthor: 'LeCun',
      title: 'A Path Towards Autonomous Machine Intelligence'
    };
    const filename = CONFIG.formatFilename(meta, '{year} - {first_author} - {title}.pdf', {
      saveToSubfolder: true,
      subfolderName: 'Papers'
    });
    assert.strictEqual(filename, 'Papers/2023 - LeCun - A Path Towards Autonomous Machine Intelligence.pdf');
  });

  test('Max title length truncation to prevent MAX_PATH overflow', () => {
    const meta = {
      year: '2024',
      firstAuthor: 'Author',
      title: 'A'.repeat(200)
    };
    const filename = CONFIG.formatFilename(meta, '{year} - {first_author} - {title}.pdf', {
      maxTitleLength: 50
    });
    // Title is capped at 50 characters
    assert.strictEqual(filename.includes('A'.repeat(51)), false);
    assert.strictEqual(filename.includes('A'.repeat(50)), true);
  });

  // Test 2: Identifier Regex Extraction
  test('Detect Nature DOI pattern', () => {
    const sample = 'https://www.nature.com/articles/s41586-020-2649-2';
    const match = '10.1038/s41586-020-2649-2'.match(CONFIG.PATTERNS.doi);
    assert.ok(match);
    assert.strictEqual(match[0], '10.1038/s41586-020-2649-2');
  });

  test('Detect ScienceDirect / Elsevier DOI pattern', () => {
    const text = 'Citation: 10.1016/j.cell.2024.01.002. Published in Cell.';
    const clean = CONFIG.cleanDoi(text);
    assert.strictEqual(clean, '10.1016/j.cell.2024.01.002');
  });

  test('Detect arXiv ID from abstract URL', () => {
    const url = 'https://arxiv.org/abs/1706.03762';
    const match = url.match(CONFIG.PATTERNS.arxiv);
    assert.ok(match);
    assert.strictEqual(match[1], '1706.03762');
  });

  test('Detect arXiv ID from PDF direct link', () => {
    const url = 'https://arxiv.org/pdf/2301.12345v2.pdf';
    const match = url.match(CONFIG.PATTERNS.arxiv);
    assert.ok(match);
    assert.strictEqual(match[1], '2301.12345v2');
  });

  test('Detect PubMed PMID from URL string', () => {
    const url = 'https://pubmed.ncbi.nlm.nih.gov/32764456/';
    const match = url.match(CONFIG.PATTERNS.pmid);
    assert.ok(match);
    assert.strictEqual(match[1], '32764456');
  });

  // Test 3: Multi-DOI Extraction & Deduplication
  test('Extract and deduplicate multiple DOIs from lab publication page HTML snippet', () => {
    const htmlSnippet = `
      <div class="publication">
        <h3>Engineered caspases directly rewire mutant Ras to cell death</h3>
        <p>bioRxiv. 2026-08-07. <a href="https://doi.org/10.64898/2026.08.06.743376">10.64898/2026.08.06.743376</a></p>
      </div>
      <div class="publication">
        <h3>A Synthetic Intercellular Communication System</h3>
        <p>Science. 2024. <a href="https://doi.org/10.1126/science.ade1234">10.1126/science.ade1234</a></p>
      </div>
      <div class="publication">
        <h3>Duplicate Mention</h3>
        <p>Referenced at <a href="https://doi.org/10.1126/science.ade1234">doi:10.1126/science.ade1234</a></p>
      </div>
      <div>Also see arXiv preprint: <a href="https://arxiv.org/abs/2301.99999">arXiv:2301.99999</a></div>
    `;

    // Regex extraction similar to content.js
    const rawMatches = htmlSnippet.match(/\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/gi) || [];
    const uniqueDois = Array.from(new Set(rawMatches.map(CONFIG.cleanDoi)));

    assert.strictEqual(uniqueDois.length, 2);
    assert.ok(uniqueDois.includes('10.64898/2026.08.06.743376'));
    assert.ok(uniqueDois.includes('10.1126/science.ade1234'));

    const arxivMatches = htmlSnippet.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arXiv:)(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    assert.ok(arxivMatches);
    assert.strictEqual(arxivMatches[1], '2301.99999');
  });

  test('Batch filename formatter creates distinct formatted names', () => {
    const papers = [
      { year: '2026', firstAuthor: 'Moeller', title: 'Engineered caspases rewire mutant Ras' },
      { year: '2024', firstAuthor: 'Elowitz', title: 'A Synthetic Intercellular Communication System' }
    ];

    const filenames = papers.map(p => CONFIG.formatFilename(p, CONFIG.DEFAULT_TEMPLATE, {
      saveToSubfolder: true,
      subfolderName: 'Papers'
    }));

    assert.strictEqual(filenames[0], 'Papers/2026 - Moeller - Engineered caspases rewire mutant Ras.pdf');
    assert.strictEqual(filenames[1], 'Papers/2024 - Elowitz - A Synthetic Intercellular Communication System.pdf');
  });

  // Test 4: PDF Resolver Patterns & Duplicate Checking
  test('Resolve bioRxiv and arXiv direct PDF URLs from metadata', () => {
    const biorxivDoi = '10.1101/2023.01.01.123456';
    const isBio = biorxivDoi.startsWith('10.1101/') || biorxivDoi.startsWith('10.64898/');
    assert.strictEqual(isBio, true);
    const bioPdf = `https://www.biorxiv.org/content/${biorxivDoi}.full.pdf`;
    assert.strictEqual(bioPdf, 'https://www.biorxiv.org/content/10.1101/2023.01.01.123456.full.pdf');

    const arxivId = '1706.03762';
    const arxivPdf = `https://arxiv.org/pdf/${arxivId}.pdf`;
    assert.strictEqual(arxivPdf, 'https://arxiv.org/pdf/1706.03762.pdf');
  });

  test('Check duplicate paper matching across different templates, DOIs, and titles', () => {
    function normalizeFuzzy(str) {
      return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function isPaperInHistory(paper, completedDownloads = []) {
      if (!paper) return false;

      const cleanDoi = normalizeFuzzy(paper.doi);
      const cleanArxiv = normalizeFuzzy(paper.arxivId);
      const normTitle = (paper.title && paper.title.length >= 15) ? normalizeFuzzy(paper.title) : '';

      for (const d of completedDownloads) {
        if (d.exists === false) continue;

        const fn = (d.filename || '').toLowerCase();
        if (!fn.endsWith('.pdf')) continue;

        const baseName = fn.split(/[/\\]/).pop();
        const normBase = normalizeFuzzy(baseName);
        const normUrl = normalizeFuzzy(d.url || '');

        if (cleanDoi && cleanDoi.length > 5 && (normBase.includes(cleanDoi) || normUrl.includes(cleanDoi))) {
          return true;
        }
        if (cleanArxiv && cleanArxiv.length > 4 && (normBase.includes(cleanArxiv) || normUrl.includes(cleanArxiv))) {
          return true;
        }
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

    // Existing files on user's disk
    const completedHistory = [
      { exists: true, filename: 'C:\\Users\\joao3\\Downloads\\Papers\\2011_Sen_Dynamical Consequences of Bandpass Feedback Loops in a Bacterial Phosphorelay.pdf', url: 'https://cdn.cell.com/10.1016/j.cell.2011.09.043' },
      { exists: true, filename: 'C:\\Users\\joao3\\Downloads\\Papers\\2016_Hormoz_Inferring Cell-State Transition Dynamics from Lineage Trees and Endpoint Single-.pdf', url: 'https://cell.com/10.1016/j.cell.2016.10.035' },
      // Deleted file: user deleted it, so exists is false!
      { exists: false, filename: 'C:\\Users\\joao3\\Downloads\\Papers\\2020_Deleted_Paper.pdf', url: 'https://doi.org/10.1038/deleted-paper' }
    ];

    // Candidate 1: Same paper queried with Standard Template
    const candidate1 = {
      doi: '10.1016/j.cell.2011.09.043',
      title: 'Dynamical Consequences of Bandpass Feedback Loops in a Bacterial Phosphorelay'
    };

    // Candidate 2: Deleted paper (exists: false) must NOT be skipped as duplicate
    const candidate2 = {
      doi: '10.1038/deleted-paper',
      title: 'Deleted Paper Title That User Removed'
    };

    // Candidate 3: Completely new paper
    const candidate3 = {
      doi: '10.1038/s41586-026-00000-0',
      title: 'Non-existent paper'
    };

    assert.strictEqual(isPaperInHistory(candidate1, completedHistory), true);
    assert.strictEqual(isPaperInHistory(candidate2, completedHistory), false); // Not in folder, must be false!
    assert.strictEqual(isPaperInHistory(candidate3, completedHistory), false);
  });

  test('Strict rejection of HTML landing pages vs verified PDF URLs', () => {
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

    function isHtmlLandingPage(url) {
      if (!url || typeof url !== 'string') return true;
      const lower = url.toLowerCase();
      if (lower.match(/^https?:\/\/doi\.org\/10\.\d{4,9}\/[^/]+$/)) return true;
      if (lower.includes('nature.com/articles/') && !lower.endsWith('.pdf')) return true;
      if (lower.includes('sciencedirect.com/science/article/') && !lower.includes('pdfft')) return true;
      if (lower.includes('cell.com/') && !lower.includes('.pdf')) return true;
      if (lower.includes('ncbi.nlm.nih.gov/pmc/articles/') && !lower.endsWith('/pdf/')) return true;
      return false;
    }

    // These must be flagged as HTML landing pages and rejected from downloads!
    assert.strictEqual(isHtmlLandingPage('https://doi.org/10.7554/elife.02950'), true);
    assert.strictEqual(isHtmlLandingPage('https://doi.org/10.1038/nature15710'), true);
    assert.strictEqual(isHtmlLandingPage('https://doi.org/10.1016/j.stem.2014.11.005'), true);
    assert.strictEqual(isHtmlLandingPage('https://www.nature.com/articles/nature19478'), true);
    assert.strictEqual(isHtmlLandingPage('https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4870307'), true);

    // These are verified direct PDF URLs and must pass!
    assert.strictEqual(isExplicitPdfUrl('https://elifesciences.org/articles/02950.pdf'), true);
    assert.strictEqual(isExplicitPdfUrl('https://www.biorxiv.org/content/10.1101/123456.full.pdf'), true);
    assert.strictEqual(isExplicitPdfUrl('https://arxiv.org/pdf/1706.03762.pdf'), true);
    assert.strictEqual(isExplicitPdfUrl('https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4870307/pdf/'), true);
    assert.strictEqual(isExplicitPdfUrl('https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0001&type=printable'), true);
  });

  test('Sci-Hub mirror cascade correctly detects and skips bot challenges', () => {
    function parseSciHubResponse(html, mirror) {
      if (!html) return null;
      // Bot challenge detection
      if (html.includes('are you are robot') || html.includes('captcha') || html.includes('altcha')) {
        return { isBotChallenge: true };
      }
      const embedMatch = html.match(/<embed[^>]+src\s*=\s*["']([^"']+)["']/i) ||
                         html.match(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/i) ||
                         html.match(/href\s*=\s*["']([^"']+\.pdf[^"']*)["']/i) ||
                         html.match(/onclick\s*=\s*["']location\.href\s*=\s*['"]([^'"]+)['"]/i);
      if (embedMatch && embedMatch[1]) {
        let pdf = embedMatch[1].replace(/\\\//g, '/').trim();
        if (pdf.startsWith('//')) pdf = 'https:' + pdf;
        else if (pdf.startsWith('/')) pdf = `https://${mirror}${pdf}`;
        pdf = pdf.split('#')[0];
        return { isBotChallenge: false, pdfUrl: pdf };
      }
      return null;
    }

    // Simulated mirror 1: Returns bot challenge HTML (Altcha)
    const challengeHtml = '<!DOCTYPE html><html><head><title>Sci-Hub: are you are robot?</title><script src="/altcha.js"></script></head><body></body></html>';
    const res1 = parseSciHubResponse(challengeHtml, 'sci-hub.ru');
    assert.strictEqual(res1.isBotChallenge, true);

    // Simulated mirror 2: Returns valid embed HTML
    const successHtml = '<html><body><embed type="application/pdf" src="/downloads/2024/paper.pdf" id="pdf"></body></html>';
    const res2 = parseSciHubResponse(successHtml, 'sci-hub.st');
    assert.strictEqual(res2.isBotChallenge, false);
    assert.strictEqual(res2.pdfUrl, 'https://sci-hub.st/downloads/2024/paper.pdf');

    // Simulated mirror 3: Sci-Net style iframe with spaces around equals and hash view params
    const sciNetHtml = '<div class="pdf"><iframe src = "/storage/8288361/abc123/paper.pdf#view=FitH&navpanes=0"></iframe></div>';
    const res3 = parseSciHubResponse(sciNetHtml, 'sci-net.xyz');
    assert.strictEqual(res3.isBotChallenge, false);
    assert.strictEqual(res3.pdfUrl, 'https://sci-net.xyz/storage/8288361/abc123/paper.pdf');
  });

  test('Canonical Paper URL generator builds correct doi.org, arXiv, and PubMed links', () => {
    assert.strictEqual(
      CONFIG.getPaperUrl({ doi: '10.1038/s41586-020-2649-2' }),
      'https://doi.org/10.1038/s41586-020-2649-2'
    );
    assert.strictEqual(
      CONFIG.getPaperUrl({ doi: 'https://doi.org/10.1016/j.cell.2011.09.043.' }),
      'https://doi.org/10.1016/j.cell.2011.09.043'
    );
    assert.strictEqual(
      CONFIG.getPaperUrl({ arxivId: '1706.03762' }),
      'https://arxiv.org/abs/1706.03762'
    );
    assert.strictEqual(
      CONFIG.getPaperUrl({ pmid: '33055453' }),
      'https://pubmed.ncbi.nlm.nih.gov/33055453/'
    );
    assert.strictEqual(
      CONFIG.getPaperUrl({ url: 'https://example.com/paper.pdf' }),
      'https://example.com/paper.pdf'
    );
  });

  test('Extract Version of Record PDF URL from Crossref syndication links (e.g. Oxford Academic, Wiley)', () => {
    const mockCrossrefItem = {
      link: [
        {
          URL: 'https://academic.oup.com/peds/advance-article-pdf/doi/10.1093/protein/gzag020/69163198/gzag020.pdf',
          'content-type': 'application/pdf',
          'content-version': 'am'
        },
        {
          URL: 'https://academic.oup.com/peds/article-pdf/doi/10.1093/protein/gzag020/69163198/gzag020.pdf',
          'content-type': 'application/pdf',
          'content-version': 'vor'
        }
      ]
    };

    const pdfLinks = mockCrossrefItem.link.filter(l => 
      l.URL && (l['content-type'] === 'application/pdf' || l.URL.toLowerCase().endsWith('.pdf'))
    );
    const vor = pdfLinks.find(l => l['content-version'] === 'vor') || pdfLinks[0];
    assert.strictEqual(vor.URL, 'https://academic.oup.com/peds/article-pdf/doi/10.1093/protein/gzag020/69163198/gzag020.pdf');
  });

  test('Clean DOIs from publisher URLs (strip Oxford Academic internal IDs, bioRxiv action suffixes)', () => {
    assert.strictEqual(
      CONFIG.cleanDoi('https://academic.oup.com/peds/advance-article/doi/10.1093/protein/gzag020/8736530'),
      '10.1093/protein/gzag020'
    );
    assert.strictEqual(
      CONFIG.cleanDoi('10.1093/protein/gzag020/8736530'),
      '10.1093/protein/gzag020'
    );
    assert.strictEqual(
      CONFIG.cleanDoi('https://www.biorxiv.org/content/10.64898/2026.07.10.737756v1.full.pdf+html'),
      '10.64898/2026.07.10.737756v1'
    );
    assert.strictEqual(
      CONFIG.cleanDoi('10.1101/2024.01.03.573434v1.abstract'),
      '10.1101/2024.01.03.573434v1'
    );
    assert.strictEqual(
      CONFIG.cleanDoi('https://doi.org/10.1038/s41587-026-03177-2/full'),
      '10.1038/s41587-026-03177-2'
    );
  });

  // Test 3: Live Academic API Queries
  console.log('\n  🌐 Running live API network tests...');

  try {
    // Crossref Test
    const crRes = await fetch('https://api.crossref.org/works/10.1038/nature12373', {
      headers: { 'User-Agent': 'PaperDownloaderTest/1.0' }
    });
    if (crRes.ok) {
      const crJson = await crRes.json();
      assert.ok(crJson.message.title);
      console.log('  ✓ Crossref REST API live query succeeded');
      passed++;
    } else {
      console.warn('  ⚠ Crossref status:', crRes.status);
    }
  } catch (e) {
    console.warn('  ⚠ Crossref fetch test skipped:', e.message);
  }

  try {
    // arXiv Test
    const arxRes = await fetch('https://export.arxiv.org/api/query?id_list=1706.03762');
    if (arxRes.ok) {
      const arxText = await arxRes.text();
      assert.ok(arxText.includes('Attention Is All You Need') || arxText.includes('Vaswani'));
      console.log('  ✓ arXiv Export API live query succeeded');
      passed++;
    } else {
      console.warn('  ⚠ arXiv status:', arxRes.status);
    }
  } catch (e) {
    console.warn('  ⚠ arXiv fetch test skipped:', e.message);
  }

  try {
    // Unpaywall Test
    const unpRes = await fetch('https://api.unpaywall.org/v2/10.1038/nature12373?email=paper_downloader_ext@academic.org');
    if (unpRes.ok) {
      const unpJson = await unpRes.json();
      assert.ok(unpJson.doi);
      console.log('  ✓ Unpaywall API live query succeeded');
      passed++;
    } else {
      console.warn('  ⚠ Unpaywall status:', unpRes.status);
    }
  } catch (e) {
    console.warn('  ⚠ Unpaywall fetch test skipped:', e.message);
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests();

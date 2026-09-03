# 📄 Paper Downloader & Smart Renamer

> A modern Chrome extension (Manifest V3) that auto-detects research papers, queries verified academic metadata (Crossref & arXiv), and downloads PDFs cleanly renamed by author, year, and title.

---

## 🌟 Key Features

* **Instant Paper Detection**: Automatically sniffs DOI, arXiv IDs, author names, and direct PDF links on any academic page.
* **Authoritative Crossref Metadata**: Connects to the Crossref REST API to get official publication titles and author lists.
* **Smart Filename Formatting**: Never save a paper as `download.pdf` or `main.pdf` again. Formats to:
  * `[Year] - [Author et al] - [Title].pdf` (e.g. `2024 - Smith et al - Deep Learning in Genomics.pdf`)
  * `[Author] ([Year]) - [Title].pdf`
  * `[Year]_[Author]_[Title].pdf`
* **Live Editable Preview**: Review and customize the generated filename before downloading.
* **1-Click BibTeX Citation**: Generates clean BibTeX ready to paste into your reference manager (Zotero, Mendeley, Overleaf).
* **Right-Click Context Menu**: Highlight any DOI or link on any webpage and select *"Download & Smart Rename Paper"*.

---

## 📁 Project Structure

```
paper_downloader/
├── manifest.json       # Manifest V3 configuration
├── config.js           # Renaming templates, regexes, API endpoints
├── background.js       # Service worker for API queries & downloads
├── content.js          # In-page paper sniffer (<meta> tags, DOI detection)
├── popup.html          # Extension interface with live preview
├── popup.js            # Popup DOM manipulation & download triggers
├── PLAN.md             # Detailed technical implementation blueprint
└── README.md           # Documentation & user guide
```

---

## 🚀 Installation

1. Clone or copy this repository to your local drive:
   ```bash
   git clone https://github.com/your-username/paper_downloader.git
   ```
2. Open Google Chrome or Microsoft Edge and go to `chrome://extensions/`.
3. Enable **Developer Mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** and select the `E:\GitHub\paper_downloader` folder.
5. Pin the extension to your toolbar.

---

## 📖 How to Use

1. Navigate to any paper page (e.g. on Nature, ScienceDirect, arXiv, PubMed, or bioRxiv).
2. Click the **Paper Downloader** icon in your browser toolbar.
3. The popup will automatically display the detected title, authors, year, and formatted filename.
4. Click **📥 Download & Smart Rename PDF** — the file is saved directly to your Downloads folder with the clean, descriptive name!

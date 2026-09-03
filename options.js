// Options page script for Paper Downloader & Smart Renamer

document.addEventListener('DOMContentLoaded', async () => {
  const presetButtons = document.getElementById('presetButtons');
  const templateInput = document.getElementById('templateInput');
  const tokenGrid = document.getElementById('tokenGrid');
  const sandboxOutput = document.getElementById('sandboxOutput');

  const saveSubfolderCheckbox = document.getElementById('saveSubfolderCheckbox');
  const subfolderGroup = document.getElementById('subfolderGroup');
  const subfolderInput = document.getElementById('subfolderInput');

  const maxTitleSlider = document.getElementById('maxTitleSlider');
  const maxTitleValue = document.getElementById('maxTitleValue');

  const unpaywallEmailInput = document.getElementById('unpaywallEmailInput');
  const enableSciHubCheckbox = document.getElementById('enableSciHubCheckbox');
  const scihubGroup = document.getElementById('scihubGroup');
  const scihubMirrorSelect = document.getElementById('scihubMirrorSelect');
  const scihubMirrorInput = document.getElementById('scihubMirrorInput');

  const saveBtn = document.getElementById('saveBtn');
  const resetDefaultsBtn = document.getElementById('resetDefaultsBtn');
  const optionsToast = document.getElementById('optionsToast');

  // Sample mock paper for live sandbox preview
  const samplePaper = {
    year: '2017',
    firstAuthor: 'Vaswani',
    lastAuthor: 'Polosukhin',
    authors: ['Vaswani, Ashish', 'Shazeer, Noam', 'Parmar, Niki', 'Uszkoreit, Jakob', 'Jones, Llion', 'Gomez, Aidan N', 'Kaiser, Lukasz', 'Polosukhin, Illia'],
    title: 'Attention Is All You Need',
    journal: 'NeurIPS',
    doi: '10.48550/arXiv.1706.03762',
    arxivId: '1706.03762'
  };

  // Initialize preset buttons
  CONFIG.TEMPLATES.forEach(tmpl => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.textContent = tmpl.name.split(':')[0];
    btn.title = tmpl.pattern;
    btn.addEventListener('click', () => {
      templateInput.value = tmpl.pattern;
      updateActivePresetButton(tmpl.pattern);
      updateSandbox();
    });
    presetButtons.appendChild(btn);
  });

  // Initialize token buttons
  CONFIG.TOKENS.forEach(tok => {
    const btn = document.createElement('button');
    btn.className = 'token-btn';
    btn.textContent = `+${tok.token}`;
    btn.title = `${tok.label} (e.g. ${tok.example})`;
    btn.addEventListener('click', () => {
      insertAtCursor(templateInput, tok.token);
      updateActivePresetButton(templateInput.value);
      updateSandbox();
    });
    tokenGrid.appendChild(btn);
  });

  // Load saved preferences
  await loadPreferences();
  updateSandbox();

  // Event Listeners for Sandbox & Inputs
  templateInput.addEventListener('input', () => {
    updateActivePresetButton(templateInput.value);
    updateSandbox();
  });

  saveSubfolderCheckbox.addEventListener('change', () => {
    subfolderGroup.style.display = saveSubfolderCheckbox.checked ? 'block' : 'none';
    updateSandbox();
  });

  subfolderInput.addEventListener('input', updateSandbox);

  maxTitleSlider.addEventListener('input', () => {
    maxTitleValue.textContent = `${maxTitleSlider.value} chars`;
    updateSandbox();
  });

  enableSciHubCheckbox.addEventListener('change', () => {
    scihubGroup.style.display = enableSciHubCheckbox.checked ? 'block' : 'none';
  });

  scihubMirrorSelect.addEventListener('change', () => {
    if (scihubMirrorSelect.value === 'custom') {
      scihubMirrorInput.style.display = 'block';
      scihubMirrorInput.focus();
    } else {
      scihubMirrorInput.style.display = 'none';
      scihubMirrorInput.value = scihubMirrorSelect.value;
    }
  });

  saveBtn.addEventListener('click', savePreferences);
  resetDefaultsBtn.addEventListener('click', resetToDefaults);

  // Update Live Sandbox Output
  function updateSandbox() {
    const pattern = templateInput.value.trim() || CONFIG.DEFAULT_TEMPLATE;
    const saveToSubfolder = saveSubfolderCheckbox.checked;
    const subfolderName = subfolderInput.value.trim() || CONFIG.DEFAULT_SUBFOLDER;
    const maxTitleLength = parseInt(maxTitleSlider.value, 10) || 80;

    const formatted = CONFIG.formatFilename(samplePaper, pattern, {
      saveToSubfolder,
      subfolderName,
      maxTitleLength
    });

    sandboxOutput.textContent = formatted;
  }

  function updateActivePresetButton(currentPattern) {
    presetButtons.querySelectorAll('.preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.title === currentPattern);
    });
  }

  function insertAtCursor(input, text) {
    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    input.value = input.value.substring(0, start) + text + input.value.substring(end);
    input.selectionStart = input.selectionEnd = start + text.length;
    input.focus();
  }

  async function loadPreferences() {
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
        templateInput.value = items[CONFIG.STORAGE_KEYS.templatePattern] || CONFIG.DEFAULT_TEMPLATE;
        updateActivePresetButton(templateInput.value);

        const subfolderEnabled = items[CONFIG.STORAGE_KEYS.saveToSubfolder] !== undefined
          ? items[CONFIG.STORAGE_KEYS.saveToSubfolder]
          : true;
        saveSubfolderCheckbox.checked = subfolderEnabled;
        subfolderGroup.style.display = subfolderEnabled ? 'block' : 'none';

        subfolderInput.value = items[CONFIG.STORAGE_KEYS.subfolderName] || CONFIG.DEFAULT_SUBFOLDER;

        const maxLen = items[CONFIG.STORAGE_KEYS.maxTitleLength] || CONFIG.DEFAULT_MAX_TITLE_LENGTH;
        maxTitleSlider.value = maxLen;
        maxTitleValue.textContent = `${maxLen} chars`;

        unpaywallEmailInput.value = items[CONFIG.STORAGE_KEYS.unpaywallEmail] || CONFIG.DEFAULT_UNPAYWALL_EMAIL;

        const scihubEnabled = items[CONFIG.STORAGE_KEYS.enableSciHub] !== undefined
          ? items[CONFIG.STORAGE_KEYS.enableSciHub]
          : true;
        enableSciHubCheckbox.checked = scihubEnabled;
        scihubGroup.style.display = scihubEnabled ? 'block' : 'none';

        const mirror = items[CONFIG.STORAGE_KEYS.sciHubMirror] || CONFIG.DEFAULT_SCIHUB_MIRROR;
        scihubMirrorInput.value = mirror;
        if (Array.from(scihubMirrorSelect.options).some(o => o.value === mirror)) {
          scihubMirrorSelect.value = mirror;
          scihubMirrorInput.style.display = 'none';
        } else {
          scihubMirrorSelect.value = 'custom';
          scihubMirrorInput.style.display = 'block';
        }

        resolve();
      });
    });
  }

  function savePreferences() {
    const selectedMirror = scihubMirrorSelect.value === 'custom' 
      ? scihubMirrorInput.value.trim() 
      : scihubMirrorSelect.value;

    const prefs = {
      [CONFIG.STORAGE_KEYS.templatePattern]: templateInput.value.trim() || CONFIG.DEFAULT_TEMPLATE,
      [CONFIG.STORAGE_KEYS.saveToSubfolder]: saveSubfolderCheckbox.checked,
      [CONFIG.STORAGE_KEYS.subfolderName]: subfolderInput.value.trim() || CONFIG.DEFAULT_SUBFOLDER,
      [CONFIG.STORAGE_KEYS.maxTitleLength]: parseInt(maxTitleSlider.value, 10) || 80,
      [CONFIG.STORAGE_KEYS.unpaywallEmail]: unpaywallEmailInput.value.trim() || CONFIG.DEFAULT_UNPAYWALL_EMAIL,
      [CONFIG.STORAGE_KEYS.enableSciHub]: enableSciHubCheckbox.checked,
      [CONFIG.STORAGE_KEYS.sciHubMirror]: selectedMirror || CONFIG.DEFAULT_SCIHUB_MIRROR
    };

    chrome.storage.sync.set(prefs, () => {
      showToast('✓ Preferences Saved!');
    });
  }

  function resetToDefaults() {
    templateInput.value = CONFIG.DEFAULT_TEMPLATE;
    updateActivePresetButton(CONFIG.DEFAULT_TEMPLATE);

    saveSubfolderCheckbox.checked = true;
    subfolderGroup.style.display = 'block';
    subfolderInput.value = CONFIG.DEFAULT_SUBFOLDER;

    maxTitleSlider.value = CONFIG.DEFAULT_MAX_TITLE_LENGTH;
    maxTitleValue.textContent = `${CONFIG.DEFAULT_MAX_TITLE_LENGTH} chars`;

    unpaywallEmailInput.value = CONFIG.DEFAULT_UNPAYWALL_EMAIL;
    enableSciHubCheckbox.checked = true;
    scihubGroup.style.display = 'block';
    scihubMirrorInput.value = CONFIG.DEFAULT_SCIHUB_MIRROR;

    savePreferences();
    updateSandbox();
    showToast('Reset to default preferences');
  }

  let toastTimer = null;
  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    optionsToast.textContent = msg;
    optionsToast.classList.add('show');
    toastTimer = setTimeout(() => {
      optionsToast.classList.remove('show');
    }, 2500);
  }
});

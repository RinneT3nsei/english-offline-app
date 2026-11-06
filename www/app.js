/**
 * Offline English Vocabulary App
 * Material 3 (Material You) Design with Piper Neural TTS, Favorites & Blur Self-Testing
 */

(function () {
  'use strict';

  const STORAGE_KEY_FAVS = 'offline_english_favs';
  const STORAGE_KEY_BLUR = 'offline_english_blur_mode';

  // Piper TTS Models Configuration (INT8 Quantized Models)
  const PIPER_MODELS = {
    'en-US': {
      id: 'en-US',
      label: 'US (Lessac INT8)',
      modelPath: 'assets/tts/en_US-lessac-medium.onnx',
      configPath: 'assets/tts/en_US-lessac-medium.onnx.json'
    },
    'en-GB': {
      id: 'en-GB',
      label: 'UK (Alan INT8)',
      modelPath: 'assets/tts/en_GB-alan-medium.onnx',
      configPath: 'assets/tts/en_GB-alan-medium.onnx.json'
    }
  };

  // Application State
  const state = {
    dictionary: [],
    filteredList: [],
    favorites: new Set(),
    searchQuery: '',
    selectedFilter: 'all', // 'all', 'favorites', 'noun', 'verb', 'adjective'
    isTrainingMode: localStorage.getItem(STORAGE_KEY_BLUR) === 'true',
    activeSpeechButton: null,

    // Neural TTS Caches
    ttsSessions: {},
    ttsConfigs: {}
  };

  // Load Saved Favorites from localStorage
  try {
    const rawFavs = localStorage.getItem(STORAGE_KEY_FAVS);
    if (rawFavs) {
      state.favorites = new Set(JSON.parse(rawFavs));
    }
  } catch (_) {
    state.favorites = new Set();
  }

  // DOM Elements
  const el = {
    appHeader: document.getElementById('appHeader'),
    cardsList: document.getElementById('cardsList'),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    filterChips: document.getElementById('filterChips'),
    resultsCount: document.getElementById('resultsCount'),
    countAll: document.getElementById('countAll'),
    countFavs: document.getElementById('countFavs'),
    emptyState: document.getElementById('emptyState'),
    resetFilterBtn: document.getElementById('resetFilterBtn'),
    toggleAllBlurBtn: document.getElementById('toggleAllBlurBtn'),
    blurModeLabel: document.getElementById('blurModeLabel')
  };

  // Icon SVG Templates (Material Symbols inspired)
  const ICONS = {
    volume: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
    starOutline: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
    starFilled: `<svg viewBox="0 0 24 24" width="20" height="20" fill="#facc15" stroke="#facc15" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`
  };

  // ---------------------------------------------------------------------------
  // Web Audio API Controller
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  let activeAudioSource = null;

  function getAudioContext(sampleRate = 22050) {
    if (!audioCtx || audioCtx.state === 'closed') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass({ sampleRate });
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function stopAudio() {
    if (activeAudioSource) {
      try {
        activeAudioSource.stop();
        activeAudioSource.disconnect();
      } catch (_) {}
      activeAudioSource = null;
    }
    document.querySelectorAll('.word-card.is-active-card').forEach(c => c.classList.remove('is-active-card'));
    if (state.activeSpeechButton) {
      state.activeSpeechButton.classList.remove('is-speaking');
      state.activeSpeechButton = null;
    }
  }

  function playPcmAudio(float32Samples, sampleRate = 22050, onEndCallback) {
    stopAudio();
    const ctx = getAudioContext(sampleRate);
    const audioBuffer = ctx.createBuffer(1, float32Samples.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32Samples);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    source.onended = () => {
      activeAudioSource = null;
      if (onEndCallback) onEndCallback();
    };

    activeAudioSource = source;
    source.start(0);
  }

  // ---------------------------------------------------------------------------
  // Piper Neural TTS Engine (ONNX Runtime WebAssembly)
  // ---------------------------------------------------------------------------
  function initOnnxEnvironment() {
    if (typeof ort !== 'undefined') {
      ort.env.wasm.wasmPaths = 'assets/tts/';
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
    }
  }

  async function loadPiperModel(accent) {
    if (state.ttsSessions[accent]) {
      return state.ttsSessions[accent];
    }

    const modelDef = PIPER_MODELS[accent] || PIPER_MODELS['en-US'];

    if (!state.ttsConfigs[accent]) {
      const configRes = await fetch(modelDef.configPath);
      if (!configRes.ok) throw new Error(`Failed to load config: ${configRes.statusText}`);
      state.ttsConfigs[accent] = await configRes.json();
    }

    if (typeof ort === 'undefined') {
      throw new Error('ONNX Runtime Web is not loaded');
    }

    const sessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    };

    const session = await ort.InferenceSession.create(modelDef.modelPath, sessionOptions);
    state.ttsSessions[accent] = {
      session,
      config: state.ttsConfigs[accent]
    };

    return state.ttsSessions[accent];
  }

  function textToPhonemeSequence(text, phonemeIdMap, ipa = null) {
    const pad = phonemeIdMap['_'] ? phonemeIdMap['_'][0] : 0;
    const bos = phonemeIdMap['^'] ? phonemeIdMap['^'][0] : 1;
    const eos = phonemeIdMap['$'] ? phonemeIdMap['$'][0] : 2;
    const space = phonemeIdMap[' '] ? phonemeIdMap[' '][0] : 3;

    let tokenIds = [];

    // Exact IPA phoneme lookup
    if (ipa && typeof ipa === 'string') {
      const cleanIpa = ipa.replace(/[\/\.]/g, '').trim();
      for (const char of cleanIpa) {
        if (phonemeIdMap[char]) {
          tokenIds.push(phonemeIdMap[char][0]);
        } else if (phonemeIdMap[char.toLowerCase()]) {
          tokenIds.push(phonemeIdMap[char.toLowerCase()][0]);
        }
      }
    }

    // Fallback text character lookup
    if (tokenIds.length === 0) {
      const normalized = text.trim();
      for (const char of normalized) {
        const lower = char.toLowerCase();
        if (phonemeIdMap[char]) {
          tokenIds.push(phonemeIdMap[char][0]);
        } else if (phonemeIdMap[lower]) {
          tokenIds.push(phonemeIdMap[lower][0]);
        } else if (char === ' ') {
          tokenIds.push(space);
        }
      }
    }

    // Sequence format: [bos, pad, tok1, pad, tok2, ..., pad, eos]
    const sequence = [bos];
    for (const id of tokenIds) {
      sequence.push(pad);
      sequence.push(id);
    }
    sequence.push(pad);
    sequence.push(eos);

    return sequence;
  }

  async function synthesizeWithPiper(text, accent, ipa = null) {
    const { session, config } = await loadPiperModel(accent);

    const sampleRate = (config.audio && config.audio.sample_rate) || 22050;
    const noiseScale = (config.inference && config.inference.noise_scale) ?? 0.667;
    const lengthScale = (config.inference && config.inference.length_scale) ?? 1.0;
    const noiseW = (config.inference && config.inference.noise_w) ?? 0.8;

    const phonemeIds = textToPhonemeSequence(text, config.phoneme_id_map, ipa);
    const seqLen = phonemeIds.length;

    const inputTensor = new ort.Tensor('int64', BigInt64Array.from(phonemeIds.map(BigInt)), [1, seqLen]);
    const inputLengthsTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(seqLen)]), [1]);
    const scalesTensor = new ort.Tensor('float32', new Float32Array([noiseScale, lengthScale, noiseW]), [3]);

    const feeds = {
      input: inputTensor,
      input_lengths: inputLengthsTensor,
      scales: scalesTensor
    };

    if (session.inputNames.includes('sid')) {
      feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    }

    const results = await session.run(feeds);
    const outputTensor = results.output || results[session.outputNames[0]];

    return {
      audioData: outputTensor.data,
      sampleRate
    };
  }

  // ---------------------------------------------------------------------------
  // Unified Speech Controller with Piper WASM & Native Fallback
  // ---------------------------------------------------------------------------
  async function speakText(text, accent, buttonElement = null, ipa = null) {
    stopAudio();

    let cardElement = null;
    if (buttonElement) {
      state.activeSpeechButton = buttonElement;
      buttonElement.classList.add('is-speaking');
      cardElement = buttonElement.closest('.word-card');
      if (cardElement) {
        document.querySelectorAll('.word-card.is-active-card').forEach(c => c.classList.remove('is-active-card'));
        cardElement.classList.add('is-active-card');
      }
    }

    const cleanup = () => {
      if (buttonElement) {
        buttonElement.classList.remove('is-speaking');
      }
      if (cardElement) {
        cardElement.classList.remove('is-active-card');
      }
      if (state.activeSpeechButton === buttonElement) {
        state.activeSpeechButton = null;
      }
    };

    try {
      // 1. Primary: Fully embedded Piper Neural TTS via ONNX Runtime WebAssembly
      if (typeof ort !== 'undefined') {
        const { audioData, sampleRate } = await synthesizeWithPiper(text, accent, ipa);
        playPcmAudio(audioData, sampleRate, cleanup);
        return;
      }

      // 2. Secondary fallback: Capacitor Native Text-to-Speech plugin
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech) {
        try { await window.Capacitor.Plugins.TextToSpeech.stop(); } catch (_) {}
        await window.Capacitor.Plugins.TextToSpeech.speak({
          text,
          lang: accent,
          rate: 0.9,
          pitch: 1.0,
          volume: 1.0,
          category: 'ambient',
        });
        cleanup();
        return;
      }

      // 3. Tertiary fallback: Browser Web Speech API
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = accent;
        u.rate = 0.9;
        u.onend = cleanup;
        u.onerror = cleanup;
        window.speechSynthesis.speak(u);
        return;
      }

      cleanup();
    } catch (err) {
      console.warn('Piper TTS inference fallback:', err);
      // Emergency fallback
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech) {
        try {
          await window.Capacitor.Plugins.TextToSpeech.speak({ text, lang: accent, rate: 0.9 });
        } catch (_) {}
      } else if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = accent;
        u.onend = cleanup;
        u.onerror = cleanup;
        window.speechSynthesis.speak(u);
        return;
      }
      cleanup();
    }
  }

  // ---------------------------------------------------------------------------
  // Favorites Management
  // ---------------------------------------------------------------------------
  function toggleFavorite(id, starButton) {
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
      if (starButton) {
        starButton.innerHTML = ICONS.starOutline;
        starButton.classList.remove('is-favorite');
      }
    } else {
      state.favorites.add(id);
      if (starButton) {
        starButton.innerHTML = ICONS.starFilled;
        starButton.classList.add('is-favorite');
      }
    }

    try {
      localStorage.setItem(STORAGE_KEY_FAVS, JSON.stringify(Array.from(state.favorites)));
    } catch (_) {}

    updateFavoritesCount();

    // If currently viewing favorites tab, immediately re-render list
    if (state.selectedFilter === 'favorites') {
      applyFilterAndRender();
    }
  }

  function updateFavoritesCount() {
    if (el.countFavs) {
      el.countFavs.textContent = state.favorites.size;
    }
  }

  // ---------------------------------------------------------------------------
  // Training Mode (Blur Toggle)
  // ---------------------------------------------------------------------------
  function setTrainingMode(active) {
    state.isTrainingMode = active;
    try {
      localStorage.setItem(STORAGE_KEY_BLUR, active ? 'true' : 'false');
    } catch (_) {}

    if (el.toggleAllBlurBtn) {
      el.toggleAllBlurBtn.classList.toggle('active', active);
    }
    if (el.blurModeLabel) {
      el.blurModeLabel.textContent = active ? 'Приховано' : 'Тренування';
    }

    // Toggle class on cardsList
    if (el.cardsList) {
      el.cardsList.classList.toggle('training-mode-active', active);
    }
  }

  // ---------------------------------------------------------------------------
  // Data Loading & Fallback
  // ---------------------------------------------------------------------------
  async function loadDictionary() {
    try {
      const response = await fetch('assets/dictionary.json');
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const data = await response.json();
      state.dictionary = data;
    } catch (err) {
      console.warn('Could not load assets/dictionary.json via fetch, using fallback', err);
      state.dictionary = getFallbackDictionary();
    }

    if (el.countAll) {
      el.countAll.textContent = state.dictionary.length;
    }
    updateFavoritesCount();
    applyFilterAndRender();
  }

  // ---------------------------------------------------------------------------
  // Filtering & Search
  // ---------------------------------------------------------------------------
  function applyFilterAndRender() {
    const query = state.searchQuery.trim().toLowerCase();
    const filter = state.selectedFilter;

    state.filteredList = state.dictionary.filter(item => {
      // 1. Filter by Favorites
      if (filter === 'favorites') {
        if (!state.favorites.has(item.id)) return false;
      } 
      // 2. Filter by Part of Speech
      else if (filter !== 'all') {
        if (item.partOfSpeech.toLowerCase() !== filter) return false;
      }

      // 3. Search query match
      if (!query) return true;

      const wordMatch = item.word.toLowerCase().includes(query);
      const translationMatch = item.translation.toLowerCase().includes(query);
      const phraseMatch = item.exampleSentence.toLowerCase().includes(query);
      const phraseTranslationMatch = item.exampleTranslation.toLowerCase().includes(query);
      const ipaMatch = item.ipa.toLowerCase().includes(query);

      return wordMatch || translationMatch || phraseMatch || phraseTranslationMatch || ipaMatch;
    });

    renderCards();
    updateStatus();
  }

  function updateStatus() {
    const count = state.filteredList.length;
    const total = state.dictionary.length;

    if (count === 0) {
      el.resultsCount.textContent = 'Нічого не знайдено';
      el.emptyState.hidden = false;
      el.cardsList.hidden = true;
    } else {
      if (state.selectedFilter === 'favorites') {
        el.resultsCount.textContent = `Збережено: ${count} слів`;
      } else {
        el.resultsCount.textContent = `Знайдено: ${count} із ${total}`;
      }
      el.emptyState.hidden = true;
      el.cardsList.hidden = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Card Rendering - Compact Material 3 Layout
  // ---------------------------------------------------------------------------
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function highlightMatches(text, query) {
    const safeText = escapeHtml(text);
    if (!query) return safeText;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return safeText.replace(regex, '<mark>$1</mark>');
  }

  function renderCards() {
    const fragment = document.createDocumentFragment();
    const query = state.searchQuery.trim().toLowerCase();

    state.filteredList.forEach(item => {
      const isFav = state.favorites.has(item.id);
      const card = document.createElement('article');
      card.className = 'word-card';
      card.setAttribute('data-id', item.id);

      const posLabel = item.partOfSpeech;
      const levelLabel = item.level || 'B2';

      card.innerHTML = `
        <!-- Card Top Bar: Word, IPA, Badges, Word Audio Chips, Favorite Star -->
        <div class="card-header-m3">
          <div class="word-primary-meta">
            <div class="word-title-row">
              <h2 class="word-title">${highlightMatches(item.word, query)}</h2>
              <span class="word-ipa">${escapeHtml(item.ipa)}</span>
              
              <!-- Compact Word Speech Chips (US & UK) -->
              <div class="word-speech-chips">
                <button class="speech-chip chip-us" data-action="speak-word-us" title="Озвучити US">
                  <span class="flag">🇺🇸</span> <span>US</span> ${ICONS.volume}
                </button>
                <button class="speech-chip chip-uk" data-action="speak-word-uk" title="Озвучити UK">
                  <span class="flag">🇬🇧</span> <span>UK</span> ${ICONS.volume}
                </button>
              </div>
            </div>

            <div class="badges-row">
              <span class="pos-tag">${escapeHtml(posLabel)}</span>
              <span class="level-tag">${escapeHtml(levelLabel)}</span>
            </div>
          </div>

          <!-- Favorite Star Icon Button -->
          <button class="fav-icon-btn ${isFav ? 'is-favorite' : ''}" data-action="toggle-fav" title="${isFav ? 'Видалити з обраного' : 'Зберегти в обране'}">
            ${isFav ? ICONS.starFilled : ICONS.starOutline}
          </button>
        </div>

        <!-- Word Translation with Tap-to-Reveal Blur for Self-Testing -->
        <div class="word-translation-box" data-action="reveal-word" title="Тапніть, щоб відкрити/приховати">
          <span class="translation-text blur-target">${highlightMatches(item.translation, query)}</span>
          <span class="reveal-hint-badge">переклад</span>
        </div>

        <!-- Quote Context Box with Integrated Mini Audio Icons -->
        <div class="example-quote-box">
          <div class="quote-text-container">
            <p class="example-phrase">“${highlightMatches(item.exampleSentence, query)}”</p>
            <p class="example-translation blur-target" data-action="reveal-phrase">${highlightMatches(item.exampleTranslation, query)}</p>
          </div>

          <!-- Bottom Right Floating Mini Audio Flags -->
          <div class="phrase-audio-actions">
            <button class="mini-speech-btn" data-action="speak-phrase-us" title="Озвучити фразу: US">
              <span class="flag">🇺🇸</span>
            </button>
            <button class="mini-speech-btn" data-action="speak-phrase-uk" title="Озвучити фразу: UK">
              <span class="flag">🇬🇧</span>
            </button>
          </div>
        </div>
      `;

      // Event Listeners for Word Audio Chips
      const wordUsBtn = card.querySelector('[data-action="speak-word-us"]');
      const wordUkBtn = card.querySelector('[data-action="speak-word-uk"]');
      wordUsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakText(item.word, 'en-US', wordUsBtn, item.ipa);
      });
      wordUkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakText(item.word, 'en-GB', wordUkBtn, item.ipa);
      });

      // Event Listeners for Phrase Mini Audio Buttons
      const phraseUsBtn = card.querySelector('[data-action="speak-phrase-us"]');
      const phraseUkBtn = card.querySelector('[data-action="speak-phrase-uk"]');
      phraseUsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakText(item.exampleSentence, 'en-US', phraseUsBtn, null);
      });
      phraseUkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakText(item.exampleSentence, 'en-GB', phraseUkBtn, null);
      });

      // Event Listener for Favorite Star
      const favBtn = card.querySelector('[data-action="toggle-fav"]');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(item.id, favBtn);
      });

      // Tap to toggle blur on translation
      const transBox = card.querySelector('[data-action="reveal-word"]');
      transBox.addEventListener('click', () => {
        transBox.classList.toggle('revealed');
      });

      const phraseTrans = card.querySelector('[data-action="reveal-phrase"]');
      phraseTrans.addEventListener('click', () => {
        phraseTrans.classList.toggle('revealed');
      });

      fragment.appendChild(card);
    });

    el.cardsList.innerHTML = '';
    el.cardsList.appendChild(fragment);
  }

  // ---------------------------------------------------------------------------
  // Event Bindings
  // ---------------------------------------------------------------------------
  function initEvents() {
    // Search input
    el.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      el.clearSearchBtn.hidden = !state.searchQuery;
      applyFilterAndRender();
    });

    // Clear search
    el.clearSearchBtn.addEventListener('click', () => {
      state.searchQuery = '';
      el.searchInput.value = '';
      el.clearSearchBtn.hidden = true;
      el.searchInput.focus();
      applyFilterAndRender();
    });

    // Reset filters
    el.resetFilterBtn.addEventListener('click', () => {
      state.searchQuery = '';
      state.selectedFilter = 'all';
      el.searchInput.value = '';
      el.clearSearchBtn.hidden = true;

      const chips = el.filterChips.querySelectorAll('.chip');
      chips.forEach(c => c.classList.toggle('active', c.dataset.pos === 'all'));

      applyFilterAndRender();
    });

    // Filter Chips click
    el.filterChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;

      const filterType = chip.dataset.pos;
      if (state.selectedFilter === filterType) return;

      state.selectedFilter = filterType;
      el.filterChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      applyFilterAndRender();
    });

    // Self-test Blur Mode Toggle Button
    if (el.toggleAllBlurBtn) {
      el.toggleAllBlurBtn.addEventListener('click', () => {
        setTrainingMode(!state.isTrainingMode);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Fallback Dictionary Data
  // ---------------------------------------------------------------------------
  function getFallbackDictionary() {
    return [
      { id: 1, word: "Resilience", ipa: "/rɪˈzɪl.jəns/", partOfSpeech: "noun", translation: "стійкість, життєстійкість", exampleSentence: "Her mental resilience helped her overcome unexpected hardships.", exampleTranslation: "Її психологічна стійкість допомогла їй подолати несподівані труднощі.", level: "B2" },
      { id: 2, word: "Perseverance", ipa: "/ˌpɜː.sɪˈvɪə.rəns/", partOfSpeech: "noun", translation: "наполегливість, завзятість", exampleSentence: "Through hard work and perseverance, he achieved his biggest dream.", exampleTranslation: "Завдяки наполегливій праці та завзятості він досяг своєї найбільшої мрії.", level: "C1" },
      { id: 3, word: "Serendipity", ipa: "/ˌser.ənˈdɪp.ə.ti/", partOfSpeech: "noun", translation: "щаслива випадковість, прозорливість", exampleSentence: "Finding this cozy bookstore was pure serendipity.", exampleTranslation: "Знайти цю затишну книгарню було справжньою щасливою випадковістю.", level: "C2" },
      { id: 4, word: "Eloquent", ipa: "/ˈel.ə.kwənt/", partOfSpeech: "adjective", translation: "красномовний, переконливий", exampleSentence: "She gave an eloquent speech that touched everyone in the room.", exampleTranslation: "Вона виголосила красномовну промову, яка зворушила кожного присутнього.", level: "B2" },
      { id: 5, word: "Ambiguity", ipa: "/ˌæm.bɪˈɡjuː.ə.ti/", partOfSpeech: "noun", translation: "двозначність, невизначеність", exampleSentence: "Clear instructions reduce ambiguity and prevent common mistakes.", exampleTranslation: "Чіткі інструкції зменшують двозначність і запобігають типовим помилкам.", level: "B2" },
      { id: 6, word: "Tenacious", ipa: "/təˈneɪ.ʃəs/", partOfSpeech: "adjective", translation: "чіпкий, впертий, непохитний", exampleSentence: "He was a tenacious investigator who never abandoned a case.", exampleTranslation: "Він був непохитним слідчим, який ніколи не кидав справу.", level: "C1" },
      { id: 7, word: "Meticulous", ipa: "/məˈtɪk.jə.ləs/", partOfSpeech: "adjective", translation: "ретельний, педантичний", exampleSentence: "She paid meticulous attention to every single detail in the report.", exampleTranslation: "Вона приділила ретельну увагу кожній окремій деталі у звіті.", level: "B2" },
      { id: 8, word: "Ephemeral", ipa: "/ɪˈfem.ər.əl/", partOfSpeech: "adjective", translation: "ефемерний, скороминущий", exampleSentence: "Morning mist is ephemeral and disappears as soon as the sun rises.", exampleTranslation: "Ранковий туман скороминущий і зникає, щойно сходить сонце.", level: "C2" },
      { id: 9, word: "Pragmatic", ipa: "/præɡˈmæt.ɪk/", partOfSpeech: "adjective", translation: "прагматичний, практичний", exampleSentence: "We need a pragmatic approach rather than an idealistic vision.", exampleTranslation: "Нам потрібен практичний підхід, а не ідеалістичне бачення.", level: "B2" },
      { id: 10, word: "Versatile", ipa: "/ˈvɜː.sə.taɪl/", partOfSpeech: "adjective", translation: "універсальний, різнобічний", exampleSentence: "This software tool is versatile enough for beginners and experts alike.", exampleTranslation: "Цей програмний інструмент достатньо універсальний як для початківців, так і для експертів.", level: "B2" }
    ];
  }

  // ---------------------------------------------------------------------------
  // Scroll-Aware Quick Return Header Controller
  // ---------------------------------------------------------------------------
  function initQuickReturnHeader() {
    const header = el.appHeader || document.getElementById('appHeader') || document.querySelector('.app-header');
    if (!header) return;

    let lastScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const threshold = 8; // Поріг чутливості у px для запобігання тремтінню
    const minScrollForHide = 80; // Мінімальна глибина скролу для приховування

    const updateHeaderHeight = () => {
      const h = header.offsetHeight;
      if (h > 0) {
        document.documentElement.style.setProperty('--header-height', `${h}px`);
      }
    };

    updateHeaderHeight();
    window.addEventListener('resize', updateHeaderHeight, { passive: true });

    window.addEventListener('scroll', () => {
      const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      const delta = currentScrollY - lastScrollY;

      // 1. Якщо користувач на самому верху сторінки — завжди показуємо
      if (currentScrollY <= 10) {
        header.classList.remove('header--hidden');
        lastScrollY = currentScrollY;
        return;
      }

      // 2. Ігноруємо мікрорухи менші за threshold
      if (Math.abs(delta) < threshold) {
        return;
      }

      // 3. Скролять униз (delta > 0) і скрол більший за 80px — приховуємо
      if (delta > 0 && currentScrollY > minScrollForHide) {
        header.classList.add('header--hidden');
      } 
      // 4. Скролять угору (delta < 0) — миттєвий швидкий показ (Quick Return)
      else if (delta < 0) {
        header.classList.remove('header--hidden');
      }

      lastScrollY = currentScrollY;
    }, { passive: true });
  }

  // ---------------------------------------------------------------------------
  // Bootstrapping
  // ---------------------------------------------------------------------------
  initOnnxEnvironment();
  initEvents();
  initQuickReturnHeader();
  setTrainingMode(state.isTrainingMode);
  loadDictionary();

  // Preload Piper INT8 models in background for instantaneous first playback
  if (typeof ort !== 'undefined') {
    setTimeout(() => {
      loadPiperModel('en-US').catch(() => {});
      loadPiperModel('en-GB').catch(() => {});
    }, 600);
  }
})();

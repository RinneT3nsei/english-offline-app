/**
 * Offline English Vocabulary App
 * 100% Offline with Piper Neural TTS via ONNX Runtime WebAssembly & Web Audio API
 */

(function () {
  'use strict';

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
    searchQuery: '',
    selectedPos: 'all',
    preferredAccent: 'en-US', // 'en-US' or 'en-GB'
    activeSpeechButton: null,

    // Neural TTS Caches
    ttsSessions: {},
    ttsConfigs: {},
    isInitializingTTS: false
  };

  // DOM Elements
  const el = {
    cardsList: document.getElementById('cardsList'),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    filterChips: document.getElementById('filterChips'),
    resultsCount: document.getElementById('resultsCount'),
    countAll: document.getElementById('countAll'),
    emptyState: document.getElementById('emptyState'),
    resetFilterBtn: document.getElementById('resetFilterBtn'),
    voiceToggleBtn: document.getElementById('voiceToggleBtn'),
    currentAccent: document.getElementById('currentAccent')
  };

  // Icon SVG Templates
  const ICONS = {
    speaker: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`,
    quote: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`
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
      // Point ONNX Runtime Web to local WASM binaries
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

    // 1. Fetch JSON config
    if (!state.ttsConfigs[accent]) {
      const configRes = await fetch(modelDef.configPath);
      if (!configRes.ok) throw new Error(`Failed to load config: ${configRes.statusText}`);
      state.ttsConfigs[accent] = await configRes.json();
    }

    // 2. Initialize ONNX session
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

  /**
   * Convert text / IPA into Piper phoneme ID tensor inputs
   */
  function textToPhonemeSequence(text, phonemeIdMap, ipa = null) {
    const pad = phonemeIdMap['_'] ? phonemeIdMap['_'][0] : 0;
    const bos = phonemeIdMap['^'] ? phonemeIdMap['^'][0] : 1;
    const eos = phonemeIdMap['$'] ? phonemeIdMap['$'][0] : 2;
    const space = phonemeIdMap[' '] ? phonemeIdMap[' '][0] : 3;

    let tokenIds = [];

    // If word has exact IPA transcription, prioritize IPA symbols
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

    // Fallback or sentence character-level token mapping
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

    // Interleave tokens with pad ID: [bos, pad, tok1, pad, tok2, ..., pad, eos]
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

    // Create ONNX inputs
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
      audioData: outputTensor.data, // Float32Array PCM samples
      sampleRate
    };
  }

  // ---------------------------------------------------------------------------
  // Unified Speech Controller with Piper WASM & Native Fallback
  // ---------------------------------------------------------------------------
  async function speakText(text, accent = state.preferredAccent, buttonElement = null, ipa = null) {
    // Handle parameter shuffling
    if (typeof accent === 'object' && accent !== null && !buttonElement) {
      buttonElement = accent;
      accent = state.preferredAccent;
    }

    stopAudio();

    let cardElement = null;
    if (state.activeSpeechButton) {
      state.activeSpeechButton.classList.remove('is-speaking');
      state.activeSpeechButton = null;
    }

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

      console.warn('No audio synthesis engine available.');
      cleanup();
    } catch (err) {
      console.warn('Piper TTS inference notice (falling back):', err);

      // Attempt fallback if Piper model loading took extra time
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech) {
        try {
          await window.Capacitor.Plugins.TextToSpeech.speak({
            text,
            lang: accent,
            rate: 0.9,
            pitch: 1.0,
            volume: 1.0
          });
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

  function toggleVoiceAccent() {
    state.preferredAccent = state.preferredAccent === 'en-US' ? 'en-GB' : 'en-US';
    const currentModel = PIPER_MODELS[state.preferredAccent];
    el.currentAccent.textContent = currentModel.label;

    // Pre-warm the newly selected model in background
    if (typeof ort !== 'undefined') {
      loadPiperModel(state.preferredAccent).catch(e => console.log('Preload:', e));
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

    el.countAll.textContent = state.dictionary.length;
    applyFilterAndRender();
  }

  // ---------------------------------------------------------------------------
  // Filtering & Search
  // ---------------------------------------------------------------------------
  function applyFilterAndRender() {
    const query = state.searchQuery.trim().toLowerCase();
    const pos = state.selectedPos;

    state.filteredList = state.dictionary.filter(item => {
      if (pos !== 'all' && item.partOfSpeech.toLowerCase() !== pos) {
        return false;
      }
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
      el.resultsCount.textContent = `Знайдено: ${count} із ${total} слів`;
      el.emptyState.hidden = true;
      el.cardsList.hidden = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Card Rendering
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
      const card = document.createElement('article');
      card.className = 'word-card';
      card.setAttribute('data-id', item.id);

      const posLabel = item.partOfSpeech;
      const levelLabel = item.level || 'B2';

      card.innerHTML = `
        <div class="card-top">
          <div class="word-info">
            <div class="word-header-row">
              <h2 class="word-title">${highlightMatches(item.word, query)}</h2>
              <span class="word-ipa">${escapeHtml(item.ipa)}</span>
            </div>
            <div class="badges-row">
              <span class="pos-tag">${escapeHtml(posLabel)}</span>
              <span class="level-tag">${escapeHtml(levelLabel)}</span>
            </div>
          </div>
        </div>

        <div class="word-translation">
          ${highlightMatches(item.translation, query)}
        </div>

        <div class="example-box">
          <p class="example-phrase">“${highlightMatches(item.exampleSentence, query)}”</p>
          <p class="example-translation">${highlightMatches(item.exampleTranslation, query)}</p>
        </div>

        <div class="card-actions">
          <button class="speech-btn btn-word" data-action="speak-word" title="Озвучити слово">
            ${ICONS.speaker} <span>Слово</span>
          </button>
          <button class="speech-btn btn-phrase" data-action="speak-phrase" title="Озвучити фразу">
            ${ICONS.quote} <span>Фраза</span>
          </button>
        </div>
      `;

      // Event Listeners for Speech Buttons
      const wordBtn = card.querySelector('[data-action="speak-word"]');
      const phraseBtn = card.querySelector('[data-action="speak-phrase"]');

      wordBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakText(item.word, state.preferredAccent, wordBtn, item.ipa);
      });

      phraseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakText(item.exampleSentence, state.preferredAccent, phraseBtn, null);
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
    el.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      el.clearSearchBtn.hidden = !state.searchQuery;
      applyFilterAndRender();
    });

    el.clearSearchBtn.addEventListener('click', () => {
      state.searchQuery = '';
      el.searchInput.value = '';
      el.clearSearchBtn.hidden = true;
      el.searchInput.focus();
      applyFilterAndRender();
    });

    el.resetFilterBtn.addEventListener('click', () => {
      state.searchQuery = '';
      state.selectedPos = 'all';
      el.searchInput.value = '';
      el.clearSearchBtn.hidden = true;

      const chips = el.filterChips.querySelectorAll('.chip');
      chips.forEach(c => c.classList.toggle('active', c.dataset.pos === 'all'));

      applyFilterAndRender();
    });

    el.filterChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;

      const pos = chip.dataset.pos;
      if (state.selectedPos === pos) return;

      state.selectedPos = pos;
      el.filterChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      applyFilterAndRender();
    });

    el.voiceToggleBtn.addEventListener('click', () => {
      toggleVoiceAccent();
    });
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
  // Bootstrapping
  // ---------------------------------------------------------------------------
  initOnnxEnvironment();
  initEvents();
  loadDictionary();

  // Set default accent label
  if (el.currentAccent) {
    el.currentAccent.textContent = PIPER_MODELS[state.preferredAccent].label;
  }
})();

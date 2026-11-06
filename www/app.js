/**
 * Offline English Vocabulary App
 * Pure Vanilla JavaScript - 100% Offline with Web Speech API
 */

(function () {
  'use strict';

  // Application State
  const state = {
    dictionary: [],
    filteredList: [],
    searchQuery: '',
    selectedPos: 'all',
    preferredAccent: 'en-US', // 'en-US' or 'en-GB'
    availableVoices: [],
    activeSpeechButton: null
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
  // Speech Synthesis Controller
  // ---------------------------------------------------------------------------
  function initSpeech() {
    if (!('speechSynthesis' in window)) {
      console.warn('Speech synthesis not supported in this environment.');
      return;
    }

    const loadVoices = () => {
      state.availableVoices = window.speechSynthesis.getVoices();
    };

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  function getBestVoice(targetLang) {
    if (!state.availableVoices || state.availableVoices.length === 0) {
      return null;
    }

    // Exact match (e.g. en-US)
    let match = state.availableVoices.find(v => v.lang === targetLang);
    if (match) return match;

    // Language prefix match (e.g. en-*)
    const prefix = targetLang.split('-')[0];
    match = state.availableVoices.find(v => v.lang.startsWith(prefix));
    return match || null;
  }

  function speakText(text, buttonElement, customRate = 0.9) {
    if (!('speechSynthesis' in window)) {
      alert('Ваш пристрій не підтримує Web Speech API.');
      return;
    }

    // Stop ongoing speech
    window.speechSynthesis.cancel();
    if (state.activeSpeechButton) {
      state.activeSpeechButton.classList.remove('is-speaking');
      state.activeSpeechButton = null;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = state.preferredAccent;
    utterance.rate = customRate; // Clear pace for learners
    utterance.pitch = 1.0;

    const voice = getBestVoice(state.preferredAccent);
    if (voice) {
      utterance.voice = voice;
    }

    if (buttonElement) {
      state.activeSpeechButton = buttonElement;
      buttonElement.classList.add('is-speaking');

      const cleanup = () => {
        buttonElement.classList.remove('is-speaking');
        if (state.activeSpeechButton === buttonElement) {
          state.activeSpeechButton = null;
        }
      };

      utterance.onend = cleanup;
      utterance.onerror = cleanup;
    }

    window.speechSynthesis.speak(utterance);
  }

  function toggleVoiceAccent() {
    state.preferredAccent = state.preferredAccent === 'en-US' ? 'en-GB' : 'en-US';
    el.currentAccent.textContent = state.preferredAccent;
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
      // Fallback data in case opened directly as file:// or if fetch is blocked
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
      // Filter by Part of Speech
      if (pos !== 'all' && item.partOfSpeech.toLowerCase() !== pos) {
        return false;
      }

      // Filter by Search query
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
        speakText(item.word, wordBtn, 0.85);
      });

      phraseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakText(item.exampleSentence, phraseBtn, 0.92);
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

    // Clear search button
    el.clearSearchBtn.addEventListener('click', () => {
      state.searchQuery = '';
      el.searchInput.value = '';
      el.clearSearchBtn.hidden = true;
      el.searchInput.focus();
      applyFilterAndRender();
    });

    // Reset button in empty state
    el.resetFilterBtn.addEventListener('click', () => {
      state.searchQuery = '';
      state.selectedPos = 'all';
      el.searchInput.value = '';
      el.clearSearchBtn.hidden = true;

      const chips = el.filterChips.querySelectorAll('.chip');
      chips.forEach(c => c.classList.toggle('active', c.dataset.pos === 'all'));

      applyFilterAndRender();
    });

    // Filter Chips
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

    // Accent voice switch
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
  initSpeech();
  initEvents();
  loadDictionary();
})();

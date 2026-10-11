const sampleText = `Cuando llegué a la casa de mi abuela, la puerta estaba entreabierta. Entré despacio y dejé la mochila junto al perchero. Desde la cocina llegaba un olor delicioso a canela y pan recién horneado.\n\n—¿Eres tú, cariño? —preguntó ella sin levantar la vista de la masa.\n\nMe senté a su lado y le conté todo lo que había pasado durante el viaje. Afuera, la tarde se desvanecía lentamente, pero dentro de la casa el tiempo parecía haberse detenido.`;
const initialState = {
  passages: [{ id: 'p1', title: 'La casa de la abuela', text: sampleText, highlights: [] }],
  active: 'p1',
  queue: [],
  repeatQueue: [],
  round: 1,
  settings: { farsiEnabled: false, liveTranslationEnabled: true, liveTranslationLang: 'en', liveTranslationOnline: true }
};

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem('lumbre-state') || 'null');
    if (stored && Array.isArray(stored.passages)) {
      stored.passages.forEach(passage => {
        passage.highlights = Array.isArray(passage.highlights) ? passage.highlights : [];
        passage.title = String(passage.title || 'Untitled passage');
        passage.text = String(passage.text || '');
      });
      stored.queue = Array.isArray(stored.queue) ? stored.queue : [];
      stored.repeatQueue = Array.isArray(stored.repeatQueue) ? stored.repeatQueue : [];
      stored.round = Number(stored.round) || 1;
      stored.settings = stored.settings && typeof stored.settings === 'object' ? stored.settings : {};
      stored.settings.farsiEnabled = stored.settings.farsiEnabled === true;
      stored.settings.liveTranslationEnabled = stored.settings.liveTranslationEnabled !== false;
      stored.settings.liveTranslationLang = stored.settings.liveTranslationLang === 'fa' ? 'fa' : 'en';
      stored.settings.liveTranslationOnline = stored.settings.liveTranslationOnline !== false;
      if (!stored.passages.some(passage => passage.id === stored.active)) {
        stored.active = stored.passages[0]?.id || '';
      }
      return stored;
    }
  } catch (error) {
    console.warn('Could not load the saved reading state.', error);
  }
  return JSON.parse(JSON.stringify(initialState));
}

let state = loadState();
ensureVerbState();
let pendingText = '';
let pendingStart = null;
let pendingEnd = null;
let pendingPassageId = '';
let tapAnchor = null;
let tapRangeComplete = false;
// iPad can request the desktop site. Touch capability, not viewport width or UA,
// determines the default; either mode remains available on every device.
let tapWordsEnabled = typeof state.settings.tapWordsEnabled === 'boolean'
  ? state.settings.tapWordsEnabled
  : navigator.maxTouchPoints > 0;
let passageEditingId = '';
let revealedCardId = '';
let revealedVerbCardId = '';
const $ = id => document.getElementById(id);

function save() {
  try {
    localStorage.setItem('lumbre-state', JSON.stringify(state));
  } catch (error) {
    console.warn('Could not save the reading state.', error);
  }
}

function activePassage() {
  const active = state.passages.find(passage => passage.id === state.active);
  const passage = active || state.passages[0] || null;
  if (passage) state.active = passage.id;
  return passage;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[character]));
}

function countWords(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function resetSelectionHint() {
  pendingText = '';
  pendingStart = null;
  pendingEnd = null;
  pendingPassageId = '';
  tapAnchor = null;
  tapRangeComplete = false;
  cancelSelectionCapture();
  // Native Safari may expose its selection only when the user touches this action.
  // Keep it tappable so we can capture then, rather than trapping users on a disabled button.
  $('selectionHint').disabled = tapWordsEnabled;
  $('selectionHint').textContent = 'Add to flashcards';
  $('selectionActions').classList.remove('is-active');
  $('selectionSummary').textContent = 'No words selected';
  $('clearSelectionBtn').hidden = true;
  const liveSel = $('selectionLiveTranslation');
  if (liveSel) liveSel.hidden = true;
  selectionLiveRequestId++;
  document.querySelectorAll('.tap-selected').forEach(word => {
    word.classList.remove('tap-selected');
    word.setAttribute('aria-pressed', 'false');
  });
}

function syncSelectionMode() {
  $('tapWordsMode').setAttribute('aria-pressed', String(tapWordsEnabled));
  $('nativeSelectionMode').setAttribute('aria-pressed', String(!tapWordsEnabled));
  $('readingText').classList.toggle('tap-words-mode', tapWordsEnabled);
  $('selectionInstructions').textContent = tapWordsEnabled
    ? 'Tap a word, or tap the first and last words of a phrase. Then tap Add to flashcards. Tap a saved highlight to edit it.'
    : 'Touch and hold a word, then adjust the handles. Tap Add to flashcards below. If selection handles do not work, choose Tap words.';
}

function setSelectionMode(tapEnabled) {
  tapWordsEnabled = tapEnabled;
  state.settings.tapWordsEnabled = tapEnabled;
  resetSelectionHint();
  window.getSelection()?.removeAllRanges();
  syncSelectionMode();
  const passage = activePassage();
  if (passage) renderPassageText(passage);
  save();
}

function renderSelectableText(text, offset, saved = false) {
  if (!tapWordsEnabled) return escapeHtml(text);
  const wordPattern = /[\p{L}\p{M}\p{N}]+(?:[’'-][\p{L}\p{M}\p{N}]+)*/gu;
  let output = '';
  let cursor = 0;
  for (const match of text.matchAll(wordPattern)) {
    output += escapeHtml(text.slice(cursor, match.index));
    const start = offset + match.index;
    const controls = saved ? '' : ' role="button" tabindex="0" aria-pressed="false"';
    output += `<span class="reading-word" data-start="${start}" data-end="${start + match[0].length}"${controls}>${escapeHtml(match[0])}</span>`;
    cursor = match.index + match[0].length;
  }
  return output + escapeHtml(text.slice(cursor));
}

function renderPassageText(passage) {
  const highlights = passage.highlights
    .filter(highlight => !highlight.learned
      && Number.isInteger(highlight.start)
      && Number.isInteger(highlight.end)
      && highlight.start >= 0
      && highlight.end > highlight.start
      && highlight.end <= passage.text.length)
    .sort((a, b) => a.start - b.start);

  let output = '';
  let cursor = 0;
  highlights.forEach(highlight => {
    // Ignore overlapping or stale ranges so a damaged highlight cannot break the reading text.
    if (highlight.start < cursor) return;
    output += renderSelectableText(passage.text.slice(cursor, highlight.start), cursor);
    output += `<mark data-id="${escapeHtml(highlight.id)}" role="button" tabindex="0" aria-label="Edit saved expression: ${escapeHtml(highlight.phrase)}" title="Tap to edit this saved expression">${renderSelectableText(passage.text.slice(highlight.start, highlight.end), highlight.start, true)}</mark>`;
    cursor = highlight.end;
  });
  output += renderSelectableText(passage.text.slice(cursor), cursor);
  $('readingText').innerHTML = output;
}

function render() {
  const passage = activePassage();
  syncFarsiControls();
  syncLiveTranslationControls();
  syncSelectionMode();
  $('passageTotal').textContent = `(${state.passages.length})`;
  $('passageSelect').innerHTML = state.passages.length
    ? state.passages.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('')
    : '<option value="">No saved passages</option>';
  $('passageSelect').value = passage?.id || '';
  $('passageSelect').disabled = !passage;
  $('tapWordsMode').disabled = !passage;
  $('nativeSelectionMode').disabled = !passage;
  $('passageList').innerHTML = state.passages.length
    ? state.passages.map(item => `<button class="passage-item ${item.id === passage?.id ? 'active' : ''}" type="button" data-passage="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><span>${item.highlights.length} saved · ${countWords(item.text)} words</span></button>`).join('')
    : '<p class="passage-list-empty">No passages yet. Create one to get started.</p>';

  const savedCount = state.passages.reduce((total, item) => total + item.highlights.filter(highlight => !highlight.learned).length, 0);
  $('navCount').textContent = savedCount;
  $('verbNavCount').textContent = state.verbs.filter(verb => !verb.learned).length;
  $('clearHighlights').disabled = !passage || !passage.highlights.length;
  $('passageMenuToggle').disabled = !passage;
  $('editPassageBtn').disabled = !passage;
  resetSelectionHint();

  if (!passage) {
    $('passageTitle').textContent = 'No passage selected';
    $('reviewEyebrow').textContent = 'NO PASSAGE SELECTED';
    $('wordCount').textContent = '0 words';
    $('highlightCount').textContent = '0 saved';
    $('selectionHint').hidden = true;
    $('readingText').innerHTML = '<div class="reader-empty"><h2>Your reading space is ready.</h2><p>Create a passage to start reading and saving words.</p><button class="primary-button" type="button" data-action="new-passage">Create a passage</button></div>';
    closePassageMenu();
    renderReview();
    save();
    return;
  }

  $('selectionHint').hidden = false;
  $('passageTitle').textContent = passage.title;
  $('reviewEyebrow').textContent = passage.title.toUpperCase();
  $('wordCount').textContent = `${countWords(passage.text)} words`;
  renderPassageText(passage);

  const activeHighlights = passage.highlights.filter(highlight => !highlight.learned);
  $('highlightCount').textContent = `${activeHighlights.length} saved`;
  renderReview();
  save();
  if (state.settings.liveTranslationEnabled) scheduleLiveTranslationRender();
}

const CARD_DIRECTIONS = ['es-en', 'en-es'];
const CORRECT_ANSWERS_TO_LEARN = 5;

function correctCount(highlight, direction) {
  const value = highlight.cards?.[direction] ?? (direction === 'es-en' ? highlight.correct : 0);
  return Math.max(0, Number(value) || 0);
}

function makeQueue(available) {
  // Put each direction across all words before returning to the other direction.
  return CARD_DIRECTIONS.flatMap(direction => available
    .filter(highlight => correctCount(highlight, direction) < CORRECT_ANSWERS_TO_LEARN)
    .map(highlight => `${highlight.id}-${direction}`));
}

function findCard(id) {
  if (typeof id !== 'string') return null;
  const passage = activePassage();
  if (!passage) return null;
  const highlight = passage.highlights.find(item => id.startsWith(`${item.id}-`));
  return highlight
    ? { h: highlight, direction: id.endsWith('en-es') ? 'en-es' : 'es-en' }
    : null;
}

function syncQueue() {
  const passage = activePassage();
  if (!passage) {
    state.queue = [];
    state.repeatQueue = [];
    return { available: [], valid: [] };
  }

  passage.highlights.forEach(highlight => {
    if (CARD_DIRECTIONS.every(direction => correctCount(highlight, direction) >= CORRECT_ANSWERS_TO_LEARN)) {
      highlight.learned = true;
    }
  });
  const available = passage.highlights.filter(highlight => !highlight.learned);
  const valid = makeQueue(available);
  const validIds = new Set(valid);
  const queued = new Set();
  const currentQueue = Array.isArray(state.queue) ? state.queue : [];
  const repeatQueue = Array.isArray(state.repeatQueue) ? state.repeatQueue : [];

  state.queue = currentQueue.filter(id => {
    if (!validIds.has(id) || queued.has(id)) return false;
    queued.add(id);
    return true;
  });
  state.repeatQueue = repeatQueue.filter(id => {
    if (!validIds.has(id) || queued.has(id)) return false;
    queued.add(id);
    return true;
  });
  // Keep any new or previously missing cards in the current pass.
  state.queue.push(...valid.filter(id => !queued.has(id)));
  if (!state.queue.length && state.repeatQueue.length) {
    state.queue = state.repeatQueue;
    state.repeatQueue = [];
    state.round = (state.round || 1) + 1;
  }
  return { available, valid };
}

function prioritizeNextWord(previousHighlightId) {
  const isAnotherWord = id => findCard(id)?.h.id !== previousHighlightId;
  let nextIndex = state.queue.findIndex(isAnotherWord);
  if (nextIndex >= 0) {
    if (nextIndex > 0) state.queue.unshift(state.queue.splice(nextIndex, 1)[0]);
    return;
  }
  if (state.repeatQueue.some(isAnotherWord)) {
    // Start the next pass early rather than showing the same word back-to-back.
    state.queue = [...state.repeatQueue, ...state.queue];
    state.repeatQueue = [];
    state.round = (state.round || 1) + 1;
    nextIndex = state.queue.findIndex(isAnotherWord);
    if (nextIndex > 0) state.queue.unshift(state.queue.splice(nextIndex, 1)[0]);
  }
}

function renderVerbDetails(details) {
  if (!Array.isArray(details) || !details.length) return '';
  return `<section class="verb-details" aria-label="Verb form details"><p class="verb-details-title">✦ VERB FORM</p>${details.map(detail => `<article class="verb-detail-card"><p class="verb-form-line">Selected form: <strong>${escapeHtml(detail.form)}</strong></p><dl><div><dt>Infinitive</dt><dd>${escapeHtml(detail.infinitive)}</dd></div><div><dt>Tense</dt><dd>${escapeHtml(detail.tense)}</dd></div><div><dt>Person</dt><dd>${escapeHtml(detail.person)}</dd></div><div><dt>Stem</dt><dd><code>${escapeHtml(detail.stem)}</code></dd></div><div><dt>Present · yo</dt><dd>${escapeHtml(detail.presentYo)}</dd></div></dl></article>`).join('')}</section>`;
}

function renderFlashcardTranslations(highlight) {
  const english = String(highlight.translation || '').trim();
  const farsi = String(highlight.translationFa || suggestFarsiTranslation(highlight.phrase) || '').trim();
  const isFarsiEnabled = state.settings.farsiEnabled;
  const farsiMarkup = isFarsiEnabled
    ? `<div class="translation-language farsi-translation" lang="fa" dir="rtl"><b>Farsi · فارسی</b><span>${escapeHtml(farsi || 'ترجمهٔ فارسی هنوز اضافه نشده است.')}</span></div>`
    : '';
  const missingFarsi = isFarsiEnabled && !farsi;
  const needsEnglish = !english;
  const helpButton = `<button class="translation-edit-action" type="button" data-action="edit-highlight" data-highlight="${escapeHtml(highlight.id)}">${needsEnglish ? 'Add English translation' : (missingFarsi ? 'Add Farsi translation' : 'Edit translations & notes')}</button>`;
  return `<section class="translation-pair ${isFarsiEnabled ? 'with-farsi' : ''}" aria-label="Translations"><div class="translation-language" lang="en"><b>English</b><span>${escapeHtml(english || 'Full translation not added yet.')}</span></div>${farsiMarkup}</section>${helpButton}`;
}

function renderFlashcardAnswer(highlight, direction, verbDetails) {
  const parts = [];
  if (direction === 'en-es') {
    parts.push(`<div class="answer-copy"><b>Spanish expression</b><span lang="es">${escapeHtml(highlight.phrase)}</span></div>`);
  }
  parts.push(renderFlashcardTranslations(highlight));
  if (highlight.explanation) parts.push(`<div class="answer-note"><b>Your note</b><span>${escapeHtml(highlight.explanation)}</span></div>`);
  parts.push(renderVerbDetails(verbDetails));
  return parts.join('');
}

function renderReview() {
  const passage = activePassage();
  const card = $('flashcard');
  if (!passage) {
    $('queueLabel').textContent = '0 cards left this round';
    $('roundLabel').textContent = `ROUND ${state.round || 1}`;
    $('roundProgress').style.width = '0%';
    $('learnedFraction').textContent = '0 / 0 learned';
    $('learnedProgress').style.width = '0%';
    $('reviewStatus').textContent = 'Create a passage to start reviewing';
    card.className = 'flashcard empty';
    card.innerHTML = '<div class="empty-state"><div class="empty-icon">✦</div><h2>Your review is ready.</h2><p>Create a passage, then save words as you read.</p><button class="primary-button" type="button" data-action="new-passage">Create a passage</button></div>';
    $('answerActions').style.display = 'none';
    return;
  }

  const { available, valid } = syncQueue();
  const current = findCard(state.queue[0]);
  const translationIsRevealed = current && revealedCardId === state.queue[0];
  $('queueLabel').textContent = `${state.queue.length} cards left this round`;
  $('roundLabel').textContent = `ROUND ${state.round || 1}`;
  const cardsThisRound = state.queue.length + state.repeatQueue.length;
  $('roundProgress').style.width = cardsThisRound ? `${state.repeatQueue.length / cardsThisRound * 100}%` : '0%';
  const learned = passage.highlights.filter(highlight => highlight.learned).length;
  $('learnedFraction').textContent = `${learned} / ${passage.highlights.length} learned`;
  $('learnedProgress').style.width = passage.highlights.length ? `${learned / passage.highlights.length * 100}%` : '0%';
  $('reviewStatus').textContent = passage.highlights.length
    ? (available.length ? `${available.length} words · ${valid.length} card directions in progress` : 'Everything is learned — lovely work!')
    : 'Add highlights to start reviewing';

  if (current) {
    const highlight = current.h;
    const hasEnglishTranslation = Boolean(String(highlight.translation || '').trim());
    const front = current.direction === 'es-en'
      ? highlight.phrase
      : (hasEnglishTranslation ? highlight.translation : 'Translation needed');
    const label = hasEnglishTranslation
      ? (current.direction === 'es-en' ? 'SPANISH → ENGLISH' : 'ENGLISH → SPANISH')
      : 'FULL TRANSLATION NEEDED';
    const count = correctCount(highlight, current.direction);
    const verbDetails = Array.isArray(highlight.verbDetails)
      ? highlight.verbDetails
      : (typeof window.analyzeSpanishVerbs === 'function'
        ? window.analyzeSpanishVerbs(highlight.phrase, passage.text, highlight.start)
        : []);
    highlight.verbDetails = verbDetails;
    const revealLabel = translationIsRevealed
      ? 'Hide answer'
      : (state.settings.farsiEnabled && verbDetails.length
        ? 'Show answer + Farsi + verb info'
        : (state.settings.farsiEnabled
          ? 'Show answer + Farsi'
          : (verbDetails.length ? 'Show answer & verb info' : 'Show translation')));
    card.className = 'flashcard';
    card.innerHTML = `<div class="card-content"><p class="card-label">${label}</p><h2 class="card-word">${escapeHtml(front)}</h2><button class="reveal-button" type="button" data-action="toggle-translation" aria-controls="cardReveal" aria-expanded="${Boolean(translationIsRevealed)}">${revealLabel}</button><div class="card-reveal" id="cardReveal"${translationIsRevealed ? '' : ' hidden'}>${renderFlashcardAnswer(highlight, current.direction, verbDetails)}</div><p class="card-label" style="margin-top:22px">${count} of ${CORRECT_ANSWERS_TO_LEARN} correct · ${current.direction === 'es-en' ? 'Card 1 of 2' : 'Card 2 of 2'}</p></div>`;
    $('answerActions').style.display = 'grid';
  } else {
    card.className = 'flashcard empty';
    card.innerHTML = `<div class="empty-state"><div class="empty-icon">✦</div><h2>${passage.highlights.length ? 'Your review is clear.' : 'Nothing saved yet.'}</h2><p>${passage.highlights.length ? 'You made it through every card in this passage.' : 'Highlight a word while reading and it will appear here.'}</p><button class="primary-button" type="button" data-view="reader">${passage.highlights.length ? 'Keep reading' : 'Go to reader'}</button></div>`;
    $('answerActions').style.display = 'none';
  }
}

/* --- Verb flashcards ------------------------------------------------------
 * Saving an expression that contains a verb from the app's verb memory also
 * creates a card in the Verbs section, where only verbs and their forms are
 * practised. A regular verb card carries the to-be (infinitive) form plus the
 * first person present and past. An irregular verb card carries the present
 * and the past for every person. */
const VERB_CARD_DIRECTIONS = ['conjugate', 'identify'];

function verbBank() {
  return typeof window.spanishVerbBank === 'object' && window.spanishVerbBank ? window.spanishVerbBank : null;
}

function ensureVerbState() {
  if (!Array.isArray(state.verbs)) state.verbs = [];
  if (!Array.isArray(state.customVerbs)) state.customVerbs = [];
  if (!state.customVerbGlosses || typeof state.customVerbGlosses !== 'object' || Array.isArray(state.customVerbGlosses)) state.customVerbGlosses = {};
  Object.keys(state.customVerbGlosses).forEach(lemma => {
    const gloss = String(state.customVerbGlosses[lemma] || '').trim();
    if (gloss) state.customVerbGlosses[lemma] = gloss;
    else delete state.customVerbGlosses[lemma];
  });
  if (!Array.isArray(state.verbQueue)) state.verbQueue = [];
  if (!Array.isArray(state.verbRepeatQueue)) state.verbRepeatQueue = [];
  state.verbRound = Number(state.verbRound) || 1;
  state.verbs = state.verbs.filter(verb => verb && typeof verb.lemma === 'string' && verb.lemma);
  state.verbs.forEach(verb => {
    verb.id = typeof verb.id === 'string' && verb.id ? verb.id : `v${Math.random().toString(36).slice(2, 9)}`;
    verb.cards = verb.cards && typeof verb.cards === 'object' ? verb.cards : {};
    verb.sources = Array.isArray(verb.sources) ? verb.sources : [];
    verb.learned = verb.learned === true;
  });
  state.customVerbs = state.customVerbs.filter(lemma => typeof lemma === 'string' && lemma);
}

function verbEntry(lemma) {
  const bank = verbBank();
  return bank ? bank.get(lemma) : null;
}

function verbCorrectCount(verb, direction) {
  return Math.max(0, Number(verb.cards?.[direction]) || 0);
}

function upsertVerbCard(lemma, source) {
  const entry = verbEntry(lemma);
  if (!entry) return null;
  const key = entry.infinitive;
  const existing = state.verbs.find(verb => verb.lemma === key);
  if (existing) {
    existing.regular = entry.regular;
    if (source && !existing.sources.some(item => item.highlightId === source.highlightId)) existing.sources.push(source);
    return { verb: existing, added: false };
  }
  const verb = {
    id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    lemma: key,
    regular: entry.regular,
    sources: source ? [source] : [],
    manual: !source,
    cards: { conjugate: 0, identify: 0 },
    learned: false
  };
  state.verbs.push(verb);
  return { verb, added: true };
}

// Which verbs of the memory does this saved expression contain?
function syncVerbCardsForHighlight(passage, highlight) {
  const bank = verbBank();
  if (!bank || !passage || !highlight) return [];
  const added = [];
  bank.matchText(highlight.phrase, passage.text, highlight.start).forEach(entry => {
    const result = upsertVerbCard(entry.infinitive, {
      passageId: passage.id,
      highlightId: highlight.id,
      phrase: highlight.phrase
    });
    if (result?.added) added.push(entry.infinitive);
  });
  return added;
}

// Backfill: expressions saved before the Verbs section existed still count.
function hydrateVerbCards() {
  const bank = verbBank();
  if (!bank) return;
  state.customVerbs.forEach(lemma => bank.add(lemma));
  state.passages.forEach(passage => passage.highlights.forEach(highlight => syncVerbCardsForHighlight(passage, highlight)));
  // Cards whose verb left the memory (for example a cleared custom verb) are dropped.
  state.verbs = state.verbs.filter(verb => Boolean(verbEntry(verb.lemma)));
  ensureVerbState();
}

function makeVerbQueue(available) {
  return VERB_CARD_DIRECTIONS.flatMap(direction => available
    .filter(verb => verbCorrectCount(verb, direction) < CORRECT_ANSWERS_TO_LEARN)
    .map(verb => `${verb.id}-${direction}`));
}

function findVerbCard(id) {
  if (typeof id !== 'string') return null;
  const verb = state.verbs.find(item => id.startsWith(`${item.id}-`));
  return verb ? { verb, direction: id.endsWith('identify') ? 'identify' : 'conjugate' } : null;
}

function syncVerbQueue() {
  state.verbs.forEach(verb => {
    if (VERB_CARD_DIRECTIONS.every(direction => verbCorrectCount(verb, direction) >= CORRECT_ANSWERS_TO_LEARN)) verb.learned = true;
  });
  const available = state.verbs.filter(verb => !verb.learned);
  const valid = makeVerbQueue(available);
  const validIds = new Set(valid);
  const queued = new Set();
  state.verbQueue = state.verbQueue.filter(id => {
    if (!validIds.has(id) || queued.has(id)) return false;
    queued.add(id);
    return true;
  });
  state.verbRepeatQueue = state.verbRepeatQueue.filter(id => {
    if (!validIds.has(id) || queued.has(id)) return false;
    queued.add(id);
    return true;
  });
  state.verbQueue.push(...valid.filter(id => !queued.has(id)));
  if (!state.verbQueue.length && state.verbRepeatQueue.length) {
    state.verbQueue = state.verbRepeatQueue;
    state.verbRepeatQueue = [];
    state.verbRound = (state.verbRound || 1) + 1;
  }
  return { available, valid };
}

function prioritizeNextVerb(previousVerbId) {
  const isAnotherVerb = id => findVerbCard(id)?.verb.id !== previousVerbId;
  let nextIndex = state.verbQueue.findIndex(isAnotherVerb);
  if (nextIndex > 0) state.verbQueue.unshift(state.verbQueue.splice(nextIndex, 1)[0]);
}

function verbGloss(lemma) {
  const key = String(lemma || '').trim();
  const base = key.replace(/se$/, '');
  // Vetted built-in meanings always win. Reader-supplied glosses are reserved
  // for genuinely custom verbs, not used to replace the reviewed verb bank.
  const reviewedGloss = verbInfinitiveEn[key] || verbInfinitiveEn[base];
  if (reviewedGloss) return String(reviewedGloss).trim();
  const readerGloss = String(state.customVerbGlosses?.[key] || '').trim();
  const baseReaderGloss = String(state.customVerbGlosses?.[base] || '').trim();
  if (readerGloss) return readerGloss;
  if (baseReaderGloss) return baseReaderGloss;
  // Never borrow a noun/adjective gloss for a verb that happens to have the
  // same spelling.
  return '';
}

// The form shown on a “which verb is this?” card. Stable inside a round, but
// it moves on each round so every person gets practised.
function verbPracticeForm(entry) {
  const bank = verbBank();
  const persons = bank ? bank.personLabels : [];
  const pool = entry.regular
    ? [{ form: entry.present[0], label: 'Present · yo' }, { form: entry.preterite[0], label: 'Past · preterite · yo' }]
    : persons.flatMap((person, index) => [
      { form: entry.present[index], label: `Present · ${person}` },
      { form: entry.preterite[index], label: `Past · preterite · ${person}` }
    ]);
  if (!pool.length) return { form: entry.infinitive, label: 'Infinitive' };
  return pool[(Math.max(1, state.verbRound || 1) - 1) % pool.length];
}

function verbTableMarkup(entry) {
  const bank = verbBank();
  const persons = bank ? bank.personLabels : [];
  const rows = entry.regular
    ? [['yo', entry.present[0], entry.preterite[0]]]
    : persons.map((person, index) => [person, entry.present[index], entry.preterite[index]]);
  const body = rows.map(([person, present, past]) => `<tr><th scope="row">${escapeHtml(person)}</th><td lang="es">${escapeHtml(present)}</td><td lang="es">${escapeHtml(past)}</td></tr>`).join('');
  const caption = entry.regular
    ? 'Regular verb · the other persons follow from these.'
    : `Irregular verb · ${entry.irregularIn.length ? entry.irregularIn.join(' and ') : 'present and past'} break the pattern.`;
  const extra = entry.otherIrregular.length
    ? `<p class="verb-table-extra">Also irregular: ${escapeHtml(entry.otherIrregular.join(', '))}.</p>`
    : '';
  return `<div class="verb-table-wrap"><table class="verb-table"><caption>${escapeHtml(caption)}</caption><thead><tr><th scope="col">Person</th><th scope="col">Present</th><th scope="col">Past · preterite</th></tr></thead><tbody><tr class="verb-infinitive-row"><th scope="row">To-be form</th><td colspan="2" lang="es">${escapeHtml(entry.infinitive)}</td></tr>${body}</tbody></table>${extra}</div>`;
}

function renderVerbMemory() {
  const bank = verbBank();
  $('verbMemoryCount').textContent = bank ? `${bank.size()} verbs in memory` : '';
  const inProgress = state.verbs.filter(verb => !verb.learned);
  const learned = state.verbs.length - inProgress.length;
  $('verbLearnedFraction').textContent = `${learned} / ${state.verbs.length} learned`;
  $('verbLearnedProgress').style.width = state.verbs.length ? `${learned / state.verbs.length * 100}%` : '0%';
  $('verbMemoryList').innerHTML = state.verbs.length
    ? state.verbs
      .slice()
      .sort((a, b) => (a.learned === b.learned ? a.lemma.localeCompare(b.lemma, 'es') : a.learned ? 1 : -1))
      .map(verb => `<li class="verb-memory-item ${verb.learned ? 'learned' : ''}"><button class="verb-memory-button" type="button" data-verb-focus="${escapeHtml(verb.id)}"><strong lang="es">${escapeHtml(verb.lemma)}</strong><span>${verb.regular ? 'regular' : 'irregular'} · ${verbCorrectCount(verb, 'conjugate') + verbCorrectCount(verb, 'identify')} of ${CORRECT_ANSWERS_TO_LEARN * 2}</span></button><button class="verb-memory-remove" type="button" data-verb-remove="${escapeHtml(verb.id)}" aria-label="Remove ${escapeHtml(verb.lemma)}">×</button></li>`)
      .join('')
    : '<p class="translation-helper">No verb cards yet. Save an expression that contains a known verb and it appears here.</p>';
}

function renderVerbs() {
  ensureVerbState();
  const card = $('verbCard');
  const { available, valid } = syncVerbQueue();
  const current = findVerbCard(state.verbQueue[0]);
  const revealed = current && revealedVerbCardId === state.verbQueue[0];

  $('verbRoundLabel').textContent = `ROUND ${state.verbRound || 1}`;
  $('verbQueueLabel').textContent = `${state.verbQueue.length} verb cards left this round`;
  const cardsThisRound = state.verbQueue.length + state.verbRepeatQueue.length;
  $('verbRoundProgress').style.width = cardsThisRound ? `${state.verbRepeatQueue.length / cardsThisRound * 100}%` : '0%';
  $('verbNavCount').textContent = available.length;
  $('verbStatus').textContent = state.verbs.length
    ? (available.length ? `${available.length} verbs in progress · ${valid.length} cards` : 'Every verb card is learned — lovely work!')
    : 'Save an expression containing a verb to start';

  if (!current) {
    card.className = 'flashcard empty';
    card.innerHTML = `<div class="empty-state"><div class="empty-icon">✦</div><h2>${state.verbs.length ? 'Your verb practice is clear.' : 'No verbs here yet.'}</h2><p>${state.verbs.length ? 'Every saved verb has been practised five times in both directions.' : 'Save a word or phrase while reading. If it contains a known verb, a verb card appears here.'}</p><button class="primary-button" type="button" data-view="reader">Go to reader</button></div>`;
    $('verbAnswerActions').style.display = 'none';
    renderVerbMemory();
    save();
    return;
  }

  const { verb, direction } = current;
  const entry = verbEntry(verb.lemma);
  if (!entry) {
    state.verbs = state.verbs.filter(item => item.id !== verb.id);
    renderVerbs();
    return;
  }
  const gloss = verbGloss(entry.infinitive);
  const kind = entry.regular ? 'REGULAR VERB' : 'IRREGULAR VERB';
  const practice = direction === 'identify' ? verbPracticeForm(entry) : null;
  const front = direction === 'identify' ? practice.form : entry.infinitive;
  const label = direction === 'identify'
    ? `WHICH VERB IS THIS? · ${practice.label.toUpperCase()}`
    : `CONJUGATE · ${kind}`;
  const prompt = direction === 'identify'
    ? 'Name the infinitive, then recall the other forms.'
    : (entry.regular ? 'To-be form, then present and past for yo.' : 'Present and past for every person.');
  const count = verbCorrectCount(verb, direction);
  const englishMeaning = gloss || 'English gloss not available for this custom verb.';
  const answer = `<div class="answer-copy verb-answer"><b lang="en">${escapeHtml(englishMeaning)}</b><span>Spanish infinitive: <span lang="es">${escapeHtml(entry.infinitive)}</span> · ${escapeHtml(kind.toLowerCase())}</span></div>${verbTableMarkup(entry)}`;
  const revealLabel = revealed ? 'Hide answer' : (direction === 'identify' ? 'Show the verb' : 'Show the forms');

  card.className = 'flashcard verb-flashcard';
  card.innerHTML = `<div class="card-content"><p class="card-label">${escapeHtml(label)}</p><h2 class="card-word" lang="es">${escapeHtml(front)}</h2><p class="verb-prompt">${escapeHtml(direction === 'identify' ? prompt : (gloss || prompt))}</p><button class="reveal-button" type="button" data-verb-action="toggle" aria-controls="verbReveal" aria-expanded="${Boolean(revealed)}">${revealLabel}</button><div class="card-reveal verb-card-reveal" id="verbReveal"${revealed ? '' : ' hidden'}>${answer}</div><p class="card-label" style="margin-top:18px">${count} of ${CORRECT_ANSWERS_TO_LEARN} correct · ${direction === 'conjugate' ? 'Card 1 of 2' : 'Card 2 of 2'}</p></div>`;
  $('verbAnswerActions').style.display = 'grid';
  renderVerbMemory();
  save();
}

/* --- Curated Spanish-to-English/Farsi dictionaries and translation engine --- */
const miniDictionary = {
  cuando: 'when', llegué: 'I arrived', llegue: 'arrive (present subjunctive)', casa: 'house', abuela: 'grandmother', puerta: 'door', entreabierta: 'ajar',
  entré: 'I entered', despacio: 'slowly', dejé: 'I left', deje: 'leave / let (present subjunctive)', mochila: 'backpack', junto: 'next to / together', perchero: 'coat rack',
  cocina: 'kitchen', llegaba: 'was arriving / used to arrive', olor: 'smell', delicioso: 'delicious', canela: 'cinnamon',
  pan: 'bread', recién: 'freshly / just', recien: 'freshly', horneado: 'baked', preguntó: 'asked', pregunto: 'I ask', levantar: 'to lift / to raise',
  vista: 'sight / view', masa: 'dough', senté: 'I seated someone/something', sente: 'seat (present subjunctive)', lado: 'side', conté: 'I told / counted', conte: 'count / tell (present subjunctive)', pasado: 'past / passed',
  durante: 'during', viaje: 'trip / travel', afuera: 'outside', tarde: 'afternoon / late', desvanecía: 'was fading / used to fade', lentamente: 'slowly',
  tiempo: 'time / weather', parecía: 'seemed', haberse: '', detenido: 'stopped', cariño: 'darling / affection',
  // Pronouns and common words - expanded
  yo: 'I', tú: 'you (informal)', tu: 'your', usted: 'you (formal)', el: 'the (masculine singular article)', él: 'he', ella: 'she', ello: 'it', nosotros: 'we', nosotras: 'we (fem)', vosotros: 'you (plural informal)', ellos: 'they (masc)', ellas: 'they (fem)', ustedes: 'you (plural formal)',
  me: 'me / to me', te: 'you / to you', se: 'himself/herself/itself/themselves / reflexive-impersonal marker', nos: 'us / to us', os: 'you / to you (plural)', le: 'to him/her/you (indirect)', les: 'to them', lo: 'him / it (masc direct)', la: 'her / it (fem) / the (fem)', los: 'them (masc) / the (masc plural)', las: 'them (fem) / the (fem plural)',
  mi: 'my', mí: 'me (after a preposition)', mis: 'my (plural)', su: 'his/her/their/your', sus: 'his/her/their (plural)', nuestro: 'our', nuestra: 'our (fem)', vuestro: 'your (plural)',
  este: 'this (masc)', esta: 'this (fem)', estos: 'these (masc)', estas: 'these (fem)', ese: 'that (masc)', esa: 'that (fem)', esos: 'those (masc)', esas: 'those (fem)', aquel: 'that (far masc)', aquella: 'that (far fem)', esto: 'this (neuter)', eso: 'that (neuter)', aquello: 'that (far neuter)',
  // Articles
  un: 'a / an (masc)', una: 'a / an (fem)', unos: 'some (masc)', unas: 'some (fem)',
  // Prepositions
  a: 'to / at', ante: 'before / in front of', bajo: 'I go down / I lower; under / low / short', con: 'with', contra: 'against', de: 'of / from', desde: 'from / since', en: 'in / on', entre: 'between / among / enter (present subjunctive)', hacia: 'toward', hasta: 'until / up to', para: 'for / in order to', por: 'for / by / through / because of', según: 'according to', segun: 'according to', sin: 'without', sobre: 'about / on / over', tras: 'after / behind', al: 'to the (a+el)', del: 'of the (de+el)',
  // Conjunctions
  y: 'and', e: 'and (before i-)', o: 'or', u: 'or (before o-)', pero: 'but', sino: 'but rather', porque: 'because', que: 'that / which / what', aunque: 'although', si: 'if', ni: 'nor / neither', pues: 'then / well',
  // Adverbs and common
  muy: 'very', mucho: 'much / a lot', muchos: 'many (masc)', muchas: 'many (fem)', poco: 'little / few', bastante: 'quite / enough', más: 'more', mas: 'but', menos: 'less', bien: 'well', mal: 'badly', mejor: 'better / best', peor: 'worse / worst', aquí: 'here', aqui: 'here', allí: 'there', alli: 'there', ahí: 'there (near you)', ahi: 'there', ahora: 'now', luego: 'then / later', después: 'after / later', despues: 'after', antes: 'before', siempre: 'always', nunca: 'never', jamás: 'never / ever', jamas: 'never', también: 'also / too', tambien: 'also', tampoco: 'neither', todavía: 'still / yet', todavia: 'still', aún: 'still / yet / even', aun: 'even', ya: 'already', solo: 'only / alone', sólo: 'only', así: 'like this / thus', asi: 'thus', entonces: 'then / so', hoy: 'today', ayer: 'yesterday', mañana: 'tomorrow / morning', temprano: 'early', pronto: 'soon', cerca: 'near', lejos: 'far', dentro: 'inside', fuera: 'outside / were or went (imperfect subjunctive of ser/ir)', arriba: 'up / above', abajo: 'down / below', delante: 'in front', detrás: 'behind', detras: 'behind', todo: 'everything / all', todos: 'everyone / all', todas: 'all (fem)', nada: 'nothing', algo: 'something', alguien: 'someone', nadie: 'no one', cada: 'each / every', otro: 'other / another', otra: 'other (fem)', mismo: 'same / self', misma: 'same (fem)', sí: 'yes / oneself (after a preposition)', no: 'no / not', cómo: 'how', cuándo: 'when', donde: 'where', dónde: 'where', porqué: 'reason / why (noun)', qué: 'what',
  // Common nouns, adjectives, verbs base forms without to
  agua: 'water', aire: 'air', bebé: 'baby', amigo: 'friend', amor: 'love', año: 'year', árbol: 'tree', arbol: 'tree', vida: 'life', gente: 'people', hombre: 'man', mujer: 'woman', niño: 'child', niña: 'child (fem)', día: 'day', noche: 'night', semana: 'week', mes: 'month', momento: 'moment', mundo: 'world', mano: 'hand', ojo: 'eye', cabeza: 'head', corazón: 'heart', corazon: 'heart', lugar: 'place', cosa: 'thing', parte: 'part', palabra: 'word', historia: 'story / history', forma: 'form / shape', manera: 'way / manner', caso: 'case', punto: 'point', país: 'country', pais: 'country', ciudad: 'city', calle: 'street', familia: 'family', padre: 'father', madre: 'mother', hijo: 'son / child', hija: 'daughter', hermano: 'brother', hermana: 'sister',
  grande: 'big / large', pequeño: 'small', pequeno: 'small', bueno: 'good', malo: 'bad', nuevo: 'new', viejo: 'old', joven: 'young', largo: 'long', corto: 'short / I cut (cortar)', alto: 'tall / high', feliz: 'happy', triste: 'sad', fácil: 'easy', facil: 'easy', difícil: 'difficult', dificil: 'difficult', importante: 'important', diferente: 'different', cierto: 'certain / true', posible: 'possible', primero: 'first', último: 'last', ultimo: '',
  // Curated verb forms; ambiguous homographs list alternatives instead of guessing context.
  soy: 'I am (ser)', eres: 'you are (ser)', es: 'is / he/she/it is (ser)', somos: 'we are (ser)', son: 'they are / you are (plural) (ser)', estoy: 'I am (estar)', estás: 'you are (estar)', está: 'is (estar) / he/she/it is', estamos: 'we are (estar)', están: 'they are (estar)', tengo: 'I have', tienes: 'you have', tiene: 'has / he/she/it has', tenemos: 'we have', tienen: 'they have', hago: 'I do/make', haces: 'you do/make', hace: 'does/makes / he/she/it does; ago in time expressions', hacemos: 'we do/make', hacen: 'they do/make', hice: 'I did/made (preterite)', hiciste: 'you did/made', hizo: 'he/she/it did/made (preterite of hacer: to do/make)', hicimos: 'we did/made', hicieron: 'they did/made', hecho: 'done/made (past participle of hacer)', haciendo: 'doing/making (gerund of hacer)',
  digo: 'I say', dices: 'you say', dice: 'says / he/she says', decimos: 'we say', dicen: 'they say', dije: 'I said', dijo: 'he/she said', dicho: 'said (participle)',
  voy: 'I go', vas: 'you go', va: 'goes / he/she goes', vamos: 'we go', van: 'they go', fui: 'I was/went', fuiste: 'you were/went', fue: 'was/went (he/she/it)', fuimos: 'we were/went', fueron: 'they were/went',
  veo: 'I see', ves: 'you see', ve: 'he/she sees / see! (tú command of ver) / go! (tú command of ir)', vemos: 'we see', ven: 'they see / see! (ustedes command of ver) / come! (tú command of venir)', vi: 'I saw', vio: 'he/she saw', visto: 'seen',
  doy: 'I give', das: 'you give', da: 'gives', damos: 'we give', dan: 'they give', di: 'I gave / say! (tú command of decir)', dio: 'he/she gave', dado: 'given (participle) / die (noun)',
  sé: 'I know / be! (tú command of ser)', sabes: 'you know', sabe: 'knows / he/she knows', sabemos: 'we know', saben: 'they know', supe: 'I knew (preterite)', supo: 'he/she knew',
  quiero: 'I want/love', quieres: 'you want', quiere: 'wants / he/she wants', queremos: 'we want', quieren: 'they want', quise: 'I wanted (preterite)', quiso: 'he/she wanted',
  puedo: 'I can', puedes: 'you can', puede: 'can / he/she can', podemos: 'we can', pueden: 'they can', pude: 'I could (preterite)', pudo: 'he/she could',
  pongo: 'I put', pones: 'you put', pone: 'puts', ponemos: 'we put', ponen: 'they put', puse: 'I put (preterite)', puso: 'he/she put', puesto: 'put (participle)',
  vengo: 'I come', vienes: 'you come', viene: 'comes', venimos: 'we come', vienen: 'they come', vine: 'I came', vino: 'he/she came / wine', venido: 'come (participle)',
  salgo: 'I go out', sales: 'you go out', sale: 'goes out / leaves', salimos: 'we go out', salen: 'they go out', salí: 'I went out', salió: 'he/she went out',
  conozco: 'I know (person/place)', conoces: 'you know', conoce: 'knows', conocemos: 'we know', conocen: 'they know',
  siento: 'I feel / I seat someone', sientes: 'you feel / seat (subjunctive)', siente: 'he/she feels / seat (subjunctive)', sentimos: 'we feel', sienten: 'they feel / seat (subjunctive)',
  pienso: 'I think', piensas: 'you think', piensa: 'thinks', pensamos: 'we think', piensan: 'they think',
  vuelvo: 'I return', vuelves: 'you return', vuelve: 'returns', volvemos: 'we return', vuelven: 'they return',
  duermo: 'I sleep', duermes: 'you sleep', duerme: 'sleeps', dormimos: 'we sleep', duermen: 'they sleep',
  pido: 'I ask for', pides: 'you ask for', pide: 'asks for', pedimos: 'we ask for', piden: 'they ask for',
  leo: 'I read', lees: 'you read', lee: 'reads', leemos: 'we read', leen: 'they read', leí: 'I read (past)', leyó: 'he/she read',
  escribo: 'I write', escribes: 'you write', escribe: 'writes', escribimos: 'we write', escriben: 'they write', escribí: 'I wrote', escribió: 'he/she wrote', escrito: 'written',
  como: 'I eat / as / like', comes: 'you eat', come: 'eats', comemos: 'we eat', comen: 'they eat', comí: 'I ate', comió: 'he/she ate',
  bebo: 'I drink', bebes: 'you drink', bebe: 'drinks', bebemos: 'we drink', beben: 'they drink', bebí: 'I drank', bebió: 'he/she drank',
  vivo: 'alive / I live', vives: 'you live', vive: 'lives', vivimos: 'we live', viven: 'they live', viví: 'I lived', vivió: 'he/she lived',
  trabajo: 'I work / work / job (noun)', trabajas: 'you work', trabaja: 'works', trabajamos: 'we work', trabajan: 'they work',
  hablo: 'I speak', hablas: 'you speak', habla: 'speaks', hablamos: 'we speak', hablan: 'they speak',
  // Extra common conjugated
  había: 'there was/were / had (imperfect of haber)', hay: 'there is/are', habrá: 'there will be', hubo: 'there was (preterite)', he: 'I have (aux)', has: 'you have (aux)', ha: 'has (aux)', hemos: 'we have (aux)', han: 'they have (aux)',
  era: 'was (imperfect of ser)', eras: 'you were (ser)', éramos: 'we were (ser)', eran: 'they were (ser)',
  estaba: 'was (imperfect of estar)', estabas: 'you were (estar)', estábamos: 'we were (estar)', estaban: 'they were (estar)',
  tenía: 'had / used to have (imperfect)', tenías: 'you had / used to have', teníamos: 'we had / used to have', tenían: 'they had / used to have',
  hacía: 'was doing/making / used to do/make; ago in time expressions', hacías: 'you were doing/making / used to do/make', hacíamos: 'we were doing/making / used to do/make', hacían: 'they were doing/making / used to do/make',
  decía: 'was saying/telling / used to say/tell', decías: 'you were saying/telling / used to say/tell', decíamos: 'we were saying/telling / used to say/tell', decían: 'they were saying/telling / used to say/tell',
  iba: 'was going / used to go', ibas: 'you were going', íbamos: 'we were going', iban: 'they were going',
  veía: 'was seeing / used to see', veías: 'you were seeing / used to see', veíamos: 'we were seeing / used to see', veían: 'they were seeing / used to see',
};

const farsiDictionary = {
  cuando: 'وقتی', llegué: 'رسیدم', llegue: 'برسم / برسد (وجه التزامی)', casa: 'خانه', abuela: 'مادربزرگ', puerta: 'در', entreabierta: 'نیمه‌باز',
  entré: 'وارد شدم', despacio: 'آهسته', dejé: 'گذاشتم', deje: 'بگذارم / بگذارد (وجه التزامی)', mochila: 'کوله‌پشتی', junto: 'کنار / با هم', perchero: 'جالباسی',
  cocina: 'آشپزخانه', llegaba: 'می‌آمد', olor: 'بو', delicioso: 'خوشمزه / دلپذیر', canela: 'دارچین',
  pan: 'نان', recién: 'تازه', recien: 'تازه', horneado: 'پخته‌شده', preguntó: 'پرسید', pregunto: 'می‌پرسم', levantar: 'بلند کردن', bebé: 'نوزاد',
  vista: 'نگاه', masa: 'خمیر', senté: 'نشاندم (کسی را/چیزی را)', sente: 'بنشاند (وجه التزامی)', lado: 'کنار', conté: 'شمردم / تعریف کردم', todo: 'همه‌چیز', pasado: 'گذشته / سپری‌شده', dado: 'داده‌شده / تاس', corto: 'کوتاه / می‌بُرم', bajo: 'پایین می‌روم / پایین می‌آورم؛ زیر / کوتاه', fuera: 'بیرون / باشم یا باشد؛ بروم یا برود (وجه التزامی)',
  durante: 'در طول', viaje: 'سفر', afuera: 'بیرون', tarde: 'عصر / دیر', desvanecía: 'کم‌کم محو می‌شد', lentamente: 'آهسته',
  dentro: 'داخل', tiempo: 'زمان / هوا', parecía: 'به نظر می‌رسید', haberse: '', detenido: 'متوقف', cariño: 'عزیزم / محبت',
  yo: 'من', tú: 'تو', tu: 'مالِ تو (پیش از اسم)', usted: 'شما (مودبانه)', él: 'او (مذکر)', ella: 'او (مونث)', nosotros: 'ما', ellos: 'آنها (مذکر)', ellas: 'آنها (مونث)',
  me: 'مرا / به من', te: 'تو را / به تو', se: 'خودش / علامت مجهول', nos: 'ما را / به ما', os: 'شما را', le: 'به او', les: 'به آنها', lo: 'او را (مذکر)', los: 'آنها را (مذکر)', las: 'آنها را (مونث)',
  mi: 'مالِ من (پیش از اسم)', mí: 'من (پس از حرف اضافه)', su: 'مالِ او / آنها / شما (پیش از اسم)', nuestro: 'مال ما',
  el: '', la: '', un: 'یک', una: 'یک (مونث)',
  a: 'به', de: 'از / مال', en: 'در', con: 'با', por: 'برای / از طریق / به خاطر', para: 'برای', sin: 'بدون', sobre: 'درباره / روی', entre: 'بین / وارد شود (وجه التزامی)', hasta: 'تا', desde: 'از',
  y: 'و', o: 'یا', pero: 'اما', porque: 'چون', que: 'که', si: 'اگر', aunque: 'اگرچه',
  muy: 'خیلی', mucho: 'خیلی', poco: 'کم', más: 'بیشتر', bien: 'خوب', mal: 'بد', aquí: 'اینجا', allí: 'آنجا', ahora: 'الان', siempre: 'همیشه', nunca: 'هرگز', también: 'همچنین', todavía: 'هنوز', todavia: 'هنوز', ya: 'قبلاً', solo: 'فقط / تنها', así: 'اینطور', hoy: 'امروز', mañana: 'فردا / صبح',
  grande: 'بزرگ', pequeño: 'کوچک', bueno: 'خوب', malo: 'بد', nuevo: 'جدید', viejo: 'قدیمی', feliz: 'خوشحال', triste: 'ناراحت', fácil: 'آسان', difícil: 'سخت', importante: 'مهم',
  soy: 'هستم (بودن)', eres: 'هستی', es: 'است', somos: 'هستیم', son: 'هستند', estoy: 'هستم (حالت یا مکان)', está: 'است (حالت یا مکان)', tengo: 'دارم', tiene: 'دارد', hago: 'انجام می‌دهم', hace: 'انجام می‌دهد / پیش (در عبارت‌های زمانی)', hice: 'انجام دادم', hizo: 'انجام داد (او)', hecho: 'انجام شده', digo: 'می‌گویم', dice: 'می‌گوید', dije: 'گفتم', dijo: 'گفت', voy: 'می‌روم', va: 'می‌رود', fui: 'رفتم / بودم', fue: 'رفت / بود', veo: 'می‌بینم', ve: 'می‌بیند / ببین! / برو!', ven: 'می‌بینند / ببینید! / بیا!', vi: 'دیدم', vio: 'دید', doy: 'می‌دهم', da: 'می‌دهد', di: 'دادم', dio: 'داد', sé: 'می‌دانم', sabe: 'می‌داند', quiero: 'می‌خواهم', quiere: 'می‌خواهد', puedo: 'می‌توانم', puede: 'می‌تواند', pongo: 'می‌گذارم', pone: 'می‌گذارد', vengo: 'می‌آیم', viene: 'می‌آید', salgo: 'خارج می‌شوم', sale: 'خارج می‌شود', conozco: 'می‌شناسم', conoce: 'می‌شناسد', parece: 'به نظر می‌رسد', siento: 'احساس می‌کنم / می‌نشانم', pienso: 'فکر می‌کنم', vuelve: 'برمی‌گردد', duerme: 'می‌خوابد', pido: 'درخواست می‌کنم', leo: 'می‌خوانم', escribo: 'می‌نویسم', como: 'می‌خورم (فعل) / مانند، مثل', vivo: 'زنده / زندگی می‌کنم', trabajo: 'کار / کار می‌کنم', hablo: 'صحبت می‌کنم',
  había: 'بود', hay: 'هست', era: 'بود (بودن)', estaba: 'بود (حالت یا مکان)', tenía: 'داشت', hacía: 'انجام می‌داد',
};

/* --- Verb infinitive translations --- */
/* Curated infinitive glosses; absent entries intentionally have no offline meaning. */
const verbInfinitiveEn = {
  "ser": "to be",
  "estar": "to be (state or location)",
  "tener": "to have",
  "hacer": "to do / to make",
  "hacerse": "to become / to make oneself",
  "hacerle": "to do or make something for him/her",
  "decir": "to say / to tell",
  "ir": "to go",
  "irse": "to leave / to go away",
  "ver": "to see",
  "dar": "to give",
  "saber": "to know (a fact or how to do something)",
  "conocer": "to know (a person/place); to be familiar with",
  "querer": "to want / to love",
  "llegar": "to arrive",
  "pasar": "to pass; to happen; to spend (time)",
  "deber": "to owe; should/must (depending on context)",
  "poner": "to put; to place; to set",
  "ponerse": "to put on / to become",
  "parecer": "to seem; to appear",
  "parecerse": "to resemble",
  "quedar": "to stay / to remain / to be left",
  "quedarse": "to stay; to remain",
  "creer": "to believe",
  "hablar": "to speak / to talk",
  "llevar": "to carry; to wear; to take along",
  "dejar": "to leave; to let; to allow",
  "seguir": "to follow; to continue",
  "encontrar": "to find; to come across",
  "encontrarse": "to meet (with); to find oneself",
  "llamar": "to call",
  "llamarse": "to be called",
  "venir": "to come",
  "pensar": "to think",
  "salir": "to go out / to leave",
  "volver": "to return; to come back",
  "volverse": "to become",
  "tomar": "to take / to drink",
  "vivir": "to live",
  "sentir": "to feel",
  "sentirse": "to feel",
  "tratar": "to treat; to try (tratar de + infinitive)",
  "mirar": "to look at; to watch",
  "contar": "to count; to tell (a story)",
  "empezar": "to begin",
  "esperar": "to wait; to hope; to expect",
  "buscar": "to look for / to search",
  "existir": "to exist",
  "entrar": "to enter",
  "trabajar": "to work",
  "escribir": "to write",
  "perder": "to lose",
  "producir": "to produce",
  "ocurrir": "to happen / to occur",
  "entender": "to understand",
  "pedir": "to ask for; to request",
  "recibir": "to receive",
  "recordar": "to remember",
  "terminar": "to finish",
  "permitir": "to allow",
  "aparecer": "to appear",
  "conseguir": "to get; to obtain; to manage to",
  "comenzar": "to begin",
  "servir": "to serve; to be useful",
  "sacar": "to take out; to remove",
  "mantener": "to keep; to maintain",
  "resultar": "to turn out; to result",
  "leer": "to read",
  "caer": "to fall",
  "caerse": "to fall; to fall down",
  "cambiar": "to change",
  "presentar": "to present; to introduce",
  "crear": "to create",
  "abrir": "to open",
  "considerar": "to consider",
  "oír": "to hear",
  "oir": "to hear",
  "acabar": "to finish; to end; to end up",
  "convertir": "to convert; to turn (something into something else)",
  "convertirse": "to become; to turn into",
  "ganar": "to win / to earn",
  "formar": "to form",
  "traer": "to bring",
  "partir": "to split; to depart",
  "morir": "to die",
  "jugar": "to play",
  "preguntar": "to ask",
  "responder": "to answer",
  "aprender": "to learn",
  "comprender": "to understand",
  "correr": "to run",
  "comer": "to eat",
  "beber": "to drink",
  "dormir": "to sleep",
  "dormirse": "to fall asleep",
  "despertar": "to wake (someone) up",
  "despertarse": "to wake up",
  "levantar": "to lift; to raise",
  "levantarse": "to get up; to stand up",
  "sentar": "to seat (someone)",
  "sentarse": "to sit down",
  "acostar": "to lay (someone) down; to put (someone) to bed",
  "acostarse": "to lie down; to go to bed",
  "vestir": "to dress; to clothe (someone)",
  "vestirse": "to get dressed",
  "bañar": "to bathe (someone)",
  "bañarse": "to bathe; to take a bath",
  "ducharse": "to shower; to take a shower",
  "lavar": "to wash",
  "lavarse": "to wash oneself",
  "gustar": "to like (literally, to be pleasing to someone)",
  "encantar": "to love (very much); to delight",
  "faltar": "to be missing; to be lacking",
  "importar": "to matter; to import",
  "interesar": "to interest; to be of interest to",
  "doler": "to hurt; to ache",
  "haber": "to have (auxiliary); there is/are (impersonal hay)",
  "poder": "to be able to; can",
  "andar": "to walk; to go around",
  "valer": "to be worth",
  "caber": "to fit",
  "conducir": "to drive; to lead",
  "traducir": "to translate",
  "construir": "to build",
  "huir": "to flee; to run away",
  "reír": "to laugh",
  "reir": "to laugh",
  "sonreír": "to smile",
  "sonreir": "to smile",
  "freír": "to fry",
  "freir": "to fry",
  "repetir": "to repeat",
  "preferir": "to prefer",
  "mostrar": "to show",
  "probar": "to try; to test; to taste",
  "cerrar": "to close; to shut",
  "mover": "to move",
  "detener": "to stop; to detain",
  "desvanecer": "to make disappear; to dissipate",
  "desvanecerse": "to fade away; to vanish",

  // Remaining built-in verbs recognized by the conjugation bank.
  "abandonar": "to abandon; to leave behind",
  "abrazar": "to hug; to embrace",
  "aburrir": "to bore",
  "aceptar": "to accept",
  "acompañar": "to accompany; to go with",
  "acordar": "to agree; to decide",
  "actuar": "to act; to perform",
  "admirar": "to admire",
  "admitir": "to admit; to accept",
  "adquirir": "to acquire; to obtain",
  "advertir": "to warn; to notice",
  "alcanzar": "to reach; to achieve",
  "almorzar": "to have lunch",
  "alquilar": "to rent; to lease",
  "amar": "to love",
  "animar": "to encourage; to cheer up",
  "anunciar": "to announce; to advertise",
  "apagar": "to turn off; to extinguish",
  "apostar": "to bet; to wager",
  "apoyar": "to support",
  "aprobar": "to approve; to pass (an exam)",
  "aprovechar": "to make use of; to take advantage of",
  "arrastrar": "to drag",
  "arreglar": "to fix; to arrange",
  "asustar": "to scare; to frighten",
  "atacar": "to attack",
  "atender": "to attend to; to serve",
  "atravesar": "to cross; to go through",
  "avanzar": "to move forward; to advance",
  "avisar": "to notify; to let someone know",
  "ayudar": "to help",
  "bailar": "to dance",
  "bajar": "to go down; to lower",
  "barrer": "to sweep",
  "besar": "to kiss",
  "brillar": "to shine",
  "bromear": "to joke",
  "calentar": "to heat; to warm",
  "caminar": "to walk",
  "cantar": "to sing",
  "cargar": "to load; to carry; to charge",
  "cenar": "to have dinner",
  "charlar": "to chat; to talk",
  "chocar": "to collide; to bump into",
  "citar": "to cite; to quote; to make an appointment",
  "cocinar": "to cook",
  "coger": "to take; to grab (usage varies by region)",
  "colocar": "to place; to put",
  "comentar": "to comment",
  "compartir": "to share",
  "competir": "to compete",
  "componer": "to compose; to put together; to repair",
  "comprar": "to buy",
  "confundir": "to confuse; to mix up",
  "congelar": "to freeze",
  "consentir": "to consent; to indulge (someone)",
  "conservar": "to keep; to preserve",
  "contener": "to contain",
  "continuar": "to continue",
  "contribuir": "to contribute",
  "conversar": "to converse; to talk",
  "copiar": "to copy",
  "corregir": "to correct; to fix",
  "cortar": "to cut",
  "coser": "to sew",
  "costar": "to cost; to be difficult",
  "crecer": "to grow",
  "cruzar": "to cross",
  "cubrir": "to cover",
  "cuidar": "to care for; to look after",
  "cumplir": "to fulfill; to complete; to turn (an age)",
  "dañar": "to damage; to harm",
  "decorar": "to decorate",
  "dedicar": "to dedicate; to devote",
  "defender": "to defend",
  "demostrar": "to demonstrate; to show",
  "desarrollar": "to develop",
  "desayunar": "to have breakfast",
  "descansar": "to rest",
  "descender": "to descend; to go down",
  "descubrir": "to discover; to uncover",
  "desear": "to wish; to desire",
  "desordenar": "to disorder; to mess up",
  "despedir": "to dismiss; to fire; to see off",
  "destruir": "to destroy",
  "devolver": "to return; to give back",
  "dibujar": "to draw",
  "dirigir": "to direct; to lead",
  "disfrutar": "to enjoy",
  "disponer": "to arrange; to provide; to have at one's disposal",
  "distribuir": "to distribute",
  "divertir": "to amuse; to entertain",
  "dividir": "to divide",
  "dudar": "to doubt; to hesitate",
  "durar": "to last",
  "echar": "to throw; to put; to cast",
  "educar": "to educate; to raise",
  "elegir": "to choose; to select",
  "empujar": "to push",
  "encender": "to light; to turn on",
  "enfermar": "to become ill; to make someone ill",
  "enfriar": "to cool; to chill",
  "enojar": "to anger; to annoy",
  "ensayar": "to rehearse; to test",
  "enseñar": "to teach; to show",
  "entregar": "to deliver; to hand over",
  "entrenar": "to train",
  "entretener": "to entertain; to keep occupied",
  "enviar": "to send",
  "escapar": "to escape",
  "escoger": "to choose; to select",
  "esconder": "to hide",
  "escuchar": "to listen to; to hear",
  "estudiar": "to study",
  "evitar": "to avoid",
  "examinar": "to examine",
  "exigir": "to demand; to require",
  "explicar": "to explain",
  "exponer": "to expose; to present",
  "extender": "to extend; to spread",
  "extrañar": "to miss (someone); to find strange",
  "fabricar": "to manufacture; to make",
  "fallar": "to fail; to malfunction",
  "felicitar": "to congratulate",
  "fingir": "to pretend; to feign",
  "firmar": "to sign",
  "forzar": "to force",
  "funcionar": "to function; to work",
  "garantizar": "to guarantee",
  "gastar": "to spend; to use up",
  "girar": "to turn; to rotate",
  "gritar": "to shout; to yell",
  "guardar": "to keep; to save; to put away",
  "hallar": "to find",
  "heredar": "to inherit",
  "herir": "to wound; to injure",
  "hervir": "to boil",
  "hornear": "to bake",
  "hospedar": "to host; to lodge",
  "humillar": "to humiliate",
  "hundir": "to sink; to submerge",
  "identificar": "to identify",
  "ignorar": "to ignore; to be unaware of",
  "imaginar": "to imagine",
  "impedir": "to prevent",
  "imponer": "to impose",
  "impresionar": "to impress",
  "imprimir": "to print",
  "incluir": "to include",
  "influir": "to influence",
  "inscribir": "to register; to enroll",
  "insistir": "to insist",
  "inspirar": "to inspire",
  "instalar": "to install",
  "insultar": "to insult",
  "intentar": "to try; to attempt",
  "interpretar": "to interpret; to perform",
  "interrumpir": "to interrupt",
  "intervenir": "to intervene",
  "invertir": "to invest; to reverse",
  "investigar": "to investigate",
  "invitar": "to invite",
  "juzgar": "to judge",
  "lanzar": "to throw; to launch",
  "lastimar": "to hurt; to injure",
  "latir": "to beat; to pulse",
  "liberar": "to free; to release",
  "limitar": "to limit; to restrict",
  "limpiar": "to clean",
  "llorar": "to cry; to weep",
  "mandar": "to send; to order; to command",
  "marcar": "to mark; to dial; to score",
  "medir": "to measure",
  "mejorar": "to improve; to get better",
  "mentir": "to lie (tell an untruth)",
  "merecer": "to deserve",
  "molestar": "to bother; to annoy",
  "montar": "to mount; to assemble; to ride",
  "morder": "to bite",
  "nacer": "to be born",
  "nadar": "to swim",
  "necesitar": "to need",
  "negar": "to deny; to refuse",
  "negociar": "to negotiate",
  "nombrar": "to name; to appoint",
  "notar": "to notice",
  "obedecer": "to obey",
  "observar": "to observe; to watch",
  "obtener": "to obtain; to get",
  "ocupar": "to occupy; to use; to take up",
  "odiar": "to hate",
  "ofrecer": "to offer",
  "oler": "to smell; to smell of",
  "olvidar": "to forget",
  "omitir": "to omit",
  "optar": "to opt; to choose",
  "ordenar": "to order; to arrange",
  "organizar": "to organize",
  "oscurecer": "to darken; to get dark",
  "padecer": "to suffer; to endure",
  "pagar": "to pay",
  "parar": "to stop",
  "pasear": "to stroll; to take a walk",
  "pegar": "to hit; to stick; to glue",
  "peinar": "to comb (hair)",
  "pelear": "to fight; to argue",
  "percibir": "to perceive; to notice",
  "permanecer": "to remain; to stay",
  "perseguir": "to pursue; to chase",
  "pescar": "to fish; to catch fish",
  "picar": "to sting; to chop (food)",
  "pintar": "to paint",
  "planear": "to plan",
  "plantar": "to plant",
  "platicar": "to chat; to talk (especially in Latin America)",
  "poseer": "to possess; to own",
  "posponer": "to postpone",
  "practicar": "to practice",
  "preparar": "to prepare",
  "prestar": "to lend",
  "prevenir": "to prevent; to warn",
  "prohibir": "to prohibit; to forbid",
  "pronunciar": "to pronounce",
  "proponer": "to propose; to suggest",
  "proteger": "to protect",
  "proveer": "to provide; to supply",
  "provocar": "to provoke; to cause",
  "publicar": "to publish",
  "quejar": "to complain (usually used as quejarse)",
  "quemar": "to burn",
  "quitar": "to remove; to take away; to take off",
  "rascar": "to scratch",
  "rayar": "to scratch; to grate",
  "realizar": "to carry out; to perform",
  "reconocer": "to recognize; to acknowledge",
  "reducir": "to reduce",
  "regalar": "to give as a gift",
  "regar": "to water; to irrigate",
  "registrar": "to register; to record; to search",
  "regresar": "to return; to go back",
  "relajar": "to relax; to loosen",
  "rellenar": "to fill; to fill in",
  "remar": "to row",
  "rendir": "to yield; to produce; to perform",
  "rentar": "to rent; to lease (regional usage)",
  "reparar": "to repair; to fix",
  "rescatar": "to rescue",
  "resistir": "to resist; to endure",
  "resolver": "to solve; to resolve",
  "respirar": "to breathe",
  "retener": "to retain; to hold back",
  "retirar": "to withdraw; to remove",
  "retratar": "to portray; to photograph",
  "reunir": "to gather; to bring together",
  "revisar": "to review; to check",
  "rezar": "to pray",
  "rodar": "to roll; to film",
  "rodear": "to surround",
  "romper": "to break",
  "roncar": "to snore",
  "ruborizar": "to make someone blush; to redden",
  "sacudir": "to shake; to dust off",
  "saltar": "to jump; to leap",
  "saludar": "to greet",
  "salvar": "to save; to rescue",
  "sanar": "to heal",
  "sangrar": "to bleed",
  "satisfacer": "to satisfy",
  "secar": "to dry",
  "separar": "to separate",
  "sobrar": "to be left over; to be extra",
  "soler": "to usually do (soler + infinitive)",
  "solicitar": "to request; to apply for",
  "soltar": "to release; to let go",
  "soñar": "to dream",
  "soplar": "to blow",
  "soportar": "to tolerate; to endure",
  "sorprender": "to surprise",
  "sostener": "to hold; to support; to maintain",
  "subir": "to go up; to raise; to upload",
  "subrayar": "to underline",
  "suceder": "to happen; to follow",
  "sufrir": "to suffer",
  "sugerir": "to suggest",
  "sumar": "to add; to sum",
  "suponer": "to suppose; to assume",
  "suspirar": "to sigh",
  "sustituir": "to replace; to substitute",
  "susurrar": "to whisper",
  "tachar": "to cross out; to label as",
  "tapar": "to cover; to block",
  "tardar": "to take time; to delay",
  "tejer": "to weave; to knit",
  "telefonear": "to phone; to call",
  "temer": "to fear; to be afraid of",
  "tender": "to stretch out; to lay out; to hang (laundry)",
  "tirar": "to throw; to throw away; to pull",
  "tocar": "to touch; to play (an instrument); to be someone's turn",
  "toser": "to cough",
  "tragar": "to swallow",
  "traicionar": "to betray",
  "tranquilizar": "to calm; to reassure",
  "transmitir": "to transmit; to broadcast",
  "transportar": "to transport; to carry",
  "trepar": "to climb",
  "triunfar": "to triumph; to succeed",
  "ubicar": "to locate; to place",
  "unir": "to join; to unite",
  "untar": "to spread; to smear",
  "usar": "to use; to wear",
  "vaciar": "to empty; to drain",
  "variar": "to vary; to change",
  "velar": "to watch over; to keep vigil",
  "vencer": "to defeat; to overcome; to expire (a deadline)",
  "vendar": "to bandage; to blindfold",
  "vender": "to sell",
  "vengar": "to avenge",
  "ventilar": "to ventilate; to air out",
  "verificar": "to verify; to check",
  "verter": "to pour; to spill",
  "viajar": "to travel",
  "vigilar": "to watch; to guard",
  "visitar": "to visit",
  "volar": "to fly",
  "vomitar": "to vomit",
  "votar": "to vote",
  "zarpar": "to set sail; to depart",

  // Common pronominal forms whose meaning differs from the base verb.
  "aburrirse": "to get bored",
  "acordarse": "to remember",
  "arrepentirse": "to repent; to regret",
  "divertirse": "to have fun",
  "enfermarse": "to get sick",
  "enojarse": "to get angry",
  "quejarse": "to complain",
};

/* Curated infinitive glosses for verbs used by the built-in flashcard bank. */
const verbInfinitiveFa = {
  "ser": "بودن",
  "estar": "بودن (حالت یا مکان)",
  "tener": "داشتن",
  "hacer": "انجام دادن / ساختن",
  "hacerse": "شدن / خود را ... کردن",
  "hacerle": "کاری برای او انجام دادن",
  "decir": "گفتن",
  "ir": "رفتن",
  "ver": "دیدن",
  "dar": "دادن",
  "saber": "دانستن (حقیقت)",
  "conocer": "شناختن",
  "querer": "خواستن / دوست داشتن",
  "llegar": "رسیدن",
  "pasar": "اتفاق افتادن / گذشتن",
  "poner": "گذاشتن",
  "parecer": "به نظر رسیدن",
  "quedar": "ماندن / باقی ماندن",
  "creer": "باور کردن",
  "hablar": "صحبت کردن",
  "llevar": "حمل کردن / پوشیدن / بردن",
  "dejar": "گذاشتن / اجازه دادن",
  "seguir": "دنبال کردن / ادامه دادن",
  "encontrar": "پیدا کردن",
  "llamar": "صدا زدن",
  "venir": "آمدن",
  "pensar": "فکر کردن",
  "salir": "خارج شدن",
  "volver": "برگشتن",
  "tomar": "گرفتن / نوشیدن",
  "vivir": "زندگی کردن",
  "sentir": "احساس کردن",
  "mirar": "نگاه کردن",
  "contar": "شمردن / تعریف کردن",
  "empezar": "شروع کردن",
  "esperar": "صبر کردن / امیدوار بودن",
  "buscar": "جستجو کردن",
  "entrar": "وارد شدن",
  "trabajar": "کار کردن",
  "escribir": "نوشتن",
  "perder": "گم کردن",
  "entender": "فهمیدن",
  "pedir": "درخواست کردن",
  "recibir": "دریافت کردن",
  "recordar": "به خاطر آوردن",
  "terminar": "تمام کردن",
  "leer": "خواندن",
  "caer": "افتادن",
  "cambiar": "تغییر دادن",
  "abrir": "باز کردن",
  "considerar": "در نظر گرفتن",
  "ganar": "برنده شدن / به دست آوردن",
  "traer": "آوردن",
  "morir": "مردن",
  "jugar": "بازی کردن",
  "preguntar": "پرسیدن",
  "comer": "خوردن",
  "beber": "نوشیدن",
  "dormir": "خوابیدن",
  "despertar": "بیدار کردن",
  "levantar": "بلند کردن",
  "sentarse": "نشستن",
  "acostarse": "به رختخواب رفتن / دراز کشیدن",
  "gustar": "خوش آمدن",
  "haber": "داشتن / وجود داشتن",
  "poder": "توانستن",
  "encontrarse": "با کسی ملاقات کردن / خود را در وضعیتی یافتن",
  "irse": "رفتن / از جایی رفتن",
  "quedarse": "ماندن",
  "sentirse": "احساس کردن",
  "deber": "بدهکار بودن / باید",
  "ponerse": "پوشیدن / شدن",
  "convertir": "تبدیل کردن",
  "convertirse": "تبدیل شدن",
  "despertarse": "از خواب بیدار شدن",
  "levantarse": "بلند شدن / از جا برخاستن",
  "sentar": "نشاندن",
  "acostar": "خواباندن / به رختخواب گذاشتن",
  "vestir": "لباس پوشاندن",
  "vestirse": "لباس پوشیدن",
  "bañar": "حمام دادن",
  "bañarse": "حمام کردن",
  "ducharse": "دوش گرفتن",
  "lavar": "شستن",
  "lavarse": "خود را شستن",
  "dormirse": "به خواب رفتن",
  "desvanecer": "محو کردن / ناپدید کردن",
  "desvanecerse": "محو شدن / از بین رفتن",
};

/* Exact offline word dictionaries */
const comprehensiveEn = (() => {
  const base = {};
  // Start with curated single-word entries, including blank entries for ambiguity.
  Object.assign(base, miniDictionary);
  // Add only exact, curated infinitive keys; never manufacture accentless aliases.
  Object.entries(verbInfinitiveEn).forEach(([es, en]) => {
    if (!base[es]) base[es] = en;
  });
  return base;
})();

const comprehensiveFa = (() => {
  const base = {};
  Object.assign(base, farsiDictionary);
  Object.entries(verbInfinitiveFa).forEach(([es, fa]) => {
    if (!base[es]) base[es] = fa;
  });
  return base;
})();

function normalizeTranslationPhrase(text) {
  return String(text || '')
    .normalize('NFC')
    .toLocaleLowerCase('es')
    .replace(/[¿?¡!.,;:—–…“”‘’\"'()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const phraseTranslations = {
  'la casa de mi abuela': { en: 'my grandmother’s house', fa: 'خانهٔ مادربزرگم' },
  'casa de la abuela': { en: 'grandmother’s house', fa: 'خانهٔ مادربزرگ' },
  'recién horneado': { en: 'freshly baked', fa: 'تازه‌پخته‌شده' },
  'pan recién horneado': { en: 'freshly baked bread', fa: 'نان تازه‌پخته‌شده' },
  'la puerta estaba entreabierta': { en: 'the door was ajar', fa: 'در نیمه‌باز بود' },
  'junto al perchero': { en: 'by the coat rack', fa: 'کنار جالباسی' },
  'olor delicioso a canela y pan recién horneado': {
    en: 'a delicious smell of cinnamon and freshly baked bread',
    fa: 'بوی دل‌انگیز دارچین و نان تازه‌پخته‌شده'
  },
  'todo lo que había pasado durante el viaje': {
    en: 'everything that had happened during the trip',
    fa: 'همهٔ اتفاقاتی که در طول سفر افتاده بود'
  },
  'sin levantar la vista': { en: 'without looking up', fa: 'بدون اینکه نگاهش را بالا بیاورد' },
  'sin levantar la vista de la masa': {
    en: 'without looking up from the dough',
    fa: 'بدون اینکه نگاهش را از خمیر بردارد'
  },
  'eres tú cariño': { en: 'Is that you, sweetheart?', fa: 'خودتی، عزیزم؟' },
  'me senté': { en: 'I sat down', fa: 'نشستم' },
  'me senté a su lado': { en: 'I sat down beside them', fa: 'کنارش نشستم' },
  'se desvanecía lentamente': { en: 'was slowly fading', fa: 'آهسته‌آهسته محو می‌شد' },

  // These reflexive constructions need the following word(s) to establish their meaning.
  'se le hizo tarde': {
    en: 'he/she ran late; it got late for him/her',
    fa: 'برای او دیر شد'
  },
  'se me hizo tarde': { en: 'I ran late; it got late for me', fa: 'برای من دیر شد / دیرم شد' },
  'se te hizo tarde': { en: 'you ran late; it got late for you', fa: 'برای تو دیر شد' },
  'se nos hizo tarde': { en: 'we ran late; it got late for us', fa: 'برای ما دیر شد' },
  'se le hizo difícil': { en: 'he/she found it difficult', fa: 'برای او سخت شد' },
  'se me hizo difícil': { en: 'I found it difficult', fa: 'برای من سخت شد' },
  'se le hizo fácil': { en: 'he/she found it easy', fa: 'برای او آسان شد' },
  'se me hace que': { en: 'it seems to me that', fa: 'به نظرم می‌رسد که' },
  'se le hace que': { en: 'it seems to him/her that', fa: 'به نظر او می‌رسد که' },
  'hacerle': { en: 'to do/make something for him/her', fa: 'کاری برای او انجام دادن' },
  'hacerle caso': { en: 'to pay attention to / listen to him/her', fa: 'به او توجه کردن / به حرفش گوش دادن' },
  'hacerse': { en: 'to become; to make oneself', fa: 'شدن / خود را ... کردن' },
  'se me hace difícil': { en: 'I find it difficult', fa: 'برایم سخت است' },
  'se me hace tarde': { en: 'it is getting late; I am running late', fa: 'دیر شده / دارم دیر می‌کنم' },
  'qué se le va a hacer': { en: 'what can you do? (idiom)', fa: 'چه می‌شود کرد' },
  'se le antojó': { en: 'he/she felt like something; something appealed to him/her', fa: 'دلش چیزی خواست / هوس کرد' },
  'se le ocurrió': { en: 'it occurred to him/her', fa: 'به ذهنش رسید' },
  'se le olvidó': { en: 'he/she forgot it', fa: 'از یادش رفت' },
  'se me olvidó': { en: 'I forgot it', fa: 'از یادم رفت' },

  'cuando llegué a la casa de mi abuela la puerta estaba entreabierta': {
    en: 'When I arrived at my grandmother’s house, the door was ajar.',
    fa: 'وقتی به خانهٔ مادربزرگم رسیدم، در نیمه‌باز بود.'
  },
  'entré despacio y dejé la mochila junto al perchero': {
    en: 'I went in slowly and left my backpack by the coat rack.',
    fa: 'آهسته وارد شدم و کوله‌پشتی‌ام را کنار جالباسی گذاشتم.'
  },
  'desde la cocina llegaba un olor delicioso a canela y pan recién horneado': {
    en: 'A delicious smell of cinnamon and freshly baked bread drifted from the kitchen.',
    fa: 'بوی دل‌انگیز دارچین و نان تازه از آشپزخانه می‌آمد.'
  },
  'eres tú cariño preguntó ella sin levantar la vista de la masa': {
    en: '“Is that you, sweetheart?” she asked without looking up from the dough.',
    fa: '—خودتی، عزیزم؟ او بدون اینکه نگاهش را از خمیر بردارد، پرسید.'
  },
  'me senté a su lado y le conté todo lo que había pasado durante el viaje': {
    en: 'I sat beside her and told her everything that had happened during the trip.',
    fa: 'کنارش نشستم و همهٔ اتفاقاتی را که در طول سفر افتاده بود برایش تعریف کردم.'
  },
  'afuera la tarde se desvanecía lentamente pero dentro de la casa el tiempo parecía haberse detenido': {
    en: 'Outside, the afternoon was slowly fading, but inside the house time seemed to have stopped.',
    fa: 'بیرون، عصر کم‌کم رو به پایان می‌رفت، اما داخل خانه انگار زمان از حرکت ایستاده بود.'
  },
  'cuando llegué a la casa de mi abuela la puerta estaba entreabierta entré despacio y dejé la mochila junto al perchero desde la cocina llegaba un olor delicioso a canela y pan recién horneado eres tú cariño preguntó ella sin levantar la vista de la masa me senté a su lado y le conté todo lo que había pasado durante el viaje afuera la tarde se desvanecía lentamente pero dentro de la casa el tiempo parecía haberse detenido': {
    en: 'When I arrived at my grandmother’s house, the door was ajar. I went in slowly and left my backpack by the coat rack. A delicious smell of cinnamon and freshly baked bread drifted from the kitchen. “Is that you, sweetheart?” she asked without looking up from the dough. I sat beside her and told her everything that had happened during the trip. Outside, the afternoon was slowly fading, but inside the house time seemed to have stopped.',
    fa: 'وقتی به خانهٔ مادربزرگم رسیدم، در نیمه‌باز بود. آهسته وارد شدم و کوله‌پشتی‌ام را کنار جالباسی گذاشتم. بوی دل‌انگیز دارچین و نان تازه از آشپزخانه می‌آمد. —خودتی، عزیزم؟ او بدون اینکه نگاهش را از خمیر بردارد، پرسید. کنارش نشستم و همهٔ اتفاقاتی را که در طول سفر افتاده بود برایش تعریف کردم. بیرون، عصر کم‌کم رو به پایان می‌رفت، اما داخل خانه انگار زمان از حرکت ایستاده بود.'
  }
};
const normalizedPhraseTranslations = new Map(Object.entries(phraseTranslations).map(([phrase, translations]) => [normalizeTranslationPhrase(phrase), translations]));
const offlinePhraseCandidates = [...normalizedPhraseTranslations.entries()]
  .map(([phrase, translations]) => ({ words: phrase.split(' '), translations }))
  .sort((a, b) => b.words.length - a.words.length);

function exactPhraseTranslation(text, language) {
  return normalizedPhraseTranslations.get(normalizeTranslationPhrase(text))?.[language] || '';
}

/* --- Curated offline translation lookup --- */
function offlineTranslateWordDetailed(word, lang) {
  const normalized = normalizeTranslationPhrase(word);
  if (!normalized || countWords(normalized) !== 1) return '';
  const dictionary = lang === 'fa' ? comprehensiveFa : comprehensiveEn;
  // Do not strip accents: el/él, si/sí, tu/tú, and other pairs differ in meaning.
  if (!Object.prototype.hasOwnProperty.call(dictionary, normalized)) return '';
  return String(dictionary[normalized] || '').trim();
}

function offlineTranslateWord(word, lang) {
  return offlineTranslateWordDetailed(word, lang);
}

function offlineTranslateText(text, lang) {
  const normalized = normalizeTranslationPhrase(text);
  if (!normalized) return '';
  const exact = exactPhraseTranslation(normalized, lang);
  if (exact) return exact;
  if (countWords(normalized) === 1) return offlineTranslateWordDetailed(text, lang);

  // Never join isolated word glosses into a sentence: without syntax and context,
  // that produces fluent-looking but often incorrect translations. Every word
  // in a multiword offline result must belong to a reviewed phrase match.
  const words = normalized.split(' ');
  const translations = [];
  let cursor = 0;
  while (cursor < words.length) {
    const match = offlinePhraseCandidates.find(candidate =>
      candidate.translations[lang]
      && candidate.words.length <= words.length - cursor
      && candidate.words.every((word, index) => words[cursor + index] === word)
    );
    if (!match) return '';
    translations.push(match.translations[lang]);
    cursor += match.words.length;
  }
  return translations.join(' ');
}

function offerTranslation(text) {
  const normalized = normalizeTranslationPhrase(text);
  const exactPhrase = exactPhraseTranslation(normalized, 'en');
  if (exactPhrase) return exactPhrase;
  if (countWords(normalized) !== 1) return '';
  return comprehensiveEn[normalized] || miniDictionary[normalized] || '';
}

function suggestFarsiTranslation(text) {
  const normalized = normalizeTranslationPhrase(text);
  const exactPhrase = exactPhraseTranslation(normalized, 'fa');
  if (exactPhrase) return exactPhrase;
  if (countWords(normalized) !== 1) return '';
  return comprehensiveFa[normalized] || farsiDictionary[normalized] || '';
}

function englishTranslationHelp(text) {
  if (offerTranslation(text)) {
    return countWords(text) > 1
      ? 'Check the full-expression suggestion and edit it if needed.'
      : 'Review the word suggestion and edit it if needed.';
  }
  return 'Lumbre will look up an English translation automatically when online. If it cannot connect, you can retry or enter the meaning yourself.';
}

function syncFarsiControls() {
  const enabled = Boolean(state.settings?.farsiEnabled);
  const toggle = $('farsiToggle');
  if (toggle) {
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.setAttribute('aria-label', enabled ? 'Hide Farsi translations' : 'Show Farsi translations');
    toggle.classList.toggle('active', enabled);
  }
  $('farsiStatus').textContent = enabled ? 'on' : 'off';
  $('modalFarsiToggle').checked = enabled;
  const field = $('farsiTranslationField');
  if (field) field.hidden = !enabled;
}

/* Live translation: reviewed offline matches first, online lookup when no match exists. */
// v4 invalidates cached results for verbs that now have reviewed English glosses.
const LIVE_TRANSLATION_CACHE_KEY = 'lumbre-live-translation-cache-v4';
const LIVE_TRANSLATION_MAX_CHUNK = 450;
let liveTranslationCache = {};
let liveTranslationRequestId = 0;
let selectionLiveRequestId = 0;

function loadLiveTranslationCache() {
  try {
    const raw = localStorage.getItem(LIVE_TRANSLATION_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
function saveLiveTranslationCache() {
  try {
    const keys = Object.keys(liveTranslationCache);
    if (keys.length > 800) {
      const toDelete = keys.slice(0, keys.length - 600);
      toDelete.forEach(k => delete liveTranslationCache[k]);
    }
    localStorage.setItem(LIVE_TRANSLATION_CACHE_KEY, JSON.stringify(liveTranslationCache));
  } catch {}
}
liveTranslationCache = loadLiveTranslationCache();
const pendingOnlineTranslationRequests = new Map();

function cacheKey(text, lang) {
  return `${lang}::${normalizeTranslationPhrase(text)}`;
}
function getCachedTranslation(text, lang) {
  const key = cacheKey(text, lang);
  return liveTranslationCache[key] || '';
}
function setCachedTranslation(text, lang, translation, source) {
  const key = cacheKey(text, lang);
  liveTranslationCache[key] = { text: translation, source: source || 'offline', ts: Date.now() };
  saveLiveTranslationCache();
}

async function fetchOnlineTranslation(text, targetLang) {
  if (!state.settings.liveTranslationOnline) throw new Error('online disabled');
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (navigator.onLine === false) throw new Error('offline');

  const lang = targetLang === 'fa' ? 'fa' : 'en';
  const key = cacheKey(trimmed, lang);
  if (pendingOnlineTranslationRequests.has(key)) return pendingOnlineTranslationRequests.get(key);

  const request = (async () => {
    const langPair = `es|${lang}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=${langPair}&de=example@example.com`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`http ${resp.status}`);
      const data = await resp.json();
      if (data?.responseStatus != null && Number(data.responseStatus) !== 200) {
        throw new Error(data.responseDetails || 'translation service error');
      }
      const translated = String(data?.responseData?.translatedText || data?.matches?.[0]?.translation || '').trim();
      if (!translated) throw new Error('empty translation');
      if (countWords(trimmed) > 1 && normalizeTranslationPhrase(translated) === normalizeTranslationPhrase(trimmed)) {
        throw new Error('translation unchanged');
      }
      // Heuristic: reject obviously bad MyMemory results for se le hizo patterns
      const lowerTrimmed = normalizeTranslationPhrase(trimmed);
      const lowerTranslated = normalizeTranslationPhrase(translated);
      if (lowerTrimmed.includes('se le hizo') && (lowerTranslated.includes('it is worked') || lowerTranslated.includes('it is made') && lowerTranslated.split(' ').length <= 3)) {
        // Consider it low quality, throw to force offline
        throw new Error('low quality online translation for hacerle construction');
      }
      return translated;
    } finally {
      clearTimeout(timeout);
    }
  })();

  pendingOnlineTranslationRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (pendingOnlineTranslationRequests.get(key) === request) pendingOnlineTranslationRequests.delete(key);
  }
}

async function translateChunk(text, targetLang) {
  const cached = getCachedTranslation(text, targetLang);
  if (cached && cached.text) return { text: cached.text, source: cached.source || 'cache' };
  const offline = offlineTranslateText(text, targetLang);
  if (offline) {
    // Keep a reviewed offline match stable; do not silently replace it with an
    // unreviewed machine translation in the background.
    setCachedTranslation(text, targetLang, offline, 'offline');
    return { text: offline, source: 'offline' };
  }
  if (!state.settings.liveTranslationOnline || navigator.onLine === false) {
    return { text: '', source: 'offline-missing' };
  }
  try {
    const online = await fetchOnlineTranslation(text, targetLang);
    if (online) {
      setCachedTranslation(text, targetLang, online, 'online');
      return { text: online, source: 'online' };
    }
  } catch (error) {
    return { text: '', source: navigator.onLine === false ? 'offline-missing' : 'error' };
  }
  return { text: '', source: 'error' };
}

function splitIntoChunks(text, maxLen) {
  const paragraphs = String(text || '').split(/\n{2,}/);
  const chunks = [];
  paragraphs.forEach(para => {
    const trimmed = para.trim();
    if (!trimmed) return;
    if (trimmed.length <= maxLen) {
      chunks.push(trimmed);
      return;
    }
    const sentences = trimmed.match(/[^.!?¡¿]+[.!?¡¿]*\s*/g) || [trimmed];
    let current = '';
    sentences.forEach(sent => {
      if ((current + sent).length > maxLen && current) {
        chunks.push(current.trim());
        current = sent;
      } else {
        current += sent;
      }
    });
    if (current.trim()) chunks.push(current.trim());
  });
  return chunks;
}

async function translateTextFull(text, targetLang, onProgress) {
  const chunks = splitIntoChunks(text, LIVE_TRANSLATION_MAX_CHUNK);
  const results = [];
  const sources = { online: 0, offline: 0, missing: 0, error: 0 };
  const currentSource = () => {
    if (sources.error) return sources.online || sources.offline ? 'partial-error' : 'error';
    if (sources.missing) return sources.online || sources.offline ? 'partial-offline' : 'offline-missing';
    if (sources.online && sources.offline) return 'mixed';
    if (sources.online) return 'online';
    return sources.offline ? 'offline' : 'offline-missing';
  };

  for (let i = 0; i < chunks.length; i++) {
    const res = await translateChunk(chunks[i], targetLang);
    results.push(res.text || chunks[i]);
    if (res.source === 'online') sources.online += 1;
    else if (res.source === 'offline') sources.offline += 1;
    else if (res.source === 'error') sources.error += 1;
    else sources.missing += 1;
    if (onProgress) onProgress(i + 1, chunks.length, currentSource());
  }
  const paragraphs = String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  let output = '';
  if (results.length === paragraphs.length) {
    output = results.join('\n\n');
  } else {
    output = results.join(' ');
    if (paragraphs.length > 1 && chunks.length > paragraphs.length) {
      output = results.join('\n\n');
    }
  }
  return { text: output, source: currentSource(), chunks: results.length };
}

function syncLiveTranslationControls() {
  const enabled = Boolean(state.settings?.liveTranslationEnabled);
  const lang = state.settings?.liveTranslationLang === 'fa' ? 'fa' : 'en';
  const toggle = $('liveTranslationToggle');
  const toolbarToggle = $('liveTranslationToolbarToggle');
  const panel = $('liveTranslationPanel');
  const langSelect = $('liveTranslationLang');
  if (toggle) {
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.classList.toggle('active', enabled);
  }
  if (toolbarToggle) {
    toolbarToggle.classList.toggle('active', enabled);
    toolbarToggle.textContent = enabled ? 'Live • on' : 'Live translate';
    toolbarToggle.setAttribute('aria-pressed', String(enabled));
  }
  const statusEl = $('liveStatus');
  if (statusEl) statusEl.textContent = enabled ? 'on' : 'off';
  if (langSelect) langSelect.value = lang;
  const contentEl = $('liveTranslationContent');
  if (contentEl) contentEl.setAttribute('lang', lang);
  if (panel) {
    panel.hidden = !enabled;
    if (!enabled) {
      const selLive = $('selectionLiveTranslation');
      if (selLive) selLive.hidden = true;
    }
  }
}

function setLiveTranslationEnabled(enabled) {
  state.settings.liveTranslationEnabled = Boolean(enabled);
  syncLiveTranslationControls();
  save();
  if (enabled) {
    renderLiveTranslation();
    if (pendingText) translateSelectionLive(pendingText);
  }
}

function setLiveTranslationLang(lang) {
  const normalized = lang === 'fa' ? 'fa' : 'en';
  state.settings.liveTranslationLang = normalized;
  syncLiveTranslationControls();
  save();
  if (state.settings.liveTranslationEnabled) {
    renderLiveTranslation(true);
    if (pendingText) translateSelectionLive(pendingText);
  }
}

let liveTranslationDebounce = null;
function scheduleLiveTranslationRender(force = false) {
  if (!state.settings.liveTranslationEnabled) return;
  if (liveTranslationDebounce) clearTimeout(liveTranslationDebounce);
  liveTranslationDebounce = setTimeout(() => {
    renderLiveTranslation(force);
  }, force ? 10 : 350);
}

async function renderLiveTranslation(force = false) {
  const panel = $('liveTranslationPanel');
  const content = $('liveTranslationContent');
  const status = $('liveTranslationStatus');
  const badge = $('liveTranslationBadge');
  const lang = state.settings.liveTranslationLang === 'fa' ? 'fa' : 'en';
  if (!panel || !content || !status) return;
  const passage = activePassage();
  if (!passage) {
    content.textContent = 'No passage selected.';
    status.textContent = '';
    if (badge) badge.textContent = 'offline';
    return;
  }
  const requestId = ++liveTranslationRequestId;
  content.innerHTML = `<span class="translating-placeholder">Translating…</span>`;
  status.textContent = 'Translating…';
  status.className = 'live-translation-status';
  if (badge) { badge.textContent = 'translating'; badge.className = 'live-badge translating'; }

  try {
    const result = await translateTextFull(passage.text, lang, (done, total, src) => {
      if (requestId !== liveTranslationRequestId) return;
      const mode = src === 'online' || src === 'mixed'
        ? 'live online'
        : (src === 'error' || src === 'partial-error'
          ? 'connection issue'
          : (src === 'offline-missing' || src === 'partial-offline' ? 'offline mode' : 'offline dictionary'));
      status.textContent = `Translating ${done}/${total} • ${mode}`;
    });
    if (requestId !== liveTranslationRequestId) return;
    const paragraphs = result.text.split(/\n{2,}/).map(p => `<div class="para">${escapeHtml(p)}</div>`).join('');
    content.innerHTML = paragraphs || escapeHtml(result.text);
    content.setAttribute('lang', lang);
    const isOnline = result.source === 'online' || result.source === 'mixed';
    const hasError = result.source === 'error' || result.source === 'partial-error';
    const statusMessages = {
      online: `Online result • check in context • ${result.chunks} segments • cached for offline`,
      mixed: `Online + reviewed offline matches • check online segments • ${result.chunks} segments`,
      offline: `Offline dictionary • ${result.chunks} reviewed matches`,
      'offline-missing': 'Offline mode — no reviewed translation is available; the original Spanish is shown.',
      'partial-offline': 'Offline mode — unmatched segments remain in Spanish. Connect and refresh for online translation.',
      error: 'Could not reach the translation service. Check your connection and refresh.',
      'partial-error': 'Some segments could not be translated online. Check your connection and refresh.'
    };
    status.textContent = statusMessages[result.source] || statusMessages.offline;
    status.className = `live-translation-status${isOnline ? ' online' : (hasError ? ' error' : '')}`;
    if (badge) {
      badge.textContent = isOnline ? (result.source === 'mixed' ? 'mixed' : 'live') : (hasError ? 'error' : 'offline');
      badge.className = `live-badge${isOnline ? ' online' : (hasError ? ' error' : '')}`;
    }
  } catch (e) {
    if (requestId !== liveTranslationRequestId) return;
    content.textContent = 'Translation unavailable. Check connection or try again.';
    status.textContent = 'Translation failed • offline fallback available';
    status.className = 'live-translation-status error';
    if (badge) { badge.textContent = 'error'; badge.className = 'live-badge error'; }
  }
}

async function translateSelectionLive(text) {
  const container = $('selectionLiveTranslation');
  const textEl = $('selectionLiveTranslationText');
  const statusEl = $('selectionLiveTranslationStatus');
  const badgeEl = $('selectionLiveBadge');
  const langEl = $('selectionLiveLang');
  const titleEl = $('selectionLiveTitle');
  if (!container || !textEl || !statusEl) return;
  const lang = state.settings.liveTranslationLang === 'fa' ? 'fa' : 'en';
  const trimmed = String(text || '').trim();
  if (!trimmed || !state.settings.liveTranslationEnabled) {
    container.hidden = true;
    return;
  }
  const requestId = ++selectionLiveRequestId;
  container.hidden = false;
  textEl.textContent = 'Translating…';
  textEl.setAttribute('lang', lang);
  statusEl.textContent = '';
  if (langEl) langEl.textContent = lang === 'fa' ? '→ فارسی' : '→ English';
  if (titleEl) titleEl.textContent = 'Live translation';
  if (badgeEl) { badgeEl.textContent = '…'; badgeEl.className = 'live-badge translating'; }

  try {
    const res = await translateChunk(trimmed, lang);
    if (requestId !== selectionLiveRequestId) return;
    if (res.text) {
      textEl.textContent = res.text;
      textEl.setAttribute('lang', lang);
      statusEl.textContent = res.source === 'online'
        ? 'Live online translation — check the result in context'
        : 'Reviewed offline word/phrase match';
      if (badgeEl) {
        badgeEl.textContent = res.source === 'online' ? 'live' : 'offline';
        badgeEl.className = res.source === 'online' ? 'live-badge online' : 'live-badge';
      }
    } else if (res.source === 'offline-missing') {
      textEl.textContent = lang === 'fa' ? 'ترجمهٔ آفلاین یافت نشد. آنلاین را امتحان کنید.' : 'No reviewed offline translation is available for this selection.';
      statusEl.textContent = 'No reviewed offline match. Reconnect to request an online translation.';
      if (badgeEl) { badgeEl.textContent = 'offline'; badgeEl.className = 'live-badge'; }
    } else {
      textEl.textContent = 'The translation service could not be reached.';
      statusEl.textContent = 'Check your internet connection, then try again.';
      if (badgeEl) { badgeEl.textContent = 'error'; badgeEl.className = 'live-badge error'; }
    }
  } catch {
    if (requestId !== selectionLiveRequestId) return;
    textEl.textContent = 'Translation unavailable.';
    statusEl.textContent = 'Check connection.';
    if (badgeEl) { badgeEl.textContent = 'error'; badgeEl.className = 'live-badge error'; }
  }
}

function migrateSavedTranslations() {
  let changed = false;
  let phrasesNeedingReview = 0;
  state.passages.forEach(passage => passage.highlights.forEach(highlight => {
    if (highlight.translationVersion === 4) return;
    // Fill missing translations from exact matches and flag legacy values that
    // conflict with the reviewed glossary, without discarding user-entered text.
    const previousTranslation = String(highlight.translation || '').trim();
    // Never erase a user's saved translation during an app update.
    highlight.translation = previousTranslation || offerTranslation(highlight.phrase);
    highlight.translationFa = highlight.translationFa || suggestFarsiTranslation(highlight.phrase);
    const currentSuggestion = offerTranslation(highlight.phrase);
    const knownSuggestionChanged = currentSuggestion
      && normalizeTranslationPhrase(previousTranslation) !== normalizeTranslationPhrase(currentSuggestion);
    const unreviewedLegacyPhrase = countWords(highlight.phrase) > 1 && !currentSuggestion;
    if (previousTranslation && (knownSuggestionChanged || unreviewedLegacyPhrase)) phrasesNeedingReview += 1;
    highlight.translationVersion = 4;
    changed = true;
  }));
  if (changed) save();
  return phrasesNeedingReview;
}

let englishTranslationRequestId = 0;
let englishTranslationLookupPending = false;
let englishTranslationTouched = false;

function setEnglishTranslationStatus(message, tone = '', showRetry = false) {
  const status = $('englishTranslationStatus');
  if (status) {
    status.textContent = message;
    status.className = `translation-helper translation-lookup-status${tone ? ` ${tone}` : ''}`;
  }
  const retry = $('retryEnglishTranslation');
  if (retry) {
    retry.hidden = !showRetry;
    retry.disabled = englishTranslationLookupPending;
  }
}

function syncEnglishTranslationSaveButton() {
  const saveButton = $('saveHighlight');
  const translation = $('translationSuggestion')?.value.trim();
  if (saveButton) saveButton.disabled = englishTranslationLookupPending && !translation;
  const retry = $('retryEnglishTranslation');
  if (retry) retry.disabled = englishTranslationLookupPending;
}

function isCurrentEnglishTranslationLookup(requestId, phrase) {
  return requestId === englishTranslationRequestId
    && $('highlightModal').classList.contains('open')
    && pendingText === phrase;
}

async function lookupEnglishTranslation(force = false) {
  const requestId = ++englishTranslationRequestId;
  const phrase = pendingText;
  const field = $('translationSuggestion');
  if (!phrase || !field) return;

  const cached = getCachedTranslation(phrase, 'en');
  if (!force && cached?.source === 'online' && cached.text) {
    if (!englishTranslationTouched && !field.value.trim()) field.value = cached.text;
    setEnglishTranslationStatus('A cached online suggestion was filled. Review it in context before using it.', 'success');
    syncEnglishTranslationSaveButton();
    return;
  }

  if (!state.settings.liveTranslationEnabled) {
    setEnglishTranslationStatus('Live translation is off. Turn it on to look this up, or enter the translation yourself.', 'offline');
    englishTranslationLookupPending = false;
    syncEnglishTranslationSaveButton();
    return;
  }
  if (!state.settings.liveTranslationOnline) {
    setEnglishTranslationStatus('Online translation is disabled. Enter the English meaning manually.', 'offline');
    englishTranslationLookupPending = false;
    syncEnglishTranslationSaveButton();
    return;
  }
  if (navigator.onLine === false) {
    setEnglishTranslationStatus('Offline mode — no built-in translation is available. Reconnect and tap “Try again,” or enter it manually.', 'offline', true);
    englishTranslationLookupPending = false;
    syncEnglishTranslationSaveButton();
    return;
  }

  englishTranslationLookupPending = true;
  setEnglishTranslationStatus('Looking up an English translation online…', 'loading');
  syncEnglishTranslationSaveButton();
  try {
    const translation = await fetchOnlineTranslation(phrase, 'en');
    if (!translation) throw new Error('empty translation');
    setCachedTranslation(phrase, 'en', translation, 'online');
    if (!isCurrentEnglishTranslationLookup(requestId, phrase)) return;

    if (!englishTranslationTouched && !field.value.trim()) {
      field.value = translation;
      setEnglishTranslationStatus('Online translation added automatically. Review it before saving.', 'success');
    } else {
      setEnglishTranslationStatus('Your edit was kept; the online result did not replace it.', 'info', !field.value.trim());
    }
  } catch {
    if (!isCurrentEnglishTranslationLookup(requestId, phrase)) return;
    if (navigator.onLine === false) {
      setEnglishTranslationStatus('Offline mode — no built-in translation is available. Reconnect and tap “Try again,” or enter it manually.', 'offline', !field.value.trim());
    } else {
      setEnglishTranslationStatus('Could not reach the translation service. Check your connection and try again, or enter it manually.', 'error', !field.value.trim());
    }
  } finally {
    if (isCurrentEnglishTranslationLookup(requestId, phrase)) {
      englishTranslationLookupPending = false;
      syncEnglishTranslationSaveButton();
    }
  }
}

let dialogReturnFocus = null;
function openDialog(id, headingId) {
  cancelSelectionCapture();
  dialogReturnFocus = document.activeElement;
  $(id).classList.add('open');
  document.body.classList.add('dialog-open');
  document.querySelector('.shell').inert = true;
  // Focus the heading, not a text field: don't cover the dialog with a tablet keyboard.
  $(headingId).focus({ preventScroll: true });
}

function closeDialog(id) {
  $(id).classList.remove('open');
  document.body.classList.remove('dialog-open');
  document.querySelector('.shell').inert = false;
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus({ preventScroll: true });
}

document.addEventListener('keydown', event => {
  const dialog = document.querySelector('.modal-backdrop.open');
  if (!dialog) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (dialog.id === 'highlightModal') closeHighlightModal();
    else closePassageModal();
  }
  if (event.key === 'Tab') {
    const controls = [...dialog.querySelectorAll('button, input, textarea, [tabindex="0"]')]
      .filter(element => !element.disabled && element.getClientRects().length);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});

function openHighlightModal(text, options = {}) {
  englishTranslationRequestId += 1;
  englishTranslationLookupPending = false;
  englishTranslationTouched = false;
  pendingText = text.trim();
  pendingStart = Number.isInteger(options.start) ? options.start : null;
  pendingEnd = Number.isInteger(options.end) ? options.end : null;
  pendingPassageId = activePassage()?.id || '';
  $('modalTitle').textContent = options.editId ? 'Edit saved expression' : 'Save this expression';
  $('saveHighlight').textContent = options.editId ? 'Save changes' : 'Save expression ↗';
  $('selectedExpression').textContent = pendingText;

  const providedTranslation = Object.prototype.hasOwnProperty.call(options, 'translation')
    ? String(options.translation || '').trim()
    : '';
  const cachedOnlineTranslation = getCachedTranslation(pendingText, 'en');
  const cachedTranslation = cachedOnlineTranslation?.source === 'online' ? String(cachedOnlineTranslation.text || '').trim() : '';
  const builtInTranslation = offerTranslation(pendingText);
  const initialTranslation = providedTranslation || cachedTranslation || builtInTranslation;
  $('translationSuggestion').value = initialTranslation;
  $('farsiTranslationInput').value = Object.prototype.hasOwnProperty.call(options, 'translationFa')
    ? options.translationFa
    : suggestFarsiTranslation(pendingText);
  $('englishTranslationHelp').textContent = englishTranslationHelp(pendingText);
  $('explanationInput').value = options.explanation || '';
  if (options.editId) $('saveHighlight').dataset.edit = options.editId;
  else delete $('saveHighlight').dataset.edit;

  if (providedTranslation) {
    setEnglishTranslationStatus('Saved English translation. Review or edit it here.');
  } else if (cachedTranslation) {
    setEnglishTranslationStatus('A previous online translation was filled from this device’s cache.', 'success');
  } else if (builtInTranslation) {
    setEnglishTranslationStatus('Built-in suggestion filled — available offline. Check it before saving.', 'success');
  } else {
    setEnglishTranslationStatus('');
  }
  syncEnglishTranslationSaveButton();
  syncFarsiControls();
  openDialog('highlightModal', 'modalTitle');
  if (!initialTranslation) lookupEnglishTranslation();
}

function closeHighlightModal(reset = true) {
  englishTranslationRequestId += 1;
  englishTranslationLookupPending = false;
  syncEnglishTranslationSaveButton();
  cancelSelectionCapture();
  window.getSelection()?.removeAllRanges();
  closeDialog('highlightModal');
  delete $('saveHighlight').dataset.edit;
  if (reset) resetSelectionHint();
}

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2200);
}

function switchView(view) {
  resetSelectionHint();
  window.getSelection()?.removeAllRanges();
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element.id === `${view}View`));
  document.querySelectorAll('.nav-link').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  if (view === 'review') renderReview();
  if (view === 'verbs') renderVerbs();
}

function domPointToTextOffset(root, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function setPendingSelection(start, end) {
  const passage = activePassage();
  if (!passage || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > passage.text.length || end <= start) return;
  const selected = passage.text.slice(start, end);
  const phrase = selected.trim();
  if (!phrase) return;
  start += selected.length - selected.trimStart().length;
  end = start + phrase.length;
  pendingText = phrase;
  pendingStart = start;
  pendingEnd = end;
  pendingPassageId = passage.id;
  const exact = passage.highlights.find(item => item.start === start && item.end === end);
  const overlap = passage.highlights.some(item => start < item.end && end > item.start);
  $('selectionSummary').textContent = `“${phrase.length > 90 ? `${phrase.slice(0, 90)}…` : phrase}”${overlap && !exact ? ' — overlaps a saved expression. Clear and select unsaved words.' : ''}`;
  $('selectionHint').textContent = exact ? 'Edit saved expression' : 'Add to flashcards';
  $('selectionHint').disabled = tapWordsEnabled && overlap && !exact;
  $('selectionHint').hidden = false;
  $('selectionActions').classList.add('is-active');
  $('clearSelectionBtn').hidden = false;
  if (state.settings.liveTranslationEnabled) {
    translateSelectionLive(phrase);
  }
  // Do not replace article DOM here: doing so destroys native selection handles.
  $('readingText').querySelectorAll('.reading-word').forEach(word => {
    const selectedWord = Number(word.dataset.start) >= start && Number(word.dataset.end) <= end;
    word.classList.toggle('tap-selected', selectedWord);
    if (word.getAttribute('role') === 'button') word.setAttribute('aria-pressed', String(selectedWord));
  });
}

function captureReadingSelection() {
  if (tapWordsEnabled || document.querySelector('.modal-backdrop.open') || !$('readerView').classList.contains('active')) return;
  const passage = activePassage();
  const root = $('readingText');
  const selection = window.getSelection();
  if (!passage || !selection || !selection.rangeCount) return;
  try {
    const range = selection.getRangeAt(0);
    // A tap on the save button can collapse an iPad selection before click fires.
    // Keep the last valid offsets until saved, cleared, or the passage changes.
    if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const start = domPointToTextOffset(root, range.startContainer, range.startOffset);
    const end = domPointToTextOffset(root, range.endContainer, range.endOffset);
    setPendingSelection(Math.min(start, end), Math.max(start, end));
  } catch (error) {
    // Safari can briefly expose a stale range while its selection handles move.
  }
}

let selectionCaptureTimers = [];
let selectionCaptureGeneration = 0;
function cancelSelectionCapture() {
  selectionCaptureGeneration += 1;
  selectionCaptureTimers.forEach(clearTimeout);
  selectionCaptureTimers = [];
}
function scheduleSelectionCapture() {
  cancelSelectionCapture();
  if (tapWordsEnabled || document.querySelector('.modal-backdrop.open') || !$('readerView').classList.contains('active')) return;
  const generation = selectionCaptureGeneration;
  // Native selection can settle after touchend or after a selection-handle drag
  // outside the article. Listen on document as well as selectionchange.
  selectionCaptureTimers = [0, 100, 350, 700].map(delay => setTimeout(() => {
    if (generation === selectionCaptureGeneration) captureReadingSelection();
  }, delay));
}

function selectTappedWord(word) {
  const start = Number(word.dataset.start);
  const end = Number(word.dataset.end);
  if (!tapAnchor || tapRangeComplete) {
    tapAnchor = { start, end };
    tapRangeComplete = false;
    setPendingSelection(start, end);
  } else if (tapAnchor.start === start && tapAnchor.end === end) {
    resetSelectionHint();
  } else {
    setPendingSelection(Math.min(tapAnchor.start, start), Math.max(tapAnchor.end, end));
    tapRangeComplete = true;
  }
}

function openPendingSelection() {
  if (document.querySelector('.modal-backdrop.open')) return;
  captureReadingSelection();
  cancelSelectionCapture();
  const passage = activePassage();
  if (!passage || passage.id !== pendingPassageId || !pendingText || passage.text.slice(pendingStart, pendingEnd) !== pendingText) {
    resetSelectionHint();
    showToast('Select text first, or choose Tap words and tap a word.');
    return;
  }
  const exact = passage.highlights.find(item => item.start === pendingStart && item.end === pendingEnd);
  if (exact) {
    openHighlightModal(exact.phrase, {
      editId: exact.id, start: exact.start, end: exact.end,
      translation: exact.translation || '', translationFa: exact.translationFa || suggestFarsiTranslation(exact.phrase),
      explanation: exact.explanation || ''
    });
  } else if (!passage.highlights.some(item => pendingStart < item.end && pendingEnd > item.start)) {
    openHighlightModal(pendingText, { start: pendingStart, end: pendingEnd });
  } else {
    showToast('That selection overlaps a saved expression. Clear it and select unsaved words.');
  }
}

function selectPassage(id) {
  if (!state.passages.some(passage => passage.id === id)) return;
  window.getSelection()?.removeAllRanges();
  state.active = id;
  state.queue = [];
  state.repeatQueue = [];
  state.round = 1;
  revealedCardId = '';
  closePassageMenu();
  render();
}

function closePassageMenu(returnFocus = false) {
  const menu = $('passageMenu');
  menu.hidden = true;
  $('passageMenuToggle').setAttribute('aria-expanded', 'false');
  if (returnFocus) $('passageMenuToggle').focus();
}

function openPassageMenu() {
  if ($('passageMenuToggle').disabled) return;
  const menu = $('passageMenu');
  const opening = menu.hidden;
  menu.hidden = !opening;
  $('passageMenuToggle').setAttribute('aria-expanded', String(opening));
  if (opening) menu.querySelector('button')?.focus();
}

function openPassageModal(mode, passage = activePassage()) {
  if (mode === 'edit' && !passage) return;
  passageEditingId = mode === 'edit' ? passage.id : '';
  $('passageForm').reset();
  $('passageNameInput').value = passageEditingId ? passage.title : '';
  $('passageTextInput').value = passageEditingId ? passage.text : '';
  $('passageModalEyebrow').textContent = passageEditingId ? 'EDIT YOUR PASSAGE' : 'BUILD YOUR READING STUDIO';
  $('passageModalTitle').textContent = passageEditingId ? 'Edit passage name & text' : 'Add a passage.';
  $('savePassageButton').textContent = passageEditingId ? 'Save changes' : 'Create passage';
  closePassageMenu();
  openDialog('passageModal', 'passageModalTitle');
}

function closePassageModal() {
  closeDialog('passageModal');
  passageEditingId = '';
}

function findPhrasePositions(text, phrase, caseInsensitive = false) {
  const haystack = caseInsensitive ? text.toLocaleLowerCase() : text;
  const needle = caseInsensitive ? phrase.toLocaleLowerCase() : phrase;
  const positions = [];
  let fromIndex = 0;
  while (needle && fromIndex <= haystack.length - needle.length) {
    const position = haystack.indexOf(needle, fromIndex);
    if (position < 0) break;
    positions.push(position);
    fromIndex = position + 1;
  }
  return positions;
}

function relocateHighlights(highlights, newText) {
  const occupied = [];
  const relocated = [];
  let removed = 0;
  const ordered = [...highlights].sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));

  ordered.forEach(highlight => {
    const phrase = String(highlight.phrase || '');
    if (!phrase) {
      removed += 1;
      return;
    }
    let positions = findPhrasePositions(newText, phrase);
    if (!positions.length) positions = findPhrasePositions(newText, phrase, true);
    const oldStart = Number(highlight.start) || 0;
    const position = positions
      .filter(candidate => !occupied.some(range => candidate < range.end && candidate + phrase.length > range.start))
      .sort((a, b) => Math.abs(a - oldStart) - Math.abs(b - oldStart))[0];

    if (position === undefined) {
      removed += 1;
      return;
    }
    highlight.start = position;
    highlight.end = position + phrase.length;
    highlight.phrase = newText.slice(highlight.start, highlight.end);
    delete highlight.verbDetails;
    occupied.push({ start: highlight.start, end: highlight.end });
    relocated.push(highlight);
  });

  relocated.sort((a, b) => a.start - b.start);
  return { highlights: relocated, removed };
}

function deleteActivePassage() {
  const passage = activePassage();
  if (!passage) return;
  const confirmed = window.confirm(`Delete “${passage.title}”? Its saved words and review progress will also be removed.`);
  if (!confirmed) return;

  const index = state.passages.findIndex(item => item.id === passage.id);
  state.passages.splice(index, 1);
  const nextPassage = state.passages[index] || state.passages[index - 1] || null;
  state.active = nextPassage?.id || '';
  state.queue = [];
  state.repeatQueue = [];
  state.round = 1;
  revealedCardId = '';
  closePassageMenu();
  render();
  showToast('Passage deleted');
}

// App navigation, passage actions, and saved-expression editing.
document.addEventListener('click', event => {
  const passageAction = event.target.closest('[data-passage-action]');
  if (passageAction) {
    if (passageAction.dataset.passageAction === 'toggle-menu') openPassageMenu();
    if (passageAction.dataset.passageAction === 'edit') openPassageModal('edit');
    if (passageAction.dataset.passageAction === 'delete') {
      closePassageMenu();
      deleteActivePassage();
    }
    return;
  }

  const action = event.target.closest('[data-action]');
  if (action?.dataset.action === 'new-passage') {
    openPassageModal('new');
    return;
  }
  if (action?.dataset.action === 'edit-highlight') {
    const highlight = activePassage()?.highlights.find(item => item.id === action.dataset.highlight);
    if (highlight) {
      openHighlightModal(highlight.phrase, {
        editId: highlight.id,
        start: highlight.start,
        end: highlight.end,
        translation: highlight.translation || '',
        translationFa: highlight.translationFa || suggestFarsiTranslation(highlight.phrase),
        explanation: highlight.explanation || ''
      });
    }
    return;
  }

  const nav = event.target.closest('[data-view]');
  if (nav) {
    closePassageMenu();
    switchView(nav.dataset.view);
    return;
  }

  const passageItem = event.target.closest('[data-passage]');
  if (passageItem) {
    selectPassage(passageItem.dataset.passage);
    return;
  }

  const mark = event.target.closest('mark[data-id]');
  if (mark) {
    // Moving touch selection handles across an existing highlight is not an edit tap.
    if (!tapWordsEnabled && window.getSelection()?.toString().trim()) return;
    const highlight = activePassage()?.highlights.find(item => item.id === mark.dataset.id);
    if (highlight) {
      openHighlightModal(highlight.phrase, {
        editId: highlight.id,
        start: highlight.start,
        end: highlight.end,
        translation: highlight.translation ?? offerTranslation(highlight.phrase),
        translationFa: highlight.translationFa ?? suggestFarsiTranslation(highlight.phrase),
        explanation: highlight.explanation || ''
      });
    }
    return;
  }

  const word = event.target.closest('#readingText .reading-word');
  if (tapWordsEnabled && word) {
    selectTappedWord(word);
    return;
  }
  if (!event.target.closest('.passage-menu-wrap')) closePassageMenu();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('passageMenu').hidden) closePassageMenu(true);
});

document.addEventListener('pointerup', scheduleSelectionCapture);
document.addEventListener('touchend', scheduleSelectionCapture, { passive: true });
document.addEventListener('selectionchange', captureReadingSelection);
$('selectionHint').addEventListener('pointerdown', event => {
  captureReadingSelection();
  // Keep the native range until click. Opening on pointerup can retarget the
  // compatibility click to the newly opened backdrop and close the editor.
  if (event.cancelable) event.preventDefault();
});
$('selectionHint').addEventListener('touchstart', captureReadingSelection, { passive: true });
$('selectionHint').addEventListener('mousedown', event => {
  captureReadingSelection();
  event.preventDefault(); // Preserve the native range while the button is pressed.
});
$('selectionHint').addEventListener('click', openPendingSelection);
$('clearSelectionBtn').addEventListener('click', () => {
  resetSelectionHint();
  window.getSelection()?.removeAllRanges();
});
$('tapWordsMode').addEventListener('click', () => setSelectionMode(true));
$('nativeSelectionMode').addEventListener('click', () => setSelectionMode(false));
$('passageSelect').addEventListener('change', event => selectPassage(event.target.value));
$('readingText').addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="button"]')) {
    event.preventDefault();
    event.target.click();
  }
});

$('translationSuggestion').addEventListener('input', () => {
  englishTranslationTouched = true;
  const hasValue = Boolean($('translationSuggestion').value.trim());
  if (englishTranslationLookupPending && hasValue) {
    setEnglishTranslationStatus('Your entry will be kept; the online lookup will not replace it.', 'info');
  }
  syncEnglishTranslationSaveButton();
});
$('retryEnglishTranslation').addEventListener('click', () => {
  if (!$('translationSuggestion').value.trim()) englishTranslationTouched = false;
  lookupEnglishTranslation(true);
});

$('saveHighlight').addEventListener('click', () => {
  const passage = activePassage();
  if (!passage) return;
  const translation = $('translationSuggestion').value.trim();
  const translationFa = $('farsiTranslationInput').value.trim();
  const explanation = $('explanationInput').value.trim();
  const editId = $('saveHighlight').dataset.edit;

  if (!translation) {
    $('translationSuggestion').focus();
    showToast('Add a full English translation before saving');
    return;
  }
  if (state.settings.farsiEnabled && !translationFa) {
    $('farsiTranslationInput').focus();
    showToast('Add a full Farsi translation or turn Farsi off');
    return;
  }

  if (editId) {
    const highlight = passage.highlights.find(item => item.id === editId);
    if (highlight) {
      highlight.translation = translation;
      highlight.translationFa = translationFa;
      highlight.translationVersion = 4;
      highlight.explanation = explanation;
    }
    closeHighlightModal(false);
    resetSelectionHint();
    render();
    showToast('Saved expression updated');
    return;
  }

  let start = pendingStart;
  if (!Number.isInteger(start) || passage.text.slice(start, start + pendingText.length) !== pendingText) {
    start = passage.text.indexOf(pendingText);
  }
  if (!pendingText || start < 0) {
    showToast('That selection could not be found');
    return;
  }
  const end = start + pendingText.length;
  if (passage.highlights.some(highlight => start < highlight.end && end > highlight.start)) {
    showToast('That expression overlaps a saved one');
    return;
  }

  const verbDetails = typeof window.analyzeSpanishVerbs === 'function'
    ? window.analyzeSpanishVerbs(pendingText, passage.text, start)
    : [];
  passage.highlights.push({
    id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    phrase: pendingText,
    start,
    end,
    translation,
    translationFa,
    translationVersion: 4,
    explanation,
    verbDetails,
    cards: { 'es-en': 0, 'en-es': 0 },
    learned: false
  });
  const newHighlight = passage.highlights[passage.highlights.length - 1];
  const newVerbs = syncVerbCardsForHighlight(passage, newHighlight);
  closeHighlightModal(false);
  resetSelectionHint();
  render();
  showToast(newVerbs.length
    ? `Added to your flashcards · ${newVerbs.length} verb card${newVerbs.length === 1 ? '' : 's'} added (${newVerbs.join(', ')})`
    : 'Translation added to your flashcards');
});

['closeModal', 'cancelModal'].forEach(id => $(id).addEventListener('click', () => closeHighlightModal()));
function dismissOnBackdropGesture(id, close) {
  const backdrop = $(id);
  let beganOnBackdrop = false;
  backdrop.addEventListener('pointerdown', event => { beganOnBackdrop = event.target === backdrop; });
  backdrop.addEventListener('pointercancel', () => { beganOnBackdrop = false; });
  backdrop.addEventListener('click', event => {
    // A drag from the dialog, or the click that opened it, must not dismiss it.
    if (event.target === backdrop && beganOnBackdrop) close();
    beganOnBackdrop = false;
  });
}
dismissOnBackdropGesture('highlightModal', closeHighlightModal);
function setFarsiEnabled(enabled) {
  state.settings.farsiEnabled = enabled;
  if (enabled && $('highlightModal').classList.contains('open') && !$('farsiTranslationInput').value.trim()) {
    $('farsiTranslationInput').value = suggestFarsiTranslation(pendingText);
  }
  syncFarsiControls();
  if ($('reviewView').classList.contains('active')) renderReview();
  save();
}
$('farsiToggle').addEventListener('click', () => setFarsiEnabled(!state.settings.farsiEnabled));
$('modalFarsiToggle').addEventListener('change', event => setFarsiEnabled(event.target.checked));
$('liveTranslationToggle').addEventListener('click', () => setLiveTranslationEnabled(!state.settings.liveTranslationEnabled));
$('liveTranslationToolbarToggle').addEventListener('click', () => setLiveTranslationEnabled(!state.settings.liveTranslationEnabled));
$('liveTranslationLang').addEventListener('change', event => setLiveTranslationLang(event.target.value));
$('liveTranslationClose').addEventListener('click', () => setLiveTranslationEnabled(false));
$('liveTranslationRefresh').addEventListener('click', () => renderLiveTranslation(true));
$('liveTranslationCopy').addEventListener('click', async () => {
  const content = $('liveTranslationContent');
  if (!content) return;
  const text = content.innerText || content.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    showToast('Translation copied');
  } catch {
    // Fallback: select text
    const range = document.createRange();
    range.selectNodeContents(content);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    showToast('Translation selected — copy with Ctrl+C');
  }
});

$('newPassageBtn').addEventListener('click', () => openPassageModal('new'));
$('newPassageBtnSmall').addEventListener('click', () => openPassageModal('new'));
$('closePassageModal').addEventListener('click', closePassageModal);
$('cancelPassageModal').addEventListener('click', closePassageModal);
dismissOnBackdropGesture('passageModal', closePassageModal);
$('passageForm').addEventListener('submit', event => {
  event.preventDefault();
  const title = $('passageNameInput').value.trim();
  const text = $('passageTextInput').value.trim();
  if (!title || !text) {
    $('passageForm').reportValidity();
    return;
  }

  if (passageEditingId) {
    const passage = state.passages.find(item => item.id === passageEditingId);
    if (!passage) {
      closePassageModal();
      render();
      return;
    }
    const oldText = passage.text;
    let removed = 0;
    if (oldText !== text) {
      const result = relocateHighlights(passage.highlights, text);
      passage.highlights = result.highlights;
      removed = result.removed;
      passage.text = text;
    }
    passage.title = title;
    closePassageModal();
    render();
    showToast(removed ? `Passage updated · ${removed} saved expression${removed === 1 ? '' : 's'} no longer in the text` : 'Passage updated');
    return;
  }

  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  state.passages.push({ id, title, text, highlights: [] });
  state.active = id;
  state.queue = [];
  state.repeatQueue = [];
  state.round = 1;
  revealedCardId = '';
  closePassageModal();
  render();
  showToast('Passage created');
});

$('clearHighlights').addEventListener('click', () => {
  const passage = activePassage();
  if (passage?.highlights.length && window.confirm('Remove all saved words from this passage?')) {
    passage.highlights = [];
    state.queue = [];
    state.repeatQueue = [];
    state.round = 1;
    revealedCardId = '';
    render();
  }
});

$('wrongBtn').addEventListener('click', () => answer(false));
$('rightBtn').addEventListener('click', () => answer(true));
$('flashcard').addEventListener('click', event => {
  const toggle = event.target.closest('[data-action="toggle-translation"]');
  if (!toggle) return;
  const currentId = state.queue[0];
  revealedCardId = revealedCardId === currentId ? '' : currentId;
  renderReview();
});

/* --- Verb section interaction --- */
$('verbCard').addEventListener('click', event => {
  const toggle = event.target.closest('[data-verb-action="toggle"]');
  if (!toggle) return;
  const currentId = state.verbQueue[0];
  revealedVerbCardId = revealedVerbCardId === currentId ? '' : currentId;
  renderVerbs();
});

$('verbWrongBtn').addEventListener('click', () => answerVerb(false));
$('verbRightBtn').addEventListener('click', () => answerVerb(true));

function answerVerb(correct) {
  const id = state.verbQueue[0];
  const card = findVerbCard(id);
  if (!card) {
    syncVerbQueue();
    renderVerbs();
    return;
  }
  state.verbQueue.shift();
  const verb = card.verb;
  verb.cards = { conjugate: verbCorrectCount(verb, 'conjugate'), identify: verbCorrectCount(verb, 'identify') };
  if (correct) verb.cards[card.direction] = Math.min(CORRECT_ANSWERS_TO_LEARN, verb.cards[card.direction] + 1);
  const directionCount = verb.cards[card.direction];
  if (VERB_CARD_DIRECTIONS.every(direction => verb.cards[direction] >= CORRECT_ANSWERS_TO_LEARN)) verb.learned = true;
  if (!verb.learned && directionCount < CORRECT_ANSWERS_TO_LEARN) state.verbRepeatQueue.push(id);
  revealedVerbCardId = '';
  syncVerbQueue();
  prioritizeNextVerb(verb.id);
  renderVerbs();
  showToast(verb.learned
    ? `${verb.lemma} is learned in both directions.`
    : (!correct
      ? 'No problem. It will come back around.'
      : (directionCount >= CORRECT_ANSWERS_TO_LEARN
        ? 'Great — this direction is set. The other direction is next.'
        : `Nice. ${CORRECT_ANSWERS_TO_LEARN - directionCount} more correct in this direction.`)));
}

$('addVerbForm').addEventListener('submit', event => {
  event.preventDefault();
  const bank = verbBank();
  const input = $('addVerbInput');
  const glossInput = $('addVerbGlossInput');
  if (!bank) return;
  const wanted = input.value.split(/[,\n;]+|\s{2,}/).map(part => part.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) {
    showToast('Type one or more infinitives, like escribir, volver');
    return;
  }
  const glossText = String(glossInput?.value || '').trim();
  const glosses = !glossText ? [] : (wanted.length === 1
    ? [glossText]
    : glossText.split(/\s*;\s*/).map(gloss => gloss.trim()).filter(Boolean));
  if (wanted.length > 1 && glossText && glosses.length !== wanted.length) {
    showToast('Enter one English meaning per verb, separated by semicolons.');
    return;
  }
  const added = [];
  const skipped = [];
  wanted.forEach((lemma, index) => {
    const entry = bank.add(lemma);
    if (!entry) {
      skipped.push(lemma);
      return;
    }
    const base = entry.infinitive.replace(/se$/, '');
    const hasReviewedGloss = Boolean(verbInfinitiveEn[entry.infinitive] || verbInfinitiveEn[base]);
    if (glosses[index] && !hasReviewedGloss) state.customVerbGlosses[entry.infinitive] = glosses[index];
    if (!state.customVerbs.includes(entry.infinitive)) state.customVerbs.push(entry.infinitive);
    const result = upsertVerbCard(entry.infinitive);
    if (result) added.push(entry.infinitive);
  });
  input.value = '';
  if (glossInput) glossInput.value = '';
  renderVerbs();
  showToast(skipped.length
    ? `Not recognised as verbs: ${skipped.join(', ')}`
    : `${added.length} verb${added.length === 1 ? '' : 's'} in your practice: ${added.join(', ')}`);
});

$('verbMemoryList').addEventListener('click', event => {
  const remove = event.target.closest('[data-verb-remove]');
  if (remove) {
    const id = remove.dataset.verbRemove;
    const verb = state.verbs.find(item => item.id === id);
    state.verbs = state.verbs.filter(item => item.id !== id);
    state.customVerbs = state.customVerbs.filter(lemma => lemma !== verb?.lemma);
    state.verbQueue = state.verbQueue.filter(cardId => !cardId.startsWith(`${id}-`));
    state.verbRepeatQueue = state.verbRepeatQueue.filter(cardId => !cardId.startsWith(`${id}-`));
    revealedVerbCardId = '';
    renderVerbs();
    showToast(`${verb?.lemma || 'Verb'} removed from your practice`);
    return;
  }
  const focus = event.target.closest('[data-verb-focus]');
  if (!focus) return;
  const id = focus.dataset.verbFocus;
  const next = state.verbQueue.findIndex(cardId => cardId.startsWith(`${id}-`));
  if (next > 0) state.verbQueue.unshift(state.verbQueue.splice(next, 1)[0]);
  revealedVerbCardId = '';
  renderVerbs();
});

function answer(correct) {
  const passage = activePassage();
  if (!passage) return;
  const id = state.queue[0];
  const card = findCard(id);
  if (!card) {
    syncQueue();
    render();
    return;
  }

  state.queue.shift();
  const highlight = card.h;
  highlight.cards = { 'es-en': correctCount(highlight, 'es-en'), 'en-es': correctCount(highlight, 'en-es') };
  if (correct) highlight.cards[card.direction] = Math.min(CORRECT_ANSWERS_TO_LEARN, highlight.cards[card.direction] + 1);
  const directionCount = highlight.cards[card.direction];
  if (CARD_DIRECTIONS.every(direction => highlight.cards[direction] >= CORRECT_ANSWERS_TO_LEARN)) highlight.learned = true;
  if (!highlight.learned && directionCount < CORRECT_ANSWERS_TO_LEARN) {
    state.repeatQueue = Array.isArray(state.repeatQueue) ? state.repeatQueue : [];
    state.repeatQueue.push(id);
  }
  revealedCardId = '';
  syncQueue();
  prioritizeNextWord(highlight.id);
  render();

  const message = highlight.learned
    ? 'Learned in both directions — removed from your passage!'
    : (!correct
      ? 'No problem. It’s back in the rotation.'
      : (directionCount >= CORRECT_ANSWERS_TO_LEARN
        ? 'Great — this direction is set. Keep going in the other direction.'
        : `Nice. ${CORRECT_ANSWERS_TO_LEARN - directionCount} more correct in this direction.`));
  showToast(message);
}

const phrasesNeedingTranslationReview = migrateSavedTranslations();
hydrateVerbCards();
syncFarsiControls();
syncLiveTranslationControls();
render();
if (phrasesNeedingTranslationReview) {
  showToast(`${phrasesNeedingTranslationReview} saved translation${phrasesNeedingTranslationReview === 1 ? '' : 's'} may need review`);
}

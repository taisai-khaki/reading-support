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

const miniDictionary = {
  cuando: 'when', llegué: 'I arrived', casa: 'house', abuela: 'grandmother', puerta: 'door', entreabierta: 'ajar',
  entré: 'I entered', despacio: 'slowly', dejé: 'I left', mochila: 'backpack', junto: 'next to', perchero: 'coat rack',
  desde: 'from', cocina: 'kitchen', llegaba: 'came', olor: 'smell', delicioso: 'delicious', canela: 'cinnamon',
  pan: 'bread', recién: 'freshly', horneado: 'baked', preguntó: 'asked', sin: 'without', levantar: 'lifting',
  vista: 'sight', masa: 'dough', senté: 'I sat', lado: 'side', conté: 'I told', todo: 'everything', pasado: 'happened',
  durante: 'during', viaje: 'trip', afuera: 'outside', tarde: 'afternoon', desvanecía: 'faded', lentamente: 'slowly',
  dentro: 'inside', tiempo: 'time', parecía: 'seemed', haberse: 'to have', detenido: 'stopped', cariño: 'darling'
};
const farsiDictionary = {
  cuando: 'وقتی', llegué: 'رسیدم', casa: 'خانه', abuela: 'مادربزرگ', puerta: 'در', entreabierta: 'نیمه‌باز',
  entré: 'وارد شدم', despacio: 'آهسته', dejé: 'گذاشتم', mochila: 'کوله‌پشتی', junto: 'کنار', perchero: 'جالباسی',
  desde: 'از', cocina: 'آشپزخانه', llegaba: 'می‌آمد', olor: 'بو', delicioso: 'دل‌انگیز', canela: 'دارچین',
  pan: 'نان', recién: 'تازه', horneado: 'پخته‌شده', preguntó: 'پرسید', sin: 'بدون', levantar: 'بلند کردن',
  vista: 'نگاه', masa: 'خمیر', senté: 'نشستم', lado: 'کنار', conté: 'تعریف کردم', todo: 'همه‌چیز', pasado: 'اتفاق افتاده',
  durante: 'در طول', viaje: 'سفر', afuera: 'بیرون', tarde: 'عصر', desvanecía: 'کم‌کم محو می‌شد', lentamente: 'آهسته',
  dentro: 'داخل', tiempo: 'زمان', parecía: 'به نظر می‌رسید', haberse: 'شده بودن', detenido: 'متوقف', cariño: 'عزیزم'
};

function normalizeTranslationPhrase(text) {
  return String(text || '')
    .normalize('NFC')
    .toLocaleLowerCase('es')
    .replace(/[¿?¡!.,;:—–…“”‘’"'()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const phraseTranslations = {
  'la casa de mi abuela': {
    en: 'my grandmother’s house',
    fa: 'خانهٔ مادربزرگم'
  },
  'casa de la abuela': {
    en: 'grandmother’s house',
    fa: 'خانهٔ مادربزرگ'
  },
  'recién horneado': {
    en: 'freshly baked',
    fa: 'تازه‌پخته‌شده'
  },
  'pan recién horneado': {
    en: 'freshly baked bread',
    fa: 'نان تازه‌پخته‌شده'
  },
  'la puerta estaba entreabierta': {
    en: 'the door was ajar',
    fa: 'در نیمه‌باز بود'
  },
  'junto al perchero': {
    en: 'by the coat rack',
    fa: 'کنار جالباسی'
  },
  'olor delicioso a canela y pan recién horneado': {
    en: 'a delicious smell of cinnamon and freshly baked bread',
    fa: 'بوی دل‌انگیز دارچین و نان تازه‌پخته‌شده'
  },
  'todo lo que había pasado durante el viaje': {
    en: 'everything that had happened during the trip',
    fa: 'همهٔ اتفاقاتی که در طول سفر افتاده بود'
  },
  'sin levantar la vista': {
    en: 'without looking up',
    fa: 'بدون اینکه نگاهش را بالا بیاورد'
  },
  'sin levantar la vista de la masa': {
    en: 'without looking up from the dough',
    fa: 'بدون اینکه نگاهش را از خمیر بردارد'
  },
  'eres tú cariño': {
    en: 'Is that you, sweetheart?',
    fa: 'خودتی، عزیزم؟'
  },
  'me senté a su lado': {
    en: 'I sat beside her',
    fa: 'کنارش نشستم'
  },
  'se desvanecía lentamente': {
    en: 'was slowly fading',
    fa: 'آهسته‌آهسته محو می‌شد'
  },
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

function exactPhraseTranslation(text, language) {
  return normalizedPhraseTranslations.get(normalizeTranslationPhrase(text))?.[language] || '';
}

function offerTranslation(text) {
  const normalized = normalizeTranslationPhrase(text);
  const exactPhrase = exactPhraseTranslation(normalized, 'en');
  if (exactPhrase) return exactPhrase;
  if (countWords(normalized) !== 1) return '';
  return miniDictionary[normalized] || '';
}

function suggestFarsiTranslation(text) {
  const normalized = normalizeTranslationPhrase(text);
  const exactPhrase = exactPhraseTranslation(normalized, 'fa');
  if (exactPhrase) return exactPhrase;
  if (countWords(normalized) !== 1) return '';
  return farsiDictionary[normalized] || '';
}

function englishTranslationHelp(text) {
  if (offerTranslation(text)) {
    return countWords(text) > 1
      ? 'Check the full-expression suggestion and edit it if needed.'
      : 'Review the word suggestion and edit it if needed.';
  }
  return countWords(text) > 1
    ? 'No reliable full-phrase suggestion is available. Add the meaning of the whole selection; word-by-word guesses are intentionally avoided.'
    : 'No dictionary suggestion is available. Add the meaning in context.';
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

/* v1.3: live translation service */
const LIVE_TRANSLATION_CACHE_KEY = 'lumbre-live-translation-cache-v1';
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
    // Keep cache bounded
    const keys = Object.keys(liveTranslationCache);
    if (keys.length > 800) {
      const toDelete = keys.slice(0, keys.length - 600);
      toDelete.forEach(k => delete liveTranslationCache[k]);
    }
    localStorage.setItem(LIVE_TRANSLATION_CACHE_KEY, JSON.stringify(liveTranslationCache));
  } catch {}
}
liveTranslationCache = loadLiveTranslationCache();

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

function offlineTranslateWord(word, lang) {
  const norm = normalizeTranslationPhrase(word);
  if (!norm) return '';
  if (lang === 'fa') return farsiDictionary[norm] || '';
  return miniDictionary[norm] || '';
}
function offlineTranslateText(text, lang) {
  const normalized = normalizeTranslationPhrase(text);
  if (!normalized) return '';
  const exact = exactPhraseTranslation(normalized, lang);
  if (exact) return exact;
  if (countWords(normalized) === 1) {
    return offlineTranslateWord(normalized, lang) || '';
  }
  // Word-by-word fallback for longer phrases when online unavailable
  const words = String(text || '').split(/(\s+|[.,;:\n\r]+)/);
  let translated = 0;
  let total = 0;
  const out = words.map(part => {
    if (/^\s+$/.test(part) || /^[.,;:\n\r]+$/.test(part)) return part;
    const m = part.match(/[\p{L}\p{M}\p{N}]+(?:[’'-][\p{L}\p{M}\p{N}]+)*/gu);
    if (!m) return part;
    total += 1;
    const lower = normalizeTranslationPhrase(part);
    const dict = lang === 'fa' ? farsiDictionary[lower] : miniDictionary[lower];
    if (dict) { translated += 1; return dict; }
    return part;
  }).join('');
  // Only return word-by-word if we translated at least 40% or it's a short phrase
  if (total > 0 && translated / total >= 0.4) return out;
  return '';
}

async function fetchOnlineTranslation(text, targetLang) {
  if (!state.settings.liveTranslationOnline) throw new Error('online disabled');
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  // Use MyMemory free API (no key). If blocked, fallback will be used.
  const langPair = `es|${targetLang === 'fa' ? 'fa' : 'en'}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=${langPair}&de=example@example.com`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`http ${resp.status}`);
    const data = await resp.json();
    const translated = data?.responseData?.translatedText || data?.matches?.[0]?.translation || '';
    if (!translated) throw new Error('empty translation');
    // MyMemory sometimes returns the same text when it fails; treat as failure if identical and long
    return translated;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

async function translateChunk(text, targetLang) {
  const cached = getCachedTranslation(text, targetLang);
  if (cached && cached.text) return { text: cached.text, source: cached.source || 'cache' };
  const offline = offlineTranslateText(text, targetLang);
  if (offline) {
    setCachedTranslation(text, targetLang, offline, 'offline');
    // Still try online in background if enabled and text is longer than single word
    if (state.settings.liveTranslationOnline && countWords(text) > 1) {
      fetchOnlineTranslation(text, targetLang).then(online => {
        if (online && normalizeTranslationPhrase(online) !== normalizeTranslationPhrase(text)) {
          setCachedTranslation(text, targetLang, online, 'online');
        }
      }).catch(() => {});
    }
    return { text: offline, source: 'offline' };
  }
  if (!state.settings.liveTranslationOnline) {
    return { text: '', source: 'offline-missing' };
  }
  try {
    const online = await fetchOnlineTranslation(text, targetLang);
    if (online) {
      setCachedTranslation(text, targetLang, online, 'online');
      return { text: online, source: 'online' };
    }
  } catch {}
  return { text: '', source: 'offline-missing' };
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
    // Split by sentences
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
  let source = 'offline';
  for (let i = 0; i < chunks.length; i++) {
    const res = await translateChunk(chunks[i], targetLang);
    results.push(res.text || chunks[i]);
    if (res.source === 'online') source = 'online';
    else if (res.source === 'offline' && source !== 'online') source = 'offline';
    if (onProgress) onProgress(i + 1, chunks.length, source);
  }
  // Reconstruct with paragraph breaks
  const paragraphs = String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  // If chunk count equals paragraph count, map 1:1, else join with line breaks
  let output = '';
  if (results.length === paragraphs.length) {
    output = results.join('\n\n');
  } else {
    // Try to preserve original paragraph structure by joining chunks that came from same para
    output = results.join(' ');
    // Re-insert double newlines where original had them by using original para count
    // For simplicity, if original had double newlines, we approximate by double newline between translated paras when length similar
    if (paragraphs.length > 1 && chunks.length > paragraphs.length) {
      // Fallback: keep as spaced but preserve double newlines from original by replacing where we think
      output = results.join('\n\n');
    }
  }
  return { text: output, source, chunks: results.length };
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
      status.textContent = `Translating ${done}/${total} • ${src === 'online' ? 'live online' : 'offline dictionary'}`;
    });
    if (requestId !== liveTranslationRequestId) return;
    const paragraphs = result.text.split(/\n{2,}/).map(p => `<div class="para">${escapeHtml(p)}</div>`).join('');
    content.innerHTML = paragraphs || escapeHtml(result.text);
    content.setAttribute('lang', lang);
    const isOnline = result.source === 'online';
    status.textContent = isOnline ? `Live online • ${result.chunks} segments • cached for offline` : `Offline dictionary • ${result.chunks} segments • add online for fuller sentences`;
    status.className = isOnline ? 'live-translation-status online' : 'live-translation-status';
    if (badge) {
      badge.textContent = isOnline ? 'live' : 'offline';
      badge.className = isOnline ? 'live-badge online' : 'live-badge';
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
      statusEl.textContent = res.source === 'online' ? 'Live online translation' : (res.source === 'offline' ? 'Offline dictionary match' : 'No offline match — try online');
      if (badgeEl) {
        badgeEl.textContent = res.source === 'online' ? 'live' : (res.source === 'offline' ? 'offline' : 'no match');
        badgeEl.className = res.source === 'online' ? 'live-badge online' : (res.source === 'error' ? 'live-badge error' : 'live-badge');
      }
    } else {
      textEl.textContent = lang === 'fa' ? 'ترجمهٔ آفلاین یافت نشد. آنلاین را امتحان کنید.' : 'No offline translation found. The full passage panel will try online.';
      statusEl.textContent = 'Offline dictionary has limited phrases — online extends coverage.';
      if (badgeEl) { badgeEl.textContent = 'offline'; badgeEl.className = 'live-badge'; }
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
    if (highlight.translationVersion === 2) return;
    // Fill missing translations from exact matches; flag uncertain legacy phrases
    // for review without discarding existing user-entered translations.
    const previousTranslation = String(highlight.translation || '').trim();
    // Never erase a user's saved translation during an app update.
    highlight.translation = previousTranslation || offerTranslation(highlight.phrase);
    highlight.translationFa = highlight.translationFa || suggestFarsiTranslation(highlight.phrase);
    if (previousTranslation && countWords(highlight.phrase) > 1 && !offerTranslation(highlight.phrase)) phrasesNeedingReview += 1;
    highlight.translationVersion = 2;
    changed = true;
  }));
  if (changed) save();
  return phrasesNeedingReview;
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
  pendingText = text.trim();
  pendingStart = Number.isInteger(options.start) ? options.start : null;
  pendingEnd = Number.isInteger(options.end) ? options.end : null;
  pendingPassageId = activePassage()?.id || '';
  $('modalTitle').textContent = options.editId ? 'Edit saved expression' : 'Save this expression';
  $('saveHighlight').textContent = options.editId ? 'Save changes' : 'Save expression ↗';
  $('selectedExpression').textContent = pendingText;
  $('translationSuggestion').value = Object.prototype.hasOwnProperty.call(options, 'translation')
    ? options.translation
    : offerTranslation(pendingText);
  $('farsiTranslationInput').value = Object.prototype.hasOwnProperty.call(options, 'translationFa')
    ? options.translationFa
    : suggestFarsiTranslation(pendingText);
  $('englishTranslationHelp').textContent = englishTranslationHelp(pendingText);
  $('explanationInput').value = options.explanation || '';
  if (options.editId) $('saveHighlight').dataset.edit = options.editId;
  else delete $('saveHighlight').dataset.edit;
  syncFarsiControls();
  openDialog('highlightModal', 'modalTitle');
}

function closeHighlightModal(reset = true) {
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
      highlight.translationVersion = 2;
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
    translationVersion: 2,
    explanation,
    verbDetails,
    cards: { 'es-en': 0, 'en-es': 0 },
    learned: false
  });
  closeHighlightModal(false);
  resetSelectionHint();
  render();
  showToast('Translation added to your flashcards');
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
syncFarsiControls();
syncLiveTranslationControls();
render();
if (phrasesNeedingTranslationReview) {
  showToast(`${phrasesNeedingTranslationReview} old phrase translation${phrasesNeedingTranslationReview === 1 ? '' : 's'} need full-context review`);
}

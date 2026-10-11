const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');
const bundledChromium = require('@sparticuz/chromium').default;

let server, browser, url;
before(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)];
      response.writeHead(200, { 'Content-Type': type || 'text/plain', 'Cache-Control': 'no-store' });
      response.end(await readFile(path.join(__dirname, '..', file)));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  // Include the package's Linux libraries in minimal containers (no apt install needed).
  if (process.platform === 'linux') {
    const bundle = require('@sparticuz/chromium');
    const libRoot = await bundle.inflate(path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
    bundle.setupLambdaEnvironment(path.join(libRoot, 'lib'));
  }
  browser = await chromium.launch({ executablePath: await bundledChromium.executablePath(), args: bundledChromium.args.filter(arg => !['--single-process', '--disable-web-security'].includes(arg)), headless: true });
  await mkdir('.artifacts', { recursive: true });
});
after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});

async function newPage(options = {}, state) {
  const context = await browser.newContext(options);
  // The app works with local assets; remote fonts aren't required for tests.
  await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  if (state) await context.addInitScript(value => {
    if (!localStorage.getItem('lumbre-state')) localStorage.setItem('lumbre-state', JSON.stringify(value));
  }, state);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('#readingText').waitFor();
  return { page, async close() { assert.deepEqual(errors, []); await context.close(); } };
}
async function selectText(page, phrase) {
  if (await page.locator('#nativeSelectionMode').getAttribute('aria-pressed') !== 'true') await page.locator('#nativeSelectionMode').click();
  await page.evaluate(phrase => {
    const root = document.getElementById('readingText');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const start = root.textContent.indexOf(phrase);
    if (start < 0) throw Error(`Missing phrase: ${phrase}`);
    const range = document.createRange();
    let offset = 0, node;
    while ((node = walker.nextNode())) {
      if (start >= offset && start < offset + node.length) range.setStart(node, start - offset);
      if (start + phrase.length > offset && start + phrase.length <= offset + node.length) {
        range.setEnd(node, start + phrase.length - offset);
        break;
      }
      offset += node.length;
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, phrase);
  assert.equal(await page.locator('#selectionHint').isEnabled(), true);
}
async function getState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('lumbre-state')));
}
async function assertFits(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'page should not scroll horizontally');
}

test('edit passage visibly updates the reader and persists after reload', async () => {
  const session = await newPage({ viewport: { width: 1440, height: 1000 } });
  const { page } = session;
  await page.locator('#editPassageBtn').click();
  assert.equal(await page.locator('#passageNameInput').inputValue(), 'La casa de la abuela');
  await page.locator('#passageNameInput').fill('My edited passage');
  await page.locator('#passageTextInput').fill('Mi abuela vive en una casa.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  assert.equal(await page.locator('#passageTitle').textContent(), 'My edited passage');
  assert.equal(await page.locator('#readingText').textContent(), 'Mi abuela vive en una casa.');
  await page.reload();
  assert.equal(await page.locator('#passageTitle').textContent(), 'My edited passage');
  await page.screenshot({ path: '.artifacts/desktop.png', fullPage: true });
  await session.close();
});

test('touch selection, Farsi suggestions, editing and bilingual flashcards persist on tablet', async () => {
  const session = await newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  const { page } = session;
  assert.equal(await page.locator('#farsiToggle').getAttribute('aria-checked'), 'false');
  await selectText(page, 'la casa de mi abuela');
  await page.locator('#selectionHint').tap();
  assert.equal(await page.locator('#translationSuggestion').inputValue(), 'my grandmother’s house');
  assert.equal(await page.locator('#farsiTranslationField').isVisible(), false);
  await page.locator('#modalFarsiToggle').tap();
  assert.equal(await page.locator('#farsiTranslationInput').inputValue(), 'خانهٔ مادربزرگم');
  assert.equal(await page.locator('#farsiTranslationInput').getAttribute('dir'), 'rtl');
  await page.locator('#saveHighlight').tap();
  assert.equal(await page.locator('#readingText mark').count(), 1);
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.locator('#readingText mark').tap();
  assert.equal(await page.locator('#modalTitle').textContent(), 'Edit saved expression');
  await page.locator('#farsiTranslationInput').fill('خانهٔ مادربزرگ من');
  await page.locator('#explanationInput').fill('A family memory');
  await page.locator('#saveHighlight').tap();
  await page.getByRole('button', { name: /^Flashcards/ }).tap();
  await page.locator('[data-action="toggle-translation"]').tap();
  assert.equal(await page.locator('.farsi-translation span').textContent(), 'خانهٔ مادربزرگ من');
  assert.equal(await page.locator('.answer-note span').textContent(), 'A family memory');
  assert.equal(await page.getByRole('button', { name: 'Edit translations & notes' }).isVisible(), true);
  await page.locator('#rightBtn').tap();
  assert.match(await page.locator('.card-label').first().textContent(), /ENGLISH → SPANISH/);
  await page.locator('[data-action="toggle-translation"]').tap();
  assert.equal(await page.locator('.farsi-translation span').textContent(), 'خانهٔ مادربزرگ من');
  await page.screenshot({ path: '.artifacts/tablet-farsi.png', fullPage: true });
  await page.reload();
  assert.equal(await page.locator('#farsiToggle').getAttribute('aria-checked'), 'true');
  assert.equal((await getState(page)).passages[0].highlights[0].translationFa, 'خانهٔ مادربزرگ من');
  await page.locator('#farsiToggle').tap();
  await page.reload();
  assert.equal(await page.locator('#farsiToggle').getAttribute('aria-checked'), 'false');
  assert.equal((await getState(page)).passages[0].highlights[0].translationFa, 'خانهٔ مادربزرگ من');
  await session.close();
});

test('selection action stays in view when reading a long passage on touch devices', async () => {
  const session = await newPage({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });
  const { page } = session;
  await page.locator('#editPassageBtn').tap();
  await page.locator('#passageTextInput').fill('Una historia larga.\n\n'.repeat(80) + 'Mi abuela.');
  await page.locator('#savePassageButton').tap();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await selectText(page, 'abuela');
  const box = await page.locator('#selectionHint').boundingBox();
  assert.ok(box.y >= 0 && box.y + box.height <= 1024, 'save selection action must be in the viewport');
  await page.locator('#selectionHint').tap();
  assert.equal(await page.locator('#selectedExpression').textContent(), 'abuela');
  assert.equal(await page.locator('#modalTitle').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#highlightModal').isVisible(), false);
  await session.close();
});

test('tablet and phone layouts keep passage switching, editing and Farsi reachable', async () => {
  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [820, 1180], [1024, 768], [1180, 820]]) {
    const session = await newPage({ viewport: { width, height }, hasTouch: true, isMobile: true });
    const { page } = session;
    await assertFits(page);
    for (const id of ['editPassageBtn', 'farsiToggle', 'newPassageBtnSmall']) {
      assert.equal(await page.locator(`#${id}`).isVisible(), true, `${id} at ${width}`);
      const box = await page.locator(`#${id}`).boundingBox();
      assert.ok(box.height >= 44, `${id} needs a touch-sized target at ${width}`);
    }
    await page.locator('#newPassageBtnSmall').tap();
    await page.locator('#passageNameInput').fill('Another passage with a longer title');
    await page.locator('#passageTextInput').fill('La puerta estaba entreabierta.');
    await page.locator('#savePassageButton').tap();
    assert.equal(await page.locator('#passageTitle').textContent(), 'Another passage with a longer title');
    await assertFits(page);
    await page.locator('[data-passage="p1"]').tap();
    assert.equal(await page.locator('#passageTitle').textContent(), 'La casa de la abuela');
    if (width === 820) await page.screenshot({ path: '.artifacts/tablet-reader.png', fullPage: true });
    await session.close();
  }
});

test('saved translations and review progress survive upgrade and passage edit', async () => {
  const state = {
    passages: [{ id: 'p1', title: 'Old passage', text: 'Una casa azul.', highlights: [
      { id: 'h1', phrase: 'casa azul', start: 4, end: 13, translation: 'A blue home, in context', translationFa: 'خانهٔ آبی', cards: { 'es-en': 3, 'en-es': 1 } }
    ] }], active: 'p1', queue: [], repeatQueue: [], settings: { farsiEnabled: true }
  };
  const session = await newPage({}, state);
  const { page } = session;
  const migrated = (await getState(page)).passages[0].highlights[0];
  assert.equal(migrated.translation, 'A blue home, in context');
  assert.equal(migrated.translationVersion, 4, 'legacy saved translations are versioned for review without being overwritten');
  await page.locator('#editPassageBtn').click();
  await page.locator('#passageTextInput').fill('Aquí hay una casa azul.');
  await page.locator('#savePassageButton').click();
  const highlight = (await getState(page)).passages[0].highlights[0];
  assert.equal(highlight.start, 13);
  assert.equal(highlight.translationFa, 'خانهٔ آبی');
  assert.deepEqual(highlight.cards, { 'es-en': 3, 'en-es': 1 });
  assert.equal(await page.locator('#readingText mark').textContent(), 'casa azul');
  await session.close();
});

test('legacy phrases that conflict with reviewed translations are preserved and flagged', async () => {
  const state = {
    passages: [{ id: 'p1', title: 'Legacy phrase', text: 'Me senté a su lado. Senté a mi abuela en la silla.', highlights: [
      { id: 'h1', phrase: 'Me senté a su lado', start: 0, end: 19, translation: 'I sat beside her', translationFa: 'کنارش نشستم', translationVersion: 2 },
      { id: 'h2', phrase: 'senté', start: 20, end: 25, translation: 'I sat down', translationFa: 'نشستم', translationVersion: 2 }
    ] }],
    active: 'p1', settings: { liveTranslationEnabled: false }
  };
  const session = await newPage({}, state);
  const { page } = session;
  const highlights = (await getState(page)).passages[0].highlights;
  assert.equal(highlights[0].translation, 'I sat beside her', 'never discard a user’s saved translation');
  assert.equal(highlights[0].translationFa, 'کنارش نشستم');
  assert.equal(highlights[0].translationVersion, 4);
  assert.equal(highlights[1].translation, 'I sat down', 'keep the old transitive verb translation visible for review');
  assert.equal(highlights[1].translationFa, 'نشستم');
  assert.equal(highlights[1].translationVersion, 4);
  assert.match(await page.locator('#toast').textContent(), /2 saved translations may need review/i);
  await session.close();
});

test('unknown phrases ask for a translation instead of inventing Farsi', async () => {
  const session = await newPage();
  const { page } = session;
  await selectText(page, 'a la casa');
  await page.locator('#selectionHint').click();
  await page.locator('#modalFarsiToggle').check();
  assert.equal(await page.locator('#farsiTranslationInput').inputValue(), '');
  assert.equal(await page.locator('#translationSuggestion').inputValue(), '');
  await page.locator('#translationSuggestion').fill('to the house');
  await page.locator('#farsiTranslationInput').fill('به خانه');
  await page.locator('#saveHighlight').click();
  assert.equal((await getState(page)).passages[0].highlights[0].translationFa, 'به خانه');
  await session.close();
});

test('audited translations distinguish verb meaning, context, and accent-sensitive words', async () => {
  const session = await newPage();
  const { page } = session;
  const actual = await page.evaluate(() => ({
    verbs: {
      despertar: verbGloss('despertar'),
      despertarse: verbGloss('despertarse'),
      sentar: verbGloss('sentar'),
      sentarse: verbGloss('sentarse'),
      levantar: verbGloss('levantar'),
      levantarse: verbGloss('levantarse'),
      acostar: verbGloss('acostar'),
      acostarse: verbGloss('acostarse'),
      convertir: verbGloss('convertir'),
      convertirse: verbGloss('convertirse'),
      desvanecer: verbGloss('desvanecer'),
      desvanecerse: verbGloss('desvanecerse'),
      adjectiveCollision: verbGloss('bajar'),
      despertarFa: offlineTranslateWordDetailed('despertar', 'fa'),
      despertarseFa: offlineTranslateWordDetailed('despertarse', 'fa'),
      sentarFa: offlineTranslateWordDetailed('sentar', 'fa'),
      sentarseFa: offlineTranslateWordDetailed('sentarse', 'fa')
    },
    words: {
      accentedEl: offlineTranslateWordDetailed('él', 'en'),
      articleEl: offlineTranslateWordDetailed('el', 'en'),
      accentedElFa: offlineTranslateWordDetailed('él', 'fa'),
      articleElFa: offlineTranslateWordDetailed('el', 'fa'),
      túFa: offlineTranslateWordDetailed('tú', 'fa'),
      tuFa: offlineTranslateWordDetailed('tu', 'fa'),
      sé: offlineTranslateWordDetailed('sé', 'en'),
      se: offlineTranslateWordDetailed('se', 'en'),
      sí: offlineTranslateWordDetailed('sí', 'en'),
      si: offlineTranslateWordDetailed('si', 'en'),
      tú: offlineTranslateWordDetailed('tú', 'en'),
      tu: offlineTranslateWordDetailed('tu', 'en'),
      cómo: offlineTranslateWordDetailed('cómo', 'en'),
      como: offlineTranslateWordDetailed('como', 'en'),
      qué: offlineTranslateWordDetailed('qué', 'en'),
      que: offlineTranslateWordDetailed('que', 'en'),
      senté: offlineTranslateWordDetailed('senté', 'en'),
      sentéFa: offlineTranslateWordDetailed('senté', 'fa'),
      bajo: offlineTranslateWordDetailed('bajo', 'en'),
      fuera: offlineTranslateWordDetailed('fuera', 'en'),
      afuera: offlineTranslateWordDetailed('afuera', 'en'),
      corto: offlineTranslateWordDetailed('corto', 'en'),
      dado: offlineTranslateWordDetailed('dado', 'en'),
      ultima: offlineTranslateWordDetailed('último', 'en'),
      ultimo: offlineTranslateWordDetailed('ultimo', 'en'),
      mi: offlineTranslateWordDetailed('mi', 'en'),
      miFa: offlineTranslateWordDetailed('mi', 'fa'),
      miAccentFa: offlineTranslateWordDetailed('mí', 'fa'),
      bebe: offlineTranslateWordDetailed('bebe', 'en'),
      bebeAccentFa: offlineTranslateWordDetailed('bebé', 'fa'),
      bañarse: offlineTranslateWordDetailed('bañarse', 'en'),
      banarse: offlineTranslateWordDetailed('banarse', 'en'),
      ve: offlineTranslateWordDetailed('ve', 'en'),
      veFa: offlineTranslateWordDetailed('ve', 'fa'),
      ven: offlineTranslateWordDetailed('ven', 'en'),
      venFa: offlineTranslateWordDetailed('ven', 'fa'),
      bajoFa: offlineTranslateWordDetailed('bajo', 'fa'),
      fueraFa: offlineTranslateWordDetailed('fuera', 'fa'),
      dadoFa: offlineTranslateWordDetailed('dado', 'fa'),
      cortoFa: offlineTranslateWordDetailed('corto', 'fa'),
      contéFa: offlineTranslateWordDetailed('conté', 'fa'),
      trabajoFa: offlineTranslateWordDetailed('trabajo', 'fa'),
      tiempoFa: offlineTranslateWordDetailed('tiempo', 'fa'),
      cariñoFa: offlineTranslateWordDetailed('cariño', 'fa'),
      porFa: offlineTranslateWordDetailed('por', 'fa'),
      juntoFa: offlineTranslateWordDetailed('junto', 'fa'),
      haberse: offlineTranslateWordDetailed('haberse', 'en')
    },
    phrases: {
      ambiguous: offlineTranslateText('se le hizo', 'en'),
      context: offlineTranslateText('se le hizo tarde', 'en'),
      satDownFa: offlineTranslateText('me senté', 'fa'),
      ambiguousSide: offlineTranslateText('Me senté a su lado.', 'en'),
      partialGuess: offlineTranslateText('La casa grande es azul.', 'en'),
      knownSentences: offlineTranslateText('Cuando llegué a la casa de mi abuela, la puerta estaba entreabierta. Entré despacio y dejé la mochila junto al perchero.', 'en'),
      fullPassageEn: offlineTranslateText(sampleText, 'en'),
      fullPassageFa: offlineTranslateText(sampleText, 'fa')
    }
  }));

  assert.equal(actual.verbs.despertar, 'to wake (someone) up');
  assert.equal(actual.verbs.despertarse, 'to wake up');
  assert.equal(actual.verbs.sentar, 'to seat (someone)');
  assert.equal(actual.verbs.sentarse, 'to sit down');
  assert.equal(actual.verbs.levantar, 'to lift; to raise');
  assert.equal(actual.verbs.levantarse, 'to get up; to stand up');
  assert.equal(actual.verbs.acostar, 'to lay (someone) down; to put (someone) to bed');
  assert.equal(actual.verbs.acostarse, 'to lie down; to go to bed');
  assert.equal(actual.verbs.convertir, 'to convert; to turn (something into something else)');
  assert.equal(actual.verbs.convertirse, 'to become; to turn into');
  assert.equal(actual.verbs.desvanecer, 'to make disappear; to dissipate');
  assert.equal(actual.verbs.desvanecerse, 'to fade away; to vanish');
  assert.equal(actual.verbs.adjectiveCollision, 'to go down; to lower', 'use the verb gloss, not the adjective gloss for bajo');
  assert.equal(actual.verbs.despertarFa, 'بیدار کردن');
  assert.equal(actual.verbs.despertarseFa, 'از خواب بیدار شدن');
  assert.equal(actual.verbs.sentarFa, 'نشاندن');
  assert.equal(actual.verbs.sentarseFa, 'نشستن');
  assert.equal(actual.words.accentedEl, 'he');
  assert.equal(actual.words.articleEl, 'the (masculine singular article)');
  assert.equal(actual.words.accentedElFa, 'او (مذکر)');
  assert.equal(actual.words.articleElFa, '', 'do not guess Farsi articles without grammatical context');
  assert.equal(actual.words.túFa, 'تو');
  assert.equal(actual.words.tuFa, 'مالِ تو (پیش از اسم)');
  assert.match(actual.words.sé, /I know/);
  assert.doesNotMatch(actual.words.se, /I know/);
  assert.equal(actual.words.sí, 'yes / oneself (after a preposition)');
  assert.equal(actual.words.si, 'if');
  assert.equal(actual.words.tú, 'you (informal)');
  assert.equal(actual.words.tu, 'your');
  assert.equal(actual.words.cómo, 'how');
  assert.equal(actual.words.como, 'I eat / as / like');
  assert.equal(actual.words.qué, 'what');
  assert.equal(actual.words.que, 'that / which / what');
  assert.equal(actual.words.senté, 'I seated someone/something', 'senté is transitive; me senté is “I sat down”');
  assert.equal(actual.words.sentéFa, 'نشاندم (کسی را/چیزی را)', 'the one-word Farsi gloss is also transitive');
  assert.equal(actual.words.bajo, 'I go down / I lower; under / low / short');
  assert.equal(actual.words.fuera, 'outside / were or went (imperfect subjunctive of ser/ir)');
  assert.equal(actual.words.afuera, 'outside', 'afuera is not a subjunctive verb form');
  assert.equal(actual.words.corto, 'short / I cut (cortar)');
  assert.equal(actual.words.dado, 'given (participle) / die (noun)');
  assert.equal(actual.words.ultima, 'last');
  assert.equal(actual.words.ultimo, '', 'do not treat unaccented ultimo as último');
  assert.equal(actual.words.mi, 'my');
  assert.equal(actual.words.miFa, 'مالِ من (پیش از اسم)');
  assert.equal(actual.words.miAccentFa, 'من (پس از حرف اضافه)');
  assert.equal(actual.words.bebe, 'drinks');
  assert.equal(actual.words.bebeAccentFa, 'نوزاد');
  assert.equal(actual.words.bañarse, 'to bathe; to take a bath');
  assert.equal(actual.words.banarse, '', 'ñ is not interchangeable with n in an exact offline lookup');
  assert.match(actual.words.ve, /go! \(tú command of ir\)/);
  assert.match(actual.words.ven, /come! \(tú command of venir\)/);
  assert.equal(actual.words.veFa, 'می‌بیند / ببین! / برو!');
  assert.equal(actual.words.venFa, 'می‌بینند / ببینید! / بیا!');
  assert.equal(actual.words.bajoFa, 'پایین می‌روم / پایین می‌آورم؛ زیر / کوتاه');
  assert.equal(actual.words.fueraFa, 'بیرون / باشم یا باشد؛ بروم یا برود (وجه التزامی)');
  assert.equal(actual.words.dadoFa, 'داده‌شده / تاس');
  assert.equal(actual.words.cortoFa, 'کوتاه / می‌بُرم');
  assert.equal(actual.words.contéFa, 'شمردم / تعریف کردم');
  assert.equal(actual.words.trabajoFa, 'کار / کار می‌کنم');
  assert.equal(actual.words.tiempoFa, 'زمان / هوا');
  assert.equal(actual.words.cariñoFa, 'عزیزم / محبت');
  assert.equal(actual.words.porFa, 'برای / از طریق / به خاطر');
  assert.equal(actual.words.juntoFa, 'کنار / با هم');
  assert.equal(actual.words.haberse, '', 'haberse needs its surrounding construction');
  assert.equal(actual.phrases.ambiguous, '', 'an incomplete se le hizo phrase is not guessed');
  assert.equal(actual.phrases.context, 'he/she ran late; it got late for him/her');
  assert.equal(actual.phrases.satDownFa, 'نشستم');
  assert.equal(actual.phrases.ambiguousSide, 'I sat down beside them', 'su does not specify gender in isolation');
  assert.equal(actual.phrases.partialGuess, '', 'unreviewed sentences are not assembled from isolated word glosses');
  assert.equal(actual.phrases.knownSentences, 'When I arrived at my grandmother’s house, the door was ajar. I went in slowly and left my backpack by the coat rack.');
  assert.match(actual.phrases.fullPassageEn, /^When I arrived at my grandmother’s house,/);
  assert.match(actual.phrases.fullPassageEn, /I sat beside her and told her everything/);
  assert.match(actual.phrases.fullPassageFa, /^وقتی به خانهٔ مادربزرگم رسیدم،/);
  assert.match(actual.phrases.fullPassageFa, /کنارش نشستم و همهٔ اتفاقاتی را/);
  await session.close();
});

test('reviewed offline matches are not silently replaced by machine translations', async () => {
  const session = await newPage();
  const { page } = session;
  let onlineRequests = 0;
  await page.route('https://api.mymemory.translated.net/**', async route => {
    onlineRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'I was seated beside him.' } })
    });
  });

  const result = await page.evaluate(() => translateChunk('me senté', 'en'));
  await page.waitForTimeout(50);
  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('lumbre-live-translation-cache-v4') || '{}')['en::me senté']);
  assert.deepEqual(result, { text: 'I sat down', source: 'offline' });
  assert.equal(onlineRequests, 0, 'a reviewed phrase should not trigger a background online overwrite');
  assert.deepEqual(cached && { text: cached.text, source: cached.source }, { text: 'I sat down', source: 'offline' });
  await session.close();
});

test('an unknown word is translated online and filled into the save form automatically', async () => {
  const state = {
    passages: [{ id: 'p1', title: 'A new word', text: 'El farol brilla.', highlights: [] }],
    active: 'p1', settings: { liveTranslationEnabled: true, liveTranslationOnline: true }
  };
  const session = await newPage({}, state);
  const { page } = session;
  const requestedWords = [];
  await page.route('https://api.mymemory.translated.net/**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    requestedWords.push(query);
    const translatedText = query === 'farol' ? 'streetlamp' : 'The streetlamp shines.';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ responseStatus: 200, responseData: { translatedText } })
    });
  });

  await selectText(page, 'farol');
  await page.locator('#selectionHint').click();
  await page.waitForFunction(() => document.querySelector('#translationSuggestion').value === 'streetlamp');
  assert.ok(requestedWords.includes('farol'), 'the selected word should be sent to the online translator');
  assert.match(await page.locator('#englishTranslationStatus').textContent(), /online translation/i);
  assert.equal(await page.locator('#saveHighlight').isEnabled(), true);
  await page.locator('#saveHighlight').click();
  assert.equal((await getState(page)).passages[0].highlights[0].translation, 'streetlamp');
  await session.close();
});

test('offline mode is stated clearly when no built-in suggestion exists', async () => {
  const state = {
    passages: [{ id: 'p1', title: 'Offline passage', text: 'La luciérnaga brilla.', highlights: [] }],
    active: 'p1', settings: { liveTranslationEnabled: true, liveTranslationOnline: true }
  };
  const session = await newPage({ viewport: { width: 320, height: 740 }, hasTouch: true, isMobile: true }, state);
  const { page } = session;
  await page.context().setOffline(true);
  await selectText(page, 'luciérnaga');
  await page.locator('#selectionHint').click();
  assert.match(await page.locator('#englishTranslationStatus').textContent(), /Offline mode/i);
  assert.equal(await page.locator('#retryEnglishTranslation').isVisible(), true);
  await assertFits(page);
  await page.locator('#translationSuggestion').fill('firefly');
  await page.locator('#saveHighlight').click();
  assert.equal((await getState(page)).passages[0].highlights[0].translation, 'firefly');
  await session.close();
});

test('service failures are explained and do not replace a manual translation', async () => {
  const state = {
    passages: [{ id: 'p1', title: 'A service hiccup', text: 'El azogue brilla.', highlights: [] }],
    active: 'p1', settings: { liveTranslationEnabled: true, liveTranslationOnline: true }
  };
  const session = await newPage({}, state);
  const { page } = session;
  let releaseFailedLookup;
  const waitForFailure = new Promise(resolve => { releaseFailedLookup = resolve; });
  await page.route('https://api.mymemory.translated.net/**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'azogue') {
      await waitForFailure;
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'The mercury shines.' } })
    });
  });

  await selectText(page, 'azogue');
  await page.locator('#selectionHint').click();
  await page.waitForFunction(() => document.querySelector('#englishTranslationStatus').textContent.includes('Looking up'));
  await page.locator('#translationSuggestion').fill('a manual meaning');
  releaseFailedLookup();
  await page.waitForFunction(() => document.querySelector('#englishTranslationStatus').textContent.includes('Could not reach'));
  assert.equal(await page.locator('#translationSuggestion').inputValue(), 'a manual meaning');
  await page.locator('#saveHighlight').click();
  assert.equal((await getState(page)).passages[0].highlights[0].translation, 'a manual meaning');
  await session.close();
});

test('actual touch taps save a word and a phrase without injecting a native selection', async () => {
  // This exercises DOM touch/pointer/click activation, not a programmatic Range.
  for (const [width, height, isMobile] of [[768, 1024, true], [1180, 820, false]]) {
    const session = await newPage({ viewport: { width, height }, hasTouch: true, isMobile });
    const { page } = session;
    assert.equal(await page.locator('#tapWordsMode').getAttribute('aria-pressed'), 'true');
    await page.locator('.reading-word').filter({ hasText: /^abuela$/ }).tap();
    assert.equal(await page.evaluate(() => window.getSelection().toString()), '');
    assert.equal(await page.locator('#selectionHint').isEnabled(), true);
    assert.match(await page.locator('#selectionSummary').textContent(), /abuela/);
    await page.locator('#selectionHint').tap();
    assert.equal(await page.locator('#selectedExpression').textContent(), 'abuela');
    assert.equal(await page.locator('#translationSuggestion').inputValue(), 'grandmother');
    await page.locator('#saveHighlight').tap();
    assert.equal((await getState(page)).passages[0].highlights[0].phrase, 'abuela');
    await page.locator('.reading-word').filter({ hasText: /^pan$/ }).tap();
    await page.locator('.reading-word').filter({ hasText: /^horneado$/ }).tap();
    assert.match(await page.locator('#selectionSummary').textContent(), /pan recién horneado/);
    await page.locator('#selectionHint').tap();
    assert.equal(await page.locator('#translationSuggestion').inputValue(), 'freshly baked bread');
    await page.locator('#saveHighlight').tap();
    await page.reload();
    assert.equal(await page.locator('#tapWordsMode').getAttribute('aria-pressed'), 'true');
    assert.equal((await getState(page)).passages[0].highlights[1].phrase, 'pan recién horneado');
    // Saved words still have their own edit action in tap mode.
    await page.locator('#readingText mark').first().tap();
    assert.equal(await page.locator('#modalTitle').textContent(), 'Edit saved expression');
    await session.close();
  }
});

test('tablet can switch all existing passages and edit both fields, including in landscape', async () => {
  const state = { passages: Array.from({ length: 12 }, (_, index) => ({
    id: `existing-${index}`, title: `Existing passage ${index + 1}`,
    text: `Mi casa. Mi abuela. Historia ${index + 1}.`, highlights: []
  })), active: 'existing-0', settings: {} };
  for (const [width, height] of [[768, 1024], [1024, 768], [1366, 1024], [390, 844]]) {
    const session = await newPage({ viewport: { width, height }, hasTouch: true, isMobile: width < 1024 }, state);
    const { page } = session;
    assert.equal(await page.locator('#passageSelect option').count(), 12);
    assert.equal(await page.locator('#passageTotal').textContent(), '(12)');
    await page.locator('#passageSelect').selectOption('existing-11');
    assert.equal(await page.locator('#readingText').textContent(), 'Mi casa. Mi abuela. Historia 12.');
    await page.locator('#editPassageBtn').tap();
    assert.equal(await page.locator('#passageNameInput').inputValue(), 'Existing passage 12');
    await page.locator('#passageNameInput').fill('Renamed on tablet');
    await page.locator('#passageTextInput').fill('La puerta estaba entreabierta.');
    await page.locator('#savePassageButton').tap();
    await page.reload();
    assert.equal(await page.locator('#passageSelect').inputValue(), 'existing-11');
    assert.equal(await page.locator('#passageSelect option:checked').textContent(), 'Renamed on tablet');
    assert.equal(await page.locator('#readingText').textContent(), 'La puerta estaba entreabierta.');
    await assertFits(page);
    if (width === 768) await page.screenshot({ path: '.artifacts/tablet-v1.2-passages.png', fullPage: true });
    await session.close();
  }
});

test('tap selection preserves repeated-word offsets and clears on passage change', async () => {
  const state = { passages: [
    { id: 'one', title: 'Repeated words', text: 'casa, casa.\n\nMi abuela.', highlights: [] },
    { id: 'two', title: 'Other passage', text: 'casa', highlights: [] }
  ], active: 'one', settings: {} };
  const session = await newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true }, state);
  const { page } = session;
  assert.equal(await page.locator('#readingText').textContent(), state.passages[0].text);
  await page.locator('.reading-word').filter({ hasText: /^casa$/ }).nth(1).tap();
  await page.locator('#selectionHint').tap();
  await page.locator('#saveHighlight').tap();
  let saved = (await getState(page)).passages[0].highlights[0];
  assert.equal(saved.start, 6);
  assert.equal(saved.end, 10);
  await page.locator('.reading-word').filter({ hasText: /^abuela$/ }).tap();
  await page.locator('#passageSelect').selectOption('two');
  assert.equal(await page.locator('#selectionHint').isEnabled(), false);
  assert.equal(await page.locator('#selectionSummary').textContent(), 'No words selected');
  assert.equal((await getState(page)).passages[1].highlights.length, 0);
  await page.locator('#nativeSelectionMode').tap();
  await page.reload();
  assert.equal(await page.locator('#nativeSelectionMode').getAttribute('aria-pressed'), 'true');
  await session.close();
});

test('native selection survives collapse before save and late events cannot reopen the editor', async () => {
  const session = await newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  const { page } = session;
  await selectText(page, 'la casa de mi abuela');
  // Simulate native handle/callout ordering separately from real tap tests.
  await page.evaluate(() => {
    window.getSelection().removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.locator('#selectionHint').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 4, clientX: 100, clientY: 100 });
  await page.locator('#selectionHint').dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 4, clientX: 100, clientY: 100 });
  assert.equal(await page.locator('#highlightModal').isVisible(), false, 'do not open on pointerup and risk retargeting the click');
  await page.locator('#selectionHint').tap();
  assert.equal(await page.locator('#highlightModal').isVisible(), true);
  assert.equal(await page.locator('#selectedExpression').textContent(), 'la casa de mi abuela');
  // A following synthetic click must not overwrite edits by reopening the modal.
  await page.locator('#translationSuggestion').fill('My custom meaning');
  await page.locator('#selectionHint').dispatchEvent('click');
  assert.equal(await page.locator('#translationSuggestion').inputValue(), 'My custom meaning');
  await page.locator('#cancelModal').click();
  await page.waitForTimeout(800); // Deliberately wait beyond deferred native selection captures.
  assert.equal(await page.locator('#selectionSummary').textContent(), 'No words selected');
  assert.equal(await page.locator('#highlightModal').isVisible(), false);
  assert.equal(await page.locator('#selectionHint').isEnabled(), true, 'native save remains tappable to retry capturing selection');
  await page.locator('#selectionHint').click();
  assert.equal(await page.locator('#highlightModal').isVisible(), false);
  assert.match(await page.locator('#toast').textContent(), /Tap words/);
  await session.close();
});

test('reverse phrase taps preserve punctuation, reject overlap, and Clear resets selection', async () => {
  const state = { passages: [{ id: 'one', title: 'Tap ranges', text: 'casa, mi abuela.', highlights: [] }], active: 'one', settings: {} };
  const session = await newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true }, state);
  const { page } = session;
  await page.getByRole('button', { name: 'abuela', exact: true }).tap();
  await page.getByRole('button', { name: 'casa', exact: true }).tap();
  assert.equal(await page.locator('#selectionSummary').textContent(), '“casa, mi abuela”');
  await page.locator('#clearSelectionBtn').tap();
  assert.equal(await page.locator('.tap-selected').count(), 0);
  await page.getByRole('button', { name: 'abuela', exact: true }).tap();
  await page.locator('#selectionHint').tap();
  await page.locator('#saveHighlight').tap();
  await page.getByRole('button', { name: 'casa', exact: true }).tap();
  await page.locator('#nativeSelectionMode').tap();
  await selectText(page, 'casa, mi abuela');
  await page.locator('#selectionHint').tap();
  assert.equal(await page.locator('#highlightModal').isVisible(), false);
  assert.match(await page.locator('#selectionSummary').textContent(), /overlaps/);
  await session.close();
});

/* --- Verb flashcards --- */
async function saveExpression(page, phrase, translation) {
  await selectText(page, phrase);
  await page.locator('#selectionHint').click();
  await page.locator('#translationSuggestion').fill(translation);
  await page.locator('#saveHighlight').click();
  await page.locator('#highlightModal.open').waitFor({ state: 'detached' });
}
async function openVerbs(page) {
  await page.getByRole('button', { name: /^Verbs/ }).click();
  await page.locator('#verbsView.active').waitFor();
}
async function verbRows(page) {
  return page.locator('#verbCard tbody tr').evaluateAll(rows => rows.map(row => [...row.children].map(cell => cell.textContent.trim())));
}

test('every built-in verb flashcard has an English gloss and displays it on the answer', async () => {
  const state = {
    passages: [{ id: 'p1', title: 'Verb gloss coverage', text: 'Ella abraza a su abuela.', highlights: [] }],
    active: 'p1', settings: { liveTranslationEnabled: false },
    verbs: [{ id: 'v1', lemma: 'abrazar', regular: true, sources: [], manual: true, cards: { conjugate: 0, identify: 0 }, learned: false }],
    verbQueue: [], verbRepeatQueue: [], verbRound: 1, customVerbs: []
  };
  const session = await newPage({}, state);
  const { page } = session;
  const coverage = await page.evaluate(() => ({
    count: window.spanishVerbBank.all().length,
    missing: window.spanishVerbBank.all().filter(entry => !verbGloss(entry.infinitive)).map(entry => entry.infinitive),
    reflexiveMeanings: ['aburrirse', 'acordarse', 'arrepentirse', 'divertirse', 'enfermarse', 'enojarse', 'quejarse'].map(verbGloss)
  }));
  assert.equal(coverage.count, 432);
  assert.deepEqual(coverage.missing, []);
  assert.deepEqual(coverage.reflexiveMeanings, [
    'to get bored', 'to remember', 'to repent; to regret', 'to have fun',
    'to get sick', 'to get angry', 'to complain'
  ]);

  await openVerbs(page);
  assert.equal(await page.locator('#verbCard .verb-prompt').textContent(), 'to hug; to embrace');
  await page.locator('[data-verb-action="toggle"]').click();
  assert.match(await page.locator('#verbCard .verb-answer').textContent(), /to hug; to embrace/);
  await session.close();
});

test('a custom verb without a gloss is not presented as an English translation', async () => {
  const state = {
    passages: [{ id: 'p1', title: 'Custom verb', text: 'Teletrabajo desde casa.', highlights: [] }],
    active: 'p1', settings: { liveTranslationEnabled: false }, customVerbs: ['teletrabajar'],
    verbs: [{ id: 'v1', lemma: 'teletrabajar', regular: true, sources: [], manual: true, cards: { conjugate: 0, identify: 0 }, learned: false }],
    verbQueue: [], verbRepeatQueue: [], verbRound: 1
  };
  const session = await newPage({}, state);
  const { page } = session;
  await openVerbs(page);
  await page.locator('[data-verb-action="toggle"]').click();
  assert.equal(await page.locator('#verbCard .verb-answer b').textContent(), 'English gloss not available for this custom verb.');
  assert.match(await page.locator('#verbCard .verb-answer>span').textContent(), /Spanish infinitive: teletrabajar/);

  await page.locator('#addVerbInput').fill('teletrabajar');
  await page.locator('#addVerbGlossInput').fill('to telework');
  await page.locator('#addVerbForm button[type="submit"]').click();
  assert.equal(await page.locator('#verbCard .verb-prompt').textContent(), 'to telework');
  assert.match(await page.locator('#verbCard .verb-answer b').textContent(), /to telework/);
  await page.reload();
  await openVerbs(page);
  assert.equal(await page.locator('#verbCard .verb-prompt').textContent(), 'to telework');
  assert.equal((await getState(page)).customVerbGlosses.teletrabajar, 'to telework');
  await session.close();
});

test('saving a regular verb adds a first-person verb card', async () => {
  const session = await newPage();
  const { page } = session;
  await saveExpression(page, 'llegué', 'I arrived');
  assert.match(await page.locator('#toast').textContent(), /1 verb card added \(llegar\)/);
  assert.equal(await page.locator('#verbNavCount').textContent(), '1');
  await openVerbs(page);
  assert.equal(await page.locator('#verbCard .card-word').textContent(), 'llegar');
  assert.match(await page.locator('#verbCard .card-label').first().textContent(), /CONJUGATE · REGULAR VERB/);
  await page.locator('[data-verb-action="toggle"]').click();
  assert.match(await page.locator('#verbCard .verb-table caption').textContent(), /Regular verb/);
  const rows = await verbRows(page);
  assert.deepEqual(rows, [
    ['To-be form', 'llegar'],
    ['yo', 'llego', 'llegué']
  ], 'a regular verb card shows only the infinitive and the first person');
  await page.screenshot({ path: '.artifacts/verb-card-regular.png', fullPage: true });
  await session.close();
});

test('saving an irregular verb adds every person for present and past', async () => {
  const session = await newPage();
  const { page } = session;
  await saveExpression(page, 'le conté', 'I told him');
  assert.match(await page.locator('#toast').textContent(), /1 verb card added \(contar\)/);
  await openVerbs(page);
  await page.locator('.verb-memory-button', { hasText: 'contar' }).click();
  assert.match(await page.locator('#verbCard .card-label').first().textContent(), /CONJUGATE · IRREGULAR VERB/);
  await page.locator('[data-verb-action="toggle"]').click();
  assert.match(await page.locator('#verbCard .verb-table caption').textContent(), /Irregular verb/);
  const rows = await verbRows(page);
  assert.deepEqual(rows, [
    ['To-be form', 'contar'],
    ['yo', 'cuento', 'conté'],
    ['tú', 'cuentas', 'contaste'],
    ['él / ella / usted', 'cuenta', 'contó'],
    ['nosotros/as', 'contamos', 'contamos'],
    ['vosotros/as', 'contáis', 'contasteis'],
    ['ellos / ellas / ustedes', 'cuentan', 'contaron']
  ]);
  await page.screenshot({ path: '.artifacts/verb-card-irregular.png', fullPage: true });
  await session.close();
});

test('a saved expression without a known verb creates no verb card', async () => {
  const session = await newPage();
  const { page } = session;
  await saveExpression(page, 'la casa de mi abuela', 'my grandmother’s house');
  assert.equal(await page.locator('#toast').textContent(), 'Translation added to your flashcards');
  assert.equal(await page.locator('#verbNavCount').textContent(), '0');
  await openVerbs(page);
  assert.match(await page.locator('#verbCard .empty-state h2').textContent(), /No verbs here yet/);
  await session.close();
});

test('a verb is learned after five correct answers in each direction', async () => {
  const session = await newPage({}, {
    passages: [{ id: 'p1', title: 'Hablar', text: 'Hablo español.', highlights: [] }],
    active: 'p1', queue: [], repeatQueue: [], round: 1,
    settings: { farsiEnabled: false, liveTranslationEnabled: false },
    verbs: [{ id: 'v1', lemma: 'hablar', regular: true, sources: [], manual: true, cards: { conjugate: 4, identify: 4 }, learned: false }],
    verbQueue: [], verbRepeatQueue: [], verbRound: 1, customVerbs: []
  });
  const { page } = session;
  await openVerbs(page);
  assert.equal(await page.locator('#verbCard .card-word').textContent(), 'hablar');
  assert.match(await page.locator('#verbCard .card-label').last().textContent(), /Card 1 of 2/);
  await page.locator('#verbRightBtn').click();
  assert.match(await page.locator('#toast').textContent(), /this direction is set/);
  await page.locator('[data-verb-action="toggle"]').click();
  assert.match(await page.locator('#verbCard .card-label').first().textContent(), /WHICH VERB IS THIS\?/);
  assert.match(await page.locator('#verbCard .card-label').last().textContent(), /Card 2 of 2/);
  await page.locator('#verbRightBtn').click();
  assert.match(await page.locator('#toast').textContent(), /hablar is learned in both directions/);
  assert.match(await page.locator('#verbCard .empty-state h2').textContent(), /Your verb practice is clear/);
  assert.match(await page.locator('#verbMemoryList').textContent(), /learned|hablar/);
  assert.equal((await getState(page)).verbs[0].learned, true);
  await session.close();
});

test('readers can add their own verbs and they survive a reload', async () => {
  const session = await newPage();
  const { page } = session;
  await openVerbs(page);
  await page.locator('#addVerbInput').fill('teletrabajar, volver');
  await page.locator('#addVerbGlossInput').fill('to telework; to return');
  await page.locator('#addVerbForm button[type="submit"]').click();
  assert.match(await page.locator('#toast').textContent(), /2 verbs in your practice: teletrabajar, volver/);
  assert.equal(await page.locator('#verbNavCount').textContent(), '2');
  await page.locator('.verb-memory-button', { hasText: 'teletrabajar' }).click();
  assert.equal(await page.locator('#verbCard .verb-prompt').textContent(), 'to telework');
  await page.locator('[data-verb-action="toggle"]').click();
  assert.deepEqual(await verbRows(page), [
    ['To-be form', 'teletrabajar'],
    ['yo', 'teletrabajo', 'teletrabajé']
  ]);
  await page.locator('.verb-memory-button', { hasText: 'volver' }).click();
  assert.equal(await page.locator('#verbCard .verb-prompt').textContent(), 'to return; to come back');
  await page.locator('[data-verb-action="toggle"]').click();
  assert.match(await page.locator('#verbCard .card-label').first().textContent(), /IRREGULAR VERB/);
  assert.deepEqual((await verbRows(page))[1], ['yo', 'vuelvo', 'volví']);
  await page.reload();
  await openVerbs(page);
  assert.equal(await page.locator('.verb-memory-item').count(), 2);
  const persisted = await getState(page);
  assert.deepEqual(persisted.customVerbs.sort(), ['teletrabajar', 'volver']);
  assert.deepEqual(persisted.customVerbGlosses, { teletrabajar: 'to telework' });
  await session.close();
});

test('verb cards are removed from practice and persist with the passage', async () => {
  const session = await newPage();
  const { page } = session;
  await saveExpression(page, 'Me senté', 'I sat down');
  await openVerbs(page);
  assert.equal(await page.locator('#verbCard .card-word').textContent(), 'sentarse');
  await page.locator('[data-verb-action="toggle"]').click();
  assert.deepEqual((await verbRows(page))[1], ['yo', 'siento', 'senté']);
  await page.locator('[data-verb-remove]').click();
  assert.equal(await page.locator('.verb-memory-item').count(), 0);
  assert.equal(await page.locator('#verbNavCount').textContent(), '0');
  await page.reload();
  await openVerbs(page);
  // The expression is still saved, so the backfill brings the verb card back.
  assert.equal(await page.locator('#verbCard .card-word').textContent(), 'sentarse');
  await session.close();
});

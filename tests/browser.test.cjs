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
  assert.equal((await getState(page)).passages[0].highlights[0].translation, 'A blue home, in context');
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

# Lumbre reading support

A static Spanish reading studio with editable passages, saved expressions, two-way flashcards, and optional Farsi translations.

## Use

- **Choose passage** lists every passage saved in this browser; **Edit name & text** opens both fields. Tap a saved highlight to edit its translations and notes, or use **Edit translations & notes** on a revealed flashcard.
- Turn on **Farsi** in the header or in the expression editor. Known words and exact phrases have editable suggestions; unmatched text requires a manually entered translation. No external translation service is configured.
- On touch devices, **Tap words** is the default (also when requesting a desktop site): tap a word, or tap the first and last words of a phrase, then tap **Add to flashcards**. **Select text** keeps native touch-and-hold/drag selection available. The last valid selection survives native selection collapse when pressing Save. Clear selection or change passages to discard it.
- Data is stored in `localStorage` in the current browser, on the current site origin. The preview and published website do not share saved passages. Do not clear browser site data to refresh the app.

## Local preview

Run `npm start` (Python 3 required), then visit port 3000. The server binds to `0.0.0.0` and disables caching. No Node dependencies are needed just to serve the app.

## Tests

With Node 22.17+ on Linux x64/arm64: `npm ci && npm test`.
The browser tests use bundled Chromium, exercise desktop and touch-emulated tablet/phone sizes, and save ignored screenshots in `.artifacts/`. Native iPad Safari selection handles and the on-screen keyboard still require a physical-device check.

## Publishing

GitHub Pages must serve the repository **root**, not `/docs`. The previous configuration pointed at the original app's branch and a nonexistent `/docs` folder, so later changes on `main` were never published.

For this Arena session, the intended publishing source is `arena/9dfab68f-reading-support` at `/`. The branch has been pushed, but the GitHub integration returned HTTP 403 when updating the Pages settings. A repository administrator must open **Settings → Pages → Build and deployment**, select **Deploy from a branch**, choose `arena/9dfab68f-reading-support` and **/(root)**, and click **Save**. The latest check shows the folder is now `/`, but the branch is still the original `arena/39cbdd71-reading-support`; PR #4 remains open. Until the branch is changed, the public site remains on the old code. Alternatively, merge PR #4 then select `main` at `/(root)`. Push subsequent updates to this session branch. The visible footer and asset query strings identify this release as `v1.2.0`. Bump both when shipping future asset changes. `.nojekyll` enables direct static publishing.

The 11 browser tests include real Playwright touch taps (no injected selection) for the tap-word path, separate simulated native-range lifecycle regressions, 12 pre-existing passages, editing both fields, and persistence. These are Chromium tests, not proof of native iPad Safari behavior.

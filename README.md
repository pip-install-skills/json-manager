# Local JSON Manager

Offline-first JSON viewer, formatter, validator, and query tool designed as a private replacement for online JSON viewer sites.

## Core guarantees

- Runs fully in the browser.
- No runtime API requests, telemetry, or data upload code.
- File import is local-only (`File` API); export writes a local `Blob`.
- The built bundle contains no `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, or `sendBeacon` call — verifiable by grepping `dist/`.

## Features

- Tree view with expand/collapse, per-node copy of the value or its path, and a search filter that keeps matches plus the ancestors needed to reach them.
- Format with 2-space, 4-space, or tab indentation, and minify to remove all whitespace.
- Validation that reports the exact line, column, and offending character, with a "jump to error" action that selects the spot in the editor.
- Repair for almost-JSON: comments, single and typographic quotes, unquoted keys and values, trailing and missing commas, Python/JavaScript literals (`True`, `None`, `undefined`, `NaN`, `Infinity`), hex and leading-zero numbers, and truncated documents.
- JSONPath queries over a useful subset: properties, indices, negative indices, unions, slices with step, wildcards, and recursive descent (`..`). Each match reports a canonical path and an RFC 6901 JSON Pointer.
- Statistics: node counts by type, object/array/property totals, unique keys, maximum depth, size in bytes, line count, and the savings from minifying.
- Sort object keys A–Z or Z–A, recursively.
- Escape and unescape JSON as a string literal, for pasting into source code.
- Load from a local file or drag and drop onto the editor.
- Light/dark mode toggle with saved user preference.

## Why a hand-written parser

The document is parsed by a recursive-descent parser in `src/lib/jsonEngine.ts` rather than `JSON.parse`, because the tool needs things the built-in parser discards:

- **Key order is preserved as written.** `JSON.parse` returns an object, and JavaScript reorders integer-like keys ahead of the rest, so `{"10":1,"2":2}` would display in the wrong order.
- **Duplicate keys survive.** `JSON.parse` silently keeps the last one; here every occurrence is kept and reported as a warning with its path.
- **Number text is exact.** `9007199254740993` and `1.50` round-trip as written instead of becoming `9007199254740992` and `1.5`.
- **Errors carry a position.** Engine error messages differ per browser and rarely give a usable line and column.

## Tech stack

- React 19 + TypeScript
- Vite 8
- No runtime dependencies beyond React — the parser, JSONPath evaluator, repair scanner, and tree model are all local code
- ESLint for code quality
- Vitest for unit tests

## Scripts

```bash
npm install
npm run dev
npm run lint
npm run test
npm run build
```

## Deploy to GitHub Pages

This project is configured for GitHub Pages via GitHub Actions using:

- `.github/workflows/deploy-pages.yml`
- dynamic Vite base path from `VITE_BASE_PATH` (auto-set in the workflow)

Steps:

1. Push this code to a GitHub repository.
2. In GitHub, open `Settings -> Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to `main` (or `master`) and the workflow deploys automatically.
5. Your site URL will be `https://<owner>.github.io/<repo>/`.

The workflow runs `npm run lint`, `npm run test`, and `npm run build` before publishing, so a failing check blocks the deploy.

## Privacy notes

- The app includes a restrictive CSP in `index.html` (including `connect-src 'self'`) and does not reference external assets, fonts, or scripts.
- Vite's module-preload polyfill is disabled in `vite.config.ts`. The app ships as a single chunk that has nothing to preload, and removing it leaves a bundle with no network-request code at all.
- For production/local usage, run `npm run build` and serve the `dist/` directory from a local web server. Opening `dist/index.html` directly as a `file://` URL does not work: the bundle is an ES module, and browsers block module scripts loaded from a file origin. Any static server will do, and it never needs to be online.

## A note on dependency versions

This project mirrors the toolchain of its sibling [Local Diff Checker](https://github.com/pip-install-skills/diffchecker) with one deliberate difference: `@testing-library/jest-dom` is on v7 rather than v6. v6 is incompatible with Vitest 4.1.11 and fails at setup time with `Cannot read properties of undefined (reading 'config')`, collecting zero tests.

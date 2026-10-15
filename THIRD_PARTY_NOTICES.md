# Third-party notices

## Marin App Shell

This app vendors the complete, unmodified Marin App Shell distribution in
`vendor/marinos/`. Its version, Marin UI baseline, and release-file hashes are
recorded in `vendor/marinos/manifest.json`.

Keep the notices distributed with that release:

- `vendor/marinos/licenses/MARIN_APP_SHELL_LICENSE.txt`
- `vendor/marinos/licenses/LUCIDE_LICENSE.txt`
- `vendor/marinos/licenses/OPEN_SANS_OFL.txt`

`vendor/marinos/marinos.css` includes the Pico CSS baseline and its embedded
license attribution. Do not strip release notices.

## Existing application font assets

Font assets remain under `vendor/fonts/`, outside the replaceable shell
directory. Retain their accompanying license information, including
`vendor/fonts/open-sans/OFL.txt`.

## Papa Parse

Marin CSV vendors Papa Parse 5.7.0 under the MIT License at
`vendor/third-party/papaparse.min.js`. Retain
`vendor/third-party/PAPAPARSE_LICENSE.txt`.

## Tabulator

Marin CSV vendors Tabulator 6.6.1 under the MIT License at:

- `vendor/third-party/tabulator.min.js`
- `vendor/third-party/tabulator.min.css`

Retain `vendor/third-party/TABULATOR_LICENSE.txt`.

## Integrity records

`vendor/third-party/vendor-manifest.json` records the reviewed versions, file
sizes, and SHA-256 values. `package-lock.json` records the npm dependency graph.
Use `scripts/vendor-dependencies.mjs` to refresh these files; do not edit the
vendored distributions or integrity records by hand.

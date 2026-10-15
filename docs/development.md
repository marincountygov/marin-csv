# Marin CSV development guide

## Runtime

Marin CSV is a static HTML/CSS/JavaScript application with no production build
step or server runtime. Serve it from an HTTP origin:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Do not use `file://` for release testing. Workers, native IndexedDB, App Shell
metadata, CSP, and persistent-profile recovery require a normal origin.

## Source layout

```text
index.html                         Application markup and ordered scripts
assets/app.js                      Workflow, dialogs, recovery UI, commands
assets/app.css                     App-owned presentation
assets/csv-engine.js               Authoritative preservation model and snapshots
assets/document-loader.js          Worker/direct parsing route
assets/csv-worker.js               Same-origin parsing worker
assets/large-file-policy.js        Standard/paged/preview classifier
assets/tabulator-adapter.js        Grid-to-document boundary
assets/workspace-state.js          Normal/expanded UI state
assets/recovery-store.js           IndexedDB and deterministic memory store
assets/recovery-coordinator.js     Journal, checkpoints, leases, startup recovery
scripts/benchmark-large-files.js   Parser/model memory and timing evidence
scripts/benchmark-recovery.js      Recovery snapshot/journal benchmark
scripts/benchmark-browser.py       Chromium interaction benchmark
scripts/vendor-dependencies.mjs    Deterministic vendoring/checksums
scripts/sync-security-meta.py      Generated security metadata
tests/test_recovery_engine.js      Snapshot/hydration/command tests
tests/test_recovery_store.js       IndexedDB transaction helper tests
tests/test_recovery_coordinator.js Journal, lease, fallback, failure tests
tests/browser_recovery.py          Memory and native IndexedDB browser flows
```

## Authority boundaries

- `csv-engine.js` owns bytes, exact strings, physical order, history, and
  serialization.
- Papa Parse is an independent validator, not the serializer.
- Tabulator is a visual interaction layer, never the export source.
- `recovery-store.js` persists records but contains no CSV interpretation.
- `recovery-coordinator.js` owns revisions and storage scheduling but cannot
  synthesize document state outside engine snapshots and commands.
- Workspace mode is transient UI state and never enters recovery metadata.

## Recovery development rules

- Do not write CSV contents to `localStorage`, `sessionStorage`, URLs, logs,
  analytics, or network requests.
- `sessionStorage` may hold only `marinCsv.tabSessionId` and
  `marinCsv.activeDocumentId`.
- Every engine mutation must emit a deterministic forward command if it changes
  recoverable state.
- Do not advance safe status before an IndexedDB transaction completes.
- Journal writes for one document must remain serialized and contiguous.
- Revision comparison, lease validation, and write must remain in one
  read/write transaction.
- Keep the newest two snapshots and the journal needed by the older retained
  snapshot.
- Do not silently delete corrupt or unsupported records.
- Active deletion must invalidate pending writes and remain suspended until an
  explicit resume action.
- `BroadcastChannel` is advisory only; IndexedDB is the source of truth.
- Database schema, source format, snapshot format, and journal format require
  independent versioning and migration review.

## IndexedDB testing

`MemoryRecoveryStore` exists for deterministic Node and policy-restricted
browser tests. It does not prove browser persistence.

The required native test uses an actual HTTP origin and persistent Chromium
profile:

```bash
python3 tests/browser_recovery.py
```

It covers native IndexedDB, confirmed-refresh restoration, second-tab conflict,
independent copy, browser-profile restart, and privacy-preserving chooser
behavior. The in-memory counterpart is:

```bash
python3 tests/browser_recovery.py --in-memory
```

## Dependencies

Exact pins:

- `papaparse` 5.7.0
- `tabulator-tables` 6.6.1

Production uses committed files under `vendor/third-party/`; no runtime CDN.
Refresh with:

```bash
npm ci
npm run vendor
```

Review all distributions, notices, checksums, lockfile changes, scans, and
browser results.

## Verification

```bash
bash scripts/check.sh
bash scripts/check.sh --browser-in-memory
bash scripts/check.sh --browser
```

The final command is mandatory in a localhost-permitted environment. Automated
tests do not establish WCAG 2.2 AA conformance. Complete the manual checklist
in `docs/csv-4-manual-review.md` before changing the Alpha status.

## Benchmarks

```bash
node --expose-gc scripts/benchmark-recovery.js
python3 scripts/benchmark-browser.py
```

The Node recovery benchmark uses the production coordinator and deterministic
memory store. It is architecture evidence, not native IndexedDB timing.

## Packaging

Release archives must contain one top-level `marin-csv/` directory and exclude
`.git`, `node_modules`, caches, logs, temporary browser profiles, and generated
screenshots. Verify the clean extracted archive, then publish the ZIP,
SHA-256, verification log, findings, test report, and manual checklist.

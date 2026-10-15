# CSV-2 verification report

Date: 2026-10-14  
Build: `0.1.0-csv.2`  
Status: Alpha

## Result

CSV-2 passes the available static, metadata, security, syntax, preservation,
large-file policy, worker-loader, Papa Parse, Tabulator-adapter, in-memory
Chromium workflow, App Shell component, CSP fixture, responsive rendering, and
benchmark checks.

CSV-1 human review passed before CSV-2 work began. CSV-2's new worker, paging,
preview, progress, and large-document states require a new human review before
release.

## Automated verification

| Area | Result | Evidence |
|---|---|---|
| Static/template validation | PASS | HTML, script order, local assets, docs, CSS boundary, version metadata |
| App Shell integrity | PASS | App Shell 1.12.2 and managed companion manifest |
| Third-party integrity | PASS | Papa Parse 5.7.0 and Tabulator 6.6.1 versions, licenses, byte counts, SHA-256 records, lockfile |
| Security metadata | PASS | `security.json`, generated meta CSP/referrer policy, `security.txt`, same-origin worker policy |
| JavaScript/Python syntax | PASS | Application, worker, benchmarks, and test sources |
| Node tests | PASS | 59 tests, 0 failures |
| CSV browser workflow | PASS in in-memory fixture | Real Papa Parse, Tabulator, standard/paged/preview workflows |
| App Shell browser fixture | PASS | Component routes, shell, responsive behavior |
| Browser CSP fixture | PASS | Allowed feeds/data image; blocked unapproved connections, scripts, handlers, and styles |
| Node benchmark | PASS | Five isolated cases with heap and RSS evidence |
| Chromium benchmark | PASS | Standard, paged, and preview interaction timing in component fixture |

## Node coverage

The 59 passing tests cover:

- exact untouched-byte output;
- string-only fields and type-like values;
- comma/TSV detection and explicit delimiter choice;
- quoted delimiters, escaped quotes, and multiline values;
- BOM, newline, final-newline, raw-row, and quote-preference preservation;
- row, column, paste, find/replace, header, undo, and redo commands;
- invalid UTF-8, malformed quoting, warnings, and parser disagreement;
- empty, header-only, blank-record, null-byte, and unusual-Unicode cases;
- full and preview transfer reconstruction;
- default snapshot transfer versus explicit move/adopt transfer;
- repeated download naming;
- bounded warning collection;
- standard, paged, and preview classification boundaries;
- low-byte/high-row preflight;
- worker eligibility, URL, transfer list, progress, result, termination, and
  structured errors;
- real Papa Parse agreement and deterministic generated CSV/TSV probes;
- real Tabulator column, editor, paste, filter, sort, focus, paging, read-only,
  and ARIA-selection behavior; and
- variable-height grid configuration.

## Browser workflow coverage

The successful in-memory Chromium workflow verifies:

- preservation-sensitive sample values;
- real Tabulator grid semantics and accessible name/dimensions;
- no-op and intentional multiline edits;
- range selection, clipboard text, block paste, undo, and focus restoration;
- row/column insertion and deletion;
- view-only standard sorting and filtering;
- find/replace validation;
- header-mode changes;
- exact untouched and convention-preserving edited downloads;
- TSV, invalid UTF-8, and parser-disagreement handling;
- malicious header and cell values rendered literally;
- paged editing with physical coordinates and full-file download;
- bounded internal vertical scrolling and responsive maximum height;
- low-byte/high-row read-only preview;
- exact-copy and repeated preview downloads;
- selected-range accessibility state and live summary;
- desktop light, mobile dark, and 320-pixel light layouts; and
- absence of CSV-derived external requests.

## Benchmarks

The final benchmark reports are:

- [`csv-2-benchmark-results.md`](csv-2-benchmark-results.md)
- [`csv-2-browser-benchmark-results.md`](csv-2-browser-benchmark-results.md)

The Node benchmark runs each case in a separate process with `--expose-gc`. It
records retained V8 heap and process RSS rather than claiming a true operating
system peak. The Chromium benchmark uses the in-memory component fixture and
therefore includes real Papa Parse, Tabulator, DOM, and interaction work but not
the same-origin worker or HTTP asset timing.

## Environment limitation

The managed Chromium runtime in this execution environment blocks navigation to
the local HTTP test origin with:

```text
net::ERR_BLOCKED_BY_ADMINISTRATOR
```

Consequently, these items are not verified here:

- normal HTTP asset loading;
- actual same-origin worker startup and `importScripts` loading;
- worker-backed timing in Chromium;
- deferred-script timing in the ordinary document;
- the application's CSP in its normal origin;
- cross-origin Referer delivery from the real app page; and
- App Shell identity-link reload behavior.

The repository retains the deterministic command:

```bash
bash scripts/check.sh --browser
```

That command is a release gate in an environment where localhost browser
navigation is permitted. The HTTP browser test now explicitly expects a request
for `assets/csv-worker.js` and verifies that metadata identifies the local Web
Worker path.

## Manual review still required

CSV-2 does not establish WCAG 2.2 AA conformance or a universal maximum file
size. Required human work includes:

- keyboard-only review;
- browser-computed accessibility-tree review;
- screen-reader testing;
- 200% and 400% zoom/reflow;
- forced-colors and numerical contrast review;
- cross-browser and touch testing;
- normal-origin worker and CSP review;
- manual preservation tests with approved synthetic fixtures; and
- benchmark confirmation on intended managed hardware.

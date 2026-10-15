# CSV-0 verification report

Date: 2026-10-13  
Build status: working feasibility build; not a production release

## Scope

This report records the checks executed against the CSV-0 source tree. It
covers the custom preservation engine, the Tabulator adapter contract, MarinOS
static integration, security metadata, and browser-level reference-mode
workflows.

The package intentionally does not contain the reviewed Papa Parse 5.7.0 or
Tabulator 6.6.1 distribution bytes. The exact dependencies are declared and an
exact-version vendoring workflow is included, but the producing environment
could not reach the package registry or upstream repositories. Actual-library
integration therefore remains a production gate.

## Automated result summary

| Area | Result | Evidence |
| --- | --- | --- |
| Preservation engine | PASS | 26 Node tests |
| Tabulator adapter contract | PASS | 5 Node tests using a controlled adapter double |
| Combined Node suite | PASS | 31 tests, 0 failures |
| JavaScript syntax | PASS | All application, script, test, and placeholder JavaScript parsed by `node --check` |
| Template and local-resource validation | PASS | Static validator, shell manifest, local asset, CSS-boundary, metadata, and documentation checks |
| Security metadata | PASS | 14 Python tests plus generated-file synchronization check |
| CSV browser workflow | PASS with environment limitation | In-memory Chromium reference-mode workflow |
| Marin App Shell fixture | PASS with environment limitation | In-memory Chromium component fixture |
| Browser CSP enforcement | PASS with environment limitation | In-memory Chromium policy fixture |

## Preservation-engine coverage

The 26 model tests verify:

- every parsed field remains a JavaScript string;
- leading zeros, long digit strings, date-like text,
  scientific-notation-like text, Boolean-like text, null-like text, and
  formula-like text remain literal;
- comma and tab detection is deterministic;
- UTF-8 BOM, CRLF, LF, CR, final newline, and no-final-newline cases;
- quoted delimiters, escaped quotes, and embedded line endings;
- trailing empty fields, short records, and blank records;
- exact original-byte download when the document is untouched;
- preservation of unchanged raw rows after another row is edited;
- preservation of a short row's raw representation when a deleted column was
  not present in that row;
- header mode without an implicit file edit;
- cell, row, column, and block-paste edits;
- safe handling of invalid edit coordinates and non-finite insertion indexes;
- spreadsheet-style clipboard payloads whose final line ending is a record
  terminator rather than an additional blank row;
- undo, redo, downloaded-state tracking, and redo-branch invalidation;
- find and replace with literal replacement text and supported options;
- blocking behavior when the independent parser reports errors or disagrees
  with the preservation parser; and
- structural and formula-like-value warnings without automatic mutation.

## Tabulator-adapter coverage

The 5 adapter-contract tests verify:

- string-only columns and string sorting configuration;
- transfer of current view rows without making the grid authoritative;
- physical document coordinates in cell-edit callbacks;
- active-cell updates from selected-range bounds;
- block paste interception and routing to the preservation model;
- native paste inside an active text editor;
- filter forwarding, focus restoration, redraw behavior, and teardown; and
- clipboard options that permit copy while preventing Tabulator from owning
  paste mutation.

These tests validate the adapter boundary. They do not substitute for running
against the exact Tabulator distribution in a real browser.

## Browser verification performed

The following commands completed successfully:

```bash
python3 tests/browser_csv.py --in-memory --screenshots /mnt/data/marin-csv-review
python3 tests/browser_smoke.py --in-memory
python3 tests/browser_security.py --in-memory
```

The CSV workflow test exercised file opening, sample data, literal editing,
model-owned block paste (including a trailing clipboard line ending), header
mode, sort/filter view behavior, find/replace, row and column operations,
undo/redo, warnings, blocked malformed input, download naming, keyboard focus
behavior, dialogs, narrow layout, and dark mode in the dependency-independent
reference grid.

Review images generated during this run:

- `csv-editor-desktop-light.png`
- `csv-editor-mobile-dark.png`

## Browser environment limitation

A normal same-origin HTTP Chromium run was attempted, but this execution
environment blocked navigation to the local test server with
`ERR_BLOCKED_BY_ADMINISTRATOR`. The failure occurred before the application
loaded and is not evidence of an application defect.

The in-memory mode exercises the application and component logic without HTTP
navigation. It does not prove:

- normal local asset loading and deferred-script timing;
- App Shell identity-link reload behavior;
- same-origin fetch behavior for security metadata and information feeds;
- Referer behavior across actual HTTP requests; or
- actual Papa Parse and Tabulator integration.

A networked or local development environment must therefore run:

```bash
npm install
npm run vendor
bash scripts/check.sh --browser
```

The generated `package-lock.json`, vendored distribution files, upstream
licenses, and checksum manifest must be reviewed and committed before release.

## Manual gates not established by CSV-0

CSV-0 does not establish WCAG 2.2 AA conformance, a supported maximum file
size, or production readiness. Required follow-up includes:

- browser-computed accessibility-tree inspection;
- keyboard-only and screen-reader testing in actual Tabulator mode;
- 200% and 400% zoom/reflow, forced-colors, and dark-mode testing;
- multiple browser engines;
- 10,000-, 100,000-, and 1,000,000-row performance characterization using
  representative field widths and lengths;
- dependency and license review of the exact vendored bytes; and
- normal HTTP CSP, network, and privacy verification.

## Conclusion

CSV-0 demonstrates that the selected architecture is feasible and that the
custom preservation engine can remain authoritative while a grid library
provides familiar editing interactions. Advancement to CSV-1 is appropriate
only after the exact dependencies are vendored and the same behavioral suite
passes in actual Tabulator mode over normal HTTP.

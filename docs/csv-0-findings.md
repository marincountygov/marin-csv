# CSV-0 feasibility findings

Date: 2026-10-13  
Status: working proof of concept; not a production release

## Question answered

Can Marin CSV provide a familiar, local-browser CSV/TSV editing workflow while
preventing silent spreadsheet-style data conversion and preserving source-file
conventions?

**Finding: yes.** The architecture is feasible without a frontend framework or
a production build step. The difficult part is not basic parsing or grid
rendering; it is making preservation behavior explicit, testable, and
independent from the visual grid. CSV-0 demonstrates that separation.

## What CSV-0 implements

- Marin App Template 2.0.8 as the starting codebase.
- Marin App Shell 1.12.2 installed from the supplied shell repository.
- Local open by keyboard-operable file picker or page-wide drag and drop.
- CSV/TSV detection and explicit delimiter selection before edits.
- Header mode on by default with a first-row-as-data option.
- Strict UTF-8 parsing, optional BOM retention, quoted fields, escaped quotes,
  quoted line endings, empty fields, trailing empty fields, and blank records.
- Exact original-byte output when untouched.
- Convention-preserving serialization after edits.
- String-only cell editing, add/delete row, add/delete column, undo/redo,
  view-only sort/filter, block paste, and find/replace.
- Always-new downloads with `-copy` or `-edited` naming.
- Visible structural and formula-like-value warnings.
- A semantic-table reference grid that makes the full workflow executable and
  testable before the selected third-party distributions are vendored.
- A Tabulator adapter that routes cell edits and block paste through the
  authoritative preservation engine, plus an exact-version vendoring workflow.
- Thirty-one passing Node regression tests: 26 for the preservation engine
  and 5 for the Tabulator adapter contract.
- Passing in-memory Chromium workflow, Marin App Shell fixture, and CSP
  enforcement tests, with the limitations recorded in the CSV-0 test report.

## Selected third-party components

| Component | Selected version | Role | License |
| --- | ---: | --- | --- |
| Papa Parse | 5.7.0 | Independent parse cross-check; future chunked/worker parsing | MIT |
| Tabulator | 6.6.1 | Production editable grid | MIT |

Both are compatible with a static vanilla-JavaScript MarinOS application and
can be served entirely from local vendored files.

## Reference-mode limitation in this package

The execution environment used to produce CSV-0 could not reach the npm
registry, so this package does not claim to contain the reviewed Papa Parse or
Tabulator distribution bytes. Harmless placeholder files are present at the
final runtime paths. The app detects their absence and activates the reference
grid with a visible CSV-0 notice.

This is deliberate rather than substituting unverified or reconstructed
third-party code. In a networked development environment, run:

```bash
npm install
npm run vendor
bash scripts/check.sh
```

Before a production evaluation, commit the generated `package-lock.json`,
generated vendor manifest, vendored distributions, and upstream licenses.
Then rerun the full browser and manual review suites in actual Tabulator mode.

The normal HTTP Chromium run could not be completed in this execution
environment because browser navigation to the local test server was blocked by
an administrative browser policy. The in-memory browser mode exercised the
CSV workflow, App Shell component fixture, and CSP enforcement logic, but it
does not replace the required same-origin HTTP run. See
[`csv-0-test-report.md`](csv-0-test-report.md).

## Demonstrated preservation behavior

The automated suite verifies:

- leading zeros and long digit strings remain strings;
- date-like and scientific-notation-like strings remain exact;
- formula-like strings remain exact and generate a warning;
- CRLF, LF, CR, UTF-8 BOM, and no-final-newline cases;
- quoted commas, escaped quotes, and embedded line endings;
- trailing empty fields and short records;
- byte-identical untouched export;
- unchanged raw rows after another row is edited;
- row and column operations with undo/redo;
- redo-branch invalidation after a downloaded state;
- header-mode behavior;
- find/replace options; and
- deterministic CSV versus TSV detection.

The Tabulator adapter suite also verifies the selected string-only column
configuration, view-data transfer, cell-edit callbacks using physical document
coordinates, range-origin tracking, model-owned block paste, filter forwarding,
focus restoration, and teardown behavior.

## Production gates after CSV-0

CSV-0 does not establish a production conformance claim. The following remain
required:

1. Vendor and cryptographically record the exact selected library files.
2. Run every browser workflow test in actual Tabulator mode; reference-mode
   passing is not a substitute.
3. Verify Tabulator API assumptions, including cell editing, range selection,
   clipboard paste, redraw, filtering, sorting, and focus restoration.
4. Inspect the browser-computed accessibility tree before and after grid
   interaction in multiple browser engines.
5. Complete keyboard-only and screen-reader testing, including navigation mode
   versus edit mode and selected-range announcements.
6. Test light mode, dark mode, 200% zoom, 400% zoom/reflow, Windows high
   contrast/forced colors, and narrow viewports.
7. Benchmark representative widths and field sizes at 10,000, 100,000, and
   1,000,000 rows; set evidence-based limits or a read-only mode.
8. Decide whether Papa Parse worker/chunk parsing can coexist with exact raw-row
   retention, or should remain a validation-only parser.
9. Add explicit recovery and user guidance for unsupported encodings.
10. Perform WAVE, Lighthouse, CSP/network, dependency, and security review.

## Phase recommendation

Proceed to CSV-1 with the custom preservation engine retained as the
architectural center. CSV-1 should first vendor and lock the selected
third-party distributions, then reconcile the Tabulator adapter through the
same behavioral tests used by the reference grid. Large-file optimization
should follow measured evidence and must not weaken untouched-byte or
string-preservation guarantees.

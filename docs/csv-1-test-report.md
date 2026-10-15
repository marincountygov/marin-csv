# CSV-1 verification report

Date: 2026-10-13
Build: `0.1.0-csv.1`
Libraries: Papa Parse 5.7.0; Tabulator 6.6.1

## Result summary

CSV-1 passed the static, metadata, security, JavaScript syntax, preservation,
real-parser, real-grid-adapter, and in-memory Chromium workflow suites executed
in the build environment.

| Area | Result | Evidence |
|---|---:|---|
| App Shell and companion integrity | PASS | Release manifest byte counts and SHA-256 records |
| Third-party integrity | PASS | Exact versions, lockfile, vendored byte counts, and SHA-256 records |
| HTML/local-resource/CSS boundaries | PASS | `tests/validate_template.py` |
| Security metadata synchronization | PASS | `scripts/sync-security-meta.py --check` and 14 metadata tests |
| JavaScript syntax | PASS | `node --check` over app, scripts, tests, and vendored status files |
| Preservation engine | PASS | 26 Node tests |
| Papa Parse integration | PASS | 6 Node tests using the actual vendored parser, including deterministic generated records |
| Tabulator adapter | PASS | 7 Node tests covering lifecycle and event contracts |
| Browser CSV workflow | PASS, in-memory origin | Actual vendored Papa Parse and Tabulator in Chromium |
| App Shell browser smoke | PASS, in-memory origin | Component routing and responsive fixture |
| CSP/security browser fixture | PASS, in-memory fixture | Exact generated policy in the security fixture |

Total Node tests: 39 passed, 0 failed.

## Browser workflow evidence

The Chromium workflow verified:

- preservation-sensitive literal values;
- actual Tabulator startup rather than a fallback implementation;
- accessible grid name and row/column metadata;
- no-op multiline editing without CRLF conversion;
- intentional multiline editing using the original embedded line ending;
- Alt+Enter promotion of a single-line field using the document line ending;
- a real two-row by two-column range copy and exact clipboard payload;
- model-owned block paste, focus restoration, and undo;
- cell edits and downloaded bytes;
- row/column insertion and deletion;
- view-only sorting and filtering with physical export order retained;
- native dialog inline validation and find/replace;
- explicit header/data interpretation;
- untouched UTF-8-BOM and no-final-newline byte identity;
- TSV delimiter detection and literal commas;
- invalid UTF-8 rejection;
- parser-disagreement blocking;
- literal rendering of malicious header and cell markup; and
- mobile dark-mode layout without page-level horizontal overflow while the
  grid retains its own horizontal scroll region.

## Environment limitation

The available Chromium runtime is governed by an administrative policy that
blocks all normal navigation, including `http://127.0.0.1`, `http://localhost`,
HTTPS test origins, `file:`, and `data:` URLs. The failure occurs before the
application or local HTTP server can respond.

For that reason, the successful CSV-1 browser workflow used the in-memory HTML
fixture while loading the actual committed MarinOS, Papa Parse, Tabulator, and
application source. This establishes application and library behavior, but it
does **not** establish:

- normal HTTP asset loading;
- deferred-script timing on a deployed origin; or
- enforcement of the application CSP in its ordinary page origin.

The repository retains `bash scripts/check.sh --browser` as the required
normal-origin release command. `--browser-in-memory` is an explicit constrained-
environment alternative, not a release substitute.

## Manual checks still required

CSV-1 does not establish WCAG 2.2 AA conformance. Required manual work includes:

- complete keyboard operation and focus review;
- browser-neutral accessibility-tree inspection;
- screen-reader testing;
- 200% and 400% zoom/reflow;
- forced-colors/high-contrast and numerical contrast review;
- touch and narrow-layout review;
- supported-browser compatibility review;
- large-file performance and memory benchmarking; and
- release dependency/security review.

The separately delivered verification log contains the exact final command
outputs from the clean packaged archive.

# CSV-5 verification report

Build: `0.1.0-csv.5`  
Date: 2026-10-15

## Result

The final working tree passed static validation, syntax checks, dependency and
App Shell integrity checks, 98 Node tests, 14 security-metadata tests, and all
five in-memory Chromium workflows.

## Automated coverage

The test suite verifies:

- central delimiter definitions, labels, validation, and MIME types;
- comma, tab, semicolon, and pipe detection;
- `.tsv` and `.psv` filename hints that cannot override stronger structural
  evidence;
- ambiguous and one-column warnings;
- explicit delimiter override before editing;
- quoted active delimiters and literal non-active delimiters;
- exact untouched bytes and convention-preserving edited output;
- Papa Parse agreement for every delimiter across CRLF, LF, and CR;
- standard, paged, and read-only preview modes;
- recovery snapshot round trips without a database or payload migration;
- pipe-delimited recovery, reopening, writer-conflict, and independent-copy
  behavior;
- file-picker and four-option selector presentation;
- pipe-delimited edit/download behavior and `.psv` filename retention;
- delimiter locking after editing; and
- all existing security, recovery, workspace, selected-cell, and grid
  regressions.

## Browser result

The actual vendored Papa Parse and Tabulator libraries passed the CSV workflow,
workspace, local-recovery interface, App Shell component, and CSP fixture tests
through the deterministic in-memory browser harness.

The managed Chromium runtime blocked navigation to the local HTTP origin before
Marin CSV loaded:

```text
net::ERR_BLOCKED_BY_ADMINISTRATOR
```

Accordingly, this environment did not establish ordinary HTTP asset loading,
same-origin worker startup, native IndexedDB persistence, persistent-profile
restart recovery, or deployed-origin CSP behavior. Run the retained production
suite in a localhost-permitted environment:

```bash
bash scripts/check.sh --browser
```

## Performance probe

The existing large-file benchmark completed with the four-candidate detector.
Representative results included approximately 59 ms for a 1,000-by-10 standard
document, 932 ms for a 10,000-by-100 paged document, and 970 ms for a
one-million-by-five preview document in this constrained Node environment.
These measurements are comparative evidence, not service-level guarantees.

## Human review

CSV-5 remains Alpha pending the checks in
[`csv-5-manual-review.md`](csv-5-manual-review.md), particularly ambiguous-file
wording, keyboard use of the delimiter selector, screen-reader output, zoom,
forced colors, and native normal-origin recovery.

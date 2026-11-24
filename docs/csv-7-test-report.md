# CSV-7 verification report

Status: generated for the CSV-7 Alpha build
Date: 2026-11-24

## Automated scope

The release suite validates static metadata, vendored dependency integrity,
JavaScript and Python syntax, preservation and recovery behavior, Tabulator
adapter behavior, App Shell integration, CSP metadata, and real vendored-library
browser workflows.

CSV-7-specific coverage includes:

- open-action order and the **Create new CSV** label;
- local timestamp filename generation;
- one-column blank-document scaffolding with zero-byte initial export;
- empty-input Papa Parse agreement;
- explicit blank-record serialization;
- filename validation, automatic `.csv` extension, and uploaded-file exclusion;
- direct grid editing, row creation, and exact text preservation;
- exact first-download and numbered repeat-download filenames;
- new-document dirty/download status;
- snapshot, transfer, source-record, and journal recovery of new-document state;
- current filename and downloaded status in Recent local documents;
- continued opened-file naming behavior; and
- App Shell 2.2.0 managed-file manifest verification.

## Results

`bash scripts/check.sh` passed:

- generated security metadata synchronization;
- Marin App Shell 2.2.0 and 44 managed icon checks;
- vendored dependency, lockfile, and checksum checks;
- HTML, local-resource, and app-owned CSS boundary checks;
- metadata, documentation, and Python syntax checks;
- 14 security metadata tests;
- App Shell button and shared-helper audits;
- JavaScript syntax checks; and
- 107 Node tests with zero failures.

All six supported in-memory browser suites passed:

- `tests/browser_csv.py --in-memory`;
- `tests/browser_files.py --in-memory`;
- `tests/browser_workspace.py --in-memory`;
- `tests/browser_recovery.py --in-memory`;
- `tests/browser_smoke.py --in-memory`; and
- `tests/browser_security.py --in-memory`.

The first four completed inside the aggregate
`bash scripts/check.sh --browser-in-memory` run. The managed execution session
then timed out while starting the fifth Playwright process; the smoke and CSP
suites subsequently passed as separate commands. No application assertion
failed.

The supplied App Shell repository also verified the installation with:

```text
Installed shell, font, icon, and marin.yml integrity: PASS
```

Recovery, large-document, and Chromium interaction benchmark scripts completed
successfully. Benchmark measurements remain comparative evidence from the
recorded environment, not service-level guarantees.

## Visual review performed

Headless Chromium screenshots were reviewed for:

- the open view with **Create new CSV** between **Browse files** and
  **Open sample**;
- the blank one-column workspace and filename control; and
- the native filename dialog with selected default name.

This review found no clipping, overlap, or unexpected horizontal overflow at a
1,440 × 1,000 viewport. It does not replace the CSV-7 manual review checklist.

## Environment limitation

Chromium navigation to the local HTTP test server is blocked in the execution
environment with `net::ERR_BLOCKED_BY_ADMINISTRATOR`. The supported in-memory
browser fixture executes the actual vendored Papa Parse, Tabulator, MarinOS,
and application/recovery code, but it cannot establish HTTP asset loading,
native IndexedDB persistence, Web Worker startup, deployed CSP behavior, or
origin-isolation behavior.

Run `bash scripts/check.sh --browser` in a localhost-permitted environment
before release deployment. This limitation does not justify skipping or
weakening any browser assertion.

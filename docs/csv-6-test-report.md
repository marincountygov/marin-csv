# CSV-6 verification report

Status: generated for the CSV-6 Alpha build  
Date: 2026-10-15

## Automated scope

The release suite validates static metadata, vendored dependency integrity,
JavaScript and Python syntax, preservation and recovery behavior, Tabulator
adapter behavior, App Shell integration, CSP metadata, and real vendored-library
browser workflows.

CSV-6-specific coverage includes:

- stable pointer context targets;
- touch-hold and keyboard context activation;
- complete existing value in the cell editor;
- clear field plus undo;
- exact and blank value filtering;
- AND combination with the global text filter;
- deterministic initial menu focus, keyboard navigation, and Escape focus restoration;
- viewport containment;
- sorted physical-row deletion;
- clicked-column deletion;
- paged-mode command availability;
- read-only writer-conflict command availability;
- preview-mode native-menu preservation; and
- context-menu security with literal markup-like data.

The clean release suite passes 101 Node tests and 14 security metadata tests,
plus the in-memory CSV, workspace, recovery, App Shell, and CSP browser
workflows. The complete command output is recorded in the release verification
log.

## Environment limitation

The managed Chromium environment may block navigation to localhost. The
in-memory browser fixture executes the actual vendored Papa Parse, Tabulator,
MarinOS, and application code, but it does not replace the normal-origin checks
for HTTP asset loading, native IndexedDB, Web Worker startup, and deployed CSP.
Run `bash scripts/check.sh --browser` in a localhost-permitted environment.

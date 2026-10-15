# CSV-4 verification report

Build: `0.1.0-csv.4`  
Date: 2026-10-14

This report is finalized from the clean release archive. CSV-4 verification
covers existing CSV preservation and workspace behavior plus IndexedDB schema,
snapshot/hydration, edit journaling, checkpoint compaction, startup recovery,
writer leases, failure states, and browser recovery controls.

## Automated result

- Static App Shell, dependency, HTML, CSS-boundary, metadata, security, and
  syntax validation: passed.
- Node test suite: 91 tests passed, 0 failed.
- Security metadata suite: 14 tests passed, 0 failed.
- Memory-backed real-library Chromium suites: passed.
- Recovery benchmark: completed for standard, paged, wide, and preview cases.

The Node suite includes dedicated coverage for immediate snapshots of oversized
mutations, advisory storage-quota preflight, recovery initialization failure,
strict transaction durability fallback, fallback-journal retention, stale
writer rejection, active-copy deletion races, and exact snapshot hydration.

## Browser modes

The deterministic in-memory browser mode exercises the production recovery
coordinator and complete UI but not native IndexedDB persistence. The required
normal-origin suite is implemented in `tests/browser_recovery.py`; it uses a
persistent Chromium profile to test native IndexedDB, confirmed refresh,
browser restart, and multi-tab conflict.

In the build environment, managed Chromium blocks localhost navigation before
the application loads (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). Native IndexedDB
and persistent-profile results must therefore be completed in a localhost-
permitted release environment with:

```bash
bash scripts/check.sh --browser
```

## Human gates

CSV-4 remains Alpha pending the checks in `csv-4-manual-review.md`, including
keyboard, screen reader, accessibility tree, zoom/reflow, forced colors,
managed-device, shared-origin security, and privacy review.

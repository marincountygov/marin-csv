# Marin CSV CSV-4 recovery benchmark results

Generated: 2026-10-15T03:45:31.502Z

These measurements use the production preservation engine, recovery coordinator, and deterministic memory-backed persistence adapter under Node.js. They measure snapshot/journal architecture and reconstruction cost; they are not native IndexedDB or end-user browser service-level guarantees.

| Case | Mode | Source | Rows | Columns | Initial checkpoint | Edit + journal | Snapshot | Restore | Retained heap | Retained RSS |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Standard 1,000 × 10 | standard | 0.1 MiB | 1,001 | 10 | 4.6 ms | 1 ms | 2.5 ms | 9.3 ms | 3 MiB | 18.8 MiB |
| Paged 10,000 × 10 | paged | 0.7 MiB | 10,001 | 10 | 23.6 ms | 1 ms | 23.2 ms | 86.6 ms | 27 MiB | 57.3 MiB |
| Paged wide 2,000 × 100 | paged | 1.4 MiB | 2,001 | 100 | 20.7 ms | 0.4 ms | 17.9 ms | 104.7 ms | 39.1 MiB | 33.2 MiB |
| Preview 250,001 × 1 | preview | 1.7 MiB | 250,002 | 1 | 3.5 ms | — | — | 3.3 ms | 0.8 MiB | 36.2 MiB |

The preview case retains original bytes and a bounded 1,000-row preview rather than constructing a complete editable model. Native IndexedDB timing, persistent-profile restart behavior, and browser-origin storage characteristics remain release-environment tests.


# Marin CSV CSV-4 recovery benchmark results

Generated: 2026-11-24T22:19:13.085Z

These measurements use the production preservation engine, recovery coordinator, and deterministic memory-backed persistence adapter under Node.js. They measure snapshot/journal architecture and reconstruction cost; they are not native IndexedDB or end-user browser service-level guarantees.

| Case | Mode | Source | Rows | Columns | Initial checkpoint | Edit + journal | Snapshot | Restore | Retained heap | Retained RSS |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Standard 1,000 × 10 | standard | 0.1 MiB | 1,001 | 10 | 3.4 ms | 1 ms | 3 ms | 10.5 ms | 3 MiB | 18.4 MiB |
| Paged 10,000 × 10 | paged | 0.7 MiB | 10,001 | 10 | 27.9 ms | 0.9 ms | 30 ms | 93.2 ms | 27 MiB | 93.9 MiB |
| Paged wide 2,000 × 100 | paged | 1.4 MiB | 2,001 | 100 | 27.2 ms | 0.6 ms | 19.4 ms | 120.6 ms | 39.1 MiB | 32.2 MiB |
| Preview 250,001 × 1 | preview | 1.7 MiB | 250,002 | 1 | 8.7 ms | — | — | 11.7 ms | 0.8 MiB | 76.6 MiB |

The preview case retains original bytes and a bounded 1,000-row preview rather than constructing a complete editable model. Native IndexedDB timing, persistent-profile restart behavior, and browser-origin storage characteristics remain release-environment tests.


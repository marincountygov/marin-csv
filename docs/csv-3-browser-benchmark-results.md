# Marin CSV CSV-3 browser benchmark results

Generated: 2026-10-14T20:34:09.942089Z
Browser: Chromium 144.0.7559.96
Execution path: in-memory component fixture

These measurements are comparative evidence from one constrained Chromium runtime. They are not universal limits or service-level guarantees.

| Case | Source | Mode | Rows | Columns | Open to usable grid | Edit commit | Sort | Filter | Page change |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| standard-1k-x-10 | 0.1 MiB | standard | 1,000 | 10 | 667.8 ms | 305.7 ms | 82.6 ms | 19.7 ms | Not applicable |
| paged-10k-x-10 | 0.8 MiB | paged | 10,000 | 10 | 1586.3 ms | 43.4 ms | Not applicable | Not applicable | 1082.5 ms |
| preview-250k-x-1 | 0.5 MiB | preview | 250,001 | 1 | 487.3 ms | Not applicable | Not applicable | Not applicable | Not applicable |

The in-memory fixture runs the real vendored Papa Parse and Tabulator code, but disables the same-origin Web Worker. Normal-origin worker startup and HTTP asset timing remain separate release checks.

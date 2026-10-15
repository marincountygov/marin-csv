# Marin CSV CSV-2 browser benchmark results

Generated: 2026-10-14T15:55:32.062691Z
Browser: Chromium 144.0.7559.96
Execution path: in-memory component fixture

These measurements are comparative evidence from one constrained Chromium runtime. They are not universal limits or service-level guarantees.

| Case | Source | Mode | Rows | Columns | Open to usable grid | Edit commit | Sort | Filter | Page change |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| standard-1k-x-10 | 0.1 MiB | standard | 1,000 | 10 | 849.1 ms | 83.3 ms | 213.6 ms | 124.8 ms | Not applicable |
| paged-10k-x-10 | 0.8 MiB | paged | 10,000 | 10 | 2325.8 ms | 97.4 ms | Not applicable | Not applicable | 1770.6 ms |
| preview-250k-x-1 | 0.5 MiB | preview | 250,001 | 1 | 640.8 ms | Not applicable | Not applicable | Not applicable | Not applicable |

The in-memory fixture runs the real vendored Papa Parse and Tabulator code, but disables the same-origin Web Worker. Normal-origin worker startup and HTTP asset timing remain separate release checks.

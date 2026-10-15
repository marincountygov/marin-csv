# Marin CSV CSV-2 benchmark results

Generated: 2026-10-14T15:50:51.007Z
Node: v22.16.0
Platform: linux x64

These measurements are comparative evidence from one constrained test environment, not universal browser limits.

| Case | Source | Mode | Data rows | Columns | Rows rendered per view | Open wall time | Retained heap delta | Retained RSS delta | Papa validation | Export |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| standard-1k-x-10 | 0.1 MiB | standard | 1,000 | 10 | 1,000 | 68 ms | 1.0 MiB | 15.7 MiB | 2 ms | 0 ms |
| paged-10k-x-10 | 0.7 MiB | paged | 10,000 | 10 | 1,000 | 298 ms | 8.4 MiB | 61.8 MiB | 16 ms | 3 ms |
| paged-10k-x-100 | 8.4 MiB | paged | 10,000 | 100 | 1,000 | 1174 ms | 63.1 MiB | 123.7 MiB | 125 ms | 20 ms |
| preview-250k-x-1 | 2.1 MiB | preview | 250,001 | 1 | 1,000 | 275 ms | 0.3 MiB | 74.0 MiB | Not applicable | 1 ms |
| preview-1m-x-5 | 42.6 MiB | preview | 1,000,000 | 5 | 1,000 | 1481 ms | 0.5 MiB | 32.8 MiB | Not applicable | 28 ms |

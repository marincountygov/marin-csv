# Marin CSV vendored dependencies

Marin CSV is a static application and makes no runtime CDN requests. This
directory contains the reviewed browser distributions for:

- Papa Parse 5.7.0;
- Tabulator 6.6.1.

`vendor-manifest.json` records each committed file's byte count and SHA-256
value. `vendor-status.js` provides the exact expected versions to the browser
startup gate. Both files are generated and must not be edited manually.

To recreate the reviewed files in a networked development environment:

```bash
npm ci
npm run vendor
bash scripts/check.sh --browser
```

The vendoring command refuses versions other than those pinned in
`package.json`, copies their distribution and license files, and regenerates
the checksum manifest. Review and commit `package-lock.json`, the vendored
files, licenses, and generated metadata together.

# CSV-4 manual review checklist

Build: `0.1.0-csv.4`

## Recovery behavior

- [ ] Open a CSV, edit several cells, wait for **Saved locally**, and refresh.
- [ ] Confirm exact values, filename, delimiter, line endings, and dirty state.
- [ ] Confirm undo and redo start empty after recovery.
- [ ] Close and reopen the browser. Verify Recent local documents appears
      without automatically exposing file contents.
- [ ] Recover two files with the same filename and distinguish them by time.
- [ ] Download a file and verify its local recovery copy remains.
- [ ] Delete an inactive local copy and verify only that record disappears.
- [ ] Delete the active local copy; verify the document remains open, recovery
      stays off through edits, and **Resume local recovery** is explicit.

## Concurrency and database lifecycle

- [ ] Open the same local copy in two tabs. Confirm only one is writable.
- [ ] Create an independent copy in the second tab and edit both separately.
- [ ] Test explicit takeover only after a stale lease expires.
- [ ] Leave an older app tab open during a database upgrade and verify blocked-
      upgrade guidance without data deletion.
- [ ] Confirm `versionchange` preserves in-memory work and requests a user-
      controlled reload.

## Failure handling

- [ ] Disable or block site storage; editing must continue with a visible local-
      recovery warning.
- [ ] Exercise quota exhaustion with synthetic data. Confirm the last safe
      revision remains and the current revision is not labeled saved.
- [ ] Test a damaged/unsupported record. Confirm other documents remain usable
      and the bad record is not silently deleted.
- [ ] Deny persistent storage and confirm ordinary recovery still functions.

## Accessibility

- [ ] Complete all Recent documents, delete, resume, conflict, copy, and
      takeover flows using only the keyboard.
- [ ] Inspect landmarks, dialogs, list actions, status names, and hidden content
      in a browser-computed accessibility tree.
- [ ] Confirm duplicate filenames have distinct action names including the
      filename and contextual timestamp text.
- [ ] Verify recovery completion, important failures, and conflicts are
      announced without announcing every background journal transaction.
- [ ] Test screen readers, 200% and 400% zoom/reflow, forced colors, reduced
      motion, light/dark mode, narrow viewport, and touch.

## Data integrity and privacy

- [ ] Verify leading zeros, long identifiers, date-like values, formula-like
      values, empty fields, blank rows, multiline fields, CSV, and TSV.
- [ ] Compare recovered export bytes with the same pre-refresh document state.
- [ ] Verify CSV content does not appear in URLs, session/local storage, logs,
      analytics, or network requests.
- [ ] Review shared-origin deployment and every app able to execute on that
      origin before approving sensitive-data use.
- [ ] Confirm user-facing text does not claim encryption, archival backup, or
      guaranteed permanent storage.

## Sign-off

- [ ] Product review
- [ ] Accessibility review
- [ ] Security review
- [ ] Privacy review
- [ ] Representative County-managed device/browser review

# CSV-7 implementation findings

## Summary

CSV-7 was implemented as a new origin state inside `CsvDocument`, not as a
parallel editor. The normal grid, preservation commands, Papa Parse check,
undo/redo, local recovery coordinator, and download workflow therefore remain
authoritative.

The supplied platform update moved Marin CSV from Marin App Shell 1.24.0 to
2.2.0 and Marin UI 1.38.0. Marin CSV has no App Shell filter column, so the
2.0 filter-column migration was not applicable.

## An editable grid needs a scaffold, but an empty CSV has no record

Papa Parse represents empty input as a one-cell blank row unless the result is
normalized. Marin CSV instead treats true zero-length input as zero records for
cross-validation.

Tabulator still needs at least one displayed column. The engine therefore keeps
a blank first-row scaffold in memory while preserving zero source bytes and
zero-byte export until a content mutation occurs. The scaffold is document
structure for editing, not implicit CSV content.

## A blank record differs from a blank document

After the user explicitly adds a one-column blank row, serializing that row as
an empty string would be indistinguishable from an untouched zero-byte file.
CSV-7 gives the inserted blank field a temporary quote preference, producing
`""`. Entering ordinary text clears that synthetic preference so values such as
`001` are not quoted without a CSV reason.

## New files need a different dirty-state baseline

An uploaded, untouched source can be considered unchanged. A new browser
document cannot: no user-controlled file exists until the first download.
`hasUndownloadedChanges` therefore remains true while `downloadCount` is zero,
even if the document still has no content edits.

After download, the existing history index can identify whether content matches
the downloaded revision. A filename change has no data-history index, so it
explicitly invalidates the downloaded marker. Recovery stores the resulting
state and download count.

## Filename changes belong in recovery but not data history

The user expects a recovered new CSV to retain its chosen name. Adding rename
to the CSV data undo stack would make Undo unexpectedly change metadata while
editing cells. CSV-7 instead emits `set-filename` as a forward recovery command
without creating a data-history command.

The source record is intentionally written once. Its filename remains the
initial source label; the current filename comes from lightweight document
metadata, snapshots, and journal replay.

## Download names must not inherit uploaded-file suffixes

The established `-copy` and `-edited` names describe a relationship to an
opened file. Those suffixes are misleading for a document created in Marin
CSV. New documents therefore use the chosen filename exactly once and append
numeric repeat suffixes only after a successful download.

## Environment limitation during browser verification

The execution environment blocked Chromium navigation to localhost with
`ERR_BLOCKED_BY_ADMINISTRATOR`. The repository's supported in-memory browser
fixture was used to exercise the real vendored libraries and production
application/recovery code. Normal-origin HTTP, native IndexedDB, worker, and
CSP behavior still require the standard browser suite in an environment where
localhost navigation is permitted.

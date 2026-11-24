# Marin CSV — CSV-7 create new CSV

Status: implemented Alpha specification
Date: 2026-11-24
Baseline: CSV-6 and Marin App Shell 1.24.0

## Purpose

CSV-7 lets a user begin a blank CSV without first choosing a local file. It
also updates Marin CSV to the supplied Marin App Shell 2.2.0 release and Marin
UI 1.38.0 baseline.

The feature must remain inside Marin CSV's existing preservation, history,
validation, recovery, and download architecture. A new CSV is not a separate or
reduced editor mode.

## Open-view action order

The open view presents these actions in order:

1. Browse files
2. Create new CSV
3. Open sample

**Create new CSV** must not open a file picker or immediately download a file.
It opens the normal editable workspace and starts local recovery through the
same coordinator used for uploaded files.

## Blank-document model

`CsvDocument.createBlank()` creates the authoritative document with:

- `newDocument: true`;
- zero original bytes;
- comma delimiter;
- UTF-8 without a BOM;
- CRLF as the convention for row boundaries created later;
- no final line ending;
- first-row column-name mode; and
- one blank first-row scaffold with one column.

The scaffold exists only to make the grid editable. Before a content edit, the
document serializes and downloads as zero bytes. Papa Parse validation compares
that empty text with an empty record set.

A new one-field blank row is serialized as `""` so it remains distinguishable
from an empty document. When the user replaces that synthetic blank field with
ordinary text, the temporary quote preference is removed and normal CSV quoting
rules resume.

## Filename behavior

The default filename is:

```text
marin-csv-YYYY-MM-DD-HHMMSS.csv
```

The timestamp uses the user's local clock at the moment the document is
created.

An **Edit filename** control appears beside the workspace filename only for new
browser documents. It opens a native dialog with inline validation. The
interface:

- trims surrounding whitespace;
- rejects an empty value;
- rejects `/`, `\`, ASCII control characters, `.`, and `..`;
- limits the resulting filename to 240 characters; and
- appends `.csv` when the entered name has no extension.

The filename is metadata. Renaming does not enter the CSV data undo/redo stack
and does not alter CSV bytes. It emits a deterministic `set-filename` recovery
command so the current name survives refresh and browser-local recovery.

## Download behavior

A new document is undownloaded from creation, including when it still exports
zero bytes.

- First download: use the current filename exactly.
- Second download: append `-2` before the extension.
- Later downloads: continue `-3`, `-4`, and so on.

Editing after a download, undoing away from the last downloaded content, or
renaming after a download returns the document to an undownloaded state.
Reaching the last downloaded content through undo/redo returns it to downloaded
state unless a later filename change invalidated that marker.

Opened files retain the existing `-copy`, `-edited`, and numeric-repeat naming
contract. Marin CSV never overwrites the opened file.

## Recovery format extension

CSV-7 uses additive fields in the existing version-1 payload formats:

- full snapshots may contain `newDocument: true`;
- source records may contain `newDocument: true` and zero original bytes; and
- journal entries may contain `{ type: "set-filename", filename }`.

Records without `newDocument` remain opened-file documents. No IndexedDB
schema-version change is required.

Recent local document metadata uses the current editable filename. A clean,
downloaded new document is reported as downloaded rather than unchanged.

## App Shell update

CSV-7 installs the supplied Marin App Shell 2.2.0 managed files, including the
Marin UI 1.38.0 baseline, and updates `marin.yml` accordingly. Managed files
under `vendor/marinos/` are installed by the App Shell installer and are not
edited by Marin CSV.

Marin CSV does not implement an App Shell filter column, so the App Shell 2.0
filter-column migration has no application component to convert.

## Accessibility and interface requirements

- The three open actions retain visible text labels and logical DOM order.
- Filename editing uses a native `dialog` and `form` with a visible label,
  help text, inline error, and `aria-invalid` on failure.
- Opening the filename dialog focuses and selects the current name.
- Saving returns focus to the filename heading and announces the result.
- The filename control is hidden for uploaded files and disabled for any
  read-only recovery conflict.
- New-document status differentiates **New — not downloaded** from
  **New — downloaded**.
- Light, dark, forced-colors, narrow-screen, zoom/reflow, keyboard, touch, and
  screen-reader behavior require manual review before any conformance claim.

## Required verification

Automated coverage must include:

- action order and visible Create new CSV label;
- timestamp filename format;
- one-column blank workspace and zero-byte initial export;
- Papa Parse agreement for the empty document;
- filename extension addition and invalid-name handling;
- filename recovery journaling;
- direct editing and row creation through the existing grid;
- exact first-download and numbered repeat-download names;
- download-state behavior across edit, undo, redo, and rename;
- recovery of `newDocument`, filename, download count, and content;
- continued uploaded-file naming behavior;
- App Shell manifest verification; and
- all CSV-0 through CSV-6 regressions.

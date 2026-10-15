# Marin CSV — CSV-5 common delimiter support

Status: implemented specification  
Build: `0.1.0-csv.5`  
Date: 2026-10-15

## Purpose

CSV-5 extends Marin CSV's existing delimiter-aware architecture from comma and
tab to a fixed, user-facing list of four common single-character delimiters:

1. Comma (`,`)
2. Tab (`\t`)
3. Semicolon (`;`)
4. Pipe (`|`)

The feature must remain simple for ordinary users. Marin CSV automatically
inspects each file, selects the most likely supported delimiter, displays the
actual selected delimiter in the existing control, and allows the user to
choose a different supported delimiter before editing.

## Non-goals

CSV-5 does not add:

- arbitrary custom delimiters;
- multi-character delimiters;
- colon, space, caret, or control-character delimiters;
- a mandatory format-selection dialog;
- automatic conversion from one delimiter to another;
- spreadsheet formats such as XLSX; or
- any change to CSV typing, preservation, recovery, or large-file policy.

## Delimiter definitions

One preservation-engine descriptor list is authoritative for validation,
display names, UI labels, MIME types, filename hints, and tests.

| Delimiter | Display label | Filename hint | Download MIME type |
|---|---|---|---|
| `,` | Comma (,) | `.csv` | `text/csv;charset=utf-8` |
| `\t` | Tab | `.tsv` | `text/tab-separated-values;charset=utf-8` |
| `;` | Semicolon (;) | none | `text/plain;charset=utf-8` |
| `|` | Pipe (\|) | `.psv` | `text/plain;charset=utf-8` |

The original filename extension is retained when Marin CSV creates a new copy
or edited download.

## Detection

Automatic detection evaluates all four supported delimiters through the custom
preservation scanner. Selection is deterministic and based on consistent
multi-column structure. `.tsv` and `.psv` are tie-breaking hints, not permission
to ignore stronger structural evidence. Comma remains the final stable fallback.

When more than one candidate produces similarly plausible multi-column
structure, Marin CSV selects one deterministically and adds an advisory
**Check the delimiter** warning. When the selected interpretation produces only
one column, Marin CSV adds an advisory **Only one column was found** warning.
Neither warning modifies or rejects the file.

The user may change the delimiter before any document edit. Marin CSV reparses
the original bytes with the explicit delimiter. The control remains disabled
after editing begins.

## Preservation and validation

All existing guarantees remain authoritative:

- untouched downloads are byte-identical;
- edited output retains the selected delimiter;
- fields containing the active delimiter are quoted correctly;
- quotes, CR, LF, BOM, final-newline choice, and unchanged raw rows retain their
  existing behavior;
- every field remains a string; and
- Papa Parse must agree cell-for-cell before editable opening and download.

## File picker and interface

The existing delimiter select contains exactly four options. No new dialog is
introduced. The file picker accepts `.csv`, `.tsv`, `.psv`, and `.txt` as hints,
plus the relevant text MIME types. The primary download action uses the generic
label **Download file**; read-only preview continues to use **Download exact
copy**.

## IndexedDB recovery

The IndexedDB schema and recovery payload formats do not change. Delimiters are
already stored as strings in source records and snapshots. Existing comma and
tab records remain valid; semicolon and pipe records use the same snapshot
format and database schema.

## Required verification

Automated coverage must include:

- detection and explicit selection for all four delimiters;
- quoted active delimiters;
- literal non-active delimiters;
- ambiguity and one-column warnings;
- UTF-8 BOM, CRLF/LF/CR, final-newline, and multiline fields;
- Papa Parse agreement across all four delimiters;
- standard, paged, and read-only preview modes;
- snapshot and recovery round trips;
- `.psv` filename retention;
- file-picker and selector UI;
- manual delimiter override before editing;
- delimiter lock after editing; and
- all CSV-0 through CSV-4 regression suites.

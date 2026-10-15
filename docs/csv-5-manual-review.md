# CSV-5 manual review checklist

Build: `0.1.0-csv.5`

## Opening and detection

- [ ] Open a conventional comma-delimited `.csv`; confirm Comma (,).
- [ ] Open a tab-delimited `.tsv`; confirm Tab.
- [ ] Open a semicolon-delimited `.csv`; confirm Semicolon (;).
- [ ] Open a pipe-delimited `.psv`; confirm Pipe (|).
- [ ] Open a pipe-delimited `.txt`; confirm structural detection still works.
- [ ] Open an ambiguous file; confirm **Check the delimiter** is understandable.
- [ ] Open a one-column text file; confirm the advisory warning is accurate.

## Manual interpretation

- [ ] Before editing, change the delimiter and confirm the original bytes are
      reparsed rather than converted.
- [ ] After editing, confirm the Delimiter control is disabled.
- [ ] Confirm changing delimiter does not alter the original browser-local copy
      of another retained document.

## Preservation

- [ ] Confirm literal commas remain text in semicolon and pipe files.
- [ ] Confirm literal semicolons remain text in comma, tab, and pipe files.
- [ ] Confirm literal pipes remain text in comma, tab, and semicolon files.
- [ ] Edit a field to contain the active delimiter and verify correct quoting.
- [ ] Verify leading zeros, long identifiers, date-like text, and formula-like
      text remain exact for all four delimiters.
- [ ] Verify CRLF, LF, BOM, multiline fields, and final-newline behavior.

## Download and recovery

- [ ] Confirm untouched downloads remain byte-identical.
- [ ] Confirm `.psv`, `.tsv`, `.csv`, and `.txt` extensions are retained.
- [ ] Confirm editable files use **Download file** and previews use **Download
      exact copy**.
- [ ] Edit semicolon and pipe files, wait for **Saved locally**, refresh, and
      confirm exact recovery.
- [ ] Confirm recovered documents show the correct delimiter in metadata and
      the select.

## Interface and accessibility

- [ ] Review the four-option select at desktop, narrow width, 200%, and 400%.
- [ ] Complete selection and override with keyboard only.
- [ ] Review option names and warning text with a screen reader.
- [ ] Review light, dark, and forced-colors presentation.
- [ ] Confirm no new external requests occur while opening any delimiter.

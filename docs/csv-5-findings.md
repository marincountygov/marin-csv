# CSV-5 implementation findings

Build: `0.1.0-csv.5`  
Date: 2026-10-15

## Result

Common delimiter support fits the existing architecture without a parser,
serializer, large-file, or IndexedDB redesign. The preservation engine already
accepted a delimiter as document metadata throughout scanning, editing,
serialization, worker transfer, and recovery. CSV-5 replaces the former
comma/tab restrictions with one authoritative four-delimiter definition list.

## Implemented scope

- Comma, tab, semicolon, and pipe are the only supported delimiters.
- The existing Delimiter select is populated from engine definitions.
- `.tsv` and `.psv` are deterministic tie-breaking filename hints.
- Structurally strongest detection remains authoritative.
- Ambiguous interpretations receive a **Check the delimiter** warning.
- One-column interpretations receive an advisory warning.
- Users may reparse the original bytes with another supported delimiter before
  editing; the control remains locked after document changes.
- `.csv`, `.tsv`, `.psv`, and `.txt` are included in the file-picker hint.
- Edited pipe and semicolon fields are quoted when they contain the active
  delimiter.
- Download MIME types are explicit for each supported delimiter.
- Original filename extensions are retained.

## Recovery compatibility

No IndexedDB database migration or recovery format bump was required.
Delimiter values were already stored as strings in source records, snapshots,
and transfer records. Existing comma and tab recovery records remain compatible
and semicolon/pipe records use the same format version.

## Deliberate boundaries

CSV-5 does not support arbitrary or multi-character delimiters. It does not add
a mandatory opening dialog or an `Automatic` value to the post-open select. The
select always shows the actual interpretation in use.

## Risk assessment

The primary regression risk is automatic detection: adding candidates can
change the selected interpretation for ambiguous text. CSV-5 mitigates this
with deterministic scoring, stable comma fallback, filename tie-breakers, and
visible advisory warnings rather than silent repair.

## Verification finding

The completed working tree passed 98 Node tests, 14 security-metadata tests,
and the actual-library in-memory Chromium workflows. A normal-origin browser
attempt was blocked by the managed runtime before application load with
`net::ERR_BLOCKED_BY_ADMINISTRATOR`; the production HTTP/IndexedDB suite remains
included for execution in a localhost-permitted environment.

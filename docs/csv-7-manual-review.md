# CSV-7 manual review checklist

Record browser/version, operating system, viewport, zoom, input device, and any
assistive technology used.

## Open view

- [ ] **Create new CSV** appears between **Browse files** and **Open sample** in visual and keyboard order.
- [ ] The action is understandable without an icon and does not open a file chooser.
- [ ] Creating a document opens the standard editable workspace.
- [ ] The default filename contains the current local date and time.

## Blank-document behavior

- [ ] The initial workspace has one editable column and no data rows.
- [ ] Downloading immediately creates a zero-byte file.
- [ ] Editing the first-row column name and adding rows behaves like an opened editable CSV.
- [ ] A deliberately added blank one-column row remains a real blank record after reopening the download.
- [ ] Leading-zero, long-number, date-like, formula-like, multiline, and markup-like values remain exact text.

## Filename editing

- [ ] **Edit filename** is visible for a new document and hidden for an uploaded file.
- [ ] Opening the dialog focuses and selects the complete current filename.
- [ ] Empty names, `/`, `\`, control characters, `.`, and `..` show an inline error and keep the dialog open.
- [ ] A name without an extension receives `.csv`.
- [ ] A supplied extension remains unchanged.
- [ ] Long names over 240 characters are rejected.
- [ ] Saving updates the workspace heading, browser title, Recent local documents entry, and accessible announcement.

## Download state

- [ ] The initial status is **New — not downloaded**.
- [ ] The first download uses the chosen filename exactly.
- [ ] The second and third downloads use `-2` and `-3` before the extension.
- [ ] A successful download changes the status to **New — downloaded**.
- [ ] A later cell edit, undo away from the downloaded revision, or filename change returns the status to not downloaded.
- [ ] Undo/redo back to downloaded content restores downloaded state when the filename has not changed.
- [ ] Uploaded files still use `-copy` and `-edited` naming and are never overwritten.

## Recovery

- [ ] After **Saved locally**, refresh restores a new document's filename, values, delimiter, and download state.
- [ ] A browser restart lists the current filename in Recent local documents rather than silently opening data.
- [ ] A second tab follows the established read-only conflict/independent-copy behavior.
- [ ] Deleting the active local copy and resuming recovery follows the existing CSV-4 contract.

## Keyboard and assistive technology

- [ ] All three open actions are reachable in logical Tab order.
- [ ] The filename dialog label, help, error, and buttons have understandable accessible names.
- [ ] Escape and Cancel close the filename dialog without changing the name.
- [ ] Saving returns focus predictably and the changed name is announced.
- [ ] The new filename heading/control arrangement does not disrupt grid or toolbar focus order.

## Themes and reflow

- [ ] Review the open actions and filename control in light and dark modes.
- [ ] Review at 200% and 400% zoom without two-dimensional page scrolling.
- [ ] Review a narrow/mobile viewport and expanded workspace mode.
- [ ] Review forced-colors mode with visible focus and button boundaries.
- [ ] Confirm the updated App Shell banner, navigation, dialogs, and footer remain usable.

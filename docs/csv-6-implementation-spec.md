# Marin CSV — CSV-6 cell context menu

Status: implemented Alpha specification  
Date: 2026-10-15  
Baseline: CSV-5

## Purpose

CSV-6 adds an application-owned context menu for one data field. It provides
familiar spreadsheet actions without allowing Tabulator, visual sorting, or
filtering to become authoritative document state.

The menu opens from a data field through:

- mouse right-click;
- touch hold;
- `Shift+F10`; or
- the dedicated Context Menu key.

The browser context menu remains available outside valid Marin CSV data fields
and in read-only preview mode, where no CSV-6 command is available.

## Commands

The fixed menu order is:

1. Edit field
2. Clear field
3. Filter to this value
4. separator
5. Delete row…
6. Delete column…

Edit field starts the existing text-only Tabulator editor. The complete current
value is visible and selected. The existing multiline and line-ending
preservation behavior remains unchanged.

Clear field sets the exact field to the empty string through `CsvDocument`
mutation APIs. It is immediate, undoable, redoable, journaled for IndexedDB
recovery, and included in later snapshots.

Delete row and Delete column use the existing confirmation dialog and
preservation-engine structural commands. Delete row acts on the physical row
containing the clicked field. Delete column acts on the clicked column. The
last remaining column cannot be deleted.

Filter to this value creates a view-only filter with exact, case-sensitive
string equality for the clicked column. Blank, whitespace, markup-like, and
multiline strings are compared literally. It combines with the global text
filter using AND semantics.

## Stable target contract

A context target contains:

```text
rowId
rowIndex
columnIndex
value
columnName
activation source
viewport coordinates
```

`rowId` is the preservation engine's stable row identifier. Before a mutation,
Marin CSV resolves that identifier back to the current physical index. Visual
sorting, global filtering, exact-value filtering, and Tabulator row position do
not redefine the target.

Column coordinates are physical document indexes. Exact-value filters are
cleared when column structure changes so undo/redo cannot leave a filter
attached to a different logical column.

## Mode availability

| Mode | Edit | Clear | Exact filter | Delete row | Delete column |
|---|---:|---:|---:|---:|---:|
| Standard editable | Yes | Yes | Yes | Yes | Yes |
| Standard read-only conflict | No | No | Yes | No | No |
| Paged editable | Yes | Yes | No | Yes | Yes |
| Read-only preview | No | No | No | No | No |
| Busy or parser-blocked | No | No | No | No | No |

When every action is unavailable, Marin CSV does not suppress the browser's
native context menu.

## Exact-value filter

The filter state is:

```javascript
{
  columnIndex: 2,
  value: "Active"
}
```

Matching is equivalent to:

```javascript
String(record[`c${columnIndex}`] ?? "") === value
```

The filter:

- is available only in standard mode;
- does not change dirty state;
- does not create undo or redo history;
- is not written to IndexedDB;
- does not change downloaded bytes or physical order;
- persists through ordinary grid redraws and workspace expansion/collapse;
- resets when another document is opened or the file is reparsed;
- clears when column structure changes; and
- combines with the global text filter using AND semantics.

A compact indicator identifies the column and selected value and provides a
Clear filter command. Empty values are presented as `(blank)`. Long and
multiline values are visually shortened while the control retains a complete
accessible name.

## Keyboard and focus behavior

When opened, focus moves to the first enabled menu item.

- Arrow Down and Arrow Up move between enabled items and wrap.
- Home and End move to the first and last enabled items.
- Enter or Space activates the focused button through native button behavior.
- Escape closes the menu and restores focus to the originating field.
- Tab or Shift+Tab closes the menu and moves to the adjacent focusable control.

The menu closes on click-away, grid scrolling, browser or visual viewport
resize, workspace mode changes, grid reconstruction, page changes, dialogs,
document opening, and long-running operations.

## Accessibility and visual behavior

The context menu uses `role="menu"`, native buttons with `role="menuitem"`, and
a semantic separator. Disabled commands expose `aria-disabled` and cannot be
activated. The menu is positioned within the current viewport.

Styling is application-owned and uses MarinOS tokens. It supports light, dark,
forced-colors, narrow-screen, and expanded-workspace modes. Destructive
commands are placed last and remain understandable without color.

The grid help text identifies right-click, long-press, and `Shift+F10` access.

## Security

CSV values and headers are never inserted as HTML. Menu labels are fixed. The
selected value is not reproduced inside the menu, URLs, browser storage,
telemetry, or logs. The exact-filter indicator uses text content only.

Markup-like field values remain literal text and cannot create elements or
script execution.

## Architecture

`assets/tabulator-adapter.js` owns Tabulator event integration, stable context
extraction, exact filtering, programmatic cell editing, and physical-coordinate
focus restoration. It never mutates the CSV document directly.

`assets/app.js` owns menu state, command availability, positioning, focus,
confirmation, dispatch to preservation-engine methods, filter presentation, and
lifecycle closure.

`index.html` contains one reusable menu and one exact-filter indicator.

`assets/app.css` contains narrowly scoped menu and indicator styles.

No dependency, IndexedDB schema, snapshot format, journal format, parser, or
serializer change is introduced.

## Required verification

Automated coverage includes:

- pointer, touch-hold, Shift+F10, and Context Menu key targets;
- stable physical row identity after sorting and filtering;
- existing value visibility when editing;
- clear, undo, redo, and recovery mutation routing;
- exact, case-sensitive, blank, whitespace, and multiline filtering;
- AND combination with the global filter;
- paged and preview availability;
- keyboard navigation and focus restoration;
- viewport containment;
- structural confirmations;
- markup-like value safety;
- unchanged export and recovery formats; and
- all CSV-0 through CSV-5 regressions.

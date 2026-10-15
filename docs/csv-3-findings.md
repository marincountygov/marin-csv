# CSV-3 workspace implementation findings

Date: 2026-10-14  
Build: `0.1.0-csv.3`  
Status: automated implementation complete; human review pending

## Scope conclusion

The CSV-3 specification was internally sufficient and did not require a product
clarification. One apparent tension was resolved from the specification itself:
find/replace was listed among features not to introduce in CSV-3, but it was
already accepted and implemented in earlier phases. CSV-3 therefore preserves
find/replace and reorganizes its existing control without changing the command.

CSV-3 changes presentation and workspace operation only. The preservation
engine, parser behavior, large-file policy, worker path, serialization rules,
and dependency versions remain unchanged.

## Implemented workspace architecture

### Full-width normal mode

When the `#start` route contains an open document, the application removes the
ordinary content-width cap for the editor only. The MarinOS banner, application
header/navigation, information routes, feedback control, and footer remain the
standard App Shell instances.

The workspace now contains:

- persistent Marin CSV and filename identity;
- a compact command toolbar;
- compact file details and warning disclosures;
- the existing standard/paged/preview grid and pager;
- a concise dimensions/format/change-state area; and
- a viewport-aware grid height.

No broad App Shell or Pico selector was introduced. Full-width rules are scoped
to the Marin CSV editor on its start route.

### Explicit expanded mode

Workspace mode is a single independent application state:

```text
normal | expanded
```

The authoritative state is reflected by `body[data-workspace-mode]` and changed
through one `setWorkspaceMode()` transition. Expanded mode:

- is an in-page fixed workspace;
- does not call the Fullscreen API;
- hides the existing App Shell skip link, banner/header, footer, and feedback hosts;
- marks those hidden hosts inert;
- retains the Marin CSV name, current filename, toolbar, warnings, pager, grid,
  status area, and Collapse workspace control; and
- is not written to localStorage, sessionStorage, cookies, or the URL.

Collapse restores each App Shell host's prior `hidden` and `inert` state rather
than assuming a fixed default.

### Toolbar and file identity

Existing commands were reorganized into compact File, History, Insert, Search,
and More groupings. Ambiguous commands retain visible labels and accessible
names. The current filename remains visually distinct from the Marin CSV
application name. The More disclosure contains less-frequent destructive and
view-interpretation controls rather than adding non-functional spreadsheet
commands.

### Viewport-aware grid sizing

CSV-2 used a capped maximum-height strategy. CSV-3 measures the available
viewport from the grid's actual top position and the visible status/footer
areas. It uses dynamic viewport height where available and responds to:

- normal/expanded transitions;
- browser and visual-viewport resizing;
- responsive layout changes;
- warning/file-details disclosures;
- paging controls; and
- long-operation status changes.

The Tabulator adapter receives an explicit pixel height and performs targeted
`setHeight()` and redraw work. It does not rebuild the `CsvDocument`, reparse
bytes, or serialize output.

## Defects found during implementation

### Synthetic focus clicks closed unrelated controls

The existing Tabulator focus-restoration path called both `click()` and
`focus()` on the target cell. Opening the new More disclosure changed measured
layout, which triggered a grid resize. The synthetic cell click then bubbled as
an outside click and closed the disclosure before a command could be selected.

The adapter now restores focus directly without synthesizing a click. During a
resize, it restores the active cell only when focus originated inside the grid.
This prevents layout work from closing menus, triggering edit behavior, or
stealing focus from toolbar and dialog controls.

### Transition focus needed to outlive the resize cycle

Collapsing expanded mode with Escape can begin while a grid cell has focus.
Tabulator's resize restoration runs asynchronously. A one-frame focus return to
the workspace toggle could therefore be overwritten by the grid on the next
frame.

The coordinated transition now returns focus to the persistent
Expand/Collapse control after the resize cycle. Keyboard tests cover expansion,
button collapse, and Escape collapse.

### Overlaid disclosure needed an explicit interaction layer

The More panel visually overlaid file-details and warning summaries. Without an
explicit open-state stacking layer, those later-painted summaries could receive
pointer hit testing through the panel. The toolbar and open menu now receive a
scoped stacking layer, and the obscured inspector row temporarily ignores
pointer interaction while the menu is open.

### Visual hiding alone was insufficient for shell regions

Expanded mode must not leave hidden App Shell descendants in keyboard or
accessibility interaction. The implementation therefore applies both `hidden`
and `inert` to the skip link and shell hosts. Browser tests verify those elements and rendered
regions are hidden, inert, not focused, and have no rendered focusable
descendants.

## Data-safety result

Workspace state is not part of the CSV model. Automated browser coverage makes
the same field edit in normal mode and expanded mode, downloads both results,
and compares the bytes. The outputs are identical.

Expanding and collapsing do not:

- change file contents or metadata;
- create a history command;
- reset dirty/download state;
- clear undo or redo;
- invoke a file read or parser;
- trigger an unsaved-change warning; or
- change physical row or column order.

All CSV-0 through CSV-2 preservation, parsing, preview, paging, warning,
security, and download tests continue to pass.

## Accessibility and responsive result

Automated coverage verifies:

- named toolbar and workspace controls;
- keyboard activation of Expand and Collapse;
- logical focus after transitions;
- Escape precedence for a menu, dialog, grid edit, and workspace collapse;
- hidden and inert shell regions;
- persistent local identity and filename in expanded mode;
- grid and command availability at a 390-pixel dark-mode viewport;
- internal horizontal grid scrolling rather than page overflow;
- light and dark visual rendering; and
- fresh-page return to normal mode.

These checks do not establish WCAG 2.2 AA conformance. The manual checklist in
[`csv-3-manual-review.md`](csv-3-manual-review.md) remains required.

## Intentionally deferred to CSV-4 or later

CSV-3 does not add formulas, type inference, Excel import/export, fill handles,
freeze panes, context menus, richer row/column selection, drag-to-copy, bulk
transformations, or a ribbon. It preserves the existing basic range selection,
copy/paste, find/replace, row/column commands, and undo/redo behavior needed for
continuity.

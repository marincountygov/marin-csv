# CSV-6 implementation findings

## Summary

CSV-6 was implemented without changing the preservation engine, parser,
serializer, recovery database, or dependency set. Tabulator already supplied
cell context, touch-hold, and programmatic edit hooks. The substantial work was
ensuring that visual row position never became the mutation target and that the
custom menu met keyboard, focus, security, and lifecycle requirements.

## Stable physical targeting

Tabulator cells expose their physical document row index and preservation row
ID. CSV-6 captures both. Row deletion resolves the stable ID immediately before
the confirmed mutation. Browser testing sorts the grid before deleting and
verifies that the clicked physical file row is removed rather than the first
visible row.

## Exact-value filtering

The existing global filter performs case-insensitive substring matching across
all displayed fields. Reusing it would not implement “Filter to this value.”
CSV-6 therefore adds a separate exact, case-sensitive column filter. The two
predicates combine with AND semantics. The filter remains adapter/view state
and cannot affect export, history, or IndexedDB.

## Structural filter safety

Column insertion, deletion, undo, and redo can change column meaning. CSV-6
clears the exact-value filter when column structure changes rather than silently
moving it to a different logical field.

## Menu ownership

An application-owned menu was selected instead of Tabulator's default rendered
menu so Marin CSV controls accessible names, keyboard navigation, focus return,
viewport positioning, light/dark/forced-colors styles, and lifecycle closure.

## Initial menu focus timing

The menu becomes visible before the next animation frame. Deferring initial
focus entirely to that frame created a small race in which an immediate Home,
End, or arrow-key press could still reach the grid. CSV-6 now focuses the first
enabled command synchronously and retains a next-frame fallback only when focus
was displaced. This makes keyboard opening deterministic without depending on
visual rendering timing.

## Empty-cell rendering

Tabulator visually represents an empty cell with a nonbreaking placeholder.
Browser assertions therefore evaluate the trimmed rendered value while the
preservation engine and downloads retain the exact empty string.

## Deferred work

CSV-6 remains single-cell context. Multi-row and multi-column selection,
selection-sensitive bulk actions, column-header menus, row-header menus,
custom sorting commands, and richer context operations remain deferred.

# CSV-6 manual review checklist

Record browser/version, operating system, viewport, zoom, input device, and any
assistive technology used.

## Pointer and touch

- [ ] Right-clicking a data field opens the custom menu at that field.
- [ ] Right-click elsewhere retains the browser context menu.
- [ ] Long-press opens the menu on a touch-capable device.
- [ ] The menu remains fully inside each viewport edge.
- [ ] Scrolling the grid closes the menu.

## Keyboard

- [ ] `Shift+F10` opens the menu for the focused field.
- [ ] The Context Menu key opens the same menu where available.
- [ ] Arrow keys, Home, and End move among enabled commands.
- [ ] Enter and Space activate commands.
- [ ] Escape closes the menu and returns focus to the originating field.
- [ ] Tab and Shift+Tab close the menu and continue focus movement.

## Commands

- [ ] Edit field displays and selects the complete existing value.
- [ ] Clear field empties only that field and is undoable/redoable.
- [ ] Delete row confirmation identifies and removes the clicked physical row.
- [ ] Delete column confirmation identifies and removes the clicked column.
- [ ] Canceling either confirmation changes nothing.
- [ ] One-column documents do not permit column deletion.

## Filtering

- [ ] Filter to this value matches exact case, whitespace, blank, and multiline values.
- [ ] The exact-filter indicator is understandable and clearable.
- [ ] Global text and exact-value filters combine as expected.
- [ ] Sorting and filtering do not change downloaded physical order.
- [ ] Paged mode disables exact filtering but retains editing/deletion actions.
- [ ] Preview mode does not show the custom menu.
- [ ] A read-only writer conflict permits exact filtering but disables every mutation command.

## Accessibility and themes

- [ ] Menu and items have correct accessible roles and names.
- [ ] Disabled items are announced as unavailable.
- [ ] Focus is visible in light and dark modes.
- [ ] Review at 200% and 400% zoom.
- [ ] Review forced-colors mode.
- [ ] Review expanded workspace and narrow/mobile layouts.
- [ ] Screen-reader output does not announce field values as menu markup.

## Data integrity and recovery

- [ ] Clear and deletion actions survive refresh after Saved locally appears.
- [ ] Undo/redo and download output match direct-editor behavior.
- [ ] Formula-like, date-like, leading-zero, long-number, and multiline values remain text.
- [ ] Markup-like values remain literal and never create executable elements.

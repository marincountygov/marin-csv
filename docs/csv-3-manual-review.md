# CSV-3 manual review checklist

Date prepared: 2026-10-14  
Build: `0.1.0-csv.3`  
Status: **pending human review**

Record tester, browser/version, operating system, viewport, assistive
technology, result, and notes for each applicable check. A failure should be
reproduced at cause level and converted into a regression test where practical.

## 1. Normal workspace layout

- [ ] Typical desktop: workspace uses substantially the available page width.
- [ ] Typical desktop: grid uses most available vertical space without hiding
      the MarinOS footer.
- [ ] Narrow laptop: toolbar remains usable and no command renders off-screen.
- [ ] Very wide monitor: grid and toolbar scale without an excessive narrow
      content column.
- [ ] Current filename is always distinguishable from the Marin CSV app name.
- [ ] File details, warnings, paging, and status remain visible and usable.
- [ ] Page has no unintended horizontal overflow; wide data scrolls inside the
      grid.

## 2. Expanded workspace layout

- [ ] Expand workspace is discoverable and accurately labelled.
- [ ] Browser tabs, address bar, and controls remain visible.
- [ ] MarinOS skip link, banner/header, footer, and feedback control are absent from interaction and accessibility exposure.
- [ ] Marin CSV name, filename, toolbar, warnings, pager, grid, and status remain
      available.
- [ ] Collapse workspace remains visible while the grid is scrolled.
- [ ] Expanded grid fills the usable viewport without stale blank areas,
      clipped columns, or a required reload.
- [ ] Collapse restores the exact normal App Shell and footer.
- [ ] Fresh reload starts in normal mode.

## 3. Data and state continuity

- [ ] Open a preservation-sensitive CSV and note delimiter, BOM, line endings,
      warnings, and unchanged state.
- [ ] Edit cells in normal mode, expand, continue editing, collapse, and verify
      all values remain.
- [ ] Verify undo and redo survive both transitions.
- [ ] Verify filter, sort, page, selection, and grid scroll position remain
      reasonable through transitions.
- [ ] Verify expanding/collapsing does not display an unsaved-change warning.
- [ ] Download after mode changes and compare the output with the same edits
      made without changing mode.
- [ ] Verify leading zeros, long numbers, date-like text, scientific-like text,
      formula-like text, quoted fields, and multiline values remain exact.

## 4. Keyboard and focus

- [ ] Complete the Expand workspace action without a mouse.
- [ ] Focus remains on the persistent Collapse workspace control after expand.
- [ ] Complete Collapse workspace without a mouse.
- [ ] Focus remains on the persistent Expand workspace control after collapse.
- [ ] Open More in expanded mode; Escape closes More first and returns focus to
      its summary.
- [ ] Open a dialog in expanded mode; Escape closes the dialog without
      collapsing the workspace.
- [ ] Begin a cell edit in expanded mode; Escape cancels editing without
      collapsing the workspace or committing text.
- [ ] With no higher-priority interaction active, Escape collapses the
      workspace.
- [ ] Tabbing never enters the hidden App Shell skip link or header/footer/feedback controls.
- [ ] No focus trap, unexpected focus reset, or focus loss occurs after resize,
      orientation change, paging, or disclosure changes.
- [ ] Visible focus is clear on every toolbar, menu, dialog, and grid control.

## 5. Accessibility-tree inspection

Use browser-neutral accessibility inspection rather than relying only on DOM
or ARIA source.

- [ ] Normal mode exposes the expected banner/navigation, main, toolbar, grid,
      status, and footer landmarks/roles.
- [ ] Toolbar is named “Marin CSV commands.”
- [ ] Expand and Collapse controls have direct, accurate accessible names and
      state.
- [ ] Current filename is exposed as content and is not confused with the app
      title.
- [ ] Expanded mode removes hidden App Shell regions and descendants from normal
      interaction/accessibility exposure.
- [ ] Grid row/column counts, headers, row numbers, cells, selected states, and
      read-only state remain coherent in both modes.
- [ ] No duplicated shell, toolbar, filename, or workspace controls appear.
- [ ] Warnings, errors, operation status, page status, and selection status are
      announced appropriately.

## 6. Screen-reader review

- [ ] Navigate the toolbar and hear concise names, groups, states, and disabled
      conditions.
- [ ] Expand and collapse without losing context.
- [ ] Confirm hidden shell content is not announced in expanded mode.
- [ ] Navigate the grid in reading/navigation mode.
- [ ] Enter and exit cell editing mode predictably.
- [ ] Hear row/column context and selected-range changes.
- [ ] Hear dialogs, inline validation, warnings, progress, completion, and
      blocking errors.
- [ ] Confirm mobile/responsive wrapping does not alter meaningful order.

## 7. Zoom, reflow, and responsive behavior

- [ ] 200% browser zoom at a desktop viewport.
- [ ] 400% browser zoom/reflow at a 1280 CSS-pixel-equivalent viewport.
- [ ] 320-pixel and 390-pixel responsive widths.
- [ ] Mobile browser dynamic toolbar changes and orientation changes.
- [ ] Toolbar wraps/collapses without hiding Expand/Collapse or Download.
- [ ] Text does not clip or overlap controls.
- [ ] Horizontal data overflow remains inside the grid.
- [ ] Touch targets remain practical; no command requires precise pointer-only
      interaction.

## 8. Theme, contrast, and forced colors

Review normal and expanded workspaces in each state.

- [ ] Light mode.
- [ ] Dark mode.
- [ ] Operating-system forced-colors/high-contrast mode.
- [ ] Numerical contrast for text, icons, borders, focus indicators, active
      cells, selected ranges, disabled controls, warnings, and status text.
- [ ] Focus and selection remain distinguishable without relying on color alone.
- [ ] Reduced-motion preference introduces no required animation or lost state
      feedback.

## 9. Browser and hardware coverage

- [ ] Current County-supported Chromium browser over normal HTTP/HTTPS.
- [ ] Current Firefox, if supported for deployment.
- [ ] Current Safari/WebKit, if supported for deployment.
- [ ] Representative managed County laptop.
- [ ] Representative external monitor and laptop-only display.
- [ ] Standard, paged, and preview documents in both workspace modes where the
      mode permits interaction.
- [ ] `bash scripts/check.sh --browser` passes in a localhost-permitted test
      environment.

## 10. Sign-off

- Tester:
- Date:
- Environment(s):
- Result: Pending
- Required remediation:
- Follow-up regression tests:

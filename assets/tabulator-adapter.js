/* Marin CSV adapter for the vendored Tabulator runtime (CSV-3). */
(function (root, factory) {
  let engine = root.MarinCsvEngine;
  if (!engine && typeof module === "object" && module.exports) engine = require("./csv-engine.js");
  const api = factory(engine);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarinCsvTabulatorAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine) {
  "use strict";

  const DATA_FIELD = /^c(\d+)$/;
  const REQUIRED_VENDOR = Object.freeze({ papaParse: "5.7.0", tabulator: "6.6.1" });

  function columnIndexFromField(field) {
    const match = DATA_FIELD.exec(String(field || ""));
    return match ? Number(match[1]) : null;
  }

  function normalizeSorters(sorters) {
    if (!Array.isArray(sorters)) return [];
    return sorters.flatMap((sorter) => {
      const field = sorter?.field || sorter?.column?.getField?.();
      const dir = sorter?.dir === "desc" ? "desc" : "asc";
      return DATA_FIELD.test(String(field || "")) ? [{ column: field, dir }] : [];
    });
  }

  function dependencyReport(rootObject = globalThis) {
    const vendor = rootObject.MarinCsvVendor || {};
    const problems = [];
    if (vendor.phase !== "vendored") problems.push("the local dependency manifest is not in vendored mode");
    if (vendor.papaParse !== REQUIRED_VENDOR.papaParse) {
      problems.push(`Papa Parse ${REQUIRED_VENDOR.papaParse} is not declared by the local dependency manifest`);
    }
    if (vendor.tabulator !== REQUIRED_VENDOR.tabulator) {
      problems.push(`Tabulator ${REQUIRED_VENDOR.tabulator} is not declared by the local dependency manifest`);
    }
    if (!rootObject.Papa || typeof rootObject.Papa.parse !== "function") {
      problems.push(`Papa Parse ${REQUIRED_VENDOR.papaParse} did not load`);
    }
    if (typeof rootObject.Tabulator !== "function") {
      problems.push(`Tabulator ${REQUIRED_VENDOR.tabulator} did not load`);
    }
    return { available: problems.length === 0, problems, vendor, required: REQUIRED_VENDOR };
  }

  function accessibleValue(value) {
    const text = String(value ?? "").replace(/\r\n|\r|\n/g, " line break ");
    if (!text) return "blank";
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  }

  function normalizeViewOptions(options = {}, documentModel = null) {
    const mode = ["standard", "paged", "preview"].includes(options.mode) ? options.mode : "standard";
    const readOnly = Boolean(options.readOnly || documentModel?.readOnly || mode === "preview");
    const pageSizeValue = Number(options.pageSize);
    const pageSize = mode === "paged" && Number.isFinite(pageSizeValue) && pageSizeValue > 0
      ? Math.trunc(pageSizeValue)
      : null;
    return {
      mode,
      readOnly,
      pageSize,
      pageIndex: Math.max(0, Math.trunc(Number(options.pageIndex) || 0)),
      disableSortFilter: Boolean(options.disableSortFilter || mode !== "standard"),
    };
  }

  function gridFallbackHeight(rootObject = globalThis) {
    const viewportHeight = Number(rootObject?.innerHeight);
    const responsiveHeight = Number.isFinite(viewportHeight) && viewportHeight > 0
      ? Math.floor(viewportHeight * 0.7)
      : 760;
    return `${Math.min(760, Math.max(320, responsiveHeight))}px`;
  }

  function normalizeEditorNewlines(value) {
    return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function preferredEditorNewline(value) {
    const matches = String(value ?? "").match(/\r\n|\r|\n/g) || [];
    if (!matches.length) return "\n";
    const counts = new Map();
    let preferred = matches[0];
    for (const newline of matches) {
      const count = (counts.get(newline) || 0) + 1;
      counts.set(newline, count);
      if (count > (counts.get(preferred) || 0)) preferred = newline;
    }
    return preferred;
  }

  /**
   * A text-only Tabulator editor that protects embedded line endings.
   *
   * HTML textarea values normalize CRLF and CR to LF. Returning a textarea's
   * value unchanged would therefore mutate an untouched multiline CSV field.
   * This editor returns the original field byte-for-byte after a no-op edit,
   * and applies the field's dominant original line-ending convention when the
   * user intentionally changes multiline content. Every field uses a textarea
   * so Alt+Enter can turn a single-line value into a multiline value without
   * replacing the editor or losing focus.
   */
  function csvTextEditor(cell, onRendered, success, cancel, params = {}) {
    const original = String(cell?.getValue?.() ?? "");
    const normalizedOriginal = normalizeEditorNewlines(original);
    const sourceMultiline = /[\r\n]/.test(original);
    const newline = sourceMultiline
      ? preferredEditorNewline(original)
      : (/^(?:\r\n|\r|\n)$/.test(params.newline || "") ? params.newline : "\n");
    const editor = document.createElement("textarea");
    const accessibleLabel = params.label || "Edit CSV cell";
    let multilineMode = sourceMultiline;
    let finished = false;

    editor.value = normalizedOriginal;
    editor.className = "csv-tabulator-editor";
    editor.rows = sourceMultiline ? 4 : 1;
    editor.setAttribute("autocomplete", "off");
    editor.setAttribute("spellcheck", "false");

    const updateMode = (forceMultiline = false) => {
      multilineMode = multilineMode || forceMultiline || editor.value.includes("\n");
      if (multilineMode) {
        editor.dataset.multiline = "true";
        editor.rows = Math.max(4, editor.value.split("\n").length);
        editor.setAttribute(
          "aria-label",
          `${accessibleLabel}; Enter adds a line; Shift+Enter saves`,
        );
      } else {
        delete editor.dataset.multiline;
        editor.rows = 1;
        editor.setAttribute(
          "aria-label",
          `${accessibleLabel}; Enter saves; Alt+Enter adds a line`,
        );
      }
    };
    updateMode();

    const finalValue = () => {
      if (editor.value === normalizedOriginal) return original;
      return editor.value.replace(/\n/g, newline);
    };
    const commit = () => {
      if (finished) return;
      finished = true;
      success(finalValue());
    };
    const abort = () => {
      if (finished) return;
      finished = true;
      cancel();
    };
    const insertLineBreak = () => {
      const start = Number.isInteger(editor.selectionStart) ? editor.selectionStart : editor.value.length;
      const end = Number.isInteger(editor.selectionEnd) ? editor.selectionEnd : start;
      if (typeof editor.setRangeText === "function") {
        editor.setRangeText("\n", start, end, "end");
      } else {
        editor.value = `${editor.value.slice(0, start)}\n${editor.value.slice(end)}`;
        const next = start + 1;
        editor.selectionStart = next;
        editor.selectionEnd = next;
      }
      updateMode(true);
    };

    editor.addEventListener("input", () => updateMode());
    editor.addEventListener("blur", commit);
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        abort();
        return;
      }
      if (event.key !== "Enter") return;

      if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        insertLineBreak();
        return;
      }
      if (!multilineMode || event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        commit();
        return;
      }
      // Preserve the textarea's native line insertion while preventing the
      // grid's keybindings from treating Enter as navigation or a commit.
      event.stopPropagation();
    });

    onRendered(() => {
      editor.focus();
      editor.select();
    });
    return editor;
  }

  class TabulatorGrid {
    constructor(container, callbacks = {}, TabulatorConstructor = globalThis.Tabulator) {
      const ElementConstructor = globalThis.HTMLElement;
      if (typeof ElementConstructor !== "function" || !(container instanceof ElementConstructor)) {
        throw new TypeError("TabulatorGrid requires an HTMLElement container.");
      }
      if (typeof TabulatorConstructor !== "function") throw new Error("Tabulator is not available.");

      this.container = container;
      this.callbacks = callbacks;
      this.Tabulator = TabulatorConstructor;
      this.document = null;
      this.table = null;
      this.ready = false;
      this.filterText = "";
      this.sorters = [];
      this.active = null;
      this.pendingFocus = null;
      this.viewportHeight = null;
      this.renderToken = 0;
      this.destroyed = false;
      this.viewOptions = normalizeViewOptions();
      this.readyPromise = Promise.resolve();
      this._resolveReady = null;
      this.container.setAttribute("aria-multiselectable", "true");

      this._pasteListener = (event) => {
        if (this.viewOptions.readOnly) return;
        const target = event.target;
        if (target?.closest?.("input, textarea, [contenteditable='true']")) return;
        const text = event.clipboardData?.getData?.("text/plain");
        if (!text || !this.active) return;
        event.preventDefault();
        this.callbacks.onPasteBlock?.(this.active.rowIndex, this.active.columnIndex, text);
      };
      this._focusListener = (event) => {
        const cell = event.target?.closest?.(".tabulator-cell[data-document-row-index][data-column-index]");
        if (!cell || !this.container.contains?.(cell)) return;
        this._setActiveCoordinates(Number(cell.dataset.documentRowIndex), Number(cell.dataset.columnIndex));
      };
      this.container.addEventListener("paste", this._pasteListener);
      this.container.addEventListener("focusin", this._focusListener);
    }

    get type() {
      return "tabulator";
    }

    _destroyTable() {
      this.renderToken += 1;
      this.ready = false;
      this._resolveReady?.(this.pageInfo());
      this._resolveReady = null;
      this.table?.destroy?.();
      this.table = null;
      this.container.replaceChildren();
      this.container.classList?.remove?.("tabulator", "tabulator-ranges", "tabulator-block-select");
      this.container.removeAttribute?.("role");
      this.container.removeAttribute?.("aria-owns");
      this.container.removeAttribute?.("aria-rowcount");
      this.container.removeAttribute?.("aria-colcount");
      this.container.removeAttribute?.("aria-readonly");
      this.container.removeAttribute?.("tabulator-layout");
      this.container.style?.removeProperty?.("height");
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this._destroyTable();
      this.container.removeEventListener("paste", this._pasteListener);
      this.container.removeEventListener("focusin", this._focusListener);
      this.active = null;
      this.pendingFocus = null;
    }

    _columns() {
      const headers = this.document.getHeaders();
      return headers.map((header, columnIndex) => {
        const title = header || `(blank ${Engine.columnLabel(columnIndex)})`;
        return {
          title,
          titleFormatter: "plaintext",
          field: `c${columnIndex}`,
          formatter: "textarea",
          variableHeight: true,
          editor: this.viewOptions.readOnly ? false : csvTextEditor,
          editorParams: { label: `Edit ${title}`, newline: this.document.newline },
          sorter: "string",
          headerSort: !this.viewOptions.disableSortFilter,
          headerSortTristate: true,
          minWidth: 140,
          widthGrow: 1,
          tooltip: false,
          cssClass: "csv-tabulator-cell",
        };
      });
    }

    _rowHeader() {
      return {
        title: "Row",
        titleFormatter: "plaintext",
        field: "__displayRow",
        formatter: "plaintext",
        headerSort: false,
        editor: false,
        width: 82,
        minWidth: 64,
        resizable: false,
        hozAlign: "right",
        headerHozAlign: "right",
        cssClass: "csv-tabulator-row-number",
      };
    }

    pageInfo() {
      const availableRows = this.document?.preview
        ? this.document.displayDataRowCount
        : (this.document?.dataRowCount || 0);
      const pageSize = this.viewOptions.pageSize || Math.max(availableRows, 1);
      const pageCount = this.viewOptions.pageSize ? Math.max(1, Math.ceil(availableRows / pageSize)) : 1;
      const pageIndex = Math.min(this.viewOptions.pageIndex, pageCount - 1);
      const start = availableRows ? pageIndex * pageSize : 0;
      const end = Math.min(availableRows, start + pageSize);
      return {
        pageIndex,
        pageNumber: pageIndex + 1,
        pageCount,
        pageSize,
        start,
        end,
        visibleRows: Math.max(0, end - start),
        availableRows,
        totalDocumentRows: this.document?.dataRowCount || 0,
      };
    }

    _data() {
      const page = this.pageInfo();
      this.viewOptions.pageIndex = page.pageIndex;
      return this.document.getDataRowEntries({
        offset: this.viewOptions.pageSize ? page.start : 0,
        limit: this.viewOptions.pageSize || undefined,
      }).map(({ row, documentIndex }, visibleIndex) => {
        const record = {
          __rowId: row.id,
          __documentIndex: documentIndex,
          __displayRow: documentIndex + 1,
          __ariaRowIndex: page.start + visibleIndex + 2,
        };
        for (let columnIndex = 0; columnIndex < this.document.columnCount; columnIndex += 1) {
          record[`c${columnIndex}`] = String(row.cells[columnIndex] ?? "");
        }
        return record;
      });
    }

    setDocument(documentModel, options = {}) {
      this.document = documentModel;
      this.viewOptions = normalizeViewOptions(options, documentModel);
      if (this.viewOptions.disableSortFilter) {
        this.sorters = [];
        this.filterText = "";
      }
      return this.render();
    }

    setPage(pageIndex) {
      if (!this.document || !this.viewOptions.pageSize) return Promise.resolve(this.pageInfo());
      this.viewOptions.pageIndex = Math.max(0, Math.trunc(Number(pageIndex) || 0));
      return this.render().then(() => this.pageInfo());
    }

    setViewportHeight(value, options = {}) {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return this.viewportHeight;
      const height = Math.max(120, Math.trunc(numericValue));
      const previousHeight = this.viewportHeight;
      this.viewportHeight = height;
      this.container.style?.setProperty?.("--csv-grid-height", `${height}px`);
      if (!this.table) return height;
      if (height === previousHeight) return height;

      const holder = this.container.querySelector?.(".tabulator-tableholder");
      const scrollLeft = Number(holder?.scrollLeft) || 0;
      const scrollTop = Number(holder?.scrollTop) || 0;
      const active = this.getActiveCell();
      const ownerDocument = this.container.ownerDocument || globalThis.document;
      const focusedElement = ownerDocument?.activeElement;
      const restoreGridFocus = Boolean(active && focusedElement && this.container.contains?.(focusedElement));
      this.table.setHeight?.(`${height}px`);
      if (options.redraw !== false) this.table.redraw?.(false);

      const restoreScroll = () => {
        const currentHolder = this.container.querySelector?.(".tabulator-tableholder");
        if (!currentHolder) return;
        currentHolder.scrollLeft = scrollLeft;
        currentHolder.scrollTop = scrollTop;
        if (restoreGridFocus) this.requestFocus(active.rowIndex, active.columnIndex);
      };
      const requestFrame = globalThis.requestAnimationFrame;
      if (typeof requestFrame === "function") requestFrame(restoreScroll);
      else restoreScroll();
      return height;
    }

    redraw() {
      this.table?.redraw?.(false);
    }

    render() {
      this._destroyTable();
      this.active = null;
      this.readyPromise = new Promise((resolve) => { this._resolveReady = resolve; });
      if (!this.document || this.destroyed) {
        this._resolveReady?.();
        this._resolveReady = null;
        return this.readyPromise;
      }

      const token = ++this.renderToken;
      const page = this.pageInfo();
      const filename = this.document.filename || "Untitled CSV";
      const label = this.viewOptions.mode === "preview"
        ? `${filename} read-only data preview`
        : this.viewOptions.mode === "paged"
          ? `${filename} data editor, page ${page.pageNumber} of ${page.pageCount}`
          : `${filename} data editor`;
      this.container.setAttribute("aria-label", label);
      this.container.setAttribute("aria-rowcount", String((this.document.preview ? page.visibleRows : this.document.dataRowCount) + 1));
      this.container.setAttribute("aria-colcount", String(this.document.columnCount + 1));
      this.container.setAttribute("aria-readonly", String(this.viewOptions.readOnly));

      const table = new this.Tabulator(this.container, {
        data: this._data(),
        columns: this._columns(),
        rowHeader: this._rowHeader(),
        index: "__rowId",
        layout: "fitDataStretch",
        minHeight: "120px",
        // CSV-3 supplies a measured pixel height so Tabulator's virtual DOM
        // and internal tableholder resize with the browser workspace.
        height: this.viewportHeight ? `${this.viewportHeight}px` : gridFallbackHeight(),
        placeholder: "This file has no data rows.",
        editTriggerEvent: "dblclick",
        editorEmptyValue: "",
        history: false,
        selectableRange: 1,
        selectableRangeColumns: false,
        selectableRangeRows: false,
        selectableRangeClearCells: false,
        selectableRangeAutoFocus: true,
        selectableRangeBlurEditOnNavigate: true,
        clipboard: "copy",
        clipboardCopyStyled: false,
        clipboardCopyConfig: {
          rowHeaders: false,
          columnHeaders: false,
          columnGroups: false,
          rowGroups: false,
          columnCalcs: false,
          dataTree: false,
          formatCells: false,
        },
        clipboardCopyRowRange: "range",
        keybindings: true,
        rowFormatter: (row) => this._decorateRow(row),
        columnDefaults: {
          resizable: "header",
          vertAlign: "middle",
          headerWordWrap: true,
        },
      });
      this.table = table;

      const current = () => !this.destroyed && this.table === table && this.renderToken === token;
      table.on?.("tableBuilt", () => {
        if (!current()) return;
        this.ready = true;
        this._applySorters();
        this._applyFilter();
        this._updateAccessibility();
        this._applyPendingFocus();
        const page = this.pageInfo();
        this.callbacks.onReady?.(page);
        this._resolveReady?.(page);
        this._resolveReady = null;
      });
      table.on?.("renderComplete", () => {
        if (!current()) return;
        this._updateAccessibility();
        this._applyPendingFocus();
      });
      table.on?.("dataFiltered", (_filters, rows) => {
        if (!current()) return;
        this._updateAccessibility(Array.isArray(rows) ? rows.length : null);
      });
      table.on?.("dataSorted", (sorters) => {
        if (!current() || this.viewOptions.disableSortFilter) return;
        this.sorters = normalizeSorters(sorters);
        this._updateAccessibility();
      });
      table.on?.("cellClick", (_event, cell) => this._setActive(cell));
      table.on?.("cellDblClick", (_event, cell) => this._setActive(cell));
      table.on?.("cellEditing", (cell) => this._setActive(cell));
      table.on?.("cellEdited", (cell) => {
        if (this.viewOptions.readOnly) return;
        const rowData = cell.getRow().getData();
        const columnIndex = columnIndexFromField(cell.getField());
        if (columnIndex === null) return;
        this._setActive(cell);
        this.callbacks.onCellChange?.(
          rowData.__documentIndex,
          columnIndex,
          String(cell.getValue() ?? ""),
        );
      });
      const activateRangeStart = (range) => {
        const start = range?.getBounds?.()?.start;
        if (start) this._setActive(start);
      };
      table.on?.("rangeAdded", (range) => {
        activateRangeStart(range);
        this._applyRangeSelection(range);
      });
      table.on?.("rangeChanged", (range) => {
        activateRangeStart(range);
        this._applyRangeSelection(range);
      });
      table.on?.("rangeRemoved", () => this._clearRangeSelection());
      return this.readyPromise;
    }

    _decorateRow(row) {
      const data = row?.getData?.();
      const rowElement = row?.getElement?.();
      if (!data || !rowElement) return;
      rowElement.dataset.documentRowIndex = String(data.__documentIndex);
      rowElement.dataset.fileRow = String(data.__displayRow);
      rowElement.setAttribute("aria-rowindex", String(data.__ariaRowIndex));

      const rowHeader = rowElement.querySelector?.(".tabulator-row-header");
      if (rowHeader) {
        rowHeader.setAttribute("role", "rowheader");
        rowHeader.setAttribute("aria-colindex", "1");
        rowHeader.setAttribute("aria-label", `File row ${data.__displayRow}`);
        rowHeader.setAttribute("aria-rowindex", String(data.__ariaRowIndex));
        rowHeader.setAttribute("aria-readonly", "true");
      }

      const headers = this.document.getHeaders();
      row.getCells?.().forEach((cell) => {
        const columnIndex = columnIndexFromField(cell.getField?.());
        if (columnIndex === null) return;
        const element = cell.getElement?.();
        if (!element) return;
        element.dataset.documentRowIndex = String(data.__documentIndex);
        element.dataset.columnIndex = String(columnIndex);
        element.setAttribute("aria-colindex", String(columnIndex + 2));
        element.setAttribute("aria-rowindex", String(data.__ariaRowIndex));
        element.setAttribute("aria-readonly", String(this.viewOptions.readOnly));
        const header = headers[columnIndex] || `Column ${Engine.columnLabel(columnIndex)}`;
        element.setAttribute(
          "aria-label",
          `File row ${data.__displayRow}, ${header}: ${accessibleValue(cell.getValue?.())}`,
        );
      });
    }

    _updateAccessibility(activeRowCount = null) {
      if (!this.document) return;
      let rowCount = activeRowCount;
      if (!Number.isInteger(rowCount)) {
        try {
          const activeRows = this.table?.getRows?.("active");
          rowCount = Array.isArray(activeRows) ? activeRows.length : this.document.dataRowCount;
        } catch {
          rowCount = this.document.dataRowCount;
        }
      }
      const page = this.pageInfo();
      const announcedRows = this.document.preview
        ? page.visibleRows
        : this.viewOptions.mode === "standard" && Number.isInteger(activeRowCount)
          ? rowCount
          : this.document.dataRowCount;
      this.container.setAttribute("aria-rowcount", String(announcedRows + 1));
      this.container.setAttribute("aria-colcount", String(this.document.columnCount + 1));
      this.container.setAttribute("aria-readonly", String(this.viewOptions.readOnly));
      this.container.querySelector?.(".tabulator-row-header")?.setAttribute?.("aria-colindex", "1");
      this.container.querySelectorAll?.(".tabulator-col[tabulator-field]").forEach((header) => {
        const columnIndex = columnIndexFromField(header.getAttribute("tabulator-field"));
        if (columnIndex !== null) {
          header.setAttribute("aria-colindex", String(columnIndex + 2));
          header.id = `csv-column-${columnIndex}`;
        }
      });
    }

    _clearRangeSelection(notify = true) {
      this.container.querySelectorAll?.('[aria-selected="true"]').forEach((element) => {
        element.removeAttribute?.("aria-selected");
      });
      if (notify) this.callbacks.onRangeChange?.(null);
    }

    _applyRangeSelection(range) {
      this._clearRangeSelection(false);
      const rawCells = range?.getCells?.();
      const cells = Array.isArray(rawCells) ? rawCells.flat(Infinity).filter(Boolean) : [];
      const selected = [];
      for (const cell of cells) {
        const element = cell?.getElement?.();
        const rowData = cell?.getRow?.().getData?.();
        const columnIndex = columnIndexFromField(cell?.getField?.());
        if (!element || !rowData || columnIndex === null) continue;
        element.setAttribute("aria-selected", "true");
        selected.push({ rowIndex: rowData.__documentIndex, columnIndex });
      }
      if (!selected.length) {
        const bounds = range?.getBounds?.();
        const startData = bounds?.start?.getRow?.().getData?.();
        const endData = bounds?.end?.getRow?.().getData?.();
        const startColumn = columnIndexFromField(bounds?.start?.getField?.());
        const endColumn = columnIndexFromField(bounds?.end?.getField?.());
        if (startData && endData && startColumn !== null && endColumn !== null) {
          const rowStart = Math.min(startData.__documentIndex, endData.__documentIndex);
          const rowEnd = Math.max(startData.__documentIndex, endData.__documentIndex);
          const columnStart = Math.min(startColumn, endColumn);
          const columnEnd = Math.max(startColumn, endColumn);
          this.container.querySelectorAll?.(".tabulator-cell[data-document-row-index][data-column-index]")
            .forEach((element) => {
              const rowIndex = Number(element.dataset.documentRowIndex);
              const columnIndex = Number(element.dataset.columnIndex);
              if (rowIndex >= rowStart && rowIndex <= rowEnd
                  && columnIndex >= columnStart && columnIndex <= columnEnd) {
                element.setAttribute("aria-selected", "true");
                selected.push({ rowIndex, columnIndex });
              }
            });
        }
      }
      if (!selected.length) {
        this.callbacks.onRangeChange?.(null);
        return;
      }
      const rows = selected.map((item) => item.rowIndex);
      const columns = selected.map((item) => item.columnIndex);
      const selection = {
        cellCount: selected.length,
        rowCount: Math.max(...rows) - Math.min(...rows) + 1,
        columnCount: Math.max(...columns) - Math.min(...columns) + 1,
        start: { rowIndex: Math.min(...rows), columnIndex: Math.min(...columns) },
        end: { rowIndex: Math.max(...rows), columnIndex: Math.max(...columns) },
      };
      this.callbacks.onRangeChange?.(selection);
    }

    _setActiveCoordinates(rowIndex, columnIndex) {
      if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex) || columnIndex < 0) return;
      const next = { rowIndex, columnIndex };
      if (this.active?.rowIndex === next.rowIndex && this.active?.columnIndex === next.columnIndex) return;
      this.active = next;
      this.callbacks.onActiveCell?.(this.getActiveCell());
    }

    _setActive(cell) {
      const rowData = cell?.getRow?.().getData?.();
      const columnIndex = columnIndexFromField(cell?.getField?.());
      if (!rowData || columnIndex === null) return;
      this._setActiveCoordinates(rowData.__documentIndex, columnIndex);
    }

    _applySorters() {
      if (this.viewOptions.disableSortFilter || !this.ready || !this.table || !this.sorters.length) return;
      const valid = this.sorters.filter((sorter) => {
        const columnIndex = columnIndexFromField(sorter.column);
        return columnIndex !== null && columnIndex < this.document.columnCount;
      });
      this.sorters = valid;
      if (valid.length) this.table.setSort?.(valid);
    }

    _filterFunction() {
      const needle = this.filterText.trim().toLocaleLowerCase();
      if (!needle) return null;
      return (record) => Object.entries(record).some(([key, cellValue]) => (
        DATA_FIELD.test(key) && String(cellValue).toLocaleLowerCase().includes(needle)
      ));
    }

    _applyFilter() {
      if (this.viewOptions.disableSortFilter || !this.ready || !this.table) return;
      const filter = this._filterFunction();
      if (!filter) this.table.clearFilter?.(true);
      else this.table.setFilter?.(filter);
    }

    setFilter(value) {
      if (this.viewOptions.disableSortFilter) return false;
      this.filterText = String(value || "");
      this._applyFilter();
      return true;
    }

    getActiveCell() {
      return this.active ? { ...this.active } : null;
    }

    _findCell(rowIndex, columnIndex) {
      if (!this.table) return null;
      const rows = this.table.getRows?.("active") || this.table.getRows?.() || [];
      const row = rows.find((candidate) => candidate.getData?.().__documentIndex === rowIndex);
      return row?.getCell?.(`c${columnIndex}`) || null;
    }

    _applyPendingFocus() {
      if (!this.ready || !this.pendingFocus) return;
      const requested = this.pendingFocus;
      this.pendingFocus = null;
      const cell = this._findCell(requested.rowIndex, requested.columnIndex);
      if (!cell) return;
      this._setActive(cell);
      const focus = () => {
        const element = cell.getElement?.();
        // Restore focus without synthesizing a click. A synthetic click can
        // close open menus, submit controls, or trigger grid edit behavior.
        element?.focus?.({ preventScroll: true });
      };
      focus();
      const scrollResult = cell.getRow?.().scrollTo?.("center", false);
      if (scrollResult && typeof scrollResult.then === "function") scrollResult.then(focus, focus);
    }

    requestFocus(rowIndex, columnIndex) {
      if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return;
      this.pendingFocus = { rowIndex, columnIndex };
      this._applyPendingFocus();
    }
  }

  function isAvailable(rootObject = globalThis) {
    return typeof rootObject.Tabulator === "function";
  }

  return { TabulatorGrid, dependencyReport, isAvailable, requiredVendor: REQUIRED_VENDOR };
});

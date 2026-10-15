/*
 * Marin CSV preservation engine (CSV-4).
 *
 * The engine treats every field as text. It keeps the original bytes so an
 * untouched document downloads byte-for-byte, and it keeps each original row's
 * raw representation so edited output preserves unaffected records and file
 * conventions wherever possible.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarinCsvEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
  const VALID_DELIMITERS = new Set([",", "\t"]);
  const VALID_NEWLINES = new Set(["\r\n", "\n", "\r"]);

  class CsvError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "CsvError";
      this.code = code;
      this.details = details;
    }
  }

  function requireDelimiter(value) {
    if (!VALID_DELIMITERS.has(value)) {
      throw new CsvError("UNSUPPORTED_DELIMITER", "Marin CSV supports comma- and tab-delimited files.", { delimiter: value });
    }
    return value;
  }

  function toUint8Array(value) {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    throw new TypeError("Expected an ArrayBuffer or Uint8Array.");
  }

  function startsWithBom(bytes) {
    return bytes.length >= 3 && bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2];
  }

  function decodeUtf8(bytes) {
    const input = toUint8Array(bytes);
    const bom = startsWithBom(input);
    const body = bom ? input.subarray(3) : input;
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch (error) {
      throw new CsvError(
        "UNSUPPORTED_ENCODING",
        "This file is not valid UTF-8. Marin CSV refuses to guess an encoding because guessing can change data.",
        { cause: String(error) },
      );
    }
    return { text, bom, bytes: input };
  }

  function encodeUtf8(text, includeBom) {
    const body = new TextEncoder().encode(text);
    if (!includeBom) return body;
    const output = new Uint8Array(UTF8_BOM.length + body.length);
    output.set(UTF8_BOM, 0);
    output.set(body, UTF8_BOM.length);
    return output;
  }

  function detachedString(value) {
    const text = String(value ?? "");
    return text ? Array.from(text).join("") : "";
  }

  function cloneRow(row) {
    return {
      id: row.id,
      cells: row.cells.slice(),
      quoteFlags: row.quoteFlags.slice(),
      raw: row.raw,
      separator: row.separator,
      changed: Boolean(row.changed),
      isNew: Boolean(row.isNew),
    };
  }

  function cloneRecoveryValue(value) {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) {
      return new value.constructor(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }
    if (Array.isArray(value)) return value.map(cloneRecoveryValue);
    if (value && typeof value === "object") {
      const result = {};
      Object.entries(value).forEach(([key, item]) => { result[key] = cloneRecoveryValue(item); });
      return result;
    }
    return value;
  }

  function validateRecoverySnapshot(snapshot, expectedKind) {
    if (!snapshot || typeof snapshot !== "object") {
      throw new CsvError("INVALID_RECOVERY_SNAPSHOT", "The local recovery snapshot is missing or invalid.");
    }
    if (snapshot.formatVersion !== 1 || snapshot.kind !== expectedKind) {
      throw new CsvError(
        "UNSUPPORTED_RECOVERY_SNAPSHOT",
        "This local copy cannot be opened by this version of Marin CSV.",
        { formatVersion: snapshot.formatVersion, kind: snapshot.kind },
      );
    }
    if (!Array.isArray(snapshot.rows)) {
      throw new CsvError("INVALID_RECOVERY_SNAPSHOT", "The local recovery snapshot does not contain valid rows.");
    }
  }

  function restoreRow(target, snapshot) {
    target.id = snapshot.id;
    target.cells = snapshot.cells.slice();
    target.quoteFlags = snapshot.quoteFlags.slice();
    target.raw = snapshot.raw;
    target.separator = snapshot.separator;
    target.changed = Boolean(snapshot.changed);
    target.isNew = Boolean(snapshot.isNew);
  }

  function replaceRowsCommand(indexes, rows) {
    return {
      type: "replace-rows",
      rows: indexes
        .filter((index) => rows[index])
        .map((index) => ({ index, row: cloneRow(rows[index]) })),
    };
  }

  function scanDelimited(text, delimiter, options = {}) {
    requireDelimiter(delimiter);
    const strict = options.strict !== false;
    const rows = [];
    const warnings = [];
    const newlineCounts = { "\r\n": 0, "\n": 0, "\r": 0 };
    let currentCells = [];
    let currentQuoteFlags = [];
    let field = "";
    let fieldQuoted = false;
    let inQuotes = false;
    let afterClosingQuote = false;
    let rowStart = 0;
    let rowNumber = 1;
    let columnNumber = 1;
    let rowId = 1;
    let endedWithSeparator = false;

    const pushField = () => {
      currentCells.push(field);
      currentQuoteFlags.push(fieldQuoted);
      field = "";
      fieldQuoted = false;
      afterClosingQuote = false;
      columnNumber += 1;
    };

    const pushRow = (rawEnd, separator) => {
      pushField();
      rows.push({
        id: rowId++,
        cells: currentCells,
        quoteFlags: currentQuoteFlags,
        raw: detachedString(text.slice(rowStart, rawEnd)),
        separator,
        changed: false,
        isNew: false,
      });
      currentCells = [];
      currentQuoteFlags = [];
      rowNumber += 1;
      columnNumber = 1;
    };

    let i = 0;
    while (i < text.length) {
      const char = text[i];

      if (inQuotes) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          afterClosingQuote = true;
          i += 1;
          continue;
        }
        field += char;
        i += 1;
        continue;
      }

      if (afterClosingQuote && char !== delimiter && char !== "\r" && char !== "\n") {
        warnings.push({
          code: "CHARACTERS_AFTER_QUOTE",
          message: "Characters appear after a closing quote. They were preserved as part of the field.",
          row: rowNumber,
          column: columnNumber,
        });
        field += char;
        afterClosingQuote = false;
        i += 1;
        continue;
      }

      if (char === delimiter) {
        pushField();
        endedWithSeparator = false;
        i += 1;
        continue;
      }

      if (char === "\r" || char === "\n") {
        const separator = char === "\r" && text[i + 1] === "\n" ? "\r\n" : char;
        newlineCounts[separator] += 1;
        pushRow(i, separator);
        i += separator.length;
        rowStart = i;
        endedWithSeparator = true;
        continue;
      }

      if (char === '"') {
        if (field.length === 0 && !fieldQuoted) {
          fieldQuoted = true;
          inQuotes = true;
        } else {
          warnings.push({
            code: "QUOTE_IN_UNQUOTED_FIELD",
            message: "A quote appears inside an unquoted field. The quote was preserved literally.",
            row: rowNumber,
            column: columnNumber,
          });
          field += char;
        }
        endedWithSeparator = false;
        i += 1;
        continue;
      }

      field += char;
      endedWithSeparator = false;
      i += 1;
    }

    if (inQuotes) {
      const detail = { row: rowNumber, column: columnNumber };
      if (strict) {
        throw new CsvError("UNCLOSED_QUOTE", `A quoted field beginning on row ${rowNumber} is not closed.`, detail);
      }
      warnings.push({
        code: "UNCLOSED_QUOTE",
        message: `A quoted field beginning on row ${rowNumber} is not closed.`,
        row: rowNumber,
        column: columnNumber,
      });
    }

    if (text.length > 0 && !endedWithSeparator) pushRow(text.length, "");

    return {
      rows,
      warnings,
      newlineCounts,
      trailingNewline: text.length > 0 && endedWithSeparator,
    };
  }


  function profileDelimited(text, delimiter, options = {}) {
    requireDelimiter(delimiter);
    const strict = options.strict !== false;
    const previewRowLimit = Math.max(0, Math.trunc(Number(options.previewRowLimit) || 0));
    const warningLimit = Math.max(1, Math.trunc(Number(options.warningLimit) || 50));
    const previewRows = [];
    const warnings = [];
    const newlineCounts = { "\r\n": 0, "\n": 0, "\r": 0 };
    const widthCounts = new Map();
    const widthExamples = new Map();
    let suppressedWarnings = 0;
    let currentCells = [];
    let currentQuoteFlags = [];
    let field = "";
    let fieldQuoted = false;
    let inQuotes = false;
    let afterClosingQuote = false;
    let rowStart = 0;
    let rowNumber = 1;
    let columnNumber = 1;
    let rowWidth = 0;
    let totalRows = 0;
    let totalCells = 0;
    let maxColumns = 0;
    let formulaLikeCount = 0;
    let endedWithSeparator = false;

    const collectCurrentRow = () => totalRows < previewRowLimit;
    const addWarning = (warning) => {
      if (warnings.length < warningLimit) warnings.push(warning);
      else suppressedWarnings += 1;
    };
    const pushField = () => {
      if (collectCurrentRow()) {
        currentCells.push(field);
        currentQuoteFlags.push(fieldQuoted);
      }
      if (formulaLike(field)) formulaLikeCount += 1;
      rowWidth += 1;
      field = "";
      fieldQuoted = false;
      afterClosingQuote = false;
      columnNumber += 1;
    };
    const pushRow = (rawEnd, separator) => {
      pushField();
      totalRows += 1;
      totalCells += rowWidth;
      maxColumns = Math.max(maxColumns, rowWidth);
      widthCounts.set(rowWidth, (widthCounts.get(rowWidth) || 0) + 1);
      if (!widthExamples.has(rowWidth)) widthExamples.set(rowWidth, []);
      const examples = widthExamples.get(rowWidth);
      if (examples.length < 5) examples.push(totalRows);
      if (previewRows.length < previewRowLimit) {
        previewRows.push({
          id: totalRows,
          cells: currentCells,
          quoteFlags: currentQuoteFlags,
          raw: detachedString(text.slice(rowStart, rawEnd)),
          separator,
          changed: false,
          isNew: false,
        });
      }
      currentCells = [];
      currentQuoteFlags = [];
      rowWidth = 0;
      rowNumber += 1;
      columnNumber = 1;
    };

    let i = 0;
    while (i < text.length) {
      const char = text[i];
      if (inQuotes) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          afterClosingQuote = true;
          i += 1;
          continue;
        }
        field += char;
        i += 1;
        continue;
      }
      if (afterClosingQuote && char !== delimiter && char !== "\r" && char !== "\n") {
        addWarning({
          code: "CHARACTERS_AFTER_QUOTE",
          message: "Characters appear after a closing quote. They were preserved as part of the field.",
          row: rowNumber,
          column: columnNumber,
        });
        field += char;
        afterClosingQuote = false;
        i += 1;
        continue;
      }
      if (char === delimiter) {
        pushField();
        endedWithSeparator = false;
        i += 1;
        continue;
      }
      if (char === "\r" || char === "\n") {
        const separator = char === "\r" && text[i + 1] === "\n" ? "\r\n" : char;
        newlineCounts[separator] += 1;
        pushRow(i, separator);
        i += separator.length;
        rowStart = i;
        endedWithSeparator = true;
        continue;
      }
      if (char === '"') {
        if (field.length === 0 && !fieldQuoted) {
          fieldQuoted = true;
          inQuotes = true;
        } else {
          addWarning({
            code: "QUOTE_IN_UNQUOTED_FIELD",
            message: "A quote appears inside an unquoted field. The quote was preserved literally.",
            row: rowNumber,
            column: columnNumber,
          });
          field += char;
        }
        endedWithSeparator = false;
        i += 1;
        continue;
      }
      field += char;
      endedWithSeparator = false;
      i += 1;
    }

    if (inQuotes) {
      const detail = { row: rowNumber, column: columnNumber };
      if (strict) {
        throw new CsvError("UNCLOSED_QUOTE", `A quoted field beginning on row ${rowNumber} is not closed.`, detail);
      }
      addWarning({
        code: "UNCLOSED_QUOTE",
        message: `A quoted field beginning on row ${rowNumber} is not closed.`,
        row: rowNumber,
        column: columnNumber,
      });
    }
    if (text.length > 0 && !endedWithSeparator) pushRow(text.length, "");

    let expectedWidth = 0;
    let expectedCount = -1;
    for (const [width, count] of widthCounts) {
      if (count > expectedCount) {
        expectedWidth = width;
        expectedCount = count;
      }
    }
    for (const [width, examples] of widthExamples) {
      if (width === expectedWidth) continue;
      for (const row of examples) {
        addWarning({
          code: "INCONSISTENT_COLUMNS",
          message: `Row ${row} has ${width} field${width === 1 ? "" : "s"}; most rows have ${expectedWidth}.`,
          row,
        });
      }
    }
    const usedNewlines = Object.entries(newlineCounts).filter(([, count]) => count > 0);
    if (usedNewlines.length > 1) {
      addWarning({
        code: "MIXED_NEWLINES",
        message: "The file uses mixed line endings. An unchanged download retains every original byte.",
      });
    }
    if (suppressedWarnings) {
      warnings.push({
        code: "ADDITIONAL_WARNINGS",
        message: `${suppressedWarnings.toLocaleString()} additional structural warning${suppressedWarnings === 1 ? " was" : "s were"} omitted from this preview.`,
      });
    }

    return {
      previewRows,
      warnings,
      newlineCounts,
      trailingNewline: text.length > 0 && endedWithSeparator,
      totalRows,
      totalCells,
      maxColumns,
      expectedWidth,
      formulaLikeCount,
    };
  }

  function mode(values) {
    const counts = new Map();
    let bestValue;
    let bestCount = -1;
    values.forEach((value) => {
      const count = (counts.get(value) || 0) + 1;
      counts.set(value, count);
      if (count > bestCount) {
        bestCount = count;
        bestValue = value;
      }
    });
    return { value: bestValue, count: bestCount };
  }

  function delimiterScore(text, delimiter) {
    let parsed;
    try {
      parsed = scanDelimited(text.slice(0, 512 * 1024), delimiter, { strict: false });
    } catch {
      return -Infinity;
    }
    const widths = parsed.rows.slice(0, 50).map((row) => row.cells.length);
    if (!widths.length) return 0;
    const common = mode(widths);
    const multiColumn = Number(common.value || 0) > 1 ? 1000 : 0;
    return multiColumn + common.count * 20 + Number(common.value || 0) - parsed.warnings.length * 5;
  }

  function detectDelimiter(text, filename = "") {
    const lower = String(filename).toLowerCase();
    const commaScore = delimiterScore(text, ",");
    const tabScore = delimiterScore(text, "\t");
    if (tabScore > commaScore) return "\t";
    if (commaScore > tabScore) return ",";
    return lower.endsWith(".tsv") ? "\t" : ",";
  }

  function profileBytes(bytes, options = {}) {
    const decoded = decodeUtf8(bytes);
    const filename = options.filename || "data.csv";
    const delimiter = options.delimiter && options.delimiter !== "auto"
      ? requireDelimiter(options.delimiter)
      : detectDelimiter(decoded.text, filename);
    const profile = profileDelimited(decoded.text, delimiter, {
      strict: options.strict !== false,
      previewRowLimit: options.previewRowLimit,
      warningLimit: options.warningLimit,
    });
    return {
      filename,
      originalBytes: decoded.bytes,
      originalText: decoded.text,
      delimiter,
      bom: decoded.bom,
      newline: dominantNewline(profile.newlineCounts),
      ...profile,
    };
  }

  function dominantNewline(counts) {
    const entries = ["\r\n", "\n", "\r"].map((value) => [value, counts[value] || 0]);
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][1] > 0 ? entries[0][0] : "\r\n";
  }

  function normalizePapaRows(data, text) {
    const rows = Array.isArray(data)
      ? data.map((row) => (Array.isArray(row) ? row.map((value) => (value == null ? "" : String(value))) : [String(row ?? "")]))
      : [];
    if (/\r\n$|\r$|\n$/.test(text) && rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
      rows.pop();
    }
    return rows;
  }

  function validateWithPapa(text, delimiter, scannedRows, papa) {
    if (!papa || typeof papa.parse !== "function") {
      return { available: false, matched: null, errors: [], version: null };
    }
    let result;
    try {
      result = papa.parse(text, {
        delimiter,
        header: false,
        dynamicTyping: false,
        skipEmptyLines: false,
        quoteChar: '"',
        escapeChar: '"',
        comments: false,
        transform: undefined,
      });
    } catch (error) {
      return {
        available: true,
        matched: false,
        errors: [{
          code: "PAPA_PARSE_EXCEPTION",
          message: "Papa Parse could not validate this file.",
          row: null,
          detail: String(error),
        }],
        version: typeof papa.VERSION === "string" ? papa.VERSION : null,
      };
    }
    const papaRows = normalizePapaRows(result.data, text);
    let matched = papaRows.length === scannedRows.length;
    if (matched) {
      for (let r = 0; r < scannedRows.length && matched; r += 1) {
        const expected = scannedRows[r].cells;
        const actual = papaRows[r];
        if (expected.length !== actual.length) matched = false;
        else {
          for (let c = 0; c < expected.length; c += 1) {
            if (expected[c] !== actual[c]) {
              matched = false;
              break;
            }
          }
        }
      }
    }
    return {
      available: true,
      matched,
      errors: Array.isArray(result.errors) ? result.errors.map((error) => ({
        code: error.code || "PAPA_PARSE",
        message: error.message || "Papa Parse reported a parsing problem.",
        row: Number.isInteger(error.row) ? error.row + 1 : null,
      })) : [],
      version: typeof papa.VERSION === "string" ? papa.VERSION : null,
    };
  }

  function columnLabel(index) {
    let value = Number(index) + 1;
    let label = "";
    while (value > 0) {
      value -= 1;
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }
    return label;
  }

  function needsQuote(value, delimiter) {
    return value.includes(delimiter)
      || value.includes('"')
      || value.includes("\r")
      || value.includes("\n")
      || /^\s|\s$/.test(value);
  }

  function serializeField(value, delimiter, preferQuote) {
    const text = String(value ?? "");
    if (!preferQuote && !needsQuote(text, delimiter)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function serializeRow(row, delimiter) {
    const cells = row.cells || [];
    return cells.map((value, index) => serializeField(value, delimiter, Boolean(row.quoteFlags[index]))).join(delimiter);
  }

  function bytesEqual(a, b) {
    const left = toUint8Array(a);
    const right = toUint8Array(b);
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
    return true;
  }

  function formulaLike(value) {
    return /^[\t\r\n ]*[=+\-@]/.test(String(value));
  }

  function makeFilename(original, edited, sequence = 1) {
    const name = String(original || "data.csv").replace(/[\\/]/g, "_");
    const match = name.match(/^(.*?)(\.[^.]+)?$/);
    const stem = match && match[1] ? match[1] : "data";
    const extension = match && match[2] ? match[2] : ".csv";
    const count = Math.max(1, Math.trunc(Number(sequence) || 1));
    const suffix = count > 1 ? `-${count}` : "";
    return `${stem}-${edited ? "edited" : "copy"}${suffix}${extension}`;
  }

  class CsvDocument {
    constructor(config) {
      this.filename = config.filename;
      this.originalBytes = config.adoptTransfer === true && config.originalBytes instanceof Uint8Array
        ? config.originalBytes
        : new Uint8Array(config.originalBytes);
      this.delimiter = config.delimiter;
      this.bom = config.bom;
      this.rows = config.rows;
      this.warnings = config.warnings;
      this.parserValidation = config.parserValidation;
      this.newlineCounts = config.newlineCounts;
      this.newline = config.newline;
      this.trailingNewline = config.trailingNewline;
      this.headerMode = config.headerMode !== false;
      this.readOnly = false;
      this.preview = false;
      this.history = [];
      this.historyIndex = 0;
      this.baseModifiedFromOpen = Boolean(config.modifiedFromOpen);
      this.lastDownloadedIndex = config.hasUndownloadedChanges ? -1 : 0;
      this.downloadCount = Math.max(0, Math.trunc(Number(config.downloadCount) || 0));
      this.nextRowId = this.rows.reduce((largest, row) => Math.max(largest, row.id), 0) + 1;
      this.recoveryListeners = new Set();
    }

    static fromTransfer(config) {
      if (!config || config.kind !== "full") throw new TypeError("Expected a full Marin CSV transfer record.");
      return new CsvDocument({ ...config, adoptTransfer: true });
    }

    static fromRecoverySnapshot(snapshot, originalBytes) {
      validateRecoverySnapshot(snapshot, "full");
      return new CsvDocument({
        filename: snapshot.filename || "data.csv",
        originalBytes: toUint8Array(originalBytes),
        delimiter: requireDelimiter(snapshot.delimiter),
        bom: Boolean(snapshot.bom),
        rows: snapshot.rows.map(cloneRow),
        warnings: (snapshot.warnings || []).map((warning) => ({ ...warning })),
        parserValidation: cloneRecoveryValue(snapshot.parserValidation || {
          available: false,
          matched: null,
          errors: [],
          version: null,
        }),
        newlineCounts: { ...(snapshot.newlineCounts || { "\r\n": 0, "\n": 0, "\r": 0 }) },
        newline: VALID_NEWLINES.has(snapshot.newline) ? snapshot.newline : "\n",
        trailingNewline: Boolean(snapshot.trailingNewline),
        headerMode: snapshot.state?.headerMode !== false,
        downloadCount: snapshot.state?.downloadCount,
        modifiedFromOpen: Boolean(snapshot.state?.modifiedFromOpen),
        hasUndownloadedChanges: Boolean(snapshot.state?.hasUndownloadedChanges),
      });
    }

    static fromBytes(bytes, options = {}) {
      const decoded = decodeUtf8(bytes);
      const filename = options.filename || "data.csv";
      const delimiter = options.delimiter && options.delimiter !== "auto"
        ? requireDelimiter(options.delimiter)
        : detectDelimiter(decoded.text, filename);
      const scanned = scanDelimited(decoded.text, delimiter, { strict: true });
      const parserValidation = validateWithPapa(decoded.text, delimiter, scanned.rows, options.papa);
      const warnings = scanned.warnings.slice();
      if (parserValidation.available && !parserValidation.matched) {
        warnings.push({
          code: "PARSER_DISAGREEMENT",
          message: "The preservation scanner and Papa Parse did not produce identical fields. Do not edit or export this file until the discrepancy is reviewed.",
        });
      }
      parserValidation.errors.forEach((error) => warnings.push(error));
      const widths = scanned.rows.map((row) => row.cells.length);
      if (widths.length) {
        const expected = mode(widths).value;
        let inconsistentCount = 0;
        widths.forEach((width, index) => {
          if (width !== expected) {
            inconsistentCount += 1;
            if (inconsistentCount <= 50) {
              warnings.push({
                code: "INCONSISTENT_COLUMNS",
                message: `Row ${index + 1} has ${width} field${width === 1 ? "" : "s"}; most rows have ${expected}.`,
                row: index + 1,
              });
            }
          }
        });
        if (inconsistentCount > 50) {
          warnings.push({
            code: "ADDITIONAL_INCONSISTENT_COLUMNS",
            message: `${(inconsistentCount - 50).toLocaleString()} additional row-width warning${inconsistentCount - 50 === 1 ? " was" : "s were"} omitted.`,
          });
        }
      }
      const usedNewlines = Object.entries(scanned.newlineCounts).filter(([, count]) => count > 0);
      if (usedNewlines.length > 1) {
        warnings.push({
          code: "MIXED_NEWLINES",
          message: "The file uses mixed line endings. Unchanged rows keep their original endings; newly created row boundaries use the dominant style.",
        });
      }
      return new CsvDocument({
        filename,
        originalBytes: decoded.bytes,
        delimiter,
        bom: decoded.bom,
        rows: scanned.rows,
        warnings,
        parserValidation,
        newlineCounts: scanned.newlineCounts,
        newline: dominantNewline(scanned.newlineCounts),
        trailingNewline: scanned.trailingNewline,
        headerMode: options.headerMode !== false,
      });
    }

    get modifiedFromOpen() {
      return this.baseModifiedFromOpen || this.historyIndex !== 0;
    }

    get hasUndownloadedChanges() {
      return this.modifiedFromOpen && this.historyIndex !== this.lastDownloadedIndex;
    }

    get canUndo() {
      return this.historyIndex > 0;
    }

    get canRedo() {
      return this.historyIndex < this.history.length;
    }

    get rowCount() {
      return this.rows.length;
    }

    get dataRowCount() {
      return Math.max(0, this.rows.length - (this.headerMode && this.rows.length ? 1 : 0));
    }

    get columnCount() {
      return this.rows.reduce((largest, row) => Math.max(largest, row.cells.length), 0);
    }

    get cellCount() {
      return this.rows.reduce((total, row) => total + row.cells.length, 0);
    }

    get displayDataRowCount() {
      return this.dataRowCount;
    }

    setHeaderMode(enabled) {
      const next = Boolean(enabled);
      if (next === this.headerMode) return false;
      this.headerMode = next;
      this._emitRecovery({ type: "set-header-mode", enabled: next }, "Change first-row view");
      return true;
    }

    getHeaders() {
      const count = this.columnCount;
      if (this.headerMode && this.rows.length) {
        return Array.from({ length: count }, (_, index) => this.rows[0].cells[index] ?? "");
      }
      return Array.from({ length: count }, (_, index) => `Column ${columnLabel(index)}`);
    }

    getDataRowEntries(options = {}) {
      const start = this.headerMode && this.rows.length ? 1 : 0;
      const requestedOffset = Math.max(0, Math.trunc(Number(options.offset) || 0));
      const available = Math.max(0, this.rows.length - start);
      const offset = Math.min(requestedOffset, available);
      const requestedLimit = Number(options.limit);
      const limit = Number.isFinite(requestedLimit) && requestedLimit >= 0
        ? Math.trunc(requestedLimit)
        : available;
      return this.rows.slice(start + offset, start + offset + limit)
        .map((row, index) => ({ row, documentIndex: start + offset + index }));
    }

    getCell(rowIndex, columnIndex) {
      const row = this.rows[rowIndex];
      return row ? row.cells[columnIndex] ?? "" : "";
    }

    subscribeRecovery(listener) {
      if (typeof listener !== "function") throw new TypeError("Recovery listener must be a function.");
      this.recoveryListeners.add(listener);
      return () => this.recoveryListeners.delete(listener);
    }

    recoveryState() {
      return {
        modifiedFromOpen: this.modifiedFromOpen,
        hasUndownloadedChanges: this.hasUndownloadedChanges,
        downloadCount: this.downloadCount,
        headerMode: this.headerMode,
      };
    }

    _emitRecovery(command, label = "Document change") {
      if (!command || !this.recoveryListeners.size) return;
      const event = {
        label,
        command: cloneRecoveryValue(command),
        state: this.recoveryState(),
      };
      this.recoveryListeners.forEach((listener) => listener(cloneRecoveryValue(event)));
    }

    _execute(label, redo, undo, recovery = {}) {
      if (this.historyIndex < this.history.length) {
        this.history.splice(this.historyIndex);
        this.lastDownloadedIndex = -1;
      }
      redo();
      const redoRecovery = typeof recovery.redo === "function" ? recovery.redo() : recovery.redo;
      const undoRecovery = typeof recovery.undo === "function" ? recovery.undo() : recovery.undo;
      this.history.push({ label, redo, undo, redoRecovery, undoRecovery });
      this.historyIndex += 1;
      this._emitRecovery(redoRecovery, label);
    }

    undo() {
      if (!this.canUndo) return null;
      const command = this.history[this.historyIndex - 1];
      command.undo();
      this.historyIndex -= 1;
      this._emitRecovery(command.undoRecovery, `Undo ${command.label}`);
      return command.label;
    }

    redo() {
      if (!this.canRedo) return null;
      const command = this.history[this.historyIndex];
      command.redo();
      this.historyIndex += 1;
      this._emitRecovery(command.redoRecovery, `Redo ${command.label}`);
      return command.label;
    }

    markDownloaded() {
      this.lastDownloadedIndex = this.historyIndex;
      this.downloadCount += 1;
      this._emitRecovery({ type: "download-state" }, "Download CSV");
    }

    _snapshotRows(indexes) {
      const result = new Map();
      indexes.forEach((index) => {
        if (this.rows[index]) result.set(index, cloneRow(this.rows[index]));
      });
      return result;
    }

    _restoreRows(snapshots) {
      snapshots.forEach((snapshot, index) => {
        if (this.rows[index]) restoreRow(this.rows[index], snapshot);
      });
    }

    setCell(rowIndex, columnIndex, value, label = "Edit cell") {
      if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex) || columnIndex < 0) return false;
      const row = this.rows[rowIndex];
      if (!row) return false;
      const text = String(value ?? "");
      if ((row.cells[columnIndex] ?? "") === text && columnIndex < row.cells.length) return false;
      const before = cloneRow(row);
      const apply = () => {
        while (row.cells.length <= columnIndex) {
          row.cells.push("");
          row.quoteFlags.push(false);
        }
        row.cells[columnIndex] = text;
        row.changed = true;
      };
      this._execute(label, apply, () => restoreRow(row, before), {
        redo: () => replaceRowsCommand([rowIndex], this.rows),
        undo: { type: "replace-rows", rows: [{ index: rowIndex, row: before }] },
      });
      return true;
    }

    setCells(edits, label = "Edit cells") {
      const byCell = new Map();
      edits
        .filter((edit) => Number.isInteger(edit.rowIndex) && Number.isInteger(edit.columnIndex)
          && edit.columnIndex >= 0 && this.rows[edit.rowIndex])
        .forEach((edit) => {
          const normalized = {
            rowIndex: edit.rowIndex,
            columnIndex: edit.columnIndex,
            value: String(edit.value ?? ""),
          };
          byCell.set(`${normalized.rowIndex}:${normalized.columnIndex}`, normalized);
        });
      const normalized = [...byCell.values()].filter((edit) => {
        const row = this.rows[edit.rowIndex];
        return edit.columnIndex >= row.cells.length || row.cells[edit.columnIndex] !== edit.value;
      });
      if (!normalized.length) return 0;
      const affected = [...new Set(normalized.map((edit) => edit.rowIndex))];
      const before = this._snapshotRows(affected);
      const apply = () => {
        normalized.forEach((edit) => {
          const row = this.rows[edit.rowIndex];
          while (row.cells.length <= edit.columnIndex) {
            row.cells.push("");
            row.quoteFlags.push(false);
          }
          row.cells[edit.columnIndex] = edit.value;
          row.changed = true;
        });
      };
      this._execute(label, apply, () => this._restoreRows(before), {
        redo: () => replaceRowsCommand(affected, this.rows),
        undo: {
          type: "replace-rows",
          rows: [...before.entries()].map(([index, row]) => ({ index, row: cloneRow(row) })),
        },
      });
      return normalized.length;
    }

    addRow(index = this.rows.length, values = []) {
      const requested = Number(index);
      const bounded = Number.isFinite(requested)
        ? Math.max(0, Math.min(Math.trunc(requested), this.rows.length))
        : this.rows.length;
      const width = Math.max(this.columnCount, values.length, 1);
      const row = {
        id: this.nextRowId++,
        cells: Array.from({ length: width }, (_, column) => String(values[column] ?? "")),
        quoteFlags: Array.from({ length: width }, () => false),
        raw: "",
        separator: "",
        changed: true,
        isNew: true,
      };
      this._execute("Add row", () => this.rows.splice(bounded, 0, row), () => this.rows.splice(bounded, 1), {
        redo: { type: "splice-rows", index: bounded, deleteCount: 0, rows: [cloneRow(row)] },
        undo: { type: "splice-rows", index: bounded, deleteCount: 1, rows: [] },
      });
      return bounded;
    }

    deleteRow(index) {
      if (!Number.isInteger(index) || !this.rows[index]) return false;
      const row = this.rows[index];
      this._execute("Delete row", () => this.rows.splice(index, 1), () => this.rows.splice(index, 0, row), {
        redo: { type: "splice-rows", index, deleteCount: 1, rows: [] },
        undo: { type: "splice-rows", index, deleteCount: 0, rows: [cloneRow(row)] },
      });
      return true;
    }

    addColumn(index = this.columnCount) {
      const requested = Number(index);
      const bounded = Number.isFinite(requested)
        ? Math.max(0, Math.min(Math.trunc(requested), this.columnCount))
        : this.columnCount;
      const affected = this.rows.map((_, rowIndex) => rowIndex);
      const before = this._snapshotRows(affected);
      const apply = () => {
        this.rows.forEach((row) => {
          while (row.cells.length < bounded) {
            row.cells.push("");
            row.quoteFlags.push(false);
          }
          row.cells.splice(bounded, 0, "");
          row.quoteFlags.splice(bounded, 0, false);
          row.changed = true;
        });
      };
      this._execute("Add column", apply, () => this._restoreRows(before), {
        redo: () => replaceRowsCommand(affected, this.rows),
        undo: {
          type: "replace-rows",
          rows: [...before.entries()].map(([rowIndex, row]) => ({ index: rowIndex, row: cloneRow(row) })),
        },
      });
      return bounded;
    }

    deleteColumn(index) {
      if (!Number.isInteger(index) || index < 0 || index >= this.columnCount || this.columnCount <= 1) return false;
      const affected = this.rows.map((_, rowIndex) => rowIndex);
      const before = this._snapshotRows(affected);
      const apply = () => {
        this.rows.forEach((row) => {
          if (index >= row.cells.length) return;
          row.cells.splice(index, 1);
          if (index < row.quoteFlags.length) row.quoteFlags.splice(index, 1);
          row.changed = true;
        });
      };
      this._execute("Delete column", apply, () => this._restoreRows(before), {
        redo: () => replaceRowsCommand(affected, this.rows),
        undo: {
          type: "replace-rows",
          rows: [...before.entries()].map(([rowIndex, row]) => ({ index: rowIndex, row: cloneRow(row) })),
        },
      });
      return true;
    }

    setHeaders(values) {
      const headers = Array.from({ length: this.columnCount || values.length || 1 }, (_, index) => String(values[index] ?? ""));
      if (!this.rows.length) {
        this.addRow(0, headers);
        this.headerMode = true;
        return headers.length;
      }
      return this.setCells(headers.map((value, columnIndex) => ({ rowIndex: 0, columnIndex, value })), "Edit column names");
    }

    findMatches(query, options = {}) {
      const needle = String(query ?? "");
      if (!needle) return [];
      const caseSensitive = Boolean(options.caseSensitive);
      const wholeCell = Boolean(options.wholeCell);
      const includeHeader = options.includeHeader !== false;
      const firstRow = includeHeader ? 0 : (this.rows.length ? 1 : 0);
      const expected = caseSensitive ? needle : needle.toLocaleLowerCase();
      const matches = [];
      for (let rowIndex = firstRow; rowIndex < this.rows.length; rowIndex += 1) {
        const row = this.rows[rowIndex];
        for (let columnIndex = 0; columnIndex < row.cells.length; columnIndex += 1) {
          const value = String(row.cells[columnIndex] ?? "");
          const candidate = caseSensitive ? value : value.toLocaleLowerCase();
          if (wholeCell ? candidate === expected : candidate.includes(expected)) {
            matches.push({ rowIndex, columnIndex, value });
          }
        }
      }
      return matches;
    }

    replaceAll(query, replacement, options = {}) {
      const needle = String(query ?? "");
      if (!needle) return 0;
      const replacementText = String(replacement ?? "");
      const matches = this.findMatches(needle, options);
      if (!matches.length) return 0;
      const caseSensitive = Boolean(options.caseSensitive);
      const wholeCell = Boolean(options.wholeCell);
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expression = new RegExp(escaped, caseSensitive ? "g" : "gi");
      const edits = matches.map((match) => ({
        rowIndex: match.rowIndex,
        columnIndex: match.columnIndex,
        value: wholeCell ? replacementText : match.value.replace(expression, () => replacementText),
      }));
      return this.setCells(edits, `Replace ${matches.length} match${matches.length === 1 ? "" : "es"}`);
    }

    formulaLikeCells(limit = Infinity) {
      const results = [];
      const maximum = Number.isFinite(Number(limit)) ? Math.max(0, Math.trunc(Number(limit))) : Infinity;
      outer: for (let rowIndex = 0; rowIndex < this.rows.length; rowIndex += 1) {
        const row = this.rows[rowIndex];
        for (let columnIndex = 0; columnIndex < row.cells.length; columnIndex += 1) {
          const value = row.cells[columnIndex];
          if (formulaLike(value)) {
            results.push({ rowIndex, columnIndex, value });
            if (results.length >= maximum) break outer;
          }
        }
      }
      return results;
    }

    formulaLikeCount() {
      let count = 0;
      this.rows.forEach((row) => {
        row.cells.forEach((value) => {
          if (formulaLike(value)) count += 1;
        });
      });
      return count;
    }

    structuralWarnings() {
      const warnings = this.warnings.slice();
      if (this.headerMode && this.rows.length) {
        const headers = this.getHeaders();
        const seen = new Map();
        headers.forEach((header, index) => {
          if (header === "") {
            warnings.push({
              code: "BLANK_HEADER",
              message: `Column ${columnLabel(index)} has a blank name. The blank value is preserved.`,
              row: 1,
              column: index + 1,
            });
          }
          const key = header;
          if (seen.has(key)) {
            warnings.push({
              code: "DUPLICATE_HEADER",
              message: `Column ${columnLabel(index)} repeats the column name “${header || "(blank)"}”. Duplicate names are preserved.`,
              row: 1,
              column: index + 1,
            });
          } else seen.set(key, index);
        });
      }
      const formulaCount = this.formulaLikeCount();
      if (formulaCount) {
        warnings.push({
          code: "FORMULA_LIKE_VALUES",
          message: `${formulaCount.toLocaleString()} field${formulaCount === 1 ? "" : "s"} begin with a character spreadsheet software may interpret as a formula. Marin CSV preserves the text and does not sanitize it silently.`,
        });
      }
      return warnings;
    }

    _applyRecoveryState(state = {}) {
      this.history = [];
      this.historyIndex = 0;
      this.baseModifiedFromOpen = Boolean(state.modifiedFromOpen);
      this.lastDownloadedIndex = state.hasUndownloadedChanges ? -1 : 0;
      this.downloadCount = Math.max(0, Math.trunc(Number(state.downloadCount) || 0));
      if (typeof state.headerMode === "boolean") this.headerMode = state.headerMode;
    }

    applyRecoveryCommand(command, state = {}) {
      if (!command || typeof command !== "object") {
        throw new CsvError("INVALID_RECOVERY_COMMAND", "A local recovery journal entry is invalid.");
      }
      if (command.type === "replace-rows") {
        if (!Array.isArray(command.rows)) {
          throw new CsvError("INVALID_RECOVERY_COMMAND", "A local recovery row replacement is invalid.");
        }
        command.rows.forEach((entry) => {
          const index = Number(entry?.index);
          if (!Number.isInteger(index) || index < 0 || index >= this.rows.length || !entry.row) {
            throw new CsvError("INVALID_RECOVERY_COMMAND", "A local recovery row replacement targets an invalid row.");
          }
          this.rows[index] = cloneRow(entry.row);
        });
      } else if (command.type === "splice-rows") {
        const index = Number(command.index);
        const deleteCount = Number(command.deleteCount);
        if (!Number.isInteger(index) || index < 0 || index > this.rows.length
            || !Number.isInteger(deleteCount) || deleteCount < 0 || index + deleteCount > this.rows.length
            || !Array.isArray(command.rows)) {
          throw new CsvError("INVALID_RECOVERY_COMMAND", "A local recovery row operation is invalid.");
        }
        this.rows.splice(index, deleteCount, ...command.rows.map(cloneRow));
      } else if (command.type === "set-header-mode") {
        this.headerMode = Boolean(command.enabled);
      } else if (command.type !== "download-state") {
        throw new CsvError(
          "UNSUPPORTED_RECOVERY_COMMAND",
          "This local copy contains a change that this version of Marin CSV cannot replay.",
          { type: command.type },
        );
      }
      this.nextRowId = this.rows.reduce((largest, row) => Math.max(largest, Number(row.id) || 0), 0) + 1;
      this._applyRecoveryState(state);
      return true;
    }

    toRecoverySnapshot() {
      return {
        formatVersion: 1,
        kind: "full",
        filename: this.filename,
        delimiter: this.delimiter,
        bom: this.bom,
        rows: this.rows.map(cloneRow),
        warnings: this.warnings.map((warning) => ({ ...warning })),
        parserValidation: cloneRecoveryValue(this.parserValidation),
        newlineCounts: { ...this.newlineCounts },
        newline: this.newline,
        trailingNewline: this.trailingNewline,
        state: this.recoveryState(),
      };
    }

    serializeText() {
      if (!this.rows.length) return "";
      let output = "";
      this.rows.forEach((row, index) => {
        output += !row.changed && !row.isNew ? row.raw : serializeRow(row, this.delimiter);
        if (index < this.rows.length - 1) {
          output += VALID_NEWLINES.has(row.separator) ? row.separator : this.newline;
        } else if (this.trailingNewline) {
          output += VALID_NEWLINES.has(row.separator) ? row.separator : this.newline;
        }
      });
      return output;
    }

    validateCurrentWithPapa(papa) {
      return validateWithPapa(this.serializeText(), this.delimiter, this.rows, papa);
    }

    exportBytes() {
      if (!this.modifiedFromOpen) return new Uint8Array(this.originalBytes);
      return encodeUtf8(this.serializeText(), this.bom);
    }

    downloadName() {
      return makeFilename(this.filename, this.modifiedFromOpen, this.downloadCount + 1);
    }

    toTransfer(options = {}) {
      const move = options.move === true;
      return {
        kind: "full",
        filename: this.filename,
        originalBytes: move ? this.originalBytes : new Uint8Array(this.originalBytes),
        delimiter: this.delimiter,
        bom: this.bom,
        rows: move ? this.rows : this.rows.map(cloneRow),
        warnings: move ? this.warnings : this.warnings.map((warning) => ({ ...warning })),
        parserValidation: move ? this.parserValidation : {
          ...this.parserValidation,
          errors: (this.parserValidation?.errors || []).map((error) => ({ ...error })),
        },
        newlineCounts: move ? this.newlineCounts : { ...this.newlineCounts },
        newline: this.newline,
        trailingNewline: this.trailingNewline,
        headerMode: this.headerMode,
        downloadCount: this.downloadCount,
      };
    }

    metadata() {
      return {
        filename: this.filename,
        delimiter: this.delimiter,
        delimiterName: this.delimiter === "\t" ? "Tab" : "Comma",
        bom: this.bom,
        encoding: "UTF-8",
        newline: this.newline,
        newlineName: this.newline === "\r\n" ? "CRLF" : this.newline === "\n" ? "LF" : "CR",
        trailingNewline: this.trailingNewline,
        bytes: this.originalBytes.byteLength,
        rows: this.rowCount,
        dataRows: this.dataRowCount,
        displayDataRows: this.displayDataRowCount,
        columns: this.columnCount,
        cells: this.cellCount,
        readOnly: this.readOnly,
        preview: this.preview,
        modifiedFromOpen: this.modifiedFromOpen,
        hasUndownloadedChanges: this.hasUndownloadedChanges,
      };
    }
  }


  class CsvPreviewDocument {
    constructor(config) {
      this.filename = config.filename;
      const adoptTransfer = config.adoptTransfer === true;
      this.originalBytes = adoptTransfer && config.originalBytes instanceof Uint8Array
        ? config.originalBytes
        : new Uint8Array(config.originalBytes);
      this.delimiter = config.delimiter;
      this.bom = Boolean(config.bom);
      this.rows = adoptTransfer ? (config.rows || []) : (config.rows || []).map(cloneRow);
      this.warnings = adoptTransfer
        ? (config.warnings || [])
        : (config.warnings || []).map((warning) => ({ ...warning }));
      this.parserValidation = config.parserValidation || {
        available: false,
        matched: null,
        errors: [],
        version: null,
        previewOnly: true,
      };
      this.newlineCounts = { ...(config.newlineCounts || { "\r\n": 0, "\n": 0, "\r": 0 }) };
      this.newline = config.newline || dominantNewline(this.newlineCounts);
      this.trailingNewline = Boolean(config.trailingNewline);
      this.headerMode = config.headerMode !== false;
      this.readOnly = true;
      this.preview = true;
      this.totalRowCount = Math.max(this.rows.length, Math.trunc(Number(config.totalRowCount) || 0));
      this.totalCellCount = Math.max(0, Math.trunc(Number(config.totalCellCount) || 0));
      this.totalColumnCount = Math.max(
        this.rows.reduce((largest, row) => Math.max(largest, row.cells.length), 0),
        Math.trunc(Number(config.totalColumnCount) || 0),
      );
      this.formulaLikeCount = Math.max(0, Math.trunc(Number(config.formulaLikeCount) || 0));
      this.downloadCount = Math.max(0, Math.trunc(Number(config.downloadCount) || 0));
      this.recoveryListeners = new Set();
    }

    static fromBytes(bytes, options = {}) {
      const headerMode = options.headerMode !== false;
      const dataLimit = Math.max(1, Math.trunc(Number(options.previewDataRows) || 1000));
      const profile = profileBytes(bytes, {
        ...options,
        previewRowLimit: dataLimit + (headerMode ? 1 : 0),
      });
      return CsvPreviewDocument.fromProfile(profile, { headerMode });
    }

    static fromProfile(profile, options = {}) {
      return new CsvPreviewDocument({
        filename: profile.filename,
        originalBytes: profile.originalBytes,
        delimiter: profile.delimiter,
        bom: profile.bom,
        rows: profile.previewRows,
        warnings: profile.warnings,
        newlineCounts: profile.newlineCounts,
        newline: profile.newline,
        trailingNewline: profile.trailingNewline,
        headerMode: options.headerMode !== false,
        totalRowCount: profile.totalRows,
        totalCellCount: profile.totalCells,
        totalColumnCount: profile.maxColumns,
        formulaLikeCount: profile.formulaLikeCount,
      });
    }

    static fromDocument(documentModel, options = {}) {
      const headerMode = options.headerMode !== false && documentModel.headerMode !== false;
      const dataLimit = Math.max(1, Math.trunc(Number(options.previewDataRows) || 1000));
      const rowLimit = dataLimit + (headerMode ? 1 : 0);
      return new CsvPreviewDocument({
        filename: documentModel.filename,
        originalBytes: documentModel.originalBytes,
        delimiter: documentModel.delimiter,
        bom: documentModel.bom,
        rows: documentModel.rows.slice(0, rowLimit),
        warnings: documentModel.warnings,
        newlineCounts: documentModel.newlineCounts,
        newline: documentModel.newline,
        trailingNewline: documentModel.trailingNewline,
        headerMode,
        totalRowCount: documentModel.rowCount,
        totalCellCount: documentModel.cellCount,
        totalColumnCount: documentModel.columnCount,
        formulaLikeCount: documentModel.formulaLikeCount(),
      });
    }

    static fromTransfer(config) {
      if (!config || config.kind !== "preview") throw new TypeError("Expected a Marin CSV preview transfer record.");
      return new CsvPreviewDocument({ ...config, adoptTransfer: true });
    }

    static fromRecoverySnapshot(snapshot, originalBytes) {
      validateRecoverySnapshot(snapshot, "preview");
      return new CsvPreviewDocument({
        filename: snapshot.filename || "data.csv",
        originalBytes: toUint8Array(originalBytes),
        delimiter: requireDelimiter(snapshot.delimiter),
        bom: Boolean(snapshot.bom),
        rows: snapshot.rows.map(cloneRow),
        warnings: (snapshot.warnings || []).map((warning) => ({ ...warning })),
        parserValidation: cloneRecoveryValue(snapshot.parserValidation || {
          available: false,
          matched: null,
          errors: [],
          version: null,
          previewOnly: true,
        }),
        newlineCounts: { ...(snapshot.newlineCounts || { "\r\n": 0, "\n": 0, "\r": 0 }) },
        newline: VALID_NEWLINES.has(snapshot.newline) ? snapshot.newline : "\n",
        trailingNewline: Boolean(snapshot.trailingNewline),
        headerMode: snapshot.state?.headerMode !== false,
        totalRowCount: snapshot.totalRowCount,
        totalCellCount: snapshot.totalCellCount,
        totalColumnCount: snapshot.totalColumnCount,
        formulaLikeCount: snapshot.formulaLikeCount,
        downloadCount: snapshot.state?.downloadCount,
      });
    }

    get modifiedFromOpen() { return false; }
    get hasUndownloadedChanges() { return false; }
    get canUndo() { return false; }
    get canRedo() { return false; }
    get rowCount() { return this.totalRowCount; }
    get dataRowCount() {
      return Math.max(0, this.totalRowCount - (this.headerMode && this.totalRowCount ? 1 : 0));
    }
    get displayDataRowCount() {
      return Math.max(0, this.rows.length - (this.headerMode && this.rows.length ? 1 : 0));
    }
    get columnCount() { return this.totalColumnCount; }
    get cellCount() { return this.totalCellCount; }
    get previewTruncated() { return this.totalRowCount > this.rows.length; }

    subscribeRecovery(listener) {
      if (typeof listener !== "function") throw new TypeError("Recovery listener must be a function.");
      this.recoveryListeners.add(listener);
      return () => this.recoveryListeners.delete(listener);
    }

    recoveryState() {
      return {
        modifiedFromOpen: false,
        hasUndownloadedChanges: false,
        downloadCount: this.downloadCount,
        headerMode: this.headerMode,
      };
    }

    _emitRecovery(command, label = "Document change") {
      if (!command || !this.recoveryListeners.size) return;
      const event = { label, command: cloneRecoveryValue(command), state: this.recoveryState() };
      this.recoveryListeners.forEach((listener) => listener(cloneRecoveryValue(event)));
    }

    setHeaderMode(enabled) {
      const next = Boolean(enabled);
      if (next === this.headerMode) return false;
      this.headerMode = next;
      this._emitRecovery({ type: "set-header-mode", enabled: next }, "Change first-row view");
      return true;
    }

    getHeaders() {
      if (this.headerMode && this.rows.length) {
        return Array.from({ length: this.columnCount }, (_, index) => this.rows[0].cells[index] ?? "");
      }
      return Array.from({ length: this.columnCount }, (_, index) => `Column ${columnLabel(index)}`);
    }

    getDataRowEntries(options = {}) {
      const start = this.headerMode && this.rows.length ? 1 : 0;
      const offset = Math.max(0, Math.trunc(Number(options.offset) || 0));
      const available = Math.max(0, this.rows.length - start);
      const limitValue = Number(options.limit);
      const limit = Number.isFinite(limitValue) && limitValue >= 0 ? Math.trunc(limitValue) : available;
      return this.rows.slice(start + offset, start + offset + limit)
        .map((row, index) => ({ row, documentIndex: start + offset + index }));
    }

    getCell(rowIndex, columnIndex) {
      const row = this.rows[rowIndex];
      return row ? row.cells[columnIndex] ?? "" : "";
    }

    structuralWarnings() {
      const warnings = this.warnings.map((warning) => ({ ...warning }));
      if (this.headerMode && this.rows.length) {
        const seen = new Map();
        this.getHeaders().forEach((header, index) => {
          if (header === "") {
            warnings.push({
              code: "BLANK_HEADER",
              message: `Column ${columnLabel(index)} has a blank name. The blank value is preserved.`,
              row: 1,
              column: index + 1,
            });
          }
          if (seen.has(header)) {
            warnings.push({
              code: "DUPLICATE_HEADER",
              message: `Column ${columnLabel(index)} repeats the column name “${header || "(blank)"}”. Duplicate names are preserved.`,
              row: 1,
              column: index + 1,
            });
          } else seen.set(header, index);
        });
      }
      if (this.formulaLikeCount) {
        warnings.push({
          code: "FORMULA_LIKE_VALUES",
          message: `${this.formulaLikeCount.toLocaleString()} field${this.formulaLikeCount === 1 ? "" : "s"} begin with a character spreadsheet software may interpret as a formula. Marin CSV preserves the original bytes and does not sanitize them silently.`,
        });
      }
      return warnings;
    }

    validateCurrentWithPapa() {
      return { available: false, matched: null, errors: [], version: null, previewOnly: true };
    }

    exportBytes() {
      return new Uint8Array(this.originalBytes);
    }

    downloadName() {
      return makeFilename(this.filename, false, this.downloadCount + 1);
    }

    markDownloaded() {
      this.downloadCount += 1;
      this._emitRecovery({ type: "download-state" }, "Download exact copy");
    }

    applyRecoveryCommand(command, state = {}) {
      if (!command || typeof command !== "object") {
        throw new CsvError("INVALID_RECOVERY_COMMAND", "A local recovery journal entry is invalid.");
      }
      if (command.type === "set-header-mode") this.headerMode = Boolean(command.enabled);
      else if (command.type !== "download-state") {
        throw new CsvError(
          "UNSUPPORTED_RECOVERY_COMMAND",
          "This local preview contains a change that this version of Marin CSV cannot replay.",
          { type: command.type },
        );
      }
      this.downloadCount = Math.max(0, Math.trunc(Number(state.downloadCount) || 0));
      if (typeof state.headerMode === "boolean") this.headerMode = state.headerMode;
      return true;
    }

    toRecoverySnapshot() {
      return {
        formatVersion: 1,
        kind: "preview",
        filename: this.filename,
        delimiter: this.delimiter,
        bom: this.bom,
        rows: this.rows.map(cloneRow),
        warnings: this.warnings.map((warning) => ({ ...warning })),
        parserValidation: cloneRecoveryValue(this.parserValidation),
        newlineCounts: { ...this.newlineCounts },
        newline: this.newline,
        trailingNewline: this.trailingNewline,
        totalRowCount: this.totalRowCount,
        totalCellCount: this.totalCellCount,
        totalColumnCount: this.totalColumnCount,
        formulaLikeCount: this.formulaLikeCount,
        state: this.recoveryState(),
      };
    }

    toTransfer(options = {}) {
      const move = options.move === true;
      return {
        kind: "preview",
        filename: this.filename,
        originalBytes: move ? this.originalBytes : new Uint8Array(this.originalBytes),
        delimiter: this.delimiter,
        bom: this.bom,
        rows: move ? this.rows : this.rows.map(cloneRow),
        warnings: move ? this.warnings : this.warnings.map((warning) => ({ ...warning })),
        parserValidation: move ? this.parserValidation : {
          ...this.parserValidation,
          errors: (this.parserValidation?.errors || []).map((error) => ({ ...error })),
        },
        newlineCounts: move ? this.newlineCounts : { ...this.newlineCounts },
        newline: this.newline,
        trailingNewline: this.trailingNewline,
        headerMode: this.headerMode,
        totalRowCount: this.totalRowCount,
        totalCellCount: this.totalCellCount,
        totalColumnCount: this.totalColumnCount,
        formulaLikeCount: this.formulaLikeCount,
        downloadCount: this.downloadCount,
      };
    }

    metadata() {
      return {
        filename: this.filename,
        delimiter: this.delimiter,
        delimiterName: this.delimiter === "\t" ? "Tab" : "Comma",
        bom: this.bom,
        encoding: "UTF-8",
        newline: this.newline,
        newlineName: this.newline === "\r\n" ? "CRLF" : this.newline === "\n" ? "LF" : "CR",
        trailingNewline: this.trailingNewline,
        bytes: this.originalBytes.byteLength,
        rows: this.rowCount,
        dataRows: this.dataRowCount,
        displayDataRows: this.displayDataRowCount,
        columns: this.columnCount,
        cells: this.cellCount,
        readOnly: true,
        preview: true,
        previewTruncated: this.previewTruncated,
        modifiedFromOpen: false,
        hasUndownloadedChanges: false,
      };
    }
  }

  function documentFromTransfer(config) {
    if (config?.kind === "full") return CsvDocument.fromTransfer(config);
    if (config?.kind === "preview") return CsvPreviewDocument.fromTransfer(config);
    throw new TypeError("Unknown Marin CSV transfer record.");
  }

  function documentFromRecoverySnapshot(snapshot, originalBytes) {
    if (snapshot?.kind === "full") return CsvDocument.fromRecoverySnapshot(snapshot, originalBytes);
    if (snapshot?.kind === "preview") return CsvPreviewDocument.fromRecoverySnapshot(snapshot, originalBytes);
    throw new CsvError("UNSUPPORTED_RECOVERY_SNAPSHOT", "This local copy cannot be opened by this version of Marin CSV.");
  }

  return {
    CsvDocument,
    CsvPreviewDocument,
    CsvError,
    bytesEqual,
    columnLabel,
    decodeUtf8,
    detectDelimiter,
    documentFromRecoverySnapshot,
    documentFromTransfer,
    encodeUtf8,
    formulaLike,
    profileBytes,
    profileDelimited,
    scanDelimited,
    serializeField,
    serializeRow,
    validateWithPapa,
    version: "0.4.0-csv4",
  };
});

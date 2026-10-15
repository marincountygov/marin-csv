#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const CASES = Object.freeze({
  "standard-1k-x-10": { rows: 1_000, columns: 10 },
  "paged-10k-x-10": { rows: 10_000, columns: 10 },
  "paged-10k-x-100": { rows: 10_000, columns: 100 },
  "preview-250k-x-1": { rows: 250_001, columns: 1 },
  "preview-1m-x-5": { rows: 1_000_000, columns: 5 },
});

function args() {
  const parsed = { caseName: null, json: null, markdown: null };
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (value === "--case") parsed.caseName = process.argv[++index];
    else if (value === "--json") parsed.json = process.argv[++index];
    else if (value === "--markdown") parsed.markdown = process.argv[++index];
    else if (value === "-h" || value === "--help") {
      console.log("Usage: node --expose-gc scripts/benchmark-large-files.js [--json FILE] [--markdown FILE]");
      console.log("Internal: --case NAME runs one isolated benchmark case.");
      process.exit(0);
    } else throw new Error(`Unknown option: ${value}`);
  }
  return parsed;
}

function generateDelimited(rows, columns) {
  const chunks = [];
  chunks.push(Buffer.from(`${Array.from({ length: columns }, (_, index) => `column_${index}`).join(",")}\n`));
  const batchSize = 5_000;
  for (let start = 0; start < rows; start += batchSize) {
    const lines = [];
    const end = Math.min(rows, start + batchSize);
    for (let row = start; row < end; row += 1) {
      const values = Array.from({ length: columns }, (_, column) => {
        if (column === 0) return String(row).padStart(8, "0");
        if (column === 1) return `03-${String((row % 28) + 1).padStart(2, "0")}`;
        return `r${row}c${column}`;
      });
      lines.push(values.join(","));
    }
    chunks.push(Buffer.from(`${lines.join("\n")}\n`));
  }
  return Buffer.concat(chunks);
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return { heapUsed: memory.heapUsed, rss: memory.rss };
}

function runCase(name) {
  const definition = CASES[name];
  if (!definition) throw new Error(`Unknown benchmark case: ${name}`);
  const Engine = require("../assets/csv-engine.js");
  const Loader = require("../assets/document-loader.js");
  const Papa = require("../vendor/third-party/papaparse.min.js");

  const generatedAt = performance.now();
  const buffer = generateDelimited(definition.rows, definition.columns);
  const generationMs = performance.now() - generatedAt;
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (typeof global.gc === "function") global.gc();
  const before = memorySnapshot();

  const progress = [];
  const openedAt = performance.now();
  const result = Loader.parseDirect(bytes, {
    filename: `${name}.csv`,
    headerMode: true,
    papa: Papa,
  }, ({ phase }) => progress.push(phase));
  const openWallMs = performance.now() - openedAt;
  if (typeof global.gc === "function") global.gc();
  const afterOpen = memorySnapshot();

  let validationMs = null;
  let serializationMs = null;
  let outputBytes = null;
  if (!result.document.readOnly && result.document.dataRowCount) {
    const firstDataRow = result.document.headerMode ? 1 : 0;
    result.document.setCell(firstDataRow, 0, "00000000-edited");
    const validationAt = performance.now();
    const validation = result.document.validateCurrentWithPapa(Papa);
    validationMs = performance.now() - validationAt;
    if (!validation.available || !validation.matched || validation.errors.length) {
      throw new Error(`${name}: Papa Parse validation failed during benchmark.`);
    }
    const serializationAt = performance.now();
    outputBytes = result.document.exportBytes().byteLength;
    serializationMs = performance.now() - serializationAt;
  } else {
    const serializationAt = performance.now();
    outputBytes = result.document.exportBytes().byteLength;
    serializationMs = performance.now() - serializationAt;
  }
  if (typeof global.gc === "function") global.gc();
  const afterWork = memorySnapshot();

  return {
    name,
    configuredRows: definition.rows,
    configuredColumns: definition.columns,
    sourceBytes: buffer.byteLength,
    generationMs,
    mode: result.policy.mode,
    readOnly: result.document.readOnly,
    totalRows: result.document.rowCount,
    dataRows: result.document.dataRowCount,
    displayedRows: result.document.displayDataRowCount,
    gridRows: result.policy.mode === "paged"
      ? Math.min(result.document.dataRowCount, result.policy.pageSize || result.document.dataRowCount)
      : result.document.displayDataRowCount,
    columns: result.document.columnCount,
    cells: result.document.cellCount,
    progress,
    metrics: result.metrics,
    openWallMs,
    validationMs,
    serializationMs,
    outputBytes,
    memory: {
      before,
      afterOpen,
      afterWork,
      openHeapDelta: afterOpen.heapUsed - before.heapUsed,
      openRssDelta: afterOpen.rss - before.rss,
    },
  };
}

function formatBytes(value) {
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function markdown(report) {
  const rows = report.cases.map((item) => [
    item.name,
    formatBytes(item.sourceBytes),
    item.mode,
    item.dataRows.toLocaleString("en-US"),
    item.columns.toLocaleString("en-US"),
    item.gridRows.toLocaleString("en-US"),
    `${item.openWallMs.toFixed(0)} ms`,
    formatBytes(item.memory.openHeapDelta),
    formatBytes(item.memory.openRssDelta),
    item.validationMs == null ? "Not applicable" : `${item.validationMs.toFixed(0)} ms`,
    `${item.serializationMs.toFixed(0)} ms`,
  ]);
  return [
    "# Marin CSV CSV-2 benchmark results",
    "",
    `Generated: ${report.generated}`,
    `Node: ${report.environment.node}`,
    `Platform: ${report.environment.platform}`,
    "",
    "These measurements are comparative evidence from one constrained test environment, not universal browser limits.",
    "",
    "| Case | Source | Mode | Data rows | Columns | Rows rendered per view | Open wall time | Retained heap delta | Retained RSS delta | Papa validation | Export |",
    "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
  ].join("\n");
}

function main() {
  const options = args();
  if (options.caseName) {
    process.stdout.write(`${JSON.stringify(runCase(options.caseName))}\n`);
    return;
  }

  const cases = [];
  for (const name of Object.keys(CASES)) {
    const child = spawnSync(process.execPath, ["--expose-gc", __filename, "--case", name], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (child.status !== 0) {
      process.stderr.write(child.stderr || child.stdout);
      process.exit(child.status || 1);
    }
    cases.push(JSON.parse(child.stdout));
  }
  const report = {
    schema: 1,
    generated: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
    },
    thresholds: require("../assets/large-file-policy.js").thresholds,
    cases,
  };
  const jsonText = `${JSON.stringify(report, null, 2)}\n`;
  const markdownText = markdown(report);
  if (options.json) fs.writeFileSync(path.resolve(options.json), jsonText);
  else process.stdout.write(jsonText);
  if (options.markdown) fs.writeFileSync(path.resolve(options.markdown), markdownText);
}

main();

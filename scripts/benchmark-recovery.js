#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const Engine = require("../assets/csv-engine.js");
const Store = require("../assets/recovery-store.js");
const Recovery = require("../assets/recovery-coordinator.js");

class MemorySessionStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function bytes(value) { return new TextEncoder().encode(value); }
function mib(value) { return Math.round((value / 1024 / 1024) * 10) / 10; }
function elapsed(start) { return Math.round((performance.now() - start) * 10) / 10; }
function collect() { if (typeof global.gc === "function") global.gc(); }
function memory() { collect(); return process.memoryUsage(); }

function standardCsv(rows, columns) {
  const header = Array.from({ length: columns }, (_, index) => `column_${index + 1}`).join(",");
  const lines = [header];
  for (let row = 0; row < rows; row += 1) {
    const values = Array.from({ length: columns }, (_, column) => `${row + 1}-${column + 1}`);
    lines.push(values.join(","));
  }
  return bytes(`${lines.join("\n")}\n`);
}

function previewCsv(rows) {
  const chunks = ["value\n"];
  const block = "001238\n".repeat(10000);
  let remaining = rows;
  while (remaining >= 10000) { chunks.push(block); remaining -= 10000; }
  if (remaining) chunks.push("001238\n".repeat(remaining));
  return bytes(chunks.join(""));
}

function coordinator(store, sessionStorage) {
  return new Recovery.RecoveryCoordinator({
    store,
    engine: Engine,
    sessionStorage,
    BroadcastChannel: null,
    debounceMs: 500,
    heartbeatMs: 1000000,
    leaseMs: 2000000,
    navigator: { storage: { persist: async () => false, estimate: async () => ({ usage: 0, quota: 1_000_000_000 }) } },
    performance: { getEntriesByType: () => [{ type: "navigate" }] },
  });
}

async function runCase(definition) {
  collect();
  const baseline = memory();
  const sourceStart = performance.now();
  const source = definition.source();
  const sourceMs = elapsed(sourceStart);

  const parseStart = performance.now();
  const documentModel = definition.preview
    ? Engine.CsvPreviewDocument.fromBytes(source, { filename: definition.filename, previewDataRows: 1000 })
    : Engine.CsvDocument.fromBytes(source, { filename: definition.filename });
  const parseMs = elapsed(parseStart);

  const store = new Store.MemoryRecoveryStore();
  const session = new MemorySessionStorage();
  const owner = coordinator(store, session);
  await owner.initialize();

  const initialStart = performance.now();
  const started = await owner.startNewDocument(documentModel, { policyMode: definition.mode });
  const initialCheckpointMs = elapsed(initialStart);

  let editAndJournalMs = null;
  let snapshotMs = null;
  if (!definition.preview) {
    const editStart = performance.now();
    documentModel.setCell(1, Math.min(1, documentModel.columnCount - 1), "001238");
    await owner.writeChain;
    editAndJournalMs = elapsed(editStart);
    const snapshotStart = performance.now();
    await owner.flush();
    snapshotMs = elapsed(snapshotStart);
  }

  await owner.detachCurrent({ releaseLease: true });
  owner.destroy();

  const reader = coordinator(store, new MemorySessionStorage());
  await reader.initialize();
  const restoreStart = performance.now();
  const restored = await reader.restoreDocument(started.documentId, { writable: false });
  const restoreMs = elapsed(restoreStart);
  if (!restored.document) throw new Error(`Recovery failed for ${definition.name}`);

  const after = memory();
  const bundle = await store.getBundle(started.documentId);
  reader.destroy();

  return {
    name: definition.name,
    mode: definition.mode,
    sourceBytes: source.byteLength,
    sourceMiB: mib(source.byteLength),
    physicalRows: documentModel.totalRowCount ?? documentModel.rowCount,
    columns: documentModel.totalColumnCount ?? documentModel.columnCount,
    sourceGenerationMs: sourceMs,
    parseMs,
    initialCheckpointMs,
    editAndJournalMs,
    snapshotCompactionMs: snapshotMs,
    restoreMs,
    retainedHeapMiB: mib(Math.max(0, after.heapUsed - baseline.heapUsed)),
    retainedRssMiB: mib(Math.max(0, after.rss - baseline.rss)),
    snapshots: bundle.snapshots.length,
    journalEntries: bundle.journal.length,
  };
}

function markdown(results) {
  const lines = [
    "# Marin CSV CSV-4 recovery benchmark results",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "These measurements use the production preservation engine, recovery coordinator, and deterministic memory-backed persistence adapter under Node.js. They measure snapshot/journal architecture and reconstruction cost; they are not native IndexedDB or end-user browser service-level guarantees.",
    "",
    "| Case | Mode | Source | Rows | Columns | Initial checkpoint | Edit + journal | Snapshot | Restore | Retained heap | Retained RSS |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const result of results) {
    lines.push(`| ${result.name} | ${result.mode} | ${result.sourceMiB} MiB | ${result.physicalRows.toLocaleString()} | ${result.columns.toLocaleString()} | ${result.initialCheckpointMs} ms | ${result.editAndJournalMs == null ? "—" : `${result.editAndJournalMs} ms`} | ${result.snapshotCompactionMs == null ? "—" : `${result.snapshotCompactionMs} ms`} | ${result.restoreMs} ms | ${result.retainedHeapMiB} MiB | ${result.retainedRssMiB} MiB |`);
  }
  lines.push(
    "",
    "The preview case retains original bytes and a bounded 1,000-row preview rather than constructing a complete editable model. Native IndexedDB timing, persistent-profile restart behavior, and browser-origin storage characteristics remain release-environment tests.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const jsonIndex = args.indexOf("--json");
  const markdownIndex = args.indexOf("--markdown");
  const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : path.join(__dirname, "..", "docs", "csv-4-recovery-benchmark-results.json");
  const markdownPath = markdownIndex >= 0 ? args[markdownIndex + 1] : path.join(__dirname, "..", "docs", "csv-4-recovery-benchmark-results.md");

  const cases = [
    { name: "Standard 1,000 × 10", mode: "standard", filename: "standard.csv", source: () => standardCsv(1000, 10) },
    { name: "Paged 10,000 × 10", mode: "paged", filename: "paged.csv", source: () => standardCsv(10000, 10) },
    { name: "Paged wide 2,000 × 100", mode: "paged", filename: "wide.csv", source: () => standardCsv(2000, 100) },
    { name: "Preview 250,001 × 1", mode: "preview", filename: "preview.csv", preview: true, source: () => previewCsv(250001) },
  ];

  const results = [];
  for (const definition of cases) {
    process.stdout.write(`Benchmarking ${definition.name}... `);
    results.push(await runCase(definition));
    console.log("done");
  }
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    gcExposed: typeof global.gc === "function",
    methodology: "Production preservation engine and recovery coordinator with MemoryRecoveryStore; not native IndexedDB.",
    results,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, `${markdown(results)}\n`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

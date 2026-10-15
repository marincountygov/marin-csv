/* Marin CSV CSV-2 document loading, worker routing, and policy application. */
(function (root, factory) {
  let engine = root.MarinCsvEngine;
  let policy = root.MarinCsvLargeFilePolicy;
  if (typeof module === "object" && module.exports) {
    engine = engine || require("./csv-engine.js");
    policy = policy || require("./large-file-policy.js");
  }
  const api = factory(engine, policy);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarinCsvDocumentLoader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine, Policy) {
  "use strict";

  if (!Engine || !Policy) throw new Error("Marin CSV document loading requires the preservation engine and large-file policy.");

  function now() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function emit(progress, phase, message) {
    if (typeof progress === "function") progress({ phase, message });
  }

  function policyStats(documentModel) {
    const metadata = documentModel.metadata();
    return {
      bytes: metadata.bytes,
      rows: metadata.rows,
      columns: metadata.columns,
      cells: metadata.cells,
    };
  }

  function parseDirect(bytes, options = {}, progress) {
    const started = now();
    const headerMode = options.headerMode !== false;
    emit(progress, "inspect", "Inspecting document size and structure");
    const inspectionStarted = now();
    const profile = Engine.profileBytes(bytes, {
      filename: options.filename,
      delimiter: options.delimiter,
      headerMode,
      previewRowLimit: Policy.thresholds.previewDataRows + (headerMode ? 1 : 0),
    });
    const inspectionMs = now() - inspectionStarted;
    const preflightPolicy = Policy.classify({
      bytes: profile.originalBytes.byteLength,
      rows: profile.totalRows,
      columns: profile.maxColumns,
      cells: profile.totalCells,
    });
    if (preflightPolicy.mode === "preview") {
      emit(progress, "preview", "Preparing a read-only preview");
      const documentModel = Engine.CsvPreviewDocument.fromProfile(profile, { headerMode });
      return {
        document: documentModel,
        policy: preflightPolicy,
        metrics: { inspectionMs, parseMs: 0, totalMs: now() - started },
        usedWorker: false,
      };
    }

    emit(progress, "parse", "Parsing and independently validating every field");
    const parseStarted = now();
    const sourceBytes = profile?.originalBytes || bytes;
    if (profile) profile.originalText = null;
    const fullDocument = Engine.CsvDocument.fromBytes(sourceBytes, {
      filename: options.filename,
      delimiter: options.delimiter,
      headerMode,
      papa: options.papa,
    });
    const parseMs = now() - parseStarted;
    const classification = Policy.classify(policyStats(fullDocument));
    const documentModel = classification.mode === "preview"
      ? Engine.CsvPreviewDocument.fromDocument(fullDocument, {
        headerMode,
        previewDataRows: Policy.thresholds.previewDataRows,
      })
      : fullDocument;
    return {
      document: documentModel,
      policy: classification,
      metrics: { inspectionMs, parseMs, totalMs: now() - started },
      usedWorker: false,
    };
  }

  function workerAllowed(rootObject = globalThis) {
    if (rootObject.MarinCsvDisableWorker) return false;
    if (typeof rootObject.Worker !== "function") return false;
    const protocol = rootObject.location?.protocol;
    return protocol === "http:" || protocol === "https:";
  }

  function workerUrl(rootObject = globalThis) {
    const base = rootObject.document?.baseURI || rootObject.location?.href;
    return new URL("assets/csv-worker.js", base).href;
  }

  function transferableBuffer(bytes) {
    if (bytes instanceof Uint8Array && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
      return bytes.buffer;
    }
    return new Uint8Array(bytes).buffer;
  }

  function parseWithWorker(bytes, options = {}, progress, rootObject = globalThis) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new rootObject.Worker(options.workerUrl || workerUrl(rootObject));
      } catch (error) {
        reject(error);
        return;
      }
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        callback(value);
      };
      worker.addEventListener("message", (event) => {
        const message = event.data || {};
        if (message.type === "progress") {
          emit(progress, message.phase, message.message);
          return;
        }
        if (message.type === "result") {
          try {
            const documentModel = Engine.documentFromTransfer(message.document);
            finish(resolve, {
              document: documentModel,
              policy: message.policy,
              metrics: message.metrics,
              usedWorker: true,
            });
          } catch (error) {
            finish(reject, error);
          }
          return;
        }
        if (message.type === "error") {
          const error = new Engine.CsvError(
            message.error?.code || "WORKER_PARSE_FAILED",
            message.error?.message || "Marin CSV could not parse this file in its local worker.",
            message.error?.details || {},
          );
          finish(reject, error);
        }
      });
      worker.addEventListener("error", (event) => {
        finish(reject, new Error(event.message || "The Marin CSV parsing worker failed."));
      });
      const buffer = transferableBuffer(bytes);
      worker.postMessage({
        type: "parse",
        buffer,
        options: {
          filename: options.filename,
          delimiter: options.delimiter || "auto",
          headerMode: options.headerMode !== false,
        },
      }, [buffer]);
    });
  }

  async function parseBytes(bytes, options = {}, progress, rootObject = globalThis) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError("parseBytes requires a Uint8Array.");
    if (workerAllowed(rootObject) && options.useWorker !== false) {
      emit(progress, "worker", "Starting the local parsing worker");
      return parseWithWorker(bytes, options, progress, rootObject);
    }
    return parseDirect(bytes, options, progress);
  }

  return {
    parseBytes,
    parseDirect,
    parseWithWorker,
    policyStats,
    workerAllowed,
    workerUrl,
    version: "0.3.0-csv2",
  };
});

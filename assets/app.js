/* Marin CSV CSV-4 application workflow. Shared shell behavior remains in vendor/marinos. */
(() => {
  "use strict";

  function initializeMarinCsv() {
    const Engine = window.MarinCsvEngine;
    const Policy = window.MarinCsvLargeFilePolicy;
    const Loader = window.MarinCsvDocumentLoader;
    const RecoveryStore = window.MarinCsvRecoveryStore;
    const Recovery = window.MarinCsvRecovery;
    const Workspace = window.MarinCsvWorkspaceState;
    const TabulatorAdapter = window.MarinCsvTabulatorAdapter;
    const get = (id) => document.getElementById(id);
    const startupError = get("csv-open-error");

    if (!Engine || !Policy || !Loader || !RecoveryStore || !Recovery || !Workspace || !TabulatorAdapter) {
      if (startupError) {
        startupError.textContent = "Marin CSV could not start because its local application modules did not load.";
        startupError.hidden = false;
      }
      return;
    }

    const dependencyStatus = TabulatorAdapter.dependencyReport(window);
    const elements = {
      workspace: get("start"),
      workspaceShell: get("csv-workspace-shell"),
      workspaceToggle: get("csv-workspace-toggle"),
      workspaceToggleLabel: get("csv-workspace-toggle-label"),
      workspaceExpandIcon: document.querySelector(".csv-workspace-expand-icon"),
      workspaceCollapseIcon: document.querySelector(".csv-workspace-collapse-icon"),
      openView: get("csv-open-view"),
      editorView: get("csv-editor-view"),
      dropZone: get("csv-drop-zone"),
      dragOverlay: get("csv-drag-overlay"),
      fileInput: get("csv-file-input"),
      openButton: get("csv-open-button"),
      sampleButton: get("csv-sample-button"),
      openAnotherButton: get("csv-open-another-button"),
      downloadButton: get("csv-download-button"),
      downloadLabel: get("csv-download-label"),
      fileHeading: get("csv-file-heading"),
      fileSummary: get("csv-file-summary"),
      modeNotice: get("csv-mode-notice"),
      largeModeNotice: get("csv-large-mode-notice"),
      operation: get("csv-operation-status"),
      operationProgress: get("csv-operation-progress"),
      operationTitle: get("csv-operation-title"),
      operationDetail: get("csv-operation-detail"),
      selectionStatus: get("csv-selection-status"),
      undoButton: get("csv-undo-button"),
      redoButton: get("csv-redo-button"),
      addRowButton: get("csv-add-row-button"),
      deleteRowButton: get("csv-delete-row-button"),
      addColumnButton: get("csv-add-column-button"),
      deleteColumnButton: get("csv-delete-column-button"),
      findButton: get("csv-find-button"),
      headersButton: get("csv-headers-button"),
      filterInput: get("csv-filter-input"),
      filterHelp: get("csv-filter-help"),
      headerMode: get("csv-header-mode"),
      delimiter: get("csv-delimiter-select"),
      metadata: get("csv-file-metadata"),
      fileDetails: get("csv-file-details"),
      moreMenu: get("csv-more-menu"),
      warnings: get("csv-warnings"),
      warningSummary: get("csv-warning-summary"),
      warningList: get("csv-warning-list"),
      grid: get("csv-grid"),
      gridHelp: get("csv-grid-help"),
      pager: get("csv-grid-pager"),
      firstPageButton: get("csv-first-page-button"),
      previousPageButton: get("csv-previous-page-button"),
      nextPageButton: get("csv-next-page-button"),
      lastPageButton: get("csv-last-page-button"),
      pageForm: get("csv-page-form"),
      pageInput: get("csv-page-input"),
      pageTotal: get("csv-page-total"),
      pageRange: get("csv-page-range"),
      pageError: get("csv-page-error"),
      statusDimensions: get("csv-status-dimensions"),
      statusFormat: get("csv-status-format"),
      statusState: get("csv-status-state"),
      statusBar: document.querySelector(".csv-workspace-status"),
      confirmDialog: get("csv-confirm-dialog"),
      confirmTitle: get("csv-confirm-title"),
      confirmMessage: get("csv-confirm-message"),
      confirmAccept: get("csv-confirm-accept"),
      findDialog: get("csv-find-dialog"),
      findForm: get("csv-find-form"),
      findText: get("csv-find-text"),
      replaceText: get("csv-replace-text"),
      findCase: get("csv-find-case"),
      findWhole: get("csv-find-whole"),
      findHeader: get("csv-find-header"),
      findError: get("csv-find-error"),
      findCount: get("csv-find-count"),
      headersDialog: get("csv-headers-dialog"),
      headersForm: get("csv-headers-form"),
      headerFields: get("csv-header-fields"),
      openError: get("csv-open-error"),
      recentPanel: get("csv-recent-panel"),
      recentList: get("csv-recent-list"),
      recentRefreshButton: get("csv-recent-refresh-button"),
      recentButton: get("csv-recent-button"),
      recentDialog: get("csv-recent-dialog"),
      recentDialogList: get("csv-recent-dialog-list"),
      recentDialogEmpty: get("csv-recent-dialog-empty"),
      recoveryNotice: get("csv-recovery-notice"),
      recoveryNoticeText: get("csv-recovery-notice-text"),
      recoveryCopyButton: get("csv-recovery-copy-button"),
      recoveryTakeoverButton: get("csv-recovery-takeover-button"),
      recoveryResumeButton: get("csv-recovery-resume-button"),
      deleteLocalButton: get("csv-delete-local-button"),
      resumeLocalButton: get("csv-resume-local-button"),
      recoveryStatus: get("csv-recovery-status"),
    };

    const state = {
      document: null,
      grid: null,
      blocked: false,
      busy: false,
      activeCell: null,
      dragDepth: 0,
      pendingConfirmation: null,
      confirmationReturnFocus: null,
      dependenciesReady: dependencyStatus.available,
      dependencyProblems: dependencyStatus.problems,
      downloadValidationError: "",
      policy: Policy.classify(),
      pageIndex: 0,
      loadMetrics: null,
      usedWorker: false,
      pendingFocusAfterOperation: null,
      workspaceMode: Workspace.MODES.NORMAL,
      route: Workspace.routeName(window.location.hash),
      shellRegionState: new Map(),
      layoutFrame: 0,
      layoutObserver: null,
      recoveryStatus: { code: Recovery.STATUS.IDLE, message: "Local recovery starting…" },
      recoveryReady: false,
      recoveryConflict: null,
      recentDocuments: [],
      recoveryAnnouncementCode: null,
    };

    let recoveryCoordinator = null;
    const recoveryStore = new RecoveryStore.IndexedDbRecoveryStore({
      onBlocked: () => recoveryCoordinator?.handleBlockedUpgrade(),
      onVersionChange: () => recoveryCoordinator?.handleVersionChange(),
    });
    recoveryCoordinator = new Recovery.RecoveryCoordinator({
      store: recoveryStore,
      engine: Engine,
      onStatus: updateRecoveryStatus,
      onConflict: handleRecoveryConflict,
      onDocumentsChanged: () => { refreshRecentDocuments().catch(() => {}); },
      onBlocked: () => updateRecoveryControls(),
      onVersionChange: () => updateRecoveryControls(),
    });

    document.body.dataset.workspaceMode = state.workspaceMode;
    document.body.dataset.csvRoute = state.route;
    document.body.dataset.csvView = "open";

    function announce(message) {
      const status = document.querySelector("#app-status-message");
      if (!status) return;
      status.textContent = "";
      window.requestAnimationFrame(() => { status.textContent = message; });
    }

    function announceSelection(selection) {
      elements.selectionStatus.textContent = "";
      if (!selection) return;
      window.requestAnimationFrame(() => {
        elements.selectionStatus.textContent = `${selection.cellCount.toLocaleString()} cell${selection.cellCount === 1 ? "" : "s"} selected across ${selection.rowCount.toLocaleString()} row${selection.rowCount === 1 ? "" : "s"} and ${selection.columnCount.toLocaleString()} column${selection.columnCount === 1 ? "" : "s"}.`;
      });
    }

    function recoveryStatusLabel(status = state.recoveryStatus) {
      switch (status?.code) {
        case Recovery.STATUS.WAITING: return "Changes waiting to save";
        case Recovery.STATUS.SAVING: return "Saving locally…";
        case Recovery.STATUS.SAVED: return "Saved locally";
        case Recovery.STATUS.RECOVERED: return "Recovered local work";
        case Recovery.STATUS.DEGRADED: return "Recovered earlier local revision";
        case Recovery.STATUS.OFF: return "Local recovery off";
        case Recovery.STATUS.UNAVAILABLE: return "Local recovery unavailable";
        case Recovery.STATUS.FULL: return "Browser storage is full";
        case Recovery.STATUS.CONFLICT: return "Open in another tab";
        case Recovery.STATUS.BLOCKED: return "Local recovery upgrade blocked";
        case Recovery.STATUS.RELOAD_REQUIRED: return "Reload required for local recovery";
        case Recovery.STATUS.UNSUPPORTED: return "Local copy unsupported";
        case Recovery.STATUS.ERROR: return "Changes are not saved locally";
        default: return state.recoveryReady ? "Local recovery ready" : "Local recovery starting…";
      }
    }

    function updateRecoveryStatus(status) {
      state.recoveryStatus = status || { code: Recovery.STATUS.IDLE, message: "" };
      const label = recoveryStatusLabel(state.recoveryStatus);
      elements.recoveryStatus.textContent = label;
      elements.recoveryStatus.dataset.state = state.recoveryStatus.code || "idle";

      const code = state.recoveryStatus.code;
      const notices = {
        [Recovery.STATUS.OFF]: "Local recovery is off for this open document. Refreshing can lose changes unless you resume recovery or download the CSV.",
        [Recovery.STATUS.UNAVAILABLE]: "Local recovery is unavailable in this browser. Continue editing only if you download the CSV before leaving.",
        [Recovery.STATUS.FULL]: "Browser storage is full. The last valid recovery copy remains, but newer changes are not saved locally. Download the CSV now.",
        [Recovery.STATUS.CONFLICT]: "This local document is open or changed in another tab. This tab cannot overwrite that recovery copy.",
        [Recovery.STATUS.DEGRADED]: "Marin CSV recovered the last valid local revision, but newer recovery data could not be applied. The document is read-only; create an independent copy to continue editing.",
        [Recovery.STATUS.BLOCKED]: "Another Marin CSV tab is blocking a local recovery database update. Close or refresh the other tab to continue local recovery.",
        [Recovery.STATUS.RELOAD_REQUIRED]: "Marin CSV was updated in another tab. Reload this tab before continuing local recovery.",
        [Recovery.STATUS.UNSUPPORTED]: "This local copy cannot be opened by this version of Marin CSV. It has not been deleted.",
        [Recovery.STATUS.ERROR]: "Changes are not saved locally. The last valid recovery copy remains available; download the CSV before leaving.",
      };
      const message = notices[code] || "";
      elements.recoveryNotice.hidden = !message;
      elements.recoveryNoticeText.textContent = message;
      if (message) setNoticeType(elements.recoveryNotice, [Recovery.STATUS.FULL, Recovery.STATUS.ERROR, Recovery.STATUS.UNAVAILABLE].includes(code) ? "error" : "warning");

      const conflict = code === Recovery.STATUS.CONFLICT;
      const degraded = code === Recovery.STATUS.DEGRADED;
      elements.recoveryCopyButton.hidden = !(conflict || degraded);
      elements.recoveryTakeoverButton.hidden = !(conflict && state.recoveryStatus.reason === "stale");
      elements.recoveryResumeButton.hidden = code !== Recovery.STATUS.OFF;
      state.recoveryConflict = conflict ? state.recoveryStatus : null;

      const important = new Set([
        Recovery.STATUS.RECOVERED,
        Recovery.STATUS.DEGRADED,
        Recovery.STATUS.OFF,
        Recovery.STATUS.UNAVAILABLE,
        Recovery.STATUS.FULL,
        Recovery.STATUS.CONFLICT,
        Recovery.STATUS.BLOCKED,
        Recovery.STATUS.RELOAD_REQUIRED,
        Recovery.STATUS.UNSUPPORTED,
        Recovery.STATUS.ERROR,
      ]);
      if (important.has(code) && state.recoveryAnnouncementCode !== code) {
        state.recoveryAnnouncementCode = code;
        announce(message || label);
      } else if (!important.has(code)) state.recoveryAnnouncementCode = null;
      updateRecoveryControls();
      scheduleWorkspaceLayout();
    }

    function showRecoveryOperationError(message) {
      const text = String(message || "Marin CSV could not complete the local recovery operation.");
      elements.recoveryNotice.hidden = false;
      elements.recoveryNoticeText.textContent = text;
      setNoticeType(elements.recoveryNotice, "error");
      announce(text);
      scheduleWorkspaceLayout();
    }

    function handleRecoveryConflict(event) {
      if (!event || event.type === "external-change") {
        refreshRecentDocuments().catch(() => {});
        return;
      }
      if (state.document && !state.document.preview) state.document.readOnly = true;
      updateAll();
      renderDocument().catch(() => {});
    }

    function updateRecoveryControls() {
      const hasRecord = Boolean(recoveryCoordinator?.documentId);
      const off = state.recoveryStatus.code === Recovery.STATUS.OFF;
      elements.recentButton.disabled = !state.recoveryReady;
      elements.recentRefreshButton.disabled = !state.recoveryReady;
      elements.deleteLocalButton.disabled = !hasRecord || off;
      elements.resumeLocalButton.hidden = !off;
      elements.recoveryResumeButton.hidden = !off;
    }

    function formatRecoveryTime(timestamp) {
      const time = Number(timestamp);
      if (!Number.isFinite(time) || time <= 0) return "Unknown time";
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(time));
    }

    function recentDocumentItem(record) {
      const item = document.createElement("li");
      item.className = "csv-recent-item";
      item.dataset.documentId = record.documentId;
      const activeHere = record.documentId === recoveryCoordinator.documentId;
      const identity = document.createElement("div");
      const name = document.createElement("p");
      name.className = "csv-recent-name";
      name.textContent = record.filename || "Untitled CSV";
      const meta = document.createElement("p");
      meta.className = "csv-recent-meta";
      const lease = record.leaseState?.status;
      const sameSession = record.leaseState?.lease?.sessionId === recoveryCoordinator.sessionId;
      const leaseText = lease === "active"
        ? (sameSession && activeHere ? "Open in this tab" : sameSession ? "Available" : "Open in another tab")
        : lease === "stale" ? "Previous tab appears closed" : "Available";
      const workText = record.workingStatus === "changed"
        ? "Changes not downloaded"
        : record.workingStatus === "downloaded"
          ? "Downloaded changes"
          : "Opened file";
      const savedTime = formatRecoveryTime(record.lastActiveAt);
      const actionContext = `${record.filename || "Untitled CSV"}, saved locally ${savedTime}`;
      meta.textContent = `${savedTime} · ${record.documentMode || "standard"} mode · ${workText} · ${leaseText}`;
      identity.append(name, meta);

      const actions = document.createElement("div");
      actions.className = "csv-recent-actions";
      if (!activeHere) {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "secondary";
        open.dataset.recoveryAction = "open";
        open.dataset.documentId = record.documentId;
        open.textContent = (lease === "active" && !sameSession) || lease === "stale" ? "Open read-only" : "Open";
        open.setAttribute("aria-label", `${open.textContent} ${actionContext}`);
        actions.append(open);
      }
      if (lease === "active" && !sameSession) {
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "secondary";
        copy.dataset.recoveryAction = "copy";
        copy.dataset.documentId = record.documentId;
        copy.textContent = "Create copy";
        copy.setAttribute("aria-label", `Create an independent copy of ${actionContext}`);
        actions.append(copy);
      }
      if (lease === "stale" && !activeHere) {
        const takeover = document.createElement("button");
        takeover.type = "button";
        takeover.className = "secondary";
        takeover.dataset.recoveryAction = "takeover";
        takeover.dataset.documentId = record.documentId;
        takeover.textContent = "Take over";
        takeover.setAttribute("aria-label", `Take over local copy of ${actionContext}`);
        actions.append(takeover);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary";
      remove.dataset.recoveryAction = "delete";
      remove.dataset.documentId = record.documentId;
      remove.dataset.filename = record.filename || "Untitled CSV";
      remove.textContent = "Delete local copy";
      remove.setAttribute("aria-label", `Delete local copy of ${actionContext}`);
      actions.append(remove);
      item.append(identity, actions);
      return item;
    }

    function renderRecentDocuments(container, records) {
      container.replaceChildren(...records.map(recentDocumentItem));
    }

    async function refreshRecentDocuments() {
      if (!state.recoveryReady) return [];
      const records = await recoveryCoordinator.listDocuments();
      state.recentDocuments = records;
      renderRecentDocuments(elements.recentList, records);
      renderRecentDocuments(elements.recentDialogList, records);
      elements.recentPanel.hidden = records.length === 0;
      elements.recentDialogEmpty.hidden = records.length !== 0;
      return records;
    }

    function recoveredPolicy(documentModel, mode) {
      const metadata = documentModel.metadata();
      const classified = Policy.classify(metadata);
      if (!mode || mode === classified.mode) return classified;
      return Object.freeze({
        ...classified,
        mode,
        readOnly: mode === "preview",
        paged: mode !== "standard",
        pageSize: mode === "preview" ? Policy.thresholds.previewDataRows
          : mode === "paged" ? Policy.thresholds.pageSize : null,
      });
    }

    async function displayRecoveredDocument(result, options = {}) {
      state.document = result.document;
      state.policy = recoveredPolicy(result.document, result.policyMode);
      state.pageIndex = 0;
      state.activeCell = null;
      state.loadMetrics = null;
      state.usedWorker = false;
      state.downloadValidationError = "";
      state.blocked = Boolean(result.document.parserValidation?.available
        && (result.document.parserValidation.matched === false
          || result.document.parserValidation.errors?.length > 0));
      makeGrid();
      if (!state.grid) throw new Error("The Tabulator grid could not be created.");
      elements.filterInput.value = "";
      clearOpenError();
      showEditorView();
      applyWorkspaceLayout({ redraw: false });
      await renderDocument();
      updateAll();
      elements.fileHeading.focus?.();
      if (!options.silent) {
        announce(result.degraded
          ? `Recovered the last valid local revision of ${result.document.filename}. Newer recovery data could not be applied.`
          : result.conflict
            ? `Opened ${result.document.filename} read-only because its local copy is active in another tab.`
            : `Recovered local work for ${result.document.filename}.`);
      }
    }

    async function restoreLocalDocument(documentId, options = {}) {
      if (!documentId || state.busy) return;
      const previousDocument = state.document;
      await beginOperation("Recovering local work", "Validating the local snapshot and edit journal");
      try {
        const result = await recoveryCoordinator.restoreDocument(documentId, {
          explicitTakeover: Boolean(options.explicitTakeover),
        });
        await displayRecoveredDocument(result, { silent: options.automatic });
        elements.recentDialog.close?.("open");
      } catch (error) {
        const message = error?.message || "Marin CSV could not recover this local document.";
        elements.recentDialog.close?.("error");
        if (previousDocument && recoveryCoordinator.document === previousDocument) {
          // A damaged or unsupported *other* record must not hide or relabel
          // the safe document that is already open.
          showEditorView();
          showRecoveryOperationError(message);
        } else {
          updateRecoveryStatus({ code: Recovery.STATUS.UNSUPPORTED, message, error });
          showOpenView();
          showOpenError(message);
        }
      } finally {
        endOperation();
        await refreshRecentDocuments();
      }
    }

    async function createIndependentCopy(documentId = null) {
      if (state.busy) return;
      await beginOperation("Creating independent copy", "Writing a separate local recovery document");
      try {
        const result = documentId
          ? await recoveryCoordinator.createIndependentCopy(documentId)
          : await recoveryCoordinator.createIndependentCopyFromCurrent();
        await displayRecoveredDocument({ ...result, conflict: false });
        elements.recentDialog.close?.("copy");
        announce(`Created an independent local copy of ${result.document.filename}.`);
      } catch (error) {
        // Failure to create a second record does not make the existing local
        // copy unsafe. Keep its status intact and report the operation error.
        showRecoveryOperationError(error?.message || "The independent local copy could not be created.");
      } finally {
        endOperation();
        await refreshRecentDocuments();
      }
    }

    function confirmDeleteLocalCopy(documentId, filename) {
      confirmAction(
        `Delete local copy of ${filename || "this document"}?`,
        documentId === recoveryCoordinator.documentId
          ? "The document will remain open, but refresh recovery will stop until you explicitly resume it. Download the CSV first if you need a file copy."
          : "This removes only the browser-local recovery copy. Any downloaded CSV files are unchanged.",
        "Delete local copy",
        async () => {
          try {
            await recoveryCoordinator.deleteDocument(documentId);
            await refreshRecentDocuments();
            updateAll();
            announce("Deleted the selected local recovery copy.");
          } catch (error) {
            showRecoveryOperationError(error?.message || "The selected local copy could not be deleted.");
          }
        },
      );
    }

    async function resumeLocalRecovery() {
      if (state.busy) return;
      elements.moreMenu.open = false;
      await beginOperation("Resuming local recovery", "Creating a new browser-local recovery copy");
      try {
        const result = await recoveryCoordinator.resumeCurrent();
        if (!result.enabled) {
          showRecoveryOperationError(result.error?.message || "Local recovery could not be resumed.");
          return;
        }
        updateAll();
        announce("Local recovery resumed.");
      } finally {
        endOperation();
        await refreshRecentDocuments();
      }
    }

    async function handleRecentAction(event) {
      const button = event.target.closest?.("button[data-recovery-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      const documentId = button.dataset.documentId;
      const action = button.dataset.recoveryAction;
      if (action === "delete") {
        confirmDeleteLocalCopy(documentId, button.dataset.filename);
      } else if (action === "copy") {
        withDiscardConfirmation(() => createIndependentCopy(documentId));
      } else if (action === "takeover") {
        withDiscardConfirmation(() => restoreLocalDocument(documentId, { explicitTakeover: true }));
      } else if (action === "open") {
        const open = () => restoreLocalDocument(documentId);
        withDiscardConfirmation(open);
      }
    }

    async function initializeRecovery() {
      const result = await recoveryCoordinator.initialize();
      state.recoveryReady = result.available;
      updateRecoveryStatus(result.status);
      updateRecoveryControls();
      const records = await refreshRecentDocuments();
      const activeDocumentId = recoveryCoordinator.activeDocumentIdFromSession();
      if (result.available && recoveryCoordinator.isConfirmedReload() && activeDocumentId
          && records.some((record) => record.documentId === activeDocumentId)) {
        await restoreLocalDocument(activeDocumentId, { automatic: true });
      }
    }

    function nextPaint() {
      return new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    }

    function applicationRoute() {
      const route = Workspace.routeName(window.location.hash);
      return ["start", "about", "security", "accessibility", "tech", "updates"].includes(route)
        ? route
        : "start";
    }

    function shellChromeRegions() {
      return [
        document.querySelector(".skip-link"),
        document.querySelector("marin-os-banner"),
        document.querySelector("marin-app-header"),
        document.querySelector("marin-app-footer"),
        document.querySelector("marin-app-feedback"),
      ].filter(Boolean);
    }

    function setShellChromeHidden(hidden) {
      shellChromeRegions().forEach((region) => {
        if (hidden) {
          if (!state.shellRegionState.has(region)) {
            state.shellRegionState.set(region, {
              hidden: region.hasAttribute("hidden"),
              inert: Boolean(region.inert),
            });
          }
          region.hidden = true;
          region.inert = true;
          return;
        }
        const previous = state.shellRegionState.get(region);
        if (!previous) return;
        region.toggleAttribute("hidden", previous.hidden);
        region.inert = previous.inert;
      });
      if (!hidden) state.shellRegionState.clear();
    }

    function updateWorkspaceToggle() {
      const expanded = state.workspaceMode === Workspace.MODES.EXPANDED;
      elements.workspaceToggleLabel.textContent = expanded ? "Collapse workspace" : "Expand workspace";
      elements.workspaceToggle.setAttribute("aria-expanded", String(expanded));
      elements.workspaceToggle.title = expanded
        ? "Return to the normal MarinOS workspace"
        : "Use the full browser window for the CSV workspace";
      elements.workspaceExpandIcon.hidden = expanded;
      elements.workspaceCollapseIcon.hidden = !expanded;
    }

    function availableViewportHeight() {
      const visualHeight = Number(window.visualViewport?.height);
      if (Number.isFinite(visualHeight) && visualHeight > 0) return visualHeight;
      return Math.max(1, Number(window.innerHeight) || 800);
    }

    function applyWorkspaceLayout({ redraw = true } = {}) {
      if (elements.editorView.hidden || state.route !== "start" || !state.grid) return 0;
      const gridTop = elements.grid.getBoundingClientRect().top;
      const footer = document.querySelector("marin-app-footer .app-footer");
      const footerHeight = state.workspaceMode === Workspace.MODES.NORMAL && footer
        ? footer.getBoundingClientRect().height
        : 0;
      const statusHeight = elements.statusBar?.getBoundingClientRect().height || 0;
      const height = Workspace.calculateGridHeight({
        viewportHeight: availableViewportHeight(),
        gridTop,
        footerHeight,
        statusHeight,
        bottomGap: state.workspaceMode === Workspace.MODES.EXPANDED ? 8 : 14,
        minimumHeight: state.workspaceMode === Workspace.MODES.EXPANDED ? 200 : 240,
      });
      elements.workspaceShell.style.setProperty("--csv-grid-height", `${height}px`);
      state.grid.setViewportHeight?.(height, { redraw });
      return height;
    }

    function scheduleWorkspaceLayout(options = {}) {
      if (state.layoutFrame) window.cancelAnimationFrame(state.layoutFrame);
      state.layoutFrame = window.requestAnimationFrame(() => {
        state.layoutFrame = 0;
        applyWorkspaceLayout(options);
      });
    }

    function setWorkspaceMode(mode, options = {}) {
      const nextMode = Workspace.normalizeMode(mode);
      if (nextMode === Workspace.MODES.EXPANDED
          && (!state.document || elements.editorView.hidden || state.route !== "start")) {
        return false;
      }
      const changed = nextMode !== state.workspaceMode;
      state.workspaceMode = nextMode;
      document.body.dataset.workspaceMode = nextMode;
      setShellChromeHidden(nextMode === Workspace.MODES.EXPANDED);
      updateWorkspaceToggle();
      scheduleWorkspaceLayout();
      window.requestAnimationFrame(() => scheduleWorkspaceLayout());
      if (options.focusToggle) {
        // A workspace transition can trigger a Tabulator resize that restores
        // grid focus on the next frame. Focus the persistent toggle after that
        // resize cycle so keyboard users remain at the control they invoked.
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => elements.workspaceToggle.focus({ preventScroll: true }));
        });
      }
      if (changed && options.announce !== false) {
        announce(nextMode === Workspace.MODES.EXPANDED
          ? "Expanded workspace. MarinOS navigation and footer are hidden until you collapse the workspace."
          : "Normal workspace restored.");
      }
      return true;
    }

    function syncRouteState() {
      state.route = applicationRoute();
      document.body.dataset.csvRoute = state.route;
      if (state.route !== "start" && state.workspaceMode === Workspace.MODES.EXPANDED) {
        setWorkspaceMode(Workspace.MODES.NORMAL, { announce: false });
      }
      scheduleWorkspaceLayout();
    }

    function initializeWorkspaceLayout() {
      updateWorkspaceToggle();
      const observed = [
        elements.workspaceShell.querySelector(".csv-workspace-header"),
        elements.modeNotice,
        elements.largeModeNotice,
        elements.recoveryNotice,
        elements.workspaceShell.querySelector(".csv-toolbar"),
        elements.workspaceShell.querySelector(".csv-workspace-inspector-row"),
        elements.pager,
        elements.statusBar,
        elements.operation,
        document.querySelector("marin-app-footer"),
      ].filter(Boolean);
      if (typeof ResizeObserver === "function") {
        state.layoutObserver = new ResizeObserver(() => scheduleWorkspaceLayout());
        observed.forEach((element) => state.layoutObserver.observe(element));
      }
      window.addEventListener("resize", scheduleWorkspaceLayout, { passive: true });
      window.visualViewport?.addEventListener?.("resize", scheduleWorkspaceLayout, { passive: true });
      window.addEventListener("hashchange", syncRouteState);
      elements.fileDetails.addEventListener("toggle", scheduleWorkspaceLayout);
      elements.warnings.addEventListener("toggle", scheduleWorkspaceLayout);
      elements.moreMenu.addEventListener("toggle", scheduleWorkspaceLayout);
    }

    function updateOperation(title, detail = "") {
      elements.operationTitle.textContent = title;
      elements.operationDetail.textContent = detail;
    }

    async function beginOperation(title, detail = "") {
      state.busy = true;
      elements.workspace.setAttribute("aria-busy", "true");
      elements.grid.setAttribute("aria-busy", "true");
      elements.operationProgress.removeAttribute("value");
      updateOperation(title, detail);
      elements.operation.hidden = false;
      updateControls();
      scheduleWorkspaceLayout();
      await nextPaint();
    }

    function endOperation() {
      state.busy = false;
      elements.workspace.setAttribute("aria-busy", "false");
      elements.grid.setAttribute("aria-busy", "false");
      elements.operation.hidden = true;
      updateControls();
      scheduleWorkspaceLayout();
      const pendingFocus = state.pendingFocusAfterOperation;
      state.pendingFocusAfterOperation = null;
      if (pendingFocus) state.grid?.requestFocus?.(pendingFocus.rowIndex, pendingFocus.columnIndex);
    }

    function showOpenView() {
      setWorkspaceMode(Workspace.MODES.NORMAL, { announce: false });
      elements.openView.hidden = false;
      elements.editorView.hidden = true;
      document.body.dataset.csvView = "open";
      elements.fileInput.value = "";
      refreshRecentDocuments().catch(() => {});
      if (!state.busy) elements.openButton.focus();
    }

    function clearOpenError() {
      elements.openError.hidden = true;
      elements.openError.textContent = "";
    }

    function resetDocumentState(options = {}) {
      setWorkspaceMode(Workspace.MODES.NORMAL, { announce: false });
      if (options.detachRecovery !== false) recoveryCoordinator.detachCurrent({ releaseLease: true }).catch(() => {});
      state.grid?.destroy?.();
      state.document = null;
      state.grid = null;
      state.blocked = false;
      state.activeCell = null;
      state.downloadValidationError = "";
      state.policy = Policy.classify();
      state.pageIndex = 0;
      state.loadMetrics = null;
      state.usedWorker = false;
      state.pendingFocusAfterOperation = null;
      state.recoveryConflict = null;
      elements.grid.replaceChildren();
      elements.pager.hidden = true;
      elements.largeModeNotice.hidden = true;
      elements.selectionStatus.textContent = "";
      elements.moreMenu.open = false;
      elements.fileDetails.open = false;
      document.title = "Marin CSV";
      if (state.dependenciesReady) makeGrid();
      updateModeNotice();
    }

    function clearDocumentAndShowOpenView() {
      resetDocumentState();
      clearOpenError();
      showOpenView();
    }

    function showOpenError(message) {
      elements.openError.textContent = message;
      elements.openError.hidden = false;
      elements.openError.focus();
    }

    function failOpen(message) {
      resetDocumentState();
      announce(message);
      showOpenView();
      showOpenError(message);
    }

    function showEditorView() {
      elements.openView.hidden = true;
      elements.editorView.hidden = false;
      document.body.dataset.csvView = "editor";
      syncRouteState();
      scheduleWorkspaceLayout({ redraw: false });
    }

    function gridOptions() {
      return {
        mode: state.policy.mode,
        readOnly: Boolean(state.document?.readOnly || state.policy.readOnly),
        pageSize: state.policy.mode === "paged" ? state.policy.pageSize : null,
        pageIndex: state.pageIndex,
        disableSortFilter: state.policy.mode !== "standard",
      };
    }

    function makeGrid() {
      state.grid?.destroy?.();
      state.grid = null;
      if (!state.dependenciesReady) return;
      const callbacks = {
        onActiveCell(cell) {
          state.activeCell = cell;
          updateControls();
        },
        onCellChange(rowIndex, columnIndex, value) {
          if (!state.document || state.blocked || state.busy || state.document.readOnly) return;
          if (state.document.setCell(rowIndex, columnIndex, value)) {
            updateAfterChange(false);
            announce(`Updated file row ${rowIndex + 1}, column ${Engine.columnLabel(columnIndex)}.`);
          }
        },
        onPasteBlock(rowIndex, columnIndex, text) {
          pasteBlock(rowIndex, columnIndex, text);
        },
        onRangeChange(selection) {
          announceSelection(selection);
        },
        onReady(page) {
          state.pageIndex = page?.pageIndex || 0;
          updatePager();
          scheduleWorkspaceLayout();
        },
      };
      state.grid = new TabulatorAdapter.TabulatorGrid(elements.grid, callbacks, window.Tabulator);
    }

    function setNoticeType(element, type) {
      element.classList.remove("app-alert--error", "app-alert--warning", "app-alert--success");
      element.classList.add(`app-alert--${type}`);
    }

    function updateModeNotice() {
      let message = "";
      if (!state.dependenciesReady) {
        message = `Marin CSV cannot open files because ${state.dependencyProblems.join("; ")}. Reload the page or report the problem.`;
      } else if (state.blocked && state.document?.parserValidation?.available) {
        const validation = state.document.parserValidation;
        const reasons = [];
        if (validation.matched === false) reasons.push("the preservation scanner and Papa Parse returned different fields");
        if (validation.errors?.length) reasons.push("Papa Parse reported a parsing error");
        message = `Editing and download are disabled because ${reasons.join(" and ") || "independent parser validation failed"}. Reopen the source with a reviewed parsing strategy before making changes.`;
      } else if (state.downloadValidationError) {
        message = state.downloadValidationError;
      }
      elements.modeNotice.hidden = !message;
      elements.modeNotice.textContent = message;
      if (message) setNoticeType(elements.modeNotice, "error");
    }

    function updateLargeModeNotice() {
      const doc = state.document;
      if (!doc || state.policy.mode === "standard") {
        elements.largeModeNotice.hidden = true;
        elements.largeModeNotice.textContent = "";
        return;
      }
      const meta = doc.metadata();
      if (state.policy.mode === "preview") {
        const shown = meta.displayDataRows.toLocaleString();
        const total = meta.dataRows.toLocaleString();
        const rowPhrase = meta.previewTruncated
          ? `The first ${shown} of ${total} data rows are shown.`
          : `${shown} data row${meta.displayDataRows === 1 ? " is" : "s are"} shown.`;
        elements.largeModeNotice.textContent = `Read-only preview mode protects browser stability for this ${formatBytes(meta.bytes)} file with ${meta.cells.toLocaleString()} fields. ${rowPhrase} Editing, find and replace, sorting, and filtering are unavailable. Downloading creates an exact byte-for-byte copy of the opened file.`;
      } else {
        elements.largeModeNotice.textContent = `Paged editing mode renders ${state.policy.pageSize.toLocaleString()} rows at a time for this file with ${meta.dataRows.toLocaleString()} data rows and ${meta.cells.toLocaleString()} fields. Edits, undo, redo, and download apply to the full file. Sorting and filtering are unavailable because they would require duplicating or reordering the full data set in the grid.`;
      }
      elements.largeModeNotice.hidden = false;
    }

    function safeFileName(name) {
      const cleaned = String(name || "data.csv").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_");
      return cleaned || "data.csv";
    }

    function formatBytes(value) {
      const bytes = Math.max(0, Number(value) || 0);
      if (bytes < 1024) return `${bytes.toLocaleString()} bytes`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    async function renderDocument(focus = null) {
      if (!state.grid || !state.document) return;
      applyWorkspaceLayout({ redraw: false });
      const ready = state.grid.setDocument(state.document, gridOptions());
      if (focus) {
        // Give the replacement grid its focus target immediately so Tabulator
        // can apply it during tableBuilt. Retain the post-operation request as
        // a second, deterministic restoration after busy-state layout changes.
        state.grid.requestFocus?.(focus.rowIndex, focus.columnIndex);
        if (state.busy) state.pendingFocusAfterOperation = focus;
      }
      await ready;
      state.pageIndex = state.grid.pageInfo().pageIndex;
      updatePager();
      scheduleWorkspaceLayout();
    }

    async function loadBytes(bytes, filename, options = {}) {
      if (!state.dependenciesReady) {
        showOpenError("Marin CSV cannot open files because its reviewed local CSV libraries did not load.");
        return;
      }
      const ownOperation = !state.busy;
      if (ownOperation) await beginOperation("Opening file", `Reading ${safeFileName(filename)}`);
      try {
        const result = await Loader.parseBytes(bytes, {
          filename: safeFileName(filename),
          delimiter: options.delimiter || "auto",
          headerMode: options.headerMode !== false,
          papa: window.Papa,
        }, ({ message }) => updateOperation("Opening file", message), window);
        state.document = result.document;
        state.policy = result.policy;
        state.pageIndex = 0;
        state.activeCell = null;
        state.loadMetrics = result.metrics;
        state.usedWorker = result.usedWorker;
        state.downloadValidationError = "";
        state.blocked = Boolean(result.document.parserValidation?.available
          && (result.document.parserValidation.matched === false
            || result.document.parserValidation.errors?.length > 0));
        makeGrid();
        if (!state.grid) throw new Error("The Tabulator grid could not be created.");
        elements.filterInput.value = "";
        clearOpenError();
        showEditorView();
        applyWorkspaceLayout({ redraw: false });
        updateOperation("Opening file", "Building the local data editor");
        await renderDocument();
        updateOperation("Opening file", "Creating the browser-local recovery copy");
        await recoveryCoordinator.startNewDocument(state.document, {
          policyMode: state.policy.mode,
          detachOnFailure: true,
        });
        updateAll();
        elements.fileHeading.textContent = result.document.filename || "Untitled CSV";
        elements.fileHeading.focus?.();
        const mode = state.policy.mode === "standard" ? "standard editing"
          : state.policy.mode === "paged" ? "paged editing" : "read-only preview";
        announce(`Opened ${result.document.filename} in ${mode} mode. ${result.document.dataRowCount.toLocaleString()} data rows and ${result.document.columnCount.toLocaleString()} columns.`);
      } catch (error) {
        const message = error instanceof Engine.CsvError
          ? error.message
          : `Marin CSV could not open this file.${error instanceof Error && error.message ? ` ${error.message}` : ""}`;
        failOpen(message);
      } finally {
        if (ownOperation) endOperation();
      }
    }

    async function loadFile(file) {
      if (!(file instanceof File) || state.busy) return;
      await beginOperation("Reading file", `Reading ${safeFileName(file.name)} from this device`);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        updateOperation("Opening file", "Preparing local parsing");
        await loadBytes(bytes, file.name, { headerMode: true });
      } catch (error) {
        const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
        failOpen(`Marin CSV could not read this file.${detail}`);
      } finally {
        endOperation();
      }
    }

    function requestFileOpen() {
      if (!state.dependenciesReady || state.busy) return;
      elements.fileInput.value = "";
      elements.fileInput.click();
    }

    function withDiscardConfirmation(action) {
      const recoveryOffWithChanges = Boolean(
        state.document?.modifiedFromOpen && state.recoveryStatus.code === Recovery.STATUS.OFF,
      );
      if (!state.document?.hasUndownloadedChanges && !recoveryOffWithChanges) {
        action();
        return;
      }
      const safelyRecovered = recoveryCoordinator.isCurrentRevisionSafe() && !recoveryOffWithChanges;
      confirmAction(
        safelyRecovered ? "Open another document?" : "Discard current browser work?",
        safelyRecovered
          ? "This file has changes that have not been downloaded. Its local recovery copy will remain in Recent local documents."
          : recoveryOffWithChanges
            ? "This file has changed and local recovery is off. Opening another document will remove the current browser workspace."
            : "This file has changes that are not safely stored locally or downloaded. Opening another file can lose them.",
        safelyRecovered ? "Open another document" : "Discard browser work",
        action,
      );
    }

    function confirmAction(title, message, acceptLabel, action) {
      if (state.busy) return;
      state.pendingConfirmation = action;
      state.confirmationReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      elements.confirmTitle.textContent = title;
      elements.confirmMessage.textContent = message;
      elements.confirmAccept.textContent = acceptLabel;
      elements.confirmDialog.returnValue = "";
      elements.confirmDialog.showModal();
      get("csv-confirm-cancel")?.focus();
    }

    elements.confirmDialog.addEventListener("close", () => {
      const action = state.pendingConfirmation;
      const returnFocus = state.confirmationReturnFocus;
      state.pendingConfirmation = null;
      state.confirmationReturnFocus = null;
      if (elements.confirmDialog.returnValue === "accept" && typeof action === "function") action();
      else returnFocus?.focus?.();
    });

    function metadataItem(term, description) {
      const wrapper = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = description;
      wrapper.append(dt, dd);
      elements.metadata.append(wrapper);
    }

    function updateMetadata() {
      if (!state.document) return;
      const meta = state.document.metadata();
      const filename = state.document.filename || "Untitled CSV";
      elements.metadata.replaceChildren();
      metadataItem("Data rows", meta.dataRows.toLocaleString());
      metadataItem("Columns", meta.columns.toLocaleString());
      metadataItem("Fields", meta.cells.toLocaleString());
      metadataItem("File size", formatBytes(meta.bytes));
      metadataItem("Mode", Policy.describe(state.policy));
      metadataItem("Delimiter", meta.delimiterName);
      metadataItem("Encoding", `${meta.encoding}${meta.bom ? " with UTF-8 BOM" : " without BOM"}`);
      metadataItem("Line endings", `${meta.newlineName}${meta.trailingNewline ? ", final line ending retained" : ", no final line ending"}`);
      metadataItem("File state", meta.modifiedFromOpen
        ? (meta.hasUndownloadedChanges ? "Changed — not downloaded" : "Changed — downloaded")
        : "Unchanged from opened file");
      metadataItem("Local recovery", recoveryStatusLabel());
      metadataItem("Parser", meta.preview
        ? `${state.usedWorker ? "Local Web Worker" : "Main-thread fallback"}; strict preservation profile; Papa Parse not needed for exact-copy preview`
        : `${state.usedWorker ? "Local Web Worker" : "Main-thread fallback"}; Papa Parse ${dependencyStatus.required.papaParse}`);
      metadataItem("Editor", `Tabulator ${dependencyStatus.required.tabulator}`);
      if (state.loadMetrics) metadataItem("Open time", `${Math.round(state.loadMetrics.totalMs).toLocaleString()} ms in this browser`);

      const preview = meta.preview && meta.previewTruncated
        ? ` · showing ${meta.displayDataRows.toLocaleString()}`
        : "";
      elements.fileHeading.textContent = filename;
      elements.fileSummary.textContent = `${meta.dataRows.toLocaleString()} data row${meta.dataRows === 1 ? "" : "s"}${preview} · ${meta.columns.toLocaleString()} column${meta.columns === 1 ? "" : "s"} · ${meta.delimiterName}-delimited`;
      elements.statusDimensions.textContent = `${meta.dataRows.toLocaleString()} row${meta.dataRows === 1 ? "" : "s"} · ${meta.columns.toLocaleString()} column${meta.columns === 1 ? "" : "s"}`;
      elements.statusFormat.textContent = `${meta.encoding}${meta.bom ? " + BOM" : ""} · ${meta.delimiterName} · ${meta.newlineName}`;
      elements.statusState.textContent = meta.preview
        ? "Read-only preview"
        : meta.hasUndownloadedChanges
          ? "Changed — not downloaded"
          : meta.modifiedFromOpen ? "Changed — downloaded" : "Unchanged";
      document.title = `${filename}${meta.hasUndownloadedChanges ? " *" : ""} | Marin CSV`;
    }

    function updateWarnings() {
      if (!state.document) return;
      const warnings = state.document.structuralWarnings();
      elements.warningList.replaceChildren();
      elements.warnings.hidden = warnings.length === 0;
      elements.warningSummary.textContent = warnings.length === 1 ? "1 file warning" : `${warnings.length.toLocaleString()} file warnings`;
      warnings.slice(0, 200).forEach((warning) => {
        const li = document.createElement("li");
        li.textContent = warning.message;
        elements.warningList.append(li);
      });
      if (warnings.length > 200) {
        const li = document.createElement("li");
        li.textContent = `${(warnings.length - 200).toLocaleString()} additional warnings are not displayed.`;
        elements.warningList.append(li);
      }
      scheduleWorkspaceLayout();
    }

    function updateControls() {
      const doc = state.document;
      const active = state.activeCell || state.grid?.getActiveCell?.();
      const blocked = !doc || state.blocked;
      const readOnly = Boolean(doc?.readOnly || state.policy.readOnly);
      const editDisabled = blocked || readOnly || state.busy;
      elements.openButton.disabled = state.busy || !state.dependenciesReady;
      elements.sampleButton.disabled = state.busy || !state.dependenciesReady;
      elements.openAnotherButton.disabled = state.busy;
      elements.downloadButton.disabled = blocked || state.busy;
      elements.downloadLabel.textContent = readOnly ? "Download exact copy" : "Download CSV";
      elements.undoButton.disabled = editDisabled || !doc?.canUndo;
      elements.redoButton.disabled = editDisabled || !doc?.canRedo;
      elements.addRowButton.disabled = editDisabled;
      elements.addColumnButton.disabled = editDisabled;
      elements.findButton.disabled = editDisabled;
      elements.deleteRowButton.disabled = editDisabled || !active || !doc?.rows?.[active.rowIndex]
        || (doc.headerMode && active.rowIndex === 0);
      elements.deleteColumnButton.disabled = editDisabled || !active || doc?.columnCount <= 1;
      elements.headersButton.disabled = editDisabled || !doc?.headerMode;
      elements.headersButton.title = doc && !doc.headerMode
        ? "Use the first row as column names before editing column names."
        : readOnly ? "Column names cannot be edited in read-only preview mode." : "";
      elements.headerMode.disabled = blocked || state.busy;
      elements.delimiter.disabled = blocked || state.busy || Boolean(doc?.modifiedFromOpen);
      const filterDisabled = blocked || state.busy || state.policy.mode !== "standard";
      elements.filterInput.disabled = filterDisabled;
      elements.filterHelp.textContent = state.policy.mode === "standard"
        ? "Filtering changes only the current view."
        : "Filtering is unavailable in paged and read-only preview modes.";
      elements.gridHelp.textContent = state.policy.mode === "preview"
        ? "Read-only preview. Use the grid to review the retained rows. Editing, sorting, filtering, and paging through omitted rows are unavailable; Download exact copy preserves every original byte."
        : state.policy.mode === "paged"
          ? "Double-click or press Enter on a cell to edit. Enter saves a single-line field; Alt+Enter adds a line. In a multiline field, Enter adds a line and Shift+Enter saves. Use the page controls to move through the file. Sorting and filtering are unavailable."
          : "Double-click or press Enter on a cell to edit. Enter saves a single-line field; Alt+Enter adds a line. In a multiline field, Enter adds a line and Shift+Enter saves. Sorting and filtering change only the view, not the saved row order.";
      elements.grid.inert = Boolean(state.blocked || state.busy);
      elements.workspaceToggle.disabled = !doc || state.busy;
      updateRecoveryControls();
      if (state.blocked) elements.grid.setAttribute("aria-disabled", "true");
      else elements.grid.removeAttribute("aria-disabled");
      updatePager();
    }

    function updateSelectors() {
      if (!state.document) return;
      elements.headerMode.value = state.document.headerMode ? "headers" : "data";
      elements.delimiter.value = state.document.delimiter;
    }

    function updatePager() {
      const page = state.grid?.pageInfo?.();
      const visible = Boolean(state.document && state.policy.mode === "paged" && page);
      elements.pager.hidden = !visible;
      if (!visible) return;
      state.pageIndex = page.pageIndex;
      elements.pageInput.value = String(page.pageNumber);
      elements.pageInput.max = String(page.pageCount);
      elements.pageTotal.textContent = `of ${page.pageCount.toLocaleString()}`;
      elements.pageRange.textContent = page.availableRows
        ? `Data rows ${(page.start + 1).toLocaleString()}–${page.end.toLocaleString()} of ${page.availableRows.toLocaleString()}`
        : "No data rows";
      elements.firstPageButton.disabled = state.busy || page.pageIndex === 0;
      elements.previousPageButton.disabled = state.busy || page.pageIndex === 0;
      elements.nextPageButton.disabled = state.busy || page.pageIndex >= page.pageCount - 1;
      elements.lastPageButton.disabled = state.busy || page.pageIndex >= page.pageCount - 1;
    }

    function updateAll() {
      updateMetadata();
      updateWarnings();
      updateSelectors();
      updateModeNotice();
      updateLargeModeNotice();
      updateControls();
      scheduleWorkspaceLayout();
    }

    async function updateAfterChange(rerender = true, focus = null) {
      state.downloadValidationError = "";
      if (rerender && state.grid && state.document) await renderDocument(focus);
      updateAll();
    }

    function parsePastedBlock(text) {
      let normalized = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (normalized.endsWith("\n")) normalized = normalized.slice(0, -1);
      const parsed = Engine.scanDelimited(normalized, "\t", { strict: true });
      return parsed.rows.map((row) => row.cells);
    }

    async function pasteBlock(startRow, startColumn, text) {
      if (!state.document || state.blocked || state.busy || state.document.readOnly) return;
      let matrix;
      try {
        matrix = parsePastedBlock(text);
      } catch (error) {
        announce(error.message || "The pasted cells could not be read.");
        return;
      }
      const edits = [];
      let omitted = 0;
      matrix.forEach((row, rowOffset) => {
        const rowIndex = startRow + rowOffset;
        if (!state.document.rows[rowIndex]) {
          omitted += row.length;
          return;
        }
        row.forEach((value, columnOffset) => {
          edits.push({ rowIndex, columnIndex: startColumn + columnOffset, value });
        });
      });
      await beginOperation("Pasting cells", `Applying ${edits.length.toLocaleString()} cell values`);
      try {
        const changed = state.document.setCells(edits, `Paste ${edits.length} cell${edits.length === 1 ? "" : "s"}`);
        await updateAfterChange(true, { rowIndex: startRow, columnIndex: startColumn });
        announce(`${changed.toLocaleString()} cell${changed === 1 ? "" : "s"} pasted.${omitted ? ` ${omitted.toLocaleString()} cell${omitted === 1 ? " was" : "s were"} outside the existing rows and were not pasted.` : ""}`);
      } finally {
        endOperation();
      }
    }

    async function downloadCurrent() {
      if (!state.document || state.blocked || state.busy) return;
      await beginOperation("Preparing download", "Validating the current document");
      try {
        if (!state.document.readOnly) {
          const validation = state.document.validateCurrentWithPapa(window.Papa);
          if (!validation.available || validation.matched === false || validation.errors.length) {
            state.downloadValidationError = "Download was stopped because the preservation engine and Papa Parse did not agree on the current document. Your file has not been downloaded or changed. Undo the latest edit or report the problem.";
            updateModeNotice();
            elements.modeNotice.focus?.();
            announce("Download stopped because independent CSV validation failed.");
            return;
          }
        }
        state.downloadValidationError = "";
        updateModeNotice();
        updateOperation("Preparing download", state.document.readOnly
          ? "Copying the exact opened bytes"
          : "Serializing retained CSV conventions");
        await nextPaint();
        const bytes = state.document.exportBytes();
        const filename = state.document.downloadName();
        const blob = new Blob([bytes], {
          type: state.document.delimiter === "\t"
            ? "text/tab-separated-values;charset=utf-8"
            : "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        state.document.markDownloaded();
        updateAll();
        announce(`Downloaded ${filename}. The opened file was not overwritten.`);
      } finally {
        endOperation();
      }
    }

    async function openSample() {
      if (state.busy) return;
      const sample = [
        "employee_id,zip_code,long_number,date_like,scientific_like,formula_like,notes",
        '000123,00901,12345678901234567890,03-04,1E10,"=SUM(A1:A2)","Line one',
        'Line two"',
        '000124,02108,00000000001234567890,01-02,9E3,"@example","Comma, quote ""and"" line break"',
        "",
      ].join("\r\n");
      await loadBytes(new TextEncoder().encode(sample), "marin-csv-sample.csv", { headerMode: true });
    }

    async function runStructuralChange(title, detail, action, focus = null) {
      if (state.busy || state.document?.readOnly) return;
      await beginOperation(title, detail);
      try {
        action();
        await updateAfterChange(true, focus);
      } finally {
        endOperation();
      }
    }

    function addRow() {
      const active = state.grid.getActiveCell?.();
      const index = active ? active.rowIndex + 1 : state.document.rows.length;
      runStructuralChange("Adding row", "Updating the document and visible page", () => {
        const inserted = state.document.addRow(index);
        state.activeCell = { rowIndex: inserted, columnIndex: active?.columnIndex || 0 };
      }, { rowIndex: index, columnIndex: active?.columnIndex || 0 }).then(() => {
        announce(`Added file row ${index + 1}.`);
      });
    }

    function deleteRow() {
      const active = state.grid.getActiveCell?.();
      if (!active || !state.document.rows[active.rowIndex]) return;
      confirmAction(
        `Delete file row ${active.rowIndex + 1}?`,
        "The row will be removed from the downloaded file. You can undo this action while this file remains open.",
        "Delete row",
        () => runStructuralChange("Deleting row", `Removing file row ${active.rowIndex + 1}`, () => {
          state.document.deleteRow(active.rowIndex);
          state.activeCell = null;
        }).then(() => announce(`Deleted file row ${active.rowIndex + 1}.`)),
      );
    }

    function addColumn() {
      const active = state.grid.getActiveCell?.();
      const index = active ? active.columnIndex + 1 : state.document.columnCount;
      runStructuralChange("Adding column", "Updating every row in the document", () => {
        const inserted = state.document.addColumn(index);
        state.activeCell = {
          rowIndex: active?.rowIndex ?? (state.document.headerMode ? 1 : 0),
          columnIndex: inserted,
        };
      }, {
        rowIndex: active?.rowIndex ?? (state.document.headerMode ? 1 : 0),
        columnIndex: index,
      }).then(() => announce(`Added column ${Engine.columnLabel(index)}.`));
    }

    function deleteColumn() {
      const active = state.grid.getActiveCell?.();
      if (!active || state.document.columnCount <= 1) return;
      const label = Engine.columnLabel(active.columnIndex);
      confirmAction(
        `Delete column ${label}?`,
        "The column and all of its values will be removed from the downloaded file. You can undo this action while this file remains open.",
        "Delete column",
        () => runStructuralChange("Deleting column", `Removing column ${label} from every row`, () => {
          state.document.deleteColumn(active.columnIndex);
          state.activeCell = null;
        }).then(() => announce(`Deleted column ${label}.`)),
      );
    }

    function buildHeaderFields() {
      const headers = state.document.getHeaders();
      elements.headerFields.replaceChildren();
      headers.forEach((header, index) => {
        const label = document.createElement("label");
        const caption = document.createElement("span");
        caption.textContent = `Column ${Engine.columnLabel(index)}`;
        const input = document.createElement("input");
        input.type = "text";
        input.name = `header-${index}`;
        input.value = header;
        input.dataset.headerIndex = String(index);
        input.autocomplete = "off";
        label.append(caption, input);
        elements.headerFields.append(label);
      });
    }

    function findOptions() {
      return {
        caseSensitive: elements.findCase.checked,
        wholeCell: elements.findWhole.checked,
        includeHeader: elements.findHeader.checked,
      };
    }

    function updateFindCount() {
      const query = elements.findText.value;
      const count = query && state.document ? state.document.findMatches(query, findOptions()).length : 0;
      elements.findCount.textContent = query
        ? `${count.toLocaleString()} matching cell${count === 1 ? "" : "s"}.`
        : "Enter text to find.";
    }

    function clearFindError() {
      elements.findError.hidden = true;
      elements.findError.textContent = "";
      elements.findText.removeAttribute("aria-invalid");
    }

    function clearPageError() {
      elements.pageError.hidden = true;
      elements.pageError.textContent = "";
      elements.pageInput.removeAttribute("aria-invalid");
    }

    async function goToPage(requestedPage) {
      const page = state.grid?.pageInfo?.();
      if (!page || state.busy) return;
      const pageNumber = Math.trunc(Number(requestedPage));
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > page.pageCount) {
        elements.pageError.textContent = `Enter a page from 1 to ${page.pageCount.toLocaleString()}.`;
        elements.pageError.hidden = false;
        elements.pageInput.setAttribute("aria-invalid", "true");
        elements.pageInput.focus();
        return;
      }
      clearPageError();
      await beginOperation("Loading rows", `Opening page ${pageNumber.toLocaleString()} of ${page.pageCount.toLocaleString()}`);
      try {
        const next = await state.grid.setPage(pageNumber - 1);
        state.pageIndex = next.pageIndex;
        updatePager();
        const documentIndex = next.start + (state.document.headerMode ? 1 : 0);
        state.pendingFocusAfterOperation = { rowIndex: documentIndex, columnIndex: 0 };
        announce(`Showing data rows ${(next.start + 1).toLocaleString()} through ${next.end.toLocaleString()} of ${next.availableRows.toLocaleString()}.`);
      } finally {
        endOperation();
      }
    }

    elements.openButton.addEventListener("click", requestFileOpen);
    elements.sampleButton.addEventListener("click", openSample);
    elements.fileInput.addEventListener("change", () => {
      const file = elements.fileInput.files?.[0];
      if (file) withDiscardConfirmation(() => loadFile(file));
    });
    elements.openAnotherButton.addEventListener("click", () => withDiscardConfirmation(clearDocumentAndShowOpenView));
    elements.downloadButton.addEventListener("click", downloadCurrent);
    elements.recentButton.addEventListener("click", async () => {
      await refreshRecentDocuments();
      elements.moreMenu.open = false;
      elements.recentDialog.showModal();
      elements.recentDialog.querySelector("button[data-recovery-action]")?.focus?.();
    });
    elements.recentRefreshButton.addEventListener("click", refreshRecentDocuments);
    elements.recentList.addEventListener("click", handleRecentAction);
    elements.recentDialogList.addEventListener("click", handleRecentAction);
    elements.deleteLocalButton.addEventListener("click", () => {
      if (!recoveryCoordinator.documentId) return;
      elements.moreMenu.open = false;
      confirmDeleteLocalCopy(recoveryCoordinator.documentId, state.document?.filename);
    });
    elements.resumeLocalButton.addEventListener("click", resumeLocalRecovery);
    elements.recoveryResumeButton.addEventListener("click", resumeLocalRecovery);
    elements.recoveryCopyButton.addEventListener("click", () => createIndependentCopy());
    elements.recoveryTakeoverButton.addEventListener("click", () => {
      if (recoveryCoordinator.documentId) restoreLocalDocument(recoveryCoordinator.documentId, { explicitTakeover: true });
    });
    elements.workspaceToggle.addEventListener("click", () => {
      const next = state.workspaceMode === Workspace.MODES.EXPANDED
        ? Workspace.MODES.NORMAL
        : Workspace.MODES.EXPANDED;
      setWorkspaceMode(next, { focusToggle: true });
    });
    elements.undoButton.addEventListener("click", async () => {
      if (state.busy) return;
      const label = state.document.undo();
      if (label) {
        state.activeCell = null;
        await beginOperation("Undoing change", label);
        try {
          await updateAfterChange(true);
          announce(`Undid: ${label}.`);
        } finally {
          endOperation();
        }
      }
    });
    elements.redoButton.addEventListener("click", async () => {
      if (state.busy) return;
      const label = state.document.redo();
      if (label) {
        state.activeCell = null;
        await beginOperation("Redoing change", label);
        try {
          await updateAfterChange(true);
          announce(`Redid: ${label}.`);
        } finally {
          endOperation();
        }
      }
    });
    elements.addRowButton.addEventListener("click", addRow);
    elements.deleteRowButton.addEventListener("click", deleteRow);
    elements.addColumnButton.addEventListener("click", addColumn);
    elements.deleteColumnButton.addEventListener("click", deleteColumn);
    elements.filterInput.addEventListener("input", () => state.grid?.setFilter?.(elements.filterInput.value));
    elements.headerMode.addEventListener("change", async () => {
      if (!state.document || state.busy) return;
      state.document.setHeaderMode(elements.headerMode.value === "headers");
      state.activeCell = null;
      state.pageIndex = 0;
      await beginOperation("Changing first-row view", "Rebuilding column and row context");
      try {
        await updateAfterChange(true);
        announce(state.document.headerMode
          ? "The first row is now used as column names."
          : "The first row is now shown as data.");
      } finally {
        endOperation();
      }
    });
    elements.delimiter.addEventListener("change", async () => {
      if (state.document.modifiedFromOpen) {
        elements.delimiter.value = state.document.delimiter;
        announce("Undo all edits or reopen the file before changing how it is parsed.");
        return;
      }
      const headerMode = state.document.headerMode;
      const bytes = state.document.originalBytes;
      const filename = state.document.filename;
      await loadBytes(bytes, filename, { delimiter: elements.delimiter.value, headerMode });
    });
    elements.findButton.addEventListener("click", () => {
      if (state.busy || state.document?.readOnly) return;
      elements.moreMenu.open = false;
      clearFindError();
      elements.findText.value = "";
      elements.replaceText.value = "";
      updateFindCount();
      elements.findDialog.showModal();
      elements.findText.focus();
    });
    [elements.findText, elements.findCase, elements.findWhole, elements.findHeader].forEach((control) => {
      control.addEventListener("input", updateFindCount);
      control.addEventListener("change", updateFindCount);
    });
    elements.findText.addEventListener("input", clearFindError);
    elements.findForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = elements.findText.value;
      if (!query.trim()) {
        elements.findError.textContent = "Enter text to find.";
        elements.findError.hidden = false;
        elements.findText.setAttribute("aria-invalid", "true");
        elements.findText.focus();
        return;
      }
      elements.findDialog.close("replace");
      await beginOperation("Replacing matches", "Applying the replacement across the full document");
      try {
        const count = state.document.replaceAll(query, elements.replaceText.value, findOptions());
        await updateAfterChange(true);
        announce(count
          ? `Replaced ${count.toLocaleString()} matching cell${count === 1 ? "" : "s"}.`
          : "No matching cells were found.");
      } finally {
        endOperation();
      }
    });
    elements.headersButton.addEventListener("click", () => {
      if (!state.document.headerMode || state.document.readOnly || state.busy) return;
      elements.moreMenu.open = false;
      buildHeaderFields();
      elements.headersDialog.showModal();
      elements.headerFields.querySelector("input")?.focus();
    });
    elements.headersForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = [...elements.headerFields.querySelectorAll("input[data-header-index]")]
        .sort((a, b) => Number(a.dataset.headerIndex) - Number(b.dataset.headerIndex))
        .map((input) => input.value);
      elements.headersDialog.close("save");
      await beginOperation("Updating column names", "Writing the first row and rebuilding the grid");
      try {
        state.document.setHeaders(values);
        await updateAfterChange(true);
        announce("Updated the first-row column names.");
      } finally {
        endOperation();
      }
    });

    elements.firstPageButton.addEventListener("click", () => goToPage(1));
    elements.previousPageButton.addEventListener("click", () => goToPage((state.grid?.pageInfo?.().pageNumber || 1) - 1));
    elements.nextPageButton.addEventListener("click", () => goToPage((state.grid?.pageInfo?.().pageNumber || 1) + 1));
    elements.lastPageButton.addEventListener("click", () => goToPage(state.grid?.pageInfo?.().pageCount || 1));
    elements.pageInput.addEventListener("input", clearPageError);
    elements.pageForm.addEventListener("submit", (event) => {
      event.preventDefault();
      goToPage(elements.pageInput.value);
    });

    document.addEventListener("click", (event) => {
      const close = event.target.closest?.("[data-close-dialog]");
      if (close instanceof HTMLButtonElement) {
        const dialog = get(close.dataset.closeDialog);
        if (dialog instanceof HTMLDialogElement) dialog.close("cancel");
      }
      if (elements.moreMenu.open && !elements.moreMenu.contains(event.target)) {
        elements.moreMenu.open = false;
      }
    });

    elements.moreMenu.addEventListener("click", (event) => {
      const action = event.target.closest?.("button");
      if (action instanceof HTMLButtonElement) {
        window.requestAnimationFrame(() => { elements.moreMenu.open = false; });
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const active = document.activeElement;
      const priority = Workspace.escapePriority({
        mode: state.workspaceMode,
        dialogOpen: Boolean(document.querySelector("dialog[open]")),
        transientOpen: elements.moreMenu.open,
        interactionActive: Boolean(active?.matches?.("input, textarea, select, [contenteditable='true']")
          || active?.closest?.(".tabulator-editing")),
      });
      if (priority === "transient") {
        event.preventDefault();
        elements.moreMenu.open = false;
        elements.moreMenu.querySelector("summary")?.focus?.();
      } else if (priority === "collapse") {
        event.preventDefault();
        setWorkspaceMode(Workspace.MODES.NORMAL, { focusToggle: true });
      }
    });

    document.addEventListener("dragenter", (event) => {
      if (state.busy || ![...event.dataTransfer?.types || []].includes("Files")) return;
      event.preventDefault();
      state.dragDepth += 1;
      elements.dragOverlay.hidden = false;
    });
    document.addEventListener("dragover", (event) => {
      if (state.busy || ![...event.dataTransfer?.types || []].includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    document.addEventListener("dragleave", (event) => {
      if (![...event.dataTransfer?.types || []].includes("Files")) return;
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (state.dragDepth === 0) elements.dragOverlay.hidden = true;
    });
    document.addEventListener("drop", (event) => {
      if (state.busy || ![...event.dataTransfer?.types || []].includes("Files")) return;
      event.preventDefault();
      state.dragDepth = 0;
      elements.dragOverlay.hidden = true;
      const file = event.dataTransfer.files?.[0];
      if (file) withDiscardConfirmation(() => loadFile(file));
    });

    window.addEventListener("beforeunload", (event) => {
      const recoveryOffWithChanges = Boolean(
        state.document?.modifiedFromOpen && state.recoveryStatus.code === Recovery.STATUS.OFF,
      );
      if (!state.document?.hasUndownloadedChanges
          && !recoveryOffWithChanges
          && recoveryCoordinator.isCurrentRevisionSafe()) return;
      event.preventDefault();
      event.returnValue = "";
    });

    initializeWorkspaceLayout();
    syncRouteState();

    if (state.dependenciesReady) {
      makeGrid();
      clearOpenError();
    } else {
      elements.openButton.disabled = true;
      elements.sampleButton.disabled = true;
      showOpenError(`Marin CSV could not start because ${state.dependencyProblems.join("; ")}.`);
    }
    updateModeNotice();
    updateControls();
    initializeRecovery().catch((error) => {
      state.recoveryReady = false;
      updateRecoveryStatus({ code: Recovery.STATUS.UNAVAILABLE, message: error?.message, error });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeMarinCsv, { once: true });
  } else {
    initializeMarinCsv();
  }
})();

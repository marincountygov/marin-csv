#!/usr/bin/env python3
"""Exercise CSV-4 recovery retained by the CSV-6 Marin CSV interface.

The in-memory mode uses the production coordinator with its deterministic
MemoryRecoveryStore so UI behavior can run in policy-restricted CI. The normal
mode uses the production IndexedDB adapter on a real HTTP origin and a
persistent Chromium profile.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import tempfile

from browser_smoke import configure, fixture_page, ready, require, serve


def data_cell(page, row: int, column: int):
    return page.locator(
        f'.tabulator-cell[data-document-row-index="{row}"][data-column-index="{column}"]'
    )


def wait_for_grid(page) -> None:
    page.locator("#csv-grid.tabulator[role='grid']").wait_for(state="visible")
    page.locator(".tabulator-cell[data-document-row-index][data-column-index]").first.wait_for()


def edit_cell(page, row: int, column: int, value: str) -> None:
    cell = data_cell(page, row, column)
    cell.dblclick()
    editor = cell.locator("textarea.csv-tabulator-editor")
    editor.wait_for()
    editor.fill(value)
    editor.press("Enter")
    page.wait_for_function(
        "([row, column, expected]) => document.querySelector(`.tabulator-cell[data-document-row-index='${row}'][data-column-index='${column}']`)?.innerText === expected",
        arg=[row, column, value],
    )


def wait_saved(page) -> None:
    page.wait_for_function(
        "() => document.querySelector('#csv-recovery-status')?.dataset.state === 'saved'"
    )
    require(page.locator("#csv-recovery-status").inner_text() == "Saved locally",
            "The recovery status did not report a completed local transaction")


def close_dialog(page, dialog_id: str) -> None:
    dialog = page.locator(f"#{dialog_id}")
    if dialog.get_attribute("open") is not None:
        dialog.locator("[data-close-dialog]").click()
        dialog.wait_for(state="hidden")


def accept_confirmation(page) -> None:
    dialog = page.locator("#csv-confirm-dialog")
    dialog.wait_for(state="visible")
    page.locator("#csv-confirm-accept").click()
    dialog.wait_for(state="hidden")


def upload(page, name: str, payload: bytes, mime_type: str = "text/csv") -> None:
    page.locator("#csv-file-input").set_input_files({
        "name": name,
        "mimeType": mime_type,
        "buffer": payload,
    })
    page.locator("#csv-editor-view").wait_for(state="visible")
    wait_for_grid(page)


def open_more(page) -> None:
    menu = page.locator("#csv-more-menu")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    menu.locator(".csv-toolbar-menu-panel").wait_for(state="visible")


def in_memory_run(screenshots: Path | None = None) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("Marin CSV browser tests require Python Playwright and Chromium.") from error

    with serve() as base_url, sync_playwright() as pw:
        executable = (shutil.which("chromium") or shutil.which("chromium-browser")
                      or shutil.which("google-chrome"))
        options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        if executable:
            options["executable_path"] = executable
        browser = pw.chromium.launch(**options)
        try:
            context = browser.new_context(
                viewport={"width": 1440, "height": 1000},
                color_scheme="light",
                accept_downloads=True,
            )
            problems, _external = configure(context, base_url)
            page = fixture_page(context, None, base_url, recovery_memory=True)
            ready(page)
            page.wait_for_function(
                "() => document.querySelector('#csv-recovery-status')?.textContent === 'Local recovery ready'"
            )
            require(page.locator("#csv-recent-panel").is_hidden(),
                    "The recent-documents panel should be hidden before a recovery record exists")

            page.locator("#csv-sample-button").click()
            page.locator("#csv-editor-view").wait_for(state="visible")
            wait_for_grid(page)
            wait_saved(page)
            require(page.evaluate("window.__marinCsvRecoveryStore.documents.size") == 1,
                    "Opening a document did not create one recovery record")

            edit_cell(page, 1, 1, "locally recovered")
            wait_saved(page)
            record = page.evaluate("""() => {
              const store = window.__marinCsvRecoveryStore;
              const value = [...store.documents.values()][0];
              return {documentId: value.documentId, revision: value.lastSafeRevision};
            }""")
            require(record["revision"] == 1, "The committed edit was not journaled as revision 1")

            page.locator("#csv-recent-button").click()
            page.locator("#csv-recent-dialog").wait_for(state="visible")
            require(page.locator("#csv-recent-dialog-list .csv-recent-item").count() == 1,
                    "The recent-documents dialog did not list the active local copy")
            require("marin-csv-sample.csv" in page.locator("#csv-recent-dialog-list").inner_text(),
                    "The recent-documents dialog omitted the filename")
            delete_label = page.locator(
                "#csv-recent-dialog-list button[data-recovery-action='delete']"
            ).get_attribute("aria-label")
            require(delete_label.startswith("Delete local copy of marin-csv-sample.csv, saved locally "),
                    "Repeated Recent documents actions do not include filename and timestamp context in their accessible names")
            require("Changes not downloaded" in page.locator("#csv-recent-dialog-list").inner_text(),
                    "The Recent documents entry omitted its working-document status")
            close_dialog(page, "csv-recent-dialog")

            # Deleting the active copy keeps the in-memory document open but
            # suspends recovery until the user explicitly resumes it.
            open_more(page)
            page.locator("#csv-delete-local-button").click()
            accept_confirmation(page)
            page.wait_for_function(
                "() => document.querySelector('#csv-recovery-status')?.dataset.state === 'off'"
            )
            require(page.evaluate("window.__marinCsvRecoveryStore.documents.size") == 0,
                    "Deleting the active local copy left a recovery record behind")
            edit_cell(page, 2, 1, "not persisted while off")
            page.wait_for_timeout(50)
            require(page.evaluate("window.__marinCsvRecoveryStore.documents.size") == 0,
                    "An edit silently recreated a deliberately deleted local copy")
            with page.expect_download():
                page.locator("#csv-download-button").click()
            unload_result = page.evaluate("""() => {
              const event = new Event('beforeunload', {cancelable: true});
              window.dispatchEvent(event);
              return event.defaultPrevented;
            }""")
            require(unload_result,
                    "A changed document with local recovery off did not retain unload protection after download")
            page.locator("#csv-recovery-resume-button").click()
            wait_saved(page)
            require(page.evaluate("window.__marinCsvRecoveryStore.documents.size") == 1,
                    "Resume local recovery did not recreate the selected document")
            edit_cell(page, 2, 1, "persisted after resume")
            wait_saved(page)

            # Open a second file; the first remains recoverable and can be
            # reopened from Recent local documents.
            page.locator("#csv-open-another-button").click()
            accept_confirmation(page)
            page.locator("#csv-open-view").wait_for(state="visible")
            upload(page, "second.psv", b"id|value\nA|second\n", "text/plain")
            wait_saved(page)
            require(page.locator("#csv-delimiter-select").input_value() == "|",
                    "The pipe delimiter was not retained when the second document entered recovery")
            require(page.evaluate("window.__marinCsvRecoveryStore.documents.size") == 2,
                    "Opening a second source did not retain both recovery records")

            page.locator("#csv-recent-button").click()
            page.locator("#csv-recent-dialog").wait_for(state="visible")
            first_item = page.locator("#csv-recent-dialog-list .csv-recent-item").filter(
                has_text="marin-csv-sample.csv"
            )
            first_item.locator("button[data-recovery-action='open']").click()
            page.locator("#csv-file-heading").wait_for(state="visible")
            page.wait_for_function(
                "() => document.querySelector('#csv-file-heading')?.textContent === 'marin-csv-sample.csv'"
            )
            require(data_cell(page, 1, 1).inner_text() == "locally recovered",
                    "Opening a recent document did not reconstruct its journaled value")
            require(data_cell(page, 2, 1).inner_text() == "persisted after resume",
                    "Edits after resuming local recovery were not journaled")

            # Give the inactive second document a foreign live lease, then
            # verify that it opens read-only and can be forked explicitly.
            page.evaluate("""() => {
              const store = window.__marinCsvRecoveryStore;
              const second = [...store.documents.values()].find(value => value.filename === 'second.psv');
              store.leases.set(second.documentId, {
                documentId: second.documentId,
                sessionId: 'another-tab',
                acquiredAt: Date.now(),
                heartbeatAt: Date.now(),
                expiresAt: Date.now() + 90_000,
                expectedRevision: second.lastSafeRevision,
              });
            }""")
            page.locator("#csv-recent-button").click()
            page.locator("#csv-recent-dialog").wait_for(state="visible")
            second_item = page.locator("#csv-recent-dialog-list .csv-recent-item").filter(has_text="second.psv")
            second_item.locator("button[data-recovery-action='open']").click()
            accept_confirmation(page)
            page.wait_for_function(
                "() => document.querySelector('#csv-recovery-status')?.dataset.state === 'conflict'"
            )
            require(page.locator("#csv-grid").get_attribute("aria-readonly") == "true",
                    "A document with another active writer did not open read-only")
            require(page.locator("#csv-delimiter-select").input_value() == "|",
                    "The recovered pipe-delimited document lost its delimiter metadata")
            require(page.locator("#csv-recovery-copy-button").is_visible(),
                    "The conflict state did not offer an independent copy")

            # The custom cell menu remains useful in a read-only writer
            # conflict, but must not expose mutation commands.
            data_cell(page, 1, 1).click(button="right")
            page.get_by_role("menu", name="Field actions").wait_for(state="visible")
            require(page.locator("#csv-context-edit").is_disabled(),
                    "Read-only conflict exposed Edit field")
            require(page.locator("#csv-context-clear").is_disabled(),
                    "Read-only conflict exposed Clear field")
            require(page.locator("#csv-context-filter").is_enabled(),
                    "Read-only conflict disabled view-only exact filtering")
            require(page.locator("#csv-context-delete-row").is_disabled(),
                    "Read-only conflict exposed Delete row")
            require(page.locator("#csv-context-delete-column").is_disabled(),
                    "Read-only conflict exposed Delete column")
            page.keyboard.press("Escape")

            page.locator("#csv-recovery-copy-button").click()
            wait_saved(page)
            require(page.locator("#csv-grid").get_attribute("aria-readonly") == "false",
                    "The independent recovery copy remained read-only")
            require(page.evaluate("window.__marinCsvRecoveryStore.documents.size") == 3,
                    "Creating an independent copy did not create a distinct recovery record")

            if screenshots:
                screenshots.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(screenshots / "csv-recovery-editor-light.png"), full_page=True)
                page.locator("#csv-recent-button").click()
                page.locator("#csv-recent-dialog").wait_for(state="visible")
                page.screenshot(path=str(screenshots / "csv-recovery-recent-light.png"), full_page=True)
                close_dialog(page, "csv-recent-dialog")
                page.emulate_media(color_scheme="dark")
                page.wait_for_timeout(100)
                page.screenshot(path=str(screenshots / "csv-recovery-editor-dark.png"), full_page=True)
                page.locator("#csv-recent-button").click()
                page.locator("#csv-recent-dialog").wait_for(state="visible")
                page.screenshot(path=str(screenshots / "csv-recovery-recent-dark.png"), full_page=True)
                close_dialog(page, "csv-recent-dialog")

            require(not problems, "Browser recovery fixture reported: " + "; ".join(problems))
            print("Marin CSV local recovery interface (memory-backed browser fixture): PASS")
            print("NOT TESTED in this mode: native IndexedDB, browser restart persistence, HTTP asset loading, or real origin isolation.")
        finally:
            browser.close()


def http_run(screenshots: Path | None = None) -> None:
    """Run the required real-origin IndexedDB tests with a persistent profile."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("Marin CSV browser tests require Python Playwright and Chromium.") from error

    profile = Path(tempfile.mkdtemp(prefix="marin-csv-recovery-profile-"))
    try:
        with serve() as base_url, sync_playwright() as pw:
            executable = (shutil.which("chromium") or shutil.which("chromium-browser")
                          or shutil.which("google-chrome"))
            options = {
                "headless": True,
                "args": ["--no-sandbox", "--disable-dev-shm-usage"],
                "viewport": {"width": 1440, "height": 1000},
                "color_scheme": "light",
                "accept_downloads": True,
            }
            if executable:
                options["executable_path"] = executable

            context = pw.chromium.launch_persistent_context(str(profile), **options)
            problems, _external = configure(context, base_url)
            try:
                pages = context.pages
                page = pages[0] if pages else context.new_page()
                page.goto(base_url, wait_until="networkidle")
                ready(page)
                page.wait_for_function(
                    "() => document.querySelector('#csv-recovery-status')?.textContent === 'Local recovery ready'"
                )
                upload(page, "recovery.psv", b"id|value\n001|original\n", "text/plain")
                wait_saved(page)
                edit_cell(page, 1, 1, "survives refresh")
                wait_saved(page)

                page.reload(wait_until="networkidle")
                ready(page)
                page.locator("#csv-editor-view").wait_for(state="visible")
                wait_for_grid(page)
                require(data_cell(page, 1, 1).inner_text() == "survives refresh",
                        "A confirmed refresh did not restore the journaled value")
                require(page.locator("#csv-delimiter-select").input_value() == "|",
                        "A confirmed refresh did not restore the pipe delimiter")
                require(page.locator("#csv-recovery-status").get_attribute("data-state") == "recovered",
                        "Confirmed refresh did not report recovered local work")

                second = context.new_page()
                second.goto(base_url, wait_until="networkidle")
                ready(second)
                second.locator("#csv-recent-panel").wait_for(state="visible")
                second.locator("#csv-recent-list button[data-recovery-action='open']").click()
                second.locator("#csv-editor-view").wait_for(state="visible")
                wait_for_grid(second)
                require(second.locator("#csv-recovery-status").get_attribute("data-state") == "conflict",
                        "A second tab was allowed to become a silent writer")
                require(second.locator("#csv-grid").get_attribute("aria-readonly") == "true",
                        "The second tab did not expose the recovered document as read-only")
                second.locator("#csv-recovery-copy-button").click()
                wait_saved(second)
                require(second.locator("#csv-grid").get_attribute("aria-readonly") == "false",
                        "The independent copy did not become writable")

                if screenshots:
                    screenshots.mkdir(parents=True, exist_ok=True)
                    page.screenshot(path=str(screenshots / "csv-recovery-http-refresh.png"), full_page=True)
                    second.screenshot(path=str(screenshots / "csv-recovery-http-copy.png"), full_page=True)
                require(not problems, "HTTP recovery browser test reported: " + "; ".join(problems))
            finally:
                context.close()

            # Reopen the same browser profile. A fresh visit must show recovery
            # choices rather than automatically exposing retained document data.
            context = pw.chromium.launch_persistent_context(str(profile), **options)
            problems, _external = configure(context, base_url)
            try:
                pages = context.pages
                page = pages[0] if pages else context.new_page()
                page.goto(base_url, wait_until="networkidle")
                ready(page)
                page.locator("#csv-recent-panel").wait_for(state="visible")
                require(page.locator("#csv-editor-view").is_hidden(),
                        "A fresh browser visit automatically exposed retained CSV contents")
                require(page.locator("#csv-recent-list .csv-recent-item").count() >= 2,
                        "The persistent browser profile did not retain recovery records")
                require(not problems, "Restart recovery browser test reported: " + "; ".join(problems))
            finally:
                context.close()

        print("Marin CSV native IndexedDB recovery, refresh, restart, and multi-tab workflow: PASS")
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in-memory", action="store_true")
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    try:
        if args.in_memory:
            in_memory_run(args.screenshots)
        else:
            http_run(args.screenshots)
    except Exception as error:
        print(f"ERROR: {error}", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

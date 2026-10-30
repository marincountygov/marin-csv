#!/usr/bin/env python3
"""Exercise how Marin CSV takes files in and gives them back through the shared upload and download helpers.

Covers the wrong file type message, dropping a file anywhere on the page, dropping something that is not a file, and
the downloaded name and bytes for each delimiter.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import sys

from browser_smoke import configure, fixture_page, ready, require, serve


BOM = b"\xef\xbb\xbf"


def wait_for_grid(page) -> None:
    page.locator("#csv-grid.tabulator[role='grid']").wait_for(state="visible")
    page.locator(".tabulator-cell[data-document-row-index][data-column-index]").first.wait_for()


def data_cell(page, row: int, column: int):
    return page.locator(
        f'.tabulator-cell[data-document-row-index="{row}"][data-column-index="{column}"]'
    )


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


def choose(page, name: str, payload: bytes, mime: str = "text/csv") -> None:
    page.locator("#csv-file-input").set_input_files({"name": name, "mimeType": mime, "buffer": payload})


def drop_files(page, files: list[tuple[str, str, str]]) -> None:
    """Fire the drag events a real drop sends to the window, with the given files."""
    page.evaluate(
        """(files) => {
          const transfer = new DataTransfer();
          files.forEach(([name, type, text]) => transfer.items.add(new File([text], name, { type })));
          for (const kind of ["dragenter", "dragover"]) {
            window.dispatchEvent(new DragEvent(kind, { dataTransfer: transfer, bubbles: true, cancelable: true }));
          }
          window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
        }""",
        files,
    )


def open_view_shown(page) -> bool:
    return page.locator("#csv-open-view").is_visible() and page.locator("#csv-editor-view").is_hidden()


def download_of(page):
    with page.expect_download() as info:
        page.locator("#csv-download-button").click()
    download = info.value
    return download.suggested_filename, Path(download.path()).read_bytes()


def accept_confirmation(page) -> None:
    dialog = page.locator("#csv-confirm-dialog")
    dialog.wait_for(state="visible")
    page.locator("#csv-confirm-accept").click()
    dialog.wait_for(state="hidden")


def run(in_memory: bool = False) -> None:
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
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, color_scheme="light",
                                          accept_downloads=True)
            problems, _external = configure(context, base_url)
            page = fixture_page(context, None, base_url) if in_memory else context.new_page()
            if not in_memory:
                page.goto(base_url, wait_until="networkidle")
            ready(page)
            page.locator("#csv-open-button").wait_for(state="visible")

            # A file that is not a spreadsheet text file gets a plain message and nothing opens.
            choose(page, "report.xlsx", b"PK\x03\x04", "application/vnd.ms-excel")
            page.locator("#csv-open-error").wait_for(state="visible")
            message = page.locator("#csv-open-error").inner_text()
            require(".csv" in message and ".tsv" in message and ".psv" in message and ".txt" in message,
                    f"The wrong-type message does not name the file types Marin CSV opens: {message!r}")
            require(open_view_shown(page), "A file of the wrong type opened the editor")

            # Dropping a file anywhere on the page shows the overlay while it is over the page, then opens the file.
            page.evaluate("""() => {
              const transfer = new DataTransfer();
              transfer.items.add(new File(["a,b\\n1,2\\n"], "dragging.csv", { type: "text/csv" }));
              window.dispatchEvent(new DragEvent("dragover", { dataTransfer: transfer, bubbles: true, cancelable: true }));
            }""")
            require(page.locator(".upload-drop-overlay").get_attribute("data-active") == "true",
                    "The drop overlay did not show while a file was over the page")
            drop_files(page, [("dropped.csv", "text/csv", "id,name\n001,Ada\n002,Grace\n")])
            page.locator("#csv-editor-view").wait_for(state="visible")
            wait_for_grid(page)
            require(page.locator(".upload-drop-overlay").get_attribute("data-active") == "false",
                    "The drop overlay stayed after the file was dropped")
            require(data_cell(page, 1, 0).inner_text() == "001", "The dropped file's text did not open as written")
            require("dropped.csv" in page.locator("#csv-editor-view").inner_text(),
                    "The dropped file's name is not shown")

            # Dragging something that is not a file (text, a link) does nothing: no overlay, no new document.
            page.evaluate("""() => {
              const transfer = new DataTransfer();
              transfer.setData("text/plain", "just some words");
              for (const kind of ["dragenter", "dragover", "drop"]) {
                window.dispatchEvent(new DragEvent(kind, { dataTransfer: transfer, bubbles: true, cancelable: true }));
              }
            }""")
            require(page.locator(".upload-drop-overlay").get_attribute("data-active") != "true",
                    "Dragging plain text showed the file drop overlay")
            require(data_cell(page, 1, 0).inner_text() == "001", "Dragging plain text replaced the open document")

            # Downloads: the name keeps the delimiter's extension, a file opened with a BOM keeps it, one without gets none.
            for name, payload, extension in (
                ("with-bom.csv", BOM + b"id,name\n001,Ada\n", ".csv"),
                ("no-bom.csv", b"id,name\n001,Ada\n", ".csv"),
                ("tabs.tsv", b"id\tname\n001\tAda\n", ".tsv"),
                ("pipes.psv", b"id|name\n001|Ada\n", ".psv"),
            ):
                page.evaluate("document.querySelector('#csv-open-error').hidden = true")
                if page.locator("#csv-editor-view").is_visible():
                    choose(page, name, payload)
                    if page.locator("#csv-confirm-dialog").is_visible():
                        accept_confirmation(page)
                else:
                    choose(page, name, payload)
                page.locator("#csv-editor-view").get_by_text(name, exact=True).first.wait_for()
                wait_for_grid(page)
                edit_cell(page, 1, 1, "Grace")
                saved_name, saved = download_of(page)
                require(saved_name.endswith(extension), f"{name} downloaded as {saved_name!r}, not {extension}")
                require(saved.startswith(BOM) == payload.startswith(BOM),
                        f"{name} download {'lost' if payload.startswith(BOM) else 'gained'} its byte-order mark")
                require(b"Grace" in saved and b"Ada" not in saved, f"{name} download does not hold the edit: {saved!r}")
                require(b"001" in saved, f"{name} download lost the leading zeros")

            require(not problems, f"Browser errors: {problems}")
        finally:
            browser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in-memory", action="store_true",
                        help="Run a component fixture when HTTP browser navigation is unavailable")
    args = parser.parse_args()
    run(args.in_memory)
    print("Marin CSV file in and out (upload, drop, download): PASS")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)

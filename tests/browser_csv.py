#!/usr/bin/env python3
"""Exercise the real Papa Parse and Tabulator Marin CSV workflow through CSV-6."""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import sys

from browser_smoke import configure, fixture_page, ready, require, serve


# Independent golden bytes for the built-in sample. A no-op edit must preserve
# its embedded CRLF, quoting, row boundaries, and final record separator.
SAMPLE_CSV = "\r\n".join([
    "employee_id,zip_code,long_number,date_like,scientific_like,formula_like,notes",
    '000123,00901,12345678901234567890,03-04,1E10,"=SUM(A1:A2)","Line one',
    'Line two"',
    '000124,02108,00000000001234567890,01-02,9E3,"@example","Comma, quote ""and"" line break"',
    "",
]).encode("utf-8")


def download_bytes(download) -> bytes:
    path = download.path()
    require(path is not None, "Browser did not retain the downloaded file")
    return Path(path).read_bytes()


def data_cell(page, row: int, column: int):
    return page.locator(
        f'.tabulator-cell[data-document-row-index="{row}"][data-column-index="{column}"]'
    )


def cell_text(page, row: int, column: int) -> str:
    return data_cell(page, row, column).inner_text()


def wait_for_grid(page) -> None:
    page.locator("#csv-grid.tabulator[role='grid']").wait_for(state="visible")
    page.locator(".tabulator-cell[data-document-row-index][data-column-index]").first.wait_for()


def open_more_menu(page) -> None:
    menu = page.locator("#csv-more-menu")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    menu.locator(".csv-toolbar-menu-panel").wait_for(state="visible")


def edit_cell(page, row: int, column: int, value: str, *, multiline: bool = False) -> None:
    cell = data_cell(page, row, column)
    cell.dblclick()
    editor = cell.locator("textarea.csv-tabulator-editor")
    editor.wait_for()
    editor.fill(value)
    editor.press("Shift+Enter" if multiline else "Enter")
    page.wait_for_function(
        "([row, column, expected]) => document.querySelector(`.tabulator-cell[data-document-row-index='${row}'][data-column-index='${column}']`)?.innerText === expected",
        arg=[row, column, value],
    )


def dispatch_paste(page, row: int, column: int, text: str) -> None:
    cell = data_cell(page, row, column)
    cell.focus()
    page.evaluate(
        """([row, column, text]) => {
            const cell = document.querySelector(
              `.tabulator-cell[data-document-row-index='${row}'][data-column-index='${column}']`
            );
            if (!cell) throw new Error('Paste target cell is missing.');
            cell.focus();
            const transfer = new DataTransfer();
            transfer.setData('text/plain', text);
            cell.dispatchEvent(new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: transfer,
            }));
        }""",
        [row, column, text],
    )


def open_another(page) -> None:
    page.locator("#csv-open-another-button").click()
    if page.locator("#csv-confirm-dialog[open]").count():
        page.locator("#csv-confirm-accept").click()
    page.locator("#csv-open-view").wait_for(state="visible")


def upload(page, name: str, mime: str, payload: bytes) -> None:
    page.locator("#csv-file-input").set_input_files({
        "name": name,
        "mimeType": mime,
        "buffer": payload,
    })
    page.locator("#csv-editor-view").wait_for(state="visible")


def run(screenshots: Path | None = None, in_memory: bool = False) -> None:
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
            problems, external = configure(context, base_url)
            requests: list[str] = []
            context.on("request", lambda request: requests.append(request.url))
            page = fixture_page(context, None, base_url) if in_memory else context.new_page()
            if not in_memory:
                page.goto(base_url, wait_until="networkidle")
            ready(page)
            page.locator("#csv-open-button").wait_for(state="visible")

            require(page.locator("#csv-open-view").is_visible(), "Open-file view is not visible initially")
            require(page.locator("#csv-editor-view").is_hidden(), "Editor should start hidden")
            require(page.locator("#csv-drop-zone").get_attribute("role") is None,
                    "Drop zone must not wrap buttons in another interactive control")
            require(page.locator("#csv-file-input").get_attribute("accept")
                    == ".csv,.tsv,.psv,.txt,text/csv,text/tab-separated-values,text/plain",
                    "File input types differ")
            require(page.locator("#csv-delimiter-select option").all_text_contents()
                    == ["Comma (,)", "Tab", "Semicolon (;)", "Pipe (|)"],
                    "Delimiter choices differ")

            page.locator("#csv-open-button").focus()
            with page.expect_file_chooser() as chooser_info:
                page.keyboard.press("Enter")
            chooser_info.value.set_files([])

            external_count_before_file = len(external)
            if in_memory:
                page.locator("#csv-sample-button").click()
            else:
                with page.expect_request(lambda request: request.url.endswith("/assets/csv-worker.js")):
                    page.locator("#csv-sample-button").click()
            page.locator("#csv-editor-view").wait_for(state="visible")
            wait_for_grid(page)
            require(page.locator("#csv-mode-notice").is_hidden(),
                    "CSV-3 should not display a dependency or parser error for the built-in sample")
            require(len(external) == external_count_before_file,
                    "Opening the built-in sample triggered an external network request")
            require("Tabulator 6.6.1" in page.locator("#csv-file-metadata").text_content(),
                    "The real vendored Tabulator runtime is not identified")
            require(("Main-thread fallback" if in_memory else "Local Web Worker")
                    in page.locator("#csv-file-metadata").text_content(),
                    "The active parsing execution path is not identified")

            require(cell_text(page, 1, 0) == "000123", "Leading zeros were not preserved")
            require(cell_text(page, 1, 2) == "12345678901234567890",
                    "Long digit string was not preserved")
            require(cell_text(page, 1, 3) == "03-04", "Date-like text was converted")
            require(cell_text(page, 1, 4) == "1E10", "Scientific-like text was converted")
            require(cell_text(page, 1, 5) == "=SUM(A1:A2)", "Formula-like text changed")
            require("formula" in page.locator("#csv-warnings").text_content().lower(),
                    "Formula-like warning is missing")
            require(page.locator("#csv-file-metadata").get_by_text("CRLF", exact=False).count() >= 1,
                    "CRLF metadata is missing")

            # Verify the real grid's accessibility surface, not only source markup.
            grid = page.get_by_role("grid", name="marin-csv-sample.csv data editor")
            require(grid.count() == 1, "The Tabulator grid lacks an accessible name")
            require(grid.get_attribute("aria-rowcount") == "3", "Grid row count differs")
            require(grid.get_attribute("aria-colcount") == "8", "Grid column count differs")
            require(page.get_by_role("columnheader").count() >= 8, "Column-header semantics are missing")
            require(page.get_by_role("rowheader").count() >= 2, "Row-header semantics are missing")
            require(page.get_by_role("gridcell").count() >= 14, "Grid-cell semantics are missing")

            if screenshots:
                screenshots.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(screenshots / "csv-editor-desktop-light.png"), full_page=True)

            # Opening and committing a multiline field without changing it must not
            # normalize its embedded CRLF into LF.
            notes = data_cell(page, 1, 6)
            notes.dblclick()
            notes_editor = notes.locator("textarea")
            notes_editor.wait_for()
            require(notes_editor.input_value() == "Line one\nLine two",
                    "Multiline editor did not expose the field text")
            require("Shift+Enter saves" in notes_editor.get_attribute("aria-label"),
                    "Multiline save instruction is missing from the editor name")
            notes_editor.press("Shift+Enter")
            notes_editor.wait_for(state="detached")
            page.wait_for_function(
                "() => document.querySelector('#csv-file-metadata')?.textContent.includes('Unchanged from opened file')"
            )
            with page.expect_download() as unchanged_download_info:
                page.locator("#csv-download-button").click()
            require(download_bytes(unchanged_download_info.value) == SAMPLE_CSV,
                    "A no-op multiline edit changed the original CSV bytes or CRLF convention")

            # Alt+Enter can promote a single-line field to multiline. Newly
            # inserted line breaks use the document's CRLF convention.
            promote = data_cell(page, 2, 6)
            promote.dblclick()
            promote_editor = promote.locator("textarea.csv-tabulator-editor")
            promote_editor.wait_for()
            # Put the caret at the end by setting it, because Control+End is not "go to the end" on every platform.
            promote_editor.evaluate("editor => editor.setSelectionRange(editor.value.length, editor.value.length)")
            promote_editor.press("Alt+Enter")
            require(promote_editor.get_attribute("data-multiline") == "true",
                    "Alt+Enter did not switch the editor to multiline mode")
            require("Shift+Enter saves" in promote_editor.get_attribute("aria-label"),
                    "Promoted multiline editor lacks its save instruction")
            promote_editor.type("Second line")
            promote_editor.press("Shift+Enter")
            promote_editor.wait_for(state="detached")
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='2'][data-column-index='6']`)?.innerText.endsWith('\\nSecond line')"
            )
            with page.expect_download() as promoted_download_info:
                page.locator("#csv-download-button").click()
            promoted_bytes = download_bytes(promoted_download_info.value)
            require(b"line break\r\nSecond line" in promoted_bytes,
                    "New multiline field did not use the document CRLF convention")
            page.locator("#csv-undo-button").click()
            page.wait_for_function(
                "() => !document.querySelector(`.tabulator-cell[data-document-row-index='2'][data-column-index='6']`)?.innerText.includes('Second line')"
            )

            # Drag selection and Ctrl+C use the real Tabulator range/clipboard
            # modules. Both cells must be visible before taking pointer
            # coordinates: Tabulator may redraw its virtualized grid on undo.
            # Capture DataTransfer.setData before Tabulator's bubble listener
            # without relying on the OS clipboard in headless Chromium.
            data_cell(page, 1, 0).scroll_into_view_if_needed()
            data_cell(page, 2, 1).scroll_into_view_if_needed()
            start_box = data_cell(page, 1, 0).bounding_box()
            end_box = data_cell(page, 2, 1).bounding_box()
            require(start_box is not None and end_box is not None,
                    "Could not locate cells for range selection")
            page.mouse.move(start_box["x"] + start_box["width"] / 2,
                            start_box["y"] + start_box["height"] / 2)
            page.mouse.down()
            page.mouse.move(end_box["x"] + end_box["width"] / 2,
                            end_box["y"] + end_box["height"] / 2, steps=10)
            # Keep the pointer pressed through a rendering opportunity: the
            # range listener may coalesce intermediate moves into a frame.
            page.evaluate("""() => new Promise(resolve => {
              requestAnimationFrame(() => requestAnimationFrame(resolve));
            })""")
            page.mouse.up()
            # Pointer release, the Tabulator range callback, accessibility
            # decoration, and the app status update are not one atomic event.
            # Wait for ALL observable states; do not retry the gesture or settle
            # for a smaller selection when a real regression occurs.
            page.wait_for_function("""() => {
              const selected = document.querySelectorAll('.tabulator-cell.tabulator-range-selected');
              const accessible = document.querySelectorAll('.tabulator-cell.tabulator-range-selected[aria-selected="true"]');
              const status = document.querySelector('#csv-selection-status')?.textContent || '';
              return selected.length === 4 && accessible.length === 4
                && status.includes('4 cells selected');
            }""")
            selected_coordinates = page.locator(
                '.tabulator-cell.tabulator-range-selected[aria-selected="true"]'
            ).evaluate_all("cells => cells.map(cell => [Number(cell.dataset.documentRowIndex), Number(cell.dataset.columnIndex)])")
            require(sorted(selected_coordinates) == [[1, 0], [1, 1], [2, 0], [2, 1]],
                    f"Two-by-two range selected the wrong physical cells: {selected_coordinates}")
            page.evaluate("""() => {
                window.__marinCsvCopied = [];
                document.addEventListener('copy', event => {
                  const transfer = event.clipboardData;
                  const setData = transfer.setData.bind(transfer);
                  transfer.setData = (type, data) => {
                    window.__marinCsvCopied.push([type, data]);
                    return setData(type, data);
                  };
                }, {capture: true, once: true});
            }""")
            page.keyboard.press("Control+C")
            page.wait_for_function("() => window.__marinCsvCopied.some(([type]) => type === 'text/plain')")
            copied_plain = page.evaluate(
                "window.__marinCsvCopied.find(([type]) => type === 'text/plain')?.[1]"
            )
            require(copied_plain == "000123\t00901\n000124\t02108",
                    "Selected range copy payload differs")

            # Block paste is committed by the preservation model. A normal trailing
            # clipboard record delimiter must not clear the next row.
            second_row_before = cell_text(page, 2, 0)
            dispatch_paste(page, 1, 0, "000777\t00888\n")
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='0']`)?.innerText === '000777'"
            )
            require(cell_text(page, 1, 1) == "00888", "Block paste second cell differs")
            require(cell_text(page, 2, 0) == second_row_before,
                    "Trailing clipboard line ending cleared the following row")
            page.wait_for_function("""() => {
                const active = document.activeElement;
                return active?.dataset?.documentRowIndex === '1' && active?.dataset?.columnIndex === '0';
            }""")
            page.locator("#csv-undo-button").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='0']`)?.innerText === '000123'"
            )
            require(cell_text(page, 1, 1) == "00901", "Undo left a pasted cell changed")

            # An intentional multiline edit retains the source field's CRLF convention.
            edit_cell(page, 1, 6, "Changed one\nLine two", multiline=True)
            with page.expect_download() as multiline_download_info:
                page.locator("#csv-download-button").click()
            multiline_bytes = download_bytes(multiline_download_info.value)
            require(b"Changed one\r\nLine two" in multiline_bytes,
                    "Edited multiline field did not retain CRLF")
            require(b"\n" not in multiline_bytes.replace(b"\r\n", b""),
                    "Edited output introduced bare LF line endings")
            page.locator("#csv-undo-button").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='6']`)?.innerText === 'Line one\\nLine two'"
            )

            # Editing remains string-only and participates in undo/redo.
            edit_cell(page, 1, 0, "000999")
            require(page.locator("#csv-undo-button").is_enabled(), "Undo did not enable after an edit")
            require(page.title().startswith("marin-csv-sample.csv *"), "Unsaved marker is missing")

            with page.expect_download() as edited_download_info:
                page.locator("#csv-download-button").click()
            edited_download = edited_download_info.value
            require(edited_download.suggested_filename == "marin-csv-sample-edited-4.csv",
                    "Edited download sequence differs")
            edited = download_bytes(edited_download)
            require(b"000999,00901" in edited, "Edited field is missing from download")
            require(b"\r\n" in edited and b"\n" not in edited.replace(b"\r\n", b""),
                    "Edited download did not retain CRLF conventions")
            require("Changed — downloaded" in page.locator("#csv-file-metadata").text_content(),
                    "Downloaded-state metadata differs")

            page.locator("#csv-undo-button").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='0']`)?.innerText === '000123'"
            )
            page.locator("#csv-redo-button").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='0']`)?.innerText === '000999'"
            )

            # Row and column commands use physical coordinates, rebuild the
            # real grid, restore focus, and remain undoable.
            data_cell(page, 1, 0).click()
            page.locator("#csv-add-row-button").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-rowcount') === '4'")
            page.wait_for_function("""() => {
                const active = document.activeElement;
                return active?.dataset?.documentRowIndex === '2' && active?.dataset?.columnIndex === '0';
            }""")
            page.locator("#csv-undo-button").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-rowcount') === '3'")

            data_cell(page, 1, 0).click()
            page.locator("#csv-add-column-button").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-colcount') === '9'")
            page.wait_for_function("""() => {
                const active = document.activeElement;
                return active?.dataset?.documentRowIndex === '1' && active?.dataset?.columnIndex === '1';
            }""")
            page.locator("#csv-undo-button").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-colcount') === '8'")

            data_cell(page, 2, 0).click()
            open_more_menu(page)
            page.locator("#csv-delete-row-button").click()
            require(page.locator("#csv-confirm-dialog[open]").count() == 1,
                    "Delete-row confirmation did not open")
            page.locator("#csv-confirm-accept").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-rowcount') === '2'")
            page.locator("#csv-undo-button").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-rowcount') === '3'")

            data_cell(page, 1, 1).click()
            open_more_menu(page)
            page.locator("#csv-delete-column-button").click()
            require(page.locator("#csv-confirm-dialog[open]").count() == 1,
                    "Delete-column confirmation did not open")
            page.locator("#csv-confirm-accept").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-colcount') === '7'")
            page.locator("#csv-undo-button").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-colcount') === '8'")

            # Filtering and sorting are presentation-only.
            page.locator("#csv-filter-input").fill("000124")
            page.wait_for_function(
                "() => [...document.querySelectorAll('.tabulator-row[data-document-row-index]')].filter((row) => row.offsetParent !== null).length === 1"
            )
            require(data_cell(page, 2, 0).is_visible(), "Expected filtered row is not visible")
            page.locator("#csv-filter-input").fill("")
            page.wait_for_function(
                "() => [...document.querySelectorAll('.tabulator-row[data-document-row-index]')].filter((row) => row.offsetParent !== null).length === 2"
            )
            page.locator('.tabulator-col[tabulator-field="c0"] .tabulator-col-content').click()
            page.wait_for_function(
                """() => document.querySelector(
                    '.tabulator-row[data-document-row-index] .tabulator-cell[data-column-index="0"]'
                )?.innerText === '000124'"""
            )
            with page.expect_download() as sorted_download_info:
                page.locator("#csv-download-button").click()
            sorted_bytes = download_bytes(sorted_download_info.value)
            require(sorted_bytes.find(b"000999") < sorted_bytes.find(b"000124"),
                    "View sorting changed physical document export order")

            # CSV-6 field context menu uses the clicked physical cell, exposes
            # complete keyboard semantics, and routes mutations through the
            # preservation engine rather than Tabulator's data model.
            edit_target = data_cell(page, 1, 3)
            edit_target.click(button="right")
            menu = page.get_by_role("menu", name="Field actions")
            menu.wait_for(state="visible")
            require(menu.get_by_role("menuitem").all_text_contents() == [
                "Edit field", "Clear field", "Filter to this value",
                "Delete row…", "Delete column…",
            ], "Field context menu actions or order differ")
            menu.get_by_role("menuitem", name="Edit field").click()
            editor = edit_target.locator("textarea.csv-tabulator-editor")
            editor.wait_for()
            require(editor.input_value() == "03-04",
                    "Context-menu editing did not expose the complete existing value")
            editor.press("Escape")

            clear_target = data_cell(page, 1, 4)
            clear_target.click(button="right")
            page.get_by_role("menuitem", name="Clear field").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='4']`)?.innerText.trim() === ''"
            )
            page.locator("#csv-undo-button").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='4']`)?.innerText === '1E10'"
            )

            filter_target = data_cell(page, 2, 1)
            filter_target.focus()
            page.keyboard.press("Shift+F10")
            menu.wait_for(state="visible")
            require(page.locator("#csv-context-edit").evaluate("el => el === document.activeElement"),
                    "The field context menu did not focus its first enabled command")
            require(page.evaluate("""() => {
                const menu = document.querySelector('#csv-cell-context-menu').getBoundingClientRect();
                return menu.left >= 0 && menu.top >= 0
                  && menu.right <= document.documentElement.clientWidth
                  && menu.bottom <= document.documentElement.clientHeight;
            }"""), "Keyboard-opened context menu escaped the viewport")
            page.keyboard.press("End")
            require(page.locator("#csv-context-delete-column").evaluate("el => el === document.activeElement"),
                    "End did not move to the last enabled menu command")
            page.keyboard.press("Home")
            require(page.locator("#csv-context-edit").evaluate("el => el === document.activeElement"),
                    "Home did not move to the first enabled menu command")
            page.keyboard.press("ArrowDown")
            require(page.locator("#csv-context-clear").evaluate("el => el === document.activeElement"),
                    "Arrow Down did not move between menu commands")
            page.keyboard.press("Escape")
            require(menu.is_hidden(), "Escape did not close the field context menu")
            require(filter_target.evaluate("el => el === document.activeElement"),
                    "Escape did not restore focus to the originating field")

            filter_target.click(button="right")
            page.get_by_role("menuitem", name="Filter to this value").click()
            page.locator("#csv-value-filter").wait_for(state="visible")
            require("02108" in page.locator("#csv-value-filter-label").inner_text(),
                    "Exact-value filter indicator does not identify the selected value")
            page.wait_for_function(
                "() => [...document.querySelectorAll('.tabulator-row[data-document-row-index]')].filter((row) => row.offsetParent !== null).length === 1"
            )
            require(data_cell(page, 2, 0).is_visible(), "Exact-value filter hid the selected row")
            page.locator("#csv-filter-input").fill("000124")
            require(data_cell(page, 2, 0).is_visible(),
                    "Global and exact-value filters did not combine with AND semantics")
            page.locator("#csv-filter-input").fill("000999")
            page.wait_for_function(
                "() => [...document.querySelectorAll('.tabulator-row[data-document-row-index]')].filter((row) => row.offsetParent !== null).length === 0"
            )
            page.locator("#csv-filter-input").fill("")
            page.locator("#csv-clear-value-filter").click()
            page.wait_for_function(
                "() => [...document.querySelectorAll('.tabulator-row[data-document-row-index]')].filter((row) => row.offsetParent !== null).length === 2"
            )

            # The sorted visual position must not change which physical row is
            # deleted. Row 2 remains the third file record even when rendered first.
            data_cell(page, 2, 0).click(button="right")
            page.get_by_role("menuitem", name="Delete row…").click()
            require(page.locator("#csv-confirm-title").inner_text() == "Delete file row 3?",
                    "Context delete-row did not retain the clicked physical row")
            page.locator("#csv-confirm-accept").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-rowcount') === '2'")
            require(data_cell(page, 2, 0).count() == 0,
                    "Context delete-row removed a different physical row")
            page.locator("#csv-undo-button").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-rowcount') === '3'")

            data_cell(page, 1, 1).click(button="right")
            page.get_by_role("menuitem", name="Delete column…").click()
            require(page.locator("#csv-confirm-title").inner_text() == "Delete column B?",
                    "Context delete-column did not target the clicked column")
            page.locator("#csv-confirm-accept").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-colcount') === '7'")
            page.locator("#csv-undo-button").click()
            page.wait_for_function("() => document.querySelector('#csv-grid')?.getAttribute('aria-colcount') === '8'")

            if screenshots:
                data_cell(page, 1, 0).click(button="right")
                menu.wait_for(state="visible")
                page.screenshot(path=str(screenshots / "csv-cell-context-menu-desktop-light.png"))
                page.keyboard.press("Escape")

            # Native form dialog, inline validation, and replace command.
            page.locator("#csv-find-button").click()
            require(page.locator("#csv-find-dialog").get_attribute("open") is not None,
                    "Find dialog did not open")
            page.locator("#csv-replace-all-button").click()
            require(page.locator("#csv-find-dialog").get_attribute("open") is not None,
                    "Empty find submission closed the dialog")
            require(page.locator("#csv-find-error").is_visible(),
                    "Empty find submission did not show an inline error")
            require(page.locator("#csv-find-text").get_attribute("aria-invalid") == "true",
                    "Invalid find input was not exposed to assistive technology")
            page.locator("#csv-find-text").fill("03-04")
            require(page.locator("#csv-find-error").is_hidden(),
                    "Find error did not clear after entering a value")
            require(page.locator("#csv-find-text").get_attribute("aria-invalid") is None,
                    "Find input remained marked invalid after correction")
            page.locator("#csv-replace-text").fill("03-05")
            require("1 matching cell" in page.locator("#csv-find-count").inner_text(),
                    "Find count differs")
            page.locator("#csv-replace-all-button").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='3']`)?.innerText === '03-05'"
            )
            page.locator("#csv-undo-button").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='3']`)?.innerText === '03-04'"
            )

            # Header interpretation is explicit and does not edit bytes.
            open_more_menu(page)
            page.locator("#csv-header-mode").select_option("data")
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='0'][data-column-index='0']`)?.innerText === 'employee_id'"
            )
            open_more_menu(page)
            page.locator("#csv-header-mode").select_option("headers")
            page.wait_for_function(
                "() => !document.querySelector(`.tabulator-cell[data-document-row-index='0'][data-column-index='0']`)"
            )

            # A pristine custom file downloads byte-for-byte, including BOM and no final newline.
            open_another(page)
            exact = b"\xef\xbb\xbfid,value\r\n0001,03-04"
            upload(page, "exact.csv", "text/csv", exact)
            wait_for_grid(page)

            # The second independent parser pass is a real download gate, not
            # only a diagnostic. A synthetic disagreement must stop before the
            # application creates or clicks a download anchor.
            page.evaluate("""() => {
                window.__marinCsvOriginalPapaParse = window.Papa.parse;
                window.__marinCsvDownloadClicks = 0;
                document.addEventListener('click', event => {
                  if (event.target instanceof HTMLAnchorElement && event.target.hasAttribute('download')) {
                    window.__marinCsvDownloadClicks += 1;
                  }
                }, true);
                window.Papa.parse = () => ({data: [['different']], errors: []});
            }""")
            page.locator("#csv-download-button").click()
            page.locator("#csv-mode-notice").wait_for(state="visible")
            require("Download was stopped" in page.locator("#csv-mode-notice").inner_text(),
                    "Pre-download parser disagreement did not produce a blocking error")
            require(page.evaluate("window.__marinCsvDownloadClicks") == 0,
                    "Download began despite pre-download parser disagreement")
            page.evaluate("() => { window.Papa.parse = window.__marinCsvOriginalPapaParse; return true; }")

            with page.expect_download() as exact_download_info:
                page.locator("#csv-download-button").click()
            exact_download = exact_download_info.value
            require(exact_download.suggested_filename == "exact-copy.csv", "Untouched filename differs")
            require(download_bytes(exact_download) == exact, "Untouched file was not byte-identical")

            # TSV detection, literal comma handling, paste, focus restoration, and undo.
            open_another(page)
            upload(page, "sample.tsv", "text/tab-separated-values", b"id\tvalue\tnote\n001\t03-04\ta,b\n")
            wait_for_grid(page)
            require(page.locator("#csv-delimiter-select").input_value() == "\t", "TSV delimiter was not detected")
            require(cell_text(page, 1, 2) == "a,b", "Literal comma in TSV was altered")
            dispatch_paste(page, 1, 0, "009\t04-05\n")
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='0']`)?.innerText === '009'"
            )
            require(cell_text(page, 1, 1) == "04-05", "TSV paste second cell differs")
            page.wait_for_function("() => document.querySelector('#app-status-message')?.textContent.includes('2 cells pasted')")
            page.locator("#csv-undo-button").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='0']`)?.innerText === '001'"
            )

            # Semicolon detection preserves literal commas and quoted semicolons.
            open_another(page)
            upload(page, "regional.csv", "text/csv",
                   b'id;amount;note\n001;1,23;"contains;semicolon"\n')
            wait_for_grid(page)
            require(page.locator("#csv-delimiter-select").input_value() == ";",
                    "Semicolon delimiter was not detected")
            require(cell_text(page, 1, 1) == "1,23", "Literal comma in semicolon data was altered")
            require(cell_text(page, 1, 2) == "contains;semicolon",
                    "Quoted semicolon field was altered")

            # Pipe detection, editing, quoting, filename retention, and the
            # generic download label operate through the production UI.
            open_another(page)
            upload(page, "records.psv", "text/plain",
                   b'id|value|note\n001|03-04|"contains | a pipe"\n')
            wait_for_grid(page)
            require(page.locator("#csv-delimiter-select").input_value() == "|",
                    "Pipe delimiter was not detected")
            require(cell_text(page, 1, 2) == "contains | a pipe", "Quoted pipe field was altered")
            require(page.locator("#csv-download-button").inner_text() == "Download file",
                    "Editable alternate-delimiter download label is misleading")
            edit_cell(page, 1, 1, "changed|value")
            open_more_menu(page)
            require(page.locator("#csv-delimiter-select").is_disabled(),
                    "Delimiter remained changeable after a document edit")
            page.keyboard.press("Escape")
            with page.expect_download() as pipe_download_info:
                page.locator("#csv-download-button").click()
            pipe_download = pipe_download_info.value
            require(pipe_download.suggested_filename == "records-edited.psv",
                    "Pipe-delimited edited filename differs")
            require(b'001|"changed|value"|"contains | a pipe"\n' in download_bytes(pipe_download),
                    "Pipe-delimited edited output was not quoted correctly")
            if screenshots:
                page.screenshot(path=str(screenshots / "csv-pipe-editor-desktop-light.png"), full_page=True)

            # Ambiguous files receive a warning and can be explicitly reparsed
            # through the existing simple delimiter select before editing.
            open_another(page)
            upload(page, "ambiguous.txt", "text/plain", b"a,b;c\n1,2;3\n")
            wait_for_grid(page)
            require(page.locator("#csv-delimiter-select").input_value() == ",",
                    "Ambiguous delimiter fallback changed")
            require("Check the delimiter" in page.locator("#csv-warnings").text_content(),
                    "Ambiguous delimiter warning is missing")
            open_more_menu(page)
            page.locator("#csv-delimiter-select").select_option(";")
            page.wait_for_function(
                "() => document.querySelector('#csv-delimiter-select')?.value === ';' && document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='0']`)?.innerText === '1,2'"
            )
            require(cell_text(page, 1, 0) == "1,2", "Manual semicolon override did not reparse original bytes")

            # Invalid UTF-8 produces a visible error rather than repaired data.
            open_another(page)
            page.locator("#csv-file-input").set_input_files({
                "name": "invalid.csv",
                "mimeType": "text/csv",
                "buffer": bytes([0xC3, 0x28]),
            })
            page.locator("#csv-open-error").wait_for(state="visible")
            require("CSV UTF-8" in page.locator("#csv-open-error").inner_text(),
                    "Invalid-encoding error differs")
            require(page.locator("#csv-editor-view").is_hidden(), "Editor opened invalid UTF-8 data")

            # Independent-parser disagreement blocks editing and download.
            page.locator("#csv-file-input").set_input_files({
                "name": "parser-disagreement.csv",
                "mimeType": "text/csv",
                "buffer": b'a,b\n1,"x"y\n',
            })
            page.locator("#csv-editor-view").wait_for(state="visible")
            page.locator("#csv-mode-notice").wait_for(state="visible")
            require("Papa Parse" in page.locator("#csv-mode-notice").inner_text(),
                    "Parser-disagreement message is missing")
            require(page.locator("#csv-download-button").is_disabled(),
                    "Download remained enabled after parser disagreement")
            require(page.locator("#csv-grid").get_attribute("inert") is not None,
                    "Grid was not disabled after parser disagreement")

            # User-controlled headers and values must never become executable HTML.
            open_another(page)
            page.evaluate("window.__marinCsvXss = 0")
            malicious = (
                b'<img src=x onerror="window.__marinCsvXss=1">,safe\n'
                b'<script>window.__marinCsvXss=2</script>,ok\n'
            )
            upload(page, "literal-markup.csv", "text/csv", malicious)
            wait_for_grid(page)
            page.wait_for_timeout(100)
            require(page.evaluate("window.__marinCsvXss") == 0, "CSV markup executed as script")
            require(page.locator(".tabulator-col-title img").count() == 0,
                    "CSV header markup created an image element")
            require(page.locator('.tabulator-col[tabulator-field="c0"] .tabulator-col-title').inner_text()
                    == '<img src=x onerror="window.__marinCsvXss=1">',
                    "CSV header markup was not rendered literally")
            require(data_cell(page, 1, 0).locator("script").count() == 0,
                    "CSV cell markup created a script element")
            require(cell_text(page, 1, 0) == "<script>window.__marinCsvXss=2</script>",
                    "CSV cell markup was not rendered literally")
            data_cell(page, 1, 0).click(button="right")
            markup_menu = page.get_by_role("menu", name="Field actions")
            markup_menu.wait_for(state="visible")
            require(markup_menu.locator("img, script").count() == 0,
                    "CSV field markup created executable elements inside the context menu")
            require("window.__marinCsvXss" not in markup_menu.inner_text(),
                    "The context menu unnecessarily reproduced the selected CSV value")
            page.keyboard.press("Escape")

            # Paged editing keeps only a bounded physical slice in Tabulator while
            # edits and downloads continue to address the full preservation model.
            open_another(page)
            paged_payload = (
                "id,value\n"
                + "\n".join(f"{index},v{index}" for index in range(5_001))
                + "\n"
            ).encode("utf-8")
            upload(page, "paged.csv", "text/csv", paged_payload)
            wait_for_grid(page)
            require("Paged editing mode" in page.locator("#csv-large-mode-notice").inner_text(),
                    "Paged-mode notice is missing")
            require("Sorting and filtering are unavailable" in page.locator("#csv-grid-help").inner_text(),
                    "Paged-mode grid help is misleading")
            require(page.locator("#csv-grid-pager").is_visible(), "Paged-mode controls are hidden")
            require(page.locator("#csv-page-input").input_value() == "1", "Paged mode did not start on page 1")
            require(page.locator(".tabulator-row[role='row']").count() <= 1_000,
                    "Paged mode rendered more than its bounded data-row slice")
            require(page.locator("#csv-grid .tabulator-tableholder").evaluate(
                "el => el.clientHeight < el.scrollHeight"),
                    "Paged grid did not activate its bounded internal vertical scroll region")
            require(page.locator("#csv-grid").evaluate(
                "el => el.getBoundingClientRect().height >= 240 && el.getBoundingClientRect().bottom <= innerHeight + 2"),
                    "Paged grid did not use a bounded viewport-aware height")
            require(page.locator("#csv-filter-input").is_disabled(),
                    "View filtering remained enabled in paged mode")
            require(page.locator("#csv-grid").get_attribute("aria-readonly") == "false",
                    "Paged editing was incorrectly exposed as read-only")
            data_cell(page, 1, 1).click(button="right")
            page.get_by_role("menu", name="Field actions").wait_for(state="visible")
            require(page.locator("#csv-context-edit").is_enabled(),
                    "Paged mode disabled field editing in the context menu")
            require(page.locator("#csv-context-clear").is_enabled(),
                    "Paged mode disabled clearing a nonblank field")
            require(page.locator("#csv-context-filter").is_disabled(),
                    "Paged mode exposed unsupported exact-value filtering")
            require(page.locator("#csv-context-delete-row").is_enabled(),
                    "Paged mode disabled row deletion")
            require(page.locator("#csv-context-delete-column").is_enabled(),
                    "Paged mode disabled column deletion")
            page.keyboard.press("Escape")
            if screenshots:
                page.screenshot(path=str(screenshots / "csv-paged-desktop-light.png"), full_page=True)
            page.locator("#csv-next-page-button").click()
            page.wait_for_function("() => document.querySelector('#csv-page-input')?.value === '2'")
            page.locator("#csv-operation-status").wait_for(state="hidden")
            page.locator(".tabulator-cell[data-document-row-index='1001'][data-column-index='0']").wait_for()
            require(cell_text(page, 1001, 0) == "1000",
                    "Page 2 did not retain physical document coordinates")
            edit_cell(page, 1001, 1, "changed-page-two")
            with page.expect_download() as paged_download_info:
                page.locator("#csv-download-button").click()
            paged_download = paged_download_info.value
            require(paged_download.suggested_filename == "paged-edited.csv",
                    "Paged edited download name differs")
            require(b"1000,changed-page-two\n" in download_bytes(paged_download),
                    "Paged edit did not reach the full-file download")
            page.locator("#csv-undo-button").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1001'][data-column-index='1']`)?.innerText === 'v1000'"
            )

            # A low-byte but extremely row-dense file must still be profiled before
            # materialization and opened as a bounded exact-copy preview.
            open_another(page)
            preview_payload = ("id\n" + "x\n" * 250_001).encode("utf-8")
            upload(page, "tiny-many-rows.csv", "text/csv", preview_payload)
            wait_for_grid(page)
            require("Read-only preview mode" in page.locator("#csv-large-mode-notice").inner_text(),
                    "Read-only preview notice is missing")
            require(page.locator("#csv-grid-help").inner_text().startswith("Read-only preview."),
                    "Preview grid help implies that editing is available")
            require(page.locator("#csv-grid").get_attribute("aria-readonly") == "true",
                    "Preview grid lacks its read-only state")
            require(page.locator("#csv-download-button").inner_text() == "Download exact copy",
                    "Preview download action does not identify exact-copy behavior")
            require(page.locator("#csv-add-row-button").is_disabled(),
                    "Preview mode left structural editing enabled")
            require(page.locator("#csv-find-button").is_disabled(),
                    "Preview mode left find and replace enabled")
            require(page.locator("#csv-filter-input").is_disabled(),
                    "Preview mode left filtering enabled")
            require(page.locator("#csv-grid-pager").is_hidden(),
                    "Read-only preview should not imply that omitted rows can be paged")
            require("Papa Parse not needed for exact-copy preview" in page.locator("#csv-file-metadata").text_content(),
                    "Preview parser metadata is misleading")
            require(page.locator(".tabulator-cell[data-document-row-index]").count() <= 1_000,
                    "Preview rendered more than its retained row bound")
            data_cell(page, 1, 0).click(button="right")
            require(page.locator("#csv-cell-context-menu").is_hidden(),
                    "Read-only preview replaced the browser menu with unusable field actions")
            if screenshots:
                page.screenshot(path=str(screenshots / "csv-preview-desktop-light.png"), full_page=True)
            with page.expect_download() as preview_download_info:
                page.locator("#csv-download-button").click()
            preview_download = preview_download_info.value
            require(preview_download.suggested_filename == "tiny-many-rows-copy.csv",
                    "Preview copy filename differs")
            require(download_bytes(preview_download) == preview_payload,
                    "Read-only preview download was not byte-identical")
            with page.expect_download() as preview_second_download_info:
                page.locator("#csv-download-button").click()
            require(preview_second_download_info.value.suggested_filename == "tiny-many-rows-copy-2.csv",
                    "Repeated preview download did not receive a new filename")

            require(not problems, f"Marin CSV browser errors: {problems}")
            context.close()

            # Narrow dark-mode review includes the real grid and preserves an internal scroll region.
            mobile = browser.new_context(
                viewport={"width": 390, "height": 844},
                color_scheme="dark",
                accept_downloads=True,
            )
            mobile_problems, _ = configure(mobile, base_url)
            page = fixture_page(mobile, None, base_url) if in_memory else mobile.new_page()
            if not in_memory:
                page.goto(base_url, wait_until="networkidle")
            ready(page)
            page.locator("#csv-sample-button").click()
            page.locator("#csv-editor-view").wait_for(state="visible")
            wait_for_grid(page)
            require(page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
                    "Narrow page shell has horizontal overflow")
            require(page.locator("#csv-grid .tabulator-tableholder").evaluate(
                "el => el.scrollWidth > el.clientWidth"), "Grid does not retain its own horizontal scroll region")
            if screenshots:
                page.screenshot(path=str(screenshots / "csv-editor-mobile-dark.png"), full_page=True)
                mobile_context_target = data_cell(page, 1, 0)
                mobile_context_target.scroll_into_view_if_needed()
                page.wait_for_timeout(100)
                mobile_context_target.click(button="right")
                page.get_by_role("menu", name="Field actions").wait_for(state="visible")
                page.screenshot(path=str(screenshots / "csv-cell-context-menu-mobile-dark.png"))
                page.keyboard.press("Escape")
            require(not mobile_problems, f"Mobile Marin CSV browser errors: {mobile_problems}")
            mobile.close()

            if screenshots:
                compact = browser.new_context(
                    viewport={"width": 320, "height": 800},
                    color_scheme="light",
                    accept_downloads=True,
                )
                compact_problems, _ = configure(compact, base_url)
                page = fixture_page(compact, None, base_url) if in_memory else compact.new_page()
                if not in_memory:
                    page.goto(base_url, wait_until="networkidle")
                ready(page)
                page.locator("#csv-sample-button").click()
                page.locator("#csv-editor-view").wait_for(state="visible")
                wait_for_grid(page)
                require(page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
                        "320-pixel light-mode page has horizontal overflow")
                page.screenshot(path=str(screenshots / "csv-editor-mobile-320-light.png"), full_page=True)
                require(not compact_problems,
                        f"Compact Marin CSV browser errors: {compact_problems}")
                compact.close()
        finally:
            browser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshots", type=Path, help="Optional review screenshot directory")
    parser.add_argument("--in-memory", action="store_true",
                        help="Run a component fixture when HTTP browser navigation is unavailable")
    args = parser.parse_args()
    run(args.screenshots, args.in_memory)
    print("Marin CSV local-file workflow (CSV-6): PASS")
    if args.in_memory:
        print("NOT TESTED in this mode: HTTP asset loading, CSP enforcement, and deferred-script timing.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)

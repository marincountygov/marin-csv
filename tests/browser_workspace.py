#!/usr/bin/env python3
"""Exercise the CSV-3 spreadsheet workspace and expanded in-page layout."""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import sys

from browser_smoke import configure, fixture_page, no_overflow, ready, require, serve


def download_bytes(download) -> bytes:
    path = download.path()
    require(path is not None, "Browser did not retain the downloaded file")
    return Path(path).read_bytes()


def data_cell(page, row: int, column: int):
    return page.locator(
        f'.tabulator-cell[data-document-row-index="{row}"][data-column-index="{column}"]'
    )


def wait_for_grid(page) -> None:
    page.locator("#csv-grid.tabulator[role='grid']").wait_for(state="visible")
    data_cell(page, 1, 0).wait_for(state="visible")
    page.wait_for_function("document.querySelector('#csv-grid')?.getBoundingClientRect().height >= 200")


def open_sample(page) -> None:
    page.locator("#csv-sample-button").click()
    page.locator("#csv-editor-view").wait_for(state="visible")
    wait_for_grid(page)


def edit_cell(page, row: int, column: int, value: str) -> None:
    cell = data_cell(page, row, column)
    cell.dblclick()
    editor = cell.locator("textarea.csv-tabulator-editor")
    editor.wait_for(state="visible")
    editor.fill(value)
    editor.press("Enter")
    page.wait_for_function(
        "([row, column, expected]) => document.querySelector(`.tabulator-cell[data-document-row-index='${row}'][data-column-index='${column}']`)?.innerText === expected",
        arg=[row, column, value],
    )


def check_selected_cell_visibility(page, row: int, column: int, expected: str) -> None:
    """Selected values must not be hidden by Tabulator's range overlay.

    Tabulator's .tabulator-range-active overlay sits above cell text. An
    opaque app-defined background on that overlay obscures selected values,
    even though the DOM, accessible name, and editor retain the correct text.
    """
    cell = data_cell(page, row, column)
    cell.click()
    require(cell.inner_text() == expected,
            "Selection unexpectedly changed the displayed cell text")
    require(cell.get_attribute("aria-selected") == "true",
            "Cell was not marked selected")
    require(page.evaluate("""() => {
      const overlay = document.querySelector('#csv-grid .tabulator-range-overlay .tabulator-range-active');
      if (!overlay) return false;
      const color = getComputedStyle(overlay).backgroundColor;
      return color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
    }"""), "Tabulator's range overlay has an opaque background hiding selected cell text")
    cell.dblclick()
    editor = cell.locator("textarea.csv-tabulator-editor")
    editor.wait_for(state="visible")
    require(editor.input_value() == expected,
            "The existing field value is missing from the active editor")
    # The range overlay must remain transparent while the cell editor is open.
    require(page.evaluate("""() => {
      const overlay = document.querySelector('#csv-grid .tabulator-range-overlay .tabulator-range-active');
      if (!overlay) return false;
      const color = getComputedStyle(overlay).backgroundColor;
      return color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
    }"""), "Tabulator's range overlay hides the active cell editor")
    editor.press("Escape")
    editor.wait_for(state="hidden")
    require(data_cell(page, row, column).inner_text() == expected,
            "Canceling the editor changed the cell value")


def mode(page, expected: str) -> None:
    page.wait_for_function(
        "expected => document.body.dataset.workspaceMode === expected",
        arg=expected,
    )
    require(page.locator("body").get_attribute("data-workspace-mode") == expected,
            f"Workspace mode did not become {expected}")


def toggle_name(page, expected: str) -> None:
    require(page.locator("#csv-workspace-toggle").inner_text().strip() == expected,
            f"Workspace toggle label is not {expected!r}")


def wait_for_toggle_focus(page, transition: str) -> None:
    """Observe focus after the transition's layout and focus restoration frames.

    setWorkspaceMode updates its mode synchronously, then schedules resizing
    and focus on successive animation frames. Reading activeElement directly
    after the mode changes races that explicit keyboard-focus contract.
    """
    page.evaluate("""() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })""")
    page.wait_for_function(
        "() => document.activeElement === document.querySelector('#csv-workspace-toggle')"
    )
    require(page.locator("#csv-workspace-toggle").evaluate("el => el === document.activeElement"),
            f"{transition} did not restore focus to the workspace control")


def shell_state(page, hidden: bool) -> None:
    regions = {
        ".skip-link": ".skip-link",
        "marin-os-banner": ".marinos-banner",
        "marin-app-header": "header.app-header",
        "marin-app-footer": "footer.app-footer",
        "marin-app-feedback": ".app-feedback",
    }
    for selector, rendered_selector in regions.items():
        host = page.locator(selector)
        rendered = page.locator(rendered_selector)
        require(host.count() == 1, f"Missing App Shell host: {selector}")
        require(rendered.count() == 1, f"Missing rendered App Shell region: {rendered_selector}")
        require(host.get_attribute("hidden") is not None if hidden else host.get_attribute("hidden") is None,
                f"{selector} hidden state differs")
        require(host.evaluate("el => Boolean(el.inert)") is hidden,
                f"{selector} inert state differs")
        require(rendered.is_hidden() if hidden else rendered.is_visible(),
                f"{rendered_selector} rendered visibility differs")
    if hidden:
        require(page.evaluate("""() => {
          const selectors = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
          const hosts = ['marin-os-banner', 'marin-app-header', 'marin-app-footer', 'marin-app-feedback'];
          const descendants = hosts.flatMap(tag => [...document.querySelector(tag).querySelectorAll(selectors)]);
          const skip = document.querySelector('.skip-link');
          return descendants.every(element => !element.matches(':focus') && element.getClientRects().length === 0)
            && !skip.matches(':focus') && skip.getClientRects().length === 0;
        }"""), "Hidden App Shell regions expose a rendered or focused descendant")


def grid_metrics(page) -> dict:
    return page.evaluate("""() => {
      const grid = document.querySelector('#csv-grid');
      const shell = document.querySelector('#csv-workspace-shell');
      const rect = grid.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        gridWidth: rect.width,
        gridHeight: rect.height,
        gridTop: rect.top,
        gridBottom: rect.bottom,
        shellWidth: shellRect.width,
        bodyMode: document.body.dataset.workspaceMode,
        documentHeight: document.documentElement.scrollHeight,
      };
    }""")


def run(screenshots: Path | None = None, in_memory: bool = False) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("CSV-3 browser tests require Python Playwright and Chromium.") from error

    with serve() as base_url, sync_playwright() as pw:
        executable = (shutil.which("chromium") or shutil.which("chromium-browser")
                      or shutil.which("google-chrome"))
        options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        if executable:
            options["executable_path"] = executable
        browser = pw.chromium.launch(**options)
        try:
            if screenshots:
                screenshots.mkdir(parents=True, exist_ok=True)

            context = browser.new_context(
                viewport={"width": 1440, "height": 1000},
                color_scheme="light",
                accept_downloads=True,
            )
            problems, _ = configure(context, base_url)
            page = fixture_page(context, None, base_url) if in_memory else context.new_page()
            if not in_memory:
                page.goto(base_url, wait_until="networkidle")
            ready(page)
            open_sample(page)

            # Normal mode is a full-width spreadsheet workspace while retaining
            # the complete App Shell and footer.
            mode(page, "normal")
            shell_state(page, False)
            toggle_name(page, "Expand workspace")
            require(page.get_by_role("toolbar", name="Marin CSV commands").count() == 1,
                    "Spreadsheet command toolbar is missing")
            require(page.locator("#csv-file-heading").inner_text() == "marin-csv-sample.csv",
                    "Current filename is not visible")
            require(page.locator("#csv-workspace-toggle").get_attribute("aria-expanded") == "false",
                    "Normal workspace toggle has incorrect ARIA state")
            require(page.locator("#csv-grid").get_attribute("aria-label")
                    == "marin-csv-sample.csv data editor", "Grid accessible name differs")
            normal = grid_metrics(page)
            require(normal["shellWidth"] >= normal["viewportWidth"] * 0.94,
                    "Normal workspace does not use substantially the full viewport width")
            require(normal["gridWidth"] >= normal["viewportWidth"] * 0.94,
                    "Normal grid remains constrained like a conventional content table")
            require(normal["gridHeight"] >= 240, "Normal grid does not retain a usable height")
            no_overflow(page)
            check_selected_cell_visibility(page, 1, 0, "000123")
            if screenshots:
                page.screenshot(path=str(screenshots / "csv-workspace-normal-light.png"), full_page=True)

            # Expanding is one explicit application state and does not use the
            # browser Fullscreen API.
            fullscreen_calls = page.evaluate("""() => {
              window.__csvFullscreenCalls = 0;
              const prototype = Element.prototype;
              const original = prototype.requestFullscreen;
              try {
                Object.defineProperty(prototype, 'requestFullscreen', {
                  configurable: true,
                  value() { window.__csvFullscreenCalls += 1; return Promise.resolve(); },
                });
              } catch (_) {}
              return Boolean(original);
            }""")
            _ = fullscreen_calls  # Browser support is not required; invocation count is.
            toggle = page.locator("#csv-workspace-toggle")
            toggle.focus()
            page.keyboard.press("Enter")
            mode(page, "expanded")
            toggle_name(page, "Collapse workspace")
            require(toggle.get_attribute("aria-expanded") == "true",
                    "Expanded workspace toggle has incorrect ARIA state")
            wait_for_toggle_focus(page, "Expand transition")
            require(page.evaluate("window.__csvFullscreenCalls") == 0,
                    "Expanded workspace invoked the Fullscreen API")
            shell_state(page, True)
            require(page.locator(".csv-workspace-header").is_visible(),
                    "Local Marin CSV identity is missing in expanded mode")
            require(page.locator("#csv-file-heading").is_visible(),
                    "Filename is missing in expanded mode")
            require(page.get_by_role("toolbar", name="Marin CSV commands").is_visible(),
                    "Toolbar is missing in expanded mode")
            require(page.locator("#csv-grid").is_visible(), "Grid is missing in expanded mode")
            expanded = grid_metrics(page)
            require(expanded["shellWidth"] >= expanded["viewportWidth"] - 12,
                    "Expanded workspace does not consume the available viewport width")
            require(expanded["gridHeight"] > normal["gridHeight"],
                    "Expanded workspace did not give the grid more vertical space")
            require(expanded["gridBottom"] <= expanded["viewportHeight"] + 1,
                    "Expanded grid extends beyond the usable viewport")
            no_overflow(page)
            check_selected_cell_visibility(page, 1, 1, "00901")
            if screenshots:
                page.screenshot(path=str(screenshots / "csv-workspace-expanded-light.png"), full_page=True)

            # Resize in expanded mode must update Tabulator without reparsing or
            # losing the loaded document.
            expanded_height = expanded["gridHeight"]
            page.set_viewport_size({"width": 1180, "height": 820})
            page.wait_for_function(
                "before => Math.abs(document.querySelector('#csv-grid').getBoundingClientRect().height - before) > 20",
                arg=expanded_height,
            )
            resized_expanded = grid_metrics(page)
            require(resized_expanded["gridBottom"] <= resized_expanded["viewportHeight"] + 1,
                    "Expanded grid did not resize into the smaller viewport")
            require(page.locator("#csv-file-heading").inner_text() == "marin-csv-sample.csv",
                    "Resize lost the loaded file")

            # Escape precedence: transient menu first, then dialog, then grid
            # editing, and only then the expanded workspace itself.
            more_summary = page.locator("#csv-more-menu > summary")
            more_summary.focus()
            page.keyboard.press("Enter")
            page.locator("#csv-more-menu[open]").wait_for()
            page.keyboard.press("Escape")
            require(page.locator("#csv-more-menu").get_attribute("open") is None,
                    "Escape did not close the open toolbar menu")
            mode(page, "expanded")
            require(more_summary.evaluate("el => el === document.activeElement"),
                    "Toolbar menu Escape did not restore focus to its summary")

            page.locator("#csv-find-button").click()
            page.locator("#csv-find-dialog[open]").wait_for()
            page.keyboard.press("Escape")
            page.locator("#csv-find-dialog").wait_for(state="hidden")
            mode(page, "expanded")

            editor_cell = data_cell(page, 1, 0)
            original_value = editor_cell.inner_text()
            editor_cell.dblclick()
            editor = editor_cell.locator("textarea.csv-tabulator-editor")
            editor.wait_for(state="visible")
            editor.fill("temporary")
            editor.press("Escape")
            editor.wait_for(state="hidden")
            require(data_cell(page, 1, 0).inner_text() == original_value,
                    "Escape from a grid editor committed an unintended value")
            mode(page, "expanded")

            # With no higher-priority interaction, Escape collapses the workspace.
            page.keyboard.press("Escape")
            mode(page, "normal")
            toggle_name(page, "Expand workspace")
            wait_for_toggle_focus(page, "Collapse by Escape")
            shell_state(page, False)

            # The same edit must serialize identically in normal and expanded
            # modes, and state must remain intact through both transitions.
            edit_cell(page, 1, 0, "000777")
            with page.expect_download() as normal_download_info:
                page.locator("#csv-download-button").click()
            normal_bytes = download_bytes(normal_download_info.value)
            page.locator("#csv-undo-button").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='0']`)?.innerText === '000123'"
            )

            toggle.focus()
            page.keyboard.press("Enter")
            mode(page, "expanded")
            edit_cell(page, 1, 0, "000777")
            toggle.focus()
            page.keyboard.press("Enter")
            mode(page, "normal")
            require(data_cell(page, 1, 0).inner_text() == "000777",
                    "Workspace transition lost the edited cell value")
            with page.expect_download() as expanded_download_info:
                page.locator("#csv-download-button").click()
            expanded_bytes = download_bytes(expanded_download_info.value)
            require(expanded_bytes == normal_bytes,
                    "Normal and expanded workspace edits serialized differently")
            page.locator("#csv-undo-button").click()
            page.wait_for_function(
                "() => document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='0']`)?.innerText === '000123'"
            )

            # Normal-mode viewport resizing must also update the grid and retain
            # the ordinary App Shell.
            normal_before_resize = grid_metrics(page)["gridHeight"]
            page.set_viewport_size({"width": 1440, "height": 1100})
            page.wait_for_function(
                "before => Math.abs(document.querySelector('#csv-grid').getBoundingClientRect().height - before) > 20",
                arg=normal_before_resize,
            )
            shell_state(page, False)
            no_overflow(page)

            # A fresh application instance always starts in normal mode; the UI
            # state is not stored in the document, URL, cookie, or localStorage.
            page = fixture_page(context, page, base_url) if in_memory else context.new_page()
            if not in_memory:
                page.goto(base_url, wait_until="networkidle")
            ready(page)
            open_sample(page)
            mode(page, "normal")
            require(page.locator("#csv-workspace-toggle").get_attribute("aria-expanded") == "false",
                    "A fresh page persisted expanded workspace mode")
            shell_state(page, False)
            require(not problems, f"CSV-3 workspace browser errors: {problems}")
            context.close()

            # Responsive dark-mode coverage keeps every command reachable and
            # the grid's horizontal overflow inside the workspace.
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
            open_sample(page)
            no_overflow(page)
            require(page.locator("#csv-workspace-toggle").is_visible(),
                    "Expand workspace is unavailable at the mobile viewport")
            require(page.locator("#csv-more-menu > summary").is_visible(),
                    "Responsive More menu is unavailable")
            page.locator("#csv-workspace-toggle").click()
            mode(page, "expanded")
            require(page.locator("#csv-workspace-toggle").is_visible(),
                    "Collapse workspace is unavailable at the mobile viewport")
            no_overflow(page)
            check_selected_cell_visibility(page, 1, 0, "000123")
            require(page.locator("#csv-grid .tabulator-tableholder").evaluate(
                "el => el.scrollWidth > el.clientWidth"),
                "Responsive grid does not retain its own horizontal scroll region")
            if screenshots:
                page.screenshot(path=str(screenshots / "csv-workspace-expanded-mobile-dark.png"), full_page=True)
            require(not mobile_problems, f"Mobile CSV-3 workspace browser errors: {mobile_problems}")
            mobile.close()
        finally:
            browser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshots", type=Path, help="Optional review screenshot directory")
    parser.add_argument("--in-memory", action="store_true",
                        help="Run a component fixture when HTTP browser navigation is unavailable")
    args = parser.parse_args()
    run(args.screenshots, args.in_memory)
    print("Marin CSV workspace architecture (CSV-3): PASS")
    if args.in_memory:
        print("NOT TESTED in this mode: HTTP asset loading, CSP enforcement, worker startup, and defer timing.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)

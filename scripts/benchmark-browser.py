#!/usr/bin/env python3
"""Measure representative Marin CSV grid interactions in a real Chromium runtime.

The default mode uses the repository's in-memory component fixture because some
managed environments block local HTTP navigation. Pass --http to exercise the
normal origin and same-origin parsing worker where policy permits it.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sys
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
if str(TESTS) not in sys.path:
    sys.path.insert(0, str(TESTS))

from browser_smoke import configure, fixture_page, ready, serve  # noqa: E402


def milliseconds(start: float) -> float:
    return round((perf_counter() - start) * 1000, 1)


def wait_for_grid(page) -> None:
    page.locator("#csv-editor-view").wait_for(state="visible")
    page.locator("#csv-grid.tabulator[role='grid']").wait_for(state="visible")
    page.locator(".tabulator-cell[data-document-row-index][data-column-index]").first.wait_for()
    page.locator("#csv-operation-status").wait_for(state="hidden")


def upload(page, filename: str, payload: bytes) -> float:
    started = perf_counter()
    page.locator("#csv-file-input").set_input_files({
        "name": filename,
        "mimeType": "text/csv",
        "buffer": payload,
    })
    wait_for_grid(page)
    return milliseconds(started)


def standard_payload(rows: int = 1_000, columns: int = 10) -> bytes:
    header = ",".join(f"column_{index + 1}" for index in range(columns))
    records = []
    for index in range(rows, 0, -1):
        values = [f"{index:06d}"]
        values.extend(f"r{index}-c{column}" for column in range(2, columns + 1))
        if index == 999:
            values[-1] = "needle-999"
        records.append(",".join(values))
    return (header + "\n" + "\n".join(records) + "\n").encode("utf-8")


def paged_payload(rows: int = 10_000, columns: int = 10) -> bytes:
    header = ",".join(f"column_{index + 1}" for index in range(columns))
    records = []
    for index in range(rows):
        values = [str(index)] + [f"r{index}-c{column}" for column in range(2, columns + 1)]
        records.append(",".join(values))
    return (header + "\n" + "\n".join(records) + "\n").encode("utf-8")


def preview_payload(rows: int = 250_001) -> bytes:
    return ("id\n" + "x\n" * rows).encode("utf-8")


def benchmark_standard(page) -> dict:
    payload = standard_payload()
    open_ms = upload(page, "browser-standard.csv", payload)

    cell = page.locator(".tabulator-cell[data-document-row-index='1'][data-column-index='1']")
    started = perf_counter()
    cell.dispatch_event("dblclick")
    editor = cell.locator("textarea.csv-tabulator-editor")
    editor.wait_for()
    editor.fill("edited-value")
    editor.press("Enter")
    page.wait_for_function(
        "document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='1']`)?.innerText === 'edited-value'"
    )
    edit_ms = milliseconds(started)

    started = perf_counter()
    page.locator('.tabulator-col[tabulator-field="c0"] .tabulator-col-title').click()
    page.wait_for_function(
        "document.querySelector('.tabulator-row .tabulator-cell[data-column-index=\"0\"]')?.innerText === '000001'"
    )
    sort_ms = milliseconds(started)

    started = perf_counter()
    page.locator("#csv-filter-input").fill("needle-999")
    page.wait_for_function(
        "document.querySelectorAll('.tabulator-row[role=\"row\"]').length === 1"
    )
    filter_ms = milliseconds(started)

    return {
        "case": "standard-1k-x-10",
        "sourceBytes": len(payload),
        "mode": "standard",
        "rows": 1_000,
        "columns": 10,
        "openToUsableGridMs": open_ms,
        "editCommitMs": edit_ms,
        "sortMs": sort_ms,
        "filterMs": filter_ms,
        "pageChangeMs": None,
    }


def benchmark_paged(page) -> dict:
    payload = paged_payload()
    open_ms = upload(page, "browser-paged.csv", payload)

    cell = page.locator(".tabulator-cell[data-document-row-index='1'][data-column-index='1']")
    started = perf_counter()
    cell.dispatch_event("dblclick")
    editor = cell.locator("textarea.csv-tabulator-editor")
    editor.wait_for()
    editor.fill("edited-page-one")
    editor.press("Enter")
    page.wait_for_function(
        "document.querySelector(`.tabulator-cell[data-document-row-index='1'][data-column-index='1']`)?.innerText === 'edited-page-one'"
    )
    edit_ms = milliseconds(started)

    started = perf_counter()
    page.locator("#csv-next-page-button").click()
    page.wait_for_function("document.querySelector('#csv-page-input')?.value === '2'")
    page.locator("#csv-operation-status").wait_for(state="hidden")
    page.locator(".tabulator-cell[data-document-row-index='1001'][data-column-index='0']").wait_for()
    page_ms = milliseconds(started)

    return {
        "case": "paged-10k-x-10",
        "sourceBytes": len(payload),
        "mode": "paged",
        "rows": 10_000,
        "columns": 10,
        "openToUsableGridMs": open_ms,
        "editCommitMs": edit_ms,
        "sortMs": None,
        "filterMs": None,
        "pageChangeMs": page_ms,
    }


def benchmark_preview(page) -> dict:
    payload = preview_payload()
    open_ms = upload(page, "browser-preview.csv", payload)
    return {
        "case": "preview-250k-x-1",
        "sourceBytes": len(payload),
        "mode": "preview",
        "rows": 250_001,
        "columns": 1,
        "openToUsableGridMs": open_ms,
        "editCommitMs": None,
        "sortMs": None,
        "filterMs": None,
        "pageChangeMs": None,
    }


def format_ms(value) -> str:
    return "Not applicable" if value is None else f"{value:.1f} ms"


def format_mib(value: int) -> str:
    return f"{value / (1024 * 1024):.1f} MiB"


def markdown(report: dict) -> str:
    lines = [
        "# Marin CSV CSV-3 browser benchmark results",
        "",
        f"Generated: {report['generated']}",
        f"Browser: {report['environment']['browser']}",
        f"Execution path: {report['environment']['executionPath']}",
        "",
        "These measurements are comparative evidence from one constrained Chromium runtime. They are not universal limits or service-level guarantees.",
        "",
        "| Case | Source | Mode | Rows | Columns | Open to usable grid | Edit commit | Sort | Filter | Page change |",
        "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for item in report["cases"]:
        lines.append("| " + " | ".join([
            item["case"],
            format_mib(item["sourceBytes"]),
            item["mode"],
            f"{item['rows']:,}",
            f"{item['columns']:,}",
            format_ms(item["openToUsableGridMs"]),
            format_ms(item["editCommitMs"]),
            format_ms(item["sortMs"]),
            format_ms(item["filterMs"]),
            format_ms(item["pageChangeMs"]),
        ]) + " |")
    lines.append("")
    if report["environment"]["executionPath"] == "in-memory component fixture":
        lines.extend([
            "The in-memory fixture runs the real vendored Papa Parse and Tabulator code, but disables the same-origin Web Worker. Normal-origin worker startup and HTTP asset timing remain separate release checks.",
            "",
        ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--http", action="store_true", help="Use a normal local HTTP origin and same-origin worker")
    parser.add_argument("--json", type=Path, default=ROOT / "docs/csv-3-browser-benchmark-results.json")
    parser.add_argument("--markdown", type=Path, default=ROOT / "docs/csv-3-browser-benchmark-results.md")
    args = parser.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("Browser benchmarks require Python Playwright and Chromium.") from error

    in_memory = not args.http
    cases = []
    with serve() as base_url, sync_playwright() as pw:
        executable = (shutil.which("chromium") or shutil.which("chromium-browser")
                      or shutil.which("google-chrome"))
        options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        if executable:
            options["executable_path"] = executable
        browser = pw.chromium.launch(**options)
        browser_version = browser.version
        try:
            for benchmark in (benchmark_standard, benchmark_paged, benchmark_preview):
                context = browser.new_context(viewport={"width": 1440, "height": 1000})
                problems, _ = configure(context, base_url)
                page = fixture_page(context, None, base_url) if in_memory else context.new_page()
                if not in_memory:
                    page.goto(base_url, wait_until="networkidle")
                ready(page)
                cases.append(benchmark(page))
                if problems:
                    raise RuntimeError("; ".join(problems))
                context.close()
        finally:
            browser.close()

    report = {
        "schema": 1,
        "generated": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "environment": {
            "browser": f"Chromium {browser_version}",
            "executionPath": "normal local HTTP origin" if args.http else "in-memory component fixture",
        },
        "cases": cases,
    }
    args.json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    args.markdown.write_text(markdown(report), encoding="utf-8")
    print(args.markdown.read_text(encoding="utf-8"))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)

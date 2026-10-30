#!/usr/bin/env python3
"""Exercise Marin CSV shell integration over HTTP. External feeds are fixtures only."""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import re
from pathlib import Path
import shutil
import sys
from threading import Thread
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "/marin-csv-test/"
MANIFEST = json.loads((ROOT / "vendor/marinos/manifest.json").read_text(encoding="utf-8"))
SECURITY = json.loads((ROOT / "security.json").read_text(encoding="utf-8"))
CATALOG = [{"name": "Smoke Test App", "url": "https://marincountygov.github.io/smoke-test/"}]
COMMITS = [{
    "sha": "1234567890abcdef1234567890abcdef12345678",
    "html_url": "https://github.com/marincountygov/test-fixture/commit/1234567",
    "commit": {
        "message": "fix: shell integration smoke test\n\nTest fixture only.",
        "committer": {"date": "2026-01-01T12:00:00Z"},
    },
}]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        if not self.path.startswith(PREFIX):
            self.send_error(404)
            return
        # Only the project subpath works, catching accidental root-relative URLs.
        self.path = "/" + self.path[len(PREFIX):]
        super().do_GET()

    def log_message(self, *args) -> None:
        pass


@contextmanager
def serve():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}{PREFIX}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def configure(context, base_url: str) -> tuple[list[str], list[str]]:
    context.set_default_timeout(10000)
    context.set_default_navigation_timeout(15000)
    problems: list[str] = []
    external: list[str] = []
    origin = urlsplit(base_url).netloc

    def intercept(route) -> None:
        url = urlsplit(route.request.url)
        if url.netloc == origin:
            route.continue_()
        elif url.hostname == "marincountygov.github.io" and url.path == "/marin-os/catalog.json":
            external.append(route.request.url)
            route.fulfill(status=200, content_type="application/json", body=json.dumps(CATALOG),
                          headers={"Access-Control-Allow-Origin": "*"})
        elif url.hostname == "api.github.com" and url.path.endswith("/commits"):
            external.append(route.request.url)
            route.fulfill(status=200, content_type="application/json", body=json.dumps(COMMITS),
                          headers={"Access-Control-Allow-Origin": "*"})
        else:
            problems.append(f"Unexpected external request: {route.request.url}")
            route.abort()

    context.route("**/*", intercept)

    # When served from localhost, the shell reads the Accessibility score and Tech data from a
    # local MarinOS dev server (http://localhost:8935) instead of the deployed marin-os. The
    # app's CSP correctly blocks that origin, and the shell shows its "couldn't load" message.
    # That is expected here, so these console messages are not app errors.
    local_dev_data = ("localhost:8935", "loadScore", "loadTech")

    def observe(page) -> None:
        page.on("pageerror", lambda error: problems.append(str(error)))
        page.on("console", lambda msg: problems.append(f"console {msg.type}: {msg.text}")
                if msg.type in ("error", "warning") and not any(t in msg.text for t in local_dev_data) else None)
        page.on("response", lambda response: problems.append(f"HTTP {response.status}: {response.url}")
                if response.status >= 400 else None)

    context.on("page", observe)
    return problems, external


def ready(page) -> None:
    page.wait_for_function("v => window.MarinAppShell?.version === v", arg=MANIFEST["shellVersion"])
    page.evaluate("document.fonts.ready")


def route_is(page, key: str) -> None:
    page.wait_for_function("key => !document.getElementById(key).hidden", arg=key)
    require(page.locator(f"#{key}").is_visible(), f"#{key} is not visible")
    require(page.locator("[data-tab-section]:visible").count() == 1, "Multiple routes are visible")


def no_overflow(page) -> None:
    require(page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
            "The page has horizontal overflow")


def fixture_page(context, current_page, url: str, *, javascript: bool = True, recovery_memory: bool = False):
    """Render the real source bytes without browser networking.

    This mode tests components, not HTTP loading or the home-link navigation.
    Every load uses a new page so the one-time shell cannot inherit old handlers.
    """
    if current_page:
        current_page.close()
    page = context.new_page()
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    # Component-only fixture: it inlines scripts/CSS, so it cannot enforce the app CSP.
    # The separate browser_security.py fixture keeps the exact policies for real CSP probes.
    html = re.sub(r'<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>', '', html, flags=re.I)
    html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.S | re.I)
    html = re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*>', '', html)
    css = (ROOT / "vendor/marinos/marinos.css").read_text(encoding="utf-8")
    for relative in MANIFEST["fontPathContract"]:
        font = (ROOT / "vendor/marinos" / relative).read_bytes()
        mime = "font/woff2" if relative.endswith(".woff2") else "font/ttf"
        css = css.replace(relative, f"data:{mime};base64,{base64.b64encode(font).decode('ascii')}")
    tabulator_css = (ROOT / "vendor/third-party/tabulator.min.css").read_text(encoding="utf-8")
    app_css = (ROOT / "assets/app.css").read_text(encoding="utf-8")
    html = html.replace("</head>", f"<style>{css}</style><style>{tabulator_css}</style><style>{app_css}</style></head>")
    page.set_content(html)
    if javascript:
        page.evaluate("""([catalog, security, commits, hash]) => {
          window.location.hash = hash;
          window.MarinCsvDisableWorker = true;
          window.__fixtureRequests = [];
          window.fetch = async (input) => {
            const url = String(input);
            window.__fixtureRequests.push(url);
            let body;
            if (url.includes('catalog.json')) body = catalog;
            else if (url.includes('security.json')) body = security;
            else if (url.includes('api.github.com')) body = commits;
            else throw new Error(`Unexpected fixture request: ${url}`);
            return new Response(JSON.stringify(body), {
              status: 200, headers: {'Content-Type': 'application/json'}
            });
          };
        }""", [CATALOG, SECURITY, COMMITS, urlsplit(url).fragment])
        for relative in (
            "vendor/marinos/marinos.js",
            "vendor/third-party/papaparse.min.js",
            "vendor/third-party/tabulator.min.js",
            "vendor/third-party/vendor-status.js",
            "assets/large-file-policy.js",
            "assets/csv-engine.js",
            "assets/document-loader.js",
            "assets/recovery-store.js",
            "assets/recovery-coordinator.js",
            "assets/workspace-state.js",
            "assets/tabulator-adapter.js",
            "assets/app.js",
        ):
            page.add_script_tag(content=(ROOT / relative).read_text(encoding="utf-8"))
            if recovery_memory and relative == "assets/recovery-store.js":
                page.evaluate("""() => {
                  const Base = window.MarinCsvRecoveryStore.MemoryRecoveryStore;
                  window.MarinCsvRecoveryStore.IndexedDbRecoveryStore = class TestRecoveryStore extends Base {
                    constructor(options = {}) {
                      super(options);
                      window.__marinCsvRecoveryStore = this;
                    }
                  };
                }""")
            if recovery_memory and relative == "assets/recovery-coordinator.js":
                page.evaluate("""() => {
                  const Base = window.MarinCsvRecovery.RecoveryCoordinator;
                  window.MarinCsvRecovery.RecoveryCoordinator = class TestRecoveryCoordinator extends Base {
                    constructor(options = {}) {
                      super(options);
                      window.__marinCsvRecoveryCoordinator = this;
                    }
                  };
                }""")
    return page


def run(screenshots: Path | None, in_memory: bool = False) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("Browser tests require Playwright for this Python interpreter.") from error

    with serve() as base_url, sync_playwright() as pw:
        executable = (shutil.which("chromium") or shutil.which("chromium-browser")
                      or shutil.which("google-chrome"))
        options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        if executable:
            options["executable_path"] = executable
        # Without a system executable, Playwright uses its installed Chromium.
        browser = pw.chromium.launch(**options)
        def navigate(context, page, url: str, *, javascript: bool = True):
            if in_memory:
                return fixture_page(context, page, url, javascript=javascript)
            page.goto(url, wait_until="networkidle")
            return page

        try:
            if screenshots:
                screenshots.mkdir(parents=True, exist_ok=True)
            context = browser.new_context(viewport={"width": 1440, "height": 960}, color_scheme="light")
            problems, external = configure(context, base_url)
            page = context.new_page()
            page = navigate(context, page, base_url)
            ready(page)
            route_is(page, "start")
            for selector in ("header.app-header", "footer.app-footer", ".marinos-banner",
                             ".app-feedback", ".skip-link", "#app-status-message"):
                require(page.locator(selector).count() == 1, f"Expected exactly one {selector}")
            require(page.locator("#main").get_attribute("tabindex") == "-1", "Main lacks focus support")
            require(page.locator("#app-status-message").get_attribute("aria-live") == "polite",
                    "Live status region is missing")
            require(page.locator("#app-nav a").all_text_contents() == ["About", "Updates"],
                    "Header navigation differs from the starter contract")
            require(page.locator(".app-footer__nav a").all_text_contents()
                    == ["About", "Security", "Accessibility", "Tech", "Updates"], "Footer links differ")
            require(page.locator(".app-footer__app-name").evaluate("el => el.tagName") == "SPAN",
                    "Footer app name should remain plain text")
            require(page.locator(".app-icon svg path").count() == 2, "Marin CSV file-spreadsheet icon did not render")
            home = page.locator(".app-title-row h1 > a.app-title__link[href='./']")
            require(home.count() == 1, "The app title is not the home link")
            require(page.locator(".app-title-row a[href='./']").count() == 1,
                    "Only the title text should link home (not the icon, subtitle, or status badge)")
            duplicates = page.evaluate("""() => {
              const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
              return ids.filter((id, index) => ids.indexOf(id) !== index);
            }""")
            require(not duplicates, f"Duplicate rendered IDs: {duplicates}")
            no_overflow(page)
            if screenshots:
                page.screenshot(path=str(screenshots / "desktop-light.png"), full_page=True)

            page.locator("#app-nav a[href='#about']").click()
            route_is(page, "about")
            require(page.locator("#about h2").count() == 1, "About heading duplicated")
            page.locator(".app-footer__nav a[href='#security']").click()
            route_is(page, "security")
            # The shell shows "Built for" (from marin.yml's audience) or the security profile label.
            page.locator("[data-security-content]").get_by_text(re.compile("Built for|Security profile")).first.wait_for()
            for control in SECURITY["publicSecurity"]["controls"]:
                page.locator("[data-security-content]").get_by_text(control).first.wait_for()
            page.locator(".app-footer__nav a[href='#accessibility']").click()
            route_is(page, "accessibility")
            require(page.locator("#accessibility h2").count() == 1, "Accessibility heading duplicated")
            page.locator("#app-nav a[href='#updates']").click()
            route_is(page, "updates")
            page.locator("[data-updates-list]").get_by_text("Shell integration smoke test", exact=True).wait_for()
            repo = page.locator("marin-app-info").get_attribute("repo")
            full_repo = repo if "/" in repo else f"marincountygov/{repo}"
            feed_requests = page.evaluate("window.__fixtureRequests") if in_memory else external
            require(any(urlsplit(url).path == f"/repos/{full_repo}/commits" for url in feed_requests),
                    "Updates used the wrong repository")
            page.go_back()
            route_is(page, "accessibility")
            page.go_forward()
            route_is(page, "updates")

            page.locator(".marinos-menu__toggle").click()
            page.locator("#marinos-menu-panel").get_by_text("Smoke Test App", exact=True).wait_for()
            page.keyboard.press("Escape")
            require(page.locator("#marinos-menu-panel").is_hidden(), "Catalog menu did not close")
            require(page.locator(".marinos-menu__toggle").evaluate("el => el === document.activeElement"),
                    "Catalog Escape did not restore focus")

            for key in ("start", "about", "security", "accessibility", "updates"):
                page = navigate(context, page, f"{base_url}#{key}")
                ready(page)
                route_is(page, key)
            page = navigate(context, page, f"{base_url}#unknown-route")
            ready(page)
            route_is(page, "start")

            if not in_memory:
                page.goto(f"{base_url}?example=1#about", wait_until="networkidle")
                ready(page)
                page.evaluate("window.__homeNavigationSentinel = true")
                page.locator("a.app-title__link").click()
                page.wait_for_url(base_url)
                ready(page)
                route_is(page, "start")
                require(page.evaluate("window.__homeNavigationSentinel === undefined"),
                        "Identity navigation did not reload the document")
            # Exercise the actual first keyboard stop, then the skip-link target.
            page.keyboard.press("Tab")
            require(page.locator(".skip-link").evaluate("el => el === document.activeElement"),
                    "Skip link was not the first keyboard stop")
            page.keyboard.press("Enter")
            require(page.locator("#main").evaluate("el => el === document.activeElement"),
                    "Skip link did not focus the main landmark")
            require(not problems, f"Desktop browser errors: {problems}")
            context.close()

            for width, mode in ((390, "dark"), (320, "light")):
                mobile_context = browser.new_context(viewport={"width": width, "height": 844}, color_scheme=mode)
                mobile_problems, _ = configure(mobile_context, base_url)
                mobile = mobile_context.new_page()
                mobile = navigate(mobile_context, mobile, base_url)
                ready(mobile)
                route_is(mobile, "start")
                no_overflow(mobile)
                require(mobile.locator("#app-nav").is_hidden(), "Mobile navigation starts open")
                mobile.locator("#menu-toggle").click()
                require(mobile.locator("#app-nav").is_visible(), "Mobile navigation did not open")
                require(mobile.locator("#menu-toggle").get_attribute("aria-expanded") == "true",
                        "Mobile menu has incorrect ARIA state")
                mobile.keyboard.press("Escape")
                require(mobile.locator("#app-nav").is_hidden(), "Escape did not close the mobile menu")
                require(mobile.locator("#menu-toggle").evaluate("el => el === document.activeElement"),
                        "Mobile menu focus was not restored")
                mobile.locator("#menu-toggle").click()
                mobile.locator("#app-nav a[href='#about']").click()
                route_is(mobile, "about")
                require(mobile.locator("#app-nav").is_hidden(), "Navigation did not close the mobile menu")
                no_overflow(mobile)
                if screenshots:
                    mobile.screenshot(path=str(screenshots / f"mobile-{width}-{mode}.png"), full_page=True)
                require(not mobile_problems, f"Mobile browser errors: {mobile_problems}")
                mobile_context.close()

            disabled = browser.new_context(java_script_enabled=False)
            disabled_problems, _ = configure(disabled, base_url)
            page = disabled.new_page()
            page = navigate(disabled, page, base_url, javascript=False)
            require(page.locator("noscript .app-alert").is_visible(), "JavaScript-disabled message is missing")
            require(not disabled_problems, f"JavaScript-disabled errors: {disabled_problems}")
            disabled.close()
        finally:
            browser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshots", type=Path, help="Optional directory for review screenshots")
    parser.add_argument("--in-memory", action="store_true",
                        help="Component-only fallback: no HTTP asset-loading or home-navigation test")
    args = parser.parse_args()
    run(args.screenshots, args.in_memory)
    if args.in_memory:
        print("Browser component fixture checks: PASS")
        print("NOT TESTED in this mode: HTTP asset loading, defer timing, identity-link reload, and CSP enforcement.")
    else:
        print("Marin CSV shell integration (local HTTP; external feed fixtures): PASS")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)

#!/usr/bin/env python3
"""Test browser enforcement of the shipped meta policies using fixture responses."""
from __future__ import annotations

import argparse
from html.parser import HTMLParser
import json
import shutil
import sys
from urllib.parse import urlsplit

from browser_smoke import ROOT, CATALOG, COMMITS, serve, ready, require

API_URL = "https://api.github.com/repos/marincountygov/marin-csv/commits?per_page=15"
CATALOG_URL = "https://marincountygov.github.io/marin-os/catalog.json"
BLOCKED_URL = "https://blocked.example/security-probe"
BLOCKED_CATALOG_URL = "https://marincountygov.github.io/not-the-catalog.json"


class PolicySource(HTMLParser):
    def __init__(self, source: str):
        super().__init__()
        self.tags = []
        self.favicon = None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta" and ((attrs.get("http-equiv") or "").lower() == "content-security-policy"
                              or (attrs.get("name") or "").lower() == "referrer"):
            self.tags.append(self.get_starttag_text())
        if tag == "link" and attrs.get("rel") == "icon":
            self.favicon = attrs["href"]


def run(in_memory: bool = False) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("Browser security tests require Python Playwright and Chromium.") from error
    security = json.loads((ROOT / "security.json").read_text(encoding="utf-8"))
    require(security["csp"]["directives"].get("worker-src") == ["'self'"],
            "The committed CSP must restrict parsing workers to the application origin")
    source = PolicySource((ROOT / "index.html").read_text(encoding="utf-8"))
    require(len(source.tags) == 2, "Expected the two shipped policy tags")
    with serve() as base_url, sync_playwright() as pw:
        executable = (shutil.which("chromium") or shutil.which("chromium-browser")
                      or shutil.which("google-chrome"))
        options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        if executable:
            options["executable_path"] = executable
        browser = pw.chromium.launch(**options)
        try:
            context = browser.new_context()
            context.set_default_timeout(10000)
            requests = []
            unexpected = []
            errors = []
            origin = urlsplit(base_url).netloc

            def intercept(route):
                url = urlsplit(route.request.url)
                requests.append((route.request.url, route.request.headers))
                if url.netloc == origin and not in_memory:
                    route.continue_()
                elif route.request.url == CATALOG_URL:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(CATALOG),
                                  headers={"Access-Control-Allow-Origin": "*"})
                elif url.hostname == "api.github.com" and url.path.endswith("/commits"):
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(COMMITS),
                                  headers={"Access-Control-Allow-Origin": "*"})
                else:
                    # Denied loads must be blocked by CSP, not merely by this test route.
                    unexpected.append(route.request.url)
                    route.abort()

            context.route("**/*", intercept)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            if in_memory:
                # No relaxation: copy the exact shipped tags into a fresh, minimal document.
                # Its opaque origin cannot test same-origin files or Referer header delivery.
                page.set_content('<!doctype html><html><head><meta charset="utf-8">'
                                 + "\n".join(source.tags) + '</head><body><p>Policy fixture</p></body></html>')
            else:
                page.goto(base_url + "?policy-probe=1#security", wait_until="networkidle")
                ready(page)
                page.locator("[data-security-content] h4").first.wait_for()
            page.evaluate("""() => {
              window.__policyViolations = [];
              document.addEventListener('securitypolicyviolation', event => {
                window.__policyViolations.push({directive: event.effectiveDirective,
                  blocked: event.blockedURI, disposition: event.disposition});
              });
            }""")
            result = page.evaluate("""async ([api, catalog, denied, wrongPath, favicon]) => {
              const allowed = [];
              for (const url of [api, catalog]) {
                const response = await fetch(url);
                allowed.push(response.ok && Array.isArray(await response.json()));
              }
              let rejected = 0;
              for (const url of [denied, wrongPath]) {
                try { await fetch(url); } catch (_) { rejected += 1; }
              }
              const image = new Image();
              const loaded = new Promise((resolve, reject) => {
                image.onload = () => resolve(image.naturalWidth > 0);
                image.onerror = () => reject(new Error('The data: favicon was blocked'));
              });
              image.src = favicon;
              document.body.appendChild(image);
              const imageLoaded = await loaded;
              image.remove();
              const inline = document.createElement('script');
              inline.textContent = 'window.__inlinePolicyProbe = true';
              document.body.appendChild(inline);
              const remote = document.createElement('script');
              remote.src = 'https://api.github.com/security-probe.js';
              document.body.appendChild(remote);
              const style = document.createElement('style');
              style.textContent = 'body { --policy-probe: allowed; }';
              document.head.appendChild(style);
              const button = document.createElement('button');
              button.setAttribute('onclick', 'window.__handlerPolicyProbe = true');
              document.body.appendChild(button);
              button.click();
              button.remove();
              return {allowed, rejected, imageLoaded};
            }""", [API_URL, CATALOG_URL, BLOCKED_URL, BLOCKED_CATALOG_URL, source.favicon])
            require(result["allowed"] == [True, True], "Configured feeds were blocked by CSP/CORS")
            require(result["rejected"] == 2, "Unapproved connection succeeded")
            require(result["imageLoaded"], "The data: image allowance failed")
            page.wait_for_function("""() => {
              const v = window.__policyViolations;
              return v.filter(x => x.directive === 'connect-src').length >= 2
                && v.filter(x => x.directive === 'script-src-elem').length >= 2
                && v.some(x => x.directive === 'script-src-attr')
                && v.some(x => x.directive === 'style-src-elem');
            }""")
            require(page.evaluate("window.__inlinePolicyProbe !== true && window.__handlerPolicyProbe !== true"),
                    "Inline script or event-handler code executed")
            require(page.evaluate("getComputedStyle(document.body).getPropertyValue('--policy-probe')") == "",
                    "Inline style was applied")
            require(page.evaluate("window.__policyViolations.every(v => v.disposition === 'enforce')"),
                    "Policy is reporting only rather than enforcing")
            require(not unexpected, f"Requests escaped CSP enforcement: {unexpected}")
            require(not errors, f"Unexpected page errors: {errors}")
            if not in_memory:
                expected_referrer = f"http://{origin}/"
                external = [headers for url, headers in requests if url == CATALOG_URL or url.startswith(API_URL)]
                require(bool(external) and all(h.get("referer") == expected_referrer for h in external),
                        "Cross-origin Referer must contain only the origin, not the app path/query")
                require(any(urlsplit(url).path.endswith("/security.json") for url, _ in requests),
                        "The app did not fetch its same-origin security configuration")
            context.close()
        finally:
            browser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in-memory", action="store_true",
                        help="Enforce the exact meta tags in a minimal document without navigation")
    args = parser.parse_args()
    run(args.in_memory)
    print("Browser CSP enforcement: PASS (allowed feeds/images; denied connections/scripts/inline styles)")
    if args.in_memory:
        print("NOT TESTED in this mode: same-origin HTTP assets and Referer header delivery.")
    else:
        print("Same-origin HTTP loading and cross-origin Referer delivery: PASS")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)

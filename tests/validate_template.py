#!/usr/bin/env python3
"""Read-only Marin CSV structure, integrity, and local-runtime checks."""
from __future__ import annotations

import ast
from collections import Counter
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SHELL = ROOT / "vendor/marinos"
THIRD_PARTY = ROOT / "vendor/third-party"
COMPONENTS = (
    "marin-os-banner", "marin-app-header", "marin-app-info",
    "marin-app-footer", "marin-app-feedback",
)
LEGACY = (
    "BRAND_VERSION", "shared/app-brand.css", "shared/app-shell.js",
    "vendor/pico.min.css",
)
EXPECTED_STYLES = [
    "vendor/marinos/marinos.css",
    "vendor/third-party/tabulator.min.css",
    "assets/app.css",
]
EXPECTED_SCRIPTS = [
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
]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Document(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
            "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, text: str) -> None:
        super().__init__(convert_charrefs=True)
        self.elements: list[tuple[str, dict[str, str | None], tuple[str, ...]]] = []
        self.stack: list[str] = []
        self.feed(text)
        self.close()
        require(not self.stack, f"Unclosed HTML elements: {self.stack}")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        require(len(attrs) == len(dict(attrs)), f"Duplicate attributes on <{tag}>")
        self.elements.append((tag, dict(attrs), tuple(self.stack)))
        if tag not in self.VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        require(bool(self.stack) and self.stack[-1] == tag, f"Unexpected closing </{tag}>")
        self.stack.pop()

    def nodes(self, tag: str) -> list[dict[str, str | None]]:
        return [attrs for name, attrs, _ in self.elements if name == tag]


def yaml_scalar(text: str, key: str) -> str:
    matches = re.findall(rf"^\s{{2}}{re.escape(key)}:\s+(.+?)\s*$", text, flags=re.M)
    require(len(matches) == 1, f"Expected one two-space {key}: value in marin.yml")
    return matches[0].strip("\"'")


def platform_shell(text: str) -> str:
    match = re.search(r"^platform:\s*\n\s{2}shell:\s+([\"']?)(\d+\.\d+\.\d+)\1\s*$", text, flags=re.M)
    require(match is not None, "Use a plain platform.shell x.y.z entry in marin.yml")
    return match.group(2)  # type: ignore[union-attr]


def validate_shell() -> dict:
    manifest = json.loads((SHELL / "manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("schema") == 1, "Unexpected shell manifest schema")
    require(manifest.get("installPath") == "vendor/marinos", "Unexpected shell install path")
    version = platform_shell((ROOT / "marin.yml").read_text(encoding="utf-8"))
    require(version == manifest.get("shellVersion"), "platform.shell does not match the installed shell")

    files = manifest.get("files")
    require(isinstance(files, dict) and files, "Shell manifest file map is empty")
    actual = {p.relative_to(SHELL).as_posix() for p in SHELL.rglob("*")
              if p.is_file() and p != SHELL / "manifest.json"}
    require(actual == set(files), "Vendored shell file set differs from the release manifest")
    for relative, expected in files.items():
        path = (SHELL / relative).resolve()
        require(SHELL.resolve() in path.parents, f"Invalid shell manifest path: {relative}")
        require(path.stat().st_size == expected["bytes"], f"Shell byte count differs: {relative}")
        require(sha256(path) == expected["sha256"],
                f"Shell SHA-256 differs: {relative}; reinstall an unmodified release")

    for font_path in manifest.get("fontPathContract", []):
        path = (SHELL / font_path).resolve()
        require(ROOT.resolve() in path.parents and path.is_file(), f"Missing managed font: {font_path}")

    icons = manifest.get("companionIcons")
    require(isinstance(icons, dict) and icons, "Shell manifest lists no companion icons")
    for relative, expected in icons.items():
        path = (ROOT / relative).resolve()
        require(ROOT.resolve() in path.parents and path.is_file(), f"Missing shell icon: {relative}")
        require(path.stat().st_size == expected["bytes"] and sha256(path) == expected["sha256"],
                f"Shell icon differs from the manifest: {relative}")
    on_disk = {p.relative_to(ROOT).as_posix() for p in (ROOT / "vendor/icons").rglob("*") if p.is_file()}
    require(on_disk == set(icons), f"Unexpected files in vendor/icons: {sorted(on_disk - set(icons))}")
    print(f"Vendored shell {version} and {len(icons)} managed icon files: PASS")
    return manifest


def validate_third_party() -> str:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    expected_versions = {"papaparse": "5.7.0", "tabulator-tables": "6.6.1"}
    require(package.get("version") == "0.1.0-csv.4",
            "package.json must identify the CSV-4 local recovery release")
    require(package.get("devDependencies") == expected_versions,
            "package.json must pin the selected exact Papa Parse and Tabulator versions")

    manifest = json.loads((THIRD_PARTY / "vendor-manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("schema") == 1, "Unexpected third-party vendor manifest schema")
    status = manifest.get("status")
    require(status == "vendored", "CSV-4 requires the reviewed vendored dependency state")
    dependencies = manifest.get("dependencies")
    require(isinstance(dependencies, dict) and set(dependencies) == set(expected_versions),
            "Third-party vendor manifest dependency set differs")

    runtime_names = {"papaparse.min.js", "tabulator.min.js", "tabulator.min.css", "vendor-status.js"}
    for name in runtime_names | {"PAPAPARSE_LICENSE.txt", "TABULATOR_LICENSE.txt", "README.md"}:
        require((THIRD_PARTY / name).is_file(), f"Missing local third-party file: {name}")

    require((ROOT / "package-lock.json").is_file(),
            "CSV-4 vendored dependency state requires package-lock.json")
    for name, version in expected_versions.items():
        record = dependencies[name]
        require(record.get("version") == version, f"Wrong vendored version for {name}")
        require(record.get("installed") is True, f"Vendored state must mark {name} installed")
        file_records = record.get("files")
        require(isinstance(file_records, dict) and file_records, f"Missing file records for {name}")
        for relative, expected in file_records.items():
            path = THIRD_PARTY / relative
            require(path.is_file(), f"Missing vendored file: {relative}")
            require(path.stat().st_size == expected.get("bytes") and sha256(path) == expected.get("sha256"),
                    f"Vendored file differs from its checksum record: {relative}")

    for relative, expected in manifest.get("files", {}).items():
        path = THIRD_PARTY / relative
        require(path.is_file() and path.stat().st_size == expected.get("bytes")
                and sha256(path) == expected.get("sha256"),
                f"Generated vendor file differs: {relative}")

    status_text = (THIRD_PARTY / "vendor-status.js").read_text(encoding="utf-8")
    require('phase: "vendored"' in status_text or '"phase": "vendored"' in status_text,
            "Vendored status file does not identify vendored mode")
    require(('papaParse: "5.7.0"' in status_text or '"papaParse": "5.7.0"' in status_text)
            and ('tabulator: "6.6.1"' in status_text or '"tabulator": "6.6.1"' in status_text),
            "Vendored status file does not identify the selected exact releases")
    print("Third-party distributions, lockfile, and checksum records: PASS")
    return status


def validate_html() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    doc = Document(html)
    for component in COMPONENTS:
        require(len(doc.nodes(component)) == 1, f"Expected one <{component}>")
    require([tag for tag, _, _ in doc.elements if tag in COMPONENTS] == list(COMPONENTS),
            "Shell components are out of order")

    main_nodes = doc.nodes("main")
    require(len(main_nodes) == 1 and main_nodes[0].get("id") == "main", "Expected main#main")
    ids = [attrs["id"] for _, attrs, _ in doc.elements if attrs.get("id")]
    require(all(count == 1 for count in Counter(ids).values()), "Duplicate source IDs found")
    require(not set(ids).intersection({"about", "security", "accessibility", "tech", "updates",
                                      "app-nav", "menu-toggle", "app-status-message"}),
            "Do not hand-author shell-owned IDs")

    sections = [(attrs, parents) for _, attrs, parents in doc.elements if "data-tab-section" in attrs]
    require(sections and sections[0][0].get("id") == "start"
            and sections[0][0].get("data-tab-section") == "start", "The first route must be #start")
    require("main" in sections[0][1] and "hidden" not in sections[0][0],
            "#start must be visible and inside main#main")

    info = doc.nodes("marin-app-info")[0]
    header = doc.nodes("marin-app-header")[0]
    footer = doc.nodes("marin-app-footer")[0]
    require(header.get("app-name") == "Marin CSV" and info.get("app-name") == "Marin CSV"
            and footer.get("app-name") == "Marin CSV", "Component app names must all be Marin CSV")
    require(info.get("repo") == "marin-csv", "marin-app-info repo must be marin-csv")
    require(info.get("security-src") == "security.json", "Security source must be local security.json")
    for key in ("data-about", "data-accessibility"):
        require(sum(tag == "template" and key in attrs and "marin-app-info" in parents
                    for tag, attrs, parents in doc.elements) == 1, f"Expected one {key} template")
    require(any(tag == "svg" and "template" in parents and "marin-app-header" in parents
                for tag, _, parents in doc.elements), "Header icon template is missing")
    require(any(attrs.get("rel") == "icon" and str(attrs.get("href", "")).startswith("data:image/svg+xml")
                for attrs in doc.nodes("link")), "Inline SVG favicon is missing")
    require(bool(doc.nodes("noscript")), "Keep a JavaScript-disabled message")
    require(len(doc.nodes("dialog")) >= 3, "Expected native dialogs for confirmations and forms")

    toolbars = [attrs for _, attrs, _ in doc.elements if attrs.get("role") == "toolbar"]
    require(len(toolbars) == 1 and toolbars[0].get("aria-label") == "Marin CSV commands",
            "CSV-3 requires one named spreadsheet command toolbar")
    toggle = next((attrs for _, attrs, _ in doc.elements
                   if attrs.get("id") == "csv-workspace-toggle"), None)
    require(toggle is not None and toggle.get("aria-controls") == "csv-workspace-shell"
            and toggle.get("aria-expanded") == "false",
            "Workspace toggle semantics differ")
    require("Expand workspace" in html,
            "Normal workspace control name must be present in source")

    app_js = (ROOT / "assets/app.js").read_text(encoding="utf-8")
    require("Collapse workspace" in app_js,
            "Expanded workspace control name must be present in application logic")
    workspace_js = (ROOT / "assets/workspace-state.js").read_text(encoding="utf-8")
    require("requestFullscreen(" not in app_js and "requestFullscreen(" not in workspace_js,
            "CSV-3 expanded workspace must not invoke the Fullscreen API")
    require("data-workspace-mode" in (ROOT / "assets/app.css").read_text(encoding="utf-8")
            and "dataset.workspaceMode" in app_js,
            "Workspace mode must have one explicit application state")
    for forbidden in ("localStorage", "sessionStorage", "document.cookie"):
        require(forbidden not in app_js and forbidden not in workspace_js,
                f"Workspace mode must remain session-only and not use {forbidden}")

    styles = [attrs.get("href") for attrs in doc.nodes("link") if attrs.get("rel") == "stylesheet"]
    sources = [attrs.get("src") for attrs in doc.nodes("script")]
    require(styles == EXPECTED_STYLES, f"Unexpected stylesheet order: {styles}")
    require(sources == EXPECTED_SCRIPTS, f"Unexpected script order: {sources}")
    for attrs in doc.nodes("script"):
        require("defer" in attrs and "async" not in attrs and attrs.get("src"),
                "Every application script must be a local ordered deferred resource")
    for relative in styles + sources + [str(info.get("security-src"))]:
        require(not re.match(r"(?:[a-z]+:|//)", relative, re.I), f"Runtime resource must be local: {relative}")
        require((ROOT / relative).is_file(), f"Missing local runtime resource: {relative}")

    for relative in LEGACY:
        require(not (ROOT / relative).exists(), f"Legacy runtime asset remains: {relative}")

    css = re.sub(r"/\*.*?\*/", "", (ROOT / "assets/app.css").read_text(encoding="utf-8"), flags=re.S)
    require(not re.search(r"\.(?:app-header|app-footer|marinos-banner)(?:\b|__)", css),
            "Application CSS must not restyle shell-owned layout")
    require("https://" not in css and "http://" not in css and "@import" not in css,
            "Application CSS must not load external runtime assets")
    print("HTML structure, local resources, and app-owned CSS boundaries: PASS")


def validate_metadata() -> None:
    manifest_text = (ROOT / "marin.yml").read_text(encoding="utf-8")
    require(yaml_scalar(manifest_text, "name") == "Marin CSV", "marin.yml project name differs")
    require(yaml_scalar(manifest_text, "repo") == "marin-csv", "marin.yml repository differs")
    require(yaml_scalar(manifest_text, "owner") == "County of Marin", "marin.yml owner differs")
    require(yaml_scalar(manifest_text, "status") == "alpha", "Marin CSV must remain alpha until release gates are complete")
    require("services: none" in manifest_text and re.search(r"^ai:\s*\n\s{2}used:\s+false\s*$", manifest_text, re.M),
            "Marin CSV must document no app AI and no outside app services")

    security = json.loads((ROOT / "security.json").read_text(encoding="utf-8"))
    require(security["review"] == {"lastReviewed": "2026-10-14", "owner": "County of Marin"},
            "Security review metadata differs")
    require(security["data"]["acceptsUserSubmittedContent"] is True
            and security["data"]["collectsUserData"] is False
            and security["data"]["storesPersonalInformation"] is True,
            "Security data-handling declarations must acknowledge browser-local IndexedDB recovery")
    require(security["dependencies"]["lockfileRequired"] is True,
            "Dependency lockfile must be required before release")

    security_txt = (ROOT / ".well-known/security.txt").read_text(encoding="utf-8")
    require("Contact: mailto:innovation@marincounty.gov" in security_txt, "security.txt contact differs")
    require(f"Expires: {security['securityTxt']['expires']}" in security_txt, "security.txt expiry is stale")
    require((ROOT / ".nojekyll").is_file(), "Keep .nojekyll for GitHub Pages")
    require((ROOT / "TEMPLATE_VERSION").read_text().strip() == "2.0.8", "Template provenance must remain 2.0.8")

    required_docs = (
        "README.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md", "AGENTS.md",
        "docs/decisions.md", "docs/data-integrity-contract.md", "docs/csv-0-findings.md",
        "docs/csv-0-test-report.md", "docs/csv-1-findings.md",
        "docs/csv-1-test-report.md", "docs/csv-2-findings.md",
        "docs/csv-2-test-report.md", "docs/large-file-policy.md",
        "docs/csv-2-benchmark-results.json", "docs/csv-2-benchmark-results.md",
        "docs/csv-2-browser-benchmark-results.json",
        "docs/csv-2-browser-benchmark-results.md",
        "docs/csv-3-findings.md", "docs/csv-3-test-report.md",
        "docs/csv-3-manual-review.md",
        "docs/csv-4-implementation-spec.md", "docs/csv-4-architecture.md",
        "docs/recovery-schema.md", "docs/recovery-formats.md",
        "docs/csv-4-findings.md", "docs/csv-4-test-report.md",
        "docs/csv-4-manual-review.md",
        "docs/csv-4-recovery-benchmark-results.json",
        "docs/csv-4-recovery-benchmark-results.md",
        "docs/development.md",
    )
    for relative in required_docs:
        require((ROOT / relative).is_file(), f"Missing required project document: {relative}")

    placeholders = re.compile(r"APP_(?:NAME|DESCRIPTION|OWNER|REPO)")
    app_owned = [
        ROOT / "index.html", ROOT / "README.md", ROOT / "marin.yml", ROOT / "security.json",
        ROOT / "SECURITY.md", ROOT / "AGENTS.md", ROOT / "docs/development.md",
    ]
    for path in app_owned:
        require(not placeholders.search(path.read_text(encoding="utf-8")), f"Starter placeholder remains in {path.name}")

    for path in (ROOT / "tests").glob("*.py"):
        ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for path in (ROOT / "scripts").glob("*.py"):
        ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    print("Metadata, security declarations, documentation, and Python syntax: PASS")


def main() -> None:
    validate_shell()
    validate_third_party()
    validate_html()
    validate_metadata()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, SyntaxError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)

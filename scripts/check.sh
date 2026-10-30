#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
BROWSER_MODE="none"

case "${1:-}" in
  '') ;;
  --browser) BROWSER_MODE="http" ;;
  --browser-in-memory) BROWSER_MODE="in-memory" ;;
  -h|--help)
    printf 'Usage: bash scripts/check.sh [--browser|--browser-in-memory]\n'
    printf '  --browser            Run browser tests through a local HTTP origin.\n'
    printf '  --browser-in-memory  Run actual vendored libraries in an in-memory fixture.\n'
    exit 0
    ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac
if [[ $# -gt 1 ]]; then
  printf 'Usage: bash scripts/check.sh [--browser|--browser-in-memory]\n' >&2
  exit 2
fi

command -v python3 >/dev/null 2>&1 || {
  printf 'ERROR: Python 3 is required for Marin CSV checks.\n' >&2
  exit 1
}
command -v node >/dev/null 2>&1 || {
  printf 'ERROR: Node is required for Marin CSV preservation-engine tests.\n' >&2
  exit 1
}

bash -n "$ROOT_DIR/scripts/check.sh"
python3 "$ROOT_DIR/scripts/sync-security-meta.py" --check
python3 "$ROOT_DIR/tests/validate_template.py"
python3 "$ROOT_DIR/tests/test_security_meta.py"
python3 "$ROOT_DIR/vendor/marinos/audit-buttons.py" "$ROOT_DIR" --fail
# Lists copy, download, file reading and upload code the app does itself; it must list nothing.
python3 "$ROOT_DIR/vendor/marinos/audit-shared-helpers.py" "$ROOT_DIR" --fail

while IFS= read -r -d '' script; do
  node --check "$script"
done < <(find "$ROOT_DIR/assets" "$ROOT_DIR/scripts" "$ROOT_DIR/tests" "$ROOT_DIR/vendor/third-party" \
  -type f \( -name '*.js' -o -name '*.mjs' \) -print0)
printf 'JavaScript syntax: PASS\n'

node --test \
  "$ROOT_DIR/tests/test_csv_engine.js" \
  "$ROOT_DIR/tests/test_csv2_engine.js" \
  "$ROOT_DIR/tests/test_document_loader.js" \
  "$ROOT_DIR/tests/test_large_file_policy.js" \
  "$ROOT_DIR/tests/test_papa_integration.js" \
  "$ROOT_DIR/tests/test_recovery_engine.js" \
  "$ROOT_DIR/tests/test_recovery_store.js" \
  "$ROOT_DIR/tests/test_recovery_coordinator.js" \
  "$ROOT_DIR/tests/test_tabulator_adapter.js" \
  "$ROOT_DIR/tests/test_workspace_state.js"
printf 'CSV preservation engine, local recovery, large-file policy, Papa Parse integration, and Tabulator adapter: PASS\n'

case "$BROWSER_MODE" in
  http)
    python3 "$ROOT_DIR/tests/browser_csv.py"
    python3 "$ROOT_DIR/tests/browser_files.py"
    python3 "$ROOT_DIR/tests/browser_workspace.py"
    python3 "$ROOT_DIR/tests/browser_recovery.py"
    python3 "$ROOT_DIR/tests/browser_smoke.py"
    python3 "$ROOT_DIR/tests/browser_security.py"
    ;;
  in-memory)
    python3 "$ROOT_DIR/tests/browser_csv.py" --in-memory
    python3 "$ROOT_DIR/tests/browser_files.py" --in-memory
    python3 "$ROOT_DIR/tests/browser_workspace.py" --in-memory
    python3 "$ROOT_DIR/tests/browser_recovery.py" --in-memory
    python3 "$ROOT_DIR/tests/browser_smoke.py" --in-memory
    python3 "$ROOT_DIR/tests/browser_security.py" --in-memory
    ;;
  none)
    printf 'SKIP: Browser tests not requested; use --browser or --browser-in-memory.\n'
    ;;
esac
printf 'Requested Marin CSV checks completed successfully.\n'

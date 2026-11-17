#!/usr/bin/env bash
# Maestro (UI-testrunner) voor de runtime-flows; alleen in CI-testjobs.
set -euo pipefail
curl -fsSL "https://get.maestro.mobile.dev" | bash
echo "$HOME/.maestro/bin" >> "${GITHUB_PATH:-/dev/null}"
export PATH="$HOME/.maestro/bin:$PATH"
maestro --version

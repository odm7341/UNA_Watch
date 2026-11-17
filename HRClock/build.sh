#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$repo/Tools/watch-apps.py" build HRClock "$@" \
  --sdk-revision b9869927e8688db001ec544dffde9c729ffa06c1

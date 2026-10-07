#!/usr/bin/env bash
# Runs the console (no-dice-ui) under a process manager such as pm2, which sources no
# shell profile. Each key a seat may need — the variables named in NO_DICE_KEYS
# (default: DEEPSEEK_API_KEY) — that isn't already set is read from ~/.zshrc
# (override with NO_DICE_KEYS_FROM), so the key lives in one place and never lands in
# the process manager's saved config.
set -euo pipefail
root=$(dirname "$(dirname "$(readlink -f "$0")")")
keys_from="${NO_DICE_KEYS_FROM:-$HOME/.zshrc}"

if [ -f "$keys_from" ]; then
  for var in ${NO_DICE_KEYS:-DEEPSEEK_API_KEY}; do
    if [ -z "${!var:-}" ]; then
      value=$(grep -E "^(export[[:space:]]+)?${var}=" "$keys_from" | tail -1 | sed -E "s/^(export[[:space:]]+)?${var}=//; s/^[\"']//; s/[\"']\$//" || true)
      if [ -n "$value" ]; then export "$var=$value"; else echo "console-daemon: $var is not set and not in $keys_from" >&2; fi
    fi
  done
fi

cd "$root"
exec node packages/ui/src/server.ts "$@"

#!/usr/bin/env bash
# Brings the console that pm2 runs as `no-dice-console` up to date with main: pull this
# checkout, install, rebuild the replay viewer and the console's page, and restart it.
# The factory runs this when an epic finishes (`previews.no-dice` in its config.yaml).
# A run the console is playing would be cut off by the restart, so then it stops short
# and says so; run it again once the run is over.
set -euo pipefail
cd "$(dirname "$(dirname "$(readlink -f "$0")")")"

running=$(curl -s --max-time 5 http://127.0.0.1:8765/api/state | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{console.log(JSON.parse(s).running===null?"":"yes")}catch{console.log("")}})')
if [ -n "$running" ]; then
  echo "update-console: the console is playing a run; not restarting it. Run scripts/update-console.sh when it is over." >&2
  exit 1
fi

git pull --ff-only -q
pnpm install --frozen-lockfile --silent
pnpm --filter @no-dice/salient-viewer build >/dev/null
pnpm --filter @no-dice/ui build >/dev/null
pm2 restart no-dice-console >/dev/null
echo "update-console: the console is at $(git log -1 --format='%h %s')"

#!/usr/bin/env bash
# Linux/Bash only. Internal SQL stream for the forthcoming private snapshot collector.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
container="$(docker compose ps --all --quiet app)"
[[ "$container" =~ ^[0-9a-f]{12,64}$ ]] || { echo 'Expected one existing application container' >&2; exit 1; }
docker compose stop --timeout 60 app >&2
[[ "$(docker inspect --format '{{.State.Running}} {{.State.Restarting}}' "$container")" == 'false false' ]] || { echo 'Application did not stop' >&2; exit 1; }
# The password is read only inside the database container, never on the host.
# All callers must preserve the pipe exit status. The app stays stopped on success or failure.
exec docker compose exec -T database bash -s < dump-database.sh

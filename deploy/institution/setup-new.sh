#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
docker compose run --rm prepare
docker compose up -d database cache
docker compose run --rm initialize
docker compose up -d app
printf '%s\n' 'WorkProof 已启动，请检查 docker compose ps。账号仅在显式运行 account 时显示。'

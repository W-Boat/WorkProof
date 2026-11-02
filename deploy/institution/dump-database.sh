#!/usr/bin/env bash
# Internal MySQL-container helper. The coordinator must stop application writers.
# stdout contains SQL only; never redirect it to an ordinary shared directory.
set +x
set -euo pipefail
export MYSQL_PWD
MYSQL_PWD="$(cat /private/mysql-root/password)"
facts="$(mysql --host=127.0.0.1 --user=root --batch --skip-column-names --execute="SELECT COUNT(*),COALESCE(SUM(ENGINE <> 'InnoDB'),0) FROM information_schema.TABLES WHERE TABLE_SCHEMA='workproof' AND TABLE_TYPE='BASE TABLE'")"
[[ "$facts" =~ ^[0-9]+$'\t'[0-9]+$ ]] || { echo 'Unexpected database inventory' >&2; exit 1; }
IFS=$'\t' read -r tables unsupported <<< "$facts"
[[ "$tables" -gt 0 && "$unsupported" -eq 0 ]] || { echo 'A nonempty InnoDB database is required' >&2; exit 1; }
writers="$(mysql --host=127.0.0.1 --user=root --batch --skip-column-names --execute="SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE DB='workproof' AND ID<>CONNECTION_ID()")"
[[ "$writers" == 0 ]] || { echo 'Database still has other application connections' >&2; exit 1; }
exec mysqldump --host=127.0.0.1 --user=root --single-transaction --quick \
  --skip-lock-tables --no-tablespaces --column-statistics=0 --set-gtid-purged=OFF \
  --hex-blob --routines --events --triggers --default-character-set=utf8mb4 workproof

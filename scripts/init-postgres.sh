#!/bin/bash
set -euo pipefail

DB_NAME="voice_mvp"
DB_USER="voice_mvp"
DB_PASS="your_password"
DB_SCHEMA="public"

echo "=== PostgreSQL 初始化 ==="

psql -v ON_ERROR_STOP=0 <<-EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
    RAISE NOTICE '角色 ${DB_USER} 已创建';
  ELSE
    RAISE NOTICE '角色 ${DB_USER} 已存在，跳过';
  END IF;
END
\$\$;
EOSQL

psql -v ON_ERROR_STOP=0 <<-EOSQL
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
EOSQL

echo "[ok] 数据库 ${DB_NAME} 已就绪"

psql -d "${DB_NAME}" -v ON_ERROR_STOP=0 <<-EOSQL
GRANT ALL ON SCHEMA ${DB_SCHEMA} TO ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${DB_SCHEMA}
  GRANT ALL ON TABLES TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${DB_SCHEMA}
  GRANT ALL ON SEQUENCES TO ${DB_USER};
EOSQL

echo "[ok] 权限已授予"
echo ""
echo "连接串："
echo "  postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=${DB_SCHEMA}"

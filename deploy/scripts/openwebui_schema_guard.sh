#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/stack.env}"
OPENWEBUI_DB="${OPENWEBUI_DB:-openwebui}"
OPENWEBUI_DB_USER="${OPENWEBUI_DB_USER:-localagent}"
OPENWEBUI_MIGRATIONS_DIR="${OPENWEBUI_MIGRATIONS_DIR:-$DEPLOY_DIR/../open-webui/backend/open_webui/migrations/versions}"
PLATFORM_COMPOSE_FILE="$DEPLOY_DIR/layer1-platform/docker-compose.yml"
APPS_COMPOSE_FILE="$DEPLOY_DIR/layer2-apps/docker-compose.yml"

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  printf '%s' "${line#*=}"
}

compose_exec() {
  local target="$1"
  shift
  local compose_file=""

  case "$target" in
    platform) compose_file="$PLATFORM_COMPOSE_FILE" ;;
    apps) compose_file="$APPS_COMPOSE_FILE" ;;
    *)
      echo "Unsupported compose target: $target" >&2
      exit 2
      ;;
  esac

  docker compose --env-file "$ENV_FILE" -f "$compose_file" "$@"
}

pg_psql() {
  compose_exec platform exec -T postgres-primary psql -U "$OPENWEBUI_DB_USER" -d "$OPENWEBUI_DB" "$@"
}

psql_scalar() {
  local sql="$1"
  pg_psql -tAc "$sql" | tr -d '[:space:]'
}

table_exists() {
  local table_name="$1"
  [[ "$(psql_scalar "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table_name}');")" == "t" ]]
}

column_exists() {
  local table_name="$1"
  local column_name="$2"
  [[ "$(psql_scalar "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table_name}' AND column_name = '${column_name}');")" == "t" ]]
}

migration_revision_exists() {
  local revision="$1"
  local migrations_dir="$2"
  [[ -n "$revision" ]] || return 1
  compgen -G "$migrations_dir/${revision}_*.py" >/dev/null
}

openwebui_schema_reset_reason() {
  local current_revision="$1"
  local migrations_dir="$2"
  local tool_has_access_control="${3:-1}"

  if [[ -n "$current_revision" ]] && ! migration_revision_exists "$current_revision" "$migrations_dir"; then
    printf 'missing_revision:%s' "$current_revision"
    return 0
  fi

  if [[ "$tool_has_access_control" != "1" ]]; then
    printf 'missing_tool_access_control'
    return 0
  fi

  printf ''
}

backup_openwebui_schema() {
  local backup_root
  local backup_file
  local timestamp

  backup_root="$(read_env_value LA_DATA_ROOT)/platform/backups/postgres"
  mkdir -p "$backup_root"
  timestamp="$(date +%Y%m%d-%H%M%S)"
  backup_file="$backup_root/openwebui-pre-reset-${timestamp}.sql"

  compose_exec platform exec -T postgres-primary sh -lc \
    "pg_dump -U '$OPENWEBUI_DB_USER' -d '$OPENWEBUI_DB' --clean --if-exists --schema=public" \
    >"$backup_file"

  printf '%s' "$backup_file"
}

reset_openwebui_schema() {
  pg_psql <<SQL
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION ${OPENWEBUI_DB_USER};
GRANT ALL ON SCHEMA public TO ${OPENWEBUI_DB_USER};
GRANT ALL ON SCHEMA public TO public;
SQL
}

ensure_openwebui_schema_ready() {
  local current_revision=""
  local tool_has_access_control="1"
  local reason=""

  if [[ ! -d "$OPENWEBUI_MIGRATIONS_DIR" ]]; then
    echo "Missing OpenWebUI migrations dir: $OPENWEBUI_MIGRATIONS_DIR" >&2
    exit 1
  fi

  if table_exists "alembic_version"; then
    current_revision="$(psql_scalar "SELECT version_num FROM alembic_version LIMIT 1;")"
  fi

  if table_exists "tool" && ! column_exists "tool" "access_control"; then
    tool_has_access_control="0"
  fi

  reason="$(openwebui_schema_reset_reason "$current_revision" "$OPENWEBUI_MIGRATIONS_DIR" "$tool_has_access_control")"
  if [[ -n "$reason" ]]; then
    local backup_file
    backup_file="$(backup_openwebui_schema)"
    echo "Detected stale OpenWebUI schema ($reason). Backed up public schema to $backup_file"
    reset_openwebui_schema
  fi

  if ! table_exists "config"; then
    echo "Initializing OpenWebUI schema from current source migrations..."
    compose_exec apps up -d --no-deps open-webui
    ENV_FILE="$ENV_FILE" bash "$DEPLOY_DIR/scripts/wait_for_service_health.sh" apps open-webui 300
  fi
}

main() {
  ensure_openwebui_schema_ready
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi

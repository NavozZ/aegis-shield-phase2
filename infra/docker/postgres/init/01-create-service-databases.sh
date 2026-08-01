#!/bin/sh

# PostgreSQL runs this file only while initializing a new data volume. It creates
# prototype database-per-service boundaries without adding application tables.
set -eu
if (set -o pipefail) 2>/dev/null; then
  set -o pipefail
fi

required_variables='POSTGRES_USER POSTGRES_DB IDENTITY_DB_NAME IDENTITY_DB_USER IDENTITY_DB_PASSWORD LEDGER_DB_NAME LEDGER_DB_USER LEDGER_DB_PASSWORD PAYMENTS_DB_NAME PAYMENTS_DB_USER PAYMENTS_DB_PASSWORD AUDIT_DB_NAME AUDIT_DB_USER AUDIT_DB_PASSWORD RESILIENCE_DB_NAME RESILIENCE_DB_USER RESILIENCE_DB_PASSWORD'

for variable_name in $required_variables; do
  eval "variable_value=\"\${$variable_name-}\""
  if [ -z "$variable_value" ]; then
    printf 'Required PostgreSQL initialization variable is missing: %s\n' "$variable_name" >&2
    exit 1
  fi
done

validate_identifier() {
  variable_name=$1
  eval "identifier_value=\"\${$variable_name}\""

  case "$identifier_value" in
    '' | *[!a-z0-9_]* | [0-9]*)
      printf 'Invalid PostgreSQL identifier in variable: %s\n' "$variable_name" >&2
      exit 1
      ;;
  esac
}

for variable_name in POSTGRES_USER POSTGRES_DB IDENTITY_DB_NAME IDENTITY_DB_USER LEDGER_DB_NAME LEDGER_DB_USER PAYMENTS_DB_NAME PAYMENTS_DB_USER AUDIT_DB_NAME AUDIT_DB_USER RESILIENCE_DB_NAME RESILIENCE_DB_USER; do
  validate_identifier "$variable_name"
done

ensure_unique_identifiers() {
  identifier_group=$1
  shift
  seen_identifiers=''

  for identifier_value in "$@"; do
    case " $seen_identifiers " in
      *" $identifier_value "*)
        printf 'PostgreSQL %s identifiers must be unique.\n' "$identifier_group" >&2
        exit 1
        ;;
    esac
    seen_identifiers="$seen_identifiers $identifier_value"
  done
}

ensure_unique_identifiers databases "$IDENTITY_DB_NAME" "$LEDGER_DB_NAME" "$PAYMENTS_DB_NAME" "$AUDIT_DB_NAME" "$RESILIENCE_DB_NAME"
ensure_unique_identifiers roles "$IDENTITY_DB_USER" "$LEDGER_DB_USER" "$PAYMENTS_DB_USER" "$AUDIT_DB_USER" "$RESILIENCE_DB_USER"

for database_name in "$IDENTITY_DB_NAME" "$LEDGER_DB_NAME" "$PAYMENTS_DB_NAME" "$AUDIT_DB_NAME" "$RESILIENCE_DB_NAME"; do
  if [ "$database_name" = "$POSTGRES_DB" ]; then
    printf 'A service database cannot reuse the administrative database name.\n' >&2
    exit 1
  fi
done

for role_name in "$IDENTITY_DB_USER" "$LEDGER_DB_USER" "$PAYMENTS_DB_USER" "$AUDIT_DB_USER" "$RESILIENCE_DB_USER"; do
  if [ "$role_name" = "$POSTGRES_USER" ]; then
    printf 'A service role cannot reuse the administrative role name.\n' >&2
    exit 1
  fi
done

create_service_database() {
  database_name=$1
  role_name=$2
  role_password=$3

  psql \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --set=ON_ERROR_STOP=1 \
    --set=database_name="$database_name" \
    --set=role_name="$role_name" \
    --set=role_password="$role_password" \
    <<-'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
  :'role_name',
  :'role_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'role_name'
) \gexec

ALTER ROLE :"role_name"
  WITH LOGIN PASSWORD :'role_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

SELECT format(
  'CREATE DATABASE %I OWNER %I ENCODING ''UTF8''',
  :'database_name',
  :'role_name'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = :'database_name'
) \gexec

ALTER DATABASE :"database_name" OWNER TO :"role_name";
REVOKE CONNECT ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO :"role_name";
SQL

  psql \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --set=ON_ERROR_STOP=1 \
    --set=database_name="$database_name" \
    --set=admin_role="$POSTGRES_USER" \
    <<-'SQL'
GRANT CONNECT ON DATABASE :"database_name" TO :"admin_role";
SQL

  psql \
    --username "$POSTGRES_USER" \
    --dbname "$database_name" \
    --set=ON_ERROR_STOP=1 \
    --set=role_name="$role_name" \
    <<-'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION :"role_name";
ALTER SCHEMA app OWNER TO :"role_name";
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA app TO :"role_name";
SQL
}

create_service_database "$IDENTITY_DB_NAME" "$IDENTITY_DB_USER" "$IDENTITY_DB_PASSWORD"
create_service_database "$LEDGER_DB_NAME" "$LEDGER_DB_USER" "$LEDGER_DB_PASSWORD"
create_service_database "$PAYMENTS_DB_NAME" "$PAYMENTS_DB_USER" "$PAYMENTS_DB_PASSWORD"
create_service_database "$AUDIT_DB_NAME" "$AUDIT_DB_USER" "$AUDIT_DB_PASSWORD"
create_service_database "$RESILIENCE_DB_NAME" "$RESILIENCE_DB_USER" "$RESILIENCE_DB_PASSWORD"

printf 'Prototype service databases and roles initialized successfully.\n'

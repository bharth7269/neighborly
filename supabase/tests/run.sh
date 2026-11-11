#!/usr/bin/env bash
# Runs migrations + security tests against a throwaway local Postgres database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=neighborly_test
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/00_local_stub.sql
for f in migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d $DB -o /dev/null -f tests/10_security_tests.sql 2>&1 | sed -E 's/^psql:[^ ]+ (NOTICE: +)?//'

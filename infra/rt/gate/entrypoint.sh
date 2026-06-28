#!/bin/sh
set -eu

password_file="$(mktemp)"
trap 'rm -f "$password_file"' EXIT
printf '%s\n' "$RT_ROOT_PASSWORD" > "$password_file"
chmod 600 "$password_file"

if ! perl -MDBI -e '
  my $dbh = DBI->connect("dbi:Pg:dbname=postgres;host=postgres", "postgres", "gate-postgres", { RaiseError => 1 });
  my ($exists) = $dbh->selectrow_array("SELECT 1 FROM pg_database WHERE datname = ?", undef, "rt6");
  exit($exists ? 0 : 1);
'; then
  /opt/rt/sbin/rt-setup-database \
    --action init \
    --dba postgres \
    --dba-password gate-postgres \
    --root-password-file "$password_file"
fi

exec /opt/rt/sbin/rt-server --server Standalone --port 9000

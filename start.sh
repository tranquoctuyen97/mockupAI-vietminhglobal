#!/bin/bash
set -a
source .env
set +a
exec node_modules/.bin/next start -p "${PORT:-3000}"

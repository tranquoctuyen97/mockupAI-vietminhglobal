#!/bin/bash
set -a
source .env
set +a
exec node_modules/.bin/next start -p 3000

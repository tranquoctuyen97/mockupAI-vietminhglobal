# RT + Gmail mailbox setup

This directory contains two separate RT setups:

- `docker-compose.yml` for the RT 6.0.3 runtime and the containerized mailbox-worker runtime;
- `gate-compose.yml` for the disposable localhost lab used by live Gmail/RT verification.

For local development, the intended split is:

- Docker Compose for infra/runtime dependencies such as RT and PostgreSQL;
- PM2 for app services, started one process at a time from `ecosystem.config.js`.

If you want the whole mailbox stack in containers, use `docker-compose.yml`. If you want the usual dev flow, keep the infra in Compose and run the app services with PM2.

The one-command bootstrap script [`./setup-dev.sh`](../../setup-dev.sh) reuses the existing MockupAI PostgreSQL server, creates a separate RT database there, seeds RT when needed, creates `RT_API_TOKEN`, and runs the RT/Gmail migration. It does not start or restart PM2 services; run those separately from `ecosystem.config.js`.

## 1) Production app stack

Required environment values live in `infra/rt/.env`. Start from the example file:

```bash
cp infra/rt/.env.example infra/rt/.env
```

Fill these values before starting the stack:

- `RT_POSTGRES_PASSWORD`
- `MASTER_ENCRYPTION_KEY`
- `DATABASE_URL`
- `REDIS_URL`
- `RT_URL`
- `RT_API_TOKEN` after you create the RT API token

Use these URL values depending on where the code runs:

- inside Docker Compose, the RT service name is `http://rt:9000`
- from the host/browser, the RT web URL is `http://127.0.0.1:8082`

Do not append `/REST/2.0` to `RT_URL`; the client code adds that path itself.

Start the stack:

```bash
docker compose --env-file infra/rt/.env -f infra/rt/docker-compose.yml up -d --build
```

If you are running the app services with PM2 on the host, start only the infra services from Compose:

```bash
docker compose --env-file infra/rt/.env -f infra/rt/docker-compose.yml up -d postgres rt
pm2 start ecosystem.config.js
```

Use the containerized `mailbox-worker` service only if you want the worker inside Docker instead of PM2.

Check that RT is up:

```bash
docker compose -f infra/rt/docker-compose.yml exec rt perl -I/opt/rt/lib -MRT -e 'print $RT::VERSION'
```

If RT does not come up on a fresh machine, inspect the container logs first:

```bash
docker compose -f infra/rt/docker-compose.yml logs rt
```

Create the API token in RT:

If you bootstrap with [`./setup-dev.sh`](../../setup-dev.sh), this step is automatic: the script creates the RT root password, seeds RT when needed, creates `RT_API_TOKEN`, and writes it into both `.env` files. Do this manually only if you are bringing RT up without the bootstrap script.

1. Sign in to RT as an administrator.
2. Create or select the mailbox service principal that the app will use.
3. Open that principal's `Preferences → Authentication Tokens`.
4. Create a token named `mockupai-mailbox-worker`.
5. Copy the token once and save it as `RT_API_TOKEN` in `infra/rt/.env`.

Verify REST2 access:

```bash
curl -H "Authorization: token $RT_API_TOKEN" "$RT_URL/REST/2.0/rt"
```

Run the mailbox database/runtime migration from the app root:

```bash
npm run db:migrate:rt-gmail
```

After the migration succeeds, restart the app and the mailbox worker.

If you are using PM2, restart the matching PM2 processes instead of the whole Compose stack:

```bash
pm2 restart mockupai
pm2 restart mockupai-worker
```

The host-side `mockupai-worker` process must have `getmail` installed and available on `PATH`. If `getmail` is missing, mailbox sync will fail with `getmail_delivery_failed` even when RT and the database are healthy. For PM2 host-side runs, set `MAILBOX_RUNTIME_DIR` to a writable host path such as `/tmp/mockupai-mailboxes`; `/run/mockupai-mailboxes` is for container/Linux service runtimes. The Docker Compose `mailbox-worker` image already includes `getmail6`, so it is the fallback when you do not want to install it on the host.

For a quick health check after startup, use the app health endpoint. It should report RT reachability without leaking mailbox emails or tokens.

## 2) Disposable live-verification lab

This stack is only for sandboxed verification. It uses RT on `127.0.0.1:18082`.

Create a temporary root password in your shell and start the lab:

```bash
export RT_GATE_ROOT_PASSWORD="$(openssl rand -hex 24)"
docker compose -f infra/rt/gate-compose.yml up -d
```

Verify RT version in the lab:

```bash
docker compose -f infra/rt/gate-compose.yml exec rt perl -I/opt/rt/lib -MRT -e 'print $RT::VERSION'
```

Use this URL for the disposable lab:

- `RT_URL=http://127.0.0.1:18082`

If you are running the live Gmail matrix, keep test credentials in a local ignored file such as `/tmp/mockupai-gmail-gate.env`:

```bash
GMAIL_TEST_USER=
GMAIL_TEST_APP_PASSWORD=
GMAIL_TEST_USER_B=
GMAIL_TEST_APP_PASSWORD_B=
RT_URL=http://127.0.0.1:18082
RT_API_TOKEN=
```

Account B is only needed for cross-mailbox isolation proof. It must be a second disposable Gmail account with IMAP enabled and its own App Password.

## 3) Migration details

`npm run db:migrate:rt-gmail` runs `scripts/migrate-rt-gmail-mailboxes.sh`. The script:

- requires `DATABASE_URL`, `REDIS_URL`, `MASTER_ENCRYPTION_KEY`, `RT_URL`, and `RT_API_TOKEN`
- validates the Prisma schema
- deploys pending Prisma migrations, including `20260624090000_rt_getmail_gmail_mailboxes`
- regenerates the Prisma client
- creates `${MAILBOX_RUNTIME_DIR:-/var/lib/mockupai-mailboxes}/configs`, `/secrets`, and `/state` with safe permissions

It does not import old mailbox data. This is a clean RT/getmail replacement.

## 4) Operational notes

- Runtime secrets are rendered into `/run/mockupai-mailboxes` and mounted read-only into RT.
- Never commit Gmail App Passwords, RT API tokens, or root passwords into Git.
- Back up the PostgreSQL volume and `/opt/rt/var` regularly.
- Restore by stopping services, restoring PostgreSQL and `rt-var`, then starting RT before the worker.
- Rotate `RT_API_TOKEN` by creating a new RT token, updating the env file, and restarting the app and worker.

## 5) PM2 dev mode

This is the default local workflow for the app services:

1. Start the RT infrastructure with Docker Compose.
2. Start `mockupai` and `mockupai-worker` with PM2.
3. Run migrations from the repo root.
4. Verify the mailbox worker can reach RT and the Gmail tooling is available on the host.

When you use `./setup-dev.sh`, step 1 is handled by the script against the existing MockupAI database server instead of a separate RT Postgres container.
The script also runs the RT/Gmail migration. It intentionally leaves step 2 to your normal PM2 workflow.

Minimal bootstrap:

```bash
bash setup-dev.sh
pm2 start ecosystem.config.js
```

If PM2 launches the worker from a different working directory, keep `MAILBOX_SCRIPT_ROOT` pointed at the repo root so the mailbox runtime config resolves the helper scripts correctly.

# Triple Whale Sync From Date Design

## Goal

Let users choose how far back a newly connected Triple Whale shop should sync, and how often it should sync after the first import.

## Scope

- Add a `From date` field to the Add Triple Whale Shop modal.
- Add a `Sync every` interval field to the same modal.
- Store both settings on each Triple Whale credential.
- Use `From date` only when the credential has never synced before.
- Use `lastSyncedAt` for all later syncs.
- Enforce a minimum recurring sync interval of 30 minutes.

## Data Contract

`TripleWhaleCredential` stores:

- `syncFromDate`: date-only value used as the initial backfill start.
- `syncIntervalMinutes`: integer minutes between recurring syncs, default `30`, minimum `30`.

Existing credentials should get:

- `syncFromDate`: 90 days before migration/apply time, matching the current hard-coded backfill behavior.
- `syncIntervalMinutes`: `30`.

## UI Contract

The Add modal uses native browser inputs:

- `From date`: `<input type="date">`.
- `Sync every`: numeric input, default `30`, min `30`.

No custom date picker or scheduler UI is needed.

## Sync Behavior

When syncing one credential:

- If `lastSyncedAt` is null, use `syncFromDate`.
- If `lastSyncedAt` is present, use that date.
- End date remains today in the tenant Triple Whale timezone.

Manual `Sync now` only queues one immediate sync. It does not change `syncFromDate` or `syncIntervalMinutes`.

Recurring sync should queue credentials according to their configured interval, with 30 minutes as the lowest accepted value.

## Validation

API validation rejects:

- Missing or invalid `syncFromDate`.
- `syncIntervalMinutes` below `30`.

The UI should also prevent interval values below `30`, but server validation is the source of truth.

## Testing

Add focused source/unit coverage for:

- Schema fields and migration defaults.
- Create API accepting and validating `syncFromDate` and `syncIntervalMinutes`.
- Sync start date choosing `syncFromDate` only before first sync.
- UI payload includes both new fields.

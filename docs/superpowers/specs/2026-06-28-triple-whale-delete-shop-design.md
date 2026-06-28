# Triple Whale Delete Shop Design

## Goal

Let users remove a Triple Whale shop directly from the integrations table and clean all app-side data tied to that credential.

## Scope

- Add a visible destructive delete action on each Triple Whale shop row.
- Confirm before deleting.
- Delete all synced daily stats for the credential.
- Delete the credential.
- Remove pending BullMQ sync jobs for that credential.

## Behavior

The row delete action calls `DELETE /api/integrations/triple-whale/[id]`.

The API must:

1. Verify the credential belongs to the current tenant.
2. Remove queued Triple Whale jobs whose payload has the same `credentialId`.
3. Delete `TripleWhaleDailyStat` rows for the credential.
4. Delete `TripleWhaleCredential`.

Only pending queue states are removed. Active jobs are not killed; if one is already running after the credential is deleted, it will fail on missing credential and stop.

## UI

Use the existing table actions area. Add a trash icon button next to edit and sync. Use native `confirm()` for now.

## Testing

Add source-level coverage that:

- Table rows expose a delete action.
- Delete calls the existing DELETE endpoint.
- Backend delete removes daily stats, credential, and calls queue cleanup.

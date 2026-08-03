# POD trend-to-idea data contract

## Canonical flow

`pod-observation/v1` records are append-only capture events. The extension aggregates them and exports one `pod-keyword-signal/v1` line per normalized keyword. The skill produces `pod-idea-card/v1`.

CSV is a human-readable summary and is not a canonical skill input.

## Observation fields

| Field | Meaning |
|---|---|
| `observationId` | Deterministic identity for one captured event |
| `source` / `sourceType` | Platform and evidence surface |
| `keywordRaw` / `keywordNormalized` | Displayed phrase and normalized key |
| `query` | Input that produced the observation |
| `sourceUrl` | Traceable HTTP(S) page or endpoint |
| `capturedAt` | UTC capture timestamp |
| `locale`, `geo`, `geoConfidence` | Context, never inferred upward |
| `metrics` | Only values shown or returned by the source |
| `rawEvidence` | Raw labels/columns needed to audit parsing |
| `warnings` | Missing, approximate, lower-bound, or interpretation caveats |

## Important metric rules

- Autocomplete `rank` is relative within one captured query, not search volume.
- Google Trends `0–100` is relative to the term’s own peak in one geo/time context.
- Etsy `1,000+` means `value: 1000`, `isLowerBound: true`; it is not exact and produces no exact opportunity score.
- TikTok posts/views/growth are social attention, not purchase intent.
- Meta `daysAlive` is ad longevity, not sales, margin, or return on ad spend.
- Missing metrics are `null` or absent. They are never fabricated as zero.
- Weekly demand uses the best rank inside that week, not the lifetime best rank.

## Keyword signal

Each `pod-keyword-signal/v1` includes:

- stable keyword ID, aliases, first/last seen;
- source and observation counts;
- independent weekly snapshots;
- platform-specific signal envelopes;
- compact provenance entries;
- completeness and warning metadata.

## Idea status

- `hypothesis`: useful direction requiring evidence or risk review.
- `research-qualified`: buyer/product are clear, gates pass, and marketplace evidence has an independent supporting source.
- `rejected`: a hard IP/sensitive/commercial-clarity gate failed.

`research-qualified` does not mean commercially validated. Actual validation requires compliant testing and observed buyer behavior.

## Privacy

Do not export cookies, access tokens, authorization headers, account identifiers, usernames, avatars, or profile IDs. Preserve only evidence needed for keyword and idea research.

## Schema migration

Readers fail closed on unknown schema versions. A v2 migration must:

1. preserve original inputs;
2. map fields explicitly;
3. retain provenance and warnings;
4. record source/target versions and a content hash;
5. validate the migrated output before analysis.

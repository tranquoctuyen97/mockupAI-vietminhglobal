# Evidence policy

## Evidence classes

| Class | Supports | Does not prove |
|---|---|---|
| Autocomplete | Language people enter and relative rank within a capture | Absolute volume |
| Google Trends | Relative movement for one query, geo, and time range | Cross-query absolute demand |
| Etsy marketplace | Product competition and visible seller evidence | Exact competition when the count is capped |
| Social attention | Community language, cultural velocity, or visual direction | Purchase intent |
| Meta ad longevity | Campaign persistence | Sales, margin, or return on ad spend |

## Claim levels

- `observed`: directly present in an input record and linked to provenance.
- `inference`: a bounded interpretation supported by named observations.
- `recommendation`: a proposed action that still needs validation.

Never create a numeric metric that is absent from input. Preserve `null`, lower-bound flags, raw labels, warnings, geo confidence, and capture context.

An idea is `research-qualified`, not commercially validated. Commercial validation requires compliant marketplace/IP checks plus a real test such as impressions, clicks, add-to-cart, or purchases.

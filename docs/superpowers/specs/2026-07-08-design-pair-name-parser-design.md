# Design Pair Name Parser

## Goal

Allow wizard design pairing to understand customer file names where the light/dark marker appears near the beginning or at the end of the design name.

Examples that must pair:

- `1 - sáng` with `1 - tối`
- `ver sáng 1` with `ver tối 1`
- `ver_sang_tên mẫu` with `ver_toi_tên mẫu`
- `sáng tên mẫu` with `tối tên mẫu`
- `tên mẫu light` with `tên mẫu dark`

## Scope

- Change only the shared pairing parser in `src/lib/designs/design-pairing.ts`.
- Keep existing UI, draft persistence, publish flow, and database schema unchanged.
- Keep unmatched marker designs publishing as independent designs through the existing mixed-design behavior.

## Parser Contract

`parseDesignName()` strips file extension, tokenizes by the existing separators, normalizes Vietnamese accents, then detects light/dark markers in these positions:

1. Last token, preserving current suffix behavior.
2. First token.
3. One internal token when the remaining tokens form a usable base name.

Supported light markers remain `sang`, `light`, and `bright`; Vietnamese `sáng` works through accent normalization. Supported dark markers remain `toi` and `dark`; Vietnamese `tối` works through accent normalization.

When a marker is found, the base name is the original name with that marker token removed and surrounding separators normalized for matching. For `ver sáng 1` and `ver tối 1`, both normalize to base name `ver 1`.

If multiple marker tokens make the name ambiguous, the parser uses the first valid marker in token order. This keeps behavior deterministic without adding configuration.

## Verification

Add focused `node:test` cases in `src/lib/designs/design-pairing.test.ts` for:

- prefix Vietnamese names;
- internal Vietnamese names like `ver sáng 1`;
- underscore customer format like `ver_sang_tên mẫu`;
- existing suffix behavior, proving no regression.

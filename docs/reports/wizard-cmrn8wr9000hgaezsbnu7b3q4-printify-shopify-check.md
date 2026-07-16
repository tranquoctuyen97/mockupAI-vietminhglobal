# Wizard `cmrn8wr9000hgaezsbnu7b3q4` Printify/Shopify Check

Checked at: 2026-07-16 16:02 +07

Scope: read-only SSH check on `162.0.211.70` for this wizard only. No remote files, listings, Printify products, or Shopify products were modified.

## Summary

- Wizard status: `PUBLISHED`, step `5`.
- Store: `YarnMerch` / Shopify domain `bdfeb5-b0.myshopify.com`.
- Printify shop: `YarnVogue`, shop ID `17609997`, sales channel `shopify`.
- Related listing: `cmrn8z4r400i6aezsnylojhbi`, title `Knitting Social Anti Fascist T-shirt`, status `ACTIVE`.
- Shopify product: `gid://shopify/Product/8595382042785`, live status `active`.
- Printify product: `6a58964c050c9be5280c9778`, visible `true`.

## Result

### 1. Printify print area is not full

The live Printify product still uses the old placement values, not full-frame:

| Print area | Position | Image ID | x | y | scale | angle |
|---|---|---:|---:|---:|---:|---:|
| 0 | front | `6a5896457f5203639d2d3fbe` | `0.497` | `0.483` | `0.618` | `0` |
| 1 | front | `6a5896497f5203639d2d3fc1` | `0.497` | `0.483` | `0.618` | `0` |

Expected full test placement would be around `x=0.5`, `y=0.5`, `scale=1` for the simple full-width test. This wizard has `scale=0.618`, so it is not full.

The product has two Printify print areas because this is a paired/light-dark style listing:

- Area 0: `591` variants, front image `6a5896457f5203639d2d3fbe`.
- Area 1: `422` variants, front image `6a5896497f5203639d2d3fc1`.
- `back`, `left_sleeve`, and `right_sleeve` placeholders are present but have no images.

### 2. Shopify media-to-shirt-color association is semantically right, but option labels are swapped

Shopify has `8` images and `66` variants. Each image is associated with the variants for one shirt color via `variant_ids`.

Media order on Shopify:

| Image position | Inferred shirt color from associated variants | Variant count |
|---:|---|---:|
| 1 | Forest | 8 |
| 2 | Heather Team Purple | 8 |
| 3 | Athletic Heather | 8 |
| 4 | Black | 9 |
| 5 | Dark Grey Heather | 8 |
| 6 | Heather Navy | 8 |
| 7 | White | 9 |
| 8 | Heather Mauve | 8 |

So, the image attachment itself is grouped by the actual shirt color. The first Shopify media is `Forest`, and the first option value in the option that actually carries colors is also `Forest`.

Detailed Shopify media URLs by color:

| Position | Color | Shopify image ID | Variant count | Sizes covered | Shopify CDN URL |
|---:|---|---:|---:|---|---|
| 1 | Forest | `44398874099873` | 8 | XS, S, M, L, XL, 2XL, 3XL, 4XL | https://cdn.shopify.com/s/files/1/0643/4547/3185/files/cmrn8x7qm00i2aezsxsw9d13o-output.webp?v=1784190625 |
| 2 | Heather Team Purple | `44398873968801` | 8 | XS, S, M, L, XL, 2XL, 3XL, 4XL | https://cdn.shopify.com/s/files/1/0643/4547/3185/files/cmrn8x7qm00i4aezsr7ybvrnt-output.webp?v=1784190624 |
| 3 | Athletic Heather | `44398874001569` | 8 | XS, S, M, L, XL, 2XL, 3XL, 4XL | https://cdn.shopify.com/s/files/1/0643/4547/3185/files/cmrn8x7pz00hxaezsjitjuk65-output.webp?v=1784190625 |
| 4 | Black | `44398874067105` | 9 | XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL | https://cdn.shopify.com/s/files/1/0643/4547/3185/files/cmrn8x7qm00i1aezsssfungy4-output.webp?v=1784190625 |
| 5 | Dark Grey Heather | `44398874034337` | 8 | XS, S, M, L, XL, 2XL, 3XL, 4XL | https://cdn.shopify.com/s/files/1/0643/4547/3185/files/cmrn8x7qm00i0aezs0pi3nu9n-output.webp?v=1784190624 |
| 6 | Heather Navy | `44398874132641` | 8 | XS, S, M, L, XL, 2XL, 3XL, 4XL | https://cdn.shopify.com/s/files/1/0643/4547/3185/files/cmrn8x7qm00i3aezsb920kdhf-output.webp?v=1784190625 |
| 7 | White | `44398874198177` | 9 | XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL | https://cdn.shopify.com/s/files/1/0643/4547/3185/files/cmrn8x7pz00hyaezse58pbw5n-output.webp?v=1784190624 |
| 8 | Heather Mauve | `44398874165409` | 8 | XS, S, M, L, XL, 2XL, 3XL, 4XL | https://cdn.shopify.com/s/files/1/0643/4547/3185/files/cmrn8x7qm00i5aezsclxs49d8-output.webp?v=1784190625 |

Internal mockup source/composite paths by color:

| Color | Mockup source | Composite path |
|---|---|---|
| Forest | `mockup://library/cmr8rekmk004v8qzsdndu1guv/cmr8rejmf004e8qzsmr40x2mb` | `custom-mockups/renders/cmrn8x7qd00hzaezsulcm17xk/cmrn8x7qm00i2aezsxsw9d13o-output.webp` |
| Heather Team Purple | `mockup://library/cmr8reku4004w8qzsp4fanmyf/cmr8rejmj004g8qzsrqaz96bt` | `custom-mockups/renders/cmrn8x7qd00hzaezsulcm17xk/cmrn8x7qm00i4aezsr7ybvrnt-output.webp` |
| Athletic Heather | `mockup://library/cmr8rek22004s8qzsac3hi6se/cmr8rejm0004b8qzs0fnjxj4q` | `custom-mockups/renders/cmrn8x7pu00hwaezsif2m3a1s/cmrn8x7pz00hxaezsjitjuk65-output.webp` |
| Black | `mockup://library/cmr8rekft004u8qzspn1jr1qq/cmr8rejmb004d8qzsix2181ab` | `custom-mockups/renders/cmrn8x7qd00hzaezsulcm17xk/cmrn8x7qm00i1aezsssfungy4-output.webp` |
| Dark Grey Heather | `mockup://library/cmr8rek8w004t8qzst9qik7id/cmr8rejm8004c8qzssn3j1bem` | `custom-mockups/renders/cmrn8x7qd00hzaezsulcm17xk/cmrn8x7qm00i0aezs0pi3nu9n-output.webp` |
| Heather Navy | `mockup://library/cmr8rel0s004x8qzsewi55hcj/cmr8rejmh004f8qzsowk0mm8f` | `custom-mockups/renders/cmrn8x7qd00hzaezsulcm17xk/cmrn8x7qm00i3aezsb920kdhf-output.webp` |
| White | `mockup://library/cmr8relgs004z8qzs3wunt206/cmr8rejmm004i8qzskt7uqra4` | `custom-mockups/renders/cmrn8x7pu00hwaezsif2m3a1s/cmrn8x7pz00hyaezse58pbw5n-output.webp` |
| Heather Mauve | `mockup://library/cmr8rel84004y8qzsvkvaxpur/cmr8rejml004h8qzsdoejs58f` | `custom-mockups/renders/cmrn8x7qd00hzaezsulcm17xk/cmrn8x7qm00i5aezsclxs49d8-output.webp` |

However, the option names on Shopify are swapped:

```text
Option 1 name: Size
Option 1 values: Forest, Heather Team Purple, Athletic Heather, Black, Dark Grey Heather, Heather Navy, White, Heather Mauve

Option 2 name: Color
Option 2 values: XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL
```

This means the data values are in the correct order for the color dimension, but Shopify labels that dimension as `Size`. The option named `Color` currently contains sizes.

### 3. DB listing variant mapping matches Shopify IDs/SKUs, but not Shopify option names

DB has `66` listing variants for this listing. Shopify also has `66` variants.

The DB mapping by Shopify variant ID and SKU is present. Example:

| DB color | DB size | Shopify title | Shopify option1 | Shopify option2 |
|---|---|---|---|---|
| Forest | XS | Forest / XS | Forest | XS |
| Athletic Heather | XS | Athletic Heather / XS | Athletic Heather | XS |
| Black | XS | Black / XS | Black | XS |

The values match the Shopify variant title, but because Shopify option labels are swapped, Shopify reports:

- `option1 = Forest`, but option 1 is named `Size`.
- `option2 = XS`, but option 2 is named `Color`.

So if the UI reads by option label, color/size will appear wrong. If it reads by variant title/value order, the actual values are still color then size.

## Final Answer

- Printify full-frame check: **Not passed**. Current placement is `scale=0.618`, not full.
- Shopify media/color match check: **Partially passed**. Media is associated with the correct shirt-color variant groups, but Shopify option names are reversed (`Size` contains colors, `Color` contains sizes), so the variant Color option is not correct.

## Evidence Commands

- Read-only DB query via Prisma raw SQL for wizard/listing/variants/mockups.
- Read-only Printify API `GET /v1/shops/17609997/products/6a58964c050c9be5280c9778.json`.
- Read-only Shopify Admin REST `GET /admin/api/2025-04/products/8595382042785.json`.
- Context7 checked Shopify REST docs for product images/variants fields before using `variant_ids` and variant `image_id`.

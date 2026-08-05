---
name: pod-competitor-ad-intelligence
description: Analyze POD competitor website/ad research run folders exported from the POD Trend Harvester. Use when the user provides competitor website snapshots, advertiser candidates, ad observations, change logs, or asks for observed/derived/inferred competitor ad intelligence, creative-family grouping, offer changes, or ad strategy reports.
---

# POD Competitor Ad Intelligence

Turn exported competitor run folders into evidence-backed ad and funnel reports.

## Workflow

1. Run `scripts/validate-input.mjs <run-folder>` before analysis.
2. If comparing runs, run `scripts/compare-runs.mjs` or use `compareRuns(previous, current)`.
3. Group ad observations with `scripts/group-creative-families.mjs`.
4. Write the report with `scripts/write-report.mjs`.
5. Preserve every claim back to an observation ID, URL and capture date.

Read `references/evidence-policy.md` before interpreting strategy.

## Rules

- Do not crawl sources. Consume only exported files.
- Do not invent missing metrics. Missing means `null` or a warning.
- Keep facts, derived changes and inferences separate.
- Never state spend, targeting, bid, ROAS, revenue, margin or profit as observed fact.
- Treat Meta, Google and TikTok public ad libraries as partial public evidence.
- Treat TikTok Top Ads as a selected collection, not all ads from that advertiser.
- Do not copy competitor artwork or protected copy; extract reusable principles only.

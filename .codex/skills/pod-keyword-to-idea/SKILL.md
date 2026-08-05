---
name: pod-keyword-to-idea
description: Use when the user provides POD keyword or trend JSONL and wants evidence-backed product ideas, clustering, risk screening, or a research shortlist.
---

# POD Keyword to Idea

Turn canonical `pod-keyword-signal/v1` JSONL into traceable POD idea hypotheses.

## Required workflow

1. Run `scripts/validate-input.mjs` on every input file. Stop on unknown schemas or invalid lines.
2. Run `scripts/normalize-input.mjs` to deduplicate the inputs.
3. Run `scripts/cluster-keywords.mjs` and retain every member keyword ID and source.
4. Create idea cards that follow `schemas/pod-idea-card-v1.schema.json`.
5. Run `scripts/evaluate-gates.mjs` before choosing a shortlist.
6. Run `scripts/write-run-artifacts.mjs` to write the complete run.

Do not crawl sources. Do not invent, repair, or estimate missing metrics. Treat social attention, ad longevity, marketplace evidence, and purchase intent as different evidence classes.

Read:

- `references/evidence-policy.md` before interpreting signals.
- `references/pod-idea-framework.md` before clustering or creating ideas.
- `references/risk-gates.md` before assigning status.

## Output contract

Write all seven run artifacts under `output/pod-idea-runs/<run-id>/`. A shortlisted idea must link to keyword IDs and source types. Label claims as observed fact, inference, or recommendation.

## Common mistakes

- Treating TikTok views, Reddit votes, or Pinterest saves as buying demand.
- Treating Meta ad longevity as proof of sales.
- Treating Etsy `1,000+` as an exact competition count.
- Combining broad, humor, gift, and personalization intent into one cluster.
- Hiding rejected ideas from the run artifacts.

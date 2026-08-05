# POD trend-to-idea runbook

## 1. Capture

1. Load `tools/POD all /pod-trend-harvester` from `edge://extensions`.
2. Start with small queues and the intended US context.
3. Capture Etsy/Google autocomplete, then enrich selected keywords with Etsy SERP and Google Trends.
4. Capture TikTok and Meta as supporting evidence only.
5. Review the Health tab after each source.

Do not change VPN/session mid-capture without starting a new run context. Record whether geo is explicit, page-derived, IP-derived, or unknown.

## 2. Export

In Keywords, choose `Export POD keyword signals (JSONL)`. Keep both downloaded files:

- `pod-keyword-signals-YYYY-MM-DD.jsonl`
- `pod-keyword-signals-YYYY-MM-DD-run-manifest.json`

Use CSV only for review.

## 3. Run the skill

Invoke `$pod-keyword-to-idea` with one or more JSONL paths. The skill validates all lines, deduplicates inputs, clusters business intent, creates distinct creative mechanics, applies gates, and writes:

1. `input-manifest.json`
2. `normalized-keywords.jsonl`
3. `clusters.jsonl`
4. `idea-candidates.jsonl`
5. `idea-rejected.jsonl`
6. `idea-shortlist.md`
7. `run-manifest.json`

## 4. Read the result

Start with `idea-shortlist.md`, then trace each shortlisted idea through `seedKeywordIds` into normalized keywords and provenance URLs. Review `idea-rejected.jsonl`; rejection is retained for audit and learning.

Before production, perform official IP/policy checks and a real buyer/listing test.

## Troubleshooting

| Symptom | Action |
|---|---|
| Parser returns no rows | Check Health, page login/gating, selector drift, and the Edge checklist |
| Etsy shows `1,000+` | Treat as lower bound; do not restore exact-score thresholds |
| Geo missing | Keep `null`/warning; rerun with explicit US selector if the source supports it |
| Worker restarted | Confirm the last flushed batch exists; rerun only the missing capture |
| JSONL line corrupt | Validator reports file and line; fix/export again, never skip silently |
| Unknown schema | Run an explicit migration; do not rename fields by guesswork |
| Social trend dominates | Keep it as hypothesis until marketplace/buyer evidence exists |

## Verification

Automated:

```bash
cd 'tools/POD all /pod-trend-harvester'
npm test

cd '/Users/tuyen.tq/Documents/freelancer/vietminhglobal/app'
node --test .codex/skills/pod-keyword-to-idea/tests/*.test.mjs
```

Real-page verification follows `tools/POD all /pod-trend-harvester/MANUAL-TEST-CHECKLIST.md`.

For source expansion and competitor research:

- Use `tools/POD all /pod-trend-harvester/SOURCE-REGION-MATRIX.md` before declaring a social source real-page verified.
- Use `tools/POD all /pod-trend-harvester/COMPETITOR-MANUAL-TEST.md` for competitor website/ad evidence.
- Instagram remains disabled until its feasibility gate passes.
- Competitor reports must separate observed facts, derived changes, and inferences. Public ad libraries do not expose spend, targeting, ROAS, revenue, margin, or profit.

# POD Trend-to-Idea Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Track progress with the checkboxes below.

**Goal:** Biến dữ liệu keyword/trend và bằng chứng website/quảng cáo đối thủ do
extension thu thập thành một luồng có thể kiểm chứng; sau đó dùng các skill
chuyên biệt để tạo POD idea và phân tích chiến lược competitor có nguồn gốc rõ
ràng.

**Architecture:** Extension chỉ thu thập và chuẩn hóa tín hiệu từ từng nền tảng,
website và public ad library. Extension xuất các hợp đồng JSONL có version,
provenance và cảnh báo chất lượng. Skill `pod-keyword-to-idea` xử lý keyword/trend;
skill `pod-competitor-ad-intelligence` xử lý website/ad snapshots và change log.
V1 dùng file handoff, chưa dùng native messaging hoặc RPC trực tiếp giữa
Chrome/Edge extension và Codex.

**Tech Stack:** Chrome/Edge Manifest V3, vanilla JavaScript ES modules, `chrome.storage.local`, Node.js built-in test runner, JSON/JSONL, JSON Schema, Codex `SKILL.md`.

---

## 1. Kết quả cần đạt

Sau khi hoàn thành, một lượt chạy chuẩn sẽ tạo luồng:

```text
Etsy / Google / TikTok / Google Trends / Meta
                    |
                    v
         Source observations có provenance
                    |
                    v
       Keyword signal records đã aggregate
                    |
                    v
       pod-keyword-signals-v1.jsonl
                    |
                    v
          Skill pod-keyword-to-idea
                    |
        +-----------+-------------+
        |                         |
        v                         v
idea-candidates.jsonl      idea-rejected.jsonl
        |
        v
idea-shortlist.md + run-manifest.json
```

Một idea được đưa vào shortlist phải trả lời được:

1. Keyword/audience nào tạo ra idea?
2. Tín hiệu đến từ nền tảng nào, URL/query nào, lúc nào?
3. Đây là tín hiệu trend, search intent, marketplace competition hay ad longevity?
4. Vì sao người mua sẽ mua sản phẩm này?
5. Thiết kế có đủ cụ thể để triển khai không?
6. Có rủi ro trademark/copyright, nội dung nhạy cảm hoặc claim y tế không?
7. Trạng thái hiện tại là hypothesis hay research-qualified?

## 2. Quyết định kiến trúc

### 2.1. Ranh giới trách nhiệm

**Extension chịu trách nhiệm:**

- Mở đúng nguồn và thu thập dữ liệu.
- Lưu observation thô có provenance.
- Chuẩn hóa kiểu dữ liệu nhưng không diễn giải quá mức.
- Aggregate observation thành keyword signal.
- Xuất JSONL/backup để skill dùng.
- Cho biết dữ liệu nào thiếu, bị capped hoặc chưa xác minh.

**Skill chịu trách nhiệm:**

- Validate file đầu vào.
- Dedupe và cluster keyword theo ngữ nghĩa kinh doanh.
- Tổng hợp evidence nhưng không tự bịa metric.
- Tạo các POD concept khác nhau.
- Áp dụng hard gate và xếp hạng.
- Sinh shortlist, candidates, rejected và run manifest.

**Không nằm trong v1:**

- Extension tự gọi LLM.
- Skill tự crawl Etsy/TikTok/Facebook/Meta.
- Native messaging giữa trình duyệt và Codex.
- Tự publish listing hoặc tự chạy ads.
- Khẳng định lợi nhuận chỉ từ tuổi quảng cáo, lượt xem hoặc search interest.

**Nằm trong v1.1 sau khi core v1 đạt checkpoint:**

- Reddit để lấy community language, pain point, insider joke và niche velocity.
- Pinterest để lấy visual aesthetic, seasonal planning và related search.
- YouTube để lấy autocomplete, content longevity và video-language signal.
- X.com để lấy cultural velocity, breaking event, sports và meme spike.
- Instagram/Reels là nguồn cuối cùng vì phụ thuộc login và DOM biến động mạnh.

Không triển khai đồng thời năm adapter. Mỗi adapter phải vượt qua live-page feasibility
gate, có fixture và xuất được cùng `pod-observation/v1` trước khi chuyển sang nguồn
tiếp theo.

### 2.2. File handoff thay vì gọi extension trực tiếp

V1 dùng JSONL vì:

- Có thể resume và xử lý lại mà không crawl lại.
- Dễ kiểm tra từng dòng và truy nguyên nguồn.
- Skill không phụ thuộc trạng thái service worker của Manifest V3.
- Có thể version schema và migration.
- Dễ tạo fixture cho test end-to-end.

Khi v1 ổn định mới đánh giá v2 direct handoff. Nếu làm v2, extension chỉ phát file hoặc đăng ký run; skill vẫn phải chấp nhận file độc lập.

### 2.3. Trạng thái idea

Chỉ dùng các trạng thái:

- `raw-signal`: mới có tín hiệu nguồn, chưa hình thành luận điểm idea.
- `hypothesis`: đã có audience/buyer/occasion/product hypothesis nhưng evidence còn yếu.
- `research-qualified`: đã qua source, intent, product-fit, creative-depth và risk gate.
- `rejected`: bị hard gate hoặc evidence không đủ.

Không dùng `validated` trong pipeline này. Chỉ được gọi là validated khi có bằng chứng mua thật và contribution dương sau chi phí sản xuất, shipping, refund, ads và fee.

## 3. Quy tắc dữ liệu bắt buộc

### 3.1. Không trộn metric khác bản chất

- Google Trends `0–100` là chỉ số tương đối trong chính truy vấn/khoảng thời gian/địa lý, không phải search volume tuyệt đối.
- TikTok views/posts là social attention, không phải purchase intent.
- Meta `daysAlive` là ad longevity, không phải lợi nhuận.
- Etsy listing count bị hiển thị `1,000+` phải lưu dưới dạng lower bound, không được coi là chính xác `1000`.
- Etsy reviews/bestseller/price/ad ratio là marketplace evidence, không thay thế sales thật.

### 3.2. `null`, `0` và unknown

- `0` chỉ dùng khi nguồn thực sự trả về zero.
- Không thu được dữ liệu phải là `null`.
- Bị giới hạn phải có `isCapped: true` hoặc `isLowerBound: true`.
- Parser không chắc phải thêm warning, không được silently fallback thành `0`.

### 3.3. Provenance

Mỗi observation tối thiểu phải có:

```json
{
  "observationId": "obs_...",
  "source": "etsy-autocomplete",
  "sourceType": "autocomplete",
  "keywordRaw": "funny nurse shirt",
  "keywordNormalized": "funny nurse shirt",
  "query": "funny nurse",
  "sourceUrl": "https://...",
  "capturedAt": "2026-07-31T00:00:00.000Z",
  "locale": "en-US",
  "geo": "US",
  "geoConfidence": "explicit",
  "metrics": {},
  "warnings": []
}
```

Không được chỉ giữ `bestRank`, `hits` và `lastSeen` vì như vậy không tái dựng được lịch sử.

## 4. Schema đích

### 4.1. Observation record

Tạo schema version `pod-observation/v1`:

```js
{
  schemaVersion: "pod-observation/v1",
  observationId: string,
  source: string,
  sourceType: string,
  keywordRaw: string | null,
  keywordNormalized: string | null,
  query: string | null,
  sourceUrl: string,
  capturedAt: ISODateString,
  locale: string | null,
  geo: string | null,
  geoConfidence: "explicit" | "page" | "ip-derived" | "unknown",
  metrics: object,
  rawEvidence: object | null,
  warnings: string[]
}
```

### 4.2. Keyword signal record

Tạo schema version `pod-keyword-signal/v1`:

```js
{
  schemaVersion: "pod-keyword-signal/v1",
  keywordId: string,
  keyword: string,
  aliases: string[],
  firstSeenAt: ISODateString,
  lastSeenAt: ISODateString,
  sourceSummary: {
    sourceCount: number,
    observationCount: number,
    sources: string[]
  },
  weekly: [
    {
      week: "YYYY-Www",
      sources: {
        "etsy-autocomplete": {
          hits: number,
          bestRank: number | null
        }
      }
    }
  ],
  platformSignals: {
    autocomplete: object | null,
    googleTrends: object | null,
    etsyMarketplace: object | null,
    tiktok: object | null,
    metaAds: object | null
  },
  provenance: [
    {
      observationId: string,
      source: string,
      query: string | null,
      sourceUrl: string,
      capturedAt: ISODateString
    }
  ],
  quality: {
    completeness: number,
    warnings: string[]
  }
}
```

### 4.3. Idea card

Tạo schema version `pod-idea-card/v1`:

```js
{
  schemaVersion: "pod-idea-card/v1",
  ideaId: string,
  status: "hypothesis" | "research-qualified" | "rejected",
  title: string,
  clusterId: string,
  seedKeywordIds: string[],
  audience: string,
  buyer: string,
  wearerOrUser: string,
  occasion: string | null,
  emotion: string,
  productTypes: string[],
  conceptType:
    "text-led" |
    "illustration-led" |
    "personalization" |
    "gift-occasion" |
    "identity-insider",
  creativeBrief: {
    hook: string,
    visualDirection: string,
    typography: string | null,
    personalizationFields: string[],
    avoid: string[]
  },
  evidence: {
    supportingKeywordIds: string[],
    sourceTypes: string[],
    reasons: string[],
    caveats: string[]
  },
  scores: {
    sourceDiversity: number,
    recency: number,
    purchaseIntent: number,
    marketplaceEvidence: number,
    trendSustainability: number,
    buyerClarity: number,
    productFit: number,
    creativeDepth: number,
    risk: number
  },
  gates: {
    ipRisk: "pass" | "review" | "fail",
    sensitiveContent: "pass" | "review" | "fail",
    buyerClarity: "pass" | "fail",
    productFit: "pass" | "fail",
    creativeDepth: "pass" | "fail",
    singleSourceTrend: "pass" | "review" | "fail"
  },
  rejectionReasons: string[],
  generatedAt: ISODateString
}
```

Không tạo một “magic score” duy nhất để che mất bản chất dữ liệu. Shortlist dùng hard gate trước, sau đó so sánh vector score và giải thích.

### 4.4. Social trend observation

Các nguồn social mới vẫn dùng envelope `pod-observation/v1`, nhưng `metrics` phải
theo taxonomy dưới đây:

```js
{
  schemaVersion: "pod-observation/v1",
  source: "reddit" | "pinterest" | "youtube" | "x" | "instagram",
  sourceType:
    "community-language" |
    "visual-aesthetic" |
    "creator-video" |
    "cultural-velocity",
  keywordRaw: string,
  keywordNormalized: string,
  query: string | null,
  sourceUrl: string,
  capturedAt: ISODateString,
  locale: "en-US" | null,
  geo: "US" | null,
  geoConfidence: "explicit" | "page" | "ip-derived" | "unknown",
  metrics: {
    rank: number | null,
    displayedVolume: number | null,
    displayedVolumeLabel: string | null,
    growth: number | null,
    engagement: number | null,
    contentCount: number | null,
    communityCount: number | null,
    publishedAt: ISODateString | null,
    contentAgeHours: number | null
  },
  rawEvidence: {
    title: string | null,
    snippet: string | null,
    community: string | null,
    category: string | null,
    relatedTerms: string[]
  },
  warnings: string[]
}
```

Quy tắc:

- Không map mọi nền tảng vào cùng một `volume`.
- Chỉ điền metric mà trang thực sự hiển thị.
- Không tự tính velocity nếu thiếu timestamp hoặc cửa sổ thời gian.
- Không lưu username/avatar/profile ID vì không cần cho idea research.
- `community-language` và `visual-aesthetic` là evidence class, không phải
  purchase intent.
- X/TikTok viral signal chỉ giúp phát hiện văn hóa đang chuyển động; để lên
  `research-qualified` vẫn cần source thứ hai và buyer/product evidence.

### 4.5. Source priority và vai trò

| Thứ tự | Source | Evidence class chính | Giá trị cho POD | Không được suy diễn |
|---:|---|---|---|---|
| 1 | Reddit | Community language | Niche, joke, pain point, buyer vocabulary | Upvote = purchase intent |
| 2 | Pinterest | Visual aesthetic | Style, màu, occasion, seasonal planning | Save = sale |
| 3 | YouTube | Creator video | Chủ đề bền hơn, hobby/fandom language | View = demand sản phẩm |
| 4 | X.com | Cultural velocity | News, sports, meme, event spike | Trend = idea an toàn/IP-safe |
| 5 | Instagram | Visual/creator | Fashion, Reels, audio, lifestyle | Reel reach = marketplace demand |

WhatsApp, Snapchat, Discord, Threads, Bluesky và Truth Social không nằm trong
v1.1. Lý do là public trend surface yếu/khó kiểm chứng, quyền truy cập hạn chế
hoặc giá trị tăng thêm thấp hơn năm nguồn trên.

## 5. File map dự kiến

### Extension hiện tại

Thư mục hiện tại có tên `tools/POD all ` với một dấu cách ở cuối. Không đổi tên thư mục này trong scope v1 để tránh làm hỏng đường dẫn ngoài repo.

```text
tools/POD all /pod-trend-harvester/
├── manifest.json
├── package.json
├── README.md
├── background.js
├── lib/
│   ├── normalize.js
│   ├── queryPlan.js
│   ├── score.js
│   ├── store.js
│   ├── observations.js              # new
│   ├── aggregate.js                 # new
│   ├── schemas.js                   # new
│   └── export.js                    # new
├── content/
│   ├── etsy.js
│   ├── gtrends.js
│   ├── meta-adlib.js
│   └── tiktok-cc.js
├── app/
│   ├── app.js
│   ├── app.html
│   └── app.css
└── tests/
    ├── fixtures/                    # new
    ├── observations.test.js         # new
    ├── aggregate.test.js            # new
    ├── export.test.js               # new
    ├── source-registry.test.js       # new in v1.1
    ├── reddit.test.js                # new in v1.1
    ├── pinterest.test.js             # new in v1.1
    ├── youtube.test.js               # new in v1.1
    ├── x.test.js                     # new in v1.1
    ├── instagram.test.js             # new in v1.1
    └── existing tests
```

Source adapters v1.1:

```text
tools/POD all /pod-trend-harvester/
├── content/
│   ├── reddit.js
│   ├── pinterest.js
│   ├── youtube.js
│   ├── x.js
│   └── instagram.js
└── lib/
    ├── sourceRegistry.js
    └── socialSignals.js
```

### Skill mới, lưu cùng repo

```text
.codex/skills/pod-keyword-to-idea/
├── SKILL.md
├── schemas/
│   ├── pod-keyword-signal-v1.schema.json
│   └── pod-idea-card-v1.schema.json
├── scripts/
│   ├── validate-input.mjs
│   ├── normalize-input.mjs
│   ├── cluster-keywords.mjs
│   ├── evaluate-gates.mjs
│   └── write-run-artifacts.mjs
├── references/
│   ├── evidence-policy.md
│   ├── pod-idea-framework.md
│   └── risk-gates.md
├── templates/
│   └── idea-shortlist.md
└── tests/
    ├── fixtures/
    ├── validate-input.test.mjs
    ├── cluster-keywords.test.mjs
    └── evaluate-gates.test.mjs
```

### Output của mỗi run

```text
output/pod-idea-runs/<run-id>/
├── input-manifest.json
├── normalized-keywords.jsonl
├── clusters.jsonl
├── idea-candidates.jsonl
├── idea-rejected.jsonl
├── idea-shortlist.md
└── run-manifest.json
```

## 6. Kế hoạch triển khai chi tiết

### Task 1: Đóng băng baseline và sửa test command

**Files:**

- Modify: `tools/POD all /pod-trend-harvester/package.json`
- Modify: `tools/POD all /pod-trend-harvester/README.md`
- Create: `tools/POD all /pod-trend-harvester/tests/baseline.test.js`

- [ ] Ghi lại các nguồn hiện có và field thực tế đang thu được.
- [ ] Đổi test command từ cách truyền cả thư mục sang glob file test tương thích Node hiện tại.
- [ ] Thêm baseline test xác nhận các module hiện tại load được.
- [ ] Xóa các tuyên bố test/real-page verification mâu thuẫn trong README.
- [ ] Ghi rõ Meta và TikTok đã test bằng fixture hay real page.

**Verification:**

```bash
cd 'tools/POD all /pod-trend-harvester'
npm test
node --check background.js
node --check app/app.js
```

**Acceptance:**

- Test suite hiện tại chạy xanh.
- README không còn hai kết luận trái ngược về real-page verification.
- Không thay đổi behavior crawl ở task này.

### Task 2: Định nghĩa schema và validation utilities

**Files:**

- Create: `tools/POD all /pod-trend-harvester/lib/schemas.js`
- Create: `tools/POD all /pod-trend-harvester/tests/schemas.test.js`
- Create: `.codex/skills/pod-keyword-to-idea/schemas/pod-keyword-signal-v1.schema.json`
- Create: `.codex/skills/pod-keyword-to-idea/schemas/pod-idea-card-v1.schema.json`

- [ ] Định nghĩa constants cho schema version.
- [ ] Viết validator nhẹ cho extension, không kéo dependency nặng vào content script.
- [ ] Viết JSON Schema đầy đủ cho skill.
- [ ] Quy định field required, enum, nullable và timestamp.
- [ ] Quy định `additionalProperties` phù hợp: strict ở envelope, linh hoạt có kiểm soát ở `metrics`.
- [ ] Thêm test cho record hợp lệ, thiếu URL, timestamp sai, metric không chắc nhưng bị ghi `0`.

**Test first example:**

```js
test("rejects an observation without provenance URL", () => {
  const result = validateObservation({
    schemaVersion: "pod-observation/v1",
    observationId: "obs_1"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /sourceUrl/);
});
```

**Acceptance:**

- Extension và skill dùng cùng tên field, enum và schema version.
- Invalid record không được export silently.

### Task 3: Chuyển storage sang append-only observations

**Files:**

- Create: `tools/POD all /pod-trend-harvester/lib/observations.js`
- Modify: `tools/POD all /pod-trend-harvester/lib/store.js`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Create: `tools/POD all /pod-trend-harvester/tests/observations.test.js`

- [ ] Tạo stable `observationId` từ source, keyword, query, URL và captured timestamp/bucket.
- [ ] Append observation thay vì chỉ cập nhật lifetime best.
- [ ] Dedupe event lặp lại trong cùng capture bằng deterministic key.
- [ ] Giữ backward-compatible read với record cũ.
- [ ] Thêm storage migration marker; không xóa dữ liệu cũ.
- [ ] Thêm warning khi locale/geo không xác định.
- [ ] Batch write để tránh ghi `chrome.storage.local` quá nhiều lần.

**Acceptance:**

- Hai tuần có rank khác nhau tạo hai weekly observation.
- Chạy lại cùng capture không nhân đôi record.
- Dữ liệu cũ vẫn mở được.
- Không có migration phá hủy dữ liệu.

### Task 4: Sửa weekly aggregation và delta

**Files:**

- Create: `tools/POD all /pod-trend-harvester/lib/aggregate.js`
- Modify: `tools/POD all /pod-trend-harvester/lib/score.js`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Create: `tools/POD all /pod-trend-harvester/tests/aggregate.test.js`

- [ ] Aggregate `hits`, `bestRank`, source count theo ISO week.
- [ ] Tính delta từ hai weekly buckets độc lập.
- [ ] Không dùng lifetime `Math.min(bestRank)` để đại diện tuần mới.
- [ ] Cho phép demand giảm.
- [ ] Ghi `insufficientHistory` nếu chưa đủ hai tuần.
- [ ] Tách raw weekly evidence khỏi derived heuristic.

**Required test:**

```js
test("weekly demand can decline", () => {
  const weeks = aggregateWeekly([
    observation({ week: "2026-W30", rank: 1 }),
    observation({ week: "2026-W31", rank: 9 })
  ]);

  assert.ok(weeks[1].demand < weeks[0].demand);
  assert.ok(computeWeeklyDelta(weeks) < 0);
});
```

**Acceptance:**

- Có test chứng minh rising, flat và declining.
- Record chỉ có một tuần không bị gán tăng trưởng giả.

### Task 5: Sửa mô hình Etsy competition

**Files:**

- Modify: `tools/POD all /pod-trend-harvester/content/etsy.js`
- Modify: `tools/POD all /pod-trend-harvester/lib/score.js`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Create: `tools/POD all /pod-trend-harvester/tests/etsy-competition.test.js`

- [ ] Parse listing text thành `value`, `isCapped`, `isLowerBound`, `rawText`.
- [ ] Với `1,000+`, lưu `value: 1000`, `isLowerBound: true`, không coi là exact.
- [ ] Không tính exact opportunity score khi competition bị capped.
- [ ] Bổ sung profile: median top reviews, bestseller count, ad ratio, shop concentration, title similarity nếu DOM có đủ evidence.
- [ ] Nếu selector thiếu, để `null` và warning.
- [ ] Bỏ label dựa trên ngưỡng `<5000`/`>20000` khi input chỉ là `1000+`.

**Acceptance:**

- `1,000+` không bị phân loại là competition thấp.
- UI/CSV/JSON đều thể hiện đây là lower bound.
- Parser fixture có cả exact, capped và missing cases.

### Task 6: Giữ đầy đủ metric TikTok và sửa source semantics

**Files:**

- Modify: `tools/POD all /pod-trend-harvester/content/tiktok-cc.js`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.js`
- Create: `tools/POD all /pod-trend-harvester/tests/tiktok-metrics.test.js`

- [ ] Không discard `cols` sau parser.
- [ ] Map các cột có nhãn rõ ràng thành posts/views/rank/growth khi có.
- [ ] Lưu raw columns nếu mapping không chắc.
- [ ] Đổi tên `/trends/video` thành `tiktok-trending-video`, không gọi là keyword insights.
- [ ] Tách hashtag trends và trending videos thành source types khác nhau.
- [ ] Ghi rõ social attention không tương đương purchase intent.

**Acceptance:**

- Fixture có views/posts sau khi đi qua handler vẫn còn nguyên.
- UI không còn gắn nhãn sai “keyword” cho video trends.
- Unknown column không bị mất.

### Task 7: Promote Google Trends related queries thành keyword candidates

**Files:**

- Modify: `tools/POD all /pod-trend-harvester/content/gtrends.js`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Create: `tools/POD all /pod-trend-harvester/tests/gtrends-related.test.js`

- [ ] Giữ time series và context geo/time range.
- [ ] Tạo observation riêng cho top/rising query.
- [ ] Link child query với parent seed bằng `derivedFromKeyword`.
- [ ] Giữ breakout/value/raw label.
- [ ] Không dùng Trends 0–100 để so absolute demand giữa các query khác context.
- [ ] Thêm warning khi geo là IP-derived hoặc unknown.

**Acceptance:**

- Rising query xuất hiện thành keyword signal riêng.
- Parent-child provenance còn nguyên.
- Không có field tên `searchVolume` lấy từ Trends interest.

### Task 8: Sửa ý nghĩa Meta Ad Library

**Files:**

- Modify: `tools/POD all /pod-trend-harvester/content/meta-adlib.js`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.js`
- Modify: `tools/POD all /pod-trend-harvester/README.md`
- Create: `tools/POD all /pod-trend-harvester/tests/meta-semantics.test.js`

- [ ] Đổi label “profitability signal/hot” thành “ad longevity signal”.
- [ ] Lưu query, source URL, page, library ID, started date, capture date, variants và destination.
- [ ] Link ad evidence với keyword bằng explicit query/keyword mapping.
- [ ] Không tự kết luận active lâu là có lời.
- [ ] Nếu ad không còn active hoặc start date thiếu, ghi `null` + warning.

**Acceptance:**

- Không còn chuỗi “profitability” trong UI, source và docs.
- `daysAlive` chỉ xuất hiện trong Meta evidence.
- Idea report mô tả nó là longevity/campaign persistence.

### Task 9: Tạo export idea-ready JSONL

**Files:**

- Create: `tools/POD all /pod-trend-harvester/lib/export.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.html`
- Create: `tools/POD all /pod-trend-harvester/tests/export.test.js`

- [ ] Thêm nút export `POD keyword signals (JSONL)`.
- [ ] Một dòng là một `pod-keyword-signal/v1`.
- [ ] Export kèm `run-manifest.json`: schema, extension version, exportedAt, record count, source counts, warning counts.
- [ ] Sort deterministic theo keyword ID.
- [ ] Không truncate trend series hoặc provenance trong JSONL.
- [ ] Giữ CSV cho người xem nhưng ghi rõ CSV là summary, không phải canonical input.
- [ ] Sanitize filename và không đưa token/cookie/local storage secrets vào export.

**Acceptance:**

- Export → parse → export lại cho ra record tương đương.
- Record count và manifest count khớp.
- Input ẩn danh/thiếu metric không làm crash.

### Task 10: Tạo scaffold skill và input validator

**Files:**

- Create: `.codex/skills/pod-keyword-to-idea/SKILL.md`
- Create: `.codex/skills/pod-keyword-to-idea/scripts/validate-input.mjs`
- Create: `.codex/skills/pod-keyword-to-idea/scripts/normalize-input.mjs`
- Create: `.codex/skills/pod-keyword-to-idea/references/evidence-policy.md`
- Create: `.codex/skills/pod-keyword-to-idea/tests/validate-input.test.mjs`

- [ ] Viết trigger: dùng khi user đưa JSONL keyword/trend và muốn tạo POD idea.
- [ ] Ghi rõ skill không crawl nguồn và không tự thêm metric.
- [ ] Validate toàn bộ file theo dòng, báo line number cho lỗi.
- [ ] Chấp nhận nhiều file và dedupe bằng `keywordId` + provenance.
- [ ] Sinh input manifest với SHA-256, số record, schema versions.
- [ ] Fail closed với schema lạ; hướng dẫn migration thay vì đoán field.

**Acceptance:**

- File hợp lệ được normalize.
- File lỗi báo đúng line và field.
- Chạy lại cùng input tạo cùng normalized records.

### Task 11: Dedupe và cluster keyword theo business semantics

**Files:**

- Create: `.codex/skills/pod-keyword-to-idea/scripts/cluster-keywords.mjs`
- Create: `.codex/skills/pod-keyword-to-idea/references/pod-idea-framework.md`
- Create: `.codex/skills/pod-keyword-to-idea/tests/cluster-keywords.test.mjs`

- [ ] Exact normalization trước, semantic clustering sau.
- [ ] Không merge chỉ vì singular/plural nếu buyer intent khác.
- [ ] Cluster theo các facet:
  - audience/identity;
  - buyer;
  - wearer/user;
  - occasion;
  - emotion/humor;
  - style/aesthetic;
  - product;
  - personalization token.
- [ ] Mỗi cluster giữ member keyword IDs và provenance summary.
- [ ] Đánh dấu ambiguous cluster cần review.
- [ ] Không để một high-volume broad keyword nuốt các long-tail intent khác nhau.

**Golden cases:**

- `nurse shirt`, `funny nurse shirt`, `nurse graduation gift` liên quan nhưng không phải một intent duy nhất.
- `mama bear` và một phrase có khả năng trademark phải vào IP review.
- `custom dog memorial shirt` phải giữ personalization + memorial sensitivity.

**Acceptance:**

- Cluster deterministic với fixture.
- Không mất source evidence khi merge aliases.
- Có lý do cluster/không cluster để review.

### Task 12: Tạo idea candidates với creative depth

**Files:**

- Modify: `.codex/skills/pod-keyword-to-idea/SKILL.md`
- Create: `.codex/skills/pod-keyword-to-idea/templates/idea-shortlist.md`
- Create: `.codex/skills/pod-keyword-to-idea/tests/idea-contract.test.mjs`

- [ ] Skill tạo tối thiểu các hướng khi phù hợp:
  - text-led;
  - illustration-led;
  - personalization;
  - gift/occasion;
  - identity/insider joke.
- [ ] Mỗi idea phải có buyer, wearer, occasion, emotion, product và creative brief.
- [ ] Không tạo hàng chục biến thể chỉ đổi một từ.
- [ ] Mỗi claim evidence phải trỏ về keyword IDs/source types.
- [ ] Phân biệt observed fact, inference và recommendation.
- [ ] Không tạo mock metric hoặc dự báo revenue không có input.

**Acceptance:**

- Idea card đúng schema.
- Hai idea cùng cluster phải khác concept mechanic, không chỉ khác title.
- Idea không rõ buyer hoặc product bị chặn trước shortlist.

### Task 13: Xây hard gates và ranking policy

**Files:**

- Create: `.codex/skills/pod-keyword-to-idea/scripts/evaluate-gates.mjs`
- Create: `.codex/skills/pod-keyword-to-idea/references/risk-gates.md`
- Create: `.codex/skills/pod-keyword-to-idea/tests/evaluate-gates.test.mjs`

- [ ] Gate IP/trademark/copyright:
  - named brands;
  - character/franchise;
  - celebrity/team;
  - suspicious slogan;
  - exact artwork copying.
- [ ] Gate sensitive content:
  - medical claims;
  - grief/memorial;
  - politics/religion;
  - protected attributes;
  - children.
- [ ] Gate commercial clarity:
  - buyer unclear;
  - product fit weak;
  - creative depth thấp;
  - chỉ có một social trend source;
  - broad keyword không có purchase context.
- [ ] Hard fail luôn vào rejected.
- [ ] Review gate có thể ở candidates nhưng không lên auto-shortlist.
- [ ] Chấm theo vector 0–5 có rubric, không dùng magic weighted score mặc định.

**Acceptance:**

- High trend nhưng dính franchise vẫn rejected.
- Meta longevity cao không tự động vượt purchase-intent gate.
- Single-source TikTok trend không được `research-qualified`.

### Task 14: Viết artifact writer và report

**Files:**

- Create: `.codex/skills/pod-keyword-to-idea/scripts/write-run-artifacts.mjs`
- Modify: `.codex/skills/pod-keyword-to-idea/templates/idea-shortlist.md`
- Create: `.codex/skills/pod-keyword-to-idea/tests/write-run-artifacts.test.mjs`

- [ ] Viết `normalized-keywords.jsonl`.
- [ ] Viết `clusters.jsonl`.
- [ ] Viết toàn bộ candidates và rejected, không chỉ shortlist.
- [ ] Report shortlist có:
  - executive summary;
  - data coverage;
  - top clusters;
  - idea table;
  - evidence/caveats;
  - risks cần kiểm tra;
  - bước validation tiếp theo.
- [ ] Run manifest ghi input hash, schema, counts, rejected reasons, generatedAt và skill version.
- [ ] Atomic write qua temporary file rồi rename để tránh file dở.

**Acceptance:**

- Tổng `shortlisted + candidate-only + rejected` khớp tổng idea generated.
- Report không che record bị loại.
- Chạy lại cùng deterministic fixture không đổi IDs/counts.

### Task 15: End-to-end integration

**Files:**

- Create: `tools/POD all /pod-trend-harvester/tests/fixtures/e2e-observations.jsonl`
- Create: `.codex/skills/pod-keyword-to-idea/tests/fixtures/e2e-signals.jsonl`
- Create: `.codex/skills/pod-keyword-to-idea/tests/e2e.test.mjs`
- Modify: `tools/POD all /pod-trend-harvester/README.md`
- Modify: `.codex/skills/pod-keyword-to-idea/SKILL.md`

- [ ] Seed observations từ ít nhất Etsy, Trends, TikTok và Meta.
- [ ] Aggregate → export JSONL.
- [ ] Skill validate → cluster → generate → gate → write outputs.
- [ ] Test corrupt line, duplicate file, missing geo, capped competition, single-source trend.
- [ ] Test một keyword giảm theo tuần.
- [ ] Test một idea bị IP gate và một idea đạt research-qualified.
- [ ] Test không có secret/cookie trong output.

**Verification:**

```bash
cd 'tools/POD all /pod-trend-harvester'
npm test

cd '/Users/tuyen.tq/Documents/freelancer/vietminhglobal/app'
node --test .codex/skills/pod-keyword-to-idea/tests/*.test.mjs
```

**Acceptance:**

- E2E tạo đủ bảy artifact của run.
- Mọi số đếm đối chiếu được.
- Không cần trình duyệt trong test pipeline.

### Task 16: Manual verification trên Edge

**Files:**

- Modify: `tools/POD all /pod-trend-harvester/README.md`
- Create: `tools/POD all /pod-trend-harvester/MANUAL-TEST-CHECKLIST.md`

- [ ] Reload unpacked extension trên Edge.
- [ ] Capture từng source bằng tài khoản/session hiện tại.
- [ ] Kiểm tra provenance URL/query/time/geo.
- [ ] Kiểm tra MV3 service worker restart không làm mất observations đã flush.
- [ ] Export JSONL và manifest.
- [ ] Chạy skill bằng file vừa export.
- [ ] Mở ít nhất 10 idea cards, đối chiếu ngược tới source.
- [ ] Ghi selector/source nào chỉ fixture-tested và source nào real-page-tested.

**Acceptance:**

- 10/10 idea cards truy ngược được về keyword và observation.
- Không có metric `0` giả do parser thiếu.
- Không có claim profit/validated không có bằng chứng.

### Task 17: Documentation và vận hành

**Files:**

- Modify: `tools/POD all /pod-trend-harvester/README.md`
- Modify: `.codex/skills/pod-keyword-to-idea/SKILL.md`
- Create: `docs/pod-trend-to-idea-data-contract.md`
- Create: `docs/pod-trend-to-idea-runbook.md`

- [ ] Viết cách capture, export, chạy skill và đọc output.
- [ ] Viết data dictionary cho mọi metric.
- [ ] Viết migration policy khi schema lên v2.
- [ ] Viết troubleshooting cho selector drift, capped count, missing geo, MV3 restart và corrupt JSONL.
- [ ] Viết privacy policy: không export cookie/token/account identifiers không cần thiết.
- [ ] Ghi rõ bằng chứng cần có trước khi gọi idea là validated.

**Acceptance:**

- Một người khác trong team có thể chạy từ đầu tới report chỉ bằng runbook.
- Mọi metric quan trọng đều có định nghĩa và caveat.

### Task 18: Source registry và social signal normalizer

**Files:**

- Create: `tools/POD all /pod-trend-harvester/lib/sourceRegistry.js`
- Create: `tools/POD all /pod-trend-harvester/lib/socialSignals.js`
- Modify: `tools/POD all /pod-trend-harvester/lib/schemas.js`
- Create: `tools/POD all /pod-trend-harvester/tests/source-registry.test.js`
- Create: `tools/POD all /pod-trend-harvester/tests/social-signals.test.js`

**Interfaces:**

- Consumes: `pod-observation/v1` validator từ Task 2.
- Produces:
  - `registerSource(definition): void`
  - `getSourceDefinition(sourceId): SourceDefinition | null`
  - `createSocialObservation(input): PodObservation`
  - `parseDisplayedNumber(label): DisplayedNumber`

```js
/**
 * @typedef {{
 *   id: "reddit" | "pinterest" | "youtube" | "x" | "instagram",
 *   evidenceClass: "community-language" | "visual-aesthetic" |
 *     "creator-video" | "cultural-velocity",
 *   requiresLogin: boolean,
 *   requiresUsRegion: boolean,
 *   defaultPurchaseIntentWeight: 0
 * }} SourceDefinition
 *
 * @typedef {{
 *   value: number | null,
 *   rawLabel: string | null,
 *   isApproximate: boolean,
 *   isLowerBound: boolean
 * }} DisplayedNumber
 */
```

- [ ] Viết failing test xác nhận mọi social source có
  `defaultPurchaseIntentWeight: 0`.
- [ ] Viết failing test cho `1.2K`, `10K+`, `—` và missing label.
- [ ] Implement registry cố định cho năm source; source lạ bị reject.
- [ ] Implement `createSocialObservation` giữ raw label, geo confidence và
  warning.
- [ ] Không tạo field tổng hợp `socialVolume`.
- [ ] Chạy toàn bộ extension tests.

**Required test:**

```js
test("social attention never becomes purchase intent by default", () => {
  for (const id of ["reddit", "pinterest", "youtube", "x", "instagram"]) {
    assert.equal(getSourceDefinition(id).defaultPurchaseIntentWeight, 0);
  }
});
```

**Acceptance:**

- Năm adapters dùng chung envelope và không tự đặt semantics riêng.
- Displayed metrics giữ được approximate/lower-bound.
- Source mới không thể silently bypass schema.

### Task 19: Reddit community-language adapter

**Files:**

- Create: `tools/POD all /pod-trend-harvester/content/reddit.js`
- Modify: `tools/POD all /pod-trend-harvester/manifest.json`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.html`
- Modify: `tools/POD all /pod-trend-harvester/app/app.js`
- Create: `tools/POD all /pod-trend-harvester/tests/fixtures/reddit-search.html`
- Create: `tools/POD all /pod-trend-harvester/tests/reddit.test.js`

**Interfaces:**

- Consumes: `createSocialObservation()` từ Task 18.
- Produces:
  - `parseRedditSearch(document, context): RedditCapture`
  - message type `CAPTURE_REDDIT`
  - observations với `source: "reddit"` và
    `sourceType: "community-language"`.

```js
/**
 * @typedef {{
 *   query: string,
 *   sourceUrl: string,
 *   capturedAt: string,
 *   items: Array<{
 *     title: string,
 *     snippet: string | null,
 *     subreddit: string | null,
 *     score: number | null,
 *     commentCount: number | null,
 *     publishedAt: string | null,
 *     postUrl: string
 *   }>,
 *   warnings: string[]
 * }} RedditCapture
 */
```

- [ ] Mở Reddit search/Reddit Pro Trends thủ công trên Edge và ghi surface
  nào hiển thị ổn định mà không bypass login/paywall.
- [ ] Chụp fixture đã loại username/avatar/profile ID.
- [ ] Viết failing parser test cho title, subreddit, score, comment count,
  timestamp và canonical URL.
- [ ] Implement parser chỉ đọc card đang hiển thị; không tự mở toàn bộ comment.
- [ ] Tạo observations riêng cho keyword/title phrases, giữ subreddit làm
  community evidence.
- [ ] Dedupe cùng canonical post URL trong một capture.
- [ ] UI cho phép nhập query và yêu cầu user xác nhận Region/Language.
- [ ] Nếu Reddit Pro Trends không khả dụng, fallback chính thức là public search
  surface; manifest phải ghi `surface: "public-search"`.

**Required assertions:**

```js
assert.equal(capture.items[0].subreddit, "r/nursing");
assert.equal(capture.items[0].commentCount, 184);
assert.equal(observation.sourceType, "community-language");
assert.equal(observation.metrics.purchaseIntent, undefined);
```

**Acceptance:**

- Mỗi Reddit observation truy ngược được tới post/search URL.
- Không lưu danh tính author.
- Upvote/comment chỉ là community engagement.
- Một Reddit-only cluster không được tự động `research-qualified`.

### Task 20: Pinterest visual-aesthetic adapter

**Files:**

- Create: `tools/POD all /pod-trend-harvester/content/pinterest.js`
- Modify: `tools/POD all /pod-trend-harvester/manifest.json`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.html`
- Modify: `tools/POD all /pod-trend-harvester/app/app.js`
- Create: `tools/POD all /pod-trend-harvester/tests/fixtures/pinterest-trends.html`
- Create: `tools/POD all /pod-trend-harvester/tests/pinterest.test.js`

**Interfaces:**

- Consumes: `createSocialObservation()` từ Task 18.
- Produces:
  - `parsePinterestTrends(document, context): PinterestCapture`
  - message type `CAPTURE_PINTEREST`
  - observations với `sourceType: "visual-aesthetic"`.

```js
/**
 * @typedef {{
 *   query: string,
 *   regionLabel: string | null,
 *   timeWindowLabel: string | null,
 *   relatedTerms: string[],
 *   trendPoints: Array<{ label: string, value: number | null }>,
 *   visualLabels: string[],
 *   sourceUrl: string,
 *   warnings: string[]
 * }} PinterestCapture
 */
```

- [ ] Trên Edge + IP US, kiểm tra Pinterest Trends có yêu cầu business login và
  region selector nào đang được áp dụng.
- [ ] Chụp fixture US có query, related terms, time window và chart labels.
- [ ] Viết failing test giữ nguyên chart labels thay vì bịa absolute volume.
- [ ] Implement parser cho query, related search, growth label và aesthetic
  descriptors đang hiển thị.
- [ ] Tạo child keyword observation cho related terms với
  `derivedFromKeyword`.
- [ ] Gắn `geoConfidence: "page"` khi UI hiển thị United States;
  `ip-derived` chỉ khi không có selector.
- [ ] Pinterest saves/pins không được map sang sales.

**Acceptance:**

- Pinterest observation giữ visual/aesthetic evidence.
- Related term có parent provenance.
- Không có field `sales`, `purchaseVolume` hoặc giả định save = purchase.

### Task 21: YouTube autocomplete và creator-video adapter

**Files:**

- Create: `tools/POD all /pod-trend-harvester/content/youtube.js`
- Modify: `tools/POD all /pod-trend-harvester/manifest.json`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.html`
- Modify: `tools/POD all /pod-trend-harvester/app/app.js`
- Create: `tools/POD all /pod-trend-harvester/tests/fixtures/youtube-search.html`
- Create: `tools/POD all /pod-trend-harvester/tests/youtube.test.js`

**Interfaces:**

- Consumes: `createSocialObservation()` và observation append API.
- Produces:
  - `parseYouTubeSearch(document, context): YouTubeCapture`
  - message type `CAPTURE_YOUTUBE`
  - `sourceType: "creator-video"`.

```js
/**
 * @typedef {{
 *   query: string,
 *   suggestions: Array<{ text: string, rank: number }>,
 *   videos: Array<{
 *     title: string,
 *     videoUrl: string,
 *     displayedViews: string | null,
 *     publishedLabel: string | null,
 *     isShort: boolean
 *   }>,
 *   sourceUrl: string,
 *   warnings: string[]
 * }} YouTubeCapture
 */
```

- [ ] Kiểm tra thực tế YouTube US search và Shorts surface trên Edge.
- [ ] Viết fixture cho regular video, Short, missing views và live video.
- [ ] Viết failing test giữ `displayedViews` raw và chỉ parse số khi chắc chắn.
- [ ] Tạo suggestion observations với rank riêng.
- [ ] Chỉ tính `contentAgeHours` nếu parser có timestamp chắc chắn; label như
  “Streamed live” không được tự đoán.
- [ ] Không coi views là demand sản phẩm.
- [ ] Gắn cảnh báo nếu kết quả bị personalization bởi account/history.

**Acceptance:**

- Autocomplete và video evidence được tách riêng.
- Không tự tính view velocity từ label không đủ dữ liệu.
- Output có canonical video/search URL và capture time.

### Task 22: X.com cultural-velocity adapter

**Files:**

- Create: `tools/POD all /pod-trend-harvester/content/x.js`
- Modify: `tools/POD all /pod-trend-harvester/manifest.json`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.html`
- Modify: `tools/POD all /pod-trend-harvester/app/app.js`
- Create: `tools/POD all /pod-trend-harvester/tests/fixtures/x-explore.html`
- Create: `tools/POD all /pod-trend-harvester/tests/x.test.js`

**Interfaces:**

- Consumes: `createSocialObservation()` và risk taxonomy từ skill Task 13.
- Produces:
  - `parseXExplore(document, context): XCapture`
  - message type `CAPTURE_X_TRENDS`
  - observations với `sourceType: "cultural-velocity"`.

```js
/**
 * @typedef {{
 *   regionLabel: string | null,
 *   trends: Array<{
 *     rank: number,
 *     phrase: string,
 *     category: string | null,
 *     displayedPostCount: string | null,
 *     searchUrl: string
 *   }>,
 *   sourceUrl: string,
 *   warnings: string[]
 * }} XCapture
 */
```

- [ ] Bật IP US cố định, đặt X Explore location thành United States và ghi lại
  region label.
- [ ] Chụp fixture không chứa username/avatar/private data.
- [ ] Viết failing tests cho promoted trend, missing post count, hashtag,
  sports team và political trend.
- [ ] Parser bỏ promoted items hoặc gắn `warning: "promoted-trend"`.
- [ ] Gắn risk hints cho celebrity, sports team, movie/game, politics và
  suspicious phrase; đây chỉ là pre-screen, không thay trademark review.
- [ ] Không mở/crawl toàn bộ reply.
- [ ] X-only idea luôn ở `hypothesis` hoặc `rejected`, không
  `research-qualified`.

**Acceptance:**

- Trend có rank, phrase, region, source URL và capturedAt.
- Missing post count là `null`.
- Cultural spike không được biến thành commercial demand.
- IP-sensitive trend đi vào review/rejected path.

### Task 23: Instagram/Reels adapter với feasibility gate

**Files:**

- Create: `tools/POD all /pod-trend-harvester/content/instagram.js`
- Modify: `tools/POD all /pod-trend-harvester/manifest.json`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.html`
- Create: `tools/POD all /pod-trend-harvester/tests/fixtures/instagram-reels.html`
- Create: `tools/POD all /pod-trend-harvester/tests/instagram.test.js`
- Create: `tools/POD all /pod-trend-harvester/INSTAGRAM-FEASIBILITY.md`

**Interfaces:**

- Consumes: `createSocialObservation()`.
- Produces một trong hai trạng thái xác định:
  - `supported`: `parseInstagramSurface()` có fixture + live-page pass.
  - `unavailable`: adapter disabled và UI giải thích lý do cụ thể.

- [ ] Kiểm tra ba surface bằng Edge session thật: Explore, hashtag search và
  Reels/audio page.
- [ ] Ghi cho từng surface: login requirement, region visibility, stable URL,
  stable text selectors, displayed metric và rate-limit behavior.
- [ ] Chọn surface chỉ khi cùng một field pass ba lần reload và một lần MV3
  worker restart.
- [ ] Nếu có surface đạt gate, chụp fixture và viết parser test cho caption
  snippet, audio/hashtag label, displayed engagement, canonical URL.
- [ ] Nếu không surface nào đạt gate, implement disabled adapter trả:

```js
{
  ok: false,
  code: "INSTAGRAM_SURFACE_UNSTABLE",
  message: "Instagram capture is disabled because no public surface passed the stability gate."
}
```

- [ ] Không dùng private endpoint, cookie extraction hoặc bypass login.
- [ ] Không tuyên bố Instagram supported nếu chỉ fixture pass.

**Acceptance:**

- Trạng thái supported/unavailable là có bằng chứng, không mơ hồ.
- Supported cần cả automated fixture test và manual live pass.
- Unavailable không làm hỏng các nguồn khác.

### Task 24: Cross-source confirmation và skill policy

**Files:**

- Modify: `tools/POD all /pod-trend-harvester/lib/aggregate.js`
- Modify: `.codex/skills/pod-keyword-to-idea/references/evidence-policy.md`
- Modify: `.codex/skills/pod-keyword-to-idea/scripts/evaluate-gates.mjs`
- Create: `.codex/skills/pod-keyword-to-idea/tests/social-confirmation.test.mjs`

**Interfaces:**

- Consumes: social observations Tasks 19–23 và marketplace/search signals
  Tasks 5–8.
- Produces:
  - `summarizeEvidenceClasses(keyword): EvidenceClassSummary`
  - gate `socialOnly`
  - gate `singleSourceTrend`
  - gate `ipSensitiveTrend`.

- [ ] Viết failing test: X-only và TikTok-only không đạt research-qualified.
- [ ] Viết failing test: Reddit + Pinterest vẫn thiếu marketplace/search intent.
- [ ] Viết passing test: Reddit community language + Pinterest aesthetic +
  Google Trends recency + Etsy marketplace evidence có thể đạt
  research-qualified nếu các hard gate khác pass.
- [ ] Giữ platform metrics tách riêng; chỉ aggregate source/evidence class
  counts.
- [ ] Report phải nói rõ bằng chứng nào là observed và phần nào là inference.
- [ ] Không yêu cầu mọi idea có đủ năm social sources.

**Required test:**

```js
test("a viral-only idea cannot be research-qualified", () => {
  const result = evaluateGates(ideaWithSources(["x", "tiktok"]));
  assert.equal(result.status, "hypothesis");
  assert.equal(result.gates.socialOnly, "fail");
});
```

**Acceptance:**

- Social reach không thay search/marketplace evidence.
- Source diversity được tính bằng evidence class, không chỉ số URL.
- Cùng nội dung repost trên nhiều mạng không được coi là xác nhận độc lập.

### Task 25: Edge US-region A/B validation cho source expansion

**Files:**

- Modify: `tools/POD all /pod-trend-harvester/MANUAL-TEST-CHECKLIST.md`
- Create: `tools/POD all /pod-trend-harvester/SOURCE-REGION-MATRIX.md`
- Modify: `docs/pod-trend-to-idea-runbook.md`

- [ ] Chọn một bộ 10 seed cố định gồm nghề nghiệp, hobby, occasion, aesthetic
  và một noise control term.
- [ ] Run A bằng IP hiện tại; lưu manifest và screenshot region label.
- [ ] Bật AdGuard VPN với một server US cố định, mở lại Edge rồi chạy Run B.
- [ ] Với Etsy, đặt Region United States, Language English, Currency USD và
  Ship-to US trước Run B.
- [ ] Với X, TikTok và Pinterest, xác nhận UI hiển thị United States.
- [ ] Với Google Trends, xác nhận request `geo=US`; không dùng VPN để giải thích
  khác biệt trong dataset đã khóa geo.
- [ ] So sánh:
  - keyword overlap;
  - local-language leakage;
  - region labels;
  - source availability;
  - warnings;
  - missing metric rate.
- [ ] Chọn canonical operating mode cho từng source và ghi vào matrix.
- [ ] Không đổi VPN server giữa một run; nếu login challenge xuất hiện, dừng
  source đó và ghi warning thay vì retry liên tục.

**Acceptance:**

- Mỗi source có một kết luận: `US VPN required`, `recommended`, hoặc
  `explicit geo sufficient`.
- Canonical run không chứa local Vietnamese leakage không được gắn warning.
- Checklist ghi ngày, Edge version, extension version, IP country và account
  region; không ghi địa chỉ IP đầy đủ.

## 7. Thứ tự triển khai và checkpoint

### Phase A — Làm dữ liệu đáng tin

Tasks 1–9.

Checkpoint bắt buộc:

- Test suite xanh.
- Weekly delta có thể âm.
- Etsy capped count không bị coi là exact.
- TikTok metrics không bị mất.
- Meta không còn “profitability”.
- Export JSONL có provenance.

### Phase B — Xây skill tạo idea

Tasks 10–14.

Checkpoint bắt buộc:

- Input validator fail rõ ràng.
- Cluster giữ intent và provenance.
- Idea card có buyer/product/creative brief.
- Hard gates hoạt động trước ranking.
- Có candidates, shortlist và rejected.

### Phase C — E2E và Edge verification

Tasks 15–17.

Checkpoint bắt buộc:

- Fixture E2E reproducible.
- Real-page checklist hoàn tất trên Edge.
- 10 idea truy ngược được về source.
- Runbook đủ cho người khác dùng.

### Phase D — Source expansion v1.1

Tasks 18–25, triển khai tuần tự theo checkpoint:

1. Source registry.
2. Reddit.
3. Pinterest.
4. YouTube.
5. X.com.
6. Instagram feasibility.
7. Cross-source policy.
8. US-region A/B validation.

Checkpoint bắt buộc sau từng adapter:

- Parser fixture xanh.
- Real-page Edge pass hoặc trạng thái `unavailable` có lý do.
- Observation đúng schema và có provenance.
- Missing metric là `null`, không phải zero.
- Không thêm purchase intent mặc định.
- Source trước đó không regression.

Chỉ bắt đầu Phase D sau khi Phase C được review. Reddit/Pinterest/YouTube/X
không được làm chậm việc sửa core data contract.

### Phase E — Competitor & Ad Intelligence

Tasks 26–38.

Phase E bắt đầu sau khi shared observation/provenance contract của Phase A–C
ổn định. Phase E không phụ thuộc việc toàn bộ optional social adapters Phase D
đã supported.

Checkpoint bắt buộc:

- Website URL là input duy nhất.
- Identity high-confidence có domain/verified evidence.
- Ambiguous identity vào review.
- Meta và Google adapters real-page pass.
- TikTok ghi rõ Top Ads coverage limitation.
- Baseline + daily watchlist checkpoint/resume được.
- Screenshot tồn tại khi ad biến mất.
- Report tách observed/derived/inferred.
- Không suy diễn spend, targeting, ROAS hoặc profit.

## 8. Test strategy

### Unit tests

- Parser và normalize từng source.
- Observation dedupe.
- ISO week aggregation.
- Capped/lower-bound semantics.
- Schema validation.
- Cluster determinism.
- Gate evaluation.
- Artifact count reconciliation.

### Fixture tests

- Lưu DOM/text fixture tối thiểu, loại bỏ thông tin tài khoản.
- Mỗi fixture ghi captured date và URL pattern.
- Selector drift phải làm test fail hoặc phát warning, không silently return zero.

### Integration tests

- Observation → signal export.
- Multi-file input → normalized records.
- Signal → cluster → idea → gate → output.
- Re-run idempotency.

### Manual tests

- Edge session thật.
- Ít nhất một capture cho mỗi nguồn.
- Test service worker restart.
- Test export file lớn.
- Test skill với một file thiếu một platform.
- A/B IP thường và AdGuard VPN US bằng cùng seed set.
- X/TikTok/Pinterest phải ghi region label.
- Instagram phải có cả fixture pass và live-page pass mới được đánh dấu
  supported.

## 9. Tiêu chí chất lượng cuối cùng

Pipeline chỉ được coi là hoàn tất nếu:

- 100% keyword signal có provenance.
- 100% idea có seed keyword IDs.
- 100% rejected idea có reason.
- Không có field unknown bị biến thành `0`.
- Không có Etsy `1,000+` bị coi là exact.
- Không có Google Trends interest bị gọi là absolute volume.
- Không có Meta days alive bị gọi là profit.
- Không có TikTok view bị coi là purchase intent.
- Không có Reddit upvote/comment bị coi là purchase intent.
- Không có Pinterest save hoặc YouTube/X/Instagram engagement bị coi là sale.
- X-only/TikTok-only idea không được research-qualified.
- Mọi social source có region/geo confidence và capture timestamp.
- Không có idea gọi là validated nếu chưa có purchase + positive contribution.
- Test tự động xanh và checklist Edge được ghi lại.

## 10. Rủi ro và cách kiểm soát

| Rủi ro | Ảnh hưởng | Kiểm soát |
|---|---|---|
| DOM source thay đổi | Parser trả thiếu dữ liệu | Fixture + warnings + `null`, manual checklist |
| MV3 worker bị kill | Mất batch đang giữ trong RAM | Append/batch flush nhỏ, checkpoint trong storage |
| Metric bị hiểu sai | Idea ranking sai | Data dictionary, platform-specific fields |
| Keyword cluster quá rộng | Idea generic | Facet-aware clustering, ambiguous review |
| LLM bịa bằng chứng | Báo cáo không đáng tin | Evidence IDs bắt buộc, facts/inference tách riêng |
| Trademark/copyright | Listing bị takedown | Hard gate + manual review list |
| Export file lớn | UI/worker crash | JSONL streaming/chunking ở phase tối ưu nếu cần |
| Schema thay đổi | Skill đọc sai | Version + fail closed + migration |
| Social trend bị đồng nhất với demand | Shortlist bị nhiễu | Evidence class + social-only gate |
| X/news spike sống quá ngắn | Idea hết trend trước khi bán | CapturedAt + recency decay + source thứ hai |
| Reddit/Pinterest personalization | Kết quả không đại diện US | Region matrix + A/B IP test |
| Instagram DOM/login thay đổi | Adapter hỏng âm thầm | Feasibility gate + disabled state |
| VPN đổi giữa run | Dataset không nhất quán/login challenge | Một US server cố định cho cả run |

## 11. Các quyết định hoãn sang v2

- Gọi skill trực tiếp từ extension.
- Local HTTP bridge/native messaging.
- Embedding/vector database cho kho keyword rất lớn.
- Tự động kiểm tra trademark qua API.
- Tự động ước tính margin theo từng fulfillment provider.
- Tự động tạo artwork/mockup/listing.
- Kết nối sales/ads thật để chuyển `research-qualified` thành `validated`.
- WhatsApp/Snapchat/Discord/Threads/Bluesky adapters.
- Crawl toàn bộ Reddit comments, X replies hoặc Instagram comments.

## 12. Quy tắc thực thi plan

- Không rename thư mục `tools/POD all ` trong scope này.
- Không xóa/migrate destructive dữ liệu extension cũ.
- Tasks 1–17 không thêm crawler mới; source adapters chỉ bắt đầu ở Phase D sau
  checkpoint Phase C.
- Source adapter chỉ đọc public/current browser surface; không extract cookie,
  gọi private endpoint hoặc bypass login/paywall.
- Không stage, commit, push hoặc deploy nếu chưa được user cho phép.
- Mỗi task phải có test đỏ trước thay đổi behavior, sau đó test xanh.
- Sau mỗi phase phải dừng ở checkpoint để review dữ liệu mẫu.
- Mọi thay đổi phải giữ backward compatibility hoặc có migration rõ ràng.

## 13. Phase E Design Contract — Competitor & Ad Intelligence

### 13.1. Mục tiêu và input

User chỉ nhập website đối thủ:

```json
{
  "website": "https://competitor.example",
  "watch": true
}
```

Hệ thống phải tự:

1. Canonicalize domain và theo redirect bình thường.
2. Đọc brand, legal name, logo, public social links và tracking technologies.
3. Tìm advertiser candidates trên public ad-research surfaces.
4. Xác minh candidate bằng domain, public social links và landing URL.
5. Auto-accept candidate high-confidence.
6. Đưa medium/low-confidence vào review.
7. Capture website/ad snapshots.
8. So sánh lịch sử và viết báo cáo observed/derived/inferred.

### 13.2. Ranh giới Extension và Skill

Extension:

- lưu competitor configuration;
- discovery identity;
- capture public website/ad evidence;
- chụp screenshot/thumbnail;
- checkpoint theo competitor/source;
- export JSONL.

Skill `pod-competitor-ad-intelligence`:

- validate input;
- reconcile identity;
- group creative families;
- so sánh snapshots;
- phân tích product, offer, hook, format và funnel;
- tách fact, derivation và inference;
- viết competitor report và cross-competitor report.

Không bên nào được:

- extract cookie/token/session;
- gọi private endpoint hoặc bypass login/CAPTCHA/paywall;
- tự mua hàng, gửi form, message, like hoặc follow;
- tuyên bố budget, targeting, bid, ROAS, revenue, margin hoặc profit;
- tự tải toàn bộ video;
- sao chép artwork/copy của đối thủ.

### 13.3. Identity confidence

`high` khi có ít nhất một bằng chứng:

- website link trực tiếp social/page identity và identity link về canonical
  domain;
- ad landing URL resolve về canonical domain;
- transparency record ghi rõ website domain;
- legal entity và advertiser identity khớp public website evidence, không có
  conflict.

`medium` khi:

- brand/logo khớp nhưng chưa xác nhận landing domain;
- website link social identity nhưng advertiser dùng legal name khác;
- ad tới related domain chưa xác nhận ownership.

`low` khi:

- chỉ giống keyword/tên;
- brand name generic;
- logo/location/category conflict;
- không có liên hệ với canonical domain.

Chỉ `high` được auto-watch. `medium`/`low` phải review với các action `Accept`,
`Reject`, `Ignore`.

### 13.4. Website snapshot contract

Mỗi competitor run lưu:

- canonical/final URL và capturedAt;
- product/collection names và URLs;
- prices, currency, compare-at price, discount;
- bundle/quantity offers;
- free-shipping threshold;
- guarantee/return claims;
- scarcity/urgency text;
- featured/bestseller labels;
- displayed review count/rating;
- personalization fields;
- popup offer;
- public cart/post-add-to-cart upsells;
- trust badges;
- storefront technology;
- public analytics/ad technologies;
- home/landing/product screenshots;
- warnings cho gated/personalized/missing content.

Missing value là `null`. Không submit checkout, form hoặc personal data. Label
“bestseller” không được đổi thành sales volume.

### 13.5. Ad observation contract

```js
{
  schemaVersion: "pod-competitor-ad/v1",
  observationId: string,
  competitorId: string,
  identityId: string,
  identityConfidence: "high" | "medium" | "low",
  platform: "meta" | "google" | "tiktok" | "x" | "pinterest",
  platformAdId: string | null,
  advertiserName: string,
  sourceUrl: string,
  capturedAt: ISODateString,
  firstSeenAt: ISODateString,
  lastSeenAt: ISODateString,
  platformStatus: "active" | "inactive" | "unknown",
  format: "image" | "video" | "carousel" | "text" | "unknown",
  copy: {
    primaryText: string | null,
    headline: string | null,
    description: string | null,
    callToAction: string | null
  },
  creative: {
    thumbnailPath: string | null,
    screenshotPath: string,
    mediaUrl: string | null,
    manuallySavedMediaPath: string | null
  },
  destination: {
    displayedUrl: string | null,
    landingUrl: string | null,
    finalUrl: string | null,
    finalDomain: string | null
  },
  platformEvidence: object,
  warnings: string[]
}
```

`firstSeenAt`/`lastSeenAt` là thời điểm tool quan sát, không phải campaign dates.
Ad thiếu trong một run không được gắn inactive ngay. Chỉ inactive khi platform
ghi rõ hoặc vượt multi-run absence policy đã document.

### 13.6. Primary ad sources

1. Meta Ad Library: active commercial ads, creative, copy, CTA, started date nếu
   hiển thị, destination và variants.
2. Google Ads Transparency Center: search bằng advertiser/website, ads trên
   Search/Display/Gmail/YouTube, serving date/location nếu hiển thị.
3. TikTok Creative Center Top Ads: collection đã chọn lọc, không phải toàn bộ
   ads của advertiser; giữ relative performance metrics đúng semantics.

X/Pinterest ad transparency là secondary source và chỉ enable sau live
feasibility. Social profile không đồng nghĩa advertiser account.

### 13.7. Observed, derived và inferred

Observed:

- visible creative/copy/CTA/product/offer;
- source/destination URL;
- displayed price;
- public platform status/metrics;
- capture times và visible variants.

Derived:

- days observed;
- landing-domain match;
- copy similarity/creative family;
- price/offer change;
- ad/landing-message consistency;
- creative addition/removal.

Inference, luôn phải có evidence + caveat:

- probable prospecting/retargeting angle;
- probable creative testing;
- probable hero product;
- probable funnel/seasonal strategy;
- probable refresh cadence.

Không inference campaign/ad-set structure, exact targeting/optimization event,
spend, attributed revenue, ROAS hoặc profit.

### 13.8. Hybrid scheduler

- Baseline chạy một lần khi add competitor.
- Daily watchlist tối đa 20 website; expected 3–4.
- Một successful capture mỗi competitor/24 giờ.
- Process competitor và source tuần tự.
- Edge đóng thì ghi missed; chạy bù khi Edge mở lại.
- `Run now` có cooldown 6 giờ sau successful run.
- Checkpoint sau từng source.
- Login/CAPTCHA chuyển `needs_attention`, không retry liên tục.

Job states:

```text
queued
  -> discovering_identity
  -> identity_review_required
  -> capturing_website
  -> capturing_ads
  -> exporting
  -> completed

rate_limit_pause | needs_attention | partial | failed | stopped
```

Error codes:

```text
IDENTITY_AMBIGUOUS
LOGIN_REQUIRED
CAPTCHA_REQUIRED
RATE_LIMITED
SURFACE_CHANGED
AD_NOT_FOUND
WEBSITE_UNREACHABLE
REGION_MISMATCH
MEDIA_SAVE_FAILED
MV3_WORKER_INTERRUPTED
```

`AD_NOT_FOUND` chỉ có nghĩa run hiện tại chưa thấy ad. `WEBSITE_UNREACHABLE`
không được làm ads cũ inactive.

### 13.9. Media và retention

- Luôn lưu ad screenshot.
- Lưu website home/landing/product screenshots cần cho change review.
- Lưu public thumbnail/media URL.
- Không tự tải full video.
- Có `Save creative` thủ công cho observation được chọn.
- Content hash dùng để dedupe saved media.
- Metadata giữ tới khi user xóa competitor.
- Screenshot mặc định giữ 180 ngày.
- Manually saved media giữ tới khi user xóa.
- Xóa failed temporary files sau khi job đóng.

### 13.10. Output

```text
output/pod-competitor-runs/<run-id>/
├── input-manifest.json
├── competitors.json
├── advertiser-candidates.jsonl
├── website-snapshots.jsonl
├── ad-observations.jsonl
├── competitor-change-log.jsonl
├── competitor-ad-report.md
└── run-manifest.json
```

Report phải có coverage, identity review, product/offer map, platform coverage,
creative angles, hook/CTA/format, landing consistency, changes, facts versus
inferences, IP risks và reusable principles không sao chép protected creative.

## 14. Phase E Implementation Tasks

### Task 26: Competitor schemas và storage

**Files:**

- Create: `tools/POD all /pod-trend-harvester/lib/competitorSchemas.js`
- Create: `tools/POD all /pod-trend-harvester/lib/competitorStore.js`
- Create: `tools/POD all /pod-trend-harvester/tests/competitor-schemas.test.js`
- Create: `tools/POD all /pod-trend-harvester/tests/competitor-store.test.js`

**Interfaces:**

- `createCompetitor({ website, watch }): Competitor`
- `validateCompetitor(value): ValidationResult`
- `validateAdObservation(value): ValidationResult`
- `appendCompetitorSnapshot(competitorId, snapshot): Promise<void>`
- `listWatchlist(): Promise<Competitor[]>`

- [ ] Viết failing tests cho canonical URL, max watchlist 20 và duplicate domain.
- [ ] Viết failing schema tests cho website/ad observations.
- [ ] Implement stable competitor ID từ registrable domain.
- [ ] Implement append-only snapshot indexes và backward-compatible storage.
- [ ] Enforce missing metric là `null`.
- [ ] Run extension tests.

**Acceptance:**

- Duplicate URL variations map cùng competitor.
- Competitor thứ 21 không được active watchlist.
- Invalid observation không được persist.

### Task 27: Website capture

**Files:**

- Create: `tools/POD all /pod-trend-harvester/content/competitor-site.js`
- Create: `tools/POD all /pod-trend-harvester/lib/websiteSnapshot.js`
- Modify: `tools/POD all /pod-trend-harvester/manifest.json`
- Create: `tools/POD all /pod-trend-harvester/tests/fixtures/competitor-shop.html`
- Create: `tools/POD all /pod-trend-harvester/tests/website-snapshot.test.js`

**Interfaces:**

- `captureWebsite(document, context): WebsiteSnapshot`
- `normalizeDisplayedOffer(value): DisplayedOffer`
- `redactTrackingData(value): RedactedEvidence`

- [ ] Fixture gồm product, price, compare-at, bundle, shipping, review và popup.
- [ ] Viết failing parser tests cho từng field.
- [ ] Implement public-page extraction và raw-text preservation.
- [ ] Capture home/landing/product screenshots.
- [ ] Detect storefront/public tracking technologies nhưng redact visitor/session.
- [ ] Không submit form, checkout hoặc purchase.

**Acceptance:**

- Snapshot đủ provenance.
- Website personalization có warning.
- Export không chứa cookie/token/visitor ID.

### Task 28: Identity discovery

**Files:**

- Create: `tools/POD all /pod-trend-harvester/lib/identityDiscovery.js`
- Create: `tools/POD all /pod-trend-harvester/tests/identity-discovery.test.js`

**Interfaces:**

- `extractWebsiteIdentity(snapshot): WebsiteIdentity`
- `generateAdvertiserQueries(identity): AdvertiserQuery[]`
- `canonicalRegistrableDomain(url): string | null`

- [ ] Tests cho brand, legal name, logo, social links và email domain.
- [ ] Tests cho redirect/affiliate/related domains.
- [ ] Implement query candidates từ brand/legal/domain/social identity.
- [ ] Không dùng email address cá nhân làm exported identity.

**Acceptance:**

- Website URL là input bắt buộc duy nhất.
- Query candidates deterministic.
- Social link và advertiser identity không bị coi là cùng loại.

### Task 29: Identity confidence và review UI

**Files:**

- Create: `tools/POD all /pod-trend-harvester/lib/identityConfidence.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.html`
- Modify: `tools/POD all /pod-trend-harvester/app/app.js`
- Create: `tools/POD all /pod-trend-harvester/tests/identity-confidence.test.js`

**Interfaces:**

- `evaluateIdentity(candidate, websiteIdentity): IdentityDecision`
- `acceptIdentity(candidateId): Promise<void>`
- `rejectIdentity(candidateId): Promise<void>`
- `ignoreIdentity(candidateId): Promise<void>`

- [ ] Failing tests cho high/medium/low evidence rules.
- [ ] Failing test: generic same-name candidate không auto-accept.
- [ ] Implement evidence list và conflict list.
- [ ] Render review queue với Accept/Reject/Ignore.
- [ ] Chỉ high-confidence vào automatic daily tracking.

**Acceptance:**

- Mọi auto-accept có domain/verified identity evidence.
- Ambiguous candidate không bị mất.

### Task 30: Meta competitor-ad adapter

**Files:**

- Create: `tools/POD all /pod-trend-harvester/content/meta-competitor-ads.js`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Create: `tools/POD all /pod-trend-harvester/tests/fixtures/meta-competitor-ads.html`
- Create: `tools/POD all /pod-trend-harvester/tests/meta-competitor-ads.test.js`

**Interfaces:**

- `searchMetaAdvertisers(query): MetaAdvertiserCandidate[]`
- `parseMetaCompetitorAds(document, context): AdObservation[]`

- [ ] Edge live spike bằng advertiser/domain queries.
- [ ] Fixture cho image/video/carousel, variant, missing date và no results.
- [ ] Parse copy/CTA/start date/destination/library ID.
- [ ] Save screenshot cho accepted observations.
- [ ] `daysAlive` chỉ là ad longevity.
- [ ] Login/CAPTCHA/rate limit trả structured error.

**Acceptance:**

- Landing-domain match tham gia confidence.
- Meta active không đồng nghĩa profit.
- No result trả `AD_NOT_FOUND`, không inactive.

### Task 31: Google Ads Transparency adapter

**Files:**

- Create: `tools/POD all /pod-trend-harvester/content/google-ad-transparency.js`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Create: `tools/POD all /pod-trend-harvester/tests/fixtures/google-ad-transparency.html`
- Create: `tools/POD all /pod-trend-harvester/tests/google-ad-transparency.test.js`

**Interfaces:**

- `searchGoogleAdvertisers(query): GoogleAdvertiserCandidate[]`
- `parseGoogleAdvertiserAds(document, context): AdObservation[]`

- [ ] Test advertiser/website-name search và filters đang hiển thị.
- [ ] Fixtures cho verified/unverified, Search/Display/YouTube ad và no result.
- [ ] Parse advertiser/payer/location/date/creative/destination khi public.
- [ ] Không đoán bidding keywords từ ad copy.
- [ ] Record serving region/date đúng raw semantics.

**Acceptance:**

- Advertiser verification evidence giữ riêng.
- Không suy diễn spend/bid/search term.
- Screenshot và source URL traceable.

### Task 32: TikTok Top Ads competitor adapter

**Files:**

- Create: `tools/POD all /pod-trend-harvester/content/tiktok-competitor-ads.js`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Create: `tools/POD all /pod-trend-harvester/tests/fixtures/tiktok-top-ads.html`
- Create: `tools/POD all /pod-trend-harvester/tests/tiktok-competitor-ads.test.js`

**Interfaces:**

- `searchTikTokTopAds(query, filters): TikTokAdSearch`
- `parseTikTokTopAds(document, context): AdObservation[]`

- [ ] Fixture cho region, industry, objective, format và relative metrics.
- [ ] Parse creative/copy/CTA/product/destination nếu hiển thị.
- [ ] Preserve CTR/CVR/view-rate labels và indexed second-by-second metrics.
- [ ] Mark coverage `selected-top-ads`, không `all-advertiser-ads`.
- [ ] Không login thì record giới hạn five-ad view nếu surface hiển thị.

**Acceptance:**

- Report nói rõ Top Ads là selected collection.
- Relative metrics không biến thành absolute performance.

### Task 33: Secondary ad-source feasibility

**Files:**

- Create: `tools/POD all /pod-trend-harvester/COMPETITOR-SECONDARY-SOURCES.md`
- Create: `tools/POD all /pod-trend-harvester/tests/secondary-source-status.test.js`

**Interfaces:**

- `getSecondarySourceStatus(source): "supported" | "unavailable"`

- [ ] Test X/Pinterest public ad surfaces trên Edge US.
- [ ] Ghi login, region, searchable identity, ad age window và stable selectors.
- [ ] `supported` cần fixture + three reloads + MV3 restart pass.
- [ ] Nếu fail, expose `unavailable` với reason; không dùng private endpoint.

**Acceptance:**

- Không có source “half-supported”.
- Unavailable source không chặn Meta/Google/TikTok.

### Task 34: Screenshot và manual media storage

**Files:**

- Create: `tools/POD all /pod-trend-harvester/lib/evidenceMedia.js`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.js`
- Create: `tools/POD all /pod-trend-harvester/tests/evidence-media.test.js`

**Interfaces:**

- `saveScreenshot(observation, image): EvidenceMedia`
- `saveSelectedCreative(observationId): Promise<EvidenceMedia>`
- `pruneScreenshots({ olderThanDays: 180 }): Promise<PruneResult>`

- [ ] Test content-hash dedupe.
- [ ] Test auto screenshot và no auto full-video download.
- [ ] Implement manual Save creative.
- [ ] Implement 180-day screenshot retention và temp cleanup.
- [ ] Warn saved media chỉ dùng research nội bộ.

**Acceptance:**

- Ad biến mất vẫn có screenshot.
- Full video chỉ tồn tại khi user chọn Save creative.

### Task 35: Hybrid scheduler và checkpoint recovery

**Files:**

- Create: `tools/POD all /pod-trend-harvester/lib/competitorScheduler.js`
- Modify: `tools/POD all /pod-trend-harvester/background.js`
- Modify: `tools/POD all /pod-trend-harvester/app/app.js`
- Create: `tools/POD all /pod-trend-harvester/tests/competitor-scheduler.test.js`

**Interfaces:**

- `scheduleCompetitorRuns(now): ScheduledRun[]`
- `resumeCompetitorJob(jobId): Promise<Job>`
- `requestRunNow(competitorId, now): RunDecision`

- [ ] Tests cho daily eligibility, 6-hour cooldown, missed catch-up và max 20.
- [ ] Tests cho sequential competitor/source execution.
- [ ] Persist checkpoint sau mỗi source.
- [ ] Resume sau MV3 interruption.
- [ ] CAPTCHA/login chuyển needs_attention, không retry loop.

**Acceptance:**

- Edge đóng không được hứa là job vẫn chạy.
- Một competitor/source lỗi không dừng queue.

### Task 36: Competitor-analysis skill

**Files:**

- Create: `.codex/skills/pod-competitor-ad-intelligence/SKILL.md`
- Create: `.codex/skills/pod-competitor-ad-intelligence/schemas/pod-competitor-ad-v1.schema.json`
- Create: `.codex/skills/pod-competitor-ad-intelligence/scripts/validate-input.mjs`
- Create: `.codex/skills/pod-competitor-ad-intelligence/references/evidence-policy.md`
- Create: `.codex/skills/pod-competitor-ad-intelligence/tests/validate-input.test.mjs`

**Interfaces:**

- Input: canonical competitor run folder.
- Output: validated normalized observations + analysis artifacts.

- [ ] Validate every JSONL line với line/field error.
- [ ] Enforce observed/derived/inferred labels.
- [ ] Refuse unknown schema version.
- [ ] Preserve claim -> observation -> URL/date chain.
- [ ] Add IP/no-copy policy.

**Acceptance:**

- Skill không crawl.
- Missing metrics không được invented.
- Competitor evidence không tạo trạng thái validated.

### Task 37: Change detection và reporting

**Files:**

- Create: `.codex/skills/pod-competitor-ad-intelligence/scripts/compare-runs.mjs`
- Create: `.codex/skills/pod-competitor-ad-intelligence/scripts/group-creative-families.mjs`
- Create: `.codex/skills/pod-competitor-ad-intelligence/scripts/write-report.mjs`
- Create: `.codex/skills/pod-competitor-ad-intelligence/templates/competitor-ad-report.md`
- Create: `.codex/skills/pod-competitor-ad-intelligence/tests/compare-runs.test.mjs`

**Interfaces:**

- `compareRuns(previous, current): CompetitorChange[]`
- `groupCreativeFamilies(observations): CreativeFamily[]`
- `writeCompetitorReport(input): ReportArtifacts`

- [ ] Tests cho price/offer/new-ad/variant/missing/reappeared changes.
- [ ] Multi-run absence policy; one missing run không inactive.
- [ ] Group creative family bằng deterministic copy/media hashes.
- [ ] Report coverage, identity, offers, creative angles, landing consistency,
  facts/inferences, IP risks và next validation.
- [ ] Reconcile counts trong run manifest.

**Acceptance:**

- Mọi report claim trace về evidence.
- Không report spend/targeting/ROAS/profit như fact.

### Task 38: Phase E end-to-end và Edge US verification

**Files:**

- Create: `tools/POD all /pod-trend-harvester/tests/competitor-e2e.test.js`
- Create: `tools/POD all /pod-trend-harvester/COMPETITOR-MANUAL-TEST.md`
- Modify: `docs/pod-trend-to-idea-runbook.md`

- [ ] E2E website -> identity -> ad capture -> export -> skill -> report.
- [ ] Test high-confidence auto-accept và ambiguous review.
- [ ] Test worker interruption/resume.
- [ ] Test one source failure không dừng sources khác.
- [ ] Test 20-competitor boundary.
- [ ] Manual test ba storefront stacks.
- [ ] Manual Meta + Google match và TikTok coverage limitation.
- [ ] Stable AdGuard US VPN run; record country, Edge/extension version, không
  lưu full IP.
- [ ] Manual screenshot + Save creative.
- [ ] Trace 10 report claims ngược về screenshot/source.

**Phase E acceptance:**

- Website URL là input bắt buộc duy nhất.
- Ít nhất 95% stored claims link tới observation/source.
- Ambiguous identity không auto-accept.
- Price/offer/ad changes xuất hiện trong change log.
- Missing ad không bị inactive ngay.
- Export không chứa cookie/token/session.
- Không auto-download full video.
- Real-page Edge verification được document theo source.

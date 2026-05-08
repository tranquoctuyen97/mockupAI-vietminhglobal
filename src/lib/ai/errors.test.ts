import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAIError } from "./errors";
import { OpenAiRequestError } from "./providers/openai";

describe("AI error parser", () => {
  it("shows a clear OpenAI API key error", () => {
    const parsed = parseAIError(
      new OpenAiRequestError(
        401,
        "Incorrect API key provided: sk-***. You can find your API key at https://platform.openai.com/account/api-keys.",
        "invalid_api_key",
        "invalid_request_error",
      ),
    );

    assert.equal(parsed.code, "auth_failed");
    assert.equal(parsed.retryable, false);
    assert.match(parsed.userMessage, /API key không hợp lệ/);
  });

  it("shows quota or billing errors distinctly from unknown failures", () => {
    const parsed = parseAIError(
      new OpenAiRequestError(
        429,
        "You exceeded your current quota, please check your plan and billing details.",
        "insufficient_quota",
        "insufficient_quota",
      ),
    );

    assert.equal(parsed.code, "quota_or_billing_required");
    assert.equal(parsed.retryable, false);
    assert.match(parsed.userMessage, /quota\/billing/);
  });
});

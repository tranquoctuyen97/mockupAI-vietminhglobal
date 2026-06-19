import assert from "node:assert/strict";
import test from "node:test";
import { buildListingUserPrompt } from "./providers/shared";

test("buildListingUserPrompt includes both light and dark design names when provided", () => {
  const prompt = buildListingUserPrompt({
    designName: "Cat - Sáng / Cat - Tối",
    productType: "T-Shirt",
    placement: "Front",
    colors: ["White", "Black"],
  });
  assert.match(prompt, /Cat - Sáng/);
  assert.match(prompt, /Cat - Tối/);
  assert.match(prompt, /White, Black/);
});

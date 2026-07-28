import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { fetchMcpImage, McpImageImportError, redactSourceUrl } from "./fetch-image";

async function imageBuffer(format: "png" | "jpeg"): Promise<Buffer> {
  const image = sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: { r: 20, g: 40, b: 60, alpha: 1 },
    },
  });
  return format === "png" ? image.png().toBuffer() : image.jpeg().toBuffer();
}

test("accepts PNG and JPEG by magic bytes regardless of Content-Type", async () => {
  const png = await imageBuffer("png");
  const jpeg = await imageBuffer("jpeg");

  for (const [buffer, expectedMime, expectedExtension] of [
    [png, "image/png", "png"],
    [jpeg, "image/jpeg", "jpg"],
  ] as const) {
    const imported = await fetchMcpImage("http://127.0.0.1/source?token=secret", {
      fetchImpl: async () =>
        new Response(new Uint8Array(buffer), {
          headers: { "Content-Type": "text/html" },
        }),
    });

    assert.equal(imported.mimeType, expectedMime);
    assert.equal(imported.extension, expectedExtension);
    assert.equal(imported.width, 3);
    assert.equal(imported.height, 2);
    assert.equal(imported.redactedSourceUrl, "http://127.0.0.1/source");
  }
});

test("rejects HTML even when the server labels it as an image", async () => {
  await assert.rejects(
    fetchMcpImage("https://assets.example.test/not-image", {
      fetchImpl: async () =>
        new Response("<html>nope</html>", {
          headers: { "Content-Type": "image/png" },
        }),
    }),
    (error: unknown) => error instanceof McpImageImportError && error.code === "UNSUPPORTED_IMAGE",
  );
});

test("rejects oversized Content-Length before reading the response body", async () => {
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array([0x89]));
        controller.close();
      },
    }),
    { headers: { "Content-Length": "101" } },
  );

  await assert.rejects(
    fetchMcpImage("https://assets.example.test/large.png", {
      fetchImpl: async () => response,
      maxBytes: 100,
    }),
    (error: unknown) => error instanceof McpImageImportError && error.code === "IMAGE_TOO_LARGE",
  );
});

test("stops a streamed response as soon as it crosses the byte limit", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
        controller.enqueue(new Uint8Array(20));
        controller.close();
      },
    }),
  );

  await assert.rejects(
    fetchMcpImage("https://assets.example.test/stream.png", {
      fetchImpl: async () => response,
      maxBytes: 16,
    }),
    (error: unknown) => error instanceof McpImageImportError && error.code === "IMAGE_TOO_LARGE",
  );
});

test("follows at most five manual redirects and resolves relative Location", async () => {
  const png = await imageBuffer("png");
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const step = Number(new URL(url).pathname.slice(1) || "0");
    if (step < 5) {
      return new Response(null, {
        status: 302,
        headers: { Location: `/${step + 1}?credential=hidden` },
      });
    }
    return new Response(new Uint8Array(png));
  };

  const imported = await fetchMcpImage("http://10.0.0.8/0?credential=hidden", { fetchImpl });
  assert.equal(imported.mimeType, "image/png");
  assert.equal(calls.length, 6);
  assert.equal(imported.redactedSourceUrl, "http://10.0.0.8/5");

  await assert.rejects(
    fetchMcpImage("http://169.254.1.10/0", {
      fetchImpl: async (input) => {
        const step = Number(new URL(String(input)).pathname.slice(1) || "0");
        return new Response(null, {
          status: 302,
          headers: { Location: `/${step + 1}` },
        });
      },
    }),
    (error: unknown) => error instanceof McpImageImportError && error.code === "TOO_MANY_REDIRECTS",
  );
});

test("uses GET/manual redirect with only the importer Accept header", async () => {
  const png = await imageBuffer("png");
  let seenInit: RequestInit | undefined;

  await fetchMcpImage("http://localhost:3000/image.png", {
    fetchImpl: async (_input, init) => {
      seenInit = init;
      return new Response(new Uint8Array(png));
    },
  });

  assert.equal(seenInit?.method, "GET");
  assert.equal(seenInit?.redirect, "manual");
  assert.deepEqual(seenInit?.headers, { Accept: "image/png,image/jpeg" });
  assert.ok(seenInit?.signal);
});

test("applies one total timeout and never leaks URL query credentials in errors", async () => {
  const secretUrl = "https://user:password@assets.example.test/image.png?token=very-secret#x";

  await assert.rejects(
    fetchMcpImage(secretUrl, {
      timeoutMs: 5,
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof McpImageImportError);
      assert.equal(error.code, "FETCH_TIMEOUT");
      assert.doesNotMatch(error.message, /very-secret|password|token=/);
      return true;
    },
  );

  assert.equal(redactSourceUrl(secretUrl), "https://assets.example.test/image.png");
});

test("rejects protocols other than HTTP and HTTPS", async () => {
  await assert.rejects(
    fetchMcpImage("file:///tmp/image.png", {
      fetchImpl: async () => {
        throw new Error("must not fetch");
      },
    }),
    (error: unknown) => error instanceof McpImageImportError && error.code === "INVALID_IMAGE_URL",
  );
});

/**
 * Printify REST API Client
 * Base URL: https://api.printify.com/v1
 */

import type { Blueprint, PrintifyShop, PrintProvider, Variant } from "./types";

const PRINTIFY_BASE_URL = "https://api.printify.com/v1";
const PRINTIFY_USER_AGENT =
  process.env.PRINTIFY_USER_AGENT || "MockupAI/1.0 (support@vmgfashion.online)";
const PRINTIFY_GET_NETWORK_ATTEMPTS = 2;
const PRINTIFY_PRE_CONNECT_NETWORK_ATTEMPTS = 3;

export interface PrintifyUploadImageResponse {
  id: string;
  file_name?: string;
  height?: number;
  width?: number;
  preview_url?: string;
}

export interface PrintifyProductImage {
  id?: string;
  mockup_id?: string;
  src: string;
  variant_ids?: number[];
  position?: string;
  is_default?: boolean;
}

export interface PrintifyProductOptionValue {
  id: number;
  title: string;
  colors?: string[];
}

export interface PrintifyProductOption {
  name: string;
  type: string;
  values: PrintifyProductOptionValue[];
  display_in_preview?: boolean;
}

export interface PrintifyProductVariant {
  id: number;
  title?: string;
  sku?: string;
  cost?: number; // cents (only in shop product, not catalog)
  price?: number; // cents
  grams?: number;
  is_enabled?: boolean;
  is_default?: boolean;
  is_available?: boolean;
  options?: number[]; // option value IDs
}

export interface PrintifyProductResponse {
  id: string;
  title: string;
  blueprint_id: number;
  print_provider_id: number;
  tags?: unknown;
  images?: PrintifyProductImage[];
  variants?: PrintifyProductVariant[];
  options?: PrintifyProductOption[];
  external?: { id: string; handle?: string } | Array<{ id: string; handle?: string }>;
}

export interface PrintifyPublishPayload {
  title: boolean;
  description: boolean;
  images: boolean;
  variants: boolean;
  tags: boolean;
  keyFeatures?: boolean;
  shipping_template?: boolean;
}

export type PrintifyRequestHookInput = {
  endpoint: string;
  method: string;
};

export type PrintifyRateLimitHookInput = PrintifyRequestHookInput & {
  retryAfterMs: number | null;
};

export type PrintifyClientHooks = {
  beforeRequest?: (input: PrintifyRequestHookInput) => Promise<void>;
  onRateLimit?: (input: PrintifyRateLimitHookInput) => Promise<void>;
};

export class PrintifyClient {
  private apiKey: string;
  private hooks: PrintifyClientHooks;

  constructor(apiKey: string, hooks: PrintifyClientHooks = {}) {
    this.apiKey = apiKey;
    this.hooks = hooks;
  }

  /**
   * Make authenticated request to Printify API
   */
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${PRINTIFY_BASE_URL}${path}`;
    const method = (options?.method ?? "GET").toUpperCase();
    await this.hooks.beforeRequest?.({ endpoint: path, method });
    const requestInit = {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": PRINTIFY_USER_AGENT,
        ...options?.headers,
      },
    };
    const response = await fetchWithNetworkRetry(url, requestInit, {
      endpoint: path,
      method,
    });

    if (!response.ok) {
      const responseBody = await response.text();
      const parsedBody = parsePrintifyResponseBody(responseBody);
      const requestId =
        readObjectValue(parsedBody, "request_id") ?? response.headers.get("x-request-id") ?? null;
      const metadata: PrintifyErrorMetadata = {
        status: response.status,
        endpoint: path,
        method,
        responseBody,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
        requestId,
      };

      if (response.status === 401) {
        throw new PrintifyAuthError("Printify API key is invalid or expired.", metadata);
      }

      if (response.status === 402) {
        throw new PrintifyBillingError(
          "Printify account billing or quota action is required.",
          metadata,
        );
      }

      if (response.status === 403) {
        throw new PrintifyPermissionError(
          "Printify API key does not have permission for this operation.",
          metadata,
        );
      }

      if (response.status === 429) {
        const rateLimitError = new PrintifyRateLimitError(
          "Printify rate limit exceeded. Try again later.",
          metadata,
        );
        try {
          await this.hooks.onRateLimit?.({
            endpoint: path,
            method,
            retryAfterMs: metadata.retryAfterMs ?? null,
          });
        } catch (cooldownError) {
          console.warn("[PrintifyClient] Failed to persist Printify cooldown metadata:", {
            endpoint: path,
            method,
            error: cooldownError instanceof Error ? cooldownError.message : String(cooldownError),
          });
        }
        throw rateLimitError;
      }

      if (response.status === 404) {
        throw new PrintifyNotFoundError(
          `Printify resource not found (404): ${responseBody}`,
          metadata,
        );
      }

      if (response.status === 400 || response.status === 422) {
        throw new PrintifyValidationError(
          `Printify rejected the request (${response.status}).`,
          metadata,
        );
      }

      if (response.status >= 500 && response.status <= 599) {
        throw new PrintifyServerError(`Printify server error (${response.status}).`, metadata);
      }

      throw new PrintifyApiError(
        `Printify API error (${response.status}): ${responseBody}`,
        metadata,
      );
    }

    return (await response.json()) as T;
  }

  /**
   * List shops — used for connection test + shop selection
   */
  async getShops(): Promise<PrintifyShop[]> {
    return this.request<PrintifyShop[]>("/shops.json");
  }

  /**
   * Test connection
   */
  async testConnection(): Promise<{ ok: boolean; shops?: PrintifyShop[]; error?: string }> {
    try {
      const shops = await this.getShops();
      return { ok: true, shops };
    } catch (error) {
      if (error instanceof PrintifyAuthError) {
        return { ok: false, error: "API key invalid or expired" };
      }
      return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  /**
   * Get catalog blueprints (product types)
   */
  async getBlueprints(): Promise<Blueprint[]> {
    return this.request<Blueprint[]>("/catalog/blueprints.json");
  }

  /**
   * Get print providers for a blueprint
   */
  async getBlueprintPrintProviders(blueprintId: number): Promise<PrintProvider[]> {
    return this.request<PrintProvider[]>(`/catalog/blueprints/${blueprintId}/print_providers.json`);
  }

  /**
   * Get variants for a blueprint + print provider combo
   */
  async getBlueprintVariants(
    blueprintId: number,
    printProviderId: number,
  ): Promise<{ variants: Variant[] }> {
    return this.request<{ variants: Variant[] }>(
      `/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`,
    );
  }

  async uploadImageBase64(input: {
    fileName: string;
    contentsBase64: string;
  }): Promise<PrintifyUploadImageResponse> {
    return this.request<PrintifyUploadImageResponse>("/uploads/images.json", {
      method: "POST",
      body: JSON.stringify({
        file_name: input.fileName,
        contents: input.contentsBase64,
      }),
    });
  }

  async uploadImageUrl(input: {
    fileName: string;
    url: string;
  }): Promise<PrintifyUploadImageResponse> {
    return this.request<PrintifyUploadImageResponse>("/uploads/images.json", {
      method: "POST",
      body: JSON.stringify({
        file_name: input.fileName,
        url: input.url,
      }),
    });
  }

  async createProduct(shopId: number, payload: unknown): Promise<PrintifyProductResponse> {
    return this.request<PrintifyProductResponse>(`/shops/${shopId}/products.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateProduct(
    shopId: number,
    productId: string,
    payload: unknown,
  ): Promise<PrintifyProductResponse> {
    return this.request<PrintifyProductResponse>(`/shops/${shopId}/products/${productId}.json`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async getProduct(shopId: number, productId: string): Promise<PrintifyProductResponse> {
    return this.request<PrintifyProductResponse>(`/shops/${shopId}/products/${productId}.json`);
  }

  async getProducts(
    shopId: number,
    page: number = 1,
  ): Promise<{ data: PrintifyProductResponse[] }> {
    return this.request<{ data: PrintifyProductResponse[] }>(
      `/shops/${shopId}/products.json?page=${page}`,
    );
  }

  async deleteProduct(shopId: number, productId: string): Promise<void> {
    await this.request<unknown>(`/shops/${shopId}/products/${productId}.json`, {
      method: "DELETE",
    });
  }

  async publishProduct(
    shopId: number,
    productId: string,
    payload: PrintifyPublishPayload,
  ): Promise<unknown> {
    return this.request<unknown>(`/shops/${shopId}/products/${productId}/publish.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async unpublishProduct(shopId: number, productId: string): Promise<unknown> {
    return this.request<unknown>(`/shops/${shopId}/products/${productId}/unpublish.json`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }
}

async function fetchWithNetworkRetry(
  url: string,
  init: RequestInit,
  input: PrintifyRequestHookInput,
): Promise<Response> {
  const maxAttempts =
    input.method === "GET" ? PRINTIFY_GET_NETWORK_ATTEMPTS : PRINTIFY_PRE_CONNECT_NETWORK_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableNetworkFetchError(error, input.method)) {
        throw error;
      }
      console.warn("[PrintifyClient] Retrying transient Printify network failure:", {
        endpoint: input.endpoint,
        method: input.method,
        attempt,
        maxAttempts,
        error: error instanceof Error ? error.message : String(error),
        causeCode: readErrorCauseCode(error),
      });
    }
  }

  throw lastError;
}

function isRetryableNetworkFetchError(error: unknown, method: string): boolean {
  if (!(error instanceof TypeError) || error.message !== "fetch failed") return false;
  const causeCode = readErrorCauseCode(error);
  const isTransientReadError =
    causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
    causeCode === "ENOTFOUND" ||
    causeCode === "ECONNRESET" ||
    causeCode === "ETIMEDOUT" ||
    causeCode === "EAI_AGAIN";
  if (method === "GET") return isTransientReadError;

  return (
    causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
    causeCode === "ENOTFOUND" ||
    causeCode === "ETIMEDOUT" ||
    causeCode === "EAI_AGAIN"
  );
}

function readErrorCauseCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const cause = error.cause;
  if (!cause || typeof cause !== "object" || !("code" in cause)) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export type PrintifyErrorMetadata = {
  status: number;
  endpoint: string;
  method: string;
  responseBody: string;
  retryAfterMs?: number | null;
  requestId?: string | null;
};

function parsePrintifyResponseBody(responseBody: string): unknown {
  try {
    return JSON.parse(responseBody);
  } catch {
    return null;
  }
}

function readObjectValue(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const raw = record[key];
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function readPrintifyErrorCode(responseBody: string): number | string | undefined {
  const parsed = parsePrintifyResponseBody(responseBody);
  if (!parsed || typeof parsed !== "object") return undefined;
  const body = parsed as { code?: unknown; errors?: { code?: unknown } };
  const code = body.code ?? body.errors?.code;
  return typeof code === "number" || typeof code === "string" ? code : undefined;
}

export function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}

class PrintifyHttpError extends Error {
  public readonly status: number;
  public readonly endpoint: string;
  public readonly method: string;
  public readonly responseBody: string;
  public readonly retryAfterMs: number | null;
  public readonly requestId: string | null;

  constructor(message: string, metadata: PrintifyErrorMetadata) {
    super(message);
    this.status = metadata.status;
    this.endpoint = metadata.endpoint;
    this.method = metadata.method;
    this.responseBody = metadata.responseBody;
    this.retryAfterMs = metadata.retryAfterMs ?? null;
    this.requestId = metadata.requestId ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PrintifyAuthenticationError extends PrintifyHttpError {
  constructor(message: string, metadata: PrintifyErrorMetadata) {
    super(message, metadata);
    this.name = "PrintifyAuthenticationError";
  }
}

// Backward-compatible alias for existing callers.
export class PrintifyAuthError extends PrintifyAuthenticationError {
  constructor(message: string, metadata: PrintifyErrorMetadata) {
    super(message, metadata);
    this.name = "PrintifyAuthError";
  }
}

export class PrintifyPermissionError extends PrintifyHttpError {
  constructor(message: string, metadata: PrintifyErrorMetadata) {
    super(message, metadata);
    this.name = "PrintifyPermissionError";
  }
}

export class PrintifyBillingError extends PrintifyHttpError {
  constructor(message: string, metadata: PrintifyErrorMetadata) {
    super(message, metadata);
    this.name = "PrintifyBillingError";
  }
}

export class PrintifyValidationError extends PrintifyHttpError {
  public readonly code?: number | string;

  constructor(message: string, metadata: PrintifyErrorMetadata) {
    super(message, metadata);
    this.name = "PrintifyValidationError";
    this.code = readPrintifyErrorCode(metadata.responseBody);
  }
}

export class PrintifyServerError extends PrintifyHttpError {
  constructor(message: string, metadata: PrintifyErrorMetadata) {
    super(message, metadata);
    this.name = "PrintifyServerError";
  }
}

export class PrintifyApiError extends PrintifyHttpError {
  public readonly body?: unknown;
  public readonly code?: number | string;

  constructor(message: string, metadata: PrintifyErrorMetadata) {
    super(message, metadata);
    this.name = "PrintifyApiError";
    this.body = parsePrintifyResponseBody(metadata.responseBody) ?? undefined;
    this.code = readPrintifyErrorCode(metadata.responseBody);
  }
}

export class PrintifyRateLimitError extends PrintifyHttpError {
  constructor(message: string, metadata: PrintifyErrorMetadata) {
    super(message, metadata);
    this.name = "PrintifyRateLimitError";
  }
}

export class PrintifyNotFoundError extends PrintifyHttpError {
  constructor(message: string, metadata: PrintifyErrorMetadata) {
    super(message, metadata);
    this.name = "PrintifyNotFoundError";
  }
}

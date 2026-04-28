/**
 * Printify REST API Client
 * Base URL: https://api.printify.com/v1
 */

import type { PrintifyShop, Blueprint, PrintProvider, Variant } from "./types";

const PRINTIFY_BASE_URL = "https://api.printify.com/v1";

export interface PrintifyUploadImageResponse {
  id: string;
  file_name?: string;
  height?: number;
  width?: number;
  preview_url?: string;
}

export interface PrintifyProductImage {
  id?: string;
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
  cost?: number;           // cents (only in shop product, not catalog)
  price?: number;          // cents
  grams?: number;
  is_enabled?: boolean;
  is_default?: boolean;
  is_available?: boolean;
  options?: number[];      // option value IDs
}

export interface PrintifyProductResponse {
  id: string;
  title: string;
  images?: PrintifyProductImage[];
  variants?: PrintifyProductVariant[];
  options?: PrintifyProductOption[];
  external?: { id: string; handle?: string };
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

export class PrintifyClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Make authenticated request to Printify API
   */
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${PRINTIFY_BASE_URL}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (response.status === 401 || response.status === 403) {
      throw new PrintifyAuthError("API key invalid or expired");
    }

    if (response.status === 429) {
      throw new PrintifyRateLimitError("Rate limit exceeded. Try again later.");
    }

    if (response.status === 404) {
      const text = await response.text();
      throw new PrintifyNotFoundError(`Printify resource not found (404): ${text}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new PrintifyApiError(`Printify API error (${response.status}): ${text}`);
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
  async getBlueprintVariants(blueprintId: number, printProviderId: number): Promise<{ variants: Variant[] }> {
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

  async createProduct(
    shopId: number,
    payload: unknown,
  ): Promise<PrintifyProductResponse> {
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
    return this.request<PrintifyProductResponse>(
      `/shops/${shopId}/products/${productId}.json`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
  }

  async getProduct(
    shopId: number,
    productId: string,
  ): Promise<PrintifyProductResponse> {
    return this.request<PrintifyProductResponse>(
      `/shops/${shopId}/products/${productId}.json`,
    );
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
    return this.request<unknown>(
      `/shops/${shopId}/products/${productId}/publish.json`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  }
}

// Error classes
export class PrintifyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintifyAuthError";
  }
}

export class PrintifyApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintifyApiError";
  }
}

export class PrintifyRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintifyRateLimitError";
  }
}

export class PrintifyNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintifyNotFoundError";
  }
}

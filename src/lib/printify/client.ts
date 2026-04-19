/**
 * Printify REST API Client
 * Base URL: https://api.printify.com/v1
 */

import type { PrintifyShop, Blueprint, PrintProvider, Variant } from "./types";

const PRINTIFY_BASE_URL = "https://api.printify.com/v1";

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

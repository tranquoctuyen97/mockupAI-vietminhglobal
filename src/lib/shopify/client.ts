/**
 * Shopify Admin GraphQL API Client
 */

import type { ShopInfo } from "./types";

const SHOPIFY_API_VERSION = "2025-04";

export class ShopifyClient {
  private domain: string;
  private accessToken: string;
  private graphqlUrl: string;

  constructor(domain: string, accessToken: string) {
    this.domain = domain;
    this.accessToken = accessToken;
    this.graphqlUrl = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  }

  /**
   * Execute GraphQL query/mutation
   */
  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 401 || response.status === 403) {
      throw new ShopifyAuthError("Token expired or invalid");
    }

    if (!response.ok) {
      const text = await response.text();
      throw new ShopifyApiError(`Shopify API error (${response.status}): ${text}`);
    }

    const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

    if (json.errors && json.errors.length > 0) {
      throw new ShopifyApiError(json.errors.map((e) => e.message).join("; "));
    }

    if (!json.data) {
      throw new ShopifyApiError("No data in Shopify response");
    }

    return json.data;
  }

  /**
   * Get shop info — used for connection test
   */
  async getShop(): Promise<ShopInfo> {
    const query = `
      query {
        shop {
          id
          name
          email
          myshopifyDomain
          plan {
            displayName
          }
          currencyCode
        }
      }
    `;

    const data = await this.graphql<{ shop: ShopInfo }>(query);
    return data.shop;
  }

  /**
   * Test connection — lightweight check
   */
  async testConnection(): Promise<{ ok: boolean; shopName?: string; error?: string }> {
    try {
      const shop = await this.getShop();
      return { ok: true, shopName: shop.name };
    } catch (error) {
      if (error instanceof ShopifyAuthError) {
        return { ok: false, error: "Token expired or invalid" };
      }
      return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }
}

// Error classes
export class ShopifyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyAuthError";
  }
}

export class ShopifyApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

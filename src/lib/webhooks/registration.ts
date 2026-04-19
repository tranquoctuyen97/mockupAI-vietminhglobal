/**
 * Auto-register Shopify webhooks for a store
 * Uses webhookSubscriptionCreate GraphQL mutation
 */

import { ShopifyClient } from "@/lib/shopify/client";

const WEBHOOK_TOPICS = ["ORDERS_CREATE", "ORDERS_UPDATED"] as const;

/**
 * Register order webhooks for a store
 * Idempotent — Shopify ignores duplicates
 */
export async function registerOrderWebhooks(
  shopifyClient: ShopifyClient,
  callbackBaseUrl: string,
): Promise<{ registered: string[]; errors: string[] }> {
  const registered: string[] = [];
  const errors: string[] = [];
  const callbackUrl = `${callbackBaseUrl}/api/webhooks/shopify/orders`;

  for (const topic of WEBHOOK_TOPICS) {
    try {
      const result = await shopifyClient.graphql<{
        webhookSubscriptionCreate: {
          webhookSubscription: { id: string; topic: string } | null;
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }>(
        `mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
            webhookSubscription {
              id
              topic
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          topic,
          webhookSubscription: {
            callbackUrl,
            format: "JSON",
          },
        },
      );

      const { webhookSubscription, userErrors } = result.webhookSubscriptionCreate;

      if (userErrors.length > 0) {
        // "has already been taken" = already registered = OK
        const alreadyTaken = userErrors.some((e) =>
          e.message.toLowerCase().includes("already been taken"),
        );
        if (alreadyTaken) {
          registered.push(topic);
        } else {
          errors.push(`${topic}: ${userErrors.map((e) => e.message).join(", ")}`);
        }
      } else if (webhookSubscription) {
        registered.push(topic);
      }
    } catch (error) {
      errors.push(
        `${topic}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  return { registered, errors };
}

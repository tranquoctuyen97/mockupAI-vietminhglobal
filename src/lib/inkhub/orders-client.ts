import { getToken, invalidateToken } from "@/lib/inkhub/token";

const INKHUB_API_ORIGIN = "https://api-inkhub-v2.grabink.co";
const DEFAULT_PAGE_SIZE = 100;

export type InkhubOrdersPage = {
  items: Array<Record<string, unknown>>;
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
};

export type InkhubOrderDateRange = {
  fromDate?: Date | string;
  toDate?: Date | string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePage(
  payload: unknown,
  requestedPage: number,
  requestedPageSize: number,
): InkhubOrdersPage {
  const body = asRecord(payload);
  const items = Array.isArray(body.items)
    ? body.items.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      )
    : [];
  const total = Math.max(0, Math.trunc(asNumber(body.total, items.length)));
  const pageSize = Math.max(1, Math.trunc(asNumber(body.pageSize, requestedPageSize)));
  const totalPages = Math.max(
    1,
    Math.trunc(asNumber(body.totalPages, Math.ceil(total / pageSize))),
  );
  return {
    items,
    total,
    totalPages,
    page: Math.max(1, Math.trunc(asNumber(body.page, requestedPage))),
    pageSize,
  };
}

async function requestPage(
  tenantId: string,
  shopId: number,
  page: number,
  pageSize: number,
  dateRange?: InkhubOrderDateRange,
): Promise<Response> {
  const { token, orgId } = await getToken(tenantId);
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  query.append("shopIds[]", String(shopId));
  if (dateRange?.fromDate !== undefined) {
    query.set("fromDate", serializeDateParam(dateRange.fromDate));
  }
  if (dateRange?.toDate !== undefined) {
    query.set("toDate", serializeDateParam(dateRange.toDate));
  }
  return fetch(`${INKHUB_API_ORIGIN}/api/orders?${query.toString()}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "organization-id": orgId,
    },
    cache: "no-store",
  });
}

function serializeDateParam(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function fetchInkhubOrdersPage(
  tenantId: string,
  shopId: number,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  dateRange?: InkhubOrderDateRange,
): Promise<InkhubOrdersPage> {
  let response = await requestPage(tenantId, shopId, page, pageSize, dateRange);
  if (response.status === 401) {
    invalidateToken(tenantId);
    response = await requestPage(tenantId, shopId, page, pageSize, dateRange);
  }
  if (!response.ok) {
    throw new Error(`Inkhub orders request failed: ${response.status}`);
  }
  return parsePage(await response.json(), page, pageSize);
}

export async function fetchInkhubShopStats(
  tenantId: string,
): Promise<Array<{ id: number; label: string; count: number }>> {
  const { token, orgId } = await getToken(tenantId);
  const response = await fetch(`${INKHUB_API_ORIGIN}/api/orders/stats/by-shop`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "organization-id": orgId,
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Inkhub shop stats request failed: ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload
    .map((value) => {
      const row = asRecord(value);
      return {
        id: Math.trunc(asNumber(row.id, -1)),
        label: String(row.label ?? ""),
        count: Math.max(0, Math.trunc(asNumber(row.count, 0))),
      };
    })
    .filter((row) => row.id >= 0 && row.label.length > 0);
}

export { DEFAULT_PAGE_SIZE as INKHUB_PAGE_SIZE };

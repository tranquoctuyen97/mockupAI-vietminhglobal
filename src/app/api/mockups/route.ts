import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { storageUrl } from "@/lib/mockup/custom-library";
import { normalizeMockupLibraryScene, normalizeMockupLibraryView } from "@/lib/mockup/global-library";
import {
  createMockupLibraryItemFromUpload,
  MockupLibraryValidationError,
  parseMultipartJson,
} from "@/lib/mockup/mockup-library-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const storeId = url.searchParams.get("storeId");
  const viewParam = url.searchParams.get("view");
  const sceneTypeParam = url.searchParams.get("sceneType");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(80, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
  const skip = (page - 1) * limit;
  const view = viewParam ? normalizeMockupLibraryView(viewParam) : null;
  const sceneType = sceneTypeParam ? normalizeMockupLibraryScene(sceneTypeParam) : null;
  if (viewParam && !view) return NextResponse.json({ error: "view is invalid" }, { status: 400 });
  if (sceneTypeParam && !sceneType) return NextResponse.json({ error: "sceneType is invalid" }, { status: 400 });

  const where = {
    tenantId: session.tenantId,
    isActive: true,
    deletedAt: null,
    ...(storeId ? { storeId } : {}),
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    ...(view ? { view } : {}),
    ...(sceneType ? { sceneType } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.mockupLibraryItem.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip,
      take: limit,
      include: { _count: { select: { templateItems: true } } },
    }),
    prisma.mockupLibraryItem.count({ where }),
  ]);

  return NextResponse.json(
    {
      items: items.map((item) => ({
        ...item,
        imageUrl: storageUrl(item.storagePath),
        previewUrl: item.previewPath ? storageUrl(item.previewPath) : null,
        templateAttachmentCount: item._count.templateItems,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    },
    {
      headers: { "Cache-Control": "private, max-age=10" },
    },
  );
}

export async function POST(request: Request) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const form = await request.formData();
  const file = form.get("file");
  if (!isFileLike(file)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const storeId = String(form.get("storeId") ?? "");
  if (!storeId) {
    return NextResponse.json({ error: "storeId is required" }, { status: 400 });
  }

  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found or not active" }, { status: 400 });
  }

  try {
    const item = await createMockupLibraryItemFromUpload({
      tenantId: session.tenantId,
      storeId: store.id,
      uploadedById: session.id,
      file,
      name: String(form.get("name") ?? ""),
      view: String(form.get("view") ?? "front"),
      sceneType: String(form.get("sceneType") ?? "flat_lay"),
      renderMode: form.get("renderMode"),
      compositeRegionPx: parseMultipartJson(form.get("compositeRegionPx"), "compositeRegionPx"),
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof MockupLibraryValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

function isFileLike(value: FormDataEntryValue | null): value is File {
  return (
    !!value &&
    typeof value !== "string" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.type === "string" &&
    typeof value.size === "number"
  );
}

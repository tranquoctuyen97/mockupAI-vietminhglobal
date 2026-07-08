import type {
  PrintifyProductOption,
  PrintifyProductOptionValue,
  PrintifyProductResponse,
} from "./client";

export type EnabledPrintifyVariantMatrixRow = {
  printifyVariantId: number;
  sku: string;
  title: string;
  colorName: string;
  colorHex: string | null;
  size: string;
  priceCents: number;
};

type OptionValueWithType = PrintifyProductOptionValue & { type: string };

export class PrintifyVariantMatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintifyVariantMatrixError";
  }
}

export function extractEnabledPrintifyVariantMatrix(
  product: PrintifyProductResponse,
): EnabledPrintifyVariantMatrixRow[] {
  const optionLookup = buildOptionLookup(product.options ?? []);
  const rows = (product.variants ?? [])
    .filter((variant) => variant.is_enabled === true)
    .map((variant) => {
      const sku = variant.sku?.trim() ?? "";
      if (!sku) {
        throw new PrintifyVariantMatrixError(
          `Missing SKU for enabled Printify variant ${variant.id}`,
        );
      }

      const optionValues = (variant.options ?? [])
        .map((id) => optionLookup.get(id))
        .filter((value): value is OptionValueWithType => Boolean(value));
      const colorOption = optionValues.find((value) => value.type === "color");
      const sizeOption = optionValues.find((value) => value.type === "size");
      const titleParts = splitVariantTitle(variant.title);

      return {
        printifyVariantId: variant.id,
        sku,
        title: variant.title ?? "",
        colorName: colorOption?.title ?? titleParts.colorName ?? "Unknown",
        colorHex: colorOption?.colors?.[0] ?? null,
        size: sizeOption?.title ?? titleParts.size ?? "ONE_SIZE",
        priceCents: variant.price ?? 0,
      };
    });

  if (rows.length === 0) {
    throw new PrintifyVariantMatrixError(`No enabled Printify variants for product ${product.id}`);
  }

  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.sku.toLowerCase();
    if (seen.has(key)) {
      throw new PrintifyVariantMatrixError(`Duplicate Printify SKU: ${row.sku}`);
    }
    seen.add(key);
  }

  return rows;
}

function buildOptionLookup(options: PrintifyProductOption[]): Map<number, OptionValueWithType> {
  const lookup = new Map<number, OptionValueWithType>();
  for (const option of options) {
    for (const value of option.values ?? []) {
      lookup.set(value.id, { ...value, type: option.type });
    }
  }
  return lookup;
}

function splitVariantTitle(title: string | undefined): {
  colorName: string | null;
  size: string | null;
} {
  if (!title) return { colorName: null, size: null };
  const parts = title
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { colorName: null, size: null };
  if (parts.length === 1) return { colorName: parts[0], size: "ONE_SIZE" };
  return {
    colorName: parts[0],
    size: parts[parts.length - 1],
  };
}

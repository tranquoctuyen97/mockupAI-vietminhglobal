import { z } from "zod";

export const ViewKeySchema = z.enum([
  "front",
  "back",
  "sleeve_left",
  "sleeve_right",
  "neck_label",
  "hem",
]);

export const PlacementModeSchema = z.enum(["stretch", "preserve", "exact"]);

export const PlacementSchema = z.object({
  xMm: z.number(),
  yMm: z.number(),
  widthMm: z.number().positive("widthMm must be positive"),
  heightMm: z.number().positive("heightMm must be positive"),
  rotationDeg: z.number().min(-360).max(360).optional(),
  lockAspect: z.boolean().optional(),
  mirrored: z.boolean().optional(),
  placementMode: PlacementModeSchema.optional(),
  presetKey: z.string().optional(),
  imageOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

export const VariantViewsSchema = z.object({
  front: PlacementSchema.nullable().optional(),
  back: PlacementSchema.nullable().optional(),
  sleeve_left: PlacementSchema.nullable().optional(),
  sleeve_right: PlacementSchema.nullable().optional(),
  neck_label: PlacementSchema.nullable().optional(),
  hem: PlacementSchema.nullable().optional(),
}).strict();

export const PlacementDataSchema = z.object({
  version: z.union([z.literal(2), z.literal("2.1")]).default("2.1"),
  variants: z.object({
    _default: VariantViewsSchema,
  }).catchall(VariantViewsSchema),
}).strict();

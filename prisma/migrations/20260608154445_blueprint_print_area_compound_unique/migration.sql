-- AlterTable: Drop unique on printify_blueprint_id alone,
-- add compound unique (printify_blueprint_id, position)
-- to support multiple positions per blueprint

-- Drop old unique index
DROP INDEX IF EXISTS "blueprint_print_areas_printify_blueprint_id_key";

-- Create compound unique
CREATE UNIQUE INDEX "blueprint_print_areas_printify_blueprint_id_position_key"
ON "blueprint_print_areas"("printify_blueprint_id", "position");

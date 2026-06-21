import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist`);
  return readFileSync(path, "utf8");
}

test("wizard mockup source panel uses the new template-default UX", () => {
  const source = read("src/components/mockup/WizardMockupSourcePanel.tsx");

  assert.doesNotMatch(source, /MODE_OPTIONS/);
  assert.match(source, /TemplateContextCard/);
  assert.match(source, /MockupPreviewSection/);
  assert.match(source, /activeSourceId/);
  assert.match(source, /UploadMockupModal/);
  assert.match(source, /mockup-library-picks/);
  // Banner removed — TemplateContextCard shows the source info instead
  assert.doesNotMatch(source, /Đang dùng Printify/);
});

test("custom mockup upload modal keeps metadata simple and uses canvas only for draft composite positioning", () => {
  const source = read("src/components/mockup/UploadMockupModal.tsx");

  assert.match(source, /Kéo ảnh vào đây, hoặc chọn từ máy/);
  assert.match(source, /File quá lớn/);
  assert.match(source, /Định dạng không hỗ trợ/);
  assert.match(source, /ReadOnlyField/);
  assert.match(source, /Template/);
  assert.match(source, /Màu/);
  assert.match(source, /Nhãn/);
  assert.doesNotMatch(source, /VIEW_OPTIONS|SCENE_OPTIONS/);
  assert.doesNotMatch(source, /Góc nhìn|Loại bối cảnh|Sort|Loại mockup|Đặt làm mặc định/);
  assert.doesNotMatch(source, /Hoàn chỉnh|Cần ghép/);
  assert.doesNotMatch(source, /CompositeRegionEditor/);
  assert.match(source, /CanvasPlacementEditor/);
  assert.match(source, /mode="CUSTOM_COMPOSITE"/);
  assert.match(source, /backgroundImageUrl=\{value\.previewUrl\}/);
  assert.match(source, /designImageUrl=\{designImageUrl\}/);
  assert.match(source, /showSaveButton=\{false\}/);
  assert.match(source, /borderRadius: 24/);
});

test("store template editor does not edit mockup composite regions directly", () => {
  const configSource = read("src/app/(authed)/stores/[id]/config/page.tsx");

  assert.doesNotMatch(configSource, /CompositeRegionEditor/);
  assert.doesNotMatch(configSource, /defaultCompositeRegionPx/);
  assert.doesNotMatch(configSource, /onChangeCompositeRegion/);
  assert.match(configSource, /TemplateMockupPicker/);
});

test("wizard custom default blocks missing custom colors without printify fallback copy", () => {
  const stepSource = read("src/app/(authed)/wizard/[draftId]/step-3/page.tsx");
  const panelSource = read("src/components/mockup/WizardMockupSourcePanel.tsx");
  const generationSource = read("src/lib/mockup/generation.ts");
  const workerSource = read("src/lib/mockup/printify-poll-worker.ts");

  assert.match(stepSource, /customAvailabilityByColorId/);
  assert.match(stepSource, /selectedMissingCustomColors/);
  assert.match(stepSource, /Màu này chưa có mockup custom/);
  assert.match(stepSource, /Bỏ màu/);
  assert.match(panelSource, /Màu này sẽ chưa thể tạo mockup/);
  assert.match(panelSource, /Mở Thư viện mockup/);
  assert.match(panelSource, /Đổi nguồn ảnh mặc định sang Printify/);
  assert.doesNotMatch(panelSource, /fallback sang Printify/);
  assert.match(generationSource, /CUSTOM_MOCKUP_MISSING_COLOR/);
  assert.match(generationSource, /chưa có mockup custom/);
  assert.match(workerSource, /bucket === "none"/);
});

test("wizard printify mode exposes canvas placement editor and keeps custom library out of the printify path", () => {
  const stepSource = read("src/app/(authed)/wizard/[draftId]/step-3/page.tsx");
  const panelSource = read("src/components/mockup/WizardMockupSourcePanel.tsx");
  const canvasSource = read("src/components/placement/CanvasPlacementEditor.tsx");

  assert.match(panelSource, /CanvasPlacementEditor/);
  // Printify StatusCard banner removed — TemplateContextCard shows source info
  assert.doesNotMatch(panelSource, /Template này sẽ dùng ảnh mockup do Printify render cho các màu đã chọn/);
  // OverrideButton still present and accessible for both modes
  assert.match(panelSource, /Thêm mockup riêng/);
  assert.match(canvasSource, /react-konva/);
  assert.match(canvasSource, /Transformer/);
  assert.match(canvasSource, /imageWidth/);
  assert.match(canvasSource, /imageHeight/);
  assert.match(canvasSource, /rotationDeg/);
});


test("composite editor exposes zoom toolbar, presets, live preview, and wizard context", () => {
  const source = read("src/components/mockup/CompositeRegionEditor.tsx");

  assert.match(source, /Zoom/);
  assert.match(source, /Mẫu nhanh/);
  assert.match(source, /Trước ngực/);
  assert.match(source, /Xem trước/);
  assert.match(source, /context\?:/);
  assert.match(source, /#1a1a1a/);
});

test("draft upload modal edits composite placement inline and uploads region with the file", () => {
  const stepSource = read("src/app/(authed)/wizard/[draftId]/step-3/page.tsx");
  const panelSource = read("src/components/mockup/WizardMockupSourcePanel.tsx");
  const modalSource = read("src/components/mockup/UploadMockupModal.tsx");

  assert.match(stepSource, /CanvasPlacementEditor/);
  assert.match(stepSource, /designImageUrl=\{activeDesignPreviewUrl\}/);
  assert.match(panelSource, /designImageUrl\?: string | null/);
  assert.match(panelSource, /designImageUrl=\{designImageUrl\}/);
  assert.match(panelSource, /form\.set\("view", "front"\)/);
  assert.match(panelSource, /form\.set\("sceneType", "flat_lay"\)/);
  assert.match(panelSource, /form\.set\("renderMode", "COMPOSITE"\)/);
  assert.match(panelSource, /form\.set\("isPrimary", "false"\)/);
  assert.match(panelSource, /form\.set\("sortOrder", "0"\)/);
  assert.match(panelSource, /form\.set\("compositeRegionPx", JSON\.stringify\(value\.compositeRegionPx\)\)/);
  assert.doesNotMatch(panelSource, /view: value\.view|sceneType: value\.sceneType|sortOrder: value\.sortOrder|isPrimary: value\.isPrimary/);
  assert.match(modalSource, /designImageUrl\?: string \| null/);
  assert.match(modalSource, /imageWidth: Math\.round\(region\.imageWidth\)/);
  assert.match(modalSource, /imageHeight: Math\.round\(region\.imageHeight\)/);
  assert.doesNotMatch(modalSource, /CompositeRegionEditor/);
});

test("gallery exposes color tabs and composite failure retry state", () => {
  const source = read("src/components/mockup/MockupGallery.tsx");

  assert.match(source, /Màu:/);
  assert.match(source, /setActiveColor/);
  assert.match(source, /Mockup riêng/);
  assert.match(source, /Từ thư viện/);
  assert.doesNotMatch(source, /Draft Custom Composite|Draft Custom Final|Template Custom Final|Template Custom Composite/);
  assert.match(source, /Tạo ảnh ghép thất bại/);
  assert.match(source, /Thử lại/);
  assert.match(source, /Xem log/);
});

test("wizard official gallery filters by template default source", () => {
  const stepSource = read("src/app/(authed)/wizard/[draftId]/step-3/page.tsx");
  const helperSource = read("src/lib/mockup/official-gallery.ts");

  assert.match(helperSource, /shouldShowInOfficialGallery/);
  assert.match(helperSource, /defaultMockupSource/);
  assert.match(helperSource, /parsed\.kind === "custom"/);
  assert.match(stepSource, /shouldShowInOfficialGallery/);
  assert.match(stepSource, /selectedTemplate\?\.defaultMockupSource \?\? "PRINTIFY"/);
  assert.match(stepSource, /isCustomTemplateDefault\s*\?\s*"Custom đang chuẩn bị mockup/);
  assert.match(stepSource, /Khi sẵn sàng, nhấn "Tạo Mockups" để render ảnh listing/);
  assert.doesNotMatch(stepSource, /isCustomSource \|\| isPrintifySource/);
});

test("custom default preview shows exact library thumbnails and missing-color actions", () => {
  const panelSource = read("src/components/mockup/WizardMockupSourcePanel.tsx");
  const sectionSource = read("src/components/mockup/MockupPreviewSection.tsx");
  const tileSource = read("src/components/mockup/PreviewTile.tsx");

  assert.match(panelSource, /customPreviewSources/);
  assert.match(panelSource, /selectedSourceIds/);
  assert.match(panelSource, /primarySourceId/);
  assert.match(panelSource, /activeSourceId/);
  assert.match(panelSource, /onRemoveColor/);
  assert.match(sectionSource, /Mockup dùng cho listing này/);
  assert.match(sectionSource, /Preview mockup đang chọn/);
  assert.match(sectionSource, /Chưa có mockup custom/);
  assert.match(sectionSource, /Thêm mockup riêng/);
  assert.match(sectionSource, /Bỏ màu/);
  assert.match(sectionSource, /Chỉnh vị trí design/);
  assert.match(sectionSource, /selectedSourceIds/);
  assert.match(sectionSource, /primarySourceId/);
  assert.match(sectionSource, /activeSourceId/);
  assert.match(tileSource, /Mockup riêng/);
  assert.match(tileSource, /Từ thư viện/);
  assert.match(tileSource, /Ảnh chính/);
  assert.match(tileSource, /selected/);
  assert.match(tileSource, /Đặt làm ảnh chính/);
  assert.match(tileSource, /onDelete && effectiveScope === "DRAFT"/);
  assert.doesNotMatch(panelSource, /Tất cả màu đã chọn đều có mockup tái sử dụng trong thư viện/);
});

test("preview tiles only show user labels and explicit placement state", () => {
  const tileSource = read("src/components/mockup/PreviewTile.tsx");

  assert.doesNotMatch(tileSource, /label\s*=\s*source\.label\s*\|\|\s*`?\$\{source\.view\}\s*·\s*\$\{source\.sceneType\}`?/);
  assert.match(tileSource, /Chưa chỉnh vị trí/);
  assert.match(tileSource, /Đã chỉnh vị trí/);
  assert.match(tileSource, /Chỉnh lại/);
});

test("global mockups page owns composite frame editing", () => {
  const pageSource = read("src/app/(authed)/mockups/page.tsx");
  const clientSource = read("src/app/(authed)/mockups/MockupsClient.tsx");
  const modalSource = read("src/components/mockup/GlobalMockupEditorModal.tsx");

  assert.doesNotMatch(pageSource, /"use client"/);
  assert.match(pageSource, /validateSession/);
  assert.match(pageSource, /hasFeature/);
  assert.match(pageSource, /MockupsClient/);
  assert.match(clientSource, /\/api\/mockups/);
  assert.match(clientSource, /params\.get\("edit"\)/);
  assert.match(modalSource, /CompositeRegionEditor/);
  assert.match(modalSource, /compositeRegionPx/);
});

test("template editor uses template mockup attachments and links global frame editor", () => {
  const configSource = read("src/app/(authed)/stores/[id]/config/page.tsx");
  const pickerSource = read("src/components/mockup/TemplateMockupPicker.tsx");

  assert.match(configSource, /TemplateMockupPicker/);
  assert.match(pickerSource, /mockup-templates\/\$\{templateId\}\/mockups/);
  assert.match(pickerSource, /fetch\("\/api\/mockups"/);
  assert.match(pickerSource, /uploadForColor/);
  assert.match(pickerSource, /\/mockups\?edit=\$\{assignment\.mockupId\}/);
  assert.doesNotMatch(configSource, /defaultCompositeRegionPx/);
  assert.doesNotMatch(configSource, /CompositeRegionEditor/);
});

test("template mockup library picker uses fixed picker state and store-scoped library", () => {
  const pickerSource = read("src/components/mockup/TemplateMockupPicker.tsx");

  assert.match(pickerSource, /pickerState,\s*setPickerState/);
  assert.match(pickerSource, /\{ colorId: string; colorName: string \} \| null/);
  assert.match(pickerSource, /position: "fixed"/);
  assert.match(pickerSource, /mockup-picker-drawer/);
  assert.match(pickerSource, /Select mockup for \{pickerState\.colorName\}/);
  assert.match(pickerSource, /api\/mockups\?storeId=\$\{encodeURIComponent\(storeId\)\}/);
  assert.match(pickerSource, /pickerState\?\.colorId === color\.id/);
  assert.doesNotMatch(pickerSource, /setPickerOpen/);
  assert.doesNotMatch(pickerSource, /setPickerColorId/);
});

test("template mockup color assignment patches existing attachments and never clears to all-colors fallback", () => {
  const pickerSource = read("src/components/mockup/TemplateMockupPicker.tsx");
  const helperSource = read("src/components/mockup/template-mockup-assignment.ts");

  assert.match(pickerSource, /assignMockupToColor/);
  assert.match(pickerSource, /method: "PATCH"/);
  assert.match(pickerSource, /method: "DELETE"/);
  assert.match(pickerSource, /method: "POST"/);
  assert.match(helperSource, /nextColorIds\.length === 0/);
  assert.match(helperSource, /type: "delete"/);
  assert.doesNotMatch(pickerSource, /appliesToColorIds: \[\]/);
});

test("new custom templates group pending mockup assignments by mockup id before creating attachments", () => {
  const configSource = read("src/app/(authed)/stores/[id]/config/page.tsx");

  assert.match(configSource, /pendingAssignmentsByMockupId/);
  assert.match(configSource, /for \(const \[mockupId, colorIds\] of pendingAssignmentsByMockupId\)/);
  assert.match(configSource, /body: JSON\.stringify\(\{ mockupId, appliesToColorIds: colorIds/);
  assert.doesNotMatch(configSource, /for \(const \[colorId, assignment\] of pendingAssignments\)[\s\S]*appliesToColorIds: \[colorId\]/);
});

test("wizard edit action opens a dedicated placement editor instead of the upload modal", () => {
  const panelSource = read("src/components/mockup/WizardMockupSourcePanel.tsx");

  assert.match(panelSource, /CanvasPlacementEditor/);
  assert.match(panelSource, /placementEditorSource/);
  assert.match(panelSource, /setPlacementEditorSource/);
  assert.doesNotMatch(panelSource, /openDraftUpload\(source\.colorId\)/);
});

test("mockup results do not fall back to sourceUrl in the result viewer", () => {
  const stepSource = read("src/app/(authed)/wizard/[draftId]/step-5/page.tsx");
  const gallerySource = read("src/components/mockup/MockupGallery.tsx");

  assert.doesNotMatch(stepSource, /compositeUrl \?\? currentMockup\.sourceUrl/);
  assert.doesNotMatch(stepSource, /compositeUrl \?\? mockup\.sourceUrl/);
  assert.doesNotMatch(stepSource, /compositeUrl \?\? allMockups\[0\]\.sourceUrl/);
  assert.doesNotMatch(gallerySource, /normalizeImageUrl\(img\.sourceUrl\)/);
  assert.doesNotMatch(gallerySource, /compositeUrl \?\? img\.sourceUrl/);
});

test("mockup generation blocks composite sources without placement", () => {
  const generationSource = read("src/lib/mockup/generation.ts");

  assert.match(generationSource, /CUSTOM_MOCKUP_MISSING_REGION/);
  assert.match(generationSource, /Chỉnh vị trí design/);
  assert.match(generationSource, /p\.templateMockupItem\.mockup\.renderMode === "COMPOSITE"/);
});

test("custom template live preview and result section use template-specific copy", () => {
  const stepSource = read("src/app/(authed)/wizard/[draftId]/step-3/page.tsx");
  const gallerySource = read("src/components/mockup/MockupGallery.tsx");

  assert.match(stepSource, /showFullLivePreview = !isCustomTemplateDefault/);
  assert.match(stepSource, /hasTriggeredBatchRender/);
  assert.match(stepSource, /Vị trí design trên template/);
  assert.match(stepSource, /Mockup tham khảo từ Printify\. Bạn có thể chỉnh vị trí design trước khi tạo mockup\./);
  assert.match(stepSource, /Vị trí design trên template — dùng để kiểm tra vị trí in\. Ảnh listing cuối sẽ dùng mockup custom bên dưới\./);
  assert.match(stepSource, /Preview lớn và nút <strong>Chỉnh vị trí<\/strong> nằm ở khối mockup bên dưới, bám theo mockup đang chọn\./);
  assert.match(stepSource, /Kết quả mockup/);
  assert.match(stepSource, /Khi sẵn sàng, nhấn "Tạo Mockups" để render ảnh listing/);
  assert.match(stepSource, /allMockupImages\.length > 0/);
  assert.doesNotMatch(stepSource, /Mockup tham khảo — chất lượng cuối cùng từ Printify/);
  assert.doesNotMatch(stepSource, /Mockup chính thức/);
  assert.doesNotMatch(stepSource, /!mockupJobId && !isGenerating/);

  assert.match(gallerySource, /Chưa có kết quả mockup\. Khi sẵn sàng, nhấn "Tạo Mockups" để render ảnh listing/);
  assert.match(gallerySource, /Ảnh listing không còn truy cập được/);
  assert.match(gallerySource, /Cần tạo lại/);
  assert.match(gallerySource, /Đang render mockups/);
  assert.doesNotMatch(gallerySource, /Printify đang render mockups/);
  assert.doesNotMatch(gallerySource, /Hãy tạo lại mockup từ Printify/);
});

test("step-3 uses ColorMockupCardGrid for custom templates", () => {
  const stepSource = read("src/app/(authed)/wizard/[draftId]/step-3/page.tsx");

  // step-3 imports and renders ColorMockupCardGrid
  assert.match(stepSource, /import \{ ColorMockupCardGrid \} from/);
  assert.match(stepSource, /<ColorMockupCardGrid/);
  // grid receives the expected props
  assert.match(stepSource, /selectedColors=\{storeColors\.filter/);
  assert.match(stepSource, /designImageUrl=\{activeDesignPreviewUrl\}/);
  assert.match(stepSource, /onGenerate=\{handleGenerate\}/);
  assert.match(stepSource, /isGenerating=\{isGenerating\}/);
  assert.match(stepSource, /generateButtonLabel=\{generateButtonLabel\}/);
  // "Vị trí in" sidebar card hidden for custom templates
  assert.match(stepSource, /!isCustomTemplateDefault &&[\s\S]*?Vị trí in/);
});

test("ColorMockupCardGrid contains readiness header, per-card upload, and placement editor", () => {
  const gridSource = read("src/components/mockup/ColorMockupCardGrid.tsx");
  const cardSource = read("src/components/mockup/ColorMockupCard.tsx");

  // Grid exports pure functions for tests
  assert.match(gridSource, /export function findSourceForColor/);
  assert.match(gridSource, /export function computeReadiness/);
  // Grid readiness header
  assert.match(gridSource, /màu sẵn sàng/);
  // Grid uses UploadMockupModal for per-color upload
  assert.match(gridSource, /UploadMockupModal/);
  assert.match(gridSource, /setUploadColorId/);
  // Card exports pure logic
  assert.match(cardSource, /export function getCardState/);
  assert.match(cardSource, /NO_SOURCE/);
  assert.match(cardSource, /NO_PLACEMENT/);
  assert.match(cardSource, /READY/);
  assert.match(cardSource, /GENERATED/);
  // Card has placement editor
  assert.match(cardSource, /CanvasPlacementEditor/);
  assert.match(cardSource, /savePlacement/);
});

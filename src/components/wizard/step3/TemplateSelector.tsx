"use client";

import type { StoreMockupTemplate } from "@prisma/client";

type TemplateSummary = {
  id: string;
  name: string;
  blueprintTitle: string | null;
  defaultMockupSource: string | null;
  colors: { id: string }[];
  enabledSizes: string[];
  readiness: { ready: boolean; label: string; missing?: string[] };
};

type Props = {
  templates: TemplateSummary[];
  selectedTemplate: TemplateSummary | null;
  onSelect: (templateId: string) => void;
  warning?: string;
};

const PRESET_MISSING_LABELS: Record<string, string> = {
  blueprintId: "Blueprint ID",
  printProviderId: "Print Provider ID",
  enabledVariantIds: "Variants",
  defaultPlacement: "Placement",
};

export function TemplateSelector({ templates, selectedTemplate, onSelect, warning }: Props) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex items-center justify-between gap-3" style={{ marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Mockup template</h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
            Chọn template cho wizard này
          </p>
        </div>
        {selectedTemplate && (
          <span
            className={`badge ${selectedTemplate.readiness.ready ? "badge-success" : "badge-warning"}`}
            style={{ flexShrink: 0, fontSize: "0.65rem" }}
          >
            {selectedTemplate.readiness.label}
          </span>
        )}
      </div>

      {templates.length > 1 ? (
        <div style={{ display: "grid", gap: 8 }}>
          {templates.map((candidate) => {
            const active = selectedTemplate?.id === candidate.id;
            const disabled = !candidate.readiness.ready;
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onSelect(candidate.id)}
                disabled={disabled}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: active ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                  backgroundColor: active ? "rgba(146, 198, 72, 0.06)" : "transparent",
                  opacity: disabled ? 0.5 : 1,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span style={{ fontWeight: 800, fontSize: "0.82rem", overflowWrap: "anywhere" }}>
                    {candidate.name}
                  </span>
                  <span style={{ fontSize: "0.65rem", fontWeight: 800, opacity: 0.65, flexShrink: 0 }}>
                    {candidate.readiness.label}
                  </span>
                </div>
                <p style={{ margin: "4px 0 0", fontSize: "0.72rem", opacity: 0.6, lineHeight: 1.3 }}>
                  {candidate.blueprintTitle || "Chưa có blueprint"} · {candidate.colors.length} màu · {candidate.enabledSizes.length} sizes
                </p>
              </button>
            );
          })}
        </div>
      ) : selectedTemplate ? (
        <div style={{ fontSize: "0.8rem", lineHeight: 1.4 }}>
          <strong>{selectedTemplate.name}</strong>
          <p style={{ margin: "4px 0 0", opacity: 0.6 }}>
            {selectedTemplate.blueprintTitle || "Chưa có blueprint"} · {selectedTemplate.colors.length} màu · {selectedTemplate.enabledSizes.length} sizes
          </p>
        </div>
      ) : (
        <p style={{ margin: 0, opacity: 0.6, fontSize: "0.8rem" }}>Store chưa có template.</p>
      )}

      {warning && (
        <p style={{ margin: "10px 0 0", color: "var(--color-warning)", fontSize: "0.75rem", lineHeight: 1.35 }}>
          {warning}
        </p>
      )}
    </div>
  );
}

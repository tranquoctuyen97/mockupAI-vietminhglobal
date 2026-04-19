"use client";

import { useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import {
  Image as ImageIcon,
  ShoppingBag,
  Move,
  Sparkles,
  PenTool,
  ClipboardCheck,
  Rocket,
  Check,
  Loader2,
  ArrowLeft,
  Save,
} from "lucide-react";
import Link from "next/link";

const STEPS = [
  { num: 1, label: "Design", icon: ImageIcon, path: "step-1" },
  { num: 2, label: "Product", icon: ShoppingBag, path: "step-2" },
  { num: 3, label: "Placement", icon: Move, path: "step-3" },
  { num: 4, label: "Mockups", icon: Sparkles, path: "step-4" },
  { num: 5, label: "Content", icon: PenTool, path: "step-5" },
  { num: 6, label: "Review", icon: ClipboardCheck, path: "step-6" },
  { num: 7, label: "Publish", icon: Rocket, path: "step-7" },
];

export default function WizardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { draftId } = useParams<{ draftId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { draft, loading, saving, loadDraft } = useWizardStore();

  useEffect(() => {
    if (draftId) loadDraft(draftId);
  }, [draftId, loadDraft]);

  // Determine current step from URL
  const currentStepMatch = pathname.match(/step-(\d)/);
  const currentStep = currentStepMatch ? parseInt(currentStepMatch[1], 10) : 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 64 }}>
        <Loader2 size={24} className="animate-spin" style={{ opacity: 0.5 }} />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <div className="flex items-center gap-3">
          <Link
            href="/wizard"
            style={{ color: "inherit", opacity: 0.5, display: "flex" }}
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="page-title" style={{ margin: 0 }}>
              Wizard
            </h1>
            <p className="page-subtitle" style={{ margin: 0 }}>
              Draft #{draftId?.slice(-6)}
            </p>
          </div>
        </div>

        {saving && (
          <div className="flex items-center gap-2" style={{ fontSize: "0.8rem", opacity: 0.5 }}>
            <Save size={14} />
            Đang lưu...
          </div>
        )}
      </div>

      {/* Stepper */}
      <div
        style={{
          display: "flex",
          gap: 0,
          marginBottom: 32,
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          border: "1px solid var(--border-default)",
        }}
      >
        {STEPS.map((step) => {
          const isActive = currentStep === step.num;
          const isCompleted = draft ? draft.currentStep > step.num : false;
          const isAccessible = draft ? step.num <= draft.currentStep + 1 : step.num === 1;
          const Icon = step.icon;

          return (
            <button
              key={step.num}
              onClick={() => {
                if (isAccessible) {
                  router.push(`/wizard/${draftId}/${step.path}`);
                }
              }}
              disabled={!isAccessible}
              style={{
                flex: 1,
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                border: "none",
                cursor: isAccessible ? "pointer" : "default",
                fontSize: "0.7rem",
                fontWeight: isActive ? 700 : 500,
                color: isActive
                  ? "var(--color-wise-green-dark)"
                  : isCompleted
                    ? "var(--text-primary)"
                    : "var(--text-tertiary)",
                backgroundColor: isActive
                  ? "rgba(146, 198, 72, 0.12)"
                  : "transparent",
                borderRight: step.num < STEPS.length ? "1px solid var(--border-default)" : "none",
                transition: "all 0.15s",
                opacity: isAccessible ? 1 : 0.4,
              }}
            >
              {isCompleted ? (
                <Check size={16} style={{ color: "var(--color-wise-green)" }} />
              ) : (
                <Icon size={16} />
              )}
              <span style={{ display: "none" }} className="stepper-label">
                {step.label}
              </span>
              {step.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {children}

      {/* Navigation */}
      <div
        className="flex items-center justify-between"
        style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--border-default)" }}
      >
        <button
          className="btn btn-secondary"
          onClick={() => {
            if (currentStep > 1) {
              router.push(`/wizard/${draftId}/step-${currentStep - 1}`);
            } else {
              router.push("/wizard");
            }
          }}
        >
          ← {currentStep > 1 ? "Quay lại" : "Danh sách"}
        </button>

        {currentStep < STEPS.length && (
          <button
            className="btn btn-primary"
            onClick={() => {
              if (draft) {
                // Update currentStep
                useWizardStore.getState().updateDraft({
                  currentStep: Math.max(draft.currentStep, currentStep + 1),
                });
              }
              router.push(`/wizard/${draftId}/step-${currentStep + 1}`);
            }}
          >
            Tiếp theo →
          </button>
        )}
      </div>
    </div>
  );
}

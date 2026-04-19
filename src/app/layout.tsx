import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "MockupAI — POD Automation Platform",
  description:
    "Nền tảng tự động hóa Print-on-Demand: Design → Mockup → Shopify → Printify",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>
        {children}
        <Toaster
          position="top-right"
          richColors
          closeButton
          duration={4000}
          toastOptions={{
            style: {
              borderRadius: "var(--radius-md)",
              fontFamily: "var(--font-body)",
              fontWeight: 500,
            },
          }}
        />
      </body>
    </html>
  );
}

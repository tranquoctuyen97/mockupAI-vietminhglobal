import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700", "900"],
});

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
    <html lang="vi" className={inter.variable} suppressHydrationWarning>
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

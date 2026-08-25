import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fitness Coach",
  description: "Private Apple Health, food, and coach dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}

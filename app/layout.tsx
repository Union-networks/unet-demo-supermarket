import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo Supermarket",
  description: "A standalone U-net demo service with scoped login and checkout-bound verification.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fundus",
  description: "Dokumente hochladen, Fragen stellen, Antworten mit Beleg.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

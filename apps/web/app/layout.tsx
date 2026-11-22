import { Archivo } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// One family; its width axis does the work (condensed prices and headlines, normal body text).
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata = {
  title: "Dónde Ahorro",
  description: "Dónde está más barato cada producto en los supermercados de CABA.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}

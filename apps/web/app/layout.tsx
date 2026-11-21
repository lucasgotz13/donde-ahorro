import { Archivo } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { THEME_COLOR } from "../lib/pwa.ts";
import { selectedBranchIds, selectedCart } from "../lib/selection.ts";
import { RegisterServiceWorker } from "./_components/register-service-worker.tsx";
import "./globals.css";

// One family; its width axis does the work (condensed prices and headlines, normal body text).
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata = {
  title: "Dónde Ahorro",
  description: "Dónde está más barato cada producto en los supermercados de CABA.",
  // S4: iOS reads these instead of the manifest when adding to the home screen.
  appleWebApp: { capable: true, title: "Dónde Ahorro", statusBarStyle: "default" as const },
};

export const viewport = { themeColor: THEME_COLOR };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [n, cart] = await Promise.all([selectedBranchIds().then((ids) => ids.length), selectedCart()]);
  const items = cart.reduce((sum, i) => sum + i.quantity, 0);
  return (
    <html lang="es-AR" className={archivo.variable}>
      <body>
        <header className="site-header">
          <Link href="/" className="wordmark">
            Dónde Ahorro
          </Link>
          <nav className="header-links" aria-label="Tus datos">
            <Link href="/sucursales" className="header-link">
              {n === 0 ? "Sucursales" : `Sucursales (${n})`}
            </Link>
            <Link href="/medios" className="header-link">
              Medios de pago
            </Link>
            <Link href="/carrito" className="header-link">
              {items ? `Carrito (${items})` : "Carrito"}
            </Link>
          </nav>
        </header>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}

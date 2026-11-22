import type { ReactNode } from "react";

export const metadata = {
  title: "Dónde Ahorro",
  description: "Compare CABA supermarket prices and promotions.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}

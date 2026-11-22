"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** S3: the browser's location, turned into a nearest-branches search. */
export function LocateButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "locating" | "denied" | "unavailable">("idle");

  const locate = () => {
    if (!("geolocation" in navigator)) return setState("unavailable");
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setState("idle");
        router.push(`/sucursales?lat=${coords.latitude.toFixed(5)}&lng=${coords.longitude.toFixed(5)}`);
      },
      (error) => setState(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  };

  return (
    <p className="locate">
      <button type="button" className="link-button" onClick={locate} disabled={state === "locating"}>
        {state === "locating" ? "Buscando tu ubicación..." : "Usar mi ubicación"}
      </button>
      {state === "denied" && <span role="status"> El navegador no dio permiso para usar tu ubicación. Escribí una dirección.</span>}
      {state === "unavailable" && <span role="status"> No pudimos obtener tu ubicación. Escribí una dirección.</span>}
    </p>
  );
}

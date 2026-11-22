"use client";

import { useEffect } from "react";

/** S4: registers /sw.js in production; in development it would serve stale pages over hot reload. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => console.error("[sw] registration failed", error));
    }
  }, []);
  return null;
}

import { describe, expect, it } from "vitest";
import { ICON_SIZES, manifest } from "./pwa.ts";

// S4: an installable PWA.
describe("manifest", () => {
  it("has what browsers need to install the app", () => {
    expect(manifest).toMatchObject({
      name: "Dónde Ahorro",
      short_name: "Dónde Ahorro",
      start_url: "/",
      scope: "/",
      display: "standalone",
      lang: "es-AR",
    });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("lists a PNG icon of 192 and 512 px, each usable as maskable", () => {
    expect(ICON_SIZES).toEqual([192, 512]);
    expect(manifest.icons).toEqual([
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });
});

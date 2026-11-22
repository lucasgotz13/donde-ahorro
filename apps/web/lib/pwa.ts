import type { MetadataRoute } from "next";

/** The aisle-grey wall from globals.css; the yellow sale tag is the icon. */
export const THEME_COLOR = "#e9edf0";
export const TAG_COLOR = "#ffd400";
export const INK_COLOR = "#18212b";

export const ICON_SIZES = [192, 512] as const;

/** S4: what a browser needs to install Dónde Ahorro to the home screen. */
export const manifest: MetadataRoute.Manifest = {
  name: "Dónde Ahorro",
  short_name: "Dónde Ahorro",
  description: "Dónde está más barato cada producto en los supermercados de CABA.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  lang: "es-AR",
  theme_color: THEME_COLOR,
  background_color: THEME_COLOR,
  // The icon is a full-bleed tag with the glyph inside the safe zone, so it also works as maskable.
  icons: ICON_SIZES.flatMap((size) =>
    (["any", "maskable"] as const).map((purpose) => ({ src: `/pwa-icon/${size}`, sizes: `${size}x${size}`, type: "image/png", purpose })),
  ),
};

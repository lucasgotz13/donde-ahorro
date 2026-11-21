import { ImageResponse } from "next/og";
import { INK_COLOR, TAG_COLOR } from "../../lib/pwa.ts";

/** The app icon: the yellow sale tag with a "$", full bleed so it also works as a maskable icon. */
export function tagIcon(size: number) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: TAG_COLOR,
          color: INK_COLOR,
          fontSize: size * 0.58,
          fontWeight: 800,
        }}
      >
        $
      </div>
    ),
    { width: size, height: size },
  );
}

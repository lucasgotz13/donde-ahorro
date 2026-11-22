import { ICON_SIZES } from "../../../lib/pwa.ts";
import { tagIcon } from "../../_components/tag-icon.tsx";

export const dynamicParams = false;

export const generateStaticParams = () => ICON_SIZES.map((size) => ({ size: String(size) }));

/** S4: the manifest's PNG icons, rendered once at build time. */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  return tagIcon(Number((await params).size));
}

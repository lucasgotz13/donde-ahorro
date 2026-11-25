/** A product's photo, decorative next to its name; without one, an empty box keeps the rows aligned. */
export function ProductImage({ url, size = "sm" }: { url: string | null; size?: "sm" | "lg" }) {
  return (
    <span className={`product-image product-image-${size}`}>
      {url && <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
    </span>
  );
}

/** The attribution the photos' license (CC BY-SA) and the database's (ODbL) ask for. */
export function ImageCredit() {
  return (
    <p className="image-credit">
      Fotos de <a href="https://openfoodfacts.org">Open Food Facts</a> (
      <a href="https://creativecommons.org/licenses/by-sa/3.0/deed.es">CC BY-SA 3.0</a>), datos bajo{" "}
      <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>.
    </p>
  );
}

import { expect, test, type Page } from "@playwright/test";

// Fixture prices (e2e/seed.ts). Yerba: Coto $5.000 (Caballito) / $5.200 (Palermo), Día $4.800, Jumbo $5.500.
// Milk: Coto $1.500, Día $1.600, Jumbo $1.400. Coto: 25% refund with Galicia credit; Día: 50% off tomorrow only.
// Oreo: Coto $980, Día $1.000 with "2DO AL 50%" ($750 each for 2), Jumbo $950 with a $850 product promo today only.

const chains = (page: Page) => page.locator(".chains > li");

async function openYerba(page: Page) {
  await page.goto("/?q=yerba");
  await page.getByRole("link", { name: /Yerba mate playadito/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Yerba mate playadito paq 1 kgm");
}

// S2 (a), S9, S11.
test("search finds a product and the cheapest chain wears the tag", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox").fill("playadito");
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByRole("link", { name: /Yerba mate playadito/ }).click();

  await expect(chains(page)).toHaveCount(3);
  await expect(chains(page).first()).toHaveClass(/chain-cheapest/);
  await expect(chains(page).first()).toContainText("Día");
  await expect(chains(page).first().getByRole("img", { name: "$4.800,00" }).first()).toBeVisible();
  await expect(chains(page).first()).toContainText("actualizado ayer");
  await expect(chains(page).filter({ hasText: "Jumbo" })).toContainText("Promos no informadas");
});

test("a product id too long for a bigint is not found, not a server error", async ({ page }) => {
  expect((await page.goto("/producto/99999999999999999999"))?.status()).toBe(404);
});

// S19: today by default, the next 7 days; a promotion applies only on its weekday.
test("a weekday promotion applies only on its day", async ({ page }) => {
  await openYerba(page);
  await expect(chains(page).first()).not.toContainText("sin promo");

  await page.getByRole("link", { name: "Mañana" }).click();
  await expect(page.getByRole("link", { name: "Mañana" })).toHaveAttribute("aria-current", "date");
  const dia = chains(page).first();
  await expect(dia).toContainText("Día");
  await expect(dia.getByRole("img", { name: "$2.400,00" }).first()).toBeVisible();
  await expect(dia).toContainText("sin promo $4.800,00");
  await expect(dia).toContainText("50% de descuento con cualquier medio de pago.");
});

// S13–S15, S18, S20.
test("the user's payment methods bring in their promotions", async ({ page }) => {
  await page.goto("/medios");
  await page.getByRole("group", { name: "Banco Galicia" }).getByLabel("Tarjeta de crédito").check();
  await page.getByRole("button", { name: "Guardar medios de pago" }).click();
  await expect(page.getByRole("status")).toHaveText("Guardamos tus medios de pago.");
  await expect(page.getByRole("group", { name: "Banco Galicia" }).getByLabel("Tarjeta de crédito")).toBeChecked();

  await openYerba(page);
  const coto = chains(page).first();
  await expect(coto).toContainText("Coto");
  await expect(coto.getByRole("img", { name: "$3.750,00" }).first()).toBeVisible();
  await expect(coto).toContainText("Pagás $5.000,00, te reintegran $1.250,00.");
  await expect(coto).toContainText("25% de reintegro con Banco Galicia, tarjeta de crédito. Tope $10.000 por compra.");
});

// "un boton que seleccione todos los medios de pago, y luego el usuario dé click en guardar".
test("a button checks every payment method and saving keeps them", async ({ page }) => {
  await page.goto("/medios");
  const galicia = page.getByRole("group", { name: "Banco Galicia" });
  await page.getByRole("button", { name: "Seleccionar todos los medios de pago" }).click();
  await expect(galicia.getByLabel("Tarjeta de crédito")).toBeChecked();
  await expect(galicia.getByLabel("Tarjeta de débito")).toBeChecked();
  await expect(page.getByLabel("Comunidad Coto")).not.toBeChecked();
  await expect(page.getByRole("status")).toHaveCount(0);

  await page.getByRole("button", { name: "Guardar medios de pago" }).click();
  await expect(page.getByRole("status")).toHaveText("Guardamos tus medios de pago.");
  await expect(galicia.getByLabel("Tarjeta de crédito")).toBeChecked();
  await expect(galicia.getByLabel("Tarjeta de débito")).toBeChecked();
});

// S3, S20.
test("choosing a branch limits prices to it", async ({ page }) => {
  await page.goto("/sucursales");
  await page.getByRole("searchbox").fill("coto palermo");
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByRole("checkbox", { name: /Coto Palermo/ }).check();
  await page.getByRole("button", { name: "Guardar sucursales" }).click();
  await expect(page.getByRole("status")).toHaveText("Guardamos tu sucursal.");
  await expect(page.getByRole("link", { name: "Sucursales (1)" })).toBeVisible();

  await openYerba(page);
  await expect(page.getByText("En tu sucursal.")).toBeVisible();
  await expect(chains(page)).toHaveCount(1);
  await expect(chains(page).first().getByRole("img", { name: "$5.200,00" }).first()).toBeVisible();

  await page.getByRole("link", { name: "Ver todas las de CABA" }).click();
  await expect(chains(page)).toHaveCount(3);
});

// S16, S17.
test("the cart totals each chain and finds the best split", async ({ page }) => {
  await openYerba(page);
  await page.getByLabel("Cantidad").selectOption("2");
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status")).toContainText("Agregado.");

  await page.goto("/?q=leche");
  await page.getByRole("link", { name: /Leche entera/ }).click();
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("link", { name: "Carrito (3)" })).toBeVisible();

  await page.goto("/carrito");
  const single = page.getByRole("region", { name: "Todo en una cadena" }).locator(".chains > li");
  await expect(single.first()).toContainText("Día");
  await expect(single.first().getByRole("img", { name: "$11.200,00" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repartiendo entre cadenas: $11.000,00" })).toBeVisible();
  await expect(page.getByText("Ahorrás $200,00 frente a comprar todo en Día, en 2 compras separadas.")).toBeVisible();

  await page.getByLabel(/Cantidad de Yerba mate/).fill("0");
  await page.getByRole("button", { name: "Actualizar cantidades" }).click();
  await expect(page.getByRole("link", { name: "Carrito (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Repartiendo/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Vaciar carrito" }).click();
  await expect(page.getByRole("heading", { name: "Tu carrito está vacío" })).toBeVisible();
});

// S25, S19: product promotions from SEPA; a multi-buy only for complete groups.
test("product promotions apply on their days and multi-buys only by the group", async ({ page }) => {
  await page.goto("/?q=oreo");
  await page.getByRole("link", { name: /Galletitas oreo/ }).click();
  const jumbo = chains(page).first();
  await expect(jumbo).toContainText("Jumbo");
  await expect(jumbo.getByRole("img", { name: "$850,00" }).first()).toBeVisible();
  await expect(jumbo).toContainText("sin promo $950,00");
  const dia = chains(page).filter({ hasText: "Día" });
  await expect(dia.getByRole("img", { name: "$1.000,00" }).first()).toBeVisible();
  await expect(dia).toContainText("Llevando 2: $750,00 c/u");

  await page.getByRole("link", { name: "Mañana" }).click();
  await expect(page.getByRole("link", { name: "Mañana" })).toHaveAttribute("aria-current", "date");
  await expect(chains(page).filter({ hasText: "Jumbo" })).not.toContainText("sin promo");

  await page.getByRole("link", { name: "Hoy" }).click();
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status")).toContainText("Agregado.");
  await page.goto("/carrito");
  const single = page.getByRole("region", { name: "Todo en una cadena" }).locator(".chains > li");
  await expect(single.first()).toContainText("Jumbo");
  await expect(single.first().getByRole("img", { name: "$850,00" })).toBeVisible();

  await page.getByLabel(/Cantidad de Galletitas oreo/).fill("2");
  await page.getByRole("button", { name: "Actualizar cantidades" }).click();
  await expect(single.first()).toContainText("Día");
  await expect(single.first().getByRole("img", { name: "$1.500,00" })).toBeVisible();
  await expect(single.first()).toContainText("sin promo $2.000,00");
});

// S11, S23.
test("the status page reports each chain's promotions", async ({ page }) => {
  await page.goto("/estado");
  await expect(page.getByRole("heading", { name: "Promos de Coto" })).toBeVisible();
  const rows = page.locator(".status-chain");
  await expect(rows.filter({ hasText: /^Coto/ })).toContainText("Promos al día");
  await expect(rows.filter({ hasText: /^Día/ })).toContainText("Promos no informadas: todavía no las leemos");
});

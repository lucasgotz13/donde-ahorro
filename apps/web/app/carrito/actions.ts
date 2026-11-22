"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { addToCart, CART_COOKIE, cartIsFull, isProductId, parseCart, serializeCart, setQuantities, type CartItem } from "../../lib/cart.ts";

async function store(cart: CartItem[]) {
  const jar = await cookies();
  if (cart.length) jar.set(CART_COOKIE, serializeCart(cart), { maxAge: 365 * 24 * 3600, sameSite: "lax", path: "/", httpOnly: true });
  else jar.delete(CART_COOKIE);
}

const current = async () => parseCart((await cookies()).get(CART_COOKIE)?.value);

/** "Agregar al carrito" on a product page. */
export async function addProductToCart(formData: FormData) {
  const productId = String(formData.get("productId") ?? "");
  const quantity = Number(formData.get("quantity"));
  if (!isProductId(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) redirect("/carrito");
  const cart = await current();
  if (cartIsFull(cart, productId)) redirect(`/producto/${productId}?agregado=lleno`);
  await store(addToCart(cart, productId, quantity));
  redirect(`/producto/${productId}?agregado=1`);
}

/** The cart page's quantities (`cantidad-<productId>`); 0 removes a product. */
export async function updateCart(formData: FormData) {
  const quantities: Record<string, number> = {};
  for (const [key, value] of formData) {
    const m = /^cantidad-(\d+)$/.exec(key);
    if (m && isProductId(m[1]!)) quantities[m[1]!] = Number(value);
  }
  await store(setQuantities(await current(), quantities));
  redirect("/carrito");
}

export async function emptyCart() {
  await store([]);
  redirect("/carrito");
}

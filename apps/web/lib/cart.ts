/** S17, S20: the cart lives in a cookie on the user's device. */
export const CART_COOKIE = "carrito";

export interface CartItem {
  productId: string;
  quantity: number;
}

const MAX_ITEMS = 50;
const MAX_QUANTITY = 99;
const validQuantity = (q: number) => Number.isInteger(q) && q >= 1 && q <= MAX_QUANTITY;

/** The cookie is user input: keep `productId:quantity` pairs with a whole quantity of 1–99, first of each product. */
export function parseCart(value: string | undefined): CartItem[] {
  const items = new Map<string, number>();
  for (const pair of (value ?? "").split(",")) {
    const m = /^(\d{1,18}):(\d{1,2})$/.exec(pair.trim());
    if (m && validQuantity(Number(m[2])) && !items.has(m[1]!)) items.set(m[1]!, Number(m[2]));
  }
  return [...items].slice(0, MAX_ITEMS).map(([productId, quantity]) => ({ productId, quantity }));
}

export const serializeCart = (cart: CartItem[]): string => cart.map((i) => `${i.productId}:${i.quantity}`).join(",");

export function addToCart(cart: CartItem[], productId: string, quantity: number): CartItem[] {
  if (!cart.some((i) => i.productId === productId)) return [...cart, { productId, quantity }].slice(0, MAX_ITEMS);
  return cart.map((i) => (i.productId === productId ? { productId, quantity: Math.min(i.quantity + quantity, MAX_QUANTITY) } : i));
}

/** The cart form's quantities; a product set to 0, or missing, leaves the cart. */
export function setQuantities(cart: CartItem[], quantities: Record<string, number>): CartItem[] {
  return cart.flatMap((i) => {
    const quantity = quantities[i.productId];
    return quantity !== undefined && validQuantity(quantity) ? [{ productId: i.productId, quantity }] : [];
  });
}

/** ISO calendar date, `YYYY-MM-DD`, in Argentina's local time. */
export type IsoDate = string;

/** Amounts are integer cents of ARS. */
export type Cents = number;

export type Channel = "online" | "in-store";

export type CapPeriod = "transaction" | "day" | "week" | "month";

/** `null`: no cap. `"unknown"`: the legal text has a cap that could not be parsed. */
export type Cap = { amount: Cents; period: CapPeriod } | "unknown" | null;

/** A payment method the user owns, by canonical catalog ids. */
export interface PaymentMethod {
  entity: string;
  medium: string;
}

export interface Promotion {
  id: string;
  chainId: string;
  /** `discount` is taken at checkout; `refund` is paid back later. */
  kind: "discount" | "refund";
  percent: number;
  /** Canonical entity id (bank, wallet); `null` when any entity qualifies. */
  entity: string | null;
  /** Canonical payment medium id (credit, debit, ...); `null` when any medium qualifies. */
  paymentMedium: string | null;
  /** Days of the week, 0 = Sunday; empty means every day. */
  weekdays: number[];
  cap: Cap;
  channel: Channel | "both";
  validFrom: IsoDate;
  validTo: IsoDate;
  /** Shown as is; exclusions are not computed. */
  legalText: string;
  /** Explicit stacking; when absent, refunds stack and discounts do not. */
  stackable?: boolean;
  /** Eligibility conditions the user must meet, all of them (e.g. `comunidad-coto`, `visa-nfc`); absent means none. */
  conditions?: string[];
}

export const isStackable = (promotion: Promotion): boolean =>
  promotion.stackable ?? promotion.kind === "refund";

export const isActiveOn = (promotion: Promotion, day: IsoDate): boolean =>
  promotion.validFrom <= day &&
  day <= promotion.validTo &&
  (promotion.weekdays.length === 0 || promotion.weekdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay()));

export const requiresPaymentMethod = (promotion: Promotion): boolean =>
  promotion.entity !== null || promotion.paymentMedium !== null;

export const acceptsPaymentMethod = (promotion: Promotion, method: PaymentMethod): boolean =>
  (promotion.entity === null || promotion.entity === method.entity) &&
  (promotion.paymentMedium === null || promotion.paymentMedium === method.medium);

export const meetsConditions = (promotion: Promotion, owned: readonly string[] = []): boolean =>
  (promotion.conditions ?? []).every((c) => owned.includes(c));

/**
 * Medusa **v2** monetary fields (Pricing `Price.amount`, order line `unit_price` / totals, etc.) are stored in
 * **major** currency units (e.g. `20` for $20.00, `20.5` for $20.50). This differs from Medusa v1, which used
 * smallest units (e.g. cents).
 *
 * @see https://docs.medusajs.com/resources/commerce-modules/pricing/concepts — Price data model (`amount`).
 */

/**
 * Parse a Medusa v2 monetary value from `number`, string, or serialized `BigNumber`-like objects.
 */
export function readMedusaMajorAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.numeric === "number" && Number.isFinite(o.numeric)) {
      return o.numeric;
    }
    if (typeof o.value === "number" && Number.isFinite(o.value)) {
      return o.value;
    }
    if (typeof o.value === "string") {
      const n = Number(o.value.trim());
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/** FedEx customs needs a strictly positive major amount; clamp invalid input. */
export function clampPositiveMajor(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0.01;
  }
  return Math.max(0.01, Math.round(value * 1e6) / 1e6);
}

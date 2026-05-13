import type {
  FulfillmentItemDTO,
  FulfillmentOrderDTO,
  ProductVariantDTO,
} from "@medusajs/framework/types";
import type { FedexCustomsLineInput, FedexRateRequestItem } from "../fedex-api/types";
import { clampPositiveMajor, readMedusaMajorAmount } from "./medusa-money";
import { normalizeFedexCountryCode } from "./fedex-address-region";

function resolveOrderCurrency(order: Partial<FulfillmentOrderDTO> | undefined): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (order as any)?.currency_code;
  return typeof c === "string" && c.length >= 3 ? c.toUpperCase().slice(0, 3) : "USD";
}

/**
 * Resolves one line's **unit price in major currency units** for FedEx customs (cart or fulfillment snapshot).
 */
export function resolveLineItemUnitPriceMajor(
  item: Partial<FulfillmentItemDTO>,
  order: Partial<FulfillmentOrderDTO> | undefined
): number {
  const rec = item as Record<string, unknown>;
  const qty = Math.max(1, Number(rec.quantity) || 1);

  const totalMajor = readMedusaMajorAmount(rec.total);
  if (totalMajor !== null && totalMajor > 0) {
    return clampPositiveMajor(totalMajor / qty);
  }

  const unitMajor = readMedusaMajorAmount(rec.unit_price);
  if (unitMajor !== null && unitMajor > 0) {
    return clampPositiveMajor(unitMajor);
  }

  const lineItemId = rec.line_item_id as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines = (order as any)?.items as any[] | undefined;
  if (lineItemId && Array.isArray(lines)) {
    const li = lines.find((x) => x?.id === lineItemId);
    const liUnit = readMedusaMajorAmount(li?.unit_price);
    if (liUnit !== null && liUnit > 0) {
      return clampPositiveMajor(liUnit);
    }
    const liQty = Math.max(1, Number(li?.quantity) || 1);
    const liTotal = readMedusaMajorAmount(li?.total);
    if (liTotal !== null && liTotal > 0) {
      return clampPositiveMajor(liTotal / liQty);
    }
  }

  return 0.01;
}

/**
 * Builds FedEx customs commodity lines from cart-like or fulfillment line items.
 */
export function buildFedexCustomsLines(
  inputItems: Partial<FulfillmentItemDTO>[],
  order: Partial<FulfillmentOrderDTO> | undefined,
  packageLineItems: FedexRateRequestItem[],
  defaultManufactureCountry: string
): FedexCustomsLineInput[] {
  const currency = resolveOrderCurrency(order);
  const origin2 = normalizeFedexCountryCode(defaultManufactureCountry) || "CO";

  return inputItems.map((item, index) => {
    const row = item as FulfillmentItemDTO & {
      variant?: ProductVariantDTO;
    } & Record<string, unknown>;
    const variant = row.variant;
    const meta = (variant?.metadata ?? {}) as Record<string, unknown>;
    const hsRaw = (meta.hs_code ?? meta.harmonized_code ?? meta.HSCode ?? "") as string;
    const hs =
      typeof hsRaw === "string" && hsRaw.length > 0 ? hsRaw : "6109100012";
    const comRaw = (meta.country_of_manufacture ?? meta.countryOfManufacture ?? "") as string;
    const com =
      typeof comRaw === "string" && comRaw.trim().length >= 2
        ? normalizeFedexCountryCode(comRaw)
        : origin2;

    const title =
      (typeof row.title === "string" && row.title) ||
      (typeof row.product_title === "string" && row.product_title) ||
      (variant?.title ? String(variant.title) : "") ||
      "General merchandise";

    const qty = Math.max(1, Number(row.quantity) || 1);
    const unitPrice = resolveLineItemUnitPriceMajor(item, order);
    const w =
      packageLineItems[index]?.weight ??
      packageLineItems[0]?.weight ?? { units: "KG" as const, value: 1 };

    return {
      description: title,
      quantity: qty,
      unitPrice,
      currency,
      harmonizedCode: hs,
      countryOfManufacture: com,
      weight: w,
    };
  });
}

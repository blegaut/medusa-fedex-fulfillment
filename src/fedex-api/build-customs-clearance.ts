import type { FedexCustomsLineInput } from "./types";

/** FedEx recommends ASCII-only strings in Ship / Rate requests. */
function toFedexAsciiDescription(input: string, maxLen = 120): string {
  const stripped = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, maxLen) || "General merchandise";
}

/** Harmonized code: digits only, capped for typical FedEx validation. */
function normalizeHarmonizedCode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.slice(0, 12) || "6109100012";
}

/**
 * FedEx `customsClearanceDetail` for international commodity shipments (Ship or Rate API).
 * @see https://developer.fedex.com/api/en-us/catalog/ship/v1/docs.html
 */
export function buildCustomsClearanceDetail(
  accountNumber: string,
  customsLines: FedexCustomsLineInput[]
): Record<string, unknown> {
  return {
    dutiesPayment: {
      paymentType: "SENDER",
      payor: {
        responsibleParty: {
          accountNumber: { value: accountNumber },
        },
      },
    },
    commodities: customsLines.map((line) => {
      const lineTotal = Math.round(line.unitPrice * line.quantity * 100) / 100;
      return {
        description: toFedexAsciiDescription(line.description),
        countryOfManufacture: line.countryOfManufacture.trim().toUpperCase().slice(0, 2),
        harmonizedCode: normalizeHarmonizedCode(line.harmonizedCode),
        quantity: line.quantity,
        quantityUnits: "EA",
        weight: {
          units: line.weight.units,
          value: line.weight.value,
        },
        unitPrice: {
          amount: line.unitPrice,
          currency: line.currency,
        },
        customsValue: {
          amount: lineTotal,
          currency: line.currency,
        },
      };
    }),
  };
}

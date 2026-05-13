/**
 * Default multiplier applied to FedEx freight after converting to USD
 * (conversion + payment margin). **1.03** = **3%** on top of the USD amount.
 *
 * Override per store via fulfillment provider `options.shippingUsdFeeMultiplier` in `medusa-config.ts`.
 */
export const DEFAULT_SHIPPING_USD_FEE_MULTIPLIER = 1.03;

type CurrencyExchangeRate = {
  fromCurrency?: string;
  intoCurrency?: string;
  rate?: number;
};

export type RatedShipmentDetailLike = {
  rateType?: string;
  totalNetCharge?: number;
  currency?: string;
  shipmentRateDetail?: {
    currency?: string;
    currencyExchangeRate?: CurrencyExchangeRate;
  };
};

function roundUsdMajor(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function normalizeFeeMultiplier(multiplier: number | undefined): number {
  const m =
    multiplier === undefined
      ? DEFAULT_SHIPPING_USD_FEE_MULTIPLIER
      : multiplier;
  if (typeof m !== "number" || !Number.isFinite(m) || m <= 0) {
    throw new Error(
      "shippingUsdFeeMultiplier must be a finite number > 0 (FedEx provider options)"
    );
  }
  return m;
}

/**
 * Converts FedEx `totalNetCharge` to **USD** using `currencyExchangeRate` when the charge is not in USD,
 * then applies the fee multiplier (default {@link DEFAULT_SHIPPING_USD_FEE_MULTIPLIER} = 3%).
 *
 * Supported FX (FedEx Rate reply): `fromCurrency: USD`, `intoCurrency: <billed>`,
 * `rate` = billed currency units per **1 USD** → **USD = charge / rate**.
 *
 * @throws If billed currency is not USD and `currencyExchangeRate` is missing, invalid, or not USD→billed.
 */
export function fedexNetChargeToUsdWithFee(
  detail: RatedShipmentDetailLike,
  feeMultiplier?: number
): number {
  const mult = normalizeFeeMultiplier(feeMultiplier);
  const charge = detail.totalNetCharge;
  if (typeof charge !== "number" || !Number.isFinite(charge) || charge < 0) {
    throw new Error("FedEx rate response missing or invalid totalNetCharge");
  }

  const billed =
    (detail.currency ?? detail.shipmentRateDetail?.currency ?? "")
      .trim()
      .toUpperCase() || "USD";

  if (billed === "USD") {
    return roundUsdMajor(charge * mult);
  }

  const fx = detail.shipmentRateDetail?.currencyExchangeRate;
  if (!fx || typeof fx.rate !== "number" || !Number.isFinite(fx.rate) || fx.rate <= 0) {
    throw new Error(
      `FedEx rate response missing currencyExchangeRate (billed currency: ${billed}, USD display required)`
    );
  }

  const from = (fx.fromCurrency ?? "").trim().toUpperCase();
  const into = (fx.intoCurrency ?? "").trim().toUpperCase();

  if (from === "USD" && into === billed) {
    return roundUsdMajor((charge / fx.rate) * mult);
  }

  throw new Error(
    `FedEx currencyExchangeRate must be USD→${billed} for conversion (got ${from}→${into})`
  );
}

/** Prefers LIST rate row when present; otherwise first row with `totalNetCharge`. */
export function pickRatedShipmentDetail(
  details: RatedShipmentDetailLike[] | undefined
): RatedShipmentDetailLike | undefined {
  if (!Array.isArray(details) || details.length === 0) {
    return undefined;
  }
  const list = details.find(
    (d) =>
      d.rateType === "LIST" && typeof d.totalNetCharge === "number"
  );
  if (list) {
    return list;
  }
  return details.find((d) => typeof d.totalNetCharge === "number");
}

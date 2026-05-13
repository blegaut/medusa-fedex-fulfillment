import {
  FedexAddress,
  FedexCustomsLineInput,
  FedexRateRequestItem,
  FedexShippingRate,
} from "./types";
import { Logger } from "@medusajs/framework/types";
import { buildCustomsClearanceDetail } from "./build-customs-clearance";
import {
  isCrossBorderFedexLane,
  normalizeFedexCountryCode,
  resolveFedexStateOrProvinceCode,
} from "../utils/fedex-address-region";

type RateReplyDetail = {
  serviceType: string;
  serviceName: string;
  ratedShipmentDetails: { totalNetCharge: number }[];
  commit?: { transitDays?: { description?: string } };
};

function buildRatePartyAddress(addr: FedexAddress): Record<string, unknown> {
  const country = normalizeFedexCountryCode(addr.countryCode);
  const state = resolveFedexStateOrProvinceCode(addr.countryCode, addr.stateOrProvinceCode);
  const out: Record<string, unknown> = {
    postalCode: addr.postalCode,
    countryCode: country,
  };
  if (state) {
    out.stateOrProvinceCode = state;
  }
  return out;
}

/**
 * Get the FedEx shipping rates.
 * @param customsLines - When origin/destination countries differ, pass commodity lines for `customsClearanceDetail` (Rate API).
 */
export const getShippingRates = async (
  baseUrl: string,
  token: string,
  accountNumber: string,
  origin: FedexAddress,
  destination: FedexAddress,
  items: FedexRateRequestItem[],
  customsLines: FedexCustomsLineInput[] | null | undefined,
  logger?: Logger
): Promise<FedexShippingRate[]> => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Invalid items array");
  }

  const requestedShipment: Record<string, unknown> = {
    shipper: {
      address: buildRatePartyAddress(origin),
    },
    recipient: {
      address: buildRatePartyAddress(destination),
    },
    pickupType: "DROPOFF_AT_FEDEX_LOCATION",
    packagingType: "YOUR_PACKAGING",
    rateRequestType: ["ACCOUNT", "LIST"],
    requestedPackageLineItems: items,
  };

  if (
    isCrossBorderFedexLane(origin, destination) &&
    customsLines &&
    customsLines.length > 0
  ) {
    requestedShipment.customsClearanceDetail = buildCustomsClearanceDetail(
      accountNumber,
      customsLines
    );
  }

  const shipment = {
    accountNumber: {
      value: accountNumber,
    },
    rateRequestControlParameters: {
      returnTransitTimes: true,
    },
    requestedShipment,
  };

  if (logger) {
    logger.debug("FedEx rate quote request: \n" + JSON.stringify(shipment, null, 2));
  }

  const response = await fetch(`${baseUrl}/rate/v1/rates/quotes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-locale": "en_US",
      "X-account-number": accountNumber,
    },
    body: JSON.stringify(shipment),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    let logBody = bodyText;
    try {
      logBody = JSON.stringify(JSON.parse(bodyText), null, 2);
    } catch {
      /* keep raw bodyText */
    }
    const headline = `FedEx rate quote request failed [${response.status} ${response.statusText}]`;
    if (logger) {
      logger.error(`${headline}\n${logBody || "(empty body)"}`);
    }
    const forThrow =
      bodyText.length > 8000
        ? `${bodyText.slice(0, 8000)}…(truncated)`
        : bodyText;
    throw new Error(`${headline}${forThrow ? `: ${forThrow}` : ""}`);
  }

  const result = await response.json();

  if (logger) {
    logger.debug("FedEx rate quote response: \n" + JSON.stringify(result, null, 2));
  }

  return Array.isArray(result.output?.rateReplyDetails)
    ? result.output.rateReplyDetails.map((r: RateReplyDetail) => {
        const rawTransit = r.commit?.transitDays?.description ?? "";

        return {
          code: r.serviceType,
          name: r.serviceName,
          price: r.ratedShipmentDetails[0].totalNetCharge,
          estimatedDelivery: rawTransit,
        };
      })
    : [];
};

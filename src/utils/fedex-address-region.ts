import type { FedexAddress } from "../fedex-api/types";

/**
 * FedEx documents state/province codes for a limited set of countries.
 * For other origins/destinations, omit `stateOrProvinceCode` from the API payload.
 *
 * **Colombia (CO):** FedEx expects `DC` (Distrito Capital / Bogotá D.C.) for typical store/cart
 * addresses in that region; we always send `DC` for `CO` to avoid invalid values like "Bogota DC".
 */
const FEDEX_STATE_OR_PROVINCE_REQUIRED = new Set([
  "US",
  "CA",
  "MX",
  "IN",
  "AE",
]);

export function normalizeFedexCountryCode(code: string | undefined | null): string {
  return (code ?? "").trim().toUpperCase().slice(0, 2);
}

export function fedexCountryRequiresStateOrProvince(
  countryCode: string | undefined | null
): boolean {
  return FEDEX_STATE_OR_PROVINCE_REQUIRED.has(normalizeFedexCountryCode(countryCode));
}

/** U.S. state / DC name → USPS-style code; returns input if already a code or unknown. */
export function usStateNameToCode(stateName: string): string {
  if (!stateName) return stateName;
  const states: Record<string, string> = {
    alabama: "AL",
    alaska: "AK",
    arizona: "AZ",
    arkansas: "AR",
    california: "CA",
    colorado: "CO",
    connecticut: "CT",
    delaware: "DE",
    florida: "FL",
    georgia: "GA",
    hawaii: "HI",
    idaho: "ID",
    illinois: "IL",
    indiana: "IN",
    iowa: "IA",
    kansas: "KS",
    kentucky: "KY",
    louisiana: "LA",
    maine: "ME",
    maryland: "MD",
    massachusetts: "MA",
    michigan: "MI",
    minnesota: "MN",
    mississippi: "MS",
    missouri: "MO",
    montana: "MT",
    nebraska: "NE",
    nevada: "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    ohio: "OH",
    oklahoma: "OK",
    oregon: "OR",
    pennsylvania: "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    tennessee: "TN",
    texas: "TX",
    utah: "UT",
    vermont: "VT",
    virginia: "VA",
    washington: "WA",
    "west virginia": "WV",
    wisconsin: "WI",
    wyoming: "WY",
    "district of columbia": "DC",
  };
  return states[stateName.trim().toLowerCase()] || stateName;
}

/**
 * When FedEx expects a subdivision code and Medusa provided one, return it.
 * Otherwise `undefined` (omit from JSON).
 */
export function resolveFedexStateOrProvinceCode(
  countryCode: string | undefined | null,
  province: string | undefined | null
): string | undefined {
  const cc = normalizeFedexCountryCode(countryCode);
  if (cc === "CO") {
    return "DC";
  }

  if (!fedexCountryRequiresStateOrProvince(countryCode)) {
    return undefined;
  }
  const raw = (province ?? "").trim();
  if (!raw) {
    return undefined;
  }
  if (cc === "US") {
    return usStateNameToCode(raw);
  }
  return raw.toUpperCase().slice(0, 35);
}

export function isCrossBorderFedexLane(
  origin: FedexAddress,
  destination: FedexAddress
): boolean {
  const o = normalizeFedexCountryCode(origin.countryCode);
  const d = normalizeFedexCountryCode(destination.countryCode);
  return Boolean(o && d && o !== d);
}

# Papapo fork: requirements and implementation plan

This document records **integration gaps** discovered while wiring FedEx into Medusa for **Papapo** (Colombia / Panama and related flows), and a **phased plan** to implement them in this fork (`medusa-fedex-fulfillment`).

Upstream reference: [igorppbr/medusa-fedex-fulfillment](https://github.com/igorppbr/medusa-fedex-fulfillment) (npm: `@igorppbr/medusa-v2-fedex-fulfillment`).

---

## 1. Context

The stock plugin provides:

- OAuth2 **client credentials** to FedEx (`/oauth/token`).
- **Rate quotes** via `POST /rate/v1/rates/quotes` for calculated shipping.
- **Create shipment** via `POST /ship/v1/shipments` with label URLs.
- **Admin** UI for credentials and order widgets.
- **Credential storage** in DB (Admin) with fallback to `medusa-config` provider options.

Papapo needs **reliable international** behavior (e.g. CO → PA) and **operational** data quality (addresses, service codes, customs). The following items are **new or strengthened requirements** for this fork.

---

## 2. Environment and Medusa configuration

| Requirement | Details |
|-------------|--------|
| **FedEx credentials** | `client_id`, `client_secret`, `account_number` from the FedEx Developer project; test vs production must match `isSandbox` and API host (`apis-sandbox` vs `apis`). |
| **API products** | The same developer app must have the **Rate** and **Ship** (and any document) APIs **enabled and deployed** (and moved to production for live keys). Missing products produce `FORBIDDEN.ERROR` on rate even when OAuth succeeds. |
| **Fulfillment provider** | Register provider `id: "fedex"` in `@medusajs/medusa/fulfillment` and the plugin in `plugins` (see upstream README). |
| **Stock location** | `from_location` for rates must have **province**, **postal_code**, **country_code** (and lines/city as needed). |
| **Sales channel (create label)** | Plugin reads `order.sales_channel_id` and requires **`metadata.phone`** on that sales channel for shipper contact. Set in Admin or Admin API. |

---

## 3. Address and code quality (rates + ship)

| Issue | Symptom | Direction for fork |
|------|---------|---------------------|
| **Province as free text** | Values like `Bogota DC`, `Panamá` sent as `stateOrProvinceCode` | Map Medusa `province` to **FedEx-expected** subdivision codes (ISO / FedEx lists per country) or document required Admin format. |
| **Country code case** | `co` / `pa` in payloads | Normalize to **uppercase** `CO` / `PA` (ISO 3166-1 alpha-2) when building FedEx JSON. |
| **Postal codes** | Invalid or placeholder postals (e.g. `507` misused) | Validate or document; align with FedEx address validation if needed. |
| **US-only `stateNameToCode` helper** | Non-US provinces pass through unchanged or wrong | Replace or extend mapping for **CO**, **PA**, and other lanes Papapo uses. |

---

## 4. Rate quote flow

| Issue | Symptom | Direction for fork |
|------|---------|---------------------|
| **Service mismatch** | `FedEx rate quote response missing expected rate data` | `calculatePrice` does `rates.find(r => r.code === optionData.service_code)`. Returned `serviceType` list must **include** the option’s `service_code`. **Sandbox virtual responses** may return a small, dummy set (e.g. only `FIRST_OVERNIGHT` with US domestic derived addresses); Admin-configured services must match **or** document sandbox limitations. |
| **Wrong product for lane** | Using a **US domestic** `serviceType` for international origin/destination | For international lanes, shipping options should use **international** `serviceType` values (see FedEx mapping in `src/fedex-api/types.ts`). |
| **Logging** | Hard to debug 403/400 | Optional: log FedEx **error response body** on non-OK (not only `statusText`). |

---

## 5. Create shipment (international)

| Issue | Symptom | Direction for fork |
|------|---------|---------------------|
| **Missing customs** | `TOTALCUSTOMSVALUE.REQUIRED` (HTTP 400) for cross-border | `create-fulfillment.ts` must add FedEx **customs** data: e.g. `customsClearanceDetail` with **commodities** and **customs value** (and related fields per FedEx Ship API v1 for the lane), plus **duties/taxes payment** as required. |
| **Data source** | N/A | Derive line-level or shipment-level values from `order` / `items` in `create-shipment` workflow: description, quantity, `unit_price`, currency, country of manufacture if required. |
| **Service type** | Wrong product for international | Ensure `serviceType` on the ship request matches an **international** product for the origin/destination pair. |

---

## 6. Optional improvements (later)

- **Commercial invoice** / pro forma if FedEx requires for the lane.
- **Return labels** and cancel shipment alignment with FedEx APIs.
- **Tests**: unit tests for address normalization and payload builders; smoke test with sandbox (where stable).

---

## 7. Implementation plan (phased)

### Phase A — Build and wire (no behavior change)

1. Keep package name `@igorppbr/medusa-v2-fedex-fulfillment` (or publish a scoped name later) so Medusa `medusa-config` **resolve** paths stay the same.
2. Document: **this repo gitignores `.medusa/`**; run `yarn` then `yarn build` in the fork before the host app (`papapo-store`) can load the plugin (see `package.json` `main` / `exports`).
3. In **papapo-store**, depend on the fork via `file:../medusa-fedex-fulfillment` and run `yarn install` from the store root.

### Phase B — International ship (Papapo-critical)

1. Extend `src/fedex-api/create-fulfillment.ts` to add **customs** blocks when origin/destination countries differ (or when FedEx requires it), using order line totals and currency.
2. Pass through any extra fields from `create-shipment` workflow (order, items) already available in `input`.
3. Surface clear errors if required customs fields are missing in order/product data.

### Phase C — Address and rate robustness

1. Add **country-specific** normalization for `stateOrProvinceCode` and **uppercase** `countryCode` in rate and ship builders.
2. Consider optional **fedex_** metadata on sales channel or store for default shipper phone if you want to avoid overloading `metadata.phone` only.
3. Improve error logging for FedEx JSON error bodies on failed HTTP responses.

### Phase D — QA and documentation

1. Re-test: OAuth, rate (calculated option), create fulfillment (label) for a **pilot** international order.
2. Update main `README.md` in this fork with a short “Papapo fork” section pointing to this doc.

---

## 8. Local dev: Medusa-recommended Yalc flow (papapo-store)

This matches [Medusa: publish plugin for local testing](https://docs.medusajs.com/learn/fundamentals/plugins/create#3-publish-plugin-locally-for-development-and-testing).

**Terminal A — plugin repo (`medusa-fedex-fulfillment`)**

```bash
corepack enable
cd /path/to/medusa-fedex-fulfillment
yarn install
```

First time (and after a clean Yalc store if needed):

```bash
yarn plugin:publish
```

Ongoing while you change the plugin (watch + republish to Yalc + refresh in the app):

```bash
yarn plugin:develop
# alias: yarn dev
```

**Terminal B — Medusa app (`papapo-store`)**

First time, or after clone / removing `.yalc`:

```bash
cd /path/to/papapo-store
yarn plugin:fedex:add
# equivalent: yarn medusa plugin:add @igorppbr/medusa-v2-fedex-fulfillment
yarn install
yarn dev
```

**After you change the plugin (explicit loop — recommended for admin / when `plugin:develop` misses files):**

1. In the **plugin** repo: `yarn plugin:push:store` — runs `medusa plugin:build` then `yalc push`.
2. In **papapo-store**: `yarn plugin:fedex:sync` — clears Vite’s `node_modules/.vite` cache, runs `yalc update`, removes the old `node_modules` copy of the package, and `yarn install` to re-link from `.yalc`.
3. Restart **`yarn dev`** in the store.

`package.json` in the app uses `file:.yalc/@igorppbr/medusa-v2-fedex-fulfillment` (set by `medusa plugin:add`). `yalc` is already a **devDependency** in papapo-store.

**Production / CI:** do not rely on Yalc; depend on a published version from npm or a private registry instead.

---

## 9. Build note (manual `yarn build` without `plugin:develop`)

The published npm package includes a prebuilt `.medusa/server` tree. This source repo **ignores** `.medusa/`. If you are not using `plugin:develop`, after changes:

```bash
corepack enable
cd /path/to/medusa-fedex-fulfillment
yarn install
yarn build
```

**Yarn 4 boundary:** If a parent directory (e.g. `~/Code/`) contains a stray `yarn.lock` without a proper workspace, Yarn 4 may refuse to treat this repo as its own project. This fork includes a **committed `yarn.lock`** at its root so installs are scoped to this package. Do not remove it without addressing the parent layout.

---

## 10. References (FedEx)

- FedEx Developer Portal: API products, keys, sandbox vs production.
- FedEx REST: **Rate** `POST /rate/v1/rates/quotes`, **Ship** `POST /ship/v1/shipments` — request bodies for **international** shipments and **customs** fields (current API version in your project).

---

*Last updated: 2026-04-22 — Papapo / fork planning.*

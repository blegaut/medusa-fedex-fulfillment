import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  StockLocationDTO,
  IStockLocationService,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOrderDTO,
  ProductVariantDTO,
  CreateFulfillmentResult,
  IFulfillmentModuleService,
  ShippingOptionDTO,
  ISalesChannelModuleService,
  SalesChannelDTO,
} from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import {
  FedexAddress,
  FedexContact,
  FedexCustomsLineInput,
  FedexRateRequestItem,
  FedexShipmentResponse,
} from "../fedex-api/types";
import { createFulfillment } from "../fedex-api/create-fulfillment";
import {
  isCrossBorderFedexLane,
  normalizeFedexCountryCode,
  resolveFedexStateOrProvinceCode,
} from "../utils/fedex-address-region";
import { buildFedexCustomsLines } from "../utils/fedex-customs-lines";
import { resolveWorkflowLogger } from "../utils/workflow-logger";

type WorkflowInput = {
  token: string;
  baseUrl: string;
  accountNumber: string;
  locationId: string;
  data: Record<string, unknown>;
  items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[];
  order: Partial<FulfillmentOrderDTO> | undefined;
  fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>;
  weightUnitOfMeasure: "LB" | "KG";
  debug?: boolean;
};

/**
 * Step to create a FedEx shipment.
 */
const createFedexShipment = createStep(
  "create-fedex-shipment",
  async (
    input: WorkflowInput,
    { container }
  ): Promise<StepResponse<{ shipment: FedexShipmentResponse }>> => {
    const log = resolveWorkflowLogger(container);

    if (input.debug) {
      log.info("FedEx create fulfillment started");
    }

    const stockLocationService = container.resolve<IStockLocationService>(
      Modules.STOCK_LOCATION
    );
    const locations = await stockLocationService.listStockLocations(
      { id: [input.locationId] },
      {
        relations: ["address"],
      }
    );

    if (locations.length === 0) {
      throw new Error("Location not found");
    }

    const location: StockLocationDTO = locations[0];

    if (input.debug) {
      log.info(`Stock Location : ${JSON.stringify(location, null, 2)}`);
    }

    if (!location.address) {
      throw new Error("Location address not found");
    }

    if (!location.address.postal_code) {
      throw new Error("Location address postal code not found");
    }

    if (!location.address.country_code) {
      throw new Error("Location address country code not found");
    }

    const orderItems: FedexRateRequestItem[] = input.items.map(
      (item: FulfillmentItemDTO & { variant?: ProductVariantDTO }) => ({
        groupPackageCount: 1,
        weight: {
          units: input.weightUnitOfMeasure,
          value: item.variant?.weight ? item.variant.weight : 1,
        },
        dimensions: {
          length: item.variant?.length ? item.variant.length : 1,
          width: item.variant?.width ? item.variant.width : 1,
          height: item.variant?.height ? item.variant.height : 1,
          units: "CM",
        },
      })
    );

    if (input.debug) {
      log.info(`Order Items : ${JSON.stringify(orderItems, null, 2)}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recipient = (input.order as any)?.shipping_address ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (input.data as any)["to_address"] ||
      {};

    const destState = resolveFedexStateOrProvinceCode(
      recipient.country_code,
      recipient.province
    );
    const destinationAddress: FedexAddress = {
      streetLines: [recipient.address_1, recipient.address_2].filter(
        (line): line is string => typeof line === "string" && !!line
      ),
      postalCode: recipient.postal_code,
      countryCode: normalizeFedexCountryCode(recipient.country_code),
      city: recipient.city || "",
      ...(destState ? { stateOrProvinceCode: destState } : {}),
    };

    const originState = resolveFedexStateOrProvinceCode(
      location.address.country_code,
      location.address.province
    );
    const originAddress: FedexAddress = {
      streetLines: [location.address.address_1, location.address.address_2].filter(
        (line): line is string => typeof line === "string" && !!line
      ),
      postalCode: location.address.postal_code,
      countryCode: normalizeFedexCountryCode(location.address.country_code),
      city: location.address.city || "",
      ...(originState ? { stateOrProvinceCode: originState } : {}),
    };

    if (input.debug) {
      log.info(`Origin Address : ${JSON.stringify(originAddress, null, 2)}`);
      log.info(`Destination Address : ${JSON.stringify(destinationAddress, null, 2)}`);
    }

    const shippingMethodId = input.fulfillment.shipping_option_id;

    if (!shippingMethodId) {
      throw new Error(
        "FedEx create fulfillment failed: Missing shipping method id"
      );
    }

    const fulfillmentService = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    );

    const shippingOption: ShippingOptionDTO = await fulfillmentService.retrieveShippingOption(shippingMethodId);

    if (!shippingOption || !shippingOption.data || !shippingOption.data.carrier_code) {
      throw new Error("FedEx create fulfillment failed: Missing shipping option data");
    }

    const shippingMethodCode: string = shippingOption.data.carrier_code.toString();

    if (input.debug) {
      log.info(`Shipping Method Code: ${shippingMethodCode}`);
    }

    const customerContact: FedexContact = {
      personName: recipient.first_name + " " + recipient.last_name,
      phoneNumber: recipient.phone,
    };

    // Get sales channel information
    const salesChannelId = input.order?.sales_channel_id;
    if (!salesChannelId) {
      throw new Error("FedEx create fulfillment failed: Missing sales channel id");
    }
    const salesChannelService = container.resolve<ISalesChannelModuleService>(
      Modules.SALES_CHANNEL
    );
    const salesChannel: SalesChannelDTO = await salesChannelService.retrieveSalesChannel(salesChannelId);

    if (!salesChannel.metadata || !salesChannel.metadata.phone) {
      throw new Error("FedEx create fulfillment failed: Missing sales channel phone");
    }

    const storeContact: FedexContact = {
      personName: salesChannel.name,
      phoneNumber: salesChannel.metadata.phone.toString(),
    };

    const crossBorder = isCrossBorderFedexLane(originAddress, destinationAddress);
    const customsLines: FedexCustomsLineInput[] | null = crossBorder
      ? buildFedexCustomsLines(
          input.items,
          input.order,
          orderItems,
          location.address.country_code ?? ""
        )
      : null;

    const shipment = await createFulfillment(
      input.baseUrl,
      input.token,
      input.accountNumber,
      originAddress,
      storeContact,
      destinationAddress,
      customerContact,
      orderItems,
      shippingMethodCode,
      customsLines,
      input.debug ? log : undefined
    );

    return new StepResponse({ shipment });
  }
);

/**
 * Workflow to create a FedEx shipment and generate a shipping label.
 */
const createShipmentWorkflow = createWorkflow(
  "create-fedex-shipment-and-label",
  (input: WorkflowInput): WorkflowResponse<{ shipment: CreateFulfillmentResult }> => {
    const { shipment } = createFedexShipment(input);

    const fulfillmentResponse: CreateFulfillmentResult = {
      labels: [
        {
          tracking_url: shipment.trackingUrl,
          label_url: shipment.labelUrl ?? "",
          tracking_number: shipment.trackingNumber ?? "",
        },
      ],
      data: {
        tracking_url: shipment.trackingUrl,
        label_url: shipment.labelUrl ?? "",
        tracking_number: shipment.trackingNumber ?? "",
        fedex_transaction_id: shipment.transactionId ?? null,
        fedex_service_type: shipment.serviceType ?? null,
        fedex_service_name: shipment.serviceName ?? null,
        fedex_carrier_code: shipment.carrierCode ?? null,
        fedex_ship_datestamp: shipment.shipDatestamp ?? null,
      },
    };

    return new WorkflowResponse({
      shipment: fulfillmentResponse,
    });
  }
);

export default createShipmentWorkflow;

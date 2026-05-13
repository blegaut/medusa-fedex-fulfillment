import { Logger } from "@medusajs/framework/types";
import {
    FedexAddress,
    FedexContact,
    FedexCustomsLineInput,
    FedexRateRequestItem,
    FedexShipmentResponse,
} from "./types";
import { buildCustomsClearanceDetail } from "./build-customs-clearance";
import { isCrossBorderFedexLane } from "../utils/fedex-address-region";

/**
 * Creates a FedEx shipment fulfillment by sending a request to the FedEx API.
 *
 * @param customsLines - One entry per fulfilled line for international lanes; pass `null` for domestic.
 */
export const createFulfillment = async (
    baseUrl: string,
    token: string,
    accountNumber: string,
    origin: FedexAddress,
    originContact: FedexContact,
    destination: FedexAddress,
    destinationContact: FedexContact,
    items: FedexRateRequestItem[],
    shippingMethod: string,
    customsLines: FedexCustomsLineInput[] | null,
    logger?: Logger
): Promise<FedexShipmentResponse> => {
    const crossBorder = isCrossBorderFedexLane(origin, destination);
    if (crossBorder && (!customsLines || customsLines.length === 0)) {
        throw new Error(
            "FedEx international shipment requires customs line items derived from order/fulfillment data"
        );
    }

    const requestedShipment: Record<string, unknown> = {
        shipper: {
            address: origin,
            contact: originContact,
        },
        recipients: [
            {
                address: destination,
                contact: destinationContact,
            },
        ],
        pickupType: "DROPOFF_AT_FEDEX_LOCATION",
        packagingType: "YOUR_PACKAGING",
        requestedPackageLineItems: items,
        serviceType: shippingMethod,
        shipTimestamp: new Date().toISOString(),
        labelSpecification: {
            imageType: "PDF",
            labelStockType: "PAPER_4X6",
            labelFormatType: "COMMON2D",
            labelRotation: "NONE",
        },
        shippingChargesPayment: {
            paymentType: "SENDER",
            payor: {
                responsibleParty: {
                    accountNumber: { value: accountNumber },
                },
            },
        },
    };

    if (crossBorder && customsLines) {
        requestedShipment.customsClearanceDetail = buildCustomsClearanceDetail(
            accountNumber,
            customsLines
        );
    }

    const shipmentPayload = {
        accountNumber: { value: accountNumber },
        labelResponseOptions: "URL_ONLY",
        requestedShipment,
    };

    if (logger) {
        logger.info(`FedEx create shipment payload: ${JSON.stringify(shipmentPayload, null, 2)}`);
    }

    const response = await fetch(`${baseUrl}/ship/v1/shipments`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-account-number": accountNumber,
        },
        body: JSON.stringify(shipmentPayload),
    });

    if (!response.ok) {
        const text = await response.text();
        if (logger) {
            logger.error(`FedEx create shipment failed [${response.status}]: ${text}`);
        }
        throw new Error(`FedEx create shipment failed: ${response.statusText}`);
    }
    const result = await response.json();

    if (logger) {
        logger.info(`FedEx create shipment response: ${JSON.stringify(result, null, 2)}`);
    }

    const shipmentDetail = result.output?.transactionShipments?.[0] || {};
    const completed = shipmentDetail.completedShipmentDetail || {};

    const trackingNumber = shipmentDetail.masterTrackingNumber || null;
    const firstPiece = shipmentDetail.pieceResponses?.[0];
    const firstDoc = firstPiece?.packageDocuments?.[0];
    const labelUrl = firstDoc?.url || null;
    const trackingUrl = trackingNumber
        ? `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`
        : "";

    return {
        trackingNumber,
        trackingUrl,
        labelUrl,
        transactionId: result.transactionId ?? null,
        serviceType: shipmentDetail.serviceType ?? null,
        serviceName: shipmentDetail.serviceName ?? null,
        carrierCode: completed.carrierCode ?? null,
        shipDatestamp: shipmentDetail.shipDatestamp ?? null,
    };
};

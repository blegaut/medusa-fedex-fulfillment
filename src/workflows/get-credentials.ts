import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { FEDEX_SETTINGS_MODULE } from "../modules/setting";
import { SetupCredentialsInput } from "../api/admin/fedex/route";
import FedexSettingsModuleService from "../modules/setting/service";

/**
 * Get FedEx credentials from the settings module.
 * @returns StepResponse<SetupCredentialsInput | null>
 */
const getDatabaseCredentials = createStep(
  "get-fedex-database-credentials",
  async (
    _input,
    { container }
  ): Promise<StepResponse<SetupCredentialsInput | null>> => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger;
    try {
      const fedexSettingService: FedexSettingsModuleService = container.resolve(FEDEX_SETTINGS_MODULE)
      const result = await fedexSettingService.getCredentials();
      return new StepResponse(result);
    } catch (error) {
      logger.error(
        `Error getting FedEx credentials from database: ${error instanceof Error ? error.message : String(error)}`
      );
      return new StepResponse(null);
    }
  }
);

/**
 * Create the workflow for getting FedEx credentials.
 * @returns WorkflowResponse<SetupCredentialsInput | null>
 */
const getCredentialsWorkflow = createWorkflow(
  "get-fedex-credentials",
  () => {
    const databaseCredentials = getDatabaseCredentials();
    return new WorkflowResponse(databaseCredentials);
  }
);

export default getCredentialsWorkflow;

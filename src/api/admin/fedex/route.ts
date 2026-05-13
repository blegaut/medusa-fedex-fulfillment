import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PostFedexSettings } from "./validator"
import { TransactionStepError } from "@medusajs/framework/orchestration"
import { z } from "zod"
import getCredentialsWorkflow from "../../../workflows/get-credentials"
import setupCredentialsWorkflow from "../../../workflows/setup-credentials"

export type SetupCredentialsInput = z.infer<typeof PostFedexSettings>

export type SetupCredentialsResponse = {
    success: boolean
    input: SetupCredentialsInput
    errors?: TransactionStepError[] | string[]
}

/**
 * API endpoint for setting up FedEx credentials
 * @param req MedusaRequest<SetupCredentialsInput>
 * @param res MedusaResponse<SetupCredentialsResponse>
 * @returns MedusaResponse<SetupCredentialsResponse>
 */
export const POST = async (
  req: MedusaRequest<SetupCredentialsInput>,
  res: MedusaResponse<SetupCredentialsResponse>
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as Logger
  try {
    const input: SetupCredentialsInput = req.body

    const { result, errors } = await setupCredentialsWorkflow(req.scope)
      .run({
        input
      })

    if ((errors && errors.length > 0) || !result) {
      return res.status(400).json({
          success: false,
          input,
          errors
      })
    }

    res.json(result)
  } catch (error) {
    logger.error(
      `Error setting up FedEx credentials: ${error instanceof Error ? error.message : String(error)}`
    )
    return res.status(500).json({
      success: false,
      errors: ["Internal Server Error"],
      input: req.validatedBody
    });
  }
}

/**
 * Get FedEx credentials from the settings module.
 * @param req MedusaRequest
 * @param res MedusaResponse
 * @returns MedusaResponse<SetupCredentialsInput | {}>
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse<SetupCredentialsInput | null>
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as Logger
  try {
      const { result, errors } = await getCredentialsWorkflow()
        .run({
          input: {}
        })

      if ((errors && errors.length > 0)) {
        logger.info(
          `Errors getting FedEx credentials: ${JSON.stringify(errors, null, 2)}`
        )
        return res.status(400).json(null)
      }

      res.json(result);
  } catch (error) {
    logger.error(
      `Error getting FedEx credentials: ${error instanceof Error ? error.message : String(error)}`
    )
    return res.status(500).json(null);
  }
}

import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

type ContainerLike = { resolve<T = unknown>(key: string): T };

/**
 * When a workflow is run without a Medusa scope (e.g. `workflow().run({ input })`),
 * the orchestrator uses an empty container that does not register `logger`.
 * When run as `workflow(req.scope).run(...)`, `logger` resolves normally.
 *
 * @see https://docs.medusajs.com/learn/fundamentals/workflows#execute-the-workflow
 */
export function resolveWorkflowLogger(container: ContainerLike): Logger {
  try {
    return container.resolve(
      ContainerRegistrationKeys.LOGGER
    ) as Logger;
  } catch {
    return console as unknown as Logger;
  }
}

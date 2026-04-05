/**
 * Validated wrapper around pi-ai's `getModel`.
 *
 * `getModel` silently returns `undefined` for unknown provider/model
 * combinations, which causes `createAgentSession` to silently fall back
 * to whatever API key is in the environment — a confusing silent failure.
 * This module validates at runtime and fails loudly instead.
 *
 * The pi-ai library types `getModel` with branded string-literal generics
 * (`KnownProvider`, model-id keyof), so dynamic strings from user config
 * require a cast at this boundary. The runtime check that follows makes
 * this safe — invalid values are caught immediately.
 *
 * @module
 */

import type { Api, Model } from "@mariozechner/pi-ai";

/**
 * Resolve a provider + model id via pi-ai's model registry.
 * Throws a descriptive error when the combination is unrecognised.
 */
export const resolveModel = async (
  provider: string,
  modelId: string,
): Promise<Model<Api>> => {
  const { getModel, getProviders } = await import("@mariozechner/pi-ai");

  // Cast required: getModel is typed for static KnownProvider literals,
  // but we accept dynamic user/plugin input. The undefined check below
  // is the real validation gate.
  const model = getModel(
    provider as Parameters<typeof getModel>[0],
    modelId as Parameters<typeof getModel>[1],
  );
  if (model) return model as Model<Api>;

  const known = (getProviders() as string[]).sort();
  throw new Error(
    `Unknown provider/model: "${provider}/${modelId}". ` +
      `Registered providers: [${known.join(", ")}]. ` +
      `Check your plugin's onModelSelected hook or --coder/--escalated CLI flags.`,
  );
};

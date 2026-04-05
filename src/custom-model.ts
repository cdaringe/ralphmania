/**
 * Resolve a {@link CustomModelConfig} into a pi-ai `Model` object.
 *
 * - **ollama**: queries `POST /api/show` for context window and input
 *   modalities, then targets the OpenAI-compatible `/v1` endpoint.
 * - **openai-compatible**: uses caller-provided metadata directly.
 *
 * @module
 */

import { z } from "zod";
import type { Api, Model, OpenAICompletionsCompat } from "@mariozechner/pi-ai";
import type { CustomModelConfig } from "./types.ts";
import { LOCAL_MODEL_COMPAT_DEFAULTS } from "./types.ts";

export const OLLAMA_DEFAULT_BASE = "http://localhost:11434";

// ---------------------------------------------------------------------------
// Ollama /api/show response schema
// ---------------------------------------------------------------------------

const OllamaDetailsSchema = z.object({
  parent_model: z.string().optional(),
  format: z.string().optional(),
  family: z.string().optional(),
  families: z.array(z.string()).optional(),
  parameter_size: z.string().optional(),
  quantization_level: z.string().optional(),
});

const OllamaShowSchema = z.object({
  license: z.string().optional(),
  modelfile: z.string().optional(),
  parameters: z.string().optional(),
  template: z.string().optional(),
  details: OllamaDetailsSchema.optional(),
  model_info: z.record(z.string(), z.unknown()).optional(),
});

export type OllamaShowResponse = z.infer<typeof OllamaShowSchema>;

// ---------------------------------------------------------------------------
// Ollama /api/tags response schema
// ---------------------------------------------------------------------------

const OllamaTagModelSchema = z.object({
  name: z.string(),
  model: z.string(),
  modified_at: z.string(),
  size: z.number(),
  digest: z.string(),
  details: OllamaDetailsSchema,
});

const OllamaTagsSchema = z.object({
  models: z.array(OllamaTagModelSchema),
});

export type OllamaTagsResponse = z.infer<typeof OllamaTagsSchema>;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export const queryOllamaShow = async (
  baseUrl: string,
  model: string,
): Promise<OllamaShowResponse> => {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/show`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) {
    throw new Error(
      `Ollama /api/show failed for "${model}" at ${url}: ${res.status} ${await res
        .text()}`,
    );
  }
  const json: unknown = await res.json();
  const parsed = OllamaShowSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Ollama /api/show returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
};

export const queryOllamaTags = async (
  baseUrl: string,
): Promise<OllamaTagsResponse> => {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/tags`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Ollama /api/tags failed at ${url}: ${res.status} ${await res.text()}`,
    );
  }
  const json: unknown = await res.json();
  const parsed = OllamaTagsSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Ollama /api/tags returned unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
};

/** Check if ollama is reachable at the given base URL. */
export const isOllamaReachable = async (
  baseUrl: string = OLLAMA_DEFAULT_BASE,
): Promise<boolean> => {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Model info extraction
// ---------------------------------------------------------------------------

export const extractContextWindow = (
  info: Record<string, unknown>,
): number => {
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith(".context_length") && typeof value === "number") {
      return value;
    }
  }
  return 8192;
};

export const hasVisionCapability = (
  info: Record<string, unknown>,
): boolean => {
  for (const key of Object.keys(info)) {
    if (key.includes(".vision.")) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Build a pi-ai Model from a custom config
// ---------------------------------------------------------------------------

const buildModel = (
  opts: {
    id: string;
    baseUrl: string;
    contextWindow: number;
    supportsImages: boolean;
    compat: OpenAICompletionsCompat;
  },
): Model<Api> => ({
  id: opts.id,
  name: opts.id,
  provider: "openai",
  // openai-completions is the correct API tag for OpenAI-compatible
  // chat/completions endpoints (ollama, llama.cpp, vLLM, etc.)
  api: "openai-completions" satisfies Api,
  baseUrl: opts.baseUrl,
  reasoning: false,
  input: opts.supportsImages ? ["text", "image"] : ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: opts.contextWindow,
  maxTokens: opts.contextWindow,
  compat: opts.compat,
});

/**
 * Resolve a custom model config into a pi-ai Model.
 */
export const resolveCustomModel = async (
  config: CustomModelConfig,
): Promise<Model<Api>> => {
  const compat: OpenAICompletionsCompat = {
    ...LOCAL_MODEL_COMPAT_DEFAULTS,
    ...config.compat,
  };

  if (config.kind === "ollama") {
    const base = config.baseUrl ?? OLLAMA_DEFAULT_BASE;
    const show = await queryOllamaShow(base, config.model);
    const info = show.model_info ?? {};
    return buildModel({
      id: config.model,
      baseUrl: `${base.replace(/\/+$/, "")}/v1`,
      contextWindow: extractContextWindow(info),
      supportsImages: hasVisionCapability(info),
      compat,
    });
  }

  return buildModel({
    id: config.model,
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    contextWindow: config.contextWindow,
    supportsImages: false,
    compat,
  });
};

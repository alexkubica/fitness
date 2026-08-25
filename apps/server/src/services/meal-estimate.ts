export type MealEstimateInput = Readonly<{
  userId: string;
  mealType: string;
  description: string;
  note?: string | undefined;
  photos?: readonly MealEstimatePhotoInput[] | undefined;
}>;

export type MealEstimatePhotoInput = Readonly<{
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
}>;

export type MealEstimateResult = Readonly<{
  totals: {
    calories: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
    fiberGrams: number;
  };
  ingredients: readonly MealEstimateIngredientResult[];
  confidence: number;
  summary: string;
  provider: "openrouter";
  model: string;
}>;

export type MealEstimateIngredientResult = Readonly<{
  name: string;
  quantity: number;
  unit: string;
  grams?: number | undefined;
  totals: {
    calories: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
    fiberGrams: number;
  };
}>;

export type MealNutritionEstimator = Readonly<{
  estimate(input: MealEstimateInput): Promise<MealEstimateResult>;
}>;

export type MealEstimateFetchResponse = Readonly<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export type MealEstimateFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<MealEstimateFetchResponse>;

export type OpenRouterMealEstimatorConfig = Readonly<{
  apiKey: string;
  endpoint?: string;
  fetch?: MealEstimateFetch;
  model?: string;
  visionModel?: string;
  fallbackModel?: string;
  appName?: string;
  siteUrl?: string;
  timeoutMs?: number;
  maxTokens?: number;
}>;

export type MealEstimatorRuntimeConfig = Readonly<{
  apiKey?: string;
  model?: string;
  visionModel?: string;
  fallbackModel?: string;
  appName?: string;
  siteUrl?: string;
}>;

export type MealEstimateFailureReason =
  | "provider-http"
  | "provider-network"
  | "provider-response"
  | "provider-timeout"
  | "invalid-estimate";

export class MealEstimateError extends Error {
  readonly reason: MealEstimateFailureReason;
  readonly statusCode: number | undefined;
  readonly providerMessage: string | undefined;

  constructor(
    reason: MealEstimateFailureReason,
    message: string,
    options: {
      statusCode?: number | undefined;
      providerMessage?: string | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "MealEstimateError";
    this.reason = reason;
    this.statusCode = options.statusCode;
    this.providerMessage = options.providerMessage;

    if (options.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        configurable: true,
      });
    }
  }
}

export type MealEstimateFailureDetails = Readonly<{
  status: 502 | 504;
  message: string;
  log: Readonly<{
    reason: MealEstimateFailureReason | "unknown";
    providerStatus?: number | undefined;
    providerMessage?: string | undefined;
  }>;
}>;

type OpenRouterContentPart =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{
      type: "image_url";
      image_url: Readonly<{ url: string }>;
    }>;

type OpenRouterMessage = Readonly<{
  role: "system" | "user";
  content: string | readonly OpenRouterContentPart[];
}>;

type OpenRouterResponseFormat = Readonly<{
  type: "json_schema";
  json_schema: Readonly<{
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  }>;
}>;

const openRouterChatEndpoint = "https://openrouter.ai/api/v1/chat/completions";
export const defaultOpenRouterModel = "openai/gpt-4.1-mini";
export const defaultOpenRouterVisionModel = "openai/gpt-4.1-mini";
export const defaultOpenRouterFallbackModel = "openrouter/free";
const defaultOpenRouterAppName = "Fitness Coach";
const defaultTimeoutMs = 20_000;
const defaultMaxTokens = 600;
const maxDescriptionChars = 2_000;
const maxNoteChars = 1_000;
const maxSummaryChars = 240;
const maxIngredientNameChars = 80;
const maxIngredientUnitChars = 24;
const maxIngredients = 12;
const maxProviderMessageChars = 180;

export function createOpenRouterMealEstimator(
  config: OpenRouterMealEstimatorConfig,
): MealNutritionEstimator {
  const fetcher = config.fetch ?? fetch;
  const endpoint = config.endpoint ?? openRouterChatEndpoint;
  const model = config.model ?? defaultOpenRouterModel;
  const visionModel = config.visionModel ?? defaultOpenRouterVisionModel;
  const fallbackModel = config.fallbackModel ?? defaultOpenRouterFallbackModel;
  const timeoutMs = config.timeoutMs ?? defaultTimeoutMs;
  const maxTokens = config.maxTokens ?? defaultMaxTokens;

  return {
    async estimate(input) {
      const requestModel =
        (input.photos?.length ?? 0) > 0 ? visionModel : model;
      const models = modelAttempts(requestModel, fallbackModel);
      let lastError: unknown;

      for (const candidateModel of models) {
        try {
          const response = await postOpenRouterChatCompletion({
            apiKey: config.apiKey,
            appName: config.appName ?? defaultOpenRouterAppName,
            endpoint,
            fetcher,
            maxTokens,
            messages: buildMealEstimateMessages(input),
            model: candidateModel,
            siteUrl: config.siteUrl,
            timeoutMs,
          });
          const parsed = extractOpenRouterText(response);
          const estimate = parseMealEstimateJson(parsed.text);

          return {
            ...estimate,
            provider: "openrouter",
            model: parsed.model ?? candidateModel,
          };
        } catch (error) {
          lastError = error;

          if (!shouldRetryMealEstimate(error)) {
            throw error;
          }
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new MealEstimateError("invalid-estimate", "Meal estimate failed.");
    },
  };
}

export function mealEstimateFailureDetails(
  error: unknown,
): MealEstimateFailureDetails {
  if (error instanceof MealEstimateError) {
    if (error.reason === "provider-timeout") {
      return {
        status: 504,
        message: "Meal estimation timed out. Try again in a moment.",
        log: { reason: error.reason },
      };
    }

    if (error.reason === "provider-http") {
      const providerMessage = error.providerMessage;
      return {
        status: 502,
        message: providerHttpFailureMessage(error.statusCode, providerMessage),
        log: {
          reason: error.reason,
          providerStatus: error.statusCode,
          ...(providerMessage === undefined ? {} : { providerMessage }),
        },
      };
    }

    if (error.reason === "provider-network") {
      return {
        status: 502,
        message: "Meal estimation provider could not be reached.",
        log: { reason: error.reason },
      };
    }

    return {
      status: 502,
      message: "Meal estimation provider returned an unusable estimate.",
      log: {
        reason: error.reason,
        providerStatus: error.statusCode,
      },
    };
  }

  return {
    status: 502,
    message: "Meal estimation failed.",
    log: { reason: "unknown" },
  };
}

export function resolveMealNutritionEstimator(
  config: MealEstimatorRuntimeConfig = {},
): MealNutritionEstimator | undefined {
  const apiKey = config.apiKey ?? envString("OPENROUTER_API_KEY");

  if (apiKey === undefined) {
    return undefined;
  }

  const siteUrl =
    config.siteUrl ??
    envString("OPENROUTER_SITE_URL") ??
    externalOriginFromEnv();

  return createOpenRouterMealEstimator({
    apiKey,
    model:
      config.model ??
      envString("MEAL_ESTIMATION_MODEL") ??
      defaultOpenRouterModel,
    visionModel:
      config.visionModel ??
      envString("MEAL_ESTIMATION_VISION_MODEL") ??
      envString("OPENROUTER_VISION_MODEL") ??
      defaultOpenRouterVisionModel,
    fallbackModel:
      config.fallbackModel ??
      envString("MEAL_ESTIMATION_FALLBACK_MODEL") ??
      defaultOpenRouterFallbackModel,
    appName:
      config.appName ??
      envString("MEAL_ESTIMATION_APP_NAME") ??
      envString("OPENROUTER_APP_NAME") ??
      defaultOpenRouterAppName,
    ...(siteUrl === undefined ? {} : { siteUrl }),
  });
}

function buildMealEstimateMessages(
  input: MealEstimateInput,
): readonly OpenRouterMessage[] {
  const note = input.note?.trim();
  const photos = input.photos ?? [];
  const text = [
    `Meal type: ${truncate(input.mealType, 100)}`,
    "",
    "User meal description:",
    truncate(input.description, maxDescriptionChars),
    ...(note === undefined || note.length === 0
      ? []
      : ["", "User notes:", truncate(note, maxNoteChars)]),
    "",
    `Attached photos: ${photos.length}`,
    "",
    "Return only JSON with keys: calories, proteinGrams, carbsGrams, fatGrams, fiberGrams, confidence, summary, ingredients.",
    "ingredients must be an array of foods in the meal. Each ingredient must have keys: name, quantity, unit, grams, calories, proteinGrams, carbsGrams, fatGrams, fiberGrams.",
    'Example ingredient: {"name":"cooked rice","quantity":1,"unit":"cup","grams":158,"calories":205,"proteinGrams":4.3,"carbsGrams":44.5,"fatGrams":0.4,"fiberGrams":0.6}.',
    'For "טונה בשמן 100ג" or "tuna in oil 100g", treat the amount as drained edible canned tuna in oil unless the user explicitly says the oil was eaten too; a typical estimate is about 195 kcal, 26g protein, 0g carbs, and 10g fat per 100g drained.',
    "All nutrition values must be numbers. confidence must be a number from 0 to 1. summary must be a short string.",
  ].join("\n");
  const content: OpenRouterMessage["content"] =
    photos.length === 0
      ? text
      : [
          {
            type: "text",
            text,
          },
          ...photos.map((photo) => ({
            type: "image_url" as const,
            image_url: {
              url: `data:${photo.mediaType};base64,${photo.base64}`,
            },
          })),
        ];

  return [
    {
      role: "system",
      content: [
        "You estimate nutrition for a private food log.",
        "Use the user's language when writing the short summary.",
        "Estimate calories and macros realistically from text and optional photos.",
        "If the item is ambiguous, make a conservative estimate and lower confidence.",
        "For canned foods in oil or water, estimate the drained edible portion unless the user explicitly includes the liquid or oil.",
        "Do not give medical advice. Do not moralize food choices.",
        "Return only one valid compact JSON object. No markdown. No explanation.",
        "Use numeric values only for calories, proteinGrams, carbsGrams, fatGrams, fiberGrams, and confidence.",
      ].join(" "),
    },
    {
      role: "user",
      content,
    },
  ];
}

async function postOpenRouterChatCompletion(input: {
  apiKey: string;
  appName: string;
  endpoint: string;
  fetcher: MealEstimateFetch;
  maxTokens: number;
  messages: readonly OpenRouterMessage[];
  model: string;
  siteUrl: string | undefined;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs);
  const headers: Record<string, string> = {
    authorization: `Bearer ${input.apiKey}`,
    "content-type": "application/json",
    "x-openrouter-title": input.appName,
  };

  if (input.siteUrl !== undefined && input.siteUrl.length > 0) {
    headers["http-referer"] = input.siteUrl;
  }

  try {
    const response = await input.fetcher(input.endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: 0.2,
        max_tokens: input.maxTokens,
        response_format: mealEstimateResponseFormat,
        provider: {
          require_parameters: true,
        },
      }),
    });

    if (!response.ok) {
      const providerMessage = await providerErrorMessage(response);
      throw new MealEstimateError(
        "provider-http",
        "OpenRouter meal estimate failed.",
        { statusCode: response.status, providerMessage },
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new MealEstimateError(
        "provider-response",
        "OpenRouter meal estimate response was not valid JSON.",
        { cause: error },
      );
    }
  } catch (error) {
    if (error instanceof MealEstimateError) {
      throw error;
    }

    if (isAbortError(error)) {
      throw new MealEstimateError(
        "provider-timeout",
        "OpenRouter meal estimate timed out.",
        { cause: error },
      );
    }

    throw new MealEstimateError(
      "provider-network",
      "OpenRouter meal estimate request failed.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

const nutritionNumberSchema = {
  type: "number",
  minimum: 0,
} as const;

const mealEstimateResponseFormat: OpenRouterResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "meal_estimate",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        calories: {
          ...nutritionNumberSchema,
          maximum: 5_000,
          description: "Estimated total calories in kcal.",
        },
        proteinGrams: {
          ...nutritionNumberSchema,
          maximum: 400,
          description: "Estimated total protein in grams.",
        },
        carbsGrams: {
          ...nutritionNumberSchema,
          maximum: 700,
          description: "Estimated total carbohydrates in grams.",
        },
        fatGrams: {
          ...nutritionNumberSchema,
          maximum: 300,
          description: "Estimated total fat in grams.",
        },
        fiberGrams: {
          ...nutritionNumberSchema,
          maximum: 150,
          description: "Estimated total fiber in grams.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Confidence in the nutrition estimate from 0 to 1.",
        },
        summary: {
          type: "string",
          maxLength: maxSummaryChars,
          description: "Short user-facing summary in the user's language.",
        },
        ingredients: {
          type: "array",
          maxItems: maxIngredients,
          description: "Per-food ingredient estimates for later portion edits.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: {
                type: "string",
                maxLength: maxIngredientNameChars,
              },
              quantity: {
                ...nutritionNumberSchema,
                maximum: 10_000,
              },
              unit: {
                type: "string",
                maxLength: maxIngredientUnitChars,
              },
              grams: {
                ...nutritionNumberSchema,
                maximum: 100_000,
              },
              calories: {
                ...nutritionNumberSchema,
                maximum: 5_000,
              },
              proteinGrams: {
                ...nutritionNumberSchema,
                maximum: 400,
              },
              carbsGrams: {
                ...nutritionNumberSchema,
                maximum: 700,
              },
              fatGrams: {
                ...nutritionNumberSchema,
                maximum: 300,
              },
              fiberGrams: {
                ...nutritionNumberSchema,
                maximum: 150,
              },
            },
            required: [
              "name",
              "quantity",
              "unit",
              "grams",
              "calories",
              "proteinGrams",
              "carbsGrams",
              "fatGrams",
              "fiberGrams",
            ],
          },
        },
      },
      required: [
        "calories",
        "proteinGrams",
        "carbsGrams",
        "fatGrams",
        "fiberGrams",
        "confidence",
        "summary",
        "ingredients",
      ],
    },
  },
};

function providerHttpFailureMessage(
  statusCode: number | undefined,
  providerMessage: string | undefined,
): string {
  const statusText = statusCode === undefined ? "" : ` (HTTP ${statusCode})`;
  const providerText =
    providerMessage === undefined
      ? ""
      : `: ${providerMessage.replace(/[.!?]+$/u, "")}`;

  return `Meal estimation provider failed${statusText}${providerText}.`;
}

async function providerErrorMessage(
  response: MealEstimateFetchResponse,
): Promise<string | undefined> {
  try {
    return sanitizeProviderErrorMessage(await response.text());
  } catch {
    return undefined;
  }
}

function sanitizeProviderErrorMessage(text: string): string | undefined {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = parseProviderErrorJson(trimmed);
  const candidate =
    providerErrorString(parsed) ??
    (trimmed.startsWith("{") || trimmed.startsWith("[") ? undefined : trimmed);
  const normalized = candidate?.replace(/\s+/gu, " ").trim();

  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  if (normalized.includes("User meal description:")) {
    return undefined;
  }

  return truncate(normalized, maxProviderMessageChars);
}

function parseProviderErrorJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function providerErrorString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const error = value.error;
  if (typeof error === "string") {
    return error;
  }

  if (isRecord(error)) {
    return firstString(error.message, error.detail, error.reason, error.code);
  }

  return firstString(value.message, value.detail, value.reason);
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function extractOpenRouterText(response: unknown): {
  text: string;
  model?: string;
} {
  if (!isRecord(response)) {
    throw new MealEstimateError(
      "provider-response",
      "OpenRouter response was not an object.",
    );
  }

  const choices = response.choices;

  if (!Array.isArray(choices)) {
    throw new MealEstimateError(
      "provider-response",
      "OpenRouter response did not include choices.",
    );
  }

  const firstChoice = choices[0];

  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new MealEstimateError(
      "provider-response",
      "OpenRouter response did not include a message.",
    );
  }

  const content = firstChoice.message.content;
  const text = typeof content === "string" ? content.trim() : "";

  if (text.length === 0) {
    throw new MealEstimateError(
      "provider-response",
      "OpenRouter response text was empty.",
    );
  }

  return {
    text,
    ...(typeof response.model === "string" ? { model: response.model } : {}),
  };
}

function parseMealEstimateJson(
  text: string,
): Omit<MealEstimateResult, "provider" | "model"> {
  const parsed = parseJsonObject(stripJsonFence(text));
  const rawTotals = isRecord(parsed.totals) ? parsed.totals : parsed;
  const ingredients = parseIngredients(parsed.ingredients);
  const confidence = nutritionNumber(
    valueFrom(parsed, "confidence"),
    "confidence",
    0,
    100,
  );
  const totals = {
    calories: nutritionNumber(
      valueFrom(rawTotals, "calories", "kcal"),
      "calories",
      0,
      5_000,
    ),
    proteinGrams: nutritionNumber(
      valueFrom(rawTotals, "proteinGrams", "protein", "protein_grams"),
      "proteinGrams",
      0,
      400,
    ),
    carbsGrams: nutritionNumber(
      valueFrom(rawTotals, "carbsGrams", "carbs", "carbohydrates"),
      "carbsGrams",
      0,
      700,
    ),
    fatGrams: nutritionNumber(
      valueFrom(rawTotals, "fatGrams", "fat", "fat_grams"),
      "fatGrams",
      0,
      300,
    ),
    fiberGrams: nutritionNumber(
      valueFrom(rawTotals, "fiberGrams", "fiber", "fiber_grams"),
      "fiberGrams",
      0,
      150,
    ),
  };

  assertUsableTotals(totals);

  return {
    totals,
    ingredients,
    confidence: confidence > 1 ? Math.round(confidence) / 100 : confidence,
    summary: truncate(
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : "Estimated from meal description.",
      maxSummaryChars,
    ),
  };
}

function parseIngredients(
  value: unknown,
): readonly MealEstimateIngredientResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, maxIngredients)
    .flatMap((ingredient): MealEstimateIngredientResult[] => {
      if (!isRecord(ingredient)) {
        return [];
      }

      const name = normalizedIngredientString(
        ingredient.name,
        maxIngredientNameChars,
      );
      const unit = normalizedIngredientString(
        ingredient.unit,
        maxIngredientUnitChars,
      );
      const quantity = optionalNutritionNumber(
        valueFrom(ingredient, "quantity", "amount"),
        0,
        10_000,
      );
      const grams = optionalNutritionNumber(ingredient.grams, 0, 100_000);
      const totals = isRecord(ingredient.totals)
        ? ingredient.totals
        : ingredient;

      if (name === undefined || unit === undefined || quantity === undefined) {
        return [];
      }

      try {
        const parsed: MealEstimateIngredientResult = {
          name,
          quantity,
          unit,
          ...(grams === undefined ? {} : { grams }),
          totals: {
            calories: nutritionNumber(
              valueFrom(totals, "calories", "kcal"),
              "ingredient.calories",
              0,
              5_000,
            ),
            proteinGrams: nutritionNumber(
              valueFrom(totals, "proteinGrams", "protein", "protein_grams"),
              "ingredient.proteinGrams",
              0,
              400,
            ),
            carbsGrams: nutritionNumber(
              valueFrom(totals, "carbsGrams", "carbs", "carbohydrates"),
              "ingredient.carbsGrams",
              0,
              700,
            ),
            fatGrams: nutritionNumber(
              valueFrom(totals, "fatGrams", "fat", "fat_grams"),
              "ingredient.fatGrams",
              0,
              300,
            ),
            fiberGrams: nutritionNumber(
              valueFrom(totals, "fiberGrams", "fiber", "fiber_grams"),
              "ingredient.fiberGrams",
              0,
              150,
            ),
          },
        };

        return [parsed];
      } catch {
        return [];
      }
    });
}

function parseJsonObject(text: string): Record<string, unknown> {
  let value: unknown;

  try {
    value = JSON.parse(extractJsonObjectText(text)) as unknown;
  } catch (error) {
    throw new MealEstimateError(
      "invalid-estimate",
      "Meal estimate text was not valid JSON.",
      { cause: error },
    );
  }

  if (!isRecord(value)) {
    throw new MealEstimateError(
      "invalid-estimate",
      "Meal estimate JSON was not an object.",
    );
  }

  return value;
}

function extractJsonObjectText(text: string): string {
  const trimmed = text.trim();

  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);

  return match?.[1]?.trim() ?? trimmed;
}

function nutritionNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  const numeric = numericValue(value);

  if (numeric === undefined || !Number.isFinite(numeric)) {
    throw new MealEstimateError(
      "invalid-estimate",
      `Meal estimate ${name} must be a finite number.`,
    );
  }

  if (numeric < min || numeric > max) {
    throw new MealEstimateError(
      "invalid-estimate",
      `Meal estimate ${name} is outside the accepted range.`,
    );
  }

  return Math.round(numeric * 10) / 10;
}

function optionalNutritionNumber(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numeric = numericValue(value);

  if (numeric === undefined || !Number.isFinite(numeric)) {
    return undefined;
  }

  if (numeric < min || numeric > max) {
    return undefined;
  }

  return Math.round(numeric * 10) / 10;
}

function assertUsableTotals(totals: MealEstimateResult["totals"]): void {
  const totalNutrition =
    totals.calories +
    totals.proteinGrams +
    totals.carbsGrams +
    totals.fatGrams +
    totals.fiberGrams;

  if (totalNutrition > 0) {
    return;
  }

  throw new MealEstimateError(
    "invalid-estimate",
    "Meal estimate nutrition totals cannot all be zero.",
  );
}

function normalizedIngredientString(
  value: unknown,
  maxChars: number,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  return truncate(trimmed, maxChars);
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().replace(",", ".");

  if (!/^[+-]?\d+(?:\.\d+)?$/u.test(normalized)) {
    return undefined;
  }

  return Number.parseFloat(normalized);
}

function modelAttempts(
  requestModel: string,
  fallbackModel: string,
): readonly string[] {
  const models = [requestModel, fallbackModel].filter(
    (model) => model.length > 0,
  );

  if (
    models.length === 2 &&
    requestModel === fallbackModel &&
    isOpenRouterRouterModel(requestModel)
  ) {
    return models;
  }

  return [...new Set(models)];
}

function isOpenRouterRouterModel(model: string): boolean {
  return model.startsWith("openrouter/");
}

function shouldRetryMealEstimate(error: unknown): boolean {
  if (!(error instanceof MealEstimateError)) {
    return false;
  }

  return !(
    error.reason === "provider-http" &&
    (error.statusCode === 401 || error.statusCode === 403)
  );
}

function valueFrom(
  record: Record<string, unknown>,
  ...keys: readonly string[]
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }

  return undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function externalOriginFromEnv(): string | undefined {
  return (
    originFromUrl(envString("FITNESS_EXTERNAL_URL")) ??
    originFromUrl(envString("RENDER_EXTERNAL_URL")) ??
    originFromVercelDomain(envString("VERCEL_PROJECT_PRODUCTION_URL")) ??
    originFromVercelDomain(envString("VERCEL_BRANCH_URL")) ??
    originFromVercelDomain(envString("VERCEL_URL"))
  );
}

function originFromUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function originFromVercelDomain(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return originFromUrl(value.includes("://") ? value : `https://${value}`);
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 20)}\n[truncated]`;
}

function envString(name: string): string | undefined {
  const value = (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

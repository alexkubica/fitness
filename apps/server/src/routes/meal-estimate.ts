import type { Hono } from "hono";
import type { ServerEnv } from "../auth.js";
import type { AuditPort } from "../services/audit.js";
import type {
  MealEstimateInput,
  MealEstimatePhotoInput,
  MealNutritionEstimator,
} from "../services/meal-estimate.js";
import { mealEstimateFailureDetails } from "../services/meal-estimate.js";

export type MealEstimateRouteServices = Readonly<{
  audit: AuditPort;
  mealEstimator?: MealNutritionEstimator | undefined;
}>;

type ValidationError = Readonly<{
  ok: false;
  error: "invalid-payload" | "payload-too-large";
  message: string;
  status: 400 | 413;
}>;

type ValidationResult<T> = Readonly<{ ok: true; value: T }> | ValidationError;

type JsonRequest = Readonly<{
  json(): Promise<unknown>;
}>;

const maxDescriptionChars = 2_000;
const maxNoteChars = 1_000;
const maxMealTypeChars = 100;
const maxPhotoCount = 6;
const maxPhotoBase64Chars = 2_500_000;

export function registerMealEstimateRoutes(
  app: Hono<ServerEnv>,
  services: MealEstimateRouteServices,
): void {
  app.post("/api/meals/estimate", async (context) => {
    const auth = context.get("auth");

    if (!auth.scopes.includes("meal:write")) {
      return context.json({ error: "missing-scope" }, 403);
    }

    if (services.mealEstimator === undefined) {
      return context.json(
        {
          error: "not-configured",
          message: "Meal estimation is not configured.",
        },
        503,
      );
    }

    const payloadResult = await parseMealEstimateRequest(context.req);

    if (payloadResult.ok === false) {
      const error = payloadResult;

      return context.json(
        { error: error.error, message: error.message },
        error.status,
      );
    }

    const payload = payloadResult.value;

    try {
      const estimate = await services.mealEstimator.estimate({
        ...payload,
        userId: auth.userId,
      });

      await services.audit.create({
        action: "meal.estimate",
        actor: auth.actor,
        target: {
          type: "meal_estimate",
          id: "adhoc",
        },
        userId: auth.userId,
        metadata: {
          photoCount: payload.photos?.length ?? 0,
          calories: estimate.totals.calories,
          confidence: estimate.confidence,
          provider: estimate.provider,
          model: estimate.model,
        },
      });

      return context.json(estimate);
    } catch (error) {
      const failure = mealEstimateFailureDetails(error);

      console.warn("meal_estimate_failed", failure.log);

      return context.json(
        {
          error: "estimation-failed",
          message: failure.message,
        },
        failure.status,
      );
    }
  });
}

async function parseMealEstimateRequest(
  request: JsonRequest,
): Promise<ValidationResult<Omit<MealEstimateInput, "userId">>> {
  try {
    return parseMealEstimatePayload(await request.json());
  } catch {
    return invalid("Request body must be valid JSON.");
  }
}

function parseMealEstimatePayload(
  value: unknown,
): ValidationResult<Omit<MealEstimateInput, "userId">> {
  if (!isRecord(value)) {
    return invalid("Payload must be an object.");
  }

  const mealType = boundedString(value.mealType, "Meal", maxMealTypeChars);
  const description = boundedRequiredString(
    value.description,
    "description",
    maxDescriptionChars,
  );
  const note = boundedOptionalString(value.note, "note", maxNoteChars);
  const photos = parsePhotos(value.photos);

  if (mealType.ok === false) {
    return mealType;
  }

  if (description.ok === false) {
    return description;
  }

  if (note.ok === false) {
    return note;
  }

  if (photos.ok === false) {
    return photos;
  }

  return {
    ok: true,
    value: {
      mealType: mealType.value,
      description: description.value,
      ...(note.value === undefined ? {} : { note: note.value }),
      ...(photos.value.length === 0 ? {} : { photos: photos.value }),
    },
  };
}

function parsePhotos(
  value: unknown,
): ValidationResult<readonly MealEstimatePhotoInput[]> {
  if (value === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return invalid("Payload photos must be an array.");
  }

  if (value.length > maxPhotoCount) {
    return payloadTooLarge(`At most ${maxPhotoCount} photos can be estimated.`);
  }

  const photos: MealEstimatePhotoInput[] = [];

  for (const photo of value) {
    if (!isRecord(photo)) {
      return invalid("Each photo must be an object.");
    }

    const mediaType = photo.mediaType;
    const base64 = photo.base64;

    if (
      mediaType !== "image/jpeg" &&
      mediaType !== "image/png" &&
      mediaType !== "image/webp"
    ) {
      return invalid(
        "Each photo mediaType must be image/jpeg, image/png, or image/webp.",
      );
    }

    if (
      typeof base64 !== "string" ||
      base64.length === 0 ||
      base64.length > maxPhotoBase64Chars ||
      !/^[A-Za-z0-9+/=]+$/u.test(base64)
    ) {
      return invalid("Each photo base64 payload is invalid.");
    }

    photos.push({
      mediaType,
      base64,
    });
  }

  return {
    ok: true,
    value: photos,
  };
}

function boundedRequiredString(
  value: unknown,
  name: string,
  maxChars: number,
): ValidationResult<string> {
  if (typeof value !== "string") {
    return invalid(`Payload ${name} is required.`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return invalid(`Payload ${name} is required.`);
  }

  if (trimmed.length > maxChars) {
    return invalid(`Payload ${name} must be at most ${maxChars} characters.`);
  }

  return {
    ok: true,
    value: trimmed,
  };
}

function boundedOptionalString(
  value: unknown,
  name: string,
  maxChars: number,
): ValidationResult<string | undefined> {
  if (value === undefined) {
    return {
      ok: true,
      value: undefined,
    };
  }

  if (typeof value !== "string") {
    return invalid(`Payload ${name} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxChars) {
    return invalid(`Payload ${name} must be at most ${maxChars} characters.`);
  }

  return {
    ok: true,
    value: trimmed.length === 0 ? undefined : trimmed,
  };
}

function boundedString(
  value: unknown,
  fallback: string,
  maxChars: number,
): ValidationResult<string> {
  if (value === undefined) {
    return {
      ok: true,
      value: fallback,
    };
  }

  if (typeof value !== "string") {
    return invalid("Payload mealType must be a string.");
  }

  const trimmed = value.trim();

  if (trimmed.length > maxChars) {
    return invalid(`Payload mealType must be at most ${maxChars} characters.`);
  }

  return {
    ok: true,
    value: trimmed.length === 0 ? fallback : trimmed,
  };
}

function invalid(message: string): ValidationError {
  return {
    ok: false,
    error: "invalid-payload",
    message,
    status: 400,
  };
}

function payloadTooLarge(message: string): ValidationError {
  return {
    ok: false,
    error: "payload-too-large",
    message,
    status: 413,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

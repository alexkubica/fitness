import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MealEstimateError,
  createOpenRouterMealEstimator,
  defaultOpenRouterFallbackModel,
  defaultOpenRouterModel,
  defaultOpenRouterVisionModel,
  mealEstimateFailureDetails,
  resolveMealNutritionEstimator,
  type MealEstimateFetch,
} from "./meal-estimate.js";

type CapturedRequest = Readonly<{
  url: string;
  body: Record<string, unknown>;
  headers: Readonly<Record<string, string>>;
}>;

function createCapturingFetch(
  content: string,
  model = "openrouter/returned-model",
): { fetcher: MealEstimateFetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetcher: MealEstimateFetch = async (url, init) => {
    requests.push({
      url,
      body: JSON.parse(init.body) as Record<string, unknown>,
      headers: init.headers,
    });

    return {
      ok: true,
      status: 200,
      async json() {
        return {
          model,
          choices: [
            {
              message: {
                content,
              },
            },
          ],
        };
      },
      async text() {
        return "";
      },
    };
  };

  return { fetcher, requests };
}

describe("OpenRouter meal estimator", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the meal model default instead of the shared Telegram model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
    const { fetcher, requests } = createCapturingFetch(
      JSON.stringify({
        calories: 190,
        proteinGrams: 30,
        carbsGrams: 8.5,
        fatGrams: 3.8,
        fiberGrams: 0,
        ingredients: [],
        confidence: 0.9,
        summary: "גבינה לבנה 5 אחוז - 250ג",
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    const estimator = resolveMealNutritionEstimator();

    await estimator?.estimate({
      userId: "user_alex",
      mealType: "Breakfast",
      description: "גבינה לבנה 250ג 5 אחוז",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toMatchObject({
      model: defaultOpenRouterModel,
      response_format: {
        type: "json_schema",
      },
      provider: {
        require_parameters: true,
      },
    });
  });

  it("uses the dedicated vision-capable meal model when photos are attached", async () => {
    const { fetcher, requests } = createCapturingFetch(
      JSON.stringify({
        calories: 320,
        proteinGrams: 22,
        carbsGrams: 34,
        fatGrams: 11,
        fiberGrams: 4,
        ingredients: [],
        confidence: 0.72,
        summary: "Toast and eggs",
      }),
    );
    const estimator = createOpenRouterMealEstimator({
      apiKey: "sk-or-test",
      fetch: fetcher,
    });

    await estimator.estimate({
      userId: "user_alex",
      mealType: "Breakfast",
      description: "plate",
      photos: [
        {
          mediaType: "image/jpeg",
          base64: "abcd",
        },
      ],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toMatchObject({
      model: defaultOpenRouterVisionModel,
    });
    expect(
      JSON.stringify(requests[0]?.body).includes("data:image/jpeg;base64,abcd"),
    ).toBe(true);
  });

  it("accepts fenced JSON with nested totals and numeric strings", async () => {
    const { fetcher } = createCapturingFetch(`
\`\`\`json
{
  "totals": {
    "calories": "190",
    "protein": "30",
    "carbs": "8.5",
    "fat": "3.8",
    "fiber": "0"
  },
  "confidence": "90",
  "summary": "גבינה לבנה 5 אחוז - 250ג"
}
\`\`\`
`);
    const estimator = createOpenRouterMealEstimator({
      apiKey: "sk-or-test",
      fetch: fetcher,
    });

    const estimate = await estimator.estimate({
      userId: "user_alex",
      mealType: "Breakfast",
      description: "גבינה לבנה 250ג 5 אחוז",
    });

    expect(estimate).toMatchObject({
      totals: {
        calories: 190,
        proteinGrams: 30,
        carbsGrams: 8.5,
        fatGrams: 3.8,
        fiberGrams: 0,
      },
      confidence: 0.9,
      ingredients: [],
      summary: "גבינה לבנה 5 אחוז - 250ג",
    });
  });

  it("parses ingredient breakdowns for local portion adjustments", async () => {
    const { fetcher } = createCapturingFetch(
      JSON.stringify({
        calories: 470,
        proteinGrams: 49,
        carbsGrams: 45,
        fatGrams: 6,
        fiberGrams: 1,
        confidence: 0.86,
        summary: "Rice and chicken breast.",
        ingredients: [
          {
            name: "cooked rice",
            quantity: 1,
            unit: "cup",
            grams: 158,
            calories: 205,
            proteinGrams: 4.3,
            carbsGrams: 44.5,
            fatGrams: 0.4,
            fiberGrams: 0.6,
          },
          {
            name: "cooked chicken breast",
            quantity: "150",
            unit: "g",
            grams: 150,
            calories: 248,
            proteinGrams: 46.5,
            carbsGrams: 0,
            fatGrams: 5.4,
            fiberGrams: 0,
          },
        ],
      }),
    );
    const estimator = createOpenRouterMealEstimator({
      apiKey: "sk-or-test",
      fetch: fetcher,
    });

    const estimate = await estimator.estimate({
      userId: "user_alex",
      mealType: "Lunch",
      description: "אורז וחזה עוף",
    });

    expect(estimate.ingredients).toEqual([
      {
        name: "cooked rice",
        quantity: 1,
        unit: "cup",
        grams: 158,
        totals: {
          calories: 205,
          proteinGrams: 4.3,
          carbsGrams: 44.5,
          fatGrams: 0.4,
          fiberGrams: 0.6,
        },
      },
      {
        name: "cooked chicken breast",
        quantity: 150,
        unit: "g",
        grams: 150,
        totals: {
          calories: 248,
          proteinGrams: 46.5,
          carbsGrams: 0,
          fatGrams: 5.4,
          fiberGrams: 0,
        },
      },
    ]);
  });

  it("sends drained canned tuna guidance to the provider", async () => {
    const { fetcher, requests } = createCapturingFetch(
      JSON.stringify({
        calories: 195,
        proteinGrams: 26,
        carbsGrams: 0,
        fatGrams: 10,
        fiberGrams: 0,
        ingredients: [],
        confidence: 0.9,
        summary: "טונה בשמן 100ג לאחר סינון.",
      }),
    );
    const estimator = createOpenRouterMealEstimator({
      apiKey: "sk-or-test",
      fetch: fetcher,
    });

    await estimator.estimate({
      userId: "user_alex",
      mealType: "Lunch",
      description: "טונה בשמן 100ג",
    });

    expect(JSON.stringify(requests[0]?.body.messages)).toContain(
      "drained edible canned tuna in oil",
    );
  });

  it("falls back to a known free model when the primary model returns unusable output", async () => {
    const requests: CapturedRequest[] = [];
    const fetcher: MealEstimateFetch = async (url, init) => {
      requests.push({
        url,
        body: JSON.parse(init.body) as Record<string, unknown>,
        headers: init.headers,
      });

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            model:
              requests.length === 1
                ? defaultOpenRouterModel
                : defaultOpenRouterFallbackModel,
            choices: [
              {
                message: {
                  content:
                    requests.length === 1
                      ? "I need more context."
                      : JSON.stringify({
                          calories: 190,
                          proteinGrams: 30,
                          carbsGrams: 8.5,
                          fatGrams: 3.8,
                          fiberGrams: 0,
                          ingredients: [],
                          confidence: 0.9,
                          summary: "גבינה לבנה 5 אחוז - 250ג",
                        }),
                },
              },
            ],
          };
        },
        async text() {
          return "";
        },
      };
    };
    const estimator = createOpenRouterMealEstimator({
      apiKey: "sk-or-test",
      fetch: fetcher,
    });

    const estimate = await estimator.estimate({
      userId: "user_alex",
      mealType: "Breakfast",
      description: "גבינה לבנה 250ג 5 אחוז",
    });

    expect(requests.map((request) => request.body.model)).toEqual([
      defaultOpenRouterModel,
      defaultOpenRouterFallbackModel,
    ]);
    expect(estimate.model).toBe(defaultOpenRouterFallbackModel);
    expect(estimate.totals.calories).toBe(190);
  });

  it("rejects all-zero nutrition totals as unusable output", async () => {
    const { fetcher } = createCapturingFetch(
      JSON.stringify({
        calories: 0,
        proteinGrams: 0,
        carbsGrams: 0,
        fatGrams: 0,
        fiberGrams: 0,
        ingredients: [
          {
            name: "eggs",
            quantity: 3,
            unit: "large",
            grams: 150,
            calories: 0,
            proteinGrams: 0,
            carbsGrams: 0,
            fatGrams: 0,
            fiberGrams: 0,
          },
        ],
        confidence: 0.9,
        summary: "3 eggs",
      }),
    );
    const estimator = createOpenRouterMealEstimator({
      apiKey: "sk-or-test",
      fetch: fetcher,
      fallbackModel: "",
    });

    await expect(
      estimator.estimate({
        userId: "user_alex",
        mealType: "Breakfast",
        description: "3 eggs",
      }),
    ).rejects.toMatchObject({
      reason: "invalid-estimate",
      message: "Meal estimate nutrition totals cannot all be zero.",
    });
  });

  it("does not retry provider authorization failures", async () => {
    const requests: CapturedRequest[] = [];
    const fetcher: MealEstimateFetch = async (url, init) => {
      requests.push({
        url,
        body: JSON.parse(init.body) as Record<string, unknown>,
        headers: init.headers,
      });

      return {
        ok: false,
        status: 401,
        async json() {
          return {};
        },
        async text() {
          return JSON.stringify({
            error: {
              message: "No endpoints found for model.",
            },
          });
        },
      };
    };
    const estimator = createOpenRouterMealEstimator({
      apiKey: "sk-or-test",
      fetch: fetcher,
    });

    await expect(
      estimator.estimate({
        userId: "user_alex",
        mealType: "Breakfast",
        description: "גבינה לבנה 250ג 5 אחוז",
      }),
    ).rejects.toMatchObject({
      reason: "provider-http",
      statusCode: 401,
      providerMessage: "No endpoints found for model.",
    });
    expect(requests).toHaveLength(1);
  });

  it("maps provider HTTP failures to sanitized API details", async () => {
    const error = new MealEstimateError(
      "provider-http",
      "OpenRouter meal estimate failed.",
      { statusCode: 429, providerMessage: "Rate limit exceeded." },
    );

    expect(mealEstimateFailureDetails(error)).toEqual({
      status: 502,
      message:
        "Meal estimation provider failed (HTTP 429): Rate limit exceeded.",
      log: {
        reason: "provider-http",
        providerStatus: 429,
        providerMessage: "Rate limit exceeded.",
      },
    });
  });
});

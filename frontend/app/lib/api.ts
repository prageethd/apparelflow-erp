export type RecipeComponent = {
  id: number;
  componentName: string;
  piecesPerGarment: number;
};

export type Recipe = {
  id: number;
  recipeCode: string;
  name: string;
  category: string;
  stdFabricYards: number;
  wastageCap: number;
  components: RecipeComponent[];
};

export type ExpectedComponent = {
  componentId: number;
  componentName: string;
  piecesPerGarment: number;
  expectedQty: number;
};

export type CuttingOrder = {
  id: number;
  orderNo: string;
  recipeId: number;
  targetQty: number;
  fabricRollId: string;
  actualFabricYds: number;
  expectedFabricYds: number | null;
  wastagePct: number | null;
  status: string;
  createdById: number;
  createdAt: string;
  updatedAt: string;
  recipe: Pick<Recipe, "id" | "recipeCode" | "name" | "category" | "stdFabricYards" | "wastageCap">;
  createdBy: {
    id: number;
    email: string;
    fullName: string;
    role: string;
  };
  expectedComponents: ExpectedComponent[];
};

export type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  message?: string;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").replace(/\/+$/, "");

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Could not reach the ApparelFlow API. Check your connection and API configuration.", 0);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}
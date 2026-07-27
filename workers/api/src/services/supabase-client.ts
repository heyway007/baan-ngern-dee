import type { AuthSession } from "../middleware/auth";
import { ApiError } from "../api-error";

type SupabaseErrorBody = Readonly<{
  code?: string;
  message?: string;
}>;

export type SupabaseConfig = Readonly<{
  url: string;
  anonKey: string;
  fetch?: typeof fetch;
}>;

function apiError(
  status: number,
  body: SupabaseErrorBody
): ApiError {
  if (status === 401) {
    return new ApiError(
      "UNAUTHENTICATED",
      401,
      "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"
    );
  }
  if (body.code === "40001") {
    return new ApiError(
      "STALE_VERSION",
      409,
      "ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่"
    );
  }
  if (
    body.code === "22000" &&
    body.message?.includes("insufficient balance")
  ) {
    return new ApiError(
      "INSUFFICIENT_BALANCE",
      409,
      "ยอดเงินในบัญชีไม่เพียงพอ"
    );
  }
  if (body.code === "23505") {
    if (body.message?.includes("private workspace")) {
      return new ApiError(
        "PRIVATE_WORKSPACE_EXISTS",
        409,
        "มีพื้นที่ส่วนตัวที่ใช้งานอยู่แล้ว"
      );
    }
    return new ApiError(
      "CATEGORY_NAME_EXISTS",
      409,
      body.message ?? "ข้อมูลนี้มีอยู่แล้ว"
    );
  }
  if (status === 403 || body.code === "42501") {
    return new ApiError(
      "FORBIDDEN_WORKSPACE",
      403,
      "ไม่มีสิทธิ์เข้าถึงพื้นที่นี้"
    );
  }
  if (body.code?.startsWith("22")) {
    return new ApiError(
      "VALIDATION_FAILED",
      400,
      body.message ?? "ข้อมูลไม่ถูกต้อง"
    );
  }
  return new ApiError(
    "INTERNAL_ERROR",
    500,
    body.message ?? "Supabase request failed"
  );
}

export class SupabaseRestClient {
  private readonly requestFetch: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly config: SupabaseConfig) {
    this.requestFetch = config.fetch ?? fetch;
    this.baseUrl = config.url.replace(/\/+$/, "");
  }

  async request<T>(
    actor: AuthSession,
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const response = await this.requestFetch(
      `${this.baseUrl}/rest/v1/${path}`,
      {
        ...init,
        headers: {
          apikey: this.config.anonKey,
          authorization: `Bearer ${actor.accessToken}`,
          "content-type": "application/json",
          ...init.headers
        }
      }
    );
    if (!response.ok) {
      const body = await response.json<SupabaseErrorBody>()
        .catch(() => ({}));
      throw apiError(response.status, body);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json<T>();
  }

  rpc<T>(
    actor: AuthSession,
    functionName: string,
    parameters: Record<string, unknown>
  ): Promise<T> {
    return this.request<T>(actor, `rpc/${functionName}`, {
      method: "POST",
      body: JSON.stringify(parameters)
    });
  }
}

export function createSupabaseAuthVerifier(config: SupabaseConfig) {
  const requestFetch = config.fetch ?? fetch;
  const baseUrl = config.url.replace(/\/+$/, "");

  return {
    async verify(accessToken: string) {
      const response = await requestFetch(`${baseUrl}/auth/v1/user`, {
        headers: {
          apikey: config.anonKey,
          authorization: `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        return null;
      }
      const user = await response.json<{ id?: string }>();
      return user.id ? { userId: user.id } : null;
    }
  };
}

import type { ApiErrorCode } from "@systems-credit/contracts";

export type ApiErrorLogContext = Readonly<{
  slipVisionCategory?:
    | "provider"
    | "empty_answer"
    | "invalid_json"
    | "invalid_shape";
}>;

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503,
    message: string,
    readonly logContext?: ApiErrorLogContext
  ) {
    super(message);
    this.name = "ApiError";
  }
}

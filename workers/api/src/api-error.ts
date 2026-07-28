import type { ApiErrorCode } from "@systems-credit/contracts";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

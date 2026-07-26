import type { ApiErrorResponse } from "@systems-credit/contracts";
import type { ErrorHandler } from "hono";

import { ApiError } from "../api-error";
import type { AppEnv } from "../types";

export const errorHandler: ErrorHandler<AppEnv> = (error, context) => {
  const requestId = context.get("requestId") ?? crypto.randomUUID();
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(
          "INTERNAL_ERROR",
          500,
          "เกิดข้อผิดพลาดภายในระบบ"
        );

  console.error({
    code: apiError.code,
    method: context.req.method,
    path: new URL(context.req.url).pathname,
    requestId,
    status: apiError.status
  });

  const body: ApiErrorResponse = {
    error: {
      code: apiError.code,
      message: apiError.message,
      requestId
    }
  };

  return context.json(body, apiError.status);
};

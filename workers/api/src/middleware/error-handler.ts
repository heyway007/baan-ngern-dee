import type { ApiErrorResponse } from "@systems-credit/contracts";
import type { ErrorHandler } from "hono";

import type { AppEnv } from "../types";

export const errorHandler: ErrorHandler<AppEnv> = (error, context) => {
  const requestId = context.get("requestId") ?? crypto.randomUUID();

  console.error({
    code: "INTERNAL_ERROR",
    method: context.req.method,
    path: new URL(context.req.url).pathname,
    requestId,
    status: 500
  });

  const body: ApiErrorResponse = {
    error: {
      code: "INTERNAL_ERROR",
      message: "เกิดข้อผิดพลาดภายในระบบ",
      requestId
    }
  };

  return context.json(body, 500);
};

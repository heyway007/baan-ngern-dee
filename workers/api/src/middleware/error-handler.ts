import type { ApiErrorResponse } from "@systems-credit/contracts";
import type { ErrorHandler } from "hono";
import { ZodError } from "zod";

import { ApiError } from "../api-error";
import type { AppEnv } from "../types";

type ValidationIssueLog = Readonly<{
  code: string;
  path: string[];
  expected?: string;
}>;

function validationIssuesFrom(
  error: unknown
): ValidationIssueLog[] | undefined {
  if (!(error instanceof ZodError)) {
    return undefined;
  }

  return error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.map(String),
    ...("expected" in issue && typeof issue.expected === "string"
      ? { expected: issue.expected }
      : {})
  }));
}

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
  const validationIssues = validationIssuesFrom(error);

  console.error({
    code: apiError.code,
    method: context.req.method,
    path: new URL(context.req.url).pathname,
    requestId,
    status: apiError.status,
    ...(validationIssues ? { validationIssues } : {})
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

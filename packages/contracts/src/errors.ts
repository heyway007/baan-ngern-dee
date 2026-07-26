export const apiErrorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN_WORKSPACE",
  "VALIDATION_FAILED",
  "STALE_VERSION",
  "DUPLICATE_MUTATION",
  "PRIVATE_WORKSPACE_EXISTS",
  "CATEGORY_NAME_EXISTS",
  "INSUFFICIENT_BALANCE",
  "INTERNAL_ERROR"
] as const;

export type ApiErrorCode = (typeof apiErrorCodes)[number];

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
  };
};

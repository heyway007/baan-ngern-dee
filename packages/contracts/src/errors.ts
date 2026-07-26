export const apiErrorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN_WORKSPACE",
  "VALIDATION_FAILED",
  "STALE_VERSION",
  "DUPLICATE_MUTATION",
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

export const apiErrorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN_WORKSPACE",
  "VALIDATION_FAILED",
  "STALE_VERSION",
  "DUPLICATE_MUTATION",
  "PRIVATE_WORKSPACE_EXISTS",
  "CATEGORY_NAME_EXISTS",
  "INSUFFICIENT_BALANCE",
  "SUPER_ADMIN_REQUIRED",
  "EMAIL_ALREADY_REGISTERED",
  "ACTIVE_INVITATION_EXISTS",
  "INVITATION_INVALID",
  "INVITATION_EXPIRED",
  "INVITATION_REDEEMED",
  "INVITATION_BUSY",
  "PASSWORD_POLICY_FAILED",
  "INVITATION_CREATE_FAILED",
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

export type { ApiErrorCode, ApiErrorResponse } from "./errors";
export { apiErrorCodes } from "./errors";

export type HealthResponse = {
  ok: true;
  service: "systems-credit-api";
};

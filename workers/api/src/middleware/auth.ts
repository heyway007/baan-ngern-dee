import type { MiddlewareHandler } from "hono";

import { ApiError } from "../api-error";
import type { AppEnv } from "../types";

export type AuthSession = Readonly<{
  userId: string;
  accessToken: string;
}>;

export interface AuthVerifier {
  verify(accessToken: string): Promise<{ userId: string } | null>;
}

export function createStaticAuthVerifier(
  tokens: Readonly<Record<string, string>>
): AuthVerifier {
  return {
    async verify(accessToken) {
      const userId = tokens[accessToken];
      return userId ? { userId } : null;
    }
  };
}

export function requireAuth(
  verifier: AuthVerifier
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const authorization = context.req.header("authorization");
    const match = authorization?.match(/^Bearer ([^\s]+)$/);
    const accessToken = match?.[1];
    const identity = accessToken
      ? await verifier.verify(accessToken)
      : null;

    if (!accessToken || !identity) {
      throw new ApiError(
        "UNAUTHENTICATED",
        401,
        "กรุณาเข้าสู่ระบบใหม่"
      );
    }

    context.set("auth", {
      userId: identity.userId,
      accessToken
    });
    await next();
  };
}

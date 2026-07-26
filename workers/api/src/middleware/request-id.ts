import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../types";

const validRequestId = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestId = () =>
  createMiddleware<AppEnv>(async (context, next) => {
    const incoming = context.req.header("x-request-id");
    const value =
      incoming && validRequestId.test(incoming) ? incoming : crypto.randomUUID();

    context.set("requestId", value);
    context.header("x-request-id", value);
    await next();
  });

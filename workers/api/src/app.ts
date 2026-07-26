import type { HealthResponse } from "@systems-credit/contracts";
import { Hono } from "hono";

import { errorHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";
import type { AppEnv } from "./types";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", requestId());
  app.onError(errorHandler);
  app.get("/health", (context) => {
    const body: HealthResponse = {
      ok: true,
      service: "systems-credit-api"
    };
    return context.json(body);
  });

  return app;
}

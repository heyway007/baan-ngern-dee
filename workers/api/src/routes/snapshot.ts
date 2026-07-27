import { Hono } from "hono";

import type { FinanceRepository } from "../services/finance-repository";
import type { AppEnv } from "../types";

export function snapshotRoutes(repository: FinanceRepository) {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (context) =>
    context.json(
      await repository.getSnapshot(context.get("auth"))
    )
  );

  return routes;
}

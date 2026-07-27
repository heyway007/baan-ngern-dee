import {
  createRecurringTemplateSchema,
  materializeRecurringPeriodSchema,
  postRecurringOccurrenceSchema,
  recurringVersionActionSchema,
  updateRecurringOccurrenceSchema,
  updateRecurringTemplateSchema
} from "@systems-credit/contracts";
import { Hono } from "hono";
import { z } from "zod";

import { ApiError } from "../api-error";
import type { FinanceRepository } from "../services/finance-repository";
import type { AppEnv } from "../types";

const idSchema = z.string().uuid();
const periodSchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);

function invalidRecurringRequest(): never {
  throw new ApiError(
    "VALIDATION_FAILED",
    400,
    "ข้อมูลรายการประจำไม่ถูกต้อง"
  );
}

async function jsonBody(context: {
  req: { json: () => Promise<unknown> };
}): Promise<unknown> {
  return context.req.json().catch(() => null);
}

export function recurringTemplateRoutes(
  repository: FinanceRepository
) {
  const routes = new Hono<AppEnv>();

  routes.post("/", async (context) => {
    const parsed = createRecurringTemplateSchema.safeParse(
      await jsonBody(context)
    );
    if (!parsed.success) {
      return invalidRecurringRequest();
    }
    const result = await repository.createRecurringTemplate(
      context.get("auth"),
      parsed.data
    );
    return context.json(result, 201);
  });

  routes.patch("/:id", async (context) => {
    const id = idSchema.safeParse(context.req.param("id"));
    const parsed = updateRecurringTemplateSchema.safeParse(
      await jsonBody(context)
    );
    if (!id.success || !parsed.success) {
      return invalidRecurringRequest();
    }
    return context.json(
      await repository.updateRecurringTemplate(
        context.get("auth"),
        id.data,
        parsed.data
      )
    );
  });

  const statusRoute = (
    path: string,
    status: "active" | "paused" | "cancelled"
  ) => {
    routes.post(path, async (context) => {
      const id = idSchema.safeParse(context.req.param("id"));
      const parsed = recurringVersionActionSchema.safeParse(
        await jsonBody(context)
      );
      if (!id.success || !parsed.success) {
        return invalidRecurringRequest();
      }
      return context.json(
        await repository.setRecurringTemplateStatus(
          context.get("auth"),
          id.data,
          status,
          parsed.data.version
        )
      );
    });
  };

  statusRoute("/:id/pause", "paused");
  statusRoute("/:id/resume", "active");
  statusRoute("/:id/cancel", "cancelled");

  return routes;
}

export function recurringPeriodRoutes(
  repository: FinanceRepository
) {
  const routes = new Hono<AppEnv>();

  routes.post("/materialize", async (context) => {
    const parsed = materializeRecurringPeriodSchema.safeParse(
      await jsonBody(context)
    );
    if (!parsed.success) {
      return invalidRecurringRequest();
    }
    return context.json(
      await repository.materializeRecurringPeriod(
        context.get("auth"),
        parsed.data
      )
    );
  });

  routes.get("/:period", async (context) => {
    const workspaceId = idSchema.safeParse(
      context.req.query("workspaceId")
    );
    const period = periodSchema.safeParse(
      context.req.param("period")
    );
    if (!workspaceId.success || !period.success) {
      return invalidRecurringRequest();
    }
    return context.json(
      await repository.getRecurringPeriod(
        context.get("auth"),
        workspaceId.data,
        period.data
      )
    );
  });

  return routes;
}

export function recurringOccurrenceRoutes(
  repository: FinanceRepository
) {
  const routes = new Hono<AppEnv>();

  routes.patch("/:id", async (context) => {
    const id = idSchema.safeParse(context.req.param("id"));
    const parsed = updateRecurringOccurrenceSchema.safeParse(
      await jsonBody(context)
    );
    if (!id.success || !parsed.success) {
      return invalidRecurringRequest();
    }
    return context.json(
      await repository.updateRecurringOccurrence(
        context.get("auth"),
        id.data,
        parsed.data
      )
    );
  });

  routes.post("/:id/skip", async (context) => {
    const id = idSchema.safeParse(context.req.param("id"));
    const parsed = recurringVersionActionSchema.safeParse(
      await jsonBody(context)
    );
    if (!id.success || !parsed.success) {
      return invalidRecurringRequest();
    }
    return context.json(
      await repository.skipRecurringOccurrence(
        context.get("auth"),
        id.data,
        parsed.data.version
      )
    );
  });

  routes.post("/:id/post", async (context) => {
    const id = idSchema.safeParse(context.req.param("id"));
    const parsed = postRecurringOccurrenceSchema.safeParse(
      await jsonBody(context)
    );
    if (!id.success || !parsed.success) {
      return invalidRecurringRequest();
    }
    const result = await repository.postRecurringOccurrence(
      context.get("auth"),
      id.data,
      parsed.data
    );
    return context.json(
      result.response,
      result.replayed ? 200 : 201
    );
  });

  return routes;
}

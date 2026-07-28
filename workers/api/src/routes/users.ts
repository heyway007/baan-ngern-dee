import {
  deleteAdminUserSchema,
  listAdminUsersQuerySchema,
  type DeleteAdminUserInput,
  type ListAdminUsersQuery
} from "@systems-credit/contracts";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { ApiError } from "../api-error";
import type { UserManagementService } from "../services/user-management-service";
import type { AppEnv } from "../types";

const userIdSchema = z.string().uuid();

function validationError(): ApiError {
  return new ApiError(
    "VALIDATION_FAILED",
    400,
    "ข้อมูลจัดการผู้ใช้ไม่ถูกต้อง"
  );
}

function validUserId(value: string): string {
  const parsed = userIdSchema.safeParse(value);
  if (!parsed.success) throw validationError();
  return parsed.data;
}

function validQuery(context: Context<AppEnv>): ListAdminUsersQuery {
  const parsed = listAdminUsersQuerySchema.safeParse(
    Object.fromEntries(new URL(context.req.url).searchParams)
  );
  if (!parsed.success) throw validationError();
  return parsed.data;
}

async function validDeleteBody(
  context: Context<AppEnv>
): Promise<DeleteAdminUserInput> {
  const parsed = deleteAdminUserSchema.safeParse(
    await context.req.json().catch(() => null)
  );
  if (!parsed.success) throw validationError();
  return parsed.data;
}

export function adminUserRoutes(
  service: UserManagementService
) {
  const routes = new Hono<AppEnv>();

  routes.get("/users", async (context) =>
    context.json(
      await service.list(
        context.get("auth"),
        validQuery(context)
      )
    )
  );

  routes.post("/users/:userId/confirm", async (context) =>
    context.json(
      await service.confirm(
        context.get("auth"),
        validUserId(context.req.param("userId"))
      )
    )
  );

  routes.post("/users/:userId/suspend", async (context) =>
    context.json(
      await service.suspend(
        context.get("auth"),
        validUserId(context.req.param("userId"))
      )
    )
  );

  routes.post("/users/:userId/resume", async (context) =>
    context.json(
      await service.resume(
        context.get("auth"),
        validUserId(context.req.param("userId"))
      )
    )
  );

  routes.post(
    "/users/:userId/password-reset",
    async (context) => {
      await service.sendPasswordReset(
        context.get("auth"),
        validUserId(context.req.param("userId"))
      );
      return context.body(null, 204);
    }
  );

  routes.delete("/users/:userId", async (context) => {
    await service.delete(
      context.get("auth"),
      validUserId(context.req.param("userId")),
      await validDeleteBody(context)
    );
    return context.body(null, 204);
  });

  return routes;
}

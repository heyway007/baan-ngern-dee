import {
  createInvitationSchema,
  inspectInvitationSchema,
  redeemInvitationSchema
} from "@systems-credit/contracts";
import { Hono } from "hono";
import { z } from "zod";

import { ApiError } from "../api-error";
import type {
  InvitationService
} from "../services/invitation-service";
import type { AppEnv } from "../types";

const invitationIdSchema = z.string().uuid();

async function validBody<T>(
  context: {
    req: { json(): Promise<unknown> };
  },
  schema: z.ZodType<T>
): Promise<T> {
  const parsed = schema.safeParse(
    await context.req.json().catch(() => null)
  );
  if (!parsed.success) {
    throw new ApiError(
      "VALIDATION_FAILED",
      400,
      "ข้อมูลคำเชิญไม่ถูกต้อง"
    );
  }
  return parsed.data;
}

function validInvitationId(value: string): string {
  const parsed = invitationIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      "VALIDATION_FAILED",
      400,
      "รหัสคำเชิญไม่ถูกต้อง"
    );
  }
  return parsed.data;
}

export function publicInvitationRoutes(
  service: InvitationService
) {
  const routes = new Hono<AppEnv>();

  routes.post("/inspect", async (context) => {
    const input = await validBody(
      context,
      inspectInvitationSchema
    );
    return context.json(await service.inspect(input.token));
  });

  routes.post("/redeem", async (context) => {
    const input = await validBody(
      context,
      redeemInvitationSchema
    );
    return context.json(await service.redeem(input));
  });

  return routes;
}

export function adminInvitationRoutes(
  service: InvitationService
) {
  const routes = new Hono<AppEnv>();

  routes.get("/capabilities", (context) =>
    context.json(service.capabilities(context.get("auth")))
  );

  routes.get("/invitations", async (context) =>
    context.json({
      invitations: await service.list(context.get("auth"))
    })
  );

  routes.post("/invitations", async (context) => {
    const input = await validBody(
      context,
      createInvitationSchema
    );
    return context.json(
      await service.create(context.get("auth"), input),
      201
    );
  });

  routes.post(
    "/invitations/:invitationId/replace",
    async (context) => {
      const invitationId = validInvitationId(
        context.req.param("invitationId")
      );
      return context.json(
        await service.replace(
          context.get("auth"),
          invitationId
        ),
        201
      );
    }
  );

  routes.delete(
    "/invitations/:invitationId",
    async (context) => {
      const invitationId = validInvitationId(
        context.req.param("invitationId")
      );
      await service.revoke(
        context.get("auth"),
        invitationId
      );
      return context.body(null, 204);
    }
  );

  return routes;
}

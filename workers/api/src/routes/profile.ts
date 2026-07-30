import {
  PROFILE_AVATAR_MAX_BYTES,
  updateProfileSchema,
  userProfileSchema
} from "@systems-credit/contracts";
import { Hono } from "hono";

import { ApiError } from "../api-error";
import type { ProfileService } from "../services/profile-service";
import type { AppEnv } from "../types";

function profileNameInvalid(): ApiError {
  return new ApiError(
    "PROFILE_NAME_INVALID",
    400,
    "ชื่อที่แสดงต้องมีความยาว 1–80 ตัวอักษร"
  );
}

function profileImageTooLarge(): ApiError {
  return new ApiError(
    "PROFILE_IMAGE_TOO_LARGE",
    413,
    "รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MB"
  );
}

export function profileRoutes(service: ProfileService) {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (context) => {
    const profile = userProfileSchema.parse(
      await service.get(context.get("auth"))
    );
    return context.json(profile);
  });

  routes.patch("/", async (context) => {
    const parsed = updateProfileSchema.safeParse(
      await context.req.json().catch(() => null)
    );
    if (!parsed.success) {
      throw profileNameInvalid();
    }
    const profile = userProfileSchema.parse(
      await service.update(context.get("auth"), parsed.data)
    );
    return context.json(profile);
  });

  routes.post("/avatar", async (context) => {
    const contentLength = Number(
      context.req.header("content-length")
    );
    if (
      Number.isFinite(contentLength) &&
      contentLength > PROFILE_AVATAR_MAX_BYTES
    ) {
      throw profileImageTooLarge();
    }
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const profile = userProfileSchema.parse(
      await service.replaceAvatar(context.get("auth"), bytes)
    );
    return context.json(profile);
  });

  routes.delete("/avatar", async (context) => {
    const profile = userProfileSchema.parse(
      await service.removeAvatar(context.get("auth"))
    );
    return context.json(profile);
  });

  return routes;
}

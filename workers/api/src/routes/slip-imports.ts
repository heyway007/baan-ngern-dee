import {
  confirmSlipInputSchema,
  postedTransactionResponseSchema
} from "@systems-credit/contracts";
import { Hono } from "hono";
import { z } from "zod";

import { ApiError } from "../api-error";
import type { SlipImportService } from "../services/slip-import-service";
import type { AppEnv } from "../types";

const analyzeFieldsSchema = z.object({
  workspaceId: z.string().uuid(),
  imageSha256: z.string().regex(/^[0-9a-f]{64}$/)
}).strict();

export function slipImportRoutes(service: SlipImportService) {
  const routes = new Hono<AppEnv>();
  routes.post("/analyze", async (context) => {
    const form = await context.req.raw.formData().catch(() => null);
    const images = form?.getAll("image") ?? [];
    const image = images[0];
    const parsed = analyzeFieldsSchema.safeParse({
      workspaceId: form?.get("workspaceId"),
      imageSha256: form?.get("imageSha256")
    });
    if (
      !form ||
      images.length !== 1 ||
      !(image instanceof File) ||
      !parsed.success
    ) {
      throw new ApiError(
        "VALIDATION_FAILED",
        400,
        "ข้อมูลรูปสลิปไม่ถูกต้อง"
      );
    }
    const result = await service.analyze(context.get("auth"), {
      ...parsed.data,
      bytes: new Uint8Array(await image.arrayBuffer()),
      claimedMime: image.type
    });
    return context.json(result);
  });

  routes.post("/confirm", async (context) => {
    const parsed = confirmSlipInputSchema.safeParse(
      await context.req.json().catch(() => null)
    );
    if (!parsed.success) {
      throw new ApiError(
        "VALIDATION_FAILED",
        400,
        "ข้อมูลยืนยันรายการไม่ถูกต้อง"
      );
    }
    const result = postedTransactionResponseSchema.parse(
      await service.confirm(context.get("auth"), parsed.data)
    );
    return context.json(result, 201);
  });
  return routes;
}

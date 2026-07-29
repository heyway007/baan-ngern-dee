import { createApp } from "./app";
import { z } from "zod";
import { createSupabaseAuthAdmin } from "./services/supabase-auth-admin";
import { createSupabaseAuthVerifier } from "./services/supabase-client";
import { createSupabaseFinanceRepository } from "./services/supabase-finance-repository";
import { createSupabasePlanningRepository } from "./services/supabase-planning-repository";
import { createInvitationService } from "./services/invitation-service";
import { createSupabaseInvitationRepository } from "./services/supabase-invitation-repository";
import { createUserManagementService } from "./services/user-management-service";
import { createSupabaseUserAuthAdmin } from "./services/supabase-user-auth-admin";
import { createSupabaseUserManagementRepository } from "./services/supabase-user-management-repository";
import { createSupabaseSlipImportRepository } from "./services/supabase-slip-import-repository";
import { createSlipImportService } from "./services/slip-import-service";
import { createSlipAnalysisTokenCodec } from "./services/slip-analysis-token";
import { createCloudflareSlipVisionExtractor } from "./services/slip-vision-extractor";
import type { AppEnv } from "./types";

type WorkerBindings = AppEnv["Bindings"];

function corsHeaders(
  request: Request,
  env: WorkerBindings
): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || origin !== env.ALLOWED_ORIGIN) {
    return {};
  }
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers":
      "authorization, content-type, x-request-id",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}

export default {
  async fetch(
    request: Request,
    env: WorkerBindings,
    executionContext: ExecutionContext
  ) {
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const config = {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY
    };
    const adminConfig = {
      url: env.SUPABASE_URL,
      serviceRoleKey: z
        .string()
        .min(20)
        .parse(env.SUPABASE_SERVICE_ROLE_KEY)
    };
    const superAdminUserId = z
      .string()
      .uuid()
      .parse(env.SUPER_ADMIN_USER_ID);
    const invitationService = createInvitationService({
      superAdminUserId,
      appOrigin: new URL(request.url).origin,
      repository:
        createSupabaseInvitationRepository(adminConfig),
      authAdmin: createSupabaseAuthAdmin(adminConfig)
    });
    const userManagementService =
      createUserManagementService({
        superAdminUserId,
        repository:
          createSupabaseUserManagementRepository(adminConfig),
        authAdmin: createSupabaseUserAuthAdmin(adminConfig)
      });
    const financeRepository = createSupabaseFinanceRepository(config);
    const app = createApp({
      authVerifier: createSupabaseAuthVerifier(config),
      financeRepository,
      planningRepository: createSupabasePlanningRepository(config),
      invitationService,
      userManagementService,
      publicConfig: {
        supabaseUrl: env.SUPABASE_URL,
        supabasePublishableKey: env.SUPABASE_ANON_KEY,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY
      },
      slipImportService: createSlipImportService({
        repository: createSupabaseSlipImportRepository(config),
        financeRepository,
        extractor: createCloudflareSlipVisionExtractor(env.AI),
        tokenCodec: createSlipAnalysisTokenCodec(
          z.string().min(32).parse(env.SLIP_ANALYSIS_TOKEN_SECRET)
        )
      })
    });
    const response = await app.fetch(
      request,
      env,
      executionContext
    );
    const outgoing = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) {
      outgoing.headers.set(name, value);
    }
    return outgoing;
  }
};

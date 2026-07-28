import type { AuthSession } from "./middleware/auth";

export type AppEnv = {
  Bindings: {
    AI: import("./services/slip-vision-extractor").SlipAiBinding;
    SLIP_ANALYSIS_TOKEN_SECRET: string;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPER_ADMIN_USER_ID: string;
    TURNSTILE_SITE_KEY: string;
    ALLOWED_ORIGIN?: string;
  };
  Variables: {
    auth: AuthSession;
    requestId: string;
  };
};

import type { AuthSession } from "./middleware/auth";

export type AppEnv = {
  Bindings: {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPER_ADMIN_USER_ID: string;
    ALLOWED_ORIGIN?: string;
  };
  Variables: {
    auth: AuthSession;
    requestId: string;
  };
};

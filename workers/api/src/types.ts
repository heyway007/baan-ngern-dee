import type { AuthSession } from "./middleware/auth";

export type AppEnv = {
  Bindings: {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    ALLOWED_ORIGIN?: string;
  };
  Variables: {
    auth: AuthSession;
    requestId: string;
  };
};

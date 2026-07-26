import type { AuthSession } from "./middleware/auth";

export type AppEnv = {
  Variables: {
    auth: AuthSession;
    requestId: string;
  };
};

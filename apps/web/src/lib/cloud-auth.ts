import type { PublicAppConfig } from "@systems-credit/contracts";
import {
  createClient,
  type AuthError,
  type Session
} from "@supabase/supabase-js";

export type CloudSession = Readonly<{
  userId: string;
  email: string;
  displayName: string;
  accessToken: string;
}>;

export interface CloudAuth {
  getSession(): Promise<CloudSession | null>;
  refreshSession(): Promise<CloudSession | null>;
  subscribe(listener: (session: CloudSession | null) => void): () => void;
  signIn(input: {
    email: string;
    password: string;
  }): Promise<CloudSession>;
  signUp(input: {
    displayName: string;
    email: string;
    password: string;
    redirectTo: string;
  }): Promise<"confirmation_required" | CloudSession>;
  requestPasswordReset(
    email: string,
    redirectTo: string
  ): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
}

function throwAuthError(error: AuthError | null) {
  if (error) {
    throw error;
  }
}

function mapSession(session: Session | null): CloudSession | null {
  if (!session) {
    return null;
  }
  const email = session.user.email;
  if (!email) {
    throw new Error("AUTH_EMAIL_REQUIRED");
  }
  const metadataName = session.user.user_metadata.display_name;
  const displayName =
    typeof metadataName === "string" && metadataName.trim()
      ? metadataName.trim()
      : email.split("@")[0]!;
  return {
    userId: session.user.id,
    email,
    displayName,
    accessToken: session.access_token
  };
}

export function createSupabaseCloudAuth(
  config: PublicAppConfig
): CloudAuth {
  const supabase = createClient(
    config.supabaseUrl,
    config.supabasePublishableKey
  );

  return {
    async getSession() {
      const { data, error } = await supabase.auth.getSession();
      throwAuthError(error);
      return mapSession(data.session);
    },

    async refreshSession() {
      const { data, error } = await supabase.auth.refreshSession();
      throwAuthError(error);
      return mapSession(data.session);
    },

    subscribe(listener) {
      const { data } = supabase.auth.onAuthStateChange(
        (_event, session) => listener(mapSession(session))
      );
      return () => data.subscription.unsubscribe();
    },

    async signIn(input) {
      const { data, error } =
        await supabase.auth.signInWithPassword(input);
      throwAuthError(error);
      const mapped = mapSession(data.session);
      if (!mapped) {
        throw new Error("AUTH_SESSION_REQUIRED");
      }
      return mapped;
    },

    async signUp(input) {
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: { display_name: input.displayName },
          emailRedirectTo: input.redirectTo
        }
      });
      throwAuthError(error);
      return mapSession(data.session) ?? "confirmation_required";
    },

    async requestPasswordReset(email, redirectTo) {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo }
      );
      throwAuthError(error);
    },

    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      throwAuthError(error);
    },

    async signOut() {
      const { error } = await supabase.auth.signOut();
      throwAuthError(error);
    }
  };
}

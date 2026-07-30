import type { PublicAppConfig } from "@systems-credit/contracts";
import {
  createClient,
  type AuthError,
  type Session
} from "@supabase/supabase-js";

export type CloudSession = Readonly<{
  userId: string;
  email?: string;
  displayName: string;
  accessToken: string;
}>;

export type CloudAuthErrorCode =
  | "AUTH_EMAIL_EXISTS"
  | "AUTH_EMAIL_NOT_CONFIRMED"
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_USER_SUSPENDED"
  | "AUTH_WEAK_PASSWORD"
  | "AUTH_CAPTCHA_FAILED"
  | "AUTH_RATE_LIMITED"
  | "AUTH_NETWORK_UNAVAILABLE"
  | "AUTH_SIGNUP_SESSION_REQUIRED"
  | "AUTH_UNKNOWN";

export class CloudAuthFailure extends Error {
  constructor(readonly code: CloudAuthErrorCode) {
    super(code);
    this.name = "CloudAuthFailure";
  }
}

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
    captchaToken: string;
  }): Promise<CloudSession>;
  requestPasswordReset(
    email: string,
    redirectTo: string
  ): Promise<void>;
  startLineSignIn(redirectTo: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
}

function mapAuthError(error: AuthError): CloudAuthFailure {
  const code = error.code?.toLowerCase();
  switch (code) {
    case "user_already_exists":
    case "email_exists":
      return new CloudAuthFailure("AUTH_EMAIL_EXISTS");
    case "email_not_confirmed":
      return new CloudAuthFailure("AUTH_EMAIL_NOT_CONFIRMED");
    case "invalid_credentials":
      return new CloudAuthFailure("AUTH_INVALID_CREDENTIALS");
    case "user_banned":
      return new CloudAuthFailure("AUTH_USER_SUSPENDED");
    case "weak_password":
      return new CloudAuthFailure("AUTH_WEAK_PASSWORD");
    case "captcha_failed":
      return new CloudAuthFailure("AUTH_CAPTCHA_FAILED");
    case "over_request_rate_limit":
      return new CloudAuthFailure("AUTH_RATE_LIMITED");
    default:
      return new CloudAuthFailure("AUTH_UNKNOWN");
  }
}

function throwAuthError(error: AuthError | null): void {
  if (error) {
    throw mapAuthError(error);
  }
}

async function authRequest<T>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CloudAuthFailure) {
      throw error;
    }
    throw new CloudAuthFailure("AUTH_NETWORK_UNAVAILABLE");
  }
}

function metadataDisplayName(
  metadata: Record<string, unknown>
): string | undefined {
  for (const key of [
    "display_name",
    "name",
    "full_name",
    "preferred_username"
  ]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 80);
    }
  }
  return undefined;
}

function mapSession(session: Session | null): CloudSession | null {
  if (!session) {
    return null;
  }
  const email = session.user.email?.trim().toLowerCase();
  const displayName =
    metadataDisplayName(session.user.user_metadata) ??
    email?.split("@")[0]?.slice(0, 80) ??
    "ผู้ใช้ LINE";
  return {
    userId: session.user.id,
    ...(email ? { email } : {}),
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
      const { data, error } = await authRequest(() =>
        supabase.auth.getSession()
      );
      throwAuthError(error);
      return mapSession(data.session);
    },

    async refreshSession() {
      const { data, error } = await authRequest(() =>
        supabase.auth.refreshSession()
      );
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
      const { data, error } = await authRequest(() =>
        supabase.auth.signInWithPassword(input)
      );
      throwAuthError(error);
      const mapped = mapSession(data.session);
      if (!mapped) {
        throw new CloudAuthFailure("AUTH_UNKNOWN");
      }
      return mapped;
    },

    async signUp(input) {
      const { data, error } = await authRequest(() =>
        supabase.auth.signUp({
          email: input.email,
          password: input.password,
          options: {
            data: { display_name: input.displayName },
            captchaToken: input.captchaToken
          }
        })
      );
      throwAuthError(error);
      const mapped = mapSession(data.session);
      if (!mapped) {
        throw new CloudAuthFailure(
          "AUTH_SIGNUP_SESSION_REQUIRED"
        );
      }
      return mapped;
    },

    async requestPasswordReset(email, redirectTo) {
      const { error } = await authRequest(() =>
        supabase.auth.resetPasswordForEmail(email, { redirectTo })
      );
      throwAuthError(error);
    },

    async startLineSignIn(redirectTo) {
      const { error } = await authRequest(() =>
        supabase.auth.signInWithOAuth({
          provider: "custom:line",
          options: { redirectTo }
        })
      );
      throwAuthError(error);
    },

    async updatePassword(password) {
      const { error } = await authRequest(() =>
        supabase.auth.updateUser({ password })
      );
      throwAuthError(error);
    },

    async signOut() {
      const { error } = await authRequest(() =>
        supabase.auth.signOut()
      );
      throwAuthError(error);
    }
  };
}

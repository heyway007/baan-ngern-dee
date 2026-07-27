import { createApp } from "./app";
import { createSupabaseAuthVerifier } from "./services/supabase-client";
import { createSupabaseFinanceRepository } from "./services/supabase-finance-repository";
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
    const app = createApp({
      authVerifier: createSupabaseAuthVerifier(config),
      financeRepository: createSupabaseFinanceRepository(config)
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

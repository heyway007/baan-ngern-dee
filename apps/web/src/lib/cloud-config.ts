import {
  publicAppConfigSchema,
  type PublicAppConfig
} from "@systems-credit/contracts";

export async function loadPublicAppConfig(
  requestFetch: typeof fetch = fetch
): Promise<PublicAppConfig> {
  const response = await requestFetch("/config", {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error("CONFIG_LOAD_FAILED");
  }
  return publicAppConfigSchema.parse(await response.json());
}

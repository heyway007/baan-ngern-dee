import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseSlipImportRepository
} from "../src/services/supabase-slip-import-repository";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  accessToken: "user-jwt"
};
const workspaceId = "22222222-2222-4222-8222-222222222222";

describe("Supabase slip import repository", () => {
  it("reads quota through the dedicated RPC without consuming an attempt", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ used: 7, limit: 30 })
    );
    const repository = createSupabaseSlipImportRepository({
      url: "https://project.supabase.co",
      anonKey: "anon-key",
      fetch: requestFetch
    });

    await expect(repository.getQuota(actor, workspaceId)).resolves.toEqual({
      used: 7,
      limit: 30
    });
    expect(requestFetch).toHaveBeenCalledWith(
      "https://project.supabase.co/rest/v1/rpc/get_slip_analysis_quota",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ p_workspace_id: workspaceId })
      })
    );
  });
});

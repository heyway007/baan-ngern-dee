import type {
  AdminInvitation,
  CreateInvitationInput
} from "@systems-credit/contracts";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api-error";
import {
  createInvitationService,
  generateInvitationToken,
  hashInvitationToken,
  maskInvitationEmail,
  type InvitationAuthAdmin,
  type InvitationRepository
} from "../src/services/invitation-service";

const adminId = "11111111-1111-4111-8111-111111111111";
const normalId = "22222222-2222-4222-8222-222222222222";
const invitationId = "33333333-3333-4333-8333-333333333333";
const claimId = "44444444-4444-4444-8444-444444444444";
const createdUserId = "55555555-5555-4555-8555-555555555555";

const invitation: AdminInvitation = {
  id: invitationId,
  email: "person@example.test",
  displayName: "Person",
  status: "ready",
  createdAt: "2026-07-27T10:00:00.000Z",
  expiresAt: "2026-07-28T10:00:00.000Z"
};

function createDependencies() {
  const calls: string[] = [];
  const repository: InvitationRepository = {
    list: vi.fn().mockResolvedValue([invitation]),
    create: vi.fn().mockImplementation(async () => invitation),
    replace: vi.fn().mockImplementation(async () => invitation),
    revoke: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({
      email: invitation.email,
      displayName: invitation.displayName
    }),
    claim: vi.fn().mockImplementation(async () => {
      calls.push("claim");
      return {
        id: invitationId,
        claimId,
        email: invitation.email,
        displayName: invitation.displayName
      };
    }),
    complete: vi.fn().mockImplementation(async () => {
      calls.push("complete");
    }),
    release: vi.fn().mockImplementation(async () => {
      calls.push("release");
    })
  };
  const authAdmin: InvitationAuthAdmin = {
    createUser: vi.fn().mockImplementation(async () => {
      calls.push("create-user");
      return { userId: createdUserId };
    })
  };
  const service = createInvitationService({
    superAdminUserId: adminId,
    appOrigin: "https://app.example",
    repository,
    authAdmin
  });
  return { authAdmin, calls, repository, service };
}

describe("invitation token safety", () => {
  it("generates 256 random bits as a 43-character base64url token", () => {
    expect(generateInvitationToken()).toMatch(
      /^[A-Za-z0-9_-]{43}$/
    );
  });

  it("hashes the same token to the stable SHA-256 hex digest", async () => {
    await expect(
      hashInvitationToken("a".repeat(43))
    ).resolves.toBe(
      "66d34fba71f8f450f7e45598853e53bfc23bbd129027cbb131a2f4ffd7878cd0"
    );
  });

  it("masks the local email identity without hiding the domain", () => {
    expect(maskInvitationEmail("person@example.test")).toBe(
      "pe****@example.test"
    );
  });
});

describe("invitation service", () => {
  it("creates a raw invitation link only for the configured Super Admin", async () => {
    const { repository, service } = createDependencies();
    const input: CreateInvitationInput = {
      email: invitation.email,
      displayName: invitation.displayName
    };

    await expect(
      service.create({ userId: normalId }, input)
    ).rejects.toMatchObject({
      code: "SUPER_ADMIN_REQUIRED",
      status: 403
    });
    const result = await service.create({ userId: adminId }, input);

    expect(result.invitation).toEqual(invitation);
    expect(result.invitationUrl).toMatch(
      /^https:\/\/app\.example\/accept-invite#token=[A-Za-z0-9_-]{43}$/
    );
    expect(repository.create).toHaveBeenCalledWith({
      email: invitation.email,
      displayName: invitation.displayName,
      tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      createdBy: adminId
    });
    expect(JSON.stringify(result.invitation)).not.toContain(
      "tokenHash"
    );
  });

  it("returns a masked identity when inspecting a ready token", async () => {
    const { repository, service } = createDependencies();

    await expect(
      service.inspect("a".repeat(43))
    ).resolves.toEqual({
      displayName: "Person",
      maskedEmail: "pe****@example.test",
      status: "ready"
    });
    expect(repository.inspect).toHaveBeenCalledWith(
      await hashInvitationToken("a".repeat(43))
    );
  });

  it("claims, creates, and completes before returning the login email", async () => {
    const { calls, service } = createDependencies();

    await expect(
      service.redeem({
        token: "a".repeat(43),
        password: "strong-password"
      })
    ).resolves.toEqual({ email: invitation.email });
    expect(calls).toEqual(["claim", "create-user", "complete"]);
  });

  it("releases the matching claim when Auth user creation fails", async () => {
    const { authAdmin, calls, service } = createDependencies();
    vi.mocked(authAdmin.createUser).mockRejectedValueOnce(
      new Error("upstream failed")
    );

    await expect(
      service.redeem({
        token: "a".repeat(43),
        password: "strong-password"
      })
    ).rejects.toMatchObject({
      code: "INVITATION_CREATE_FAILED"
    });
    expect(calls).toEqual(["claim", "release"]);
  });

  it("does not release after Auth succeeds but completion fails", async () => {
    const { calls, repository, service } = createDependencies();
    vi.mocked(repository.complete).mockImplementationOnce(
      async () => {
        calls.push("complete");
        throw new ApiError(
          "INVITATION_BUSY",
          409,
          "completion failed"
        );
      }
    );

    await expect(
      service.redeem({
        token: "a".repeat(43),
        password: "strong-password"
      })
    ).rejects.toMatchObject({
      code: "INVITATION_CREATE_FAILED"
    });
    expect(calls).toEqual(["claim", "create-user", "complete"]);
  });
});

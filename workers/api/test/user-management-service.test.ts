import type {
  AdminUser,
  ListAdminUsersQuery
} from "@systems-credit/contracts";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api-error";
import {
  createUserManagementService,
  type UserAuthAdmin,
  type UserManagementRepository
} from "../src/services/user-management-service";

const adminId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const normalId = "33333333-3333-4333-8333-333333333333";
const mutationId = "44444444-4444-4444-8444-444444444444";

const activeUser: AdminUser = {
  userId,
  email: "friend@example.test",
  displayName: "Friend",
  status: "active",
  createdAt: "2026-07-28T10:00:00.000Z",
  emailConfirmedAt: "2026-07-28T10:00:01.000Z",
  privateWorkspaceCount: 1,
  deletionPending: false
};

function createDependencies() {
  const events: string[] = [];
  const repository: UserManagementRepository = {
    list: vi.fn().mockResolvedValue({
      users: [activeUser],
      nextCursor: null
    }),
    recordAction: vi.fn().mockImplementation(async () => {
      events.push("repository.recordAction");
    }),
    getDeletionState: vi.fn().mockImplementation(async () => {
      events.push("repository.getDeletionState");
      return null;
    }),
    purgePrivateData: vi.fn().mockImplementation(async () => {
      events.push("repository.purgePrivateData");
      return { privateWorkspacesDeleted: 1 };
    }),
    completeDeletion: vi.fn().mockImplementation(async () => {
      events.push("repository.completeDeletion");
    })
  };
  const authAdmin: UserAuthAdmin = {
    getUser: vi.fn().mockImplementation(async () => {
      events.push("auth.getUser");
      return activeUser;
    }),
    confirmUser: vi.fn().mockResolvedValue(activeUser),
    suspendUser: vi.fn().mockResolvedValue({
      ...activeUser,
      status: "suspended",
      bannedUntil: "2126-07-28T10:00:00.000Z"
    }),
    resumeUser: vi.fn().mockResolvedValue(activeUser),
    sendPasswordReset: vi.fn().mockResolvedValue(undefined),
    markDeletionPending: vi.fn().mockImplementation(async () => {
      events.push("auth.markDeletionPending");
      return {
        ...activeUser,
        status: "deletion_pending",
        deletionPending: true
      };
    }),
    deleteUser: vi.fn().mockImplementation(async () => {
      events.push("auth.deleteUser");
    })
  };
  const service = createUserManagementService({
    superAdminUserId: adminId,
    repository,
    authAdmin
  });
  return { authAdmin, events, repository, service };
}

describe("user management service", () => {
  it("allows only the configured Super Admin to list users", async () => {
    const { repository, service } = createDependencies();
    const query: ListAdminUsersQuery = {
      search: "friend",
      limit: 25
    };

    await expect(
      service.list({ userId: normalId }, query)
    ).rejects.toMatchObject({
      code: "SUPER_ADMIN_REQUIRED",
      status: 403
    });
    await expect(
      service.list({ userId: adminId }, query)
    ).resolves.toMatchObject({ users: [activeUser] });
    expect(repository.list).toHaveBeenCalledWith(query);
  });

  it("audits successful confirm, suspend, resume, and reset actions", async () => {
    const { authAdmin, repository, service } =
      createDependencies();

    await service.confirm({ userId: adminId }, userId);
    await service.suspend({ userId: adminId }, userId);
    vi.mocked(authAdmin.getUser).mockResolvedValueOnce({
      ...activeUser,
      status: "suspended",
      bannedUntil: "2126-07-28T10:00:00.000Z"
    });
    await service.resume({ userId: adminId }, userId);
    await service.sendPasswordReset(
      { userId: adminId },
      userId
    );

    expect(repository.recordAction).toHaveBeenNthCalledWith(1, {
      actorUserId: adminId,
      targetUserId: userId,
      action: "confirmed",
      details: {}
    });
    expect(repository.recordAction).toHaveBeenNthCalledWith(2, {
      actorUserId: adminId,
      targetUserId: userId,
      action: "suspended",
      details: {}
    });
    expect(repository.recordAction).toHaveBeenNthCalledWith(3, {
      actorUserId: adminId,
      targetUserId: userId,
      action: "resumed",
      details: {}
    });
    expect(repository.recordAction).toHaveBeenNthCalledWith(4, {
      actorUserId: adminId,
      targetUserId: userId,
      action: "password_reset_requested",
      details: {}
    });
    expect(authAdmin.sendPasswordReset).toHaveBeenCalledWith(
      activeUser.email
    );
  });

  it("protects the Super Admin and current actor from access changes", async () => {
    const { authAdmin, service } = createDependencies();
    vi.mocked(authAdmin.getUser).mockResolvedValue({
      ...activeUser,
      userId: adminId,
      email: "admin@example.test"
    });

    await expect(
      service.suspend({ userId: adminId }, adminId)
    ).rejects.toMatchObject({
      code: "USER_PROTECTED",
      status: 409
    });
    await expect(
      service.resume({ userId: adminId }, adminId)
    ).rejects.toMatchObject({
      code: "USER_PROTECTED",
      status: 409
    });
  });

  it("does not resume deletion-pending accounts", async () => {
    const { authAdmin, service } = createDependencies();
    vi.mocked(authAdmin.getUser).mockResolvedValue({
      ...activeUser,
      status: "deletion_pending",
      deletionPending: true
    });

    await expect(
      service.resume({ userId: adminId }, userId)
    ).rejects.toMatchObject({
      code: "USER_DELETION_PENDING",
      status: 409
    });
    expect(authAdmin.resumeUser).not.toHaveBeenCalled();
  });

  it("rejects a deletion email mismatch before changing state", async () => {
    const { authAdmin, repository, service } =
      createDependencies();

    await expect(
      service.delete({ userId: adminId }, userId, {
        email: "wrong@example.test",
        clientMutationId: mutationId
      })
    ).rejects.toMatchObject({
      code: "USER_EMAIL_MISMATCH",
      status: 409
    });
    expect(authAdmin.markDeletionPending).not.toHaveBeenCalled();
    expect(repository.purgePrivateData).not.toHaveBeenCalled();
  });

  it("runs the retryable deletion state machine in order", async () => {
    const { events, service } = createDependencies();

    await service.delete({ userId: adminId }, userId, {
      email: "friend@example.test",
      clientMutationId: mutationId
    });

    expect(events).toEqual([
      "repository.getDeletionState",
      "auth.getUser",
      "auth.markDeletionPending",
      "repository.purgePrivateData",
      "auth.deleteUser",
      "repository.completeDeletion"
    ]);
  });

  it("leaves deletion pending when Auth deletion fails", async () => {
    const { authAdmin, events, repository, service } =
      createDependencies();
    vi.mocked(authAdmin.deleteUser).mockImplementationOnce(
      async () => {
        events.push("auth.deleteUser");
        throw new ApiError(
          "USER_ADMIN_ACTION_FAILED",
          500,
          "Auth unavailable"
        );
      }
    );

    await expect(
      service.delete({ userId: adminId }, userId, {
        email: "friend@example.test",
        clientMutationId: mutationId
      })
    ).rejects.toMatchObject({
      code: "USER_ADMIN_ACTION_FAILED"
    });
    expect(repository.completeDeletion).not.toHaveBeenCalled();
    expect(authAdmin.markDeletionPending).toHaveBeenCalledWith(
      userId
    );
  });

  it("completes a purged deletion when Auth already removed the user", async () => {
    const { authAdmin, events, repository, service } =
      createDependencies();
    vi.mocked(repository.getDeletionState).mockImplementationOnce(
      async () => {
        events.push("repository.getDeletionState");
        return { purgeCompleted: true, completed: false };
      }
    );
    vi.mocked(authAdmin.getUser).mockImplementationOnce(async () => {
      events.push("auth.getUser");
      throw new ApiError(
        "USER_NOT_FOUND",
        404,
        "User not found"
      );
    });

    await service.delete({ userId: adminId }, userId, {
      email: "friend@example.test",
      clientMutationId: mutationId
    });

    expect(events).toEqual([
      "repository.getDeletionState",
      "auth.getUser",
      "repository.completeDeletion"
    ]);
  });

  it("returns immediately for an already completed mutation", async () => {
    const { authAdmin, repository, service } =
      createDependencies();
    vi.mocked(repository.getDeletionState).mockResolvedValueOnce({
      purgeCompleted: true,
      completed: true
    });

    await service.delete({ userId: adminId }, userId, {
      email: "friend@example.test",
      clientMutationId: mutationId
    });

    expect(authAdmin.getUser).not.toHaveBeenCalled();
    expect(repository.purgePrivateData).not.toHaveBeenCalled();
  });
});

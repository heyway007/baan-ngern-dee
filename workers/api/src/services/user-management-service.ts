import type {
  AdminUser,
  AdminUserListResponse,
  AdminUserMutationResponse,
  DeleteAdminUserInput,
  ListAdminUsersQuery
} from "@systems-credit/contracts";

import {
  ApiError,
  type ApiErrorLogContext
} from "../api-error";
import type { InvitationActor } from "./invitation-service";

export type UserAdminAction =
  | "confirmed"
  | "suspended"
  | "resumed"
  | "password_reset_requested";

export interface UserManagementRepository {
  list(
    input: ListAdminUsersQuery
  ): Promise<AdminUserListResponse>;
  recordAction(input: {
    actorUserId: string;
    targetUserId: string;
    action: UserAdminAction;
    details: Readonly<Record<string, string | number | boolean>>;
  }): Promise<void>;
  getDeletionState(input: {
    targetUserId: string;
    clientMutationId: string;
  }): Promise<{
    purgeCompleted: boolean;
    completed: boolean;
  } | null>;
  purgePrivateData(input: {
    actorUserId: string;
    targetUserId: string;
    clientMutationId: string;
    confirmation: string;
  }): Promise<{ privateWorkspacesDeleted: number }>;
  completeDeletion(input: {
    actorUserId: string;
    targetUserId: string;
    clientMutationId: string;
  }): Promise<void>;
}

export interface UserAuthAdmin {
  getUser(userId: string): Promise<AdminUser>;
  confirmUser(userId: string): Promise<AdminUser>;
  suspendUser(userId: string): Promise<AdminUser>;
  resumeUser(userId: string): Promise<AdminUser>;
  sendPasswordReset(email: string): Promise<void>;
  markDeletionPending(userId: string): Promise<AdminUser>;
  deleteUser(userId: string): Promise<void>;
}

export interface UserManagementService {
  list(
    actor: InvitationActor,
    query: ListAdminUsersQuery
  ): Promise<AdminUserListResponse>;
  confirm(
    actor: InvitationActor,
    userId: string
  ): Promise<AdminUserMutationResponse>;
  suspend(
    actor: InvitationActor,
    userId: string
  ): Promise<AdminUserMutationResponse>;
  resume(
    actor: InvitationActor,
    userId: string
  ): Promise<AdminUserMutationResponse>;
  sendPasswordReset(
    actor: InvitationActor,
    userId: string
  ): Promise<void>;
  delete(
    actor: InvitationActor,
    userId: string,
    input: DeleteAdminUserInput
  ): Promise<void>;
}

function userNotFound(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code === "USER_NOT_FOUND"
  );
}

type UserAdminStage = NonNullable<
  ApiErrorLogContext["userAdminStage"]
>;

export function createUserManagementService(options: {
  superAdminUserId: string;
  repository: UserManagementRepository;
  authAdmin: UserAuthAdmin;
}): UserManagementService {
  function requireSuperAdmin(actor: InvitationActor): void {
    if (actor.userId !== options.superAdminUserId) {
      throw new ApiError(
        "SUPER_ADMIN_REQUIRED",
        403,
        "ไม่มีสิทธิ์จัดการผู้ใช้"
      );
    }
  }

  function requireMutableTarget(
    actor: InvitationActor,
    target: AdminUser
  ): void {
    if (
      actor.userId === target.userId ||
      target.userId === options.superAdminUserId
    ) {
      throw new ApiError(
        "USER_PROTECTED",
        409,
        "ไม่สามารถเปลี่ยนสถานะบัญชีผู้ดูแลระบบได้"
      );
    }
  }

  function requireEmail(target: AdminUser): string {
    if (!target.email) {
      throw new ApiError(
        "USER_ADMIN_ACTION_FAILED",
        409,
        "บัญชี LINE นี้ไม่มีอีเมลสำหรับดำเนินการนี้"
      );
    }
    return target.email;
  }

  async function recordAction(
    actor: InvitationActor,
    targetUserId: string,
    action: UserAdminAction
  ): Promise<void> {
    await options.repository.recordAction({
      actorUserId: actor.userId,
      targetUserId,
      action,
      details: {}
    });
  }

  async function atDeletionStage<T>(
    stage: UserAdminStage,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(
          error.code,
          error.status,
          error.message,
          {
            ...error.logContext,
            userAdminStage: stage
          }
        );
      }
      throw error;
    }
  }

  return {
    async list(actor, query) {
      requireSuperAdmin(actor);
      return options.repository.list(query);
    },

    async confirm(actor, userId) {
      requireSuperAdmin(actor);
      requireEmail(await options.authAdmin.getUser(userId));
      const user = await options.authAdmin.confirmUser(userId);
      await recordAction(actor, userId, "confirmed");
      return { user };
    },

    async suspend(actor, userId) {
      requireSuperAdmin(actor);
      requireMutableTarget(
        actor,
        await options.authAdmin.getUser(userId)
      );
      const user = await options.authAdmin.suspendUser(userId);
      await recordAction(actor, userId, "suspended");
      return { user };
    },

    async resume(actor, userId) {
      requireSuperAdmin(actor);
      const target = await options.authAdmin.getUser(userId);
      requireMutableTarget(actor, target);
      if (target.deletionPending) {
        throw new ApiError(
          "USER_DELETION_PENDING",
          409,
          "บัญชีนี้อยู่ระหว่างการลบและไม่สามารถเปิดใช้งานได้"
        );
      }
      const user = await options.authAdmin.resumeUser(userId);
      await recordAction(actor, userId, "resumed");
      return { user };
    },

    async sendPasswordReset(actor, userId) {
      requireSuperAdmin(actor);
      const target = await options.authAdmin.getUser(userId);
      const email = requireEmail(target);
      await recordAction(
        actor,
        userId,
        "password_reset_requested"
      );
      await options.authAdmin.sendPasswordReset(email);
    },

    async delete(actor, userId, input) {
      requireSuperAdmin(actor);
      const state =
        await atDeletionStage("deletion_state", () =>
          options.repository.getDeletionState({
            targetUserId: userId,
            clientMutationId: input.clientMutationId
          })
        );
      if (state?.completed) return;

      let target: AdminUser;
      try {
        target = await atDeletionStage("auth_get_user", () =>
          options.authAdmin.getUser(userId)
        );
      } catch (error) {
        if (userNotFound(error) && state?.purgeCompleted) {
          await atDeletionStage("complete_deletion", () =>
            options.repository.completeDeletion({
              actorUserId: actor.userId,
              targetUserId: userId,
              clientMutationId: input.clientMutationId
            })
          );
          return;
        }
        throw error;
      }

      requireMutableTarget(actor, target);
      const expectedConfirmation = target.email ?? target.userId;
      const confirmationMatches = target.email
        ? input.confirmation.toLowerCase() === target.email
        : input.confirmation === target.userId;
      if (!confirmationMatches) {
        throw new ApiError(
          target.email
            ? "USER_EMAIL_MISMATCH"
            : "USER_CONFIRMATION_MISMATCH",
          409,
          target.email
            ? "อีเมลยืนยันไม่ตรงกับบัญชี"
            : "รหัสผู้ใช้ยืนยันไม่ตรงกับบัญชี"
        );
      }

      // Email-less LINE identities cannot use the email-oriented pending
      // marker reliably; purge their private data before Auth deletion.
      if (!target.deletionPending && target.email) {
        await atDeletionStage("mark_pending", () =>
          options.authAdmin.markDeletionPending(userId)
        );
      }
      await atDeletionStage("purge_private_data", () =>
        options.repository.purgePrivateData({
          actorUserId: actor.userId,
          targetUserId: userId,
          clientMutationId: input.clientMutationId,
          confirmation: expectedConfirmation
        })
      );
      await atDeletionStage("auth_delete", () =>
        options.authAdmin.deleteUser(userId)
      );
      await atDeletionStage("complete_deletion", () =>
        options.repository.completeDeletion({
          actorUserId: actor.userId,
          targetUserId: userId,
          clientMutationId: input.clientMutationId
        })
      );
    }
  };
}

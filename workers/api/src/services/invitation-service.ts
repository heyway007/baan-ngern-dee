import type {
  AdminCapabilities,
  AdminInvitation,
  CreateInvitationInput,
  CreateInvitationResponse,
  InspectInvitationResponse,
  RedeemInvitationInput,
  RedeemInvitationResponse
} from "@systems-credit/contracts";

import { ApiError } from "../api-error";

export type InvitationActor = Readonly<{
  userId: string;
}>;

export type InvitationIdentity = Readonly<{
  email: string;
  displayName: string;
}>;

export type ClaimedInvitation = InvitationIdentity &
  Readonly<{
    id: string;
    claimId: string;
  }>;

export interface InvitationRepository {
  list(): Promise<readonly AdminInvitation[]>;
  create(input: {
    email: string;
    displayName: string;
    tokenHash: string;
    createdBy: string;
  }): Promise<AdminInvitation>;
  replace(input: {
    invitationId: string;
    tokenHash: string;
    actorUserId: string;
  }): Promise<AdminInvitation>;
  revoke(
    invitationId: string,
    actorUserId: string
  ): Promise<void>;
  inspect(tokenHash: string): Promise<InvitationIdentity>;
  claim(tokenHash: string): Promise<ClaimedInvitation>;
  complete(
    invitationId: string,
    claimId: string,
    userId: string
  ): Promise<void>;
  release(
    invitationId: string,
    claimId: string
  ): Promise<void>;
}

export interface InvitationAuthAdmin {
  createUser(input: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<{ userId: string }>;
}

export interface InvitationService {
  capabilities(actor: InvitationActor): AdminCapabilities;
  list(
    actor: InvitationActor
  ): Promise<readonly AdminInvitation[]>;
  create(
    actor: InvitationActor,
    input: CreateInvitationInput
  ): Promise<CreateInvitationResponse>;
  replace(
    actor: InvitationActor,
    invitationId: string
  ): Promise<CreateInvitationResponse>;
  revoke(
    actor: InvitationActor,
    invitationId: string
  ): Promise<void>;
  inspect(token: string): Promise<InspectInvitationResponse>;
  redeem(
    input: RedeemInvitationInput
  ): Promise<RedeemInvitationResponse>;
}

export function generateInvitationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const binary = Array.from(
    bytes,
    (byte) => String.fromCharCode(byte)
  ).join("");
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function hashInvitationToken(
  token: string
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

export function maskInvitationEmail(email: string): string {
  const separator = email.lastIndexOf("@");
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  const hiddenLength = Math.max(3, local.length - visible.length);
  return `${visible}${"*".repeat(hiddenLength)}@${domain}`;
}

function invitationCreationError(error: unknown): ApiError {
  if (
    error instanceof ApiError &&
    (error.code === "EMAIL_ALREADY_REGISTERED" ||
      error.code === "PASSWORD_POLICY_FAILED")
  ) {
    return error;
  }
  return new ApiError(
    "INVITATION_CREATE_FAILED",
    500,
    "ยังสร้างบัญชีไม่ได้ กรุณาลองใหม่"
  );
}

export function createInvitationService(options: {
  superAdminUserId: string;
  appOrigin: string;
  repository: InvitationRepository;
  authAdmin: InvitationAuthAdmin;
}): InvitationService {
  const appOrigin = options.appOrigin.replace(/\/+$/, "");

  function requireSuperAdmin(actor: InvitationActor) {
    if (actor.userId !== options.superAdminUserId) {
      throw new ApiError(
        "SUPER_ADMIN_REQUIRED",
        403,
        "ไม่มีสิทธิ์จัดการคำเชิญ"
      );
    }
  }

  async function tokenForInvitation() {
    const token = generateInvitationToken();
    return {
      token,
      tokenHash: await hashInvitationToken(token)
    };
  }

  function invitationUrl(token: string) {
    return `${appOrigin}/accept-invite#token=${token}`;
  }

  return {
    capabilities(actor) {
      return {
        canManageInvitations:
          actor.userId === options.superAdminUserId
      };
    },

    async list(actor) {
      requireSuperAdmin(actor);
      return options.repository.list();
    },

    async create(actor, input) {
      requireSuperAdmin(actor);
      const generated = await tokenForInvitation();
      const invitation = await options.repository.create({
        email: input.email,
        displayName: input.displayName,
        tokenHash: generated.tokenHash,
        createdBy: actor.userId
      });
      return {
        invitation,
        invitationUrl: invitationUrl(generated.token)
      };
    },

    async replace(actor, invitationId) {
      requireSuperAdmin(actor);
      const generated = await tokenForInvitation();
      const invitation = await options.repository.replace({
        invitationId,
        tokenHash: generated.tokenHash,
        actorUserId: actor.userId
      });
      return {
        invitation,
        invitationUrl: invitationUrl(generated.token)
      };
    },

    async revoke(actor, invitationId) {
      requireSuperAdmin(actor);
      await options.repository.revoke(
        invitationId,
        actor.userId
      );
    },

    async inspect(token) {
      const tokenHash = await hashInvitationToken(token);
      const identity = await options.repository.inspect(tokenHash);
      return {
        displayName: identity.displayName,
        maskedEmail: maskInvitationEmail(identity.email),
        status: "ready"
      };
    },

    async redeem(input) {
      const tokenHash = await hashInvitationToken(input.token);
      const claim = await options.repository.claim(tokenHash);
      let authUserCreated = false;

      try {
        const created = await options.authAdmin.createUser({
          email: claim.email,
          displayName: claim.displayName,
          password: input.password
        });
        authUserCreated = true;
        await options.repository.complete(
          claim.id,
          claim.claimId,
          created.userId
        );
        return { email: claim.email };
      } catch (error) {
        if (!authUserCreated) {
          await options.repository
            .release(claim.id, claim.claimId)
            .catch(() => undefined);
        }
        throw invitationCreationError(error);
      }
    }
  };
}

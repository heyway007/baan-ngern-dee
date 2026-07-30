import {
  apiErrorCodes,
  userProfileSchema,
  type ApiErrorCode,
  type UpdateProfileInput,
  type UserProfile
} from "@systems-credit/contracts";
import { z } from "zod";

import type { CloudAuth } from "./cloud-auth";

const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum(apiErrorCodes),
        message: z.string(),
        requestId: z.string()
      })
      .strict()
  })
  .strict();

const unauthenticatedMessage = "กรุณาเข้าสู่ระบบอีกครั้ง";
const profileLoadFailedMessage =
  "ไม่สามารถโหลดข้อมูลโปรไฟล์ได้ กรุณาลองใหม่";
const profileImageUploadFailedMessage =
  "ไม่สามารถอัปโหลดรูปโปรไฟล์ได้ กรุณาลองใหม่";

export interface ProfileApi {
  get(): Promise<UserProfile>;
  update(input: UpdateProfileInput): Promise<UserProfile>;
  replaceAvatar(file: Blob): Promise<UserProfile>;
  removeAvatar(): Promise<UserProfile>;
}

export class ProfileApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "ProfileApiFailure";
  }
}

function loadFailure(): ProfileApiFailure {
  return new ProfileApiFailure(
    "PROFILE_LOAD_FAILED",
    profileLoadFailedMessage
  );
}

function imageUploadFailure(): ProfileApiFailure {
  return new ProfileApiFailure(
    "PROFILE_IMAGE_UPLOAD_FAILED",
    profileImageUploadFailedMessage
  );
}

function unauthenticatedFailure(): ProfileApiFailure {
  return new ProfileApiFailure("UNAUTHENTICATED", unauthenticatedMessage);
}

async function errorFromResponse(
  response: Response,
  fallback: () => ProfileApiFailure
): Promise<ProfileApiFailure> {
  const parsed = apiErrorSchema.safeParse(
    await response.clone().json().catch(() => null)
  );
  if (parsed.success) {
    return new ProfileApiFailure(
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.requestId
    );
  }
  return response.status === 401 ? unauthenticatedFailure() : fallback();
}

export function createProfileApi(options: {
  auth: CloudAuth;
  fetch?: typeof fetch;
  onUnauthenticated(): void;
}): ProfileApi {
  const requestFetch = options.fetch ?? fetch;

  async function request(
    path: string,
    init: RequestInit,
    fallback: () => ProfileApiFailure
  ): Promise<UserProfile> {
    let session;
    try {
      session = await options.auth.getSession();
    } catch {
      throw fallback();
    }
    if (!session) {
      options.onUnauthenticated();
      throw unauthenticatedFailure();
    }

    const send = (accessToken: string) =>
      requestFetch(path, {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          ...init.headers
        }
      });

    let response: Response;
    try {
      response = await send(session.accessToken);
      if (response.status === 401) {
        session = await options.auth.refreshSession();
        if (!session) {
          options.onUnauthenticated();
          throw await errorFromResponse(response, fallback);
        }
        response = await send(session.accessToken);
      }
    } catch (error) {
      if (error instanceof ProfileApiFailure) {
        throw error;
      }
      throw fallback();
    }

    if (!response.ok) {
      if (response.status === 401) {
        options.onUnauthenticated();
      }
      throw await errorFromResponse(response, fallback);
    }

    const parsed = userProfileSchema.safeParse(
      await response.json().catch(() => null)
    );
    if (!parsed.success) {
      throw fallback();
    }
    return parsed.data;
  }

  return {
    get() {
      return request("/v1/profile", { method: "GET" }, loadFailure);
    },

    update(input) {
      return request(
        "/v1/profile",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: input.displayName })
        },
        loadFailure
      );
    },

    replaceAvatar(file) {
      return request(
        "/v1/profile/avatar",
        {
          method: "POST",
          headers: file.type ? { "content-type": file.type } : {},
          body: file
        },
        imageUploadFailure
      );
    },

    removeAvatar() {
      return request(
        "/v1/profile/avatar",
        { method: "DELETE" },
        loadFailure
      );
    }
  };
}

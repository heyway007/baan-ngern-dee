import { describe, expect, it } from "vitest";

import {
  PROFILE_AVATAR_MAX_BYTES,
  updateProfileSchema,
  userProfileSchema
} from "./profile";
import { apiErrorCodes } from "./errors";

describe("profile contracts", () => {
  it("trims a valid display name and rejects unknown fields", () => {
    expect(
      updateProfileSchema.parse({ displayName: "  New Name  " })
    ).toEqual({ displayName: "New Name" });
    expect(() =>
      updateProfileSchema.parse({
        displayName: "New Name",
        email: "replacement@example.test"
      })
    ).toThrow();
  });

  it("accepts email, LINE, and avatar fallback response shapes", () => {
    expect(
      userProfileSchema.parse({
        userId: "11111111-1111-4111-8111-111111111111",
        displayName: "Min",
        accountChannel: {
          kind: "email",
          label: "min@example.test"
        },
        avatar: { source: "initial", url: null }
      })
    ).toMatchObject({ displayName: "Min" });
    expect(PROFILE_AVATAR_MAX_BYTES).toBe(2_097_152);
  });

  it("includes the profile API error codes", () => {
    expect(apiErrorCodes).toEqual(
      expect.arrayContaining([
        "PROFILE_LOAD_FAILED",
        "PROFILE_NAME_INVALID",
        "PROFILE_IMAGE_TOO_LARGE",
        "PROFILE_IMAGE_UNSUPPORTED",
        "PROFILE_IMAGE_UPLOAD_FAILED"
      ])
    );
  });
});

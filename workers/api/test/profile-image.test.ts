import { PROFILE_AVATAR_MAX_BYTES } from "@systems-credit/contracts";
import { describe, expect, it } from "vitest";

import { validateProfileImage } from "../src/services/profile-image";

describe("validateProfileImage", () => {
  it.each([
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg", "jpg"],
    [
      new Uint8Array([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a
      ]),
      "image/png",
      "png"
    ],
    [
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46,
        0, 0, 0, 0,
        0x57, 0x45, 0x42, 0x50
      ]),
      "image/webp",
      "webp"
    ]
  ] as const)("detects %s", (bytes, contentType, extension) => {
    expect(validateProfileImage(bytes)).toMatchObject({
      contentType,
      extension
    });
  });

  it.each([
    ["zero bytes", new Uint8Array()],
    ["a GIF header", new Uint8Array([0x47, 0x49, 0x46, 0x38])]
  ])("rejects %s as unsupported", (_description, bytes) => {
    expect(() => validateProfileImage(bytes)).toThrow(
      expect.objectContaining({
        code: "PROFILE_IMAGE_UNSUPPORTED",
        status: 415
      })
    );
  });

  it("rejects an image exceeding the maximum byte length", () => {
    expect(() =>
      validateProfileImage(new Uint8Array(PROFILE_AVATAR_MAX_BYTES + 1))
    ).toThrow(
      expect.objectContaining({
        code: "PROFILE_IMAGE_TOO_LARGE",
        status: 413
      })
    );
  });
});

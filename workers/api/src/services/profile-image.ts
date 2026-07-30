import { PROFILE_AVATAR_MAX_BYTES } from "@systems-credit/contracts";

import { ApiError } from "../api-error";

export type ValidProfileImage = Readonly<{
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}>;

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function validateProfileImage(bytes: Uint8Array): ValidProfileImage {
  if (bytes.byteLength > PROFILE_AVATAR_MAX_BYTES) {
    throw new ApiError(
      "PROFILE_IMAGE_TOO_LARGE",
      413,
      "รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MB"
    );
  }

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { bytes, contentType: "image/jpeg", extension: "jpg" };
  }

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { bytes, contentType: "image/png", extension: "png" };
  }

  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return { bytes, contentType: "image/webp", extension: "webp" };
  }

  throw new ApiError(
    "PROFILE_IMAGE_UNSUPPORTED",
    415,
    "รองรับเฉพาะรูป JPG, PNG และ WebP"
  );
}

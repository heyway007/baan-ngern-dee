export type SlipImageMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

const MAX_IMAGE_BYTES = 5_000_000;

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function detectedMime(bytes: Uint8Array): SlipImageMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp";
  }
  return null;
}

export function validateSlipImage(
  bytes: Uint8Array,
  claimedMime: string
): Readonly<{ bytes: Uint8Array; mime: SlipImageMime }> {
  if (!bytes.length) throw new Error("IMAGE_EMPTY");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("IMAGE_TOO_LARGE");
  }
  const mime = detectedMime(bytes);
  if (!mime) throw new Error("IMAGE_UNSUPPORTED");
  if (mime !== claimedMime) throw new Error("MIME_MISMATCH");
  return { bytes, mime };
}

export async function sha256Hex(bytes: Uint8Array | string) {
  const value =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(value)
  );
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

import { z } from "zod";

const claimsSchema = z
  .object({
    userId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    imageSha256: z.string().regex(/^[0-9a-f]{64}$/),
    documentIdentitySha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    documentKind: z.enum(["bank_transfer", "receipt"]),
    exp: z.number().int().positive()
  })
  .strict();

export type SlipAnalysisClaims = z.infer<typeof claimsSchema>;
type NewClaims = Omit<SlipAnalysisClaims, "exp">;
export type IssuedSlipAnalysisToken = Readonly<{
  token: string;
  expiresAt: string;
}>;

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export type SlipAnalysisTokenCodec = Readonly<{
  issue(claims: NewClaims): Promise<IssuedSlipAnalysisToken>;
  verify(
    token: string,
    expected: Readonly<{ userId: string; workspaceId: string }>
  ): Promise<SlipAnalysisClaims>;
}>;

export function createSlipAnalysisTokenCodec(
  secret: string,
  now: () => number = () => Math.floor(Date.now() / 1000)
): SlipAnalysisTokenCodec {
  if (secret.length < 32) throw new Error("TOKEN_SECRET_TOO_SHORT");
  const encoder = new TextEncoder();
  const keyPromise = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  return {
    async issue(input) {
      const expiresAtSeconds = now() + 1800;
      const payload = base64Url(
        encoder.encode(JSON.stringify({ ...input, exp: expiresAtSeconds }))
      );
      const signature = await crypto.subtle.sign(
        "HMAC",
        await keyPromise,
        encoder.encode(payload)
      );
      return {
        token: `${payload}.${base64Url(new Uint8Array(signature))}`,
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
      };
    },
    async verify(token, expected) {
      const [payload, signature, extra] = token.split(".");
      if (!payload || !signature || extra) throw new Error("TOKEN_INVALID");
      const valid = await crypto.subtle.verify(
        "HMAC",
        await keyPromise,
        decodeBase64Url(signature),
        encoder.encode(payload)
      );
      if (!valid) throw new Error("TOKEN_INVALID");
      const claims = claimsSchema.parse(
        JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)))
      );
      if (
        claims.userId !== expected.userId ||
        claims.workspaceId !== expected.workspaceId
      ) {
        throw new Error("TOKEN_SCOPE_INVALID");
      }
      if (claims.exp < now()) throw new Error("TOKEN_EXPIRED");
      return claims;
    }
  };
}

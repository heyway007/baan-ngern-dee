import { describe, expect, it } from "vitest";

import {
  adminCapabilitiesSchema,
  adminInvitationSchema,
  createInvitationSchema,
  inspectInvitationSchema,
  redeemInvitationSchema
} from "../src";

describe("invitation contracts", () => {
  it("normalizes the recipient identity before creating an invitation", () => {
    expect(
      createInvitationSchema.parse({
        email: "  PERSON@EXAMPLE.COM ",
        displayName: "  Person  "
      })
    ).toEqual({
      email: "person@example.com",
      displayName: "Person"
    });
  });

  it("rejects a redemption password shorter than eight characters", () => {
    expect(
      redeemInvitationSchema.safeParse({
        token: "a".repeat(43),
        password: "short"
      }).success
    ).toBe(false);
  });

  it("accepts only base64url-shaped invitation tokens", () => {
    expect(
      inspectInvitationSchema.safeParse({
        token: "a".repeat(43)
      }).success
    ).toBe(true);
    expect(
      inspectInvitationSchema.safeParse({
        token: "not+a/token="
      }).success
    ).toBe(false);
  });

  it("parses sanitized capability and invitation responses", () => {
    expect(
      adminCapabilitiesSchema.parse({
        canManageInvitations: true
      })
    ).toEqual({ canManageInvitations: true });

    expect(
      adminInvitationSchema.parse({
        id: "93b2ea61-500a-4db3-bb62-1246049bdf7a",
        email: "person@example.com",
        displayName: "Person",
        status: "ready",
        createdAt: "2026-07-27T10:00:00.000Z",
        expiresAt: "2026-07-28T10:00:00.000Z"
      })
    ).toEqual({
      id: "93b2ea61-500a-4db3-bb62-1246049bdf7a",
      email: "person@example.com",
      displayName: "Person",
      status: "ready",
      createdAt: "2026-07-27T10:00:00.000Z",
      expiresAt: "2026-07-28T10:00:00.000Z"
    });
  });
});

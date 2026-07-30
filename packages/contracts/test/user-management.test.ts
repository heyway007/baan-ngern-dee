import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  adminUserListResponseSchema,
  deleteAdminUserSchema,
  listAdminUsersQuerySchema
} from "../src";

describe("user management contracts", () => {
  it("normalizes user search and coerces a bounded page size", () => {
    expect(
      listAdminUsersQuerySchema.parse({
        search: "  Friend@Example.COM ",
        limit: "25",
        cursor:
          "2026-07-28T10:00:00.000Z|00000000-0000-4000-8000-000000000001"
      })
    ).toEqual({
      search: "friend@example.com",
      limit: 25,
      cursor:
        "2026-07-28T10:00:00.000Z|00000000-0000-4000-8000-000000000001"
    });

    expect(
      listAdminUsersQuerySchema.safeParse({
        search: "",
        limit: "51"
      }).success
    ).toBe(false);
  });

  it("accepts a normalized email or exact user UUID for deletion confirmation", () => {
    expect(
      deleteAdminUserSchema.parse({
        confirmation: " FRIEND@Example.com ",
        clientMutationId:
          "00000000-0000-4000-8000-000000000002"
      })
    ).toEqual({
      confirmation: "friend@example.com",
      clientMutationId:
        "00000000-0000-4000-8000-000000000002"
    });

    expect(
      deleteAdminUserSchema.parse({
        confirmation:
          "00000000-0000-4000-8000-000000000003",
        clientMutationId:
          "00000000-0000-4000-8000-000000000002"
      })
    ).toEqual({
      confirmation:
        "00000000-0000-4000-8000-000000000003",
      clientMutationId:
        "00000000-0000-4000-8000-000000000002"
    });

    expect(() =>
      deleteAdminUserSchema.parse({
        confirmation: "not-an-email-or-uuid",
        clientMutationId: "not-a-uuid",
        password: "must-not-be-accepted"
      })
    ).toThrowError(z.ZodError);
  });

  it("parses only the sanitized admin user read model", () => {
    expect(
      adminUserListResponseSchema.parse({
        users: [
          {
            userId:
              "00000000-0000-4000-8000-000000000003",
            email: "friend@example.com",
            displayName: "Friend",
            status: "deletion_pending",
            createdAt: "2026-07-28T10:00:00.000Z",
            privateWorkspaceCount: 1,
            deletionPending: true
          }
        ],
        nextCursor: null
      })
    ).toEqual({
      users: [
        {
          userId:
            "00000000-0000-4000-8000-000000000003",
          email: "friend@example.com",
          displayName: "Friend",
          status: "deletion_pending",
          createdAt: "2026-07-28T10:00:00.000Z",
          privateWorkspaceCount: 1,
          deletionPending: true
        }
      ],
      nextCursor: null
    });
  });

  it("parses an email-less LINE user without inventing an email", () => {
    expect(
      adminUserListResponseSchema.parse({
        users: [
          {
            userId:
              "00000000-0000-4000-8000-000000000004",
            displayName: "มิน LINE",
            status: "active",
            createdAt: "2026-07-30T10:00:00.000Z",
            privateWorkspaceCount: 1,
            deletionPending: false
          }
        ],
        nextCursor: null
      })
    ).toEqual({
      users: [
        {
          userId:
            "00000000-0000-4000-8000-000000000004",
          displayName: "มิน LINE",
          status: "active",
          createdAt: "2026-07-30T10:00:00.000Z",
          privateWorkspaceCount: 1,
          deletionPending: false
        }
      ],
      nextCursor: null
    });
  });
});

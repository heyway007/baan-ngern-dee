import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api-error";
import {
  createSupabaseProfileGateway
} from "../src/services/supabase-profile-gateway";

const serviceRoleKey = "service-role-secret";
const config = {
  url: "https://project.supabase.co/",
  serviceRoleKey
};
const userId = "11111111-1111-4111-8111-111111111111";

function headersAt(
  requestFetch: ReturnType<typeof vi.fn<typeof fetch>>,
  callIndex = 0
): Headers {
  return new Headers(requestFetch.mock.calls[callIndex]![1]?.headers);
}

function expectAdminHeaders(headers: Headers): void {
  expect(headers.get("apikey")).toBe(serviceRoleKey);
  expect(headers.get("authorization")).toBe(
    `Bearer ${serviceRoleKey}`
  );
}

describe("Supabase profile gateway", () => {
  it("reads one strict profile row with the exact PostgREST query", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([
        {
          display_name: "Mint Profile",
          avatar_path: `${userId}/avatar.png`
        }
      ])
    );
    const gateway = createSupabaseProfileGateway({
      ...config,
      fetch: requestFetch
    });

    await expect(gateway.readProfile(userId)).resolves.toEqual({
      displayName: "Mint Profile",
      avatarPath: `${userId}/avatar.png`
    });
    expect(requestFetch).toHaveBeenCalledWith(
      `https://project.supabase.co/rest/v1/profiles?id=eq.${userId}&select=display_name,avatar_path&limit=1`,
      expect.objectContaining({ method: "GET" })
    );
    expectAdminHeaders(headersAt(requestFetch));
  });

  it.each([
    ["display_name", "  Mint Display  ", "Mint Display"],
    ["name", "Mint Name", "Mint Name"],
    ["full_name", "Mint Full", "Mint Full"],
    [
      "preferred_username",
      `  ${"m".repeat(90)}  `,
      "m".repeat(80)
    ]
  ])(
    "uses Auth user_metadata.%s as the fallback display name",
    async (metadataKey, metadataValue, expectedName) => {
      const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          email: null,
          user_metadata: {
            [metadataKey]: metadataValue
          }
        })
      );
      const gateway = createSupabaseProfileGateway({
        ...config,
        fetch: requestFetch
      });

      await expect(gateway.readIdentity(userId)).resolves.toEqual({
        fallbackDisplayName: expectedName
      });
      expect(requestFetch.mock.calls[0]![0]).toBe(
        `https://project.supabase.co/auth/v1/admin/users/${userId}`
      );
      expect(requestFetch.mock.calls[0]![1]?.method).toBe("GET");
      expectAdminHeaders(headersAt(requestFetch));
    }
  );

  it.each([
    ["avatar_url", "https://line.example.test/avatar-one"],
    ["picture", "https://line.example.test/avatar-two"]
  ])(
    "normalizes Auth email and LINE %s metadata",
    async (avatarKey, avatarUrl) => {
      const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          email: "MINT@EXAMPLE.TEST",
          user_metadata: {
            [avatarKey]: `  ${avatarUrl}  `
          }
        })
      );
      const gateway = createSupabaseProfileGateway({
        ...config,
        fetch: requestFetch
      });

      await expect(gateway.readIdentity(userId)).resolves.toEqual({
        email: "mint@example.test",
        fallbackDisplayName: "mint",
        lineAvatarUrl: avatarUrl
      });
    }
  );

  it("uses the LINE label only when Auth has no usable name or email", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        email: null,
        user_metadata: {
          display_name: " ",
          name: 42,
          full_name: "",
          preferred_username: null
        }
      })
    );
    const gateway = createSupabaseProfileGateway({
      ...config,
      fetch: requestFetch
    });

    await expect(gateway.readIdentity(userId)).resolves.toEqual({
      fallbackDisplayName: "ผู้ใช้ LINE"
    });
  });

  it("accepts the empty email returned for a LINE identity", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        email: "",
        user_metadata: {
          email_verified: false,
          name: "New'Waranchai",
          phone_verified: false,
          picture: "https://line.example.test/avatar",
          sub: "line-user-id"
        }
      })
    );
    const gateway = createSupabaseProfileGateway({
      ...config,
      fetch: requestFetch
    });

    await expect(gateway.readIdentity(userId)).resolves.toEqual({
      fallbackDisplayName: "New'Waranchai",
      lineAvatarUrl: "https://line.example.test/avatar"
    });
  });

  it("patches only the requested profile field with a minimal response", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const gateway = createSupabaseProfileGateway({
      ...config,
      fetch: requestFetch
    });
    const avatarPath = `${userId}/new avatar.png`;

    await gateway.updateDisplayName(userId, "Mint New");
    await gateway.updateAvatarPath(userId, avatarPath);
    await gateway.updateAvatarPath(userId, null);

    expect(requestFetch).toHaveBeenCalledTimes(3);
    for (const [index, expectedBody] of [
      [0, { display_name: "Mint New" }],
      [1, { avatar_path: avatarPath }],
      [2, { avatar_path: null }]
    ] as const) {
      expect(requestFetch.mock.calls[index]![0]).toBe(
        `https://project.supabase.co/rest/v1/profiles?id=eq.${userId}`
      );
      expect(requestFetch.mock.calls[index]![1]?.method).toBe("PATCH");
      expect(
        JSON.parse(
          String(requestFetch.mock.calls[index]![1]?.body)
        )
      ).toEqual(expectedBody);
      const headers = headersAt(requestFetch, index);
      expectAdminHeaders(headers);
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("prefer")).toBe("return=minimal");
    }
  });

  it("uploads raw bytes to the segment-encoded private Storage path", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const gateway = createSupabaseProfileGateway({
      ...config,
      fetch: requestFetch
    });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    await gateway.uploadAvatar({
      path: `${userId}/new avatar?#.png`,
      bytes,
      contentType: "image/png"
    });

    expect(requestFetch.mock.calls[0]![0]).toBe(
      `https://project.supabase.co/storage/v1/object/profile-avatars/${userId}/new%20avatar%3F%23.png`
    );
    expect(requestFetch.mock.calls[0]![1]?.method).toBe("POST");
    expect(requestFetch.mock.calls[0]![1]?.body).toBe(bytes);
    const headers = headersAt(requestFetch);
    expectAdminHeaders(headers);
    expect(headers.get("content-type")).toBe("image/png");
    expect(headers.get("cache-control")).toBe("max-age=3600");
    expect(headers.get("x-upsert")).toBe("false");
  });

  it("signs the encoded private path and returns an absolute safe URL", async () => {
    const signedPath =
      `/storage/v1/object/sign/profile-avatars/${userId}/avatar%20%231.png?token=abc`;
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ signedURL: signedPath })
    );
    const gateway = createSupabaseProfileGateway({
      ...config,
      fetch: requestFetch
    });

    await expect(
      gateway.signAvatar(`${userId}/avatar #1.png`, 86_400)
    ).resolves.toBe(`https://project.supabase.co${signedPath}`);
    expect(requestFetch.mock.calls[0]![0]).toBe(
      `https://project.supabase.co/storage/v1/object/sign/profile-avatars/${userId}/avatar%20%231.png`
    );
    expect(requestFetch.mock.calls[0]![1]?.method).toBe("POST");
    expect(
      JSON.parse(String(requestFetch.mock.calls[0]![1]?.body))
    ).toEqual({ expiresIn: 86_400 });
    const headers = headersAt(requestFetch);
    expectAdminHeaders(headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it.each([
    [
      "Storage-root-relative",
      `/object/sign/profile-avatars/${userId}/avatar.png?token=storage-root-token`,
      `https://project.supabase.co/storage/v1/object/sign/profile-avatars/${userId}/avatar.png?token=storage-root-token`
    ],
    [
      "Storage-path-relative",
      `object/sign/profile-avatars/${userId}/avatar.png?token=storage-path-token`,
      `https://project.supabase.co/storage/v1/object/sign/profile-avatars/${userId}/avatar.png?token=storage-path-token`
    ],
    [
      "path-relative",
      `storage/v1/object/sign/profile-avatars/${userId}/avatar.png?token=path-token`,
      `https://project.supabase.co/storage/v1/object/sign/profile-avatars/${userId}/avatar.png?token=path-token`
    ],
    [
      "same-origin absolute",
      `https://project.supabase.co/storage/v1/object/sign/profile-avatars/${userId}/avatar.png?token=absolute-token`,
      `https://project.supabase.co/storage/v1/object/sign/profile-avatars/${userId}/avatar.png?token=absolute-token`
    ]
  ])(
    "preserves a legitimate %s Supabase signed URL",
    async (_format, signedURL, expectedUrl) => {
      const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ signedURL })
      );
      const gateway = createSupabaseProfileGateway({
        ...config,
        fetch: requestFetch
      });

      await expect(
        gateway.signAvatar(`${userId}/avatar.png`, 86_400)
      ).resolves.toBe(expectedUrl);
    }
  );

  it.each([
    [
      "cross-origin absolute URL",
      `https://attacker.example/storage/v1/object/sign/profile-avatars/${userId}/avatar.png?token=${serviceRoleKey}`
    ],
    [
      "cross-origin network-path URL",
      `//attacker.example/storage/v1/object/sign/profile-avatars/${userId}/avatar.png?token=${serviceRoleKey}`
    ],
    [
      "HTTPS-to-HTTP downgrade",
      `http://project.supabase.co/storage/v1/object/sign/profile-avatars/${userId}/avatar.png?token=${serviceRoleKey}`
    ],
    [
      "wrong private object path",
      `https://project.supabase.co/storage/v1/object/sign/profile-avatars/${userId}/other.png?token=${serviceRoleKey}`
    ],
    [
      "wrong Storage route",
      `https://project.supabase.co/storage/v1/object/public/profile-avatars/${userId}/avatar.png?token=${serviceRoleKey}`
    ]
  ])(
    "rejects a signed response with a %s",
    async (_case, signedURL) => {
      const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ signedURL })
      );
      const gateway = createSupabaseProfileGateway({
        ...config,
        fetch: requestFetch
      });

      const error = await gateway
        .signAvatar(`${userId}/avatar.png`, 86_400)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        code: "PROFILE_LOAD_FAILED",
        status: 500
      });
      expect(String((error as Error).message)).not.toContain(
        serviceRoleKey
      );
      expect(String((error as Error).message)).not.toContain(
        "attacker.example"
      );
    }
  );

  it("deletes an exact private Storage object prefix", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const gateway = createSupabaseProfileGateway({
      ...config,
      fetch: requestFetch
    });
    const path = `${userId}/old avatar.png`;

    await gateway.deleteAvatar(path);

    expect(requestFetch.mock.calls[0]![0]).toBe(
      "https://project.supabase.co/storage/v1/object/profile-avatars"
    );
    expect(requestFetch.mock.calls[0]![1]?.method).toBe("DELETE");
    expect(
      JSON.parse(String(requestFetch.mock.calls[0]![1]?.body))
    ).toEqual({ prefixes: [path] });
    const headers = headersAt(requestFetch);
    expectAdminHeaders(headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it.each([
    {
      name: "a strict profile row",
      response: Response.json([
        {
          display_name: "Mint",
          avatar_path: null,
          private_note: "must not be accepted"
        }
      ]),
      invoke: (gateway: ReturnType<
        typeof createSupabaseProfileGateway
      >) => gateway.readProfile(userId),
      code: "PROFILE_LOAD_FAILED"
    },
    {
      name: "an Auth identity",
      response: Response.json({
        email: "not-an-email",
        user_metadata: {}
      }),
      invoke: (gateway: ReturnType<
        typeof createSupabaseProfileGateway
      >) => gateway.readIdentity(userId),
      code: "PROFILE_LOAD_FAILED"
    },
    {
      name: "a signed URL",
      response: Response.json({
        signedURL: "javascript:alert(service-role-secret)"
      }),
      invoke: (gateway: ReturnType<
        typeof createSupabaseProfileGateway
      >) => gateway.signAvatar(`${userId}/avatar.png`, 86_400),
      code: "PROFILE_LOAD_FAILED"
    },
    {
      name: "a whitespace-only signed URL",
      response: Response.json({
        signedURL: "   "
      }),
      invoke: (gateway: ReturnType<
        typeof createSupabaseProfileGateway
      >) => gateway.signAvatar(`${userId}/avatar.png`, 86_400),
      code: "PROFILE_LOAD_FAILED"
    }
  ])(
    "maps a malformed $name response to a secret-free ApiError",
    async ({ response, invoke, code }) => {
      const requestFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response);
      const gateway = createSupabaseProfileGateway({
        ...config,
        fetch: requestFetch
      });

      const error = await invoke(gateway).catch(
        (caught: unknown) => caught
      );

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code, status: 500 });
      expect(String((error as Error).message)).not.toContain(
        serviceRoleKey
      );
    }
  );

  it.each([
    {
      name: "PostgREST",
      invoke: (gateway: ReturnType<
        typeof createSupabaseProfileGateway
      >) => gateway.updateDisplayName(userId, "Mint"),
      code: "PROFILE_LOAD_FAILED"
    },
    {
      name: "Storage",
      invoke: (gateway: ReturnType<
        typeof createSupabaseProfileGateway
      >) =>
        gateway.uploadAvatar({
          path: `${userId}/avatar.png`,
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "image/png"
        }),
      code: "PROFILE_IMAGE_UPLOAD_FAILED"
    }
  ])(
    "maps an unsuccessful $name response to a secret-free ApiError",
    async ({ invoke, code }) => {
      const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { message: `upstream exposed ${serviceRoleKey}` },
          { status: 500 }
        )
      );
      const gateway = createSupabaseProfileGateway({
        ...config,
        fetch: requestFetch
      });

      const error = await invoke(gateway).catch(
        (caught: unknown) => caught
      );

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code, status: 500 });
      expect(String((error as Error).message)).not.toContain(
        serviceRoleKey
      );
    }
  );

  it("maps fetch failures without exposing a thrown service key", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`network ${serviceRoleKey}`));
    const gateway = createSupabaseProfileGateway({
      ...config,
      fetch: requestFetch
    });

    const error = await gateway
      .readProfile(userId)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "PROFILE_LOAD_FAILED",
      status: 500
    });
    expect(String((error as Error).message)).not.toContain(
      serviceRoleKey
    );
  });
});

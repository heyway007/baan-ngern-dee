import assert from "node:assert/strict";
import test from "node:test";

import { provisionRichMenu } from "./provision-line-rich-menu.mjs";
import { validateRichMenu } from "./validate-line-rich-menu.mjs";

const ORIGIN = "https://baan-ngern-dee.workplatform.workers.dev";
const ACCESS_TOKEN = "line-secret-token-for-tests";

const validDefinition = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "baan-ngern-dee-default-v1",
  chatBarText: "เมนูบ้านเงินดี",
  areas: [
    {
      bounds: { x: 0, y: 0, width: 834, height: 843 },
      action: {
        type: "uri",
        label: "ภาพรวม",
        uri: `${ORIGIN}/line?next=%2Foverview`,
      },
    },
    {
      bounds: { x: 834, y: 0, width: 833, height: 843 },
      action: {
        type: "uri",
        label: "เพิ่มรายรับ",
        uri: `${ORIGIN}/line?next=%2Ftransactions%2Fnew%3Ftype%3Dincome`,
      },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: {
        type: "uri",
        label: "เพิ่มรายจ่าย",
        uri: `${ORIGIN}/line?next=%2Ftransactions%2Fnew%3Ftype%3Dexpense`,
      },
    },
    {
      bounds: { x: 0, y: 843, width: 834, height: 843 },
      action: {
        type: "uri",
        label: "บัญชี",
        uri: `${ORIGIN}/line?next=%2Faccounts`,
      },
    },
    {
      bounds: { x: 834, y: 843, width: 833, height: 843 },
      action: {
        type: "uri",
        label: "ผ่อนและหนี้",
        uri: `${ORIGIN}/line?next=%2Finstallments`,
      },
    },
    {
      bounds: { x: 1667, y: 843, width: 833, height: 843 },
      action: {
        type: "message",
        label: "สอบถามเรา",
        text: "สอบถามเรา",
      },
    },
  ],
};

function makePng(width = 2500, height = 1686, byteLength = 33) {
  const bytes = Buffer.alloc(byteLength);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function cloneDefinition() {
  return structuredClone(validDefinition);
}

test("accepts the exact six-area LINE rich-menu definition", () => {
  assert.deepEqual(validateRichMenu(cloneDefinition(), makePng()), {
    width: 2500,
    height: 1686,
    bytes: 33,
  });
});

test("rejects overlapping rich-menu areas", () => {
  const definition = cloneDefinition();
  definition.areas[1].bounds.x = 800;

  assert.throws(
    () => validateRichMenu(definition, makePng()),
    /overlap/i,
  );
});

test("rejects a full-coverage grid with an altered tap boundary", () => {
  const definition = cloneDefinition();
  definition.areas[0].bounds.width = 835;
  definition.areas[1].bounds.x = 835;
  definition.areas[1].bounds.width = 832;

  assert.throws(
    () => validateRichMenu(definition, makePng()),
    /exact bounds/i,
  );
});

test("rejects an area outside the image bounds", () => {
  const definition = cloneDefinition();
  definition.areas[5].bounds.width = 834;

  assert.throws(
    () => validateRichMenu(definition, makePng()),
    /bounds/i,
  );
});

test("rejects a definition with fewer than six areas", () => {
  const definition = cloneDefinition();
  definition.areas.pop();

  assert.throws(
    () => validateRichMenu(definition, makePng()),
    /six areas/i,
  );
});

test("rejects a PNG with incorrect dimensions", () => {
  assert.throws(
    () => validateRichMenu(cloneDefinition(), makePng(2499, 1686)),
    /2500x1686/,
  );
});

test("rejects a PNG larger than one megabyte", () => {
  assert.throws(
    () =>
      validateRichMenu(
        cloneDefinition(),
        makePng(2500, 1686, 1_048_577),
      ),
    /1048576/,
  );
});

function successfulResponseFor(url) {
  if (url === "https://api.line.me/v2/bot/richmenu") {
    return Response.json({ richMenuId: "richmenu-test" });
  }
  return new Response(null, { status: 200 });
}

test("provisions the LINE rich menu in validate, create, upload, default order", async () => {
  const calls = [];
  const pngBytes = makePng();
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    return successfulResponseFor(url);
  };

  const result = await provisionRichMenu({
    accessToken: ACCESS_TOKEN,
    definition: cloneDefinition(),
    pngBytes,
    fetchImpl,
  });

  assert.deepEqual(result, { richMenuId: "richmenu-test" });
  assert.deepEqual(
    calls.map(({ url, method }) => [method, url]),
    [
      ["POST", "https://api.line.me/v2/bot/richmenu/validate"],
      ["POST", "https://api.line.me/v2/bot/richmenu"],
      [
        "POST",
        "https://api-data.line.me/v2/bot/richmenu/richmenu-test/content",
      ],
      [
        "POST",
        "https://api.line.me/v2/bot/user/all/richmenu/richmenu-test",
      ],
    ],
  );
  for (const call of calls) {
    assert.equal(call.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  }
  assert.equal(calls[0].headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].body), validDefinition);
  assert.equal(calls[1].headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[1].body), validDefinition);
  assert.equal(calls[2].headers["content-type"], "image/png");
  assert.strictEqual(calls[2].body, pngBytes);
});

for (const failure of [
  {
    name: "upload",
    url: "https://api-data.line.me/v2/bot/richmenu/richmenu-test/content",
    status: 503,
  },
  {
    name: "default",
    url: "https://api.line.me/v2/bot/user/all/richmenu/richmenu-test",
    status: 429,
  },
]) {
  test(`${failure.name} failure deletes the newly created rich menu`, async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, ...options });
      if (url === failure.url) {
        return new Response(null, { status: failure.status });
      }
      return successfulResponseFor(url);
    };

    await assert.rejects(
      provisionRichMenu({
        accessToken: ACCESS_TOKEN,
        definition: cloneDefinition(),
        pngBytes: makePng(),
        fetchImpl,
      }),
      new RegExp(`${failure.name}.*${failure.status}`, "i"),
    );

    assert.deepEqual(
      calls.at(-1) && [calls.at(-1).method, calls.at(-1).url],
      [
        "DELETE",
        "https://api.line.me/v2/bot/richmenu/richmenu-test",
      ],
    );
  });
}

test("provisioning errors never expose the channel access token", async () => {
  const fetchImpl = async () =>
    new Response(`upstream accidentally echoed ${ACCESS_TOKEN}`, {
      status: 401,
    });

  await assert.rejects(
    provisionRichMenu({
      accessToken: ACCESS_TOKEN,
      definition: cloneDefinition(),
      pngBytes: makePng(),
      fetchImpl,
    }),
    (error) => {
      assert.equal(error.message.includes(ACCESS_TOKEN), false);
      assert.match(error.message, /validate.*401/i);
      return true;
    },
  );
});

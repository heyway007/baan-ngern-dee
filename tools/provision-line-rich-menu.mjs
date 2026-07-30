import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { validateRichMenu } from "./validate-line-rich-menu.mjs";

const API_ORIGIN = "https://api.line.me";
const DATA_API_ORIGIN = "https://api-data.line.me";

function phaseError(phase, status) {
  return new Error(`LINE rich-menu ${phase} failed (${status}).`);
}

async function send(fetchImpl, url, options, phase) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch {
    throw phaseError(phase, "network");
  }
  if (!response.ok) {
    throw phaseError(phase, response.status);
  }
  return response;
}

export async function provisionRichMenu({
  accessToken,
  definition,
  pngBytes,
  fetchImpl = fetch,
}) {
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("A LINE channel access token is required.");
  }
  validateRichMenu(definition, pngBytes);

  const authorization = { Authorization: `Bearer ${accessToken}` };
  const jsonHeaders = {
    ...authorization,
    "content-type": "application/json",
  };
  const definitionBody = JSON.stringify(definition);

  await send(
    fetchImpl,
    `${API_ORIGIN}/v2/bot/richmenu/validate`,
    { method: "POST", headers: jsonHeaders, body: definitionBody },
    "validate",
  );

  const createResponse = await send(
    fetchImpl,
    `${API_ORIGIN}/v2/bot/richmenu`,
    { method: "POST", headers: jsonHeaders, body: definitionBody },
    "create",
  );

  let richMenuId;
  try {
    ({ richMenuId } = await createResponse.json());
  } catch {
    throw phaseError("create", "invalid response");
  }
  if (
    typeof richMenuId !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(richMenuId)
  ) {
    throw phaseError("create", "invalid response");
  }

  const cleanup = async () => {
    try {
      await fetchImpl(`${API_ORIGIN}/v2/bot/richmenu/${richMenuId}`, {
        method: "DELETE",
        headers: authorization,
      });
    } catch {
      // Cleanup is best-effort; preserve the bounded original phase error.
    }
  };

  try {
    await send(
      fetchImpl,
      `${DATA_API_ORIGIN}/v2/bot/richmenu/${richMenuId}/content`,
      {
        method: "POST",
        headers: { ...authorization, "content-type": "image/png" },
        body: pngBytes,
      },
      "upload",
    );

    await send(
      fetchImpl,
      `${API_ORIGIN}/v2/bot/user/all/richmenu/${richMenuId}`,
      { method: "POST", headers: authorization },
      "default",
    );
  } catch (error) {
    await cleanup();
    throw error;
  }

  return { richMenuId };
}

async function main() {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("Set LINE_CHANNEL_ACCESS_TOKEN in the current shell.");
  }

  const root = new URL("../", import.meta.url);
  const [definitionText, pngBytes] = await Promise.all([
    readFile(new URL("ops/line/rich-menu.json", root), "utf8"),
    readFile(new URL("apps/web/public/line/rich-menu.png", root)),
  ]);
  const result = await provisionRichMenu({
    accessToken,
    definition: JSON.parse(definitionText),
    pngBytes,
  });
  console.log(`Rich menu provisioned: ${result.richMenuId}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Provisioning failed.");
    process.exitCode = 1;
  });
}

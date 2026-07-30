import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const EXPECTED_WIDTH = 2500;
const EXPECTED_HEIGHT = 1686;
const MAX_PNG_BYTES = 1_048_576;
const EXPECTED_NAME = "baan-ngern-dee-default-v1";
const EXPECTED_CHAT_BAR_TEXT = "เมนูบ้านเงินดี";
const PRODUCTION_ORIGIN =
  "https://baan-ngern-dee.newforico-9ea.workers.dev";
const EXPECTED_DESTINATIONS = [
  "/overview",
  "/transactions/new?type=income",
  "/transactions/new?type=expense",
  "/accounts",
  "/installments",
];
const EXPECTED_LABELS = [
  "ภาพรวม",
  "เพิ่มรายรับ",
  "เพิ่มรายจ่าย",
  "บัญชี",
  "ผ่อนและหนี้",
  "สอบถามเรา",
];
const EXPECTED_BOUNDS = [
  { x: 0, y: 0, width: 834, height: 843 },
  { x: 834, y: 0, width: 833, height: 843 },
  { x: 1667, y: 0, width: 833, height: 843 },
  { x: 0, y: 843, width: 834, height: 843 },
  { x: 834, y: 843, width: 833, height: 843 },
  { x: 1667, y: 843, width: 833, height: 843 },
];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fail(message) {
  throw new Error(`Invalid LINE rich menu: ${message}`);
}

function readPngSize(pngBytes) {
  if (!Buffer.isBuffer(pngBytes) || pngBytes.length < 24) {
    fail("PNG bytes are missing or truncated.");
  }
  if (!pngBytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail("PNG signature is invalid.");
  }
  if (
    pngBytes.readUInt32BE(8) !== 13 ||
    pngBytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    fail("PNG IHDR is invalid.");
  }
  return {
    width: pngBytes.readUInt32BE(16),
    height: pngBytes.readUInt32BE(20),
  };
}

function rectanglesOverlap(left, right) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function validateGeometry(definition) {
  if (
    definition?.size?.width !== EXPECTED_WIDTH ||
    definition?.size?.height !== EXPECTED_HEIGHT
  ) {
    fail("JSON size must be 2500x1686.");
  }
  if (!Array.isArray(definition.areas) || definition.areas.length !== 6) {
    fail("definition must contain exactly six areas.");
  }

  let coveredArea = 0;
  for (let index = 0; index < definition.areas.length; index += 1) {
    const bounds = definition.areas[index]?.bounds;
    if (
      !bounds ||
      !Number.isInteger(bounds.x) ||
      !Number.isInteger(bounds.y) ||
      !Number.isInteger(bounds.width) ||
      !Number.isInteger(bounds.height) ||
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      fail(`area ${index + 1} bounds must be positive integers.`);
    }
    if (
      bounds.x + bounds.width > EXPECTED_WIDTH ||
      bounds.y + bounds.height > EXPECTED_HEIGHT
    ) {
      fail(`area ${index + 1} is outside the image bounds.`);
    }
    for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
      if (
        rectanglesOverlap(
          bounds,
          definition.areas[otherIndex].bounds,
        )
      ) {
        fail(`areas ${otherIndex + 1} and ${index + 1} overlap.`);
      }
    }
    coveredArea += bounds.width * bounds.height;
  }

  if (coveredArea !== EXPECTED_WIDTH * EXPECTED_HEIGHT) {
    fail("the six areas must cover every pixel exactly once.");
  }

  for (let index = 0; index < EXPECTED_BOUNDS.length; index += 1) {
    const bounds = definition.areas[index].bounds;
    const expected = EXPECTED_BOUNDS[index];
    if (
      bounds.x !== expected.x ||
      bounds.y !== expected.y ||
      bounds.width !== expected.width ||
      bounds.height !== expected.height
    ) {
      fail(`area ${index + 1} must use the exact bounds.`);
    }
  }
}

function validateActions(definition) {
  for (let index = 0; index < 5; index += 1) {
    const action = definition.areas[index]?.action;
    if (action?.type !== "uri" || action.label !== EXPECTED_LABELS[index]) {
      fail(`area ${index + 1} must use the expected HTTPS URI action.`);
    }

    let url;
    try {
      url = new URL(action.uri);
    } catch {
      fail(`area ${index + 1} URI is malformed.`);
    }
    if (
      url.protocol !== "https:" ||
      url.origin !== PRODUCTION_ORIGIN ||
      url.pathname !== "/line" ||
      url.searchParams.size !== 1 ||
      url.searchParams.get("next") !== EXPECTED_DESTINATIONS[index]
    ) {
      fail(
        `area ${index + 1} URI must use the production origin and an allowlisted destination.`,
      );
    }
  }

  const finalAction = definition.areas[5]?.action;
  if (
    finalAction?.type !== "message" ||
    finalAction.label !== EXPECTED_LABELS[5] ||
    finalAction.text !== "สอบถามเรา"
  ) {
    fail('area 6 must send the exact message "สอบถามเรา".');
  }
}

export function validateRichMenu(definition, pngBytes) {
  const { width, height } = readPngSize(pngBytes);
  if (width !== EXPECTED_WIDTH || height !== EXPECTED_HEIGHT) {
    fail("PNG dimensions must be 2500x1686.");
  }
  if (pngBytes.length > MAX_PNG_BYTES) {
    fail("PNG byte length must be at most 1048576.");
  }
  if (definition?.selected !== true) {
    fail("selected must be true.");
  }
  if (definition?.name !== EXPECTED_NAME) {
    fail(`name must be ${EXPECTED_NAME}.`);
  }
  if (definition?.chatBarText !== EXPECTED_CHAT_BAR_TEXT) {
    fail(`chatBarText must be ${EXPECTED_CHAT_BAR_TEXT}.`);
  }

  validateGeometry(definition);
  validateActions(definition);

  return { width, height, bytes: pngBytes.length };
}

async function main() {
  const root = new URL("../", import.meta.url);
  const [definitionText, pngBytes] = await Promise.all([
    readFile(new URL("ops/line/rich-menu.json", root), "utf8"),
    readFile(new URL("apps/web/public/line/rich-menu.png", root)),
  ]);
  const result = validateRichMenu(JSON.parse(definitionText), pngBytes);
  console.log(`${result.width}x${result.height}`);
  console.log(`${result.bytes} bytes`);
  console.log("Rich menu valid");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Validation failed.");
    process.exitCode = 1;
  });
}

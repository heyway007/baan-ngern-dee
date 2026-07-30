import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const sourceUrl = new URL("../ops/line/rich-menu.html", import.meta.url);
const outputUrl = new URL(
  "../apps/web/public/line/rich-menu.png",
  import.meta.url,
);

async function main() {
  const outputPath = fileURLToPath(outputUrl);
  await mkdir(dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 2500, height: 1686 },
      deviceScaleFactor: 1,
    });
    await page.goto(sourceUrl.href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: outputPath,
      type: "png",
      fullPage: false,
    });
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Rich-menu generation failed.",
  );
  process.exitCode = 1;
});

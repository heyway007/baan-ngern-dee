import { describe, expect, it } from "vitest";

import { prepareSlipImage } from "./slip-image";

describe("prepareSlipImage", () => {
  it("rejects unsupported and oversized files before decoding", async () => {
    await expect(prepareSlipImage(
      new File(["text"], "note.txt", { type: "text/plain" })
    )).rejects.toThrow("รองรับเฉพาะ");
    await expect(prepareSlipImage(
      new File([new Uint8Array(5_000_001)], "large.jpg", {
        type: "image/jpeg"
      })
    )).rejects.toThrow("5 MB");
  });
});

import type { SlipAiExtraction } from "@systems-credit/contracts";

import {
  SlipVisionUnavailableError,
  type SlipVisionExtractor,
  type SlipVisionFailureCategory
} from "./slip-vision-extractor";

export type SlipVisionRetryEvent = Readonly<{
  code: "SLIP_VISION_RETRY";
  attempt: 1 | 2 | 3;
  maxAttempts: 3;
  slipVisionCategory: SlipVisionFailureCategory;
  requestId: string;
  path: "/v1/slip-imports/analyze";
}>;

export type SlipVisionRetryOptions = Readonly<{
  extractor: SlipVisionExtractor;
  input: Parameters<SlipVisionExtractor["extract"]>[0];
  requestId: string;
  sleep?: (milliseconds: number) => Promise<void>;
  log?: (event: SlipVisionRetryEvent) => void;
}>;

const delays = [300, 900] as const;

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function extractSlipWithRetry(
  options: SlipVisionRetryOptions
): Promise<SlipAiExtraction> {
  const sleep = options.sleep ?? delay;
  const log =
    options.log ?? ((event: SlipVisionRetryEvent) => console.warn(event));

  for (let index = 0; index < 3; index += 1) {
    try {
      return await options.extractor.extract(options.input);
    } catch (error) {
      if (!(error instanceof SlipVisionUnavailableError)) throw error;
      const attempt = (index + 1) as 1 | 2 | 3;
      log({
        code: "SLIP_VISION_RETRY",
        attempt,
        maxAttempts: 3,
        slipVisionCategory: error.category,
        requestId: options.requestId,
        path: "/v1/slip-imports/analyze"
      });
      if (attempt === 3) throw error;
      await sleep(delays[index]!);
    }
  }

  throw new Error("UNREACHABLE_SLIP_VISION_RETRY");
}

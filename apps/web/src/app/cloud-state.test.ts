import type {
  FinanceSnapshot
} from "@systems-credit/contracts";
import { describe, expect, it } from "vitest";

import type { CloudSession } from "../lib/cloud-auth";
import {
  cloudReducer,
  initialCloudState
} from "./cloud-state";

const session: CloudSession = {
  userId: "9c585235-f409-4764-b4ad-f1da4d500290",
  email: "min@example.test",
  displayName: "มิน",
  accessToken: "access-token"
};

const emptySnapshot: FinanceSnapshot = {
  version: 1,
  workspace: null,
  categories: [],
  accounts: [],
  accountBalances: {},
  openingTransactions: [],
  transactions: [],
  installmentContracts: [],
  installmentSchedules: {},
  installmentPayments: [],
  installmentPayoffs: [],
  recurringTemplates: [],
  recurringOccurrences: [],
  budgetAllocations: [],
  savingsGoals: []
};

describe("cloudReducer", () => {
  it("starts by loading public configuration", () => {
    expect(initialCloudState).toEqual({ status: "loading-config" });
  });

  it("moves through session and finance loading deterministically", () => {
    expect(
      cloudReducer(initialCloudState, { type: "CONFIG_LOADED" })
    ).toEqual({ status: "loading-session" });

    const loadingFinance = cloudReducer(
      { status: "loading-session" },
      { type: "SESSION_FOUND", session }
    );
    expect(loadingFinance).toEqual({
      status: "loading-finance",
      session,
      snapshot: null
    });

    expect(
      cloudReducer(loadingFinance, {
        type: "SNAPSHOT_LOADED",
        session,
        snapshot: emptySnapshot
      })
    ).toEqual({
      status: "ready",
      session,
      snapshot: emptySnapshot
    });
  });

  it("moves any boot state to signed out", () => {
    expect(
      cloudReducer(initialCloudState, { type: "SIGNED_OUT" })
    ).toEqual({ status: "signed-out" });
  });

  it("retains the last successful snapshot after a recoverable error and retry", () => {
    const ready = {
      status: "ready" as const,
      session,
      snapshot: emptySnapshot
    };
    const failed = cloudReducer(ready, {
      type: "SNAPSHOT_FAILED",
      session,
      message: "โหลดข้อมูลไม่สำเร็จ"
    });

    expect(failed).toEqual({
      status: "recoverable-error",
      session,
      snapshot: emptySnapshot,
      message: "โหลดข้อมูลไม่สำเร็จ",
      retry: "snapshot"
    });
    expect(
      cloudReducer(failed, { type: "RETRY_SNAPSHOT" })
    ).toEqual({
      status: "loading-finance",
      session,
      snapshot: emptySnapshot
    });
  });
});

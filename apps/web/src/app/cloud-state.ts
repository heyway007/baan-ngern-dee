import type { FinanceSnapshot } from "@systems-credit/contracts";

import type { CloudSession } from "../lib/cloud-auth";

export type CloudState =
  | Readonly<{ status: "loading-config" }>
  | Readonly<{ status: "loading-session" }>
  | Readonly<{ status: "signed-out" }>
  | Readonly<{
      status: "loading-finance";
      session: CloudSession;
      snapshot: FinanceSnapshot | null;
    }>
  | Readonly<{
      status: "ready";
      session: CloudSession;
      snapshot: FinanceSnapshot;
    }>
  | Readonly<{
      status: "recoverable-error";
      session: CloudSession | null;
      snapshot: FinanceSnapshot | null;
      message: string;
      retry: "boot" | "snapshot";
    }>;

export type CloudAction =
  | Readonly<{ type: "CONFIG_LOADED" }>
  | Readonly<{
      type: "SESSION_FOUND";
      session: CloudSession;
    }>
  | Readonly<{ type: "SIGNED_OUT" }>
  | Readonly<{
      type: "SNAPSHOT_LOADED";
      session: CloudSession;
      snapshot: FinanceSnapshot;
    }>
  | Readonly<{
      type: "BOOT_FAILED";
      message: string;
    }>
  | Readonly<{
      type: "SNAPSHOT_FAILED";
      session: CloudSession;
      message: string;
    }>
  | Readonly<{ type: "RETRY_BOOT" }>
  | Readonly<{ type: "RETRY_SNAPSHOT" }>;

export const initialCloudState: CloudState = {
  status: "loading-config"
};

function snapshotFromState(state: CloudState) {
  return "snapshot" in state ? state.snapshot : null;
}

export function cloudReducer(
  state: CloudState,
  action: CloudAction
): CloudState {
  switch (action.type) {
    case "CONFIG_LOADED":
      return { status: "loading-session" };
    case "SESSION_FOUND":
      return {
        status: "loading-finance",
        session: action.session,
        snapshot: snapshotFromState(state)
      };
    case "SIGNED_OUT":
      return { status: "signed-out" };
    case "SNAPSHOT_LOADED":
      return {
        status: "ready",
        session: action.session,
        snapshot: action.snapshot
      };
    case "BOOT_FAILED":
      return {
        status: "recoverable-error",
        session: null,
        snapshot: null,
        message: action.message,
        retry: "boot"
      };
    case "SNAPSHOT_FAILED":
      return {
        status: "recoverable-error",
        session: action.session,
        snapshot: snapshotFromState(state),
        message: action.message,
        retry: "snapshot"
      };
    case "RETRY_BOOT":
      return initialCloudState;
    case "RETRY_SNAPSHOT":
      if (
        state.status !== "recoverable-error" ||
        !state.session
      ) {
        return state;
      }
      return {
        status: "loading-finance",
        session: state.session,
        snapshot: state.snapshot
      };
  }
}

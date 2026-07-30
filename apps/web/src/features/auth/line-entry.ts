export const LINE_DESTINATION_KEY = "baan-ngern-dee:line-destination:v1";

export type LineDestination =
  | "/overview"
  | "/transactions/new?type=income"
  | "/transactions/new?type=expense"
  | "/accounts"
  | "/installments";

const LINE_DESTINATIONS: ReadonlySet<LineDestination> = new Set<LineDestination>([
  "/overview",
  "/transactions/new?type=income",
  "/transactions/new?type=expense",
  "/accounts",
  "/installments"
]);

export function resolveLineDestination(
  value: string | null | undefined
): LineDestination {
  return LINE_DESTINATIONS.has(value as LineDestination)
    ? (value as LineDestination)
    : "/overview";
}

export function rememberLineDestination(
  storage: Pick<Storage, "setItem">,
  destination: LineDestination
): void {
  storage.setItem(LINE_DESTINATION_KEY, resolveLineDestination(destination));
}

export function readLineDestination(
  storage: Pick<Storage, "getItem">
): LineDestination {
  return resolveLineDestination(storage.getItem(LINE_DESTINATION_KEY));
}

export function clearLineDestination(
  storage: Pick<Storage, "removeItem">
): void {
  storage.removeItem(LINE_DESTINATION_KEY);
}

export function lineWorkspaceName(displayName: string): string {
  const name = displayName.trim();
  if (!name || name === "ผู้ใช้ LINE") {
    return "การเงินของฉัน";
  }

  return Array.from(`บ้านเงินของ ${name}`)
    .slice(0, 80)
    .join("");
}

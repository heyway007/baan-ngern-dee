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
  if (
    !name ||
    name === "\u00e0\u00b8\u0153\u00e0\u00b8\u00b9\u00e0\u00b9\u2030\u00e0\u00b9\u0192\u00e0\u00b8\u0160\u00e0\u00b9\u2030 LINE"
  ) {
    return "\u00e0\u00b8\u0081\u00e0\u00b8\u00b2\u00e0\u00b8\u00a3\u00e0\u00b9\u20ac\u00e0\u00b8\u2021\u00e0\u00b8\u00b4\u00e0\u00b8\u2122\u00e0\u00b8\u201a\u00e0\u00b8\u00ad\u00e0\u00b8\u2021\u00e0\u00b8\u2030\u00e0\u00b8\u00b1\u00e0\u00b8\u2122";
  }

  return Array.from(
    `\u00e0\u00b8\u0161\u00e0\u00b9\u2030\u00e0\u00b8\u00b2\u00e0\u00b8\u2122\u00e0\u00b9\u20ac\u00e0\u00b8\u2021\u00e0\u00b8\u00b4\u00e0\u00b8\u2122\u00e0\u00b8\u201a\u00e0\u00b8\u00ad\u00e0\u00b8\u2021 ${name}`
  )
    .slice(0, 80)
    .join("");
}

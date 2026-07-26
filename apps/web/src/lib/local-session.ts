const SESSION_KEY = "systems-credit:session:v1";

export type LocalSession = Readonly<{
  displayName: string;
}>;

export function readLocalSession(storage: Storage): LocalSession | null {
  const stored = storage.getItem(SESSION_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as LocalSession).displayName === "string" &&
      (parsed as LocalSession).displayName.trim()
    ) {
      return {
        displayName: (parsed as LocalSession).displayName.trim()
      };
    }
  } catch {
    // A broken local session is treated as signed out.
  }
  return null;
}

export function writeLocalSession(
  storage: Storage,
  displayName: string
): LocalSession {
  const session = { displayName: displayName.trim() };
  storage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearLocalSession(storage: Storage) {
  storage.removeItem(SESSION_KEY);
}

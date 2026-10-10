export type AuthUser = {
  id: number;
  email: string;
  role: string;
  fullName: string;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

const SESSION_KEY = "apparelflow.session";

export function readSession(): AuthSession | null {
  const storedSession = window.localStorage.getItem(SESSION_KEY);
  if (!storedSession) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(storedSession);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "token" in parsed &&
      typeof parsed.token === "string" &&
      "user" in parsed &&
      typeof parsed.user === "object" &&
      parsed.user !== null &&
      "id" in parsed.user &&
      typeof parsed.user.id === "number" &&
      Number.isInteger(parsed.user.id) &&
      "email" in parsed.user &&
      typeof parsed.user.email === "string" &&
      "role" in parsed.user &&
      typeof parsed.user.role === "string" &&
      "fullName" in parsed.user &&
      typeof parsed.user.fullName === "string"
    ) {
      return {
        token: parsed.token,
        user: {
          id: parsed.user.id,
          email: parsed.user.email,
          role: parsed.user.role,
          fullName: parsed.user.fullName,
        },
      };
    }
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }

  window.localStorage.removeItem(SESSION_KEY);
  return null;
}

export function saveSession(session: AuthSession): void {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
}
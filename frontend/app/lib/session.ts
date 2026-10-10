export type UserRole = "cutting_supervisor" | "cutting_verifier" | "sewing_supervisor";

export type AuthUser = {
  id: number;
  email: string;
  role: UserRole;
  fullName: string;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

const SESSION_KEY = "apparelflow.session";

export function isUserRole(value: unknown): value is UserRole {
  return value === "cutting_supervisor" || value === "cutting_verifier" || value === "sewing_supervisor";
}

function readTokenUser(token: string): AuthUser | null {
  try {
    const encodedPayload = token.split(".")[1];
    if (!encodedPayload) return null;

    const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const binary = window.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));

    if (
      typeof payload !== "object" ||
      payload === null ||
      !("id" in payload) ||
      typeof payload.id !== "number" ||
      !Number.isInteger(payload.id) ||
      !("email" in payload) ||
      typeof payload.email !== "string" ||
      !("role" in payload) ||
      !isUserRole(payload.role) ||
      !("fullName" in payload) ||
      typeof payload.fullName !== "string"
    ) {
      return null;
    }

    return {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      fullName: payload.fullName,
    };
  } catch {
    return null;
  }
}

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
      isUserRole(parsed.user.role) &&
      "fullName" in parsed.user &&
      typeof parsed.user.fullName === "string"
    ) {
      const tokenUser = readTokenUser(parsed.token);
      if (
        !tokenUser ||
        tokenUser.id !== parsed.user.id ||
        tokenUser.email !== parsed.user.email ||
        tokenUser.role !== parsed.user.role ||
        tokenUser.fullName !== parsed.user.fullName
      ) {
        window.localStorage.removeItem(SESSION_KEY);
        return null;
      }

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
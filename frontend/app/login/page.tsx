"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest, ApiError, type ApiEnvelope } from "@/app/lib/api";
import { isUserRole, readSession, saveSession, type AuthUser } from "@/app/lib/session";

type LoginResponse = {
  token: string;
  user: AuthUser;
};

type DemoAccount = AuthUser & { password: string };

const roleLabels = {
  cutting_supervisor: "Cutting Supervisor",
  cutting_verifier: "Cutting Verifier",
  sewing_supervisor: "Sewing Supervisor",
} as const;

function isLoginResponse(value: unknown): value is LoginResponse {
  if (typeof value !== "object" || value === null || !("token" in value) || !("user" in value)) {
    return false;
  }

  const user = value.user;
  return (
    typeof value.token === "string" &&
    typeof user === "object" &&
    user !== null &&
    "id" in user &&
    typeof user.id === "number" &&
    Number.isInteger(user.id) &&
    "email" in user &&
    typeof user.email === "string" &&
    "role" in user &&
    isUserRole(user.role) &&
    "fullName" in user &&
    typeof user.fullName === "string"
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [demoError, setDemoError] = useState("");

  useEffect(() => {
    const session = readSession();
    if (session) {
      router.replace("/dashboard");
    }

    let active = true;
    apiRequest<ApiEnvelope<DemoAccount[]>>("/api/auth/demo-accounts")
      .then((response) => {
        if (active) setDemoAccounts(response.data);
      })
      .catch((requestError) => {
        if (active && !(requestError instanceof ApiError && requestError.status === 404)) {
          setDemoError("Demo credentials are unavailable. Sign in with your assigned account.");
        }
      });

    return () => {
      active = false;
    };
  }, [router]);

  const reason = searchParams.get("reason");
  const routeMessage =
    reason === "session-expired"
      ? "Your session expired. Sign in again to continue."
      : reason === "required"
        ? "Sign in to access the dashboard."
        : reason === "forbidden"
          ? "Your account does not have access to the requested workspace."
          : "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      const response: unknown = await apiRequest<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail, password }),
      });

      if (!isLoginResponse(response)) {
        setError("The API returned an unexpected login response. Please try again.");
        return;
      }

      const user: AuthUser = {
        id: response.user.id,
        email: response.user.email,
        role: response.user.role,
        fullName: response.user.fullName,
      };
      saveSession({ token: response.token, user });
      router.replace("/dashboard");
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.status === 401
            ? "Email or password is incorrect."
            : requestError.message
          : "Unable to sign in. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#edf2ef] px-5 py-12 text-slate-950">
      <section className="w-full max-w-md border-t-4 border-emerald-800 bg-white px-7 py-8 shadow-[0_18px_60px_rgba(20,45,32,0.10)] sm:px-10 sm:py-10">
        <div className="mb-9">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">ApparelFlow ERP</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Sign in</h1>
          <p className="mt-2 text-sm text-slate-600">Access cutting operations with your account.</p>
        </div>

        {demoAccounts.length > 0 && (
          <section aria-labelledby="demo-accounts-heading" className="mb-6 border border-emerald-200 bg-emerald-50 p-4">
            <h2 className="text-sm font-semibold text-emerald-950" id="demo-accounts-heading">Assessment demo accounts</h2>
            <p className="mt-1 text-xs text-emerald-900">Selecting an account fills the standard sign-in form. The server still verifies its password and assigns the authenticated role.</p>
            <div className="mt-3 grid gap-2">
              {demoAccounts.map((account) => (
                <button
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border border-emerald-300 bg-white px-3 py-2 text-left text-sm text-slate-950 hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                  key={account.role}
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                    setError("");
                  }}
                  type="button"
                >
                  <span className="font-semibold">{roleLabels[account.role]}</span>
                  <span className="text-xs text-slate-700">{account.email}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {demoError && <p className="mb-4 text-sm text-amber-900" role="status">{demoError}</p>}

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-slate-800">
              Email address
            </label>
            <input
              autoComplete="username"
              className="block min-h-12 w-full border border-slate-400 bg-white px-3.5 text-base text-slate-950 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-800/25"
              id="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-slate-800">
              Password
            </label>
            <input
              autoComplete="current-password"
              className="block min-h-12 w-full border border-slate-400 bg-white px-3.5 text-base text-slate-950 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-800/25"
              id="password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>

          {(error || routeMessage) && (
            <p aria-live="polite" className="border-l-4 border-rose-700 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-900" role="alert">
              {error || routeMessage}
            </p>
          )}

          <button
            className="flex min-h-12 w-full items-center justify-center bg-emerald-800 px-4 text-sm font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={loading}
            type="submit"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#edf2ef] px-5 text-slate-900">
          <p className="text-sm font-medium">Loading sign-in...</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
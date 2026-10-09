const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

async function getHealth() {
  try {
    const response = await fetch(`${API_URL}/api/health`, {
      cache: "no-store",
    });
    return {
      ok: response.ok,
      body: await response.json(),
    };
  } catch {
    return {
      ok: false,
      body: {
        success: false,
        message: "Backend is not reachable. Start it with npm run dev in backend/.",
      },
    };
  }
}

export default async function Home() {
  const health = await getHealth();

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          ApparelFlow ERP
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Frontend is calling {API_URL}/api/health
        </p>
        <pre className="mt-6 overflow-x-auto rounded-lg bg-zinc-100 p-4 text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
          {JSON.stringify(health.body, null, 2)}
        </pre>
        <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {health.ok ? "Frontend → backend connection works." : "Frontend could not reach the backend."}
        </p>
      </div>
    </main>
  );
}

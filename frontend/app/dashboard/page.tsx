"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, ApiError, type ApiEnvelope, type CuttingOrder, type Recipe } from "@/app/lib/api";
import { clearSession, readSession, type AuthSession } from "@/app/lib/session";

type PageState = "checking" | "ready" | "forbidden";

type OrderFormErrors = {
  recipeId?: string;
  targetQty?: string;
  fabricRollId?: string;
  actualFabricYds?: string;
};

const inputClassName =
  "block min-h-11 w-full border border-slate-400 bg-white px-3 text-sm text-slate-950 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-800/25";

function statusClassName(status: string): string {
  if (status === "PENDING_VERIFICATION") {
    return "bg-amber-100 text-amber-950";
  }
  if (status === "VERIFIED" || status === "COMPLETED") {
    return "bg-emerald-100 text-emerald-950";
  }
  if (status === "REJECTED") {
    return "bg-rose-100 text-rose-950";
  }
  return "bg-slate-200 text-slate-900";
}

export default function DashboardPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("checking");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [orders, setOrders] = useState<CuttingOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [recipeId, setRecipeId] = useState("");
  const [targetQty, setTargetQty] = useState("");
  const [fabricRollId, setFabricRollId] = useState("");
  const [actualFabricYds, setActualFabricYds] = useState("");
  const [formErrors, setFormErrors] = useState<OrderFormErrors>({});
  const [formError, setFormError] = useState("");
  const [pageError, setPageError] = useState("");
  const [createdOrder, setCreatedOrder] = useState<CuttingOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const handleRequestError = useCallback((error: unknown): void => {
    if (error instanceof ApiError && error.status === 401) {
      clearSession();
      router.replace("/login?reason=session-expired");
      return;
    }
    if (error instanceof ApiError && error.status === 403) {
      setPageError("Your account is not authorized to access Supervisor operations.");
      return;
    }
    setPageError(error instanceof Error ? error.message : "The request could not be completed.");
  }, [router]);

  useEffect(() => {
    const currentSession = readSession();
    if (!currentSession) {
      router.replace("/login?reason=required");
      return;
    }
    if (currentSession.user.role !== "cutting_supervisor") {
      clearSession();
      router.replace("/login?reason=forbidden");
      return;
    }

    const authorizedSession = currentSession;

    let active = true;
    async function loadDashboard() {
      try {
        const [recipeResponse, orderResponse] = await Promise.all([
          apiRequest<ApiEnvelope<Recipe[]>>("/api/recipes", {}, authorizedSession.token),
          apiRequest<ApiEnvelope<CuttingOrder[]>>("/api/orders", {}, authorizedSession.token),
        ]);
        if (active) {
          setSession(authorizedSession);
          setRecipes(recipeResponse.data);
          setOrders(orderResponse.data);
          setPageState("ready");
          setPageError("");
        }
      } catch (error) {
        if (!active) return;
        handleRequestError(error);
        setPageState(error instanceof ApiError && error.status === 403 ? "forbidden" : "ready");
      } finally {
        if (active) setOrdersLoading(false);
      }
    }

    void loadDashboard();
    return () => {
      active = false;
    };
  }, [handleRequestError, router]);

  async function refreshOrders(token: string): Promise<void> {
    const response = await apiRequest<ApiEnvelope<CuttingOrder[]>>("/api/orders", {}, token);
    setOrders(response.data);
  }

  function validateForm(): { valid: boolean; quantity: number; fabric: number } {
    const nextErrors: OrderFormErrors = {};
    const quantity = Number(targetQty);
    const fabric = Number(actualFabricYds);

    if (!recipeId || !recipes.some((recipe) => recipe.id === Number(recipeId))) {
      nextErrors.recipeId = "Select an available recipe.";
    }
    if (!/^\d+$/.test(targetQty) || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647) {
      nextErrors.targetQty = "Enter a positive whole-number garment quantity.";
    }
    if (!fabricRollId.trim()) {
      nextErrors.fabricRollId = "Enter a fabric roll ID.";
    } else if (fabricRollId.trim().length > 100) {
      nextErrors.fabricRollId = "Fabric roll ID must be 100 characters or fewer.";
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(actualFabricYds) || !Number.isFinite(fabric) || fabric <= 0) {
      nextErrors.actualFabricYds = "Enter a positive fabric quantity with up to two decimal places.";
    }

    setFormErrors(nextErrors);
    return { valid: Object.keys(nextErrors).length === 0, quantity, fabric };
  }

  async function handleCreateOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setCreatedOrder(null);
    if (submittingRef.current) return;
    const validation = validateForm();
    if (!validation.valid || !session) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await apiRequest<ApiEnvelope<CuttingOrder>>(
        "/api/orders",
        {
          method: "POST",
          body: JSON.stringify({
            recipeId: Number(recipeId),
            targetQty: validation.quantity,
            fabricRollId: fabricRollId.trim(),
            actualFabricYds: validation.fabric,
          }),
        },
        session.token
      );

      setCreatedOrder(response.data);
      setTargetQty("");
      setFabricRollId("");
      setActualFabricYds("");
      setFormErrors({});
      setOrdersLoading(true);
      try {
        await refreshOrders(session.token);
      } catch (error) {
        handleRequestError(error);
      } finally {
        setOrdersLoading(false);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        handleRequestError(error);
        setPageState("forbidden");
      } else if (error instanceof ApiError && error.status === 401) {
        handleRequestError(error);
      } else {
        setFormError(error instanceof Error ? error.message : "Unable to create the cutting order.");
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function signOut(): void {
    clearSession();
    router.replace("/login");
  }

  if (pageState === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#edf2ef] px-5 text-slate-900">
        <p aria-live="polite" className="text-sm font-medium">Loading Supervisor dashboard...</p>
      </main>
    );
  }

  if (pageState === "forbidden") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#edf2ef] px-5 text-slate-950">
        <section className="w-full max-w-lg border-t-4 border-rose-700 bg-white p-8 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-rose-800">Access restricted</p>
          <h1 className="mt-3 text-2xl font-semibold">Supervisor access required</h1>
          <p className="mt-2 text-sm text-slate-700">{pageError || "This account cannot access Supervisor operations."}</p>
          <button className="mt-6 min-h-11 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900" onClick={signOut} type="button">
            Sign out
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#edf2ef] text-slate-950">
      <header className="border-b border-emerald-950/20 bg-[#173d30] text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-200">ApparelFlow ERP</p>
            <h1 className="mt-1 text-xl font-semibold">Cutting operations</h1>
          </div>
          <div className="flex items-center gap-4">
            <p className="hidden text-sm text-emerald-50 sm:block">{session?.user.fullName}</p>
            <button className="min-h-10 border border-white/50 px-3 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={signOut} type="button">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">Supervisor</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Cutting orders</h2>
          </div>
          <button
            className="min-h-11 bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900"
            onClick={() => {
              setFormOpen((open) => !open);
              setFormError("");
            }}
            type="button"
          >
            {formOpen ? "Close form" : "Create cutting order"}
          </button>
        </div>

        {pageError && (
          <p aria-live="polite" className="mb-5 border-l-4 border-rose-700 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900" role="alert">
            {pageError}
          </p>
        )}

        {formOpen && (
          <section aria-labelledby="create-order-heading" className="mb-8 border border-slate-300 bg-white p-5 shadow-sm sm:p-7">
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-800">New order</p>
              <h3 className="mt-1 text-lg font-semibold" id="create-order-heading">Create cutting order</h3>
            </div>

            {recipes.length === 0 ? (
              <p className="border-l-4 border-amber-600 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                No recipes are currently available. An order cannot be created until recipes are available from the API.
              </p>
            ) : (
              <form className="grid gap-x-5 gap-y-4 md:grid-cols-2" onSubmit={handleCreateOrder} noValidate>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800" htmlFor="recipeId">Recipe</label>
                  <select
                    aria-describedby={formErrors.recipeId ? "recipeId-error" : undefined}
                    aria-invalid={Boolean(formErrors.recipeId)}
                    className={inputClassName}
                    id="recipeId"
                    onChange={(event) => setRecipeId(event.target.value)}
                    value={recipeId}
                  >
                    <option value="">Select a recipe</option>
                    {recipes.map((recipe) => (
                      <option key={recipe.id} value={recipe.id}>{recipe.name} ({recipe.recipeCode})</option>
                    ))}
                  </select>
                  {formErrors.recipeId && <p className="mt-1 text-sm text-rose-800" id="recipeId-error">{formErrors.recipeId}</p>}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800" htmlFor="targetQty">Target garment quantity</label>
                  <input
                    aria-describedby={formErrors.targetQty ? "targetQty-error" : undefined}
                    aria-invalid={Boolean(formErrors.targetQty)}
                    className={inputClassName}
                    id="targetQty"
                    inputMode="numeric"
                    onChange={(event) => setTargetQty(event.target.value)}
                    value={targetQty}
                  />
                  {formErrors.targetQty && <p className="mt-1 text-sm text-rose-800" id="targetQty-error">{formErrors.targetQty}</p>}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800" htmlFor="fabricRollId">Fabric roll ID</label>
                  <input
                    aria-describedby={formErrors.fabricRollId ? "fabricRollId-error" : undefined}
                    aria-invalid={Boolean(formErrors.fabricRollId)}
                    className={inputClassName}
                    id="fabricRollId"
                    maxLength={100}
                    onChange={(event) => setFabricRollId(event.target.value)}
                    value={fabricRollId}
                  />
                  {formErrors.fabricRollId && <p className="mt-1 text-sm text-rose-800" id="fabricRollId-error">{formErrors.fabricRollId}</p>}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800" htmlFor="actualFabricYds">Actual fabric used (yards)</label>
                  <input
                    aria-describedby={formErrors.actualFabricYds ? "actualFabricYds-error" : undefined}
                    aria-invalid={Boolean(formErrors.actualFabricYds)}
                    className={inputClassName}
                    id="actualFabricYds"
                    inputMode="decimal"
                    onChange={(event) => setActualFabricYds(event.target.value)}
                    value={actualFabricYds}
                  />
                  {formErrors.actualFabricYds && <p className="mt-1 text-sm text-rose-800" id="actualFabricYds-error">{formErrors.actualFabricYds}</p>}
                </div>

                {formError && (
                  <p aria-live="polite" className="border-l-4 border-rose-700 bg-rose-50 px-3 py-2.5 text-sm text-rose-900 md:col-span-2" role="alert">
                    {formError}
                  </p>
                )}

                <div className="md:col-span-2">
                  <button
                    className="min-h-11 bg-emerald-800 px-5 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                    disabled={submitting}
                    type="submit"
                  >
                    {submitting ? "Creating order..." : "Create order"}
                  </button>
                </div>
              </form>
            )}

            {createdOrder && (
              <div aria-live="polite" className="mt-5 border-l-4 border-emerald-700 bg-emerald-50 p-4 text-emerald-950" role="status">
                <p className="font-semibold">Order {createdOrder.orderNo} created</p>
                <p className="mt-1 text-sm">Status: {createdOrder.status}</p>
                <h4 className="mt-4 text-sm font-semibold">Expected component counts</h4>
                <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                  {createdOrder.expectedComponents.map((component) => (
                    <li key={component.componentId}>{component.componentName}: {component.expectedQty}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section aria-labelledby="orders-heading" className="border border-slate-300 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
            <div>
              <h3 className="font-semibold" id="orders-heading">Recent orders</h3>
              <p className="mt-0.5 text-sm text-slate-600">Persisted cutting orders, newest first</p>
            </div>
            <span className="text-sm font-medium text-slate-600">{orders.length} total</span>
          </div>

          {ordersLoading ? (
            <p aria-live="polite" className="px-5 py-8 text-sm text-slate-600">Loading orders...</p>
          ) : orders.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-600">No cutting orders yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-700">
                  <tr>
                    <th className="px-5 py-3 font-semibold" scope="col">Order</th>
                    <th className="px-5 py-3 font-semibold" scope="col">Recipe</th>
                    <th className="px-5 py-3 font-semibold" scope="col">Target qty</th>
                    <th className="px-5 py-3 font-semibold" scope="col">Fabric roll</th>
                    <th className="px-5 py-3 font-semibold" scope="col">Created</th>
                    <th className="px-5 py-3 font-semibold" scope="col">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {orders.map((order) => (
                    <tr key={order.id} className="text-slate-800">
                      <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-950">{order.orderNo}</td>
                      <td className="px-5 py-4">{order.recipe.name}</td>
                      <td className="px-5 py-4 tabular-nums">{order.targetQty.toLocaleString()}</td>
                      <td className="px-5 py-4">{order.fabricRollId}</td>
                      <td className="whitespace-nowrap px-5 py-4">{new Date(order.createdAt).toLocaleString()}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex px-2.5 py-1 text-xs font-semibold ${statusClassName(order.status)}`}>
                          {order.status.replaceAll("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
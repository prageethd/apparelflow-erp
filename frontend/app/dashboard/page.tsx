"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, ApiError, type ApiEnvelope, type AuthUser, type CuttingOrder, type Recipe } from "@/app/lib/api";
import { clearSession, readSession, saveSession, type AuthSession } from "@/app/lib/session";
import {
  approvalBlockReason as getApprovalBlockReason,
  expectedComponentQty,
  fabricPreview,
  parseFabricYards,
  parseTargetQuantity,
  trafficStatus,
} from "@/app/lib/workflow";

type PageState = "checking" | "ready" | "sewing" | "forbidden";

type OrderFormErrors = {
  recipeId?: string;
  targetQty?: string;
  fabricRollId?: string;
  actualFabricYds?: string;
};

const inputClassName =
  "block min-h-11 w-full border border-slate-400 bg-white px-3 text-sm text-slate-950 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-800/25";

const roleLabels = {
  cutting_supervisor: "Cutting Supervisor",
  cutting_verifier: "Cutting Verifier",
  sewing_supervisor: "Sewing Supervisor",
} as const;

const trafficLabels = {
  GREEN: "GREEN · exact count",
  YELLOW: "YELLOW · excess count",
  RED: "RED · shortage",
} as const;

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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<CuttingOrder | null>(null);
  const [countDrafts, setCountDrafts] = useState<Record<number, string>>({});
  const [savingCounts, setSavingCounts] = useState(false);
  const [transitionLoading, setTransitionLoading] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
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
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const recipeSelectRef = useRef<HTMLSelectElement>(null);
  const detailsDialogRef = useRef<HTMLDialogElement>(null);
  const detailsCloseRef = useRef<HTMLButtonElement>(null);

  const selectedRecipe = recipes.find((recipe) => recipe.id === Number(recipeId));
  const previewQuantity = parseTargetQuantity(targetQty);
  const actualFabricPreview = parseFabricYards(actualFabricYds);
  const fabricPreviewValues = selectedRecipe && previewQuantity
    ? fabricPreview(selectedRecipe.stdFabricYards, previewQuantity, actualFabricPreview, selectedRecipe.wastageCap)
    : null;
  const expectedFabricPreview = fabricPreviewValues?.expectedFabricYds ?? null;
  const wastagePreview = fabricPreviewValues?.wastagePct ?? null;
  const exceedsWastageCap = fabricPreviewValues?.exceedsWastageCap ?? false;

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
    const authorizedSession = currentSession;

    let active = true;
    async function loadDashboard() {
      await Promise.resolve();
      if (!active) return;

      try {
        const identityResponse = await apiRequest<ApiEnvelope<AuthUser>>(
          "/api/auth/me",
          {},
          authorizedSession.token
        );
        const verifiedSession = { token: authorizedSession.token, user: identityResponse.data };
        saveSession(verifiedSession);
        setSession(verifiedSession);

        if (verifiedSession.user.role === "sewing_supervisor") {
          const queueResponse = await apiRequest<ApiEnvelope<CuttingOrder[]>>(
            "/api/sewing/queue",
            {},
            verifiedSession.token
          );
          if (active) {
            setOrders(queueResponse.data);
            setPageState("sewing");
            setPageError("");
          }
          return;
        }

        const recipeRequest = verifiedSession.user.role === "cutting_supervisor"
          ? apiRequest<ApiEnvelope<Recipe[]>>("/api/recipes", {}, verifiedSession.token)
          : Promise.resolve(null);
        const [recipeResponse, orderResponse] = await Promise.all([
          recipeRequest,
          apiRequest<ApiEnvelope<CuttingOrder[]>>("/api/orders", {}, verifiedSession.token),
        ]);
        if (active) {
          setSession(verifiedSession);
          setRecipes(recipeResponse?.data ?? []);
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

  useEffect(() => {
    const dialog = createDialogRef.current;
    if (!dialog) return;

    if (formOpen && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => recipeSelectRef.current?.focus());
    } else if (!formOpen && dialog.open) {
      dialog.close();
    }
  }, [formOpen]);

  useEffect(() => {
    const dialog = detailsDialogRef.current;
    if (!dialog) return;

    if (detailsOpen && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => detailsCloseRef.current?.focus());
    } else if (!detailsOpen && dialog.open) {
      dialog.close();
    }
  }, [detailsOpen]);

  async function refreshOrders(token: string): Promise<void> {
    const path = session?.user.role === "sewing_supervisor" ? "/api/sewing/queue" : "/api/orders";
    const response = await apiRequest<ApiEnvelope<CuttingOrder[]>>(path, {}, token);
    setOrders(response.data);
  }

  async function openOrderDetails(order: CuttingOrder): Promise<void> {
    if (!session) return;

    setSelectedOrder(order);
    setDetailsError("");
    setRejectionReason("");
    setDetailsLoading(true);
    setDetailsOpen(true);
    setCountDrafts(Object.fromEntries(order.expectedComponents.map((item) => [
      item.componentId,
      item.actualQty === null ? "" : String(item.actualQty),
    ])));
    try {
      const response = await apiRequest<ApiEnvelope<CuttingOrder>>(
        session.user.role === "sewing_supervisor"
          ? `/api/sewing/orders/${order.id}`
          : `/api/orders/${order.id}`,
        {},
        session.token
      );
      setSelectedOrder(response.data);
      setCountDrafts(Object.fromEntries(response.data.expectedComponents.map((item) => [
        item.componentId,
        item.actualQty === null ? "" : String(item.actualQty),
      ])));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleRequestError(error);
      } else {
        setDetailsError(error instanceof Error ? error.message : "Unable to retrieve this order.");
      }
    } finally {
      setDetailsLoading(false);
    }
  }

  function validateForm(): { valid: boolean; quantity: number; fabric: number } {
    const nextErrors: OrderFormErrors = {};
    const quantity = parseTargetQuantity(targetQty);
    const fabric = parseFabricYards(actualFabricYds);

    if (!selectedRecipe) {
      nextErrors.recipeId = "Select an available recipe.";
    } else if (selectedRecipe.components.length === 0) {
      nextErrors.recipeId = "This recipe has no components and cannot be used for an order.";
    }
    if (quantity === null) {
      nextErrors.targetQty = "Enter a positive whole-number garment quantity.";
    }
    if (!fabricRollId.trim()) {
      nextErrors.fabricRollId = "Enter a fabric roll ID.";
    } else if (fabricRollId.trim().length > 100) {
      nextErrors.fabricRollId = "Fabric roll ID must be 100 characters or fewer.";
    }
    if (fabric === null) {
      nextErrors.actualFabricYds = "Enter a positive fabric quantity with up to two decimal places.";
    }

    setFormErrors(nextErrors);
    return { valid: Object.keys(nextErrors).length === 0, quantity: quantity ?? 0, fabric: fabric ?? 0 };
  }

  async function saveVerificationCounts(): Promise<boolean> {
    if (!session || !selectedOrder) return false;
    const items = [];
    for (const component of selectedOrder.expectedComponents) {
      const rawValue = countDrafts[component.componentId] ?? "";
      if (rawValue === "") {
        items.push({ componentId: component.componentId, actualQty: null });
        continue;
      }
      if (!/^(0|[1-9]\d*)$/.test(rawValue)) {
        setDetailsError(`Enter a non-negative whole number for ${component.componentName}.`);
        return false;
      }
      const actualQty = Number(rawValue);
      if (!Number.isSafeInteger(actualQty) || actualQty > 2147483647) {
        setDetailsError(`The count for ${component.componentName} exceeds the supported limit.`);
        return false;
      }
      items.push({ componentId: component.componentId, actualQty });
    }

    setSavingCounts(true);
    setDetailsError("");
    try {
      const response = await apiRequest<ApiEnvelope<CuttingOrder>>(
        `/api/orders/${selectedOrder.id}/counts`,
        { method: "PATCH", body: JSON.stringify({ items }) },
        session.token
      );
      setSelectedOrder(response.data);
      setCountDrafts(Object.fromEntries(response.data.expectedComponents.map((item) => [
        item.componentId,
        item.actualQty === null ? "" : String(item.actualQty),
      ])));
      setOrders((current) => current.map((order) => order.id === response.data.id ? response.data : order));
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) handleRequestError(error);
      else setDetailsError(error instanceof Error ? error.message : "Unable to save component counts.");
      return false;
    } finally {
      setSavingCounts(false);
    }
  }

  async function rejectSelectedOrder(): Promise<void> {
    if (!selectedOrder || !rejectionReason.trim() || transitionLoading || savingCounts) return;
    const countsSaved = await saveVerificationCounts();
    if (countsSaved) {
      await runOrderTransition(`/api/orders/${selectedOrder.id}/reject`, { reason: rejectionReason });
    }
  }

  async function runOrderTransition(path: string, body?: Record<string, unknown>): Promise<void> {
    if (!session || !selectedOrder || transitionLoading) return;
    setTransitionLoading(true);
    setDetailsError("");
    try {
      const response = await apiRequest<ApiEnvelope<CuttingOrder>>(
        path,
        { method: "POST", body: JSON.stringify(body ?? {}) },
        session.token
      );
      setSelectedOrder(response.data);
      setOrders((current) => current.map((order) => order.id === response.data.id ? response.data : order));
      setRejectionReason("");
      if (session.user.role === "cutting_supervisor" && response.data.status === "PENDING_VERIFICATION") {
        setCountDrafts(Object.fromEntries(response.data.expectedComponents.map((item) => [item.componentId, ""])));
      }
      if (session.user.role === "sewing_supervisor") {
        await refreshOrders(session.token);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) handleRequestError(error);
      else setDetailsError(error instanceof Error ? error.message : "Unable to complete this workflow action.");
    } finally {
      setTransitionLoading(false);
    }
  }

  function changeCount(componentId: number, value: string): void {
    setCountDrafts((current) => ({ ...current, [componentId]: value }));
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
      setFormOpen(false);
      setTargetQty("");
      setRecipeId("");
      setFabricRollId("");
      setActualFabricYds("");
      setFormErrors({});
      setOrdersLoading(true);
      try {
        await refreshOrders(session.token);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          handleRequestError(error);
        } else {
          setPageError(`Order ${response.data.orderNo} was created, but the list could not be refreshed. ${error instanceof Error ? error.message : ""}`.trim());
        }
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

  const userRole = session?.user.role;
  const canCreateOrders = userRole === "cutting_supervisor";
  const canReadOrders = userRole === "cutting_supervisor" || userRole === "cutting_verifier" || userRole === "sewing_supervisor";
  const isVerifier = userRole === "cutting_verifier";
  const isSewingWorkspace = userRole === "sewing_supervisor";
  const approvalBlockReason = selectedOrder
    ? getApprovalBlockReason(selectedOrder.status, selectedOrder.expectedComponents, countDrafts)
    : "Select an order before approving.";

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
          <h1 className="mt-3 text-2xl font-semibold">Order access unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">{pageError || "This account cannot access cutting orders."}</p>
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
            <h1 className="mt-1 text-xl font-semibold">{isSewingWorkspace ? "Sewing operations" : "Cutting operations"}</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="hidden text-sm text-emerald-50 sm:block">{session?.user.fullName}</p>
              {userRole && <p className="text-xs font-semibold text-emerald-200">{roleLabels[userRole]}</p>}
            </div>
            <button className="min-h-10 border border-white/50 px-3 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={signOut} type="button">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">{userRole ? roleLabels[userRole] : "Orders"}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{isSewingWorkspace ? "Sewing queue" : "Cutting orders"}</h2>
          </div>
          {canCreateOrders && (
            <button
              className="min-h-11 bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900"
              onClick={() => {
                setFormError("");
                setFormOpen(true);
              }}
              type="button"
            >
              Create Order
            </button>
          )}
        </div>

        {pageError && (
          <p aria-live="polite" className="mb-5 border-l-4 border-rose-700 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900" role="alert">
            {pageError}
          </p>
        )}

        {createdOrder && (
          <div aria-live="polite" className="mb-5 border-l-4 border-emerald-700 bg-emerald-50 p-4 text-emerald-950" role="status">
            <p className="font-semibold">Order {createdOrder.orderNo} created</p>
            <p className="mt-1 text-sm">Status: {createdOrder.status}</p>
            <p className="mt-2 text-sm">
              Expected fabric: {createdOrder.expectedFabricYds?.toFixed(2) ?? "Unavailable"} yd
              {createdOrder.wastagePct !== null ? ` · Wastage: ${createdOrder.wastagePct.toFixed(2)}%` : ""}
            </p>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {createdOrder.expectedComponents.map((component) => (
                <li key={component.componentId}>{component.componentName}: {component.expectedQty}</li>
              ))}
            </ul>
          </div>
        )}

        {canCreateOrders && (
          <dialog
            aria-labelledby="create-order-heading"
            className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto border border-slate-300 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/60"
            onCancel={(event) => {
              event.preventDefault();
              if (!submitting) setFormOpen(false);
            }}
            ref={createDialogRef}
          >
            <section className="p-5 sm:p-7">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-800">New order</p>
              <h3 className="mt-1 text-lg font-semibold" id="create-order-heading">Create cutting order</h3>
                </div>
                <button
                  aria-label="Close order form"
                  className="flex size-10 shrink-0 items-center justify-center border border-slate-400 text-xl text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-50"
                  disabled={submitting}
                  onClick={() => setFormOpen(false)}
                  type="button"
                >
                  ×
                </button>
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
                    ref={recipeSelectRef}
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

                {selectedRecipe && previewQuantity && (
                  <section aria-label="Expected component preview" className="border-t border-slate-200 pt-4 md:col-span-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="text-sm font-semibold">Expected components</h4>
                      <p className="text-xs text-slate-600">Preview only; saved values are calculated by the server.</p>
                    </div>
                    {selectedRecipe.components.length === 0 ? (
                      <p className="mt-2 text-sm text-amber-900">This recipe has no components.</p>
                    ) : (
                      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                        {selectedRecipe.components.map((component) => (
                          <li className="flex justify-between gap-3 border-b border-slate-200 py-2 text-sm" key={component.id}>
                            <span>{component.componentName} <span className="text-slate-600">× {component.piecesPerGarment}</span></span>
                            <span className="font-semibold tabular-nums">{expectedComponentQty(component.piecesPerGarment, previewQuantity)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                {expectedFabricPreview !== null && (
                  <section aria-label="Fabric usage preview" className="border-t border-slate-200 pt-4 md:col-span-2">
                    <h4 className="text-sm font-semibold">Fabric usage preview</h4>
                    <p className="mt-1 text-sm text-slate-700">
                      Expected: {expectedFabricPreview.toFixed(2)} yd
                      {wastagePreview !== null ? ` · Estimated wastage: ${wastagePreview.toFixed(2)}%` : ""}
                      {selectedRecipe ? ` · Recipe cap: ${selectedRecipe.wastageCap.toFixed(2)}%` : ""}
                    </p>
                    {exceedsWastageCap && (
                      <p className="mt-2 border-l-4 border-amber-600 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
                        Warning: estimated wastage exceeds this recipe’s cap. The order can still be submitted; the server’s calculated result is authoritative.
                      </p>
                    )}
                  </section>
                )}

                {formError && (
                  <p aria-live="polite" className="border-l-4 border-rose-700 bg-rose-50 px-3 py-2.5 text-sm text-rose-900 md:col-span-2" role="alert">
                    {formError}
                  </p>
                )}

                <div className="flex flex-wrap gap-3 pt-2 md:col-span-2">
                  <button
                    className="min-h-11 bg-emerald-800 px-5 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                    disabled={submitting}
                    type="submit"
                  >
                    {submitting ? "Creating order..." : "Create order"}
                  </button>
                  <button
                    className="min-h-11 border border-slate-400 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700 disabled:opacity-50"
                    disabled={submitting}
                    onClick={() => setFormOpen(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            </section>
          </dialog>
        )}

        {canReadOrders && <section aria-labelledby="orders-heading" className="border border-slate-300 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
            <div>
              <h3 className="font-semibold" id="orders-heading">{isSewingWorkspace ? "Verified queue and assembly history" : "Orders"}</h3>
              <p className="mt-0.5 text-sm text-slate-600">{isSewingWorkspace ? "Only verified and in-progress batches are returned by the API." : "Persisted cutting orders, newest first"}</p>
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
                    <th className="px-5 py-3 font-semibold" scope="col">Actions</th>
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
                      <td className="px-5 py-4">
                        <button
                          className="font-semibold text-emerald-900 underline decoration-emerald-700 underline-offset-2 hover:text-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                          onClick={() => void openOrderDetails(order)}
                          type="button"
                        >
                          View details
                        </button>
                        {isSewingWorkspace && order.status === "VERIFIED" && (
                          <button
                            className="ml-4 font-semibold text-emerald-900 underline decoration-emerald-700 underline-offset-2 hover:text-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                            onClick={() => void runOrderTransition(`/api/sewing/orders/${order.id}/start`)}
                            type="button"
                          >
                            Start assembly
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>}

        <dialog
          aria-labelledby="order-details-heading"
          className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto border border-slate-300 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/60"
          onCancel={(event) => {
            event.preventDefault();
            setDetailsOpen(false);
          }}
          ref={detailsDialogRef}
        >
          <section className="p-5 sm:p-7">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-800">Persisted order</p>
                <h3 className="mt-1 text-lg font-semibold" id="order-details-heading">{selectedOrder?.orderNo ?? "Order details"}</h3>
              </div>
              <button
                aria-label="Close order details"
                className="flex size-10 shrink-0 items-center justify-center border border-slate-400 text-xl text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                onClick={() => setDetailsOpen(false)}
                ref={detailsCloseRef}
                type="button"
              >
                ×
              </button>
            </div>

            {detailsLoading ? (
              <p aria-live="polite" className="py-6 text-sm text-slate-600">Loading order details...</p>
            ) : detailsError ? (
              <p aria-live="polite" className="border-l-4 border-rose-700 bg-rose-50 px-3 py-2.5 text-sm text-rose-900" role="alert">{detailsError}</p>
            ) : selectedOrder ? (
              <div className="space-y-5">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="font-semibold text-slate-600">Recipe</dt><dd>{selectedOrder.recipe.name} ({selectedOrder.recipe.recipeCode})</dd></div>
                  <div><dt className="font-semibold text-slate-600">Status</dt><dd>{selectedOrder.status.replaceAll("_", " ")}</dd></div>
                  <div><dt className="font-semibold text-slate-600">Target quantity</dt><dd>{selectedOrder.targetQty.toLocaleString()}</dd></div>
                  <div><dt className="font-semibold text-slate-600">Fabric roll</dt><dd>{selectedOrder.fabricRollId}</dd></div>
                  <div><dt className="font-semibold text-slate-600">Actual fabric</dt><dd>{selectedOrder.actualFabricYds.toFixed(2)} yd</dd></div>
                  <div><dt className="font-semibold text-slate-600">Expected fabric</dt><dd>{selectedOrder.expectedFabricYds?.toFixed(2) ?? "Unavailable"} yd</dd></div>
                  <div><dt className="font-semibold text-slate-600">Wastage</dt><dd>{selectedOrder.wastagePct !== null ? `${selectedOrder.wastagePct.toFixed(2)}%` : "Unavailable"}</dd></div>
                  <div><dt className="font-semibold text-slate-600">Created</dt><dd>{new Date(selectedOrder.createdAt).toLocaleString()}</dd></div>
                  {selectedOrder.sewingStartedAt && <div><dt className="font-semibold text-slate-600">Assembly started</dt><dd>{new Date(selectedOrder.sewingStartedAt).toLocaleString()} by {selectedOrder.sewingStartedBy?.fullName ?? "Unknown user"}</dd></div>}
                </dl>
                <div>
                  <h4 className="text-sm font-semibold">{isVerifier ? "Physical component counts" : "Component counts"}</h4>
                  {selectedOrder.expectedComponents.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-600">No component details returned.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-slate-200">
                      {selectedOrder.expectedComponents.map((component) => (
                        <li className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_7rem_10rem] sm:items-center" key={component.componentId}>
                          <span>{component.componentName} <span className="text-slate-600">× {component.piecesPerGarment} · expected {component.expectedQty}</span></span>
                          {isVerifier && selectedOrder.status === "PENDING_VERIFICATION" ? (
                            <label className="text-xs font-semibold text-slate-700">
                              Actual count
                              <input
                                aria-describedby={countDrafts[component.componentId] && !/^(0|[1-9]\d*)$/.test(countDrafts[component.componentId]) ? `count-${component.componentId}-error` : undefined}
                                aria-invalid={Boolean(countDrafts[component.componentId] && !/^(0|[1-9]\d*)$/.test(countDrafts[component.componentId]))}
                                aria-label={`Actual count for ${component.componentName}`}
                                className={`${inputClassName} mt-1`}
                                inputMode="numeric"
                                min={0}
                                onChange={(event) => changeCount(component.componentId, event.target.value)}
                                type="number"
                                step={1}
                                value={countDrafts[component.componentId] ?? ""}
                              />
                              {countDrafts[component.componentId] && !/^(0|[1-9]\d*)$/.test(countDrafts[component.componentId]) && (
                                <span className="mt-1 block text-xs font-medium text-rose-800" id={`count-${component.componentId}-error`}>Enter a non-negative whole number.</span>
                              )}
                            </label>
                          ) : (
                            <span className="font-semibold tabular-nums">Actual: {component.actualQty ?? "Not counted"}</span>
                          )}
                          {(() => {
                            const raw = countDrafts[component.componentId] ?? (component.actualQty === null ? "" : String(component.actualQty));
                            const actual = raw !== "" && /^(0|[1-9]\d*)$/.test(raw) ? Number(raw) : component.actualQty;
                            const status = isVerifier && selectedOrder.status === "PENDING_VERIFICATION"
                              ? trafficStatus(component.expectedQty, actual)
                              : component.status ?? trafficStatus(component.expectedQty, component.actualQty);
                            return status ? (
                              <span className={`inline-flex w-fit px-2.5 py-1 text-xs font-semibold ${status === "GREEN" ? "bg-emerald-100 text-emerald-950" : status === "YELLOW" ? "bg-amber-100 text-amber-950" : "bg-rose-100 text-rose-950"}`}>
                                {trafficLabels[status]}
                              </span>
                            ) : <span className="text-xs font-semibold text-slate-600">NOT COUNTED</span>;
                          })()}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {isVerifier && selectedOrder.status === "PENDING_VERIFICATION" && (
                  <div className="space-y-4 border-t border-slate-200 pt-4">
                    {approvalBlockReason && <p className="border-l-4 border-amber-600 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">{approvalBlockReason}</p>}
                    <button
                      className="min-h-11 border border-slate-500 px-4 text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={savingCounts || transitionLoading}
                      onClick={() => void saveVerificationCounts()}
                      type="button"
                    >
                      {savingCounts ? "Saving counts..." : "Save counts"}
                    </button>
                    <div className="flex flex-wrap gap-3">
                      <button
                        className="min-h-11 bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                        disabled={Boolean(approvalBlockReason) || savingCounts || transitionLoading}
                        onClick={() => void runOrderTransition(`/api/orders/${selectedOrder.id}/approve`)}
                        type="button"
                      >
                        {transitionLoading ? "Processing..." : "Approve batch"}
                      </button>
                      <button
                        className="min-h-11 bg-rose-800 px-4 text-sm font-semibold text-white hover:bg-rose-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                        disabled={!rejectionReason.trim() || savingCounts || transitionLoading}
                        onClick={() => void rejectSelectedOrder()}
                        type="button"
                      >
                        Reject for re-cut
                      </button>
                    </div>
                    <label className="block text-sm font-semibold text-slate-800" htmlFor="rejectionReason">
                      Rejection reason (required)
                      <textarea
                        className={`${inputClassName} mt-1 min-h-24 py-2`}
                        id="rejectionReason"
                        maxLength={2000}
                        onChange={(event) => setRejectionReason(event.target.value)}
                        value={rejectionReason}
                      />
                    </label>
                  </div>
                )}

                {userRole === "cutting_supervisor" && selectedOrder.status === "REJECTED" && (
                  <button
                    className="min-h-11 bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900 disabled:opacity-50"
                    disabled={transitionLoading}
                    onClick={() => void runOrderTransition(`/api/orders/${selectedOrder.id}/recut`)}
                    type="button"
                  >
                    Return re-cut order for verification
                  </button>
                )}

                {isSewingWorkspace && selectedOrder.status === "VERIFIED" && (
                  <button
                    className="min-h-11 bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900 disabled:opacity-50"
                    disabled={transitionLoading}
                    onClick={() => void runOrderTransition(`/api/sewing/orders/${selectedOrder.id}/start`)}
                    type="button"
                  >
                    Start sewing assembly
                  </button>
                )}

                {selectedOrder.verificationHistory.length > 0 && (
                  <section className="border-t border-slate-200 pt-4">
                    <h4 className="text-sm font-semibold">Verification history</h4>
                    <ol className="mt-2 space-y-3">
                      {selectedOrder.verificationHistory.map((entry) => (
                        <li className="border-l-2 border-slate-300 pl-3 text-sm" key={entry.id}>
                          <p className="font-semibold">{entry.decision} by {entry.verifier.fullName} · {new Date(entry.timestamp).toLocaleString()}</p>
                          {entry.rejectionNote && <p className="mt-1 text-rose-900">Reason: {entry.rejectionNote}</p>}
                          <p className="mt-1 text-slate-700">Recorded wastage: {entry.wastagePct?.toFixed(2) ?? "Unavailable"}%</p>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </div>
            ) : null}
          </section>
        </dialog>
      </div>
    </main>
  );
}
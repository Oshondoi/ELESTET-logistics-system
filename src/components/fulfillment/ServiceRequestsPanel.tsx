import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ExecutorAccountSearchResult,
  ServiceRequest,
  ServiceRequestItemDraft,
  RequestSupplyDraft,
  Store,
} from "../../types";
import {
  acceptServiceRequest,
  assignServiceRequestResponsible,
  claimServiceRequestInvite,
  copyServiceRequest,
  createServiceRequestFromForm,
  createServiceRequestInvite,
  fetchRecentExecutorAccounts,
  fetchServiceRequestVersions,
  getRequestDraftDeviceId,
  heartbeatServiceRequestWorkDraft,
  fetchRequestBatchSummaries,
  fetchServiceRequests,
  openServiceRequestWorkDraft,
  rejectServiceRequest,
  removeServiceRequests,
  saveServiceRequestWorkDraft,
  searchExecutorAccounts,
  startServiceRequestWork,
  submitServiceRequest,
  type RequestBatchSummary,
  type ServiceRequestVersion,
} from "../../services/requestService";
import { createStoreInSupabase } from "../../services/storeService";
import { RequestIntakeEditor } from "./RequestIntakeEditor";
import { reassignRejectedServiceRequest } from "../../services/requestService";
import {
  fetchOtkPerformers,
  type OtkPerformer,
} from "../../services/fulfillmentService";

interface Props {
  accountId: string;
  accountShortId: number | null;
  accountName: string;
  stores: Store[];
  userEmail: string;
  userName: string;
  canCreate: boolean;
  canManage: boolean;
  canAssign?: boolean;
  canStartWork?: boolean;
  canCreateLink: boolean;
  clientMode?: boolean;
  onStoreCreated?: (store: Store) => void;
  onBatchesChanged?: () => void;
  onMyDrafts?: () => void;
}

type StoreDraft = {
  storeId: string;
  deliveryMode: "pickup" | "self_delivery";
  intakeMode: "bulk" | "catalog" | "barcodes" | "boxes";
  itemsText: string;
  supplies: RequestSupplyDraft[];
};

const labels: Record<ServiceRequest["status"], string> = {
  draft: "Черновик",
  submitted: "Ожидает исполнителя",
  accepted: "Принята",
  rejected: "Отклонена",
  cancelled: "Отменена",
};
const tones: Record<ServiceRequest["status"], string> = {
  draft: "bg-slate-100 text-slate-600",
  submitted: "bg-amber-50 text-amber-700",
  accepted: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const linesToItems = (value: string): ServiceRequestItemDraft[] =>
  value
    .split("\n")
    .map((line, position) => {
      const [barcode = "", name = "", qty = "0", article = ""] = line
        .split(";")
        .map((part) => part.trim());
      return {
        barcode,
        name,
        qty: Math.max(0, Number.parseInt(qty, 10) || 0),
        article,
        position,
      };
    })
    .filter((item) => item.barcode || item.name || item.qty > 0);

const itemsToLines = (items: ServiceRequestItemDraft[] | undefined) =>
  (items ?? [])
    .map((item) =>
      [item.barcode, item.name ?? "", item.qty, item.article ?? ""].join("; "),
    )
    .join("\n");

export const ServiceRequestsPanel = ({
  accountId,
  accountShortId,
  accountName,
  stores,
  userEmail,
  userName,
  canCreate,
  canManage,
  canAssign = false,
  canStartWork = false,
  canCreateLink,
  clientMode = false,
  onStoreCreated,
  onBatchesChanged,
  onMyDrafts,
}: Props) => {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ServiceRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const [reassigning, setReassigning] = useState<ServiceRequest | null>(null);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const [requestFilter, setRequestFilter] = useState<"active" | "cancelled">("active");
  const [directionFilter, setDirectionFilter] = useState<"all" | "incoming" | "outgoing">("all");
  const [recentExecutors, setRecentExecutors] = useState<ExecutorAccountSearchResult[]>([]);
  const [title, setTitle] = useState("");
  const [name, setName] = useState(userName);
  const [email, setEmail] = useState(userEmail);
  const [comment, setComment] = useState("");
  const [executorQuery, setExecutorQuery] = useState("");
  const [executor, setExecutor] = useState<ExecutorAccountSearchResult | null>(
    null,
  );
  const [executorResults, setExecutorResults] = useState<
    ExecutorAccountSearchResult[]
  >([]);
  const [storeDrafts, setStoreDrafts] = useState<StoreDraft[]>([]);
  const [activeStore, setActiveStore] = useState(0);
  const [saving, setSaving] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreMarketplace, setNewStoreMarketplace] = useState("wildberries");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [viewing, setViewing] = useState<ServiceRequest | null>(null);
  const [viewingBatches, setViewingBatches] = useState<RequestBatchSummary[]>(
    [],
  );
  const [viewingBatchesLoading, setViewingBatchesLoading] = useState(false);
  const [viewingVersions, setViewingVersions] = useState<ServiceRequestVersion[]>([]);
  const [viewingVersionsLoading, setViewingVersionsLoading] = useState(false);
  const [performers, setPerformers] = useState<OtkPerformer[]>([]);
  const [deviceId] = useState(getRequestDraftDeviceId);
  const lastActivityRef = useRef(Date.now());
  const editorHydratingRef = useRef(false);
  const workSaveQueue = useRef<Promise<void>>(Promise.resolve());

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRequests(await fetchServiceRequests(accountId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить заявки");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [accountId]);

  useEffect(() => {
    void fetchRecentExecutorAccounts(accountId)
      .then(setRecentExecutors)
      .catch(() => setRecentExecutors([]));
  }, [accountId]);

  useEffect(() => {
    if (!accountId || !canAssign) {
      setPerformers([]);
      return;
    }
    void fetchOtkPerformers(accountId)
      .then(setPerformers)
      .catch(() => setPerformers([]));
  }, [accountId, canAssign]);

  useEffect(() => {
    const batchIds = (viewing?.stores ?? [])
      .map((row) => row.batch_id)
      .filter((id): id is string => Boolean(id));
    if (batchIds.length === 0) {
      setViewingBatches([]);
      setViewingBatchesLoading(false);
      return;
    }
    setViewingBatchesLoading(true);
    void fetchRequestBatchSummaries(batchIds)
      .then(setViewingBatches)
      .catch(() => setViewingBatches([]))
      .finally(() => setViewingBatchesLoading(false));
  }, [viewing]);

  useEffect(() => {
    if (!viewing) { setViewingVersions([]); return; }
    let active = true;
    setViewingVersionsLoading(true);
    void fetchServiceRequestVersions(viewing.id)
      .then((rows) => { if (active) setViewingVersions(rows); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Не удалось загрузить историю заявки"); })
      .finally(() => { if (active) setViewingVersionsLoading(false); });
    return () => { active = false; };
  }, [viewing?.id]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        setExecutorResults(await searchExecutorAccounts(executorQuery));
      } catch {
        setExecutorResults([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [executorQuery]);

  const openEditor = async (request: ServiceRequest) => {
    setError("");
    editorHydratingRef.current = true;
    try {
      const work = await openServiceRequestWorkDraft(request.id, deviceId);
      setCreating(false);
      setTitle(work.title ?? request.title);
      setName(work.applicantName ?? request.applicant_name ?? userName);
      setEmail(work.applicantEmail ?? request.applicant_email ?? userEmail);
      setComment(work.comment ?? request.comment ?? "");
      const executorId = work.executorAccountId ?? request.executor_account_id;
      setExecutor(work.executor ?? (executorId ? {
        id: executorId,
        short_id: request.executor_company_short_id ?? 0,
        name: request.executor_company_name ?? "",
      } : null));
      setExecutorQuery("");
      setInviteUrl("");
      setStoreDrafts(work.stores ? work.stores.map((row) => ({
        storeId: row.store_id,
        deliveryMode: row.delivery_mode,
        intakeMode: row.intake_mode,
        itemsText: itemsToLines((row.payload.items ?? []) as ServiceRequestItemDraft[]),
        supplies: (row.payload.supplies ?? []) as RequestSupplyDraft[],
      })) : (request.stores ?? []).map((row) => ({
        storeId: row.applicant_store_id,
        deliveryMode: row.delivery_mode,
        intakeMode: row.intake_mode,
        itemsText: itemsToLines(row.payload.items),
        supplies: row.payload.supplies ?? [],
      })));
      setActiveStore(0);
      lastActivityRef.current = Date.now();
      setEditing(request);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось открыть черновик");
    } finally {
      window.setTimeout(() => { editorHydratingRef.current = false; }, 0);
    }
  };

  const openNew = (defaultExecutor?: ExecutorAccountSearchResult, inviteToken?: string) => {
    setEditing(null);
    setCreating(true);
    setTitle("");
    setName(userName);
    setEmail(userEmail);
    setComment("");
    setExecutor(defaultExecutor ?? null);
    setPendingInviteToken(inviteToken ?? null);
    setExecutorQuery("");
    setStoreDrafts([]);
    setActiveStore(0);
    setError("");
  };

  const closeEditor = async (persist = true) => {
    if (persist && editing) {
      try { await persistWorkDraft(editing.id, payload()); }
      catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить черновик"); return; }
    }
    setCreating(false);
    setEditing(null);
    setPendingInviteToken(null);
  };

  useEffect(() => {
    const token = localStorage.getItem("elestet-pending-request-invite");
    if (!token || !accountId) return;
    const requestedAccountId = localStorage.getItem(
      "elestet-pending-request-account",
    );
    if (requestedAccountId && requestedAccountId !== accountId) return;
    const replaceExisting =
      localStorage.getItem("elestet-pending-request-replace") === "1";
    void (async () => {
      try {
        const invitedExecutor = await claimServiceRequestInvite(
          token,
          accountId,
          replaceExisting,
        );
        localStorage.removeItem("elestet-pending-request-invite");
        localStorage.removeItem("elestet-pending-request-account");
        localStorage.removeItem("elestet-pending-request-replace");
        openNew(invitedExecutor, token);
      } catch (inviteError) {
        setError(
          inviteError instanceof Error
            ? inviteError.message
            : "Не удалось открыть приглашение",
        );
      }
    })();
    // Invite is consumed once for the active company.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const createDraft = () => openNew();

  const resolvedExecutorId = executor?.id ?? editing?.executor_account_id ?? "";
  const payload = () => ({
    title,
    executorAccountId: resolvedExecutorId,
    executor,
    applicantName: name,
    applicantEmail: email,
    comment,
    stores: storeDrafts.map((store, position) => ({
      store_id: store.storeId,
      position,
      delivery_mode: store.deliveryMode,
      intake_mode: store.intakeMode,
      payload: { items: linesToItems(store.itemsText), supplies: store.supplies },
    })),
  });

  const persistWorkDraft = async (requestId: string, value: ReturnType<typeof payload>) => {
    const pending = workSaveQueue.current.then(() => saveServiceRequestWorkDraft(requestId, deviceId, value)).then(() => undefined);
    workSaveQueue.current = pending.catch(() => undefined);
    await pending;
  };

  useEffect(() => {
    if (!editing || saving || editorHydratingRef.current) return;
    const timer = window.setTimeout(() => {
      void persistWorkDraft(editing.id, payload())
        .catch((e) => setError(e instanceof Error ? e.message : "Не удалось автоматически сохранить черновик"));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [editing?.id, editing?.status, deviceId, title, name, email, comment, executor, storeDrafts, saving]);

  useEffect(() => {
    if (!editing) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current < 120_000) {
        void heartbeatServiceRequestWorkDraft(editing.id, deviceId)
          .then((active) => { if (!active) setError("Право редактирования передано другому устройству. Откройте заявку заново."); })
          .catch(() => setError("Не удалось продлить право редактирования черновика"));
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [editing?.id, editing?.status, deviceId]);

  const save = async (submit: boolean) => {
    if (!editing && !creating) return;
    if (!resolvedExecutorId) {
      setError("Выберите исполнителя");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (creating) {
        await createServiceRequestFromForm(accountId, payload(), pendingInviteToken);
      } else if (editing) {
        await persistWorkDraft(editing.id, payload());
        if (submit) await submitServiceRequest(editing.id);
      }
      await closeEditor(false);
      await load();
      if (submit) onBatchesChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить заявку");
    } finally {
      setSaving(false);
    }
  };

  const removeRequests = async (ids: string[]) => {
    if (!ids.length) return;
    const selected = requests.filter((request) => ids.includes(request.id));
    const deleting = selected.filter((request) => request.current_version === 0).length;
    const cancelling = selected.length - deleting;
    if (!window.confirm(`Удалить черновиков: ${deleting}. Отменить подтверждённых заявок: ${cancelling}. Продолжить?`)) return;
    setSaving(true);
    setError("");
    try {
      await removeServiceRequests(ids);
      setSelectedRequestIds([]);
      await load();
      onBatchesChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить заявки");
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setSaving(true);
    setError("");
    try {
      await fn();
      await load();
      onBatchesChanged?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
      );
    } finally {
      setSaving(false);
    }
  };

  const copyInviteUrl = async () => {
    if (!inviteUrl) return;
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(inviteUrl);
      else {
        const textarea = document.createElement("textarea");
        textarea.value = inviteUrl;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 900);
    } catch {
      setError("Не удалось скопировать ссылку");
      setInviteCopied(false);
    }
  };

  const closeInvite = () => {
    setInviteUrl("");
    setInviteCopied(false);
  };

  const addStore = (storeId: string) => {
    if (!storeId || storeDrafts.some((row) => row.storeId === storeId)) return;
    setStoreDrafts((current) => [
      ...current,
      {
        storeId,
        deliveryMode: "self_delivery",
        intakeMode: "bulk",
        itemsText: "",
        supplies: [],
      },
    ]);
    setActiveStore(storeDrafts.length);
  };

  const createStore = async () => {
    if (!newStoreName.trim()) return;
    setSaving(true);
    try {
      const store = await createStoreInSupabase(
        { name: newStoreName, marketplace: newStoreMarketplace },
        accountId,
      );
      onStoreCreated?.(store);
      addStore(store.id);
      setNewStoreName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать магазин");
    } finally {
      setSaving(false);
    }
  };

  const availableStores = useMemo(
    () =>
      stores.filter(
        (store) =>
          !store.deleted_at &&
          !storeDrafts.some((draft) => draft.storeId === store.id),
      ),
    [stores, storeDrafts],
  );
  const visibleRequests = useMemo(() => requests.filter((request) =>
    (requestFilter === "cancelled" ? request.status === "cancelled" : request.status !== "cancelled") &&
    (directionFilter === "all" || (directionFilter === "incoming"
      ? request.executor_account_id === accountId
      : request.applicant_account_id === accountId))
  ), [requests, requestFilter, directionFilter, accountId]);
  const suggestedExecutors = executorQuery.trim() ? executorResults : recentExecutors;
  const currentStoreDraft = storeDrafts[activeStore];
  const currentStore = currentStoreDraft
    ? stores.find((store) => store.id === currentStoreDraft.storeId)
    : null;

  if (loading)
    return (
      <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400">
        Загрузка заявок…
      </div>
    );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between rounded-3xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
        <div>
          <p className="font-semibold text-slate-800">Заявки клиентов</p>
          <p className="text-xs text-slate-400">
            R — заявка, по одной P на каждый магазин
          </p>
        </div>
        <div className="flex gap-2">
          {onMyDrafts && <button type="button" onClick={onMyDrafts} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Мои сохранённые черновики</button>}
          {canCreateLink && !clientMode && (
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void act(async () => {
                  const invite = await createServiceRequestInvite(accountId);
                  const url = `${window.location.origin}/request-invite/${invite.token}`;
                  setInviteCopied(false);
                  setInviteUrl(url);
                })
              }
              className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
            >
              Ссылка для клиента
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={createDraft}
              className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Новая заявка
            </button>
          )}
        </div>
      </div>
      {inviteUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="service-request-invite-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeInvite();
          }}
        >
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="service-request-invite-title"
                  className="text-lg font-semibold text-slate-900"
                >
                  Ссылка для клиента
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Первоначальный срок действия — 30 дней.
                </p>
              </div>
              <button
                type="button"
                onClick={closeInvite}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Закрыть окно"
              >
                ×
              </button>
            </div>
            <button
              type="button"
              onClick={() => void copyInviteUrl()}
              className={`mt-5 block w-full break-all rounded-2xl border px-4 py-4 text-left font-mono text-sm transition focus:outline-none focus:ring-2 ${inviteCopied ? "border-emerald-300 bg-emerald-50 text-emerald-700 ring-emerald-200" : "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-400 hover:bg-blue-100 focus:ring-blue-300"}`}
            >
              {inviteUrl}
            </button>
          </div>
        </div>
      )}
      <div className="flex w-fit gap-1 rounded-2xl bg-slate-100 p-1 text-sm">
        <button type="button" onClick={() => { setRequestFilter("active"); setSelectedRequestIds([]); }} className={`rounded-xl px-3 py-1.5 ${requestFilter === "active" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Активные</button>
        <button type="button" onClick={() => { setRequestFilter("cancelled"); setSelectedRequestIds([]); }} className={`rounded-xl px-3 py-1.5 ${requestFilter === "cancelled" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Отменённые</button>
      </div>
      <div className="flex w-fit gap-1 rounded-2xl bg-white p-1 text-sm ring-1 ring-slate-100">
        {(["all", "outgoing", "incoming"] as const).map((value) => <button key={value} type="button" onClick={() => { setDirectionFilter(value); setSelectedRequestIds([]); }} className={`rounded-xl px-3 py-1.5 ${directionFilter === value ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}>{value === "all" ? "Все" : value === "outgoing" ? "Исходящие" : "Входящие"}</button>)}
      </div>
      {visibleRequests.length === 0 ? (
        <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400">
          Заявок пока нет
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
          {selectedRequestIds.length > 0 && canCreate && (
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-sm">
              <span>Выбрано: {selectedRequestIds.length}</span>
              <button type="button" disabled={saving} onClick={() => void removeRequests(selectedRequestIds)} className="rounded-xl bg-rose-50 px-3 py-1.5 text-rose-600 disabled:opacity-50">
                Удалить выбранные
              </button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">
                  <input type="checkbox" aria-label="Выбрать все заявки" checked={visibleRequests.filter((request) => request.applicant_account_id === accountId && request.status !== "cancelled").length > 0 && visibleRequests.filter((request) => request.applicant_account_id === accountId && request.status !== "cancelled").every((request) => selectedRequestIds.includes(request.id))} onChange={(event) => setSelectedRequestIds(event.target.checked ? visibleRequests.filter((request) => request.applicant_account_id === accountId && request.status !== "cancelled").map((request) => request.id) : [])} disabled={!canCreate} />
                </th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Заявка</th>
                <th className="px-4 py-3">Магазины / партии</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRequests.map((request) => {
                const isApplicant = request.applicant_account_id === accountId;
                return (
                  <tr key={request.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => setViewing(request)}>
                    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                      {canCreate && isApplicant && request.status !== "cancelled" && <input type="checkbox" aria-label={`Выбрать заявку R-${request.short_id}`} checked={selectedRequestIds.includes(request.id)} onChange={(event) => setSelectedRequestIds((current) => event.target.checked ? [...current, request.id] : current.filter((id) => id !== request.id))} />}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <span className="text-violet-500">
                        C-
                        {request.applicant_company_short_id ??
                          (isApplicant ? accountShortId : "—")}
                      </span>
                      <br />
                      R-{request.short_id}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">
                        {request.title || `Заявка R-${request.short_id}`}
                      </p>
                      <p className="text-xs text-slate-400">
                        {isApplicant && request.executor_account_id === accountId
                          ? "Исходящая · Входящая"
                          : isApplicant ? "Исходящая" : `Заказчик: ${request.applicant_name || "—"}`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {(request.stores ?? []).map((row) => {
                        const store = stores.find(
                          (item) => item.id === row.applicant_store_id,
                        );
                        return (
                          <div key={row.id} className="text-xs text-slate-600">
                            A-{store?.short_id ?? "—"} ·{" "}
                            {store?.name ?? "Магазин"}{" "}
                            {row.batch_id ? "· P создана" : ""}
                          </div>
                        );
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-xl px-2 py-1 text-xs font-medium ${tones[request.status]}`}
                      >
                        {labels[request.status]}
                      </span>
                      {request.rejection_comment && (
                        <p className="mt-1 max-w-52 text-xs text-rose-500">
                          {request.rejection_comment}
                        </p>
                      )}
                      {request.status === "cancelled" && <p className="mt-1 text-xs text-rose-500">Отменено заказчиком</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {new Date(request.created_at).toLocaleDateString("ru-RU")}
                    </td>
                    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                      <div className="flex flex-wrap justify-end gap-1">
                        {canCreate && isApplicant && request.status === "rejected" && (
                          <button type="button" onClick={() => { setReassigning(request); setExecutor(null); setExecutorQuery(""); setError(""); }} className="rounded-xl border px-2.5 py-1.5 text-xs">
                            Другой исполнитель
                          </button>
                        )}
                        {canCreate &&
                          isApplicant &&
                          ["draft", "submitted", "accepted"].includes(
                            request.status,
                          ) && (
                            <button
                              onClick={() => openEditor(request)}
                              className="rounded-xl border px-2.5 py-1.5 text-xs"
                            >
                              {request.status === "draft"
                                ? "Редактировать"
                                : "Корректировка"}
                            </button>
                          )}
                        {canCreate && isApplicant && request.status !== "cancelled" && (
                          <button type="button" disabled={saving} onClick={() => void removeRequests([request.id])} className="rounded-xl border border-rose-200 px-2.5 py-1.5 text-xs text-rose-600 disabled:opacity-50">
                            Удалить
                          </button>
                        )}
                        {canCreate &&
                          isApplicant &&
                          request.status !== "draft" && (
                            <button
                              onClick={() =>
                                void act(async () => {
                                  openEditor(
                                    await copyServiceRequest(request.id),
                                  );
                                })
                              }
                              className="rounded-xl border px-2.5 py-1.5 text-xs"
                            >
                              Копия
                            </button>
                          )}
                        {canManage &&
                          !isApplicant &&
                          request.status === "submitted" && (
                            <>
                              <button
                                disabled={saving}
                                onClick={() =>
                                  void act(() =>
                                    acceptServiceRequest(request.id),
                                  )
                                }
                                className="rounded-xl bg-emerald-600 px-2.5 py-1.5 text-xs text-white"
                              >
                                Принять
                              </button>
                              <button
                                disabled={saving}
                                onClick={() => {
                                  const reason =
                                    window.prompt("Причина отклонения") ?? "";
                                  void act(() =>
                                    rejectServiceRequest(request.id, reason),
                                  );
                                }}
                                className="rounded-xl bg-rose-50 px-2.5 py-1.5 text-xs text-rose-600"
                              >
                                Отклонить
                              </button>
                            </>
                          )}
                        {canAssign &&
                          !isApplicant &&
                          request.status === "accepted" && (
                            <select
                              aria-label={`Ответственный за заявку R-${request.short_id}`}
                              value={request.responsible_user_id ?? ""}
                              disabled={saving}
                              onChange={(event) =>
                                void act(() =>
                                  assignServiceRequestResponsible(
                                    request.id,
                                    event.target.value || null,
                                  ),
                                )
                              }
                              className="max-w-44 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600"
                            >
                              <option value="">Ответственный</option>
                              {performers.map((performer) => (
                                <option
                                  key={performer.user_id}
                                  value={performer.user_id}
                                >
                                  {performer.full_name}
                                </option>
                              ))}
                            </select>
                          )}
                        {canStartWork &&
                          !isApplicant &&
                          request.status === "accepted" &&
                          (request.work_started_at ? (
                            <span className="rounded-xl bg-blue-50 px-2.5 py-1.5 text-xs text-blue-600">
                              Работа начата
                            </span>
                          ) : (
                            <button
                              disabled={saving}
                              onClick={() =>
                                void act(() =>
                                  startServiceRequestWork(request.id),
                                )
                              }
                              className="rounded-xl bg-blue-600 px-2.5 py-1.5 text-xs text-white disabled:opacity-50"
                            >
                              Начать работу
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {reassigning && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4">
        <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
          <h2 className="text-lg font-semibold">Исполнитель заявки R-{reassigning.short_id}</h2>
          <p className="mt-2 text-sm text-slate-500">Заявка и партии сохранят свои номера. Новый исполнитель получит заявку после отправки.</p>
          <input value={executor ? `C-${executor.short_id} · ${executor.name}` : executorQuery} onChange={(event) => { setExecutor(null); setExecutorQuery(event.target.value); }} placeholder="Название компании или C-ID" className="mt-4 w-full rounded-xl border px-3 py-2" />
          {!executor && suggestedExecutors.filter((row) => row.id !== reassigning.executor_account_id).map((row) => <button key={row.id} type="button" onClick={() => setExecutor(row)} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-blue-50">C-{row.short_id} · {row.name}</button>)}
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => setReassigning(null)} className="rounded-xl border px-4 py-2">Отмена</button>
            <button type="button" disabled={saving || !executor} onClick={async () => {
              if (!executor) return;
              setSaving(true); setError("");
              try { await reassignRejectedServiceRequest(reassigning.id, executor.id); setReassigning(null); await load(); onBatchesChanged?.(); }
              catch (e) { setError(e instanceof Error ? e.message : "Не удалось отправить заявку"); }
              finally { setSaving(false); }
            }} className="rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Подтвердить и отправить</button>
          </div>
        </div>
      </div>}

      {(editing || creating) && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4"
          onMouseDown={() => !saving && closeEditor()}
        >
          <div
            className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            onChangeCapture={() => { lastActivityRef.current = Date.now(); }}
            onKeyDown={() => { lastActivityRef.current = Date.now(); }}
          >
            <div className="flex justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="flex items-center gap-3 text-lg font-semibold text-slate-800">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">+</span>
                  {creating ? "Новая заявка" : `R-${editing?.short_id} · ${editing?.current_version ? "Корректировка" : "Редактирование заявки"}`}
                </h2>
                <p className="text-xs text-slate-400">
                  {creating
                    ? "Номер R появится только после сохранения. Товары добавляются внутри заявки."
                    : "Наполнение сохраняется в отдельном черновике БД; в журнал попадает подтверждение."}
                </p>
              </div>
              <button
                onClick={() => void closeEditor()}
                className="h-8 w-8 rounded-xl text-slate-400 hover:bg-slate-100"
              >
                ×
              </button>
            </div>
            <div className="grid gap-3 px-6 pt-5 sm:grid-cols-2">
              <label className="text-xs text-slate-500">
                Отправитель
                <input value={`C-${accountShortId ?? "—"} · ${editing?.applicant_company_name ?? accountName}`} readOnly className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
              </label>
              <label className="text-xs text-slate-500">
                Название
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-slate-500">
                Исполнитель: C-ID или название
                <input
                  disabled={(editing?.current_version ?? 0) > 0}
                  value={
                    executor
                      ? `C-${executor.short_id} · ${executor.name}`
                      : executorQuery
                  }
                  onChange={(e) => {
                    setExecutor(null);
                    setExecutorQuery(e.target.value);
                  }}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50"
                />
                {!executor && suggestedExecutors.length > 0 && (
                  <div className="relative">
                    <div className="absolute z-10 mt-1 w-full rounded-xl border bg-white p-1 shadow-xl">
                      {!executorQuery.trim() && <p className="px-3 py-1 text-xs text-slate-400">Работали вместе</p>}
                      {suggestedExecutors.map((result) => (
                        <button
                          key={result.id}
                          onClick={() => {
                            setExecutor(result);
                            setExecutorResults([]);
                          }}
                          className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-blue-50"
                        >
                          C-{result.short_id} · {result.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </label>
              <label className="text-xs text-slate-500">
                Имя заявителя
                <input
                  disabled={(editing?.current_version ?? 0) > 0}
                  title={
                    (editing?.current_version ?? 0) > 0
                      ? "Меняется отдельным подтверждаемым действием"
                      : undefined
                  }
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50"
                />
              </label>
              <label className="text-xs text-slate-500">
                Почта
                <input
                  disabled={(editing?.current_version ?? 0) > 0}
                  title={
                    (editing?.current_version ?? 0) > 0
                      ? "Меняется отдельным подтверждаемым действием"
                      : undefined
                  }
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50"
                />
              </label>
            </div>
            <label className="mt-3 block px-6 text-xs text-slate-500">
              Комментарий
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </label>
            {!creating && <div className="mx-6 mt-4 rounded-2xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {storeDrafts.map((draft, index) => {
                  const store = stores.find(
                    (item) => item.id === draft.storeId,
                  );
                  return (
                    <button
                      key={draft.storeId}
                      onClick={() => setActiveStore(index)}
                      className={`rounded-xl px-3 py-2 text-xs ${activeStore === index ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
                    >
                      A-{store?.short_id ?? "—"} · {store?.name}
                    </button>
                  );
                })}
                <select
                  disabled={(editing?.current_version ?? 0) > 0}
                  value=""
                  onChange={(e) => addStore(e.target.value)}
                  className="rounded-xl border px-2 py-2 text-xs"
                >
                  <option value="">+ Выбрать магазин</option>
                  {availableStores.map((store) => (
                    <option key={store.id} value={store.id}>
                      A-{store.short_id ?? "—"} · {store.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  placeholder="Новый магазин"
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"
                />
                <select
                  value={newStoreMarketplace}
                  onChange={(e) => setNewStoreMarketplace(e.target.value)}
                  className="rounded-xl border px-2 text-sm"
                >
                  <option value="wildberries">Wildberries</option>
                  <option value="ozon">Ozon</option>
                  <option value="other">Другое</option>
                </select>
                <button
                  disabled={(editing?.current_version ?? 0) > 0}
                  onClick={() => void createStore()}
                  className="rounded-xl border px-3 text-sm"
                >
                  Создать
                </button>
              </div>
              {currentStoreDraft && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{currentStore?.name}</p>
                    <button
                      disabled={(editing?.current_version ?? 0) > 0}
                      onClick={() => {
                        setStoreDrafts((rows) =>
                          rows.filter((_, index) => index !== activeStore),
                        );
                        setActiveStore(0);
                      }}
                      className="text-xs text-rose-500"
                    >
                      Убрать вкладку
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-slate-500">
                      Способ приёмки
                      <select
                        value={currentStoreDraft.intakeMode}
                        onChange={(e) =>
                          setStoreDrafts((rows) =>
                            rows.map((row, index) =>
                              index === activeStore
                                ? {
                                    ...row,
                                    intakeMode: e.target
                                      .value as StoreDraft["intakeMode"],
                                  }
                                : row,
                            ),
                          )
                        }
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      >
                        <option value="bulk">Навалом</option>
                        <option value="catalog">Каталог</option>
                        <option value="barcodes">По баркодам</option>
                        <option value="boxes">Готовые короба</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-500">
                      Передача
                      <select
                        value={currentStoreDraft.deliveryMode}
                        onChange={(e) =>
                          setStoreDrafts((rows) =>
                            rows.map((row, index) =>
                              index === activeStore
                                ? {
                                    ...row,
                                    deliveryMode: e.target
                                      .value as StoreDraft["deliveryMode"],
                                  }
                                : row,
                            ),
                          )
                        }
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      >
                        <option value="self_delivery">Сами отправляют</option>
                        <option value="pickup">Исполнитель забирает</option>
                      </select>
                    </label>
                  </div>
                  <RequestIntakeEditor
                    catalogMode={currentStoreDraft.intakeMode === "catalog"} accountId={accountId} storeId={currentStoreDraft.storeId}
                    itemsText={currentStoreDraft.itemsText}
                    onItemsTextChange={(value) => { lastActivityRef.current = Date.now(); setStoreDrafts((rows) => rows.map((row, index) => index === activeStore ? { ...row, itemsText: value } : row)); }}
                    supplies={currentStoreDraft.supplies}
                    onSuppliesChange={(value) => { lastActivityRef.current = Date.now(); setStoreDrafts((rows) => rows.map((row, index) => index === activeStore ? { ...row, supplies: value } : row)); }}
                    boxesMode={currentStoreDraft.intakeMode === "boxes"}
                  />
                </div>
              )}
            </div>}
            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 px-6 py-5">
              <button
                disabled={saving || !resolvedExecutorId}
                onClick={() => void save(false)}
                className="rounded-2xl border px-4 py-2 text-sm"
              >
                {creating ? "Сохранить заявку" : "Сохранить черновик"}
              </button>
              {!creating && <button
                disabled={
                  saving || !resolvedExecutorId || storeDrafts.length === 0
                }
                onClick={() => void save(true)}
                title={
                  !resolvedExecutorId
                    ? "Выберите исполнителя"
                    : storeDrafts.length === 0
                      ? "Добавьте магазин"
                      : undefined
                }
                className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-medium text-white disabled:bg-slate-300"
              >
                {(editing?.current_version ?? 0) > 0 ? "Подтвердить корректировку" : "Подтвердить и отправить"}
              </button>}
            </div>
          </div>
        </div>
      )}
      {viewing && (
        <div
          className="fixed inset-0 z-[109] flex items-center justify-center bg-black/45 p-4"
          onMouseDown={() => setViewing(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-xs text-violet-500">
                  C-{viewing.applicant_company_short_id ?? "—"} · R-
                  {viewing.short_id}
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {viewing.title || "Заявка"}
                </h2>
              </div>
              <button
                onClick={() => setViewing(null)}
                className="h-8 w-8 rounded-xl text-slate-400 hover:bg-slate-100"
              >
                ×
              </button>
            </div>
            <div className="mt-4 space-y-2 rounded-2xl bg-slate-50 p-4 text-sm">
              <p>
                <span className="text-slate-400">Заказчик:</span>{" "}
                {viewing.applicant_name || "—"}
              </p>
              <p>
                <span className="text-slate-400">Почта:</span>{" "}
                {viewing.applicant_email || "—"}
              </p>
              <p>
                <span className="text-slate-400">Статус:</span>{" "}
                {labels[viewing.status]}
              </p>
              <p>
                <span className="text-slate-400">Версия:</span>{" "}
                {viewing.current_version}
              </p>
              {viewing.comment && (
                <p>
                  <span className="text-slate-400">Комментарий:</span>{" "}
                  {viewing.comment}
                </p>
              )}
            </div>
            <div className="mt-3 space-y-2">
              {(viewing.stores ?? []).map((row) => {
                const store = stores.find(
                  (item) => item.id === row.applicant_store_id,
                );
                return (
                  <div
                    key={row.id}
                    className="rounded-2xl border px-4 py-3 text-sm"
                  >
                    <p className="font-medium">
                      A-{store?.short_id ?? "—"} · {store?.name ?? "Магазин"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {row.intake_mode} · {row.delivery_mode} ·{" "}
                      {(row.payload.items ?? []).length} позиций
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Журнал подтверждений</p>
              {viewingVersionsLoading ? <p className="mt-2 text-xs text-slate-400">Загрузка истории…</p>
                : viewingVersions.length === 0 ? <p className="mt-2 text-xs text-slate-400">Подтверждений ещё нет</p>
                : <div className="mt-2 space-y-2">{viewingVersions.map((version) => <details key={version.id} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-medium text-slate-700">Версия {version.version} · {version.event_type} · {new Date(version.confirmed_at).toLocaleString("ru-RU")}</summary>
                  <div className="mt-2 space-y-2 text-slate-600">{(version.snapshot.stores ?? []).map((store) => <div key={store.id} className="rounded-lg bg-slate-50 p-2">
                    <p className="font-medium">Магазин · {store.id.slice(0, 8)}</p>
                    {(store.payload?.items ?? []).map((item, index) => <p key={`${item.barcode}-${index}`} className="mt-1 font-mono">{item.barcode || item.name || "Товар"} · {item.qty} шт.</p>)}
                    {(store.payload?.supplies ?? []).map((supply) => <div key={supply.key} className="mt-2 border-t pt-2">
                      <p>Поставка: {supply.warehouse_name}</p>
                      {supply.boxes.map((box, index) => <p key={box.key} className="font-mono">Короб №{index + 1}: {box.items.map((item) => `${item.barcode} × ${item.qty}`).join(", ")}</p>)}
                    </div>)}
                  </div>)}</div>
                </details>)}</div>}
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Связанные партии и документы
              </p>
              {viewingBatchesLoading ? (
                <p className="mt-2 text-sm text-slate-400">Загрузка…</p>
              ) : viewingBatches.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">Партий пока нет</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {viewingBatches.map((batch) => (
                    <div
                      key={batch.id}
                      className="rounded-2xl bg-slate-50 px-4 py-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">
                          P-{batch.short_id ?? "—"} · {batch.name}
                        </p>
                        <span className="text-xs text-slate-500">
                          {batch.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Этап: {batch.current_stage || "—"} · Приём заявки:{" "}
                        {batch.request_acceptance_status}
                      </p>
                      {batch.documents.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {batch.documents.map((document) => (
                            <span
                              key={document.id}
                              className="rounded-lg bg-white px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-200"
                            >
                              {document.kind === "acceptance_act"
                                ? "Акт"
                                : "Счёт"}{" "}
                              · ред. {document.revision} · {document.status}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

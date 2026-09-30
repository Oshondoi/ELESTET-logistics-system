import { useEffect, useMemo, useRef, useState } from "react";
import type { ExecutorAccountSearchResult, ServiceRequestItemDraft, Store } from "../types";
import { fetchStoresFromSupabase } from "../services/storeService";
import { RequestIntakeEditor } from "../components/fulfillment/RequestIntakeEditor";
import {
  heartbeatMyRequestReserve,
  listMyRequestReserves,
  openMyRequestReserve,
  saveMyRequestReserve,
  searchExecutorAccounts,
  submitMyRequestReserve,
  type MyRequestReserve,
  type ReservedInviteStore,
} from "../services/requestService";

type StoreForm = Omit<ReservedInviteStore, "items" | "position"> & { itemsText: string };
const emptyStore = (): StoreForm => ({
  store_id: "", name: "", marketplace: "wildberries", delivery_mode: "self_delivery",
  intake_mode: "bulk", itemsText: "", supplies: [],
});
const linesToItems = (value: string): ServiceRequestItemDraft[] => value.split("\n")
  .map((line, position) => {
    const [barcode = "", name = "", quantity = "0", article = ""] = line.split(";").map((part) => part.trim());
    return { barcode, name, qty: Math.max(0, Number.parseInt(quantity, 10) || 0), article, position };
  })
  .filter((item) => item.barcode || item.name || item.qty > 0);

export const MyRequestDraftsPage = ({ onMaterialized, onSignOut, onCreateCompany, onBack, accounts }: {
  onMaterialized: (accountId: string) => void;
  onSignOut: () => void;
  onCreateCompany: () => void;
  onBack?: () => void;
  accounts?: Array<{ id: string; short_id: number | null; name: string }>;
}) => {
  const [rows, setRows] = useState<MyRequestReserve[]>([]);
  const [activeId, setActiveId] = useState("");
  const [hydratedId, setHydratedId] = useState("");
  const [openAttempt, setOpenAttempt] = useState(0);
  const [companyName, setCompanyName] = useState("Основная компания");
  const [applicantAccountId, setApplicantAccountId] = useState(accounts?.[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [stores, setStores] = useState<StoreForm[]>([emptyStore()]);
  const [activeScannerStore, setActiveScannerStore] = useState(0);
  const [existingStores, setExistingStores] = useState<Store[]>([]);
  const [executor, setExecutor] = useState<ExecutorAccountSearchResult | null>(null);
  const [executorQuery, setExecutorQuery] = useState("");
  const [executorResults, setExecutorResults] = useState<ExecutorAccountSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const draftCacheRef = useRef<Record<string, Record<string, unknown>>>({});
  const lastActivityRef = useRef(Date.now());
  const active = useMemo(() => rows.find((row) => row.invite_id === activeId) ?? null, [rows, activeId]);
  useEffect(() => {
    if (activeScannerStore >= stores.length) setActiveScannerStore(0);
  }, [activeScannerStore, stores.length]);
  useEffect(() => { lastActivityRef.current = Date.now(); }, [stores]);

  useEffect(() => {
    void listMyRequestReserves()
      .then((result) => { setRows(result); setActiveId(result[0]?.invite_id ?? ""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить заявки"))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    setHydratedId("");
    if (!active) return;
    let cancelled = false;
    void openMyRequestReserve(active.invite_id).then((remoteDraft) => {
    if (cancelled) return;
    const draft = Object.keys(remoteDraft).length
      ? remoteDraft
      : draftCacheRef.current[active.invite_id] ?? active.draft;
    setCompanyName(typeof draft.companyName === "string" ? draft.companyName : "Основная компания");
    setTitle(typeof draft.title === "string" ? draft.title : "");
    setComment(typeof draft.comment === "string" ? draft.comment : "");
    setStores(Array.isArray(draft.stores) && draft.stores.length ? draft.stores as StoreForm[] : [emptyStore()]);
    setActiveScannerStore(0);
    const savedExecutor = draft.executor && typeof draft.executor === "object"
      ? draft.executor as ExecutorAccountSearchResult : null;
    setExecutor(savedExecutor ?? {
      id: active.executor_account_id,
      short_id: active.executor_short_id,
      name: active.executor_name,
    });
    setExecutorQuery("");
    setHydratedId(active.invite_id);
    setError("");
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Черновик сейчас открыт на другом устройстве"); });
    return () => { cancelled = true; };
  }, [activeId, rows, openAttempt]);
  useEffect(() => {
    if (!active || hydratedId !== active.invite_id) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current > 120_000) return;
      void heartbeatMyRequestReserve(active.invite_id).then((ok) => {
        if (!ok) { setHydratedId(""); setError("Право записи черновика истекло. Выберите заявку снова, чтобы продолжить."); }
      }).catch(() => setHydratedId(""));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeId, hydratedId]);
  useEffect(() => {
    if (!active || !loaded || hydratedId !== active.invite_id) return;
    const timer = window.setTimeout(() => {
      const draft = { companyName, title, comment, stores, executor };
      draftCacheRef.current[active.invite_id] = draft;
      void saveMyRequestReserve(active.invite_id, draft)
        .catch((e) => setError(e instanceof Error ? e.message : "Не удалось сохранить черновик"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeId, hydratedId, companyName, title, comment, stores, executor, loaded]);
  useEffect(() => {
    if (executor || !executorQuery.trim()) { setExecutorResults([]); return; }
    const timer = window.setTimeout(() => {
      void searchExecutorAccounts(executorQuery).then(setExecutorResults).catch(() => setExecutorResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [executor, executorQuery]);
  useEffect(() => {
    if (!applicantAccountId) { setExistingStores([]); return; }
    let active = true;
    void fetchStoresFromSupabase(applicantAccountId)
      .then((result) => { if (active) setExistingStores(result); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Не удалось загрузить магазины"); });
    return () => { active = false; };
  }, [applicantAccountId]);

  const updateStore = (index: number, change: Partial<StoreForm>) =>
    setStores((current) => current.map((row, i) => i === index ? { ...row, ...change } : row));
  const switchDraft = (inviteId: string) => {
    if (active && hydratedId === active.invite_id) {
      const draft = { companyName, title, comment, stores, executor };
      draftCacheRef.current[active.invite_id] = draft;
      void saveMyRequestReserve(active.invite_id, draft)
        .catch((e) => setError(e instanceof Error ? e.message : "Не удалось сохранить черновик"));
    }
    setActiveId(inviteId);
  };
  const confirm = async () => {
    if (!active || !executor || hydratedId !== active.invite_id) return;
    setBusy(true);
    setError("");
    try {
      await saveMyRequestReserve(active.invite_id, { companyName, title, comment, stores, executor });
      const result = await submitMyRequestReserve(active.invite_id, {
        companyName, applicantName: active.full_name, applicantEmail: active.email,
        title, comment, executorAccountId: executor.id, applicantAccountId: applicantAccountId || null,
        stores: stores.map((store, position) => ({ ...store, position, items: linesToItems(store.itemsText) })),
      });
      onMaterialized(result.account_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подтвердить заявку");
    } finally {
      setBusy(false);
    }
  };

  return <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-800" onChangeCapture={() => { lastActivityRef.current = Date.now(); }} onKeyDown={() => { lastActivityRef.current = Date.now(); }}>
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Клиентский кабинет</p>
          <h1 className="mt-1 text-2xl font-semibold">Мои заявки</h1></div>
        <div className="flex gap-2">{onBack && <button type="button" onClick={onBack} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">В ELESTET</button>}
          <button type="button" onClick={onSignOut} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">Выйти</button></div>
      </div>
      {error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
      {!loaded ? <p className="mt-8 text-sm text-slate-500">Загрузка…</p>
        : rows.length === 0 ? <div className="mt-8 rounded-2xl bg-white p-6 text-sm text-slate-500">Незавершённых заявок нет. Чтобы начать новую, откройте действующую клиентскую ссылку.
          {!accounts?.length && <button type="button" onClick={onCreateCompany} className="mt-4 block rounded-xl bg-blue-600 px-4 py-2 text-white">Создать компанию вручную</button>}
        </div>
        : <div className="mt-5 grid gap-5 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="space-y-2">
            {rows.map((row) => <button type="button" key={row.invite_id} onClick={() => switchDraft(row.invite_id)}
              className={`w-full rounded-2xl border px-4 py-3 text-left text-sm ${activeId === row.invite_id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}>
              <span className="font-medium">Заявка для C-{row.executor_short_id}</span>
              <span className="mt-1 block text-xs text-slate-500">{row.executor_name}</span>
              <span className="mt-1 block text-xs text-slate-400">{row.link_active ? "Ссылка действует" : "Ссылка истекла или заменена — черновик сохранён"}</span>
            </button>)}
          </div>
          {active && hydratedId !== active.invite_id && <div className="rounded-2xl bg-white p-6 text-sm text-slate-600">
            {error || "Открываем черновик для записи…"}
            {error && <button type="button" onClick={() => { setError(""); setOpenAttempt((value) => value + 1); }} className="mt-3 block rounded-xl border px-3 py-2 text-sm">Попробовать открыть снова</button>}
          </div>}
          {active && hydratedId === active.invite_id && <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
            <h2 className="text-lg font-semibold">Незавершённая заявка</h2>
            <p className="mt-1 text-xs text-slate-500">Наполнение сохраняется в БД. Номер R и партии P появятся только после подтверждения.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-500">Компания-заявитель
                {accounts?.length ? <select value={applicantAccountId} onChange={(e) => setApplicantAccountId(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                  {accounts.map((account) => <option key={account.id} value={account.id}>C-{account.short_id} · {account.name}</option>)}
                </select> : <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />}</label>
              <label className="text-xs text-slate-500">Исполнитель
                <input value={executor ? `C-${executor.short_id} · ${executor.name}` : executorQuery} onChange={(e) => { setExecutor(null); setExecutorQuery(e.target.value); }} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                {!executor && executorResults.length > 0 && <div className="relative"><div className="absolute z-10 w-full rounded-xl border bg-white p-1 shadow-lg">{executorResults.map((row) => <button type="button" key={row.id} onClick={() => { setExecutor(row); setExecutorResults([]); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-blue-50">C-{row.short_id} · {row.name}</button>)}</div></div>}
              </label>
              <label className="text-xs text-slate-500">Имя заявителя<input value={active.full_name} readOnly className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-2 text-sm" /></label>
              <label className="text-xs text-slate-500">Подтверждённая почта<input value={active.email} readOnly className="mt-1 w-full rounded-xl border bg-slate-50 px-3 py-2 text-sm" /></label>
              <label className="text-xs text-slate-500">Название заявки<input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
              <label className="text-xs text-slate-500">Комментарий<input value={comment} onChange={(e) => setComment(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
            </div>
            <div className="mt-5 space-y-3">
              {stores.map((store, index) => <div key={index} className="rounded-2xl border border-slate-200 p-4">
                <button type="button" onClick={() => setActiveScannerStore(index)} className={`mb-3 rounded-lg px-3 py-1.5 text-xs ${activeScannerStore === index ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {activeScannerStore === index ? "Сканер подключён к этому магазину" : "Подключить сканер к этому магазину"}
                </button>
                {accounts?.length ? <select value={store.store_id ?? ""} onChange={(e) => {
                  const selected = existingStores.find((candidate) => candidate.id === e.target.value);
                  updateStore(index, selected ? { store_id: selected.id, name: selected.name, marketplace: selected.marketplace } : { store_id: "", name: "", marketplace: "wildberries" });
                }} className="mb-3 w-full rounded-xl border px-3 py-2 text-sm">
                  <option value="">+ Новый магазин</option>
                  {existingStores.map((candidate) => <option key={candidate.id} value={candidate.id}>A-{candidate.short_id ?? "—"} · {candidate.name}</option>)}
                </select> : null}
                <div className="flex gap-2"><input value={store.name} readOnly={Boolean(store.store_id)} onChange={(e) => updateStore(index,{name:e.target.value})} placeholder="Название магазина" className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm read-only:bg-slate-50" />
                  <select value={store.marketplace.toLowerCase()} disabled={Boolean(store.store_id)} onChange={(e) => updateStore(index,{marketplace:e.target.value})} className="rounded-xl border px-2 text-sm"><option value="wildberries">Wildberries</option><option value="ozon">Ozon</option></select>
                  <button type="button" disabled={stores.length === 1} onClick={() => setStores((current) => current.filter((_,i) => i !== index))} className="text-xs text-rose-500 disabled:opacity-40">Убрать</button></div>
                <select value={store.intake_mode} onChange={(e) => updateStore(index,{intake_mode:e.target.value as StoreForm["intake_mode"]})} className="mt-3 rounded-xl border px-3 py-2 text-sm"><option value="bulk">Навалом</option><option value="catalog">По каталогу</option><option value="barcodes">По баркодам</option><option value="boxes">Готовые короба</option></select>
                <RequestIntakeEditor itemsText={store.itemsText} onItemsTextChange={(value) => updateStore(index,{itemsText:value})}
                  catalogMode={store.intake_mode === "catalog"} accountId={applicantAccountId} storeId={store.store_id}
                  supplies={store.supplies ?? []} onSuppliesChange={(value) => updateStore(index,{supplies:value})}
                  boxesMode={store.intake_mode === "boxes"} serialScannerEnabled={activeScannerStore === index} />
              </div>)}
              <button type="button" onClick={() => setStores((current) => [...current,emptyStore()])} className="rounded-xl border px-3 py-2 text-sm">+ Добавить магазин</button>
            </div>
            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" disabled={busy} onClick={() => void saveMyRequestReserve(active.invite_id,{companyName,title,comment,stores,executor}).catch((e) => setError(e instanceof Error ? e.message : "Ошибка сохранения"))} className="rounded-xl border px-4 py-2 text-sm">Сохранить черновик</button>
              <button type="button" disabled={busy || !executor} onClick={() => void confirm()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Подтвердить заявку</button>
            </div>
          </div>}
        </div>}
    </div>
  </div>;
};

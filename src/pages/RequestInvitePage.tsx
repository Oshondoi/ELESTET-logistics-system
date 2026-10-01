import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Account,
  ExecutorAccountSearchResult,
  ServiceRequestItemDraft,
} from "../types";
import {
  accountHasActiveRequestInvite,
  getAdminInvitePreview,
  getPublicServiceRequestInvite,
  listRequestInviteBindableAccountIds,
  openMyRequestReserve,
  heartbeatMyRequestReserve,
  replaceServiceRequestInviteReserve,
  reserveServiceRequestInvite,
  saveServiceRequestInviteReserve,
  searchExecutorAccounts,
  submitServiceRequestInviteReserve,
  type AdminInvitePreview,
  type PublicRequestInvite,
  type ReservedInviteStore,
} from "../services/requestService";
import { normalizePassword, passwordsMatch, validatePassword } from "../lib/passwordUtils";
import { supabase } from "../lib/supabase";
import { RequestIntakeEditor } from "../components/fulfillment/RequestIntakeEditor";
import { PasswordRecoveryForm } from "../components/auth/PasswordRecoveryForm";

interface Props {
  token: string;
  isSignedIn: boolean;
  isAdminPreview: boolean;
  accounts: Account[];
  accountsLoading: boolean;
  onSignIn: (values: { email: string; password: string }) => Promise<unknown>;
  onSignUp: (values: {
    fullName: string;
    email: string;
    password: string;
  }) => Promise<unknown>;
  onContinue: (accountId?: string | null) => void;
  onMaterialized: (accountId: string) => void;
}

type StoreForm = Omit<ReservedInviteStore, "items" | "position"> & {
  itemsText: string;
};
const emptyStore = (): StoreForm => ({
  name: "",
  marketplace: "wildberries",
  delivery_mode: "self_delivery",
  intake_mode: "bulk",
  itemsText: "",
  supplies: [],
});
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

const AdminPreview = ({ data }: { data: AdminInvitePreview }) => (
  <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
    <div className="w-full max-w-3xl rounded-3xl bg-white p-7 shadow-xl">
      <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
        Просмотреть как админ · только чтение
      </div>
      <h1 className="mt-5 text-xl font-semibold">Клиентская ссылка</h1>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-4">
          <span className="text-slate-400">Исполнитель</span>
          <p className="mt-1 font-medium">
            C-{data.executor.short_id} · {data.executor.name}
          </p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <span className="text-slate-400">Заявитель</span>
          <p className="mt-1 font-medium">
            {data.applicant
              ? `C-${data.applicant.short_id} · ${data.applicant.name}`
              : data.reserve?.full_name || "Ещё не создан"}
          </p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <span className="text-slate-400">Состояние</span>
          <p className="mt-1 font-medium">{data.state}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <span className="text-slate-400">Почта резерва</span>
          <p className="mt-1 font-medium">{data.reserve?.email || "—"}</p>
        </div>
      </div>
      <h2 className="mt-6 font-semibold">Заявки</h2>
      <div className="mt-2 divide-y rounded-2xl border">
        {data.requests.length ? (
          data.requests.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between px-4 py-3 text-sm"
            >
              <span>
                R-{row.short_id} · {row.title || "Без названия"}
              </span>
              <span className="text-slate-400">{row.status}</span>
            </div>
          ))
        ) : (
          <div className="px-4 py-5 text-sm text-slate-400">
            Подтверждённых заявок ещё нет
          </div>
        )}
      </div>
    </div>
  </div>
);

export const RequestInvitePage = ({
  token,
  isSignedIn,
  isAdminPreview,
  accounts,
  accountsLoading,
  onSignIn,
  onContinue,
  onMaterialized,
}: Props) => {
  const [invite, setInvite] = useState<PublicRequestInvite | null>(null);
  const [preview, setPreview] = useState<AdminInvitePreview | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpStep, setOtpStep] = useState<"idle" | "code" | "password" | "conflict" | "done">("idle");
  const [otpPurpose, setOtpPurpose] = useState<"bind" | "replace">("bind");
  const [recoverPassword, setRecoverPassword] = useState(false);
  const [otpRetryAt, setOtpRetryAt] = useState(0);
  const [otpNow, setOtpNow] = useState(Date.now());
  const otpRemaining = Math.max(0, Math.ceil((otpRetryAt - otpNow) / 1000));
  useEffect(() => {
    if (!otpRetryAt) return;
    const timer = window.setInterval(() => setOtpNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [otpRetryAt]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [existingAccount, setExistingAccount] = useState(false);
  const [hasExistingLink, setHasExistingLink] = useState(false);
  const [companyName, setCompanyName] = useState("Основная компания");
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [executor, setExecutor] = useState<ExecutorAccountSearchResult | null>(
    null,
  );
  const [executorQuery, setExecutorQuery] = useState("");
  const [executorResults, setExecutorResults] = useState<
    ExecutorAccountSearchResult[]
  >([]);
  const [stores, setStores] = useState<StoreForm[]>([emptyStore()]);
  const [activeScannerStore, setActiveScannerStore] = useState(0);
  useEffect(() => {
    if (activeScannerStore >= stores.length) setActiveScannerStore(0);
  }, [activeScannerStore, stores.length]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflictToken, setConflictToken] = useState("");
  const [conflictCopied, setConflictCopied] = useState(false);
  const [bindableAccountIds, setBindableAccountIds] = useState<string[] | null>(
    null,
  );
  const [reserveLeaseReady, setReserveLeaseReady] = useState(false);
  const [reserveOpenAttempt, setReserveOpenAttempt] = useState(0);
  const lastActivityRef = useRef(Date.now());
  useEffect(() => { lastActivityRef.current = Date.now(); }, [stores]);

  useEffect(() => {
    setInvite(null);
    setPreview(null);
    setError("");
    if (isAdminPreview) {
      void getAdminInvitePreview(token)
        .then(setPreview)
        .catch((e) =>
          setError(e instanceof Error ? e.message : "Ссылка недоступна"),
        );
      return;
    }
    void getPublicServiceRequestInvite(token)
      .then((row) => {
        setInvite(row);
        setName(row.reserved_name ?? "");
        setEmail(row.reserved_email ?? "");
        setExistingAccount(Boolean(row.reserved_email));
        const defaultExecutor = {
          id: row.executor_account_id,
          short_id: row.executor_short_id,
          name: row.executor_name,
        };
        setExecutor(defaultExecutor);
        setExecutorQuery(
          `C-${defaultExecutor.short_id} · ${defaultExecutor.name}`,
        );
        const draft = row.reserve_draft;
        if (draft) {
          setCompanyName(
            typeof draft.companyName === "string"
              ? draft.companyName
              : "Основная компания",
          );
          setTitle(typeof draft.title === "string" ? draft.title : "");
          setComment(typeof draft.comment === "string" ? draft.comment : "");
          if (draft.executor && typeof draft.executor === "object") {
            const savedExecutor = draft.executor as ExecutorAccountSearchResult;
            setExecutor(savedExecutor);
            setExecutorQuery(
              `C-${savedExecutor.short_id} · ${savedExecutor.name}`,
            );
          }
          if (Array.isArray(draft.stores) && draft.stores.length)
            setStores(draft.stores as StoreForm[]);
        }
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Ссылка недоступна"),
      );
  }, [token, isAdminPreview]);
  const bindableAccounts = useMemo(
    () =>
      accounts.filter((account) => bindableAccountIds?.includes(account.id)),
    [accounts, bindableAccountIds],
  );
  useEffect(() => {
    if (!isSignedIn || invite?.applicant_account_id) return;
    void listRequestInviteBindableAccountIds()
      .then(setBindableAccountIds)
      .catch(() => setBindableAccountIds([]));
  }, [isSignedIn, invite?.applicant_account_id]);
  useEffect(() => {
    if (
      invite?.applicant_account_id &&
      accounts.some((account) => account.id === invite.applicant_account_id)
    )
      setSelectedAccountId(invite.applicant_account_id);
    else if (bindableAccounts.length === 1)
      setSelectedAccountId(bindableAccounts[0].id);
  }, [accounts, bindableAccounts, invite?.applicant_account_id]);
  useEffect(() => {
    if (!selectedAccountId || invite?.applicant_account_id) {
      setHasExistingLink(false);
      return;
    }
    void accountHasActiveRequestInvite(selectedAccountId)
      .then(setHasExistingLink)
      .catch(() => setHasExistingLink(false));
  }, [selectedAccountId, invite?.applicant_account_id]);
  useEffect(() => {
    if (executor || !executorQuery.trim() || !isSignedIn) {
      setExecutorResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchExecutorAccounts(executorQuery)
        .then(setExecutorResults)
        .catch(() => setExecutorResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [executor, executorQuery, isSignedIn]);
  useEffect(() => {
    setReserveLeaseReady(false);
    if (!isSignedIn || accounts.length || isAdminPreview || !invite?.reserved_email || !invite.invite_id) return;
    let cancelled = false;
    void openMyRequestReserve(invite.invite_id)
      .then((draft) => {
        if (cancelled) return;
        if (draft && typeof draft === "object" && Object.keys(draft).length) {
          setCompanyName(typeof draft.companyName === "string" ? draft.companyName : "Основная компания");
          setTitle(typeof draft.title === "string" ? draft.title : "");
          setComment(typeof draft.comment === "string" ? draft.comment : "");
          if (Array.isArray(draft.stores) && draft.stores.length) setStores(draft.stores as StoreForm[]);
          if (draft.executor && typeof draft.executor === "object") setExecutor(draft.executor as ExecutorAccountSearchResult);
        }
        setReserveLeaseReady(true);
        setError("");
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Черновик сейчас открыт на другом устройстве"); });
    return () => { cancelled = true; };
  }, [isSignedIn, accounts.length, isAdminPreview, invite?.reserved_email, invite?.invite_id, reserveOpenAttempt]);
  useEffect(() => {
    if (!reserveLeaseReady || !invite?.invite_id) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current > 120_000) return;
      void heartbeatMyRequestReserve(invite.invite_id).then((ok) => {
        if (!ok) { setReserveLeaseReady(false); setError("Право записи черновика истекло. Обновите страницу, чтобы продолжить."); }
      }).catch(() => setReserveLeaseReady(false));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [reserveLeaseReady, invite?.invite_id]);
  useEffect(() => {
    if (
      !isSignedIn ||
      accounts.length ||
      isAdminPreview ||
      !invite?.reserved_email ||
      !reserveLeaseReady
    )
      return;
    const timer = window.setTimeout(() => {
      void saveServiceRequestInviteReserve(token, {
        companyName,
        title,
        comment,
        stores,
        executor,
      }).catch((e) => setError(e instanceof Error ? e.message : "Не удалось сохранить черновик на сервере"));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    isSignedIn,
    accounts.length,
    isAdminPreview,
    invite?.reserved_email,
    reserveLeaseReady,
    token,
    companyName,
    title,
    comment,
    stores,
    executor,
  ]);

  const executorLabel = useMemo(
    () =>
      invite ? `C-${invite.executor_short_id} · ${invite.executor_name}` : "",
    [invite],
  );
  const requestPasswordReset = async () => {
    setRecoverPassword(true);
  };
  const copyConflictLink = async () => {
    if (!conflictToken) return;
    await navigator.clipboard.writeText(
      `${window.location.origin}/request-invite/${conflictToken}`,
    );
    setConflictCopied(true);
    window.setTimeout(() => setConflictCopied(false), 900);
  };
  const replaceConflictLink = async () => {
    setBusy(true);
    setError("");
    try {
      await replaceServiceRequestInviteReserve(token);
      window.location.assign(`/request-invite/${token}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось заменить ссылку");
      setBusy(false);
    }
  };
  const sendEmailCode = async (purpose: "bind" | "replace") => {
    if (!supabase || busy) return;
    if (Date.now() < otpRetryAt) { setError("Подождите минуту перед повторной отправкой кода."); return; }
    let targetEmail = email.trim();
    if (purpose === "replace" && !targetEmail) {
      const { data } = await supabase.auth.getUser();
      targetEmail = data.user?.email ?? "";
      setEmail(targetEmail);
    }
    if (!targetEmail) {
      setError("Укажите почту");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: targetEmail,
        options: { shouldCreateUser: purpose === "bind", ...(purpose === "bind" ? { data: { full_name: name.trim() } } : {}) },
      });
      if (otpError) throw otpError;
      setOtpRetryAt(Date.now() + 60_000);
      setOtpNow(Date.now());
      setEmail(targetEmail);
      setOtpCode("");
      setOtpPurpose(purpose);
      setOtpStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить код");
    } finally {
      setBusy(false);
    }
  };
  const verifyEmailCode = async () => {
    if (!supabase || !/^\d{6}$/.test(otpCode.trim())) {
      setError("Введите шестизначный код из письма");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(), token: otpCode.trim(), type: "email",
      });
      if (verifyError) throw verifyError;
      setOtpStep("password");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Код не подошёл");
    } finally {
      setBusy(false);
    }
  };
  const finishEmailCode = async () => {
    if (!supabase) return;
    const passwordError = validatePassword(password);
    if (passwordError) { setError(passwordError); return; }
    if (!passwordsMatch(password, passwordAgain)) { setError("Пароли не совпадают"); return; }
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: normalizePassword(password) });
      if (updateError) throw updateError;
      if (otpPurpose === "replace") {
        setOtpStep("done");
        continueToRequest();
      } else {
        const reservation = await reserveServiceRequestInvite(token, name.trim(), email.trim());
        if (!reservation.ok && reservation.code === "EMAIL_RESERVED") {
          setConflictToken(reservation.token ?? "");
          setOtpStep("conflict");
        } else {
          setInvite((current) => current ? { ...current, reserved_email: email.trim(), reserved_name: name.trim() } : current);
          setOtpStep("done");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завершить подтверждение");
    } finally {
      setBusy(false);
    }
  };
  const continueToRequest = () => {
    if (
      hasExistingLink &&
      !window.confirm(
        "У выбранной компании уже есть клиентская ссылка. Заменить её этой ссылкой? Старая ссылка перестанет работать, данные компании и история сохранятся.",
      )
    )
      return;
    localStorage.setItem("elestet-pending-request-invite", token);
    if (selectedAccountId)
      localStorage.setItem(
        "elestet-pending-request-account",
        selectedAccountId,
      );
    if (hasExistingLink)
      localStorage.setItem("elestet-pending-request-replace", "1");
    else localStorage.removeItem("elestet-pending-request-replace");
    onContinue(selectedAccountId || null);
  };

  if (isAdminPreview) {
    if (preview) return <AdminPreview data={preview} />;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        {error || "Загрузка режима просмотра…"}
      </div>
    );
  }
  if (!invite && !error)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">
        Проверка ссылки…
      </div>
    );
  if (!invite?.is_available)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
          <h1 className="text-lg font-semibold">
            {invite?.unavailable_reason || error || "Ссылка недействительна"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Ссылка удалена, заменена или срок её действия истёк.
          </p>
          <a
            href="/"
            className="mt-5 inline-flex rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white"
          >
            Вернуться в ELESTET
          </a>
        </div>
      </div>
    );

  if (recoverPassword)
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <PasswordRecoveryForm initialEmail={email} onBack={() => { setRecoverPassword(false); setPassword(""); setPasswordAgain(""); setError(""); }} />
      </div>
    </div>;

  if (otpStep === "code" || otpStep === "password" || otpStep === "conflict")
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">Ссылка от {executorLabel}</p>
          <h1 className="mt-2 text-xl font-semibold">
            {otpStep === "code" ? "Подтвердите почту" : otpStep === "password" ? "Создайте пароль" : "Подтвердите замену ссылки"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">{email}</p>
          {error && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
          {otpStep === "code" && <>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g,""))} placeholder="Шестизначный код" className="mt-5 w-full rounded-xl border px-3 py-2.5" />
            <button type="button" disabled={busy || otpCode.length !== 6} onClick={() => void verifyEmailCode()} className="mt-3 w-full rounded-2xl bg-blue-600 py-2.5 font-medium text-white disabled:opacity-50">Проверить код</button>
            <button type="button" disabled={busy || otpRemaining > 0} onClick={() => void sendEmailCode(otpPurpose)} className="mt-3 w-full text-sm text-blue-600 disabled:opacity-50">{otpRemaining > 0 ? `Отправить повторно через ${otpRemaining} с` : "Отправить код повторно"}</button>
            <button type="button" disabled={busy} onClick={() => { setOtpStep("idle"); setOtpCode(""); setError(""); }} className="mt-3 w-full text-sm text-slate-500">Изменить адрес / вернуться назад</button>
          </>}
          {otpStep === "password" && <>
            <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Новый пароль аккаунта" className="mt-5 w-full rounded-xl border px-3 py-2.5" />
            <input type="password" autoComplete="new-password" value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} placeholder="Повторите пароль" className="mt-3 w-full rounded-xl border px-3 py-2.5" />
            <button type="button" disabled={busy} onClick={() => void finishEmailCode()} className="mt-3 w-full rounded-2xl bg-blue-600 py-2.5 font-medium text-white disabled:opacity-50">Сохранить пароль и продолжить</button>
          </>}
          {otpStep === "conflict" && <>
            <p className="mt-4 text-sm text-slate-600">У этой почты уже есть действующая ссылка. Старые заявки сохранятся отдельно. Использовать текущую ссылку вместо прежней?</p>
            {conflictToken && <button type="button" onClick={() => void copyConflictLink()} className={`mt-3 w-full rounded-xl border px-3 py-2 text-sm ${conflictCopied ? "border-emerald-300 bg-emerald-50" : "border-slate-200"}`}>Скопировать прежнюю ссылку</button>}
            <button type="button" disabled={busy} onClick={() => void replaceConflictLink()} className="mt-3 w-full rounded-2xl bg-blue-600 py-2.5 font-medium text-white disabled:opacity-50">Использовать текущую ссылку</button>
          </>}
        </div>
      </div>
    );

  if (isSignedIn && accountsLoading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Проверка доступа…
      </div>
    );

  if (
    isSignedIn &&
    !invite.applicant_account_id &&
    accounts.length > 0 &&
    bindableAccountIds === null
  )
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Проверка прав компании…
      </div>
    );

  if (
    isSignedIn &&
    !invite.applicant_account_id &&
    accounts.length > 0 &&
    bindableAccounts.length === 0
  )
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
          <h1 className="text-lg font-semibold">
            Нет компании с правами для привязки ссылки
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Нужны одновременно права на создание заявок и управление партиями.
          </p>
          <a
            href="/"
            className="mt-5 inline-flex rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white"
          >
            Вернуться в ELESTET
          </a>
        </div>
      </div>
    );

  if (
    isSignedIn &&
    invite.applicant_account_id &&
    !accounts.some((account) => account.id === invite.applicant_account_id)
  )
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
          <h1 className="text-lg font-semibold">
            У вас нет доступа к данным текущей ссылки
          </h1>
          <a
            href="/"
            className="mt-5 inline-flex rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white"
          >
            Вернуться в ELESTET
          </a>
        </div>
      </div>
    );

  if (isSignedIn && accounts.length === 0) {
    const updateStore = (index: number, values: Partial<StoreForm>) =>
      setStores((current) =>
        current.map((row, i) => (i === index ? { ...row, ...values } : row)),
      );
    const confirm = async () => {
      if (!reserveLeaseReady) { setError("Черновик ещё не открыт для записи. Обновите страницу и повторите."); return; }
      setBusy(true);
      setError("");
      try {
        const result = await submitServiceRequestInviteReserve(token, {
          companyName,
          applicantName: name,
          applicantEmail: email,
          title,
          comment,
          executorAccountId: executor?.id || invite.executor_account_id,
          stores: stores.map((store, position) => ({
            ...store,
            position,
            items: linesToItems(store.itemsText),
          })),
        });
        onMaterialized(result.account_id);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Не удалось подтвердить заявку",
        );
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-8" onChangeCapture={() => { lastActivityRef.current = Date.now(); }} onKeyDown={() => { lastActivityRef.current = Date.now(); }}>
        <div className="mx-auto max-w-4xl rounded-3xl bg-white p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">
            Ссылка от {executorLabel}
          </p>
          <h1 className="mt-2 text-xl font-semibold">Новая заявка</h1>
          <p className="mt-1 text-sm text-slate-500">
            Компания, магазины, заявка и партии будут созданы одновременно после
            подтверждения.
          </p>
          {error && (
            <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </p>
          )}
          {!reserveLeaseReady && error && <button type="button" onClick={() => { setError(""); setReserveOpenAttempt((value) => value + 1); }} className="mt-3 rounded-xl border px-3 py-2 text-sm">Попробовать открыть черновик снова</button>}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Компания
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2.5"
              />
            </label>
            <label className="text-sm">
              Исполнитель: C-ID или название
              <input
                value={
                  executor
                    ? `C-${executor.short_id} · ${executor.name}`
                    : executorQuery
                }
                onChange={(event) => {
                  setExecutor(null);
                  setExecutorQuery(event.target.value);
                }}
                className="mt-1 w-full rounded-xl border px-3 py-2.5"
              />
              {!executor && executorResults.length > 0 && (
                <span className="relative block">
                  <span className="absolute z-10 mt-1 w-full rounded-xl border bg-white p-1 shadow-xl">
                    {executorResults.map((result) => (
                      <button
                        type="button"
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
                  </span>
                </span>
              )}
            </label>
            <label className="text-sm">
              Название заявки
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2.5"
              />
            </label>
          </div>
          {stores.map((store, index) => (
            <div key={index} className="mt-4 rounded-2xl border p-4">
              <button type="button" onClick={() => setActiveScannerStore(index)} className={`mb-3 rounded-lg px-3 py-1.5 text-xs ${activeScannerStore === index ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                {activeScannerStore === index ? "Сканер подключён к этому магазину" : "Подключить сканер к этому магазину"}
              </button>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Магазин {index + 1}</h2>
                {stores.length > 1 && (
                  <button
                    onClick={() =>
                      setStores((rows) => rows.filter((_, i) => i !== index))
                    }
                    className="text-sm text-rose-600"
                  >
                    Удалить
                  </button>
                )}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input
                  value={store.name}
                  onChange={(e) => updateStore(index, { name: e.target.value })}
                  placeholder="Название магазина"
                  className="rounded-xl border px-3 py-2.5"
                />
                <select
                  value={store.marketplace.toLowerCase()}
                  onChange={(e) =>
                    updateStore(index, { marketplace: e.target.value })
                  }
                  className="rounded-xl border px-3 py-2.5"
                >
                  <option value="wildberries">Wildberries</option>
                  <option value="ozon">Ozon</option>
                </select>
                <select
                  value={store.delivery_mode}
                  onChange={(e) =>
                    updateStore(index, {
                      delivery_mode: e.target
                        .value as StoreForm["delivery_mode"],
                    })
                  }
                  className="rounded-xl border px-3 py-2.5"
                >
                  <option value="self_delivery">
                    Самостоятельная доставка
                  </option>
                  <option value="pickup">Забор исполнителем</option>
                </select>
                <select
                  value={store.intake_mode}
                  onChange={(e) =>
                    updateStore(index, {
                      intake_mode: e.target.value as StoreForm["intake_mode"],
                    })
                  }
                  className="rounded-xl border px-3 py-2.5"
                >
                  <option value="bulk">Общая приёмка</option>
                  <option value="catalog">По каталогу</option>
                  <option value="barcodes">По штрихкодам</option>
                  <option value="boxes">По коробам</option>
                </select>
              </div>
              <RequestIntakeEditor itemsText={store.itemsText} onItemsTextChange={(value) => updateStore(index,{itemsText:value})}
                catalogMode={store.intake_mode === "catalog"}
                supplies={store.supplies ?? []} onSuppliesChange={(value) => updateStore(index,{supplies:value})}
                boxesMode={store.intake_mode === "boxes"} serialScannerEnabled={activeScannerStore === index} />
            </div>
          ))}
          <button
            onClick={() => setStores((rows) => [...rows, emptyStore()])}
            className="mt-3 rounded-xl border px-3 py-2 text-sm"
          >
            + Добавить магазин
          </button>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Комментарий"
            className="mt-4 w-full rounded-xl border px-3 py-2.5"
          />
          <button
            disabled={busy || !executor || !reserveLeaseReady}
            onClick={() => void confirm()}
            className="mt-5 w-full rounded-2xl bg-blue-600 py-3 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Создание…" : "Подтвердить заявку"}
          </button>
        </div>
      </div>
    );
  }

  if (isSignedIn)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">
            Ссылка от {executorLabel}
          </p>
          <h1 className="mt-2 text-xl font-semibold">
            Открыть клиентскую ссылку
          </h1>
          {!invite.applicant_account_id && bindableAccounts.length > 1 && (
            <div className="mt-5">
              <label className="mb-2 block text-sm font-medium">
                От имени какой компании открыть ссылку?
              </label>
              <p className="mb-3 text-xs text-slate-500">
                Эта компания станет заявителем и будет привязана к ссылке.
              </p>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5"
              >
                <option value="">Выберите компанию</option>
                {bindableAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    C-{a.short_id} · {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {hasExistingLink && (
            <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              У компании уже есть ссылка. При продолжении система попросит
              подтвердить её замену; вся история останется у компании.
            </p>
          )}
          <button
            disabled={
              !invite.applicant_account_id &&
              bindableAccounts.length > 1 &&
              !selectedAccountId
            }
            onClick={() => hasExistingLink ? void sendEmailCode("replace") : continueToRequest()}
            className="mt-5 w-full rounded-2xl bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Перейти к заявке
          </button>
        </div>
      </div>
    );

  const submit = async () => {
    if (busy) return;
    if (!email.trim() || (!existingAccount && !name.trim())) {
      setError("Укажите имя и почту");
      return;
    }
    if (!existingAccount) {
      await sendEmailCode("bind");
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (!existingAccount && password !== passwordAgain) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    setError("");
    try {
      localStorage.setItem("elestet-pending-request-invite", token);
      localStorage.setItem(
        "elestet-pending-request-profile",
        JSON.stringify({ name: name.trim(), email: email.trim() }),
      );
      await onSignIn({ email: email.trim(), password });
      const reservation = await reserveServiceRequestInvite(
        token,
        name.trim(),
        email.trim(),
      );
      if (!reservation.ok && reservation.code === "EMAIL_RESERVED") {
        if (!reservation.token)
          throw new Error(
            "Эта почта уже занята другим резервом. Войдите с его паролем или восстановите доступ.",
          );
        setConflictToken(reservation.token);
        return;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не удалось продолжить";
      if (!existingAccount && /уже существует/i.test(message))
        setExistingAccount(true);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">
          Ссылка от {executorLabel}
        </p>
        <h1 className="mt-2 text-xl font-semibold">
          {existingAccount ? "Вход в ELESTET" : "Данные заявителя"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {existingAccount ? "Введите пароль своей учётной записи." : "Подтвердите почту шестизначным кодом. Работа по клиентской ссылке бесплатна."}
        </p>
        <div className="mt-3 h-14" aria-live="polite" aria-atomic="true">
          {error && (
            <p className="max-h-full overflow-y-auto break-words rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </p>
          )}
        </div>
        {conflictToken && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">
              Для этой почты уже существует незавершённая ссылка
            </p>
            <button
              type="button"
              onClick={() => void copyConflictLink()}
              className={`mt-2 block w-full cursor-pointer break-all rounded-xl border px-3 py-2 text-left font-mono text-xs transition ${conflictCopied ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-white text-amber-800"}`}
            >
              {window.location.origin}/request-invite/{conflictToken}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void replaceConflictLink()}
              className="mt-2 w-full rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Заменить ссылку на текущую
            </button>
          </div>
        )}
        <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {!existingAccount && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Имя"
              autoComplete="name"
              className="w-full rounded-xl border px-3 py-2.5"
            />
          )}
          <input
            type="email"
            value={email}
            readOnly={Boolean(invite.reserved_email)}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Почта"
            autoComplete="email"
            className="w-full rounded-xl border px-3 py-2.5 read-only:bg-slate-50"
          />
          {existingAccount && name && (
            <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
              {name}
            </div>
          )}
          {existingAccount && <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              existingAccount ? "Введите пароль" : "Придумайте пароль"
            }
            autoComplete={existingAccount ? "current-password" : "new-password"}
            className="w-full rounded-xl border px-3 py-2.5"
          />}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy
              ? "Проверка…"
              : existingAccount
                ? "Войти и открыть заявку"
                : "Получить код на почту"}
          </button>
          {existingAccount && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void requestPasswordReset()}
              className="block w-full text-center text-sm text-blue-600 disabled:opacity-50"
            >
              Забыли пароль?
            </button>
          )}
        </form>
      </div>
    </div>
  );
};

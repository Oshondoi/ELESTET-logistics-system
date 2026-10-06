import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { InviteDeleteDialog } from "./InviteDeleteDialog";
import { inviteStateLabel, inviteDate, inviteTerm } from "../../lib/invitePresentation";

interface LinkRow {
  id: string;
  token: string;
  state: string;
  created_at: string;
  expires_at: string;
  creator_email: string | null;
  executor_name: string;
  applicant_short_id: number | null;
  applicant_name: string | null;
  reserved_email: string | null;
  reserved_name: string | null;
  email_confirmed: boolean | null;
  request_count: number;
  batch_count: number;
  ended_at: string | null;
  end_reason: string | null;
  auth_created_at: string | null;
  company_created_at: string | null;
  is_available: boolean;
}

export const RequestLinksAdminTab = () => {
  const [rows, setRows] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return;
    setError("");
    const { data, error: rpcError } = await (supabase as any).rpc(
      "admin_list_service_request_invites_v2",
    );
    if (rpcError) setError(rpcError.message);
    else setRows((data ?? []) as LinkRow[]);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 60000);
    const wake = () => void load();
    window.addEventListener('focus', wake);
    return () => { clearInterval(timer); window.removeEventListener('focus', wake); };
  }, [load]);

  const act = async (fn: string, row: LinkRow, question: string) => {
    if (!supabase || !window.confirm(question)) return;
    const { error: rpcError } = await (supabase as any).rpc(fn, {
      p_invite_id: row.id,
    });
    if (rpcError) setError(rpcError.message);
    else await load();
  };
  const copy = async (row: LinkRow) => {
    if (!row.is_available) return;
    try { await navigator.clipboard.writeText(
      `${window.location.origin}/request-invite/${row.token}`,
    );
    setCopied(row.id);
    window.setTimeout(() => setCopied(null), 900);
    } catch { setError('Не удалось скопировать ссылку'); }
  };

  if (loading)
    return (
      <div className="rounded-3xl bg-white p-12 text-center text-sm text-slate-400">
        Загрузка ссылок…
      </div>
    );
  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-600">
          {error}
        </div>
      )}
      <div className="overflow-x-auto rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
        <table className="min-w-[1380px] w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-400">
            <tr>
              <th className="px-3 py-3">Ссылка</th>
              <th className="px-3 py-3">Статус</th>
              <th className="px-3 py-3">Создатель / исполнитель</th>
              <th className="px-3 py-3">Компания заявителя</th>
              <th className="px-3 py-3">Резерв</th>
              <th className="px-3 py-3">Почта</th>
              <th className="px-3 py-3">R / P</th>
              <th className="px-3 py-3">Срок</th>
              <th className="px-3 py-3">Прекращение · Бишкек</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-3">
                  <button
                    disabled={!row.is_available}
                    onClick={() => void copy(row)}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 ${copied === row.id ? "bg-emerald-50 text-emerald-700" : "text-blue-600 hover:bg-blue-50"}`}
                  >
                    {row.is_available ? 'Копировать ссылку' : 'Ссылка недоступна'} <span aria-hidden>⧉</span>
                  </button>
                </td>
                <td className="px-3 py-3">
                  {inviteStateLabel[row.state] ?? row.state}
                  <div className="text-xs text-slate-400">
                    {row.applicant_name
                      ? "Компания создана"
                      : row.reserved_email
                        ? "Резерв"
                        : "Без резерва"}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {row.executor_name}
                  <div className="text-xs text-slate-400">
                    {row.creator_email || "—"}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {row.applicant_name
                    ? `C-${row.applicant_short_id} · ${row.applicant_name}`
                      : "—"}
                  <div className="text-xs text-slate-400">Создана: {inviteDate(row.company_created_at)}</div>
                </td>
                <td className="px-3 py-3">
                  {row.reserved_name || "—"}
                  {row.reserved_email && (
                    <div className="text-xs text-slate-400">
                      {row.reserved_email}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3">
                  {row.email_confirmed == null
                    ? "—"
                    : row.email_confirmed
                      ? "Подтверждена"
                      : "Не подтверждена"}
                  <div className="text-xs text-slate-400">Аккаунт: {inviteDate(row.auth_created_at)}</div>
                </td>
                <td className="px-3 py-3">
                  {row.request_count} / {row.batch_count}
                </td>
                <td className="px-3 py-3">
                  {inviteTerm(row.state, row.expires_at)}
                  <div className="text-xs text-slate-400">Бишкек</div>
                </td>
                <td className="px-3 py-3">{row.end_reason || '—'}<div className="text-xs text-slate-400">{inviteDate(row.ended_at)}</div></td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-1">
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={`/request-invite/${row.token}?admin-preview=1`}
                      className="rounded-xl border px-2.5 py-1.5 text-xs"
                    >
                        Просмотреть как админ
                    </a>
                    {!["deleted", "replaced"].includes(row.state) && (
                      <>
                        <button
                          onClick={() =>
                            void act(
                              "admin_detach_service_request_invite",
                              row,
                              `Отвязать и удалить ссылку${row.applicant_name ? ` компании C-${row.applicant_short_id} · ${row.applicant_name}` : ""}? Данные останутся.`,
                            )
                          }
                          className="rounded-xl border px-2.5 py-1.5 text-xs"
                        >
                          Отвязать ссылку
                        </button>
                        <button
                          onClick={() =>
                            setDeleting(row.id)
                          }
                          className="rounded-xl bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700"
                        >
                          Удалить данные ссылки
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deleting && <InviteDeleteDialog key={deleting} inviteId={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); void load(); }} />}
    </div>
  );
};

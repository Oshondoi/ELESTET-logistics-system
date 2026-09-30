import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type Version = {
  id: string; version: number; confirmed_at: string;
  snapshot: {
    items: Array<{ id: string; barcode: string; name: string; declared: number; received: number; defect: number; excluded: boolean }>;
    logs: Array<{ id: string; performer_name?: string; qty?: number; qty_defect?: number }>;
    supplies: Array<{ id: string; warehouse_name: string; boxes: Array<{ id: string; items: Array<{ barcode: string; qty: number }> }> }>;
  };
};

export function ConfirmedStepHistory({ batchId, stageId, step }: { batchId: string; stageId?: string; step: string }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setVersions([]);
    void (async () => {
      if (!supabase) throw new Error("Нет соединения с базой");
      let query = (supabase as any).from("fulfillment_step_versions").select("id,version,confirmed_at,snapshot")
        .eq("batch_id", batchId).eq("step", step).order("version", { ascending: false });
      query = stageId ? query.eq("pipeline_stage_id", stageId) : query.is("pipeline_stage_id", null);
      const { data, error } = await query;
      if (error) throw error;
      if (active) setVersions(data ?? []);
    })().catch((e) => { if (active) setError(e.message ?? "Не удалось загрузить журнал"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [batchId, stageId, step]);
  return <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
    <p className="text-xs text-slate-500">Здесь сохраняются результаты подтверждений. Промежуточный ввод в журнал не попадает.</p>
    {loading ? <p>Загрузка…</p> : error ? <p className="text-rose-600">{error}</p> : !versions.length ? <p className="text-sm text-slate-400">Подтверждённых версий пока нет.</p> : versions.map((entry) => <details key={entry.id} open={entry === versions[0]} className="rounded-2xl border border-slate-200 p-4">
      <summary className="cursor-pointer text-sm font-medium">Версия {entry.version} · Подтверждённый результат · {new Date(entry.confirmed_at).toLocaleString("ru-RU")}</summary>
      <div className="mt-3 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Товар</th><th>Заявлено</th><th>Принято</th><th>Брак</th></tr></thead><tbody>
        {entry.snapshot.items.map((item) => <tr key={item.id} className={item.excluded ? "text-slate-400 line-through" : "border-t"}><td className="p-2">{item.name || item.barcode}<span className="ml-2 text-slate-400">{item.barcode}</span></td><td>{item.declared}</td><td>{item.received}</td><td>{item.defect}</td></tr>)}
      </tbody></table></div>
      {entry.snapshot.logs.map((log) => <p key={log.id} className="mt-2 text-xs">{log.performer_name || "Исполнитель"}: {log.qty ?? 0} шт., брак {log.qty_defect ?? 0}</p>)}
      {entry.snapshot.supplies.map((supply) => <div key={supply.id} className="mt-3 rounded-xl bg-slate-50 p-3 text-xs"><b>{supply.warehouse_name}</b>{supply.boxes.map((box, index) => <p key={box.id} className="mt-1">Короб {index + 1}: {box.items.map((item) => `${item.barcode} — ${item.qty} шт.`).join(", ")}</p>)}</div>)}
    </details>)}
  </div>;
}

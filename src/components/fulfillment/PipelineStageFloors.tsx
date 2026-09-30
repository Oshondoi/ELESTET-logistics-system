import type { BatchPipelineStage, FulfillmentStage } from "../../types";

const stageOrder: Array<{ key: FulfillmentStage; label: string; flag?: keyof BatchPipelineStage }> = [
  { key: "reception", label: "Приём" },
  { key: "otk", label: "ОТК", flag: "stage_otk" },
  { key: "packaging", label: "Упак.", flag: "stage_packaging" },
  { key: "marking", label: "Марк.", flag: "stage_marking" },
  { key: "packing", label: "Короба", flag: "stage_packing" },
  { key: "logistics", label: "Лог.", flag: "stage_logistics" },
];

export const PipelineStageFloors = ({ stages }: { stages: BatchPipelineStage[] }) => (
  <div className="space-y-2">
    {[...stages].sort((a, b) => a.order_index - b.order_index).map((stage) => {
      const enabled = stageOrder.filter((step) => !step.flag || stage[step.flag]);
      const currentIndex = enabled.findIndex((step) => step.key === stage.current_stage);
      return <div key={stage.id} className="flex items-center gap-3">
        <div className="w-24 shrink-0 truncate text-[10px] leading-tight text-slate-600" title={`${stage.name} · C-${stage.stage_company_short_id ?? "—"}`}>
          <span className="block font-semibold">{stage.name}</span>
          <span className="text-slate-400">C-{stage.stage_company_short_id ?? "—"}</span>
        </div>
        <div className="flex min-w-0 items-start gap-1 overflow-x-auto">
          {enabled.map((step, index) => {
            const completed = stage.status === "done" || (stage.status === "active" && (stage.current_stage === "done" || index < currentIndex));
            const current = stage.status === "active" && index === currentIndex;
            return <div key={step.key} className="flex w-12 shrink-0 flex-col items-center text-center">
              <span className={`h-3 w-3 rounded-full ${completed ? "bg-emerald-500" : current ? "bg-blue-600 ring-2 ring-blue-100" : "bg-slate-200"}`} />
              <span className={`mt-1 text-[9px] leading-tight ${completed ? "text-emerald-600" : current ? "font-semibold text-blue-600" : "text-slate-400"}`}>{step.label}</span>
            </div>;
          })}
        </div>
      </div>;
    })}
  </div>
);

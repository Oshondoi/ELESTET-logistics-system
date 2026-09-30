import { useEffect, useRef, useState } from "react";
import type { RequestSupplyDraft } from "../../types";
import { FulfillmentElestetScanner } from "./FulfillmentElestetScanner";

type Props = {
  itemsText: string;
  onItemsTextChange: (value: string) => void;
  supplies: RequestSupplyDraft[];
  onSuppliesChange: (value: RequestSupplyDraft[]) => void;
  boxesMode: boolean;
  serialScannerEnabled?: boolean;
};

const parsedItem = (line: string) => {
  const [barcode = "", name = "", quantity = "0", article = ""] = line.split(";").map((value) => value.trim());
  return { barcode, name, qty: Number.parseInt(quantity, 10) || 0, article };
};

export function RequestIntakeEditor({ itemsText, onItemsTextChange, supplies, onSuppliesChange, boxesMode, serialScannerEnabled = true }: Props) {
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [activeBoxKey, setActiveBoxKey] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastScanRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const cameraScannedRef = useRef(false);
  const scanHandlerRef = useRef<(value: string) => void>(() => undefined);

  const changeSupply = (supplyKey: string, change: Partial<RequestSupplyDraft>) =>
    onSuppliesChange(supplies.map((supply) => supply.key === supplyKey ? { ...supply, ...change } : supply));
  const addSupply = () => {
    const key = crypto.randomUUID();
    const boxKey = crypto.randomUUID();
    onSuppliesChange([...supplies, { key, warehouse_name: "", boxes: [{ key: boxKey, items: [] }] }]);
    setActiveBoxKey(boxKey);
  };
  const addBox = (supply: RequestSupplyDraft) => {
    const key = crypto.randomUUID();
    changeSupply(supply.key, { boxes: [...supply.boxes, { key, items: [] }] });
    setActiveBoxKey(key);
  };
  const scan = (raw: string) => {
    const barcode = raw.trim().replace(/[\r\n\t]+$/g, "");
    if (!barcode) return;
    if (/^01\d{14}21/.test(barcode)) {
      setScanError("Это КИЗ, а не штрихкод товара. Сначала укажите товарный штрихкод.");
      return;
    }
    const currentSupply = boxesMode
      ? supplies.find((supply) => supply.boxes.some((box) => box.key === activeBoxKey))
      : null;
    if (boxesMode && !currentSupply) {
      setScanError("Сначала добавьте поставку и выберите короб.");
      return;
    }
    if (lastScanRef.current.value === barcode && Date.now() - lastScanRef.current.at < 120) return;
    lastScanRef.current = { value: barcode, at: Date.now() };
    setScanError("");
    const lines = itemsText.split("\n").filter((line) => line.trim());
    const index = lines.findIndex((line) => parsedItem(line).barcode === barcode);
    if (index < 0) lines.push(`${barcode}; ; 1;`);
    else {
      const item = parsedItem(lines[index]);
      lines[index] = [item.barcode, item.name, item.qty + 1, item.article].join("; ");
    }
    onItemsTextChange(lines.join("\n"));
    if (boxesMode && currentSupply) {
      changeSupply(currentSupply.key, { boxes: currentSupply.boxes.map((box) => {
        if (box.key !== activeBoxKey) return box;
        const previous = box.items.find((item) => item.barcode === barcode);
        return { ...box, items: previous
          ? box.items.map((item) => item.barcode === barcode ? { ...item, qty: item.qty + 1 } : item)
          : [...box.items, { barcode, qty: 1 }] };
      }) });
    }
    setScanValue("");
  };
  scanHandlerRef.current = scan;

  useEffect(() => {
    if (!cameraOpen || !videoRef.current) return;
    let cancelled = false;
    let controls: { stop: () => void } | null = null;
    void import("@zxing/browser").then(async ({ BrowserMultiFormatReader }) => {
      if (cancelled || !videoRef.current) return;
      const reader = new BrowserMultiFormatReader();
      controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (result && !cameraScannedRef.current) {
          cameraScannedRef.current = true;
          scanHandlerRef.current(result.getText());
          setCameraOpen(false);
        }
      });
      if (cancelled) controls.stop();
    }).catch((error: unknown) => {
      setScanError(error instanceof Error ? error.message : "Камера недоступна");
      setCameraOpen(false);
    });
    return () => { cancelled = true; controls?.stop(); };
  }, [cameraOpen]);

  return <div className="mt-3 space-y-3">
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 p-3">
      <input value={scanValue} onChange={(event) => setScanValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); scan(scanValue); } }}
        placeholder="Сканер / ТСД: штрихкод + Enter" className="min-w-0 flex-1 rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm" />
      <button type="button" onClick={() => scan(scanValue)} className="rounded-xl bg-blue-600 px-3 py-2 text-sm text-white">Принять</button>
      <button type="button" onClick={() => { cameraScannedRef.current = false; setCameraOpen(true); }} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-blue-700">Камера</button>
    </div>
    {serialScannerEnabled && <FulfillmentElestetScanner testMode="barcode" onScan={scan} />}
    {scanError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{scanError}</p>}
    <textarea value={itemsText} onChange={(event) => onItemsTextChange(event.target.value)} rows={5}
      placeholder="Штрихкод; название; количество; артикул — товар в каждой строке"
      className="w-full rounded-xl border px-3 py-2 font-mono text-xs" />
    {boxesMode && <div className="space-y-3 rounded-xl border border-orange-200 bg-orange-50/50 p-3">
      <p className="text-xs text-orange-900">Поставки и короба. Каждый короб должен содержать товары; суммарное количество по коробам должно совпасть с товарами выше.</p>
      {supplies.map((supply) => <div key={supply.key} className="rounded-xl border bg-white p-3">
        <div className="flex gap-2">
          <input value={supply.warehouse_name} onChange={(event) => changeSupply(supply.key, { warehouse_name: event.target.value })}
            placeholder="Склад / название поставки" className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm" />
          <button type="button" onClick={() => onSuppliesChange(supplies.filter((row) => row.key !== supply.key))} className="text-xs text-rose-600">Удалить</button>
        </div>
        <div className="mt-3 space-y-3">{supply.boxes.map((box, boxIndex) => <div key={box.key} className={`rounded-xl border p-3 ${activeBoxKey === box.key ? "border-blue-400" : "border-slate-200"}`}>
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => setActiveBoxKey(box.key)} className="text-sm font-medium">Короб №{boxIndex + 1} {activeBoxKey === box.key ? "· сканирование сюда" : ""}</button>
            <button type="button" onClick={() => changeSupply(supply.key, { boxes: supply.boxes.filter((row) => row.key !== box.key) })} className="text-xs text-rose-600">Удалить короб</button>
          </div>
          {box.items.map((item) => <div key={item.barcode} className="mt-2 flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate font-mono">{item.barcode}</span>
            <input type="number" min={1} value={item.qty} onChange={(event) => changeSupply(supply.key, { boxes: supply.boxes.map((row) => row.key === box.key ? { ...row, items: row.items.map((entry) => entry.barcode === item.barcode ? { ...entry, qty: Number(event.target.value) } : entry) } : row) })} className="w-20 rounded-lg border px-2 py-1" />
            <button type="button" onClick={() => changeSupply(supply.key, { boxes: supply.boxes.map((row) => row.key === box.key ? { ...row, items: row.items.filter((entry) => entry.barcode !== item.barcode) } : row) })} className="text-rose-600">×</button>
          </div>)}
          {!box.items.length && <p className="mt-2 text-xs text-rose-500">Короб пустой</p>}
        </div>)}
          <button type="button" onClick={() => addBox(supply)} className="rounded-lg border px-3 py-1.5 text-xs">+ Короб</button>
        </div>
      </div>)}
      <button type="button" onClick={addSupply} className="rounded-xl border border-orange-300 bg-white px-3 py-2 text-sm">+ Поставка</button>
    </div>}
    {cameraOpen && <div className="fixed inset-0 z-[130] flex flex-col bg-black p-4 text-white">
      <div className="flex justify-between"><span>Сканирование штрихкода</span><button type="button" onClick={() => setCameraOpen(false)}>Закрыть</button></div>
      <video ref={videoRef} playsInline muted className="mt-4 min-h-0 flex-1 object-contain" />
    </div>}
  </div>;
}

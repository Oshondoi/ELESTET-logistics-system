# WB Excel Export — Шаблоны для поставки FBW (09.05.2026)

## Зачем это нужно

WB FBW (Фулфилмент от ВБ) требует, чтобы перед приёмкой поставки продавец загрузил два Excel-файла в ЛК → Поставки → Упаковка:
1. **Шаблон товаров** — список всех баркодов и количеств (WB добавляет их в поставку)
2. **Шаблон коробов** — распределение: какой баркод в каком коробе, сколько штук

Раньше менеджер делал это вручную по таблицам в Excel. Теперь ELESTET генерирует оба файла одной кнопкой на основе данных фулфилмента.

---

## Ограничение WB API (ВАЖНО)

**WB Supplies API (`supplies-api.wildberries.ru`) — только чтение (GET).** Записать данные в WB через API **невозможно**.

Проверено: все write-методы (`POST /packages`, `PUT /packages/{code}/barcodes` и т.д.) либо не существуют, либо требуют внутреннего токена, недоступного продавцам.

**Единственный способ автоматизации — сгенерировать Excel и загрузить его в ЛК вручную** (кнопка «Загрузить файл» в интерфейсе поставки).

---

## Как работают ШК коробов (packageCode)

Когда продавец создаёт поставку FBW в ЛК WB → кнопка «Начать упаковку» → WB автоматически присваивает каждому коробу код вида `WB_1586327524`, `WB_1586327525` и т.д.

Эти коды:
- Получаются через `GET /api/v1/supplies/{supplyId}/package` → массив `{ packageCode, quantity, barcodes }`
- **Уже скачиваются нашим приложением** при нажатии синей кнопки QR-стикеров — edge function `wb-supply` генерирует PDF со стикерами для каждого короба
- Теперь **дополнительно сохраняются** в `trip_lines.wb_package_codes: string[]` в БД и в локальный state

---

## Архитектура фичи

### БД
```sql
-- Колонка добавлена патчем patch_wb_package_codes.sql
alter table public.trip_lines
  add column if not exists wb_package_codes text[] not null default '{}';
```
Применена в продакшн через Management API 09.05.2026.

### Edge Function `wb-supply/index.ts` (обновлена)
При синке QR-стикеров (стандартный сценарий) edge function теперь:
1. Получает список коробов от WB: `GET /api/v1/supplies/{supplyId}/package`
2. Генерирует PDF QR-стикеров (как раньше)
3. **Сохраняет ШК коробов в БД**: `UPDATE trip_lines SET wb_package_codes = [WB_xxx, WB_yyy] WHERE id = line_id`
4. Возвращает `package_codes` в ответе наряду со `sticker_urls` и `cargo_type`

```typescript
// Пример ответа edge function:
{
  wb_supply_id: "39201279",
  sticker_urls: ["https://..."],
  cargo_type: 1,
  package_codes: ["WB_1586327524", "WB_1586327525", "WB_1586327526", "WB_1586327527"]
}
```

### `src/types/index.ts`
```typescript
interface TripLine {
  // ... существующие поля ...
  wb_package_codes: string[]   // ← новое поле
  // ...
}
```

### `src/lib/wbExcelExport.ts` (новый файл)
Библиотека для генерации Excel через SheetJS (`xlsx`):

```typescript
// Шаблон 1: товары для поставки WB
downloadGoodsTemplate(supply: FulfillmentSupplyWithBoxes, filename?)
// Колонки: Баркод | Количество
// Логика: агрегирует все box_items, дедуплицирует по баркоду, суммирует кол-во

// Шаблон 2: распределение по коробам
downloadBoxesTemplate(supply, wbBoxCodes: string[], filename?)
// Колонки: Баркод товара | Кол-во товаров | ШК короба | Срок годности
// Логика: сортирует wbBoxCodes по числовому суффиксу (WB_1586327524 → 1586327524)
//         сопоставляет с нашими коробами по box_number (коробо #1 → WB_min, #2 → WB_next...)
```

⚠️ **Важно**: заголовок колонки кол-ва — `Кол-во товаров` (с «в»), не `Кол-во товара`. WB чувствителен к точному совпадению заголовков.

### `src/services/fulfillmentService.ts`
```typescript
// Получить фулфилмент-поставку со всеми коробами и товарами по trip_line_id
fetchSupplyByTripLineId(tripLineId: string): Promise<FulfillmentSupplyWithBoxes | null>
```

### `src/hooks/useAppData.ts`
```typescript
// Главная функция — скачать Excel шаблон(ы)
const downloadWbExcel = async (
  tripId: string,
  lineId: string,
  type: 'goods' | 'boxes' | 'all'
) => {
  // 1. Достаёт данные фулфилмента из БД
  const supply = await fetchSupplyByTripLineId(lineId)
  // 2. Для "goods" — генерирует и скачивает товарный шаблон
  // 3. Для "boxes" — берёт ШК коробов из локального state (line.wb_package_codes)
  //    НИКАКОГО запроса к WB API! Коды уже есть после синка QR-стикеров.
  //    Если коды отсутствуют — ошибка "Нажмите синюю кнопку QR-стикеров"
}

// fetchWbBarcodes (синяя кнопка QR) теперь сохраняет wb_package_codes в state
setTrips(current => current.map(t => t.id === tripId ? {
  ...t,
  lines: t.lines.map(l => l.id === lineId ? {
    ...l,
    wb_supply_id: result.wb_supply_id,
    wb_cargo_type: result.cargo_type,
    wb_package_codes: result.package_codes ?? []   // ← новое
  } : l)
} : t))
```

### UI: `TripLineStickerCell.tsx`
В ячейке «Стикеры» добавлена зелёная кнопка с иконкой документа (Excel).

При клике — выпадающее меню (portal, правильно позиционированное):
- **«Скачать товары»** — всегда доступна (не нужен wb_supply_id)
- **«Скачать короба»** — доступна только если задан `wbSupplyId` (с тултипом если нет)
- **«Скачать всё»** — доступна только если задан `wbSupplyId`

---

## Полный сценарий работы

```
1. Менеджер создаёт рейс и поставку в ELESTET
   (заполняет коробки и товары в модуле Фулфилмент)

2. Менеджер открывает ЛК WB → Поставки → создаёт FBW поставку
   WB выдаёт ID поставки, напр. 39201279

3. Менеджер вводит ID поставки в ELESTET (поле «WB Supply ID» в поставке)

4. Менеджер нажимает синюю кнопку QR-стикеров в ELESTET:
   → Edge function wb-supply вызывает WB API
   → WB возвращает список коробов: [{packageCode: "WB_1586327524", ...}, ...]
   → Генерируется PDF со стикерами (QR-код каждого короба)
   → ШК коробов сохраняются в trip_lines.wb_package_codes
   → Менеджер распечатывает QR-стикеры и клеит на коробы

5. Менеджер нажимает зелёную кнопку Excel в ELESTET:
   а) «Скачать товары» → Excel файл:
      | Баркод        | Количество |
      | 2049059846830 | 25         |
      | 2049059846847 | 25         |

   б) «Скачать короба» → Excel файл:
      | Баркод товара | Кол-во товаров | ШК короба    | Срок годности |
      | 2049059846830 | 25             | WB_1586327524|               |
      | 2049059846847 | 25             | WB_1586327525|               |

6. Менеджер идёт в ЛК WB → Поставки → Упаковка:
   а) Загружает «товары» через «Загрузить файл» → WB добавляет товары в поставку
   б) Загружает «короба» → WB привязывает товары к коробам

7. Всё. Поставка готова к сдаче.
```

---

## Важные детали реализации

### Соответствие коробов
Наши коробы (box_number = 1, 2, 3...) сопоставляются с WB-кодами по сортировке:
- WB-коды сортируются по числовому суффиксу по возрастанию: `WB_1586327524` < `WB_1586327525`
- Наши коробы сортируются по `box_number` по возрастанию
- `box_number=1` → `WB_1586327524`, `box_number=2` → `WB_1586327525` и т.д.

### Установленные пакеты
```bash
npm install xlsx   # SheetJS — генерация Excel файлов
```

### Задействованные файлы
| Файл | Изменение |
|---|---|
| `src/lib/wbExcelExport.ts` | Новый файл — генерация шаблонов |
| `src/types/index.ts` | `wb_package_codes: string[]` в TripLine |
| `src/services/tripService.ts` | `getWbSupplyPackageCodes()` (не используется в основном флоу, оставлен как запасной) |
| `src/services/fulfillmentService.ts` | `fetchSupplyByTripLineId()` |
| `src/hooks/useAppData.ts` | `downloadWbExcel()` + обновление state в `fetchWbBarcodes` |
| `src/components/ui/TripLineStickerCell.tsx` | Зелёная кнопка Excel + дропдаун |
| `src/components/trips/TripTable.tsx` | Проброс `onDownloadWbExcel` prop |
| `src/pages/ShipmentsPage.tsx` | Проброс `onDownloadWbExcel` prop |
| `src/App.tsx` | Подключение `onDownloadWbExcel={downloadWbExcel}` |
| `supabase/functions/wb-supply/index.ts` | Сохранение wb_package_codes в БД при синке |
| `supabase/patch_wb_package_codes.sql` | Миграция колонки |

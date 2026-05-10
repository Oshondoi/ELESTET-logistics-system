# Shipments Component Area

## Purpose
Handles the main business workflow: viewing and creating shipments.

## Main Files
- `src/pages/ShipmentsPage.tsx`
- `src/components/trips/TripTable.tsx`
- `src/services/shipmentService.ts`

## Свернуть / Развернуть список (кнопка в тулбаре)

Иконка: двойные шевроны ↑ (свернуть) / ↓ (развернуть). Расположена в строке поиска/фильтров, первая кнопка.

**Состояние (ShipmentsPage):**
```ts
const [expandAllTrips, setExpandAllTrips] = useState(() => localStorage.getItem(lsKey('elestet-expand-all')) === 'true')
const [collapseSignal, setCollapseSignal] = useState(0)           // счётчик для форс-схлопывания
const [anyTripExpanded, setAnyTripExpanded] = useState(false)     // true если хоть один рейс раскрыт
```

**Логика кнопки:**
- `anyTripExpanded=true` → закрыть все: `setExpandAllTrips(false)` + `setCollapseSignal(n+1)` + `localStorage='false'`
- `anyTripExpanded=false` → открыть все: `setExpandAllTrips(true)` + `localStorage='true'`
- `collapseSignal` нужен, т.к. если `expandAll` уже `false`, его изменение не вызовет реакцию в TripTable

**TripTable пропсы:**
```tsx
expandAll={expandAllTrips || searchQuery.trim().length > 0}
collapseAllSignal={collapseSignal}
onExpandedCountChange={(count) => { setAnyTripExpanded(count > 0); if (count === 0) setExpandAllTrips(false) }}
```
При активном поиске рейсы авто-разворачиваются (чтобы поставки были видны).

**Стиль кнопки:** `!h-10 !w-10 !rounded-2xl !px-0`, синий фон `!bg-[#E3EAF6]` когда `anyTripExpanded=true`.

## Настройки тулбара — привязка к пользователю

Все localStorage-ключи содержат суффикс `userId`:
```ts
const lsKey = (k: string) => userId ? `${k}-${userId}` : k
```
Ключи: `elestet-expand-all`, `elestet-hover-add-mode`, `elestet-logistics-show-supplier`.
UserId передаётся через prop `userId?: string` из App.tsx (`session?.user?.id`).
Это позволяет каждому пользователю хранить свои настройки в одной компании.

## Режим фокуса

**Функция:** скрывает сайдбар и топбар — контент занимает весь экран (100% ширины и высоты).

**Реализация:**
- Класс `elestet-focus-mode` добавляется к `document.body`
- CSS в `styles.css`:
  ```css
  body.elestet-focus-mode aside,
  body.elestet-focus-mode main > div:first-child { display: none; }
  ```
- **Хранение:** `sessionStorage('elestet-focus-mode')` — переживает F5, но не навигацию по SPA и не закрытие вкладки
- **Защита от F5:** `beforeunload` ставит флаг `elestet-focus-mode-reloading`; cleanup в `useEffect([], [])` проверяет флаг — если есть, оставляет ключ (перезагрузка), если нет — удаляет (уход со страницы)
- **Старая логика** (затемнение соседних рейсов в TripTable) — удалена. `focusMode` не передаётся в `<TripTable>`.

## Поиск по поставкам

**Поле:** ширина `min-w-[400px]`, иконка лупы слева, кнопка ✕ для сброса, стиль идентичен ProductsPage (серый фон → белый + синяя обводка при фокусе).

**Что ищет** (`filteredTrips` через `useMemo`):
- Рейс: `trip_number`, `carrier`
- Поставка: `store.name`, `store.supplier_full`, `store.store_code`, `destination_warehouse`, `shipment_number`, `wb_supply_id`

**Логика фильтрации:**
- Если совпадение по рейсу/перевозчику → весь рейс со всеми строками
- Если совпадение только по поставке → рейс остаётся, но показываются только matching строки внутри

```ts
const filteredTrips = useMemo(() => {
  if (!q) return trips
  const matchesLine = (line) => ...
  const tripMatches = (trip) => trip.trip_number?.includes(q) || trip.carrier.includes(q)
  return trips
    .filter((trip) => tripMatches(trip) || trip.lines.some(matchesLine))
    .map((trip) => tripMatches(trip) ? trip : { ...trip, lines: trip.lines.filter(matchesLine) })
}, [trips, searchQuery])
```

## Current UX
- flat page header via top bar title
- compact action bar with search/filter/sort placeholders and create action
- summary cards
- dense shipments table
- modal for creation
- tracking preview shown before save

## Critical Business Logic
- shipment belongs to one account and one store
- next `tracking_number` is computed inside the chosen store scope
- displayed `tracking_code` uses format `TRK-{number}`
- if status is `Прибыл` and date absent, current date is auto-filled
- status history entry is created during creation flow

## Current Limitation
Frontend preview logic mirrors DB logic, but should not be treated as ultimate source of truth. Real source of truth must move to Supabase.

## Future Safe Evolution
- create shipment through Supabase RPC
- load shipments through joined reads
- expose shipment status history in a details drawer/page
- turn visual search/filter controls into real query controls

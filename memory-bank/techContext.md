# Tech Context

## Current feature files — 24.08.2026
- `src/pages/FbsOrdersPage.tsx` — FBS cache UI, поставки/заказы, синк, перенос, печать, лист подбора, товарное обогащение.
- `src/pages/ProductsPage.tsx` — каталог товаров, поиск с очисткой, редактирование себестоимости и Excel с обязательными/выборочными колонками по точному варианту.
- `supabase/functions/wb-fbs/index.ts` — прокси и синхронизация WB Marketplace FBS API.
- `supabase/patch_fbs_reliable_sync.sql` — int64-safe статусы, журнал и атомарный полный снимок FBS; применён в production.
- `supabase/patch_fbs_product_locations.sql` — пакетный read-only поиск товара FBS по содержимому коробов с партией, поставкой и текущим WMS-адресом; применён в production.
- `src/pages/WmsPage.tsx` — визуальные стеллажи, паллетоместа, стороны, сетки K-мест, QR коробов, перенос/обмен.
- `supabase/patch_wms_rack_layout.sql` — стороны и геометрия мест коробов, ограничения, атомарные RPC планировки и перемещения; применён в production.
- `supabase/patch_wms_side_codes_f.sql` — безопасная production-миграция стабильных кодов сторон с `S1/S2` на `F1/F2` без смены UUID и потери размещений.
- `supabase/patch_wms_scanning.sql`, `supabase/patch_wms_operations.sql`, `supabase/patch_wms_sensitive_search.sql` — WMS QR/сканирование, операции и чувствительный поиск; новые адреса используют `F`, старые WMS QR с `S1/S2` остаются читаемыми.
- `src/pages/TzPromptsPage.tsx` — CRUD промптов и компактный `TasksTab`.
- `supabase/patch_tz_tasks.sql` — `tz_tasks`, индексы, RLS superadmin; применён.
- `supabase/patch_tz_task_sections.sql` — раздел страницы для коротких задач и индекс раздела; применён в production 26.08.2026.
- `supabase/patch_tz_task_timezone.sql` — часовой пояс браузера, из которого создана короткая задача; применён в production 26.08.2026.
- `supabase/seed_tz_tasks_20260809.sql` — идемпотентный сид девяти задач; применён.
- `memory-bank/components/fbs-orders.md`, `wms.md` и `tz-tasks.md` — подробная актуальная документация.

## Packages used by current FBS/export/WMS work
- `jspdf` — PDF; `xlsx` — Excel; `jszip` — ZIP нескольких поставок; `qrcode.react` — QR физического короба; `@supabase/supabase-js` — DB/Functions.

## Validation/deploy state — 24.08.2026
- Полный `npm run build` проходит: 658 модулей; остаются только прежние предупреждения Vite о размере чанков и `xlsx`. После последней кнопки очистки поиска отдельно проходит `npx tsc -b --pretty false`.
- Локальные frontend-изменения WMS/FBS/Products используют только `localStorage` и существующие read-запросы; новых SQL/RPC и изменений production Supabase нет.
- Рабочая ветка — `main`; последний commit перед текущими локальными изменениями — `9bd1554`. Vercel production автоматически собирает push в `main`.
- Production Supabase уже содержит надёжную FBS-синхронизацию, новую WMS-планировку/RPC и стороны `F1/F2`. Миграция сохранила UUID и все 53 текущих размещения; потерянных связей — 0. Fulfillment-поставки не менялись и сохраняют `S` в ШК всех 2212 коробов.
- Supabase CLI linked project: `jzucxqakvgzpgtvagsnq`.

## Stack
- Frontend: React + TypeScript
- Bundler: Vite
- Styling: Tailwind CSS
- Backend: Supabase (Postgres + Edge Functions + pg_cron)

## Current Packages
- `react`, `react-dom`
- `vite`, `typescript`
- `tailwindcss`, `@tailwindcss/postcss`
- `@vitejs/plugin-react`
- `@supabase/supabase-js`
- `qrcode.react`

## Important Files
- `src/App.tsx` — app shell, routing by activePage/effectivePage state; кеш `adminStats`/`adminAccounts`; рендеринг `PaymentResultPage`
- `src/hooks/useAuth.ts` — auth session
- `src/hooks/useAccounts.ts` — company list, create, delete
- `src/hooks/useAppData.ts` — stores, trips, stickers, bundles; 2-волновая загрузка (Promise.all)
- `src/hooks/usePlatformRole.ts` — платформенная роль (`user`/`support`/`admin`/`superadmin`)
- `src/services/tripService.ts` — fetchTrips, createTrip, addTripLine
- `src/services/shipmentService.ts` — legacy
- `src/services/storeService.ts` — stores CRUD
- `src/services/platformRoleService.ts` — adminGetPlatformRoles, adminSetPlatformRole, adminFindUserByShortId
- `src/services/billingService.ts` — activateGracePeriod, getBillingStatus
- `src/services/accessOverrideService.ts` — adminGetOverrides, adminCreateOverride (include_trial_accounts)
- `src/services/paymentService.ts` — createPaymentOrder (→ Edge Function), getPaymentOrderStatus (→ RPC)
- `src/pages/AdminPage.tsx` — 5 табов: users/subscriptions/access/team/payment; экспортирует `AdminStats`, `AccountBillingRow`
- `src/pages/SubscriptionPage.tsx` — тарифы + калькулятор периода + кнопка «Оплатить»
- `src/pages/PaymentResultPage.tsx` — polling + UI-состояния pending/paid/failed/expired
- `src/types/index.ts` — все domain types
- `src/lib/supabase.ts` — Supabase client
- `src/lib/plans.ts` — getBillingStatus, trialDaysLeft, graceDaysLeft
- `src/lib/constants.ts` — shipmentStatuses, paymentStatuses, tripStatuses, carrierOptions, warehouseOptions

## Supabase SQL-патчи (применённые)
- `supabase/bootstrap.sql` — начальная схема
- `supabase/patch_platform_roles.sql` — platform_role на profiles, get_my_platform_role()
- `supabase/patch_platform_roles_team.sql` — admin_get_platform_roles(), admin_find_user_by_short_id()
- `supabase/patch_admin_stats_rpc.sql` — admin_get_stats() RPC (вместо Edge Function)
- `supabase/patch_billing.sql`, `patch_billing_v4.sql` — таблицы биллинга (plan, plan_until, trial_ends_at, grace_until)
- `supabase/patch_billing_extra.sql` — блокировка 2-й компании, include_trial_accounts в access_overrides
- `supabase/patch_billing_security.sql` — защита admin_ RPC, фикс grace period
- `supabase/patch_billing_cron.sql` — cron job `expire-outdated-plans` (03:00 UTC ежедневно)
- `supabase/patch_billing_get_my_accounts.sql` — billing-поля в get_my_accounts RPC
- `supabase/patch_payment_orders.sql` — таблица payment_orders + 3 RPC (create/activate/get_status)
- `supabase/patch_access_overrides.sql` — access_overrides таблица + RPC
- `supabase/patch_fbs_db.sql`, `supabase/patch_fbs_reliable_sync.sql` — FBS-кэш, официальные статусы WB, журнал и атомарный снимок
- `supabase/patch_wms.sql`, `supabase/patch_wms_boxes.sql`, `supabase/patch_wms_disabled.sql` — базовая WMS-схема, физические короба и заглушённые места
- `supabase/patch_wms_rack_layout.sql` — максимум две стороны, сетки K-мест, стойки, безопасное сохранение и атомарный move/swap
- `supabase/patch_wms_side_codes_f.sql` — перевод существующих сторон на `F1/F2` без пересоздания записей
- `supabase/patch_wms_scanning.sql`, `supabase/patch_wms_operations.sql`, `supabase/patch_wms_sensitive_search.sql` — QR, сканирование, размещение, история и поиск с новыми `F`-адресами; распознавание старых `S`-адресов сохранено

## Edge Functions (задеплоены)
- `supabase/functions/wb-fbs/index.ts` — FBS API WB, полный sync, статусы, поставки, стикеры, остатки и передача поставки в доставку
- `supabase/functions/create-payment/index.ts` — создание платёжного заказа (TODO: MBusiness API call)
- `supabase/functions/payment-webhook/index.ts` — получение webhook от MBusiness (TODO: HMAC verify + field mapping)
- Деплой: через Management API `POST /v1/projects/{id}/functions` (Supabase CLI не принимает формат токена)

## Платёжный поток
```
SubscriptionPage
  → handlePay → createPaymentOrder (paymentService)
    → POST Edge Function create-payment
      → create_payment_order RPC → uuid
      → [TODO] MBusiness API → payment_url
      → вернуть {order_id, payment_url}
  → window.location.href = payment_url
    → Пользователь оплачивает на странице MBusiness
    → MBusiness POST /payment-webhook (Edge Function)
      → [TODO] verify HMAC
      → activate_plan_by_payment RPC
      → plan активирован
    → MBusiness redirect → /payment/result?order_id=...
  PaymentResultPage
    → polling getPaymentOrderStatus каждые 3с
    → статус paid → onAccountRefresh
```

## Environment
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Deploy
- Хостинг: Vercel (elestet.net = production, main branch)
- CI/CD: автодеплой при push в `main` (production)
- **ВАЖНО:** текущая рабочая ветка — `main`. В `master` больше не мержить.
- `vercel.json`: `"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]` — SPA routing
- Supabase Project: `jzucxqakvgzpgtvagsnq.supabase.co`

## Домен
- Домен `elestet.net` зарегистрирован на **Namecheap**
- DNS: `A @ → 76.76.21.21`, `CNAME www → cname.vercel-dns.com`

## DB API Pattern (для скриптов)
```js
// _something.cjs (CommonJS — ESM проект, нужен .cjs)
const fs = require('fs')
const https = require('https')
// node -e "..." — однострочники через require()
// Запрос: POST api.supabase.com/v1/projects/{id}/database/query
// Body: JSON.stringify({ query: sql })
// Auth: Bearer sbp_v0_...
```

## Future Technical Direction
- Мобильное приложение: React Native (Expo) + TypeScript, та же Supabase БД
- При росте сложности: React Router, TanStack Query, Supabase generated types

## Current Packages
- `react`, `react-dom`
- `vite`, `typescript`
- `tailwindcss`, `@tailwindcss/postcss`
- `@vitejs/plugin-react`
- `@supabase/supabase-js`

## Important Files
- `src/App.tsx` — app shell, routing by activePage state; `usePlatformRole`, `effectiveOverride`, `adminStats`/`adminAccounts` кеш
- `src/hooks/useAuth.ts` — auth session
- `src/hooks/useAccounts.ts` — company list, create, delete
- `src/hooks/useAppData.ts` — stores, shipments (legacy), trips, stickers, bundles, mutations; 2-волновая загрузка
- `src/hooks/usePlatformRole.ts` — платформенная роль (`user`/`support`/`admin`/`superadmin`), isAdmin, isSupport
- `src/services/tripService.ts` — fetchTrips, createTrip, addTripLine
- `src/services/shipmentService.ts` — legacy, keep for now
- `src/services/storeService.ts` — stores CRUD
- `src/services/platformRoleService.ts` — adminGetPlatformRoles, adminSetPlatformRole, adminFindUserByShortId
- `src/types/index.ts` — all domain types including Trip, TripLine, TripWithLines
- `src/lib/supabase.ts` — Supabase client
- `src/lib/constants.ts` — shipmentStatuses, paymentStatuses, tripStatuses, carrierOptions, warehouseOptions
- `src/pages/AdminPage.tsx` — 4 таба: users/subscriptions/access/team; экспортирует `AdminStats`, `AccountBillingRow`
- `supabase/schema.sql` — main schema
- `supabase/trips.sql` — trips + trip_lines tables, RLS, RPC
- `supabase/patch_trip_functions.sql` — исправление FOR UPDATE в create_trip и add_trip_line
- `supabase/carriers_warehouses.sql` — carriers + warehouses tables, RLS
- `supabase/patch_platform_roles.sql` — `platform_role` колонка на profiles, get_my_platform_role(), admin_set_platform_role() — APPLIED
- `supabase/patch_platform_roles_team.sql` — admin_get_platform_roles(), admin_find_user_by_short_id() — APPLIED
- `supabase/patch_admin_stats_rpc.sql` — admin_get_stats() RPC (вместо Edge Function admin-stats) — APPLIED
- `supabase/seed_trips.sql` — тестовый сид через SQL
- `supabase/run_seed.mjs` — тестовый сид через Node.js + Supabase client

## Environment
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEFAULT_ACCOUNT_ID` (legacy dev helper)

## Current Tooling Notes
- Tailwind через PostCSS (`@tailwindcss/postcss`)
- Dev server: `npm run dev`
- No router — page switching is local state in App.tsx
- No query caching library

## Deploy
- Хостинг: Vercel (`elestet-logistics-system.vercel.app`)
- CI/CD: автодеплой при push в `main` через GitHub
- Env-переменные: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` добавлены в Vercel
- Production RLS включён на всех таблицах
- Рекурсивные политики `account_members` исправлены (`user_id = auth.uid()`)

## Система коротких ID (short_id) — ВАЖНО

Все ключевые сущности имеют числовой `short_id` (автоинкремент). На фронте всегда показываем short_id с префиксом, UUID используется только внутри БД/API.

| Сущность | Таблица | Формат на фронте | Поле |
|---|---|---|---|
| Пользователь | `profiles` | `U1`, `U2`, ... | `profiles.short_id` |
| Компания (аккаунт) | `accounts` | `C-1`, `C-2`, ... | `accounts.short_id` |
| Партия (фулфилмент) | `fulfillment_batches` | `P-1`, `P-2`, ... | `fulfillment_batches.short_id` |

**Правило:** На фронте всегда показывать `short_id` с префиксом, никогда UUID. UUID — только для внутренней логики (запросы к БД, foreign keys).



## Домен
- Домен `elestet.net` зарегистрирован на **Namecheap**
- DNS настраивается в Namecheap → Advanced DNS
- Нужные записи: `A @ → 76.76.21.21`, `CNAME www → cname.vercel-dns.com`
- При падении сайта (ERR_CONNECTION_REFUSED) — сначала проверить Namecheap Advanced DNS + Vercel → Domains

## Future Technical Direction
- Мобильное приложение: React Native (Expo) + TypeScript, та же Supabase БД
- При росте сложности: React Router, TanStack Query, генерированные Supabase types

## Platform Roles — система ролей платформы (31.05.2026)

Отдельный уровень прав поверх RBAC аккаунтов. Хранится в `profiles.platform_role`.

| Роль | Доступ |
|------|--------|
| `user` | Обычный пользователь (по умолчанию) |
| `support` | Поддержка: видит AdminPage, не может изменять роли, имеет `effectiveOverride = { plan: 'operational' }` |
| `admin` | Администратор: видит AdminPage, вкладку Команда, может менять роли |
| `superadmin` | Суперадмин: все права admin + может повышать до superadmin |

### Файлы
- `supabase/patch_platform_roles.sql` — `platform_role` колонка, `get_my_platform_role()`, `admin_set_platform_role()` — APPLIED
- `supabase/patch_platform_roles_team.sql` — `admin_get_platform_roles()`, `admin_find_user_by_short_id()` — APPLIED
- `src/hooks/usePlatformRole.ts` — хук: `{ platformRole, isSuperAdmin, isAdmin, isSupport, isLoading }`
- `src/services/platformRoleService.ts` — `adminGetPlatformRoles()`, `adminSetPlatformRole(userId, role)`, `adminFindUserByShortId(shortId)`

### App.tsx — platform role section
```ts
const { platformRole, isSuperAdmin, isAdmin, isSupport } = usePlatformRole(session?.user?.id)
const [adminStats, setAdminStats] = useState<AdminStats | null>(null)
const [adminAccounts, setAdminAccounts] = useState<AdminAccountBillingRow[] | null>(null)
const effectiveOverride: ActiveOverride | null = isSupport
  ? { type: 'plan', plan: 'operational', free_until: '2099-12-31' }
  : activeOverride
```

### AdminPage — вкладки
- `users` — список пользователей (admin_get_stats RPC)
- `subscriptions` — биллинг, тарифы
- `access` — управление доступом
- `team` — команда платформы (только для `canEdit = isAdmin || isSuperAdmin`)

```ts
const canEdit = platformRole === 'admin' || platformRole === 'superadmin'
```

## Supabase API (PowerShell — применение SQL патчей)

```powershell
$lines = Get-Content "supabase\patch_xxx.sql" -Encoding UTF8
$sql = $lines -join "`n"
$payload = [pscustomobject]@{ query = $sql }
$json = $payload | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/<PROJECT_REF>/database/query" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer <SUPABASE_PAT>"; "Content-Type" = "application/json" } `
  -Body $bytes
```


- Schema: `supabase/schema.sql`
- Bootstrap: `supabase/bootstrap.sql`
- Dev helpers: `supabase/dev_access.sql`, `supabase/disable_rls_dev.sql`
- Trips schema: `supabase/trips.sql` + `supabase/patch_trip_functions.sql`
- carriers/warehouses: `supabase/carriers_warehouses.sql` (таблицы применены, фронт не подключён)
- RPC: `create_trip`, `add_trip_line` — работают, протестированы
- **countries**: `supabase/patch_countries.sql` — кэш стран Teksher `(teksher_id PK, name, code, synced_at)`
- **tnved_codes**: ТН ВЭД справочник — `(code, teksher_id, sub_position_name, position, position_name, subgroup_id, ...)`

## Edge Functions
- `supabase/functions/teksher-auth/index.ts` — все взаимодействия с Teksher API
- Деплой: `npx supabase functions deploy teksher-auth --no-verify-jwt`
- Actions: `connect`, `disconnect`, `stats`, `products`, `codes`, `operations`, `operation_ready`, `emit`, `utilise`, `create_product`, `publish_product`, `participant_info`, `topup_qr`, `countries`, `refresh_countries`, `tnved_list`, `tnved_sync`
- Auth в edge function: `supabase.auth.getUser()` через заголовок `Authorization: Bearer {token}`
- **ВАЖНО:** вызывающая сторона (KizPage.tsx `invoke()`) обязана обновить сессию через `supabase.auth.getSession()` перед каждым вызовом и явно передать свежий `access_token`

## Public repository and secret handling (31.08.2026)

- GitHub repository is currently public. Treat `README.md`, tracked files, commit history, author metadata, and unique project strings as discoverable even when a person does not initially know the GitHub username.
- `sourcemap: false` prevents convenient production source maps, but it does not hide a public repository or its README.
- Supabase personal access tokens (`sbp_…`), service-role values, WB keys, payment secrets, and similar credentials must never be literals in tracked scripts, README, memory bank, examples, logs, or frontend code.
- Local helpers must read privileged values from an ignored `.env.local`, process environment, or a platform secret store. Examples use placeholders only.
- If a real token ever enters a commit, deleting the line is not revocation. First revoke/delete the token at its provider, then remove it from the working tree and rewrite public Git history if cleanup is required.
- The historical Supabase PAT discovered in a tracked helper during the 31.08.2026 audit was confirmed by the owner as already revoked. Never reuse or reproduce its value.

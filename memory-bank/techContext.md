# Tech Context

## Stack
- Frontend: React + TypeScript
- Bundler: Vite
- Styling: Tailwind CSS
- Backend: Supabase (Postgres)

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

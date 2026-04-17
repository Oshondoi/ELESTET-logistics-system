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
- `src/App.tsx` — app shell, routing by activePage state
- `src/hooks/useAuth.ts` — auth session
- `src/hooks/useAccounts.ts` — company list, create, delete
- `src/hooks/useAppData.ts` — stores, shipments (legacy), trips, mutations
- `src/services/tripService.ts` — fetchTrips, createTrip, addTripLine
- `src/services/shipmentService.ts` — legacy, keep for now
- `src/services/storeService.ts` — stores CRUD
- `src/types/index.ts` — all domain types including Trip, TripLine, TripWithLines
- `src/lib/supabase.ts` — Supabase client
- `src/lib/constants.ts` — shipmentStatuses, paymentStatuses, tripStatuses, carrierOptions, warehouseOptions
- `supabase/schema.sql` — main schema
- `supabase/trips.sql` — trips + trip_lines tables, RLS, RPC
- `supabase/patch_trip_functions.sql` — исправление FOR UPDATE в create_trip и add_trip_line
- `supabase/carriers_warehouses.sql` — carriers + warehouses tables, RLS
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

## Future Technical Direction
- Мобильное приложение: React Native (Expo) + TypeScript, та же Supabase БД
- При росте сложности: React Router, TanStack Query, генерированные Supabase types
- Production RLS — убрать disable_rls_dev.sql после исправления рекурсии в account_members

## Supabase Notes
- Schema: `supabase/schema.sql`
- Bootstrap: `supabase/bootstrap.sql`
- Dev helpers: `supabase/dev_access.sql`, `supabase/disable_rls_dev.sql`
- Trips schema: `supabase/trips.sql` + `supabase/patch_trip_functions.sql`
- carriers/warehouses: `supabase/carriers_warehouses.sql` (таблицы применены, фронт не подключён)
- RPC: `create_trip`, `add_trip_line` — работают, протестированы

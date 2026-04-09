# Tech Context

## Stack
- Frontend: React
- Bundler: Vite
- Language: TypeScript
- Styling: Tailwind CSS
- Backend: Supabase
- Database: Postgres via Supabase

## Current Packages
- `react`
- `react-dom`
- `vite`
- `typescript`
- `tailwindcss`
- `@tailwindcss/postcss`
- `@vitejs/plugin-react`
- `@supabase/supabase-js`

## Important Files
- `package.json`
- `src/App.tsx`
- `src/hooks/useAuth.ts`
- `src/hooks/useAccounts.ts`
- `src/hooks/useAppData.ts`
- `src/services/accountService.ts`
- `src/services/shipmentService.ts`
- `src/services/storeService.ts`
- `src/types/index.ts`
- `src/lib/supabase.ts`
- `supabase/schema.sql`

## Environment
Expected env vars:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

If env vars are missing, the app should be treated as misconfigured. Runtime is intended to work only with Supabase now.

## Current Tooling Notes
- Tailwind is wired through PostCSS using `@tailwindcss/postcss`
- Dev server is started via `npm run dev`
- Linting is currently checked through editor diagnostics rather than a dedicated lint script

## Current Technical Constraints
- No router installed yet; page switching is local state driven
- No query caching library yet
- No component library; UI is custom lightweight Tailwind primitives

## Recommended Near-Term Technical Direction
- Keep dependencies lean
- Avoid over-engineering before real data is connected
- When auth/data complexity grows, consider adding:
  - React Router
  - TanStack Query
  - generated Supabase types

## Supabase Notes
- Schema is ready in `supabase/schema.sql`
- First account bootstrap exists in `supabase/bootstrap.sql`
- Temporary browser-access helpers exist in:
  - `supabase/dev_access.sql`
  - `supabase/disable_rls_dev.sql`
- Real implementation will likely need:
  - direct table reads
  - RPC for shipment creation
  - auth session handling
  - role-aware account resolution

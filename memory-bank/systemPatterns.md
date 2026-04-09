# System Patterns

## Architecture Style
Current architecture is a frontend-first MVP shell with a real Supabase-backed runtime.

There are two main layers right now:
- Presentational React UI
- Auth + company selection state
- Supabase-backed data hook/service layer

Later target:
- Presentational React UI
- Feature-specific hooks / services
- Supabase client + RPC / table queries
- Supabase Auth + corrected RLS-protected data model

## Main Frontend Structure
- `src/components`
  - shared UI primitives
  - layout pieces
  - feature-specific components
- `src/pages`
  - page composition only
- `src/hooks`
  - app-level state composition
- `src/services`
  - data creation/list logic
- `src/types`
  - domain contracts
- `src/lib`
  - helpers, constants, Supabase client

## State Pattern
Current state is managed by:
- `useAuth`
- `useAccounts`
- `useAppData`

Pattern:
1. resolve auth session
2. load user companies
3. choose active company
4. read stores and shipments from Supabase for active company
5. run create flows through service helpers / RPC

This should later evolve into:
1. authenticated account resolution
2. feature-specific data hooks (`useShipments`, `useStores`, etc.)
3. explicit mutation flows and refresh rules
4. preserve type-safe DTO/domain mapping

## Domain Patterns

### Multi-Tenant Boundary
`account_id` is the main tenant boundary for business data.

### Store-Specific Shipment Sequence
Tracking number uniqueness is not global. It is scoped to a store:
- unique key: `(store_id, tracking_number)`
- generated display value: `tracking_code`

### Status History Pattern
Status change tracking is append-only history via `shipment_status_history`.

### Safe Relational Design
Deletion is intentionally conservative:
- foreign keys use restrictive behavior in important places
- UI should favor safe workflows over destructive deletion

## UI Patterns
- Compact business layout
- Left sidebar navigation with brand area and company switcher
- Flat top bar with current page title
- Dense tables for operations
- Compact action bars with search/filter/create affordances
- Modal forms for creation flows
- Russian copy throughout the interface

## Important Boundaries
- UI should not directly own business logic for store code or tracking sequence generation when Supabase becomes active
- generation logic should live in DB / RPC / trusted service layer
- frontend may preview generated values, but backend must remain source of truth

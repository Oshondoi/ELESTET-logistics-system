# Project Brief

## Project
`ELESTET` is an MVP web application for managing logistics shipments to Wildberries.

## Primary Goal
Build a clean, extensible SaaS-style operations panel for shipment tracking and store management, with Supabase as the backend and React + Vite as the frontend.

## Scope of Current MVP
- Multi-account SaaS data model
- Supabase Auth flow
- Company creation and selection
- Russian-language business UI
- Shipments list page
- Shipment creation modal
- Stores page
- Store creation modal
- Supabase-ready SQL schema
- Strict Supabase-backed runtime for reads/writes

## Required Business Entities
- `auth.users`
- `profiles`
- `accounts`
- `account_members`
- `stores`
- `shipments`
- `shipment_status_history`

## Core Business Rules
- One user can belong to multiple accounts
- One account can contain multiple stores
- Each store belongs to exactly one account
- Each shipment belongs to exactly one account and one store
- Shipment status changes must be written to history
- `tracking_number` increments only within a store
- `tracking_code` format is `TRK-{number}`
- `store_code` format is `A4821` style: 1 uppercase letter + 4 digits
- `store_code` must be unique globally
- `arrival_date` is auto-filled when status becomes `Прибыл`, but remains editable
- Physical delete is not the main UX path; schema should remain safe and relationally correct

## Product Direction
The product should feel like a practical operations system, not a marketing landing page. Dense, readable, and efficient UI is preferred over decorative layout.

## Change Discipline
- Work strictly to the user's task and the stated acceptance criteria
- Do not change unrelated business logic, UI behavior, copy, layout, or visual style unless the task explicitly asks for it
- Prefer the smallest safe fix that solves the requested problem
- Avoid opportunistic refactors and side improvements during focused bugfix or UI tasks
- A valid task result must not regress adjacent screens, forms, shared UI primitives, or existing flows
- If a requested fix truly requires touching nearby areas, keep the blast radius minimal and explicit
- Default project rule: preserve already working behavior and do not touch adjacent screens, entities, or styles unless the current task explicitly requires it

## Non-Goals For Current Stage
- Production-grade role UI
- Detailed analytics
- Complex filters and reporting
- Shipment detail page
- Realtime updates

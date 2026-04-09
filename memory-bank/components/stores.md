# Stores Component Area

## Purpose
Stores are account-owned marketplace cabinets used as the parent scope for shipments.

## Main Files
- `src/pages/StoresPage.tsx`
- `src/components/stores/StoreList.tsx`
- `src/components/stores/StoreFormModal.tsx`
- `src/services/storeService.ts`

## Current UX
- compact action bar
- stats card
- list view
- create store modal
- optional manual `store_code`
- auto-generation in SQL schema when not provided

## Critical Business Logic
- each store belongs to one account
- `store_code` must be globally unique
- required format: one uppercase letter plus four digits

## Future Safe Evolution
- validate `store_code` before submit
- prevent duplicate manual codes with backend error handling
- add marketplace-specific metadata only if business actually needs it

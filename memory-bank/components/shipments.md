# Shipments Component Area

## Purpose
Handles the main business workflow: viewing and creating shipments.

## Main Files
- `src/pages/ShipmentsPage.tsx`
- `src/components/shipments/ShipmentTable.tsx`
- `src/components/shipments/ShipmentFormModal.tsx`
- `src/services/shipmentService.ts`

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

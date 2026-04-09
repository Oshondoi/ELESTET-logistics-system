# Product Context

## Why This Project Exists
The product is being created to manage logistics operations for shipments going to Wildberries. The user needs a compact web interface to register stores, create shipments, track statuses, and later add account-based collaboration and authorization.

## Problems It Solves
- Shipment tracking is currently not systematized in a structured SaaS product
- Store-specific tracking sequences are easy to break without explicit system logic
- Operators need a clean interface in Russian for everyday work
- Data model must be safe for future multi-company operation

## Target Users
- Logistics operators
- Managers
- Admins / account owners
- Internal teams working inside one business account

## UX Expectations
- Russian-language UI
- Compact and business-like
- Better suited for operations than presentation
- Minimal friction when entering repetitive logistics data
- Easy to extend later with auth, roles, and stronger Supabase account isolation

## Current Product Shape
- Main focus is shipment registry
- Stores are supporting entities required for shipment creation
- Layout uses a left sidebar plus main content work area
- Forms open in modals
- UI is being tuned toward a denser SaaS dashboard style
- Access is now blocked behind auth; user must sign in before seeing the app
- Company is a first-class entity in the product and is selected via sidebar switcher

## Important Semantic Rules
- `Прибыл` means cargo reached the required city/country and is ready for next dispatch step
- `planned_marketplace_delivery_date` is the expected date for marketplace delivery
- `arrived_box_qty` means actual boxes received in fact
- `units_qty` and `units_total` must remain distinct fields because the business requested both

## Current Product Quality Target
Not enterprise-heavy, but not toy-quality. The MVP should be stable, readable, and structurally safe for future growth.

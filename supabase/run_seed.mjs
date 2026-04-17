import { createClient } from '@supabase/supabase-js'

const url = 'https://jzucxqakvgzpgtvagsnq.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dWN4cWFrdmd6cGd0dmFnc25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MTM5NjIsImV4cCI6MjA5MTI4OTk2Mn0.qX73zQpV0qZecXcbcCLKqr_niYAag8nYCFV19RMkEp0'

const supabase = createClient(url, key)

// Получаем account_id и store_id из БД
const { data: accounts, error: accErr } = await supabase.from('accounts').select('id').limit(1)
if (accErr || !accounts?.length) { console.error('Нет аккаунтов:', accErr?.message); process.exit(1) }
const accountId = accounts[0].id
console.log('account_id:', accountId)

const { data: stores, error: stErr } = await supabase.from('stores').select('id, name').eq('account_id', accountId).limit(2)
if (stErr || !stores?.length) { console.error('Нет магазинов:', stErr?.message); process.exit(1) }
const store1 = stores[0].id
const store2 = (stores[1] ?? stores[0]).id
console.log('store1:', stores[0].name, '| store2:', (stores[1] ?? stores[0]).name)

// ── Рейс 1 ──────────────────────────────────────────────────
const { data: trip1, error: t1err } = await supabase.rpc('create_trip', {
  p_account_id: accountId,
  p_carrier: 'Asia Cargo',
  p_departure_date: '2026-04-20',
  p_status: 'Отправлен',
  p_payment_status: 'Частично оплачено',
  p_comment: 'Первый тестовый рейс',
})
if (t1err) { console.error('create_trip 1:', t1err.message); process.exit(1) }
console.log(`Создан Рейс #${trip1.trip_number}`)

for (const [store, warehouse, boxes, units, total, status, comment] of [
  [store1, 'Коледино',      10, 200, 150000, 'В пути',           'Основная партия'],
  [store2, 'Электросталь',   5,  80,  60000, 'В пути',           ''],
  [store1, 'Казань',          3,  40,  30000, 'Ожидает отправки', ''],
]) {
  const { error } = await supabase.rpc('add_trip_line', {
    p_trip_id: trip1.id,
    p_account_id: accountId,
    p_store_id: store,
    p_destination_warehouse: warehouse,
    p_box_qty: boxes,
    p_units_qty: units,
    p_units_total: total,
    p_arrived_box_qty: 0,
    p_planned_marketplace_delivery_date: '2026-04-25',
    p_arrival_date: null,
    p_status: status,
    p_comment: comment,
  })
  if (error) { console.error('add_trip_line:', error.message); process.exit(1) }
  console.log(`  + поставка → ${warehouse}`)
}

// ── Рейс 2 ──────────────────────────────────────────────────
const { data: trip2, error: t2err } = await supabase.rpc('create_trip', {
  p_account_id: accountId,
  p_carrier: 'Карго KG',
  p_departure_date: '2026-04-28',
  p_status: 'Формируется',
  p_payment_status: 'Не оплачено',
  p_comment: 'Второй тестовый рейс',
})
if (t2err) { console.error('create_trip 2:', t2err.message); process.exit(1) }
console.log(`Создан Рейс #${trip2.trip_number}`)

for (const [store, warehouse, boxes, units, total, comment] of [
  [store1, 'Краснодар',    8, 120, 90000, 'Срочно'],
  [store2, 'Новосибирск',  6,  90, 70000, ''],
]) {
  const { error } = await supabase.rpc('add_trip_line', {
    p_trip_id: trip2.id,
    p_account_id: accountId,
    p_store_id: store,
    p_destination_warehouse: warehouse,
    p_box_qty: boxes,
    p_units_qty: units,
    p_units_total: total,
    p_arrived_box_qty: 0,
    p_planned_marketplace_delivery_date: '2026-05-04',
    p_arrival_date: null,
    p_status: 'Ожидает отправки',
    p_comment: comment,
  })
  if (error) { console.error('add_trip_line:', error.message); process.exit(1) }
  console.log(`  + поставка → ${warehouse}`)
}

console.log('Готово!')

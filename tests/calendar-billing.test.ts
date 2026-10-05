import assert from 'node:assert/strict'
import { quoteCalendarMonth as quote, quotePlanReplacement as replace } from '../src/lib/calendarBilling'
for (const month of ['2026-02','2028-02','2026-04','2026-01']) {
  for (const day of ['01','04','05']) assert.equal(quote(3000, `${month}-${day}`).amountSom, 3000)
}
assert.equal(quote(3000,'2026-04-09').amountSom,2500)
assert.equal(quote(3000,'2026-04-14').amountSom,2000)
assert.equal(quote(3000,'2026-10-16').amountSom,1600)
assert.equal(quote(5000,'2026-10-31').amountSom,167)
assert.deepEqual(quote(3000,'2026-12-31',true),{startDate:'2027-01-01',endDateExclusive:'2027-02-01',chargedDays:31,amountSom:3000})
assert.throws(()=>quote(3000,'2026-02-29'))
assert.throws(()=>quote(3000,'2026-04-15',true))
const base={previousMonthlySom:3000,nextMonthlySom:2000,purchaseDate:'2026-04-09',paidAt:'2026-04-09T08:00:00Z',now:'2026-04-10T08:00:00Z',completedChanges:0,kind:'main' as const}
const result=replace(base)
assert.equal(result.creditSom,833)
assert.equal(result.startDate,'2026-04-09')
assert.equal(result.paidAt,base.paidAt)
assert.equal(replace({...base,completedChanges:2}).creditSom,833)
assert.throws(()=>replace({...base,completedChanges:3}))
assert.throws(()=>replace({...base,kind:'brand'}))
assert.throws(()=>replace({...base,now:'2026-04-11T08:00:00Z'}))
assert.equal(replace({...base,now:'2026-04-11T07:59:59Z'}).creditSom,833)
console.log('calendar_billing_ok')

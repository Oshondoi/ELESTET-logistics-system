// Called only by the loopback-only schema clone harness.
import assert from 'node:assert/strict';
export async function runFbsNetStockRace({sql,asUser,user,company}) {
 const u=await user(), a=await company(u,'FBS race fixture');
 const one=async(q,p)=>(await sql(q,p)).rows[0].id;
 const s=await one("insert into stores(account_id,store_code,name) values($1,'fbs-race','Race') returning id",[a]);
 const w=await one("insert into wms_warehouses(account_id,name,fbs_enabled) values($1,'Race',true) returning id",[a]);
 const batch=await one("insert into fulfillment_batches(account_id,store_id,name,wms_warehouse_id) values($1,$2,'Race',$3) returning id",[a,s,w]);
 const supply=await one("insert into fulfillment_supplies(account_id,batch_id,warehouse_name,supply_number) values($1,$2,'Race',1) returning id",[a,batch]);
 const box=await one("insert into fulfillment_boxes(account_id,supply_id,box_number,barcode) values($1,$2,1,'RACE-BOX') returning id",[a,supply]);
 const item=await one("insert into fulfillment_box_items(account_id,box_id,barcode,qty) values($1,$2,'2052797745525',1) returning id",[a,box]);
 for(let i=0;i<8;i++)await sql("insert into fbs_orders(account_id,store_id,wb_order_id,supplier_status,wb_system_status,skus) values($1,$2,$3,'confirm','waiting','[\"2052797745525\"]')",[a,s,`race-${i}`]);
 const results=await Promise.allSettled(Array.from({length:8},(_,i)=>asUser(u,c=>c.query('select reserve_fbs_order_from_box($1,$2,$3)',[s,`race-${i}`,box]))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'exactly one order takes the last unit');
 for(const r of results.filter(r=>r.status==='rejected')){
  assert.equal(r.reason.code,'P0001','business rejection, not deadlock or timeout');
 }
 assert.equal((await sql('select qty from fulfillment_box_items where id=$1',[item])).rows[0].qty,0);
 assert.equal((await sql("select count(*)::integer n from fbs_stock_allocations where box_item_id=$1 and status='reserved'",[item])).rows[0].n,1);
 console.log('fbs_net_stock_race_passed: 8 orders / last unit / one allocation / no negative stock');
}

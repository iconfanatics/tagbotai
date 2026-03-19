import db from './app/db.server';
async function run() {
  const store = await db.store.findFirst({ where: { klaviyoIsActive: true } });
  if (!store) { console.log("No active store"); return; }
  console.log("Sync Message:", store.syncMessage);
  
  const rules = await db.rule.findMany({ where: { storeId: store.id } });
  console.log("Rules target tags:", rules.map(r => r.targetTag));
  
  const customers = await db.customer.findMany({ where: { storeId: store.id, email: { not: null } } });
  console.log(`Found ${customers.length} customers with email`);
  console.log("Sample customer tags:", customers.slice(0,3).map(c => c.tags));
}
run();

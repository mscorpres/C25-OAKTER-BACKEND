// Backup restore: repairQcaMfgRates.js --apply se badli values wapas purani karo.
// Input: repairQcaMfgRates_applied_<timestamp>.json (usme har field ka old/new value hai)
//
// Safety: koi field tabhi restore hoti hai jab DB me abhi bhi wahi "new" value ho jo repair ne likhi thi.
// Agar baad me kisi ne us row ko badla hai to wo row skip hoti hai aur report me dikhti hai.
//
// Run (dry run):  node scripts/restoreQcaMfgRates.js scripts/repairQcaMfgRates_applied_XXXX.json
// Restore karo:   node scripts/restoreQcaMfgRates.js scripts/repairQcaMfgRates_applied_XXXX.json --apply
const fs = require("fs");
const { invtDB } = require("../config/db/connection.js");

const APPLY = process.argv.includes("--apply");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: node scripts/restoreQcaMfgRates.js <repairQcaMfgRates_applied_*.json> [--apply]");
  process.exit(1);
}

// Sirf yahi table/field restore ho sakti hain (JSON se SQL injection na ho)
const ALLOWED = {
  rm_location: ["in_po_rate"],
  mfg_production_2: ["in_fg_rate"],
  mfg_production_3: ["in_fg_rate"],
};
const same = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= 1e-6;

(async () => {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data.apply) console.log("NOTE: ye dry-run ki file hai — isme ki changes DB me kabhi save nahi hui thi.");
  const changes = data.changes || [];
  console.log(`Changes in file: ${changes.length}  (mode: ${APPLY ? "APPLY" : "DRY RUN"})`);

  const t = await invtDB.transaction();
  let restored = 0;
  const skipped = [];
  try {
    for (const c of changes) {
      if (!ALLOWED[c.table] || !ALLOWED[c.table].includes(c.field) || !Number.isInteger(Number(c.ID))) {
        skipped.push({ ...c, reason: "table/field not allowed" });
        continue;
      }
      const cur = await invtDB.query(`SELECT ${c.field} AS v FROM ${c.table} WHERE ID = :id FOR UPDATE`, {
        replacements: { id: c.ID }, type: invtDB.QueryTypes.SELECT, logging: false, transaction: t,
      });
      if (!cur.length) { skipped.push({ ...c, reason: "row not found" }); continue; }
      if (!same(cur[0].v, c.new)) { skipped.push({ ...c, current: cur[0].v, reason: "value changed after repair" }); continue; }

      await invtDB.query(`UPDATE ${c.table} SET ${c.field} = :old WHERE ID = :id`, {
        replacements: { old: c.old, id: c.ID }, type: invtDB.QueryTypes.UPDATE, logging: false, transaction: t,
      });
      restored++;
    }

    console.log(`Restorable: ${restored}   Skipped: ${skipped.length}`);
    if (skipped.length) console.table(skipped.slice(0, 50));

    if (APPLY) { await t.commit(); console.log("RESTORE COMMITTED."); }
    else { await t.rollback(); console.log("DRY RUN — kuch restore nahi hua. Restore ke liye --apply lagao."); }
    process.exit(0);
  } catch (e) {
    await t.rollback();
    console.error("FAILED, rollback:", e);
    process.exit(1);
  }
})();

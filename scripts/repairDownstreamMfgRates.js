// One-time fix (repairQcaMfgRates.js ke baad): jin normal MFG entries (executePPR) me
// QCA wale SFG components (jaise SFG283) consume hue, unke saved rates theek karo.
//
// QCA repair se SFG component ka IN-QCA rate badla → uska WAR badla. Ye script:
//  - un MFG entries ki har CONSUMPTION row ka WAR us row tak dobara nikalti hai → in_po_rate
//  - mfg_production_2.in_fg_rate (type C) = Σ(qty × WAR, RFP chhod ke) / mfg qty   (executePPR jaisa)
//  - mfg_production_3.in_fg_rate (type IN): --fg-in-rfp=exclude → RFP chhod ke
//                                           --fg-in-rfp=include → RFP ke saath (purana fgin logic)
// Sirf wahi MFG liye jaate hain jinme SFG component ka saved rate naye WAR se alag hai.
//
// Scope: sirf wo SFG components jinke IN-QCA rate QCA repair (--qca=<applied json>) me badle,
// aur sirf us date ke baad ki MFG entries.
//
// Dry run:  node scripts/repairDownstreamMfgRates.js --qca=scripts/repairQcaMfgRates_applied_XXXX.json --fg-in-rfp=exclude
// Apply:    node scripts/repairDownstreamMfgRates.js --qca=scripts/repairQcaMfgRates_applied_XXXX.json --fg-in-rfp=exclude --apply
// Restore:  node scripts/restoreQcaMfgRates.js scripts/repairDownstreamMfgRates_applied_XXXX.json --apply
const fs = require("fs");
const path = require("path");
const { invtDB } = require("../config/db/connection.js");
const { newWeightedAverageRate, isRFPComponent } = require("../helper/utils/newAvgRate");

const APPLY = process.argv.includes("--apply");
const MODE = (process.argv.find((a) => a.startsWith("--fg-in-rfp=")) || "").split("=")[1];
if (!["exclude", "include"].includes(MODE)) {
  console.error("--fg-in-rfp=exclude ya --fg-in-rfp=include dena zaroori hai");
  process.exit(1);
}
const QCA_PATH = (process.argv.find((a) => a.startsWith("--qca=")) || "").slice(6);
if (!QCA_PATH || !fs.existsSync(QCA_PATH)) {
  console.error("--qca=<repairQcaMfgRates_applied_*.json> dena zaroori hai");
  process.exit(1);
}
const QCA_FILE = JSON.parse(fs.readFileSync(QCA_PATH, "utf8"));
if (!QCA_FILE.apply) {
  console.error("--qca file applied wali honi chahiye, dry-run wali nahi");
  process.exit(1);
}
const BRANCH = "BROAKTRC25";
const EPS = 1e-6;
const MIN_DIFF = 0.01; // SFG component ka saved rate naye WAR se itna alag ho tabhi MFG lo

const r = (n) => Number((Number(n) || 0).toFixed(4));
const changed = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > EPS;

(async () => {
  const t = await invtDB.transaction();
  const q = (sql, rep = {}) => invtDB.query(sql, { replacements: rep, type: invtDB.QueryTypes.SELECT, logging: false, transaction: t });
  const u = (sql, rep = {}) => invtDB.query(sql, { replacements: rep, type: invtDB.QueryTypes.UPDATE, logging: false, transaction: t });

  const backup = [];
  const summary = [];
  let updates = 0;

  try {
    // QCA repair me jin SFG components ke IN-QCA rate sach me badle — wahi aur usi date ke baad
    const qcaChangedIds = (QCA_FILE.changes || []).filter((c) => c.table === "rm_location").map((c) => Number(c.ID));
    const changedIn = await q(
      `SELECT components_id, MIN(insert_date) AS since FROM rm_location
       WHERE ID IN (:ids) AND in_module = 'IN-QCA'
       GROUP BY components_id`,
      { ids: qcaChangedIds.length ? qcaChangedIds : [0] },
    );
    if (!changedIn.length) {
      console.log("QCA repair me kisi SFG IN-QCA rate ka change nahi mila — kuch karne ko nahi.");
      await t.rollback();
      process.exit(0);
    }
    console.log(`SFG components (IN-QCA rate badla): ${changedIn.map((x) => `${x.components_id} since ${x.since}`).join(", ")}`);
    console.log(`(mode: ${APPLY ? "APPLY" : "DRY RUN"}, FG IN rate RFP: ${MODE})`);

    // Normal (non-QCA) MFG entries jinme ye components us date ke baad consume hue
    let candidates = [];
    for (const { components_id, since } of changedIn) {
      candidates = candidates.concat(
        await q(
          `SELECT rm.ID, rm.mfg_ppr_trans_id_2 AS mfg, rm.components_id, rm.in_po_rate, rm.insert_date
           FROM rm_location rm
           JOIN mfg_production_2 p2 ON p2.mfg_transaction = rm.mfg_ppr_trans_id_2 AND p2.mfg_prod_type = 'C'
           WHERE rm.trans_type = 'CONSUMPTION' AND rm.components_id = :comp AND rm.insert_date >= :since
             AND (p2.from_module IS NULL OR p2.from_module <> 'QCA')`,
          { comp: components_id, since },
        ),
      );
    }
    candidates.sort((a, b) => String(a.insert_date).localeCompare(String(b.insert_date)) || a.ID - b.ID);
    const targetMfgs = [];
    for (const c of candidates) {
      const war = await newWeightedAverageRate(c.components_id, c.insert_date, c.ID, false, invtDB, t);
      if (Math.abs((Number(c.in_po_rate) || 0) - war) > MIN_DIFF && !targetMfgs.includes(c.mfg)) targetMfgs.push(c.mfg);
    }
    console.log(`SFG consumption rows: ${candidates.length}, MFG entries jinke rate badlenge: ${targetMfgs.length}\n`);

    for (const mfgNo of targetMfgs) {
      const p2 = (
        await q(
          `SELECT ID, mfg_sku, mfg_prod_planing_qty, in_fg_rate, mfg_full_date FROM mfg_production_2
           WHERE mfg_transaction = :m AND mfg_prod_type = 'C' AND company_branch = :branch LIMIT 1`,
          { m: mfgNo, branch: BRANCH },
        )
      )[0];
      const mfgQty = Number(p2?.mfg_prod_planing_qty) || 0;
      if (!p2 || mfgQty <= 0) {
        summary.push({ mfg: mfgNo, note: "mfg_production_2 row/qty nahi mila — skipped" });
        continue;
      }

      const cons = await q(
        `SELECT rm.ID, rm.components_id, rm.qty, rm.in_po_rate, rm.insert_date, c.c_part_no, c.c_new_part_no, c.c_name
         FROM rm_location rm LEFT JOIN components c ON c.component_key = rm.components_id
         WHERE rm.mfg_ppr_trans_id_2 = :m AND rm.trans_type = 'CONSUMPTION'
         ORDER BY rm.ID ASC`,
        { m: mfgNo },
      );

      let valueExcl = 0;
      let valueRfp = 0;
      const changedComponents = [];
      for (const row of cons) {
        const war = await newWeightedAverageRate(row.components_id, row.insert_date, row.ID, false, invtDB, t);
        const value = (Number(row.qty) || 0) * war;
        const rfp = isRFPComponent(row.c_new_part_no);
        if (rfp) valueRfp += value;
        else valueExcl += value;

        if (changed(row.in_po_rate, war)) {
          changedComponents.push({
            partcode: row.c_part_no,
            new_partno: row.c_new_part_no,
            component: row.c_name,
            cons_qty: Number(row.qty) || 0,
            old_saved_rate: r(row.in_po_rate),
            new_rate_WAR: r(war),
            in_fg_rate: rfp ? "NO (RFP)" : "YES",
          });
          backup.push({ table: "rm_location", ID: row.ID, field: "in_po_rate", old: row.in_po_rate, new: war });
          await u("UPDATE rm_location SET in_po_rate = :rate WHERE ID = :id", { rate: war, id: row.ID });
          updates++;
        }
      }
      const rateExcl = valueExcl / mfgQty;
      const rateIncl = (valueExcl + valueRfp) / mfgQty;
      const p3Rate = MODE === "exclude" ? rateExcl : rateIncl;

      if (changed(p2.in_fg_rate, rateExcl)) {
        backup.push({ table: "mfg_production_2", ID: p2.ID, field: "in_fg_rate", old: p2.in_fg_rate, new: rateExcl });
        await u("UPDATE mfg_production_2 SET in_fg_rate = :rate WHERE ID = :id", { rate: rateExcl, id: p2.ID });
        updates++;
      }

      const p3 = await q(
        `SELECT ID, in_fg_rate, mfg_pro_apr_transaction FROM mfg_production_3
         WHERE mfg_ref_transid_2 = :m AND type = 'IN' AND company_branch = :branch`,
        { m: mfgNo, branch: BRANCH },
      );
      for (const row of p3) {
        if (changed(row.in_fg_rate, p3Rate)) {
          backup.push({ table: "mfg_production_3", ID: row.ID, field: "in_fg_rate", old: row.in_fg_rate, new: p3Rate });
          await u("UPDATE mfg_production_3 SET in_fg_rate = :rate WHERE ID = :id", { rate: p3Rate, id: row.ID });
          updates++;
        }
      }

      console.log(`${mfgNo}  |  SKU ${p2.mfg_sku}  |  qty ${mfgQty}  |  ${p2.mfg_full_date}`);
      if (changedComponents.length) console.table(changedComponents);
      console.log(
        `  MFG rate (p2): ${r(p2.in_fg_rate)} → ${r(rateExcl)}   |   FG IN rate (p3): ${p3.map((x) => r(x.in_fg_rate)).join(", ") || "-"} → ${r(p3Rate)}   (RFP ke saath ${r(rateIncl)})\n`,
      );

      summary.push({
        mfg: mfgNo,
        sku: p2.mfg_sku,
        qty: mfgQty,
        old_p2_rate: r(p2.in_fg_rate),
        new_p2_rate: r(rateExcl),
        old_p3_rate: p3.map((x) => r(x.in_fg_rate)).join(", ") || "-",
        new_p3_RFP_excluded: r(rateExcl),
        new_p3_RFP_included: r(rateIncl),
        fg_in: p3.map((x) => x.mfg_pro_apr_transaction).join(", ") || "-",
        components: changedComponents,
      });
    }

    console.log("===== SUMMARY =====");
    console.table(summary.map(({ components, ...s }) => s));
    console.log(`\nTotal field updates: ${updates}`);

    const reportFile = path.join(__dirname, `repairDownstreamMfgRates_${APPLY ? "applied" : "dryrun"}_${Date.now()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify({ apply: APPLY, mode: MODE, summary, changes: backup }, null, 2));
    console.log(`Old/new values saved: ${reportFile}`);

    if (APPLY) {
      await t.commit();
      console.log("COMMITTED.");
    } else {
      await t.rollback();
      console.log("DRY RUN — rollback, DB me kuch save nahi hua. Save karne ke liye --apply lagao.");
    }
    process.exit(0);
  } catch (e) {
    await t.rollback();
    console.error("FAILED, rollback:", e);
    process.exit(1);
  }
})();

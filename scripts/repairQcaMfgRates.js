// One-time fix: QCA lot_transfer se bane MFG entries ke rates theek karo.
//
// Bug (create_qca_process.js /lot_transfer):
//  1. CONSUMPTION rows ke in_po_rate me component ka WAR nahi, running SFG total save hota tha
//  2. mfg_production_2 / mfg_production_3 ka in_fg_rate 0 reh jata tha
//  3. SFG rate me refurb (RFP) components bhi count ho rahe the
//
// Ye script har QCA MFG (purane se naye order me) ke liye:
//  - har CONSUMPTION row ka WAR us row tak dobara nikalta hai → in_po_rate
//  - SFG rate = Σ(qty × WAR, RFP chhod ke) / lot_qty
//  - wahi rate IN-QCA inward + IN-TRN auto transfer rows + mfg_production_2/3.in_fg_rate me
// Sab ek DB transaction me hota hai, isliye baad wale MFG ka WAR pehle wale ke sahi rate se banta hai.
//
// Run (dry run, kuch save nahi hota):  node scripts/repairQcaMfgRates.js
// Sirf ek MFG:                         node scripts/repairQcaMfgRates.js --mfg=MFG/C25/26-27/0402
// DB me likhne ke liye:                 node scripts/repairQcaMfgRates.js --apply
const fs = require("fs");
const path = require("path");
const { invtDB } = require("../config/db/connection.js");
const { newWeightedAverageRate, isRFPComponent } = require("../helper/utils/newAvgRate");

const APPLY = process.argv.includes("--apply");
const ONLY_MFG = (process.argv.find((a) => a.startsWith("--mfg=")) || "").slice(6) || null;
const BRANCH = "BROAKTRC25";
const EPS = 1e-6;

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
    const mfgs = await q(
      `SELECT ID, mfg_transaction, mfg_sku, mfg_prod_planing_qty, in_fg_rate, mfg_full_date
       FROM mfg_production_2
       WHERE from_module = 'QCA' AND company_branch = :branch AND mfg_prod_type = 'C'
       ${ONLY_MFG ? "AND mfg_transaction = :mfg" : ""}
       ORDER BY mfg_full_date ASC, ID ASC`,
      { branch: BRANCH, mfg: ONLY_MFG },
    );
    console.log(`QCA MFG entries: ${mfgs.length}  (mode: ${APPLY ? "APPLY" : "DRY RUN"})\n`);

    for (const mfg of mfgs) {
      const lotQty = Number(mfg.mfg_prod_planing_qty) || 0;
      const cons = await q(
        `SELECT rm.ID, rm.components_id, rm.qty, rm.in_po_rate, rm.insert_date, c.c_part_no, c.c_new_part_no, c.c_name
         FROM rm_location rm LEFT JOIN components c ON c.component_key = rm.components_id
         WHERE rm.mfg_ppr_trans_id_2 = :mfg AND rm.trans_type = 'CONSUMPTION'
         ORDER BY rm.ID ASC`,
        { mfg: mfg.mfg_transaction },
      );
      if (!cons.length || lotQty <= 0) {
        summary.push({ mfg: mfg.mfg_transaction, note: "no consumption rows — skipped" });
        continue;
      }

      // 1. Consumption rows — component ka WAR us row tak
      let totalValue = 0;
      let rfpValue = 0;
      const components = [];
      for (const row of cons) {
        const war = await newWeightedAverageRate(row.components_id, row.insert_date, row.ID, false, invtDB, t);
        const value = (Number(row.qty) || 0) * war;
        const rfp = isRFPComponent(row.c_new_part_no);
        if (rfp) rfpValue += value;
        else totalValue += value;
        components.push({
          row_id: row.ID,
          partcode: row.c_part_no,
          new_partno: row.c_new_part_no,
          component: row.c_name,
          cons_qty: Number(row.qty) || 0,
          old_saved_rate: r(row.in_po_rate),
          new_rate_WAR: r(war),
          value: r(value),
          in_sfg_rate: rfp ? "NO (RFP)" : "YES",
        });

        if (changed(row.in_po_rate, war)) {
          backup.push({ table: "rm_location", ID: row.ID, field: "in_po_rate", old: row.in_po_rate, new: war });
          await u("UPDATE rm_location SET in_po_rate = :rate WHERE ID = :id", { rate: war, id: row.ID });
          updates++;
        }
      }
      const sfgRate = totalValue / lotQty;
      const oldSfgRate = (totalValue + rfpValue) / lotQty; // purana logic (RFP ke saath)

      // 2. SFG inward (IN-QCA) + auto transfer (IN-TRN) — usi transaction me consumption ke turant baad bani rows
      const lastConsID = cons[cons.length - 1].ID;
      const mapped = await q("SELECT sfg_mapped_rm FROM bom_recipe WHERE bom_product_sku = :sku LIMIT 1", { sku: mfg.mfg_sku });
      const sfgComp = mapped[0]?.sfg_mapped_rm || null;

      const qcaRow = (
        await q(
          `SELECT ID, components_id, in_po_rate FROM rm_location
           WHERE in_module = 'IN-QCA' AND any_remark = 'Process MIN' AND qty = :qty
             AND ID > :lastID AND ID <= :lastID + 10
             ${sfgComp ? "AND components_id = :comp" : ""}
           ORDER BY ID ASC LIMIT 1`,
          { qty: lotQty, lastID: lastConsID, comp: sfgComp },
        )
      )[0];
      const trnRow = qcaRow
        ? (
            await q(
              `SELECT ID, in_po_rate FROM rm_location
               WHERE in_module = 'IN-TRN' AND trans_type = 'TRANSFER' AND any_remark = 'Auto Transfer'
                 AND components_id = :comp AND qty = :qty AND ID > :qcaID AND ID <= :qcaID + 5
               ORDER BY ID ASC LIMIT 1`,
              { comp: qcaRow.components_id, qty: lotQty, qcaID: qcaRow.ID },
            )
          )[0]
        : null;

      for (const row of [qcaRow, trnRow].filter(Boolean)) {
        if (changed(row.in_po_rate, sfgRate)) {
          backup.push({ table: "rm_location", ID: row.ID, field: "in_po_rate", old: row.in_po_rate, new: sfgRate });
          await u("UPDATE rm_location SET in_po_rate = :rate WHERE ID = :id", { rate: sfgRate, id: row.ID });
          updates++;
        }
      }

      // 3. mfg_production_2 / mfg_production_3 in_fg_rate
      if (changed(mfg.in_fg_rate, sfgRate)) {
        backup.push({ table: "mfg_production_2", ID: mfg.ID, field: "in_fg_rate", old: mfg.in_fg_rate, new: sfgRate });
        await u("UPDATE mfg_production_2 SET in_fg_rate = :rate WHERE ID = :id", { rate: sfgRate, id: mfg.ID });
        updates++;
      }
      const p3 = await q("SELECT ID, in_fg_rate FROM mfg_production_3 WHERE mfg_ref_transid_2 = :mfg AND type = 'IN' AND company_branch = :branch", {
        mfg: mfg.mfg_transaction,
        branch: BRANCH,
      });
      for (const row of p3) {
        if (changed(row.in_fg_rate, sfgRate)) {
          backup.push({ table: "mfg_production_3", ID: row.ID, field: "in_fg_rate", old: row.in_fg_rate, new: sfgRate });
          await u("UPDATE mfg_production_3 SET in_fg_rate = :rate WHERE ID = :id", { rate: sfgRate, id: row.ID });
          updates++;
        }
      }

      summary.push({
        mfg: mfg.mfg_transaction,
        date: mfg.mfg_full_date,
        sku: mfg.mfg_sku,
        qty: lotQty,
        old_inQCA_rate: qcaRow ? r(qcaRow.in_po_rate) : "-",
        with_RFP: r(oldSfgRate),
        new_rate_RFP_excluded: r(sfgRate),
        inQCA_row: qcaRow ? qcaRow.ID : "NOT FOUND",
        trn_row: trnRow ? trnRow.ID : "NOT FOUND",
        components,
      });
    }

    // Har MFG ke components ka detail
    for (const s of summary) {
      if (!s.components) continue;
      console.log(`\n${s.mfg}  |  ${s.sku}  |  qty ${s.qty}  |  ${s.date}`);
      console.table(s.components.map(({ row_id, ...c }) => c));
      console.log(`  SFG rate: purana saved ${s.old_inQCA_rate}  |  RFP ke saath ${s.with_RFP}  |  NAYA (RFP chhod ke) ${s.new_rate_RFP_excluded}`);
    }

    console.log("\n===== SUMMARY =====");
    console.table(summary.map(({ components, ...s }) => s));
    console.log(`\nTotal field updates: ${updates}`);
    const notFound = summary.filter((s) => s.inQCA_row === "NOT FOUND" || s.trn_row === "NOT FOUND");
    if (notFound.length) console.log(`WARNING: ${notFound.length} MFG ke IN-QCA/IN-TRN rows match nahi hue — unke sirf consumption + in_fg_rate update honge.`);

    const reportFile = path.join(__dirname, `repairQcaMfgRates_${APPLY ? "applied" : "dryrun"}_${Date.now()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify({ apply: APPLY, summary, changes: backup }, null, 2));
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

let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

//Required Passing Parameters:

//1.  date
checkNegativeValue = (value) => {
	return value < 0 ? -1 * value : value;
};

const FG_ALLOTTED_LOC_KEY = "2026023151444723";
 
router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    const date = String(req.body.date || "").match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    if (!date || date.length < 2) {
      return res.json({
        status: "error",
        success: false,
        message: "Please supply a valid date range (DD-MM-YYYY)",
      });
    }
 
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
    const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
    if (durationInMonths > 3) {
      return res.json({
        status: "error",
        success: false,
        message: "On the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only.",
      });
    }
 
    // ---------- Allotted FG locations ----------
    const stmt_loc = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: FG_ALLOTTED_LOC_KEY },
        type: invtDB.QueryTypes.SELECT,
      }
    );
 
    if (!stmt_loc.length || !stmt_loc[0].locations) {
      return res.json({
        status: "error",
        success: false,
        message: "No FG locations allotted for this key",
      });
    }
 
    // string to array ("k1,k2,k3" -> ["k1","k2","k3"])
    const loc_ids = [
      ...new Set(
        String(stmt_loc[0].locations)
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v && v !== "--")
      ),
    ];
 
    // keep only ACTIVE locations (same check as the location dropdown API)
    const activeLocRows = loc_ids.length
      ? await invtDB.query(
          "SELECT `location_key`, `loc_name` FROM `location_main` WHERE `location_key` IN (:loc_ids) AND `loc_status` = 'ACTIVE'",
          { replacements: { loc_ids }, type: invtDB.QueryTypes.SELECT }
        )
      : [];
    const locations = activeLocRows.map((r) => String(r.location_key));
 
    if (!locations.length) {
      return res.json({
        status: "error",
        success: false,
        message: "No active FG locations found for this key",
      });
    }
 
    const products = await invtDB.query(
      "SELECT * FROM `products` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE products_type = 'default' ORDER BY `products`.`p_name` ASC",
      { type: invtDB.QueryTypes.SELECT }
    );
 
    const repl = { date1: fromdate, date2: todate, branch: req.branch, locs: locations };
 
    // ---------- CREDIT: IN / FGMIN / TRANSFER (in) into allotted locations (keyed by SKU) ----------
    const creditRows = await invtDB.query(
      `SELECT
        \`mfg_pro_apr_sku\` AS sku,
        COALESCE(SUM(CASE WHEN DATE(\`mfg_pro_apr_fulldate\`) BETWEEN :date1 AND :date2 THEN \`mfg_approve_in_qty\` ELSE 0 END),0) AS totalIN,
        COALESCE(SUM(CASE WHEN DATE(\`mfg_pro_apr_fulldate\`) < :date1 THEN \`mfg_approve_in_qty\` ELSE 0 END),0) AS totalOP_in
      FROM \`mfg_production_3\`
      WHERE \`fg_status\` = 'ACTIVE'
        AND \`company_branch\` = :branch
        AND \`type\` IN ('IN', 'FGMIN', 'TRANSFER')
        AND \`mfg_pro_location_in\` IN (:locs)
      GROUP BY \`mfg_pro_apr_sku\``,
      { replacements: repl, type: invtDB.QueryTypes.SELECT }
    );
    const creditMap = new Map(creditRows.map((r) => [r.sku, r]));
 
    // ---------- DEBIT: OUT from allotted locations (includes transfer OUT leg) (keyed by product_key) ----------
    const debitRows = await invtDB.query(
      `SELECT
        \`fgout_pro_apr_sku\` AS product_key,
        COALESCE(SUM(CASE WHEN DATE(\`fgout_pro_apr_date\`) BETWEEN :date1 AND :date2 THEN \`fgout_approve_out_qty\` ELSE 0 END),0) AS totalOut,
        COALESCE(SUM(CASE WHEN DATE(\`fgout_pro_apr_date\`) < :date1 THEN \`fgout_approve_out_qty\` ELSE 0 END),0) AS totalOP_out
      FROM \`mfg_production_3\`
      WHERE \`fg_status\` = 'ACTIVE'
        AND \`company_branch\` = :branch
        AND \`type\` = 'OUT'
        AND \`fgout_pro_location_out\` IN (:locs)
      GROUP BY \`fgout_pro_apr_sku\``,
      { replacements: repl, type: invtDB.QueryTypes.SELECT }
    );
    const debitMap = new Map(debitRows.map((r) => [r.product_key, r]));
 
    // ---------- DEBIT: FG RETURN EXECUTE (TRANSFER row with loc_in '--', consumed from allotted location) (keyed by SKU) ----------
    const revRows = await invtDB.query(
      `SELECT
        \`mfg_pro_apr_sku\` AS sku,
        COALESCE(SUM(CASE WHEN DATE(\`mfg_pro_apr_fulldate\`) BETWEEN :date1 AND :date2 THEN \`mfg_approve_in_qty\` ELSE 0 END),0) AS revOut,
        COALESCE(SUM(CASE WHEN DATE(\`mfg_pro_apr_fulldate\`) < :date1 THEN \`mfg_approve_in_qty\` ELSE 0 END),0) AS revOP
      FROM \`mfg_production_3\`
      WHERE \`fg_status\` = 'ACTIVE'
        AND \`company_branch\` = :branch
        AND \`type\` = 'TRANSFER'
        AND \`mfg_pro_location_in\` = '--'
        AND \`fgout_pro_location_out\` IN (:locs)
      GROUP BY \`mfg_pro_apr_sku\``,
      { replacements: repl, type: invtDB.QueryTypes.SELECT }
    );
    const revMap = new Map(revRows.map((r) => [r.sku, r]));
 
    // ---------- PPR ----------
    const pprRows = await invtDB.query(
      "SELECT `prod_product_sku` AS sku, COALESCE(SUM(`prod_planned_qty`), 0) AS totalReqPPRQTY, COALESCE(SUM(`prod_executed_qty`), 0) AS prod_executed_qty FROM `mfg_production_1` WHERE `phase1_status` = 'A' AND `prod_branch` = :branch GROUP BY `prod_product_sku`",
      { replacements: { branch: req.branch }, type: invtDB.QueryTypes.SELECT }
    );
    const pprMap = new Map(pprRows.map((r) => [r.sku, r]));
 
    const data = products.map((item) => {
      const cr = creditMap.get(item.p_sku) || {};
      const dr = debitMap.get(item.product_key) || {};
      const rv = revMap.get(item.p_sku) || {};
 
      const totalIn = Number(cr.totalIN) || 0;
      const totalOut = (Number(dr.totalOut) || 0) + (Number(rv.revOut) || 0);
 
      const openIn = Number(cr.totalOP_in) || 0;
      const openOut = (Number(dr.totalOP_out) || 0) + (Number(rv.revOP) || 0);
      const openBal = helper.number(openIn - openOut);
 
      const closeBal = helper.number(Number(openBal) + totalIn - totalOut);
 
      let replenishment;
      if (closeBal < item.p_min_stock) {
        replenishment = checkNegativeValue(item.p_min_stock - closeBal);
      } else {
        replenishment = "00";
      }
 
      const ppr = pprMap.get(item.p_sku);
      const totalRequestQTY = ppr ? Number(ppr.totalReqPPRQTY) || 0 : 0;
      const totalAccept4Consumption = ppr ? Number(ppr.prod_executed_qty) || 0 : 0;
      const eqp = totalRequestQTY - totalAccept4Consumption;
 
      let fg_type;
      if (item.products_type == "default") {
        fg_type = "FG";
      } else if (item.products_type == "semi") {
        fg_type = "SEMI FG";
      } else {
        fg_type = "N/A";
      }
 
      return {
        totalOB: "--",
        totalClosingh: "--",
        totalIn: "--",
        totalOut: "--",
        sku: item.p_sku,
        product: item.p_name,
        openBal: openBal,
        debitBal: totalOut,
        creditBal: totalIn,
        closingBal: closeBal,
        unit: item.units_name,
        replenishment: replenishment,
        minqty: item.p_min_stock,
        batchqty: item.p_batch_qty,
        eqp: eqp,
        fgtype: fg_type,
      };
    });
 
    return res.json({
      status: "success",
      success: true,
      data: data,
    });
  } catch (error) {
    res.json({
      status: "error",
      code: 500,
      message: "Internal Error<br/>If this condition persists, contact your system administrator",
      error: error.stack,
    });
    return;
  }
});
module.exports = router;

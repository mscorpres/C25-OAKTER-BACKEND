let { invtDB } = require("../../../config/db/connection");



const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const helper = require("../../../helper/helper");
const avgRate = require("../../../helper/utils/avgRate");

const {
  newWeightedAverageRate,
  calculateFGRate,
} = require("../../../helper/utils/newAvgRate");
const {
  fgWeightedAverageRate,
} = require("../../../helper/utils/newFGavgRate");
const Validator = require("validatorjs");
checkNegativeValue = (value) => {
  return value < 0 ? 0 : value.toFixed(2);
};

function byDate(a, b) {
  let d1 = new Date(moment(a.date, "DD-MM-YYYY HH:mm:ss"));
  let d2 = new Date(moment(b.date, "DD-MM-YYYY HH:mm:ss"));
  return d2 - d1;
}

router.get("/location", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: "2026023151444723" },
        type: invtDB.QueryTypes.SELECT,
      },
    );
    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    for (let i = 0; i < loc_ids.length; i++) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: loc_ids[i] },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      stmt2.forEach((element) => {
        locations.push({ id: element.location_key, text: element.loc_name });
      });

      if (i == loc_ids.length - 1) {
        return res.json({ success: true, status: "success", data: locations });
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.get("/", async (req, res) => {
  try {
    let data = [];
    let IN = "IN";
    let OUT = "OUT";
    let NEUTRAL = "NEUTRAL";
    let CANCELLEND = "CANCELLEND";

    // FG RETURN EXECUTE rows = TRANSFER rows with no "location in" (created by /executeFG_reversal).
    // They consume stock from fgout_pro_location_out, so they must be treated as OUT.
    const REV = "(`type` = 'TRANSFER' AND `mfg_pro_location_in` = '--')";

    if (!req.query.sku || req.query.sku == "") {
      res.json({
        status: "error",
        message: "Please supply product sku code",
        success: false,
      });
      return;
    }

    if (req.query.date && String(req.query.date).trim() !== "") {
      const dates = String(req.query.date)
        .trim()
        .match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      if (dates && dates.length === 2) {
        const startM = moment(dates[0], "DD-MM-YYYY");
        const endM = moment(dates[1], "DD-MM-YYYY");
        if (startM.isValid() && endM.isValid()) {
          req.query.start = startM.format("YYYY-MM-DD");
          req.query.end = endM.format("YYYY-MM-DD");
        }
      }
    }

    {
      let stmt1 = await invtDB.query(
        "SELECT * FROM `products` LEFT JOIN `units` ON `units`.`units_id` = `products`.`p_uom` WHERE `products`.`product_key` = :product_key",
        {
          replacements: { product_key: req.query.sku },
          type: invtDB.QueryTypes.SELECT,
        },
      );
      if (stmt1.length > 0) {
        let whereClause =
          "WHERE (mfg_production_3.mfg_pro_apr_sku = :skucode OR mfg_production_3.fgout_pro_apr_sku = :product_key AND mfg_production_3.fg_status = 'ACTIVE')";
        let replacements = {
          skucode: stmt1[0].p_sku,
          product_key: req.query.sku,
        };

        const hasLocation = req.query.location && req.query.location !== "";
        if (hasLocation) {
          // CHANGE 1: added the FG return execute branch (TRANSFER with loc_in '--' consumed from :location)
          whereClause +=
            " AND ((mfg_production_3.type = 'IN' AND mfg_production_3.mfg_pro_location_in = :location)" +
            " OR (mfg_production_3.type = 'FGMIN' AND mfg_production_3.mfg_pro_location_in = :location)" +
            " OR (mfg_production_3.type = 'TRANSFER' AND mfg_production_3.mfg_pro_location_in = :location)" +
            " OR (mfg_production_3.type = 'TRANSFER' AND mfg_production_3.mfg_pro_location_in = '--' AND mfg_production_3.fgout_pro_location_out = :location)" +
            " OR (mfg_production_3.type = 'OUT' AND mfg_production_3.fgout_pro_location_out = :location AND mfg_production_3.fg_status = 'ACTIVE'))";
          replacements.location = req.query.location;
        }

        const hasDateRange =
          req.query.start &&
          req.query.end &&
          String(req.query.start).trim() !== "" &&
          String(req.query.end).trim() !== "";

        if (hasDateRange) {
          const date1 = moment(req.query.start).format("YYYY-MM-DD");
          const date2 = moment(req.query.end).format("YYYY-MM-DD");
          replacements.date1 = date1;
          replacements.date2 = date2;
          whereClause +=
            " AND (((mfg_production_3.type IN ('IN', 'FGMIN', 'TRANSFER') AND DATE_FORMAT(mfg_production_3.mfg_pro_apr_fulldate,'%Y-%m-%d') BETWEEN :date1 AND :date2) OR (mfg_production_3.type = 'OUT' AND mfg_production_3.fg_status = 'ACTIVE' AND DATE_FORMAT(mfg_production_3.fgout_pro_apr_date,'%Y-%m-%d') BETWEEN :date1 AND :date2)))";
        }

        let queryString = `SELECT
            mfg_production_3.ID AS m3_id,
            mfg_production_3.fg_out_remark,
            mfg_production_3.mfg_ref_transid_1, 
            mfg_production_3.mfg_ref_transid_2, 
            mfg_production_3.mfg_pro_apr_transaction, 
            mfg_production_3.mfg_pro_FGout_transaction, 
            mfg_production_3.type AS transaction_type, 
            mfg_production_3.mfg_pro_apr_fulldate AS in_date, 
            COALESCE(mfg_production_2.mfg_prod_planing_qty, mfg_production_3.mfg_approve_in_qty) AS in_qty,
            mfg_production_3.mfg_pro_location_in,
            mfg_production_3.fgout_pro_location_out,
            mfg_production_3.fg_out_type,
            mfg_production_3.fg_status AS fg_status,
            mfg_production_2.fg_status AS mfg2_fg_status,
            mfg_production_3.in_fg_rate,
            user_inby.user_name AS in_by_user,
            user_outby.user_name AS out_by_user,
            mfg_production_3.fgout_pro_apr_fulldate AS out_date, 
            mfg_production_3.fgout_approve_out_qty AS out_qty,
            loc_in.loc_name AS loc_in_name,
            loc_out.loc_name AS loc_out_name
          FROM mfg_production_3
          LEFT JOIN products ON mfg_production_3.mfg_pro_apr_sku = products.p_sku OR fgout_pro_apr_sku = products.product_key
          LEFT JOIN mfg_production_2 ON mfg_production_3.mfg_ref_transid_2 = mfg_production_2.mfg_transaction AND mfg_production_2.mfg_prod_type = 'C'
          LEFT JOIN admin_login AS user_inby ON user_inby.CustID = mfg_production_3.mfg_pro_apr_by 
          LEFT JOIN admin_login AS user_outby ON user_outby.CustID = mfg_production_3.fgout_pro_apr_by
          LEFT JOIN location_main AS loc_in ON loc_in.location_key = mfg_production_3.mfg_pro_location_in
          LEFT JOIN location_main AS loc_out ON loc_out.location_key = mfg_production_3.fgout_pro_location_out
          ${whereClause}
          ORDER BY mfg_production_3.ID DESC`;

        let stmt2 = await invtDB.query(queryString, {
          replacements: replacements,
          type: invtDB.QueryTypes.SELECT,
        });
        if (stmt2.length > 0 || hasDateRange) {
          let openingQty = 0;
          let creditInRange = 0;
          let debitInRange = 0;

          if (hasDateRange) {
            const date1 = moment(req.query.start).format("YYYY-MM-DD");
            const date2 = moment(req.query.end).format("YYYY-MM-DD");

            const inLocClause = hasLocation
              ? "AND `mfg_pro_location_in` = :location "
              : "";
            const outLocClause = hasLocation
              ? "AND `fgout_pro_location_out` = :location "
              : "AND `fg_out_type` != '--' ";
            const revLocClause = hasLocation
              ? "AND `fgout_pro_location_out` = :location "
              : "";

            // CHANGE 3: reversal rows excluded from IN sums, added as separate OUT sums (revOut / revOP)
            const r5Row = await invtDB.query(
              `SELECT
                COALESCE(SUM(CASE WHEN \`type\` IN ('IN', 'FGMIN', 'TRANSFER') AND NOT ${REV} AND \`mfg_pro_apr_sku\` = :sku ${inLocClause}AND DATE_FORMAT(\`mfg_pro_apr_fulldate\`,'%Y-%m-%d') BETWEEN :date1 AND :date2 THEN \`mfg_approve_in_qty\` ELSE 0 END),0) totalIN,
                COALESCE(SUM(CASE WHEN \`type\` IN ('OUT') ${outLocClause}AND \`fgout_pro_apr_sku\` = :product AND DATE_FORMAT(\`fgout_pro_apr_date\`,'%Y-%m-%d') BETWEEN :date1 AND :date2 THEN \`fgout_approve_out_qty\` ELSE 0 END),0) totalOut,
                COALESCE(SUM(CASE WHEN \`type\` IN ('IN', 'FGMIN', 'TRANSFER') AND NOT ${REV} AND \`mfg_pro_apr_sku\` = :sku ${inLocClause}AND DATE_FORMAT(\`mfg_pro_apr_fulldate\`,'%Y-%m-%d') < :date1 THEN \`mfg_approve_in_qty\` ELSE 0 END),0) totalOP_in,
                COALESCE(SUM(CASE WHEN \`type\` IN ('OUT') ${outLocClause}AND \`fgout_pro_apr_sku\` = :product AND DATE_FORMAT(\`fgout_pro_apr_date\`,'%Y-%m-%d') < :date1 THEN \`fgout_approve_out_qty\` ELSE 0 END),0) totalOP_out,
                COALESCE(SUM(CASE WHEN ${REV} AND \`mfg_pro_apr_sku\` = :sku ${revLocClause}AND DATE_FORMAT(\`mfg_pro_apr_fulldate\`,'%Y-%m-%d') BETWEEN :date1 AND :date2 THEN \`mfg_approve_in_qty\` ELSE 0 END),0) revOut,
                COALESCE(SUM(CASE WHEN ${REV} AND \`mfg_pro_apr_sku\` = :sku ${revLocClause}AND DATE_FORMAT(\`mfg_pro_apr_fulldate\`,'%Y-%m-%d') < :date1 THEN \`mfg_approve_in_qty\` ELSE 0 END),0) revOP
              FROM \`mfg_production_3\` WHERE \`fg_status\` = 'ACTIVE'`,
              {
                replacements: {
                  sku: stmt1[0].p_sku,
                  product: req.query.sku,
                  location: req.query.location,
                  date1,
                  date2,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            );
            if (r5Row.length > 0) {
              const totalIn = Number(r5Row[0].totalIN) || 0;
              const totalOut =
                (Number(r5Row[0].totalOut) || 0) +
                (Number(r5Row[0].revOut) || 0);
              openingQty = helper.number(
                Number(r5Row[0].totalOP_in) -
                  (Number(r5Row[0].totalOP_out) +
                    (Number(r5Row[0].revOP) || 0)),
              );
              creditInRange = totalIn;
              debitInRange = totalOut;
            }
          }

          const openingData = await invtDB.query(
            "SELECT average_rate, closing_qty, total_value FROM tbl_sku_average_rate WHERE sku_key = :productKey",
            {
              replacements: { productKey: req.query.sku },
              type: invtDB.QueryTypes.SELECT,
            },
          );
          if (!hasDateRange && openingData.length > 0) {
            openingQty = openingData[0].closing_qty || 0;
          }

          let lastRate = 0;
          const lastInTransaction = stmt2.find(
            (item) => item.transaction_type === "IN" && item.mfg_ref_transid_2,
          );
          if (lastInTransaction && lastInTransaction.mfg_ref_transid_2) {
            try {
              const lastRateStmt = await invtDB.query(
                "SELECT `in_fg_rate` FROM `mfg_production_2` WHERE `mfg_transaction` = :mfg_transaction AND `mfg_prod_type` = 'C' LIMIT 1",
                {
                  replacements: {
                    mfg_transaction: lastInTransaction.mfg_ref_transid_2,
                  },
                  type: invtDB.QueryTypes.SELECT,
                },
              );
              if (lastRateStmt.length > 0 && lastRateStmt[0].in_fg_rate) {
                lastRate = lastRateStmt[0].in_fg_rate || 0;
              }
            } catch (e) {}
          }
          if (lastRate === 0 && openingData.length > 0) {
            lastRate = openingData[0].average_rate || 0;
          }

          const debitLocClause = hasLocation
            ? "AND `fgout_pro_location_out` = :location "
            : "AND fg_out_type != '--' ";
          let stmt3 = await invtDB.query(
            `SELECT COALESCE(SUM(\`DebitQTY\`),0) as \`DebitBalance\` FROM (SELECT \`fgout_approve_out_qty\` DebitQTY FROM \`mfg_production_3\` WHERE \`fgout_pro_apr_sku\` = :productkey AND type = 'OUT' ${debitLocClause}AND fg_status = 'ACTIVE') t`,
            {
              replacements: {
                productkey: req.query.sku,
                location: req.query.location,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          let debitBal;
          let products;
          if (stmt3.length > 0) {
            debitBal = stmt3[0].DebitBalance || 0;
            products = stmt3[0].p_name + " " + stmt1[0].p_name;
          } else {
            debitBal = 0;
            products = "--";
          }

          // CHANGE 3: FG return execute quantity is a debit
          const stmtRev = await invtDB.query(
            `SELECT COALESCE(SUM(\`mfg_approve_in_qty\`),0) AS revQty
             FROM \`mfg_production_3\`
             WHERE \`mfg_pro_apr_sku\` = :sku AND ${REV} AND fg_status = 'ACTIVE'
             ${hasLocation ? "AND `fgout_pro_location_out` = :location" : ""}`,
            {
              replacements: {
                sku: stmt1[0].p_sku,
                location: req.query.location,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );
          debitBal = Number(debitBal) + Number(stmtRev[0].revQty || 0);

          const creditLocClause = hasLocation
            ? "AND `mfg_pro_location_in` = :location "
            : "";
          // CHANGE 3: reversal rows excluded from credit
          let stmt4 = await invtDB.query(
            `SELECT COALESCE(SUM(\`mfg_approve_in_qty\`),0) AS \`totalQTYinTODAY\` FROM \`mfg_production_3\` WHERE \`mfg_pro_apr_sku\` = :sku AND \`type\` IN('IN', 'FGMIN', 'TRANSFER') AND NOT ${REV} ${creditLocClause}AND fg_status = 'ACTIVE'`,
            {
              replacements: { sku: stmt1[0].p_sku, location: req.query.location },
              type: invtDB.QueryTypes.SELECT,
            },
          );
          let creditBal;
          if (stmt4.length > 0) {
            creditBal = stmt4[0].totalQTYinTODAY || 0;
          } else {
            creditBal = 0;
          }

          const inTransactions = stmt2.filter(
            (item) => item.transaction_type === "IN" && item.mfg_ref_transid_2,
          );
          const mfgTransactionIds = [
            ...new Set(inTransactions.map((item) => item.mfg_ref_transid_2)),
          ];

          let mfgRatesMap = new Map();
          if (mfgTransactionIds.length > 0) {
            const placeholders = mfgTransactionIds
              .map((_, index) => `:mfg_no${index}`)
              .join(", ");
            const replacements = {};
            mfgTransactionIds.forEach((id, index) => {
              replacements[`mfg_no${index}`] = id;
            });

            const batchRateQuery = `
              SELECT mfg_transaction, in_fg_rate 
              FROM mfg_production_2 
              WHERE mfg_transaction IN (${placeholders})
              AND mfg_prod_type = 'C'
            `;

            const rateResults = await invtDB.query(batchRateQuery, {
              replacements: replacements,
              type: invtDB.QueryTypes.SELECT,
            });

            rateResults.forEach((row) => {
              if (row.in_fg_rate) {
                mfgRatesMap.set(row.mfg_transaction, row.in_fg_rate);
              }
            });
          }

          // CHANGE 4 (NEW): destination lookup for OUT rows that are the source leg of a TRANSFER.
          // Done separately so it does not depend on the location filter used for stmt2.
          const outTxnIds = [
            ...new Set(
              stmt2
                .filter(
                  (r) =>
                    r.transaction_type === "OUT" && r.mfg_pro_FGout_transaction,
                )
                .map((r) => r.mfg_pro_FGout_transaction),
            ),
          ];

          const transferDestMap = new Map(); // txn id -> destination location name
          if (outTxnIds.length > 0) {
            const ph = outTxnIds.map((_, i) => `:t${i}`).join(", ");
            const rep = { sku: stmt1[0].p_sku };
            outTxnIds.forEach((id, i) => (rep[`t${i}`] = id));

            const destRows = await invtDB.query(
              `SELECT m.mfg_pro_apr_transaction, l.loc_name
                 FROM mfg_production_3 m
                 LEFT JOIN location_main l ON l.location_key = m.mfg_pro_location_in
                WHERE m.type = 'TRANSFER'
                  AND m.fg_status = 'ACTIVE'
                  AND m.mfg_pro_apr_sku = :sku
                  AND m.mfg_pro_location_in IS NOT NULL
                  AND m.mfg_pro_location_in != '--'
                  AND m.mfg_pro_apr_transaction IN (${ph})`,
              { replacements: rep, type: invtDB.QueryTypes.SELECT },
            );
            destRows.forEach((r) =>
              transferDestMap.set(r.mfg_pro_apr_transaction, r.loc_name),
            );
          }

          // CHANGE 2: reversal rows must not be treated as transfer sources
          const transferSourceTxnIds = new Set(
            stmt2
              .filter(
                (item) =>
                  item.transaction_type === "TRANSFER" &&
                  item.mfg_pro_apr_transaction &&
                  item.mfg_pro_location_in &&
                  item.mfg_pro_location_in !== "--",
              )
              .map((item) => item.mfg_pro_apr_transaction),
          );

          const displayRows = stmt2.filter(
            (item) =>
              !(
                item.transaction_type === "OUT" &&
                item.mfg_pro_FGout_transaction &&
                transferSourceTxnIds.has(item.mfg_pro_FGout_transaction)
              ),
          );

          const transactionPromises = displayRows.map(async (item, index) => {
            let transaction_type;
            let transaction_type_label;
            let transaction_id;
            let transaction_qty;
            let transaction_qty_in = 0;
            let transaction_qty_out = 0;
            let transaction_doneby;
            let transaction_date;
            let rate = item.in_fg_rate || 0;
            let location_in = "--";
            let location_out = "--";
            let mode = "--";
            let weightedSKURate = 0;

            const txDate =
              item.transaction_type == "IN" ||
              item.transaction_type == "FGMIN" ||
              item.transaction_type == "TRANSFER"
                ? item.in_date
                : item.out_date;
            const txDateFormatted = txDate
              ? moment(txDate).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")
              : moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

            // CHANGE 2: detect FG return execute rows
            const isFgReturnExec =
              item.transaction_type == "TRANSFER" &&
              (item.mfg_pro_location_in === "--" || !item.mfg_pro_location_in) &&
              item.fgout_pro_location_out &&
              item.fgout_pro_location_out !== "--";

            if (isFgReturnExec) {
              transaction_type = OUT;
              transaction_type_label = "FG RETURN EXECUTE";
              transaction_id =
                "FG RETURN EXEC TXN: " +
                item.mfg_pro_apr_transaction +
                (item.mfg_ref_transid_1
                  ? "\nFG RETURN TXN: " + item.mfg_ref_transid_1
                  : "");
              transaction_date = moment(item.in_date)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY HH:mm:ss");
              transaction_qty = item.in_qty;
              transaction_qty_in = 0;
              transaction_qty_out = item.in_qty || 0;
              transaction_doneby = item.in_by_user || "--";
              location_in = "--";
              location_out = item.loc_out_name || "--";
              mode = "FG RETURN EXECUTE";
              weightedSKURate = 0;
            } else if (item.transaction_type == "IN") {
              transaction_type = IN;
              transaction_type_label = "IN";
              let txnParts = [];
              if (item.mfg_ref_transid_1)
                txnParts.push("PPR TXN: " + item.mfg_ref_transid_1);
              if (item.mfg_ref_transid_2)
                txnParts.push("MFG TXN: " + item.mfg_ref_transid_2);
              if (item.mfg_pro_apr_transaction)
                txnParts.push("FG IN TXN: " + item.mfg_pro_apr_transaction);
              transaction_id =
                txnParts.length > 0 ? txnParts.join("\n") : "N/A";
              transaction_date = moment(item.in_date)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY HH:mm:ss");
              transaction_qty = item.in_qty;
              transaction_qty_in = item.in_qty || 0;
              transaction_qty_out = 0;
              transaction_doneby = item.in_by_user;
              location_in = item.loc_in_name || "--";
              location_out = "--";
              mode = "FGIN";
              weightedSKURate = 0;
            } else if (item.transaction_type == "FGMIN") {
              transaction_type = IN;
              transaction_type_label = "FGMIN";
              transaction_id = item.mfg_pro_apr_transaction
                ? "FG MIN TXN: " + item.mfg_pro_apr_transaction
                : "N/A";
              transaction_date = moment(item.in_date)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY HH:mm:ss");
              transaction_qty = item.in_qty;
              transaction_qty_in = item.in_qty || 0;
              transaction_qty_out = 0;
              transaction_doneby = item.in_by_user || "--";
              location_in = item.loc_in_name || "--";
              location_out = "--";
              mode = "FGMIN";
              weightedSKURate = 0;
            } else if (item.transaction_type == "TRANSFER") {
              transaction_type = NEUTRAL;
              transaction_type_label = "TRANSFER";
              transaction_id = item.mfg_pro_apr_transaction
                ? "FG TRF TXN: " + item.mfg_pro_apr_transaction
                : "N/A";
              transaction_date = moment(item.in_date)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY HH:mm:ss");
              transaction_qty = item.in_qty;
              transaction_qty_in = item.in_qty || 0;
              transaction_qty_out = item.in_qty || 0;
              transaction_doneby = item.in_by_user || "--";
              location_in = item.loc_in_name || "--";
              const sourceOutRow = item.mfg_pro_apr_transaction
                ? stmt2.find(
                    (r) =>
                      r.transaction_type === "OUT" &&
                      r.mfg_pro_FGout_transaction ===
                        item.mfg_pro_apr_transaction,
                  )
                : null;
              location_out =
                (sourceOutRow && sourceOutRow.loc_out_name) ||
                item.loc_out_name ||
                "--";
              mode = "TRANSFER";
              weightedSKURate = 0;
            } else if (item.transaction_type == "OUT") {
              // CHANGE 5: an OUT that is the source leg of a location-to-location move
              // (has a paired ACTIVE TRANSFER row) is shown as TRANSFER, not OUT.
              const transferDest = item.mfg_pro_FGout_transaction
                ? transferDestMap.get(item.mfg_pro_FGout_transaction)
                : null;
              const isTransferOut = !!transferDest;

              transaction_date = moment(item.out_date)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY HH:mm:ss");
              transaction_qty = item.out_qty;
              transaction_qty_in = 0; // stock only leaves THIS (source) location
              transaction_qty_out = item.out_qty || 0;
              transaction_doneby = item.out_by_user || "--";
              location_out = item.loc_out_name || "--";
              weightedSKURate = 0;

              if (isTransferOut) {
                transaction_type = NEUTRAL;
                transaction_type_label = "TRANSFER";
                transaction_id = "FG TRF TXN: " + item.mfg_pro_FGout_transaction;
                location_in = transferDest; // destination location
                mode = "TRANSFER";
              } else {
                transaction_type = OUT;
                transaction_type_label = "OUT";
                transaction_id = item.mfg_pro_FGout_transaction
                  ? "FG OUT TXN: " + item.mfg_pro_FGout_transaction
                  : "N/A";
                location_in = "--";
                if (item.fg_out_type === "SL001") {
                  mode = "SALES";
                } else if (item.fg_out_type === "OT001") {
                  mode = "OTHER";
                } else if (item.fg_out_type === "REPL") {
                  mode = "REPLACEMENT";
                } else {
                  mode = "OUT";
                }
              }
            } else {
              transaction_type = "N/A";
              transaction_type_label = "N/A";
              transaction_id = "N/A";
              transaction_date = "N/A";
              transaction_qty = "N/A";
              transaction_qty_in = 0;
              transaction_qty_out = 0;
              transaction_doneby = "N/A";
              rate = 0;
              location_in = "--";
              location_out = "--";
              mode = "--";
              weightedSKURate = 0;
            }

            const m3St = String(item.fg_status || "ACTIVE").toUpperCase();
            const m2St = String(item.mfg2_fg_status || "ACTIVE").toUpperCase();
            const isCancelledRow =
              m3St !== "ACTIVE" ||
              ((item.transaction_type === "IN" ||
                item.transaction_type === "TRANSFER" ||
                item.transaction_type === "FGMIN") &&
                m2St !== "ACTIVE");
            if (isCancelledRow) {
              transaction_type = CANCELLEND;
              if (transaction_type_label && transaction_type_label !== "N/A") {
                transaction_type_label = `${transaction_type_label} (CANCELLED)`;
              } else {
                transaction_type_label = "CANCELLED";
              }
            }

            return {
              serial_no: index + 1,
              date: transaction_date,
              type: transaction_type,
              transaction_type: transaction_type_label,
              transaction_id: transaction_id,
              qty_in: transaction_qty_in,
              qty_out: transaction_qty_out,
              rate: rate,
              weightedSKURate: weightedSKURate,
              newWAR: await fgWeightedAverageRate(
                req.query.sku,
                txDateFormatted,
                item.m3_id,
              ),
              location_in: location_in,
              location_out: location_out,
              mode: mode,
              doneby: transaction_doneby,
              remark: item.fg_out_remark || "--",
              qty: transaction_qty,
              uom: stmt1[0].units_name,
            };
          });

          const transactionData = await Promise.all(transactionPromises);
          data.push(...transactionData);

          if (stmt2.length == 0 && !hasDateRange) {
            res.json({
              status: "error",
              message: "no any transaction found",
              success: false,
            });
            return;
          } else {
            const fgretunrQty = await invtDB.query(
              "SELECT COALESCE(SUM(`qty_return`),0) as `qty_return` , COALESCE(SUM(`executed_qty`),0) as `executed_qty` FROM fg_return WHERE product_id = :sku_code AND fg_status = 'NG'",
              {
                replacements: { sku_code: req.query.sku },
                type: invtDB.QueryTypes.SELECT,
              },
            );

            const closingqty = hasDateRange
              ? helper.number(Number(openingQty) + creditInRange - debitInRange)
              : creditBal - debitBal;

            const noTxn = data.length == 0;
            res.json({
              status: "success",
              success: true,
              message: noTxn
                ? hasDateRange
                  ? "No transaction found for the selected date range"
                  : "No transaction found"
                : "Transactions fetched successfully",
              response: {
                data1: {
                  sku: stmt1[0].p_sku,
                  uom: stmt1[0].units_name,
                  product: stmt1[0].p_name.toUpperCase(),
                  closingqty: closingqty,
                  pendingfgReturnQty:
                    (fgretunrQty[0].qty_return || 0) -
                    (fgretunrQty[0].executed_qty || 0),
                  openingqty: openingQty,
                  lastRate: lastRate,
                },
                data2: data,
              },
            });
            return;
          }
        } else {
          res.json({
            status: "error",
            message:
              "couldn't fetch the transaction associated with this product at this location",
            success: false,
          });
          return;
        }
      } else {
        res.json({
          status: "error",
          message:
            "couldn't fetch the transaction bcz seems the product does not exist",
          success: false,
        });
        return;
      }
    }
  } catch (error) {
    helper.errorResponse(res, error);
    return;
  }
});

// Download Breakdown Report
router.get("/breakdown", async (req, res) => {

});


module.exports = router;

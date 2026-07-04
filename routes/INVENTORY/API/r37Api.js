const express = require("express");
const router = express.Router();
const { decode } = require("html-entities");

let { invtDB, otherDB } = require("../../../config/db/connection");

const validateApiToken = async (req, res, next) => {
  const authHeader = req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      code: 401,
      message: "No token provided",
      status: "error",
    });
  }

  const token = authHeader.replace("Bearer ", "");
  try {
    const currentTime = moment.tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const tokenRecord = await otherDB.query(
      `SELECT expires_at
       FROM tbl_api_tokens
       WHERE token = :token
         AND expires_at > :currentTime`,
      {
        replacements: { token, currentTime },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (!tokenRecord.length) {
      return res.status(401).json({
        code: 401,
        message: "Invalid OR the token has been expired",
        status: "error",
      });
    }

    next();
  } catch (error) {
    console.error("Error validating API token:", error);
    return res.status(401).json({
      code: 401,
      message: "Unauthorized Access, CASE SENSITIVE",
      status: "error",
    });
  }
};

const parseDateRange = (value) => {
  const dates = String(value || "").match(/\d{2}-\d{2}-\d{4}/g);
  if (!dates || dates.length < 1) return null;

  const fromMoment = moment(dates[0], "DD-MM-YYYY", true);
  const toMoment = dates[1] ? moment(dates[1], "DD-MM-YYYY", true) : fromMoment.clone();
  if (!fromMoment.isValid() || !toMoment.isValid() || toMoment.isBefore(fromMoment)) {
    return null;
  }

  return {
    fromdate: fromMoment.format("YYYY-MM-DD"),
    todate: toMoment.format("YYYY-MM-DD"),
  };
};

const number = (val) => Number((Number(val) || 0).toFixed(3));

router.get("/fetch/VendorStock", async (req, res) => {
  const { date, vendor } = req.query;

  if (!date) {
    return res.status(400).json({
      status: "error", 
      success: false,
      message: "date required. Example: 21-11-2025 OR 01-11-2025 - 21-11-2025",
    });
  }

  const parsed = parseDateRange(date);
  if (!parsed) {
    return res.status(400).json({
      status: "error",
      success: false,
      message: "Invalid date format/value",
    });
  }

  const { fromdate, todate } = parsed;
  const vendorFilter = String(vendor || "").trim();

  try {
    // const vendorWhere = vendorFilter ? " AND p.jw_po_vendor_reg_id = :vendorCode " : "";
    // const vendorReplacements = vendorFilter ? { vendorCode: vendorFilter } : {};
    
    const vendorWhere = vendorFilter ? " AND v.ven_name LIKE :vendorName " : "";
    const vendorReplacements = vendorFilter ? { vendorName: `%${vendorFilter}%` } : {};

    const vendorPartRows = await invtDB.query(
      `SELECT
         p.jw_po_vendor_reg_id AS vendor_code,
         COALESCE(v.ven_name, '--') AS vendor_name,
         b.jw_bom_part AS component_id,
         c.c_part_no AS part_code,
         c.c_new_part_no AS new_part_code,
         c.c_name AS component_name,
         COALESCE(u.units_name, '--') AS unit
       FROM jw_purchase_req p
       INNER JOIN jw_bom_recipe b
         ON b.jw_bom_po_trans = p.jw_jw_transaction
       LEFT JOIN components c
         ON c.component_key = b.jw_bom_part
       LEFT JOIN units u
         ON u.units_id = c.c_uom
       LEFT JOIN ven_basic_detail v
         ON v.ven_register_id = p.jw_po_vendor_reg_id
       WHERE p.jw_po_status = 'A'
         ${vendorWhere}
       GROUP BY p.jw_po_vendor_reg_id, b.jw_bom_part
       ORDER BY p.jw_po_vendor_reg_id ASC, c.c_part_no ASC`,
      {
        replacements: vendorReplacements,
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!vendorPartRows.length) {
      return res.json({
        status: "error",
        success: false,
        message: "No data found",
      });
    }

    const openingRows = await invtDB.query(
      `SELECT
         x.vendor_code,
         x.component_id,
         SUM(x.inward_qty) AS inward_qty,
         SUM(x.outward_qty) AS outward_qty
       FROM (
         SELECT
           p.jw_po_vendor_reg_id AS vendor_code,
           r.components_id AS component_id,
           SUM(r.qty + COALESCE(r.other_qty, 0)) AS inward_qty,
           0 AS outward_qty
         FROM rm_location r
         INNER JOIN jw_purchase_req p
           ON p.jw_jw_transaction = r.jw_transaction_id
          AND p.jw_po_status = 'A'
         LEFT JOIN ven_basic_detail v ON v.ven_register_id = p.jw_po_vendor_reg_id
         WHERE r.trans_type = 'JOBWORK'
           AND DATE(r.insert_date) < :fromdate
           ${vendorWhere}
         GROUP BY p.jw_po_vendor_reg_id, r.components_id

         UNION ALL

         SELECT
           p.jw_po_vendor_reg_id AS vendor_code,
           r.components_id AS component_id,
           0 AS inward_qty,
           SUM(r.qty + COALESCE(r.other_qty, 0)) AS outward_qty
         FROM rm_location r
         INNER JOIN jw_purchase_req p
           ON p.jw_jw_transaction = r.jw_transaction_id
          AND p.jw_po_status = 'A'
        LEFT JOIN ven_basic_detail v ON v.ven_register_id = p.jw_po_vendor_reg_id
         WHERE r.trans_type = 'CONSUMPTION'
           AND r.trans_mode = 'default'
           AND DATE(r.insert_date) < :fromdate
           ${vendorWhere}
         GROUP BY p.jw_po_vendor_reg_id, r.components_id

         UNION ALL

         SELECT
           p.jw_po_vendor_reg_id AS vendor_code,
           r.components_id AS component_id,
           0 AS inward_qty,
           SUM(r.qty + COALESCE(r.other_qty, 0)) AS outward_qty
         FROM rm_location r
         INNER JOIN jw_purchase_req p
           ON p.jw_jw_transaction = r.jw_transaction_id
          AND p.jw_po_status = 'A'
          LEFT JOIN ven_basic_detail v ON v.ven_register_id = p.jw_po_vendor_reg_id
         WHERE r.trans_type = 'SFG-CONSUMPTION'
           AND DATE(r.insert_date) < :fromdate
           ${vendorWhere}
         GROUP BY p.jw_po_vendor_reg_id, r.components_id

         UNION ALL

         SELECT
           p.jw_po_vendor_reg_id AS vendor_code,
           r.components_id AS component_id,
           0 AS inward_qty,
           SUM(r.qty + COALESCE(r.other_qty, 0)) AS outward_qty
         FROM rm_location r
         INNER JOIN jw_purchase_req p
           ON p.jw_jw_transaction = r.in_jw_transaction_id
          AND p.jw_po_status = 'A'
          LEFT JOIN ven_basic_detail v ON v.ven_register_id = p.jw_po_vendor_reg_id
         WHERE r.trans_type = 'TRANSFER'
           AND r.trans_mode = 'return'
           AND DATE(r.insert_date) < :fromdate
           ${vendorWhere}
         GROUP BY p.jw_po_vendor_reg_id, r.components_id
       ) x
       GROUP BY x.vendor_code, x.component_id`,
      {
        replacements: { fromdate, ...vendorReplacements },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const dayRows = await invtDB.query(
      `SELECT
         x.txn_date,
         x.vendor_code,
         x.component_id,
         SUM(x.inward_qty) AS inward_qty,
         SUM(x.outward_qty) AS outward_qty
       FROM (
         SELECT
           DATE(r.insert_date) AS txn_date,
           p.jw_po_vendor_reg_id AS vendor_code,
           r.components_id AS component_id,
           SUM(r.qty + COALESCE(r.other_qty, 0)) AS inward_qty,
           0 AS outward_qty
         FROM rm_location r
         INNER JOIN jw_purchase_req p
           ON p.jw_jw_transaction = r.jw_transaction_id
          AND p.jw_po_status = 'A'
        LEFT JOIN ven_basic_detail v ON v.ven_register_id = p.jw_po_vendor_reg_id
         WHERE r.trans_type = 'JOBWORK'
           AND DATE(r.insert_date) BETWEEN :fromdate AND :todate
           ${vendorWhere}
         GROUP BY DATE(r.insert_date), p.jw_po_vendor_reg_id, r.components_id

         UNION ALL

         SELECT
           DATE(r.insert_date) AS txn_date,
           p.jw_po_vendor_reg_id AS vendor_code,
           r.components_id AS component_id,
           0 AS inward_qty,
           SUM(r.qty + COALESCE(r.other_qty, 0)) AS outward_qty
         FROM rm_location r
         INNER JOIN jw_purchase_req p
           ON p.jw_jw_transaction = r.jw_transaction_id
          AND p.jw_po_status = 'A'
           LEFT JOIN ven_basic_detail v ON v.ven_register_id = p.jw_po_vendor_reg_id
         WHERE r.trans_type = 'CONSUMPTION'
           AND r.trans_mode = 'default'
           AND DATE(r.insert_date) BETWEEN :fromdate AND :todate
           ${vendorWhere}
         GROUP BY DATE(r.insert_date), p.jw_po_vendor_reg_id, r.components_id

         UNION ALL

         SELECT
           DATE(r.insert_date) AS txn_date,
           p.jw_po_vendor_reg_id AS vendor_code,
           r.components_id AS component_id,
           0 AS inward_qty,
           SUM(r.qty + COALESCE(r.other_qty, 0)) AS outward_qty
         FROM rm_location r
         INNER JOIN jw_purchase_req p
           ON p.jw_jw_transaction = r.jw_transaction_id
          AND p.jw_po_status = 'A'
        LEFT JOIN ven_basic_detail v ON v.ven_register_id = p.jw_po_vendor_reg_id
         WHERE r.trans_type = 'SFG-CONSUMPTION'
           AND DATE(r.insert_date) BETWEEN :fromdate AND :todate
           ${vendorWhere}
         GROUP BY DATE(r.insert_date), p.jw_po_vendor_reg_id, r.components_id

         UNION ALL

         SELECT
           DATE(r.insert_date) AS txn_date,
           p.jw_po_vendor_reg_id AS vendor_code,
           r.components_id AS component_id,
           0 AS inward_qty,
           SUM(r.qty + COALESCE(r.other_qty, 0)) AS outward_qty
         FROM rm_location r
         INNER JOIN jw_purchase_req p
           ON p.jw_jw_transaction = r.in_jw_transaction_id
          AND p.jw_po_status = 'A'
         LEFT JOIN ven_basic_detail v ON v.ven_register_id = p.jw_po_vendor_reg_id
         WHERE r.trans_type = 'TRANSFER'
           AND r.trans_mode = 'return'
           AND DATE(r.insert_date) BETWEEN :fromdate AND :todate
           ${vendorWhere}
         GROUP BY DATE(r.insert_date), p.jw_po_vendor_reg_id, r.components_id
       ) x
       GROUP BY x.txn_date, x.vendor_code, x.component_id`,
      {
        replacements: { fromdate, todate, ...vendorReplacements },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const openingMap = {};
    for (let i = 0; i < openingRows.length; i++) {
      const row = openingRows[i];
      const key = `${row.vendor_code}__${row.component_id}`;
      openingMap[key] = number(row.inward_qty) - number(row.outward_qty);
    }

    const dayMap = {};
    for (let i = 0; i < dayRows.length; i++) {
      const row = dayRows[i];
      const key = `${row.txn_date}__${row.vendor_code}__${row.component_id}`;
      dayMap[key] = {
        inward: number(row.inward_qty),
        outward: number(row.outward_qty),
      };
    }

    const dateList = [];
    let cursor = moment(fromdate, "YYYY-MM-DD");
    const end = moment(todate, "YYYY-MM-DD");
    while (!cursor.isAfter(end)) {
      dateList.push(cursor.format("YYYY-MM-DD"));
      cursor = cursor.add(1, "day");
    }

    const result = [];
    for (let i = 0; i < vendorPartRows.length; i++) {
      const item = vendorPartRows[i];
      const stockKey = `${item.vendor_code}__${item.component_id}`;
      let runningBalance = number(openingMap[stockKey] || 0);

      for (let d = 0; d < dateList.length; d++) {
        const dateKey = `${dateList[d]}__${item.vendor_code}__${item.component_id}`;
        const movement = dayMap[dateKey] || { inward: 0, outward: 0 };

        const openingBalance = runningBalance;
        const inward = number(movement.inward);
        const outward = number(movement.outward);
        const closingBalance = number(openingBalance + inward - outward);

        result.push({
          date: moment(dateList[d], "YYYY-MM-DD").format("DD-MM-YYYY"),
          vendorName: item.vendor_name,
          partCode: item.part_code || "--",
          openingBalance,
          inward,
          outward,
          closingBalance,
        });

        runningBalance = closingBalance;
      }
    }

    return res.json({
      status: "success",
      success: true,
      fromdate: moment(fromdate, "YYYY-MM-DD").format("DD-MM-YYYY"),
      todate: moment(todate, "YYYY-MM-DD").format("DD-MM-YYYY"),
      data: result,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: "error",
      success: false,
      message: "an internal error occured, Please try after some time.",
    });
  }
});

module.exports = router;

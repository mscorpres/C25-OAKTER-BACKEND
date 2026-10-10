const express = require("express");
const router = express.Router();
const { invtDB } = require("../../../config/db/connection");
const auth = require("../../../middleware/auth");
const { getDatabaseByGST } = require("../../../helper/utils/gstDbMapper");

/* ---------------- GET SFG CONSUMPTION ITEMS ---------------- */
async function getSfgConsumptionItems(jwTransaction, db) {
  const stmt = await db.query(
    `
    SELECT 
      components.c_name,
      components.c_part_no,
      components.components_type,
      rm_location.qty,
      rm_location.other_qty,
      units.units_name,
      rm_location.any_remark,
      rm_location.mfg_bom_qty,
      rm_location.in_hsn_code,
      rm_location.components_id
    FROM rm_location
    LEFT JOIN components 
      ON rm_location.components_id = components.component_key
    LEFT JOIN units 
      ON units.units_id = components.c_uom
    WHERE 
      rm_location.trans_mode = 'default' 
      AND rm_location.trans_type = 'SFG-CONSUMPTION'
      AND rm_location.vendor_type = '--'
      AND rm_location.jw_transaction_id = :jwTrans
    `,
    {
      replacements: { jwTrans: jwTransaction },
      type: db.QueryTypes.SELECT,
    }
  );

  const list = await Promise.all(
    stmt.map(async (item) => {
      const qty = Number(item.qty || 0);
      const otherQty = Number(item.other_qty || 0);
      const consumed = qty + otherQty;

      return {
        componentName: item.c_name || "--",
        componentPart: item.c_part_no || "--",
        hsnCode: item.in_hsn_code || "--",
        qtyConsumed: consumed,
        bomQty: item.mfg_bom_qty || "--",
        UOM: item.units_name || "--",
        locationFrom: "GDJW056_ASCENT ENTERPRISES",
        remark: item.any_remark || "--",
      };
    })
  );

  return list;
}

router.get("/jw-sfg-inward", auth.tallysyncAuthorized, async (req, res) => {
  try {
    const { fromdate, todate } = req.query;
    
   
    let gst = null;
    
    
    const urlSources = [req.originalUrl, req.url, req.path];
    
    for (const urlSource of urlSources) {
      if (!urlSource) continue;
      
      
      const gstMatch = urlSource.toString().match(/gst=([^/&?\s]+)/i);
      if (gstMatch && gstMatch[1]) {
        gst = gstMatch[1].trim();
        break;
      }
    }
    
   
    if (!gst && req.params) {
      const paramsStr = JSON.stringify(req.params);
      const gstMatch = paramsStr.match(/gst[=:]([^/&?\s"']+)/i);
      if (gstMatch && gstMatch[1]) {
        gst = gstMatch[1].trim();
      }
    }
    
   
    let db;
    try {
      db = getDatabaseByGST(gst);
    } catch (error) {
      return res.status(400).json({
        status: "error",
        message: error.message || "Invalid GST number",
      });
    }

    if (!fromdate || !todate) {
      return res.status(400).json({
        status: "error",
        message: "fromdate and todate query parameters are required",
      });
    }

    const from = moment(fromdate, "DD-MM-YYYY", true);
    const to = moment(todate, "DD-MM-YYYY", true);

    if (!from.isValid() || !to.isValid()) {
      return res.status(400).json({
        status: "error",
        message: "Invalid date format. Use DD-MM-YYYY",
      });
    }

    const stmt = await db.query(
      `
      SELECT 
  jw_purchase_req.jw_jw_transaction,
  jw_purchase_req.jw_po_issue_qty,
  jw_purchase_req.jw_po_full_date,
  products.p_sku,
  products.p_name,
  products.p_hsncode,
  units.units_name,
  rm_location.in_po_rate,
  rm_location.in_invoice_id,
  rm_location.in_transaction_id
FROM jw_purchase_req

LEFT JOIN products
  ON jw_purchase_req.jw_po_sku = products.product_key

LEFT JOIN units
  ON products.p_uom = units.units_id

LEFT JOIN (
    SELECT *
    FROM rm_location
    WHERE trans_type = 'INWARD'
      AND trans_mode = 'default'
      AND in_module = 'IN-JWI'
      AND vendor_type = 'j01'
) AS rm_location
  ON jw_purchase_req.jw_jw_transaction = rm_location.in_jw_transaction_id

WHERE
  DATE(jw_purchase_req.jw_po_full_date)
  BETWEEN :d1 AND :d2
  AND jw_purchase_req.jw_po_status = 'A'
  AND jw_purchase_req.jw_po_issue_qty > 0

ORDER BY jw_purchase_req.jw_po_full_date DESC;
      `,
      {
        replacements: {
          d1: from.format("YYYY-MM-DD"),
          d2: to.format("YYYY-MM-DD"),
        },
        type: db.QueryTypes.SELECT,
      }
    );

    if (!stmt.length) {
      return res.status(404).json({
        status: "error",
        message: "Data not found",
      });
    }

    const sfgList = await Promise.all(
      stmt.map(async (item) => {
        const consumption = await getSfgConsumptionItems(
          item.jw_jw_transaction,
          db
        );

        return {
          jwTxnID: item.jw_jw_transaction,
          date: moment(item.jw_po_full_date).format("DD-MM-YYYY HH:mm:ss"),
          productSKU: item.p_sku,
          productName: item.p_name,
          UOM: item.units_name,
          hsnCode: item.p_hsncode,
          sfGInQty: Number(item.jw_po_issue_qty || 0),
          inRate: Number(item.in_po_rate || 0),
          locationTo: "GDRM0021-A-21 Noida",
          minInvoice: item.in_invoice_id || "--",
          minRate: Number(item.in_po_rate || 0),
          minTxnId: item.in_transaction_id || "--",
          voucherID: item.in_transaction_id + "-" + item.in_invoice_id,
          consumptions: consumption,
        };
      })
    );

    const totalConsumption = sfgList.reduce(
      (sum, i) => sum + i.consumptions.length,
      0
    );

    return res.json({
      status: "success",
      header: {
        date: `${from.format("DD-MM-YYYY")} to ${to.format("DD-MM-YYYY")}`,
        totalSfg: sfgList.length,
        totalConsumption,
        voucherType: "PRODUCTION-JW",
        voucherSubType: "MFGJOURNAL",
      },
      sfgs: sfgList,
    });
  } catch (err) {
    console.error("SFG INWARD ERROR:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
});

module.exports = router;

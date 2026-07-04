const express = require("express");
const router = express.Router();

let { invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

function formatDate(date) {
  return moment(date).isValid() ? moment(date).format("DD-MM-YYYY") : "--";
}

function Number(number) {
  return number.toString().padStart(2, '0');
}

// Count of all Transactions
router.post("/transaction_counts/:type", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    data: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
  }

  const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
  const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
  const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

  try {
    const type = req.params.type;

    let finalResult;

    if (type == "MIN") {
      let totalMINCounts = await invtDB.query(
        `SELECT
  COUNT(DISTINCT CASE WHEN trans_type = 'INWARD' THEN in_transaction_id ELSE NULL END) AS totalMIN,
  MAX(DATE_FORMAT(CASE WHEN trans_type = 'INWARD' THEN insert_date END, '%Y-%m-%d')) AS lastInsertDateMIN,
  COUNT(DISTINCT CASE WHEN trans_type = 'INWARD' AND in_module = 'IN-PO' THEN in_transaction_id ELSE NULL END) AS poMIN,
  MAX(DATE_FORMAT(CASE WHEN trans_type = 'INWARD' AND in_module = 'IN-PO' THEN insert_date END, '%Y-%m-%d')) AS lastInsertDatePOMIN,
  COUNT(DISTINCT CASE WHEN trans_type = 'INWARD' AND in_module = 'IN-JWI' THEN in_transaction_id ELSE NULL END) AS jwMIN,
  MAX(DATE_FORMAT(CASE WHEN trans_type = 'INWARD' AND in_module = 'IN-JWI' THEN insert_date END, '%Y-%m-%d')) AS lastInsertDateJWMIN,
  COUNT(DISTINCT CASE WHEN trans_type = 'INWARD' AND in_module = 'IN-MIN' THEN in_transaction_id ELSE NULL END) AS normalMIN,
  MAX(DATE_FORMAT(CASE WHEN trans_type = 'INWARD' AND in_module = 'IN-MIN' THEN insert_date END, '%Y-%m-%d')) AS lastInsertDatenormalMIN
  FROM rm_location
  WHERE DATE_FORMAT(insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch
`,
        {
          replacements: { date1: date1, date2: date2, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      finalResult = {
        totalMIN: Number(totalMINCounts[0].totalMIN),
        lastMin: formatDate(totalMINCounts[0].lastInsertDateMIN),
        totalPOMin: Number(totalMINCounts[0].poMIN),
        lastPOMin: formatDate(totalMINCounts[0].lastInsertDatePOMIN),
        totalJWMin: Number(totalMINCounts[0].jwMIN),
        lastJWMin: formatDate(totalMINCounts[0].lastInsertDateJWMIN),
        totalNormalMIN: Number(totalMINCounts[0].normalMIN),
        lastNormalMin: formatDate(totalMINCounts[0].lastInsertDatenormalMIN),
      };
    } else if (type == "transaction") {
      let totalTransactionCounts = await invtDB.query(
        `SELECT
  COUNT(DISTINCT CASE WHEN trans_type = 'REJECTION' AND rej_transaction_id != '--' THEN rej_transaction_id ELSE NULL END) AS Rejection,
  MAX(DATE_FORMAT(CASE WHEN trans_type = 'REJECTION' AND rej_transaction_id != '--' THEN insert_date END, '%Y-%m-%d')) AS lastRejection,
  COUNT(DISTINCT CASE WHEN trans_type = 'CONSUMPTION' THEN mfg_ppr_trans_id_2 ELSE NULL END) AS Consumption,
  MAX(DATE_FORMAT(CASE WHEN trans_type = 'CONSUMPTION' THEN insert_date END, '%Y-%m-%d')) AS lastConsumption,
  COUNT(DISTINCT CASE WHEN trans_type = 'JOBWORK' THEN jw_challan_id ELSE NULL END) AS JWchallan,
  MAX(DATE_FORMAT(CASE WHEN trans_type = 'JOBWORK' THEN insert_date END, '%Y-%m-%d')) AS lastJWchallan,
  (SELECT COUNT(DISTINCT po_transaction) FROM po_purchase_req WHERE DATE_FORMAT(po_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalPO,
  (SELECT MAX(DATE_FORMAT(po_full_date, '%Y-%m-%d')) FROM po_purchase_req WHERE DATE_FORMAT(po_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS lastInsertDatePO,
  (SELECT COUNT(*) FROM jw_purchase_req WHERE DATE_FORMAT(jw_po_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalJW_PO,
  (SELECT MAX(DATE_FORMAT(jw_po_full_date, '%Y-%m-%d')) FROM jw_purchase_req WHERE DATE_FORMAT(jw_po_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS lastInsertDateJW_PO,
  (SELECT COUNT(DISTINCT mfg_transaction) FROM mfg_production_2 WHERE DATE_FORMAT(mfg_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalMFG,
  (SELECT MAX(DATE_FORMAT(mfg_full_date, '%Y-%m-%d')) FROM mfg_production_2 WHERE DATE_FORMAT(mfg_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS lastInsertDateMFG,
  (SELECT COUNT(*) FROM mfg_production_3 WHERE type = 'IN' AND DATE_FORMAT(mfgphase2_insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalFGin,
  (SELECT MAX(DATE_FORMAT(mfgphase2_insert_date, '%Y-%m-%d')) FROM mfg_production_3 WHERE type = 'IN' AND DATE_FORMAT(mfgphase2_insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS lastInsertDateFGin,
  (SELECT COUNT(DISTINCT mfg_pro_FGout_transaction) FROM mfg_production_3 WHERE type = 'OUT' AND DATE_FORMAT(fgout_pro_apr_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS totalFGout,
  (SELECT MAX(DATE_FORMAT(fgout_pro_apr_date, '%Y-%m-%d')) FROM mfg_production_3 WHERE type = 'OUT' AND DATE_FORMAT(fgout_pro_apr_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch) AS lastInsertDateFGout
  FROM rm_location
  WHERE DATE_FORMAT(insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch
`,
        {
          replacements: { date1: date1, date2: date2, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      finalResult = {
        totalRejection: Number(totalTransactionCounts[0].Rejection),
        lastRejection: formatDate(totalTransactionCounts[0].lastRejection),
        totalConsumption: Number(totalTransactionCounts[0].Consumption),
        lastConsumption: formatDate(totalTransactionCounts[0].lastConsumption),
        totalJWchallan: Number(totalTransactionCounts[0].JWchallan),
        lastJWchallan: formatDate(totalTransactionCounts[0].lastJWchallan),
        totalPO: Number(totalTransactionCounts[0].totalPO),
        lastPO: formatDate(totalTransactionCounts[0].lastInsertDatePO),
        totalJW_PO: Number(totalTransactionCounts[0].totalJW_PO),
        lastJW_PO: formatDate(totalTransactionCounts[0].lastInsertDateJW_PO),
        totalMFG: Number(totalTransactionCounts[0].totalMFG),
        lastMFG: formatDate(totalTransactionCounts[0].lastInsertDateMFG),
        totalFGin: Number(totalTransactionCounts[0].totalFGin),
        lastFGin: formatDate(totalTransactionCounts[0].lastInsertDateFGin),
        totalFGout: Number(totalTransactionCounts[0].totalFGout),
        lastFGout: formatDate(totalTransactionCounts[0].lastInsertDateFGout),
      };
    } else if (type == "GP") {
      let totalGPCounts = await invtDB.query(
        `SELECT
  COUNT(CASE WHEN gp_type = 'RGP' THEN 1 ELSE NULL END) AS totalRGP,
  MAX(DATE_FORMAT(CASE WHEN gp_type = 'RGP' THEN gp_insert_dt END, '%Y-%m-%d')) AS lastInsertDateRGP,
  COUNT(CASE WHEN gp_type = 'NRGP' THEN 1 ELSE NULL END) AS totalNRGP,
  MAX(DATE_FORMAT(CASE WHEN gp_type = 'NRGP' THEN gp_insert_dt END, '%Y-%m-%d')) AS lastInsertDateNRGP,
  (SELECT COUNT(DISTINCT dc_transaction) FROM ims_dc_challan WHERE (STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(dc_log,'$[0].insert_date')), '%Y-%m-%d') BETWEEN :date1 AND :date2) AND company_branch = :branch) AS totalRGP_DCchallan,
  (SELECT MAX(STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(dc_log,'$[0].insert_date')), '%Y-%m-%d')) FROM ims_dc_challan WHERE (STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(dc_log,'$[0].insert_date')), '%Y-%m-%d') BETWEEN :date1 AND :date2) AND company_branch = :branch) AS lastInsertDateRGP_DCchallan
  FROM ims_gatepass
  WHERE DATE_FORMAT(gp_insert_dt, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch
`,
        {
          replacements: { date1: date1, date2: date2, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      finalResult = {
        totalRGP: Number(totalGPCounts[0].totalRGP),
        lastRGP: formatDate(totalGPCounts[0].lastInsertDateRGP),
        totalNRGP: Number(totalGPCounts[0].totalNRGP),
        lastNRGP: formatDate(totalGPCounts[0].lastInsertDateNRGP),
        totalRGP_DCchallan: Number(totalGPCounts[0].totalRGP_DCchallan),
        lastDCchallan: formatDate(totalGPCounts[0].lastInsertDateRGP_DCchallan),
        totalGatePass: Number(helper.number(totalGPCounts[0].totalRGP) + helper.number(totalGPCounts[0].totalNRGP)),
      };
    }

    return res.json({ status: "success", success: true, message: "", data: finalResult });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// Master Counts
router.post("/master_counts", [auth.isAuthorized], async (req, res) => {
  try {
    let masterCounts = await invtDB.query(
      `SELECT
  COUNT(*) AS totalComponents,
  MAX(DATE_FORMAT(insert_date, '%Y-%m-%d')) AS lastComponent,
  (SELECT COUNT(*) FROM products) AS totalProducts,
  (SELECT MAX(DATE_FORMAT(insert_date, '%Y-%m-%d')) FROM products) AS lastProduct,
  (SELECT COUNT(*) FROM project_master) AS totalProjects,
  (SELECT MAX(DATE_FORMAT(insert_date, '%Y-%m-%d')) FROM project_master) AS lastProject,
  (SELECT COUNT(*) FROM ven_basic_detail) AS totalVendors,
  (SELECT MAX(DATE_FORMAT(insert_full_date, '%Y-%m-%d')) FROM ven_basic_detail) AS lastVendor
  FROM components
`,
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    return res.json({
      status: "success", success: true,
      success: true,
      message: "",
      data: {
        totalComponents: masterCounts[0].totalComponents,
        lastComponent: formatDate(masterCounts[0].lastComponent),
        totalProducts: masterCounts[0].totalProducts,
        lastProduct: formatDate(masterCounts[0].lastProduct),
        totalProjects: masterCounts[0].totalProjects,
        lastProject: formatDate(masterCounts[0].lastProject),
        totalVendors: masterCounts[0].totalVendors,
        lastVendor: formatDate(masterCounts[0].lastVendor),
      },
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// Pending Counts
router.post("/pending_counts", [auth.isAuthorized], async (req, res) => {
  try {
    let pendingCounts = await invtDB.query(
      `SELECT
  COUNT(DISTINCT po_transaction) AS pendingPOs,
  (SELECT COUNT(*) FROM jw_purchase_req WHERE company_branch = :branch AND jw_po_status = "A" AND COALESCE(jw_po_order_qty, 0) > COALESCE(jw_po_issue_qty, 0)) AS pendingJW_POs,
  (SELECT COUNT(*) FROM mfg_production_1 WHERE prod_branch = :branch AND phase1_status = "A" AND COALESCE(prod_planned_qty, 0) > COALESCE(prod_executed_qty, 0)) AS pendingPPRs,
  (SELECT COUNT(DISTINCT transaction_id) FROM material_request WHERE company_branch = :branch AND transaction_type = "O") AS pendingMRs
  FROM po_purchase_req
  WHERE company_branch = :branch AND po_status = "A" AND approval_status = "P"
`,
      {
        replacements: { branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let stmt0 = await invtDB.query(
      "SELECT COALESCE( SUM( mfg_production_2.mfg_prod_planing_qty ), 0 ) AS totalReqQty, IF( table1.testAMT IS NULL, '0', table1.testAMT ) AS testAMT, mfg_production_2.mfg_full_date FROM mfg_production_2 LEFT JOIN( SELECT mfg_ref_id, mfg_transaction, mfg_prod_planing_qty, COALESCE(SUM(mfg_prod_in), 0) AS testAMT, mfg_prod_type FROM mfg_production_2 GROUP BY mfg_transaction,mfg_ref_id ) table1 ON mfg_production_2.mfg_transaction = table1.mfg_transaction AND mfg_production_2.mfg_ref_id = table1.mfg_ref_id WHERE mfg_production_2.mfg_prod_type = 'C' AND mfg_production_2.company_branch = :branch AND mfg_production_2.mfg_sku_type = 'FG' GROUP BY mfg_production_2.mfg_transaction,mfg_production_2.step_count ORDER BY mfg_production_2.ID DESC",
      { replacements: { branch: req.branch }, type: invtDB.QueryTypes.SELECT }
    );

    let pendingFGCount = 0;

    if (stmt0.length > 0) {
      for (const item0 of stmt0) {
        if (item0.totalReqQty > item0.testAMT) {
          pendingFGCount++;
        }
      }
    }

    return res.json({
      status: "success", success: true,
      success: true,
      message: "",
      data: {
        pendingPO: Number(pendingCounts[0].pendingPOs),
        pendingJW_PO: Number(pendingCounts[0].pendingJW_POs),
        pendingPPR: Number(pendingCounts[0].pendingPPRs),
        pendingFG: Number(pendingFGCount),
        pendingMRapproval: Number(pendingCounts[0].pendingMRs),
      },
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// Top Vendor MIN
router.post("/top_vendor_min", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    data: "required",
    limit: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
  }

  const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
  const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
  const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
  const limit = req.body.limit;

  try {
    let top_min = await invtDB.query(
      `
    SELECT
      rm_location.in_vendor_name AS venCode,
      COUNT(DISTINCT in_transaction_id) AS minCount,
      ven_basic_detail.ven_name AS vendorName
    FROM rm_location
    LEFT JOIN ven_basic_detail ON rm_location.in_vendor_name = ven_basic_detail.ven_register_id
    WHERE DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND trans_type = "INWARD"
      AND company_branch = :branch
    GROUP BY rm_location.in_vendor_name
    ORDER BY minCount DESC
    LIMIT :limit
    `,
      {
        replacements: { date1: date1, date2: date2, branch: req.branch, limit: limit },
        type: invtDB.QueryTypes.SELECT,
      }
    );    

    return res.json({
      status: "success", success: true,
      success: true,
      message: "",
      data: {
        topMINs: top_min.map((item) => ({
          vendorCode: item.venCode,
          minCount: item.minCount,
          vendorName: item.vendorName,
        })),
      },
    });
    
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// Top Purchase Components
router.post("/top_po_components", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    data: "required",
    limit: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
  }

  const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
  const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
  const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
  const limit = req.body.limit;

  try {
    let top_components = await invtDB.query(
      `
SELECT components.c_part_no AS cPartno, SUM(po_purchase_req.po_order_qty) AS totalQuantity, components.c_name AS cname
FROM po_purchase_req
LEFT JOIN components ON po_purchase_req.po_part_no = components.component_key
WHERE DATE_FORMAT(po_purchase_req.po_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND po_purchase_req.company_branch = :branch
GROUP BY po_purchase_req.po_part_no
ORDER BY totalQuantity DESC
LIMIT :limit
`,
      {
        replacements: { date1: date1, date2: date2, branch: req.branch, limit: limit },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    return res.json({
      status: "success", success: true,
      success: true,
      message: "",
      data: {
        topComponents: top_components.map((item) => ({
          partCode: item.cPartno,
          totalQuantity: item.totalQuantity,
          componentName: item.cname,
        })),
      },
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// Top MFG Products
router.post("/top_mfg_products", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    data: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
  }

  const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
  const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
  const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

  try {
    let top_products = await invtDB.query(
      `
SELECT mfg_production_2.mfg_sku AS psku, SUM(mfg_production_2.mfg_prod_planing_qty) AS totalmfgQuantity, products.p_name AS pname
FROM mfg_production_2
LEFT JOIN products ON mfg_production_2.mfg_sku = products.p_sku
WHERE DATE_FORMAT(mfg_production_2.mfg_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND mfg_production_2.company_branch = :branch
GROUP BY mfg_production_2.mfg_sku
ORDER BY totalmfgQuantity DESC
LIMIT 3
`,
      {
        replacements: { date1: date1, date2: date2, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    return res.json({
      status: "success", success: true,
      success: true,
      message: "",
      data: {
        topProducts: top_products.map((item) => ({
          productSku: item.psku,
          totalmfgQuantity: item.totalmfgQuantity,
          productName: item.pname,
        })),
      },
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// Add Products
router.post("/add_products", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    data: "required",
    sku: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
  }

  const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
  const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
  const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

  try {

      let show_products = await invtDB.query(
        "SELECT mfg_production_2.mfg_sku AS psku, SUM(mfg_production_2.mfg_prod_planing_qty) AS totalmfgQuantity, products.p_name AS pname FROM mfg_production_2 LEFT JOIN products ON mfg_production_2.mfg_sku = products.p_sku WHERE DATE_FORMAT(mfg_full_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND company_branch = :branch AND mfg_sku = :sku GROUP BY mfg_sku",
        {
          replacements: { date1: date1, date2: date2, branch: req.branch, sku: req.body.sku },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if(show_products.length <= 0){
        return res.json({ status: "error", success: false, message: "Product not maufactured yet" });
      }

    return res.json({
      status: "success", success: true,
      success: true,
      message: "",
      data: {
        productSku: show_products[0].psku,
        totalmfgQuantity: show_products[0].totalmfgQuantity,
        productName: show_products[0].pname,
      },
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;

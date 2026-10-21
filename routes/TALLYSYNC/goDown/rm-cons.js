const express = require("express");
const router = express.Router();
const Validator = require("validatorjs");
const { invtDB } = require("../../../config/db/connection");
const auth = require("../../../middleware/auth");
const { getDatabaseByGST } = require("../../../helper/utils/gstDbMapper");
const { lastNewWeightedAverageRate, calculateWARForTallyAPI } = require("../../../helper/utils/newAvgRate");
const { fgWeightedAverageRate } = require("../../../helper/utils/newFGavgRate");

// Helper function to calculate weighted purchase rate using the same database connection
async function getWeightedPurchaseRateWithDB(componentKey, insertDate, db) {
  const dateStr = moment(insertDate).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  const query =
    "SELECT COALESCE(SUM((in_po_rate * exchange_rate * qty) + custom_duty + freight_charge), 0) AS sum_amount, COALESCE(SUM(qty), 0) AS sum_qty FROM rm_location WHERE components_id = :componentKey AND DATE_FORMAT(insert_date, '%Y-%m-%d %H:%i:%s') BETWEEN :startDate AND :date AND trans_type IN('INWARD') AND (in_module != 'IN-FGRETURN')";
  
  const result = await db.query(query, {
    replacements: { componentKey, date: dateStr, startDate: `2025-04-01 00:00:00` },
    type: db.QueryTypes.SELECT,
  });

  let getAverageRate = await db.query("SELECT * FROM tbl_average_rate WHERE component_key = :componentKey", {
    replacements: { componentKey },
    type: db.QueryTypes.SELECT,
  });

  if (getAverageRate.length <= 0) {
    getAverageRate = [{ average_rate: 0, closing_qty: 0 }];
  }

  const { sum_amount, sum_qty } = result[0];
  const weightedPurchaseRate = (sum_amount + Number(getAverageRate[0].average_rate * getAverageRate[0].closing_qty)) / (sum_qty + Number(getAverageRate[0].closing_qty));
  
  return Number.isNaN(weightedPurchaseRate) ? 0 : weightedPurchaseRate.toFixed(2);
}

router.get("/consumption", async (req, res) => {
  try {
    const { fromdate, todate, branch } = req.query;
    
  
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

    // Determine location configuration based on GST
    const MAIN_BRANCH_GST = process.env.MAIN_BRANCH_GST;
    const isMainBranch = gst && MAIN_BRANCH_GST && gst.trim().toUpperCase() === MAIN_BRANCH_GST.trim().toUpperCase();
    // WAR functions receive the GST-resolved db.
    const useNewWAR = isMainBranch;

    if (!fromdate || !todate) {
      return res.status(400).json({
        status: "error",
        message: "fromdate and todate are required (DD-MM-YYYY)",
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

  // RM → CONSUMPTION (OUT)
    const rmToConsStmt = await db.query(
      `SELECT
        components.c_name,
        components.component_key,
        components.c_part_no,
        all_sub_groups.sub_group_name,
        units.units_name,
        location_main.loc_name,
        admin_login.user_name,
        rm_location.ID AS row_id,
        rm_location.insert_date,
        rm_location.trans_type,
        rm_location.in_vendor_name,
        rm_location.out_transaction_id,
        rm_location.any_remark,
        rm_location.jw_challan_id,
        rm_location.qty,
        loc2.loc_name AS loc_out
      FROM rm_location
      LEFT JOIN components 
        ON rm_location.components_id = components.component_key
      LEFT JOIN units 
        ON components.c_uom = units.units_id
      LEFT JOIN all_sub_groups 
        ON components.c_sub_group = all_sub_groups.sub_group_id
      LEFT JOIN location_main 
        ON rm_location.loc_in = location_main.location_key
      LEFT JOIN location_main AS loc2 
        ON rm_location.loc_out = loc2.location_key
      LEFT JOIN admin_login 
        ON rm_location.insert_by = admin_login.CustID
      WHERE components.c_type = 'R'
        AND components.c_is_enabled = 'Y'
        AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') 
            BETWEEN :fromdate AND :todate
        AND rm_location.trans_type IN('ISSUE')
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND FIND_IN_SET(
          location_main.location_key,
          (SELECT locations FROM location_allotted WHERE loc_all_key = '202391921334723')
        )
        AND NOT (
          components.c_new_part_no LIKE '%RFP%' 
          OR components.c_new_part_no LIKE '%FGP%'
        )
      ORDER BY rm_location.insert_date DESC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      }
    );

    //SF024 → REJ021 (OUT)
    const sf024LocOut = '20220106105354';
    const sf024LocIn = '20210920102942';

    const sf024ToRej021Stmt = await db.query(
      `SELECT
        components.c_name,
        components.component_key,
        components.c_part_no,
        all_sub_groups.sub_group_name,
        units.units_name,
        rm_location.qty,
        rm_location.insert_date,
        rm_location.any_remark,
        rm_location.jw_challan_id,
        rm_location.trans_type,
        rm_location.transfer_transaction_id,
        loc_in.loc_name AS loc_in,
        loc_out.loc_name AS loc_out
      FROM rm_location
      LEFT JOIN components
        ON rm_location.components_id = components.component_key
      LEFT JOIN units
        ON components.c_uom = units.units_id
      LEFT JOIN all_sub_groups
        ON components.c_sub_group = all_sub_groups.sub_group_id
      LEFT JOIN location_main loc_in
        ON rm_location.loc_in = loc_in.location_key
      LEFT JOIN location_main loc_out
        ON rm_location.loc_out = loc_out.location_key
      WHERE components.c_type = 'R'
        AND components.c_is_enabled = 'Y'
        AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d')
            BETWEEN :fromdate AND :todate
        AND rm_location.trans_type IN('TRANSFER','REJECTION')
        AND rm_location.loc_out = :sf024LocOut
        AND rm_location.loc_in = :sf024LocIn
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      ORDER BY rm_location.transfer_transaction_id DESC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          sf024LocOut,
          sf024LocIn,
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      }
    );

    // FG RETURN (IN)
    const fgReturnStmt = await db.query(
      `SELECT 
        rm_location.*,
        rm_location.insert_date,
        rm_location.reversal_txn_id,
        rm_location.fg_rtn_refid,
        components.c_part_no,
        components.c_name,
        components.component_key,
        all_sub_groups.sub_group_name,
        units.units_name,
        admin_login.user_name,
        location_main.loc_name
      FROM rm_location
      LEFT JOIN fg_return 
        ON fg_return.fg_return_txn = rm_location.reversal_txn_id
      LEFT JOIN components 
        ON rm_location.components_id = components.component_key
      LEFT JOIN units 
        ON components.c_uom = units.units_id
      LEFT JOIN all_sub_groups 
        ON components.c_sub_group = all_sub_groups.sub_group_id
      LEFT JOIN admin_login 
        ON rm_location.insert_by = admin_login.CustID
      LEFT JOIN location_main 
        ON rm_location.loc_in = location_main.location_key
      WHERE rm_location.in_module = 'IN-FGRETURN'
        AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') 
            BETWEEN :fromdate AND :todate
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND rm_location.components_id IS NOT NULL
        AND rm_location.qty > 0
        AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      ORDER BY rm_location.fg_rtn_refid, rm_location.insert_date DESC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      }
    );

     // DIRECT PRODUCTION (IN) -- AS PROD
     const directProductionStmt = await db.query(
      `SELECT 
        rm_location.*,
        rm_location.insert_date,
        components.c_part_no,
        components.c_name,
        components.component_key,
        all_sub_groups.sub_group_name,
        units.units_name,
        admin_login.user_name,
        location_main.loc_name
      FROM rm_location
      LEFT JOIN components 
        ON rm_location.components_id = components.component_key
      LEFT JOIN units 
        ON components.c_uom = units.units_id
      LEFT JOIN all_sub_groups 
        ON components.c_sub_group = all_sub_groups.sub_group_id
      LEFT JOIN admin_login 
        ON rm_location.insert_by = admin_login.CustID
      LEFT JOIN location_main 
        ON rm_location.loc_in = location_main.location_key
      WHERE rm_location.inward_type = 'MANUAL-PRODUCTION'
        AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') 
            BETWEEN :fromdate AND :todate
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND rm_location.components_id IS NOT NULL
        AND rm_location.qty > 0
        AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      ORDER BY rm_location.insert_date DESC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      }
    );

    // FG CONSUMPTION (OUT) - Excludes Sales (SL001), includes other FG OUT types
    const fgConsumptionStmt = await db.query(
      `SELECT 
        mfg_production_3.ID,
        products.p_name,
        products.product_key,
        products.p_sku,
        products.p_hsncode,
        units.units_name,
        location_main.loc_name,
        admin_login.user_name,
        mfg_production_3.fgout_pro_apr_fulldate AS insert_date,
        mfg_production_3.fg_out_type AS trans_type,
        mfg_production_3.mfg_pro_FGout_transaction AS out_transaction_id,
        mfg_production_3.fg_out_remark AS any_remark,
        mfg_production_3.fgout_approve_out_qty AS qty,
        loc2.loc_name AS loc_out
      FROM mfg_production_3
      LEFT JOIN products 
        ON mfg_production_3.fgout_pro_apr_sku = products.product_key
      LEFT JOIN units 
        ON products.p_uom = units.units_id
      LEFT JOIN location_main 
        ON mfg_production_3.fgout_pro_location_out = location_main.location_key
      LEFT JOIN location_main AS loc2 
        ON mfg_production_3.fgout_pro_location_out = loc2.location_key
      LEFT JOIN admin_login 
        ON mfg_production_3.fgout_pro_apr_by = admin_login.CustID
      WHERE mfg_production_3.type = 'OUT'
        AND products.product_key IS NOT NULL
        AND (mfg_production_3.fg_out_type IS NULL OR mfg_production_3.fg_out_type != 'SL001')
        AND DATE_FORMAT(mfg_production_3.fgout_pro_apr_date, '%Y-%m-%d')
            BETWEEN :fromdate AND :todate
        ${branch ? "AND mfg_production_3.company_branch = :branch" : ""}
        AND mfg_production_3.fg_status = 'ACTIVE'
        AND COALESCE(mfg_production_3.mfg_pro_FGout_transaction, '') NOT LIKE 'BRTC%'
        AND NOT EXISTS (
          SELECT 1 FROM mfg_production_3 AS trf
          WHERE trf.type = 'TRANSFER'
            AND trf.mfg_pro_apr_transaction = mfg_production_3.mfg_pro_FGout_transaction
        )
      ORDER BY mfg_production_3.fgout_pro_apr_fulldate DESC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      }
    );

    // RM CONSUMPTION (Jobwork related)
    const rmConsumptionStmt = await db.query(
      `SELECT 
        rm_location.*,
        components.c_name,
        components.component_key,
        components.c_part_no,
        components.c_new_part_no,
        all_sub_groups.sub_group_name,
        units.units_name,
        location_main.loc_name AS loc_in_name,
        location_main.location_key AS loc_in_key,
        loc2.loc_name AS loc_out_name,
        loc2.location_key AS loc_out_key,
        rm_location.jw_transaction_id,
        rm_location.out_transaction_id
      FROM rm_location
      LEFT JOIN components 
        ON rm_location.components_id = components.component_key
      LEFT JOIN units 
        ON components.c_uom = units.units_id
      LEFT JOIN all_sub_groups 
        ON components.c_sub_group = all_sub_groups.sub_group_id
      LEFT JOIN location_main 
        ON rm_location.loc_in = location_main.location_key
      LEFT JOIN location_main AS loc2 
        ON rm_location.loc_out = loc2.location_key
      WHERE DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') 
            BETWEEN :fromdate AND :todate
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND rm_location.trans_type = 'CONSUMPTION'
        AND rm_location.jw_transaction_id != '--'
        AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      ORDER BY rm_location.ID ASC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      }
    );

    // RM → CONSUMPTION (OUT)
    const type1Promises = rmToConsStmt.map(async (item) => {
      const purchaseRate = useNewWAR
        ? await calculateWARForTallyAPI(item.component_key, item.insert_date, item.row_id, db)
        : await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

      const qty = Number(item.qty || 0);
      const amount = qty * purchaseRate;

      const godownName = "GDRM001_C25";

      return {
        voucherNumber: `C25RM/CONS${moment(item.insert_date).format("DDMMYY")}`,
        voucherDate: moment(item.insert_date).format("DD-MM-YYYY"),
        voucherType: "Consumption",
        remark: "Being Material Transfer from Main store to Consumption",
        type: "OUT",
        inventoryEntry: {
          stockItemName: item.c_part_no,
          stockItemDescription: item.c_name,
          subcategory: item.sub_group_name || "null",
          godownName: godownName,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          jwChallan: item.jw_challan_id || "null",
          transactionType: item.trans_type,
          gst: isMainBranch,
        }
      };
    });

    // SF024 → REJ021 (OUT) - Group by transfer_transaction_id
    const groupedSf024ToRej021 = sf024ToRej021Stmt.reduce((acc, item) => {
      const key = item.transfer_transaction_id || `TXN_${moment(item.insert_date).format("DDMMYYHHmmss")}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {});

    const type2Promises = [];
    for (const [txnId, group] of Object.entries(groupedSf024ToRej021)) {
      const firstItem = group[0];
      const voucherNumber = `QCF${txnId}`;

      const inventoryEntryPromises = group.map(async (item) => {
        const purchaseRate = useNewWAR
          ? await lastNewWeightedAverageRate(item.component_key, to.format("YYYY-MM-DD"), db)
          : await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

        const qty = Number(item.qty || 0);
        const amount = qty * purchaseRate;

        return {
          stockItemName: item.c_part_no,
          stockItemDescription: item.c_name,
          subcategory: item.sub_group_name || "null",
          godownName: "GDSF024_Rejection",
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          jwChallan: item.jw_challan_id || "null",
          transactionType: item.trans_type
        };
      });

      type2Promises.push(
        Promise.all(inventoryEntryPromises).then((inventoryEntries) => ({
          voucherNumber: voucherNumber,
          voucherDate: moment(firstItem.insert_date).format("DD-MM-YYYY"),
          voucherType: "Consumption-QCF",
          remark: firstItem.any_remark || "--",
          type: "OUT",
          inventoryEntries: inventoryEntries
        }))
      );
    }

    // FG RETURN
    const groupedFgReturn = fgReturnStmt.reduce((acc, item) => {
      const key = item.fg_rtn_refid;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {});

    const type3Promises = [];
    for (const [rtnRefId, group] of Object.entries(groupedFgReturn)) {
      const firstItem = group[0];
      const reversalTxnId = firstItem.reversal_txn_id;
      const voucherNumber = `${reversalTxnId}/${rtnRefId}`;

     
      const inventoryEntryPromises = group.map(async (item) => {
        const purchaseRate = await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

        const qty = Number(item.qty || 0);
        const amount = qty * purchaseRate;

        return {
          stockItemName: item.c_part_no,
          stockItemDescription: item.c_name,
          subcategory: item.sub_group_name || "null",
          godownName: "GDWP001_A21",
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          fgRtnRefId: item.fg_rtn_refid || "null",
          transactionType: "FG_RETURN"
        };
      });

      type3Promises.push(
        Promise.all(inventoryEntryPromises).then((inventoryEntries) => ({
          voucherNumber: voucherNumber,
          voucherDate: moment(firstItem.insert_date).format("DD-MM-YYYY"),
          voucherType: "Stock Journal",
          remark: "Being Material Recover from Product on production floor" || "--",
          type: "IN",
          inventoryEntries: inventoryEntries
        }))
      );
    }

   const groupedDirectProduction = directProductionStmt.reduce((acc, item) => {
      const dateKey = moment(item.insert_date).format("DDMMYY");
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(item);
      return acc;
    }, {});

    const type4Promises = [];
    for (const [dateKey, group] of Object.entries(groupedDirectProduction)) {
      const firstItem = group[0];
      const voucherNumber = `PROD${dateKey}`;

      const inventoryEntryPromises = group.map(async (item) => {
        const purchaseRate = useNewWAR
          ? await lastNewWeightedAverageRate(item.component_key, to.format("YYYY-MM-DD"), db)
          : await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

        const qty = Number(item.qty || 0);
        const amount = qty * purchaseRate;

        const godownName = "GDRM001_C25";

        return {
          stockItemName: item.c_part_no,
          stockItemDescription: item.c_name,
          subcategory: item.sub_group_name || "null",
          godownName: godownName,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          transactionType: "MANUAL-PRODUCTION"
        };
      });

      type4Promises.push(
        Promise.all(inventoryEntryPromises).then((inventoryEntries) => ({
          voucherNumber: voucherNumber,
          voucherDate: moment(firstItem.insert_date).format("DD-MM-YYYY"),
          voucherType: "Stock Journal",
          remark: "Being Material added to main store",
          type: "IN",
          inventoryEntries: inventoryEntries
        }))
      );
    }

    // FG CONSUMPTION (OUT) - Each SKU gets separate voucher
    const type5Promises = fgConsumptionStmt.map(async (item, index) => {
      const dateStr = moment(item.insert_date).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
      // Same WAR calculation as used in q3 report (fgWeightedAverageRate)
      const skuRate = await fgWeightedAverageRate(item.product_key, dateStr, item.ID, db);

      const qty = Number(item.qty || 0);
      const amount = qty * skuRate;

      const godownName = "C25_FG001";

      // Voucher number = transaction id + p_sku (same txn can have multiple SKUs)
      const voucherNumber = `C25${item.out_transaction_id}_${item.p_sku }`
       
        

      return {
        voucherNumber: voucherNumber,
        voucherDate: moment(item.insert_date).format("DD-MM-YYYY"),
        voucherType: "Consumption - FG",
        remark: item.any_remark || "Material sent to FG consumption",
        type: "OUT",
        inventoryEntries: [{
          stockItemName: item.p_sku,
          stockItemDescription: item.p_name,
          subcategory: item.p_hsncode || "null",
          godownName: godownName,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: Number(skuRate).toFixed(2),
          amount: amount,
          jwChallan: item.out_transaction_id || "null",
          transactionType: item.trans_type
        }]
      };
    });

    // Rate = jw_material_challan.jw_order_rate only (same as fetchTableAnly avgRate)
    const jwChallanRateMap = new Map();
    const jwCompPairs = rmConsumptionStmt
      .filter((it) => it.component_key && it.jw_transaction_id)
      .map((it) => ({ txnId: it.jw_transaction_id, compId: it.component_key }));
    const uniqueJwPairs = Array.from(
      new Map(jwCompPairs.map((p) => [`${p.txnId}_${p.compId}`, p]).values()).values()
    );
    if (uniqueJwPairs.length > 0) {
      const orConditions = uniqueJwPairs
        .map((_, i) => `(jw_transaction = :txn_${i} AND jw_component_id = :comp_${i})`)
        .join(" OR ");
      const repl = {};
      uniqueJwPairs.forEach((p, i) => {
        repl[`txn_${i}`] = p.txnId;
        repl[`comp_${i}`] = p.compId;
      });
      const challanRows = await db.query(
        `SELECT jw_transaction, jw_component_id, jw_order_rate FROM jw_material_challan WHERE ${orConditions}`,
        { replacements: repl, type: db.QueryTypes.SELECT }
      );
      challanRows.forEach((r) =>
        jwChallanRateMap.set(
          `${r.jw_transaction}_${r.jw_component_id}`,
          Number(r.jw_order_rate || 0)
        )
      );
    }

    // RM CONSUMPTION (Jobwork related) - Group by job work order (jw_transaction_id)
    const groupedRmConsumption = rmConsumptionStmt.reduce((acc, item) => {
      const key = item.jw_transaction_id || `JW_${moment(item.insert_date).format("DDMMYYHHmmss")}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    const type6Promises = [];
    for (const [jwTxnId, group] of Object.entries(groupedRmConsumption)) {
      const firstItem = group[0];
      const godownNameFirst = (firstItem.loc_out_name || "VENDOR");
      const voucherNumber = `${jwTxnId}`;

      const inventoryEntryPromises = group.map(async (item) => {
        const jwRate = jwChallanRateMap.get(`${item.jw_transaction_id}_${item.component_key}`);
        const purchaseRate = Number(jwRate || 0).toFixed(2);
        const qty = Number(item.qty || 0) + Number(item.other_qty || 0);
        const amount = qty * purchaseRate;
        const godownName = (item.loc_out_name || "VENDOR");

        return {
          stockItemName: item.c_part_no || item.c_new_part_no,
          stockItemDescription: item.c_name,
          subcategory: item.sub_group_name || "null",
          godownName: godownName,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          jwChallan: item.jw_transaction_id || "null",
          transactionType: "CONSUMPTION"
        };
      });

      type6Promises.push(
        Promise.all(inventoryEntryPromises).then((inventoryEntries) => ({
          voucherNumber: voucherNumber,
          voucherDate: moment(firstItem.insert_date).format("DD-MM-YYYY"),
          voucherType: "Consumption - JW",
          remark: "Being Material droppage at " + godownNameFirst + " against Job work Order no. " + (firstItem.jw_transaction_id || "--"),
          type: "OUT",
          inventoryEntries: inventoryEntries
        }))
      );
    }

   
    const type1Results = await Promise.all(type1Promises);
    const type2Results = await Promise.all(type2Promises);
    const type3Results = await Promise.all(type3Promises);
     const type4Results = await Promise.all(type4Promises);
    const type5Results = await Promise.all(type5Promises);
    const type6Results = await Promise.all(type6Promises);

    
    const allVouchers = [];

   
    // Group type1 (RM → CONSUMPTION) by voucher number
    const type1VoucherMap = new Map();
    for (const item of type1Results) {
      const key = item.voucherNumber;
      if (type1VoucherMap.has(key)) {
        type1VoucherMap.get(key).inventoryEntries.push(item.inventoryEntry);
      } else {
        type1VoucherMap.set(key, {
          voucherNumber: item.voucherNumber,
          voucherDate: item.voucherDate,
          voucherType: item.voucherType,
          remark: item.remark,
          type: item.type,
          inventoryEntries: [item.inventoryEntry]
        });
      }
    }

    // type5 (FG CONSUMPTION) - Each SKU already has separate voucher, no grouping needed

    // type2 (SF024 → REJ021) is already grouped by transfer_transaction_id, so add directly
    allVouchers.push(...Array.from(type1VoucherMap.values()));
    allVouchers.push(...type2Results);
    
  
    allVouchers.push(...type3Results);
   
    allVouchers.push(...type4Results);
    allVouchers.push(...type5Results);

    // type6 (RM CONSUMPTION) - already one voucher per job work order (jw_transaction_id)
    allVouchers.push(...type6Results);

   
    allVouchers.sort((a, b) => {
      const dateA = moment(a.voucherDate, "DD-MM-YYYY");
      const dateB = moment(b.voucherDate, "DD-MM-YYYY");
      return dateB.diff(dateA);
    });

    if (!allVouchers.length) {
      return res.status(404).json({
        status: "error",
        message: "No data found for the specified date range",
      });
    }

    // Calculate total amount
    let totalAmount = 0;
    let totalQty = 0;

    let summaryQty = 0;
    let summaryStockValue = 0;

    allVouchers.forEach((voucher) => {
      voucher.inventoryEntries.forEach((entry) => {
        totalAmount += Number(entry.amount) || 0;
        totalQty += Number(entry.quantity) || 0;
      });

      if (voucher.voucherType === "Consumption") {
        voucher.inventoryEntries.forEach((entry) => {
          summaryQty += Number(entry.quantity) || 0;
          summaryStockValue += Number(entry.amount) || 0;
        });
      }
    });

    return res.status(200).json({
      status: "success",
      header: {
        fromDate: from.format("DD-MM-YYYY"),
        toDate: to.format("DD-MM-YYYY"),
        totalVouchers: allVouchers.length,
        totalAmount: Number(totalAmount.toFixed(2)),
        summary: {
          totalQty: Number(summaryQty.toFixed(4)),
          totalStockValue: Number(summaryStockValue.toFixed(4)),
        }
      },
      vouchers: allVouchers
    });
  } catch (error) {
    console.error("Error in /rm-cons:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

module.exports = router;
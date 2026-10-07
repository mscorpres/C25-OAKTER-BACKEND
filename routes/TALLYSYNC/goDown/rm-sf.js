const express = require("express");
const router = express.Router();
const Validator = require("validatorjs");
const { invtDB } = require("../../../config/db/connection");
const auth = require("../../../middleware/auth");
const { getDatabaseByGST } = require("../../../helper/utils/gstDbMapper");
const { calculateWARForTallyAPI } = require("../../../helper/utils/newAvgRate");

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

router.get("/stock_journal", async (req, res) => {
  try {
    const { fromdate, todate } = req.query;
    let branch = req.query.branch;
    console.log("Query parameters:", branch, fromdate, todate);

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

    // Query 1: RM to SF (InterGodownTrfr)
    // Determine location configuration based on GST
    // Exclude physical RM + SF024 virtual godown
    const excludedLocations = ["20220106105354", "1765369161652"];

    // Set branch dynamically based on GST if not provided in query
    const MAIN_BRANCH_GST = process.env.MAIN_BRANCH_GST;
    const isMainBranch = gst && MAIN_BRANCH_GST && gst.trim().toUpperCase() === MAIN_BRANCH_GST.trim().toUpperCase();
    // calculateWARForTallyAPI receives the GST-resolved db.
    const useNewWAR = isMainBranch;
    if (!branch && isMainBranch) {
      branch = "BROAKTRC25";
    }

    const stmt = await db.query(
      `SELECT 
        components.c_name,
        components.component_key,
        components.c_part_no,
        components.c_sub_group,
        all_sub_groups.sub_group_name,
        components.c_type,
        units.units_name,
        location_main.loc_name AS loc_in_name,
        location_main.location_key AS loc_in_key,
        loc2.loc_name AS loc_out_name,
        loc2.location_key AS loc_out_key,
        admin_login.user_name,
        rm_location.insert_date,
        rm_location.trans_type,
        rm_location.any_remark,
        rm_location.qty,
        rm_location.out_transaction_id as transaction_id,
        rm_location.ID AS rm_location_id
      FROM rm_location
      LEFT JOIN components
        ON rm_location.components_id = components.component_key
      LEFT JOIN units
        ON components.c_uom = units.units_id
      LEFT JOIN location_main
        ON rm_location.loc_in = location_main.location_key
      LEFT JOIN location_main AS loc2
        ON rm_location.loc_out = loc2.location_key
      LEFT JOIN admin_login
        ON rm_location.insert_by = admin_login.CustID
      LEFT JOIN all_sub_groups
        ON components.c_sub_group = all_sub_groups.sub_group_id
      WHERE components.c_type = 'R'
        AND components.c_is_enabled = 'Y'
        AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') 
            BETWEEN :fromdate AND :todate
        AND rm_location.trans_type IN('ISSUE')
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND rm_location.loc_in NOT IN (:excludedLocations)
        AND FIND_IN_SET(
          location_main.location_key, 
          (SELECT locations FROM location_allotted WHERE loc_all_key = '202391821188452')
        )
        AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      ORDER BY rm_location.insert_date DESC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          excludedLocations: excludedLocations,
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      },
    );

    // Query 2: RM to REJ (InterGodownTrfr - REJ godown)
    // Determine location configuration based on GST for Query 2
    const query2LocIn = ["20220106105354", "1765369161652"];
    const query2LocOutNotIn = ["1790338762381", "20220106105354", "1690877340601"];

    const rmToRejStmt = await db.query(
      `SELECT 
        components.c_name,
        components.component_key,
        components.c_part_no,
        components.c_new_part_no,
        all_sub_groups.sub_group_name,
        units.units_name,
        location_main.loc_name AS loc_in_name,
        location_main.location_key AS loc_in_key,
        admin_login.user_name,
        rm_location.insert_date,
        rm_location.trans_type,
        rm_location.in_vendor_name,
        rm_location.out_transaction_id as transaction_id,
        rm_location.jw_transaction_id,
        rm_location.jw_challan_id,
        rm_location.any_remark,
        rm_location.qty,
        loc2.loc_name AS loc_out_name,
        loc2.location_key AS loc_out_key,
        rm_location.ID AS rm_location_id
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
        AND rm_location.trans_type IN('ISSUE', 'JOBWORK', 'REJECTION')
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND rm_location.loc_in IN (:query2LocIn)
        AND rm_location.loc_out NOT IN (:query2LocOutNotIn)
        AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      ORDER BY rm_location.insert_date DESC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          query2LocIn: query2LocIn,
          query2LocOutNotIn: query2LocOutNotIn,
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      },
    );

    // Query 3: Production to Rejection (SF024) - TRANSFER
    // Determine location configuration based on GST for Query 3
    const query3LocIn = "20220106105354";
    const query3LocOutNotIn = "20220106105354";

    const prodToRejStmt = await db.query(
      `SELECT 
        rm_location.*,
        components.c_name,
        components.component_key,
        components.c_part_no,
        all_sub_groups.sub_group_name,
        units.units_name,
        admin_login.user_name,
        location_main.loc_name AS loc_in_name,
        location_main.location_key AS loc_in_key,
        loc2.loc_name AS loc_out_name,
        loc2.location_key AS loc_out_key,
        rm_location.transfer_transaction_id as transaction_id
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
      LEFT JOIN location_main AS loc2 
        ON rm_location.loc_out = loc2.location_key
      WHERE components.c_type = 'R'
        AND components.c_is_enabled = 'Y'
        AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') 
            BETWEEN :fromdate AND :todate
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND rm_location.trans_type LIKE '%TRANSFER%'
        AND rm_location.loc_in = :query3LocIn
        AND rm_location.loc_out != :query3LocOutNotIn
        AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      ORDER BY rm_location.insert_date DESC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          query3LocIn: query3LocIn,
          query3LocOutNotIn: query3LocOutNotIn,
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      },
    );

    // Query 4: Rejection to Production - TRANSFER
    // Determine location configuration based on GST for Query 4
    const query4LocOut = "20220106105354";
    // SF024 virtual 1765369161652; merge prior != + NOT IN lists
    const query4LocInNotIn = ["20220106105354", "1765369161652", "1690877340601", "20210920102942", "1690871989601"];

    const rejToProdStmt = await db.query(
      `SELECT 
        rm_location.*,
        components.c_name,
        components.component_key,
        components.c_part_no,
        all_sub_groups.sub_group_name,
        units.units_name,
        admin_login.user_name,
        location_main.loc_name AS loc_in_name,
        location_main.location_key AS loc_in_key,
        loc2.loc_name AS loc_out_name,
        loc2.location_key AS loc_out_key,
        rm_location.transfer_transaction_id as transaction_id
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
      LEFT JOIN location_main AS loc2 
        ON rm_location.loc_out = loc2.location_key
      WHERE components.c_type = 'R'
        AND components.c_is_enabled = 'Y'
        AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') 
            BETWEEN :fromdate AND :todate
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND rm_location.trans_type LIKE '%TRANSFER%'
        AND rm_location.loc_out = :query4LocOut
        AND rm_location.loc_in NOT IN (:query4LocInNotIn)
        AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      ORDER BY rm_location.insert_date DESC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          query4LocOut: query4LocOut,
          query4LocInNotIn: query4LocInNotIn,
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      },
    );

    // Query 5: Production to Store (SF999) - PROD-RM (Stock Journal)
    // Determine location configuration based on GST for Query 5
    const query5LocIn = "1690877340601";
    // loc_out: prod/self + physical RM + SF024 virtual (1765369161652)
    const query5LocOutNotIn = ["1690877340601", "20220106105354", "1765369161652"];

    const prodToStoreStmt = await db.query(
      `SELECT 
        rm_location.*,
        components.c_name,
        components.component_key,
        components.c_part_no,
        all_sub_groups.sub_group_name,
        units.units_name,
        admin_login.user_name,
        location_main.loc_name AS loc_in_name,
        location_main.location_key AS loc_in_key,
        loc2.loc_name AS loc_out_name,
        loc2.location_key AS loc_out_key,
        rm_location.transfer_transaction_id as transaction_id
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
      LEFT JOIN location_main AS loc2 
        ON rm_location.loc_out = loc2.location_key
      WHERE components.c_type = 'R'
        AND components.c_is_enabled = 'Y'
        AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') 
            BETWEEN :fromdate AND :todate
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND rm_location.trans_type = 'TRANSFER'
        AND rm_location.loc_in = :query5LocIn
        AND rm_location.loc_out NOT IN (:query5LocOutNotIn)
        AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      ORDER BY rm_location.insert_date DESC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          query5LocIn: query5LocIn,
          query5LocOutNotIn: query5LocOutNotIn,
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      },
    );

    // Query 6: SF024 (Rejection) → SF999
    const query6LocIn = "1690877340601";
    const query6LocOut = "20220106105354";
    const rejToStoreStmt = await db.query(
      `SELECT 
        rm_location.*,
        components.c_name,
        components.component_key,
        components.c_part_no,
        all_sub_groups.sub_group_name,
        units.units_name,
        admin_login.user_name,
        location_main.loc_name AS loc_in_name,
        location_main.location_key AS loc_in_key,
        loc2.loc_name AS loc_out_name,
        loc2.location_key AS loc_out_key,
        rm_location.transfer_transaction_id as transaction_id
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
      LEFT JOIN location_main AS loc2 
        ON rm_location.loc_out = loc2.location_key
      WHERE components.c_type = 'R'
        AND components.c_is_enabled = 'Y'
        AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') 
            BETWEEN :fromdate AND :todate
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND rm_location.trans_type = 'TRANSFER'
        AND rm_location.loc_in = :query6LocIn
        AND rm_location.loc_out = :query6LocOut
        AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      ORDER BY rm_location.insert_date DESC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          query6LocIn,
          query6LocOut,
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      },
    );

    // Query 7: JOBWORK STOCK JOURNAL TRANSFER [A21 to Vendor Godown]
    const jobworkStockJournalStmt = await db.query(
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
        rm_location.jw_challan_id,
        ven_basic_detail.ven_name AS ven_name
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
      LEFT JOIN ven_basic_detail 
        ON rm_location.in_vendor_name = ven_basic_detail.ven_register_id
      WHERE DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') 
            BETWEEN :fromdate AND :todate
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND rm_location.vendor_type = 'j01'
        AND rm_location.trans_type = 'JOBWORK'
        AND rm_location.trans_mode = 'default'
        AND rm_location.jw_challan_id != '--'
        AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      ORDER BY rm_location.ID ASC`,
      {
        replacements: {
          fromdate: from.format("YYYY-MM-DD"),
          todate: to.format("YYYY-MM-DD"),
          ...(branch && { branch }),
        },
        type: db.QueryTypes.SELECT,
      },
    );

    // Query 8: RM Return
    const rmReturnStmt = await db.query(
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
        rm_location.transfer_transaction_id,
        ven_basic_detail.ven_name AS ven_name
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
      LEFT JOIN ven_basic_detail 
        ON rm_location.in_vendor_name = ven_basic_detail.ven_register_id
      WHERE DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') 
            BETWEEN :fromdate AND :todate
        ${branch ? "AND rm_location.company_branch = :branch" : ""}
        AND rm_location.trans_type = 'TRANSFER'
        AND rm_location.trans_mode = 'return'
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
      },
    );

    // JJJ: Process all vouchers in parallel using Promise.all for better performance
    const allVoucherItems = [];

    // Process Type 1: Original RM to SF (InterGodownTrfr)
    const type1Promises = stmt.map(async (item) => {
      // const purchaseRate = await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);
      const purchaseRate = useNewWAR
        ? await calculateWARForTallyAPI(item.component_key, item.insert_date, item.rm_location_id ?? item.ID, db)
        : await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

      const qty = Number(item.qty || 0);
      const amount = qty * purchaseRate;

      const destinationLocation = "GDWP001_C25";
      const sourceLocationCode = "GDRM001_C25";

      return {
        voucherNumber: `C25RM2SF${moment(item.insert_date).format("DDMMYY")}`,
        voucherDate: moment(item.insert_date).format("DD-MM-YYYY"),
        voucherType: "Inter Godown Trfr-SF",
        remark: "The Material sent to Production floor for manufacturing" || "--",
        destinationLocation: destinationLocation,
        inventoryEntry: {
          stockItemName: item.c_part_no,
          stockItemDescription: item.c_name,
          godownName: sourceLocationCode,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          subcategory: item.sub_group_name || "null",
        },
      };
    });

    // Process Type 2: RM to REJ (InterGodownTrfr - REJ godown)
    const type2Promises = rmToRejStmt.map(async (item) => {
      // const purchaseRate = await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);
      const purchaseRate = useNewWAR
        ? await calculateWARForTallyAPI(item.component_key, item.insert_date, item.rm_location_id ?? item.ID, db)
        : await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

      const qty = Number(item.qty || 0);
      const amount = qty * purchaseRate;

      const sourceLocationCode = "GDRM001_C25";
      const destinationLocation = "C25_Rejection";
      const voucherNum = `RMREJ${moment(item.insert_date).format("DDMMYY")}`;

      return {
        voucherNumber: voucherNum,
        voucherDate: moment(item.insert_date).format("DD-MM-YYYY"),
        voucherType: "Inter Godown Trfr-SF",
        remark: "Being the Material transfer to rejection store from main store" || "--",
        destinationLocation: destinationLocation,
        inventoryEntry: {
          stockItemName: item.c_part_no || item.c_new_part_no,
          stockItemDescription: item.c_name,
          godownName: sourceLocationCode,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          subcategory: item.sub_group_name || "null",
        },
      };
    });

    // Process Type 3: Production to Rejection (SF024)
    const type3Promises = prodToRejStmt.map(async (item) => {
      // const purchaseRate = await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);
      const purchaseRate = useNewWAR
        ? await calculateWARForTallyAPI(item.component_key, item.insert_date, item.rm_location_id ?? item.ID, db)
        : await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

      const qty = Number(item.qty || 0);
      const amount = qty * purchaseRate;

      const sourceLocationCode = "GDWP001_A21";
      const destinationLocation = "GDSF024_Rejection";
      const voucherNum = `SF/SF024/${moment(item.insert_date).format("DDMMYY")}`;

      return {
        voucherNumber: voucherNum,
        voucherDate: moment(item.insert_date).format("DD-MM-YYYY"),
        voucherType: "Inter Godown Trfr-SF",
        remark: "Being the Material transfer to rejection store from production floor" || "--",
        destinationLocation: destinationLocation,
        inventoryEntry: {
          stockItemName: item.c_part_no,
          stockItemDescription: item.c_name,
          godownName: sourceLocationCode,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          subcategory: item.sub_group_name || "null",
        },
      };
    });

    // Process Type 4: Rejection to Production
    const type4Promises = rejToProdStmt.map(async (item) => {
      // const purchaseRate = await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);
      const purchaseRate = useNewWAR
        ? await calculateWARForTallyAPI(item.component_key, item.insert_date, item.rm_location_id ?? item.ID, db)
        : await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

      const qty = Number(item.qty || 0);
      const amount = qty * purchaseRate;

      const sourceLocationCode = "GDSF024_Rejection";
      const destinationLocation = "GDWP001_A21";
      const voucherNum = `REJ/SF/${moment(item.insert_date).format("DDMMYY")}`;

      return {
        voucherNumber: voucherNum,
        voucherDate: moment(item.insert_date).format("DD-MM-YYYY"),
        voucherType: "Inter Godown Trfr-SF",
        remark: "Being Material transfer from Rejection floor to Production floor" || "--",
        destinationLocation: destinationLocation,
        inventoryEntry: {
          stockItemName: item.c_part_no,
          stockItemDescription: item.c_name,
          godownName: sourceLocationCode,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          subcategory: item.sub_group_name || "null",
        },
      };
    });

    // Process Type 5: Production to Store (PROD-RM) - Stock Journal
    const type5Promises = prodToStoreStmt.map(async (item) => {
      // const purchaseRate = await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);
      const purchaseRate = useNewWAR
        ? await calculateWARForTallyAPI(item.component_key, item.insert_date, item.rm_location_id ?? item.ID, db)
        : await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

      const qty = Number(item.qty || 0);
      const amount = qty * purchaseRate;

      const sourceLocationCode = "GDWP001_A21";
      const destinationLocation = "GDRM001_C25";
      const voucherNum = `PROD/RM/${moment(item.insert_date).format("DDMMYY")}`;

      return {
        voucherNumber: voucherNum,
        voucherDate: moment(item.insert_date).format("DD-MM-YYYY"),
        voucherType: "Stock Journal",
        remark: "Being Material transfer from Production to main store" || "--",
        destinationLocation: destinationLocation,
        inventoryEntry: {
          stockItemName: item.c_part_no,
          stockItemDescription: item.c_name,
          godownName: sourceLocationCode,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          subcategory: item.sub_group_name || "null",
        },
      };
    });

    // Process Type 6: Rejection to Store (SF024 to SF999) - Stock Journal
    const type6Promises = rejToStoreStmt.map(async (item) => {
      // const purchaseRate = await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);
      const purchaseRate = useNewWAR
        ? await calculateWARForTallyAPI(item.component_key, item.insert_date, item.rm_location_id ?? item.ID, db)
        : await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

      const qty = Number(item.qty || 0);
      const amount = qty * purchaseRate;
      const sourceLocationCode = "GDSF024_Rejection";
      const destinationLocation = "GDRM001_C25";
      const voucherNum = `REJ/RM/${moment(item.insert_date).format("DDMMYY")}`;

      return {
        voucherNumber: voucherNum,
        voucherDate: moment(item.insert_date).format("DD-MM-YYYY"),
        voucherType: "Stock Journal",
        remark: "Being Material transfer from Rejection to main store" || "--",
        destinationLocation,
        inventoryEntry: {
          stockItemName: item.c_part_no,
          stockItemDescription: item.c_name,
          godownName: sourceLocationCode,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          subcategory: item.sub_group_name || "null",
        },
      };
    });

    // Process Type 7: JOBWORK STOCK JOURNAL TRANSFER [A21 to Vendor Godown]
    // Group by jw_challan_id - each challan should be a separate voucher
    const groupedJobworkStockJournal = jobworkStockJournalStmt.reduce((acc, item) => {
      const challanId = item.jw_challan_id || `CHALLAN_${moment(item.insert_date).format("DDMMYYHHmmss")}`;
      if (!acc[challanId]) {
        acc[challanId] = [];
      }
      acc[challanId].push(item);
      return acc;
    }, {});

    const type7Promises = [];
    for (const [challanId, group] of Object.entries(groupedJobworkStockJournal)) {
      const firstItem = group[0];
      const voucherNum = `${challanId}`;

      // Calculate destinationLocation outside the map function so it's accessible in Promise.all().then()
      const destinationLocation = firstItem.loc_in_name;

      const inventoryEntryPromises = group.map(async (item) => {
        // const purchaseRate = await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);
        const purchaseRate = useNewWAR
          ? await calculateWARForTallyAPI(item.component_key, item.insert_date, item.rm_location_id ?? item.ID, db)
          : await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

        const qty = Number(item.qty || 0) + Number(item.other_qty || 0);
        const amount = qty * purchaseRate;

        // godownName should NOT use "GDRM001_C25", use actual location or default
        const sourceLocationCode = "GDRM001_C25";

        return {
          stockItemName: item.c_part_no || item.c_new_part_no,
          stockItemDescription: item.c_name,
          godownName: sourceLocationCode,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          subcategory: item.sub_group_name || "null",
        };
      });

      type7Promises.push(
        Promise.all(inventoryEntryPromises).then((inventoryEntries) => ({
          voucherNumber: voucherNum,
          voucherDate: moment(firstItem.insert_date).format("DD-MM-YYYY"),
          voucherType: "InterGodownTrfr",
          remark: `The Material sent to ${firstItem.ven_name || firstItem.in_vendor_name || "Vendor"} on challan no ${challanId} dated ${moment(firstItem.insert_date).format("DD-MM-YYYY")}` || "--",
          destinationLocation: destinationLocation,
          inventoryEntriesoutward: inventoryEntries,
        })),
      );
    }

    // Process Type 8: RM Return — voucher no = do challan number; remark = vendor, challan no, date, e-way bill
    const type8Promises = rmReturnStmt.map(async (item) => {
      // const purchaseRate = await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);
      const purchaseRate = useNewWAR
        ? await calculateWARForTallyAPI(item.component_key, item.insert_date, item.rm_location_id ?? item.ID, db)
        : await getWeightedPurchaseRateWithDB(item.component_key, item.insert_date, db);

      const qty = Number(item.qty || 0) + Number(item.other_qty || 0);
      const amount = qty * purchaseRate;

      const sourceLocationCode = item.loc_out_name;
      const destinationLocation = "GDRM001_C25";
      // Voucher number = challan + transfer id (MIN/25-26/20642 jaisa mat dikhao, sirf last part 20642)
      const challanNo = item.in_invoice_id && item.in_invoice_id !== "--" ? item.in_invoice_id : item.transfer_transaction_id || "--";
      const rawTransferId = item.transfer_transaction_id && item.transfer_transaction_id !== "--" ? item.transfer_transaction_id : "";
      const transferId = rawTransferId.includes("/") ? rawTransferId.split("/").pop() : rawTransferId;
      const voucherNum = challanNo !== "--" && transferId ? `${challanNo}_${transferId}` : challanNo;

      const vendorName = item.ven_name || item.in_vendor_name || "--";
      const challanDate = moment(item.insert_date).format("DD-MM-YYYY");
      const ewayBillNo = item.min_ewaybill && item.min_ewaybill !== "--" ? item.min_ewaybill : "--";
      const remark = `Being Material return from ${vendorName} on challan no ${challanNo} dated ${challanDate} and E-way Bill No ${ewayBillNo}`;

      return {
        voucherNumber: voucherNum,
        voucherDate: moment(item.insert_date).format("DD-MM-YYYY"),
        voucherType: "Stock Journal",
        remark: remark,
        destinationLocation: destinationLocation,
        inventoryEntry: {
          stockItemName: item.c_part_no || item.c_new_part_no,
          stockItemDescription: item.c_name,
          godownName: sourceLocationCode,
          quantity: qty,
          uom: item.units_name || "Pcs",
          rate: purchaseRate,
          amount: amount,
          subcategory: item.sub_group_name || "null",
        },
      };
    });

    // Wait for all promises to resolve in parallel
    const allResults = await Promise.all([
      ...type1Promises,
      ...type2Promises,
      ...type3Promises,
      ...type4Promises,
      ...type5Promises,
      ...type6Promises,
      ...type7Promises,
      ...type8Promises,
    ]);

    const voucherMap = new Map();

    for (const item of allResults) {
      const key = item.voucherNumber;

      // Type 7 already has inventoryEntriesoutward array, so handle it differently
      if (item.inventoryEntriesoutward && Array.isArray(item.inventoryEntriesoutward)) {
        // This is already a complete voucher (Type 7)
        voucherMap.set(key, item);
      } else if (voucherMap.has(key)) {
        // Existing voucher, add entry
        voucherMap.get(key).inventoryEntriesoutward.push(item.inventoryEntry);
      } else {
        // New voucher
        voucherMap.set(key, {
          voucherNumber: item.voucherNumber,
          voucherDate: item.voucherDate,
          voucherType: item.voucherType,
          remark: item.remark,
          destinationLocation: item.destinationLocation,
          inventoryEntriesoutward: [item.inventoryEntry],
        });
      }
    }

    //Convert map to array
    const vouchers = Array.from(voucherMap.values());

    // Sort by date (most recent first)
    vouchers.sort((a, b) => {
      const dateA = moment(a.voucherDate, "DD-MM-YYYY");
      const dateB = moment(b.voucherDate, "DD-MM-YYYY");
      return dateB.diff(dateA);
    });

    if (!vouchers.length) {
      return res.status(404).json({
        status: "error",
        message: "No data found for the specified date range",
      });
    }

    // Calculate total amount by summing all inventory entries in all vouchers
    const totalAmount = vouchers.reduce((sum, voucher) => {
      const voucherTotal = voucher.inventoryEntriesoutward.reduce((vSum, entry) => vSum + entry.amount, 0);
      return sum + voucherTotal;
    }, 0);

    return res.status(200).json({
      status: "success",
      header: {
        fromDate: from.format("DD-MM-YYYY"),
        toDate: to.format("DD-MM-YYYY"),
        totalVouchers: vouchers.length,
        totalAmount: Number(totalAmount.toFixed(2)),
        voucherSubType: "IntergodownTransferJournal",
      },
      vouchers: vouchers,
    });
  } catch (error) {
    console.error("Error in /stock_journal:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

module.exports = router;

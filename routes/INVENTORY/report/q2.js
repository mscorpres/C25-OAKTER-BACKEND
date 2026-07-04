let { invtDB } = require("../../../config/db/connection");

const { decode } = require("html-entities");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");

const VENDOR_TYPES = {
  v01: "Vendor",
  j01: "JWI",
  s01: "SortIn",
  r01: "RejIn",
  p01: "ProdIn",
};

// Utility functions
const checkNegativeValue = (value) => (value < 0 ? 0 : value);

const byID = (a, b) => b.rm_id - a.rm_id;
const toStockDisplay = (val) =>
  helper.number(Math.max(0, Math.floor(Number(val) || 0)));

const locationCache = new Map();
const vendorCache = new Map();

async function getLocationName(locationKey) {
  if (locationKey === "--" || !locationKey) return "--";

  if (locationCache.has(locationKey)) {
    return locationCache.get(locationKey);
  }

  try {
    const result = await invtDB.query(
      "SELECT loc_name FROM location_main WHERE location_key = :location_key",
      {
        replacements: { location_key: locationKey },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const locationName = result.length > 0 ? result[0].loc_name : "--";
    locationCache.set(locationKey, locationName);
    return locationName;
  } catch (error) {
    console.error("Error fetching location:", error);
    return "--";
  }
}

async function getVendorDetails(vendorId) {
  if (!vendorId || vendorId === "" || vendorId === 0 || vendorId === "--") {
    return { name: "N/A", code: "N/A" };
  }

  if (vendorCache.has(vendorId)) {
    return vendorCache.get(vendorId);
  }

  try {
    const result = await invtDB.query(
      "SELECT ven_name, ven_register_id FROM ven_basic_detail WHERE ven_register_id = :vendorId",
      {
        replacements: { vendorId },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const vendorDetails =
      result.length > 0
        ? { name: result[0].ven_name, code: result[0].ven_register_id }
        : { name: "N/A", code: "N/A" };

    vendorCache.set(vendorId, vendorDetails);
    return vendorDetails;
  } catch (error) {
    console.error("Error fetching vendor details:", error);
    return { name: "N/A", code: "N/A" };
  }
}

// Calculate opening balance from ALL previous transactions (like Q5 logic but with session boundary)
async function getOpeningBalance(componentKey, location, currentSession) {
  try {
    // Get session start date for current session
    const sessionStartYear = parseInt(currentSession.split("-")[0]);
    const sessionStartDate = `20${sessionStartYear}-04-01 00:00:00`;

    // Get all inward transactions before current session start
    const inwardResult = await invtDB.query(
      `SELECT COALESCE(SUM(qty), 0) AS total_inward 
       FROM rm_location 
       WHERE components_id = :component 
         AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') 
         AND loc_in = :location 
         AND DATE_FORMAT(insert_date, '%Y-%m-%d %H:%i:%s') < :sessionStartDate`,
      {
        replacements: {
          component: componentKey,
          location,
          sessionStartDate: sessionStartDate,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    // Get all outward transactions before current session start
    const outwardResult = await invtDB.query(
      `SELECT COALESCE(SUM(qty), 0) AS total_outward 
       FROM rm_location 
       WHERE components_id = :component 
         AND trans_type IN ('SFg-CONSUMPTION','CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') 
         AND loc_out = :location 
         AND DATE_FORMAT(insert_date, '%Y-%m-%d %H:%i:%s') < :sessionStartDate`,
      {
        replacements: {
          component: componentKey,
          location,
          sessionStartDate: sessionStartDate,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const inward = helper.number(inwardResult[0]?.total_inward || 0);
    const outward = helper.number(outwardResult[0]?.total_outward || 0);

    return inward - outward;
  } catch (error) {
    console.error("Error calculating opening balance:", error);
    return 0;
  }
}

async function getWeightedPurchaseRate(componentKey, date, session) {
  try {
    const sessionStartYear = parseInt(session.split("-")[0]);
    const startDate = `20${sessionStartYear.toString().padStart(2, "0")}-04-01 00:00:00`;

    const query = `
      SELECT
        COALESCE(SUM((in_po_rate * exchange_rate * qty) + custom_duty + freight_charge), 0) AS sum_amount,
        COALESCE(SUM(qty), 0) AS sum_qty
      FROM rm_location
      WHERE components_id = :componentKey
        AND DATE_FORMAT(insert_date, '%Y-%m-%d %H:%i:%s') BETWEEN :startDate AND :date
        AND trans_type IN('INWARD')
        AND (in_module != 'IN-FGRETURN')
        AND txn_session = :session
    `;

    const [result, averageRateResult] = await Promise.all([
      invtDB.query(query, {
        replacements: {
          componentKey,
          date,
          startDate,
          session,
        },
        type: invtDB.QueryTypes.SELECT,
      }),
      invtDB.query(
        "SELECT average_rate, closing_qty FROM tbl_average_rate WHERE component_key = :componentKey",
        {
          replacements: { componentKey },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
    ]);

    const averageRate =
      averageRateResult.length > 0
        ? averageRateResult[0]
        : { average_rate: 0, closing_qty: 0 };

    const { sum_amount, sum_qty } = result[0];
    const avgValue =
      Number(averageRate.average_rate) * Number(averageRate.closing_qty);
    const totalValue = sum_amount + avgValue;
    const totalQty = sum_qty + Number(averageRate.closing_qty);

    const weightedPurchaseRate = totalQty > 0 ? totalValue / totalQty : 0;

    return {
      weightedPurchaseRate: Number.isNaN(weightedPurchaseRate)
        ? 0
        : Number(weightedPurchaseRate.toFixed(2)),
      sum_value: totalValue,
      sum_qty: totalQty,
    };
  } catch (error) {
    console.error("Error fetching Weighted Purchase Rate:", error);
    return {
      weightedPurchaseRate: 0,
      sum_value: 0,
      sum_qty: 0,
    };
  }
}

function getTransactionDetails(item) {
  const transactionMap = {
    INWARD: {
      mode: "MIN",
      label: "INWARD",
      qty_in: item.qty,
      qty_out: 0,
      rate: (
        item.in_po_rate * item.exchange_rate +
        (Number(item.custom_duty) + Number(item.freight_charge)) / item.qty
      ).toFixed(2),
      transaction_id:
        item.in_transaction_id !== "--"
          ? item.in_transaction_id
          : (item.transfer_transaction_id ?? "--"),
    },
    ISSUE: {
      mode: "ISSUE",
      label: "ISSUE",
      qty_in: 0,
      qty_out: item.qty,
      rate: 0,
      transaction_id: item.out_transaction_id ?? "NA",
    },
    CONSUMPTION: (item) => {
      if (item.in_module === "PART-CONV") {
        return {
          mode: "CONVRSN",
          label: "CONVERSION",
          qty_in: 0,
          qty_out: item.qty,
          rate: 0,
          transaction_id:
            item.out_transaction_id !== "--"
              ? item.out_transaction_id
              : (item.transfer_transaction_id ?? "--"),
        };
      }
      if (item.in_module === "--") {
        return {
          mode: "CONSUMP",
          label: "CONSUMPTION",
          qty_in: 0,
          qty_out: item.qty,
          rate: 0,
          transaction_id:
            item.in_module === "PART-CONV" || item.in_module === "CONSUMPTION"
              ? (item.out_transaction_id ?? "NA")
              : item.mfg_ppr_trans_id_2 !== "--"
                ? item.mfg_ppr_trans_id_2
                : (item.jw_transaction_id ?? "--"),
        };
      }

      return {};
    },
    "SFG-CONSUMPTION": {
      mode: "CONSUMP",
      label: "CONSUMPTION",
      qty_in: 0,
      qty_out: item.qty,
      rate: 0,
      transaction_id: item.jw_transaction_id ?? "NA",
    },
    JOBWORK: {
      mode: "JOBWORK",
      label: "JOBWORK",
      qty_in: item.qty,
      qty_out: item.qty,
      rate: 0,
      transaction_id: item.jw_transaction_id ?? "NA",
    },
    TRANSFER: {
      mode: "TRANSFER",
      label: "TRANSFER",
      qty_in: item.qty,
      qty_out: item.qty,
      rate: 0,
      transaction_id: item.transfer_transaction_id ?? "--",
    },
    REJECTION: {
      mode: "REJECTION",
      label: "REJECTION",
      qty_in: 0,
      qty_out: item.qty,
      rate: 0,
      transaction_id:
        item.rej_transaction_id !== "--"
          ? item.rej_transaction_id
          : (item.transfer_transaction_id ?? "NA"),
    },
    CANCELLED: {
      mode: "CANCELLED",
      label: "CANCELLED",
      qty_in: item.qty,
      qty_out: item.qty,
      rate: 0,
      transaction_id: getValidTransactionId(item),
    },
  };

  const result = transactionMap[item.trans_type];

  return (
    (typeof result === "function" ? result(item) : result) || {
      mode: "N/A",
      label: "N/A",
      qty_in: "N/A",
      qty_out: "N/A",
      rate: 0,
      transaction_id: "--",
    }
  );
}

function getValidTransactionId(item) {
  const ids = [
    item.in_transaction_id,
    item.out_transaction_id,
    item.transfer_transaction_id,
    item.rej_transaction_id,
    item.jw_transaction_id,
    item.mfg_ppr_trans_id_2,
  ];

  return ids.find((id) => id && id !== "--") || "NA";
}

async function processTransactionData(stmt2, componentKey, session, offset) {
  const promises = stmt2.map(async (item, index) => {
    const transactionDetails = getTransactionDetails(item);
    const vendorType = VENDOR_TYPES[item.vendor_type] || "--";

    const [locationIn, locationOut, vendorDetails, weightedRate] =
      await Promise.all([
        getLocationName(item.loc_in),
        getLocationName(item.loc_out),
        getVendorDetails(item.in_vendor_name),

        require("../../../helper/utils/newAvgRate").newWeightedAverageRate(
          componentKey,
          moment(item.inward_date).format("YYYY-MM-DD HH:mm:ss"),
          item.rm_id,
        ),
      ]);

    let outRate = 0;
    if (["CONSUMPTION", "ISSUE"].includes(transactionDetails.label)) {
      outRate = weightedRate.weightedPurchaseRate;
    } else if (transactionDetails.label === "JOBWORK") {
      outRate = item.in_po_rate * item.exchange_rate;
    }

    return {
      serialNo: offset + index + 1,
      rowCount: item.row_id,

      vendorType: vendorType,
      vendorName: vendorDetails.name,
      vendorCode: vendorDetails.code,

      qtyIn: toStockDisplay(transactionDetails.qty_in),
      qtyOut: toStockDisplay(transactionDetails.qty_out),
      qtyInRate: transactionDetails.rate,
      finalRate: item.final_rate,
      weightedPurchaseRate: weightedRate.weightedPurchaseRate,
      totalValue: weightedRate.sum_value,
      outRate: outRate,
      rate: item.final_rate !== "0" ? item.final_rate : item.in_po_rate,
      weightedPurchaseRateCurrency: "INR",

      transactionBy: (
        item.user_name?.toString().split(" ")[0] || "N/A"
      ).toUpperCase(),

      locationIn: locationIn,
      locationOut: locationOut,

      transactionID: transactionDetails.transaction_id,
      transactionType: transactionDetails.label,
      transactionMode: transactionDetails.mode,
      transactionDate: moment(item.inward_date, "YYYY-MM-DD HH:mm:ss").format(
        "DD-MM-YYYY HH:mm:ss",
      ),

      tbl_weighted_rate: weightedRate,

      remark:
        item.any_remark && item.any_remark !== "--"
          ? item.any_remark
          : item.rejection_any_remark && item.rejection_any_remark !== "--"
            ? item.rejection_any_remark
            : "--",
    };
  });

  const data = await Promise.all(promises);
  return data.sort(byID);
}

async function getSessionWiseQuantities(componentKey, location, session) {
  const [inwardResult, outwardResult] = await Promise.all([
    invtDB.query(
      `SELECT COALESCE(SUM(qty), 0) AS Inward 
       FROM rm_location 
       WHERE components_id = :component 
         AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') 
         AND loc_in = :location 
         AND txn_session = :session`,
      {
        replacements: { component: componentKey, location, session },
        type: invtDB.QueryTypes.SELECT,
      },
    ),
    invtDB.query(
      `SELECT COALESCE(SUM(qty), 0) AS Outward 
       FROM rm_location 
       WHERE components_id = :component 
         AND trans_type IN ('SFG-CONSUMPTION','CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') 
         AND loc_out = :location 
         AND txn_session = :session`,
      {
        replacements: { component: componentKey, location, session },
        type: invtDB.QueryTypes.SELECT,
      },
    ),
  ]);
  return {
    inward: helper.number(inwardResult[0]?.Inward || 0),
    outward: helper.number(outwardResult[0]?.Outward || 0),
  };
}

async function getBOMDetails(componentKey) {
  const bomResult = await invtDB.query(
    `SELECT p_name, product_sku, qty, subject_name 
     FROM bom_quantity 
     LEFT JOIN bom_recipe ON bom_recipe.subject_id = bom_quantity.subject_under 
     LEFT JOIN products ON products.p_sku = bom_recipe.bom_product_sku 
     WHERE bom_quantity.component_id = :component 
       AND bom_quantity.bom_status IN ('A')`,
    {
      replacements: { component: componentKey },
      type: invtDB.QueryTypes.SELECT,
    },
  );

  const bomDetailsBySku = {};
  bomResult.forEach((item) => {
    if (!bomDetailsBySku[item.product_sku]) {
      bomDetailsBySku[item.product_sku] = [];
    }
    bomDetailsBySku[item.product_sku].push({
      sku: item.product_sku,
      bom_name: item.subject_name,
      bom_qty: item.qty,
      product: item.p_name,
    });
  });

  return bomDetailsBySku;
}

router.get("/view", [auth.isAuthorized], async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const key = req.query.key.trim();
    const location = req.query.location.trim();

    if (!key) {
      return res.json({
        status: "error",
        message: "Please supply component part code",
        success: false,
      });
    }

    if (!location) {
      return res.json({
        status: "error",
        message: "Please supply location",
        success: false,
      });
    }

    // Get session from request
    const session = req.session;
    if (!session) {
      return res.json({
        status: "error",
        message: "Session not found",
        success: false,
      });
    }

    // Get component details
    const componentResult = await invtDB.query(
      `SELECT * FROM components 
       LEFT JOIN units ON units.units_id = components.c_uom 
       WHERE (components.c_part_no = :partcode OR components.component_key = :partcode) 
         AND c_is_enabled = 'Y'`,
      {
        replacements: { partcode: key },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (componentResult.length === 0) {
      return res.json({
        status: "error",
        message: "No component found",
        success: false,
      });
    }

    const component = componentResult[0];

    const totalCountResult = await invtDB.query(
      `SELECT COUNT(*) as total
       FROM rm_location 
       LEFT JOIN components 
         ON rm_location.components_id = components.component_key 
       WHERE rm_location.components_id = :component 
         AND components.c_is_enabled = 'Y' 
         AND rm_location.txn_session = :session 
         AND (
           rm_location.loc_in = :location 
           OR rm_location.loc_out = :location
         )`,
      {
        replacements: {
          component: component.component_key,
          session: session,
          location: location,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const totalRecords = totalCountResult[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / limit);

    const transactionResult = await invtDB.query(
      `SELECT *,

              rm_location.insert_date AS inward_date,
              rm_location.ID AS rm_id,
              rm_location.w_avr_rate AS w_avr_rate
       FROM rm_location 
       LEFT JOIN components 
         ON rm_location.components_id = components.component_key 
       LEFT JOIN admin_login 
         ON rm_location.insert_by = admin_login.CustID 
       WHERE rm_location.components_id = :component 
         AND components.c_is_enabled = 'Y' 
         AND rm_location.txn_session = :session 
         AND (
           rm_location.loc_in = :location 
           OR rm_location.loc_out = :location
         )
       ORDER BY rm_location.txn_session,
                rm_location.insert_date DESC,
                rm_location.ID ASC
       LIMIT :limit OFFSET :offset`,
      {
        replacements: {
          component: component.component_key,
          session: session,
          location: location,
          limit: Number(limit),
          offset: Number(offset),
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (transactionResult.length === 0) {
      return res.json({
        status: "error",
        message:
          "No transactions found for the specified component, session, and location",
        success: false,
      });
    }

    const [
      data,
      sessionQuantities,
      openingBalance,
      bomDetails,
      lastTransaction,
      lastUserTransaction,
      lastRateData,
    ] = await Promise.all([
      processTransactionData(
        transactionResult,
        component.component_key,
        session,
        offset,
      ),
      getSessionWiseQuantities(component.component_key, location, session),
      getOpeningBalance(component.component_key, location, session),
      getBOMDetails(component.component_key),
      invtDB.query(
        `SELECT rm_location.*, ims_rm_audit.*, admin_login.user_name 
         FROM rm_location 
         LEFT JOIN ims_rm_audit 
           ON rm_location.components_id = ims_rm_audit.component_key 
         LEFT JOIN admin_login 
           ON admin_login.CustID = ims_rm_audit.audit_by 
         WHERE rm_location.components_id = :component 
           AND rm_location.trans_type = 'INWARD' 
           AND rm_location.txn_session = :session
           AND (
             rm_location.loc_in = :location 
             OR rm_location.loc_out = :location
           )
           AND ims_rm_audit.ID = (
             SELECT MAX(ID) 
             FROM ims_rm_audit 
             WHERE component_key = :component
           ) 
         ORDER BY rm_location.insert_date DESC 
         LIMIT 1`,
        {
          replacements: {
            component: component.component_key,
            session: session,
            location: location,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
      invtDB.query(
        `SELECT * 
         FROM rm_location 
         LEFT JOIN admin_login 
           ON rm_location.insert_by = admin_login.CustID 
         WHERE rm_location.components_id = :component 
           AND rm_location.txn_session = :session 
           AND (
             rm_location.loc_in = :location 
             OR rm_location.loc_out = :location
           )
         ORDER BY rm_location.insert_date DESC 
         LIMIT 1`,
        {
          replacements: {
            component: component.component_key,
            session: session,
            location: location,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
      invtDB.query(
        `SELECT rm_location.in_po_rate, ims_currency.currency_symbol 
         FROM rm_location 
         LEFT JOIN ims_currency 
           ON ims_currency.currency_id = rm_location.currency_type 
         WHERE rm_location.components_id = :component 
           AND rm_location.trans_type = 'INWARD' 
           AND rm_location.vendor_type = 'v01' 
           AND rm_location.txn_session = :session 
           AND (
             rm_location.loc_in = :location 
             OR rm_location.loc_out = :location
           )
         ORDER BY rm_location.insert_date DESC 
         LIMIT 1`,
        {
          replacements: {
            component: component.component_key,
            session: session,
            location: location,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
    ]);

    const lastAuditInfo =
      lastTransaction.length > 0
        ? {
          remark: lastTransaction[0].audit_remark || "N/A",
          date: lastTransaction[0].audit_dt
            ? moment(
              lastTransaction[0].audit_dt,
              "YYYY-MM-DD HH:mm:ss",
            ).format("DD-MM-YYYY HH:mm:ss")
            : "N/A",
          by: lastTransaction[0].user_name || "N/A",
        }
        : { remark: "N/A", date: "N/A", by: "N/A" };

    const lastRate =
      lastRateData.length > 0
        ? `${lastRateData[0].currency_symbol || ""} ${helper.number(
          lastRateData[0].in_po_rate,
        )}`
        : "N/A";

    const closingQuantity =
      openingBalance + sessionQuantities.inward - sessionQuantities.outward;

    const lastInwardTransaction = transactionResult.find(
      (item) => item.trans_type === "INWARD",
    );

    const lastUserInfo =
      lastUserTransaction.length > 0 ? lastUserTransaction[0] : null;

    const lastVendorDetails = lastInwardTransaction
      ? await getVendorDetails(lastInwardTransaction.in_vendor_name)
      : { name: "N/A", code: "N/A" };

    const lastInwardDate = lastInwardTransaction
      ? moment(lastInwardTransaction.inward_date).format("DD-MM-YYYY HH:mm:ss")
      : "--";

    return res.json({
      status: "success",
      success: true,
      pagination: {
        currentPage: page,
        limit: limit,
        totalRecords: totalRecords,
        totalPages: totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      data: {
        header: {
          partNo: `${transactionResult[0].c_part_no}(${component.c_new_part_no})`,
          partName: decode(transactionResult[0].c_name),
          uom: component.units_name,
          openingBalance: toStockDisplay(openingBalance),
          sessionInward: toStockDisplay(sessionQuantities.inward),
          sessionOutward: toStockDisplay(sessionQuantities.outward),
          closingqty: toStockDisplay(closingQuantity),
          lastInDate: lastInwardDate,
          lastRate: lastRate,
          lastVendor: lastVendorDetails.name,
          lastVendorCode: lastVendorDetails.code,
          lastEntryBy: lastUserInfo
            ? (
              lastUserInfo.user_name?.toString().split(" ")[0] || "N/A"
            ).toUpperCase()
            : "N/A",
          lastEntryDate: lastUserInfo
            ? moment(lastUserInfo.insert_date).format("DD-MM-YYYY HH:mm:ss")
            : "N/A",
          uniqueID: transactionResult[0].attribute_code,
          mfgCode: component.manufacturing_code,
          session: session,
          location: location,
          bomDetails: bomDetails,
          lastRemark: lastAuditInfo.remark,
          lastPhysicalEntryDt: lastAuditInfo.date,
          lastPhysicalEntryBy: lastAuditInfo.by,
        },
        body: data,
      },
    });
  } catch (error) {
    console.error("Error in inventory transaction route:", error);
    return helper.errorResponse(res, err);
  }
});

module.exports = router;

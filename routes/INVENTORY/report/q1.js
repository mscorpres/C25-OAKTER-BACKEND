let { invtDB } = require("../../../config/db/connection");

const { decode } = require("html-entities");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const Validator = require("validatorjs");

const VENDOR_TYPES = {
  v01: "Vendor",
  j01: "JWI",
  s01: "SortIn",
  r01: "RejIn",
  p01: "ProdIn",
};

// Utility functions
const checkNegativeValue = (value) => (value < 0 ? 0 : value.toFixed(2));

// Cache for location and vendor lookups
const locationCache = new Map();
const vendorCache = new Map();

function byDate(a, b) {
  const d1 = new Date(moment(a.date, "DD-MM-YYYY HH:mm:ss"));
  const d2 = new Date(moment(b.date, "DD-MM-YYYY HH:mm:ss"));
  return d2 - d1;
}

async function getLocationName(locationKey) {
  if (!locationKey || locationKey === "" || locationKey === "--") return "--";
  if (locationCache.has(locationKey)) return locationCache.get(locationKey);

  try {
    const result = await invtDB.query(
      "SELECT loc_name FROM `location_main` WHERE `location_key` = :locationKey",
      { replacements: { locationKey }, type: invtDB.QueryTypes.SELECT },
    );
    const name = result.length > 0 ? decode(result[0].loc_name) : "--";
    locationCache.set(locationKey, name);
    return name;
  } catch {
    return "--";
  }
}

async function getVendorDetails(vendorId) {
  if (!vendorId || vendorId === "" || vendorId === "--") {
    return { name: "--", code: "--" };
  }
  if (vendorCache.has(vendorId)) return vendorCache.get(vendorId);

  try {
    const result = await invtDB.query(
      "SELECT ven_name, ven_register_id FROM `ven_basic_detail` WHERE `ven_register_id` = :vendorId",
      { replacements: { vendorId }, type: invtDB.QueryTypes.SELECT },
    );
    const details =
      result.length > 0
        ? { name: result[0].ven_name, code: result[0].ven_register_id }
        : { name: "--", code: "--" };
    vendorCache.set(vendorId, details);
    return details;
  } catch {
    return { name: "--", code: "--" };
  }
}

function getTransactionDetails(item) {
  const type = item.trans_type;

  if (type === "INWARD") {
    return {
      mode: "MIN",

      label: "INWARD",
      qty_in: item.qty,
      qty_out: 0,
      transaction_id:
        item.in_transaction_id !== "--"
          ? item.in_transaction_id
          : (item.transfer_transaction_id ?? "--"),
    };
  }
  if (type === "ISSUE") {
    return {
      mode: "ISSUE",

      label: "ISSUE",
      qty_in: 0,
      qty_out: item.qty,
      transaction_id: item.out_transaction_id ?? "NA",
    };
  }
  if (type === "CONSUMPTION" && item.in_module === "--") {
    return {
      mode: "CONSUMP",

      label: "CONSUMPTION",
      qty_in: 0,
      qty_out: item.qty,
      transaction_id:
        item.in_module === "PART-CONV" || item.in_module === "CONSUMPTION"
          ? (item.out_transaction_id ?? "NA")
          : item.mfg_ppr_trans_id_2 !== "--"
            ? item.mfg_ppr_trans_id_2
            : (item.jw_transaction_id ?? "--"),
    };
  }
  if (type === "CONSUMPTION" && item.in_module === "PART-CONV") {
    return {
      mode: "CONVRSN",

      label: "CONVERSION",
      qty_in: 0,
      qty_out: item.qty,
      transaction_id:
        item.out_transaction_id !== "--"
          ? item.out_transaction_id
          : (item.transfer_transaction_id ?? "--"),
    };
  }
  if (type === "SFG-CONSUMPTION") {
    return {
      mode: "CONSUMP",

      label: "CONSUMPTION",
      qty_in: 0,
      qty_out: item.qty,
      transaction_id: item.jw_transaction_id ?? "NA",
    };
  }
  if (type === "JOBWORK") {
    return {
      mode: "JOBWORK",

      label: "JOBWORK",
      qty_in: item.qty,
      qty_out: item.qty,
      transaction_id: item.jw_transaction_id ?? "NA",
    };
  }
  if (type === "TRANSFER") {
    return {
      mode: "TRANSFER",

      label: "TRANSFER",
      qty_in: item.qty,
      qty_out: item.qty,
      transaction_id: item.transfer_transaction_id ?? "--",
    };
  }
  if (type === "REJECTION") {
    return {
      mode: "REJECTION",

      label: "REJECTION",
      qty_in: 0,
      qty_out: item.qty,
      transaction_id:
        item.rej_transaction_id !== "--"
          ? item.rej_transaction_id
          : (item.transfer_transaction_id ?? "NA"),
    };
  }
  if (type === "CANCELLED") {
    const ids = [
      item.in_transaction_id,
      item.out_transaction_id,
      item.transfer_transaction_id,
      item.rej_transaction_id,
      item.jw_transaction_id,
      item.mfg_ppr_trans_id_2,
    ];
    return {
      mode: "CANCELLED",

      label: "CANCELLED",
      qty_in: item.qty,
      qty_out: item.qty,
      transaction_id: ids.find((id) => id && id !== "--") || "NA",
    };
  }

  return {
    mode: "N/A",
    label: "N/A",
    qty_in: "N/A",
    qty_out: "N/A",
    transaction_id: "--",
  };
}

router.get("/view", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.query.wise?.trim();
  const searchValue = req.query.data?.trim();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const validation = new Validator(req.query, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
  }

  try {
    if (searchBy !== "C") {
      return res.json({
        success: false,
        message: "no any transaction found",
        status: "error",
      });
    }

    if (!searchValue) {
      return res.json({
        success: false,
        message: "Please supply component / code",
        status: "error",
      });
    }

    const stmt1 = await invtDB.query(
      "SELECT * FROM `components` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `components`.`c_part_no` = :partcode OR `components`.`component_key` = :partcode AND c_is_enabled = 'Y'",
      {
        replacements: { partcode: searchValue },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (stmt1.length === 0) {
      return res.json({
        success: false,
        message: "no any transaction found",
        status: "error",
      });
    }

    const componentKey = stmt1[0].component_key;

    const [countQuery, stmt2] = await Promise.all([
      invtDB.query(
        "SELECT COUNT(*) as total FROM `rm_location` WHERE `components_id` = :component AND components_id IN (SELECT component_key FROM components WHERE c_is_enabled = 'Y')",
        {
          replacements: { component: componentKey },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
      invtDB.query(
        `SELECT rm_location.ID AS rm_id, 
    rm_location.*, rm_location.insert_date AS inward_date, components.c_name, components.c_part_no, components.c_new_part_no,  admin_login.user_name FROM rm_location LEFT JOIN components ON rm_location.components_id = components.component_key LEFT JOIN admin_login ON rm_location.insert_by = admin_login.CustID WHERE rm_location.components_id = :component AND components.c_is_enabled = 'Y' ORDER BY rm_location.insert_date DESC LIMIT :limit OFFSET :offset`,
        {
          replacements: { component: componentKey, limit, offset },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
    ]);

    if (stmt2.length === 0) {
      return res.json({
        success: false,
        message: "no any transaction found",
        status: "error",
      });
    }

    const totalRecords = countQuery[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    const data = await Promise.all(
      stmt2.map(async (item, index) => {
        const txn = getTransactionDetails(item);
        const vendorType = VENDOR_TYPES[item.vendor_type] || "--";

        const [location_in, location_out, vendorDetails, weightedPurchaseRate] =
          await Promise.all([
            getLocationName(item.loc_in),
            getLocationName(item.loc_out),
            getVendorDetails(item.in_vendor_name),

            require("../../../helper/utils/newAvgRate").newWeightedAverageRate(
              item.components_id,
              moment(item.inward_date).format("YYYY-MM-DD HH:mm:ss"),
              item.rm_id,
            ),
          ]);

        const name = item.user_name
          ? item.user_name.toString().split(" ")[0]
          : "N/A";

        let out_rate = 0;
        if (txn.label === "CONSUMPTION" || txn.label === "ISSUE") {
          out_rate = weightedPurchaseRate;
        }
        if (txn.label === "JOBWORK") {
          out_rate = item.in_po_rate * item.exchange_rate;
        }

        return {
          serialNo: offset + index + 1,

          vendorType,
          vendorName: vendorDetails.name,
          vendorCode: vendorDetails.code,

          qtyIn: helper.number(txn.qty_in),
          qtyOut: helper.number(txn.qty_out),

          weightedPurchaseRate,
          rate: item.final_rate !== "0" ? item.final_rate : item.in_po_rate,

          transactionBy: name.toUpperCase(),

          locationIn: location_in,
          locationOut: location_out,

          transactionID: txn.transaction_id,
          transactionType: txn.label,
          transactionMode: txn.mode,
          transactionDate: moment(
            item.inward_date,
            "YYYY-MM-DD HH:mm:ss",
          ).format("DD-MM-YYYY HH:mm:ss"),

          tbl_weighted_rate: weightedPurchaseRate,
        };
      }),
    );

    const [stmt6, stmt7, stmt8, stmt9, stmt10] = await Promise.all([
      // ALL INWARD
      invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER')",
        {
          replacements: { component: componentKey },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
      // ALL OUTWARD
      invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER')",
        {
          replacements: { component: componentKey },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
      // LAST INWARD TRANSACTION
      invtDB.query(
        "SELECT * FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD') ORDER BY `insert_date` DESC LIMIT 1",
        {
          replacements: { component: componentKey },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
      // LAST ENTRY
      invtDB.query(
        "SELECT * FROM `rm_location` LEFT JOIN `admin_login` ON rm_location.insert_by = admin_login.CustID WHERE `rm_location`.`components_id` = :component ORDER BY `rm_location`.`insert_date` DESC LIMIT 1",
        {
          replacements: { component: componentKey },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
      // LAST RATE
      invtDB.query(
        "SELECT rm_location.in_po_rate, ims_currency.currency_symbol FROM `rm_location` LEFT JOIN ims_currency ON ims_currency.currency_id = rm_location.currency_type WHERE rm_location.`components_id` = :component AND rm_location.`trans_type` = 'INWARD' AND (rm_location.`vendor_type` = 'v01') ORDER BY rm_location.`insert_date` DESC LIMIT 1",
        {
          replacements: { component: componentKey },
          type: invtDB.QueryTypes.SELECT,
        },
      ),
    ]);

    const inward_all_qty =
      stmt6.length > 0 ? helper.number(stmt6[0].Inward) : 0;
    const outward_all_qty =
      stmt7.length > 0 ? helper.number(stmt7[0].Outward) : 0;

    let vendor_type = "N/A";
    let vendorDate = "N/A";
    if (stmt8.length > 0) {
      vendor_type = VENDOR_TYPES[stmt8[0].vendor_type] || "N/A";
      vendorDate = moment(stmt8[0].insert_date).format("DD-MM-YYYY");
    }

    let user = "N/A";
    let date = "N/A";
    if (stmt9.length > 0) {
      user = stmt9[0].user_name;
      date = moment(stmt9[0].approve_date).format("DD-MM-YYYY");
    }

    let last_in_rate = "N/A";
    if (stmt10.length > 0) {
      last_in_rate =
        stmt10[0].currency_symbol == null
          ? ""
          : stmt10[0].currency_symbol +
          " " +
          helper.number(stmt10[0].in_po_rate);
    }

    data.sort(byDate);

    return res.json({
      status: "success",
      success: true,
      data: {
        header: {
          partCode: stmt2[0].c_part_no + " (" + stmt2[0].c_new_part_no + ")",
          partName: decode(stmt2[0].c_name),
          uom: stmt1[0].units_name,
          closingQty: inward_all_qty - outward_all_qty,
          lastIN: vendorDate + " / " + vendor_type,
          lastRate: last_in_rate,
          uniqueID: stmt2[0].attribute_code,
        },
        body: data,
        pagination: {
          currentPage: page,
          totalPages,
          totalRecords,
          recordsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      },
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

module.exports = router;

let { invtDB } = require("../../../config/db/connection");



const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");

router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    // Input validation
    const validation = new Validator(req.body, {
      wise: "required|in:datewise,skuwise",
      data: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: validation.errors.all(),
      });
    }

    const { wise, data, advanced = false, dateRange = null } = req.body;

    // Validate date range for advanced mode
    if (advanced && (!dateRange || !isValidDateRange(dateRange))) {
      return res.json({
        status: "error",
        success: false,
        message: "Invalid or missing date range for advanced filter",
      });
    }

    // Build query parameters
    const queryParams = buildQueryParams(wise, data, advanced, dateRange);
    if (queryParams.error) {
      return res.json(queryParams.error);
    }

    // Execute optimized query
    const productionData = await executeOptimizedQuery(queryParams);

    if (!productionData || productionData.length === 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Data Not Found",
      });
    }

    // Process results efficiently
    const result = await processResults(productionData);

    return res.json({
      status: "success",
      success: true,
      data: result,
      total: result.length,
    });
  } catch (error) {
    console.error("Production API Error:", error);
    return helper.errorResponse(res, err);
  }
});

// Helper Functions
function isValidDateRange(dateRange) {
  const dateRegex = /([0-9]{2})-([0-9]{2})-([0-9]{4})/g;
  const dates = dateRange.match(dateRegex);
  return dates && dates.length === 2;
}

function buildQueryParams(wise, data, advanced, dateRange) {
  const params = { replacements: {} };

  try {
    // Handle date validation and formatting
    if (wise === "datewise" || advanced) {
      const dateString = wise === "datewise" ? data : dateRange;
      const dates = dateString.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      if (!dates || dates.length !== 2) {
        return {
          error: {
            status: "error",
            success: false,
            message: "Invalid date format. Expected DD-MM-YYYY to DD-MM-YYYY",
          },
        };
      }

      const fromDate = moment(dates[0], "DD-MM-YYYY");
      const toDate = moment(dates[1], "DD-MM-YYYY");

      // Validate date range
      if (!fromDate.isValid() || !toDate.isValid()) {
        return {
          error: {
            status: "error",
            success: false,
            message: "Invalid date values",
          },
        };
      }

      if (fromDate.isAfter(toDate)) {
        return {
          error: {
            success: false,
            status: "error",
            message: "Start date must be before end date",
          },
        };
      }

      const durationInMonths = toDate.diff(fromDate, "months");
      if (durationInMonths > 3) {
        return {
          error: {
            status: "error",
            success: false,
            message: "Date range cannot exceed 3 months (90 days). Effective from Nov 11, 2021",
          },
        };
      }

      params.replacements.date1 = fromDate.format("YYYY-MM-DD");
      params.replacements.date2 = toDate.format("YYYY-MM-DD");
      params.hasDateFilter = true;
    }

    // Handle SKU filter
    if (wise === "skuwise") {
      if (!data || data.trim() === "") {
        return {
          error: {
            status: "error",
            success: false,
            message: "SKU cannot be empty",
          },
        };
      }
      params.replacements.sku = data.trim();
      params.hasSkuFilter = true;
    }

    params.wise = wise;
    params.advanced = advanced;

    return params;
  } catch (error) {
    return {
      error: {
        status: "error",
        success: false,
        message: "Error processing parameters",
      },
    };
  }
}

async function executeOptimizedQuery(params) {
  // Optimized query with DISTINCT to prevent duplicates
  let baseQuery = `
    SELECT DISTINCT 
      mp2.mfg_transaction,
      mp2.mfg_full_date,
      mp2.mfg_prod_planing_qty,
      mp2.mfg_sku,
      mp2.mfg_con_location,
      mp2.mfg_comment,
      mp2.mfg_approved_by,
      mp2.mfg_prod_type,
      mp3.fg_out_remark,
      mp3.fg_status,
      p.p_name,
      p.p_sku,
      p.products_type,
      p.p_uom,
      u.units_name,
      al.user_name
    FROM mfg_production_2 mp2
    LEFT JOIN mfg_production_3 mp3 ON mp3.mfg_ref_transid_2 = mp2.mfg_transaction
    LEFT JOIN products p ON mp2.mfg_sku = p.p_sku
    LEFT JOIN units u ON p.p_uom = u.units_id
    LEFT JOIN admin_login al ON al.CustID = mp2.mfg_approved_by
    WHERE mp2.mfg_prod_type = 'C' AND (mp3.fg_status = 'ACTIVE' OR mp3.fg_status IS NULL)`;

  // Add conditions based on filters
  if (params.hasDateFilter) {
    baseQuery += ` AND DATE(mp2.mfg_full_date) BETWEEN :date1 AND :date2`;
  }

  if (params.hasSkuFilter) {
    baseQuery += ` AND mp2.mfg_sku = :sku`;
  }

  baseQuery += ` ORDER BY mp2.mfg_transaction DESC`;

  const result = await invtDB.query(baseQuery, {
    replacements: params.replacements,
    type: invtDB.QueryTypes.SELECT,
  });

  return result;
}

async function processResults(stmt) {
  // Batch fetch all unique locations to reduce database calls
  const uniqueLocations = [
    ...new Set(stmt.map((item) => item.mfg_con_location).filter(Boolean)),
  ];
  const locationMap = await fetchLocationsBatch(uniqueLocations);

  return stmt.map((item, index) => ({
    serial_no: index + 1,
    date: moment(item.mfg_full_date).format("DD-MM-YYYY HH:mm:ss"),
    mfg_id: item.mfg_transaction,
    mfg_qty: item.mfg_prod_planing_qty,
    productname: item.p_name || "N/A",
    productsku: item.p_sku || "N/A",
    fg_loc: locationMap[item.mfg_con_location] || "N/A",
    unit: item.units_name || "N/A",
    user: item.user_name || "N/A",
    fgtype: getProductType(item.products_type),
    remark: item.mfg_comment || "-",
  }));
}

async function fetchLocationsBatch(locations) {
  if (locations.length === 0) return {};

  const placeholders = locations
    .map((_, index) => `:location${index}`)
    .join(",");
  const replacements = {};
  locations.forEach((location, index) => {
    replacements[`location${index}`] = location;
  });

  const locationQuery = `SELECT location_key, loc_name FROM location_main WHERE location_key IN (${placeholders})`;

  const locationResults = await invtDB.query(locationQuery, {
    replacements,
    type: invtDB.QueryTypes.SELECT,
  });

  // Create a map for O(1) lookup
  const locationMap = {};
  locationResults.forEach((loc) => {
    locationMap[loc.location_key] = loc.loc_name;
  });

  return locationMap;
}

function getProductType(productType) {
  switch (productType) {
    case "default":
      return "FG";
    case "semi":
      return "SEMI FG";
    default:
      return "N/A";
  }
}

// GET MFG CONSUMPTION COMPONENT
router.post(
  "/getMfgConsumptionComponent",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      const validation = new Validator(req.body, {
        mfg_no: "required",
        end_date: "required"
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: validation.errors.all(),
        });
      }

      const { mfg_no } = req.body;

      let stmt0 = await invtDB.query(
        "SELECT `mfg_production_1`.prod_bom_subject FROM mfg_production_2 LEFT JOIN mfg_production_1 ON mfg_production_1.prod_transaction = mfg_production_2.mfg_ref_id WHERE mfg_production_2.mfg_transaction = :mfg_no GROUP BY mfg_production_2.mfg_ref_id LIMIT 1",
        {
          replacements: {
            mfg_no: mfg_no,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      let stmt1 = await invtDB.query(
        "SELECT rm_location.ID AS row_id, rm_location.mfg_bom_qty, rm_location.qty, rm_location.any_remark, rm_location.other_qty, rm_location.insert_date AS mfg_date, rm_location.w_avr_rate, components.c_part_no, components.c_new_part_no , components.c_name, components.component_key, components.components_type, units.units_name, location_main.loc_name, (SELECT bom_quantity.qty FROM bom_quantity WHERE bom_quantity.component_id = components.component_key AND bom_quantity.subject_under = :bom_subject) AS bom_qty FROM rm_location LEFT JOIN components ON rm_location.components_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN location_main ON rm_location.loc_out = location_main.location_key WHERE rm_location.mfg_ppr_trans_id_2 = :mfg_no",
        {
          replacements: {
            mfg_no: mfg_no,
            bom_subject: stmt0[0].prod_bom_subject,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt1.length <= 0) {
        return res.json({
          status: "error",
          success: false,
          message: "Data Not Found",
        });
      }

      const { newWeightedAverageRate, CUTOFF_DATE } = require("../../../helper/utils/newAvgRate");

      const data = [];
      for (let i = 0; i < stmt1.length; i++) {
        let component_type = "N/A";
        if (stmt1[i].components_type == "default") {
          component_type = "RM";
        } else if (stmt1[i].components_type == "semi") {
          component_type = "SR";
        }

        const isAfterCutoff =
          new Date(stmt1[i].mfg_date).getTime() >
          new Date(CUTOFF_DATE).getTime();

        let weightedPurchaseRate;
        if (isAfterCutoff) {
          weightedPurchaseRate = await newWeightedAverageRate(
            stmt1[i].component_key,
            stmt1[i].mfg_date,
            stmt1[i].row_id,
          );
        } else {
          weightedPurchaseRate = parseFloat(stmt1[i].w_avr_rate) || 0;
        }

        data.push({
          serial_no: i + 1,
          cons_qty: Number(stmt1[i].qty) + Number(stmt1[i].other_qty),
          cons_loc: stmt1[i].loc_name,
          partcode: stmt1[i].c_part_no,
          new_partno: stmt1[i].c_new_part_no,
          component: stmt1[i].c_name,
          unit: stmt1[i].units_name,
          comment: stmt1[i].any_remark,
          fgtype: component_type,
          // bom_qty: stmt1[i].bom_qty,
          bom_qty:
            Number(stmt1[i].mfg_bom_qty) <= 0
              ? "--"
              : helper.number(stmt1[i].mfg_bom_qty),
          weightedPurchaseRate: weightedPurchaseRate,
          weightedTotalCost: helper.number(
            (Number(stmt1[i].qty) + Number(stmt1[i].other_qty)) *
            weightedPurchaseRate,
          ),
        });
      }

      return res.json({ status: "success", success: true, data: data });
    } catch (error) {
      return helper.errorResponse(res, err);
    }
  },
);

module.exports = router;

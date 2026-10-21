const express = require("express");
const router = express.Router();
const { invtDB } = require("../../config/db/connection");
const auth = require("../../middleware/auth");
const { getWeightedPurchaseRate } = require("../../helper/utils/avgRate");
const {
  lastNewWeightedAverageRate,
  newWeightedAverageRate,
} = require("../../helper/utils/newAvgRate");
const { getDatabaseByGST } = require("../../helper/utils/gstDbMapper");

const reportCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/* ================================================================
   OPTIMIZED: getConsumptionItems replaced by getBulkConsumptionItems
   Ab saare mfg_ids ke liye EK SAATH queries chalti hain
   ================================================================ */
async function getBulkConsumptionItems(
  mfgIds,
  db,
  todateStr = null,
) {
  if (!mfgIds || mfgIds.length === 0) return new Map();

  console.time("bulk_consumption");

  // Step 1: Saare bom_subjects ek query mein
  const bomSubjectRows = await db.query(
    `SELECT mp2.mfg_transaction, mp1.prod_bom_subject
     FROM mfg_production_2 mp2
     LEFT JOIN mfg_production_1 mp1 ON mp1.prod_transaction = mp2.mfg_ref_id
     WHERE mp2.mfg_transaction IN (:ids)`,
    {
      replacements: { ids: mfgIds },
      type: db.QueryTypes.SELECT,
    },
  );

  // Map: mfg_transaction -> bom_subject
  const bomSubjectMap = new Map();
  bomSubjectRows.forEach((row) => {
    bomSubjectMap.set(row.mfg_transaction, row.prod_bom_subject || 0);
  });

  // Step 2: Saari rm_location items ek query mein (with components, units, subgroups, location)
  const consumptionRows = await db.query(
    `SELECT
    rm_location.ID AS rm_row_id,
        rm_location.mfg_ppr_trans_id_2 AS mfg_id,
        rm_location.components_id,
        rm_location.qty,
        rm_location.other_qty,
        rm_location.any_remark,
        rm_location.insert_date,
        rm_location.loc_out,
        components.c_part_no,
        components.c_name,
        components.components_type,
        components.c_uom,
        units.units_name,
        location_main.loc_name,
        all_sub_groups.sub_group_name
     FROM rm_location
     LEFT JOIN components ON rm_location.components_id = components.component_key
     LEFT JOIN units ON components.c_uom = units.units_id
     LEFT JOIN all_sub_groups ON all_sub_groups.sub_group_id = components.c_sub_group
     LEFT JOIN location_main ON rm_location.loc_out = location_main.location_key
     WHERE rm_location.mfg_ppr_trans_id_2 IN (:ids)
       AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
      `,
    {
      replacements: { ids: mfgIds },
      type: db.QueryTypes.SELECT,
    },
  );

  if (!consumptionRows.length) {
    console.timeEnd("bulk_consumption");
    return new Map();
  }

  // Step 3: BOM qty - saare (component_id, bom_subject) pairs ek query mein
  // Unique pairs collect karo
  const bomPairs = [];
  const bomPairSet = new Set();
  consumptionRows.forEach((row) => {
    const bom_subject = bomSubjectMap.get(row.mfg_id) || 0;
    const pairKey = `${row.components_id}_${bom_subject}`;
    if (!bomPairSet.has(pairKey) && row.components_id && bom_subject) {
      bomPairSet.add(pairKey);
      bomPairs.push({ component_id: row.components_id, bom_subject });
    }
  });

  // BOM qty bulk fetch using CASE WHEN (efficient)
  const bomQtyMap = new Map(); // key: `componentId_bomSubject`
  if (bomPairs.length > 0) {
    // Build WHERE IN clause using OR conditions
    const bomConditions = bomPairs
      .map(
        (_, i) => `(component_id = :comp_${i} AND subject_under = :sub_${i})`,
      )
      .join(" OR ");
    const bomReplacements = {};
    bomPairs.forEach((pair, i) => {
      bomReplacements[`comp_${i}`] = pair.component_id;
      bomReplacements[`sub_${i}`] = pair.bom_subject;
    });

    const bomQtyRows = await db.query(
      `SELECT component_id, subject_under, qty FROM bom_quantity WHERE ${bomConditions}`,
      {
        replacements: bomReplacements,
        type: db.QueryTypes.SELECT,
      },
    );
    bomQtyRows.forEach((row) => {
      bomQtyMap.set(`${row.component_id}_${row.subject_under}`, row.qty);
    });
  }

  // Step 4: Unique component IDs aur component+date keys collect karo
  const componentIds = [
    ...new Set(
      consumptionRows
        .map((r) => {
          return r.components_id;
        })
        .filter(Boolean),
    ),
  ];
  const componentDateKeySet = new Set();
  const componentDateKeyList = [];
  let maxDateMs = 0;
  consumptionRows.forEach((row) => {
    if (!row.components_id || !row.insert_date) return;
    const currDate = new Date(row.insert_date);
    const currMs = currDate.getTime();
    if (Number.isNaN(currMs)) return;
    if (currMs > maxDateMs) maxDateMs = currMs;
    const key = `${row.components_id}_${currMs}`;
    if (!componentDateKeySet.has(key)) {
      componentDateKeySet.add(key);
      componentDateKeyList.push({
        componentId: row.components_id,
        dateMs: currMs,
        insertDt: row.insert_date,
        insertRowID: row.rm_row_id,
      });
    }
  });

  if (componentIds.length === 0) {
    // No components — return empty consumption per mfg
    const resultMap = new Map();
    mfgIds.forEach((id) => resultMap.set(id, []));
    console.timeEnd("bulk_consumption");
    return resultMap;
  }

  // Step 5: Average rates bulk fetch
  const averageRates = await db.query(
    `SELECT component_key, average_rate, closing_qty 
     FROM tbl_average_rate 
     WHERE component_key IN (:componentIds)`,
    {
      replacements: { componentIds },
      type: db.QueryTypes.SELECT,
    },
  );
  const averageRateMap = new Map();
  averageRates.forEach((row) => {
    averageRateMap.set(row.component_key, {
      average_rate: Number(row.average_rate || 0),
      closing_qty: Number(row.closing_qty || 0),
    });
  });

  // Step 6: ONE bulk rm_location inward query for weighted rate
  const maxDateOverall = new Date(maxDateMs || Date.now());
  const maxDateStr = moment(maxDateOverall).format("YYYY-MM-DD HH:mm:ss");

  const bulkRmLocationData = await db.query(
    `SELECT 
        components_id,
        insert_date,
        (in_po_rate * exchange_rate * qty) + custom_duty + freight_charge AS amount,
        qty
     FROM rm_location 
     WHERE components_id IN (:componentIds)
       AND DATE_FORMAT(insert_date, '%Y-%m-%d %H:%i:%s') BETWEEN :startDate AND :maxDate
       AND trans_type IN ('INWARD') 
       AND (in_module != 'IN-FGRETURN')`,
    {
      replacements: {
        componentIds,
        maxDate: maxDateStr,
        startDate: `2025-04-01 00:00:00`,
      },
      type: db.QueryTypes.SELECT,
    },
  );

  // Step 7: Weighted rate calculate in memory per component+insert_date
  const weightedRateMap = new Map();
  componentDateKeyList.forEach(({ componentId, dateMs }) => {
    const mapKey = `${componentId}_${dateMs}`;

    const componentData = bulkRmLocationData.filter((row) => {
      return (
        row.components_id === componentId &&
        new Date(row.insert_date).getTime() <= dateMs
      );
    });

    const sum_amount = componentData.reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0,
    );
    const sum_qty = componentData.reduce(
      (sum, row) => sum + Number(row.qty || 0),
      0,
    );

    const avgRate = averageRateMap.get(componentId) || {
      average_rate: 0,
      closing_qty: 0,
    };
    const numerator = sum_amount + avgRate.average_rate * avgRate.closing_qty;
    const denominator = sum_qty + avgRate.closing_qty;
    const weightedPurchaseRate =
      denominator === 0 ? NaN : numerator / denominator;

    weightedRateMap.set(
      mapKey,
      Number.isNaN(weightedPurchaseRate)
        ? "0"
        : weightedPurchaseRate.toFixed(2),
    );
  });

  // New WAR: compute newWeightedAverageRate per component + consumption date
  const newWARMap = new Map();
  if (componentIds.length > 0 && todateStr) {
    await Promise.all(
      componentDateKeyList.map(
        async ({ componentId, insertDt, insertRowID, dateMs }) => {
          const rate = await newWeightedAverageRate(
            componentId,
            insertDt,
            insertRowID,
            db, // GST-resolved connection selects branch-specific DB and cutoff
          );
          const mapKey = `${componentId}_${dateMs}`; // unique per component + date
          newWARMap.set(mapKey, rate);
        },
      ),
    );
  }

  // Step 8: Group consumption rows by mfg_id and map fields
  const resultMap = new Map();
  mfgIds.forEach((id) => resultMap.set(id, []));

  consumptionRows.forEach((row) => {
    const mfg_id = row.mfg_id;
    const bom_subject = bomSubjectMap.get(mfg_id) || 0;
    const bomQty = bomQtyMap.get(`${row.components_id}_${bom_subject}`) || "--";
    const rowDateMs = row.insert_date
      ? new Date(row.insert_date).getTime()
      : NaN;
    const weightedRateKey = Number.isNaN(rowDateMs)
      ? null
      : `${row.components_id}_${rowDateMs}`;
    const weightedRate =
      (weightedRateKey && weightedRateMap.get(weightedRateKey)) || "0";
    const consumed = Number(row.qty) + Number(row.other_qty);

    const newWeightedRateKey = Number.isNaN(rowDateMs)
      ? null
      : `${row.components_id}_${rowDateMs}`;
    const newWARRate =
      (newWeightedRateKey && newWARMap.get(newWeightedRateKey)) || "0";

    const entry = {
      componentName: row.c_name,
      componentPart: row.c_part_no,
      qtyConsumed: consumed,
      bomQty,
      UOM: row.units_name,
      locationFrom: "GDWP001_C25",
      comment: row.any_remark || "-",
      subGroup: row.sub_group_name || "null",
      // Uses the new weighted average rate (newWeightedAverageRate)
      weightedPurchaseRate: newWARRate,
      weightedTotalCost: Number((consumed * newWARRate).toFixed(2)),
    };

    if (resultMap.has(mfg_id)) {
      resultMap.get(mfg_id).push(entry);
    }
  });

  console.timeEnd("bulk_consumption");
  return resultMap;
}

/* ---------------- MAIN REPORT API ---------------- */
router.get("/manufacturing", async (req, res) => {
  let timerEnded = false;
  const endManufacturingTimer = () => {
    if (!timerEnded) {
      console.timeEnd("manufacturing_api");
      timerEnded = true;
    }
  };

  let responded = false;
  const timeoutHandle = setTimeout(() => {
    if (!responded && !res.headersSent) {
      responded = true;
      endManufacturingTimer();
      return res.status(504).json({
        status: "error",
        message: "Request timed out. Please try a smaller date range.",
      });
    }
  }, 25000);

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
      clearTimeout(timeoutHandle);
      responded = true;
      return res.status(400).json({
        status: "error",
        message: error.message || "Invalid GST number",
      });
    }

    const MAIN_BRANCH_GST = process.env.MAIN_BRANCH_GST;
    if (
      !branch &&
      gst &&
      MAIN_BRANCH_GST &&
      gst.trim().toUpperCase() === MAIN_BRANCH_GST.trim().toUpperCase()
    ) {
      branch = "BROAKTRC25";
    }

    /* ----- Parse Date Range ----- */
    let dateRange = null;

    if (fromdate && todate) {
      const from = moment(fromdate, "DD-MM-YYYY", true);
      const to = moment(todate, "DD-MM-YYYY", true);

      if (!from.isValid() || !to.isValid()) {
        clearTimeout(timeoutHandle);
        responded = true;
        return res.status(400).json({
          status: "error",
          message: "Invalid date format. Use DD-MM-YYYY",
        });
      }

      dateRange = { from, to };
    } else {
      clearTimeout(timeoutHandle);
      responded = true;
      return res.status(400).json({
        status: "error",
        message: "fromdate and todate query parameters are required",
      });
    }

    // Cache check
    const cacheKey = `${gst || "unknown"}_${fromdate}_${todate}_${branch || ""}`;
    const cached = reportCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      clearTimeout(timeoutHandle);
      responded = true;
      endManufacturingTimer();
      return res.json(cached.data);
    }

    /* ----- Main Queries (parallel) ----- */
    let query = `
      SELECT mp2.mfg_transaction, mp2.mfg_prod_planing_qty, mp2.mfg_comment, mp2.mfg_sku,
             mp2.mfg_full_date, p.p_name, p.p_hsncode, p.p_description,
             units.units_name, location_main.loc_name AS fg_loc, al.user_name
      FROM mfg_production_2 mp2
      LEFT JOIN products p ON p.p_sku = mp2.mfg_sku
      LEFT JOIN units ON units.units_id = p.p_uom
      LEFT JOIN location_main ON location_main.location_key = mp2.mfg_con_location
      LEFT JOIN admin_login al ON al.CustID = mp2.mfg_approved_by
      WHERE mp2.mfg_prod_type IN ('C')`;

    const replacements = {};

    if (dateRange) {
      query += ` AND DATE(mp2.mfg_full_date) BETWEEN :d1 AND :d2`;
      replacements.d1 = dateRange.from.format("YYYY-MM-DD");
      replacements.d2 = dateRange.to.format("YYYY-MM-DD");
    }

    if (branch) {
      query += ` AND mp2.company_branch = :branch`;
      replacements.branch = branch;
    }

    // Run both main queries in parallel
    const [stmt, sfgInwardStmt] = await Promise.all([
      db.query(query, {
        replacements,
        type: db.QueryTypes.SELECT,
      }),
      db.query(
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
          rm_location.out_transaction_id,
          rm_location.in_transaction_id,
          jpr.jw_po_recipe,
          jpr.jw_po_sku,
          jw_product.p_sku AS product_sku,
          jw_product.p_name AS product_name,
          jw_product.p_hsncode AS product_hsncode,
          jw_product.p_description AS product_description,
          COALESCE(
            jbr.jw_bom_qty,
            (SELECT bom_quantity.qty 
             FROM bom_quantity 
             WHERE bom_quantity.component_id = components.component_key 
             AND bom_quantity.subject_under = jpr.jw_po_recipe
             AND bom_quantity.bom_status = 'A'
             LIMIT 1)
          ) AS bom_qty
        FROM rm_location
        LEFT JOIN components ON rm_location.components_id = components.component_key
        LEFT JOIN units ON components.c_uom = units.units_id
        LEFT JOIN all_sub_groups ON components.c_sub_group = all_sub_groups.sub_group_id
        LEFT JOIN location_main ON rm_location.loc_in = location_main.location_key
        LEFT JOIN location_main AS loc2 ON rm_location.loc_out = loc2.location_key
        LEFT JOIN jw_purchase_req jpr ON rm_location.jw_transaction_id = jpr.jw_jw_transaction
        LEFT JOIN products jw_product ON jw_product.product_key = jpr.jw_po_sku
        LEFT JOIN jw_bom_recipe jbr
          ON jbr.jw_bom_sku = jpr.jw_po_sku
          AND jbr.jw_bom_po_trans = rm_location.jw_transaction_id
          AND jbr.jw_bom_part = components.component_key
        WHERE DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') BETWEEN :d1 AND :d2
          ${branch ? "AND rm_location.company_branch = :branch" : ""}
          AND rm_location.trans_type = 'SFG-CONSUMPTION'
          AND rm_location.trans_mode = 'default'
          AND rm_location.jw_transaction_id != '--'
          AND COALESCE(components.c_new_part_no, '') NOT LIKE '%RFP%'
        ORDER BY rm_location.ID ASC`,
        {
          replacements: {
            d1: dateRange.from.format("YYYY-MM-DD"),
            d2: dateRange.to.format("YYYY-MM-DD"),
            ...(branch && { branch }),
          },
          type: db.QueryTypes.SELECT,
        },
      ),
    ]);

    if (!stmt.length && !sfgInwardStmt.length) {
      clearTimeout(timeoutHandle);
      responded = true;
      endManufacturingTimer();
      return res.status(404).json({
        status: "error",
        message: "Data not found",
      });
    }

    /* ================================================================
       OPTIMIZED: Pehle saare mfg IDs collect karo, phir EK SAATH
       bulk consumption fetch karo — N×4 queries → sirf 6 queries total
       ================================================================ */
    const allMfgIds = stmt.map((item) => item.mfg_transaction);

    // Bulk fetch all consumption data in one go (replaces getConsumptionItems loop)
    const bulkConsumptionMap =
      allMfgIds.length > 0
        ? await getBulkConsumptionItems(
            allMfgIds,
            db,
            dateRange.to.format("YYYY-MM-DD"),
          )
        : new Map();

    let totalConsumption = 0;

    const mfgList = stmt.map((item) => {
      const consumption = bulkConsumptionMap.get(item.mfg_transaction) || [];
      totalConsumption += consumption.length;

      return {
        voucherType: "PRODUCTION",
        voucherSubType: "MFGJOURNAL",
        transaction: item.mfg_transaction,
        date: moment(item.mfg_full_date).format("DD-MM-YYYY HH:mm:ss"),
        productSKU: item.mfg_sku,
        productName: item.p_name,
        hsnCode: item.p_hsncode,
        description: item.p_description,
        plannedQty: item.mfg_prod_planing_qty,
        UOM: item.units_name,
        locationTo: "C25_FG001",
        prodType: item.products_type === "semi" ? "SEMI" : "FG",
        remark:
          `The product ${item.p_name} ${item.mfg_sku} has been manufactured against MFG No ${item.mfg_transaction}` ||
          "-",
        consumptions: consumption,
      };
    });

    /* ================================================================
       SFG INWARD: Base on MIN (in_transaction_id) - one voucher per MIN.
       Header/plannedQty ref: getMinTransactionByDate; consumption ref: getjwsfinwardConsumption
       ================================================================ */

    // Group by in_transaction_id (MIN) - each MIN = one voucher
    const groupedSfgInward = sfgInwardStmt.reduce((acc, item) => {
      const minId =
        item.in_transaction_id && item.in_transaction_id !== "--"
          ? item.in_transaction_id
          : `MIN_${moment(item.insert_date).format("DDMMYYHHmmss")}`;
      if (!acc[minId]) acc[minId] = [];
      acc[minId].push(item);
      return acc;
    }, {});

    // Unique jw_transaction_id for jobwork dates (rate lookup)
    const jwTxnIds = [
      ...new Set(sfgInwardStmt.map((r) => r.jw_transaction_id).filter(Boolean)),
    ];
    const jwDatesMap = new Map();
    if (jwTxnIds.length > 0) {
      const jwDates = await db.query(
        `SELECT jw_jw_transaction, jw_po_full_date 
         FROM jw_purchase_req 
         WHERE jw_jw_transaction IN (:jwTxnIds)`,
        {
          replacements: { jwTxnIds },
          type: db.QueryTypes.SELECT,
        },
      );
      jwDates.forEach((row) => {
        jwDatesMap.set(row.jw_jw_transaction, row.jw_po_full_date);
      });
    }

    // Collect SFG component data: rate date = item.insert_date (same as rm_sfgXML getWeightedPurchaseRate(component_key, sfgItem.insert_date))
    const sfgComponentData = [];
    Object.entries(groupedSfgInward).forEach(([jwTxnId, group]) => {
      group.forEach((item) => {
        if (item.component_key) {
          const rateDate = item.insert_date || group[0].insert_date;
          sfgComponentData.push({
            component_key: item.component_key,
            jobworkDate: rateDate,
            item,
          });
        }
      });
    });

    // Bulk average rates for SFG components
    const sfgComponentKeys = [
      ...new Set(sfgComponentData.map((d) => d.component_key).filter(Boolean)),
    ];
    const sfgAverageRateMap = new Map();
    if (sfgComponentKeys.length > 0) {
      const sfgAverageRates = await db.query(
        `SELECT component_key, average_rate, closing_qty 
         FROM tbl_average_rate 
         WHERE component_key IN (:componentKeys)`,
        {
          replacements: { componentKeys: sfgComponentKeys },
          type: db.QueryTypes.SELECT,
        },
      );
      sfgAverageRates.forEach((row) => {
        sfgAverageRateMap.set(row.component_key, {
          average_rate: Number(row.average_rate || 0),
          closing_qty: Number(row.closing_qty || 0),
        });
      });
    }

    // ONE bulk rm_location query for SFG weighted rates
    const sfgMaxDate =
      sfgComponentData.length > 0
        ? new Date(
            Math.max(
              ...sfgComponentData.map((d) => new Date(d.jobworkDate).getTime()),
            ),
          )
        : null;

    const sfgMaxDateStr = sfgMaxDate
      ? moment(sfgMaxDate).format("YYYY-MM-DD HH:mm:ss")
      : null;

    const sfgBulkRmLocationData =
      sfgComponentKeys.length > 0 && sfgMaxDateStr
        ? await db.query(
            `SELECT 
              components_id,
              insert_date,
              (in_po_rate * exchange_rate * qty) + custom_duty + freight_charge AS amount,
              qty
            FROM rm_location 
            WHERE components_id IN (:componentKeys)
              AND DATE_FORMAT(insert_date, '%Y-%m-%d %H:%i:%s') BETWEEN :startDate AND :maxDate
              AND trans_type IN ('INWARD') 
              AND (in_module != 'IN-FGRETURN')`,
            {
              replacements: {
                componentKeys: sfgComponentKeys,
                maxDate: sfgMaxDateStr,
                startDate: `2025-04-01 00:00:00`,
              },
              type: db.QueryTypes.SELECT,
            },
          )
        : [];

    // plannedQty = INWARD qty per MIN (getMinTransactionByDate inqty)
    const inTxnIds = Object.keys(groupedSfgInward);
    const inqtyMap = new Map();
    const inwardProductMap = new Map(); // MIN -> product from INWARD row (jo SFG receive hua)
    if (inTxnIds.length > 0) {
      const rows = await db.query(
        `SELECT in_transaction_id, SUM(COALESCE(qty,0) + COALESCE(other_qty,0)) AS inqty FROM rm_location WHERE in_transaction_id IN (:ids) AND trans_type = 'INWARD' GROUP BY in_transaction_id`,
        { replacements: { ids: inTxnIds }, type: db.QueryTypes.SELECT },
      );
      rows.forEach((r) =>
        inqtyMap.set(r.in_transaction_id, Number(r.inqty || 0)),
      );

      const inwardRows = await db.query(
        `SELECT rm_location.in_transaction_id, components.c_part_no, components.c_name, rm_location.in_hsn_code, units.units_name,
                rm_location.min_ewaybill, rm_location.in_invoice_id, rm_location.insert_date
         FROM rm_location
         LEFT JOIN components ON rm_location.components_id = components.component_key
         LEFT JOIN units ON components.c_uom = units.units_id
         WHERE rm_location.in_transaction_id IN (:ids) AND rm_location.trans_type = 'INWARD' AND rm_location.in_module = 'IN-JWI'
         ORDER BY rm_location.id ASC`,
        { replacements: { ids: inTxnIds }, type: db.QueryTypes.SELECT },
      );
      inwardRows.forEach((r) => {
        if (r.in_transaction_id && !inwardProductMap.has(r.in_transaction_id)) {
          inwardProductMap.set(r.in_transaction_id, {
            productSKU: r.c_part_no || "--",
            productName: r.c_name || "--",
            hsnCode: r.in_hsn_code || "--",
            UOM: r.units_name || "Pcs",
            challanNo: r.in_invoice_id || "--",
            dated: r.insert_date
              ? moment(r.insert_date).format("DD-MM-YYYY")
              : "--",
            minEwaybill: r.min_ewaybill || "--",
          });
        }
      });
    }

    // Rate = jw_material_challan.jw_order_rate (same as fetchTableAnly avgRate), fallback = weighted from rm_location
    const jwChallanRateMap = new Map();
    const jwCompPairs = [];
    Object.values(groupedSfgInward).forEach((g) => {
      g.forEach((it) => {
        if (it.component_key && it.jw_transaction_id)
          jwCompPairs.push({
            txnId: it.jw_transaction_id,
            compId: it.component_key,
          });
      });
    });
    const uniquePairs = Array.from(
      new Map(
        jwCompPairs.map((p) => [`${p.txnId}_${p.compId}`, p]).values(),
      ).values(),
    );
    if (uniquePairs.length > 0) {
      const orConditions = uniquePairs
        .map(
          (_, i) =>
            `(jw_transaction = :txn_${i} AND jw_component_id = :comp_${i})`,
        )
        .join(" OR ");
      const repl = {};
      uniquePairs.forEach((p, i) => {
        repl[`txn_${i}`] = p.txnId;
        repl[`comp_${i}`] = p.compId;
      });
      const challanRows = await db.query(
        `SELECT jw_transaction, jw_component_id, jw_order_rate FROM jw_material_challan WHERE ${orConditions}`,
        { replacements: repl, type: db.QueryTypes.SELECT },
      );
      challanRows.forEach((r) =>
        jwChallanRateMap.set(
          `${r.jw_transaction}_${r.jw_component_id}`,
          Number(r.jw_order_rate || 0),
        ),
      );
    }

    // newWAR: pre-fetch lastNewWeightedAverageRate for all SFG inward consumption components
    const sfgNewWARMap = new Map();
    const sfgUniqueCompKeys = [
      ...new Set(sfgInwardStmt.map((r) => r.component_key).filter(Boolean)),
    ];
    const todateFormatted = dateRange.to.format("YYYY-MM-DD");
    if (sfgUniqueCompKeys.length > 0) {
      await Promise.all(
        sfgUniqueCompKeys.map(async (compKey) => {
          const rate = await lastNewWeightedAverageRate(
            compKey,
            todateFormatted,
            db, // GST-resolved connection selects branch-specific DB and cutoff
          );
          sfgNewWARMap.set(compKey, rate);
        }),
      );
    }

    // Weighted rate calculate in memory for SFG (fallback when jw_material_challan me rate na ho)
    const sfgWeightedRateMap = new Map();
    sfgComponentData.forEach(({ component_key, jobworkDate }) => {
      if (!component_key) return;

      const dateMs = new Date(jobworkDate).getTime();
      const mapKey = `${component_key}_${dateMs}`;

      if (sfgWeightedRateMap.has(mapKey)) return;

      const componentData = sfgBulkRmLocationData.filter(
        (row) =>
          row.components_id === component_key &&
          new Date(row.insert_date).getTime() <= dateMs,
      );

      const sum_amount = componentData.reduce(
        (sum, row) => sum + Number(row.amount || 0),
        0,
      );
      const sum_qty = componentData.reduce(
        (sum, row) => sum + Number(row.qty || 0),
        0,
      );

      const avgRate = sfgAverageRateMap.get(component_key) || {
        average_rate: 0,
        closing_qty: 0,
      };
      const numerator = sum_amount + avgRate.average_rate * avgRate.closing_qty;
      const denominator = sum_qty + avgRate.closing_qty;
      const weightedPurchaseRate =
        denominator === 0 ? NaN : numerator / denominator;

      sfgWeightedRateMap.set(
        mapKey,
        Number.isNaN(weightedPurchaseRate)
          ? "0"
          : weightedPurchaseRate.toFixed(2),
      );
    });

    // Build SFG inward list: one voucher per MIN; transaction = in_transaction_id (getMinTransactionByDate); consumption = SFG-CONSUMPTION rows (getjwsfinwardConsumption)
    const sfgInwardList = Object.entries(groupedSfgInward).map(
      ([minId, group]) => {
        const firstItem = group[0];
        const jwTxnId = firstItem.jw_transaction_id; // for rate lookup
        const jobworkDate = jwDatesMap.get(jwTxnId) || firstItem.insert_date;
        const dateMs = new Date(jobworkDate).getTime();

        const consumption = group.map((item) => {
          const rateKey = `${item.component_key}_${dateMs}`;
          const jwRate = jwChallanRateMap.get(
            `${item.jw_transaction_id}_${item.component_key}`,
          );
          const weightedRate =
            jwRate !== undefined && jwRate !== null
              ? String(jwRate)
              : sfgWeightedRateMap.get(rateKey) || "0";
          const rateNum = Number(weightedRate) || 0;
          const consumed = Number(item.qty || 0) + Number(item.other_qty || 0);

          const newWARRate = sfgNewWARMap.get(item.component_key) || "0";
          const newWARRateNum = Number(newWARRate) || 0;

          return {
            componentName: item.c_name,
            componentPart: item.c_part_no || item.c_new_part_no,
            qtyConsumed: consumed,
            bomQty: item.bom_qty || "--",
            UOM: item.units_name,
            locationFrom: item.loc_out_name,
            comment: item.any_remark || "-",
            subGroup: item.sub_group_name || "null",
            weightedPurchaseRate:
              (typeof rateNum === "number"
                ? rateNum.toFixed(2)
                : String(rateNum)) || "0",
            weightedTotalCost: Number((consumed * rateNum).toFixed(2)),
            newWAR: {
              weightedPurchaseRate: newWARRate,
              weightedTotalCost: Number((consumed * newWARRateNum).toFixed(2)),
            },
          };
        });

        totalConsumption += consumption.length;

        const inqty = inqtyMap.get(minId);
        const plannedQty =
          inqty !== undefined && inqty !== null ? String(inqty) : "--";

        const lastRmLocation = group[group.length - 1];
        const inTxnStr = String(lastRmLocation.in_transaction_id || "");
        const lastDateMatch = inTxnStr.match(
          /(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{2}|\d{6,8})[\s\-_\/]*([\d]+)$/,
        );
        const minNumber = lastDateMatch
          ? lastDateMatch[2]
          : (inTxnStr.split("/").pop() || inTxnStr).replace(/\D/g, "") ||
            inTxnStr;
        const inInvoiceId =
          lastRmLocation.in_invoice_id && lastRmLocation.in_invoice_id !== "--"
            ? lastRmLocation.in_invoice_id
            : "";
        const txnId = inInvoiceId ? `${inInvoiceId}_${minNumber}` : minNumber;
        const inwardProduct = inwardProductMap.get(minId);

        return {
          voucherType: "PRODUCTION - JW",
          voucherSubType: "MFGJOURNAL",
          transaction: `C25${txnId}`,
          date: moment(firstItem.insert_date).format("DD-MM-YYYY HH:mm:ss"),
          productSKU: inwardProduct
            ? inwardProduct.productSKU
            : firstItem.product_sku || firstItem.jw_po_sku,
          productName: inwardProduct
            ? inwardProduct.productName
            : firstItem.product_name || firstItem.jw_po_sku,
          hsnCode: inwardProduct
            ? inwardProduct.hsnCode
            : firstItem.product_hsncode || firstItem.in_hsn_code || "--",
          description: inwardProduct
            ? inwardProduct.productName
            : firstItem.product_description || firstItem.product_name || "-",
          plannedQty,
          UOM: inwardProduct ? inwardProduct.UOM : firstItem.units_name,
          locationTo: "GDRM001_C25",
          prodType: "SFG",
          remark: inwardProduct
            ? `Being Material received after job work on challan no ${inwardProduct.challanNo}, Dated ${inwardProduct.dated} and E-way Bill No ${inwardProduct.minEwaybill}`
            : firstItem.any_remark || "-",
          consumptions: consumption,
        };
      },
    );

    /* ----- Final Response ----- */
    const allMfgList = [...mfgList, ...sfgInwardList];

    const finalResponse = {
      status: "success",
      header: {
        date: `${dateRange.from.format("DD-MM-YYYY")} to ${dateRange.to.format(
          "DD-MM-YYYY",
        )}`,
        totalMfg: allMfgList.length,
        totalConsumption: totalConsumption + sfgInwardList.length,
      },
      mfg: allMfgList,
    };

    // Cache store
    reportCache.set(cacheKey, { data: finalResponse, ts: Date.now() });

    clearTimeout(timeoutHandle);
    if (responded || res.headersSent) {
      return;
    }
    responded = true;
    endManufacturingTimer();
    return res.json(finalResponse);
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (responded || res.headersSent) {
      return;
    }
    responded = true;
    console.log("==================================", err);
    endManufacturingTimer();
    return res.status(500).json({
      status: "error",
      message: "Internal Server Error - " + err,
    });
  }
});

module.exports = router;

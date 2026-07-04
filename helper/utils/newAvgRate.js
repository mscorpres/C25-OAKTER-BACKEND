const { invtDB } = require("../../config/db/connection");

const CUTOFF_DATE = "2026-06-07 19:00:00";
exports.CUTOFF_DATE = CUTOFF_DATE;
const INR_CURRENCY = 364907247; //INR

/**
 * Rate calculate karo:
 * - final_rate > 0       → final_rate use karo
 * - currency != INR      → (qty * in_po_rate * exchange_rate + custom_duty + freight_charge) / qty
 * - currency == INR      → in_po_rate use karo
 */
function calculateRate(txn) {
  const finalRate = parseFloat(txn.final_rate) || 0;
  const inPoRate = parseFloat(txn.in_po_rate) || 0;
  const exchangeRate = parseFloat(txn.exchange_rate) || 1;
  const customDuty = parseFloat(txn.custom_duty) || 0;
  const freightCharge = parseFloat(txn.freight_charge) || 0;
  const qty = parseFloat(txn.qty) || 0;
  const currencyType = parseInt(txn.currency_type) || INR_CURRENCY;

  // ✅ final_rate > 0 → use karo directly
  if (finalRate > 0) {
    return finalRate;
  }

  // ✅ Foreign currency → import formula
  if (currencyType !== INR_CURRENCY) {
    // (qty * in_po_rate * exchange_rate + custom_duty + freight_charge) / qty
    if (qty > 0) {
      return (qty * inPoRate * exchangeRate + customDuty + freightCharge) / qty;
    }
    return 0;
  }

  // ✅ INR → seedha in_po_rate
  return inPoRate;
}

/**
 * Calculate WVR for a component transaction by transaction
 * @param {string} componentKey
 * @param {string} date - "YYYY-MM-DD HH:mm:ss"
 * @param {number} currentID - rm_location.ID of current row (include this)
 * @returns {Promise<number>} - WVR after this transaction
 *
 * WVR Rules:
 *  UP (+)    : INWARD  + in_module != IN-WO  + vendor_type = v01
 *              TRANSFER + trans_mode = return + vendor_type = j01
 *
 *  DOWN (-)  : ISSUE/CONSUMPTION + loc_storable = 0  (currentWVR use hoga)
 *              JOBWORK                                (currentWVR use hoga)
 *
 *  NO CHANGE : INWARD (IN-WO or vendor_type != v01)
 *              TRANSFER (other), SFG-CONSUMPTION, WORKORDER
 *
 *  SKIP      : CANCELLED, REJECTION, MIN_PENDING, REVERSE
 */
exports.newWeightedAverageRate = async function (
  componentKey,
  date,
  currentID,
) {
  console.log(`\n📋  Calculating WVR for component: ${componentKey}`);
  try {
    const transactions = await invtDB.query(
      `SELECT
                rm_location.ID,
                rm_location.trans_type,
                rm_location.in_module,
                rm_location.vendor_type,
                rm_location.trans_mode,
                rm_location.currency_type,
                rm_location.exchange_rate,
                rm_location.custom_duty,
                rm_location.freight_charge,
                lm_in.loc_storable,
                rm_location.qty,
                rm_location.in_po_rate,
                rm_location.final_rate,
                rm_location.insert_date
            FROM rm_location
            LEFT JOIN location_main AS lm_in  ON lm_in.location_key = rm_location.loc_in
            LEFT JOIN location_main AS lm_out ON lm_out.location_key = rm_location.loc_out
            WHERE rm_location.components_id = :componentKey
              AND rm_location.insert_date > :cutoffDate
              AND rm_location.trans_type NOT IN ('CANCELLED', 'REJECTION', 'MIN_PENDING', 'REVERSE')
              AND (
                    rm_location.insert_date < :date
                    OR (rm_location.insert_date = :date AND rm_location.ID <= :currentID)
              )
            ORDER BY rm_location.insert_date ASC, rm_location.ID ASC`,
      {
        replacements: {
          componentKey: componentKey,
          date: date,
          currentID: currentID,
          cutoffDate: CUTOFF_DATE,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    // Opening balance HAMESHA tbl_average_rate_2026 se
    const avgRows = await invtDB.query(
      `SELECT last_rate, closing_stock, closing_stock_value
             FROM tbl_average_rate_2026
             WHERE component_key = :componentKey
             LIMIT 1`,
      {
        replacements: { componentKey: componentKey },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    let runningQty = 0;
    let runningValue = 0;
    let lastWVR = 0; // ✅ NEW — last known WVR, stock 0 hone par bhi preserve

    if (avgRows.length > 0) {
      runningQty = parseFloat(avgRows[0].closing_stock) || 0;
      runningValue = parseFloat(avgRows[0].closing_stock_value) || 0;
      lastWVR = parseFloat(avgRows[0].last_rate) || 0; // ✅ NEW — opening rate
    }

    for (const txn of transactions) {
      const qty = parseFloat(txn.qty) || 0;
      const rate = calculateRate(txn); // ✅ smart rate
      const locStorable = parseInt(txn.loc_storable);

      // ── WVR UP (+) ────────────────────────────────────────────────────
      const isInward =
        (txn.trans_type === "INWARD" &&
          txn.in_module !== "IN-WO" &&
          txn.vendor_type === "v01") ||
        (txn.trans_type === "INWARD" &&
          txn.in_module == "IN-JWI" &&
          txn.vendor_type === "j01") ||
        (txn.trans_type === "TRANSFER" &&
          txn.trans_mode === "return" &&
          txn.vendor_type === "j01") ||
        (txn.trans_type === "INWARD" && txn.in_module == "PART-CONV") ||
        (txn.trans_type === "INWARD" && txn.in_module == "IN-QCA") ||
        (txn.trans_type === "TRANSFER" && txn.in_module == "IN-TRN");

      // ── WVR DOWN (-) ──────────────────────────────────────────────────
      const isOutward =
        (locStorable === 0 &&
          ["ISSUE", "CONSUMPTION"].includes(txn.trans_type)) ||
        (txn.trans_type === "JOBWORK" && txn.vendor_type === "j01") ||
        txn.trans_type === "SFG-CONSUMPTION" ||
        (txn.trans_type === "CONSUMPTION" && txn.in_module === "PART-CONV");

      // ── Apply logic ───────────────────────────────────────────────────
      if (isInward) {
        // UP (+): (Old Value + New Value) / (Old Qty + New Qty)
        runningValue = runningValue + qty * rate;
        runningQty = runningQty + qty;
      } else if (isOutward) {
        // DOWN (-): currentWVR se deduct, stock 0 ho to lastWVR use karo
        const currentWVR = runningQty > 0 ? runningValue / runningQty : lastWVR; // ✅ CHANGED
        runningValue = Math.max(0, runningValue - qty * currentWVR);
        runningQty = Math.max(0, runningQty - qty);
      }
      // else: NO CHANGE — carry forward last WVR

      // ✅ NEW — har txn ke baad WVR yaad rakho, stock 0 hua to residue clean
      if (runningQty > 0) {
        lastWVR = runningValue / runningQty;
      } else {
        runningValue = 0;
      }
    }

    // ✅ CHANGED — stock 0 → 0 nahi, last known WVR return karo
    const finalWVR = runningQty > 0 ? runningValue / runningQty : lastWVR;
    return parseFloat(finalWVR.toFixed(10));
  } catch (error) {
    console.error("Error calculating WVR:", error);
    throw error;
  }
};

/**
 * Returns the LAST WVR for a component (optional date filter)
 * @param {string} componentKey
 * @param {string|null} date - Optional "YYYY-MM-DD" — us date tak ka last WVR
 * @returns {Promise<number>}
 */
exports.lastNewWeightedAverageRate = async function (
  componentKey,
  date = null,
) {
  try {
    const cutoffMs = new Date(CUTOFF_DATE).getTime();

    const dateCondition = date
      ? `AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d %H:%i:%s') <= :date`
      : ``;

    const transactions = await invtDB.query(
      `SELECT
                rm_location.ID,
                rm_location.trans_type,
                rm_location.in_module,
                rm_location.vendor_type,
                rm_location.trans_mode,
                rm_location.currency_type,
                rm_location.exchange_rate,
                rm_location.custom_duty,
                rm_location.freight_charge,
                lm_in.loc_storable,
                rm_location.qty,
                rm_location.in_po_rate,
                rm_location.final_rate,
                rm_location.insert_date
            FROM rm_location
            LEFT JOIN location_main AS lm_in  ON lm_in.location_key = rm_location.loc_in
            LEFT JOIN location_main AS lm_out ON lm_out.location_key = rm_location.loc_out
            WHERE rm_location.components_id = :componentKey
              AND rm_location.trans_type NOT IN ('CANCELLED', 'REJECTION', 'MIN_PENDING', 'REVERSE')
              ${dateCondition}
            ORDER BY rm_location.insert_date ASC, rm_location.ID ASC`,
      {
        replacements: {
          componentKey: componentKey,
          ...(date && { date: date }),
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    // Koi bhi txn CUTOFF ke baad hai?
    const hasPostCutoffTxn = transactions.some(
      (txn) => new Date(txn.insert_date).getTime() > cutoffMs,
    );

    // Agar CUTOFF ke baad koi txn nahi → seedha last_rate return karo
    if (!hasPostCutoffTxn) {
      const avgRows = await invtDB.query(
        `SELECT last_rate
                 FROM tbl_average_rate_2026
                 WHERE component_key = :componentKey
                 LIMIT 1`,
        {
          replacements: { componentKey: componentKey },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (avgRows.length > 0) {
        return parseFloat(parseFloat(avgRows[0].last_rate).toFixed(10));
      }
      return 0;
    }

    // CUTOFF ke baad txn hain → opening balance + calculate
    const avgRows = await invtDB.query(
      `SELECT last_rate, closing_stock, closing_stock_value
             FROM tbl_average_rate_2026
             WHERE component_key = :componentKey
             LIMIT 1`,
      {
        replacements: { componentKey: componentKey },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    let runningQty = 0;
    let runningValue = 0;
    let lastWVR = 0; // ✅ NEW — last known WVR, stock 0 hone par bhi preserve

    if (avgRows.length > 0) {
      runningQty = parseFloat(avgRows[0].closing_stock) || 0;
      runningValue = parseFloat(avgRows[0].closing_stock_value) || 0;
      lastWVR = parseFloat(avgRows[0].last_rate) || 0; // ✅ NEW — opening rate
    }

    for (const txn of transactions) {
      // Pre-cutoff skip — already in opening balance
      if (new Date(txn.insert_date).getTime() <= cutoffMs) {
        continue;
      }

      const qty = parseFloat(txn.qty) || 0;
      const rate = calculateRate(txn); // ✅ smart rate
      const locStorable = parseInt(txn.loc_storable);

      // ── WVR UP (+) ────────────────────────────────────────────────────
      const isInward =
        (txn.trans_type === "INWARD" &&
          txn.in_module !== "IN-WO" &&
          txn.vendor_type === "v01") ||
        (txn.trans_type === "INWARD" &&
          txn.in_module === "IN-JWI" &&
          txn.vendor_type === "j01") ||
        (txn.trans_type === "TRANSFER" &&
          txn.trans_mode === "return" &&
          txn.vendor_type === "j01")  ||
        (txn.trans_type === "INWARD" && txn.in_module == "PART-CONV") ||
        (txn.trans_type === "INWARD" && txn.in_module == "IN-QCA") ||
        (txn.trans_type === "TRANSFER" && txn.in_module == "IN-TRN");

      // ── WVR DOWN (-) ──────────────────────────────────────────────────
      const isOutward =
        (locStorable === 0 &&
          ["ISSUE", "CONSUMPTION"].includes(txn.trans_type)) ||
        (txn.trans_type === "JOBWORK" && txn.vendor_type === "j01") || // ✅ CHANGED — j01 check
        txn.trans_type === "SFG-CONSUMPTION" ||
        (txn.trans_type === "CONSUMPTION" && txn.in_module === "PART-CONV"); // ✅ NEW

      if (isInward) {
        runningValue = runningValue + qty * rate;
        runningQty = runningQty + qty;
      } else if (isOutward) {
        const currentWVR = runningQty > 0 ? runningValue / runningQty : lastWVR; // ✅ CHANGED
        runningValue = Math.max(0, runningValue - qty * currentWVR);
        runningQty = Math.max(0, runningQty - qty);
      }
      // else: NO CHANGE

      // ✅ NEW — har txn ke baad WVR yaad rakho, stock 0 hua to residue clean
      if (runningQty > 0) {
        lastWVR = runningValue / runningQty;
      } else {
        runningValue = 0;
      }
    }

    // ✅ CHANGED — stock 0 → 0 nahi, last known WVR return karo
    const finalWVR = runningQty > 0 ? runningValue / runningQty : lastWVR;
    return parseFloat(finalWVR.toFixed(10));
  } catch (error) {
    console.error("Error calculating last WVR:", error);
    throw error;
  }
};

exports.calculateWARForTallyAPI = async function (
  componentKey,
  insertDate,
  rowId,
  db,
) {
  try {
    const result = await db.query(
      `SELECT in_po_rate, exchange_rate, custom_duty, freight_charge, qty, final_rate, currency_type
       FROM rm_location WHERE ID = :rowId LIMIT 1`,
      { replacements: { rowId }, type: db.QueryTypes.SELECT },
    );
    if (!result.length) return 0;
    const rate = calculateRate(result[0]);
    return parseFloat(rate.toFixed(10));
  } catch (error) {
    console.error("Error in calculateWARForTallyAPI:", error);
    throw error;
  }
};

module.exports.calculateRate = calculateRate;

/**
 * FG ka rate calculate karo uske components ke WAR se.
 * @param {string} mfgRefTransId2 - item.mfg_ref_transid_2
 * @param {number|string} inQty   - item.in_qty (FG quantity)
 * @returns {Promise<number>} - calculated FG rate per unit
 */
exports.calculateFGRate = async function (mfgRefTransId2, inQty) {
  if (!mfgRefTransId2) return 0;

  const compRows = await invtDB.query(
    `SELECT rm_location.ID AS row_id,
            rm_location.insert_date AS mfg_date,
            rm_location.qty,
            components.component_key
     FROM rm_location
     LEFT JOIN components ON rm_location.components_id = components.component_key
     WHERE rm_location.mfg_ppr_trans_id_2 = :mfg_no`,
    {
      replacements: { mfg_no: mfgRefTransId2 },
      type: invtDB.QueryTypes.SELECT,
    },
  );

  if (!compRows.length) return 0;

  const fgQty = parseFloat(inQty) || 1;
  let totalValue = 0;

  for (const comp of compRows) {
    const wvr = await exports.newWeightedAverageRate(
      comp.component_key,
      comp.mfg_date,
      comp.row_id,
    );
    totalValue += (parseFloat(comp.qty) || 0) * wvr;
  }

  return totalValue / fgQty;
};

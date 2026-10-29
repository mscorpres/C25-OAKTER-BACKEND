const { invtDB } = require("../../config/db/connection");

// WAR calculation component ki saari transactions se hoti hai,
// opening stock/value 0 se start (New Logic without Opening).
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
 * WVR direction rules — SINGLE SOURCE OF TRUTH.
 *
 * isInwardTxn  : stock me value + qty add karta hai
 * isOutwardTxn : stock se qty ghatata hai (current WVR par issue hota hai)
 *
 * NOTE:
 *  - CONSUMPTION HAMESHA OUT (loc_storable chahe kuch bhi ho).
 *  - TRANSFER kabhi in/out nahi — internal movement hai, company-wide
 *    stock/WVR par net-zero (NO-CHANGE).
 *  - JOB WORK: sirf JW Outward (OUT) aur RM Return (IN) ka impact.
 *    JW Inward (IN-JWI) aur SFG-CONSUMPTION (vendor ke paas jobwork stock
 *    se consumption — RM JW Outward par pehle hi ghat chuka) NO-CHANGE.
 */
function isInwardTxn(txn) {
  return (
    (txn.trans_type === "INWARD" &&
      txn.in_module !== "IN-WO" &&
      txn.vendor_type === "v01") ||
    (txn.trans_type === "INWARD" &&
      txn.in_module === "IN-JWI" &&
      txn.vendor_type === "j01") ||
    (txn.trans_type === "INWARD" && txn.in_module === "PART-CONV") ||
    (txn.trans_type === "INWARD" && txn.in_module === "IN-QCA")  ||
    (txn.trans_type === "INWARD" && txn.vendor_type === "BT") ||
    (txn.trans_type === "TRANSFER" &&
      txn.trans_mode === "return" &&
      txn.vendor_type === "j01")
  );
}

function isOutwardTxn(txn) {
  const locStorable = parseInt(txn.loc_storable);
  return (
    (locStorable === 0 && txn.trans_type === "ISSUE") ||
    txn.trans_type === "CONSUMPTION" ||
    (txn.trans_type === "JOBWORK" && txn.vendor_type === "j01") ||
    txn.trans_type === "SFG-CONSUMPTION"
  );
}

/**
 * Component ki saari valid transactions (date/ID order me).
 * @param {string} componentKey
 * @param {string} extraCondition - extra WHERE clause (date filter)
 * @param {object} extraReplacements
 * @param {object} db - sequelize connection (default invtDB)
 */
async function fetchTransactions(componentKey, extraCondition = "", extraReplacements = {}, db = invtDB) {
  return db.query(
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
          LEFT JOIN location_main AS lm_in ON lm_in.location_key = rm_location.loc_in
          WHERE rm_location.components_id = :componentKey
            AND rm_location.trans_type NOT IN ('CANCELLED', 'REJECTION', 'MIN_PENDING', 'REVERSE')
            ${extraCondition}
          ORDER BY rm_location.insert_date ASC, rm_location.ID ASC`,
    {
      replacements: { componentKey, ...extraReplacements },
      type: db.QueryTypes.SELECT,
    },
  );
}

/**
 * WAR engine — New Logic without Opening.
 * Opening qty/value/rate = 0, phir har txn:
 *  IN  : WAR = (Last Closing Value + Inward Value) / (Last Closing Qty + Inward Qty)
 *  OUT : current WAR par issue — qty/value ghatte hain, WAR same rehta hai
 *  else: NO CHANGE
 * Stock 0 hone par value reset, last WAR yaad rehta hai.
 *
 * @param {object[]} transactions
 * @returns {{ rate: number, qty: number }}
 */
function runWAR(transactions) {
  let runningQty = 0;
  let runningValue = 0;
  let lastWVR = 0;

  for (const txn of transactions) {
    const qty = parseFloat(txn.qty) || 0;

    if (isInwardTxn(txn)) {
      runningValue = runningValue + qty * calculateRate(txn);
      runningQty = runningQty + qty;
    } else if (isOutwardTxn(txn)) {
      // out par current WAR par hi issue hota hai
      const currentWVR = runningQty > 0 ? runningValue / runningQty : lastWVR;
      runningValue = Math.max(0, runningValue - qty * currentWVR);
      runningQty = Math.max(0, runningQty - qty);
    }

    if (runningQty > 0) {
      lastWVR = runningValue / runningQty;
    } else {
      runningValue = 0;
    }
  }

  return {
    rate: parseFloat(lastWVR.toFixed(10)),
    qty: runningQty,
  };
}

/**
 * Component ka WAR — RM WAR ka EK HI function.
 * @param {string} componentKey
 * @param {string|Date|null} date - Optional — us date/time tak.
 *        Sirf "YYYY-MM-DD" diya to us din ke end (23:59:59) tak.
 * @param {number|null} currentID - Optional — date wale exact time par
 *        sirf is rm_location.ID tak (us row ko include karke)
 * @param {boolean} withStock - true → { rate, qty } (running stock qty bhi)
 * @param {object} db - Optional — branch DB (TallySync GST wise), default invtDB
 * @returns {Promise<number|{ rate: number, qty: number }>}
 */
exports.newWeightedAverageRate = async function (
  componentKey,
  date = null,
  currentID = null,
  withStock = false,
  db = invtDB,
) {
  try {
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      date = `${date} 23:59:59`;
    }

    let condition = ``;
    if (date && currentID) {
      condition = `AND (
              rm_location.insert_date < :date
              OR (rm_location.insert_date = :date AND rm_location.ID <= :currentID)
            )`;
    } else if (date) {
      condition = `AND rm_location.insert_date <= :date`;
    }

    const transactions = await fetchTransactions(componentKey, condition, { date, currentID }, db);
    const result = runWAR(transactions);
    return withStock ? result : result.rate;
  } catch (error) {
    console.error("Error calculating WVR:", error);
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

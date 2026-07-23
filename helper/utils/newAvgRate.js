const { invtDB } = require("../../config/db/connection");

const CUTOFF_DATE = "2026-07-06 11:45:00";
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
 * WVR direction rules — SINGLE SOURCE OF TRUTH.
 * Sabhi WAR functions (view/last/breakup) yahi use karte hain taaki numbers
 * kabhi drift na karein.
 *
 * isInwardTxn  : stock me value + qty add karta hai
 * isOutwardTxn : stock se qty ghatata hai (current WVR par issue hota hai)
 *
 * NOTE:
 *  - CONSUMPTION HAMESHA OUT (loc_storable chahe kuch bhi ho).
 *  - TRANSFER kabhi in/out nahi — internal movement hai, company-wide
 *    stock/WVR par net-zero (NO-CHANGE).
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
 * Calculate WVR for a component transaction by transaction
 * @param {string} componentKey
 * @param {string} date - "YYYY-MM-DD HH:mm:ss"
 * @param {number} currentID - rm_location.ID of current row (include this)
 * @returns {Promise<number>} - WVR after this transaction
 *
 * WVR Rules:
 *  UP (+)    : INWARD  + in_module != IN-WO  + vendor_type = v01
 *              INWARD  + vendor_type = BT (branch transfer)
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

      const isInward = isInwardTxn(txn);
      const isOutward = isOutwardTxn(txn);

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

      const isInward = isInwardTxn(txn);
      const isOutward = isOutwardTxn(txn);

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

/**
 * Same engine as lastNewWeightedAverageRate, but also returns the running
 * stock qty it computed — needed when a caller wants to correctly blend in
 * an additional (not-yet-committed) inward without re-deriving qty via a
 * separately-scoped aggregate query that may not match the engine's own
 * isInward/isOutward bucketing.
 * @param {string} componentKey
 * @param {string|null} date
 * @returns {Promise<{ rate: number, qty: number }>}
 */
exports.lastNewWeightedAverageRateWithStock = async function (
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

    const hasPostCutoffTxn = transactions.some(
      (txn) => new Date(txn.insert_date).getTime() > cutoffMs,
    );

    if (!hasPostCutoffTxn) {
      const avgRows = await invtDB.query(
        `SELECT last_rate, closing_stock
                 FROM tbl_average_rate_2026
                 WHERE component_key = :componentKey
                 LIMIT 1`,
        {
          replacements: { componentKey: componentKey },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (avgRows.length > 0) {
        return {
          rate: parseFloat(parseFloat(avgRows[0].last_rate).toFixed(10)),
          qty: parseFloat(avgRows[0].closing_stock) || 0,
        };
      }
      return { rate: 0, qty: 0 };
    }

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
    let lastWVR = 0;

    if (avgRows.length > 0) {
      runningQty = parseFloat(avgRows[0].closing_stock) || 0;
      runningValue = parseFloat(avgRows[0].closing_stock_value) || 0;
      lastWVR = parseFloat(avgRows[0].last_rate) || 0;
    }

    for (const txn of transactions) {
      if (new Date(txn.insert_date).getTime() <= cutoffMs) {
        continue;
      }

      const qty = parseFloat(txn.qty) || 0;
      const rate = calculateRate(txn);

      const isInward = isInwardTxn(txn);
      const isOutward = isOutwardTxn(txn);

      if (isInward) {
        runningValue = runningValue + qty * rate;
        runningQty = runningQty + qty;
      } else if (isOutward) {
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

    const finalWVR = runningQty > 0 ? runningValue / runningQty : lastWVR;
    return {
      rate: parseFloat(finalWVR.toFixed(10)),
      qty: runningQty,
    };
  } catch (error) {
    console.error("Error calculating last WVR with stock:", error);
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
 * WAR (Weighted Average Rate) ka transaction-by-transaction breakup return karo.
 * Same engine as newWeightedAverageRate — sirf har step capture karta hai taaki
 * frontend par WAR kaise bana ye dikhaya ja sake.
 *
 * Columns (har row): Qty | Rate | Value | Closing Qty | WAR | Value
 *   - qty        : is transaction ki quantity
 *   - rate       : is transaction ka smart rate (calculateRate)
 *   - value      : qty * rate (is txn ka value impact)
 *   - closingQty : is txn ke baad running stock qty
 *   - war        : is txn ke baad weighted average rate
 *   - value(closing) : closingQty * war (running stock value)
 *
 * @param {string} componentKey
 * @param {string|null} date - Optional "YYYY-MM-DD HH:mm:ss" — us date tak ka breakup
 * @returns {Promise<{ opening: object, rows: object[], closing: object }>}
 */
exports.newWeightedAverageRateBreakup = async function (
  componentKey,
  date = null,
) {
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
            AND rm_location.insert_date > :cutoffDate
            AND rm_location.trans_type NOT IN ('CANCELLED', 'REJECTION', 'MIN_PENDING', 'REVERSE')
            ${dateCondition}
          ORDER BY rm_location.insert_date ASC, rm_location.ID ASC`,
    {
      replacements: {
        componentKey: componentKey,
        cutoffDate: CUTOFF_DATE,
        ...(date && { date: date }),
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
  let lastWVR = 0;

  if (avgRows.length > 0) {
    runningQty = parseFloat(avgRows[0].closing_stock) || 0;
    runningValue = parseFloat(avgRows[0].closing_stock_value) || 0;
    lastWVR = parseFloat(avgRows[0].last_rate) || 0;
  }

  const round = (n) => parseFloat((parseFloat(n) || 0).toFixed(4));

  const opening = {
    closingQty: round(runningQty),
    war: round(lastWVR),
    value: round(runningValue),
  };

  const rows = [];

  for (const txn of transactions) {
    const qty = parseFloat(txn.qty) || 0;
    const rate = calculateRate(txn);

    const isInward = isInwardTxn(txn);
    const isOutward = isOutwardTxn(txn);

    let direction = "NO-CHANGE";
    let rowRate = rate;

    if (isInward) {
      direction = "IN";
      runningValue = runningValue + qty * rate;
      runningQty = runningQty + qty;
    } else if (isOutward) {
      direction = "OUT";
      const currentWVR = runningQty > 0 ? runningValue / runningQty : lastWVR;
      rowRate = currentWVR; // out par current WAR par hi issue hota hai
      runningValue = Math.max(0, runningValue - qty * currentWVR);
      runningQty = Math.max(0, runningQty - qty);
    }

    if (runningQty > 0) {
      lastWVR = runningValue / runningQty;
    } else {
      runningValue = 0;
    }

    rows.push({
      id: txn.ID,
      date: moment(txn.insert_date).format("DD-MM-YYYY HH:mm:ss"),
      transactionType: txn.trans_type,
      direction, // IN | OUT | NO-CHANGE
      qty: round(qty),
      rate: round(rowRate),
      value: round(qty * rowRate), // hamesha positive — is txn ka value
      closingQty: round(runningQty),
      war: round(runningQty > 0 ? runningValue / runningQty : lastWVR),
      closingValue: round(runningValue),
    });
  }

  const closing = {
    closingQty: round(runningQty),
    war: round(runningQty > 0 ? runningValue / runningQty : lastWVR),
    value: round(runningValue),
  };

  return { opening, rows, closing };
};

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

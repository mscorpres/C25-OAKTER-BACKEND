const { invtDB } = require("../../config/db/connection");

const FG_CUTOFF_DATE = "2026-07-07 00:00:00"; // FG cutoff 28 June 2026 09:30 PM
const INR_CURRENCY = 364907247; // INR

// Inward rate: foreign currency ho to convert, warna seedha in_fg_rate
function fgCalculateRate(txn) {
  const inFgRate = parseFloat(txn.in_fg_rate) || 0;
  const exchangeRate = parseFloat(txn.exchange_rate) || 1;
  const qty = parseFloat(txn.mfg_approve_in_qty) || 0;
  const currencyType = parseInt(txn.currency_type) || INR_CURRENCY;

  if (currencyType !== INR_CURRENCY && qty > 0) {
    return (qty * inFgRate * exchangeRate) / qty; // = inFgRate × exchangeRate
  }
  return inFgRate;
}

// ─── Shared: ek txn pe running qty/value/WAR update (single source of truth) ──
//     state = { runningQty, runningValue, lastWAR }
function applyFgTxn(txn, state) {
  // 1. Outward Consumption → DOWN (current WAR pe minus)
  const isConsumption =
    txn.type === "OUT" &&
    txn.fg_out_type !== "--" &&
    txn.fg_status === "ACTIVE";

  // 2. FG→FG Godown Transfer → NO CHANGE
  const isTransfer = txn.type === "TRANSFER" && txn.fg_out_type === "--";

  // 3. FG inward through Purchase → UP (apne rate pe blend)
  const isPurchase = txn.inward_type === "VENDOR" && txn.vendor_type === "v01";

  // 4. FG Sales Return → qty UP, par current WAR pe (WAR same rehta)
  const isSalesReturn =
    txn.inward_type === "SALES-RETURN" && txn.vendor_type === "s01";

  // 5. Inward through MFG → UP (apne rate pe blend)
  const isMfgInward = txn.type === "IN" && txn.fg_status === "ACTIVE";

  const outQty = parseFloat(txn.fgout_approve_out_qty) || 0;
  const inQty = parseFloat(txn.mfg_approve_in_qty) || 0;
  const inRate = fgCalculateRate(txn);

  if (isConsumption) {
    const currentWAR =
      state.runningQty > 0
        ? state.runningValue / state.runningQty
        : state.lastWAR;
    state.runningValue = Math.max(0, state.runningValue - outQty * currentWAR);
    state.runningQty = Math.max(0, state.runningQty - outQty);
  } else if (isPurchase || isMfgInward) {
    state.runningValue = state.runningValue + inQty * inRate;
    state.runningQty = state.runningQty + inQty;
  } else if (isSalesReturn) {
    const currentWAR =
      state.runningQty > 0
        ? state.runningValue / state.runningQty
        : state.lastWAR;
    state.runningValue = state.runningValue + inQty * currentWAR;
    state.runningQty = state.runningQty + inQty;
  } else if (isTransfer) {
    // NO CHANGE
  }
  // else: koi aur type → NO CHANGE

  if (state.runningQty > 0) {
    state.lastWAR = state.runningValue / state.runningQty;
  } else {
    state.runningValue = 0;
  }
}

// ─── p_sku / product_key resolve karo ───────────────────────────────────
async function resolveKeys(skuKey) {
  const [product] = await invtDB.query(
    `SELECT p_sku, product_key FROM products WHERE p_sku = :code OR product_key = :code LIMIT 1`,
    { replacements: { code: skuKey }, type: invtDB.QueryTypes.SELECT },
  );
  return {
    pSku: product ? product.p_sku : skuKey,
    productKey: product ? product.product_key : skuKey,
  };
}

// ─── Opening balance tbl_fg_avr_rate_2026 se ───────────────────────────
async function getOpening(productKey) {
  const avgRows = await invtDB.query(
    `SELECT last_rate, closing_stock, closing_stock_value
           FROM tbl_fg_avr_rate_2026
           WHERE sku_key = :productKey
           LIMIT 1`,
    { replacements: { productKey }, type: invtDB.QueryTypes.SELECT },
  );

  if (avgRows.length > 0) {
    return {
      runningQty: parseFloat(avgRows[0].closing_stock) || 0,
      runningValue: parseFloat(avgRows[0].closing_stock_value) || 0,
      lastWAR: parseFloat(avgRows[0].last_rate) || 0,
    };
  }
  return { runningQty: 0, runningValue: 0, lastWAR: 0 };
}

// ════════════════════════════════════════════════════════════════════════
// 1. Per-row WAR (report ke liye — date/currentID tak)
//    date na do to current IST; currentID na do to no cap
// ════════════════════════════════════════════════════════════════════════
exports.fgWeightedAverageRate = async function (
  skuKey,
  date = null,
  currentID = null,
) {
  try {
    if (!date) {
      date = moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss");
    }
    if (currentID === null || currentID === undefined) {
      currentID = Number.MAX_SAFE_INTEGER;
    }

    const { pSku, productKey } = await resolveKeys(skuKey);

    const transactions = await invtDB.query(
      `SELECT
                ID,
                mfg_pro_apr_sku,
                fgout_pro_apr_sku,
                type,
                inward_type,
                vendor_type,
                fg_out_type,
                fg_status,
                currency_type,
                fgout_approve_out_qty,
                mfg_approve_in_qty,
                in_fg_rate,
                COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) AS txn_date
            FROM mfg_production_3
            WHERE (
                    mfg_pro_apr_sku = :pSku OR mfg_pro_apr_sku = :productKey
                    OR fgout_pro_apr_sku = :pSku OR fgout_pro_apr_sku = :productKey
                  )
              AND COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) > :cutoffDate
              AND (
                    COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) < :date
                    OR (COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) = :date AND ID <= :currentID)
              )
            ORDER BY COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) ASC, ID ASC`,
      {
        replacements: {
          pSku,
          productKey,
          date,
          currentID,
          cutoffDate: FG_CUTOFF_DATE,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const state = await getOpening(productKey);

    for (const txn of transactions) {
      applyFgTxn(txn, state);
    }

    const finalWAR =
      state.runningQty > 0
        ? state.runningValue / state.runningQty
        : state.lastWAR;
    return parseFloat(finalWAR.toFixed(10));
  } catch (error) {
    console.error("Error calculating FG WAR:", error);
    throw error;
  }
};

// ════════════════════════════════════════════════════════════════════════
// 2. Latest/last WAR — date na do to cutoff ke baad sab (current IST tak)
// ════════════════════════════════════════════════════════════════════════
exports.lastFGWeightedAverageRate = async function (skuKey, date = null) {
  try {
    const cutoffMs = new Date(FG_CUTOFF_DATE).getTime();

    if (!date) {
      date = moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss");
    }

    const dateCondition = date
      ? `AND COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) <= :date`
      : ``;

    const { pSku, productKey } = await resolveKeys(skuKey);

    const transactions = await invtDB.query(
      `SELECT
                ID,
                mfg_pro_apr_sku,
                fgout_pro_apr_sku,
                type,
                inward_type,
                vendor_type,
                fg_out_type,
                fg_status,
                currency_type,
                fgout_approve_out_qty,
                mfg_approve_in_qty,
                in_fg_rate,
                COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) AS txn_date
            FROM mfg_production_3
            WHERE (
                    mfg_pro_apr_sku = :pSku OR mfg_pro_apr_sku = :productKey
                    OR fgout_pro_apr_sku = :pSku OR fgout_pro_apr_sku = :productKey
                  )
              AND COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) > :cutoffDate
              ${dateCondition}
            ORDER BY COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) ASC, ID ASC`,
      {
        replacements: {
          pSku,
          productKey,
          cutoffDate: FG_CUTOFF_DATE,
          ...(date && { date }),
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const hasPostCutoffTxn = transactions.some(
      (txn) => new Date(txn.txn_date).getTime() > cutoffMs,
    );

    if (!hasPostCutoffTxn) {
      const avgRows = await invtDB.query(
        `SELECT last_rate FROM tbl_fg_avr_rate_2026 WHERE sku_key = :productKey LIMIT 1`,
        { replacements: { productKey }, type: invtDB.QueryTypes.SELECT },
      );
      if (avgRows.length > 0) {
        return parseFloat(parseFloat(avgRows[0].last_rate).toFixed(10));
      }
      return 0;
    }

    const state = await getOpening(productKey);

    for (const txn of transactions) {
      if (new Date(txn.txn_date).getTime() <= cutoffMs) continue;
      applyFgTxn(txn, state);
    }

    const finalWAR =
      state.runningQty > 0
        ? state.runningValue / state.runningQty
        : state.lastWAR;
    return parseFloat(finalWAR.toFixed(10));
  } catch (error) {
    console.error("Error calculating last FG WAR:", error);
    throw error;
  }
};

// ════════════════════════════════════════════════════════════════════════
// 3. DEBUG: console me pura table dikhao (Qty | Rate | Value | Closing | WAR | Value as per WAR)
//    Use: await printFGTable("15720");           // current IST tak sab
//         await printFGTable("15720", "2026-06-27 12:00:00");  // us date tak
// ════════════════════════════════════════════════════════════════════════
exports.printFGTable = async function (skuKey, date = null) {
  try {
    const cutoffMs = new Date(FG_CUTOFF_DATE).getTime();

    if (!date) {
      date = moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss");
    }

    const { pSku, productKey } = await resolveKeys(skuKey);

    const transactions = await invtDB.query(
      `SELECT
                ID,
                mfg_pro_apr_sku,
                fgout_pro_apr_sku,
                type,
                inward_type,
                vendor_type,
                fg_out_type,
                fg_status,
                currency_type,
                fgout_approve_out_qty,
                mfg_approve_in_qty,
                in_fg_rate,
                COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) AS txn_date
            FROM mfg_production_3
            WHERE (
                    mfg_pro_apr_sku = :pSku OR mfg_pro_apr_sku = :productKey
                    OR fgout_pro_apr_sku = :pSku OR fgout_pro_apr_sku = :productKey
                  )
              AND COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) > :cutoffDate
              AND COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) <= :date
            ORDER BY COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--')) ASC, ID ASC`,
      {
        replacements: { pSku, productKey, cutoffDate: FG_CUTOFF_DATE, date },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const state = await getOpening(productKey);

    console.log(
      `\n📋  FG WAR TABLE — SKU: ${skuKey}  (cutoff: ${FG_CUTOFF_DATE} → ${date})`,
    );
    console.log(
      `📦 OPENING → Closing:${state.runningQty}  WAR:${state.lastWAR}  Value:${state.runningValue}`,
    );
    console.log("─".repeat(135));
    console.log(
      "│ " +
        "Qty".padStart(10) +
        " │ " +
        "Rate".padStart(14) +
        " │ " +
        "Value".padStart(14) +
        " │ " +
        "Closing Qty".padStart(12) +
        " │ " +
        "WAR".padStart(16) +
        " │ " +
        "Value as per WAR".padStart(18) +
        " │  Type",
    );
    console.log("─".repeat(135));

    for (const txn of transactions) {
      // pehchaano (sirf display ke liye)
      const isConsumption =
        txn.type === "OUT" &&
        txn.fg_out_type !== "--" &&
        txn.fg_status === "ACTIVE";
      const isTransfer = txn.type === "TRANSFER" && txn.fg_out_type === "--";
      const isPurchase =
        txn.inward_type === "VENDOR" && txn.vendor_type === "v01";
      const isSalesReturn =
        txn.inward_type === "SALES-RETURN" && txn.vendor_type === "s01";
      const isMfgInward = txn.type === "IN" && txn.fg_status === "ACTIVE";

      const outQty = parseFloat(txn.fgout_approve_out_qty) || 0;
      const inQty = parseFloat(txn.mfg_approve_in_qty) || 0;
      const inRate = fgCalculateRate(txn);

      let dispQty = 0,
        dispRate = 0,
        dispValue = 0,
        label = "NO CHANGE";

      if (isConsumption) {
        dispQty = outQty;
        dispRate =
          state.runningQty > 0
            ? state.runningValue / state.runningQty
            : state.lastWAR;
        dispValue = outQty * dispRate;
        label = "Outward Consumption [-]";
      } else if (isPurchase) {
        dispQty = inQty;
        dispRate = inRate;
        dispValue = inQty * inRate;
        label = "FG Purchase [+]";
      } else if (isMfgInward) {
        dispQty = inQty;
        dispRate = inRate;
        dispValue = inQty * inRate;
        label = "Inward through MFG [+]";
      } else if (isSalesReturn) {
        dispQty = inQty;
        dispRate =
          state.runningQty > 0
            ? state.runningValue / state.runningQty
            : state.lastWAR;
        dispValue = inQty * dispRate;
        label = "FG Sales Return [= qty+]";
      } else if (isTransfer) {
        dispQty =
          parseFloat(txn.mfg_approve_in_qty) ||
          parseFloat(txn.fgout_approve_out_qty) ||
          0;
        dispRate = state.lastWAR;
        dispValue = 0;
        label = "FG→FG Transfer [=]";
      }

      // state update (asli calculation)
      applyFgTxn(txn, state);

      const warValue = state.runningQty * state.lastWAR;

      console.log(
        "│ " +
          String(dispQty).padStart(10) +
          " │ " +
          dispRate.toFixed(4).padStart(14) +
          " │ " +
          dispValue.toFixed(2).padStart(14) +
          " │ " +
          String(state.runningQty).padStart(12) +
          " │ " +
          state.lastWAR.toFixed(6).padStart(16) +
          " │ " +
          warValue.toFixed(4).padStart(18) +
          " │  " +
          label,
      );
    }

    console.log("─".repeat(135));
    const finalWAR =
      state.runningQty > 0
        ? state.runningValue / state.runningQty
        : state.lastWAR;
    console.log(
      `✅ FINAL → Closing:${state.runningQty}  WAR:${finalWAR.toFixed(10)}  Value:${state.runningValue.toFixed(4)}\n`,
    );
    return parseFloat(finalWAR.toFixed(10));
  } catch (error) {
    console.error("Error printing FG table:", error);
    throw error;
  }
};

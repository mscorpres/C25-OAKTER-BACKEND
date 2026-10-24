const { invtDB } = require("../../config/db/connection");

// FG WAR — SKU ki saari transactions se, opening stock/value 0 se start
// (New Logic without Opening). Koi cutoff / opening table nahi.
const INR_CURRENCY = 364907247; // INR

const TXN_DATE = `COALESCE(NULLIF(mfg_pro_apr_fulldate, '--'), NULLIF(fgout_pro_apr_fulldate, '--'))`;

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

  // 3b. FG inward through Branch Transfer → UP (apne rate pe blend)
  const isBranchTransfer = txn.vendor_type === "BT";

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
  } else if (isPurchase || isMfgInward || isBranchTransfer) {
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

// ─── SKU ki transactions (date/ID order me) + WAR calculate ─────────────
async function calculateFgWAR(skuKey, dateCondition, extraReplacements) {
  const { pSku, productKey } = await resolveKeys(skuKey);

  const transactions = await invtDB.query(
    `SELECT
              ID,
              type,
              inward_type,
              vendor_type,
              fg_out_type,
              fg_status,
              currency_type,
              fgout_approve_out_qty,
              mfg_approve_in_qty,
              in_fg_rate
          FROM mfg_production_3
          WHERE (
                  mfg_pro_apr_sku = :pSku OR mfg_pro_apr_sku = :productKey
                  OR fgout_pro_apr_sku = :pSku OR fgout_pro_apr_sku = :productKey
                )
            ${dateCondition}
          ORDER BY ${TXN_DATE} ASC, ID ASC`,
    {
      replacements: { pSku, productKey, ...extraReplacements },
      type: invtDB.QueryTypes.SELECT,
    },
  );

  const state = { runningQty: 0, runningValue: 0, lastWAR: 0 };
  for (const txn of transactions) {
    applyFgTxn(txn, state);
  }
  return parseFloat(state.lastWAR.toFixed(10));
}

const nowIST = () => moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss");

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
    return await calculateFgWAR(
      skuKey,
      `AND (
              ${TXN_DATE} < :date
              OR (${TXN_DATE} = :date AND ID <= :currentID)
            )`,
      {
        date: date || nowIST(),
        currentID: currentID ?? Number.MAX_SAFE_INTEGER,
      },
    );
  } catch (error) {
    console.error("Error calculating FG WAR:", error);
    throw error;
  }
};

// ════════════════════════════════════════════════════════════════════════
// 2. Latest/last WAR — date na do to current IST tak
// ════════════════════════════════════════════════════════════════════════
exports.lastFGWeightedAverageRate = async function (skuKey, date = null) {
  try {
    return await calculateFgWAR(skuKey, `AND ${TXN_DATE} <= :date`, {
      date: date || nowIST(),
    });
  } catch (error) {
    console.error("Error calculating last FG WAR:", error);
    throw error;
  }
};

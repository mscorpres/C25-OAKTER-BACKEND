const { invtDB } = require("../../config/db/connection");

//last inward rate

exports.getLastInwardRate = async function(component_key,vendor_code){
  try{
     if (!component_key || !vendor_code) {
      return 0;
    }
     const result = await invtDB.query(
      `SELECT (in_po_rate * exchange_rate) AS actual_rate
       FROM rm_location 
       WHERE components_id = :component_key
         AND trans_type = 'INWARD'
         AND in_vendor_name = :vendor_code
         AND in_module != 'IN-FGRETURN'  
         AND in_po_rate > 0
         AND exchange_rate > 0
       ORDER BY insert_date DESC, ID DESC 
       LIMIT 1`,
      {
        replacements: {
          component_key,
          vendor_code,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    
    if (result.length > 0 && result[0].actual_rate) {
      return parseFloat(result[0].actual_rate).toFixed(4) * 1; // Convert to number with 4 decimals
    }

    return 0;
  } catch (error) {
    console.error("Error in getLastInwardRate helper:", error);
    return 0;
  }

  }

/** Last inward rate + currency symbol as one display string — used only by getComponentDetailsByCode. */
exports.getLastInwardRateDisplayForComponentDetail = async function (component_key, vendor_code) {
  try {
    if (!component_key || !vendor_code) {
      return formatInwardRateForDisplay({ rate: 0, currency_symbol: null });
    }
    const result = await invtDB.query(
      `SELECT rl.in_po_rate AS actual_rate, ic.currency_symbol
       FROM rm_location rl
       LEFT JOIN ims_currency ic ON ic.currency_id = rl.currency_type
       WHERE rl.components_id = :component_key
         AND rl.trans_type = 'INWARD'
         AND rl.in_vendor_name = :vendor_code
         AND rl.in_module != 'IN-FGRETURN'
         AND rl.in_po_rate > 0
         AND rl.exchange_rate > 0
       ORDER BY rl.insert_date DESC, rl.ID DESC
       LIMIT 1`,
      {
        replacements: {
          component_key,
          vendor_code,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0 && result[0].actual_rate != null) {
      return formatInwardRateForDisplay({
        rate: parseFloat(result[0].actual_rate).toFixed(4) * 1,
        currency_symbol: result[0].currency_symbol || null,
      });
    }

    return formatInwardRateForDisplay({ rate: 0, currency_symbol: null });
  } catch (error) {
    console.error("Error in getLastInwardRateDisplayForComponentDetail:", error);
    return "0";
  }
};

function formatInwardRateForDisplay(inward) {
  if (!inward) return "0";
  const n = Number(inward.rate || 0);
  const val = parseFloat(n.toFixed(4));
  const sym = inward.currency_symbol;
  return sym ? `${val} ${sym}` : String(val);
}
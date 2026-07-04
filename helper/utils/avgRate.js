const { invtDB } = require("../../config/db/connection");

exports.getWeightedPurchaseRate = async function (componentKey, date) {
  // Ensure date is in proper format (YYYY-MM-DD HH:mm:ss)
  // If only date is provided, append end of day time
  let formattedDate = date;
  if (date && date.length === 10 && !date.includes(' ')) {
    // Date only format (YYYY-MM-DD), append end of day time
    formattedDate = date + ' 23:59:59';
  }
  
  // Define the query to calculate the Weighted Purchase Rate
  // Use <= for end date to include all transactions up to and including the given date/time
  const query =
    "SELECT COALESCE(SUM((in_po_rate * exchange_rate * qty) + custom_duty + freight_charge), 0) AS sum_amount, COALESCE(SUM(qty), 0) AS sum_qty FROM rm_location WHERE components_id = :componentKey AND DATE_FORMAT(insert_date, '%Y-%m-%d %H:%i:%s') >= :startDate AND DATE_FORMAT(insert_date, '%Y-%m-%d %H:%i:%s') <= :date AND trans_type IN('INWARD') AND (in_module != 'IN-FGRETURN')";

  // Execute the query with the provided parameters
  const result = await invtDB.query(query, {
    replacements: { componentKey, date: formattedDate, startDate: `2025-04-01 00:00:00` },
    type: invtDB.QueryTypes.SELECT,
  });

  let getAverageRate = await invtDB.query("SELECT * FROM tbl_average_rate WHERE component_key = :componentKey", {
    replacements: { componentKey },
    type: invtDB.QueryTypes.SELECT,
  });

  // console.table(getAverageRate);

  if (getAverageRate.length <= 0) {
    getAverageRate = [{ average_rate: 0, closing_qty: 0 }];
  }

  // Destructure the results
  const { sum_amount, sum_qty } = result[0];

  // console.table(result);

  // Calculate the Weighted Purchase Rate
  const weightedPurchaseRate = (sum_amount + Number(getAverageRate[0].average_rate * getAverageRate[0].closing_qty)) / (sum_qty + Number(getAverageRate[0].closing_qty));

  // console.table([
  //   {
  //     weightedPurchaseRate : Number.isNaN(weightedPurchaseRate) ? 0 : weightedPurchaseRate.toFixed(2),
  //     sum_qty,
  //     sum_amount,
  //     avr_val: getAverageRate[0].average_rate * getAverageRate[0].closing_qty,
  //     closing_qty: getAverageRate[0].closing_qty,
  //     avr_rate: getAverageRate[0].average_rate,
  //     closing: getAverageRate[0].closing_qty,
  //     date,
  //   },
  // ]);

  // Return the calculated rate
  return Number.isNaN(weightedPurchaseRate) ? 0 : weightedPurchaseRate.toFixed(2);
};


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

exports.getWeightedSKURate = async function (productKey, date) {
  try {
    const startDate = '2026-02-01 00:00:00';
    
    // Query: SUM(in_fg_rate × mfg_prod_planing_qty) and SUM(mfg_prod_planing_qty) from mfg_production_2 (type 'C' only)
    const query =
      "SELECT COALESCE(SUM((CASE WHEN mfg_production_3.type = 'IN' THEN mfg_production_2.in_fg_rate WHEN mfg_production_3.type = 'FGMIN' THEN mfg_production_3.in_fg_rate END) * (CASE WHEN mfg_production_3.type = 'IN' THEN mfg_production_2.mfg_prod_planing_qty WHEN mfg_production_3.type = 'FGMIN' THEN mfg_production_3.mfg_approve_in_qty END)), 0) AS sum_amount, COALESCE(SUM(CASE WHEN mfg_production_3.type = 'IN' THEN mfg_production_2.mfg_prod_planing_qty WHEN mfg_production_3.type = 'FGMIN' THEN mfg_production_3.mfg_approve_in_qty END), 0) AS sum_qty FROM mfg_production_3 LEFT JOIN products ON mfg_production_3.mfg_pro_apr_sku = products.p_sku LEFT JOIN mfg_production_2 ON mfg_production_3.mfg_ref_transid_2 = mfg_production_2.mfg_transaction AND mfg_production_2.mfg_prod_type = 'C' WHERE products.product_key = :productKey AND DATE_FORMAT(mfg_production_3.mfg_pro_apr_fulldate, '%Y-%m-%d %H:%i:%s') >= :startDate AND DATE_FORMAT(mfg_production_3.mfg_pro_apr_fulldate, '%Y-%m-%d %H:%i:%s') <= :date AND mfg_production_3.type IN('IN', 'FGMIN') AND ((mfg_production_3.type = 'IN' AND mfg_production_2.in_fg_rate IS NOT NULL AND mfg_production_2.in_fg_rate != '' AND mfg_production_2.in_fg_rate != '0' AND CAST(mfg_production_2.in_fg_rate AS DECIMAL(15,4)) > 0) OR (mfg_production_3.type = 'FGMIN' AND mfg_production_3.in_fg_rate IS NOT NULL AND mfg_production_3.in_fg_rate != '' AND mfg_production_3.in_fg_rate != '0' AND CAST(mfg_production_3.in_fg_rate AS DECIMAL(15,4)) > 0))";

    const result = await invtDB.query(query, {
      replacements: { productKey, date, startDate },
      type: invtDB.QueryTypes.SELECT,
    });

    // Detailed query to show individual rate and qty values
    const detailQuery = "SELECT mfg_production_3.type, CASE WHEN mfg_production_3.type = 'IN' THEN mfg_production_2.in_fg_rate WHEN mfg_production_3.type = 'FGMIN' THEN mfg_production_3.in_fg_rate END AS rate, CASE WHEN mfg_production_3.type = 'IN' THEN mfg_production_2.mfg_prod_planing_qty WHEN mfg_production_3.type = 'FGMIN' THEN mfg_production_3.mfg_approve_in_qty END AS qty, (CASE WHEN mfg_production_3.type = 'IN' THEN mfg_production_2.in_fg_rate WHEN mfg_production_3.type = 'FGMIN' THEN mfg_production_3.in_fg_rate END) * (CASE WHEN mfg_production_3.type = 'IN' THEN mfg_production_2.mfg_prod_planing_qty WHEN mfg_production_3.type = 'FGMIN' THEN mfg_production_3.mfg_approve_in_qty END) AS rate_x_qty, mfg_production_3.mfg_pro_apr_fulldate FROM mfg_production_3 LEFT JOIN products ON mfg_production_3.mfg_pro_apr_sku = products.p_sku LEFT JOIN mfg_production_2 ON mfg_production_3.mfg_ref_transid_2 = mfg_production_2.mfg_transaction AND mfg_production_2.mfg_prod_type = 'C' WHERE products.product_key = :productKey AND DATE_FORMAT(mfg_production_3.mfg_pro_apr_fulldate, '%Y-%m-%d %H:%i:%s') >= :startDate AND DATE_FORMAT(mfg_production_3.mfg_pro_apr_fulldate, '%Y-%m-%d %H:%i:%s') <= :date AND mfg_production_3.type IN('IN', 'FGMIN') AND ((mfg_production_3.type = 'IN' AND mfg_production_2.in_fg_rate IS NOT NULL AND mfg_production_2.in_fg_rate != '' AND mfg_production_2.in_fg_rate != '0' AND CAST(mfg_production_2.in_fg_rate AS DECIMAL(15,4)) > 0) OR (mfg_production_3.type = 'FGMIN' AND mfg_production_3.in_fg_rate IS NOT NULL AND mfg_production_3.in_fg_rate != '' AND mfg_production_3.in_fg_rate != '0' AND CAST(mfg_production_3.in_fg_rate AS DECIMAL(15,4)) > 0)) ORDER BY mfg_production_3.mfg_pro_apr_fulldate";
    
    const detailResult = await invtDB.query(detailQuery, {
      replacements: { productKey, date, startDate },
      type: invtDB.QueryTypes.SELECT,
    });

    console.log("=== Individual Transaction Details ===");
    console.table(detailResult);
    console.log("====================================");

    let getAverageRate = await invtDB.query("SELECT * FROM tbl_sku_average_rate WHERE sku_key = :productKey", {
      replacements: { productKey },
      type: invtDB.QueryTypes.SELECT,
    });

    if (getAverageRate.length <= 0) {
      getAverageRate = [{ average_rate: 0, closing_qty: 0, total_value: 0 }];
    }

    const { sum_amount, sum_qty } = result[0];
    const totalValue = Number(getAverageRate[0].total_value || 0);
    const openingQty = Number(getAverageRate[0].closing_qty || 0);

    // Formula: (SUM(rate × qty) + total_value) / (SUM(qty) + closing_qty)
    const numerator = Number(sum_amount) + totalValue;
    const denominator = Number(sum_qty) + openingQty;
    const weightedSKURate = denominator > 0 ? numerator / denominator : 0;

    console.log("=== Weighted SKU Rate Calculation ===");
    console.log("Product Key:", productKey);
    console.log("Date:", date);
    console.log("SUM(rate × qty) - sum_amount:", sum_amount);
    console.log("SUM(qty) - sum_qty:", sum_qty);
    console.log("Opening total_value:", totalValue);
    console.log("Opening closing_qty:", openingQty);
    console.log("Numerator (sum_amount + total_value):", numerator);
    console.log("Denominator (sum_qty + openingQty):", denominator);
    console.log("Weighted SKU Rate:", weightedSKURate);
    console.log("===================================");

    return Number.isNaN(weightedSKURate) ? 0 : weightedSKURate;
  } catch (error) {
    console.error("Error fetching Weighted SKU Rate:", error);
    return 0;
  }
};

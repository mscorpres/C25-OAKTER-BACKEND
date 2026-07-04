const express = require("express");
const router = express.Router();
const { invtDB, otherDB } = require("../../../config/db/connection");

// Middleware to validate API token
const validateApiToken = async (req, res, next) => {
  const authHeader = req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.json({
      code: 401,
      message: "No token provided",
      status: "error",
      success: false,
    });
  }

  const token = authHeader.replace("Bearer ", "");
  try {
    const currentTime = moment.tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const tokenRecord = await otherDB.query(
      `SELECT *, 
                  expires_at AS expires_at_raw 
           FROM tbl_api_tokens 
           WHERE token = :token 
             AND expires_at > :currentTime`,
      {
        replacements: { token, currentTime },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (!tokenRecord.length) {
      return res.json({
        code: 401,
        message: "Invalid OR the token has been expired",
        status: "error",
        success: false,
      });
    }

    req.client_code = tokenRecord[0].client_code;
    next();
  } catch (error) {
    console.error("Error validating API token:", error);
    return helper.errorResponse(res, error);
  }
};

router.post("/fg/stock", [validateApiToken], async (req, res) => {
  try {
    if (!req.body.date) {
      return res.json({
        status: "error",
        success: false,
        message:
          "date is required. Example: '21-11-2025' OR '01-01-2024 - 31-01-2024'",
      });
    }

    let fromdate, todate;
    const dateInput = req.body.date.trim();

    const singleDateMatch = dateInput.match(
      /^([0-9]{2})-([0-9]{2})-([0-9]{4})$/
    );

    if (singleDateMatch) {
      fromdate = moment(dateInput, "DD-MM-YYYY").format("YYYY-MM-DD");
      todate = fromdate; // Single day range
    } else {
      const date = dateInput.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      if (!date || date.length < 2) {
        return res.json({
          status: "error",
          success: false,
          message:
            "Invalid date range format. Example: '01-01-2024 - 31-01-2024'",
        });
      }

      fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
    }

    const skuList = req.body.skuList;

    if (!Array.isArray(skuList) || skuList.length === 0) {
      return res.json({
        status: "success",
        success: true,
        code: "200",
        response: { data: [] },
      });
    }

    const products = await invtDB.query(
      `
            SELECT p.p_sku, p.p_name, p.product_key
            FROM products p
            WHERE p.p_sku IN(:skuList)
            ORDER BY p.p_name ASC
            `,
      {
        replacements: { skuList },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (products.length === 0) {
      return res.json({
        status: "success",
        success: true,
        response: { data: [] },
      });
    }

    const result = [];

    for (const item of products) {
      const stmt = await invtDB.query(
        `
                SELECT 
                    COALESCE(SUM(CASE 
                        WHEN type='IN' AND mfg_pro_apr_sku = :sku 
                        AND DATE_FORMAT(mfg_pro_apr_fulldate,'%Y-%m-%d') BETWEEN :date1 AND :date2 
                        THEN mfg_approve_in_qty ELSE 0 END),0) AS totalIN,

                    COALESCE(SUM(CASE 
                        WHEN type='OUT' AND fgout_pro_apr_sku = :product 
                        AND DATE_FORMAT(fgout_pro_apr_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 
                        THEN fgout_approve_out_qty ELSE 0 END),0) AS totalOUT,

                    COALESCE(SUM(CASE 
                        WHEN type='IN' AND mfg_pro_apr_sku = :sku 
                        AND DATE_FORMAT(mfg_pro_apr_fulldate,'%Y-%m-%d') < :date1 
                        THEN mfg_approve_in_qty ELSE 0 END),0) AS openingIN,

                    COALESCE(SUM(CASE 
                        WHEN type='OUT' AND fgout_pro_apr_sku = :product 
                        AND DATE_FORMAT(fgout_pro_apr_date,'%Y-%m-%d') < :date1 
                        THEN fgout_approve_out_qty ELSE 0 END),0) AS openingOUT
                FROM mfg_production_3
                `,
        {
          replacements: {
            sku: item.p_sku,
            product: item.product_key,
            date1: fromdate,
            date2: todate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      const row = stmt[0];
      const opening = row.openingIN - row.openingOUT;
      const closing = opening + (row.totalIN - row.totalOUT);

      result.push({
        sku: item.p_sku,
        name: item.p_name,
        opening,
        closing,
      });
    }

    return res.json({
      status: "success",
      success: true,
      data: {
        data: result,
        skuCount: result.length,
        date: `${fromdate} - ${todate}`,
      },
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();

const { encode, decode } = require("html-entities");

let { invtDB, otherDB } = require("../../../config/db/connection");

const validateApiToken = async (req, res, next) => {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            code: 401,
            message: "No token provided",
            status: "error",
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
            return res.status(401).json({
                code: 401,
                message: "Invalid OR the token has been expired",
                status: "error",
            });
        }

        req.client_code = tokenRecord[0].client_code;
        next();
    } catch (error) {
        console.error("Error validating API token:", error);
        return res.status(401).json({
            code: 401,
            message: "Unauthorized Access, CASE SENSITIVE",
            status: "error",
        });
    }
};

router.get("/fetch/components", [validateApiToken], async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({
      status: "error",
      success: false,
      message: "date required. Example: 21-11-2025 OR 01-01-2024 - 31-01-2024",
    });
  }

  let fromdate, todate;
  const dates = date.match(/\d{2}-\d{2}-\d{4}/g);

  if (!dates || dates.length < 1) {
    return res.status(400).json({
      status: "error",
      success: false,
      message: "Invalid date format",
    });
  }

  const fromMoment = moment(dates[0], "DD-MM-YYYY", true);
  const toMoment = dates[1]
    ? moment(dates[1], "DD-MM-YYYY", true)
    : fromMoment.clone();

  if (!fromMoment.isValid() || !toMoment.isValid()) {
    return res.status(400).json({
      status: "error",
      success: false,
      message: "Invalid date value",
    });
  }

  // 🔴 MAX 14 DAYS CHECK
  const diffDays = toMoment.diff(fromMoment, "days");

  if (diffDays < 0) {
    return res.status(400).json({
      status: "error",
      success: false,
      message: "To date cannot be before From date",
    });
  }

  if (diffDays > 13) {
    return res.status(400).json({
      status: "error",
      code: 400,
      message: "Maximum allowed date range is 14 days",
    });
  }

  fromdate = fromMoment.format("YYYY-MM-DD");
  todate = toMoment.format("YYYY-MM-DD");

  try {
    const result = await invtDB.query(
      "SELECT c_part_no,c_new_part_no,c_new_part_no,c_name,units_name, all_sub_groups.sub_group_name FROM components LEFT JOIN units ON units.units_id = components.c_uom LEFT JOIN all_sub_groups ON all_sub_groups.sub_group_id = components.c_sub_group LEFT JOIN rm_location ON rm_location.components_id = components.component_key WHERE c_type= 'R' AND DATE_FORMAT(rm_location.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 GROUP BY components.component_key ORDER BY components.ID DESC ",
      { 
        replacements: { date1: fromdate, date2: todate },
        type: invtDB.QueryTypes.SELECT 
      }
    );

    if (result.length > 0) {
      for (let i = 0; i < result.length; i++) {
        
       

        result[i].c_new_part_no = result[i].c_new_part_no ?? "NA";

        result[i].sub_group_name = result[i].sub_group_name ?? "NA";

      }

      return res.json({ code: 200, data: result, status: "success" });
    } else {
      return res.json({ code: 500, message: { msg: "No Component Found!!!" } });
    }
  } catch (err) {
    return res.json({
      code: 500,
      message: {
        msg: "Internal Error!!!If this condition persists, contact your system administrator",
      },
      status: "error",
      errors: err.stack,
    });
  }
});

router.get("/fetch/bomdetails", [validateApiToken], async (req, res) => {
  try {
    if (!req.query.part_code || req.query.part_code.trim() === "") {
      return res.json({
        code: 500,
        status: "error",
        message: { msg: "Please supply part code" },
      });
    }

   
    const componentResult = await invtDB.query(
      "SELECT component_key FROM components WHERE (c_part_no = :partcode OR component_key = :partcode) AND c_is_enabled = 'Y'",
      {
        replacements: { partcode: req.query.part_code.trim() },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (componentResult.length === 0) {
      return res.json({
        code: 500,
        status: "error",
        message: { msg: "No component found with this part code" },
      });
    }

    const componentKey = componentResult[0].component_key;

    
    const bomResult = await invtDB.query(
      `SELECT 
        bom_quantity.qty,
        bom_quantity.insert_date AS part_code_added_date,
        bom_recipe.subject_name AS bom_name,
        bom_recipe.insert_date AS bom_create_date,
        bom_recipe.bom_product_sku AS sku_code,
        products.p_name AS product_name,
        units.units_name AS uom
      FROM bom_quantity
      LEFT JOIN bom_recipe ON bom_recipe.subject_id = bom_quantity.subject_under
      LEFT JOIN products ON products.p_sku = bom_recipe.bom_product_sku
      LEFT JOIN units ON units.units_id = products.p_uom
      WHERE bom_quantity.component_id = :componentKey
        AND bom_quantity.bom_status IN ('A')
      ORDER BY bom_recipe.insert_date DESC, bom_quantity.insert_date DESC`,
      {
        replacements: { componentKey: componentKey },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (bomResult.length > 0) {
      // Format the dates
      for (let i = 0; i < bomResult.length; i++) {
        bomResult[i].bom_create_date = bomResult[i].bom_create_date
          ? moment(bomResult[i].bom_create_date).format("DD-MM-YYYY HH:mm:ss")
          : "NA";
        bomResult[i].part_code_added_date = bomResult[i].part_code_added_date
          ? moment(bomResult[i].part_code_added_date).format("DD-MM-YYYY HH:mm:ss")
          : "NA";
        bomResult[i].qty = bomResult[i].qty ?? 0;
        bomResult[i].uom = bomResult[i].uom ?? "NA";
        bomResult[i].bom_name = bomResult[i].bom_name ?? "NA";
        bomResult[i].sku_code = bomResult[i].sku_code ?? "NA";
        bomResult[i].product_name = bomResult[i].product_name ?? "NA";
      }

      return res.json({
        code: 200,
        status: "success",
        data: bomResult,
      });
    } else {
      return res.json({
        code: 500,
        status: "error",
        message: { msg: "No BOM found for this part code" },
      });
    }
  } catch (err) {
    return res.json({
      code: 500,
      status: "error",
      message: {
        msg: "Internal Error!!!If this condition persists, contact your system administrator",
      },
      errors: err.stack,
    });
  }
});

module.exports = router;

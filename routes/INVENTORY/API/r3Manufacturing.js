const express = require("express");
const router = express.Router();



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


router.get("/manufacturing",[validateApiToken], async (req, res) => {
  try {
    const { date } = req.query;

    if (!date || date === "") {
      return res.status(400).json({
        status: "error",
        message: { msg: "Please supply date. Example: 01-01-2024 - 31-01-2024" },
        code: "400",
      });
    }

    const dateMatch = date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    
    if (!dateMatch || dateMatch.length < 1) {
      return res.status(400).json({
        status: "error",
        message: { msg: "Invalid date format. Use format: DD-MM-YYYY - DD-MM-YYYY" },
        code: "400",
      });
    }

    const fromdate = moment(dateMatch[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = dateMatch[1] 
      ? moment(dateMatch[1], "DD-MM-YYYY").format("YYYY-MM-DD")
      : moment(dateMatch[0], "DD-MM-YYYY").format("YYYY-MM-DD");

    // Validate date range (max 3 months / 90 days)
    const durationInMonths = moment(todate, "YYYY-MM-DD").diff(moment(fromdate, "YYYY-MM-DD"), "months");
    const diffDays = moment(todate, "YYYY-MM-DD").diff(moment(fromdate, "YYYY-MM-DD"), "days");
    
    if (diffDays < 0) {
      return res.status(400).json({
        status: "error",
        message: { msg: "To date cannot be before From date" },
        code: "400",
      });
    }

    if (durationInMonths > 3 || diffDays > 90) {
      return res.status(400).json({
        status: "error",
        message: { msg: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only" },
        code: "400",
      });
    }

    let stmt1 = await invtDB.query(
      "SELECT *,`t1`.`user_name` AS `mfg_created_by`, `t2`.`user_name` AS `mfg_approved_by` FROM `mfg_production_2` LEFT JOIN `products` ON `mfg_production_2`.`mfg_sku` = `products`.`p_sku` LEFT JOIN `location_main` ON `mfg_production_2`.`mfg_con_location` = `location_main`.`location_key` LEFT JOIN `mfg_production_1` ON `mfg_production_1`.`prod_product_sku` = `mfg_production_2`.`mfg_sku` AND `mfg_production_1`.`prod_transaction` = `mfg_production_2`.`mfg_ref_id` LEFT JOIN `admin_login` AS `t1` ON `t1`.`CustID` = `mfg_production_2`.`mfg_ppr_created_by` LEFT JOIN `admin_login` AS `t2` ON `t2`.`CustID` = `mfg_production_2`.`mfg_approved_by` WHERE `mfg_production_2`.`mfg_prod_type` = 'C' AND DATE_FORMAT(`mfg_production_2`.`mfg_full_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
      { replacements: { date1: fromdate, date2: todate }, type: invtDB.QueryTypes.SELECT }
    );

    const data = [];
    let count = 0;
    
    if (stmt1.length > 0) {
      stmt1.map((item) => {
        data.push({
          serial_no: count + 1,
          product_sku: item.p_sku,
          product_name: item.p_name,
          transaction1: item.mfg_ref_id,
          transaction2: item.mfg_transaction,
          mfginsertdate: moment(item.mfg_full_date).tz("Asia/Kolkata").format("DD-MM-YYYY"),
          approveqty: item.mfg_prod_planing_qty,
          location: item.loc_name,
          pprcreatedby: item.mfg_created_by,
          mfgapprovedby: item.mfg_approved_by,
          pprinsertdate: moment(item.prod_insert_date).tz("Asia/Kolkata").format("DD-MM-YYYY"),
          pprcustomer: item.prod_customer_name,
          project_id: item.prod_project,
        });
        count++;
      });

      return res.json({
        status: "success",
        code: "200",
        response: {
          data: data,
        },
      });
    } else {
      return res.json({
        status: "error",
        code: 500,
        message: { msg: "NO data Found!" },
      });
    }
  } catch (error) {
    console.error("Error in r3Manufacturing API:", error);
    return res.status(500).json({
      status: "error",
      code: 500,
      message: { msg: "Internal Error<br/>If this condition persists, contact your system administrator" },
      error: error.stack,
    });
  }
});

module.exports = router;


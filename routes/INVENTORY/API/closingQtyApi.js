const express = require("express");
const router = express.Router();



let { invtDB, otherDB } = require("../../../config/db/connection");
const Validator = require("validatorjs");
const helper = require("../../../helper/helper");

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

router.get("/rm/closing/stock",[validateApiToken], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      partCode: "required",
      date: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: { msg: helper.firstErrorValidatorjs(validation) },
      });
    }

    const { partCode } = req.query;
    const given_date = moment(req.query.date, "DD-MM-YYYY")
      .endOf("day")
      .format("YYYY-MM-DD HH:mm:ss");

    const LOCATION_GROUP_KEYS = [
      "2023112717950595",
      "20231127171244714",
    ];

    const [componentDetails] = await invtDB.query(
      `SELECT c_part_no,component_key, c_name, units_name FROM components LEFT JOIN units ON units.units_id = components.c_uom WHERE c_part_no = :partCode`,
      {
        replacements: { partCode },
        type: invtDB.QueryTypes.SELECT,
      }
    );


     const componentKey = componentDetails.component_key;

    if (!componentDetails) {
      return res.json({ success: false, message: { msg: "Component not found" } });
    }

    /* ---------------- Location keys ---------------- */
    const allotted = await invtDB.query(
      `SELECT locations FROM location_allotted WHERE loc_all_key IN (:keys)`,
      {
        replacements: { keys: LOCATION_GROUP_KEYS },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const locationKeys = [
      ...new Set(
        allotted
          .filter(a => a.locations)
          .flatMap(a => a.locations.split(","))
      ),
    ];

    if (!locationKeys.length) {
      return res.json({ status: "success", data: [] });
    }

    const stockRows = await invtDB.query(
      `
      SELECT
        lm.loc_name AS location, COALESCE(SUM(CASE WHEN rl.trans_type IN ('INWARD','ISSUE','JOBWORK','REJECTION','TRANSFER') AND rl.loc_in = lm.location_key AND rl.insert_date <= :date THEN rl.qty ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN rl.trans_type IN ('CONSUMPTION','ISSUE','JOBWORK','REJECTION','TRANSFER') AND rl.loc_out = lm.location_key AND rl.insert_date <= :date THEN rl.qty ELSE 0 END), 0) AS closingQty FROM location_main lm LEFT JOIN rm_location rl ON rl.components_id = :componentKey AND (rl.loc_in = lm.location_key OR rl.loc_out = lm.location_key) WHERE lm.location_key IN (:locationKeys)
        AND lm.loc_status = 'ACTIVE' GROUP BY lm.location_key, lm.loc_name
      `,
      {
        replacements: {
          componentKey,
          locationKeys,
          date: given_date,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    return res.json({
      status: "success",
      code: 200,
      data: {
        component: {
          partNo: componentDetails.c_part_no,
          partName: componentDetails.c_name,
          uom: componentDetails.units_name,
        },
        close_data: stockRows.map(r => ({
          location: r.location,
          closingQty: helper.number(r.closingQty),
        })),
      },
    });

  } catch (err) {
    console.error(err);
    return res.json({ success: false, message: { msg: err.message } });
  }
});



router.get("/component-exist",[validateApiToken], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      partCode: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: "false",
        status: "error",
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    let partCode = String(req.query.partCode || "").trim();


    if (partCode.length < 4 || partCode.length > 10) {
      return res.json({
        success: "false",
        status: "error",
        message: "Part Code length must be between 4 and 10 characters",
      });
    }

    const partCodeRegex = /^[A-Za-z0-9]+$/;
    if (!partCodeRegex.test(partCode)) {
      return res.json({
        success: "false",
        status: "error",
        message: "Part Code must contain only A-Z, a-z, 0-9",
      });
    }

    const stmt = await invtDB.query(
      `SELECT c_part_no,c_name, c_new_part_no, units.units_name AS uom,c_is_enabled AS is_active FROM components LEFT JOIN units ON units.units_id = components.c_uom WHERE c_part_no = :partCode LIMIT 1 `,
      {
        replacements: { partCode },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      return res.json({
        success: false,
        status: "error",
        message: "Part Code Already Exist",
        data: {
          partCode: stmt[0].c_part_no,
          newPartCode: stmt[0].c_new_part_no,
          partName: stmt[0].c_name,
          uom: stmt[0].uom,
          activeStatus: stmt[0].is_active === "Y",
        },
      });
    }

    return res.json({
      success: true,
      status: "success",
      message: "Part Code Not Exist",
      data: {
        partCode,
      },
    });

  } catch (error) {
    console.error(error);
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


// router.post('/q2ClosingQty', async (req, res) => {
//     try {
//         const validation = new Validator(req.body, {
//             component: "required",
//             location: "required",
//             closingDate: "required",
//         });

//         if (validation.fails()) {
//             return res.json({
//                 status: "error",
//                 success: false,
//                 message: "something you missing in form field to supply",
//                 data: validation.errors.all(),
//             });
//         }

//         let inward = await invtDB.query("SELECT COALESCE(SUM(qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND loc_in = :location AND DATE_FORMAT(insert_date, '%Y-%m-%d') = :closingDate", {
//             replacements: {
//                 component: req.body.component,
//                 location: req.body.location,
//                 closingDate: req.body.closingDate,
//             },
//             type: invtDB.QueryTypes.SELECT,
//         });

//         let outward = await invtDB.query("SELECT COALESCE(SUM(qty),0) AS Outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')  AND loc_out = :location AND DATE_FORMAT(insert_date, '%Y-%m-%d') = :closingDate", {
//             replacements: {
//                 component: req.body.component,
//                 location: req.body.location,
//                 closingDate: req.body.closingDate,
//             },
//             type: invtDB.QueryTypes.SELECT,
//         })

//         const inwardResult = helper.number(inward[0]?.Inward || 0);
//         const outwardResult = helper.number(outward[0]?.Outward || 0);
//         const closingQty = inwardResult - outwardResult;

//         return res.json({
//             status: "success",
//             code: "200",
//             response: {
//                 closingQty: closingQty,
//             },
//         });

//     } catch (error) {
//         return res.status(500).json({
//             status: "error",
//             code: 500,
//             message: { msg: "Internal Error<br/>If this condition persists, contact your system administrator" },
//             error: error.stack,
//         });
//     }
// })


module.exports = router;
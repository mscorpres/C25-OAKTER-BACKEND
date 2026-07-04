const express = require("express");
const router = express.Router();
let { invtDB, otherDB } = require("../../../config/db/connection");
const Validator = require("validatorjs");

const helper = require("./../../../helper/helper");


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

router.get('/challan/view', [validateApiToken],  async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.json({
        code: 400,
        success: false,
        message:"From and To dates are required",
        status: "error",
      });
    }

    const fromDate = moment(from, "DD-MM-YYYY").format("YYYY-MM-DD");
    const toDate = moment(to, "DD-MM-YYYY").format("YYYY-MM-DD");

    const stmt = await invtDB.query(
      `SELECT jw_challan_id, insert_date, jw_transaction_id FROM rm_location WHERE trans_type = 'JOBWORK' AND DATE(insert_date) BETWEEN :from AND :to`,
      {
        replacements: { from: fromDate, to: toDate },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!stmt.length) {
      return res.json({
        code: 404,
        success: false,
        message:"No Challan Found",
        status: "error",
      });
    }

    let result = [];

    for (let i = 0; i < stmt.length; i++) {
      result.push({
        challanId: stmt[i].jw_challan_id,
        jwTransactionId: stmt[i].jw_transaction_id,
        insertDate : stmt[i].insert_date ,
      });
    }
    return res.json({
      code: 200,
      success: true,
      data: result,
      message: "Challan Found Successfully",
      status: "success",
    });

  } catch (error) {
    return res.json({
      code: 500,
      message:"Internal Error! If this persists, contact your system administrator.",
      success: false,
      status: "error",
    });
  }
});


router.post('/challan/details', [validateApiToken], async (req, res) => {
  try {
    const { challanId } = req.body;
    const stmt = await invtDB.query(
      `SELECT *, c.c_name, c.c_part_no, u.units_name,rm_location.qty, rm_location.in_jw_invoice_id, rm_location.jw_transaction_id, rm_location.insert_date, rm_location.insert_by, rm_location.any_remark FROM rm_location LEFT JOIN components c ON rm_location.components_id = c.component_key LEFT JOIN units u ON c.c_uom = u.units_id WHERE jw_challan_id = :challanId`,
      {
        replacements: { challanId },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!stmt.length) {
      return res.json({
        code: 404,
        success: false,
        message: "No Challan Found",
        status: "error",
      });
    }

    let result = [];

    for (let i = 0; i < stmt.length; i++) {
      result.push({
        challanId: stmt[i].jw_challan_id,
        partName: stmt[i].c_name,
        partNo: stmt[i].c_part_no,
        unit: stmt[i].units_name,
        quantity: stmt[i].qty,
        inJwInvoiceId: stmt[i].in_jw_invoice_id,
        jwTransactionId: stmt[i].jw_transaction_id,
        insertDate : stmt[i].insert_date ,
        insertBy : stmt[i].insert_by,
        anyRemark : stmt[i].any_remark
      });
    }

    return res.json({
      code: 200,
      data: result,
      success: true,
      message: "Challan Found Successfully",
      status: "success",
    });
  } catch (error) {
    return res.json({
      code: 500,
      success: false,
      message:"Internal Error! If this persists, contact your system administrator.",
      status: "error",
    });
  }
});



module.exports = router;

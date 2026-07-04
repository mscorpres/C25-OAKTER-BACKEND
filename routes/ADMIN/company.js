const express = require("express");
const router = express.Router();


let { invtDB } = require("../../config/db/connection");
const auth = require("../../middleware/auth");
const Validator = require("validatorjs");
let sms = require("../../helper/smsGateway");

// GET COMPANY MAPPED USERID
router.get("/user/list", [auth.isAuthorized], async (req, res) => {
  try {
    const { type, status } = req.query; 

    let whereParts = [];
    let replacements = {};

    // ============================================
    // 🔍 TYPE FILTER (developer | user | all)
    // ============================================
    if (type === "developer" || type === "user") {
      whereParts.push("`type` = :type");
      replacements.type = type;
    }
    // if type = all or undefined → no filter applied


    // ============================================
    // 🔍 STATUS FILTER (0 or 1 only)
    // ============================================
    if (status !== undefined) {
      if (status !== "0" && status !== "1") {
        return res.json({
          success: false,
          status: "error",
          message: "Invalid status value. Allowed values: 0 or 1",
        });
      }

      whereParts.push("`login_status` = :status");
      replacements.status = status;
    }

    // Merge conditions into WHERE clause
    let whereSQL = "";
    if (whereParts.length > 0) {
      whereSQL = "WHERE " + whereParts.join(" AND ");
    }

    // ============================================
    // 🔍 EXECUTE QUERY
    // ============================================
    const stmt = await invtDB.query(
      `SELECT 
          company_id,
          CustID,
          user_name,
          Mobile_No,
          Email_ID,
          login_status,
          type
        FROM admin_login
        ${whereSQL}
        ORDER BY user_name ASC`,
      {
        replacements,
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length === 0) {
      return res.json({
        success: false,
        status: "error",
        message: "No data found for selected filters.",
      });
    }

    const finalResult = stmt.map((row) => ({
      username: row.user_name,
      custID: row.CustID,
      email: row.Email_ID,
      mobile: row.Mobile_No,
      status: row.login_status,
      orgCode: row.company_id,
      type: row.type,
    }));

    return res.json({
      success: true,
      status: "success",
      data: finalResult,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPDATE USER STATUS
router.put("/user/edit", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    status: "required",
    userID: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
  }

  if (req.body.status !== "1" && req.body.status !== "0") {
    return res.json({
      success: false,
      status: "error",
      message: "getting invalid input from client ends",
      error: err.stack,
    });
  }
  try {
    let stmt = await invtDB.query(
      "SELECT * FROM `admin_login` WHERE `CustID` = :user_id",
      {
        replacements: { user_id: req.body.userID },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      if (stmt[0].CustID == req.logedINUser) {
        return res.json({
          success: false,
          status: "error",
          message: "you can't do this operation ownself",
        });
      } else {
        let stmt1 = await invtDB.query(
          "UPDATE `admin_login` SET `update_date` = :update_date, `login_status` = :status WHERE `company_id` = :company_id AND `CustID` = :user_id",
          {
            replacements: {
              status: req.body.status,
              company_id: "COM0001",
              user_id: req.body.userID,
              update_date: moment(new Date())
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD HH:mm:ss"),
            },
            type: invtDB.QueryTypes.UPDATE,
          }
        );
        if (stmt1.length > 0) {
          res.json({
            success: true,
            status: "success",
            message: "user account status updated",
          });
          if (req.body.status == "0") {
            return sms.AccountSuspended(
              "91" + stmt[0].Mobile_No,
              "growthX",
              stmt[0].Email_ID
            );
          } else {
            return sms.AccountUnsuspended(
              "91" + stmt[0].Mobile_No,
              "growthX",
              stmt[0].Email_ID
            );
          }
        } else {
          return res.json({
            success: false,
            status: "error",
            message: "an error occured while updating user account status",
            error: err.stack,
          });
        }
      }
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "an unauthorized operation performed",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

module.exports = router;

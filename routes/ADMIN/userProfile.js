const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const { invtDB, otherDB } = require("../../config/db/connection");
const Validator = require("validatorjs");
const bcrypt = require("bcryptjs");


router.get("/fetchProfile/:userId", [auth.isAuthorized], async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.json({
        status: "error",
        success: false,
        message: "User ID is required",
      });
    }

    const stmt = await invtDB.query(
      `SELECT * FROM admin_login WHERE CustID = :user_id`,
      {
        replacements: { user_id: userId },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length === 0) {
      return res.json({
        status: "error",
        success: false,
        message: "User not found",
      });
    }

    const stmt2 = await invtDB.query(
      `SELECT Log_Time
       FROM admin_logs
       WHERE CustID = :user_id
       ORDER BY id DESC
       LIMIT 1`,
      {
        replacements: { user_id: userId },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const user = stmt[0];

    const result = {
      id: user.CustID,
      user_name: user.user_name,
      email: user.Email_ID,
      mobile: user.Mobile_No,
      reg_date: user.reg_date,
      askChangePassword: user.ask_change_password,
      type: user.type,
      twoStep: user.twoStep,
      status: user.login_status,
      lastLogin: stmt2.length > 0 ? moment(stmt2[0].Log_Time).format("DD-MM-YYYY hh:mm A") : null,
    };

    return res.json({
      status: "success",
      success: true,
      data: result,
    }); ``
  } catch (error) {
    console.log(error);
    return res.json({
      status: "error",
      success: false,
      message: "Something went wrong",
    });
  }
});


router.get("/loginLogs", [auth.isAuthorized], async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.json({
        status: "error",
        success: false,
        message: "User ID is required",
      });
    }

    const stmt = await invtDB.query(
      `SELECT *
       FROM admin_logs
       WHERE CustID = :user_id
       ORDER BY id DESC`,
      {
        replacements: { user_id: userId },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length === 0) {
      return res.json({
        status: "error",
        success: false,
        message: "logs are not found",
      });
    }


    const result = stmt.map((item) => ({
      ID: item.ID,
      CustID: item.CustID,
      Mobile: item.Mobile,
      Email_ID: item.Email_ID,
      LogID: item.LogID,
      IProtocol: item.IProtocol,
      Log_Out: item.Log_Out,
      Service: item.Service,
      Organization: item.Organization,
      ASN_No: item.ASN_No,
      Country: item.Country,
      Region_st: item.Region_st,
      Rg_City: item.Rg_City,
      ZIP_Code: item.ZIP_Code,
      Longitudinal: item.Longitudinal,
      Latitude: item.Latitude,
      Zone: item.Zone,
      Status: item.Status,
      log_time: moment(item.Log_Time).format("DD-MM-YYYY hh:mm A"),
    }));

    return res.json({
      status: "success",
      success: true,
      data: result,
    });
  } catch (error) {
    console.log(error);
    return res.json({
      status: "error",
      success: false,
      message: "Something went wrong",
    });
  }
});

router.get("/getActivityLog", [auth.isAuthorized], async (req, res) => {
  try {
    const { userid, page = 1, limit = 20 } = req.query;

    let whereClause = "";
    let replacements = {
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    };

    if (userid) {
      whereClause = "WHERE userid = :userid";
      replacements.userid = userid;
    }

    const data = await otherDB.query(
      `SELECT
        ID,
        log_id,
        userid,
        ip,
        method,
        path,
        status,
        timestamp,
        responseTime,
        requestBody,
        responseBody,
        userAgent
      FROM req_activity_log
      ${whereClause}
      ORDER BY ID DESC
      LIMIT :limit OFFSET :offset`,
      {
        replacements,
        type: otherDB.QueryTypes.SELECT,
      }
    );

    let result = []

    for (let i = 0; i < data.length; i++) {
      result.push({
        ID: data[i].ID,
        log_id: data[i].log_id,
        userid: data[i].userid,
        ip: data[i].ip,
        method: data[i].method,
        path: data[i].path,
        status: data[i].status,
        timestamp: moment(data[i].timestamp).format("DD-MM-YYYY HH:mm:ss"),
        responseTime: data[i].responseTime,
        requestBody: data[i].requestBody,
        responseBody: data[i].responseBody,
        userAgent: data[i].userAgent,
      });
    }

    const total = await otherDB.query(
      `SELECT COUNT(*) AS total
       FROM req_activity_log
       ${whereClause}`,
      {
        replacements,
        type: otherDB.QueryTypes.SELECT,
      }
    );

    return res.json({
      success: true,
      status: "success",
      message: "Activity logs fetched successfully.",
      data: result,
      pagination: {
        total: total[0].total,
        page: Number(page),
        limit: Number(limit),
      },
    });
  } catch (error) {
    console.error(error);
    return res.json({
      success: false,
      status: "error",
      message: "an error occurred while fetching activity logs.",

    });
  }
});


router.put("/updateUserSettings", [auth.isAuthorized], async (req, res) => {
  try {
    const {
      userId,
      newPassword,
      confirmPassword,
      twoStep,
      askPasswordChange,
    } = req.body;

    if (!userId) {
      return res.json({
        success: false,
        status: "error",
        message: "User ID is required.",
        data: null,
      });
    }

    let updateFields = [];
    let replacements = { userId };

    // Update Password
    if (
      typeof newPassword !== "undefined" ||
      typeof confirmPassword !== "undefined"
    ) {
      const validation = new Validator(
        { newPassword, confirmPassword },
        {
          newPassword:
            "required|regex:^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@#$_])[A-Za-z\\d@#$_]{8,16}$",
          confirmPassword: "required",
        }
      );

      if (validation.fails()) {
        return res.json({
          success: false,
          status: "error",
          message: helper.firstErrorValidatorjs(validation),
          data: null,
        });
      }

      if (newPassword !== confirmPassword) {
        return res.json({
          success: false,
          status: "error",
          message: "New password and confirm password do not match.",
          data: null,
        });
      }

      updateFields.push("Password = :password");
      replacements.password = await bcrypt.hash(newPassword, 10);
    }

    // Update Two Step Authentication
    if (typeof twoStep !== "undefined") {
      if (![0, 1, "0", "1"].includes(twoStep)) {
        return res.json({
          success: false,
          status: "error",
          message: "twoStep must be either 0 (OFF) or 1 (ON).",
          data: null,
        });
      }

      updateFields.push("twoStep = :twoStep");
      replacements.twoStep = Number(twoStep) === 1 ? "ON" : "OFF";
    }

    // Update Ask Password Change
    if (typeof askPasswordChange !== "undefined") {
      let value = String(askPasswordChange).toUpperCase();

      // Convert 0/1 to Y/N
      if (value == "1") {
        value = "Y";
      } else if (value == "0") {
        value = "N";
      }

      if (!["Y", "N"].includes(value)) {
        return res.json({
          success: false,
          status: "error",
          message: "askPasswordChange must be either Y/N or 1/0.",
          data: null,
        });
      }

      updateFields.push("ask_change_password = :askPasswordChange");
      replacements.askPasswordChange = value;
    }

    if (updateFields.length === 0) {
      return res.json({
        success: false,
        status: "error",
        message: "No fields provided to update.",
        data: null,
      });
    }

    await invtDB.query(
      `UPDATE admin_login
       SET ${updateFields.join(", ")}
       WHERE CustID = :userId`,
      {
        replacements,
        type: invtDB.QueryTypes.UPDATE,
      }
    );

    return res.json({
      success: true,
      status: "success",
      message: "User settings updated successfully.",
      data: null,
    });
  } catch (error) {
    console.error(error);
    return res.json({
      success: false,
      status: "error",
      message: "Something went wrong.",
      data: null,
    });
  }
});


// UPDATE USER VERIFICATION STATUS
router.put(
  "/update-user-verification-status",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      const type = req.query.type;

      if (type === "loginStatus") {
        const validation = new Validator(req.body, {
          userId: "required",
          loginStatus: "required|in:0,1",
        });

        if (validation.fails()) {
          return res.status(400).json({
            success: false,
            message: helper.firstErrorValidatorjs(validation),
          });
        }

        const checkUser = await invtDB.query(
          "SELECT CustID FROM admin_login WHERE CustID = :custid",
          {
            replacements: { custid: req.body.userId },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (checkUser.length === 0) {
          return res.status(404).json({
            success: false,
            message: "User not found",
          });
        }

        await invtDB.query(
          `UPDATE admin_login
           SET login_status = :login_status
           WHERE CustID = :custid`,
          {
            replacements: {
              login_status: req.body.loginStatus,
              custid: req.body.userId,
            },
            type: invtDB.QueryTypes.UPDATE,
          }
        );


        return res.json({
          success: true,
          message: "Login status updated successfully",
        });
      }

      const validation = new Validator(req.body, {
        userId: "required",
        status: "required|in:0,1,M,E",
      });

      if (validation.fails()) {
        return res.status(400).json({
          success: false,
          message: helper.firstErrorValidatorjs(validation),
        });
      }

      const checkUser = await invtDB.query(
        "SELECT CustID FROM admin_login WHERE CustID = :custid",
        {
          replacements: { custid: req.body.userId },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (checkUser.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      let mobile_status = null;
      let email_status = null;
      let query = "";

      switch (req.body.status) {
        case "0":
          mobile_status = "1";
          email_status = "1";
          query = `
            UPDATE admin_login
            SET isMobileConfirmed = :mobile_status,
                isEmailConfirmed = :email_status
            WHERE CustID = :custid
          `;
          break;

        case "1":
          mobile_status = "0";
          email_status = "0";
          query = `
            UPDATE admin_login
            SET isMobileConfirmed = :mobile_status,
                isEmailConfirmed = :email_status
            WHERE CustID = :custid
          `;
          break;

        case "M":
          mobile_status = "0";
          query = `
            UPDATE admin_login
            SET isMobileConfirmed = :mobile_status
            WHERE CustID = :custid
          `;
          break;

        case "E":
          email_status = "0";
          query = `
            UPDATE admin_login
            SET isEmailConfirmed = :email_status
            WHERE CustID = :custid
          `;
          break;
      }

      await invtDB.query(query, {
        replacements: {
          mobile_status,
          email_status,
          custid: req.body.userId,
        },
        type: invtDB.QueryTypes.UPDATE,
      });


      return res.json({
        success: true,
        message: "User verification status changed successfully",
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message: "Something went wrong, please contact the administrator.",
      });
    }
  }
);

router.put("/update-user-mobile-no", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(
      req.body,
      {
        userId: "required",
        mobileNo: "required|regex:/^[6-9][0-9]{9}$/",
        isVerified: "required|in:0,1",
      },
      {
        "regex.mobileNo": "Monile no. should be 10 digits",
        "in.isVarified": "isVarified should be 0 or 1",
      }
    );

    if (valid.fails()) {
      return res.status(400).json({ success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    const checkUser = await invtDB.query("SELECT * FROM admin_login WHERE CustID = :custid", {
      replacements: {
        custid: req.body.userId,
      },
      type: invtDB.QueryTypes.SELECT,
    });

    if (checkUser.length <= 0) {
      return res.status(404).json({ success: false, message: "user not found" });
    }

    const stmtUpdate = await invtDB.query("UPDATE admin_login SET mobile_no = :mobileNo, isMobileConfirmed = :isVerified WHERE CustID = :custid", {
      replacements: {
        mobileNo: req.body.mobileNo,
        isVerified: req.body.isVerified,
        custid: req.body.userId,
      },
    });

    if (stmtUpdate[0].affectedRows <= 0) {
      return res.status(400).json({ success: false, message: "user mobile no not changed" });
    }

    return res.json({ success: true, message: "user mobile no changed successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "something went wrong, please contact the administrator.", error: error.stack });
  }
});


// UPDATE EMAIL ID
router.put("/update-email-id", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      userId: "required",
      emailId: "required|email",
      isVerified: "required|in:0,1",
    });

    if (valid.fails()) {
      return res.status(400).json({ success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    const checkUser = await invtDB.query("SELECT * FROM admin_login WHERE CustID = :custid", {
      replacements: {
        custid: req.body.userId,
      },
      type: invtDB.QueryTypes.SELECT,
    });

    if (checkUser.length <= 0) {
      return res.status(404).json({ success: false, message: "user not found" });
    }

    const stmtUpdate = await invtDB.query("UPDATE admin_login SET Email_ID = :emailId, isEmailConfirmed = :isVerified WHERE CustID = :custid", {
      replacements: {
        emailId: req.body.emailId,
        isVerified: req.body.isVerified,
        custid: req.body.userId,
      },
    });

    if (stmtUpdate[0].affectedRows <= 0) {
      return res.status(400).json({ success: false, message: "user email id not changed" });
    }

    return res.json({ success: true, message: "user email id changed successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "something went wrong, please contact the administrator.", error: error.stack });
  }
});


module.exports = router;
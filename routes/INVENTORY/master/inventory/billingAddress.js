const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB, invtOakterDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");

// GET ALL Billing Address
router.get("/getAll", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `billing_address` WHERE `use_for` = :status",
      { replacements: { status: "COMPANY" }, type: invtDB.QueryTypes.SELECT }
    );
    if (stmt1.length > 0) {
      let data = [];
      stmt1.map(async (element) => {
        let stmt2 = await invtDB.query(
          "SELECT `state_name` FROM `state_code` WHERE `state_code` = :state_code",
          {
            replacements: { state_code: element.billing_state },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt2.length > 0) {
          data.push({
            label: element.billing_lable,
            company: element.billing_company,
            state: stmt2[0].state_name,
            pan: element.billing_pan,
            cin: element.billing_cin,
            gst: element.billing_gstno,
            insert_dt: moment(element.insert_date)
              .tz("Asia/Kolkata")
              .format("DD-MM-YYYY hh:mm"),
          });

          if (data.length == stmt1.length) {
            return res.json({
              status: "success",
              success: true,
              message: "",
              data: data,
            });
          }
        }
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "no any billing address found",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// SAVE Billing Address
router.post("/saveBillingAddress", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(
    req.body,
    {
      label: "required",
      company: "required",
      pan: "required",
      gstin: "required",
      state: "required",
      address: "required",
    },
    {
      label: "Please supply the address label",
    }
  );

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something is missing in form fields"
    });
  }

  const t1 = await invtDB.transaction();
  const t2 = await invtOakterDB.transaction(); 

  try {
    const payload = {
      code: helper.getUniqueNumber(),
      label: req.body.label,
      company: req.body.company,
      address: req.body.address.replace(/\n/g, "<br>"),
      state: req.body.state,
      gstno: req.body.gstin,
      panno: req.body.pan,
      cin: req.body.cin ?? "",
      insert_by: req.logedINUser,
      insert_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
      for: "COMPANY",
    };

    const insertSQL = `
      INSERT INTO billing_address 
      (billing_code, billing_lable, billing_company, billing_address, billing_state, billing_gstno, billing_pan, billing_cin, insert_by, insert_date, use_for)
      VALUES (:code, :label, :company, :address, :state, :gstno, :panno, :cin, :insert_by, :insert_date, :for)
    `;

    await Promise.all([
      invtDB.query(insertSQL, {
        replacements: payload,
        transaction: t1,
        type: invtDB.QueryTypes.INSERT,
      }),
      invtOakterDB.query(insertSQL, {
        replacements: payload,
        transaction: t2,
        type: invtOakterDB.QueryTypes.INSERT,
      }),
    ]);

    await Promise.all([t1.commit(), t2.commit()]);

    return res.json({
      status: "success",
      success: true,
      message: "Billing address successfully registered",
      data: {},
    });
  } catch (error) {
    if (t1) await t1.rollback();
    if (t2) await t2.rollback();
    return helper.errorResponse(res, error);
  }
});

module.exports = router;

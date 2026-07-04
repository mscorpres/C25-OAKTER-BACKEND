const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB, invtOakterDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");

function uniqueString(length) {
    var result = "";
    var characters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

// GET ALL SHIPPING ADDRESS
router.get("/getAll", [auth.isAuthorized], async (req, res) => {
    try {
        let stmt1 = await invtDB.query("SELECT * FROM `shipment_address` WHERE `use_for` = :status", { replacements: { status: "COMPANY" }, type: invtDB.QueryTypes.SELECT });
        if (stmt1.length > 0) {
            let data = [];
            stmt1.map(async (element) => {
                let stmt2 = await invtDB.query("SELECT * FROM `state_code` WHERE `state_code` = :state_code", { replacements: { state_code: element.shipment_state_code }, type: invtDB.QueryTypes.SELECT });
                if (stmt2.length > 0) {
                    data.push({
                        label: element.shipment_label,
                        company: element.shipment_company,
                        state: stmt2[0].state_name + " (" + stmt2[0].state_code + ")",
                        pan: element.shipment_pan,
                        gst: element.shipment_gstin,
                        insert_dt: moment(element.insert_date).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                    });

                    if (data.length == stmt1.length) {
                        return res.json({ status: "success", success: true, message: "", data: data });
                    }
                }
            });
        } else {
            return res.json({ status: "error", success: false, message: "no any shipping address found" });
        }
    } catch (error) {
        return helper.errorResponse(res, error);
    }
});

// SAVE SHIPPING ADDRESS
router.post("/saveShippingAddress", [auth.isAuthorized], async (req, res) => {
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
    const shipmentCode = await uniqueString(8); 
    const payload = {
      code: shipmentCode,
      label: req.body.label,
      company: req.branch,
      address: req.body.address.replace(/\n/g, "<br>"),
      state: req.body.state,
      gstno: req.body.gstin,
      panno: req.body.pan,
      insert_by: req.logedINUser,
      insert_date: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      for: "COMPANY",
    };

    const insertSQL = `
      INSERT INTO shipment_address 
      (shipment_code, shipment_label, shipment_company, shipment_address, shipment_state_code, shipment_gstin, shipment_pan, shipment_insert_by, shipment_insert_time, use_for)
      VALUES (:code, :label, :company, :address, :state, :gstno, :panno, :insert_by, :insert_date, :for)
    `;

    await Promise.all([
      invtDB.query(insertSQL, { replacements: payload, transaction: t1, type: invtDB.QueryTypes.INSERT }),
      invtOakterDB.query(insertSQL, { replacements: payload, transaction: t2, type: invtOakterDB.QueryTypes.INSERT }),
    ]);

    await Promise.all([t1.commit(), t2.commit()]);

    return res.json({
      status: "success",
      success: true,
      message: "Shipping address successfully registered",
      data: {},
    });
  } catch (error) {
    if (t1) await t1.rollback();
    if (t2) await t2.rollback();
    return helper.errorResponse(res, error);
  }
});


module.exports = router;

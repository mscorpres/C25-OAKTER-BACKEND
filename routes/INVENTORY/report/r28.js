let { invtDB, otherDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();
const Validator = require("validatorjs");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      date: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    const date = req.body.date;

    const stmt = await otherDB.query(
      `SELECT invt_r28.* , components.c_new_part_no , components.component_key FROM invt_r28 LEFT JOIN ${invtDB.config.database}.components ON invt_r28.parts_code = ${invtDB.config.database}.components.c_part_no WHERE req_date = :date`,
      {
        replacements: { date: date },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length == 0) {
      return res.json({ status: "error", success: false, message: "No Data Found" });
    }

    const avgRate = require("../../../helper/utils/avgRate");

    const promises = stmt.map(async (item) => ({
      part_code: item.parts_code,
      part_code_new: item.c_new_part_no,
      part_name: item.part_name,
      rm_qty: item.rm,
      sf_qty: item.sf,
      time: moment(item.insert_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
      weightedPurchaseRate: await avgRate.getWeightedPurchaseRate(item.component_key, moment(item.insert_date, "YYYY-MM-DD HH:mm:ss").format("YYYY-MM-DD HH:mm:ss")),
    }));

    const data = await Promise.all(promises);

    return res.json({ status: "success", success: true, message: "Report fetched successfully", data: data });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// SEND MAIL TO USER
router.get("/sendMail", [auth.isAuthorized], async (req, res) => {
  try {
    return res.sendFile("invt_r28_mail.html", {
      root: "./views",
    });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

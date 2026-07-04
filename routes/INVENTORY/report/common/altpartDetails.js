const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");

// FOR Q2
router.post("/altpartDetails", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      component: "required",
      location: "required",
    });

    if (valid.fails()) {
      return res.json({
        message: helper.firstErrorValidatorjs(valid),
        data: null,
        status: "error",
        success: false,
      });
    }

    const compStmt = await invtDB.query(
      "SELECT c_alt_part_key FROM components WHERE component_key = :component AND c_alt_part_key != '--'",
      {
        replacements: {
          component: req.body.component,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (compStmt.length <= 0) {
      return res.json({
        message: "No data found!!!",
        success: false,
        data: null,
      });
    }

    //
    const compArr = compStmt[0].c_alt_part_key.split(",");

    const data = [];

    for (let i = 0; i < compArr.length; i++) {
      // COMP DETALIS
      const stmtComp = await invtDB.query(
        "SELECT c_name , c_part_no , c_new_part_no , units_name FROM components LEFT JOIN units ON components.c_uom = units.units_id WHERE component_key = :components_key",
        {
          replacements: {
            components_key: compArr[i],
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      //ALL INWARD
      let stmt6 = await invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_in` = :location",
        {
          replacements: {
            component: compArr[i],
            location: req.body.location,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      let inward_all_qty = 0;
      if (stmt6.length > 0) {
        inward_all_qty = helper.number(stmt6[0].Inward);
      }

      // ALL OUTWARD
      let stmt7 = await invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_out` = :location",
        {
          replacements: {
            component: compArr[i],
            location: req.body.location,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      let outward_all_qty = 0;
      if (stmt7.length > 0) {
        outward_all_qty = helper.number(stmt7[0].Outward);
      }

      data.push({
        partName: stmtComp[0].c_name,
        partNo: stmtComp[0].c_part_no,
        newPartNo: stmtComp[0].c_new_part_no,
        uom: stmtComp[0].units_name,
        closingQty:
          helper.number(inward_all_qty) - helper.number(outward_all_qty),
      });
    }

    return res.json({ message: "success", data: data, success: true });
  } catch (e) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();

let { invtDB, otherDB, refbDB } = require("../../../config/db/connection");

const Validator = require("validatorjs");

router.post("/fetchPartData", async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      part_code: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: "Part code is required" });
    }

    const stmt_part = await invtDB.query("SELECT component_key ,  c_part_no, c_name FROM components WHERE c_part_no = :part_code", {
      replacements: { part_code: req.body.part_code },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt_part.length > 0) {
      const todayDt = moment(new Date()).format("YYYY-MM-DD");
      const final = [];
      let stmt_closing = await invtDB.query(
        "SELECT (SELECT COALESCE(SUM(`qty`+`other_qty`), 0) FROM `rm_location` WHERE loc_in = :rm021 AND `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'TRANSFER')) - (SELECT COALESCE(SUM(`qty`+`other_qty`), 0) FROM `rm_location` WHERE loc_out = :rm021 AND `components_id` = :component AND (`trans_type` != 'INWARD' AND `trans_type` != 'CONSUMPTION' AND `trans_type` != 'CANCELLED')) AS RM021CLOSING , (SELECT COALESCE(SUM(`qty`+`other_qty`), 0) FROM `rm_location` WHERE loc_in = :rm029 AND `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'TRANSFER')) - (SELECT COALESCE(SUM(`qty`+`other_qty`), 0) FROM `rm_location` WHERE loc_out = :rm029 AND `components_id` = :component AND (`trans_type` != 'INWARD' AND `trans_type` != 'CONSUMPTION' AND `trans_type` != 'CANCELLED')) AS RM029CLOSING,(SELECT COALESCE(SUM(`qty`+`other_qty`), 0) FROM rm_location WHERE `components_id` = :component AND (`trans_type` = 'INWARD') AND DATE_FORMAT(insert_date , '%Y-%m-%d') = :date) AS min_qty FROM DUAL;",
        {
          replacements: { component: stmt_part[0].component_key, rm021: "20210910142629", rm029: "1679131898656", date: todayDt },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let RM021 = 0;
      let RM029 = 0;
      let min_qty = 0;

      if (stmt_closing.length > 0) {
        RM021 = stmt_closing[0].RM021CLOSING;
        RM029 = stmt_closing[0].RM029CLOSING;
        min_qty = stmt_closing[0].min_qty;
      }

      final.push({
        PART_NO: stmt_part[0].c_part_no,
        PART_NAME: stmt_part[0].c_name,
        RM021: RM021,
        RM029: RM029,
        MIN_QTY: min_qty,
      });

      return res.json({ status: "success", success: true, message: "", data: final });
    } else {
      return res.json({ status: "error", success: false, message: "Component not found!!!" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;

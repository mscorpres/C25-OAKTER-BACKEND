const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const Validator = require("validatorjs");

router.post("/vbtAppReport", [auth.isAuthorized], async (req, res) => {
  try {
    let data = [];

    // GET VENDOR Bill DATA
    let stmt = await tallyDB.query("SELECT `ven_code`, `vbt_key` , `vbt_invoice_no` ,`vbt_invoice_date` , min_id FROM `tally_vbt` WHERE `vbt_ap_status` = 'O' GROUP BY `vbt_key`", {
      replacements: { vendor: req.body.vendor },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      for (let i = 0; i < stmt.length; i++) {
        // GET MIN & PO & COST & PROJECT CODE

        let stmt_other = await invtDB.query(
          "SELECT in_transaction_id , in_po_transaction_id , po_project_name , cost_center_name FROM rm_location LEFT JOIN po_purchase_req ON po_purchase_req.po_transaction = rm_location.in_po_transaction_id LEFT JOIN cost_center ON cost_center.cost_center_key =po_purchase_req.po_cost_center  WHERE in_transaction_id = :min_id GROUP BY rm_location.in_transaction_id ",
          {
            replacements: { min_id: stmt[i].min_id },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        // GET TOTAL VENDOR AMMOUNT
        let stmt_total_amm = await tallyDB.query("SELECT SUM(`vbt_ven_ammount`) as ven_ammount  FROM `tally_vbt` WHERE `vbt_key` = :vbt_key ", {
          replacements: { vbt_key: stmt[i].vbt_key },
          type: tallyDB.QueryTypes.SELECT,
        });

        let stmt_pend = await tallyDB.query("SELECT SUM(`ap_os_amm`) as total_ap_os_amm FROM `tally_ap` WHERE `ap_ref_no` = :v_key ", {
          replacements: { v_key: stmt[i].vbt_key },
          type: tallyDB.QueryTypes.SELECT,
        });

        os_amm = stmt_total_amm[0].ven_ammount;

        if (stmt_pend.length > 0) {
          // PENDIG AMMOUNT
          os_amm = Number(stmt_total_amm[0].ven_ammount) - Number(stmt_pend[0].total_ap_os_amm);
        }

        data.push({
          v_key: stmt[i].vbt_key,
          v_code: stmt[i].ven_code,
          invoice_number: stmt[i].vbt_invoice_no,
          invoice_date: stmt[i].vbt_invoice_date,
          os_amm: Number(os_amm).toFixed(0),
          clear_amm: Number(stmt_total_amm[0].ven_ammount).toFixed(0) - Number(os_amm).toFixed(0),
          ammount: Number(stmt_total_amm[0].ven_ammount).toFixed(0),
          po_id: stmt_other[0].in_po_transaction_id,
          project: stmt_other[0].po_project_name ?? "--",
          cost_center: stmt_other[0].cost_center_name ?? "--",
        });
      } // END FOR

      return res.json({ code: "200", status: "success", success: true, data: data });
    } else {
      return res.json({ status: "error", success: false, message: "Data Not Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

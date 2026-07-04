const express = require("express");
const router = express.Router();
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const Validator = require("validatorjs");
const { tallyDB } = require("../../../config/db/connection");

router.post("/cpmReport", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      projectCode: "required",
    });

    if (validation.fails()) {
      return res.json({ status: "error", success: false, message: validation.errors.all() });
    }

    let result = [];
    let stmt = await tallyDB.query(
      "SELECT `project_id`, tally_vbt.ven_code, tally_ledger.ladger_name , COALESCE(SUM(`vbt_taxable_value`), 0) AS purchase , COALESCE(SUM(`vbt_cgst`),0) + COALESCE(SUM(`vbt_sgst`),0) + COALESCE(SUM(`vbt_igst`),0) AS gst , COALESCE(SUM(`vbt_ven_ammount`),0) AS ven_amount FROM `tally_vbt` LEFT JOIN tally_ledger ON tally_ledger.ledger_key = tally_vbt.ven_code WHERE `tally_vbt`.`project_id` = :projectName AND tally_vbt.vbt_status != 'DE' GROUP BY `tally_vbt`.ven_code",
      {
        replacements: { projectName: req.body.projectCode },
        type: tallyDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length === 0) {
      return res.json({ message: "No data found!!", status: "error", success: false });
    }
    for (let i = 0; i < stmt.length; i++) {

      let vbtTaxableAmount = 0
      let gstAmount = 0
      let venAmount = 0
      let advanceAmount = 0

      let stmt1 = await tallyDB.query("SELECT COALESCE(SUM(`vbt_taxable_value`), 0) AS purchase , COALESCE(SUM(`vbt_cgst`),0) + COALESCE(SUM(`vbt_sgst`),0) + COALESCE(SUM(`vbt_igst`),0) AS gst , COALESCE(SUM(`vbt_ven_ammount`),0) AS ven_amount FROM `tally_vbt` LEFT JOIN tally_ledger ON tally_ledger.ledger_key = tally_vbt.ven_code WHERE `tally_vbt`.`project_id` = :projectName AND tally_vbt.vbt_status = 'DE' AND tally_vbt.ven_code = :ven_code GROUP BY `tally_vbt`.ven_code",
        {
          replacements: {
            projectName: req.body.projectCode,
            ven_code: stmt[i].ven_code
          },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (stmt1.length > 0) {
        vbtTaxableAmount = Number(Number(stmt1[0].purchase).toFixed(0));
        gstAmount = Number(Number(stmt1[0].gst).toFixed(0));
        venAmount = Number(Number(stmt1[0].ven_amount).toFixed(0));
      }

      let paidAmount = 0

      let stmt2 = await tallyDB.query("SELECT COALESCE(SUM(`ap_so_amm`),0) AS paid_amount FROM tally_ap WHERE project_id = :projectName AND ap_ven_code = :venCode GROUP BY project_id", {
        replacements: {
          projectName: req.body.projectCode,
          venCode: stmt[i].ven_code
        },
        type: tallyDB.QueryTypes.SELECT
      })

      if (stmt2.length > 0) {
        paidAmount = Number(Number(stmt2[0].paid_amount).toFixed(0)).toLocaleString("en-IN")
      }

      result.push({
        ven_code: stmt[i].ven_code,
        ven_name: stmt[i].ladger_name,
        vbt_taxable_value: Number(Number(stmt[i].purchase).toFixed(0) - vbtTaxableAmount).toLocaleString("en-IN"),
        gst_amount: Number(Number(stmt[i].gst).toFixed(0) - gstAmount).toLocaleString("en-IN"),
        vendor_amount: Number(Number(stmt[i].ven_amount).toFixed(0) - venAmount).toLocaleString("en-IN"),
        paid_amount: paidAmount,
        advance_amount: 0
      });
    }
    return res.json({ status: "success", success: true, data: result });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// router.post("/updateTallyVbt", [auth.isAuthorized], async (req, res) => {
//   const transaction = await tallyDB.transaction()
//   try {
//       let stmt = await tallyDB.query("SELECT min_id, mscorpre_ims_invt.po_purchase_req.po_project_name, mscorpre_ims_invt.po_purchase_req.po_transaction FROM tally_vbt LEFT JOIN mscorpre_ims_invt.rm_location ON mscorpre_ims_invt.rm_location.in_transaction_id = min_id LEFT JOIN mscorpre_ims_invt.po_purchase_req ON mscorpre_ims_invt.po_purchase_req.po_transaction = mscorpre_ims_invt.rm_location.in_po_transaction_id", {
//           type: tallyDB.QueryTypes.SELECT,
//       })

//       if (stmt.length > 0) {
//           for (let i = 0; i < stmt.length; i++) {
//               let stmt1 = await tallyDB.query("UPDATE tally_vbt SET po_number = :po_number, project_id = :project_id WHERE min_id = :min_id", {
//                   replacements: {
//                       min_id: stmt[i].min_id,
//                       project_id: stmt[i].po_project_name,
//                       po_number: stmt[i].po_transaction
//                   },
//                   type: tallyDB.QueryTypes.UPDATE,
//                   transaction:transaction,
//               })

//               if (stmt1.length <= 0) {
//                   await transaction.rollback()
//                   return res.json({ status: 'error', message: 'error while updating...' })
//               }

//           }
//           await transaction.commit()
//           return res.json({ status: 'success', message: "updated successfully..." })
//       }
//       return res.json({ status: 'error', message: 'no data' })
//   } catch (err) {
//       await transaction.rollback()
//       return res.json({ status: "error", success: false, message: "Internal error"});

//   }
// })

module.exports = router;

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
let { tallyDB, invtDB } = require("../../../config/db/connection");

const Validator = require("validatorjs");



// VBT01 // PURCHASE GOOD && VBT06 // JOBWORK
// Disable the VBT 
router.put("/disable_vbtprocess", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    min_transaction: "required",
    part_code: "required",
  });

  if (validation.fails()) {
    return res.json({ message: validation.errors.all(), status: "error", success: false });
  }

  const transactioninvt = await invtDB.transaction();
  const { min_transaction, part_code, remark } = req.body;

  try {
    // FETCH VBT
    let stmt_check_vbt = await invtDB.query("SELECT c.c_part_no, rl.* FROM rm_location rl JOIN components c ON rl.components_id = c.component_key WHERE rl.in_transaction_id = :min AND c.c_part_no = :part", {
      replacements: {
        min: min_transaction,
        part: part_code
      },
      type: invtDB.QueryTypes.SELECT
    });

    if (stmt_check_vbt.length == 0) {
      return res.json({ status: "error", success: false, message: "VBT not found for process" });
    }
    if (stmt_check_vbt[0].vbp_status == "Y") {
      return res.json({ status: "error", success: false, message: "VBT already processed and it cannot be disabled" });
    }
    if (stmt_check_vbt[0].vbp_status == "NOTELIGIBLE") {
      return res.json({ status: "error", success: false, message: "VBT already marked as disabled for process" });
    }
    // UPDATE VBT
    let update_stmt = await invtDB.query("UPDATE `rm_location` SET `vbp_status` = 'NOTELIGIBLE' , backend_remark = :remark WHERE `in_transaction_id` = :min AND `components_id`= :comp", {
      replacements: {
        min: min_transaction,
        comp: stmt_check_vbt[0].components_id,
        remark: "Remark: "+(remark || "Not Mention") + " @at: " + moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss") + " @by: " + req.logedINUser
      },
      type: invtDB.QueryTypes.UPDATE,
      transaction: transactioninvt
    });

    if (update_stmt.length > 0) {
      await transactioninvt.commit();
      return res.json({ status: "success", success: true, message: "VBT has been disabled for process", data: {
        status: "DISABLED"
      } });
    }

    await transactioninvt.rollback();
    return res.json({ status: "error", success: false, message: "an error occurred while process your request" });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

// FETCH VBT MODULES (SELECt OPTION)(VBT GROUP MAP)
router.post("/fetch_vbt_list", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == undefined || req.body.search == "") {
      stmt = await tallyDB.query("SELECT vbt_module,vbt_name FROM `vbt_module` LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT vbt_module,vbt_name FROM `vbt_module` WHERE vbt_name LIKE :search LIMIT 50", {
        replacements: { search: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }
    if (stmt.length > 0) {
      let final = [];
      stmt.map((item) => {
        final.push({ id: item.vbt_module, label: item.vbt_name });
        if (final.length == stmt.length) {
          return res.json({ status: "success", success: true, data: final });
        }
      });
    } else {
      return res.json({ status: "error", success: false, message: "No Sub-Group Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH VBT GROUP
router.post("/fetch_vbt_group", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    vbt_key: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query("SELECT vbt_name,vbt_module,vbt_group_key FROM `vbt_module` WHERE `vbt_module`= :module", {
      replacements: { module: req.body.vbt_key },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      let sub_group = stmt[0].vbt_group_key.split(",");
      let vbt_group_key = [];
      if (sub_group.length > 0) {
        for (let i = 0; i < sub_group.length; i++) {
          let stmt_sub = await tallyDB.query("SELECT group_key,group_name,code from tally_group WHERE `group_key` = :key ", {
            replacements: { key: sub_group[i] },
            type: tallyDB.QueryTypes.SELECT,
          });

          vbt_group_key.push({ code: stmt_sub[0].group_key, label: `${stmt_sub[0].group_name} (${stmt_sub[0].code})` });
        }
      }

      return res.json({

        status: "success", success: true,
        data: {
          vbt_name: stmt[0].vbt_name,
          vbt_module: stmt[0].vbt_module,
          vbt_group_key: vbt_group_key,
        },
      });
    } else {
      return res.json({ status: "error", success: false, message: "No data Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH FREIGHT
router.post("/fetch_freight_group", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT `vbt_group_key` FROM `vbt_module` WHERE `vbt_module`='vbt01'", {
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      let str_gl_keys = stmt[0].vbt_group_key;
      let gl_key_arr = str_gl_keys.split(",");
      if (gl_key_arr.length > 0) {
        let options = [];
        for (let i = 0; i < gl_key_arr.length; i++) {
          let stmt1 = await tallyDB.query("SELECT `ledger_key` , `ladger_name` , `code` FROM `tally_ledger` WHERE `sub_group_key`=:key", {
            replacements: { key: gl_key_arr[i] },
            type: tallyDB.QueryTypes.SELECT,
          });
          if (stmt1.length > 0) {
            for (let j = 0; j < stmt1.length; j++) {
              options.push({ id: stmt1[j].ledger_key, text: `${stmt1[j].ladger_name} (${stmt1[j].code})` });
            }
          }
        }
        return res.json(options);
      }
    } else {
      return res.json({ status: "error", success: false, message: "No G/L Mapping Found!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE VBT GROUP
router.post("/update_vbt_group_module", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    vbt_module: "required",
    sub_groups: "required",
  });

  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let groups_keys_in_str = req.body.sub_groups.toString();

    let stmt = await tallyDB.query("UPDATE `vbt_module` SET `vbt_group_key` = :keys WHERE `vbt_module`.`vbt_module` = :module ", {
      replacements: { keys: groups_keys_in_str, module: req.body.vbt_module },
      type: tallyDB.QueryTypes.UPDATE,
    });

    if (stmt.length > 0) {
      return res.json({ status: "success", success: true, message: "Updated!!" });
    } else {
      return res.json({ status: "success", success: true, message: "Something went wrong Updation Failed!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH GST LEDGER FOR VBT
router.get("/fetch_gst_ledger", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT `vbt_group_key` FROM `vbt_module` WHERE `vbt_module`='gst'", {
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      let str_gl_keys = stmt[0].vbt_group_key;
      let gl_key_arr = str_gl_keys.split(",");
      if (gl_key_arr.length > 0) {
        let options = [];
        for (let i = 0; i < gl_key_arr.length; i++) {
          let stmt1 = await tallyDB.query("SELECT `ledger_key` , `ladger_name` , `code` FROM `tally_ledger` WHERE `sub_group_key`=:key", {
            replacements: { key: gl_key_arr[i] },
            type: tallyDB.QueryTypes.SELECT,
          });
          if (stmt1.length > 0) {
            for (let j = 0; j < stmt1.length; j++) {
              options.push({ id: stmt1[j].ledger_key, text: `${stmt1[j].ladger_name} (${stmt1[j].code})` });
            }
          }
        }
        return res.json(options);
      }
    } else {
      return res.json({ status: "error", success: false, message: "No G/L Mapping Found!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// to check existing invoice number 
router.get('/checkInvoice', async (req, res) => {
  let validation = new Validator(req.query, {
    vbtInvoiceNo: 'required',
    vendor: 'required',
  });
  if (validation.fails()) {
    return res.status(403).send(Object.values(validation.errors.all())[0].join());
  }
  try {
    let findExistingInvoice = await tallyDB.query("SELECT * FROM `tally_vbt` WHERE vbt_invoice_no= :vbtInvoiceNo AND ven_code = :vendor", {
      type: tallyDB.QueryTypes.SELECT,
      replacements: {
        vbtInvoiceNo: req.query.vbtInvoiceNo,
        vendor: req.query.vendor
      },
    });
    if (findExistingInvoice.length > 0) {
      return res.status(200).send({
        message: 'vbt has been already generated for this invoice no',
        checkInvoice: true
      });
    } else {
      return res.status(200).send({
        message: 'no vbt has been made for this invoice no',
        checkInvoice: false
      });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

//delete vbt 
router.delete("/deleteVbt", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.query, {
    vbtKey: "required",
    reason: "required",
  })

  if (validation.fails()) {
    return res.status(403).send(Object.values(validation.errors.all())[0].join());
  }

  const transactionTallyDB = await tallyDB.transaction();

  const transactionInvtDB = await invtDB.transaction();

  try {

    let checkUser = await invtDB.query("SELECT type FROM admin_login WHERE CustID = :custID", {
      replacements: { custID: req.logedINUser },
      type: invtDB.QueryTypes.SELECT
    });

    if (checkUser.length <= 0) {
      await transactionInvtDB.rollback();
      await transactionTallyDB.rollback();
      return res.json({ status: "error", success: false, message: "user not found" });
    }

    if (checkUser[0].type != 'developer') {
      await transactionInvtDB.rollback();
      await transactionTallyDB.rollback();
      return res.json({ status: "error", success: false, message: "You are not authorized to perform this action" });
    }

    let checkSettlement = await tallyDB.query("SELECT * FROM `tally_ap` WHERE `ap_ref_no` = :vbtKey", {
      replacements: { vbtKey: req.query.vbtKey },
      type: tallyDB.QueryTypes.SELECT
    });

    if (checkSettlement.length > 0) {
      await transactionInvtDB.rollback();
      await transactionTallyDB.rollback();
      return res.json({ status: "error", success: false, message: "cannot delete as vbt is already knocked off" });
    }

    let fetchVbt = await tallyDB.query("SELECT * FROM tally_vbt WHERE vbt_key = :key", {
      replacements: { key: req.query.vbtKey },
      type: tallyDB.QueryTypes.SELECT,
      transaction: transactionTallyDB
    });

    if (fetchVbt.length <= 0) {
      await transactionInvtDB.rollback();
      await transactionTallyDB.rollback();
      return res.json({ status: "error", success: false, message: "vbt not found" });
    }

    const deletedDate = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    const deletedBy = req.logedINUser;

    for (const row of fetchVbt) {
      if (row.vbt_debit_key != '--') {
        await transactionInvtDB.rollback();
        await transactionTallyDB.rollback();
        return res.json({ status: "error", success: false, message: "cannot delete as debit note is generated for this vbt" });
      }

      let insertVbtData = await tallyDB.query("INSERT INTO deleted_tally_vbt(part_code, po_number, project_id, jw_id, vbt_inqty, vbt_bill_qty, vbt_inrate, currency_type, exchange_rate, vbt_taxable_value, hsn_code, vbt_gst_type, vbt_gst_rate, custom_duty, sws, misc, freight, vbt_freight_gl, insurance_value, other_charges, vbp_gst_ass_value, vbt_cgst, vbt_cgst_gl, vbt_sgst, vbt_sgst_gl, vbt_igst, vbt_igst_gl, gl_code, tds_code, tds_gl, vbt_tds_ass_val, vbt_tds_amount, vbt_ven_ammount, vbt_key, vbt_debit_key, min_id, ven_code, vbt_invoice_no, ven_address, vbt_comment, vbt_invoice_date, vbt_gstin, vbt_type, vbt_other_data, vbt_session_year, insert_by, insert_date, update_by, update_date, effective_date, vbt_status, vbt_ap_status, deleted_by, deleted_date, item_description , reason) VALUES( :partCode , :poNumber , :projectID , :jwID , :vbtInQty , :vbtBillQty , :vbtInRate , :currencyType , :exchangeRate , :vbtTaxableValue , :hsnCode , :vbtGstType , :vbtGstRate , :customDuty , :sws , :misc , :freight , :vbtFreightGl , :insuranceValue , :otherCharges , :vbpGstAssValue , :vbtCgst , :vbtCgstGl , :vbtSgst , :vbtSgstGl , :vbtIgst , :vbtIgstGl , :glCode , :tdsCode , :tdsGl , :vbtTdsAssVal , :vbtTdsAmount , :vbtVenAmount , :vbtKey , :vbtDebitKey , :minID , :venCode , :vbtInvoiceNo , :venAddress , :vbtComment , :vbtInvoiceDate , :vbtGstIn , :vbtType , :vbtOtherData , :vbtSessionYear , :insertBy , :insertDate , :updateBy , :updateDate , :effectiveDate , :vbtStatus , :vbtApStatus , :deletedBy , :deletedDate , :itemDescription , :reason)", {
        replacements: {
          partCode: row.part_code,
          poNumber: row.po_number,
          projectID: row.project_id,
          jwID: row.jw_id,
          vbtInQty: row.vbt_inqty,
          vbtBillQty: row.vbt_bill_qty,
          vbtInRate: row.vbt_inrate,
          currencyType: row.currency_type,
          exchangeRate: row.exchange_rate,
          vbtTaxableValue: row.vbt_taxable_value,
          hsnCode: row.hsn_code,
          vbtGstType: row.vbt_gst_type,
          vbtGstRate: row.vbt_gst_rate,
          customDuty: row.custom_duty,
          sws: row.sws,
          misc: row.misc,
          freight: row.freight,
          vbtFreightGl: row.vbt_freight_gl,
          insuranceValue: row.insurance_value,
          otherCharges: row.other_charges,
          vbpGstAssValue: row.vbp_gst_ass_value,
          vbtCgst: row.vbt_cgst,
          vbtCgstGl: row.vbt_cgst_gl,
          vbtSgst: row.vbt_sgst,
          vbtSgstGl: row.vbt_sgst_gl,
          vbtIgst: row.vbt_igst,
          vbtIgstGl: row.vbt_igst_gl,
          glCode: row.gl_code,
          tdsCode: row.tds_code,
          tdsGl: row.tds_gl,
          vbtTdsAssVal: row.vbt_tds_ass_val,
          vbtTdsAmount: row.vbt_tds_amount,
          vbtVenAmount: row.vbt_ven_ammount,
          vbtKey: row.vbt_key,
          vbtDebitKey: row.vbt_debit_key,
          minID: row.min_id,
          venCode: row.ven_code,
          vbtInvoiceNo: row.vbt_invoice_no,
          venAddress: row.ven_address,
          vbtComment: row.vbt_comment,
          vbtInvoiceDate: row.vbt_invoice_date,
          vbtGstIn: row.vbt_gstin,
          vbtType: row.vbt_type,
          vbtOtherData: row.vbt_other_data,
          vbtSessionYear: row.vbt_session_year,
          insertBy: row.insert_by,
          insertDate: row.insert_date,
          updateBy: row.update_by,
          updateDate: row.update_date,
          effectiveDate: row.effective_date,
          vbtStatus: row.vbt_status,
          vbtApStatus: row.vbt_ap_status,
          deletedBy: deletedBy,
          deletedDate: deletedDate,
          itemDescription: row.item_description,
          reason: req.query.reason
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transactionTallyDB
      });

      if (insertVbtData.length <= 0) {
        await transactionInvtDB.rollback();
        await transactionTallyDB.rollback();
        return res.json({ status: "error", success: false, message: "error while inserting vbt data" });
      }

      let updateMinStatus = await invtDB.query("UPDATE rm_location SET vbp_status = 'N' WHERE in_transaction_id = :min", {
        replacements: { min: row.min_id },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transactionInvtDB
      });

      if (updateMinStatus.length <= 0) {
        await transactionInvtDB.rollback();
        await transactionTallyDB.rollback();
        return res.json({ status: "error", success: false, message: "error occured while updating min status" });
      }
    }

    let deleteVbt = await tallyDB.query("DELETE FROM tally_vbt WHERE vbt_key = :vbtKey AND vbt_debit_key = '--' ", {
      replacements: { vbtKey: req.query.vbtKey },
      type: tallyDB.QueryTypes.DELETE,
      transaction: transactionTallyDB
    })

    const ledgerData = await tallyDB.query("SELECT * FROM `tally_ledger_data` WHERE `module_used` = :vbtKey", {
      replacements: {
        vbtKey: req.query.vbtKey,
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    for (const row of ledgerData) {
      let insertLedgerData = await tallyDB.query("INSERT INTO `deleted_tally_ledger_data` (ladger_key, debit, credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladgerKey, :debit , :credit, :moduleUsed, :insertDate, :whichModule, :effectiveDate, :insertBy)", {
        replacements: {
          ladgerKey: row.ladger_key,
          debit: row.debit,
          credit: row.credit,
          moduleUsed: row.module_used,
          insertDate: row.insert_date,
          whichModule: row.which_module,
          effectiveDate: row.ref_date,
          insertBy: row.insert_by,
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transactionTallyDB,
      });

      if (insertLedgerData.length <= 0) {
        await transactionInvtDB.rollback();
        await transactionTallyDB.rollback();
        return res.json({ status: "error", success: false, message: "error while inserting ledger data" });
      }
    }

    let deleteLedger = await tallyDB.query("DELETE FROM tally_ledger_data WHERE module_used = :vbtKey AND debit_key = '--' ", {
      replacements: { vbtKey: req.query.vbtKey },
      type: tallyDB.QueryTypes.DELETE,
      transaction: transactionTallyDB
    })

    await transactionTallyDB.commit();
    await transactionInvtDB.commit();
    return res.json({ status: "error", success: false, message: "vbt deleted successfully" });

  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

//vbts gl options
router.get("/vbtGlOptions", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.query, {
      type: "required",
    });

    if (validation.fails()) {
      return res.status(403).send(Object.values(validation.errors.all())[0].join());
    }

    let stmt = await tallyDB.query("SELECT `vbt_group_key` FROM `vbt_module` WHERE `vbt_module`= :type", {
      replacements: {
        type: req.query.type
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      let str_gl_keys = stmt[0].vbt_group_key;
      let gl_key_arr = str_gl_keys.split(",");
      if (gl_key_arr.length > 0) {
        let options = [];
        for (let i = 0; i < gl_key_arr.length; i++) {
          let stmt1 = await tallyDB.query("SELECT ledger_key, ladger_name, code FROM `tally_ledger` WHERE `sub_group_key`=:key", {
            replacements: { key: gl_key_arr[i] },
            type: tallyDB.QueryTypes.SELECT,
          });
          if (stmt1.length > 0) {
            for (let j = 0; j < stmt1.length; j++) {
              options.push({ id: stmt1[j].ledger_key, text: `${stmt1[j].ladger_name} (${stmt1[j].code})` });
            }
          }
        }
        return res.json(options);
      }
    } else {
      return res.json({ status: "error", success: false, message: "No data found" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

//vbt verification
router.patch("/verify", [auth.isAuthorized], async (req, res) => {
  let transaction = await tallyDB.transaction();

  try {
    let validation = new Validator(req.body, {
      vbtKey: "required",
      verificationStatus: "required|boolean",
    });

    if (validation.fails()) {
      return res.status(403).send(Object.values(validation.errors.all())[0].join());
    }

    let updateVbt = await tallyDB.query("UPDATE tally_vbt SET verificationStatus = :verificationStatus , verifiedBy = :verifiedBy, verifiedAt = :verifiedDate WHERE vbt_key = :vbtKey", {
      replacements: {
        verificationStatus: req.body.verificationStatus,
        verifiedBy: req.logedINUser,
        verifiedDate: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        vbtKey: req.body.vbtKey,
      },
      transaction: transaction
    })

    if (updateVbt[0].affectedRows) {
      await transaction.commit();
      return res.json({ status: "error", success: false, message: "vbt verified successfully" });
    } else {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "vbt not verified" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

//get vbt data to edit
router.get("/getData", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.query, {
      vbtKey: 'required'
    });

    if (validation.fails()) {
      return res.status(403).send(Object.values(validation.errors.all())[0].join());
    }

    let fetchVbt = await tallyDB.query("SELECT * FROM tally_vbt WHERE vbt_key = :vbtKey AND vbt_debit_key = '--'", {
      replacements: { vbtKey: req.query.vbtKey },
      type: tallyDB.QueryTypes.SELECT
    });

    let result = [];
    if (fetchVbt.length > 0) {
      for (let i = 0; i < fetchVbt.length; i++) {

        let fetchPart = await invtDB.query("SELECT c_part_no AS partCode , c_name AS partName , component_key AS productKey FROM components WHERE component_key = :componentKey", {
          replacements: { componentKey: fetchVbt[i].part_code },
          type: invtDB.QueryTypes.SELECT
        })

        let fetchFreight = await tallyDB.query("SELECT CONCAT('(', code , ')' , ladger_name) AS label , ledger_key AS value FROM tally_ledger WHERE ledger_key = :ledgerKey", {
          replacements: { ledgerKey: fetchVbt[i].vbt_freight_gl },
          type: tallyDB.QueryTypes.SELECT
        })

        let fetchCgst = await tallyDB.query("SELECT CONCAT('(', code , ')' , ladger_name) AS label , ledger_key AS value FROM tally_ledger WHERE ledger_key = :ledgerKey", {
          replacements: { ledgerKey: fetchVbt[i].vbt_cgst_gl },
          type: tallyDB.QueryTypes.SELECT
        })

        let fetchSgst = await tallyDB.query("SELECT CONCAT('(', code , ')' , ladger_name) AS label , ledger_key AS value FROM tally_ledger WHERE ledger_key = :ledgerKey", {
          replacements: { ledgerKey: fetchVbt[i].vbt_sgst_gl },
          type: tallyDB.QueryTypes.SELECT
        })

        let fetchIgst = await tallyDB.query("SELECT CONCAT('(', code , ')' , ladger_name) AS label , ledger_key AS value FROM tally_ledger WHERE ledger_key = :ledgerKey", {
          replacements: { ledgerKey: fetchVbt[i].vbt_igst_gl },
          type: tallyDB.QueryTypes.SELECT
        })

        let fetchPurchaseGl = await tallyDB.query("SELECT CONCAT('(', code , ')' , ladger_name) AS label , ledger_key AS value FROM tally_ledger WHERE ledger_key = :ledgerKey", {
          replacements: { ledgerKey: fetchVbt[i].gl_code },
          type: tallyDB.QueryTypes.SELECT
        })

        let fetchTds = await tallyDB.query("SELECT CONCAT('(', tally_ledger.code , ')' , tally_ledger.ladger_name) AS glName , tally_ledger.ledger_key AS tdsGlKey , tally_tds.tds_key AS tdsKey , tally_tds.tds_name AS tdsName , tally_tds.tds_percent AS tdsPercent FROM tally_ledger LEFT JOIN tally_tds ON tally_ledger.ledger_key = tally_tds.tds_gl_code WHERE tally_ledger.ledger_key = :ledgerKey AND tally_tds.tds_key = :tdsKey", {
          replacements: {
            ledgerKey: fetchVbt[i].tds_gl,
            tdsKey: fetchVbt[i].tds_code
          },
          type: tallyDB.QueryTypes.SELECT
        })

        if (fetchTds.length === 0) {
          fetchTds.push({
            glName: "--",
            tdsGlKey: "--",
            tdsKey: "--",
            tdsName: "--",
            tdsPercent: 0
          })
        }

        result.push({
          part: fetchPart[0],
          poNumber: fetchVbt[i].po_number,
          jwID: fetchVbt[i].jw_id,
          projectID: fetchVbt[i].project_id,
          vbtInQty: fetchVbt[i].vbt_inqty,
          vbtBillQty: fetchVbt[i].vbt_bill_qty,
          vbtInRate: fetchVbt[i].vbt_inrate,
          currencyType: fetchVbt[i].currency_type,
          exchangeRate: fetchVbt[i].exchange_rate,
          taxableValue: fetchVbt[i].vbt_taxable_value,
          hsnCode: fetchVbt[i].hsn_code,
          gstType: fetchVbt[i].vbt_gst_type,
          gstRate: fetchVbt[i].vbt_gst_rate,
          customDuty: fetchVbt[i].custom_duty,
          sws: fetchVbt[i].sws,
          misc: fetchVbt[i].misc,
          freightAmount: fetchVbt[i].freight,
          freight: fetchFreight[0],
          insuranceValue: fetchVbt[i].insurance_value,
          otherCharges: fetchVbt[i].other_charges,
          gstAssValue: fetchVbt[i].vbp_gst_ass_value,
          cgstAmount: fetchVbt[i].vbt_cgst,
          cgst: fetchCgst[0],
          sgstAmount: fetchVbt[i].vbt_sgst,
          sgst: fetchSgst[0],
          igstAmount: fetchVbt[i].vbt_igst,
          igst: fetchIgst[0],
          purchase_gl: fetchPurchaseGl[0],
          tdsAssValue: fetchVbt[i].vbt_tds_ass_val,
          tdsAmount: fetchVbt[i].vbt_tds_amount,
          tds: fetchTds[0],
          // venCode: fetchVbt[i].ven_code,
          venAmmount: fetchVbt[i].vbt_ven_ammount,
          minId: fetchVbt[i].min_id,
          venCode: fetchVbt[i].ven_code,
          invoiceNo: fetchVbt[i].vbt_invoice_no,
          invoiceDate: fetchVbt[i].vbt_invoice_date,
          venAddress: fetchVbt[i].ven_address,
          comment: fetchVbt[i].vbt_comment,
          gst: fetchVbt[i].vbt_gstin,
          vbtType: fetchVbt[i].vbt_type,
          vbtOtherData: fetchVbt[i].vbt_other_data,
          effectiveDate: moment(fetchVbt[i].effective_date).format("DD-MM-YYYY"),
          itemDescription: fetchVbt[i].item_description,
          insertDate: fetchVbt[i].insert_date,
          insertBy: fetchVbt[i].insert_by,
          roundOffSign: fetchVbt[i].round_off_sign,
          roundOffValue: fetchVbt[i].round_off_amt,
          billAmount: fetchVbt[i].billAmount,
          inrPrice: fetchVbt[i].inrPrice,
          cifPrice: fetchVbt[i].cifPrice,
          cifValue: fetchVbt[i].cifValue
        })
      }

      return res.status(200).send(result);
    }
    return res.json({ status: "error", success: false, message: "No data found" });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

//give last entry price for prompt
router.post("/lastOptions", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      partCode: "required",
      vendorCode: "required"
    });

    if (validation.fails()) {
      return res.status(403).send(Object.values(validation.errors.all())[0].join());
    }

    let result = [];

    for (let i = 0; i < req.body.partCode.length; i++) {
      const fetchPart = await invtDB.query("SELECT component_key FROM components WHERE c_part_no = :partCode", {
        replacements: { partCode: req.body.partCode[i] },
        type: invtDB.QueryTypes.SELECT
      })
      if (fetchPart.length <= 0) {
        // return res.json({ status: "error", success: false, message: "part not found" });
        continue;
      }

      const fetchVbt = await tallyDB.query("SELECT tally_vbt.vbt_inrate AS inRate, tally_vbt.gl_code AS ledgerCode, tally_ledger.ladger_name AS ledgerName FROM `tally_vbt` LEFT JOIN tally_ledger ON tally_ledger.ledger_key = tally_vbt.gl_code WHERE tally_vbt.`part_code` = :componentKey AND tally_vbt.`ven_code` = :vendorCode ORDER BY tally_vbt.`insert_date` DESC LIMIT 1", {
        replacements: { componentKey: fetchPart[0].component_key, vendorCode: req.body.vendorCode },
        type: tallyDB.QueryTypes.SELECT
      });

      if (fetchVbt.length <= 0) {
        return res.json(null);
      }

      result.push({
        partCode: req.body.partCode[i],
        inRate: fetchVbt[0].inRate,
        ledgerCode: fetchVbt[0].ledgerCode,
        ledgerName: fetchVbt[0].ledgerName
      })
    }

    return res.json(result);

  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

module.exports = router;

const express = require("express");
const router = express.Router();


const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");

let { invtDB } = require("../../../../config/db/connection");


const htmlToPdf = require("html-pdf-node");
const fs = require("fs");

const Validator = require("validatorjs");
const GPHtml = require("./GPPrintHTML");

// ADD NEW GATEPASS (DC)
router.post("/createGatePass", [auth.isAuthorized], async (req, res) => {
  var vendor = req.body.vendor;
  var bill = req.body.bill;
  var other = req.body.other;
  var material = req.body.material;

  let validation_vendor = new Validator(vendor, {
    passtype: "required",
    vendorname: "required",
    vendorbranch: "required",
    vendoraddress: "required",
  });
  if (validation_vendor.fails()) {
    return res.json({ status: "error", success: false, message: "Validation failed", data: validation_vendor.errors.all() });
  }

  let validation_bill = new Validator(bill, {
    billaddressid: "required",
    billaddress: "required",
  });
  if (validation_bill.fails()) {
    return res.json({ status: "error", success: false, message: "Validation failed", data: validation_bill.errors.all() });
  }

  const toFindDublicates = (arry) => arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(material.component);
  if (dubliEle.length > 0) {
    return res.json({ status: "error", success: false, message: "You have entered the same component twice in a single request." });
  }

  let itemLength = material.component.length;
  let sumOfChallanValue = 0;
  for (let i = 0; i < itemLength; i++) {
    sumOfChallanValue += material.qty[i] * material.rate[i];

    let validation_material = new Validator(
      {
        item: material.component[i],
        qty: material.qty[i],
        rate: material.rate[i],
        remark: material.remark[i],
      },
      {
        item: "required",
        qty: "required|min:1",
        rate: "required|min:1",
      }
    );
    if (validation_material.fails()) {
      return res.json({ status: "error", success: false, message: "Validation failed", data: validation_material.errors.all() });
    }
  }

  const t = await invtDB.transaction();

  try {
    if (other.vehicle_no == "") {
      t.rollback();
      return res.json({ status: "error", success: false, message: "Vehicle No is required." });
    }

    let transactionID = await helper.genTransaction("REGP", t);

    let stmt1 = await invtDB.query("SELECT `dc_transaction` FROM `ims_dc_challan` WHERE `dc_transaction` = :transaction_id GROUP BY `dc_transaction` LIMIT 1", {
      replacements: { transaction_id: transactionID },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt1.length > 0) {
      t.rollback();
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Alloting transaction id as [" + transactionID + "] for REGP has already exist with us, required manual checking or contact to system administrator.",
      });
    } else {
      let stmt2;
      for (let i = 0; i < itemLength; i++) {
        if (helper.number(material.qty[i]) > 0) {
          stmt2 = await invtDB.query(
            "INSERT INTO `ims_dc_challan` (`company_branch`,`dc_transaction`, `dc_type`, `trans_type`, `dc_vendor_details`, `dc_pass_terms`, `dc_bill_from`, `component`, `dc_qty`, `dc_rate`, `dc_hsn`, `dc_remark`,`dc_log`) VALUES (:branch,:transaction, :dc_type, :trans_type, :dc_vendor_details, :dc_pass_terms, :dc_bill_from, :component, :dc_qty, :dc_rate, :dc_hsn, :dc_remark,:dc_log)",
            {
              replacements: {
                branch: req.branch,
                transaction: transactionID,
                dc_type: "REGP",
                trans_type: req.body.trans_type,
                dc_vendor_details: JSON.stringify({
                  vendor_code: vendor.vendorname,
                  vendor_branch: vendor.vendorbranch,
                  vendor_address: vendor.vendoraddress.replace(/\n/g, "<br>"),
                }),
                dc_pass_terms: JSON.stringify({
                  terms_of_payment: other.terms_of_payment == "" ? "--" : other.terms_of_payment,
                  references_no: other.reference_no_dt == "" ? "--" : other.reference_no_dt,
                  other_references: other.other_reference == "" ? "--" : other.other_reference,
                  buyer_ord_no: other.buyer_order_no == "" ? "--" : other.buyer_order_no,
                  dispatch_doc_no: other.dispatch_doc_no == "" ? "--" : other.dispatch_doc_no,
                  dispatched_through: other.dispatch_through == "" ? "--" : other.dispatch_through,
                  destination: other.destination == "" ? "--" : other.destination,
                  terms_of_delivery: other.terms_of_delivery == "" ? "--" : other.terms_of_delivery,
                  narration: other.narration == "" ? "--" : other.narration,
                  vehicle_no: other.vehicle_no == "" ? "--" : other.vehicle_no,
                }),
                dc_bill_from: JSON.stringify({
                  bill_from_code: bill.billaddressid,
                  bill_from_address: bill.billaddress.replace(/\n/g, "<br>"),
                }),
                component: material.component[i],
                dc_qty: material.qty[i],
                dc_rate: material.rate[i],
                dc_hsn: material.hsncode[i] == "" ? "--" : material.hsncode[i],
                dc_remark: material.remark[i] == "" ? "--" : material.remark[i],
                dc_log: JSON.stringify({
                  insert_by: req.logedINUser,
                  insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                  update_by: "--",
                  update_date: "--",
                }),
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: t,
            }
          );
        }
      }
      if (stmt2.length > 0) {
        t.commit();
        return res.json({ status: "success", success: true, message: "GP Generated : RefID: " + transactionID, data: { txn: transactionID } });
      } else {
        t.rollback();
        return res.json({ status: "error", success: false, message: "An error occurred while creating gate pass." });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

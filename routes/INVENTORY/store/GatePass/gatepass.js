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
    return res.json({
      status: "error",
      success: false,
      message: "Validation failed",
      data: validation_vendor.errors.all(),
    });
  }

  let validation_bill = new Validator(bill, {
    billaddressid: "required",
    billaddress: "required",
  });
  if (validation_bill.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Validation failed",
      data: validation_bill.errors.all(),
    });
  }

  const toFindDublicates = (arry) =>
    arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(material.component);
  if (dubliEle.length > 0) {
    return res.json({
      status: "error",
      success: false,
      message: "You have entered the same component twice in a single request.",
    });
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
      return res.json({
        status: "error",
        success: false,
        message: "Validation failed",
        data: validation_material.errors.all(),
      });
    }
  }

  const t = await invtDB.transaction();

  try {
    if (other.vehicle_no == "") {
      t.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Vehicle No is required.",
      });
    }
    let type, transactionID;

    if (vendor.passtype === "R") {
      type = "RGP";
      transactionID = await helper.genTransaction("RGP_DC", t);
    } else {
      type = "NRGP";
      transactionID = await helper.genTransaction("NRGP_DC", t);
    }

    let stmt1 = await invtDB.query(
      "SELECT `dc_transaction` FROM `ims_dc_challan` WHERE `dc_transaction` = :transaction_id GROUP BY `dc_transaction` LIMIT 1",
      {
        replacements: { transaction_id: transactionID },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt1.length > 0) {
      t.rollback();
      return res.json({
        status: "error",
        success: false,
        success: false,
        message:
          "Alloting transaction id as [" +
          transactionID +
          "] for GP has already exist with us, required manual checking or contact to system administrator.",
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
                dc_type: vendor.passtype,
                trans_type: req.body.trans_type,
                dc_vendor_details: JSON.stringify({
                  vendor_code: vendor.vendorname,
                  vendor_branch: vendor.vendorbranch,
                  vendor_address: vendor.vendoraddress.replace(/\n/g, "<br>"),
                }),
                dc_pass_terms: JSON.stringify({
                  terms_of_payment:
                    other.terms_of_payment == ""
                      ? "--"
                      : other.terms_of_payment,
                  references_no:
                    other.reference_no_dt == "" ? "--" : other.reference_no_dt,
                  other_references:
                    other.other_reference == "" ? "--" : other.other_reference,
                  buyer_ord_no:
                    other.buyer_order_no == "" ? "--" : other.buyer_order_no,
                  dispatch_doc_no:
                    other.dispatch_doc_no == "" ? "--" : other.dispatch_doc_no,
                  dispatched_through:
                    other.dispatch_through == ""
                      ? "--"
                      : other.dispatch_through,
                  destination:
                    other.destination == "" ? "--" : other.destination,
                  terms_of_delivery:
                    other.terms_of_delivery == ""
                      ? "--"
                      : other.terms_of_delivery,
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
                  insert_date: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm:ss"),
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
        return res.json({
          status: "success",
          success: true,
          message: "GP Generated : RefID: " + transactionID,
          data: { txn: transactionID },
        });
      } else {
        t.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "An error occurred while creating gate pass.",
        });
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// ADD NEW GATEPASS (GP)
router.post("/createGP", [auth.isAuthorized], async (req, res) => {
  var recipient = req.body.recipient;
  var contact = req.body.contact;
  var other = req.body.other;
  var material = req.body.material;

  let validation_recipient = new Validator(recipient, {
    passtype: "required",
    name: "required",
    address: "required",
  });
  if (validation_recipient.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Validation failed",
      data: validation_recipient.errors.all(),
    });
  }

  const toFindDublicates = (arry) =>
    arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(material.component);
  if (dubliEle.length > 0) {
    return res.json({
      status: "error",
      success: false,
      message: "You have entered the same component twice in a single request.",
    });
  }

  let itemLength = material.component.length;
  for (let i = 0; i < itemLength; i++) {
    let validation_material = new Validator(
      {
        item: material.component[i],
        qty: material.qty[i],
        remark: material.remark[i],
      },
      {
        item: "required",
        qty: "required|min:1",
      }
    );
    if (validation_material.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "Validation failed",
      });
    }
  }

  const t = await invtDB.transaction();

  try {
    let transactionID = await helper.genTransaction("GATEPASS", t);

    let stmt_check_transID = await invtDB.query(
      "SELECT `gp_journal_id` FROM `ims_gatepass` WHERE `gp_journal_id` = :transaction_id GROUP BY `gp_journal_id` LIMIT 1",
      {
        replacements: { transaction_id: transactionID },
        type: invtDB.QueryTypes.SELECT,
        transaction: t,
      }
    );
    if (stmt_check_transID.length > 0) {
      t.rollback();
      return res.json({
        status: "error",
        success: false,
        success: false,
        message:
          "Alloting journal id as [" +
          transactionID +
          "] for gatepass has already alloted, required manual checking, contact your system administrator.",
      });
    } else {
      let stmt2;
      for (let i = 0; i < itemLength; i++) {
        if (helper.number(material.qty[i]) > 0) {
          stmt2 = await invtDB.query(
            "INSERT INTO `ims_gatepass`(`company_branch`,`gp_type`,`gp_name`,`gp_email`,`gp_mobile`,`gp_address`,`gp_part_code`,`gp_pass_qty`,`gp_part_remark`,`gp_journal_id`,`gp_narration`,`gp_insert_dt`,`gp_insert_by`) VALUES (:branch,:type,:name,:email,:mobile,:address,:part,:qty,:remark,:transaction,:narration,:in_dt,:in_by)",
            {
              replacements: {
                branch: req.branch,
                type: recipient.passtype,
                name: recipient.name,
                email: contact.email == "" ? "--" : contact.email,
                mobile: contact.mobile == "" ? "--" : contact.mobile,
                address: recipient.address.replace(/\n/g, "<br>"),
                part: material.component[i],
                qty: material.qty[i],
                remark: material.remark[i] == "" ? "--" : material.remark[i],
                transaction: transactionID,
                narration: other.narration == "" ? "--" : other.narration,
                in_dt: moment(new Date())
                  .tz("Asia/Kolkata")
                  .format("YYYY-MM-DD HH:mm:ss"),
                in_by: req.logedINUser,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: t,
            }
          );
        }
      }
      if (stmt2.length > 0) {
        t.commit();
        return res.json({
          status: "success",
          success: true,
          message: "GP Generated : Journal ID: " + transactionID,
        });
      } else {
        t.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "An error occurred while creating gatepass.",
        });
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//NEW CODE 16-09-2025 GATEPASS
router.post("/fetchAllGatepass", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }
  const ARCHIVE_CUTOFF_DATE = "2026-09-01";

  try {
    let stmt = [];
    if (searchBy == "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months"
      );
      if (durationInMonths > 3) {
        return res.json({
          status: "error",
          success: false,
          success: false,
          message:
            "On the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only.",
        });
      }

      if (fromdate < ARCHIVE_CUTOFF_DATE) {
        return res.json({
          success: false,
          message:"transaction before " + moment(ARCHIVE_CUTOFF_DATE, "YYYY-MM-DD").format("DD-MM-YYYY") + " is archived" ,
          status: "error",
        });
      }


      stmt = await invtDB.query(
        `SELECT 
          ven_basic_detail.ven_name, 
          ven_basic_detail.ven_register_id, 
          ims_dc_challan.dc_log, 
          ims_dc_challan.dc_vendor_details, 
          ims_dc_challan.dc_transaction, 
          ims_dc_challan.ewaybill_no, 
          ims_dc_challan.ewaybill_status,
          ims_dc_challan.dc_qty,
          ims_dc_challan.return_inward_qty,
          ims_dc_challan.dc_rate,
          ims_dc_challan.dc_hsn,
          ims_dc_challan.component,
          ims_dc_challan.ID as challan_id,
          components.c_part_no,
          components.c_name,
          units.units_name
        FROM ims_dc_challan 
        LEFT JOIN ven_basic_detail 
          ON ven_basic_detail.ven_register_id = JSON_UNQUOTE(JSON_EXTRACT(ims_dc_challan.dc_vendor_details, '$[0].vendor_code')) 
        LEFT JOIN components 
          ON ims_dc_challan.component = components.component_key 
        LEFT JOIN units 
          ON components.c_uom = units.units_id
        WHERE (STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(ims_dc_challan.dc_log, '$[0].insert_date')), '%Y-%m-%d') BETWEEN :datefrom AND :dateto) 
          AND ims_dc_challan.trans_type = 'DC' 
          AND ims_dc_challan.dc_status = 'ACTIVE' 
          AND ims_dc_challan.company_branch = :branch 
        ORDER BY ims_dc_challan.dc_transaction DESC, ims_dc_challan.ID DESC`,
        {
          replacements: {
            datefrom: fromdate,
            dateto: todate,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "gpwise") {
      stmt = await invtDB.query(
        `SELECT 
          ven_basic_detail.ven_name, 
          ven_basic_detail.ven_register_id, 
          ims_dc_challan.dc_log, 
          ims_dc_challan.dc_vendor_details, 
          ims_dc_challan.dc_transaction, 
          ims_dc_challan.ewaybill_no, 
          ims_dc_challan.ewaybill_status,
          ims_dc_challan.dc_qty,
          ims_dc_challan.return_inward_qty,
          ims_dc_challan.dc_rate,
          ims_dc_challan.dc_hsn,
          ims_dc_challan.component,
          ims_dc_challan.ID as challan_id,
          components.c_part_no,
          components.c_name,
          units.units_name
        FROM ims_dc_challan 
        LEFT JOIN ven_basic_detail 
          ON ven_basic_detail.ven_register_id = JSON_UNQUOTE(JSON_EXTRACT(ims_dc_challan.dc_vendor_details, '$[0].vendor_code')) 
        LEFT JOIN components 
          ON ims_dc_challan.component = components.component_key 
        LEFT JOIN units 
          ON components.c_uom = units.units_id
        WHERE ims_dc_challan.trans_type = 'DC' 
          AND ims_dc_challan.dc_status = 'ACTIVE' 
          AND ims_dc_challan.dc_transaction LIKE CONCAT('%', :transaction, '%') 
          AND ims_dc_challan.company_branch = :branch 
        ORDER BY ims_dc_challan.dc_transaction DESC, ims_dc_challan.ID DESC`,
        {
          replacements: {
            transaction: searchValue,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Please select valid filter method.",
      });
    }

    if (stmt.length > 0) {
      let finalResult = [];
      stmt.forEach((element, index) => {
        let jsonData_log = JSON.parse(element.dc_log);

        const insertDateOnly = moment(jsonData_log.insert_date, "YYYY-MM-DD HH:mm:ss").format("YYYY-MM-DD");
        if (insertDateOnly < ARCHIVE_CUTOFF_DATE) {
          return; // skip archived transactions (relevant for gpwise search)
        }
        const lineTotal = (
          parseFloat(element.dc_qty || 0) * parseFloat(element.dc_rate || 0)
        ).toFixed(2);

        const originalQty = parseFloat(element.dc_qty || 0);
        const returnedQty = parseFloat(element.return_inward_qty || 0);
        const pendingQty = parseFloat((originalQty - returnedQty).toFixed(4));



        finalResult.push({
          serial_no: index + 1,
          insert_date: moment(
            jsonData_log.insert_date,
            "YYYY-MM-DD HH:mm:ss"
          ).format("DD-MM-YYYY HH:mm:ss"),
          transaction_id: element.dc_transaction,
          challan_id: element.challan_id,
          vendor_name: element.ven_name + " (" + element.ven_register_id + ")",
          ewaybill_no: element.ewaybill_no || "--",
          ewaybill_status: element.ewaybill_status || "--",
          part_no: element.c_part_no || "--",
          component_name: element.c_name || "--",
          component_key: element.component || "--",
          quantity: originalQty,
          returned_qty: returnedQty,
          pending_qty: pendingQty < 0 ? 0 : pendingQty,
          rate: parseFloat(element.dc_rate || 0).toFixed(2),
          unit: element.units_name || "--",
          hsn: element.dc_hsn || "--",
          line_total: lineTotal,
        });
      });

      if (finalResult.length === 0) {
        res.json({
          success: false,
          message: "transaction before " + moment(ARCHIVE_CUTOFF_DATE, "YYYY-MM-DD").format("DD-MM-YYYY") + " is archived" ,
          status: "error",
        });
        return;
      }

      return res.json({
        status: "success",
        success: true,
        data: finalResult,
        total_records: finalResult.length,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message:
          "No gatepass DC were found that match the given search criteria.",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//FETCH ALL GATEPASSES (GP)
router.post("/fetchAllGP", [auth.isAuthorized], async (req, res, next) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }

  try {
    let stmt = [];
    if (searchBy == "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      stmt = await invtDB.query(
        "SELECT * FROM `ims_gatepass` WHERE DATE_FORMAT(`gp_insert_dt`,'%Y-%m-%d') BETWEEN :datefrom AND :dateto AND `company_branch` = :branch GROUP BY `gp_journal_id` ORDER BY `ID` DESC",
        {
          replacements: {
            datefrom: fromdate,
            dateto: todate,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "gpwise") {
      stmt = await invtDB.query(
        "SELECT * FROM `ims_gatepass` WHERE `gp_journal_id` = :journal_id AND `company_branch` = :branch GROUP BY `gp_journal_id` ORDER BY `ID` DESC",
        {
          replacements: {
            journal_id: searchValue,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "mobemailwise") {
      stmt = await invtDB.query(
        "SELECT * FROM `ims_gatepass` WHERE (`gp_email` LIKE CONCAT('%', :mobemail, '%') OR `gp_mobile` LIKE CONCAT('%', :mobemail, '%')) AND `company_branch` = :branch GROUP BY `gp_journal_id` ORDER BY `ID` DESC",
        {
          replacements: {
            mobemail: searchValue,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Select valid filter method.",
      });
    }

    if (stmt.length > 0) {
      let finalResult = [];
      stmt.forEach((element) => {
        finalResult.push({
          gp_reg_date: moment(
            element.gp_insert_dt,
            "YYYY-MM-DD HH:mm:ss"
          ).format("DD-MM-YYYY HH:mm:ss"),
          transaction_id: element.gp_journal_id,
          recipient: element.gp_name,
        });
      });

      if (stmt.length == finalResult.length) {
        return res.json({
          status: "success",
          success: true,
          data: finalResult,
        });
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No journal were found that match the given search criteria.",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// PRINT GATEPASS (DC)
router.post("/printGatePass", async (req, res) => {
  let validation = new Validator(req.body, {
    transaction: "required",
  });
  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }

  try {
    // BILLING FROM ADDRESS
    let stmt1 = await invtDB.query(
      "SELECT *, `ven_basic_detail`.`ven_name`, `ven_basic_detail`.`ven_register_id` FROM `ims_dc_challan` LEFT JOIN `ven_basic_detail` ON json_unquote(json_extract(`ims_dc_challan`.`dc_vendor_details`,'$[0].vendor_code')) = `ven_basic_detail`.`ven_register_id` WHERE `ims_dc_challan`.`dc_transaction` = :transaction GROUP BY `ims_dc_challan`.`dc_transaction`",
      {
        replacements: { transaction: req.body.transaction },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    let vendor_name,
      vendor_address,
      vendor_gstin,
      vendor_panno,
      vendor_statename;
    let bill_from_company,
      bill_from_gstin,
      bill_from_cin,
      bill_from_pan,
      bill_from_statename,
      bill_from_statecode;

    if (stmt1.length > 0) {
      let jsonData_vendor = JSON.parse(stmt1[0].dc_vendor_details);
      let jsonData_bill_from = JSON.parse(stmt1[0].dc_bill_from);

      if (
        jsonData_vendor.vendor_address !== "" &&
        jsonData_vendor.vendor_address !== "--"
      ) {
        vendor_address = jsonData_vendor.vendor_address;
      }

      vendor_name = stmt1[0].ven_name + " (" + stmt1[0].ven_register_id + ")";
      vendor_panno = stmt1[0].ven_pan_no;

      if (
        jsonData_bill_from.bill_from_address !== "" &&
        jsonData_bill_from.bill_from_address !== "--"
      ) {
        bill_from_address = jsonData_bill_from.bill_from_address;
      }

      let stmt2 = await invtDB.query(
        "SELECT * FROM `billing_address` LEFT JOIN `ims_dc_challan` ON json_unquote(json_extract(`ims_dc_challan`.`dc_bill_from`,'$[0].bill_from_code')) = `billing_address`.`billing_code` LEFT JOIN `state_code` ON `state_code`.`state_code` = `billing_address`.`billing_state` WHERE `ims_dc_challan`.`dc_transaction` = :transaction GROUP BY `ims_dc_challan`.`dc_transaction`",
        {
          replacements: { transaction: req.body.transaction },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt2.length > 0) {
        bill_from_company = stmt2[0].billing_company;
        bill_from_gstin = stmt2[0].billing_gstno;
        bill_from_cin = stmt2[0].billing_cin;
        bill_from_pan = stmt2[0].billing_pan;
        bill_from_statename = stmt2[0].state_name;
        bill_from_statecode = stmt2[0].billing_state;

        if (bill_from_address == "--" && bill_from_address == "") {
          bill_from_address = stmt2[0].billing_address;
        } else {
          bill_from_address = bill_from_address;
        }
      } else {
        bill_from_company = "N/A";
        bill_from_gstin = "N/A";
        bill_from_cin = "N/A";
        bill_from_pan = "N/A";
        bill_from_statename = "N/A";
        bill_from_statecode = "N/A";
      }

      let stmt3 = await invtDB.query(
        "SELECT `ven_address`, `ven_add_gst`, `ven_state`, `ven_add_gst` FROM `ven_address_detail` WHERE `ven_address_id` = :branch_code",
        {
          replacements: { branch_code: jsonData_vendor.vendor_branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt3.length > 0) {
        vendor_statename = stmt3[0].ven_state;
        vendor_gstin = stmt3[0].ven_add_gst;
        if (vendor_address == "--" && vendor_address == "") {
          vendor_address = stmt3[0].ven_address;
        } else {
          vendor_address = vendor_address;
        }
      } else {
        vendor_statename = "N/A";
        vendor_gstin = "N/A";
      }
    }

    // OTHER NOTES
    let stmt4 = await invtDB.query(
      "SELECT * FROM `ims_dc_challan` LEFT JOIN `components` ON `components`.`component_key` = `ims_dc_challan`.`component` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `dc_transaction` = :transaction",
      {
        replacements: { transaction: req.body.transaction },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt4.length > 0) {
      let items_data = [];
      let sum_total_amt = 0;
      let total_row_value = 0;
      let count = 1;

      stmt4.forEach((item) => {
        total_row_value =
          helper.number(item.dc_qty) * helper.number(item.dc_rate);
        items_data += `
				<tr class="no-bottom-border">
                    <td>${count}</td>
                    <td>${item.c_name}</td>
					<td>${item.dc_hsn}</td>
					<td>${item.c_part_no}</td>                    
                    <td>${helper.number(item.dc_qty)}</td>
                    <td>${item.dc_rate}</td>
                    <td>${item.units_name}</td>
                    <td>${total_row_value}</td>
                </tr>
				`;
        count = count + 1;
        sum_total_amt += total_row_value;
      });

      if (stmt4.length == count - 1) {
        let jsonData_terms = JSON.parse(stmt4[0].dc_pass_terms);
        let jsonData_log = JSON.parse(stmt4[0].dc_log);

        let data = {
          //
          bill_from_company: bill_from_company,
          bill_from_address: bill_from_address,
          bill_from_gstin: bill_from_gstin,
          bill_from_cin: bill_from_cin,
          bill_from_pan: bill_from_pan,
          bill_from_statename: bill_from_statename,
          bill_from_statecode: bill_from_statecode,
          //
          ship_to_vendor: vendor_name,
          ship_to_address: vendor_address,
          ship_to_gstin: vendor_gstin,
          ship_to_panno: vendor_panno,
          ship_to_statename: vendor_statename,
          ship_to_statecode: "--",
          //
          bill_to_vendor: vendor_name,
          bill_to_address: vendor_address,
          bill_to_gstin: vendor_gstin,
          bill_to_panno: vendor_panno,
          bill_to_statename: vendor_statename,
          bill_to_statecode: "--",
          //
          transaction_id: stmt4[0].dc_transaction,
          transaction_dt: moment(jsonData_log.insert_date).format("DD-MM-YYYY"),
          reference_no_dt: jsonData_terms.references_no,
          terms_of_payment: jsonData_terms.terms_of_payment,
          other_references: jsonData_terms.other_references,
          buyer_order_no: jsonData_terms.buyer_ord_no,
          buyer_order_date: "--",
          dispatch_doc_no: jsonData_terms.dispatch_doc_no,
          dispatch_through: jsonData_terms.dispatched_through,
          destination: jsonData_terms.destination,
          vehicle_no: jsonData_terms.vehicle_no,
          terms_of_delivery: jsonData_terms.terms_of_delivery,
          narration: jsonData_terms.narration,
          //
          sum_total_amt: sum_total_amt,
          sum_total_amt_in_word: helper.amount_to_word(sum_total_amt) + " Only",
        };

        let html = GPHtml.GPPrintHtml(data, items_data);

        let fileName =
          "GATEPASS-" + data.transaction_id.replace(/\//g, "_") + ".pdf";

        let options = {
          format: "A4",
          margin: { top: "5px", bottom: "10px", left: "10px", right: "10px" },
        };
        let file = { content: html };
        htmlToPdf
          .generatePdf(file, options)
          .then((pdfBuffer) => {
            return res.json({
              status: "success",
              success: true,
              message: "File generated successfully.",
              data: { buffer: pdfBuffer, filename: fileName },
            });
          })
          .catch((err) => {
            return res.json({
              status: "error",
              success: false,
              message: "An error occurred while generating file.",
              debug:
                process.env.NODE_ENV === "development" ? err.stack : undefined,
            });
          });
      }
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// PRINT GATEPASS (GP)
router.post("/printGP", async (req, res) => {
  try {
    let file = {
      url: `${process.env.API_URL}/helper/PRINT/PHP/GP/printGp.php?journal=${req.body.transaction}`,
    };
    let options = { format: "A4" };

    htmlToPdf
      .generatePdf(file, options)
      .then((pdfBuffer) => {
        return res.json({
          status: "success",
          success: true,
          message: "File generated successfully.",
          data: {
            buffer: pdfBuffer,
            filename: "GP" + req.body.transaction + ".pdf",
          },
        });
      })
      .catch((err) => {
        return res.json({
          status: "error",
          success: false,
          message: "Error while generating file.",
          debug: process.env.NODE_ENV === "development" ? err.stack : undefined,
        });
      });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//UPDATE GATEPASS
router.post("/fetchData4Update", [auth.isAuthorized], async (req, res) => {
  const po_transaction = req.body.gpcode;
  const validation = new Validator(req.body, {
    gpcode: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }

  try {
    material = [];
    const result = await invtDB.query(
      "SELECT *, `ims_dc_challan`.`ID` AS `rowID` FROM `ims_dc_challan` LEFT JOIN `components` ON `components`.`component_key` = `ims_dc_challan`.`component` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `ims_dc_challan`.`dc_transaction` = :transaction AND `ims_dc_challan`.`company_branch` = :branch",
      {
        replacements: {
          transaction: po_transaction,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      let jsonData_vendor = JSON.parse(result[0].dc_vendor_details);
      let jsonData_warehouse = JSON.parse(result[0].dc_bill_from);
      let jsonData_other = JSON.parse(result[0].dc_pass_terms);

      //GP TYPE
      let gp_type_option = "";
      if (result[0].dc_type == "R") {
        gp_type_option =
          "<option value='R' selected>RGP (RETURNABLE GATE PASS)</option><option value='N' disabled>NRGP (NON-RETURNABLE GATE PASS)</option>";
      } else {
        gp_type_option =
          "<option value='R'>RGP (RETURNABLE GATE PASS)</option><option value='N' selected disabled>NRGP (NON-RETURNABLE GATE PASS)</option>";
      }
      //FETCH VENDOR
      let vendor_name = await invtDB.query(
        "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor_code",
        {
          replacements: { vendor_code: jsonData_vendor.vendor_code },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let selectedVendor = "--";
      if (vendor_name.length > 0) {
        selectedVendor = {
          value: vendor_name[0].ven_register_id,
          label: vendor_name[0].ven_name,
        };
      } else {
        selectedVendor = { value: "--", label: "N/A" };
      }

      // FETCH VENDOR ADDRESS AND BRANCH
      let vendor_address = await invtDB.query(
        "SELECT * FROM `ven_basic_detail` LEFT JOIN `ven_address_detail` ON `ven_basic_detail`.`ven_register_id` = `ven_address_detail`.`ven_id` WHERE `ven_address_detail`.`ven_address_id` = :branchcode",
        {
          replacements: { branchcode: jsonData_vendor.vendor_branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let vendor_branch_code,
        vendor_branch_label,
        vendor_fulladdress,
        vendor_gst_in,
        vendor_panno;
      vendor_fulladdress = jsonData_vendor.vendor_address;
      if (vendor_address.length == 0) {
        vendor_branch_code = "N/A";
        vendor_gst_in = "N/A";
        vendor_panno = "N/A";
      } else {
        vendor_branch_code = vendor_address[0].ven_address_id;
        vendor_branch_label = vendor_address[0].ven_add_label;
        vendor_gst_in = vendor_address[0].ven_add_gst;
        vendor_panno = vendor_address[0].ven_pan_no;
      }

      //FETCH WAREHOUSE ADDRESS
      let selectedWareHouse,
        warehouse_branch_code,
        warehouse_branch_label,
        warehouse_address,
        warehouse_gst_in,
        warehouse_panno;
      let warehouse = await invtDB.query(
        "SELECT * FROM `billing_address` WHERE `billing_code`= :warehouse_code",
        {
          replacements: { warehouse_code: jsonData_warehouse.bill_from_code },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      warehouse_address = jsonData_warehouse.bill_from_address;

      if (warehouse.length > 0) {
        selectedWareHouse = {
          value: warehouse[0].billing_code,
          label: warehouse[0].billing_lable,
        };
        warehouse_branch_code = warehouse[0].billing_code;
        warehouse_branch_label = warehouse[0].billing_lable;
        warehouse_gst_in = warehouse[0].billing_gstno;
        warehouse_panno = warehouse[0].billing_pan;
      } else {
        selectedWareHouse = { value: "--", label: "N/A" };
        warehouse_branch_code = "--";
        warehouse_branch_label = "N/A";
        warehouse_gst_in = "N/A";
        warehouse_panno = "N/A";
      }

      //FETCH COMPONENT DETAILS
      result.map(async (element) => {
        const originalQty = parseFloat(element.dc_qty || 0);
        const returnedQty = parseFloat(element.return_inward_qty || 0);
        const pendingQty = parseFloat((originalQty - returnedQty).toFixed(4));
        material.push({
          serial_no: element.rowID,
          selectedComponent: [
            {
              id: element.component_key,
              text: element.c_name + " ( " + element.c_part_no + " )",
            },
          ],
          unit: element.units_name,
          hsn_code: element.dc_hsn,
          rate: element.dc_rate,
          qty: element.dc_qty,
          returned_qty: returnedQty,
          pending_qty: pendingQty < 0 ? 0 : pendingQty,
          remark: element.dc_remark,
          total: (element.dc_qty * element.dc_rate).toFixed(2),
        });

        vendor = {
          vendor: selectedVendor,
          vendor_address: vendor_fulladdress,
          vendor_gst_in: vendor_gst_in,
          vendor_panno: vendor_panno,
          branch: {
            vendor_branch: vendor_branch_code,
            vendor_branch_lable: vendor_branch_label,
          },
        };

        warehouse = {
          warehouse: selectedWareHouse,
          warehouse_address: warehouse_address,
          warehouse_gst_in: warehouse_gst_in,
          warehouse_panno: warehouse_panno,
        };

        other_details = {
          terms_of_payment: jsonData_other.terms_of_payment,
          references_no: jsonData_other.references_no,
          buyer_ord_no: jsonData_other.buyer_ord_no,
          dispatch_doc_no: jsonData_other.dispatch_doc_no,
          other_references: jsonData_other.other_references,
          dispatched_through: jsonData_other.dispatched_through,
          destination: jsonData_other.destination,
          terms_of_delivery: jsonData_other.terms_of_delivery,
          vehicle_no: jsonData_other.vehicle_no,
          narration: jsonData_other.narration,
        };

        if (material.length == result.length) {
         res.json({
            success: true,
            status: "success",
            data: { rgp_challan_no: result[0].dc_transaction, gp_type: gp_type_option, material: material, vendor: vendor, other: other_details, warehouse: warehouse },
          });
          return;
        }
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No GP found.",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
  // next();
});

// UPDATE DC
router.post("/updateDc", [auth.isAuthorized], async (req, res) => {
  var vendor = req.body.vendor;
  var bill = req.body.bill;
  var other = req.body.other;
  var material = req.body.material;

  let gpValid = new Validator(req.body, {
    gp: "required",
  });
  if (gpValid.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Validation failed",
      data: gpValid.errors.all(),
    });
  }

  let validation_vendor = new Validator(vendor, {
    passtype: "required",
    vendorname: "required",
    vendorbranch: "required",
    vendoraddress: "required",
  });
  if (validation_vendor.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Validation failed",
      data: validation_vendor.errors.all(),
    });
  }

  let validation_bill = new Validator(bill, {
    billaddressid: "required",
    billaddress: "required",
  });
  if (validation_bill.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Validation failed",
      data: validation_bill.errors.all(),
    });
  }

  const toFindDublicates = (arry) =>
    arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(material.component);
  if (dubliEle.length > 0) {
    return res.json({
      status: "error",
      success: false,
      message: "You have entered the same component twice in a single request.",
    });
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
      return res.json({
        status: "error",
        success: false,
        message: "Validation failed",
        data: validation_material.errors.all(),
      });
    }
  }

  // if (sumOfChallanValue > helper.number(49999)) {
  // 	return res.json({ status: "error", success: false, message: "You can't create the challan if total amount will equal to OR exceed 50K" });
  // }

  const t = await invtDB.transaction();

  try {
    if (other.vehicle_no == "") {
      t.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Vehicle No is required.",
      });
    }
    const transactionID = req.body.gp;

    for (let i = 0; i < itemLength; i++) {
      let stmt = await invtDB.query(
        "SELECT * FROM `ims_dc_challan` WHERE `ID` = :row AND dc_transaction = :dc_Id AND `company_branch` = :branch",
        {
          replacements: {
            row: material.serial[i],
            dc_Id: transactionID,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt.length > 0) {
        if (helper.number(material.qty[i]) > 0) {
          // UPDATE
          let update_stmt = await invtDB.query(
            "UPDATE `ims_dc_challan` SET `dc_type` = :dc_type,`trans_type` = :trans_type, `dc_vendor_details` = :dc_vendor_details, `dc_pass_terms` = :dc_pass_terms, `dc_bill_from` = :dc_bill_from, `dc_qty` = :dc_qty , `dc_rate` = :dc_rate, `dc_hsn` = :dc_hsn , `dc_remark` = :dc_remark, `dc_log` = :dc_log, `component` = :component WHERE `ims_dc_challan`.`dc_transaction` = :transaction AND `ims_dc_challan`.`ID` = :row",
            {
              replacements: {
                transaction: transactionID,
                dc_type: vendor.passtype,
                trans_type: req.body.trans_type,
                dc_vendor_details: JSON.stringify({
                  vendor_code: vendor.vendorname,
                  vendor_branch: vendor.vendorbranch,
                  vendor_address: vendor.vendoraddress.replace(/\n/g, "<br>"),
                }),
                dc_pass_terms: JSON.stringify({
                  terms_of_payment:
                    other.terms_of_payment == ""
                      ? "--"
                      : other.terms_of_payment,
                  references_no:
                    other.reference_no_dt == "" ? "--" : other.reference_no_dt,
                  other_references:
                    other.other_reference == "" ? "--" : other.other_reference,
                  buyer_ord_no:
                    other.buyer_order_no == "" ? "--" : other.buyer_order_no,
                  dispatch_doc_no:
                    other.dispatch_doc_no == "" ? "--" : other.dispatch_doc_no,
                  dispatched_through:
                    other.dispatch_through == ""
                      ? "--"
                      : other.dispatch_through,
                  destination:
                    other.destination == "" ? "--" : other.destination,
                  terms_of_delivery:
                    other.terms_of_delivery == ""
                      ? "--"
                      : other.terms_of_delivery,
                  narration: other.narration == "" ? "--" : other.narration,
                  vehicle_no: other.vehicle_no == "" ? "--" : other.vehicle_no,
                }),
                dc_bill_from: JSON.stringify({
                  bill_from_code: bill.billaddressid,
                  bill_from_address: bill.billaddress.replace(/\n/g, "<br>"),
                }),
                row: material.serial[i],
                component: material.component[i],
                dc_qty: material.qty[i],
                dc_rate: material.rate[i],
                dc_hsn: material.hsncode[i] == "" ? "--" : material.hsncode[i],
                dc_remark: material.remark[i] == "" ? "--" : material.remark[i],
                dc_log: JSON.stringify({
                  insert_by: JSON.parse(stmt[0].dc_log).insert_by,
                  insert_date: JSON.parse(stmt[0].dc_log).insert_date,
                  update_by: req.logedINUser,
                  update_date: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm:ss"),
                }),
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: t,
            }
          );
        } else {
          // INSERT
          let insert_stmt = await invtDB.query(
            "INSERT INTO `ims_dc_challan` (`company_branch`,`dc_transaction`, `dc_type`, `trans_type`, `dc_vendor_details`, `dc_pass_terms`, `dc_bill_from`, `component`, `dc_qty`, `dc_rate`, `dc_hsn`, `dc_remark`,`dc_log`) VALUES (:branch,:transaction, :dc_type, :trans_type, :dc_vendor_details, :dc_pass_terms, :dc_bill_from, :component, :dc_qty, :dc_rate, :dc_hsn, :dc_remark,:dc_log)",
            {
              replacements: {
                branch: req.branch,
                transaction: transactionID,
                dc_type: vendor.passtype,
                trans_type: req.body.trans_type,
                dc_vendor_details: JSON.stringify({
                  vendor_code: vendor.vendorname,
                  vendor_branch: vendor.vendorbranch,
                  vendor_address: vendor.vendoraddress.replace(/\n/g, "<br>"),
                }),
                dc_pass_terms: JSON.stringify({
                  terms_of_payment:
                    other.terms_of_payment == ""
                      ? "--"
                      : other.terms_of_payment,
                  references_no:
                    other.reference_no_dt == "" ? "--" : other.reference_no_dt,
                  other_references:
                    other.other_reference == "" ? "--" : other.other_reference,
                  buyer_ord_no:
                    other.buyer_order_no == "" ? "--" : other.buyer_order_no,
                  dispatch_doc_no:
                    other.dispatch_doc_no == "" ? "--" : other.dispatch_doc_no,
                  dispatched_through:
                    other.dispatch_through == ""
                      ? "--"
                      : other.dispatch_through,
                  destination:
                    other.destination == "" ? "--" : other.destination,
                  terms_of_delivery:
                    other.terms_of_delivery == ""
                      ? "--"
                      : other.terms_of_delivery,
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
                  insert_date: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm:ss"),
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
    }
    await t.commit();
    return res.json({
      status: "success",
      success: true,
      message: "Update Successful.",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//fetch deleivery challan fro ewaybill

router.post("/fetch_dc", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    challan_no: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      success: false,
      message: "Something is missing in the form fields.",
      data: validation.errors.all(),
    });
  }

  try {
    const stmt = await invtDB.query(
      `SELECT dc.*, dc.ID AS row_id, 
              c.component_key, c.c_name, c.c_part_no, c.c_specification, 
              u.units_name 
       FROM ims_dc_challan dc 
       LEFT JOIN components c ON dc.component = c.component_key 
       LEFT JOIN units u ON c.c_uom = u.units_id 
       WHERE dc.dc_transaction = :challan_no`,
      {
        replacements: { challan_no: req.body.challan_no },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length === 0) {
      return res.json({
        status: "error",
        success: false,
        success: false,
        message: "Unable to fetch any delivery challan transaction.",
      });
    }

    const dcData = stmt[0];

    const billFromDetails = dcData.dc_bill_from
      ? JSON.parse(dcData.dc_bill_from)
      : {};
    const vendorDetails = dcData.dc_vendor_details
      ? JSON.parse(dcData.dc_vendor_details)
      : {};

    const billingAddr = await invtDB.query(
      "SELECT * FROM billing_address WHERE billing_code = :billingcode",
      {
        replacements: { billingcode: billFromDetails.bill_from_code || "" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const stmtBillingState = await invtDB.query(
      "SELECT * FROM state_code WHERE state_code = :code",
      {
        replacements: {
          code: billingAddr.length > 0 ? billingAddr[0].billing_state : "",
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    const stmtVenDetail = await invtDB.query(
      "SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor_id ",
      {
        replacements: { vendor_id: vendorDetails.vendor_code || "" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let stmtVenBranch = [];
    if (stmtVenDetail.length > 0) {
      stmtVenBranch = await invtDB.query(
        "SELECT * FROM ven_address_detail WHERE ven_address_id = :address_id",
        {
          replacements: { address_id: vendorDetails.vendor_branch || "" },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let vendorAddress =
      stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_address : "";

    let stmtVenState = [];
    if (stmtVenBranch.length > 0 && stmtVenBranch[0].ven_state) {
      stmtVenState = await invtDB.query(
        "SELECT * FROM state_code WHERE state_code = :code",
        {
          replacements: { code: stmtVenBranch[0].ven_state },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    const dispatchAddr = await invtDB.query(
      "SELECT * FROM dispatch_address WHERE dispatch_code = :dispatchcode",
      {
        replacements: { dispatchcode: dcData.company_branch || "" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let stmtDispatchState = [];
    if (dispatchAddr.length > 0 && dispatchAddr[0].dispatch_state_code) {
      stmtDispatchState = await invtDB.query(
        "SELECT * FROM state_code WHERE state_code = :code",
        {
          replacements: { code: dispatchAddr[0].dispatch_state_code },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    const items = stmt.map((row) => ({
      ID: row.row_id,
      component_name: row.c_name || "Unknown Component",
      component_description: row.c_specification || "",
      part_no: row.c_part_no || "",
      qty: row.dc_qty || "0",
      rate: row.dc_rate.trim("\t") || "0",
      unit_name: row.units_name || "",
      hsn_code: row.dc_hsn || "",
      taxable_amount: ((row.dc_rate || 0) * (row.dc_qty || 0)).toFixed(3),
      remarks: row.dc_remark || "",
    }));
    // Construct response

    const passTerms = dcData.dc_pass_terms
      ? JSON.parse(dcData.dc_pass_terms)
      : {};
    const response = {
      status: "success",
      success: true,
      success: true,
      message: "Delivery Challan Details Fetched Successfully.",
      data: {
        challan_id: dcData.dc_transaction,
        dc_type: dcData.dc_type || "Delivery Challan",
        supplyType: "Outward",
        subSupplyType: dcData.trans_type || "Unknown",
        docType: "Delivery Challan",
        bill_from: {
          legalName:
            billingAddr.length > 0
              ? billingAddr[0].billing_company
              : billFromDetails.bill_from_address || "Unknown Company",
          gstin: billingAddr.length > 0 ? billingAddr[0].billing_gstno : "",
          state: {
            state_code:
              stmtBillingState.length > 0 ? stmtBillingState[0].state_code : "",
            state_name:
              stmtBillingState.length > 0 ? stmtBillingState[0].state_name : "",
          },
          location: billingAddr.length > 0 ? billingAddr[0].billing_city : "",
          address1:
            billingAddr.length > 0
              ? billingAddr[0].billing_address
              : billFromDetails.bill_from_address || "",
          address2: "",
          pincode: billingAddr.length > 0 ? billingAddr[0].billing_pin : "",
        },
        bill_to: {
          client:
            stmtVenDetail.length > 0
              ? stmtVenDetail[0].ven_name
              : vendorDetails.ven_name || "Unknown Vendor",
          gst: stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_add_gst : "",
          state: {
            state_code:
              stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_state : "",
            state_name:
              stmtVenState.length > 0 ? stmtVenState[0].state_name : "",
          },
          location:
            stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_add_label : "",
          address1: vendorAddress,
          address2: "",
          pincode: stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_pincode : "",
        },
        ship_from: {
          legalName:
            dispatchAddr.length > 0 ? dispatchAddr[0].dispatch_company : "",
          gst: dispatchAddr.length > 0 ? dispatchAddr[0].dispatch_gstin : "",
          state: {
            state_code:
              dispatchAddr.length > 0
                ? dispatchAddr[0].dispatch_state_code
                : "",
            state_name:
              stmtDispatchState.length > 0
                ? stmtDispatchState[0].state_name
                : "",
          },
          address1:
            dispatchAddr.length > 0 ? dispatchAddr[0].dispatch_address : "",
          address2: "",
          pincode:
            dispatchAddr.length > 0 ? dispatchAddr[0].dispatch_pincode : "",
        },
        ship_to: {
          company:
            stmtVenDetail.length > 0
              ? stmtVenDetail[0].ven_name
              : vendorDetails.ven_name || "Unknown Vendor",
          gst: stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_add_gst : "",
          state: {
            state_code:
              stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_state : "",
            state_name:
              stmtVenState.length > 0 ? stmtVenState[0].state_name : "",
          },
          address1: vendorAddress,
          address2: "",
          pincode: stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_pincode : "",
        },
        total_amount: items
          .reduce((sum, item) => sum + Number(item.taxable_amount), 0)
          .toFixed(3),
        dc_status: dcData.dc_status,
        vehicle: passTerms.vehicle_no || "--",
      },
      items: items,
    };

    return res.json(response);
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

router.post("/fetchReturnableItems", [auth.isAuthorized], async (req, res) => {

  const transactionRef = req.body.gp || req.body.gpcode || req.body.transaction;

  const validation = new Validator(
    { gp: transactionRef },
    { gp: "required" }
  );
  if (validation.fails()) {
    return res.json({ success: false, message:"something you missing in form field to supply", data: validation.errors.all(), status: "error" });
  }

  try {
    const stmt = await invtDB.query(
      `SELECT
          dc.ID AS row_id,
          dc.dc_transaction,
          dc.dc_type,
          dc.dc_status,
          dc.component,
          dc.dc_qty,
          dc.return_inward_qty,
          dc.dc_rate,
          dc.dc_hsn,
          dc.dc_remark,
          dc.dc_vendor_details,
          dc.dc_log,
          c.c_part_no,
          c.c_name,
          u.units_name
        FROM ims_dc_challan dc
        LEFT JOIN components c ON c.component_key = dc.component
        LEFT JOIN units u ON u.units_id = c.c_uom
        WHERE dc.dc_transaction = :transaction AND dc.company_branch = :branch
        ORDER BY dc.ID ASC`,
      {
        replacements: { transaction: transactionRef, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length === 0) {
      return res.json({ success: false, message: { msg: "no gate pass found against the given transaction id" }, status: "error" });
    }

    let vendorName = "--";
    try {
      const vendorDetails = JSON.parse(stmt[0].dc_vendor_details);
      const ven = await invtDB.query("SELECT `ven_name`, `ven_register_id` FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor_code", {
        replacements: { vendor_code: vendorDetails.vendor_code },
        type: invtDB.QueryTypes.SELECT,
      });
      if (ven.length > 0) {
        vendorName = ven[0].ven_name + " (" + ven[0].ven_register_id + ")";
      }
    } catch (e) {
      vendorName = "--";
    }

    const items = stmt.map((row) => {
      const originalQty = parseFloat(row.dc_qty || 0);
      const returnedQty = parseFloat(row.return_inward_qty || 0);
      const pendingQty = parseFloat((originalQty - returnedQty).toFixed(4));
      return {
        row_id: row.row_id,
        component_key: row.component,
        component_name: row.c_name || "--",
        part_no: row.c_part_no || "--",
        unit: row.units_name || "--",
        hsn: row.dc_hsn || "--",
        rate: parseFloat(row.dc_rate || 0).toFixed(2),
        original_qty: originalQty,
        returned_qty: returnedQty,
        pending_qty: pendingQty < 0 ? 0 : pendingQty,
        remark: row.dc_remark || "--",
      };
    });

    return res.json({
      success: true,
      status: "success",
      response: {
        transaction: stmt[0].dc_transaction,
        vendor_name: vendorName,
        items: items,
      },
    });
  } catch (err) {
    return res.json({ success: false, message:"Internal Error<br/>If this condition persists, contact your system administrator", status: "error", error: err.stack });
  }
});




// 2) CREATE A RETURN AGAINST A GATE PASS
router.post("/createReturn",[auth.isAuthorized], async (req, res) => {
  // `gp` / `transaction` is the actual gate pass this return is against -- this is what gets
  // looked up AND what gets saved as `rgp_challan_no` on the return record.
  const transactionRef = req.body.gp || req.body.transaction;
  const other = req.body.other || {};
  const material = req.body.material;

  const validation = new Validator(
    { gp: transactionRef },
    { gp: "required" }
  );
  if (validation.fails()) {
    return res.json({ success: false, message: "something you missing in form field to supply", data: validation.errors.all(), status: "error" });
  }

  if (!material || !Array.isArray(material.row_id) || material.row_id.length === 0) {
    return res.json({ success: false, message:"at least one item is required to create a return", status: "error" });
  }

  const toFindDublicates = (arry) => arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(material.row_id);
  if (dubliEle.length > 0) {
    return res.json({ success: false, message:  "You have entered a same item twice of time in a single request", status: "error" });
  }

  const itemLength = material.row_id.length;
  for (let i = 0; i < itemLength; i++) {
    const validation_material = new Validator(
      { row_id: material.row_id[i], qty: material.qty[i] },
      { row_id: "required", qty: "required|min:1" }
    );
    if (validation_material.fails()) {
      return res.json({ success: false, message: validation_material.errors.all(), status: "error" });
    }
  }

  const t = await invtDB.transaction();

  try {
    // fetch original gate pass rows this return is against
    const originalRows = await invtDB.query("SELECT * FROM `ims_dc_challan` WHERE `dc_transaction` = :transaction AND `company_branch` = :branch", {
      replacements: { transaction: transactionRef, branch: req.branch },
      type: invtDB.QueryTypes.SELECT,
    });

    if (originalRows.length === 0) {
      t.rollback();
      return res.json({ success: false, message: "no gate pass found against the given transaction id [" + transactionRef + "]" , status: "error" });
    }

    const originalRowsById = {};
    originalRows.forEach((row) => {
      originalRowsById[row.ID] = row;
    });

    // generate the new return transaction number
    let stmt = await invtDB.query("SELECT * FROM `ims_numbering` WHERE `for_number` = 'REGP'", { type: invtDB.QueryTypes.SELECT });
    await invtDB.query("UPDATE `ims_numbering` SET `suffix` = `suffix`+1 WHERE `for_number` = 'REGP'", { transaction: t, type: invtDB.QueryTypes.UPDATE });

    let returnTransactionID;
    if (stmt.length > 0) {
      let suffix = parseInt(stmt[0].suffix) + 1;
      suffix = suffix.toString().padStart(parseInt(stmt[0].number_length_limit), "0");
      returnTransactionID = stmt[0].prefix + "/" + stmt[0].session + "/" + suffix;
    } else {
      let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
      returnTransactionID = "RTN/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    const dup = await invtDB.query("SELECT `return_transaction` FROM `ims_gatepass_return` WHERE `return_transaction` = :transaction LIMIT 1", {
      replacements: { transaction: returnTransactionID },
      type: invtDB.QueryTypes.SELECT,
    });
    if (dup.length > 0) {
      t.rollback();
      return res.json({
        success: false,
        message: "alloting transaction id as [" + returnTransactionID + "] for gate pass return has already exist with us, required manual checking or contact to system administrator.",
        status: "error",
      });
    }

    for (let i = 0; i < itemLength; i++) {
      const rowId = material.row_id[i];
      const returnQty = helper.number(material.qty[i]);
      const originalRow = originalRowsById[rowId];

      if (!originalRow) {
        t.rollback();
        return res.json({ success: false, message: "item [" + rowId + "] does not belong to the gate pass [" + transactionRef + "]" , status: "error" });
      }

      const pendingQty = helper.number(originalRow.dc_qty) - helper.number(originalRow.return_inward_qty || 0);

      if (returnQty <= 0) {
        t.rollback();
        return res.json({ success: false, message:"return qty must be greater than 0", status: "error" });
      }
      if (returnQty > pendingQty) {
        t.rollback();
        return res.json({
          success: false,
          message: "you can return maximum [" + pendingQty + "] qty for component [" + originalRow.component + "], requested [" + returnQty + "]" ,
          status: "error",
        });
      }

      await invtDB.query(
        "INSERT INTO `ims_gatepass_return` (`txn_session`,`company_branch`,`return_transaction`,`rgp_challan_no`,`ref_row_id`,`component`,`return_qty`,`return_rate`,`return_hsn`,`return_remark`,`return_log`) VALUES (:txn_session,:branch,:return_transaction,:rgp_challan_no,:ref_row_id,:component,:return_qty,:return_rate,:return_hsn,:return_remark,:return_log)",
        {
          replacements: {
            txn_session: helper.generateTxnSession(),
            branch: req.branch,
            return_transaction: returnTransactionID,
            rgp_challan_no: transactionRef,
            ref_row_id: rowId,
            component: originalRow.component,
            return_qty: material.qty[i],
            return_rate: originalRow.dc_rate,
            return_hsn: originalRow.dc_hsn || "--",
            return_remark: (material.remark && material.remark[i]) || "--",
            return_log: JSON.stringify({
              insert_by: req.logedINUser,
              insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
              narration: other.narration || "--",
              vehicle_no: other.vehicle_no || "--",
            }),
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        }
      );

      // keep the original gate pass line item's running "return_inward_qty" in sync
      await invtDB.query(
        "UPDATE `ims_dc_challan` SET `return_inward_qty` = CAST(COALESCE(`return_inward_qty`, 0) AS DECIMAL(18,4)) + CAST(:qty AS DECIMAL(18,4)) WHERE `ID` = :row_id",
        {
          replacements: { qty: material.qty[i], row_id: rowId },
          type: invtDB.QueryTypes.UPDATE,
          transaction: t,
        }
      );
    }

    await t.commit();
    return res.json({ success: true, message: "Gate Pass Return Generated : RefID: " + returnTransactionID, status: "success", data: { txn: returnTransactionID } });
  } catch (err) {
    console.log()
    t.rollback();
    return res.json({ success: false, status: "error", message: "internally something happend wrong, contact to administrator" , error: err.stack });
  }
});

// 3) FETCH ALL GATE PASS RETURNS (datewise / vendorwise)
router.post("/fetchAllReturns", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });
  if (validation.fails()) {
    return res.json({ success: false, message:"something you missing in form field to supply" , data: validation.errors.all(), status: "error" });
  }

  try {
    let stmt = [];
    const baseSelect = `SELECT
          ven.ven_name, ven.ven_register_id,
          r.ID AS return_row_id,
          r.return_transaction,
          r.rgp_challan_no,
          r.ref_row_id,
          r.component,
          r.return_qty,
          r.return_rate,
          r.return_hsn,
          r.return_remark,
          r.return_status,
          r.return_log,
          c.c_part_no,
          c.c_name,
          u.units_name
        FROM ims_gatepass_return r
        LEFT JOIN ims_dc_challan dc ON dc.ID = r.ref_row_id
        LEFT JOIN ven_basic_detail ven ON ven.ven_register_id = JSON_UNQUOTE(JSON_EXTRACT(dc.dc_vendor_details, '$[0].vendor_code'))
        LEFT JOIN components c ON c.component_key = r.component
        LEFT JOIN units u ON u.units_id = c.c_uom`;

    if (searchBy == "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      if (!date || date.length < 2) {
        return res.json({ success: false, message:"invalid date range supplied" , status: "error" });
      }

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
      if (durationInMonths > 3) {
        return res.json({ status: "error", message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only", success: false });
      }

      stmt = await invtDB.query(
        `${baseSelect}
        WHERE (STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(r.return_log, '$[0].insert_date')), '%Y-%m-%d') BETWEEN :datefrom AND :dateto)
          AND r.return_status = 'ACTIVE'
          AND r.company_branch = :branch
        ORDER BY r.return_transaction DESC, r.ID DESC`,
        { replacements: { datefrom: fromdate, dateto: todate, branch: req.branch }, type: invtDB.QueryTypes.SELECT }
      );
    } else if (searchBy == "vendorwise") {
      stmt = await invtDB.query(
        `${baseSelect}
        WHERE r.return_status = 'ACTIVE'
          AND r.company_branch = :branch
          AND (ven.ven_name LIKE CONCAT('%', :vendor, '%') OR ven.ven_register_id LIKE CONCAT('%', :vendor, '%'))
        ORDER BY r.return_transaction DESC, r.ID DESC`,
        { replacements: { vendor: searchValue, branch: req.branch }, type: invtDB.QueryTypes.SELECT }
      );
    } else {
      return res.json({ success: false, message:"Please select valid filter method", status: "error" });
    }

    if (stmt.length === 0) {
      return res.json({ success: false, message:  "no gate pass return were found that match the given search criteria", status: "error" });
    }

    const finalResult = stmt.map((element, index) => {
      let insertDate = "--";
      try {
        insertDate = moment(JSON.parse(element.return_log).insert_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss");
      } catch (e) {
        insertDate = "--";
      }
      const lineTotal = (parseFloat(element.return_qty || 0) * parseFloat(element.return_rate || 0)).toFixed(2);

      return {
        serial_no: index + 1,
        return_date: insertDate,
        return_qty: parseFloat(element.return_qty || 0),
        rgp_challan_no: element.rgp_challan_no,
        item: element.c_name || "--",
        remarks: element.return_remark || "--",
        //
        insert_date: insertDate,
        return_transaction: element.return_transaction,
        against_transaction: element.rgp_challan_no,
        vendor_name: element.ven_name ? element.ven_name + " (" + element.ven_register_id + ")" : "--",
        part_no: element.c_part_no || "--",
        component_name: element.c_name || "--",
        component_key: element.component,
        quantity: parseFloat(element.return_qty || 0),
        rate: parseFloat(element.return_rate || 0).toFixed(2),
        unit: element.units_name || "--",
        hsn: element.return_hsn || "--",
        remark: element.return_remark || "--",
        line_total: lineTotal,
      };
    });

    return res.json({ success: true, status: "success", response: { data: finalResult, total_records: finalResult.length } });
  } catch (err) {
    console.log(err);
    return res.json({ success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator", status: "error", error: err.stack });
  }
});


router.post("/consolidatedReturnReport", [auth.isAuthorized], async (req, res) => {
  const vendor = req.body.vendor; // required -- vendor code or vendor name (partial match)
  const searchValue = req.body.data; // required -- "DD-MM-YYYY-DD-MM-YYYY"

  const validation = new Validator(req.body, {
    vendor: "required",
    data: "required",
  });
  if (validation.fails()) {
    return res.json({ success: false, message:"something you missing in form field to supply" , data: validation.errors.all(), status: "error" });
  }

  const ARCHIVE_CUTOFF_DATE = "2026-09-01"; // transactions before this date are archived and not served here

  try {
    const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    if (!date || date.length < 2) {
      return res.json({ success: false, message: "invalid date range supplied" , status: "error" });
    }

    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
    const durationInDays = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "days");
    if (durationInDays > 366) {
      return res.json({ status: "error", message: "We can provide you 1 year (366 days) data only", success: false });
    }

    if (fromdate < ARCHIVE_CUTOFF_DATE) {
      return res.json({
        success: false,
        message:"transaction before " + moment(ARCHIVE_CUTOFF_DATE, "YYYY-MM-DD").format("DD-MM-YYYY") + " is archived",
        status: "error",
      });
    }

    const vendorFilter = "AND (ven.ven_name LIKE CONCAT('%', :vendor, '%') OR ven.ven_register_id LIKE CONCAT('%', :vendor, '%'))";

    // OUTWARD side: every DC (gate pass) *created* inside the date range, for this vendor
    const outwardRows = await invtDB.query(
      `SELECT
          ven.ven_name,
          ven.ven_register_id,
          dc.component,
          c.c_part_no,
          c.c_name,
          u.units_name,
          SUM(CAST(dc.dc_qty AS DECIMAL(18,4))) AS total_outward
        FROM ims_dc_challan dc
        LEFT JOIN ven_basic_detail ven ON ven.ven_register_id = JSON_UNQUOTE(JSON_EXTRACT(dc.dc_vendor_details, '$[0].vendor_code'))
        LEFT JOIN components c ON c.component_key = dc.component
        LEFT JOIN units u ON u.units_id = c.c_uom
        WHERE dc.company_branch = :branch
          AND dc.dc_status = 'ACTIVE'
          AND (STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(dc.dc_log, '$[0].insert_date')), '%Y-%m-%d') BETWEEN :datefrom AND :dateto)
          ${vendorFilter}
        GROUP BY ven.ven_register_id, dc.component`,
      { replacements: { branch: req.branch, datefrom: fromdate, dateto: todate, vendor: vendor }, type: invtDB.QueryTypes.SELECT }
    );

    // RETURNED side: every return *created* inside the date range, for this vendor
    // (independent of when the original DC/gate pass was created)
    const returnedRows = await invtDB.query(
      `SELECT
          ven.ven_name,
          ven.ven_register_id,
          r.component,
          c.c_part_no,
          c.c_name,
          u.units_name,
          SUM(CAST(r.return_qty AS DECIMAL(18,4))) AS total_returned
        FROM ims_gatepass_return r
        LEFT JOIN ims_dc_challan dc ON dc.ID = r.ref_row_id
        LEFT JOIN ven_basic_detail ven ON ven.ven_register_id = JSON_UNQUOTE(JSON_EXTRACT(dc.dc_vendor_details, '$[0].vendor_code'))
        LEFT JOIN components c ON c.component_key = r.component
        LEFT JOIN units u ON u.units_id = c.c_uom
        WHERE r.company_branch = :branch
          AND r.return_status = 'ACTIVE'
          AND (STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(r.return_log, '$[0].insert_date')), '%Y-%m-%d') BETWEEN :datefrom AND :dateto)
          ${vendorFilter}
        GROUP BY ven.ven_register_id, r.component`,
      { replacements: { branch: req.branch, datefrom: fromdate, dateto: todate, vendor: vendor }, type: invtDB.QueryTypes.SELECT }
    );

    if (outwardRows.length === 0 && returnedRows.length === 0) {
      return res.json({ success: false, message: "no gate pass transaction were found that match the given search criteria", status: "error" });
    }

    // merge both sides keyed by vendor + component -- a component might have
    // outward activity, returned activity, or both within the given window
    const merged = {};
    const upsert = (row, field, qtyField) => {
      const key = row.ven_register_id + "|" + row.component;
      if (!merged[key]) {
        merged[key] = {
          ven_name: row.ven_name,
          ven_register_id: row.ven_register_id,
          c_name: row.c_name,
          c_part_no: row.c_part_no,
          units_name: row.units_name,
          total_outward: 0,
          total_returned: 0,
        };
      }
      merged[key][field] = parseFloat(row[qtyField] || 0);
    };
    outwardRows.forEach((row) => upsert(row, "total_outward", "total_outward"));
    returnedRows.forEach((row) => upsert(row, "total_returned", "total_returned"));

    const finalResult = Object.values(merged)
      .sort((a, b) => (a.ven_name || "").localeCompare(b.ven_name || "") || (a.c_name || "").localeCompare(b.c_name || ""))
      .map((element, index) => {
        const outward = parseFloat(element.total_outward || 0);
        const returned = parseFloat(element.total_returned || 0);
        return {
          serial_no: index + 1,
          vendor: element.ven_name ? element.ven_name + " (" + element.ven_register_id + ")" : "--",
          item: element.c_name || "--",
          part_no: element.c_part_no || "--",
          unit: element.units_name || "--",
          outward: outward,
          returned: returned,
          balance: parseFloat((outward - returned).toFixed(4)),
        };
      });

    return res.json({ success: true, status: "success",  data: finalResult, total_records: finalResult.length  });
  } catch (err) {
    return res.json({ success: false, message:"Internal Error<br/>If this condition persists, contact your system administrator", status: "error", error: err.stack });
  }
});

module.exports = router;

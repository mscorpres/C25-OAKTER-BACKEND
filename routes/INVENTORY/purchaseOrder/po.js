const express = require("express");
const router = express.Router();
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");


let { format } = require("timeago.js");

let { invtDB, otherDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const { encode, decode } = require("html-entities");

const helper = require("../../../helper/helper");

const Validator = require("validatorjs");

var XLSX = require("xlsx");
const multer = require("multer");
const path = require("path");
const html_to_pdf = require("html-pdf-node");
const poPermission = require("../../../middleware/poPermission");

// GET LOCATION FOR PO INWARD
router.post("/getLocationPOInMin", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE  `loc_all_key` = :location_key",
      {
        replacements: { location_key: "20220212151405" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      loc_options = [];
      stmt.map((item) => {
        str_arr = item.locations.split(",");
        str_arr.map(async (item2) => {
          let stmt2 = await invtDB.query(
            "SELECT location_key,loc_name FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
            {
              replacements: { location_defined: item2 },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (stmt2.length > 0) {
            stmt2.map(async (item3) => {
              loc_options.push({
                id: item3.location_key,
                text: item3.loc_name,
              });
            });
          }
          if (str_arr.length == loc_options.length) {
            return res.json({
              success: true,
              status: "success",
              data: { loc_options },
            });
          }
        });
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.post("/costCenter", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    let limit = 10;

    if (req.body.project_name) {
      stmt = await invtDB.query(
        `SELECT cc.* 
        FROM cost_center cc
        INNER JOIN project_master pm ON cc.cost_center_key = pm.project_costcenter
        WHERE pm.project_name = :project_name AND cc.cost_center_status = 'Y'
        ORDER BY cc.cost_center_name ASC`,
        {
          replacements: { project_name: req.body.project_name },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (req.body.search == "") {
      stmt = await invtDB.query(
        "SELECT * FROM `cost_center` WHERE `cost_center_status` = 'Y' ORDER BY `cost_center_name` ASC LIMIT :limit",
        {
          replacements: { limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT * FROM `cost_center` WHERE `cost_center_status` = 'Y' AND (`cost_center_short_name` LIKE :name OR `cost_center_name` LIKE :name OR `cost_center_key` LIKE :name) ORDER BY `cost_center_name` LIMIT :limit",
        {
          replacements: { name: `%${req.body.search}%`, limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({
          id: item.cost_center_key,
          text:
            item.cost_center_name + " (" + item.cost_center_short_name + ")",
        });

        if (stmt.length == final.length) {
          res.json({ success: true, data: final, message: null });
          return;
        }
      });
    } else {
      res.json([{ id: "0", text: "No Data Found" }]);
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.post("/fetchStatus4PO", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    purchaseOrder: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
    return;
  }

  try {
    let stmt1 = await invtDB.query(
      "SELECT `po_status`, `advance_payment` FROM `po_purchase_req` WHERE `po_transaction` = :purchase_order GROUP BY `po_transaction`",
      {
        replacements: {
          purchase_order: req.body.purchaseOrder,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt1.length > 0 && stmt1[0].po_status == "C") {
      res.json({
        success: false,
        message: "Purchase Order is already closed...",
        status: "success",
      });
      return;
    } else {
      res.json({
        success: true,
        data: {
          advPayment: stmt1.length > 0 ? stmt1[0].advance_payment : null,
        },
        status: "success",
      });
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//CREATE PURCHASE ORDER
router.post(
  "/createPO",
  [auth.isAuthorized, poPermission.checkPOPermission("create")],
  async (req, res) => {
    const validation = new Validator(req.body, {
      pocreatetype: "required",
      vendorname: "required",
      vendorbranch: "required",
      vendoraddress: "required",
      vendortype: "required",
      pocostcenter: "required",
      poproject_name: "required",
      po_raise_by: "required",
      advancePayment: "required",
      ship_type: "required|in:saved,vendor,manual",
    });

    if (validation.fails()) {
      res.json({
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
      return;
    }

    // Validate shipping details based on ship_type
    if (req.body.ship_type === "saved") {
      if (!req.body.shipaddressid) {
        res.json({
          success: false,
          message: "Please select shipping address for saved mode",
          status: "error",
        });
        return;
      }
    } else if (req.body.ship_type === "vendor") {
      if (!req.body.ship_vendor || !req.body.ship_vendor_branch) {
        res.json({
          success: false,
          message: "Please select shipping vendor and branch for vendor mode",
          status: "error",
        });
        return;
      }
    } else if (req.body.ship_type === "manual") {
      // For manual, no mandatory GST/PAN, but address is required
      if (!req.body.shipaddress || req.body.shipaddress.trim() === "") {
        res.json({
          success: false,
          message: "Please provide shipping address for manual entry",
          status: "error",
        });
        return;
      }
    }

    if (req.body.pocreatetype == "0") {
      res.json({
        success: false,
        message: "Please select PO type",
        status: "error",
      });
      return;
    }

    let supplementaryPo;
    if (req.body.pocreatetype == "S") {
      if (
        req.body.pocreatetype == undefined ||
        req.body.pocreatetype == null ||
        req.body.pocreatetype == ""
      ) {
        res.json({
          success: false,
          message: "Please select supplementary PO",
          status: "error",
        });
        return;
      } else {
        supplementaryPo = req.body.supplementaryPo;
      }
    } else {
      supplementaryPo = "--";
    }

    let itemLength = req.body.component.length;
    if (itemLength == 0) {
      res.json({
        success: false,
        message: "Please add item",
        status: "error",
      });
      return;
    }

    let itemCurrencys = [];
    for (let i = 0; i < itemLength; i++) {
      itemCurrencys.push(req.body.currency[i]);
    }

    let uniqueItemCurrencys = [...new Set(itemCurrencys)];
    if (uniqueItemCurrencys.length > 1) {
      res.json({
        success: false,
        message: "Please select same currency",
        status: "error",
      });
      return;
    }

    const toFindDublicates = (arry) =>
      arry.filter((item, index) => arry.indexOf(item) !== index);
    const dubliEle = toFindDublicates(req.body.component);

    if (dubliEle.length > 0) {
      res.json({
        success: false,
        message:
          "You have entered a same component twice of time in a single request",
        status: "error",
      });
      return;
    }

    let qtyWarnings = [];

    const componentKeys = req.body.component.filter((key) => key); // remove empty

    let componentNameMap = {};
    if (componentKeys.length > 0) {
      const componentDetails = await invtDB.query(
        "SELECT component_key, c_name, c_part_no FROM `components` WHERE component_key IN (:keys)",
        {
          replacements: { keys: componentKeys },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      componentDetails.forEach((comp) => {
        componentNameMap[comp.component_key] = {
          name: comp.c_name || "Unknown Component",
          part_no: comp.c_part_no || "",
        };
      });
    }

    // Now build warnings with readable names
    for (let i = 0; i < itemLength; i++) {
      const currentPOQty = Number(req.body.qty[i]) || 0;
      const executedQty = Number(req.body.exq_po_qty[i]) || 0;
      const projectQty = Number(req.body.project_qty[i]) || 0;
      const totalQtyAfterPO = currentPOQty + executedQty;

      if (totalQtyAfterPO > projectQty) {
        const compKey = req.body.component[i];
        const compInfo = componentNameMap[compKey] || {
          name: compKey,
          part_no: "",
        };
        const displayName = compInfo.part_no
          ? `${compInfo.part_no} - ${compInfo.name}`
          : compInfo.name;

        qtyWarnings.push({
          row: i + 1,
          component: compKey,
          component_name: displayName,
          poQty: currentPOQty,
          executedQty: executedQty,
          totalAfterPO: totalQtyAfterPO,
          projectQty: projectQty,
          excess: totalQtyAfterPO - projectQty,
          message: `Row ${
            i + 1
          } [${displayName}]: PO Qty (${currentPOQty}) + Executed Qty (${executedQty}) = ${totalQtyAfterPO} exceeds Project Qty (${projectQty}) by ${
            totalQtyAfterPO - projectQty
          } units`,
        });
      }
    }

    if (qtyWarnings.length > 0 && !req.body.confirmQtyExceed) {
      return res.json({
        success: false,
        message:
          "Quantity exceeds project requirement. Please confirm to proceed.",
        status: "warning",
        data: {
          warnings: qtyWarnings,
          requiresConfirmation: true,
        },
      });
    }

    for (let i = 0; i < itemLength; i++) {
      let itemValidation = new Validator(
        {
          item: req.body.component[i],
          qty: req.body.qty[i],
          rate: req.body.rate[i],
          exchangeCurr: req.body.currency[i],
          gst_rate: req.body.gstrate[i],
          gst_type: req.body.gsttype[i],
        },
        {
          item: "required",
          qty: "required|min:1",
          rate: "required",
          exchangeCurr: "required",
          gst_rate: "required",
          gst_type: [
            "required_if:gst_rate,!=,0",
            "required_if:gst_rate,!=,I",
            "required_if:gst_rate,!=,L",
          ],
        }
      );

      if (itemValidation.fails()) {
        res.json({
          success: false,
          message: helper.firstErrorValidatorjs(itemValidation),
          status: "error",
        });
        return;
      }

      if (
        !helper.preg_match(
          /^(0[1-9]|[1-2][0-9]|3[0-1])-(0[1-9]|1[0-2])-[0-9]{4}$/,
          req.body.duedate[i]
        ) &&
        req.body.duedate[i] != ""
      ) {
        res.json({
          success: false,
          message: "Please select valid due date in DD-MM-YYYY",
          status: "error",
        });
        return;
      }
    }

    if (req.body.pocostcenter == null) {
      res.json({
        success: false,
        message: "supply the PO cost center",
        status: "error",
      });
      return;
    }

    // START TRANSACTION
    const t = await invtDB.transaction();

    try {
      let new_create_po_no_value = await helper.genTransaction("CREATE_PO", t);

      let get_transaction_id = await invtDB.query(
        "SELECT `po_transaction` FROM `po_purchase_req` WHERE `po_transaction` = :transaction_id GROUP BY `po_transaction` LIMIT 1",
        {
          replacements: { transaction_id: new_create_po_no_value },
          transaction: t,
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (get_transaction_id.length > 0) {
        res.json({
          success: false,
          message:
            "alloting transaction id as [" +
            new_create_po_no_value +
            "] for PO has already exist with us, required manual checking or contact to system administrator.",
          status: "error",
        });
        return;
      }

      let check_billing_address = await invtDB.query(
        "SELECT * FROM `billing_address` WHERE `billing_code` = :code",
        {
          replacements: { code: req.body.billaddressid },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (check_billing_address.length <= 0) {
        res.json({
          success: false,
          message:
            "Vendor billing address not found, please add billing address first.",
          status: "error",
        });
        return;
      }

      let get_vendor_detail = await invtDB.query(
        "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendorid",
        {
          replacements: { vendorid: req.body.vendorname },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (get_vendor_detail.length <= 0) {
        res.json({
          success: false,
          message: "Vendor not found, please add vendor first.",
          status: "error",
        });
        return;
      }

      var vendor_code = get_vendor_detail[0].ven_register_id;
      var vendor_name = get_vendor_detail[0].ven_name;
      //msme check
      var isVenMsme = get_vendor_detail[0].ven_msme_status === "Y" ? "Y" : "N";

      let shipAddressId = "--";
      let shipAddress = req.body.shipaddress
        ? req.body.shipaddress.replace(/\n/g, " ")
        : "--";

      let shipVendorBranch = "--";
      let shipPartyName = "--";
      let shipGST = "--";
      let shipPAN = "--";

      if (req.body.ship_type === "saved") {
        shipAddressId = req.body.shipaddressid;
        shipVendorBranch = "--";
      } else if (req.body.ship_type === "vendor") {
        shipAddressId = req.body.ship_vendor.key;
        shipVendorBranch = req.body.ship_vendor_branch;
      } else if (req.body.ship_type === "manual") {
        shipAddressId = "--";
        shipVendorBranch = "--";

        // CAPTURE MANUAL SHIPPING DETAILS
        shipPartyName = req.body.partyName || "--";
        shipGST = req.body.shipGST || "--";
        shipPAN = req.body.shipPan || "--";
      }

      let tolerance, minTolerance, rowDetails;
      let AllDevisations = "";
      let approveStatus = "A";
      let pendingRemark = "--";
      let approveArr = [];

      for (let i = 0; i < itemLength; i++) {
        pendingRemark = "--";
        tolerance = ((req.body.rate_cap[i] * 1) / 100).toFixed(2);
        minTolerance = req.body.rate_cap[i] - tolerance;
        rowDetails = `PO Qty [${req.body.qty[i]}] | PO Rate [${req.body.rate[i]}] | BOM Rate [${req.body.rate_cap[i]}] | TOLERANCE [${tolerance}] | Project Req. QTY [${req.body.project_qty[i]}] | PO Executed [${req.body.exq_po_qty[i]}]`;
        AllDevisations += rowDetails + "\n";

        if (req.body.currency[i] == 364907247) {
          if (
            Number(req.body.qty[i]) >
            Number(req.body.project_qty[i]) - Number(req.body.exq_po_qty[i])
          ) {
            approveStatus = "P";
            pendingRemark = rowDetails + "\n: deviation in qty";
          }

          if (
            minTolerance > req.body.rate[i] ||
            req.body.rate[i] > req.body.rate_cap[i]
          ) {
            approveStatus = "P";
            pendingRemark = rowDetails + "\n: deviation in price";
          }

          if (
            (minTolerance > req.body.rate[i] ||
              req.body.rate[i] > req.body.rate_cap[i]) &&
            Number(req.body.qty[i]) >
              Number(req.body.project_qty[i]) - Number(req.body.exq_po_qty[i])
          ) {
            approveStatus = "P";
            pendingRemark = rowDetails + "\n: deviation in qty and price both";
          }
        } else {
          if (
            Number(req.body.qty[i]) >
            Number(req.body.project_qty[i]) - Number(req.body.exq_po_qty[i])
          ) {
            approveStatus = "P";
            pendingRemark = rowDetails + "\n: deviation in qty";
          }

          if (
            minTolerance > req.body.exchange[i] ||
            req.body.exchange[i] > req.body.rate_cap[i]
          ) {
            approveStatus = "P";
            pendingRemark = rowDetails + "\n: deviation in price";
          }

          if (
            (minTolerance > req.body.exchange[i] ||
              req.body.exchange[i] > req.body.rate_cap[i]) &&
            Number(req.body.qty[i]) >
              Number(req.body.project_qty[i]) - Number(req.body.exq_po_qty[i])
          ) {
            approveStatus = "P";
            pendingRemark = rowDetails + "\n: deviation in qty and price both";
          }
        }

        approveArr.push(approveStatus);

        if (req.body.remark[i].length > 250) {
          res.json({
            success: false,
            message:
              "supplied remark are too long!!! maximum character's allowed (250) only",
            status: "error",
          });
          return;
        }

        let check_currency = await invtDB.query(
          "SELECT `currency_id` FROM `ims_currency` WHERE `currency_id` = :currency",
          {
            replacements: { currency: req.body.currency[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (check_currency.length <= 0) {
          res.json({
            success: false,
            message: "currency either inactive or not exist in our records",
            status: "error",
          });
          return;
        }

        let check_item = await invtDB.query(
          "SELECT * FROM `components` WHERE `component_key` = :component_key",
          {
            replacements: { component_key: req.body.component[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (check_item.length > 0) {
          if (check_item[0].c_is_enabled == "N") {
            res.json({
              success: false,
              message: `component partcode ${
                check_item[0].c_part_no
              } / ${decode(
                check_item[0].c_name
              )} can not be execute bcz it has been disabled for transaction`,
              status: "error",
            });
            return;
          }
        } else {
          res.json({
            success: false,
            message: `some component can not be operate bcz of client issue please reload the browser OR contact to developer`,
            status: "error",
          });
          return;
        }

        let res1 = await invtDB.query(
          "INSERT INTO `po_purchase_req` (`advance_payment`,`payment_terms_day`,`approval_status`,`status_remark`,`company_branch`,`po_currency`,`po_exchange`,`po_supplementary`,`po_billing_id`,`po_billing_addr`,`po_ship_id`,`po_ship_address`,`po_ship_type`,`po_ship_vendor_branch`,`terms_condition`,`quotation_detail`,`payment_terms`,`po_vendor_type`,`po_vendor_reg_id`,`po_project_name`,`po_comment`,`po_vendor_name`,`po_ven_add_id`,`po_vendor_address`,`po_part_no`,`po_order_qty`,`po_order_rate`,`po_duedate`,`po_remark`, `internal_remark`,`po_insert_date`,`po_insert_by`,`po_full_date`,`po_transaction`,`po_hsncode`,`po_gsttype`,`po_gstrate`,`po_cgst`,`po_sgst`,`po_igst`,`po_pending_qty`,`po_cost_center`, po_raise_by,statusforporequest,ship_partyname, ship_other_pan, ship_other_gstin,isVenMsme) VALUES (:advancepayment,:termsdays,:approveStatus,:status_remark,:branch,:currency,:exchange,:supplementary,:bill_id,:bill_addr,:shipaddressid,:shipaddress,:ship_type,:shipvendorbranch,:termscondition,:quoationdetail,:paymentterms,:vendortype,:vendorid,:project_name,:po_comment,:vendorname,:vendorbranch,:vendoraddress,:part,:qty,:rate,:duedate,:remark, :internal_remark,:insertdate,:by,:fulldate,:transactionid,:hsncode,:gsttype,:gstrate,:cgst,:sgst,:igst,:qty,:cost_center , :po_raise_by, :statusforporequest ,:ship_partyname,:ship_other_pan,:ship_other_gstin,:isVenMsme)",
          {
            replacements: {
              advancepayment: req.body.advancePayment,
              termsdays:
                req.body.paymenttermsday == "" ? 30 : req.body.paymenttermsday,
              approveStatus: approveStatus,
              status_remark: pendingRemark,
              branch: req.branch,
              currency: req.body.currency[i],
              exchange:
                req.body.currency[i] == "364907247" ? 1 : req.body.exchange[i],
              supplementary: req.body.original_po ? req.body.original_po : "--",
              bill_id: req.body.billaddressid,
              bill_addr: req.body.billaddress.replace(/\n/g, " "),

              shipaddressid: shipAddressId,
              shipaddress: shipAddress,
              ship_type: req.body.ship_type,
              shipvendorbranch: shipVendorBranch,
              termscondition: req.body.termscondition
                ? req.body.termscondition
                : "--",
              quoationdetail: req.body.quotationdetail
                ? req.body.quotationdetail
                : "--",
              paymentterms: req.body.paymentterms
                ? req.body.paymentterms
                : "--",
              vendortype: req.body.vendortype,
              vendorid: vendor_code,
              project_name: req.body.poproject_name,
              po_comment: req.body.pocomment,
              internal_remark: req.body.internal_remark[i]
                ? req.body.internal_remark[i]
                : "",
              vendorname: vendor_name,
              vendorbranch: req.body.vendorbranch,
              vendoraddress: req.body.vendoraddress.replace(/\n/g, " "),
              part: req.body.component[i],
              qty: req.body.qty[i],
              rate: req.body.rate[i],
              duedate: req.body.duedate[i],
              remark: req.body.remark[i],
              insertdate: moment(new Date())
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY"),
              by: req.logedINUser,
              fulldate: moment(new Date())
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD HH:mm:ss"),
              transactionid: new_create_po_no_value,
              hsncode: req.body.hsncode[i],
              gsttype: req.body.gsttype[i],
              gstrate: req.body.gstrate[i],
              cgst: `${
                helper.gstCalculation(
                  req.body.gstrate[i],
                  req.body.rate[i] * req.body.qty[i],
                  req.body.gsttype[i]
                ).cgst
              }`,
              sgst: `${
                helper.gstCalculation(
                  req.body.gstrate[i],
                  req.body.rate[i] * req.body.qty[i],
                  req.body.gsttype[i]
                ).sgst
              }`,
              igst: `${
                helper.gstCalculation(
                  req.body.gstrate[i],
                  req.body.rate[i] * req.body.qty[i],
                  req.body.gsttype[i]
                ).igst
              }`,
              qty: req.body.qty[i],
              cost_center: req.body.pocostcenter,
              po_raise_by: req.body.po_raise_by ?? "--",
              statusforporequest: "N",
              ship_partyname: shipPartyName,
              ship_other_pan: shipPAN,
              ship_other_gstin: shipGST,
              isVenMsme: isVenMsme,
            },
            transaction: t,
            type: invtDB.QueryTypes.INSERT,
          }
        );
      } // LOOP END

      let res2 = await invtDB.query(
        "INSERT INTO `transaction_ids` (`transaction_id`,`module_type`)VALUES (:transaction,'CREATE_PO')",
        {
          replacements: { transaction: new_create_po_no_value },
          transaction: t,
          type: invtDB.QueryTypes.INSERT,
        }
      );

      let po_log = await invtDB.query(
        "INSERT INTO `po_status_log`(`po_id`, `min_no`, `po_log_status`, `insert_dt`, `insert_time`, `insert_by`) VALUES ( :poid, :minno, :status, :insert_dt, :insert_time, :insert_by )",
        {
          replacements: {
            poid: new_create_po_no_value,
            minno: "--",
            status: "CREATED",
            insert_dt: moment(new Date()).format("YYYY-MM-DD"),
            insert_time: moment(new Date()).format("HH:mm:ss"),
            insert_by: req.logedINUser,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        }
      );

      if (!approveArr.includes("P")) {
        let po_log = await invtDB.query(
          "INSERT INTO `po_status_log`(`po_id`, `min_no`, `po_log_status`, `insert_dt`, `insert_time`, `insert_by`) VALUES ( :poid, :minno, :status, :insert_dt, :insert_time, :insert_by )",
          {
            replacements: {
              poid: new_create_po_no_value,
              minno: "--",
              status: "AUTO APPROVED",
              insert_dt: moment(new Date()).format("YYYY-MM-DD"),
              insert_time: moment(new Date()).format("HH:mm:ss"),
              insert_by: req.logedINUser,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: t,
          }
        );
      }

      let mail_subject = `New PO created with PO ID #${new_create_po_no_value}`;
      let mail_body = `
Hi,
New PO created with TXN ID #${new_create_po_no_value}
VENDOR:- ${vendor_name} (${vendor_code})
Remark:- ${AllDevisations}
Click here to view or approve the PO
 `;

      let getLeaderMails = await otherDB.query(
        `SELECT ims_po_team_leader , leader.Email_ID FROM ims_po_team LEFT JOIN ${global.ims_db_name}.admin_login leader ON leader.CustID = ims_po_team.ims_po_team_leader WHERE ims_po_team_member = :raise_by AND po_cost_center = :cost_center `,
        {
          replacements: {
            raise_by: req.body.po_raise_by,
            cost_center: req.body.pocostcenter,
          },
          type: otherDB.QueryTypes.SELECT,
        }
      );

      let mail_id = "";
      if (getLeaderMails.length > 0) {
        const mail_arrr = [];
        for (let i = 0; i < getLeaderMails.length; i++) {
          mail_arrr.push(getLeaderMails[i].Email_ID);
        }
        mail_id = mail_arrr.join(",");
      } else {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: `'PO Raise By' user is not assigned to any team for the cost center to raise PO`,
        });
      }

      if (req.body.pocreatetype == "S") {
        let res3 = await invtDB.query(
          "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :po_id AND `company_branch` = :branch LIMIT 1",
          {
            replacements: {
              po_id: req.body.original_po,
              branch: req.branch,
            },
            transaction: t,
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (res3.length > 0) {
          await t.commit();
          helper.sendMail(mail_id, null, mail_subject, mail_body, null);
          res.json({
            success: true,
            message:
              "PO created successfully with TXN ID #" + new_create_po_no_value,
            status: "success",
            data: { po_id: new_create_po_no_value },
          });
          return;
        } else {
          await t.rollback();
          res.json({
            success: false,
            message: "Please supply the valid supplementary purchase order",
            status: "error",
          });
          return;
        }
      } else {
        await t.commit();
        helper.sendMail(mail_id, null, mail_subject, mail_body, null);
        res.json({
          success: true,
          message:
            "PO created successfully with TXN ID #" + new_create_po_no_value,
          status: "success",
          data: { po_id: new_create_po_no_value },
        });
        return;
      }
    } catch (err) {
      await t.rollback();
      res.json({
        success: false,
        status: "error",
        message: err.message,
      })
      return helper.errorResponse(res, err);
    }
  }
);

//VIEW ALL COMPONENTS IN PURCHASE ORDER
router.post("/fetchComponentList4PO", [auth.isAuthorized], async (req, res) => {
  const po_transaction = req.body.poid;
  const validation = new Validator(req.body, {
    poid: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      status: "error",
    });
    return;
  }

  try {
    let result = await invtDB.query(
      "SELECT * FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` WHERE `po_purchase_req`.`po_transaction` = :po AND `po_purchase_req`.`company_branch` = :branch ORDER BY `components`.`c_name` DESC",
      {
        replacements: { po: po_transaction, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      finalResult = [];
      let getQty;
      for (let i = 0; i < result.length; i++) {
        getQty = await invtDB.query(
          "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :po AND `po_part_no` = :component AND `company_branch` = :branch",
          {
            replacements: {
              po: po_transaction,
              component: result[i].component_key,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        // ADDED: Query to get the last purchase rate for this component
        let lastPurchaseRate = null;
        let tolerance = null;
        const lastPO = await invtDB.query(
          "SELECT `po_order_rate` FROM `po_purchase_req` WHERE `po_part_no` = :component AND `company_branch` = :branch AND `po_transaction` != :po AND `po_order_rate` IS NOT NULL AND `po_order_rate` > 0 ORDER BY `po_insert_date` DESC LIMIT 1",
          {
            replacements: {
              component: result[i].component_key,
              branch: req.branch,
              po: po_transaction,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        // Set last purchase rate if found
        if (lastPO.length > 0) {
          lastPurchaseRate = helper.number(lastPO[0].po_order_rate);
          tolerance = helper.number((lastPurchaseRate * 5) / 100);
        }
        // END OF ADDED CODE

        po_ordered_qty = helper.number(getQty[0].po_order_qty);
        po_pending_qty = helper.number(getQty[0].po_pending_qty);

        finalResult.push({
          componentPartID: result[i].c_part_no,
          componentID: result[i].component_key,
          advPayment: result[i].advance_payment,
          pending_qty: po_pending_qty,
          ordered_qty: po_ordered_qty,
          po_components: decode(result[i].c_name),
          po_part_status: result[i].po_part_status,
          remark: result[i].po_remark,
          deviation_remark: result[i].status_remark,
          reject_remark: result[i].po_rej_remark,
          porequestremark: result[i].remarkbyactacoutteam,
          rate: result[i].po_order_rate,
          last_purchase_rate: lastPurchaseRate,
          tolerance: tolerance,
        });
      } //loop end
      res.json({ success: true, status: "success", data: finalResult });
      return;
    } else {
      res.json({
        success: false,
        message: "No PO found",
        status: "error",
      });
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//FETCH PENDING PURCHASE ORDER
router.post("/fetchPendingData4PO", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      status: "error",
    });
    return;
  }

  try {
    let result = [];
    if (searchBy == "single_date_wise") {
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
          message:
            "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          success: false,
        });
      }

      result = await invtDB.query(
        "SELECT po_purchase_req.* , ven_basic_detail.* , cost_center.*  , admin_login.user_name AS po_created_by, po_approve.user_name as approve_by , raised_by.user_name as raise_by , project_master.project_description , COALESCE(SUM(po_purchase_req.po_order_qty),0) totalReq_Qty, COALESCE(SUM(po_purchase_req.po_pending_qty),0) totalIn_Qty FROM po_purchase_req LEFT JOIN ven_basic_detail ON po_purchase_req.po_vendor_reg_id = ven_basic_detail.ven_register_id LEFT JOIN admin_login ON po_purchase_req.po_insert_by = admin_login.CustID LEFT JOIN cost_center ON po_purchase_req.po_cost_center = cost_center.cost_center_key LEFT JOIN admin_login po_approve ON po_approve.CustID = po_purchase_req.po_approve_by  LEFT JOIN admin_login raised_by ON raised_by.CustID = po_purchase_req.po_raise_by LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name WHERE DATE_FORMAT(po_purchase_req.po_full_date,'%Y-%m-%d') BETWEEN :datefrom AND :dateto AND po_purchase_req.po_status = :status AND po_purchase_req.company_branch = :branch AND  po_purchase_req.txn_session = :session AND po_purchase_req.statusforporequest IN ('A', '--')  GROUP BY po_purchase_req.po_transaction ORDER BY po_purchase_req.ID DESC",
        {
          replacements: {
            datefrom: fromdate,
            dateto: todate,
            status: "A",
            branch: req.branch,
            session: req.session,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "po_wise") {
      result = await invtDB.query(
        "SELECT po_purchase_req.* , ven_basic_detail.* , cost_center.*  , admin_login.user_name AS po_created_by, po_approve.user_name as approve_by , raised_by.user_name as raise_by , project_master.project_description , COALESCE(SUM(po_purchase_req.po_order_qty),0) totalReq_Qty, COALESCE(SUM(po_purchase_req.po_pending_qty),0) totalIn_Qty FROM po_purchase_req LEFT JOIN ven_basic_detail ON po_purchase_req.po_vendor_reg_id = ven_basic_detail.ven_register_id LEFT JOIN admin_login ON po_purchase_req.po_insert_by = admin_login.CustID LEFT JOIN cost_center ON po_purchase_req.po_cost_center = cost_center.cost_center_key LEFT JOIN admin_login po_approve ON po_approve.CustID = po_purchase_req.po_approve_by  LEFT JOIN admin_login raised_by ON raised_by.CustID = po_purchase_req.po_raise_by LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name WHERE po_purchase_req.po_transaction LIKE CONCAT('%', :po_id, '%') AND po_purchase_req.po_status = :status AND po_purchase_req.company_branch = :branch AND po_purchase_req.txn_session = :session AND po_purchase_req.statusforporequest IN ('A', '--') GROUP BY po_purchase_req.po_transaction ORDER BY po_purchase_req.ID DESC",
        {
          replacements: {
            po_id: searchValue,
            status: "A",
            branch: req.branch,
            session: req.session,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "vendor_wise") {
      result = await invtDB.query(
        "SELECT po_purchase_req.* , ven_basic_detail.* , cost_center.*  , admin_login.user_name AS po_created_by, po_approve.user_name as approve_by , raised_by.user_name as raise_by , project_master.project_description , COALESCE(SUM(po_purchase_req.po_order_qty),0) totalReq_Qty, COALESCE(SUM(po_purchase_req.po_pending_qty),0) totalIn_Qty FROM po_purchase_req LEFT JOIN ven_basic_detail ON po_purchase_req.po_vendor_reg_id = ven_basic_detail.ven_register_id LEFT JOIN admin_login ON po_purchase_req.po_insert_by = admin_login.CustID LEFT JOIN cost_center ON po_purchase_req.po_cost_center = cost_center.cost_center_key LEFT JOIN admin_login po_approve ON po_approve.CustID = po_purchase_req.po_approve_by  LEFT JOIN admin_login raised_by ON raised_by.CustID = po_purchase_req.po_raise_by LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name WHERE po_purchase_req.po_vendor_reg_id = :venid AND po_purchase_req.po_status = :status AND po_purchase_req.company_branch = :branch AND po_purchase_req.txn_session = :session AND po_purchase_req.statusforporequest IN ('A', '--') GROUP BY po_purchase_req.po_transaction ORDER BY po_purchase_req.ID DESC",
        {
          replacements: {
            venid: searchValue,
            status: "A",
            branch: req.branch,
            session: req.session,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      res.json({
        success: false,
        message: "Please select valid filter method",
        status: "error",
      });
      return;
    }

    if (result.length > 0) {
      let finalResult = [];
      for (let i = 0; i < result.length; i++) {
        if (result[i].totalIn_Qty > 0) {
          let status = "--";
          if (result[i].approval_status == "P") {
            status = "PENDING";
          }
          if (result[i].approval_status == "A") {
            status = "APPROVED";
          }
          if (result[i].approval_status == "R") {
            status = "REJECTED";
          }
          if (result[i].approval_status == "D") {
            status = "CANCELLED";
          }
          finalResult.push({
            advPayment: result[i].advance_payment,
            po_transaction: result[i].po_transaction,
            vendor_name: result[i].ven_name,
            po_comment: result[i].po_comment,
            vendor_id: result[i].po_vendor_reg_id,
            po_reg_date: moment(
              result[i].po_full_date,
              "YYYY-MM-DD HH:mm:ss"
            ).format("DD-MM-YYYY HH:mm:ss"),
            po_reg_by: result[i].po_created_by,
            due_date: result[i].po_duedate == "" ? "--" : result[i].po_duedate,
            time_ago: format(result[i].po_full_date, "en_US"),
            po_trans_encrypt: result[i].po_transaction,
            po_status: result[i].po_status,
            approval_status: status,
            cost_center:
              result[i].cost_center_name +
              " (" +
              result[i].cost_center_short_name +
              ")",
            po_reject_remark:
              status == "REJECTED" ? result[i].po_rej_remark : "NA",
            project_id: result[i].po_project_name ?? "NA",
            project_name: result[i].project_description ?? "NA",
            requested_by: result[i].raise_by ?? "NA",
            approved_by: result[i].approve_by ?? "NA",
            poacceptstatus:
              result[i].statusforporequest === "A"
                ? "APPROVED"
                : result[i].statusforporequest === "R"
                ? "REJECTED"
                : "OLD",

            poacceptBy: result[i].porequestApprovalId,
          });
        }
      }
      if (finalResult.length > 0) {
        return res.json({
          success: true,
          status: "success",
          data: finalResult,
        });
      } else {
        return res.json({
          success: false,
          message: "No PO found",
          status: "error",
        });
      }
    }
    res.json({
      success: false,
      message: "No PO found",
      status: "error",
    });
    return;
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH RM FOR UPDATE PURCHASE ORDER
router.post("/fetchData4Update", [auth.isAuthorized], async (req, res) => {
  const po_transaction = req.body.pono;
  const validation = new Validator(req.body, {
    pono: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      status: "error",
    });
    return;
  }

  try {
    const result = await invtDB.query(
      "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :transaction AND `po_status` = :status AND `company_branch` = :branch GROUP BY po_part_no, po_transaction",
      {
        replacements: {
          transaction: po_transaction,
          status: "A",
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      if (result[0].po_status !== "A") {
        res.json({
          success: false,
          message: "PO marked as closed, mean you can't ammend",
          status: "error",
        });
        return false;
      }

      const result2 = await invtDB.query(
        "SELECT *, `po_purchase_req`.`ID` AS `purchaseUpdateID` FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` LEFT JOIN `units` ON units.units_id = components.c_uom WHERE `po_purchase_req`.`po_transaction` = :transaction AND `po_purchase_req`.`po_part_status` = :part_status AND `po_purchase_req`.`company_branch` = :branch",
        {
          replacements: {
            transaction: po_transaction,
            part_status: "ACTIVE",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (result2.length > 0) {
        let check_open_po = await invtDB.query(
          "SELECT * FROM `rm_location` WHERE `in_po_transaction_id` = :transaction AND `trans_type` != 'CANCELLED' AND `company_branch` = :branch",
          {
            replacements: { transaction: po_transaction, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (check_open_po.length > 0) {
          res.json({
            success: false,
            message: "PO has been opened therefore it can't be update...",
            status: "error",
          });
          return;
        }

        materials = [];
        vendor = [];
        billaddress = [];
        shipaddress = [];
        vendor_ship_address = [];

        let shipment_code = "--";
        let shipment_name = "- N/A -";
        let shipment_gstid = "N/A";
        let shipment_cinno = "N/A";
        let shipment_panno = "N/A";
        let ship_address = "Not Available";
        let ship_type = "saved";
        let ship_vendor_id = "--";
        let ship_vendor_branch_id = "--";

        let ship_vendor_code = null;
        let ship_vendor_name = "- N/A -";
        let ship_vendor_branch = null;

        let is_ship_same_as_billing = false;

        let billing_address = "N/A";
        let billing_code = "--";
        let billing_name = "- N/A -";
        let billing_cinno = "N/A";
        let billing_panno = "N/A";
        let billing_gstid = "N/A";

        let result3;
        let count = 0;

        for (let i = 0; i < result2.length; i++) {
          result3 = await invtDB.query(
            "SELECT *, COALESCE(SUM(`qty`+`other_qty`),0) `totalIN_Qty` FROM `rm_location` WHERE `in_po_transaction_id` = :poid AND `components_id` = :partno AND `trans_type` = 'INWARD' AND `company_branch` = :branch",
            {
              replacements: {
                poid: po_transaction,
                partno: result2[i].po_part_no,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          totalIN_Qty = 0;
          if (result3.length > 0) {
            totalIN_Qty = helper.number(result3[0].totalIN_Qty);
          }
          selectLabel = "";
          selectValue = "";

          if (result2[i].po_vendor_type == "v01") {
            selectLabel = "Vendor";
            selectValue = "v01";
          } else if (result2[i].po_vendor_type == "j01") {
            selectLabel = "JWI";
            selectValue = "j01";
          } else if (result2[i].po_vendor_type == "s01") {
            selectLabel = "SortIn";
            selectValue = "s01";
          } else if (result2[i].po_vendor_type == "r01") {
            selectLabel = "RejIn";
            selectValue = "r01";
          } else if (result2[i].po_vendor_type == "p01") {
            selectLabel = "ProdReturn";
            selectValue = "p01";
          } else {
            selectLabel = "--N/A--";
            selectValue = "0";
          }

          // VENDER DETAIL
          let vendor_detail = await invtDB.query(
            "SELECT * FROM `po_purchase_req` LEFT JOIN `ven_basic_detail` ON `po_purchase_req`.`po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `po_purchase_req`.`po_vendor_reg_id` = :vendorid",
            {
              replacements: { vendorid: result2[i].po_vendor_reg_id },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          selectedVendor = "--";
          if (vendor_detail.length > 0) {
            if (vendor_detail[0].po_vendor_reg_id == "--") {
              selectedVendor = {
                value: result2[i].po_vendor_reg_id,
                label: result2[i].po_vendor_reg_id,
              };
            } else {
              selectedVendor = {
                value: vendor_detail[0].ven_register_id,
                label: vendor_detail[0].ven_name,
              };
            }
          }

          // ADDRESS DETAIL (Vendor Branch Address)
          let address_detail = await invtDB.query(
            "SELECT * FROM `po_purchase_req` LEFT JOIN `ven_address_detail` ON `po_purchase_req`.`po_ven_add_id` = `ven_address_detail`.`ven_address_id` WHERE `po_purchase_req`.`po_ven_add_id` = :vendoraddress",
            {
              replacements: { vendoraddress: result2[i].po_ven_add_id },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          selectedAddress = "";
          ven_state_name = "";
          if (address_detail.length > 0) {
            if (address_detail[0].po_ven_add_id !== "--") {
              ven_state_name = address_detail[0].ven_state;
              selectedAddressLabel = {
                value: address_detail[0].po_ven_add_id,
                label: address_detail[0].ven_add_label,
              };
            } else {
              ven_state_name = "N/R";
              selectedAddressLabel = {
                value: "0",
                label: "- - ADDRESS N/A - -",
              };
            }
            vendor_gstid = address_detail[0].ven_add_gst;
          }

          let bill_address_detail = await invtDB.query(
            "SELECT * FROM `billing_address` WHERE `billing_code` = :code",
            {
              replacements: { code: result2[i].po_billing_id },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (bill_address_detail.length > 0) {
            billing_code = bill_address_detail[0].billing_code;
            billing_name = bill_address_detail[0].billing_company;
            billing_gstid = bill_address_detail[0].billing_gstno;
            billing_cinno = bill_address_detail[0].billing_cin;
            billing_panno = bill_address_detail[0].billing_pan;

            if (result2[i].po_billing_addr !== "") {
              billing_address = result2[i].po_billing_addr;
            } else {
              billing_address = bill_address_detail[0].billing_address;
            }
          } else {
            billing_address = "N/A";
            billing_code = "--";
            billing_name = "- N/A -";
            billing_cinno = "N/A";
            billing_panno = "N/A";
            billing_gstid = "N/A";
          }

          // Updated shipping address logic to handle 3 different ship_type cases

          shipment_code = "--";
          shipment_name = "- N/A -";
          shipment_gstid = "N/A";
          shipment_cinno = "N/A";
          shipment_panno = "N/A";
          ship_address = "Not Available";
          ship_type = result2[i].po_ship_type || "saved";
          ship_vendor_id = "--";
          ship_vendor_branch_id = "--";
          ship_vendor_code = null;
          ship_vendor_name = "- N/A -";
          ship_vendor_branch = null;
          is_ship_same_as_billing = false;

          if (
            result2[i].po_ship_id === result2[i].po_billing_id &&
            result2[i].po_ship_id !== "--"
          ) {
            is_ship_same_as_billing = true;
            ship_type = "saved";

            shipment_code = billing_code;
            shipment_name = billing_name;
            shipment_gstid = billing_gstid;
            shipment_cinno = billing_cinno;
            shipment_panno = billing_panno;
            ship_address = billing_address;
          } else {
            if (ship_type === "saved") {
              let ship_address_detail = await invtDB.query(
                "SELECT * FROM `shipment_address` WHERE `shipment_code` = :code",
                {
                  replacements: { code: result2[i].po_ship_id },
                  type: invtDB.QueryTypes.SELECT,
                }
              );
              if (ship_address_detail.length > 0) {
                shipment_code = ship_address_detail[0].shipment_code;
                shipment_name = ship_address_detail[0].shipment_label;
                shipment_gstid = ship_address_detail[0].shipment_gstin || "N/A";
                shipment_cinno = "--";
                shipment_panno = ship_address_detail[0].shipment_pan || "N/A";

                if (
                  result2[i].po_ship_address &&
                  result2[i].po_ship_address !== ""
                ) {
                  ship_address = result2[i].po_ship_address;
                } else {
                  ship_address =
                    ship_address_detail[0].shipment_address || "Not Available";
                }
              } else {
                shipment_code = result2[i].po_ship_id || "--";
                ship_address = result2[i].po_ship_address || "Not Available";
              }
            } else if (ship_type === "vendor") {
              ship_vendor_id = result2[i].po_ship_id;
              ship_vendor_branch_id = result2[i].po_ship_vendor_branch || "--";

              shipment_code = ship_vendor_id;

              let ship_vendor_detail = await invtDB.query(
                "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor_id",
                {
                  replacements: { vendor_id: ship_vendor_id },
                  type: invtDB.QueryTypes.SELECT,
                }
              );

              if (ship_vendor_detail.length > 0) {
                ship_vendor_code = {
                  value: ship_vendor_detail[0].ven_register_id,
                  label: ship_vendor_detail[0].ven_name,
                };
                ship_vendor_name = ship_vendor_detail[0].ven_name;
                shipment_name = ship_vendor_detail[0].ven_name;
              } else {
                ship_vendor_code = {
                  value: ship_vendor_id,
                  label: ship_vendor_id,
                };
                ship_vendor_name = ship_vendor_id;
                shipment_name = ship_vendor_id;
              }

              if (ship_vendor_branch_id !== "--") {
                let vendor_ship_branch_detail = await invtDB.query(
                  "SELECT * FROM `ven_address_detail` WHERE `ven_address_id` = :branch_id",
                  {
                    replacements: { branch_id: ship_vendor_branch_id },
                    type: invtDB.QueryTypes.SELECT,
                  }
                );

                if (vendor_ship_branch_detail.length > 0) {
                  shipment_gstid =
                    vendor_ship_branch_detail[0].ven_add_gst || "N/A";
                  shipment_cinno = "--";
                  shipment_panno =
                    vendor_ship_branch_detail[0].ven_add_pan || "N/A";

                  ship_vendor_branch = {
                    value: vendor_ship_branch_detail[0].ven_address_id,
                    label:
                      vendor_ship_branch_detail[0].ven_add_label ||
                      "Vendor Branch",
                  };

                  if (
                    result2[i].po_ship_address &&
                    result2[i].po_ship_address !== ""
                  ) {
                    ship_address = result2[i].po_ship_address;
                  } else {
                    ship_address =
                      vendor_ship_branch_detail[0].ven_address ||
                      "Not Available";
                  }
                } else {
                  ship_vendor_branch = {
                    value: ship_vendor_branch_id,
                    label: "Unknown Branch",
                  };
                  ship_address = result2[i].po_ship_address || "Not Available";
                }
              } else {
                ship_vendor_branch = {
                  value: "0",
                  label: "- - BRANCH N/A - -",
                };
                ship_address = result2[i].po_ship_address || "Not Available";
              }
            } else if (ship_type === "manual") {
              shipment_code = "--";
              shipment_name = result2[i].ship_partyname || "Manual Entry";
              shipment_gstid = result2[i].ship_other_gstin || "N/A";
              shipment_cinno = "--";
              shipment_panno = result2[i].ship_other_pan || "N/A";
              ship_address = result2[i].po_ship_address || "Not Available";

              if (
                !result2[i].ship_partyname ||
                result2[i].ship_partyname.trim() === ""
              ) {
                shipment_name = "Manual Entry";
              }
            }
          }

          gsttype = "";
          if (result2[i].po_gsttype === "L") {
            gsttype = [{ id: "L", text: "LOCAL" }];
          } else if (result2[i].po_gsttype === "I") {
            gsttype = [{ id: "I", text: "INTER STATE" }];
          } else {
            gsttype = [{ id: 0, text: "-- TYPE --" }];
          }

          // COST DETAIL
          let cost_center = await invtDB.query(
            "SELECT * FROM `cost_center` WHERE `cost_center_key` = :costkey",
            {
              replacements: { costkey: result2[i].po_cost_center },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          selectedCostCenter = "--";
          if (cost_center.length > 0) {
            selectedCostCenter = {
              value: cost_center[0].cost_center_key,
              label: cost_center[0].cost_center_name,
            };
          } else {
            selectedCostCenter = { value: 0, label: "--" };
          }

          // PROJECT INFO RATE / PROJECT QTY / EXECUTED PO
          let projectRate = await otherDB.query(
            "SELECT COALESCE(project_rate, 0) as rate FROM `invt_projects` WHERE project_name = :project AND project_rm = :component ORDER BY ID DESC LIMIT 1",
            {
              replacements: {
                project: result[0].po_project_name,
                component: result2[i].po_part_no,
              },
              type: otherDB.QueryTypes.SELECT,
            }
          );
          let ppr_project_rate;
          if (projectRate.length > 0) {
            ppr_project_rate = projectRate[0].rate;
          } else {
            ppr_project_rate = 0;
          }

          let projectOrdQty = await otherDB.query(
            "SELECT COALESCE(SUM(project_requirement), 0) as rqdOrdQty FROM invt_projects WHERE project_name = :project AND `project_rm` = :component",
            {
              replacements: {
                project: result[0].po_project_name,
                component: result2[i].po_part_no,
              },
              type: otherDB.QueryTypes.SELECT,
            }
          );
          let ppr_project_qty;
          if (projectOrdQty.length > 0) {
            ppr_project_qty = projectOrdQty[0].rqdOrdQty;
          } else {
            ppr_project_qty = 0;
          }

          let projectPOQty = await invtDB.query(
            "SELECT COALESCE(SUM(po_order_qty), 0) as poOrdQty FROM po_purchase_req WHERE po_project_name = :project AND po_part_no = :component AND po_part_status = 'ACTIVE' AND po_status = 'A' AND approval_status = 'A'",
            {
              replacements: {
                project: result[0].po_project_name,
                component: result2[i].po_part_no,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let ppr_po_qty;
          if (projectPOQty.length > 0) {
            ppr_po_qty = projectPOQty[0].poOrdQty;
          } else {
            ppr_po_qty = 0;
          }

          let projected_qty = 0;
          const component_code = result2[i].po_part_no;

          const projectBOMResult = await invtDB.query(
            `SELECT pm.bomsubjectid, pm.projectQty 
             FROM project_master pm
             WHERE pm.bomsubjectid IS NOT NULL 
             AND pm.bomsubjectid != '' 
             AND pm.bomsubjectid != '--'
             AND pm.projectQty > 0`,
            {
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (projectBOMResult.length > 0) {
            for (const project of projectBOMResult) {
              const bomQtyResult = await invtDB.query(
                `SELECT bq.qty 
                 FROM bom_quantity bq
                 INNER JOIN bom_recipe br ON bq.subject_under = br.subject_id
                 WHERE bq.subject_under = :bom_id 
                 AND bq.component_id = :component_id
                 AND br.bom_status = 'ENABLE'`,
                {
                  replacements: {
                    bom_id: project.bomsubjectid,
                    component_id: component_code,
                  },
                  type: invtDB.QueryTypes.SELECT,
                }
              );

              if (bomQtyResult.length > 0) {
                const bomComponentQty = bomQtyResult[0].qty || 0;
                const projectQty = project.projectQty || 0;
                projected_qty += projectQty * bomComponentQty;
              }
            }
          }

          let executed_qty = 0;
          const executedQtyResult = await invtDB.query(
            `SELECT COALESCE(SUM(pr.po_order_qty), 0) AS total_executed_qty
             FROM po_purchase_req pr
             INNER JOIN project_master pm ON pr.po_project_name = pm.project_name
             WHERE pr.po_part_no = :component_code
             AND pm.bomsubjectid IS NOT NULL 
             AND pm.bomsubjectid != '' 
             AND pm.bomsubjectid != '--'`,
            {
              replacements: {
                component_code: component_code,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (executedQtyResult.length > 0) {
            executed_qty = executedQtyResult[0].total_executed_qty || 0;
          }

          const last_rate_value =
            await require("../../../helper/utils/avgRate").getLastInwardRate(
              result2[i].po_part_no,
              result2[i].po_vendor_reg_id
            );

          materials.push({
            updateid: result2[i].purchaseUpdateID,
            part_no: result2[i].c_part_no,
            component: result2[i].c_name,
            component_short: result2[i].c_name,
            componentKey: result2[i].component_key,
            selectedComponent: [
              {
                id: result2[i].component_key,
                text:
                  decode(result2[i].c_name) +
                  " ( " +
                  result2[i].c_part_no +
                  " )",
              },
            ],
            orderqty: helper.number(result2[i].po_order_qty) - totalIN_Qty,
            unitname: result2[i].units_name,
            project_rate: ppr_project_rate,
            project_qty: ppr_project_qty,
            po_ord_qty: ppr_po_qty,
            // AAA CHANGE: Added new fields for projected and executed quantities
            project_qty: helper.number(projected_qty),
            po_exec_qty: helper.number(executed_qty),
            rate: result2[i].po_order_rate,
            last_rate: last_rate_value,
            currency: result2[i].po_currency,
            duedate: result2[i].po_duedate,
            gsttype: gsttype,
            taxablevalue: (
              helper.number(result2[i].po_order_qty) *
              helper.number(result2[i].po_order_rate)
            ).toFixed(2),
            exchangerate: result2[i].po_exchange,
            exchangetaxablevalue: (
              helper.number(result2[i].po_order_qty) *
              helper.number(result2[i].po_order_rate) *
              helper.number(result2[i].po_exchange)
            ).toFixed(2),
            hsncode: result2[i].po_hsncode,
            gstrate: result2[i].po_gstrate,
            cgst: result2[i].po_cgst,
            sgst: result2[i].po_sgst,
            igst: result2[i].po_igst,
            remark: result2[i].po_remark,
            internal_remark: result2[i].internal_remark,
            orderid: result2[i].po_transaction,
          });
          count++;
          if (count == result2.length) {
            myFun();
            return;
          }
        }

        function myFun() {
          vendor.push({
            vendortype_value: selectValue,
            vendortype_label: selectLabel,
            vendorcode: selectedVendor,
            vendorname: result2[0].po_vendor_name,
            vendorbranch: selectedAddressLabel,
            vendoraddress: result2[0].po_vendor_address,

            paymentterms: result[0].payment_terms,
            paymenttermsday: result[0].payment_terms_day,
            projectname: result[0].po_project_name,
            pocomment: result[0].po_comment,
            termsofcondition: result[0].terms_condition,
            termsofquotation: result[0].quotation_detail,
            costcenter: selectedCostCenter,
            country: "INDIA",
            vendorgst: vendor_gstid,
            orderid: result[0].po_transaction,
            advPayment: result[0].advance_payment,
            remarByacc: result[0].remarkbyactacoutteam,
          });

          billaddress = {
            billaddress: billing_address,
            addrbillid: billing_code,
            addrbillname: billing_name,
            billpanno: billing_panno,
            billcinno: billing_cinno,
            billgstid: billing_gstid,
          };

          shipaddress = {
            shipaddress: ship_address,
            addrshipid: shipment_code,
            addrshipname: shipment_name,
            shippanno: shipment_panno,
            shipcinno: shipment_cinno,
            shipgstid: shipment_gstid,
            ship_type: ship_type,
            is_same_as_billing: is_ship_same_as_billing,

            ship_partyname: result2[0].ship_partyname || "",
            ship_other_pan: result2[0].ship_other_pan || "",
            ship_other_gstin: result2[0].ship_other_gstin || "",

            ship_vendor_code: ship_vendor_code,
            ship_vendor_name: ship_vendor_name,
            ship_vendor_branch: ship_vendor_branch,
          };

          res.json({
            success: true,
            status: "success",
            data: {
              materials: materials,
              vendor: vendor,
              bill: billaddress,
              ship: shipaddress,
            },
          });
          return;
        }
      } else {
        res.json({
          success: false,
          message: "No PO found",
          status: "error",
        });
        return true;
      }
    } else {
      res.json({
        success: false,
        message: "PO has been closed therefore it can't be update",
        status: "error",
      });
      return;
    }
  } catch (err) {
    console.log(err);
    return helper.errorResponse(res, err);
  }
});
// UPDATE PURCHASE ORDER
router.post(
  "/updateData4Update",
  [auth.isAuthorized, poPermission.checkPOPermission("edit")],
  async (req, res) => {
    console.log(req.body);
    let validation = new Validator(req.body, {
      vendor_name: "required",
      vendor_address: "required",
      costcenter: "required",
      advancePayment: "required",
      ship_type: "required|in:saved,vendor,manual",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
    }

    if (req.body.ship_type === "saved") {
      if (!req.body.ship_address_id) {
        return res.json({
          success: false,
          message: "Please select shipping address for saved mode",
          status: "error",
        });
      }
    } else if (req.body.ship_type === "vendor") {
      if (!req.body.ship_vendor || !req.body.ship_vendor_branch) {
        return res.json({
          success: false,
          message: "Please select shipping vendor and branch for vendor mode",
          status: "error",
        });
      }
    } else if (req.body.ship_type === "manual") {
      if (!req.body.ship_address || req.body.ship_address.trim() === "") {
        return res.json({
          success: false,
          message: "Please provide shipping address for manual entry",
          status: "error",
        });
      }
    }

    let itemCurrencys = [];
    for (let i = 0; i < req.body.updaterow.length; i++) {
      itemCurrencys.push(req.body.currency[i]);
    }
    let uniqueItemCurrencys = [...new Set(itemCurrencys)];
    if (uniqueItemCurrencys.length > 1) {
      res.json({
        success: false,
        message: "Please select same currency",
        status: "error",
      });
      return;
    }

    const toFindDublicates = (arry) =>
      arry.filter((item, index) => arry.indexOf(item) !== index);
    const dubliEle = toFindDublicates(req.body.component);
    if (dubliEle.length > 0) {
      res.json({
        success: false,
        message:
          "You have entered a same component twice of time in a single request",
        status: "error",
      });
      return;
    }

    const t = await invtDB.transaction();
    try {
      let shipAddressId = "--";
      let shipAddress = req.body.ship_address
        ? req.body.ship_address.replace(/\n/g, "<br>")
        : "--";
      let shipVendorBranch = "--"; // Default to "--"

      //fro
      let shipPartyName = "";
      let shipOtherPan = "";
      let shipOtherGstin = "";

      if (req.body.ship_type === "saved") {
        shipAddressId = req.body.ship_address_id;
        shipAddress = req.body.ship_address
          ? req.body.ship_address.replace(/\n/g, "<br>")
          : "--";
        shipVendorBranch = "--";

        // Validate that saved address exists
        // let stmt1 = await invtDB.query("SELECT * FROM `shipment_address` WHERE `shipment_code` = :code", {
        //   replacements: { code: req.body.ship_address_id },
        //   type: invtDB.QueryTypes.SELECT,
        // });

        // if (stmt1.length === 0) {
        //   await t.rollback();
        //   return res.json({
        //     status: "error",
        //     message: "Selected shipment address is not valid" },
        //     success:false,
        //   });
        // }
      } else if (req.body.ship_type === "vendor") {
        shipAddressId = req.body.ship_vendor;
        shipVendorBranch = req.body.ship_vendor_branch || "--";
        shipAddress = req.body.ship_address
          ? req.body.ship_address.replace(/\n/g, "<br>")
          : "--";
      } else if (req.body.ship_type === "manual") {
        shipAddressId = "--";
        shipVendorBranch = "--";
        shipAddress = req.body.ship_address.replace(/\n/g, "<br>");

        // Save manual fields (optional — empty is allowed)
        shipPartyName = (req.body.ship_partyname || "").trim();
        shipOtherPan = (req.body.ship_other_pan || "").trim();
        shipOtherGstin = (req.body.ship_other_gstin || "").trim();
      }

      // // Check if the user is authorized to update the PO
      // let poCreatorCheck = await invtDB.query(
      //   "SELECT `po_insert_by` FROM `po_purchase_req` WHERE `po_transaction` = :transaction AND `company_branch` = :branch LIMIT 1",
      //   {
      //     replacements: {
      //       transaction: req.body.poid,
      //       branch: req.branch,
      //     },
      //     type: invtDB.QueryTypes.SELECT,
      //   }
      // );

      // if (poCreatorCheck.length > 0) {
      //   if (poCreatorCheck[0].po_insert_by !== req.logedINUser) {
      //     await t.rollback();
      //     return res.json({
      //       code: 403,
      //       status: "error",
      //       message:  "You are not authorized to update this PO. Only the creator can update it.",
      //     });
      //   }
      // } else {
      //   await t.rollback();
      //   return res.json({
      //     success:false,
      //     status: "error",
      //     message: "PO not found" },
      //   });
      // }

      let stmt2 = await invtDB.query(
        "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :transaction AND `po_status` = :status AND `company_branch` = :branch GROUP BY po_part_no, po_transaction",
        {
          replacements: {
            transaction: req.body.poid,
            status: "A",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt2.length > 0) {
        let stmt3 = await invtDB.query(
          "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendorid",
          {
            replacements: { vendorid: req.body.vendor_name },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt3.length > 0) {
          vendor_code = stmt3[0].ven_register_id;
          vendor_name = stmt3[0].ven_name;
          var isVenMsme = stmt3[0].ven_msme_status === "Y" ? "Y" : "N";
        } else {
          await t.rollback();
          return res.json({
            status: "error",
            message: "vendor is not registered yet",
            success: false,
          });
        }

        let stmt4 = await invtDB.query(
          "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :po_code AND `company_branch` = :branch",
          {
            replacements: { po_code: req.body.poid, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt4.length > 0) {
          bill_address_id = req.body.bill_address_id;
          bill_address = req.body.billaddress;
        } else {
          await t.rollback();
          return res.json({
            status: "error",
            message: "something happend wrong, PO ID not exist!",
            success: false,
          });
        }

        let rejectionCheckStmt = await invtDB.query(
          "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :transaction AND `statusforporequest` = :status",
          {
            replacements: {
              transaction: req.body.poid,
              status: "R",
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let newStatusForPoRequest = rejectionCheckStmt.length > 0 ? "UV" : "N";

        let tolerance, minTolerance, rowDetails;
        let approveStatus = "A";
        let pendingRemark = "--";

        for (i = 0; i < req.body.updaterow.length; i++) {
          pendingRemark = "--";
          let data = {
            qty: req.body.qty[i],
            gst_rate: req.body.gstrate[i],
            gst_type: req.body.gsttype[i],
          };

          let validData = new Validator(data, {
            qty: "required|not_in:0",
            gst_rate: "integer",
            gst_type: "in:L,I",
          });
          if (validData.fails()) {
            await t.rollback();
            return res.json({
              success: false,
              message: helper.firstErrorValidatorjs(validData),
              status: "error",
            });
          }

          tolerance = ((req.body.rate_cap[i] * 1) / 100).toFixed(2);
          minTolerance = req.body.rate_cap[i] - tolerance;

          rowDetails = `PO Qty [${req.body.qty[i]}] | PO Rate [${req.body.rate[i]}] | BOM Rate [${req.body.rate_cap[i]}] | TOLERANCE [${tolerance}] | Project Req. QTY [${req.body.project_qty[i]}] | PO Executed [${req.body.exq_po_qty[i]}]`;

          if (req.body.currency[i] == 364907247) {
            if (
              Number(req.body.qty[i]) >
              Number(req.body.project_qty[i]) - Number(req.body.exq_po_qty[i])
            ) {
              approveStatus = "P";
              pendingRemark = rowDetails + "\n: deviation in qty";
            }
            if (
              minTolerance > req.body.rate[i] ||
              req.body.rate[i] > req.body.rate_cap[i]
            ) {
              approveStatus = "P";
              pendingRemark = rowDetails + "\n: deviation in price";
            }

            if (
              (minTolerance > req.body.rate[i] ||
                req.body.rate[i] > req.body.rate_cap[i]) &&
              Number(req.body.qty[i]) >
                Number(req.body.project_qty[i]) - Number(req.body.exq_po_qty[i])
            ) {
              approveStatus = "P";
              pendingRemark =
                rowDetails + "\n: deviation in both qty and price both";
            }
          } else {
            if (
              Number(req.body.qty[i]) >
              Number(req.body.project_qty[i]) - Number(req.body.exq_po_qty[i])
            ) {
              approveStatus = "P";
              pendingRemark = rowDetails + "\n: deviation in qty";
            }
            if (
              minTolerance > req.body.exchange_rate[i] ||
              req.body.exchange_rate[i] > req.body.rate_cap[i]
            ) {
              approveStatus = "P";
              pendingRemark = rowDetails + "\n: deviation in price";
            }

            if (
              (minTolerance > req.body.exchange_rate[i] ||
                req.body.exchange_rate[i] > req.body.rate_cap[i]) &&
              Number(req.body.qty[i]) >
                Number(req.body.project_qty[i]) - Number(req.body.exq_po_qty[i])
            ) {
              approveStatus = "P";
              pendingRemark =
                rowDetails + "\n: deviation in both qty and price both";
            }
          }

          if (req.body.updaterow[i] == 0) {
            //INSERT PO DETAILS
            // RECENT CHANGE: Added po_ship_type and po_ship_vendor_branch columns to INSERT
            let insertStmt = await invtDB.query(
              "INSERT INTO `po_purchase_req` (`advance_payment`,`payment_terms_day`,`approval_status`,`status_remark`,`company_branch`,`po_vendor_name`,`po_comment`,`po_project_name`,`po_currency`,`po_exchange`,`po_vendor_type`,`po_vendor_reg_id`,`po_ven_add_id`,`po_vendor_address`,`po_billing_id`,`po_billing_addr`,`po_ship_id`,`po_ship_address`,`po_ship_type`,`po_ship_vendor_branch`,`po_part_no`,`po_order_qty`,`po_order_rate`,`po_duedate`,`po_hsncode`, `po_gsttype`, `po_gstrate`, `po_cgst`, `po_sgst`, `po_igst`,`po_remark`,`internal_remark`, `po_insert_date`,`po_insert_by`,`po_full_date`,`po_transaction`,`terms_condition`,`quotation_detail`,`payment_terms`,`po_pending_qty`,`po_cost_center`,isVenMsme) VALUES (:advance_payment, :termsday,:approveStatus,:status_remark,:branch,:vendorname,:po_comment,:project_name,:currency,:exchange,:vendortype,:vendorid,:vendorbranch,:vendoraddress,:bill_id,:billaddress,:ship_id,:shipaddress,:ship_type,:shipvendorbranch,:componentkey,:qty,:rate,:duedate,:hsncode,:gsttype,:gstrate,:cgst,:sgst,:igst,:remark, :internal_remark,:insertdate,:insertedby,:fulldate,:transactionid,:termsandcondition,:quotationterms,:paymentterms,:qty,:costcenter,:isVenMsme)",
              {
                replacements: {
                  advance_payment: req.body.advancePayment,
                  termsday: req.body.termsday == "" ? 30 : req.body.termsday,
                  approveStatus: approveStatus,
                  status_remark: pendingRemark,
                  branch: req.branch,
                  vendorname: vendor_name,
                  insertdate: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD"),
                  fulldate: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm:ss"),
                  insertedby: req.logedINUser,
                  vendortype: req.body.vendor_type,
                  vendorid: vendor_code,
                  vendorbranch: req.body.vendor_branch,
                  vendoraddress: req.body.vendor_address.replace(/\n/g, "<br>"),

                  bill_id: bill_address_id,
                  billaddress: bill_address.replace(/\n/g, "<br>"),

                  ship_id: shipAddressId,
                  shipaddress: shipAddress,
                  ship_type: req.body.ship_type,
                  shipvendorbranch: shipVendorBranch,

                  componentkey: req.body.component[i],
                  qty: req.body.qty[i],
                  rate: req.body.rate[i],
                  currency: req.body.currency[i],
                  exchange:
                    req.body.currency[i] == "364907247"
                      ? 1
                      : req.body.exchange_rate[i],
                  duedate: req.body.date[i],
                  hsncode: req.body.hsn[i],
                  gsttype: req.body.gsttype[i],
                  gstrate: req.body.gstrate[i],
                  cgst: helper.gstCalculation(
                    req.body.gstrate[i],
                    req.body.rate[i] * req.body.qty[i],
                    req.body.gsttype[i]
                  ).cgst,
                  sgst: helper.gstCalculation(
                    req.body.gstrate[i],
                    req.body.rate[i] * req.body.qty[i],
                    req.body.gsttype[i]
                  ).sgst,
                  igst: helper.gstCalculation(
                    req.body.gstrate[i],
                    req.body.rate[i] * req.body.qty[i],
                    req.body.gsttype[i]
                  ).igst,
                  remark: req.body.remark[i],
                  internal_remark: req.body.internal_remark[i],

                  transactionid: req.body.poid,

                  termsandcondition: req.body.termsandcondition,
                  quotationterms: req.body.quotationterms,
                  paymentterms: req.body.paymentterms,
                  costcenter: req.body.costcenter,
                  project_name: req.body.projectname,
                  po_comment: req.body.pocomment,
                  isVenMsme: isVenMsme,
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: t,
              }
            );

            if (req.body.qty[i] == 0) {
              await t.rollback();
              return res.json({
                status: "error",
                message: "PO Order Qty couldn't be zero/0",
                success: false,
              });
            } else if (req.body.qty[i] < 0) {
              await t.rollback();
              return res.json({
                status: "error",
                message: "PO Order Qty couldn't be negative",
                success: false,
              });
            } else if (
              Number.isInteger(req.body.gstrate[i]) &&
              req.body.gstrate[i] < 0
            ) {
              await t.rollback();
              return res.json({
                status: "error",
                message:
                  req.body.gstrate[i] +
                  " PO GST Rate couldn't be decimal OR negative int",
                success: false,
              });
            } else if (
              req.body.gsttype[i] !== "L" &&
              req.body.gsttype[i] !== "I"
            ) {
              await t.rollback();
              return res.json({
                status: "error",
                message:
                  "PO GST Type couldn't be other than LOCAL or INTERSTATE",
                success: false,
              });
            } else {
              if (req.body.date[i] !== "") {
                if (
                  !helper.preg_match(
                    /^(0[1-9]|[1-2][0-9]|3[0-1])-(0[1-9]|1[0-2])-[0-9]{4}$/,
                    req.body.date[i]
                  )
                ) {
                  await t.rollback();
                  return res.json({
                    status: "error",
                    message: "PO Due Date couldn't be other than DD-MM-YYYY",
                    success: false,
                  });
                } else if (
                  moment(req.body.date[i], "DD-MM-YYYY").diff(
                    moment(new Date(), "DD-MM-YYYY"),
                    "days"
                  ) < 0
                ) {
                  await t.rollback();
                  return res.json({
                    status: "error",
                    message:
                      "PO Due Date couldn't be less than PO creating date",
                    success: false,
                  });
                } else if (
                  moment(req.body.date[i], "DD-MM-YYYY").diff(
                    moment(new Date(), "DD-MM-YYYY"),
                    "days"
                  ) == 0
                ) {
                  await t.rollback();
                  return res.json({
                    status: "error",
                    message:
                      "PO Due Date couldn't be equal to PO creating date",
                    success: false,
                  });
                } else {
                  let stmt5 = await invtDB.query(
                    "SELECT * FROM `components` WHERE `component_key` = :component_key",
                    {
                      replacements: { component_key: req.body.component[i] },
                      type: invtDB.QueryTypes.SELECT,
                    }
                  );
                  if (stmt5.length > 0) {
                    if (stmt5[0].c_is_enabled == "N") {
                      await t.rollback();
                      return res.json({
                        status: "error",
                        message:
                          "RM [" +
                          decode(stmt5[0].c_name) +
                          " / " +
                          stmt5[0].c_part_no +
                          "] can not be execute due to marked as disabled for any transactions",
                        success: false,
                      });
                    } else {
                      let stmt6 = await invtDB.query(
                        "UPDATE `components` SET `c_hsn` = :hsncode WHERE `component_key` = :component_key",
                        {
                          replacements: {
                            hsncode: req.body.hsn[i],
                            component_key: req.body.component[i],
                          },
                          type: invtDB.QueryTypes.UPDATE,
                          transaction: t,
                        }
                      );

                      // RECENT CHANGE: Added po_ship_type and po_ship_vendor_branch to UPDATE
                      let stmt7 = await invtDB.query(
                        "UPDATE `po_purchase_req` SET advance_payment = :advance_payment,  `po_vendor_name` = :vendorname, `po_ship_address` = :ship_address, `po_ship_id` = :ship_id, `po_ship_type` = :ship_type, `po_ship_vendor_branch` = :shipvendorbranch, `po_vendor_reg_id` = :vendorcode, `po_vendor_type` = :vendortype, `po_vendor_address` = :vendoraddress, `po_ven_add_id` = :vendorbranch, `terms_condition` = :termsandcondition, `quotation_detail` = :quotationterms, `payment_terms` = :paymentterms, `po_cost_center` = :costcenter, `po_billing_id` = :billingid,`po_billing_addr` = :billingaddress, `statusforporequest` = :status  WHERE `po_transaction` = :poid",
                        {
                          replacements: {
                            advance_payment: req.body.advancePayment,
                            vendorname: vendor_name,
                            ship_address: shipAddress, // RECENT CHANGE: Use processed shipAddress
                            ship_id: shipAddressId, // RECENT CHANGE: Use processed shipAddressId
                            ship_type: req.body.ship_type, // RECENT CHANGE: Store ship_type
                            shipvendorbranch: shipVendorBranch, // RECENT CHANGE: Store vendor branch ID
                            vendorcode: req.body.vendor_name,
                            vendortype: req.body.vendor_type,
                            vendoraddress: req.body.vendor_address.replace(
                              /\n/g,
                              "<br>"
                            ),
                            vendorbranch: req.body.vendor_branch,
                            termsandcondition: req.body.termsandcondition,
                            quotationterms: req.body.quotationterms,
                            paymentterms: req.body.paymentterms,
                            costcenter: req.body.costcenter,
                            poid: req.body.poid,
                            billingid: req.body.bill_address_id,
                            billingaddress: req.body.billaddress.replace(
                              /\n/g,
                              "<br>"
                            ),
                            status: newStatusForPoRequest,
                          },
                          type: invtDB.QueryTypes.UPDATE,
                          transaction: t,
                        }
                      );
                    }
                  } else {
                    await t.rollback();
                    return res.json({
                      status: "error",
                      message:
                        "some component can not be operate bcz of client issue please reload the browser OR contact to developer",
                      success: false,
                    });
                  }
                }
              } else {
                let stmt8 = await invtDB.query(
                  "SELECT * FROM `components` WHERE `component_key` = :component_key",
                  {
                    replacements: { component_key: req.body.component[i] },
                    type: invtDB.QueryTypes.SELECT,
                  }
                );
                if (stmt8.length > 0) {
                  if (stmt8[0].c_is_enabled == "N") {
                    await t.rollback();
                    return res.json({
                      status: "error",
                      message:
                        "RM [" +
                        decode(stmt8[0].c_name) +
                        " / " +
                        stmt8[0].c_part_no +
                        "] can not be execute due to marked as disabled for any transactions",
                      success: false,
                    });
                  } else {
                    let stmt9 = await invtDB.query(
                      "UPDATE `components` SET `c_hsn` = :hsncode WHERE `component_key` = :component_key",
                      {
                        replacements: {
                          hsncode: req.body.hsn[i],
                          component_key: req.body.component[i],
                        },
                        type: invtDB.QueryTypes.UPDATE,
                        transaction: t,
                      }
                    );

                    let stmt10 = await invtDB.query(
                      "UPDATE `po_purchase_req` SET advance_payment = :advance_payment, `po_vendor_name` = :vendorname, `po_comment` = :po_comment, `po_project_name` = :project_name, `po_ship_address` = :ship_address, `po_ship_id` = :ship_id, `po_ship_type` = :ship_type, `po_ship_vendor_branch` = :shipvendorbranch, `po_vendor_reg_id` = :vendorcode, `po_vendor_type` = :vendortype, `po_vendor_address` = :vendoraddress, `po_ven_add_id` = :vendorbranch, `terms_condition` = :termsandcondition, `quotation_detail` = :quotationterms, `payment_terms` = :paymentterms, `po_cost_center` = :costcenter , `po_billing_id` = :billingid,`po_billing_addr` = :billingaddres, `statusforporequest` = :status WHERE `po_transaction` = :poid",
                      {
                        replacements: {
                          advance_payment: req.body.advancePayment,
                          vendorname: vendor_name,
                          project_name: req.body.projectname,
                          po_comment: req.body.pocomment,
                          ship_address: shipAddress,
                          ship_id: shipAddressId,
                          ship_type: req.body.ship_type,
                          shipvendorbranch: shipVendorBranch,
                          vendorcode: req.body.vendor_name,
                          vendortype: req.body.vendor_type,
                          vendoraddress: req.body.vendor_address.replace(
                            /\n/g,
                            "<br>"
                          ),
                          vendorbranch: req.body.vendor_branch,
                          termsandcondition: req.body.termsandcondition,
                          quotationterms: req.body.quotationterms,
                          paymentterms: req.body.paymentterms,
                          costcenter: req.body.costcenter,
                          poid: req.body.poid,
                          billingid: req.body.bill_address_id,
                          billingaddres: req.body.billaddress.replace(
                            /\n/g,
                            "<br>"
                          ),
                          status: newStatusForPoRequest,
                        },
                        type: invtDB.QueryTypes.UPDATE,
                        transaction: t,
                      }
                    );
                  }
                } else {
                  await t.rollback();
                  return res.json({
                    status: "error",
                    message:
                      "some component can not be operate bcz of client issue please reload the browser OR contact to developer",
                    success: false,
                  });
                }
              }
            }
          } else {
            let updateStmt = await invtDB.query(
              "UPDATE `po_purchase_req` SET advance_payment = :advance_payment, `approval_status` = :approveStatus, `status_remark` = :status_remark,`po_vendor_name` = :vendorname, `po_comment` = :po_comment, `po_project_name` = :project_name, `po_currency` = :currency, `po_exchange` = :exchange , `po_vendor_type`= :vendortype, `po_vendor_reg_id` = :vendorid, `po_ven_add_id` = :vendorbranch, `po_vendor_address`= :vendoraddress, `po_ship_id` = :ship_id, `po_ship_address` = :ship_address, `po_ship_type` = :ship_type, `po_ship_vendor_branch` = :shipvendorbranch, `po_part_no`= :componentkey, `po_order_qty`= :qty, `po_order_rate`= :rate, `po_duedate`= :duedate, `po_hsncode`= :hsncode, `po_gsttype`= :gsttype, `po_gstrate`= :gstrate, `po_cgst`= :cgst, `po_sgst`= :sgst, `po_igst`= :igst, `po_remark`= :remark, `internal_remark`= :internal_remark, `terms_condition`= :termsandcondition, `quotation_detail`= :quotationterms, `payment_terms`= :paymentterms, `po_pending_qty` = :qty, `po_cost_center` = :costcenter, `po_billing_id` = :billingid,`po_billing_addr` = :billingaddress,`statusforporequest` = :status , `ship_partyname` = :ship_partyname,   `ship_other_pan` = :ship_other_pan, `ship_other_gstin` = :ship_other_gstin   WHERE `ID`= :rowid AND `po_transaction`= :poid",
              {
                replacements: {
                  advance_payment: req.body.advancePayment,
                  approveStatus: approveStatus,
                  status_remark: pendingRemark,
                  vendorname: vendor_name,
                  po_comment: req.body.pocomment,
                  project_name: req.body.projectname,
                  vendortype: req.body.vendor_type,
                  vendorid: req.body.vendor_name,
                  vendoraddress: req.body.vendor_address.replace(/\n/g, "<br>"),
                  vendorbranch: req.body.vendor_branch,
                  ship_id: shipAddressId,
                  ship_address: shipAddress,
                  ship_type: req.body.ship_type,
                  shipvendorbranch: shipVendorBranch,
                  componentkey: req.body.component[i],
                  qty: req.body.qty[i],
                  rate: req.body.rate[i],
                  currency: req.body.currency[i],
                  exchange:
                    req.body.currency[i] == "364907247"
                      ? 1
                      : req.body.exchange_rate[i],
                  duedate: req.body.date[i],
                  hsncode: req.body.hsn[i],
                  gsttype: req.body.gsttype[i],
                  gstrate: req.body.gstrate[i],
                  cgst: helper.gstCalculation(
                    req.body.gstrate[i],
                    req.body.rate[i] * req.body.qty[i],
                    req.body.gsttype[i]
                  ).cgst,
                  sgst: helper.gstCalculation(
                    req.body.gstrate[i],
                    req.body.rate[i] * req.body.qty[i],
                    req.body.gsttype[i]
                  ).sgst,
                  igst: helper.gstCalculation(
                    req.body.gstrate[i],
                    req.body.rate[i] * req.body.qty[i],
                    req.body.gsttype[i]
                  ).igst,
                  remark: req.body.remark[i],
                  internal_remark: req.body.internal_remark[i],
                  termsandcondition: req.body.termsandcondition,
                  quotationterms: req.body.quotationterms,
                  paymentterms: req.body.paymentterms,
                  costcenter: req.body.costcenter,
                  rowid: req.body.updaterow[i],
                  poid: req.body.poid,
                  billingid: req.body.bill_address_id,
                  billingaddress: req.body.billaddress.replace(/\n/g, "<br>"),
                  status: newStatusForPoRequest,
                  ship_partyname: shipPartyName,
                  ship_other_pan: shipOtherPan,
                  ship_other_gstin: shipOtherGstin,
                },
                type: invtDB.QueryTypes.UPDATE,
                transaction: t,
              }
            );

            if (req.body.qty[i] == 0) {
              await t.rollback();
              return res.json({
                status: "error",
                message: "PO Order Qty couldn't be zero/0",
                success: false,
              });
            } else if (req.body.qty[i] < 0) {
              await t.rollback();
              return res.json({
                status: "error",
                message: "PO Order Qty couldn't be negative",
                success: false,
              });
            } else if (
              Number.isInteger(req.body.gstrate[i]) &&
              req.body.gstrate[i] < 0
            ) {
              await t.rollback();
              return res.json({
                status: "error",
                message:
                  req.body.gstrate[i] +
                  " PO GST Rate couldn't be decimal OR negative int",
                success: false,
              });
            } else if (
              req.body.gsttype[i] !== "L" &&
              req.body.gsttype[i] !== "I"
            ) {
              await t.rollback();
              return res.json({
                status: "error",
                message:
                  "PO GST Type couldn't be other than LOCAL or INTERSTATE",
                success: false,
              });
            } else {
              if (req.body.date[i] !== "") {
                if (
                  !helper.preg_match(
                    /^(0[1-9]|[1-2][0-9]|3[0-1])-(0[1-9]|1[0-2])-[0-9]{4}$/,
                    req.body.date[i]
                  )
                ) {
                  await t.rollback();
                  return res.json({
                    status: "error",
                    message: "PO Due Date couldn't be other than DD-MM-YYYY",
                    success: false,
                  });
                } else if (
                  moment(req.body.date[i], "DD-MM-YYYY").diff(
                    moment(new Date(), "DD-MM-YYYY"),
                    "days"
                  ) < 0
                ) {
                  await t.rollback();
                  return res.json({
                    status: "error",
                    message:
                      "PO Due Date couldn't be less than PO creating date",
                    success: false,
                  });
                } else if (
                  moment(req.body.date[i], "DD-MM-YYYY").diff(
                    moment(new Date(), "DD-MM-YYYY"),
                    "days"
                  ) == 0
                ) {
                  await t.rollback();
                  return res.json({
                    status: "error",
                    message:
                      "PO Due Date couldn't be equal to PO creating date",
                    success: false,
                  });
                } else {
                  let stmt11 = await invtDB.query(
                    "SELECT * FROM `components` WHERE `component_key` = :component_key",
                    {
                      replacements: { component_key: req.body.component[i] },
                      type: invtDB.QueryTypes.SELECT,
                    }
                  );
                  if (stmt11.length > 0) {
                    if (stmt11[0].c_is_enabled == "N") {
                      await t.rollback();
                      return res.json({
                        status: "error",
                        message:
                          "RM [" +
                          decode(stmt11[0].c_name) +
                          " / " +
                          stmt11[0].c_part_no +
                          "] can not be execute due to marked as disabled for any transactions",
                        success: false,
                      });
                    } else {
                      let stmt12 = await invtDB.query(
                        "UPDATE `components` SET `c_hsn` = :hsncode WHERE `component_key` = :component_key",
                        {
                          replacements: {
                            hsncode: req.body.hsn[i],
                            component_key: req.body.component[i],
                          },
                          type: invtDB.QueryTypes.UPDATE,
                          transaction: t,
                        }
                      );
                      // RECENT CHANGE: Added po_ship_type and po_ship_vendor_branch to UPDATE
                      let stmt13 = await invtDB.query(
                        "UPDATE `po_purchase_req` SET advance_payment = :advance_payment, `po_vendor_name` = :vendorname, `po_comment` = :po_comment, `po_project_name` = :project_name, `po_ship_address` = :ship_address, `po_ship_id` = :ship_id, `po_ship_type` = :ship_type, `po_ship_vendor_branch` = :shipvendorbranch, `po_vendor_reg_id` = :vendorcode, `po_vendor_type` = :vendortype, `po_vendor_address` = :vendoraddress, `po_ven_add_id` = :vendorbranch, `terms_condition` = :termsandcondition, `quotation_detail` = :quotationterms, `payment_terms` = :paymentterms, `po_cost_center` = :costcenter , `po_billing_id` = :billingid,`po_billing_addr` = :billingaddress WHERE `po_transaction` = :poid",
                        {
                          replacements: {
                            advance_payment: req.body.advancePayment,
                            vendorname: vendor_name,
                            po_comment: req.body.pocomment,
                            project_name: req.body.projectname,
                            ship_address: shipAddress, // RECENT CHANGE: Use processed shipAddress
                            ship_id: shipAddressId, // RECENT CHANGE: Use processed shipAddressId
                            ship_type: req.body.ship_type, // RECENT CHANGE: Store ship_type
                            shipvendorbranch: shipVendorBranch, // RECENT CHANGE: Store vendor branch ID
                            vendorcode: req.body.vendor_name,
                            vendortype: req.body.vendor_type,
                            vendoraddress: req.body.vendor_address.replace(
                              /\n/g,
                              "<br>"
                            ),
                            vendorbranch: req.body.vendor_branch,
                            termsandcondition: req.body.termsandcondition,
                            quotationterms: req.body.quotationterms,
                            paymentterms: req.body.paymentterms,
                            costcenter: req.body.costcenter,
                            poid: req.body.poid,
                            billingid: req.body.bill_address_id,
                            billingaddress: req.body.billaddress.replace(
                              /\n/g,
                              "<br>"
                            ),
                          },
                          type: invtDB.QueryTypes.UPDATE,
                          transaction: t,
                        }
                      );
                    }
                  } else {
                    await t.rollback();
                    return res.json({
                      status: "error",
                      message:
                        "some component can not be operate bcz of client issue please reload the browser OR contact to developer",
                      success: false,
                    });
                  }
                }
              } else {
                let stmt14 = await invtDB.query(
                  "UPDATE `components` SET `c_hsn` = :hsncode WHERE `component_key` = :component_key",
                  {
                    replacements: {
                      hsncode: req.body.hsn[i],
                      component_key: req.body.component[i],
                    },
                    type: invtDB.QueryTypes.UPDATE,
                    transaction: t,
                  }
                );

                let stmt15 = await invtDB.query(
                  "UPDATE `po_purchase_req` SET advance_payment = :advance_payment, `po_vendor_name` = :vendorname, `po_ship_address` = :ship_address, `po_ship_id` = :ship_id, `po_ship_type` = :ship_type, `po_ship_vendor_branch` = :shipvendorbranch, `po_vendor_reg_id` = :vendorcode, `po_vendor_type` = :vendortype, `po_vendor_address` = :vendoraddress, `po_ven_add_id` = :vendorbranch, `terms_condition` = :termsandcondition, `quotation_detail` = :quotationterms, `payment_terms` = :paymentterms, `po_cost_center` = :costcenter, `po_billing_id` = :billingid,`po_billing_addr` = :billingaddress WHERE `po_transaction` = :poid",
                  {
                    replacements: {
                      advance_payment: req.body.advancePayment,
                      vendorname: vendor_name,
                      ship_address: shipAddress,
                      ship_id: shipAddressId,
                      ship_type: req.body.ship_type,
                      shipvendorbranch: shipVendorBranch,
                      vendorcode: req.body.vendor_name,
                      vendortype: req.body.vendor_type,
                      vendoraddress: req.body.vendor_address.replace(
                        /\n/g,
                        "<br>"
                      ),
                      vendorbranch: req.body.vendor_branch,
                      termsandcondition: req.body.termsandcondition,
                      quotationterms: req.body.quotationterms,
                      paymentterms: req.body.paymentterms,
                      costcenter: req.body.costcenter,
                      poid: req.body.poid,
                      billingid: req.body.bill_address_id,
                      billingaddress: req.body.billaddress.replace(
                        /\n/g,
                        "<br>"
                      ),
                    },
                    type: invtDB.QueryTypes.UPDATE,
                    transaction: t,
                  }
                );
              }
            }
          }
        }
        await t.commit();
        return res.json({
          status: "success",
          message: "PO Updated Successfully",
          success: true,
        });
      } else {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "PO has been closed therefore it can't be update",
        });
      }
    } catch (err) {
      await t.rollback();
      return helper.errorResponse(res, err);
    }
  }
);

// PRINT PURCHASE ORDER
router.post("/printPo", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    POID: "required",
    subject: "required",
    mail: "required",
    recipient: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: "something you missing in form field to supply",
      status: "error",
    });
  }

  let recip_str = req.body.recipient;
  let recip_arr = recip_str.split(",");

  let attachments = [
    {
      // stream as an attachment
      filename: "text4.txt",
      content: fs.createReadStream("file.txt"),
    },
  ];

  if (
    helper.sendMail(
      recip_arr,
      null,
      req.body.subject,
      req.body.mail,
      attachments
    )
  ) {
    return res.json({
      success: true,
      message: "Mail Send Successfully",
      status: "success",
    });
  } else {
    return res.json({ success: false, message: "somenthing", status: "error" });
  }
});

//FETCH ALL COMPONENT DETAILS AVAILABLE IN PO FOR MIN
router.post("/fetchData4MIN", [auth.isAuthorized], async (req, res) => {
  const po_transaction = req.body.pono;
  const validation = new Validator(req.body, {
    pono: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      status: "error",
    });
    return;
  }

  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :transaction AND `company_branch` = :branch GROUP BY po_part_no, po_transaction",
      {
        replacements: {
          transaction: po_transaction,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt1.length > 0) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :transaction AND `po_status` = :status AND `company_branch` = :branch GROUP BY po_part_no, po_transaction",
        {
          replacements: {
            transaction: po_transaction,
            branch: req.branch,
            status: "A",
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt2.length > 0) {
        let stmt3 = await invtDB.query(
          "SELECT * FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` LEFT JOIN `units` ON units.units_id = components.c_uom LEFT JOIN `ven_address_detail` ON `po_purchase_req`.`po_ven_add_id` = `ven_address_detail`.`ven_address_id` LEFT JOIN `ven_basic_detail` ON `po_purchase_req`.`po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `po_purchase_req`.`po_transaction` = :transaction AND `po_purchase_req`.`po_part_status` = :part_status AND `po_purchase_req`.`company_branch` = :branch",
          {
            replacements: {
              transaction: po_transaction,
              part_status: "ACTIVE",
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        const data = [];
        let count = 0;

        // let fre_stmt = await invtDB.query("SELECT c_part_no,c_name,c_name,units_name,component_key FROM components LEFT JOIN units ON units.units_id = components.c_uom WHERE c_type= 'S' AND components.component_key = '20210626121124'", {
        //   type: invtDB.QueryTypes.SELECT,
        // });

        stmt3.map(async (item) => {
          let stmt4 = await invtDB.query(
            "SELECT *, COALESCE(SUM(`qty`+`other_qty`),0) `totalIN_Qty` FROM `rm_location` WHERE `in_po_transaction_id` = :poid AND `components_id` = :partno AND `trans_type` = 'INWARD' AND `company_branch` = :branch",
            {
              replacements: {
                poid: po_transaction,
                partno: item.po_part_no,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let totalINQTY;
          if (stmt4.length > 0) {
            totalINQTY = helper.number(stmt4[0].totalIN_Qty);
          } else {
            totalINQTY = 0;
          }
          let vendor_type;
          if (item.po_vendor_type == "v01") {
            vendor_type = "Vendor";
          } else if (item.po_vendor_type == "jwi") {
            vendor_type = "JOBWORK";
          } else if (item.po_vendor_type == "s01") {
            vendor_type = "SortIn";
          } else if (item.po_vendor_type == "r01") {
            vendor_type = "RejectionIn";
          } else if (item.po_vendor_type == "p01") {
            vendor_type = "ProdReturn";
          } else {
            vendor_type = "N/A";
          }

          data.push({
            serial_no: count + 1,
            hsncode: item.po_hsncode,
            gstrate: item.po_gstrate,
            gsttype: item.po_gsttype,
            orderid: item.po_transaction,
            component_fullname: decode(item.c_name),
            component_shortname: helper.truncateWithEllipse(item.c_name, 30),
            unitsname: item.units_name,
            componentKey: item.component_key,
            partcode: item.po_part_no,
            orderqty: helper.number(item.po_order_qty) - totalINQTY,
            orderrate: helper.number(item.po_order_rate),
            exchange_rate: helper.number(item.po_exchange),
            usdValue:
              helper.number(item.po_order_rate) *
              helper.number(item.po_order_qty) *
              helper.number(item.po_exchange),
            currency: item.po_currency,
            orderduedate: item.po_duedate,
            orderremark: item.po_remark,
            c_partno: item.c_part_no,
            totalValue:
              (helper.number(item.po_order_qty) - totalINQTY) *
              helper.number(item.po_order_rate),
          });
          count++;

          if (stmt3.length == count) {
            res.json({
              status: "success",
              success: true,
              data: {
                materials: data,
                vendor_type: {
                  vendorname: item.ven_name,
                  vendorcode: item.po_vendor_reg_id,
                  vendortype:
                    item.po_vendor_type == "v01"
                      ? "Vendor"
                      : item.po_vendor_type == "jwi"
                      ? "JOBWORK"
                      : item.po_vendor_type == "s01"
                      ? "SortIn"
                      : item.po_vendor_type == "r01"
                      ? "RejectionIn"
                      : item.po_vendor_type == "p01"
                      ? "ProdReturn"
                      : "N/A",
                  gstin: item.ven_add_gst,
                  vendoraddress: item.po_vendor_address,
                },
              },
            });
            return;
          }
        });
      } else {
        res.json({
          success: false,
          message: "No PO found",
          status: "error",
        });
        return true;
      }
    } else {
      res.json({
        success: true,
        message: "PO has been closed therefore it can't be update.",
        status: "error",
      });
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
  // next();
});

// FETCH PURCHASE ORDER STATUS
router.post("/createCostCenter", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    code: "required",
    name: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: "something you missing in form field to supply" ,
      data: validation.errors.all(),
      status: "error",
    });
  }

  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `cost_center` WHERE `cost_center_short_name` = :cost_id OR `cost_center_name` = :cost_name",
      {
        replacements: {
          cost_id: req.body.code,
          cost_name: req.body.name,
        },
        type: invtDB.QueryTypes.SELECT
      }
    );

    if (stmt1.length > 0) {
      return res.json({
        success: false,
        message: "seems cost id or cost name are already exist in our records",
        status: "error",
      });
    } else {
      await invtDB.query(
        "INSERT INTO `cost_center` (`cost_center_name`, `cost_center_short_name`, `cost_center_key`, `cost_center_indt`, `cost_center_inby`) VALUES (:cost_name, :cost_short_name, :cost_id, :in_date, :in_by)",
        {
          replacements: {
            cost_name: req.body.name,
            cost_short_name: req.body.code,
            cost_id: helper.getUniqueNumber(),
            in_date: moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss"),
            in_by: req.logedINUser,
          },
          type: invtDB.QueryTypes.INSERT
        }
      );
      return  res.json({
        success: true,
        message: "cost center created successfully",
        status: "success",
      });
    }
  } catch (err) {
     return helper.errorResponse(res, err); }
});

// INSERT PURCHASE ORDER
router.post(
  "/poMIN",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const validation = new Validator(req.body, {
      poid: "required",
    });

    if (validation.fails()) {
      res.json({
        success: false,
        message: "something you missing in form field to supply",
        status: "error",
      });
      return;
    }
    let itemLength = req.body.component.length;
    for (let i = 0; i < itemLength; i++) {
      let itemValidation = new Validator(
        {
          item: req.body.component[i],
          qty: req.body.qty[i],
          rate: req.body.rate[i],
          exchangeCurr: req.body.currency[i],
          gst_rate: req.body.gstrate[i],
          gst_type: req.body.gsttype[i],
        },
        {
          item: "required",
          qty: "required|not_in:0",
          rate: "required",
          exchangeCurr: "required",
          gst_rate: "required",
          gst_type: [
            "required_if:gst_rate,!=,0",
            "required_if:gst_rate,!=,I",
            "required_if:gst_rate,!=,L",
          ],
        }
      );
      if (itemValidation.fails()) {
        res.json({
          success: false,
          message: helper.validationError(itemValidation.errors.all()),
          status: "error",
        });
        return;
      }
    }

    const t = await invtDB.transaction();
    let out_txn_no = helper.getUniqueNumber(); //Transaction OUT ID
    try {
      let stmt1 = await invtDB.query(
        "SELECT `branch_code` FROM `branches` WHERE `branch_code` = :branchcode",
        {
          replacements: {
            branchcode: req.branch,
            status: "C",
          },
          type: invtDB.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (stmt1.length > 0 || 1) {
        let in_txn_no;
        let stmt2 = await invtDB.query(
          "SELECT * FROM `ims_numbering` WHERE `for_number` = 'MIN' FOR UPDATE",
          { transaction: t, type: invtDB.QueryTypes.SELECT }
        );

        if (stmt2.length > 0) {
          var suffix = stmt2[0].suffix;
          suffix = parseInt(suffix) + 1;
          suffix = suffix.toString();
          suffix = suffix.padStart(parseInt(stmt2[0].number_length_limit), "0");
          in_txn_no = stmt2[0].prefix + "/" + stmt2[0].session + "/" + suffix;
        } else {
          let currYear = parseInt(
            new Date().getFullYear().toString().substr(2, 2)
          );
          in_txn_no = "MIN/" + currYear + "-" + (currYear + 1) + "/0001";
        }
        await invtDB.query(
          "UPDATE `ims_numbering` SET `suffix` = `suffix`+1 WHERE `for_number` = 'MIN'",
          { transaction: t, type: invtDB.QueryTypes.UPDATE }
        );

        let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");

        let get_transaction_id = await invtDB.query(
          "SELECT `transaction_id` FROM `transaction_ids` WHERE `transaction_id` = :transaction_id LIMIT 1",
          {
            replacements: { transaction_id: in_txn_no },
            transaction: t,
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (get_transaction_id.length > 0) {
          t.rollback();
          res.json({
            success: false,
            message:
              "alloting transaction id as [" +
              in_txn_no +
              "] for MIN has already mapped, required manual checking or contact to system administrator.",
            status: "error",
          });
          return;
        } else {
          let stmt3 = await invtDB.query(
            "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :po_transaction AND `company_branch` = :branch",
            {
              replacements: {
                po_transaction: req.body.poid,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt3.length > 0) {
            let checkVendor = await invtDB.query(
              "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor_id",
              {
                replacements: { vendor_id: stmt3[0].po_vendor_reg_id },
                type: invtDB.QueryTypes.SELECT,
              }
            );

            if (checkVendor.length == 0) {
              t.rollback();
              res.json({
                success: false,
                message: "Vendor not found",
                status: "warning",
              });
              return;
            }

            /* if (checkVendor[0].ven_einvoice_status == 'Y' && (req.body.irn === '' || req.body.irn.length !== 15)) {
            t.rollback();
            res.json({ success:false, message: "Please enter valid Acknowledgement number" }, status: "warning" });
            return;
          } */

            for (let i = 0; i < itemLength; i++) {
              if (req.body.invoice[i] !== "") {
                if (req.body.location[i] == "0") {
                  t.rollback();
                  res.json({
                    success: false,
                    message: "you might left some location to select",
                    status: "error",
                  });
                  return;
                }
                let stmt4 = await invtDB.query(
                  "INSERT INTO `rm_location` (manual_mfg_code, `in_module`,`in_vendor_addr`,`in_vendor_branch`,`company_branch`,`currency_type`,`exchange_rate`,`in_gst_cgst`,`in_gst_sgst`,`in_gst_igst`,`in_hsn_code`,`vendor_type`,`components_id`,`in_po_rate`,`qty`,`loc_in`,`any_remark`,`insert_date`,`insert_by`,`in_transaction_id`,`in_po_transaction_id`,`in_po_invoice_id`,`trans_type`,`in_vendor_name`,`in_gst_rate`,`in_gst_type`,`is_auto_cons`, rm_loc_project_id , rm_loc_cost_center, eInv_applicability, ackwlg_irn, qr_status)VALUES (:manual_mfg_code,'IN-PO',:ven_address,:ven_branch,:branch,:currency,:exchange,:cgst,:sgst,:igst,:hsncode,:vendor_type,:component,:po_rate,:qty,:location_in,:remark,:insertdate,:insertby,:in_transaction_id,:po_transaction_id,:po_invoice_id,:in_type,:vendor_name,:gstrate,:gsttype,'N' , :rm_loc_project_id , :rm_loc_cost_center,  :einv_applicability, :ackwlg_irn, :qr_status)",
                  {
                    replacements: {
                      manual_mfg_code: req.body.manual_mfg_code[i] ?? "--",
                      rm_loc_project_id: stmt3[0].po_project_name,
                      rm_loc_cost_center: stmt3[0].po_cost_center,
                      ven_address: stmt3[0].po_vendor_address,
                      ven_branch: stmt3[0].po_ven_add_id,
                      branch: req.branch,
                      currency: req.body.currency[i],
                      exchange:
                        req.body.currency[i] == "364907247"
                          ? 1
                          : req.body.exchange[i],
                      cgst: `${
                        helper.gstCalculation(
                          req.body.gstrate[i],
                          req.body.rate[i] * req.body.qty[i],
                          req.body.gsttype[i]
                        ).cgst
                      }`,
                      sgst: `${
                        helper.gstCalculation(
                          req.body.gstrate[i],
                          req.body.rate[i] * req.body.qty[i],
                          req.body.gsttype[i]
                        ).sgst
                      }`,
                      igst: `${
                        helper.gstCalculation(
                          req.body.gstrate[i],
                          req.body.rate[i] * req.body.qty[i],
                          req.body.gsttype[i]
                        ).igst
                      }`,
                      hsncode: req.body.hsncode[i],
                      vendor_type: stmt3[0].po_vendor_type,
                      component: req.body.component[i],
                      po_rate:
                        req.body.currency[i] == "364907247"
                          ? Number(req.body.rate[i])
                          : Number(req.body.rate[i]),
                      qty: req.body.qty[i],
                      location_in: req.body.location[i],
                      remark:
                        req.body.remark[i] == "" ? "--" : req.body.remark[i],
                      insertdate: insert_dt,
                      insertby: req.logedINUser,
                      in_transaction_id: in_txn_no,
                      po_transaction_id: req.body.poid,
                      po_invoice_id: req.body.invoice[i],
                      in_type: "INWARD",
                      vendor_name: stmt3[0].po_vendor_reg_id,
                      gstrate: req.body.gstrate[i],
                      gsttype: req.body.gsttype[i],
                      einv_applicability: checkVendor[0].ven_einvoice_status,
                      ackwlg_irn: req.body.irn ?? "--",
                      qr_status: req.body.qrScan ?? "--",
                    },
                    type: invtDB.QueryTypes.INSERT,
                    transaction: t,
                  }
                );
                // Auto Consump
                if (req.body.out_location[i] !== 0) {
                  let stmt4 = await invtDB.query(
                    "INSERT INTO `rm_location` (`company_branch`,`trans_type`,`components_id`,`loc_in`,`loc_out`,`qty`,`insert_date`,`insert_by`,`in_transaction_id`,`out_transaction_id`,`is_auto_cons`, any_remark)VALUES (:branch,:type,:component,:loc_in,:loc_out,:qty,:indate,:inby,:in_transaction_id,:out_transaction_id,'Y', :remark)",
                    {
                      replacements: {
                        branch: req.branch,
                        type: "ISSUE",
                        component: req.body.component[i],
                        loc_in: req.body.out_location[i],
                        loc_out: req.body.location[i],
                        qty: req.body.qty[i],
                        indate: insert_dt,
                        inby: req.logedINUser,
                        in_transaction_id: in_txn_no,
                        out_transaction_id: out_txn_no,
                        remark:
                          req.body.remark[i] == "" ? "--" : req.body.remark[i],
                      },
                      type: invtDB.QueryTypes.INSERT,
                      transaction: t,
                    }
                  );
                }

                if (
                  req.body.invoiceDate[i] == "" &&
                  !helper.preg_match(
                    /^(0[1-9]|[1-2][0-9]|3[0-1])-(0[1-9]|1[0-2])-[0-9]{4}$/,
                    req.body.invoiceDate[i]
                  )
                ) {
                  t.rollback();
                  res.json({
                    success: false,
                    message:
                      "Pls recheck the invoice date, It should be in 'DD-MM-YYYY' format OR would not be empty",
                    status: "error",
                  });
                  return;
                } else {
                  let stmt6 = await invtDB.query(
                    "SELECT `currency_id` FROM `ims_currency` WHERE `currency_id`  = :currency",
                    {
                      replacements: { currency: req.body.currency[i] },
                      type: invtDB.QueryTypes.SELECT,
                      transaction: t,
                    }
                  );
                  if (stmt6.length > 0) {
                    if (
                      req.body.qty[i] !== "" &&
                      req.body.qty[i] !== "0" &&
                      req.body.invoice[i] !== ""
                    ) {
                      let stmt7 = await invtDB.query(
                        "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `totalIN_QTY` FROM `rm_location` WHERE `components_id` = :component AND `in_po_transaction_id` = :po_transaction_id AND `trans_type` = 'INWARD' AND `company_branch` = :branch",
                        {
                          replacements: {
                            component: req.body.component[i],
                            po_transaction_id: req.body.poid,
                            branch: req.branch,
                          },
                          type: invtDB.QueryTypes.SELECT,
                        }
                      );

                      let totalInward;
                      if (stmt7.length > 0) {
                        totalInward = helper.number(stmt7[0].totalIN_QTY);
                      } else {
                        totalInward = 0;
                      }

                      let stmt8 = await invtDB.query(
                        "SELECT * FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` WHERE `po_purchase_req`.`po_part_status` = 'ACTIVE' AND `po_purchase_req`.`po_transaction` = :po_transaction_id AND `po_purchase_req`.`po_part_no` = :component AND `po_purchase_req`.`company_branch` = :branch",
                        {
                          replacements: {
                            po_transaction_id: req.body.poid,
                            component: req.body.component[i],
                            branch: req.branch,
                          },
                          type: invtDB.QueryTypes.SELECT,
                        }
                      );
                      if (stmt8.length > 0) {
                        if (
                          helper.number(stmt8[0].po_order_qty) >=
                          helper.number(
                            totalInward + helper.number(req.body.qty[i])
                          )
                        ) {
                          if (req.body.location[i] == "") {
                            t.rollback();
                            res.json({
                              success: false,
                              message:
                                "supply the valid inwarding location for MIN partcode " +
                                stmt8[0].c_part_no,
                              status: "error",
                            });
                            return;
                          } else if (req.body.invoice[i] == "") {
                            t.rollback();
                            res.json({
                              success: false,
                              message:
                                "supply the valid Invoice ID for MIN partcode " +
                                stmt8[0].c_part_no,
                              status: "error",
                            });
                            return;
                          } else if (req.body.qty[i] < 0) {
                            t.rollback();
                            res.json({
                              success: false,
                              message:
                                "MIN quantity couldn't be in negative for MIN partcode " +
                                stmt8[0].c_part_no,
                              status: "error",
                            });
                            return;
                          } else if (req.body.hsncode[i] == "") {
                            t.rollback();
                            res.json({
                              success: false,
                              message:
                                "HSN code is mandatory to supply for MIN partcode " +
                                stmt8[0].c_part_no,
                              status: "error",
                            });
                            return;
                          } else if (
                            req.body.gsttype[i] !== "L" &&
                            req.body.gsttype[i] !== "I"
                          ) {
                            t.rollback();
                            res.json({
                              success: false,
                              message:
                                "GST type is not valid for MIN partcode " +
                                stmt8[0].c_part_no,
                              status: "error",
                            });
                            return;
                          } else if (req.body.gstrate[i] == "") {
                            t.rollback();
                            res.json({
                              success: false,
                              message:
                                "GST rate is mandatory to supply for MIN partcode " +
                                stmt8[0].c_part_no,
                              status: "error",
                            });
                            return;
                          } else {
                            let stmt9 = await invtDB.query(
                              "UPDATE `components` SET `c_hsn` = :hsncode WHERE `component_key` = :component_key",
                              {
                                replacements: {
                                  hsncode: req.body.hsncode[i],
                                  component_key: req.body.component[i],
                                },
                                type: invtDB.QueryTypes.UPDATE,
                                transaction: t,
                              }
                            );
                            let stmt10 = await invtDB.query(
                              "UPDATE `po_purchase_req` SET `po_pending_qty` = po_pending_qty - :outward_qty, `po_inward_qty`= po_inward_qty + :inward_qty WHERE `po_part_no` = :components AND `po_transaction` = :po_id",
                              {
                                replacements: {
                                  outward_qty: req.body.qty[i],
                                  inward_qty: req.body.qty[i],
                                  components: req.body.component[i],
                                  po_id: req.body.poid,
                                },
                                type: invtDB.QueryTypes.UPDATE,
                                transaction: t,
                              }
                            );
                          }
                        } else {
                          if (totalInward == 0) {
                            t.rollback();
                            res.json({
                              success: false,
                              message:
                                totalInward +
                                " MIN quantity should be less than to the total PO order quantity & the PO order quantity for partcode " +
                                stmt8[0].c_part_no,
                              status: "error",
                            });
                          } else {
                            t.rollback();
                            res.json({
                              success: false,
                              message:
                                "MIN quantity should be less than to the total PO Order quantity & you have already inwarded [" +
                                totalInward +
                                "] QTY in partcode [" +
                                stmt8[0].c_part_no +
                                "]",
                              status: "error",
                            });
                          }
                        }
                      }
                    }
                  } else {
                    t.rollback();
                    res.json({
                      success: false,
                      message: "currency either inactive or not exist with us",
                      status: "error",
                    });
                    return;
                  }
                }
              }
            }
            let str = req.body.invoices;
            let arr = str.split(",");
            let fileLength = arr.length;
            for (let i = 0; i < fileLength; i++) {
              let insert_date = moment(new Date())
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD HH:mm:ss");
              let insert_res_2 = await invtDB.query(
                "INSERT INTO `ims_min_invoices` (`min_inv_file`, `min_inv_by`, `min_inv_dt`, `min_min_id`) VALUES(:fileurl, :invby, :invdate, :minid)",
                {
                  replacements: {
                    fileurl: arr[i],
                    invby: req.logedINUser,
                    invdate: insert_date,
                    minid: in_txn_no,
                  },
                  type: invtDB.QueryTypes.INSERT,
                  transaction: t,
                }
              );
            }

            //
            let finalCheck = await invtDB.query(
              "INSERT INTO transaction_ids (transaction_id, module_type) SELECT * FROM (SELECT :txn, 'MIN-PO') AS tmp WHERE NOT EXISTS ( SELECT transaction_id FROM transaction_ids WHERE transaction_id = :txn ) LIMIT 1",
              {
                replacements: { txn: in_txn_no },
                type: invtDB.QueryTypes.INSERT,
              }
            );
            if (finalCheck.length > 0) {
              let po_log = await invtDB.query(
                "INSERT INTO `po_status_log`(`po_id`, `min_no`, `po_log_status`, `insert_dt`, `insert_time`, `insert_by`) VALUES ( :poid, :minno, :status, :insert_dt, :insert_time, :insert_by )",
                {
                  replacements: {
                    poid: req.body.poid,
                    minno: in_txn_no,
                    status: "--",
                    insert_dt: moment(new Date()).format("YYYY-MM-DD"),
                    insert_time: moment(new Date()).format("HH:mm:ss"),
                    insert_by: req.logedINUser,
                  },
                  type: invtDB.QueryTypes.INSERT,
                  transaction: t,
                }
              );
              await t.commit();
              // Integrated API logic
              let payload = { Data: [] };
              let apiStatus = null;
              let externalResult;
              try {
                const data = [];
                const itemLength = req.body.component?.length || 0;

                for (let i = 0; i < itemLength; i++) {
                  let partCodeName = "";
                  let partname = "";
                  if (req.body.component[i]) {
                    const componentResult = await invtDB.query(
                      "SELECT c_part_no, c_name FROM `components` WHERE `component_key` = :partCode LIMIT 1",
                      {
                        replacements: { partCode: req.body.component[i] },
                        type: invtDB.QueryTypes.SELECT,
                      }
                    );
                    partCodeName =
                      componentResult.length > 0
                        ? componentResult[0].c_part_no
                        : "";
                    partname =
                      componentResult.length > 0
                        ? componentResult[0].c_name
                        : "";
                  }

                  data.push({
                    PARTCode: partCodeName,
                    PARTCodeName: partname,
                    VendorName:
                      req.body.vendortype === "p01"
                        ? "--"
                        : req.body.vendor || "--",
                    InvoiceDate: moment(
                      req.body.invoiceDate?.[i] || insert_dt,
                      "DD-MM-YYYY"
                    ).format("YYYY/MM/DD HH:mm:ss"),
                    MinNumber: in_txn_no,
                    UNIT: isNaN(parseInt(req.body.qty[i]))
                      ? 0
                      : parseInt(req.body.qty[i]),
                    Rate: isNaN(parseFloat(req.body.rate[i]))
                      ? 0
                      : parseFloat(req.body.rate[i]),
                    MINDate: moment(insert_dt).format("YYYY/MM/DD HH:mm:ss"),
                  });
                }

                payload = { Data: data };

                console.log(
                  "Payload for external API:",
                  JSON.stringify(payload, null, 2)
                );

                const response = await axios.post(
                  "http://dev.oakter.co:84/Oakter/Report/SaveComponentInwardData",
                  payload,
                  {
                    headers: { "Content-Type": "application/json" },
                  }
                );

                console.log("API Response:", response.data);

                apiStatus =
                  response.data.OverAllStatus === "PASS" ? "PASS" : "FAIL";

                try {
                  await invtDB.query(
                    "INSERT INTO api_payload_log (min_number, api_status, payload, log_dt) VALUES (:minNumber, :apiStatus, :payload, :log_dt)",
                    {
                      replacements: {
                        minNumber: in_txn_no,
                        apiStatus: apiStatus,
                        payload: JSON.stringify(payload),
                        log_dt: moment(insert_dt).format("YYYY-MM-DD HH:mm:ss"),
                      },
                      type: invtDB.QueryTypes.INSERT,
                    }
                  );
                } catch (dbError) {
                  console.error(
                    "Failed to log payload to api_payload_log:",
                    dbError.message
                  );
                }

                externalResult = {
                  status: apiStatus,
                  message:
                    apiStatus === "PASS"
                      ? "External API call successful"
                      : `External API call failed: ${response.data.Status.join(
                          ", "
                        )}`,
                  details: response.data.Status,
                };
              } catch (error) {
                console.error("External API Error:", {
                  message: error.message,
                  response: error.response
                    ? {
                        status: error.response.status,
                        data: error.response.data,
                      }
                    : "No response data",
                });

                apiStatus = "ERROR";

                try {
                  await invtDB.query(
                    "INSERT INTO api_payload_log (min_number, api_status, payload, log_dt) VALUES (:minNumber, :apiStatus, :payload, :log_dt)",
                    {
                      replacements: {
                        minNumber: in_txn_no,
                        apiStatus: apiStatus,
                        payload: JSON.stringify(payload),
                        log_dt: moment(insert_dt).format("YYYY-MM-DD HH:mm:ss"),
                      },
                      type: invtDB.QueryTypes.INSERT,
                    }
                  );
                } catch (dbError) {
                  console.error(
                    "Failed to log payload to api_payload_log:",
                    dbError.message
                  );
                }

                externalResult = {
                  status: apiStatus,
                  message: `Failed to call external API: ${error.message}`,
                  details: error.response?.data || null,
                };
              }

              return res.json({
                success: true,
                message:
                  "PO Material-IN completed..!!! transaction ref ID. [#" +
                  in_txn_no +
                  "]",
                status: "success",
                data: {
                  txn: in_txn_no,
                  externalStatus: externalResult.status,
                  externalDetails: externalResult.details,
                },
              });
            } else {
              t.rollback();
              res.json({
                success: false,
                message:
                  "transaction route seems to be really busy - Please try again...",
                status: "warning",
              });
              return;
            }
          } else {
            t.rollback();
            res.json({
              success: false,
              message:
                "MIN operation cancelled bcz it seem PO ID not exist in our records",
              status: "error",
            });
            return;
          }
        }
      } else {
        t.rollback();
        res.json({
          success: false,
          status: "error",
          message: "You have selected an invalid company branch",
        });
        return;
      }
    } catch (err) {
      t.rollback();
      return helper.errorResponse(res, err);
    }
  }
);

//COMPLETE PO
router.post("/fetchCompletePO", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });
  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      status: "error",
    });
    return;
  }
  try {
    let stmt1;
    let data = req.body.data;
    if (req.body.wise == "single_date_wise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months"
      );
      if (durationInMonths > 3) {
        return res.json({
          status: "error",
          message:
            "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          success: false,
        });
      }

      stmt1 = await invtDB.query(
        "SELECT *, `admin_login`.`user_name` AS `po_created_by`, COALESCE(SUM(`po_purchase_req`.`po_order_qty`),0) `totalReq_Qty`, COALESCE(SUM(`po_purchase_req`.`po_pending_qty`),0) `totalIn_Qty`, `ven_basic_detail`.`ven_name` FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` LEFT JOIN `ven_basic_detail` ON `po_purchase_req`.`po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `admin_login` ON `po_purchase_req`.`po_insert_by` = `admin_login`.`CustID` LEFT JOIN `cost_center` ON `po_purchase_req`.`po_cost_center` = `cost_center`.`cost_center_key` WHERE `po_purchase_req`.`company_branch` = :branch AND DATE_FORMAT(`po_purchase_req`.`po_full_date`,'%Y-%m-%d') BETWEEN :fromdate AND :todate GROUP BY `po_purchase_req`.`po_transaction` ORDER BY `po_purchase_req`.`ID` DESC",
        {
          replacements: {
            branch: req.branch,
            fromdate: fromdate,
            todate: todate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (req.body.wise == "po_wise") {
      stmt1 = await invtDB.query(
        "SELECT *, `admin_login`.`user_name` AS `po_created_by`, COALESCE(SUM(`po_purchase_req`.`po_order_qty`),0) `totalReq_Qty`, COALESCE(SUM(`po_purchase_req`.`po_pending_qty`),0) `totalIn_Qty`, `ven_basic_detail`.`ven_name` FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` LEFT JOIN `ven_basic_detail` ON `po_purchase_req`.`po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `admin_login` ON `po_purchase_req`.`po_insert_by` = `admin_login`.`CustID` LEFT JOIN `cost_center` ON `po_purchase_req`.`po_cost_center` = `cost_center`.`cost_center_key` WHERE `po_purchase_req`.`company_branch` = :branch AND `po_purchase_req`.`po_transaction` LIKE CONCAT('%', :po_id, '%') GROUP BY `po_purchase_req`.`po_transaction` ORDER BY `po_purchase_req`.`ID` DESC",
        {
          replacements: { branch: req.branch, po_id: data },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (req.body.wise == "vendor_wise") {
      stmt1 = await invtDB.query(
        "SELECT *, `admin_login`.`user_name` AS `po_created_by`, COALESCE(SUM(`po_purchase_req`.`po_order_qty`),0) `totalReq_Qty`, COALESCE(SUM(`po_purchase_req`.`po_pending_qty`),0) `totalIn_Qty`, `ven_basic_detail`.`ven_name` FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` LEFT JOIN `ven_basic_detail` ON `po_purchase_req`.`po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `admin_login` ON `po_purchase_req`.`po_insert_by` = `admin_login`.`CustID` LEFT JOIN `cost_center` ON `po_purchase_req`.`po_cost_center` = `cost_center`.`cost_center_key` WHERE `po_purchase_req`.`company_branch` = :branch AND `po_purchase_req`.`po_vendor_reg_id` = :venid GROUP BY `po_purchase_req`.`po_transaction` ORDER BY `po_purchase_req`.`ID` DESC",
        {
          replacements: { branch: req.branch, venid: data },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt1.length > 0) {
      let final_data = [];
      let serial_no = 0;
      for (let i = 0; i < stmt1.length; i++) {
        let item = stmt1[i];
        // stmt1.map((item) => {
        let po_style;
        if (item.totalIn_Qty <= 0 || item.po_status == "C") {
          if (item.totalIn_Qty == item.totalReq_Qty && item.po_status == "C") {
            po_style =
              "<span style='text-decoration:line-through'><span style='color:black'>" +
              item.po_transaction +
              "</span></span>!!! <span class='text-danger' style='font-weight:bold'>FULLY CANCELLED</span>";
          } else if (
            item.totalReq_Qty > item.totalIn_Qty &&
            item.totalIn_Qty !== "0" &&
            item.po_status == "C"
          ) {
            po_style =
              "<span style='text-decoration:line-through'><span style='color:black'>" +
              item.po_transaction +
              "</span></span>!!! <span class='text-danger' style='font-weight:bold'>PARTIALLY CANCELLED</span>";
          } else {
            po_style = item.po_transaction;
          }

          final_data.push({
            slno: serial_no,
            po_transaction_style: po_style,
            po_comment: item.po_comment,
            po_transaction_code: item.po_transaction,
            vendor_name: item.ven_name,
            vendor_id: item.po_vendor_reg_id,
            po_reg_date: moment(item.po_full_date, "").format("DD-MM-YYYY"),
            po_reg_by: item.po_created_by,
            time_ago: format(item.po_full_date, "en_US"),
            cost_center:
              item.cost_center_name + " (" + item.cost_center_short_name + ")",
          });
          serial_no++;
        }
      }
      return res.json({ success: true, data: { final_data, serial_no } });
    } else {
      return res.json({
        success: false,
        message: "No Data Found",
        status: "error",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.post(
  "/CancelPO",
  [auth.isAuthorized, permission.isPermittedMethod("CANCEL")],
  async (req, res) => {
    let validation = new Validator(req.body, {
      purchase_order: "required",
      remark: "required",
    });
    if (validation.fails()) {
      res.json({
        success: false,
        message: "something you missing in form field to supply",
        status: "error",
      });
      return;
    }
    try {
      const t = await invtDB.transaction();
      let stmt1 = await invtDB.query(
        "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :poid AND `company_branch` =:branch",
        {
          replacements: { poid: req.body.purchase_order, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt1.length > 0) {
        if (stmt1[0].po_status == "C") {
          return res.json({
            success: false,
            message: "Purchase Order already closed",
            status: "error",
          });
        } else {
          let stmt2 = await invtDB.query(
            "UPDATE `po_purchase_req` SET `po_close_remark` = :remark, `po_status` = :status WHERE `po_transaction` = :poid",
            {
              replacements: {
                remark: req.body.remark.replace(/\n/g, "<br>"),
                status: "C",
                poid: req.body.purchase_order,
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: t,
            }
          );
          if (stmt2.length > 0) {
            t.commit();
            res.json({
              success: true,
              message: "Purchase Order closed successfully",
              status: "success",
            });
            return;
          } else {
            t.rollback();
            res.json({
              success: false,
              message:
                "unable to close the purchase order due to some technical issue",
              status: "error",
            });
            return;
          }
        }
      } else {
        return res.json({
          success: false,
          message: "No PO Found",
          status: "error",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// REMOVE PART CODE
// router.post("/removePart", [auth.isAuthorized], async (req, res) => {
//   let validation = new Validator(req.body, {
//     pocode: "required",
//     partcode: "required",
//     updatecode: "required",
//   });
//   if (validation.fails()) {
//     res.json({
//       success: false,
//       message: "something you missing in form field to supply",
//       data: validation.errors.all(),
//       status: "error",
//     });
//     return;
//   }

//   const transaction = await invtDB.transaction();

//   try {
//     let stmt1 = await invtDB.query(
//       "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :po_code AND `po_status` = 'A' AND `company_branch` = :branch",
//       {
//         replacements: { po_code: req.body.pocode, branch: req.branch },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );
//     if (stmt1.length > 0) {
//       let stmt2 = await invtDB.query(
//         "SELECT * FROM `rm_location` WHERE `in_po_transaction_id` = :po_code AND `components_id` = :part_code AND `company_branch` = :branch",
//         {
//           replacements: {
//             po_code: req.body.pocode,
//             part_code: req.body.partcode,
//             branch: req.branch,
//           },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );
//       if (stmt2.length > 0) {
//         await transaction.rollback();
//         return res.json({
//           success: false,
//           message:
//             "can't delete the item it seems we have already inwarded some quantity against of this item with po transaction, that you have supplied..",
//           status: "error",
//         });
//       } else {
//         let stmt3 = await invtDB.query(
//           "DELETE FROM `po_purchase_req` WHERE `po_transaction` = :po_code AND `po_part_no` = :component AND `ID` = :delete_id AND `company_branch` = :branch",
//           {
//             replacements: {
//               po_code: req.body.pocode,
//               delete_id: req.body.updatecode,
//               component: req.body.partcode,
//               branch: req.branch,
//             },
//             type: invtDB.QueryTypes.DELETE,
//           }
//         );

//         transaction.commit();
//         res.json({
//           success: true,
//           message: "Part removed successfully..",
//           status: "success",
//         });
//         return;
//       }
//     } else {
//       return res.json({
//         success: false,
//         message: "PO is either closed or not exist",
//         status: "error",
//       });
//     }
//   } catch (err) {
//     transaction.rollback();
//     return helper.errorResponse(res, err);
//   }
// });
router.post("/removePart", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    pocode: "required",
    partcode: "required",
    updatecode: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
  }

  const transaction = await invtDB.transaction();

  try {
    // 1. Check PO exists and active
    const poCheck = await invtDB.query(
      `SELECT ID FROM po_purchase_req
       WHERE po_transaction = :po_code
       AND po_status = 'A'
       AND company_branch = :branch`,
      {
        replacements: {
          po_code: req.body.pocode,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
        transaction,
      }
    );

    if (poCheck.length === 0) {
      await transaction.rollback();
      return res.json({
        success: false,
        message: "PO is either closed or not exist",
        status: "error",
      });
    }

    // 2. Count total components in this PO
    const componentCount = await invtDB.query(
      `SELECT COUNT(*) AS total
       FROM po_purchase_req
       WHERE po_transaction = :po_code
       AND company_branch = :branch`,
      {
        replacements: {
          po_code: req.body.pocode,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
        transaction,
      }
    );

    if (componentCount[0].total <= 1) {
      await transaction.rollback();
      return res.json({
        success: false,
        message: "At least one component must remain in the PO. You cannot remove all parts.",
        status: "error",
      });
    }

    // 3. Check inward entry exists
    const inwardCheck = await invtDB.query(
      `SELECT ID FROM rm_location
       WHERE in_po_transaction_id = :po_code
       AND components_id = :part_code
       AND company_branch = :branch`,
      {
        replacements: {
          po_code: req.body.pocode,
          part_code: req.body.partcode,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
        transaction,
      }
    );

    if (inwardCheck.length > 0) {
      await transaction.rollback();
      return res.json({
        success: false,
        message:
          "Can't delete this item. Inward entry already exists against this PO.",
        status: "error",
      });
    }

    // 4. Delete component
    await invtDB.query(
      `DELETE FROM po_purchase_req
       WHERE po_transaction = :po_code
       AND po_part_no = :component
       AND ID = :delete_id
       AND company_branch = :branch`,
      {
        replacements: {
          po_code: req.body.pocode,
          component: req.body.partcode,
          delete_id: req.body.updatecode,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.DELETE,
        transaction,
      }
    );

    await transaction.commit();

    return res.json({
      success: true,
      message: "Part removed successfully.",
      status: "success",
    });
  } catch (err) {
    await transaction.rollback();
    return helper.errorResponse(res, err);
  }
});


router.post(
  "/getComponentDetailsByCode",
  [auth.isAuthorized],
  async (req, res) => {
    const validation = new Validator(req.body, {
      component_code: "required",
      vencode: "required",
      project: "required",
    });

    if (!validation.passes()) {
      return res.json({
        success: false,
        status: "error",
        message: validation.errors.all(),
      });
    }

    try {
      const { component_code, vencode, project } = req.body;

      // 1. Get Component Details
      const result = await invtDB.query(
        `SELECT c.*, u.units_name 
         FROM components c 
         LEFT JOIN units u ON c.c_uom = u.units_id 
         WHERE c.component_key = :key AND c.c_is_enabled = 'Y'`,
        {
          replacements: { key: component_code },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (result.length === 0) {
        return res.json({
          success: false,
          status: "error",
          message: "Component not found or disabled",
        });
      }

      const item = result[0];
      const gstrate = item.c_gst === "--" || !item.c_gst ? 0 : item.c_gst;

      const rate =
        await require("../../../helper/utils/avgRate").getLastInwardRate(
          component_code,
          vencode
        );
      const branch = req.branch;
      const location_key = "2023112717950595";

      let closing_stock = 0;

      const locAllot = await invtDB.query(
        "SELECT locations, branch_locations FROM location_allotted WHERE loc_all_key = :loc_key",
        {
          replacements: { loc_key: location_key },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let allowedLocations = "";

      if (locAllot.length > 0) {
        if (locAllot[0].branch_locations) {
          try {
            const branchLocs = JSON.parse(locAllot[0].branch_locations);
            allowedLocations = branchLocs[branch] || locAllot[0].locations;
          } catch (e) {
            allowedLocations = locAllot[0].locations;
          }
        } else {
          allowedLocations = locAllot[0].locations;
        }
      }

      if (allowedLocations) {
        const locationsArray = allowedLocations.split(",").filter(Boolean);

        const stockResult = await invtDB.query(
          `SELECT 
            COALESCE(SUM(CASE WHEN loc_in IN (:locations) AND trans_type IN ('INWARD','ISSUE','JOBWORK','REJECTION','TRANSFER') THEN qty ELSE 0 END), 0) 
            - 
            COALESCE(SUM(CASE WHEN loc_out IN (:locations) AND trans_type IN ('CONSUMPTION','ISSUE','JOBWORK','REJECTION','TRANSFER') THEN qty ELSE 0 END), 0) AS closing_qty
          FROM rm_location 
          WHERE components_id = :component`,
          {
            replacements: {
              locations: locationsArray,
              component: component_code,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        closing_stock = stockResult[0]?.closing_qty || 0;
      }

      let projected_qty = 0;

      const projectBOMResult = await invtDB.query(
        `SELECT pm.bomsubjectid, pm.projectQty 
         FROM project_master pm
         WHERE pm.project_name = :project_name
         AND pm.bomsubjectid IS NOT NULL 
         AND pm.bomsubjectid != '' 
         AND pm.bomsubjectid != '--'
         AND pm.projectQty > 0`,
        {
          replacements: { project_name: project },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (projectBOMResult.length > 0) {
        for (const project of projectBOMResult) {
          const bomQtyResult = await invtDB.query(
            `SELECT bq.qty 
             FROM bom_quantity bq
             INNER JOIN bom_recipe br ON bq.subject_under = br.subject_id
             WHERE bq.subject_under = :bom_id 
             AND bq.component_id = :component_id
             AND br.bom_status = 'ENABLE'`,
            {
              replacements: {
                bom_id: project.bomsubjectid,
                component_id: component_code,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (bomQtyResult.length > 0) {
            const bomComponentQty = bomQtyResult[0].qty || 0;
            const projectQty = project.projectQty || 0;

            projected_qty += projectQty * bomComponentQty;
          }
        }
      }

      let executed_qty = 0;
      const executedQtyResult = await invtDB.query(
        `SELECT COALESCE(SUM(pr.po_order_qty), 0) AS total_executed_qty
         FROM po_purchase_req pr
         INNER JOIN project_master pm ON pr.po_project_name = pm.project_name
         WHERE pr.po_part_no = :component_code
         AND pm.project_name = :project_name
         AND pm.bomsubjectid IS NOT NULL 
         AND pm.bomsubjectid != '' 
         AND pm.bomsubjectid != '--'`,
        {
          replacements: {
            component_code: component_code,
            project_name: project, // AAA: Filter by specific project
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (executedQtyResult.length > 0) {
        executed_qty = executedQtyResult[0].total_executed_qty || 0;
      }

      return res.json({
        success: true,
        status: "success",
        data: {
          key: item.component_key,
          unit: item.units_name,
          hsn: item.c_hsn,
          gstrate: gstrate,
          rate: helper.number(rate),
          mfgCode: item.manufacturing_code,
          closing_stock: helper.number(closing_stock),
          project_req_qty: helper.number(projected_qty), // **NEW: Added projected quantity**
          po_exec_qty: helper.number(executed_qty),
        },
      });
    } catch (err) {
      console.error("getComponentDetailsByCode Error:", err);
      return helper.errorResponse(res, err);
    }
  }
);

// ADD ATTACHMENT PO
var po_storage = multer.diskStorage({
  destination: (req, file, callBack) => {
    callBack(null, "./uploads/POFiles");
  },
  filename: (req, file, callBack) => {
    callBack(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});
var po_uploadfile = multer({ storage: po_storage });

router.post(
  "/uploadAttachment",
  [auth.isAuthorized, po_uploadfile.array("files")],
  async (req, res) => {
    try {
      let filesLenth = req.files.length;

      if (filesLenth <= 0) {
        res.json({
          success: false,
          message: "add some attachment",
          status: "error",
        });
        return;
      }
      if (req.body.doc_name == "") {
        res.json({
          success: false,
          message: "add attachment file(s) name",
          status: "error",
        });
        return;
      }

      let files = [];
      if (filesLenth > 0) {
        for (let i = 0; i < filesLenth; i++) {
          files.push(req.files[i].filename);
        }
      }

      files = files.toString();

      const transaction = await invtDB.transaction();
      let stmt = await invtDB.query(
        "INSERT INTO `ims_min_invoices` (`doc_file_name`,`min_inv_file`,`min_inv_by`,`min_inv_dt`,`min_po_id`,`trans_type`,`attachment_id`) VALUES(:label,:file,:by,:date,:po,:type,:attachment_id)",
        {
          replacements: {
            label: req.body.doc_name,
            file: files,
            by: req.logedINUser,
            date: moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss"),
            po: req.body.po_id,
            type: "PO",
            attachment_id: helper.getUniqueNumber(),
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      );
      if (stmt.length > 0) {
        await transaction.commit();
        res.json({
          success: true,
          message: "File attached successfully",
          data: files,
        });
      } else {
        fs.unlinkSync("./uploads/POFiles" + req.file.filename);
        await transaction.rollback();
        return res.json({
          success: false,
          message: "an error occured while uploading attachment",
          status: "error",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH UPLOADED PO ATTACHMENTS
router.post(
  "/fetchUploadedAttachment",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let stmt = await invtDB.query(
        "SELECT * FROM `ims_min_invoices` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `ims_min_invoices`.`min_inv_by` WHERE `ims_min_invoices`.`trans_type` = 'PO' AND `min_po_id` = :po_order ORDER BY `ims_min_invoices`.`ID` DESC",
        {
          replacements: { po_order: req.body.po_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        let result = [];
        stmt.map((value) => {
          result.push({
            doc_name: value.doc_file_name,
            doc_url:
              "https://media.mscorpres.co.in/oakterIms/uploades/minInvoice/" +
              value.min_inv_file,
            doc_id: value.attachment_id,
            uploaded_date: moment(value.min_inv_dt)
              .tz("Asia/Kolkata")
              .format("DD-MM-YYYY hh:mm:ss A"),
            uploaded_by: value.user_name,
            serial_no: helper.randomNumber(1000, 9999),
          });
          if (result.length == stmt.length) {
            return res.json({ success: true, status: "success", data: result });
          }
        });
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "no any attachment(s) found with PO",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

//DELETE UPLOADED PO ATTACHMENT
router.post(
  "/deleteUploadedAttachment",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      doc_id: "required",
      po_id: "required",
    });
    if (validation.fails()) {
      res.json({
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
      return;
    }

    const t = await invtDB.transaction();

    try {
      let stmt1 = await invtDB.query(
        "SELECT * FROM `ims_min_invoices` WHERE `attachment_id` = :doc_code AND `min_po_id` = :po_code",
        {
          replacements: { doc_code: req.body.doc_id, po_code: req.body.po_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt1.length > 0) {
        let stmt2 = await invtDB.query(
          "DELETE FROM `ims_min_invoices` WHERE `attachment_id` = :doc_code AND `min_po_id` = :po_code",
          {
            replacements: {
              doc_code: req.body.doc_id,
              po_code: req.body.po_id,
            },
            type: invtDB.QueryTypes.DELETE,
            transaction: t,
          }
        );
        //
        fs.unlinkSync(
          path.join(
            __dirname + "./../../../uploads/POFiles/" + stmt1[0].min_inv_file
          )
        );
        await t.commit();
        res.json({
          success: true,
          message: "attachment removed successfully..",
          status: "success",
        });
        return;
        //
      } else {
        await t.rollback();
        return res.json({
          success: false,
          message: "no data matched",
          status: "error",
        });
      }
    } catch (err) {
      await t.rollback();
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH PO VENDOR WISE FOR MIN
router.post("/fetchVendorPO", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    po: "required",
    vendor: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      status: "error",
    });
    return;
  }

  try {
    let result = await invtDB.query(
      "SELECT * FROM `po_purchase_req` WHERE `po_transaction` LIKE :po AND `po_vendor_reg_id` = :vendor AND `company_branch` = :branch",
      {
        replacements: {
          po: req.body.po,
          vendor: req.body.vendor,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      if (result[0].po_status == "C") {
        res.json({
          success: false,
          message: "PO marked as cancelled, so cann't proceed for MIN",
          status: "error",
        });
        return;
      }
      if (result[0].approval_status !== "A") {
        res.json({
          success: false,
          message: "PO not approved yet for further transactions",
          status: "error",
        });
        return;
      }
      let stmt1 = await invtDB.query(
        "SELECT * FROM po_purchase_req LEFT JOIN components ON po_purchase_req.po_part_no = components.component_key LEFT JOIN units ON units.units_id = components.c_uom LEFT JOIN ven_address_detail ON po_purchase_req.po_ven_add_id = ven_address_detail.ven_address_id LEFT JOIN ven_basic_detail ON po_purchase_req.po_vendor_reg_id = ven_basic_detail.ven_register_id LEFT JOIN cost_center ON po_purchase_req.po_cost_center = cost_center.cost_center_key LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name WHERE po_purchase_req.po_transaction = :transaction AND po_purchase_req.po_part_status = :part_status AND po_purchase_req.company_branch = :branch",
        {
          replacements: {
            transaction: req.body.po,
            part_status: "ACTIVE",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      const data = [];
      for (let i = 0; i < stmt1.length; i++) {
        let stmt2 = await invtDB.query(
          "SELECT *, COALESCE(SUM(`qty`+`other_qty`),0) `totalIN_Qty` FROM `rm_location` WHERE `in_po_transaction_id` = :poid AND `components_id` = :partno AND `trans_type` = 'INWARD' AND `company_branch` = :branch",
          {
            replacements: {
              poid: req.body.po,
              partno: stmt1[i].po_part_no,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let totalINQTY;
        if (stmt2.length > 0) {
          totalINQTY = helper.number(stmt2[0].totalIN_Qty);
        } else {
          totalINQTY = 0;
        }

        data.push({
          hsncode: stmt1[i].po_hsncode,
          gstrate: stmt1[i].po_gstrate,
          gsttype: stmt1[i].po_gsttype,
          component_fullname: decode(stmt1[i].c_name),
          unitsname: stmt1[i].units_name,
          componentKey: stmt1[i].component_key,
          mfgCode: stmt1[i].manufacturing_code,
          partcode: stmt1[i].po_part_no,
          po_order_qty: helper.number(stmt1[i].po_order_qty),
          orderqty: helper.number(stmt1[i].po_order_qty) - totalINQTY,
          orderrate: helper.number(stmt1[i].po_order_rate),
          exchange_rate: helper.number(stmt1[i].po_exchange),
          usdValue:
            helper.number(stmt1[i].po_order_rate) *
            helper.number(stmt1[i].po_order_qty) *
            helper.number(stmt1[i].po_exchange),
          currency: stmt1[i].po_currency,
          orderduedate: stmt1[i].po_duedate,
          orderremark: stmt1[i].po_remark,
          c_partno: stmt1[i].c_part_no,
          totalValue:
            (helper.number(stmt1[i].po_order_qty) - totalINQTY) *
            helper.number(stmt1[i].po_order_rate),
          pia_status: stmt1[i].pia_status,
        });
      }
      res.json({
        status: "success",
        success: true,
        data: {
          materials: data,
          headers: {
            vendorname: stmt1[0].ven_name,
            vendorcode: stmt1[0].po_vendor_reg_id,
            vendortype:
              stmt1[0].po_vendor_type == "v01"
                ? "Vendor"
                : stmt1[0].po_vendor_type == "jwi"
                ? "JOBWORK"
                : stmt1[0].po_vendor_type == "s01"
                ? "SortIn"
                : stmt1[0].po_vendor_type == "r01"
                ? "RejectionIn"
                : stmt1[0].po_vendor_type == "p01"
                ? "ProdReturn"
                : "N/A",
            gstin: stmt1[0].ven_add_gst,
            vendoraddress: stmt1[0].po_vendor_address,
            transaction: stmt1[0].po_transaction,
            cost_center_name: `${stmt1[0].cost_center_name} (${stmt1[0].cost_center_short_name}) `,
            cost_center_key: stmt1[0].po_cost_center,
            project_code: stmt1[0].po_project_name,
            project_description: stmt1[0].project_description,
          },
        },
      });
      return;
    } else {
      res.json({
        success: false,
        message: "no PO found that matching to your query",
        status: "error",
      });
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//FETCH PENDING PO FOR APPROVAL
router.post("/fetchneededApprovalPO", [auth.isAuthorized], async (req, res) => {
  const isPermission = await helper.checkPermission(
    "po-approve",
    req.logedINUser
  );
  if (isPermission == false) {
    return res.json({
      success: false,
      status: "error",
      message: "Permission denied",
    });
  }

  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
    return;
  }

  try {
    let result = [];
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
          message:
            "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          success: false,
        });
      }

      result = await invtDB.query(
        "SELECT po_purchase_req.* , ven_basic_detail.*, admin_login.* , cost_center.*, project_master.*  , raised_by.user_name as raise_by , admin_login.user_name AS po_created_by, COALESCE( SUM(po_purchase_req.po_order_qty), 0 ) totalReq_Qty, COALESCE( SUM(po_purchase_req.po_pending_qty), 0 ) totalIn_Qty FROM po_purchase_req LEFT JOIN ven_basic_detail ON po_purchase_req.po_vendor_reg_id = ven_basic_detail.ven_register_id LEFT JOIN admin_login ON po_purchase_req.po_insert_by = admin_login.CustID LEFT JOIN cost_center ON po_purchase_req.po_cost_center = cost_center.cost_center_key LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name LEFT JOIN admin_login raised_by ON raised_by.CustID = po_purchase_req.po_raise_by WHERE DATE_FORMAT( po_purchase_req.po_full_date, '%Y-%m-%d' ) BETWEEN :datefrom AND :dateto AND po_purchase_req.po_status = :status AND po_purchase_req.approval_status = 'P' AND po_purchase_req.company_branch = :branch AND po_purchase_req.statusforporequest = 'A' GROUP BY po_purchase_req.po_transaction, po_purchase_req.approval_status ORDER BY po_purchase_req.ID DESC",
        {
          replacements: {
            datefrom: fromdate,
            dateto: todate,
            status: "A",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "powise") {
      result = await invtDB.query(
        "SELECT po_purchase_req.* , ven_basic_detail.*, admin_login.* , cost_center.*, project_master.*  , raised_by.user_name as raise_by , admin_login.user_name AS po_created_by, COALESCE( SUM(po_purchase_req.po_order_qty), 0 ) totalReq_Qty, COALESCE( SUM(po_purchase_req.po_pending_qty), 0 ) totalIn_Qty FROM po_purchase_req LEFT JOIN ven_basic_detail ON po_purchase_req.po_vendor_reg_id = ven_basic_detail.ven_register_id LEFT JOIN admin_login ON po_purchase_req.po_insert_by = admin_login.CustID LEFT JOIN cost_center ON po_purchase_req.po_cost_center = cost_center.cost_center_key LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name LEFT JOIN admin_login raised_by ON raised_by.CustID = po_purchase_req.po_raise_by  WHERE po_purchase_req.po_transaction LIKE CONCAT('%', :po_id, '%') AND po_purchase_req.po_status = :status AND po_purchase_req.company_branch = :branch AND po_purchase_req.statusforporequest = 'A' AND po_purchase_req.approval_status = 'P' GROUP BY po_purchase_req.po_transaction, po_purchase_req.approval_status ORDER BY po_purchase_req.ID DESC",
        {
          replacements: { po_id: searchValue, status: "A", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "vendorwise") {
      result = await invtDB.query(
        "SELECT po_purchase_req.* , ven_basic_detail.*, admin_login.* , cost_center.*, project_master.*  , raised_by.user_name as raise_by , admin_login.user_name AS po_created_by, COALESCE( SUM(po_purchase_req.po_order_qty), 0 ) totalReq_Qty, COALESCE( SUM(po_purchase_req.po_pending_qty), 0 ) totalIn_Qty FROM po_purchase_req LEFT JOIN ven_basic_detail ON po_purchase_req.po_vendor_reg_id = ven_basic_detail.ven_register_id LEFT JOIN admin_login ON po_purchase_req.po_insert_by = admin_login.CustID LEFT JOIN cost_center ON po_purchase_req.po_cost_center = cost_center.cost_center_key LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name LEFT JOIN admin_login raised_by ON raised_by.CustID = po_purchase_req.po_raise_by  WHERE po_purchase_req.po_vendor_reg_id = :venid AND po_purchase_req.po_status = :status AND po_purchase_req.company_branch = :branch AND po_purchase_req.statusforporequest = 'A' AND po_purchase_req.approval_status = 'P' GROUP BY po_purchase_req.po_transaction, po_purchase_req.approval_status ORDER BY po_purchase_req.ID DESC",
        {
          replacements: { venid: searchValue, status: "A", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "projectwise") {
      result = await invtDB.query(
        "SELECT po_purchase_req.* , ven_basic_detail.*, admin_login.* , cost_center.*, project_master.*  , raised_by.user_name as raise_by , admin_login.user_name AS po_created_by, COALESCE( SUM(po_purchase_req.po_order_qty), 0 ) totalReq_Qty, COALESCE( SUM(po_purchase_req.po_pending_qty), 0 ) totalIn_Qty FROM po_purchase_req LEFT JOIN ven_basic_detail ON po_purchase_req.po_vendor_reg_id = ven_basic_detail.ven_register_id LEFT JOIN admin_login ON po_purchase_req.po_insert_by = admin_login.CustID LEFT JOIN cost_center ON po_purchase_req.po_cost_center = cost_center.cost_center_key LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name LEFT JOIN admin_login raised_by ON raised_by.CustID = po_purchase_req.po_raise_by  WHERE po_purchase_req.po_project_name = :project AND po_purchase_req.po_status = :status AND po_purchase_req.company_branch = :branch AND po_purchase_req.statusforporequest = 'A' AND po_purchase_req.approval_status = 'P' GROUP BY po_purchase_req.po_transaction, po_purchase_req.approval_status ORDER BY po_purchase_req.ID DESC",
        {
          replacements: {
            project: searchValue,
            status: "A",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      res.json({
        success: false,
        message: "Please select valid filter method",
        status: "error",
      });
      return;
    }

    if (result.length > 0) {
      let finalResult = [];
      for (let i = 0; i < result.length; i++) {
        if (result[i].totalIn_Qty > 0) {
          let stmt_valid_apprval_user = await otherDB.query(
            "SELECT ims_po_team_leader FROM ims_po_team WHERE ims_po_team_member = :ims_po_team_member AND po_cost_center = :po_cost_center",
            {
              replacements: {
                ims_po_team_member: result[i].po_raise_by,
                po_cost_center: result[i].po_cost_center,
              },
              type: otherDB.QueryTypes.SELECT,
            }
          );
          if (stmt_valid_apprval_user.length > 0) {
            if (
              stmt_valid_apprval_user.some(
                (user) => user.ims_po_team_leader === req.logedINUser
              ) ||
              req.logedINUser == "CRN615672" ||
              req.logedINUser == "CRN103522" ||
              req.logedINUser == "CRN6668049"
            ) {
              finalResult.push({
                po_transaction: result[i].po_transaction,
                vendor_name: result[i].ven_name,
                po_comment: result[i].po_comment,
                vendor_id: result[i].po_vendor_reg_id,
                po_reg_date: moment(
                  result[i].po_full_date,
                  "YYYY-MM-DD HH:mm:ss"
                ).format("DD-MM-YYYY HH:mm:ss"),
                po_reg_by: result[i].po_created_by,
                due_date:
                  result[i].po_duedate == "" ? "--" : result[i].po_duedate,
                time_ago: format(result[i].po_full_date, "en_US"),
                po_trans_encrypt: result[i].po_transaction,
                po_status: result[i].po_status,
                po_costcenter:
                  result[i].cost_center_short_name +
                  " ( " +
                  result[i].cost_center_name +
                  " )",
                po_projectname: result[i].po_project_name,
                project_description: result[i].project_description,
                approval_status: result[i].approval_status,
                requested_by: result[i].raise_by ?? "NA",
                remark: result[i].po_remark,
                deviation_remark: result[i].status_remark,
                reject_remark: result[i].po_rej_remark,
              });
            }
          }
        }
      }

      if (finalResult.length > 0) {
        return res.json({
          success: true,
          status: "success",
          data: finalResult,
        });
      } else {
        return res.json({
          success: false,
          message: "No PO found",
          status: "error",
        });
      }
    }
    return res.json({
      success: false,
      message: "No PO found",
      status: "error",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//VIEW ALL COMPONENTS IN PURCHASE ORDER
router.post(
  "/fetchComponentList4POApproval",
  [auth.isAuthorized],
  async (req, res) => {
    const po_transaction = req.body.poid;
    const validation = new Validator(req.body, {
      poid: "required",
    });

    if (validation.fails()) {
      res.json({
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
      return;
    }

    try {
      let result = await invtDB.query(
        "SELECT * FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `po_purchase_req`.`po_transaction` = :po AND `po_purchase_req`.`company_branch` = :branch ORDER BY `components`.`c_name` DESC",
        {
          replacements: { po: po_transaction, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (result.length > 0) {
        finalResult = [];
        let getQty;
        for (let i = 0; i < result.length; i++) {
          getQty = await invtDB.query(
            "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :po AND `po_part_no` = :component AND `company_branch` = :branch",
            {
              replacements: {
                po: po_transaction,
                component: result[i].component_key,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          po_ordered_qty = helper.number(getQty[0].po_order_qty);
          po_pending_qty = helper.number(getQty[0].po_pending_qty);

          finalResult.push({
            componentPartID: result[i].c_part_no,
            ordered_qty: po_ordered_qty,
            po_components: decode(result[i].c_name),
            po_part_status: result[i].po_part_status,
            uom: result[i].units_name,
            approval_remark: result[i].status_remark,
            remark: result[i].po_remark,
            deviation_remark: result[i].status_remark,
            reject_remark: result[i].po_rej_remark,
          });
        } //loop end
        res.json({ success: true, status: "success", data: finalResult });
        return;
      } else {
        res.json({
          success: false,
          message: "No PO found",
          status: "error",
        });
        return;
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// APPROVE PO
router.post("/updatePOApproval", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    poid: "required|array",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
  }

  try {
    for (let i = 0; i < req.body.poid.length; i++) {
      let t = await invtDB.transaction();

      let stmt = await invtDB.query(
        "UPDATE `po_purchase_req` SET `approval_status` = 'A', statusforporequest = 'A', `po_approve_by` = :user WHERE `approval_status` = 'P' AND `po_transaction` = :transaction",
        {
          replacements: {
            transaction: req.body.poid[i],
            user: req.logedINUser,
          },
          type: invtDB.QueryTypes.UPDATE,
          transaction: t,
        }
      );
      if (stmt.length > 0) {
        let stmt_po_log = await invtDB.query(
          "INSERT INTO `po_status_log`(`po_id`, `po_log_status`, `po_log_remark`, `insert_dt`, `insert_time`, `insert_by`) VALUES ( :poid, :status, :remark, :insert_dt, :insert_time, :insert_by )",
          {
            replacements: {
              poid: req.body.poid[i],
              status: "APPROVED",
              remark: req.body.remark ?? "--",
              insert_dt: moment(new Date()).format("YYYY-MM-DD"),
              insert_time: moment(new Date()).format("HH:mm:ss"),
              insert_by: req.logedINUser,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: t,
          }
        );

        await t.commit();

        const stmt_check = await invtDB.query(
          "SELECT admin_login.Email_ID FROM po_purchase_req LEFT JOIN admin_login ON admin_login.CustID = po_purchase_req.po_raise_by  WHERE po_transaction = :po_id GROUP BY po_transaction",
          {
            replacements: { po_id: req.body.poid[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt_check.length > 0) {
          const mailSubject = `PO APPROVED [REF ${req.body.poid[i]}]`;
          const mailMsg = `<div style="font-family: Roboto,sans-serif;" ><p>Hi, </p>
                              <p>PO <b>(${req.body.poid[i]}) </b> APPROVED.</p>
                              <p><b>Remark:-</b> ${req.body.remark} </p>
                            </div>
                          `;

          let file = {
            url: `${process.env.API_URL}/helper/PRINT/PHP/PO/alwar-printReceipt.php?invoice=${Buffer.from(req.body.poid[i]).toString("base64")}`
          };
          let options = { format: "A4" };
          html_to_pdf
            .generatePdf(file, options)
            .then((pdfBuffer) => {
              helper.sendMail(
                stmt_check[0].Email_ID,
                null,
                mailSubject,
                mailMsg,
                [{ filename: "POFILE.pdf", content: pdfBuffer }]
              );
            })
            .catch((err) => {
              helper.errorMAil(err, mailSubject, err.stack, null);
            });
        }
      } else {
        await t.rollback();
        return res.json({
          success: false,
          message: "No PO found for approval",
          status: "error",
        });
      }
    }

    return res.json({
      success: true,
      status: "success",
      message: "PO Approved for further processor",
    });
  } catch (err) {
    await t.rollback();
    return helper.errorResponse(res, err);
  }
});

// REJECT PO// REJECT PO
router.post("/rejectPo", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      poid: "required|array",
      remark: "required",
    });

    if (valid.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: valid.errors.all(),
      });
    }

    const { remark } = req.body;

    for (let i = 0; i < req.body.poid.length; i++) {
      let transaction = await invtDB.transaction();
      try {
        const stmt = await invtDB.query(
          "SELECT po_purchase_req.ID , admin_login.Email_ID FROM po_purchase_req LEFT JOIN admin_login ON admin_login.CustID = po_purchase_req.po_insert_by  WHERE po_transaction = :po_id GROUP BY po_transaction",
          {
            replacements: { po_id: req.body.poid[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt.length > 0) {
          if (stmt[0].approval_status == "R") {
            await transaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message: "PO ALREADY REJECTED!!!",
            });
          }
          const stmt_update = await invtDB.query(
            "UPDATE po_purchase_req SET approval_status = 'R' , statusforporequest = 'R' , po_approve_by = :po_approve_by , po_rej_remark = :remark WHERE  po_transaction = :poid",
            {
              replacements: {
                poid: req.body.poid[i],
                po_approve_by: req.logedINUser,
                remark: req.body.remark,
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            }
          );

          if (stmt_update.length > 0) {
            let stmt_po_log = await invtDB.query(
              "INSERT INTO `po_status_log`(`po_id`, `po_log_status`, `po_log_remark`, `insert_dt`, `insert_time`, `insert_by`) VALUES ( :poid, :status, :remark, :insert_dt, :insert_time, :insert_by )",
              {
                replacements: {
                  poid: req.body.poid[i],
                  status: "REJECTED",
                  remark: req.body.remark,
                  insert_dt: moment(new Date()).format("YYYY-MM-DD"),
                  insert_time: moment(new Date()).format("HH:mm:ss"),
                  insert_by: req.logedINUser,
                  transaction: transaction,
                },
              }
            );

            await transaction.commit();
            const po_subject = `PO REJECTED [REF ${req.body.poid[i]}]`;
            const mailMsg = `<p>Hi,</p>
                            <p>PO (${req.body.poid[i]}) Rejected.</p>
                            <p><b>Remark:-</b> ${req.body.remark}</p>
                          `;

            helper.sendMail(stmt[0].Email_ID, null, po_subject, mailMsg, null);
          } else {
            await transaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message: "PO Rejected FAILED",
            });
          }
        } else {
          await transaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "Something wrong!!!",
          });
        }
      } catch (err) {
        await transaction.rollback();
        return helper.errorResponse(res, err);
      }
    }
    return res.json({
      success: true,
      status: "success",
      message: "PO Rejected",
    });
  } catch (err) {
    await transaction.rollback();
    return helper.errorResponse(res, err);
  }
});

// Upload the File While Creating PO
//! Use of Multer
var storage = multer.diskStorage({
  destination: (req, file, callBack) => {
    callBack(null, "./uploads/temp/");
  },
  filename: (req, file, callBack) => {
    callBack(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});

var upload = multer({ storage: storage });
router.post(
  "/uploadPoFile",
  upload.single("file"),
  [auth.isAuthorized],
  async (req, res) => {
    try {
      // VALIDATE FILE
      if (req.file == undefined) {
        return res.json({
          success: false,
          status: "error",
          message: "Please select a file",
        });
      }
      // Validate file extension (should be .xlsx)
      const fileExtension = req.file.originalname.split(".").pop();
      if (fileExtension !== "xlsx") {
        return res.json({
          success: false,
          status: "error",
          message: "File format must be .xlsx",
        });
      }

      var workbook = XLSX.readFile("./uploads/temp/" + req.file.filename);

      let json_data = XLSX.utils.sheet_to_json(workbook.Sheets.Sheet1);

      let data = [];
      let errors = [];
      let gsttypeSet = new Set();
      let partCodeMap = new Map();
      let partCodes = json_data.map((item) => item.PARTCODE);

      let componentData = await invtDB.query(
        "SELECT `c_part_no`, `c_name` FROM `components` WHERE `c_part_no` IN (:part_codes)",
        {
          replacements: { part_codes: partCodes },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let componentMap = new Map();
      componentData.forEach((component) => {
        componentMap.set(component.c_part_no, component.c_name);
      });

      await Promise.all(
        json_data.map(async (item, index) => {
          if (!item.PARTCODE || item.PARTCODE.replace(/\s+/g, "") === "") {
            errors.push(
              `PARTCODE is empty or contains only spaces in row no. ${
                index + 2
              }`
            );
            return;
          }

          if (
            !item.GSTTYPE ||
            item.GSTTYPE.replace(/\s+/g, "") === "" ||
            (item.GSTTYPE.toUpperCase() !== "L" &&
              item.GSTTYPE.toUpperCase() !== "I")
          ) {
            errors.push(
              `GSTTYPE is empty or contains spaces or not L,I in row no. ${
                index + 2
              }`
            );
            return;
          }

          if (!componentMap.has(item.PARTCODE)) {
            errors.push(
              `Part code not valid (${item.PARTCODE}) in file row no. ${
                index + 2
              }`
            );
            return;
          }

          let c_part_name = componentMap.get(item.PARTCODE);

          // Track GSTTYPE unique
          gsttypeSet.add(item.GSTTYPE);
          if (gsttypeSet.size > 1) {
            errors.push(
              `Multiple GSTTYPE values found. Please ensure only one type (L or I). Error in row no. ${
                index + 2
              }`
            );
            return;
          }

          // Check for duplicate PARTCODEs
          if (partCodeMap.has(item.PARTCODE)) {
            let rows = partCodeMap.get(item.PARTCODE);
            rows.push(index + 2);
            partCodeMap.set(item.PARTCODE, rows);
          } else {
            partCodeMap.set(item.PARTCODE, [index + 2]);
          }

          data.push({
            partCode: item.PARTCODE,
            partName: c_part_name,
            qty: item.QTY,
            rate: item.RATE,
            hsn: item.HSNCODE,
            gsttype: item.GSTTYPE,
            gst: item.GSTRATE,
          });
        })
      );

      let duplicates = [];
      partCodeMap.forEach((rows, partCode) => {
        if (rows.length > 1) {
          duplicates.push(
            `Part code ${partCode} found in rows: ${rows.join(", ")}`
          );
        }
      });

      if (duplicates.length > 0) {
        errors.push(`Duplicate part codes found: ${duplicates.join("; ")}`);
      }

      if (errors.length > 0) {
        return res.json({
          success: false,
          message: errors.join("; "),
          status: "error",
        });
      }

      // Unlink File
      fs.unlinkSync("./uploads/temp/" + req.file.filename);
      return res.json({ data, success: true, status: "success" });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

//feth request po

//FETCH PENDING PURCHASE ORDER
router.post("/requested", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
    return;
  }

  try {
    let result = [];
    if (searchBy == "single_date_wise") {
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
          message:
            "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          success: false,
        });
      }

      result = await invtDB.query(
        "SELECT po_purchase_req.* , ven_basic_detail.* , cost_center.*  , admin_login.user_name AS po_created_by, po_approve.user_name as approve_by , raised_by.user_name as raise_by , project_master.project_description , COALESCE(SUM(po_purchase_req.po_order_qty),0) totalReq_Qty, COALESCE(SUM(po_purchase_req.po_pending_qty),0) totalIn_Qty FROM po_purchase_req LEFT JOIN ven_basic_detail ON po_purchase_req.po_vendor_reg_id = ven_basic_detail.ven_register_id LEFT JOIN admin_login ON po_purchase_req.po_insert_by = admin_login.CustID LEFT JOIN cost_center ON po_purchase_req.po_cost_center = cost_center.cost_center_key LEFT JOIN admin_login po_approve ON po_approve.CustID = po_purchase_req.po_approve_by  LEFT JOIN admin_login raised_by ON raised_by.CustID = po_purchase_req.po_raise_by LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name WHERE DATE_FORMAT(po_purchase_req.po_full_date,'%Y-%m-%d') BETWEEN :datefrom AND :dateto AND po_purchase_req.po_status = :status AND po_purchase_req.company_branch = :branch AND  po_purchase_req.txn_session = :session AND (po_purchase_req.statusforporequest IS NULL OR po_purchase_req.statusforporequest IN ('N','R','UV')) AND approval_status IN ('P', 'R')  GROUP BY po_purchase_req.po_transaction ORDER BY po_purchase_req.ID DESC",
        {
          replacements: {
            datefrom: fromdate,
            dateto: todate,
            status: "A",
            branch: req.branch,
            session: req.session,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "po_wise") {
      result = await invtDB.query(
        "SELECT po_purchase_req.* , ven_basic_detail.* , cost_center.*  , admin_login.user_name AS po_created_by, po_approve.user_name as approve_by , raised_by.user_name as raise_by , project_master.project_description , COALESCE(SUM(po_purchase_req.po_order_qty),0) totalReq_Qty, COALESCE(SUM(po_purchase_req.po_pending_qty),0) totalIn_Qty FROM po_purchase_req LEFT JOIN ven_basic_detail ON po_purchase_req.po_vendor_reg_id = ven_basic_detail.ven_register_id LEFT JOIN admin_login ON po_purchase_req.po_insert_by = admin_login.CustID LEFT JOIN cost_center ON po_purchase_req.po_cost_center = cost_center.cost_center_key LEFT JOIN admin_login po_approve ON po_approve.CustID = po_purchase_req.po_approve_by  LEFT JOIN admin_login raised_by ON raised_by.CustID = po_purchase_req.po_raise_by LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name WHERE po_purchase_req.po_transaction LIKE CONCAT('%', :po_id, '%') AND po_purchase_req.po_status = :status AND po_purchase_req.company_branch = :branch AND  po_purchase_req.txn_session = :session AND (po_purchase_req.statusforporequest IS NULL OR po_purchase_req.statusforporequest IN ('N','R','UV')) AND approval_status IN ('P', 'R')  GROUP BY po_purchase_req.po_transaction ORDER BY po_purchase_req.ID DESC",
        {
          replacements: { po_id: searchValue, status: "A", branch: req.branch, session: req.session },
          type: invtDB.QueryTypes.SELECT,
        }
      );

    } else {
      res.json({
        status: "error",
        message: "something you missing in form field to supply",
        success: false,
      })
      return;
    }

    if (result.length > 0) {
      let finalResult = [];
      for (let i = 0; i < result.length; i++) {
        if (result[i].totalIn_Qty > 0) {
          let status = "--";
          if (result[i].approval_status == "P") {
            status = "PENDING";
          }
          if (result[i].approval_status == "A") {
            status = "APPROVED";
          }
          if (result[i].approval_status == "R") {
            status = "REJECTED";
          }
          if (result[i].approval_status == "D") {
            status = "CANCELLED";
          }

          let poacceptstatus = "PENDING";
          if (result[i].statusforporequest === "A") {
            poacceptstatus = "APPROVED";
          } else if (result[i].statusforporequest === "R") {
            poacceptstatus = "REJECTED";
          } else if (result[i].statusforporequest === "UV") {
            poacceptstatus = "UNDER VERIFICATION";
          }
          const creatorIds = [
            ...new Set(result.map((r) => r.po_raise_by).filter(Boolean)),
          ];

          const leaderMap = {};
          if (creatorIds.length > 0) {
            const leaders = await otherDB.query(
              `SELECT 
           ipt.ims_po_team_member AS member_id,
           leader.Email_ID AS leader_email,
           leader.user_name AS leader_name,
           leader.CustID AS leader_id
         FROM ims_po_team ipt
         INNER JOIN ${global.ims_db_name}.admin_login leader 
           ON leader.CustID = ipt.ims_po_team_leader
         WHERE ipt.ims_po_team_member IN (:creatorIds)
           AND ipt.status = 'ACTIVE'`,
              {
                replacements: { creatorIds },
                type: otherDB.QueryTypes.SELECT,
              }
            );

            leaders.forEach((l) => {
              leaderMap[l.member_id] = {
                leader_email: l.leader_email || "NA",
                leader_name: l.leader_name || "NA",
                leader_id: l.leader_id || "NA",
              };
            });
          }
          const leader = leaderMap[result[i].po_raise_by] || {};
          finalResult.push({
            advPayment: result[i].advance_payment,
            po_transaction: result[i].po_transaction,
            vendor_name: result[i].ven_name,
            po_comment: result[i].po_comment,
            vendor_id: result[i].po_vendor_reg_id,
            po_reg_date: moment(
              result[i].po_full_date,
              "YYYY-MM-DD HH:mm:ss"
            ).format("DD-MM-YYYY HH:mm:ss"),
            po_reg_by: result[i].po_created_by,
            due_date: result[i].po_duedate == "" ? "--" : result[i].po_duedate,
            time_ago: format(result[i].po_full_date, "en_US"),
            po_trans_encrypt: result[i].po_transaction,
            po_status: result[i].po_status,
            approval_status: status,
            cost_center:
              result[i].cost_center_name +
              " (" +
              result[i].cost_center_short_name +
              ")",
            po_reject_remark:
              status == "REJECTED" ? result[i].po_rej_remark : "NA",
            project_id: result[i].po_project_name ?? "NA",
            project_name: result[i].project_description ?? "NA",
            requested_by: result[i].raise_by ?? "NA",
            approved_by: result[i].approve_by ?? "NA",
            poacceptstatus: poacceptstatus,
            leader_email: leader.leader_email || "NA",
            leader_name: leader.leader_name || "NA",
            leader_id: leader.leader_id || "NA",
          });
        }
      }
      if (finalResult.length > 0) {
        return res.json({
          success: true,
          status: "success",
          data: finalResult,
        });
      } else {
        return res.json({
          success: false,
          message: "No PO found",
          status: "error",
        });
      }
    }
    res.json({
      success: false,
      message: "No PO found",
      status: "error",
    });
    return;
  } catch (err) {
    console.log(err);
    return res.json({
      success: false,
      message: "Something went wrong",
      status: "error",
      stack: err.stack,
    })
  }
});

//pending request po fro accoutn team
router.post(
  "/updatePOComponentStatus",
  [auth.isAuthorized, poPermission.checkPOPermission('approve')],
  async (req, res) => {
    const validation = new Validator(req.body, {
      po_transaction: "required",
      vendor_code: "required",
      components: "required|array",
      "components.*.component_key": "required",
      "components.*.status": "required",
      remark: "string",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: "Something is missing in the form fields",
        data: validation.errors.all(),
      });
    }

    const { po_transaction, vendor_code, components, remark = "" } = req.body;
    const t = await invtDB.transaction();

    try {
      
      const userInfo = req.userPermissions;

      // Get approval level permissions from JSON
      const hasFirstLevelPermission = userInfo.permissions.can_approve_po_first_level === true;
      const hasFinalLevelPermission = userInfo.permissions.can_approve_po_final_level === true;

      // Check if user has any approval permission
      if (!hasFirstLevelPermission && !hasFinalLevelPermission) {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "You do not have permission to approve/reject POs",
        });
      }

      // Check PO current status and statusforporequest
      const poCheck = await invtDB.query(
        `SELECT po_transaction, approval_status, statusforporequest, po_cost_center
         FROM po_purchase_req 
         WHERE po_transaction = :po 
         AND company_branch = :branch 
         LIMIT 1`,
        {
          replacements: { po: po_transaction, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (!poCheck.length) {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "PO not found or access denied",
        });
      }

      const currentPOStatus = poCheck[0].approval_status || 'P';
      const currentStatusForPORequest = poCheck[0].statusforporequest || 'N';

      // **VALIDATION LOGIC**
      
      // First-level users can ONLY work when statusforporequest is Pending (N)
      if (hasFirstLevelPermission && !hasFinalLevelPermission) {
        if (!['N', null, ''].includes(currentStatusForPORequest)) {
          await t.rollback();
          return res.json({
            success: false,
            status: "error",
            message: 
              `You can only approve/reject POs in 'Pending (N)' status. This PO request is currently in '${currentStatusForPORequest}' status.` 
          });
        }
      }

      // Final-level users can ONLY work when statusforporequest is UV (Under Verification)
      if (hasFinalLevelPermission && !hasFirstLevelPermission) {
        if (currentStatusForPORequest !== 'UV') {
          await t.rollback();
          return res.json({
            success: false,
            status: "error",
            message: `You can only give final approval to POs in 'Under Verification (UV)' status. This PO request is currently in '${currentStatusForPORequest}' status.`
          });
        }
      }

      // Users with both permissions
      if (hasFirstLevelPermission && hasFinalLevelPermission) {
        // They can work on both N and UV, but not on already approved (A)
        if (!['N', 'UV', null, ''].includes(currentStatusForPORequest)) {
          await t.rollback();
          return res.json({
            success: false,
            status: "error",
            message: `This PO request is already in '${currentStatusForPORequest}' status and cannot be modified.`,
          });
        }
      }

      // To store rate mismatch info
      const rateMismatchComponents = [];

      // LOOP THROUGH COMPONENTS
      for (const comp of components) {
        const { component_key, status } = comp;

        if (!["A", "R"].includes(status)) {
          await t.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "Status must be 'A' (Approve) or 'R' (Reject)",
          });
        }

        // Fetch PO rate
        const poRateData = await invtDB.query(
          `SELECT po_order_rate, c_name, c_part_no 
           FROM po_purchase_req 
           LEFT JOIN components ON po_purchase_req.po_part_no = components.component_key
           WHERE po_transaction = :po 
             AND po_part_no = :key 
             AND company_branch = :branch 
           LIMIT 1`,
          {
            replacements: {
              po: po_transaction,
              key: component_key,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
            transaction: t,
          }
        );

        if (!poRateData.length) {
          await t.rollback();
          return res.json({
            success: false,
            status: "error",
            message: `Component ${component_key} not found in this PO`,
          });
        }

        const order_rate = parseFloat(poRateData[0].po_order_rate || 0);
        const component_name = poRateData[0].c_name || component_key;
        const part_no = poRateData[0].c_part_no || "";

        // Fetch last inward rate
        const lastRateRaw = await require("../../../helper/utils/avgRate").getLastInwardRate(
          component_key,
          vendor_code
        );

        const last_actual_rate = parseFloat(lastRateRaw || 0);
        const rateDifference = Math.abs(order_rate - last_actual_rate);

        // Rate mismatch check (tolerance of 0.01)
        const isRateMismatch = rateDifference > 0.01;

        if (status === "A" && isRateMismatch) {
          
          if (hasFirstLevelPermission && !hasFinalLevelPermission) {
            rateMismatchComponents.push({
              component_key,
              component_name,
              part_no,
              order_rate: order_rate.toFixed(4),
              last_rate: last_actual_rate.toFixed(4),
              difference: rateDifference.toFixed(4),
            });
          }
          
          // If user with both permissions is working on Pending (N) PO → BLOCK
          if (hasFirstLevelPermission && hasFinalLevelPermission && currentStatusForPORequest === 'N') {
            rateMismatchComponents.push({
              component_key,
              component_name,
              part_no,
              order_rate: order_rate.toFixed(4),
              last_rate: last_actual_rate.toFixed(4),
              difference: rateDifference.toFixed(4),
            });
          }

          // If final-level user is approving UV PO with rate mismatch → ALLOW 
          if (hasFinalLevelPermission && currentStatusForPORequest === 'UV') {
            rateMismatchComponents.push({
              component_key,
              component_name,
              part_no,
              order_rate: order_rate.toFixed(4),
              last_rate: last_actual_rate.toFixed(4),
              difference: rateDifference.toFixed(4),
              overridden_by: req.logedINUser,
              note: "Rate mismatch approved by final authority"
            });
          }
        }
      }

      // **BLOCK if rate mismatch found and user is NOT doing final approval on UV PO**
      const shouldBlockForRateMismatch = rateMismatchComponents.length > 0 && 
        (currentStatusForPORequest !== 'UV' || !hasFinalLevelPermission);

      if (shouldBlockForRateMismatch) {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Rate mismatch detected! Only final approval authority can approve POs with rate mismatches when they are in 'Under Verification (UV)' status.",
          data: rateMismatchComponents,
        });
      }

      // Fetch PO Creator for email notification
      const poCreatorData = await invtDB.query(
        `SELECT DISTINCT po_raise_by, u.Email_ID 
         FROM po_purchase_req p 
         LEFT JOIN ${global.ims_db_name}.admin_login u 
           ON u.CustID = p.po_raise_by 
         WHERE p.po_transaction = :po 
           AND p.company_branch = :branch`,
        {
          replacements: { po: po_transaction, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
          transaction: t,
        }
      );

      let poCreatorEmail = "";
      let poCreatorName = "User";

      if (poCreatorData.length > 0) {
        poCreatorEmail = poCreatorData[0].Email_ID || "";
        poCreatorName = poCreatorData[0].po_raise_by || "User";
      }

      const rejectedComponents = components.filter((c) => c.status === "R");
      const approvedComponents = components.filter((c) => c.status === "A");
      const hasRejection = rejectedComponents.length > 0;
      const hasApproval = approvedComponents.length > 0;

      // **APPLY UPDATES**
      for (const comp of components) {
        const { component_key, status, remark: compRemark = "" } = comp;
        const finalRemark = (compRemark || remark).trim();

        let updateQuery = `
          UPDATE po_purchase_req
          SET statusforporequest = :status,
              remarkbyactacoutteam = :remark,
              porequestApprovalId = :approvedBy
        `;

      
        if (hasFinalLevelPermission && currentStatusForPORequest === 'UV' && status === "A") {
          updateQuery += `, approval_status = 'A', po_approve_by = :approvedBy`;
        }

        updateQuery += `
          WHERE po_transaction = :po
          AND po_part_no = :component_key
          AND company_branch = :branch
        `;

        // Determine the new statusforporequest value
        let newStatusForPORequest = status; // 'A' or 'R'
        
        // If first-level approving pending (N) → change to UV
        if (status === 'A' && currentStatusForPORequest === 'N' && !hasFinalLevelPermission) {
          newStatusForPORequest = 'A';
        }
        
        // If user with both permissions approving pending (N) → change to UV
        if (status === 'A' && currentStatusForPORequest === 'N' && hasFirstLevelPermission && hasFinalLevelPermission) {
          newStatusForPORequest = 'A';
        }

        // If rejecting → change back to N (Pending)
        if (status === 'R') {
          newStatusForPORequest = 'R';
        }

        await invtDB.query(updateQuery, {
          replacements: {
            status: newStatusForPORequest,
            remark: finalRemark,
            approvedBy: req.logedINUser,
            po: po_transaction,
            component_key,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.UPDATE,
          transaction: t,
        });
      }

      // **INSERT LOG ENTRY**
      let logStatus = "";
      let logRemark = remark || "--";

      if (hasRejection) {
        logStatus = rejectedComponents.length === components.length ? "FULLY REJECTED" : "PARTIALLY REJECTED";
        logRemark = `Components rejected: ${rejectedComponents.map(c => c.component_key).join(", ")}. ${logRemark}`;
      } else if (hasApproval) {
        if (hasFinalLevelPermission && currentStatusForPORequest === 'UV') {
          logStatus = "FINAL APPROVED";
        } else {
          logStatus = "FIRST LEVEL APPROVED";
        }
        logRemark = `Components approved: ${approvedComponents.map(c => c.component_key).join(", ")}. ${logRemark}`;
      }

     
      if (rateMismatchComponents.length > 0 && hasFinalLevelPermission && currentStatusForPORequest === 'UV') {
        logRemark += ` | Rate Mismatch Override by ${req.logedINUser}`;
      }

      await invtDB.query(
        `INSERT INTO po_status_log 
         (po_id, po_log_status, po_log_remark, insert_dt, insert_time, insert_by) 
         VALUES (:poid, :status, :remark, :insert_dt, :insert_time, :insert_by)`,
        {
          replacements: {
            poid: po_transaction,
            status: logStatus,
            remark: logRemark,
            insert_dt: moment(new Date()).format("YYYY-MM-DD"),
            insert_time: moment(new Date()).format("HH:mm:ss"),
            insert_by: req.logedINUser,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        }
      );

      await t.commit();

      // **EMAIL NOTIFICATION for rejections**
      if (hasRejection && poCreatorEmail) {
        const rejectedList = rejectedComponents
          .map((c) => {
            return `- Component: ${c.component_key} → Rejected ${
              c.remark ? `(Remark: ${c.remark})` : ""
            }`;
          })
          .join("<br>");

        const globalRemark = remark
          ? `<br><br><b>General Remark:</b> ${remark}`
          : "";

        const mail_subject = `PO #${po_transaction} - Component(s) Rejected`;
        const mail_body = `
            <p>Dear ${poCreatorName},</p>
            <p>Your PO <strong>#${po_transaction}</strong> has been reviewed.</p>
            <p><strong>Status:</strong> <span style="color:red;">Some components have been REJECTED</span></p>

            <hr>
            <p><b>Rejected Components:</b><br>${rejectedList}</p>
            ${globalRemark}
            <hr>

            <p>Please review and resubmit with correct information.</p>
            <p><a href="https://oakter.mscorpres.co.in/approval-po">Click here to view PO</a></p>
            <br>
            <p>Thank you,<br>Approval Team</p>
          `;

        helper.sendMail(poCreatorEmail, null, mail_subject, mail_body, null);
      }

      // **EMAIL NOTIFICATION for final approval**
      if (hasApproval && hasFinalLevelPermission && currentStatusForPORequest === 'UV' && poCreatorEmail) {
        const mailSubject = `PO APPROVED [REF ${po_transaction}]`;
        const mailMsg = `<div style="font-family: Roboto,sans-serif;">
                          <p>Hi ${poCreatorName},</p>
                          <p>PO <b>(${po_transaction})</b> has been APPROVED.</p>
                          <p><b>Remark:</b> ${remark || "No remarks"}</p>
                        </div>`;

        let file = {
          url:
            `${process.env.API_URL}/helper/PRINT/PHP/PO/alwar-printReceipt.php?invoice=${Buffer.from(po_transaction).toString("base64")}`,
        };
        let options = { format: "A4" };
        
        html_to_pdf
          .generatePdf(file, options)
          .then((pdfBuffer) => {
            helper.sendMail(poCreatorEmail, null, mailSubject, mailMsg, [
              { filename: "POFILE.pdf", content: pdfBuffer }
            ]);
          })
          .catch((err) => {
            helper.errorMAil(err, mailSubject, err.stack, null);
          });
      }

      // Determine next status and approval level
      let nextStatusForPORequest = "";
      let approvalLevel = "";

      if (hasRejection) {
        nextStatusForPORequest = "Pending (N)";
        approvalLevel = "Rejected - Sent back for correction";
      } else if (hasApproval) {
        if (currentStatusForPORequest === 'UV' && hasFinalLevelPermission) {
          nextStatusForPORequest = "Approved (A)";
          approvalLevel = "Final Approval - Completed";
        } else if (currentStatusForPORequest === 'N' || currentStatusForPORequest === null || currentStatusForPORequest === '') {
          nextStatusForPORequest = "Under Verification (UV)";
          approvalLevel = "First Level Approval - Sent for Final Review";
        }
      }

      return res.json({
        success: true,
        status: "success",
        message: "PO components updated successfully",
        data: {
          po_transaction,
          updated: components.length,
          action: hasRejection
            ? rejectedComponents.length === components.length
              ? "Fully Rejected"
              : "Partially Rejected"
            : "Approved",
          approval_level: approvalLevel,
          previous_statusforporequest: currentStatusForPORequest,
          new_statusforporequest: nextStatusForPORequest,
          approval_status_updated: hasFinalLevelPermission && currentStatusForPORequest === 'UV' && hasApproval ? "Yes" : "No",
          rate_mismatch_info: rateMismatchComponents.length > 0 ? rateMismatchComponents : null,
          user_info: {
            team_name: userInfo.team_name,
            role: userInfo.role,
            first_level_permission: hasFirstLevelPermission,
            final_level_permission: hasFinalLevelPermission
          }
        },
      });
    } catch (err) {
      await t.rollback();
      console.error("updatePOComponentStatus error:", err);
      return res.json({
        success: false,
        status: "error",
        message: "Internal Error!!! Contact administrator",
        error: err.message,
      });
    }
  }
);

router.post("/bomRecipe", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    let limit = 10;
    if (req.body.search == "") {
      stmt = await invtDB.query(
        "SELECT * FROM `bom_recipe` WHERE `bom_status` = 'ENABLE' ORDER BY `subject_name` ASC LIMIT :limit",
        {
          replacements: { limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT * FROM `bom_recipe` WHERE `bom_status` = 'ENABLE' AND (`subject_id` LIKE :search OR `subject_name` LIKE :search OR `bom_product_sku` LIKE :search) ORDER BY `subject_name` ASC LIMIT :limit",
        {
          replacements: { search: `%${req.body.search}%`, limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({
          id: item.subject_id,
          text: item.subject_name + " (" + item.bom_product_sku + ")",
        });

        if (stmt.length == final.length) {
          res.json({ success: true, data: final, status: "success" });
          return;
        }
      });
    } else {
      res.json([{ id: "0", text: "No Data Found" }]);
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

const storage1 = multer.diskStorage({
  destination: "POtmp",
  filename: function (req, file, cb) {
    cb(null, "TRY" + Date.now() + Math.floor(Math.random() * 900 + 100) + path.extname(file.originalname));
  },
});

const upload1 = multer({ storage: storage1 });


router.post("/upload/item", upload1.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({
        code: 400,
        message: { msg: "No file uploaded. Please upload an Excel file." },
        status: "error",
        success: false,
      });
    }

    const expectedColumns = [
      "PART_CODE",
      "ITEM_DESCRIPTION",
      "QTY",
      "RATE",
      "HSN",
      "DUE_DATE",
      "GST_RATE",
      "INTERNAL_REMARK",
    ];



    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        code: 400,
        message:"Excel file is empty or invalid. Please ensure the file contains at least one sheet.",
        status: "error",
        success: false,
      });
    }

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    if (!worksheet || !worksheet["!ref"]) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        code: 400,
        message:"Excel sheet is empty. Please ensure the sheet contains data.",
        status: "error",
        success: false,
      });
    }


    const headers = [];
    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      const cell = worksheet[cellAddress];
      headers.push(cell ? cell.v : null);
    }

    if (headers.length !== expectedColumns.length) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        code: 400,
        message:`Excel column validation failed. Expected ${expectedColumns.length} columns but found ${headers.length} columns.`,
        status: "error",
        success: false,
      });
    }

    const mismatches = headers
      .map((header, index) => {
        const headerStr =
          header && typeof header === "string" ? header.trim().toUpperCase().replace(/ /g, "_") : "";
        const expectedStr = expectedColumns[index] ? expectedColumns[index].toUpperCase() : "";
        if (headerStr !== expectedStr) {
          return {
            column: `Column ${String.fromCharCode(65 + index)}`,
            actual: header || "Empty",
            expected: expectedColumns[index] || "N/A",
          };
        }
        return null;
      })
      .filter(Boolean);

    if (mismatches.length > 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        code: 400,
        message:"Excel column validation failed.",
        mismatches,
        status: "error",
        success: false,
      });
    }

    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const data = rows.slice(1);

    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      const rowNumber = rowIndex + 2;

      if (!row) continue;
      while (row.length < expectedColumns.length) {
        row.push(undefined);
      }


      const partCode = row[0];
      if (!partCode) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message:`Excel column validation failed\nPART_CODE is required at row number [${rowNumber}]`,
          status: "error",
          success: false,
        });
      }
      const { venderCode, projectId } = req.body

      if (!venderCode || !projectId) {
        return res.status(400).json({
          code: 400,
          message: { msg: "Vender code or Project id not found" },
          status: "error",
          success: false,
        });
      }



      const partCodeData = await invtDB.query(
        "SELECT `c_name`, `component_key`, `c_part_no`, u.units_name FROM `components` LEFT JOIN `units` u ON u.units_id = components.c_uom WHERE `c_part_no` = :partcode",
        { replacements: { partcode: String(partCode) }, type: invtDB.QueryTypes.SELECT }
      );

      if (!partCodeData || partCodeData.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message:`Excel column validation failed\nPART_CODE '${partCode}' does not exist in the database at row number [${rowNumber}]`,
          status: "error",
          success: false,
        });
      }

      const component_key = partCodeData[0].component_key;


      const lastRate =
        await require("../../../helper/utils/avgRate").getLastInwardRate(
          component_key,
          venderCode
        );


      const branch = req.branch;
      const location_key = "2023112717950595";

      let closing_stock = 0;

      const locAllot = await invtDB.query(
        "SELECT locations, branch_locations FROM location_allotted WHERE loc_all_key = :loc_key",
        {
          replacements: { loc_key: location_key },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let allowedLocations = "";

      if (locAllot.length > 0) {
        if (locAllot[0].branch_locations) {
          try {
            const branchLocs = JSON.parse(locAllot[0].branch_locations);
            allowedLocations = branchLocs[branch] || locAllot[0].locations;
          } catch (e) {
            allowedLocations = locAllot[0].locations;
          }
        } else {
          allowedLocations = locAllot[0].locations;
        }
      }

      if (allowedLocations) {
        const locationsArray = allowedLocations.split(",").filter(Boolean);

        const stockResult = await invtDB.query(
          `SELECT 
            COALESCE(SUM(CASE WHEN loc_in IN (:locations) AND trans_type IN ('INWARD','ISSUE','JOBWORK','REJECTION','TRANSFER') THEN qty ELSE 0 END), 0) 
            - 
            COALESCE(SUM(CASE WHEN loc_out IN (:locations) AND trans_type IN ('CONSUMPTION','ISSUE','JOBWORK','REJECTION','TRANSFER') THEN qty ELSE 0 END), 0) AS closing_qty
          FROM rm_location 
          WHERE components_id = :component`,
          {
            replacements: {
              locations: locationsArray,
              component: component_key,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        closing_stock = stockResult[0]?.closing_qty || 0;
      }

      let projected_qty = 0;

      const projectBOMResult = await invtDB.query(
        `SELECT pm.bomsubjectid, pm.projectQty 
         FROM project_master pm
         WHERE pm.project_name = :project_name
         AND pm.bomsubjectid IS NOT NULL 
         AND pm.bomsubjectid != '' 
         AND pm.bomsubjectid != '--'
         AND pm.projectQty > 0`,
        {
          replacements: { project_name: projectId },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      console.log("pro --- ", projected_qty)

      if (projectBOMResult.length > 0) {
        for (const project of projectBOMResult) {
          const bomQtyResult = await invtDB.query(
            `SELECT bq.qty 
             FROM bom_quantity bq
             INNER JOIN bom_recipe br ON bq.subject_under = br.subject_id
             WHERE bq.subject_under = :bom_id 
             AND bq.component_id = :component_id
             AND br.bom_status = 'ENABLE'`,
            {
              replacements: {
                bom_id: project.bomsubjectid,
                component_id: component_key,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (bomQtyResult.length > 0) {
            const bomComponentQty = bomQtyResult[0].qty || 0;
            const projectQty = project.projectQty || 0;

            projected_qty += projectQty * bomComponentQty;
          }
        }
      }

      let executed_qty = 0;
      const executedQtyResult = await invtDB.query(
        `SELECT COALESCE(SUM(pr.po_order_qty), 0) AS total_executed_qty
         FROM po_purchase_req pr
         INNER JOIN project_master pm ON pr.po_project_name = pm.project_name
         WHERE pr.po_part_no = :component_code
         AND pm.project_name = :project_name
         AND pm.bomsubjectid IS NOT NULL 
         AND pm.bomsubjectid != '' 
         AND pm.bomsubjectid != '--'`,
        {
          replacements: {
            component_code: component_key,
            project_name: projectId,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (executedQtyResult.length > 0) {
        executed_qty = executedQtyResult[0].total_executed_qty || 0;
      }


      row[0] =
        partCodeData.length === 1
          ? {
            name: partCodeData[0].c_name,
            key: partCodeData[0].component_key,
            partNo: partCodeData[0].c_part_no,
            uom: partCodeData[0].units_name,
            rate: helper.number(lastRate),
            closing_stock: helper.number(closing_stock),
            project_req_qty: helper.number(projected_qty),
            po_exec_qty: helper.number(executed_qty),
          }
          : partCodeData.map((c) => ({
            name: c.c_name,
            key: c.component_key,
            partNo: c.c_part_no,
            uom: c.units_name,
            rate: helper.number(lastRate),
            closing_stock: helper.number(closing_stock),
            project_req_qty: helper.number(projected_qty),
            po_exec_qty: helper.number(executed_qty),
          }));


      const itemDescription = row[1];
      row[1] = itemDescription != null ? String(itemDescription).trim() : "--";

      const qty = Number(row[2]);
      if (row[2] === null || row[2] === undefined || isNaN(qty) || qty <= 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message:`Excel column validation failed\nQTY must be a non-zero positive number at row number [${rowNumber}]`,
          status: "error",
          success: false,
        });
      }



      const rate = Number(row[3]);
      if (row[3] === null || row[3] === undefined || isNaN(rate) || rate < 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message: `Excel column validation failed\nRATE must be a non-negative number at row number [${rowNumber}]`,
          status: "error",
          success: false,
        });
      }



      const hsn = row[4];
      if (hsn !== null && hsn !== undefined && hsn !== "--") {
        const hsnStr = String(hsn).trim();
        if (![6, 8].includes(hsnStr.length) || isNaN(Number(hsn))) {
          fs.unlinkSync(filePath);
          return res.status(400).json({
            code: 400,
            message: `Excel column validation failed\nHSN must be '--', a 6-digit, or an 8-digit number at row number [${rowNumber}]`,
            status: "error",
            success: false,
          });
        }
      }
      row[4] = hsn != null ? String(hsn).trim() : "--";


      const dueDate = row[5];
let dueDateStr = "";

if (
  dueDate !== null &&
  dueDate !== undefined &&
  String(dueDate).trim() !== "" &&
  String(dueDate).trim() !== "--"
) {
  dueDateStr = String(dueDate).trim();

  const dueDateRegex = /^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}$/;

  if (!dueDateRegex.test(dueDateStr)) {
    fs.unlinkSync(filePath);
    return res.status(400).json({
      code: 400,
      message: `Excel column validation failed\nDUE_DATE must be in DD-MM-YYYY or DD/MM/YYYY format at row number [${rowNumber}]`,
      status: "error",
      success: false,
    });
  }
}

row[5] = dueDateStr;


      const gstRate = row[6] != null && String(row[6]).trim() !== "" ? Number(row[6]) : 0;
      row[6] = gstRate;


      const internalRemark = row[7];
      row[7] = internalRemark != null ? String(internalRemark).trim() : "--";
    }

    // fs.unlinkSync(filePath);

    const transformedHeaders = headers.map((header) => {
      if (!header || typeof header !== "string") return header || "Unknown";
      return header.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    });

    return res.json({
      code: 200,
      success: true,
      data: {
        headers: transformedHeaders,
        rows: data,
      },
      message: "Excel file validated successfully.",
      status: "success",
    });
  } catch (error) {
    console.log(error);
    if (req.file && req.file.path) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({
      code: 500,
      message: { msg: "Internal Error! If this persists, contact your system administrator." },
      error: error.message,
      status: "error",
      success: false,
    });
  }
});

module.exports = router;

const { invtDB } = require("../../../config/db/connection");
const express = require("express");
const router = express.Router();
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
const {decode, encode} = require("html-entities");

// GET QCA MINS
router.post("/", [auth.isAuthorized], async (req, res) => {
  const min_types = req.body.min_types;

  const validation = new Validator(req.body, {
    data: "required",
    min_types: "required",
  });

  if (validation.fails()) {
    return res.status(400).json({ success: false, code: 500, message: helper.firstErrorValidatorjs(validation), status: "error" });
  }

  try {
    let result = [];

    if (min_types == "M") {
      const searchValue = req.body.data;

      if (!/([0-9]{2})-([0-9]{2})-([0-9]{4})/gi.test(searchValue)) {
        return res.json({ success: false, status: "error", message: "Invalid date format" });
      }

      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      let date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      let date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      if (moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "days") > "90") {
        return res.status(400).json({
          success: false,
          status: "error",
          message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          code: "500",
        });
      }

      result = await invtDB.query(
        "SELECT *, `rm_location`.`insert_date` FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN location_main ON rm_location.loc_in = location_main.location_key LEFT JOIN admin_login ON rm_location.insert_by = admin_login.CustID WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND DATE_FORMAT(rm_location.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `rm_location`.trans_type = 'INWARD' AND `rm_location`.in_module = 'IN-QCA' ORDER BY rm_location.insert_date DESC",
        { replacements: { date1: date1, date2: date2 }, type: invtDB.QueryTypes.SELECT }
      );
    }

    if (result.length > 0) {
      let finalResult = [];
      result.forEach(async (element) => {
        let invoiceStatus = false;
        let checkInvoices = await invtDB.query("SELECT * FROM ims_min_invoices WHERE min_min_id = :txn", {
          replacements: { txn: element.in_transaction_id },
          type: invtDB.QueryTypes.SELECT,
        });
        if (checkInvoices.length > 0) {
          invoiceStatus = true;
        }

        let vendor = "";
        if (element.vendor_type == "v01") {
          vendor = "Vendor";
        } else if (element.vendor_type == "j01") {
          vendor = "JWI";
        } else if (element.vendor_type == "s01") {
          vendor = "SortIn";
        } else if (element.vendor_type == "r01") {
          vendor = "RejIn";
        } else if (element.vendor_type == "p01") {
          vendor = "ProdReturn";
        } else {
          vendor = "N/A";
        }
        let vendorName = "N/A";

        if (element.in_vendor_name != "--") {
          let stmt_vendorName = await invtDB.query("SELECT `ven_name` FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor", {
            replacements: { vendor: element.in_vendor_name },
            type: invtDB.QueryTypes.SELECT,
          });
          if (stmt_vendorName.length > 0) {
            vendorName = stmt_vendorName[0].ven_name;
          }
        }

        let project_name = "N/A";
        let invoice_number = "N/A";
        let po_number = "N/A";
        let cost_center = "N/A";
        if (element.in_po_invoice_id !== "--") {
          invoice_number = element.in_po_invoice_id;
          po_number = element.in_po_transaction_id;

          let stmt_project = await invtDB.query(
            "SELECT `po_project_name` , cost_center_name , cost_center_short_name FROM `po_purchase_req` LEFT JOIN cost_center ON cost_center.cost_center_key = po_purchase_req.po_cost_center WHERE `po_transaction` = :po GROUP BY po_transaction",
            { replacements: { po: po_number }, type: invtDB.QueryTypes.SELECT }
          );
          if (stmt_project.length > 0) {
            project_name = stmt_project[0].po_project_name == "" ? "N/A" : stmt_project[0].po_project_name;
            cost_center = stmt_project[0].cost_center_name == "" ? "N/A" : `(${stmt_project[0].cost_center_name}) ${stmt_project[0].cost_center_short_name}`;
          }
        } else {
          if (element.in_invoice_id !== "--") {
            invoice_number = element.in_invoice_id;
          }
        }

        if (element.currency_type == "--" || element.currency_type == "" || element.currency_type == "364907247") {
          currency = "INR";
        } else {
          currency = "USD";
        }

        let inQty = parseInt(element.qty) + parseInt(element.other_qty);

        let hsncode = "";
        if (element.in_hsn_code !== "" && element.in_hsn_code !== "--") {
          hsncode = element.in_hsn_code;
        } else {
          hsncode = "--";
        }

        finalResult.push({
          DATE: moment(element.insert_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"), // date("d-m-Y", strtotime(element.insert_date)),
          COMPONENT: decode(element.c_name),
          PART: element.c_part_no,
          HSNCODE: hsncode,
          TYPE: vendor,
          LOCATION: element.loc_name,
          RATE: element.in_po_rate,
          CURRENCY: currency,
          INQTY: inQty,
          UNIT: element.units_name,
          VENDOR: vendorName,
          PONUMBER: po_number,
          INVOIVENUMBER: invoice_number,
          TRANSACTION: element.in_transaction_id,
          ISSUEBY: element.user_name,
          COMMENT: element.any_remark == "" ? "--" : element.any_remark,
          PROJECT: project_name,
          COSTCENTER: cost_center,
          invoiceStatus: invoiceStatus,
        });

        if (finalResult.length == result.length) {
          return res.json({ status: "success", success: true, data: finalResult });
        }
      });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found" });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

module.exports = router;

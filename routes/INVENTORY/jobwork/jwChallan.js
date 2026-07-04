const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../../config/db/connection");
// let { invtDB, otherDB } = require("../../../config/testDB");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
const moment = require("moment");
const helper = require("./../../../helper/helper");
var html_to_pdf = require("html-pdf-node");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const xlsx = require("xlsx");

checkIfZero = (value) => {
  value = value > 0 ? value : 0;
  return value;
};

// FETCH JOBWORK CHALLAN LIST
router.post("/getJobworkChallan", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      data: "required",
      wise: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: validation.errors.all(),
      });
    }

    const { data, wise } = req.body;
    let stmt;

    if (wise == "issuedtwise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        "SELECT *, COALESCE(`jw_material_challan`.`jw_challan_txn_id`, 'N/A') AS `challan_no` FROM `jw_material_issue` LEFT JOIN `jw_material_challan` ON `jw_material_issue`.`jw_m_transaction_id` = `jw_material_challan`.`jw_challan_ref_id` LEFT JOIN `products` ON `jw_material_issue`.`jw_m_sku` = `products`.`product_key` LEFT JOIN `ven_basic_detail` ON `jw_material_challan`.`jw_vendor_id` = `ven_basic_detail`.`ven_register_id` WHERE DATE_FORMAT(`jw_material_issue`.`jw_m_insert_dt`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `jw_material_issue`.`jw_m_status` != :status AND `jw_material_issue`.`company_branch` = :branch GROUP BY `jw_material_issue`.`jw_m_transaction_id` ORDER BY `jw_material_issue`.`jw_m_insert_dt` DESC",
        {
          replacements: {
            date1: date1,
            date2: date2,
            status: "C",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        "SELECT *, COALESCE(`jw_material_challan`.`jw_challan_txn_id`, 'N/A') AS `challan_no` FROM `jw_material_issue` LEFT JOIN `jw_material_challan` ON `jw_material_issue`.`jw_m_transaction_id` = `jw_material_challan`.`jw_challan_ref_id` LEFT JOIN `products` ON `jw_material_issue`.`jw_m_sku` = `products`.`product_key` LEFT JOIN `ven_basic_detail` ON `jw_material_challan`.`jw_vendor_id` = `ven_basic_detail`.`ven_register_id` WHERE DATE_FORMAT(`jw_material_challan`.`jw_insert_dt`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `jw_material_issue`.`jw_m_status` != :status AND `jw_material_issue`.`company_branch` = :branch GROUP BY `jw_material_issue`.`jw_m_transaction_id` ORDER BY `jw_material_issue`.`jw_m_insert_dt` DESC",
        {
          replacements: {
            date1: date1,
            date2: date2,
            status: "C",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "vendorwise") {
      stmt = await invtDB.query(
        "SELECT *, COALESCE(`jw_material_challan`.`jw_challan_txn_id`, 'N/A') AS `challan_no` FROM `jw_material_issue` LEFT JOIN `jw_material_challan` ON `jw_material_issue`.`jw_m_transaction_id` = `jw_material_challan`.`jw_challan_ref_id` LEFT JOIN `products` ON `jw_material_issue`.`jw_m_sku` = `products`.`product_key` LEFT JOIN `ven_basic_detail` ON `jw_material_challan`.`jw_vendor_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_material_issue`.`jw_m_vendor` = :venid AND `jw_material_issue`.`jw_m_status` != :status AND `jw_material_issue`.`company_branch` = :branch GROUP BY `jw_material_issue`.`jw_m_transaction_id` ORDER BY `jw_material_issue`.`jw_m_insert_dt` DESC",
        {
          replacements: { venid: data, status: "C", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "jw_transaction_wise") {
      stmt = await invtDB.query(
        "SELECT *, COALESCE(`jw_material_challan`.`jw_challan_txn_id`, 'N/A') AS `challan_no` FROM `jw_material_issue` LEFT JOIN `jw_material_challan` ON `jw_material_issue`.`jw_m_transaction_id` = `jw_material_challan`.`jw_challan_ref_id` LEFT JOIN `products` ON `jw_material_issue`.`jw_m_sku` = `products`.`product_key` LEFT JOIN `ven_basic_detail` ON `jw_material_challan`.`jw_vendor_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_material_issue`.`jw_m_job_id` LIKE CONCAT('%', :jw_id, '%') AND `jw_material_issue`.`jw_m_status` != :status AND `jw_material_issue`.`company_branch` = :branch GROUP BY `jw_material_issue`.`jw_m_transaction_id` ORDER BY `jw_material_issue`.`jw_m_insert_dt` DESC",
        {
          replacements: { jw_id: data, status: "C", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "jw_sfg_wise") {
      stmt = await invtDB.query(
        "SELECT *, COALESCE(`jw_material_challan`.`jw_challan_txn_id`, 'N/A') AS `challan_no` FROM `jw_material_issue` LEFT JOIN `jw_material_challan` ON `jw_material_issue`.`jw_m_transaction_id` = `jw_material_challan`.`jw_challan_ref_id` LEFT JOIN `products` ON `jw_material_issue`.`jw_m_sku` = `products`.`product_key` LEFT JOIN `ven_basic_detail` ON `jw_material_challan`.`jw_vendor_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_material_issue`.`jw_m_sku` = :sfgcode AND `jw_material_issue`.`jw_m_status` != :status AND `jw_material_issue`.`company_branch` = :branch GROUP BY `jw_material_issue`.`jw_m_transaction_id` ORDER BY `jw_material_issue`.`jw_m_insert_dt` DESC",
        {
          replacements: { sfgcode: data, status: "C", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "challan_wise") {
      stmt = await invtDB.query(
        "SELECT *, COALESCE(`jw_material_challan`.`jw_challan_txn_id`, 'N/A') AS `challan_no` FROM `jw_material_issue` LEFT JOIN `jw_material_challan` ON `jw_material_issue`.`jw_m_transaction_id` = `jw_material_challan`.`jw_challan_ref_id` LEFT JOIN `products` ON `jw_material_issue`.`jw_m_sku` = `products`.`product_key` LEFT JOIN `ven_basic_detail` ON `jw_material_challan`.`jw_vendor_id` = `ven_basic_detail`.`ven_register_id`  WHERE `jw_material_challan`.`jw_challan_txn_id` LIKE CONCAT('%', :challan_id, '%') AND `jw_material_issue`.`jw_m_status` != :status AND `jw_material_issue`.`company_branch` = :branch GROUP BY `jw_material_issue`.`jw_m_transaction_id` ORDER BY `jw_material_issue`.`jw_m_insert_dt` DESC",
        {
          replacements: { challan_id: data, status: "C", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "Please select valid filter method",
      });
    }

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        let stmt1 = await invtDB.query(
          "SELECT `jw_challan_ref_id`,`challan_status` FROM `jw_material_challan` WHERE `jw_challan_ref_id` = :challan_ref_id AND `jw_material_challan`.`company_branch` = :branch",
          {
            replacements: {
              challan_ref_id: stmt[i].jw_m_transaction_id,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );
        let status = "";
        // STATUS
        if (stmt1.length > 0) {
          status = stmt1[0].challan_status == "A" ? "edit" : "cancel";
        } else {
          status = "create"; // CREATE CHALLAN
        }

        final.push({
          issue_challan_rm_dt: moment(
            stmt[i].jw_m_insert_dt,
            "YYYY-MM-DD HH:mm:ss",
          ).format("DD-MM-YYYY HH:mm:ss"),
          issue_transaction_id: stmt[i].jw_m_transaction_id,
          jw_transaction_id: stmt[i].jw_m_job_id,
          challan_id: stmt[i].challan_no,
          jw_chlln_txn_id: stmt[i].jw_challan_txn_id,
          sku_code: stmt[i].p_sku,
          m_sku: stmt[i].jw_m_sku,
          vendor: `${stmt[i].ven_name} ( ${stmt[i].jw_vendor_id} )`,
          jw_sku_name: stmt[i].p_name,
          status: status,
          jw_ewaybill: stmt[i].jw_ewaybill_no,
          jw_ewaybill_status: stmt[i].jw_ewaybill_status,
        });
      }

      return res.json({ success: true, status: "success", data: final });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "no orders were found that match the given search criteria",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH ALL COMPONENET IN JW CHALLAN
router.post("/fetchAllCompJw", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      transaction: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: "something you missing in form field to supply",
        status: "error",
      });
    }

    let stmt = await invtDB.query(
      "SELECT * FROM `jw_material_issue` LEFT JOIN `components` ON `jw_material_issue`.`jw_m_component` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_material_issue`.`jw_m_transaction_id` = :transaction ORDER BY `components`.`c_part_no`",
      {
        replacements: { transaction: req.body.transaction },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (stmt.length > 0) {
      let stmt_check = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :jobwork_id",
        {
          replacements: { jobwork_id: stmt[0].jw_m_job_id },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt_check.length > 0) {
        let final = [];
        let vendor_name;
        if (
          stmt_check[0].jw_po_vendor_reg_id !== "" &&
          stmt_check[0].jw_po_vendor_reg_id !== null
        ) {
          let stmt_ven = await invtDB.query(
            "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor_id",
            {
              replacements: { vendor_id: stmt_check[0].jw_po_vendor_reg_id },
              type: invtDB.QueryTypes.SELECT,
            },
          );
          if (stmt_ven.length > 0) {
            vendor_name = stmt_ven[0].ven_name;
          }
        } else {
          vendor_name =
            "Something Wrong! Please do not execute the operation...";
        }

        let vendor_address = "";
        let vendor_state = "";
        let vendor_gst = "";

        let stmt_ven_datail = await invtDB.query(
          "SELECT * FROM `ven_address_detail` WHERE `ven_address_id` = :address_id",
          {
            replacements: { address_id: stmt_check[0].jw_po_ven_add_id },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (stmt_ven_datail.length > 0) {
          if (stmt_check[0].jw_po_vendor_address != "") {
            vendor_address = stmt_check[0].jw_po_vendor_address;
            vendor_state = stmt_ven_datail[0].ven_state;
            vendor_gst = stmt_ven_datail[0].ven_add_gst;
          } else {
            vendor_address =
              stmt_ven_datail[0].ven_address_line_1 +
              ", " +
              stmt_ven_datail[0].ven_address_line_2 +
              ", " +
              stmt_ven_datail[0].ven_address_line_3 +
              "(" +
              stmt_ven_datail[0].ven_pincode +
              ")";
            vendor_state = stmt_ven_datail[0].ven_state;
            vendor_gst = stmt_ven_datail[0].ven_add_gst;
          }
        }

        let vendor_type = "";

        if (stmt_check[0].jw_po_vendor_type == "v01") {
          vendor_type = "Vendor";
        } else if (stmt_check[0].jw_po_vendor_type == "j01") {
          vendor_type = "JWI";
        } else if (stmt_check[0].jw_po_vendor_type == "s01") {
          vendor_type = "SortIn";
        } else if (stmt_check[0].jw_po_vendor_type == "r01") {
          vendor_type = "RejIn";
        } else if (stmt_check[0].jw_po_vendor_type == "p01") {
          vendor_type = "ProdReturn";
        } else {
          vendor_type = "N/A";
        }

        let terms_condition = stmt_check[0].jw_terms_condition;
        let quotation_detail = stmt_check[0].jw_quotation_detail;
        let payment_term = stmt_check[0].jw_payment_terms;

        final.push({
          vendor_name: vendor_name,
          vendor_address: str_replace("<br>", ", ", vendor_address),
          vendor_type: vendor_type,
          vendor_state: vendor_state,
          vendor_gst: vendor_gst,
          vendor_country: "INDIA",
          terms_condition: terms_condition,
          quotation_detail: quotation_detail,
          payment_term: payment_term,
        });

        // COMPNENETS
        let stmt_comp = await invtDB.query(
          "SELECT *, `jw_material_issue`.`ID` AS `row_id` FROM `jw_material_issue` LEFT JOIN `components` ON `jw_material_issue`.`jw_m_component` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_material_issue`.`jw_m_transaction_id` = :transaction AND `jw_material_issue`.`jw_m_status` = 'P' ORDER BY `components`.`c_part_no`",
          {
            replacements: { transaction: req.body.transaction },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (stmt_comp.length) {
          let components = [];

          for (let i = 0; i < stmt_comp.length; i++) {
            components.push({
              trans_row_id: Buffer.from(
                stmt_comp[i].row_id.toString(),
              ).toString("base64"),
              ref_id: Buffer.from(
                stmt_comp[i].jw_m_transaction_id.toString(),
              ).toString("base64"),
              jw_id: stmt_comp[i].jw_m_job_id,
              component_key: stmt_comp[i].component_key,
              component_name: stmt_comp[i].c_name,
              part_no: stmt_comp[i].c_part_no,
              hsn_code: stmt_comp[i].c_hsn,
              unit_name: stmt_comp[i].units_name.toUpperCase(),
              issue_qty: stmt_comp[i].jw_m_issue_qty,
              availableQty: "",
            });
          }

          return res.json({
            success: true,
            status: "success",
            data: {
              header: final,
              components: components,
            },
          });
        } else {
          return res.json({
            success: false,
            status: "error",
            message:
              "no any component pending for challan againts of this jobwork transaction id..",
          });
        }
      } else {
        return res.json({
          success: false,
          status: "error",
          message:
            "we can not perform this action due to some issue in datebase and from your client side, Please contact to the system administrator..",
        });
      }
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "unable to fetch any transaction issue request",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET JW CHALLAN CREATE LOCATIONS
router.get("/jwChallanLocations", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: "20220621142318" },
        type: invtDB.QueryTypes.SELECT,
      },
    );
    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    for (let i = 0; i < loc_ids.length; i++) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: loc_ids[i] },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      stmt2.forEach((element) => {
        locations.push({ id: element.location_key, text: element.loc_name });
      });

      if (i == loc_ids.length - 1) {
        return res.json({ success: true, status: "success", data: locations });
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//jw_bom_recipe
// CREATE JW CHALLAN COMPONENETS
// router.post("/createJwChallan", [auth.isAuthorized], async (req, res) => {
//   try {
//     let validation = new Validator(req.body, {
//       transaction: "required",
//       jwtxn: "required",
//     });

//     if (validation.fails()) {
//       res.json({
//         success: false,
//         message: "something you missing in form field to supply",
//         data: validation.errors.all(),
//         status: "error",
//       });
//     }

//     let stmt_jw_mtrl_issue = await invtDB.query(
//       "SELECT * FROM `jw_material_issue` LEFT JOIN `components` ON `jw_material_issue`.`jw_m_component` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_material_issue`.`jw_m_transaction_id` = :transaction AND `jw_material_issue`.`company_branch` = :branch ORDER BY `components`.`c_part_no`",
//       {
//         replacements: { transaction: req.body.transaction, branch: req.branch },
//         type: invtDB.QueryTypes.SELECT,
//       },
//     );

//     if (stmt_jw_mtrl_issue.length > 0) {
//       let stmt_jw_pur_req = await invtDB.query(
//         "SELECT * FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :jobwork_id AND `company_branch` = :branch",
//         {
//           replacements: {
//             jobwork_id: stmt_jw_mtrl_issue[0].jw_m_job_id,
//             branch: req.branch,
//           },
//           type: invtDB.QueryTypes.SELECT,
//         },
//       );

//       if (stmt_jw_pur_req.length > 0) {
//         let stmt_ven_datail1 = await invtDB.query(
//           "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor_id",
//           {
//             replacements: { vendor_id: stmt_jw_pur_req[0].jw_po_vendor_reg_id },
//             type: invtDB.QueryTypes.SELECT,
//           },
//         );

//         let selectedVendor,
//           vendor_address = "";
//         if (stmt_ven_datail1.length > 0) {
//           selectedVendor = {
//             value: stmt_jw_pur_req[0].jw_po_vendor_reg_id,
//             label: stmt_ven_datail1[0].ven_name,
//           };
//         } else {
//           selectedVendor = { value: "0", label: "N/A" };
//         }

//         let stmt_ven_datail2 = await invtDB.query(
//           "SELECT * FROM `ven_address_detail` WHERE `ven_address_id` = :address_id",
//           {
//             replacements: { address_id: stmt_jw_pur_req[0].jw_po_ven_add_id },
//             type: invtDB.QueryTypes.SELECT,
//           },
//         );

//         if (stmt_ven_datail2.length > 0) {
//           if (stmt_jw_pur_req[0].jw_po_vendor_address != "") {
//             vendor_address = stmt_jw_pur_req[0].jw_po_vendor_address;
//             selectedAddressLabel = {
//               value: stmt_jw_pur_req[0].jw_po_ven_add_id,
//               label: stmt_ven_datail2[0].ven_add_label,
//             };
//           } else {
//             vendor_address = stmt_ven_datail2[0].ven_address_line_1;
//             selectedAddressLabel = { value: "0", label: "- - ADDRESS N/A - -" };
//           }
//           vendor_state = stmt_ven_datail2[0].ven_state;
//           vendor_gst = stmt_ven_datail2[0].ven_add_gst;
//         }

//         let vendor_type = "";
//         if (stmt_jw_pur_req[0].jw_po_vendor_type == "v01") {
//           vendor_type = "Vendor";
//         } else if (stmt_jw_pur_req[0].jw_po_vendor_type == "j01") {
//           vendor_type = "JWI";
//         } else if (stmt_jw_pur_req[0].jw_po_vendor_type == "s01") {
//           vendor_type = "SortIn";
//         } else if (stmt_jw_pur_req[0].jw_po_vendor_type == "r01") {
//           vendor_type = "RejIn";
//         } else if (stmt_jw_pur_req[0].jw_po_vendor_type == "p01") {
//           vendor_type = "ProdReturn";
//         } else {
//           vendor_type = "N/A";
//         }

//         let header = {
//           vendorcode: selectedVendor,
//           vendorbranch: selectedAddressLabel,
//           vendor_address: vendor_address.replace("<br>", ", "),
//           vendor_type: vendor_type,
//           cc: stmt_jw_pur_req[0].jw_cost_center,
//         };

//         let stmt_comp = await invtDB.query(
//           "SELECT *, `jw_material_issue`.`ID` AS `row_id` FROM `jw_material_issue` LEFT JOIN `components` ON `jw_material_issue`.`jw_m_component` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_material_issue`.`jw_m_transaction_id` = :transaction AND `jw_material_issue`.`jw_m_status` = 'P' AND `jw_material_issue`.`company_branch` = :branch ORDER BY `components`.`c_part_no`",
//           {
//             replacements: {
//               transaction: req.body.transaction,
//               branch: req.branch,
//             },
//             type: invtDB.QueryTypes.SELECT,
//           },
//         );

//         if (stmt_comp.length > 0) {
//           let final = [];
//           for (let i = 0; i < stmt_comp.length; i++) {
//             // recipe_rate = await invtDB.query("SELECT `jw_bom_rate` FROM `jw_bom_recipe` WHERE `jw_bom_part` = :component AND `jw_bom_po_trans` = :jwtxn", {
//             //   replacements: { component: stmt_comp[i].component_key, jwtxn: req.body.jwtxn },
//             //   type: invtDB.QueryTypes.SELECT,
//             // });
//             let avgRate =
//               await require("../../../helper/utils/avgRate").getWeightedPurchaseRate(
//                 stmt_comp[i].component_key,
//                 moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
//               );
//             final.push({
//               trans_row_id: Buffer.from(
//                 stmt_comp[i].row_id.toString(),
//               ).toString("base64"),
//               ref_id: Buffer.from(stmt_comp[i].jw_m_transaction_id).toString(
//                 "base64",
//               ),
//               jw_id: stmt_comp[i].jw_m_job_id,
//               component_key: stmt_comp[i].component_key,
//               component_name: stmt_comp[i].c_name,
//               part_no: stmt_comp[i].c_part_no,
//               hsn_code: stmt_comp[i].c_hsn,
//               unit_name: stmt_comp[i].units_name.toUpperCase(),
//               issue_qty: stmt_comp[i].jw_m_issue_qty,
//               assign_rate: avgRate, //recipe_rate[0].jw_bom_rate == "" ? 0 : recipe_rate[0].jw_bom_rate,
//               availableQty: "",
//             });
//           }

//           return res.json({
//             success: true,
//             status: "success",
//             data: { header: header, material: final },
//           });
//         } else {
//           return res.json({
//             success: false,
//             status: "error",
//             message:
//               "no any component pending for challan againts of this jobwork transaction id..",
//           });
//         }
//       } else {
//         return res.json({
//           success: false,
//           status: "error",
//           message:
//             "we can not perform this action due to some issue in database and from your client side, Please contact to the system administrator..",
//         });
//       }
//     } else {
//       return res.json({
//         success: false,
//         status: "error",
//         message: "unable to fetch any transaction issue request",
//       });
//     }
//   } catch (err) {
//     return helper.errorResponse(res, err);
//   }
// });
router.post("/createJwChallan", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      transaction: "required",
      jwtxn: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
    }

    const { transaction, jwtxn } = req.body;
    const { branch } = req;

    const toBase64 = (value) =>
      Buffer.from(value.toString()).toString("base64");

    const dbSelect = (query, replacements) =>
      invtDB.query(query, { replacements, type: invtDB.QueryTypes.SELECT });

    const VENDOR_TYPE_MAP = {
      v01: "Vendor",
      j01: "JWI",
      s01: "SortIn",
      r01: "RejIn",
      p01: "ProdReturn",
    };

    const jwMaterialIssue = await dbSelect(
      `SELECT jmi.*, c.component_key, c.c_name, c.c_part_no, c.c_hsn, c.c_uom, u.units_name
       FROM jw_material_issue jmi
       LEFT JOIN components c ON jmi.jw_m_component = c.component_key
       LEFT JOIN units u ON c.c_uom = u.units_id
       WHERE jmi.jw_m_transaction_id = :transaction
         AND jmi.company_branch = :branch
       ORDER BY c.c_part_no`,
      { transaction, branch },
    );

    if (!jwMaterialIssue.length) {
      return res.json({ success: false, status: "error", message: "unable to fetch any transaction issue request" });
    }

    const jwPurReq = await dbSelect(
      `SELECT * FROM jw_purchase_req
       WHERE jw_jw_transaction = :jobwork_id
         AND company_branch = :branch`,
      { jobwork_id: jwMaterialIssue[0].jw_m_job_id, branch },
    );

    if (!jwPurReq.length) {
      return res.json({ success: false, status: "error", message: "Could not perform this action due to some issue in the records and from your client side, Please contact to the system administrator.." });
    }

    const purReq = jwPurReq[0];

    const [venBasic, venAddress] = await Promise.all([
      dbSelect(
        `SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor_id`,
        { vendor_id: purReq.jw_po_vendor_reg_id },
      ),
      dbSelect(
        `SELECT * FROM ven_address_detail WHERE ven_address_id = :address_id`,
        { address_id: purReq.jw_po_ven_add_id },
      ),
    ]);

    const selectedVendor =
      venBasic.length > 0
        ? { value: purReq.jw_po_vendor_reg_id, label: venBasic[0].ven_name }
        : { value: "0", label: "N/A" };

    let vendor_address = "";
    let selectedAddressLabel = { value: "0", label: "- - ADDRESS N/A - -" };

    if (venAddress.length > 0) {
      const addr = venAddress[0];
      vendor_address =
        purReq.jw_po_vendor_address !== ""
          ? purReq.jw_po_vendor_address
          : addr.ven_address_line_1;

      selectedAddressLabel =
        purReq.jw_po_vendor_address !== ""
          ? { value: purReq.jw_po_ven_add_id, label: addr.ven_add_label }
          : { value: "0", label: "- - ADDRESS N/A - -" };
    }

    const header = {
      vendorcode: selectedVendor,
      vendorbranch: selectedAddressLabel,
      vendor_address: vendor_address.replace("<br>", ", "),
      vendor_type: VENDOR_TYPE_MAP[purReq.jw_po_vendor_type] ?? "N/A",
      cc: purReq.jw_cost_center,
    };

    const pendingComponents = await dbSelect(
      `SELECT jmi.*, jmi.ID AS row_id, c.component_key, c.c_name, c.c_part_no, c.c_hsn, u.units_name
       FROM jw_material_issue jmi
       LEFT JOIN components c ON jmi.jw_m_component = c.component_key
       LEFT JOIN units u ON c.c_uom = u.units_id
       WHERE jmi.jw_m_transaction_id = :transaction
         AND jmi.jw_m_status = 'P'
         AND jmi.company_branch = :branch
       ORDER BY c.c_part_no`,
      { transaction, branch },
    );

    if (!pendingComponents.length) {
      return res.json({ success: false, status: "error", message: "no any component pending for challan againts of this jobwork transaction ID" });
    }

    const avgRates = await Promise.all(
      pendingComponents.map((comp) =>
        require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(
          comp.component_key,
        ),
      ),
    );

    const material = pendingComponents.map((comp, i) => ({
      trans_row_id: toBase64(comp.row_id),
      ref_id: toBase64(comp.jw_m_transaction_id),
      jw_id: comp.jw_m_job_id,
      component_key: comp.component_key,
      component_name: comp.c_name,
      part_no: comp.c_part_no,
      hsn_code: comp.c_hsn,
      unit_name: comp.units_name.toUpperCase(),
      issue_qty: comp.jw_m_issue_qty,
      assign_rate: avgRates[i],
      availableQty: "",
    }));

    return res.json({
      success: true,
      status: "success",
      data: { header, material },
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// SAVE CREATE CHALLAN
router.post(
  "/saveCreateChallan",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      let validation = new Validator(req.body.header, {
        billingaddrid: "required",
        billingaddr: "required",
        transaction_id: "required",
        reference_id: "required",
        dispatchfromaddrid: "required",
        dispatchfromaddr: "required",
        dispatchfrompincode: "required",
        dispatchfromgst: "required",
        vehicle: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          success: false,
          message: "something you missing in form field to supply",
          data: validation.errors.all(),
          status: "error",
        });
      }

      let comp_length = req.body.material.component.length;

      for (let i = 0; i < comp_length; i++) {
        let valid = new Validator({
          qty: req.body.material.qty[i],
          component: req.body.material.component[i],
          rate: req.body.material.rate[i],
          picklocation: req.body.material.picklocation[i],
          hsncode: req.body.material.hsncode[i],
        });

        if (valid.fails()) {
          await transaction.rollback();
          return res.json({
            success: false,
            message: "something you missing in form field to supply",
            data: validation.errors.all(),
            status: "error",
          });
        }
      }

      let stmt_check_billadd = await invtDB.query(
        "SELECT * FROM `billing_address` WHERE `billing_code` = :code",
        {
          replacements: { code: req.body.header.billingaddrid },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt_check_billadd.length > 0) {
        let stmt_check_disp = await invtDB.query(
          "SELECT * FROM `dispatch_address` WHERE `dispatch_code` = :code",
          {
            replacements: { code: req.body.header.dispatchfromaddrid },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (stmt_check_disp.length > 0) {
          let stmt_jw = await invtDB.query(
            "SELECT * FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :jobwork_id AND `company_branch` = :branch",
            {
              replacements: {
                jobwork_id: req.body.header.transaction_id,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          if (stmt_jw.length > 0) {
            if (stmt_jw[0].jw_po_status == "C") {
              await transaction.rollback();
              return res.json({
                success: false,
                status: "error",
                message:
                  "an error encountered while executing request bcz the JW PO Order has been marked as (ON HOLD / BLOCKED) for any transactions related, please contact to authorized person to resolve this issue..",
              });
            } else if (stmt_jw[0].ven_location == "--") {
              await transaction.rollback();
              return res.json({
                success: false,
                status: "error",
                message:
                  "Vendor Location is not mapped.\nPlease ask to your system administrator to map vendor location from vendor master.",
              });
            } else {
              let vendor_id = stmt_jw[0].jw_po_vendor_reg_id;
              let vendor_type = stmt_jw[0].jw_po_vendor_type;
              let ven_address_id = stmt_jw[0].jw_po_ven_add_id;
              let ven_address = stmt_jw[0].jw_po_vendor_address;

              let stmt_trans = await invtDB.query(
                "SELECT * FROM `ims_numbering` WHERE `for_number` = 'DELIVERY_CHALLAN' FOR UPDATE",
                {
                  type: invtDB.QueryTypes.SELECT,
                  transaction: transaction,
                },
              );

              let TransID;

              if (stmt_trans.length > 0) {
                var suffix = stmt_trans[0].suffix;
                suffix = parseInt(suffix) + 1;
                suffix = suffix.toString();
                suffix = suffix.padStart(
                  parseInt(stmt_trans[0].number_length_limit),
                  "0",
                );
                TransID =
                  stmt_trans[0].prefix +
                  "/" +
                  stmt_trans[0].session +
                  "/" +
                  suffix;
              } else {
                let currYear = parseInt(
                  new Date().getFullYear().toString().substr(2, 2),
                );
                TransID = "JW/" + currYear + "-" + (currYear + 1) + "/0001";
              }
              let stmt_update = await invtDB.query(
                "UPDATE `ims_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'DELIVERY_CHALLAN'",
                {
                  type: invtDB.QueryTypes.UPDATE,
                  transaction: transaction,
                },
              );
              if (stmt_update.length > 0) {
                let stmt_comp;
                let insert_dt = moment(new Date()).format(
                  "YYYY-MM-DD HH:mm:ss",
                );
                for (let i = 0; i < comp_length; i++) {
                  stmt_comp = await invtDB.query(
                    "SELECT * FROM `components` WHERE `component_key` = :component_key AND `c_is_enabled` = 'Y'",
                    {
                      replacements: {
                        component_key: req.body.material.component[i],
                      },
                      type: invtDB.QueryTypes.SELECT,
                    },
                  );

                  if (stmt_comp.length > 0) {
                    let stmt_check_jw = await invtDB.query(
                      "SELECT * FROM `jw_material_issue` WHERE `jw_m_job_id` = :jobwork_id AND `jw_m_component` = :component_key AND `company_branch` = :branch",
                      {
                        replacements: {
                          jobwork_id: req.body.header.transaction_id,
                          component_key: req.body.material.component[i],
                          branch: req.branch,
                        },
                        type: invtDB.QueryTypes.SELECT,
                      },
                    );

                    if (stmt_check_jw.length > 0) {
                      let stmt_check_qty = await invtDB.query(
                        "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_in` = :locationkey",
                        {
                          replacements: {
                            component: req.body.material.component[i],
                            locationkey: req.body.material.picklocation[i],
                          },
                          type: invtDB.QueryTypes.SELECT,
                        },
                      );

                      let inward_all_qty = 0;
                      if (stmt_check_qty.length > 0) {
                        inward_all_qty = stmt_check_qty[0].Inward;
                      }

                      let stmt_outward = await invtDB.query(
                        "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_out` = :locationkey",
                        {
                          replacements: {
                            component: req.body.material.component[i],
                            locationkey: req.body.material.picklocation[i],
                          },
                          type: invtDB.QueryTypes.SELECT,
                        },
                      );

                      let outward_all_qty = 0;
                      if (stmt_outward.length > 0) {
                        outward_all_qty = stmt_outward[0].Outward;
                      }

                      let closingBal =
                        helper.number(inward_all_qty) -
                        helper.number(outward_all_qty);

                      if (closingBal >= req.body.material.qty[i]) {
                        let updateHsn = await invtDB.query(
                          "UPDATE `components` SET `c_hsn` = :hsncode WHERE `component_key` = :component_key",
                          {
                            replacements: {
                              hsncode: req.body.material.hsncode[i],
                              component_key: req.body.material.component[i],
                            },
                            type: invtDB.QueryTypes.UPDATE,
                            transaction: transaction,
                          },
                        );

                        let stmt_update = await invtDB.query(
                          "UPDATE `jw_material_issue` SET `jw_m_confirm_issue_qty` = :issue_qty, `jw_m_status` = 'A' WHERE `jw_m_component` = :component_key AND `jw_m_job_id` = :jobwork_id AND `jw_m_transaction_id` = :reference",
                          {
                            replacements: {
                              issue_qty: req.body.material.qty[i],
                              component_key: req.body.material.component[i],
                              jobwork_id: req.body.header.transaction_id,
                              reference: Buffer.from(
                                req.body.header.reference_id,
                                "base64",
                              ).toString(),
                            },
                            type: invtDB.QueryTypes.UPDATE,
                            transaction: transaction,
                          },
                        );

                        if (stmt_update.length > 0) {
                          let stmt_insert_rm = await invtDB.query(
                            "INSERT INTO `rm_location` (`company_branch`,`currency_type`, `is_qc_sample`,`vendor_type`,`in_vendor_name`,`in_vendor_branch`,`in_vendor_addr`,`insert_date`,`insert_by`,`trans_type`,`components_id`,`qty`,`jw_transaction_id`,`jw_challan_id`,`in_po_rate`,`in_hsn_code`,`loc_in`,`loc_out`,`any_remark`) VALUES(:branch,'364907247','Y',:ven_type, :ven_name, :ven_branch, :ven_address, :insert_dt, :insert_by, 'JOBWORK', :component_key, :issue_qty, :jobwork_id, :challan_id, :rate, :hsn, :loc_in, :loc_out, :remark)",
                            {
                              replacements: {
                                branch: req.branch,
                                ven_type: vendor_type,
                                ven_name: vendor_id,
                                ven_branch: req.body.header.vendorbranch,
                                ven_address: req.body.header.vendoraddress,
                                component_key: req.body.material.component[i],
                                issue_qty: req.body.material.qty[i],
                                jobwork_id: req.body.header.transaction_id,
                                challan_id: TransID,
                                rate: req.body.material.rate[i],
                                hsn: req.body.material.hsncode[i],
                                loc_in: stmt_jw[0].ven_location,
                                loc_out: req.body.material.picklocation[i],
                                remark:
                                  req.body.material.remark[i] == ""
                                    ? "--"
                                    : req.body.material.remark[i],
                                insert_dt: insert_dt,
                                insert_by: req.logedINUser,
                              },
                              type: invtDB.QueryTypes.INSERT,
                              transaction: transaction,
                            },
                          );

                          if (stmt_insert_rm.length > 0) {
                            await invtDB.query(
                              "INSERT INTO `jw_material_challan` (`company_branch`,`jw_challan_txn_id`,`jw_vehicle`,`jw_billing_id`,`jw_billing_address`,`jw_challan_ref_id`,`jw_vendor_id`,`jw_vendor_address`,`jw_ven_add_id`,`jw_component_id`,`jw_order_qty`,`jw_order_rate`,`jw_hsncode`,`jw_duration_process`,`jw_nature_process`,`jw_other_ref`,`jw_dispatch_to_id`,`jw_dispatch_to__line1`,`jw_dispatch_to_pincode`,`jw_insert_dt`,`jw_insert_by`,`jw_transaction`,`jw_remark`,`jw_dispatch_gstin`) VALUES(:branch,:challan_txn_id,:vehicle,:billing_id,:billing_address,:challan_ref_id,:vendor_id, :vendor_address, :address_id, :component_id, :order_qty, :order_rate, :hsncode, :duration, :nature, :other_ref, :dispatch_id, :dispatch_line_1, :dispatch_pincode, :insert_dt, :insert_by, :jw_transaction, :remark, :gstin)",
                              {
                                replacements: {
                                  branch: req.branch,
                                  challan_txn_id: TransID,
                                  vehicle: req.body.header.vehicle,
                                  billing_id: req.body.header.billingaddrid,
                                  billing_address:
                                    req.body.header.billingaddr.replace(
                                      /\n/g,
                                      "<br>",
                                    ),
                                  challan_ref_id: Buffer.from(
                                    req.body.header.reference_id,
                                    "base64",
                                  ).toString(),
                                  vendor_id: vendor_id,
                                  vendor_address: ven_address,
                                  address_id: ven_address_id,
                                  component_id: req.body.material.component[i],
                                  order_qty: req.body.material.qty[i],
                                  order_rate: req.body.material.rate[i],
                                  hsncode: req.body.material.hsncode[i],
                                  duration: req.body.header.duration,
                                  nature: req.body.header.nature,
                                  other_ref: req.body.header.other_ref,
                                  dispatch_id:
                                    req.body.header.dispatchfromaddrid,
                                  dispatch_line_1:
                                    req.body.header.dispatchfromaddr.replace(
                                      /\n/g,
                                      "<br>",
                                    ),
                                  dispatch_pincode:
                                    req.body.header.dispatchfrompincode,
                                  insert_dt: insert_dt,
                                  insert_by: req.logedINUser,
                                  jw_transaction:
                                    req.body.header.transaction_id,
                                  remark: req.body.material.remark[i],
                                  gstin: req.body.header.dispatchfromgst,
                                },
                                type: invtDB.QueryTypes.INSERT,
                                transaction: transaction,
                              },
                            );
                            await invtDB.query(
                              "INSERT INTO `jw_ven_challan` (`company_branch`,`jw_ven`,`jw_part`,`jw_qty`,`jw_rate`,`jw_jobwork_id`,`jw_challan_ref`,`jw_challan_id`,`jw_insert_dt`,`jw_insert_by`) VALUES(:branch,:vendor,:part,:qty,:rate,:jobwork,:challan_ref,:challan_id,:insert_dt,:insert_by)",
                              {
                                replacements: {
                                  branch: req.branch,
                                  vendor: vendor_id,
                                  part: req.body.material.component[i],
                                  qty: req.body.material.qty[i],
                                  rate: req.body.material.rate[i],
                                  jobwork: req.body.header.transaction_id,
                                  challan_ref: insert_dt,
                                  challan_id: TransID,
                                  insert_dt: moment(new Date())
                                    .tz("Asia/Kolkata")
                                    .format("YYYY-MM-DD HH:mm:ss"),
                                  insert_by: req.logedINUser,
                                },
                                type: invtDB.QueryTypes.INSERT,
                                transaction: transaction,
                              },
                            );
                          } else {
                            await transaction.rollback();
                            return res.json({
                              success: false,
                              status: "error",
                              message:
                                "an error occured while saving your data in our records ",
                            });
                          }
                        }
                      } else {
                        await transaction.rollback();
                        return res.json({
                          success: false,
                          status: "error",
                          message: `IN = ${inward_all_qty} and OUT = ${outward_all_qty}  @ issue qty is not available for jobwork at selected pick location for partcode [ ${stmt_comp[0].c_part_no} / ${stmt_comp[0].c_name} ] `,
                        });
                      }
                    } else {
                      await transaction.rollback();
                      return res.json({
                        code: 500,
                        status: "error",
                        message: {
                          msg: "an error encountered while executing request bcz you can't issue the qty for that component that doesn't come for issue yet..",
                        },
                      });
                    }
                  } else {
                    await transaction.rollback();
                    return res.json({
                      code: 500,
                      status: "error",
                      message: {
                        msg:
                          "operation cancelled due to part code in sequelize no. (" +
                          [i + 1] +
                          ") is currently disabled",
                      },
                    });
                  }
                }
                await transaction.commit();
                return res.json({
                  code: 200,
                  status: "success",
                  message: `Challan Generated Successfully...\nChallan ID: ${TransID}`,
                });
              } else {
                await transaction.rollback();
                return res.json({
                  code: 500,
                  status: "error",
                  message: {
                    msg: "an operation for updation in transaction has failed, while creating challan",
                  },
                });
              }
            }
          } else {
            await transaction.rollback();
            return res.json({
              code: 500,
              status: "error",
              message: {
                msg: "an error encountered while executing request bcz might you are trying to break the rules as per our guidlines, you may will suspended!",
              },
            });
          }
        } else {
          await transaction.rollback();
          return res.json({
            code: 500,
            status: "error",
            message: {
              msg: "an error encountered while executing request bcz you have select an invalid dispatch from address, please reload the page and try again..",
            },
          });
        }
      } else {
        await transaction.rollback();
        return res.json({
          code: 500,
          status: "error",
          message: { msg: "billing address is not valid" },
        });
      }
    } catch (err) {
      return res.json({
        code: 500,
        status: "error",
        message: {
          msg: "Internal Error<br/>If this condition persists, contact your system administrator",
        },
        error: err.stack,
      });
    }
  },
);

// PRINT JW CHALLAN
router.post("/printJobworkChallan", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      invoice_id: "required",
      ref_id: "required",
      challan: "required",
    });

    if (validation.fails()) {
      res.json({
        code: 500,
        message: { msg: "something you missing in form field to supply" },
        data: validation.errors.all(),
        status: "error",
      });
    }

    const { invoice_id, ref_id, challan } = req.body;
    let file = {
      url: `${process.env.API_URL}/helper/PRINT/PHP/JW/JWchallan.php?invoice=${invoice_id}&refid=${ref_id}`,
    };
    let options = { format: "A4" };
    await html_to_pdf
      .generatePdf(file, options)
      .then((pdfBuffer) => {
        let filename = req.body.challan.replace(/[/]/g, "_") + ".pdf";
        return res.json({
          success: true,
          status: "success",
          message: "file generated successfully...",
          data: { buffer: pdfBuffer, filename: filename },
        });
      })
      .catch((err) => {
        return res.json({
          success: false,
          status: "error",
          message: "error while generating file...",
          error: err.stack,
        });
      });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// EDIT JW CHALLAN
router.post("/editJobworkChallan", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      challan_no: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
    }

    let stmt = await invtDB.query(
      "SELECT `jw_material_challan`.*, `jw_material_challan`.`ID` AS `row_id`, `components`.`component_key`, `components`.`c_name`, `components`.`c_part_no`, `units`.`units_name`, `ven_basic_detail`.`ven_name` FROM `jw_material_challan` LEFT JOIN `ven_basic_detail` ON `ven_basic_detail`.`ven_register_id` = `jw_material_challan`.`jw_vendor_id` LEFT JOIN `components` ON `jw_material_challan`.`jw_component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_material_challan`.`jw_challan_txn_id` = :transaction AND `jw_material_challan`.`company_branch` =:branch ORDER BY `components`.`c_part_no`",
      {
        replacements: { transaction: req.body.challan_no, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (stmt.length > 0) {
      let stmt_ven_datail = await invtDB.query(
        "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor_id",
        {
          replacements: { vendor_id: stmt[0].jw_vendor_id },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      let selectedVendor,
        vendor_address = "";
      if (stmt_ven_datail.length > 0) {
        selectedVendor = {
          value: stmt_ven_datail[0].ven_register_id,
          label: stmt_ven_datail[0].ven_name,
        };
      } else {
        selectedVendor = { value: "0", label: "N/A" };
      }

      let stmt_ven_branch = await invtDB.query(
        "SELECT * FROM `ven_address_detail` WHERE `ven_address_id` = :address_id",
        {
          replacements: { address_id: stmt[0].jw_ven_add_id },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt_ven_branch.length > 0) {
        if (stmt[0].jw_vendor_address != "") {
          vendor_address = stmt[0].jw_vendor_address;
          selectedAddressLabel = {
            value: stmt[0].jw_ven_add_id,
            label: stmt_ven_branch[0].ven_add_label,
          };
        } else {
          vendor_address = stmt_ven_branch[0].ven_address;
          selectedAddressLabel = { value: "0", label: "- - ADDRESS N/A - -" };
        }
      }

      let billing_addr = await invtDB.query(
        "SELECT * FROM `billing_address` WHERE `billing_code` = :billingcode",
        {
          replacements: { billingcode: stmt[0].jw_billing_id },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (billing_addr.length > 0) {
        selectBillingLabel = {
          value: stmt[0].jw_billing_id,
          label: billing_addr[0].billing_lable,
        };
      } else {
        selectBillingLabel = { value: "0", label: "N/A" };
      }

      let dispatch_addr = await invtDB.query(
        "SELECT * FROM `dispatch_address` WHERE `dispatch_code` = :dispatchcode",
        {
          replacements: { dispatchcode: stmt[0].jw_dispatch_to_id },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (dispatch_addr.length > 0) {
        selectDispatchLabel = {
          value: stmt[0].jw_dispatch_to_id,
          label: dispatch_addr[0].dispatch_label,
        };
      } else {
        selectDispatchLabel = { value: "0", label: "N/A" };
      }

      let material = [];

      for (let i = 0; i < stmt.length; i++) {
        material.push({
          trans_row_id: Buffer.from(stmt[i].row_id.toString()).toString(
            "base64",
          ),
          ref_id: Buffer.from(stmt[i].jw_challan_ref_id.toString()).toString(
            "base64",
          ),
          component_key: stmt[i].component_key,
          component_name: stmt[i].c_name,
          part_no: stmt[i].c_part_no,
          part_rate: stmt[i].jw_order_rate,
          hsn_code: stmt[i].jw_hsncode,
          unit_name: stmt[i].units_name.toUpperCase(),
          issue_qty: stmt[i].jw_order_qty,
          remarks: stmt[i].jw_remark,
        });
      }
      return res.json({
        success: true,
        status: "success",
        data: {
          header: {
            vendorcode: selectedVendor,
            vendorbranch: selectedAddressLabel,
            vendor_address: vendor_address,

            duration_process: stmt[0].jw_duration_process,
            nature_process: stmt[0].jw_nature_process,
            other_ref: stmt[0].jw_other_ref,
            vehicle: stmt[0].jw_vehicle,

            billing_info: selectBillingLabel,
            billing_address: stmt[0].jw_billing_address,

            dispatch_info: selectDispatchLabel,
            dispatch_address: stmt[0].jw_dispatch_to__line1,

            jw_id: stmt[0].jw_transaction,
            challan_id: stmt[0].jw_challan_txn_id,
          },
          material: material,
        },
      });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "unable to fetch any challan transaction",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPDATE JW CHALLAN
router.post("/updateJobworkChallan", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    var header = req.body.header;
    var material = req.body.material;

    let validation = new Validator(req.body, {
      transaction_id: "required",
    });

    if (validation.fails()) {
      await transaction.rollback();
      res.json({
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
    }

    let comp_length = material.component.length;
    let qty_length = material.qty.length;
    let rate_length = material.rate.length;

    if (comp_length != qty_length || comp_length != rate_length) {
      await transaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "invalid data found",
      });
    }

    for (let i = 0; i < comp_length; i++) {
      let validation = new Validator(
        {
          component: material.component[i],
          qty: material.qty[i],
          rate: material.rate[i],
        },
        {
          component: "required",
          qty: "required|min:1",
          rate: "required|min:1",
        },
      );

      if (validation.fails()) {
        await transaction.rollback();
        res.json({
          success: false,
          message: "something you missing in form field to supply",
          data: validation.errors.all(),
          status: "error",
        });
      }
    }

    let stmt = await invtDB.query(
      "SELECT * FROM `jw_material_challan` WHERE `jw_challan_txn_id` = :challan_id AND `company_branch` = :branch",
      {
        replacements: {
          challan_id: req.body.transaction_id,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );
    if (stmt.length > 0) {
      let data = moment(stmt[0].jw_insert_dt, "YYYY-MM-DD HH:mm:ss").format(
        "YYYY-MM-DD HH:mm:ss",
      );
      let date = new Date(data);
      let diff = new Date() - date;
      let hours = diff / 1000 / 60 / 60;

      if (hours > 48) {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message:
            "updation denied due to time limitaion bonding upto 48h only ",
        });
      } else {
        let stmt_updt_jw1 = await invtDB.query(
          "UPDATE `jw_material_challan` SET `jw_ven_add_id`= :vendorbranch, `jw_vendor_address`= :vendoraddress, `jw_nature_process` = :nature, `jw_duration_process` = :duration, `jw_vehicle` = :vehicle, `jw_other_ref` = :other_ref, `jw_billing_id` = :billingid, `jw_billing_address` = :billingaddress, `jw_dispatch_to_id` = :dispatchid, `jw_dispatch_to__line1` = :dispatchaddress WHERE `jw_challan_txn_id` = :challan",
          {
            replacements: {
              vendorbranch: header.vendorbranch,
              vendoraddress: header.vendoraddress,
              nature: header.nature,
              duration: header.duration,
              vehicle: header.vehicle,
              other_ref: header.other_ref,
              billingid: header.billingid,
              billingaddress: header.billingaddress.replace(/\n/g, "<br>"),
              dispatchid: header.dispatchid,
              dispatchaddress: header.dispatchaddress.replace(/\n/g, "<br>"),
              challan: req.body.transaction_id,
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transaction,
          },
        );

        for (let i = 0; i < comp_length; i++) {
          let stmt_check_qty = await invtDB.query(
            "SELECT COALESCE( SUM( CASE WHEN trans_type IN('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_in` = (SELECT loc_out FROM rm_location WHERE components_id = :component AND `jw_challan_id` = :challan AND `jw_transaction_id` = :jobwork) THEN qty ELSE 0 END ), 0 ) AS inward, COALESCE( SUM( CASE WHEN trans_type IN('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_out` = (SELECT loc_out FROM rm_location WHERE components_id = :component AND `jw_challan_id` = :challan AND `jw_transaction_id` = :jobwork)THEN qty ELSE 0 END ), 0 ) AS outward FROM rm_location WHERE components_id = :component AND `jw_challan_id` != :challan",
            {
              replacements: {
                component: material.component[i],
                challan: stmt[0].jw_challan_txn_id,
                jobwork: stmt[0].jw_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );
          let inward_all_qty = 0,
            outward_all_qty = 0;
          if (stmt_check_qty.length > 0) {
            inward_all_qty = stmt_check_qty[0].inward;
            outward_all_qty = stmt_check_qty[0].outward;
          } else {
            inward_all_qty = 0;
            outward_all_qty = 0;
          }

          let closingBal =
            helper.number(inward_all_qty) - helper.number(outward_all_qty);

          if (closingBal >= req.body.material.qty[i]) {
            let stmt_updt_jw2 = await invtDB.query(
              "UPDATE `jw_material_challan` SET `jw_order_qty`= :qty, `jw_hsncode`= :hsncode, `jw_order_rate`= :rate , `jw_remark` = :jw_remark WHERE `jw_component_id`= :component AND `jw_challan_txn_id` = :challan",
              {
                replacements: {
                  qty: material.qty[i],
                  hsncode: material.hsncode[i],
                  rate: material.rate[i],
                  component: material.component[i],
                  challan: req.body.transaction_id,
                  jw_remark: material.remark[i],
                },
                type: invtDB.QueryTypes.UPDATE,
                transaction: transaction,
              },
            );
            if (stmt_updt_jw2.length > 0) {
              let stmt_rm_update1 = await invtDB.query(
                "UPDATE `rm_location` SET `qty`= :qty, `in_hsn_code` = :hsncode, `in_po_rate`= :rate WHERE `components_id`= :component AND `jw_challan_id` = :challan",
                {
                  replacements: {
                    qty: material.qty[i],
                    hsncode: material.hsncode[i],
                    rate: material.rate[i],
                    component: material.component[i],
                    challan: req.body.transaction_id,
                  },
                  type: invtDB.QueryTypes.UPDATE,
                  transaction: transaction,
                },
              );
              if (stmt_rm_update1.length <= 0) {
                await transaction.rollback();
                return res.json({
                  success: false,
                  status: "error",
                  message: "unable to update challan transaction",
                });
              }
            } else {
              await transaction.rollback();
              return res.json({
                success: false,
                status: "error",
                message:
                  "an operation for updation has failed, while updating the Challan..",
              });
            }
          } else {
            await transaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message: `IN = ${inward_all_qty} and OUT = ${outward_all_qty} @ updating qty is not available for jobwork at already selected pick location for partcode row number ${[
                i,
              ]}`,
            });
          }
        }
        await transaction.commit();
        return res.json({
          success: true,
          status: "success",
          message: "challan transaction has been updated successfully",
        });
      }
    } else {
      await transaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message:
          "an error encountered while executing request bcz might you are trying to break the rules as per our guidlines, you may will suspended!",
      });
    }
  } catch (err) {
    await transaction.rollback();
    return helper.errorResponse(res, err);
  }
});

//   Remove JW Challan Part
router.post("/removeChallanJWPart", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    let validation = new Validator(req.body, {
      partcode: "required",
      row_id: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
    }

    let stmt = await invtDB.query(
      "DELETE FROM `jw_material_issue` WHERE `ID` = :row AND `jw_m_component` = :component",
      {
        replacements: {
          row: Buffer.from(req.body.row_id, "base64").toString("ascii"),
          component: req.body.partcode,
        },
        type: invtDB.QueryTypes.DELETE,
        transaction: transaction,
      },
    );
    // if (stmt) {
    await transaction.commit();
    return res.json({
      success: true,
      status: "success",
      message: "component deleted successfully",
    });
    // } else {
    //   await transaction.rollback();
    //   return res.json({ code: 200, status: "error", message: { msg: "an error occured while deleting the component" } });
    // }
  } catch (err) {
    await transaction.rollback();
    return helper.errorResponse(res, err);
  }
});

//CANCEL CHALLA
router.post("/jwChallanCancel", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    let validation = new Validator(req.body, {
      po_id: "required",
      challan_id: "required",
      remark: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: validation.errors.all(),
      });
    }

    if (req.body.challan_id == "N/A") {
      let stmt = await invtDB.query(
        "UPDATE jw_material_issue SET jw_m_status = 'C', can_remark = :remark WHERE jw_m_sku_trans_id = :po_id AND jw_m_transaction_id = :ref_id",
        {
          replacements: {
            remark: req.body.remark,
            po_id: req.body.po_id,
            ref_id: req.body.ref_id,
          },
          type: invtDB.QueryTypes.UPDATE,
        },
      );
      await transaction.commit();
      return res.json({
        success: true,
        status: "success",
        message: "status cancelled successfully",
      });
    } else {
      let stmt = await invtDB.query(
        "UPDATE jw_material_challan SET challan_status = 'C', challan_can_remark = :remark WHERE jw_transaction = :po_id AND jw_challan_txn_id = :challan_id",
        {
          replacements: {
            remark: req.body.remark,
            po_id: req.body.po_id,
            challan_id: req.body.challan_id,
          },
          type: invtDB.QueryTypes.UPDATE,
        },
      );

      if (stmt.length > 0) {
        let stmt1 = await invtDB.query(
          "SELECT jw_component_id FROM jw_material_challan WHERE jw_transaction = :po_id AND jw_challan_txn_id = :challan_id",
          {
            replacements: {
              po_id: req.body.po_id,
              challan_id: req.body.challan_id,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        for (let i = 0; i < stmt1.length; i++) {
          await invtDB.query(
            "UPDATE rm_location SET trans_type= 'CANCELLED' WHERE components_id = :comp_id AND jw_transaction_id = :po_id AND jw_challan_id = :challan_id",
            {
              replacements: {
                comp_id: stmt1[i].jw_component_id,
                po_id: req.body.po_id,
                challan_id: req.body.challan_id,
              },
              type: invtDB.QueryTypes.UPDATE,
            },
          );
        }
        await transaction.commit();
        return res.json({
          success: true,
          status: "success",
          message: "challan cancelled successfully",
        });
      }
    }
  } catch (err) {
    await transaction.rollback();
    return helper.errorResponse(res, err);
  }
});

// MIN - ADD Part code via CSV

const storage1 = multer.diskStorage({
  destination: "tmp",
  filename: function (req, file, cb) {
    cb(
      null,
      "TRY" +
      Date.now() +
      Math.floor(Math.random() * 900 + 100) +
      path.extname(file.originalname),
    );
  },
});

const upload1 = multer({ storage: storage1 });

router.post("/upload/item", upload1.single("file"), async (req, res) => {
  try {
    const expectedColumns = [
      "PART_CODE",
      "QTY",
      "RATE",
      "HSN",
      "INVOICE",
      "LOCATION",
      "AUTO_CONSUMP",
      "REMARK",
    ];

    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const headers = [];
    const range = xlsx.utils.decode_range(worksheet["!ref"]);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = xlsx.utils.encode_cell({ r: 0, c: col });
      const cell = worksheet[cellAddress];
      headers.push(cell ? cell.v : null);
    }

    const mismatches = headers
      .map((header, index) => {
        if (
          header?.trim().toUpperCase() !== expectedColumns[index].toUpperCase()
        ) {
          return {
            column: `Column ${String.fromCharCode(65 + index)}`,
            actual: header,
            expected: expectedColumns[index],
          };
        }
        return null;
      })
      .filter(Boolean);

    if (mismatches.length > 0) {
      fs.unlinkSync(filePath);
      return res.json({
        success: false,
        message: "Excel column validation failed.",
        mismatches,
        status: "error",
      });
    }

    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    const data = rows.slice(1);

    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      const rowNumber = rowIndex + 2;

      const qty = Number(row[2]);
      if (isNaN(qty) || qty <= 0) {
        return res.json({
          success: false,
          message: `Excel column validation failed\nQTY must be a non-zero number at row number [${rowNumber}]`,
          status: "error",
        });
      }

      const hsn = row[3];
      if (
        hsn !== "--" &&
        (![4, 6, 8].includes(String(hsn).length) || isNaN(hsn))
      ) {
        return res.json({
          message: `Excel column validation failed\nHSN must be '--', a 6-digit, or an 8-digit number at row number [${rowNumber}]`,
          status: "error",
          success: false,
        });
      }

      const autoConsump = row[6];
      if (autoConsump !== 1 && autoConsump !== 0) {
        const getConslocation = await invtDB.query(
          "SELECT `loc_name`, `location_key` FROM `location_main` WHERE `loc_name` = :autoConsump",
          {
            replacements: { autoConsump },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (!getConslocation || getConslocation.length === 0) {
          return res.json({
            message: `Excel column validation failed\nLOCATION '${autoConsump}' does not exist in the database at row number [${rowNumber}]`,
            status: "error",
            success: false,
          });
        }

        row[6] = {
          text: getConslocation[0].loc_name,
          value: getConslocation[0].location_key,
        };
      } else {
        row[6] = { text: "No", value: "0" };
      }

      const remark = row[7];
      if (remark && remark.length > 100) {
        return res.json({
          success: false,
          message: `Excel column validation failed\nREMARK length must be less than 100 characters at row number [${rowNumber}]`,
          status: "error",
        });
      }

      const location = row[5];
      const locationData = await invtDB.query(
        "SELECT `loc_name`, `location_key` FROM `location_main` WHERE `loc_name` = :location",
        {
          replacements: { location },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (!locationData || locationData.length === 0) {
        return res.json({
          message: `Excel column validation failed\nLOCATION '${location}' does not exist in the database at row number [${rowNumber}]`,
          status: "error",
          success: false,
        });
      }

      row[5] = {
        text: locationData[0].loc_name,
        value: locationData[0].location_key,
      };

      const partCode = row[0];
      const partCodeData = await invtDB.query(
        "SELECT `c_name`, `component_key`, `c_part_no` FROM `components` WHERE `c_part_no` = :partcode",
        {
          replacements: { partcode: partCode },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (!partCodeData || partCodeData.length === 0) {
        return res.json({
          message: `Excel column validation failed\nPART_CODE '${partCode}' does not exist in the database at row number [${rowNumber}]`,
          status: "error",
          success: false,
        });
      }

      row[0] = {
        name: partCodeData[0].c_name,
        key: partCodeData[0].component_key,
        partNo: partCodeData[0].c_part_no,
      };
    }

    fs.unlinkSync(filePath);

    const transformedHeaders = headers.map((header) =>
      header.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
    );

    return res.json({
      success: true,
      data: {
        headers: transformedHeaders,
        rows: data,
      },
      message: "Excel file validated successfully.",
      status: "success",
    });
  } catch (error) {
    if (req.file && req.file.path) {
      fs.unlinkSync(req.file.path);
    }
    return helper.errorResponse(res, error);
  }
});

module.exports = router;

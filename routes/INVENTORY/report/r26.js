const express = require("express");
const router = express.Router();
const multer = require("multer");
const xlsx = require("xlsx");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

const path = require("path");
let { invtDB, refbDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const { encode, decode } = require("html-entities");

const Validator = require("validatorjs");

// GET TRANSACTION TYPE OUT
router.post(
  "/xmlViewOut",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      wise: "required",
      data: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "pick the transaction type firstly..",
      });
    }

    let date = moment(req.body.data, "DD-MM-YYYY").format("YYYY-MM-DD");
    try {
      let stmt;

      if (req.body.wise == "rm-sf") {
        stmt = await invtDB.query(
          "SELECT components.c_name, `components`.`component_key`, `components`.`c_new_part_no`, components.c_part_no ,units.units_name, location_main.loc_name, admin_login.user_name , rm_location.insert_date, rm_location.trans_type, rm_location.in_vendor_name, rm_location.out_transaction_id, rm_location.any_remark, rm_location.jw_challan_id, rm_location.qty, loc2.loc_name AS `loc_out` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `location_main` ON `rm_location`.`loc_in` = `location_main`.`location_key`  LEFT JOIN `location_main` as loc2 ON `rm_location`.`loc_out` = `loc2`.`location_key`  LEFT JOIN `admin_login` ON rm_location.insert_by = admin_login.CustID WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND DATE_FORMAT( `rm_location`.`insert_date`, '%Y-%m-%d' ) = :date AND `rm_location`.`trans_type` IN('ISSUE') AND rm_location.company_branch = :branch AND rm_location.loc_in != '1762327014444' AND FIND_IN_SET( location_main.location_key, (SELECT locations FROM location_allotted WHERE loc_all_key = '202391821188452') ) ORDER BY `rm_location`.`insert_date` DESC",
          {
            replacements: { date: date, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      }
      if (req.body.wise == "rm-jw") {
        stmt = await invtDB.query(
          "SELECT components.c_name, `components`.`component_key`, components.c_part_no, `components`.`c_new_part_no` ,units.units_name, location_main.loc_name, admin_login.user_name , rm_location.insert_date, rm_location.trans_type, rm_location.in_vendor_name, rm_location.out_transaction_id, rm_location.any_remark, rm_location.jw_challan_id, rm_location.qty, loc2.loc_name AS `loc_out` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `location_main` ON `rm_location`.`loc_in` = `location_main`.`location_key`  LEFT JOIN `location_main` as loc2 ON `rm_location`.`loc_out` = `loc2`.`location_key`  LEFT JOIN `admin_login` ON rm_location.insert_by = admin_login.CustID WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND DATE_FORMAT( `rm_location`.`insert_date`, '%Y-%m-%d' ) = :date AND `rm_location`.`trans_type` IN('JOBWORK') AND rm_location.company_branch = :branch AND FIND_IN_SET( location_main.location_key, (SELECT locations FROM location_allotted WHERE loc_all_key = '2023919103150216') ) ORDER BY `rm_location`.`insert_date` DESC",
          {
            replacements: { date: date, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      }
      if (req.body.wise == "rm-cons") {
        stmt = await invtDB.query(
          "SELECT components.c_name, `components`.`component_key`, components.c_part_no, `components`.`c_new_part_no` ,units.units_name, location_main.loc_name, admin_login.user_name , rm_location.insert_date, rm_location.trans_type, rm_location.in_vendor_name, rm_location.out_transaction_id, rm_location.any_remark, rm_location.jw_challan_id, rm_location.qty, loc2.loc_name AS `loc_out` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `location_main` ON `rm_location`.`loc_in` = `location_main`.`location_key`  LEFT JOIN `location_main` as loc2 ON `rm_location`.`loc_out` = `loc2`.`location_key`  LEFT JOIN `admin_login` ON rm_location.insert_by = admin_login.CustID WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND DATE_FORMAT( `rm_location`.`insert_date`, '%Y-%m-%d' ) = :date AND `rm_location`.`trans_type` IN('ISSUE') AND rm_location.company_branch = :branch AND FIND_IN_SET( location_main.location_key, (SELECT locations FROM location_allotted WHERE loc_all_key = '202391921334723') ) ORDER BY `rm_location`.`insert_date` DESC",
          {
            replacements: { date: date, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      }

      if (req.body.wise == "rm-rej") {
        stmt = await invtDB.query(
          "SELECT components.c_name, `components`.`component_key`, components.c_part_no, `components`.`c_new_part_no` ,units.units_name, location_main.loc_name, admin_login.user_name , rm_location.insert_date, rm_location.trans_type, rm_location.in_vendor_name, rm_location.out_transaction_id, rm_location.any_remark, rm_location.jw_challan_id, rm_location.qty, loc2.loc_name AS `loc_out` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `location_main` ON `rm_location`.`loc_in` = `location_main`.`location_key`  LEFT JOIN `location_main` as loc2 ON `rm_location`.`loc_out` = `loc2`.`location_key`  LEFT JOIN `admin_login` ON rm_location.insert_by = admin_login.CustID WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND DATE_FORMAT( `rm_location`.`insert_date`, '%Y-%m-%d' ) = :date AND `rm_location`.`trans_type` IN('REJECTION') AND rm_location.company_branch = :branch AND FIND_IN_SET( location_main.location_key, (SELECT locations FROM location_allotted WHERE loc_all_key = '2023926102632157') ) ORDER BY `rm_location`.`insert_date` DESC",
          {
            replacements: { date: date, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      }

      if(req.body.wise=="rm-rej"){
        stmt=await invtDB.query(
          
        )
      }
      

      if (req.body.wise == "ven-cons") {
        stmt = await invtDB.query(
          "SELECT jw_ven_location.*, components.c_part_no, components.c_name , units.units_name, admin_login.user_name FROM jw_ven_location LEFT JOIN components ON components.component_key = jw_ven_location.jw_ven_rm LEFT JOIN units ON units.units_id = components.c_uom LEFT JOIN admin_login ON admin_login.CustID = jw_ven_location.jw_ven_insert_by WHERE jw_ven_code = :vendor AND (DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') BETWEEN :data AND :data) AND jw_ven_txn_type = 'RM-CONSUMPTION' AND jw_ven_location.type = 'consumption'",
          {
            replacements: {
              vendor: "VEN0266",
              data: date,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        const response_data = [];
        for (let i = 0; i < stmt.length; i++) {
          let fetchComponent = [];

          if (
            stmt[i].consumed_product != null &&
            stmt[i].consumed_product != "" &&
            stmt[i].consumed_product != undefined
          ) {
            fetchComponent = await invtDB.query(
              "SELECT * FROM components WHERE component_key = :data",
              {
                replacements: {
                  data: stmt[i].consumed_product,
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );
          }

          response_data.push({
            part_no: stmt[i].c_part_no,
            part_name: stmt[i].c_name,
            unit: stmt[i].units_name,
            qty: stmt[i].jw_ven_in_qty,
            hsn: stmt[i].jw_ven_part_hsn,
            doc_ref: stmt[i].jw_ven_challan_ref,
            doc_date: stmt[i].jw_ven_date,
            create_dt: moment(
              stmt[i].jw_ven_insert_dt,
              "YYYY-MM-DD HH:mm:ss"
            ).format("DD-MM-YYYY HH:mm:ss"),
            create_by: stmt[i].user_name,
            txn_id: stmt[i].jw_ven_txn,
            remark: stmt[i].jw_ven_remark,
            type: stmt[i].type ?? "--",
            consumedProduct:
              fetchComponent.length > 0
                ? {
                    text:
                      fetchComponent[0].c_part_no +
                      " - " +
                      fetchComponent[0].c_name,
                    value: fetchComponent[0].component_key,
                  }
                : "--",
            consumedQty: stmt[i].consumed_product_qty ?? "--",
          });
        }

        return res.json({ status: "success", success: true, message: "Data fetched successfully", data: response_data });
      }

      if (stmt.length > 0) {
        let final_data = [],
          count = 0;
        stmt.map(async (item) => {
          let last_purchase = 0;

          /*let stmt1 = await invtDB.query("SELECT `ID`, COALESCE(SUM(`in_po_rate`), 0) AS `last_rate`, `components_id` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD') AND `ID` = (SELECT MAX(`ID`) FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD'))",
          {
            replacements: { component: item.component_key },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt1.length > 0) {
          last_purchase = stmt1[0].last_rate;
        } else {
          last_purchase = 0;
        }*/

          //TRANSACTION MODE
          let transaction_mode;
          let transaction_id;
          if (item.trans_type == "") {
            transaction_mode = "N/A";
            transaction_id = "N/A";
          } else if (item.trans_type == "ISSUE") {
            transaction_mode = "ISSUE";
            transaction_id = "TXN ID: " + item.out_transaction_id;
          } else if (item.trans_type == "JOBWORK") {
            transaction_mode = "JOBWORK";
            transaction_id =
              "JW TXN ID: " +
              item.jw_transaction_id +
              "<br/>CHALLAN TXN ID: " +
              item.jw_challan_id;
          } else if (item.trans_type == "REJECTION") {
            transaction_mode = "REJECTION";
            transaction_id = "N/A";
          } else {
            transaction_mode = "N/A";
            transaction_id = "N/A";
          }

          final_data.push({
            DATE: moment(item.insert_date).format("DD-MM-YYYY HH:mm:ss"),
            COMPONENT: decode(item.c_name),
            CATPART: item.c_new_part_no,
            PART: item.c_part_no,
            FROMLOCATION: item.loc_out,
            TOLOCATION: item.loc_name,
            OUTQTY: `${item.qty}`,
            UNIT: item.units_name,
            TYPE: transaction_mode,
            TRANSACTION: transaction_id,
            LPP: last_purchase,
          });
          count++;
        });

        if (stmt.length == final_data.length) {
          return res.json({
            status: "success", success: true,
            success: true,
            message: "Data fetched successfully",
            data: final_data,
          });
        }
      } else {
        return res.json({
          status: "error", success: false,
          success: false,
          message: "could not find the transaction the date you have supplied",
        });
      }
    } catch (err) {
        return res.json({ status: "error", success: false, message: err.message , err:err.stack});
    }
  }
);

module.exports = router;

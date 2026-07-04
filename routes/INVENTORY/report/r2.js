let { invtDB } = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

//Required Passing Parameters:

//1.  date
//2.  type [P/A]
function byDate(a, b) {
  let d1 = new Date(moment(a.reg_date, "DD-MM-YYYY"));
  let d2 = new Date(moment(b.reg_date, "DD-MM-YYYY"));
  return d2 - d1;
}

router.post("/", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Something you missing in form field to supply.", data: validation.errors.all() });
  }

  try {
    let stmt = [];
    if (searchBy == "P") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
      if (durationInMonths > 3) {
        return res.json({
          status: "error", success: false,
          success: false,
          message: "On the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only.",
        });
      }
      stmt = await invtDB.query(
        "SELECT *, branches.branch_name, COALESCE(SUM(`po_purchase_req`.`po_order_qty`),0) `totalReq_Qty`,po_purchase_req.po_remark, COALESCE(SUM(`po_purchase_req`.`po_inward_qty`),0) `Inward`, ( SELECT user_name FROM admin_login WHERE admin_login.CustID = po_purchase_req.po_raise_by ) AS request_by , ( SELECT user_name FROM admin_login WHERE admin_login.CustID = po_purchase_req.po_approve_by ) AS approved_by FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` LEFT JOIN `units` ON units.units_id = `components`.`c_uom` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `po_purchase_req`.`po_insert_by` LEFT JOIN `cost_center` ON `po_purchase_req`.`po_cost_center` = `cost_center`.`cost_center_key` LEFT JOIN `branches` ON `branches`.`branch_code` = `po_purchase_req`.`company_branch` WHERE `components`.`c_is_enabled` = 'Y' AND `po_purchase_req`.`po_status` = 'A' AND ( (`po_purchase_req`.`po_status` = 'C' AND `po_purchase_req`.`po_inward_qty` != '0') OR  ( DATE_FORMAT(`po_purchase_req`.`po_full_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) ) GROUP BY `po_purchase_req`.`po_part_no`, `po_purchase_req`.`po_transaction` ORDER BY `po_purchase_req`.`ID` DESC",
        {
          replacements: { date1: fromdate, date2: todate },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt.length > 0) {
        const data = [];
        for (let i = 0; i < stmt.length; i++) {
          if (stmt[i].totalReq_Qty > stmt[i].Inward) {
            let duedate;
            if (stmt[i].po_duedate == "") {
              duedate = "--";
            } else {
              duedate = stmt[i].po_duedate;
            }

            let cost_center;
            if (stmt[i].po_cost_center !== "--" && stmt[i].po_cost_center !== "") {
              cost_center = stmt[i].cost_center_name + " (" + stmt[i].cost_center_short_name + ")";
            } else {
              cost_center = "N/A";
            }

            data.push({
              totalOB: "--",
              totalClosingh: "-",
              totalIn: "--",
              totalOut: "--",
              branch: stmt[i].branch_name,
              component_name: decode(stmt[i].c_name),
              unit_name: stmt[i].units_name,
              part_no: stmt[i].c_part_no,
              new_partno: stmt[i].c_new_part_no,
              reg_date: moment(stmt[i].po_full_date).tz("Asia/Kolkata").format("DD-MM-YYYY"),
              reg_by: stmt[i].user_name,
              ordered_qty: stmt[i].po_order_qty,
              ordered_pending: stmt[i].po_pending_qty,
              ordered_inward: stmt[i].po_inward_qty,
              vendor_name: stmt[i].po_vendor_name,
              vendor_code: stmt[i].po_vendor_reg_id,
              due_date: duedate,
              po_order_id: stmt[i].po_transaction,
              po_rate: stmt[i].po_order_rate,
              po_cost_center: cost_center,
              po_project: stmt[i].po_project_name,
              po_status: stmt[i].po_status,
              po_remark: stmt[i].po_remark,
              po_approve_by: stmt[i].approved_by,
              po_raise_by: stmt[i].request_by,
              // weightedPurchaseRate: await require("../../../helper/utils/avgRate").getWeightedPurchaseRate(stmt[i].component_key, moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")),

            });
          }
        }
        data.sort(byDate);
        res.json({
          status: "success", success: true,
          success: true,
          data: data,
        });
        return;
      } else {
        res.json({
          status: "error", success: false,
          success: false,
          message: "No entry found in between date.",
        });
        return;
      }
    } else if (searchBy == "A") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
      if (durationInMonths > 3) {
        return res.json({
          status: "error", success: false,
          success: false,
          message: "On the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only.",
        });
      }
      stmt = await invtDB.query(
        "SELECT *, branches.branch_name, COALESCE(SUM(`po_purchase_req`.`po_order_qty`),0) `totalReq_Qty`,po_purchase_req.po_remark, ( SELECT user_name FROM admin_login WHERE admin_login.CustID = po_purchase_req.po_raise_by ) AS request_by , ( SELECT user_name FROM admin_login WHERE admin_login.CustID = po_purchase_req.po_approve_by ) AS approved_by FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `po_purchase_req`.`po_insert_by` LEFT JOIN `cost_center` ON `po_purchase_req`.`po_cost_center` = `cost_center`.`cost_center_key` LEFT JOIN `branches` ON `branches`.`branch_code` = `po_purchase_req`.`company_branch` WHERE `components`.`c_is_enabled` = 'Y' AND `po_purchase_req`.`po_status` = 'A' AND DATE_FORMAT(`po_purchase_req`.`po_full_date`, '%Y-%m-%d') BETWEEN :date1 AND :date2 GROUP BY `po_purchase_req`.`po_part_no`, `po_purchase_req`.`po_transaction` ORDER BY `po_purchase_req`.`ID` DESC",
        {
          replacements: { date1: fromdate, date2: todate },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt.length > 0) {
        const data = [];
        for (let i = 0; i < stmt.length; i++) {
          let duedate;
          if (stmt[i].po_duedate == "") {
            duedate = "--";
          } else {
            duedate = stmt[i].po_duedate;
          }

          let cost_center;
          if (stmt[i].po_cost_center !== "--" && stmt[i].po_cost_center !== "") {
            cost_center = stmt[i].cost_center_name + " (" + stmt[i].cost_center_short_name + ")";
          } else {
            cost_center = "N/A";
          }

          data.push({
            totalOB: "--",
            totalClosingh: "-",
            totalIn: "--",
            totalOut: "--",
            branch: stmt[i].branch_name,
            component_name: decode(stmt[i].c_name),
            unit_name: stmt[i].units_name,
            part_no: stmt[i].c_part_no,
            new_partno: stmt[i].c_new_part_no,
            reg_date: moment(stmt[i].po_full_date).tz("Asia/Kolkata").format("DD-MM-YYYY"),
            reg_by: stmt[i].user_name,
            ordered_qty: stmt[i].po_order_qty,
            ordered_pending: stmt[i].po_pending_qty,
            ordered_inward: stmt[i].po_inward_qty,
            vendor_name: stmt[i].po_vendor_name,
            vendor_code: stmt[i].po_vendor_reg_id,
            due_date: duedate,
            po_order_id: stmt[i].po_transaction,
            po_rate: stmt[i].po_order_rate,
            po_cost_center: cost_center,
            po_project: stmt[i].po_project_name,
            po_status: stmt[i].po_status,
            po_remark: stmt[i].po_remark,
            po_approve_by: stmt[i].approved_by,
            po_raise_by: stmt[i].request_by,
            // weightedPurchaseRate: await require("../../../helper/utils/avgRate").getWeightedPurchaseRate(stmt[i].component_key, moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")),

          });
        }
        res.json({
          status: "success", success: true,
          success: true,
          data: data,
        });
        return;
      } else {
        res.json({
          status: "error", success: false,
          success: false,
          message: "No entry found in between date.",
        });
        return;
      }
    } else if (searchBy == "PROJECT") {
      stmt = await invtDB.query(
        "SELECT *, branches.branch_name, COALESCE(SUM(`po_purchase_req`.`po_order_qty`),0) `totalReq_Qty`,po_purchase_req.po_remark, ( SELECT user_name FROM admin_login WHERE admin_login.CustID = po_purchase_req.po_raise_by ) AS request_by , ( SELECT user_name FROM admin_login WHERE admin_login.CustID = po_purchase_req.po_approve_by ) AS approved_by FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `po_purchase_req`.`po_insert_by` LEFT JOIN `cost_center` ON `po_purchase_req`.`po_cost_center` = `cost_center`.`cost_center_key` LEFT JOIN `branches` ON `branches`.`branch_code` = `po_purchase_req`.`company_branch` WHERE `components`.`c_is_enabled` = 'Y' AND `po_project_name` = :project_name GROUP BY `po_purchase_req`.`po_part_no`, `po_purchase_req`.`po_transaction` ORDER BY `po_purchase_req`.`ID` DESC",
        {
          replacements: { project_name: searchValue },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt.length > 0) {
        const data = [];
        for (let i = 0; i < stmt.length; i++) {
          let duedate;
          if (stmt[i].po_duedate == "") {
            duedate = "--";
          } else {
            duedate = stmt[i].po_duedate;
          }

          let cost_center;
          if (stmt[i].po_cost_center !== "--" && stmt[i].po_cost_center !== "") {
            cost_center = stmt[i].cost_center_name + " (" + stmt[i].cost_center_short_name + ")";
          } else {
            cost_center = "N/A";
          }

          data.push({
            totalOB: "--",
            totalClosingh: "-",
            totalIn: "--",
            totalOut: "--",
            branch: stmt[i].branch_name,
            component_name: decode(stmt[i].c_name),
            unit_name: stmt[i].units_name,
            part_no: stmt[i].c_part_no,
            new_partno: stmt[i].c_new_part_no,
            reg_date: moment(stmt[i].po_full_date).tz("Asia/Kolkata").format("DD-MM-YYYY"),
            reg_by: stmt[i].user_name,
            ordered_qty: stmt[i].po_order_qty,
            ordered_pending: stmt[i].po_pending_qty,
            ordered_inward: stmt[i].po_inward_qty,
            vendor_name: stmt[i].po_vendor_name,
            vendor_code: stmt[i].po_vendor_reg_id,
            due_date: duedate,
            po_order_id: stmt[i].po_transaction,
            po_rate: stmt[i].po_order_rate,
            po_cost_center: cost_center,
            po_project: stmt[i].po_project_name,
            po_status: stmt[i].po_status,
            po_remark: stmt[i].po_remark,
            po_approve_by: stmt[i].approved_by,
            po_raise_by: stmt[i].request_by,
            // weightedPurchaseRate: await require("../../../helper/utils/avgRate").getWeightedPurchaseRate(stmt[i].component_key, moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")),

          });
        }
        res.json({
          status: "success", success: true,
          success: true,
          data: data,
        });
        return;
      } else {
        res.json({
          status: "error", success: false,
          message: "no entry found with the project name you entered",
          code: "500",
        });
        return;
      }
    } else if (searchBy == "by") {
      stmt = await invtDB.query(
        "SELECT *, branches.branch_name, COALESCE(SUM(`po_purchase_req`.`po_order_qty`),0) `totalReq_Qty`,po_purchase_req.po_remark, COALESCE(SUM(`po_purchase_req`.`po_inward_qty`),0) `Inward`, ( SELECT user_name FROM admin_login WHERE admin_login.CustID = po_purchase_req.po_raise_by ) AS request_by , ( SELECT user_name FROM admin_login WHERE admin_login.CustID = po_purchase_req.po_approve_by ) AS approved_by FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` LEFT JOIN `units` ON units.units_id = `components`.`c_uom` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `po_purchase_req`.`po_insert_by` LEFT JOIN `cost_center` ON `po_purchase_req`.`po_cost_center` = `cost_center`.`cost_center_key` LEFT JOIN `branches` ON `branches`.`branch_code` = `po_purchase_req`.`company_branch` WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND po_raise_by = :data GROUP BY `po_purchase_req`.`po_part_no`, `po_purchase_req`.`po_transaction` ORDER BY `po_purchase_req`.`ID` DESC",
        {
          replacements: { data: searchValue },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt.length > 0) {
        const data = [];
        for (let i = 0; i < stmt.length; i++) {
          //if (stmt[i].totalReq_Qty > stmt[i].Inward) {
          let duedate;
          if (stmt[i].po_duedate == "") {
            duedate = "--";
          } else {
            duedate = stmt[i].po_duedate;
          }

          let cost_center;
          if (stmt[i].po_cost_center !== "--" && stmt[i].po_cost_center !== "") {
            cost_center = stmt[i].cost_center_name + " (" + stmt[i].cost_center_short_name + ")";
          } else {
            cost_center = "N/A";
          }

          data.push({
            totalOB: "--",
            totalClosingh: "-",
            totalIn: "--",
            totalOut: "--",
            branch: stmt[i].branch_name,
            component_name: decode(stmt[i].c_name),
            unit_name: stmt[i].units_name,
            part_no: stmt[i].c_part_no,
            new_partno: stmt[i].c_new_part_no,
            reg_date: moment(stmt[i].po_full_date).tz("Asia/Kolkata").format("DD-MM-YYYY"),
            reg_by: stmt[i].user_name,
            ordered_qty: stmt[i].po_order_qty,
            ordered_pending: stmt[i].po_pending_qty,
            ordered_inward: stmt[i].po_inward_qty,
            vendor_name: stmt[i].po_vendor_name,
            vendor_code: stmt[i].po_vendor_reg_id,
            due_date: duedate,
            po_order_id: stmt[i].po_transaction,
            po_rate: stmt[i].po_order_rate,
            po_cost_center: cost_center,
            po_project: stmt[i].po_project_name,
            po_approve_by: stmt[i].approved_by,
            po_remark: stmt[i].po_remark,
            po_raise_by: stmt[i].request_by,
            // weightedPurchaseRate: await require("../../../helper/utils/avgRate").getWeightedPurchaseRate(stmt[i].component_key, moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")),
          });
          //}
        }
        data.sort(byDate);
        res.json({
          status: "success", success: true,
          success: true,
          data: data,
        });
        return;
      } else {
        res.json({
          status: "error", success: false,
          success: false,
          message: "No entry found in between date.",
        });
        return;
      }
    } else {
      res.json({
        status: "error", success: false,
        message: "select valid report type",
        code: "500",
      });
      return;
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;

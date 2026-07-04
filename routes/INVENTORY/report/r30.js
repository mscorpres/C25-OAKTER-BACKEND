let { invtDB } = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

function byDate(a, b) {
  return (
    moment(b.date, "DD-MM-YYYY HH:mm:ss") -
    moment(a.date, "DD-MM-YYYY HH:mm:ss")
  );
}
function byID(a, b) {
  return b.rowcount - a.rowcount;
}

router.post("/", [auth.isAuthorized], async (req, res) => {
  if (req.body.vendor == null) {
    return res.json({
      status: "error",
      success: false,
      success: false,
      message: "Please supply vendor",
    });
  }
  if (req.body.date == "") {
    return res.json({
      status: "error",
      success: false,
      success: false,
      message: "Please supply date range",
    });
  }

  const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
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
        "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
    });
  }

  try {
    let stmt = await invtDB.query(
      "SELECT `jw_ven_challan`.`jw_jobwork_id`, `jw_ven_challan`.`jw_challan_id`, `jw_ven_challan`.`jw_insert_dt`, `admin_login`.`user_name` FROM `jw_ven_challan` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `jw_ven_challan`.`jw_insert_by` WHERE (`jw_trans_type` = 'P' AND DATE_FORMAT(`jw_insert_dt`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND jw_ven_challan.jw_ven = :vendor GROUP BY `jw_trans_type`, `jw_challan_ref`",
      {
        replacements: {
          date1: fromdate,
          date2: todate,
          vendor: req.body.vendor,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      let finalResult = [],
        count = 0;
      stmt.forEach((element) => {
        finalResult.push({
          jobwork: element.jw_jobwork_id,
          challan: element.jw_challan_id,
          insert_by: element.user_name,
          insert_dt: moment(element.jw_insert_dt)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY hh:mm A"),
        });
        count++;
        if (stmt.length == count) {
          return res.json({
            status: "success",
            success: true,
            message: "Data fetched successfully",
            data: finalResult,
          });
        }
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No request found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.post("/viewRM", [auth.isAuthorized], async (req, res) => {
  if (req.body.vendor == null) {
    return res.json({
      status: "error",
      success: false,
      success: false,
      message: "Please supply vendor",
    });
  }
  if (req.body.jw == "") {
    return res.json({
      status: "error",
      success: false,
      success: false,
      message: "Please supply the Jobwork",
    });
  }
  if (req.body.challan == "") {
    return res.json({
      status: "error",
      success: false,
      success: false,
      message: "Please supply the challan",
    });
  }
  try {
    let stmt = await invtDB.query(
      "SELECT `components`.`c_part_no`, `components`.`c_new_part_no`, `components`.`component_key`, `components`.`c_name`, `jw_ven_challan`.`jw_jobwork_id`, `jw_ven_challan`.`jw_challan_id`, `jw_ven_challan`.`jw_qty`, `jw_ven_challan`.`jw_rate`, `units`.`units_name`, (SELECT 	jw_hsncode FROM jw_material_challan WHERE jw_component_id = `components`.`component_key` AND jw_jobwork_id = :jw AND 	jw_challan_id = :challan LIMIT 1) AS hsn FROM `jw_ven_challan` LEFT JOIN `components` ON `jw_ven_challan`.`jw_part` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_trans_type` = 'P' AND `jw_jobwork_id` = :jw AND `jw_challan_id` = :challan AND jw_ven_challan.jw_ven = :vendor",
      {
        replacements: {
          jw: req.body.jw,
          challan: req.body.challan,
          vendor: req.body.vendor,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      let finalResult = [];
      for (let i = 0; i < stmt.length; i++) {
        let select_res = await invtDB.query(
          "SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) as `in_qty` FROM `jw_ven_location` WHERE `jw_ven_jw_ref` = :jobwork AND `jw_ven_rm` = :component AND `jw_ven_challan_ref` = :challan",
          {
            replacements: {
              component: stmt[i].component_key,
              jobwork: stmt[i].jw_jobwork_id,
              challan: stmt[i].jw_challan_id,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let in_qty = 0,
          jw_qty = 0;
        if (select_res.length > 0) {
          in_qty = helper.number(select_res[0].in_qty);
          jw_qty = helper.number(stmt[i].jw_qty);
        }

        finalResult.push({
          cat_part_no: stmt[i].c_new_part_no,
          part_no: stmt[i].c_part_no,
          part_name: stmt[i].c_name,
          uom: stmt[i].units_name,
          hsn: stmt[i].hsn ?? "--",
          jw_qty: stmt[i].jw_qty,
          jw_leftqty: jw_qty - in_qty,
          jw_rate: stmt[i].jw_rate,
        });
      }
      res.json({ status: "success", success: true, data: finalResult });
      return;
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No request found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

module.exports = router;

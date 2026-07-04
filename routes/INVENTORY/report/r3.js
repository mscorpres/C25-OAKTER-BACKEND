let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

//Required Passing Parameters:

//1.  date

router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    if (req.body.date == "") {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply date.",
      });
    }
    const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
    if (durationInMonths > 3) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "On the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only.",
      });
    }
    let stmt1 = await invtDB.query(
      "SELECT *,`t1`.`user_name` AS `mfg_created_by`, `t2`.`user_name` AS `mfg_approved_by` FROM `mfg_production_2` LEFT JOIN `products` ON `mfg_production_2`.`mfg_sku` = `products`.`p_sku` LEFT JOIN `location_main` ON `mfg_production_2`.`mfg_con_location` = `location_main`.`location_key` LEFT JOIN `mfg_production_1` ON `mfg_production_1`.`prod_product_sku` = `mfg_production_2`.`mfg_sku` AND `mfg_production_1`.`prod_transaction` = `mfg_production_2`.`mfg_ref_id` LEFT JOIN `admin_login` AS `t1` ON `t1`.`CustID` = `mfg_production_2`.`mfg_ppr_created_by` LEFT JOIN `admin_login` AS `t2` ON `t2`.`CustID` = `mfg_production_2`.`mfg_approved_by` WHERE `mfg_production_2`.`mfg_prod_type` = 'C' AND DATE_FORMAT(`mfg_production_2`.`mfg_full_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
      { replacements: { date1: fromdate, date2: todate }, type: invtDB.QueryTypes.SELECT }
    );

    const data = [];
    count = 0;
    if (stmt1.length > 0) {
      stmt1.map((item) => {
        data.push({
          serial_no: count + 1,
          product_sku: item.p_sku,
          product_name: item.p_name,
          transaction1: item.mfg_ref_id,
          transaction2: item.mfg_transaction,
          mfginsertdate: moment(item.mfg_full_date).tz("Asia/Kolkata").format("DD-MM-YYYY"),
          approveqty: item.mfg_prod_planing_qty,
          location: item.loc_name,
          pprcreatedby: item.mfg_created_by,
          mfgapprovedby: item.mfg_approved_by,
          pprinsertdate: moment(item.prod_insert_date).tz("Asia/Kolkata").format("DD-MM-YYYY"),
          pprcustomer: item.prod_customer_name,
          project_id: item.prod_project,
        });
        count++;
        if (stmt1.length == count) {
          return res.json({
            status: "success", success: true,
            success: true,
            data: data,
          });
        }
      });
    } else {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "No data found!",
      });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;

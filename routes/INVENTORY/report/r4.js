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
        message: "Supply date first.",
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
      "SELECT *, `t1`.`user_name` AS `mfg_approve_by`, `t2`.`user_name` AS `ppr_create_by`, `t3`.`user_name` AS `mfg_create_by` FROM `mfg_production_3` LEFT JOIN `products` ON `mfg_production_3`.`mfg_pro_apr_sku` = `products`.`p_sku` LEFT JOIN `location_main` ON `mfg_production_3`.`mfg_pro_location_in` = `location_main`.`location_key` LEFT JOIN `mfg_production_1` ON `mfg_production_1`.`prod_product_sku` = `mfg_production_3`.`mfg_pro_apr_sku` AND `mfg_production_1`.`prod_transaction` = `mfg_production_3`.`mfg_ref_transid_1` LEFT JOIN `admin_login` AS `t1` ON `t1`.`CustID` = `mfg_production_3`.`mfg_pro_apr_by` LEFT JOIN `admin_login` AS `t2` ON `t2`.`CustID` = `mfg_production_3`.`ppr_created_by` LEFT JOIN `admin_login` AS `t3` ON `t3`.`CustID` = `mfg_production_3`.`mfg_created_by` WHERE DATE_FORMAT(`mfg_production_3`.`mfg_pro_apr_fulldate`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `mfg_production_3`.`type` = 'IN' AND `mfg_production_3`.`entry_mode` = 'A' GROUP BY `mfg_production_3`.`mfg_pro_apr_transaction` ORDER BY `mfg_production_3`.`ID` DESC",
      { replacements: { date1: fromdate, date2: todate }, type: invtDB.QueryTypes.SELECT }
    );
    const data = [];
    count = 0;
    if (stmt1.length > 0) {
      stmt1.map((item) => {
        let fg_type;
        if (item.products_type == "default") {
          fg_type = "FG";
        } else if (item.products_type == "semi") {
          fg_type = "SEMI FG";
        } else {
          fg_type = "N/A";
        }

        data.push({
          type: fg_type,
          product_sku: item.p_sku,
          product_name: item.p_name,
          transaction1: item.mfg_ref_transid_1,
          transaction2: item.mfg_ref_transid_2,
          transaction3: item.mfg_pro_apr_transaction,
          mfginsertdate: moment(item.mfgphase2_insert_date).tz("Asia/Kolkata").format("DD-MM-YYYY"),
          approveqty: item.mfg_approve_in_qty,
          location: item.loc_name,
          approveby: item.mfg_approve_by,
          pprcreatedby: item.ppr_create_by,
          pprcustomer: item.prod_customer_name,
          approvedate: moment(item.mfg_pro_apr_fulldate).tz("Asia/Kolkata").format("DD-MM-YYYY"),
          mfgapprovedby: item.mfg_create_by,
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

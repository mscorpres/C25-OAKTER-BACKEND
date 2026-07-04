let { invtDB } = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


function byDate(a, b) {
  return moment(b.date, "DD-MM-YYYY HH:mm:ss") - moment(a.date, "DD-MM-YYYY HH:mm:ss");
}
function byID(a, b) {
  return b.rowcount - a.rowcount;
}

router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
    const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
    if (durationInMonths > 3) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
      });
    }

    let IN = '<span class="d-inline-block radius-round p-2 bgc-green"></span>';
    let OUT = '<span class="d-inline-block radius-round p-2 bgc-red"></span>';

    if (req.body.component == null) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply component part code",
      });
    } else if (req.body.location == null) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply location",
      });
    } else if (req.body.vendor == null) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply vendor",
      });
    } else if (req.body.date == "") {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply date range",
      });
    } else {
      let stmt1 = await invtDB.query("SELECT * FROM `components` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `components`.`c_part_no` = :partcode OR `components`.`component_key` = :partcode", {
        replacements: { partcode: req.body.component },
        type: invtDB.QueryTypes.SELECT,
      });

      if (stmt1.length > 0) {
        let stmt2 = await invtDB.query(
          "SELECT *, `jw_ven_location`.`jw_ven_insert_dt` AS `inward_date`, `jw_ven_location`.`ID` AS `rowcount` FROM `jw_ven_location` LEFT JOIN `components` ON `jw_ven_location`.`jw_ven_rm` = `components`.`component_key` LEFT JOIN `admin_login` ON `jw_ven_location`.`jw_ven_insert_by` = `admin_login`.`CustID` WHERE `jw_ven_location`.`jw_ven_rm` = :component ORDER BY `jw_ven_location`.`jw_ven_insert_dt` DESC , `jw_ven_location`.`ID` ASC",
          {
            replacements: { component: stmt1[0].component_key },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let data = [];
        if (stmt2.length > 0) {
          count = 0;
          stmt2.map(async (item) => {
            let transaction_mode;
            let transaction_type;
            let transaction_type_label;
            let qty_in;
            let qty_out;
            if (item.jw_ven_txn_type == "") {
              transaction_mode = "N/A";
            } else if (item.jw_ven_txn_type == "RM-INWARD") {
              transaction_mode = "MIN";
              transaction_type = IN;
              transaction_type_label = "INWARD";
              qty_in = item.jw_ven_in_qty;
              qty_out = 0;
            } else if (item.jw_ven_txn_type == "RM-CONSUMPTION") {
              transaction_mode = "CONSUMP";
              transaction_type = OUT;
              transaction_type_label = "CONSUMPTION";
              qty_in = 0;
              qty_out = item.jw_ven_in_qty;
            } else {
              transaction_mode = "N/A";
              transaction_type = "N/A";
              transaction_type_label = "N/A";
              qty_in = "N/A";
              qty_out = "N/A";
            }

            let stmt3 = await invtDB.query("SELECT * FROM `location_main` WHERE `location_key` = :location_in", {
              replacements: { location_in: item.jw_ven_loc_in },
              type: invtDB.QueryTypes.SELECT,
            });

            let location_in;
            if (stmt3.length > 0) {
              location_in = stmt3[0].loc_name;
            } else {
              location_in = "--";
            }

            let stmt4 = await invtDB.query("SELECT * FROM `location_main` WHERE `location_key` = :location_out", {
              replacements: { location_out: item.jw_ven_loc_out },
              type: invtDB.QueryTypes.SELECT,
            });

            let location_out;
            if (stmt4.length > 0) {
              location_out = stmt4[0].loc_name;
            } else {
              location_out = "--";
            }


            data.push({
              serial_no: count + 1,
              rowcount: item.rowcount,
              type: transaction_type,
              transaction: item.jw_ven_txn,
              qty_in: qty_in,
              qty_out: qty_out,
              key: item.component_key,
              location_in: location_in,
              location_out: location_out,
              transaction_type: transaction_type_label,
              mode: transaction_mode,
              date: moment(item.inward_date).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss"),
            });
            count++;

            if (stmt2.length == count) {
              data.sort(byID);
              myfunction();
            }
          });
        } else {
          return res.json({
            status: "error", success: false,
            success: false,
            message: "no any transaction found",
          });
        }

        async function myfunction() {
          //ALL INWARD
          let stmt6 = await invtDB.query(
            "SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Inward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND( `jw_ven_txn_type` = 'RM-INWARD') AND `jw_ven_loc_in` = :location AND `jw_ven_code` = :vendor",
            {
              replacements: {
                component: stmt1[0].component_key,
                location: req.body.location,
                vendor: req.body.vendor,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let inward_all_qty;
          if (stmt6.length > 0) {
            inward_all_qty = helper.number(stmt6[0].Inward);
          } else {
            inward_all_qty = 0;
          }

          // ALL OUTWARD
          let stmt7 = await invtDB.query(
            "SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Outward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-CONSUMPTION') AND `jw_ven_loc_out` = :location AND `jw_ven_code` = :vendor",
            {
              replacements: {
                component: stmt1[0].component_key,
                location: req.body.location,
                vendor: req.body.vendor,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let outward_all_qty;
          if (stmt7.length > 0) {
            outward_all_qty = helper.number(stmt7[0].Outward);
          } else {
            outward_all_qty = 0;
          }

          // LAST TRANSACTION DETAIL
          let stmt8 = await invtDB.query("SELECT * FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-INWARD') ORDER BY `ID` DESC LIMIT 1", {
            replacements: { component: stmt1[0].component_key },
            type: invtDB.QueryTypes.SELECT,
          });


          let stmt9 = await invtDB.query("SELECT * FROM `jw_ven_location` LEFT JOIN `admin_login` ON `jw_ven_location`.`jw_ven_insert_by` = `admin_login`.`CustID` WHERE `jw_ven_location`.`jw_ven_rm` = :component ORDER BY `jw_ven_location`.`ID` DESC LIMIT 1", {
            replacements: { component: stmt1[0].component_key },
            type: invtDB.QueryTypes.SELECT,
          });
          let user;
          let date;
          if (stmt9.length > 0) {
            user = stmt9[0].user_name;
            date = moment(stmt9[0].jw_ven_insert_dt).tz("Asia/Kolkata").format("DD-MM-YYYY");
          } else {
            user = "N/A";
            date = "N/A";
          }

          if (data.length == 0) {
            res.json({
              status: "error", success: false,
              message: "no any transaction found",

            });
            return;
          } else {
            return res.json({
              status: "success", success: true,
              success: true,
              message: "Report fetched successfully",
              data: {
                data1: {
                  partno: stmt2[0].c_part_no,
                  component: decode(stmt2[0].c_name),
                  uom: stmt1[0].units_name,
                  closingqty: helper.number(inward_all_qty - outward_all_qty)
                },
                data2: data,
              },
            });
          }
        }
      } else {
        res.json({
          status: "error", success: false,
          message: "no any transaction found",

        });
        return;
      }
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;

let { invtDB, otherDB } = require("../../../config/db/connection");
const { encode, decode } = require("html-entities");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query("SELECT * FROM rm_location WHERE DATE_FORMAT(insert_date,'%Y-%m-%d') = :date GROUP BY components_id", {
      replacements: {
        date: moment(new Date()).format("DD-MM-YYYY"),
      },
      type: invtDB.QueryTypes.SELECT,
    });

    stmt1.map(async (item) => {
      //INWARD
      let stmt2 = await invtDB.query(
        "SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND (trans_type = 'INWARD' OR trans_type = 'TRANSFER')",
        {
          replacements: {
            component: item.components_id,
            date: moment(new Date()).format("DD-MM-YYYY"),
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let inward_qty;
      if (stmt2.length > 0) {
        inward_qty = stmt2[0].Inward;
      } else {
        inward_qty = 0;
      }

      //OUTWARD
      let stmt3 = await invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') = :date AND (`trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER')",
        {
          replacements: {
            component: item.components_id,
            date: moment(new Date()).format("DD-MM-YYYY"),
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let outward_qty;
      if (stmt3.length > 0) {
        outward_qty = stmt3[0].Outward;
      } else {
        outward_qty = 0;
      }

      let stmt4 = await otherDB.query("SELECT * FROM invt_r11 WHERE component_key = :component", {
        replacements: { component: item.components_id },
        type: otherDB.QueryTypes.SELECT,
      });
      if (stmt4.length > 0) {
        //UPDATE OPNING OPENING STOCK
        let update = otherDB.query("UPDATE invt_r11 SET tdday_in_bal = :in, tdday_out_bal = :out, re_calculate = 'N' WHERE component_key = :component", {
          replacements: {
            component: item.components_id,
            in: inward_qty,
            out: outward_qty,
          },
          type: otherDB.QueryTypes.UPDATE,
        });
      } else {
        //INSERT COMPONENT FROM COMPONENT
        let insert = otherDB.query("INSERT INTO invt_r11 (component_key, tdday_in_bal, tdday_out_bal, re_calculate)VALUES (:component, :in, :out, 'N')", {
          replacements: {
            component: item.components_id,
            in: inward_qty,
            out: outward_qty,
          },
          type: otherDB.QueryTypes.INSERT,
        });
      }
    });

    let stmt5 = await otherDB.query(
      `SELECT r11.re_calculate, r11.ystday_cl_bal, r11.tdday_in_bal, r11.last_rt, r11.tdday_out_bal, c1.component_key, c1.c_name, c1.c_part_no, c1.c_new_part_no , u1.units_name FROM ${global.other_db_name}.invt_r11 r11 LEFT JOIN ${global.ims_db_name}.components c1 ON r11.component_key = c1.component_key LEFT JOIN ${global.ims_db_name}.units u1 ON c1.c_uom = u1.units_id ORDER BY c1.c_part_no ASC`,
      { type: otherDB.QueryTypes.SELECT }
    );

    let stmt6 = await otherDB.query("SELECT COALESCE(COUNT(ID), 00) as totalError FROM invt_r11 WHERE re_calculate != 'OK'", { type: otherDB.QueryTypes.SELECT });

    const data = [];
    count = 0;
    stmt5.map(async (item) => {
      let status;
      if (item.re_calculate == "Y") {
        status = "status_bad";
      } else {
        status = "status_good";
      }

      // let stmt6 = await invtDB.query(
      // 	"SELECT `rm_location`.`in_po_rate`, `ims_currency`.`currency_notes` FROM `rm_location` LEFT JOIN `ims_currency` ON `rm_location`.`currency_type` = `ims_currency`.`currency_id` WHERE `rm_location`.`trans_type` = 'INWARD' AND `rm_location`.`components_id` = :component ORDER BY `rm_location`.`ID` DESC LIMIT 1",
      // 	{ replacements: { component: item.component_key }, type: invtDB.QueryTypes.SELECT }
      // );

      // let last_in_rate;
      // if (stmt6.length > 0) {
      // 	last_in_rate = stmt6[0].currency_notes + " " + stmt6[0].in_po_rate;
      // } else {
      // 	last_in_rate = 0;
      // }
      let stmt7 = await invtDB.query(
        "SELECT rm_location.in_po_rate, rm_location.exchange_rate ,ims_currency.currency_symbol, ims_currency.currency_notes FROM rm_location LEFT JOIN ims_currency ON rm_location.currency_type = ims_currency.currency_id WHERE rm_location.trans_type = 'INWARD' AND rm_location.components_id = :component AND rm_location.ID = (SELECT MAX(ID) FROM rm_location WHERE components_id = :component AND (trans_type = 'INWARD') AND DATE_FORMAT( rm_location.insert_date, '%Y-%m-%d' ) <= :date  AND vendor_type  = 'v01' )",
        {
          replacements: {
            component: item.component_key,
            date: moment(new Date()).format("YYYY-MM-DD"),
          },
          type: invtDB.QueryTypes.SELECT
        }
      );
      let last_in_rate = "NA", currency = "NA" , exchange_rate = "NA";
      if (stmt7.length > 0) {
        last_in_rate = stmt7[0].currency_notes + " " + stmt7[0].in_po_rate;
        currency = stmt7[0].currency_notes;
        exchange_rate = stmt7[0].exchange_rate;
      } else {
        last_in_rate = "N/A";
      }

      data.push({
        serial_no: count + 1,
        key: item.component_key,
        name: decode(item.c_name),
        part: item.c_part_no,
        part_new: item.c_new_part_no,
        uom: item.units_name,
        op: helper.number(item.ystday_cl_bal),
        in: helper.number(item.tdday_in_bal),
        out: helper.number(item.tdday_out_bal),
        cl: helper.number(item.ystday_cl_bal) + helper.number(item.tdday_in_bal) - helper.number(item.tdday_out_bal),
        last_in_rate: last_in_rate,
        currency : currency,
        exchange_rate : exchange_rate,
        status: status,
      });
      count++;

      if (stmt5.length == count) {
        return res.json({
          status: "success", success: true,
          success: true,
          message: "Report fetched successfully",
          data: {
            data: data,
            totalError: stmt6[0].totalError
          },
        });
      }
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.get("/generate", [auth.isAuthorized], async (req, res) => {
  try {
    const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");

    //   let stmt_trunc_table = await otherDB.query("TRUNCATE TABLE `invt_r11`", {
    // 	type: otherDB.QueryTypes.TRUNCATE,
    //   });

    // INSERT INTO ${other_db_name}.invt_r11(component_key) SELECT c1.component_key FROM ${ims_db_name}.components AS c1 LEFT JOIN ${other_db_name}.invt_r11 AS c2 ON c1.component_key = c2.component_key WHERE c2.ID IS NULL

    let stmt1 = await otherDB.query(
      `INSERT INTO ${global.other_db_name}.invt_r11(component_key) SELECT c1.component_key FROM ${global.ims_db_name}.components AS c1 LEFT JOIN ${global.other_db_name}.invt_r11 AS c2 ON c1.component_key = c2.component_key WHERE c2.ID IS NULL AND c1.c_is_enabled = 'Y'`,
      { type: otherDB.QueryTypes.INSERT }
    );

    if (stmt1.length > 0) {
      let stmt2 = await otherDB.query(
        "SELECT component_key FROM invt_r11 WHERE insert_dt < :yesterday OR insert_dt = '--'",
        {
          replacements: { yesterday: yesterday },
          type: otherDB.QueryTypes.SELECT,
        }
      );
      if (stmt2.length > 0) {
        let opening_qty = 0,
          last_in_rate = "N/A";
        for (let i = 0; i < stmt2.length; i++) {

          // BRANCH STOCK LOCATION
          let r11_location = await invtDB.query("SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
            replacements: { location_key: "2023111515193423" },
            type: invtDB.QueryTypes.SELECT,
          });

          let all_branch__location = [];
          if (r11_location.length > 0) {
            for (let loc_i = 0; loc_i < r11_location.length; loc_i++) {
              all_branch__location = r11_location[loc_i].locations.split(",");
            }
          } else {
            throw new Error("No Location Found");
          }
          // END BRANCH STOCK LOCATION

          // OPENING
          let stmt3 = await invtDB.query(
            "SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS inbefor FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') < :date1 ) AS inbefor ,  (SELECT COALESCE(SUM(qty+other_qty), 0) AS outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') < :date1) AS outbefore FROM DUAL",
            {
              replacements: {
                component: stmt2[i].component_key,
                location: all_branch__location,
                date1: yesterday,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (stmt3.length > 0) {
            // opening_qty = helper.number(stmt3[0].OpeningBalance);
            opening_qty = helper.number(stmt3[0].inbefor - stmt3[0].outbefore);
          } else {
            opening_qty = 0;
          }

          // console.log(opening_qty);
          // return;

          // Last Rate
          let stmt4 = await invtDB.query(
            "SELECT `rm_location`.`in_po_rate`, `ims_currency`.`currency_symbol`, `ims_currency`.`currency_notes` FROM `rm_location` LEFT JOIN `ims_currency` ON `rm_location`.`currency_type` = `ims_currency`.`currency_id` WHERE `rm_location`.`trans_type` = 'INWARD' AND `rm_location`.`components_id` = :component ORDER BY `rm_location`.`ID` DESC LIMIT 1",
            {
              replacements: {
                component: stmt2[i].component_key,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt4.length > 0) {
            last_in_rate = stmt4[0].currency_notes + " " + stmt4[0].in_po_rate;
          } else {
            last_in_rate = "N/A";
          }

          let stmt5 = await otherDB.query(
            "SELECT * FROM `invt_r11` WHERE `component_key` = :component",
            {
              replacements: {
                component: stmt2[i].component_key,
              },
              type: otherDB.QueryTypes.SELECT,
            }
          );

          let finalUpdate = await otherDB.query(
            "UPDATE `invt_r11` SET `ystday_cl_bal` = :close, `re_calculate` = 'OK', `insert_dt` = :newdate, `last_rt` = :lastrate WHERE `component_key` = :component",
            {
              replacements: {
                close: opening_qty,
                component: stmt2[i].component_key,
                newdate: moment().format("YYYY-MM-DD"),
                lastrate: last_in_rate,
              },
              type: otherDB.QueryTypes.UPDATE,
            }
          );
        }
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

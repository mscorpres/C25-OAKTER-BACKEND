let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();
const { encode, decode } = require("html-entities");

//Required Passing Parameters:

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const Validation = require("validatorjs");

//1.  type [T/A]
//2.  date DD-MM-YYYY - DD-MM-YYYY
//3.  location
//4.  pagefrom
//5.  pageto

router.get("/", [auth.isAuthorized], async (req, res) => {
  let validation = new Validation(req.query, {
    date: "required",
    page: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Validation failed", data: validation.errors.all() });
  }

  try {
    const date = req.query.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
    const { page, rows, callback } = req.query;

    let from = page == 1 ? 0 : page * rows - rows;

    let total_comp = await invtDB.query("SELECT COUNT(*) AS `records` FROM `components`", { type: invtDB.QueryTypes.SELECT });
    const records = total_comp[0].records;

    let comp_stmt = await invtDB.query(`SELECT component_key, c_part_no, c_name, c_min_stock FROM components WHERE c_type != 'S' AND c_is_enabled = 'Y' LIMIT ${from} , ${rows}`, {
      type: invtDB.QueryTypes.SELECT,
    });

    if (comp_stmt.length > 0) {
      let final_data = [];
      count = 0;
      for (let i = 0; i < comp_stmt.length; i++) {
        // INWARD AND OUTWARD
        let stmt = await invtDB.query(
          "SELECT COALESCE(SUM(CASE WHEN trans_type IN ( 'INWARD','TRANSFER' ) THEN qty ELSE 0 END ), 0) AS inward , COALESCE(SUM(CASE WHEN trans_type IN ( 'ISSUE','JOBWORK', 'REJECTION', 'TRANSFER' ) THEN qty ELSE 0 END ), 0) AS outward FROM rm_location WHERE DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND components_id = :compKey AND `trans_type` IN ( 'INWARD','ISSUE','JOBWORK', 'REJECTION', 'TRANSFER' )",
          {
            replacements: {
              compKey: comp_stmt[i].component_key,
              date1: fromdate,
              date2: todate
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let INWARD, OUTWARD;
        if (stmt.length > 0) {
          INWARD = helper.number(stmt[0].inward);
          OUTWARD = helper.number(stmt[0].outward);
        }

        let open_stmt = await invtDB.query(
          "SELECT COALESCE(SUM(QTY), 0) AS `OpeningBalance` FROM ( SELECT `qty` QTY FROM `rm_location` CR WHERE CR.components_id = :compKey AND DATE_FORMAT(CR.insert_date, '%Y-%m-%d') < :date1 AND (CR.`trans_type` = 'INWARD' OR CR.`trans_type` = 'TRANSFER') UNION ALL SELECT - COALESCE(SUM(`qty` + `other_qty`), 0) QTY FROM `rm_location` DR WHERE DR.components_id = :compKey AND DATE_FORMAT(DR.insert_date, '%Y-%m-%d') < :date1 AND (DR.`trans_type` = 'ISSUE' OR DR.`trans_type` = 'REJECTION' OR DR.`trans_type` = 'JOBWORK' OR DR.`trans_type` = 'TRANSFER')) t",
          {
            replacements: {
              compKey: comp_stmt[i].component_key,
              date1: fromdate
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let OPENING;
        if (open_stmt.length > 0) {
          OPENING = open_stmt[0].OpeningBalance;
        }

        count++;
        final_data.push({
          SR: from + count,
          PART_CODE: comp_stmt[i].c_part_no,
          COMPONENT_NAME: decode(comp_stmt[i].c_name),
          OPENING: OPENING,
          INWARD: INWARD,
          OUTWARD: OUTWARD,
          CLOSING: helper.number(OPENING) + helper.number(INWARD) - helper.number(OUTWARD),
        });

        if (final_data.length == comp_stmt.length) {
          let data = callback + `(` + JSON.stringify({ page: page, rows: final_data, records: `${records}`, total: parseInt(records / rows) }) + ")";
          res.writeHeader(200, { "Content-Type": "text/html" });
          res.write(data);
          res.end();
          return;
        }
      }
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/old", [auth.isAuthorized], async (req, res) => {
  try {
    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0]).format("YYYY-DD-MM");
    const todate = moment(date[1]).format("YYYY-DD-MM");
    const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
    if (req.body.type == "") {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply data report type.",
      });
    } else if (req.body.date == "") {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply date.",
      });
    } else if (req.body.location == "") {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply location.",
      });
    } else if (req.body.pagefrom == "") {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply page from number.",
      });
    } else if (req.body.pageto == "") {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Please supply page to number.",
      });
    } else if (durationInMonths > 3) {
      // 6months
      let stmt1;
      if (req.body.type == "T") {
        stmt1 = await invtDB.query(
          "SELECT * FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE DATE_FORMAT(`rm_location`.`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND (`rm_location`.`loc_in` = :location OR `rm_location`.`loc_out` = :location) AND (`rm_location`.`trans_type` != 'CANCELLED') AND components.c_is_enabled = 'Y' GROUP BY `components`.`component_key` ORDER BY `components`.`c_part_no` ASC LIMIT :pagefrom, :pageto",
          {
            replacements: {
              date1: fromdate,
              date2: todate,
              location: req.body.location,
              pagefrom: parseInt(req.body.pagefrom),
              pageto: parseInt(req.body.pageto)
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else if (req.body.type == "A") {
        stmt1 = await invtDB.query("SELECT * FROM `components` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` GROUP BY `component_key` ORDER BY `components`.`c_part_no` ASC LIMIT :pagefrom, :pageto", {
          replacements: {
            pagefrom: parseInt(req.body.pagefrom),
            pageto: parseInt(req.body.pageto),
          },
          type: invtDB.QueryTypes.SELECT,
        });
      } else {
        return res.json({
          status: "error", success: false,
          success: false,
          message: "Select valid report type.",
        });
      }

      const data = [];
      count = 1;
      stmt1.map(async (item) => {
        // ALL INWARD AT LOCATION
        let stmt2 = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :location AND (`trans_type` != 'CANCELLED') AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
          {
            replacements: {
              component: item.component_key,
              date1: fromdate,
              date2: todate,
              location: req.body.location
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let inward_all_qty;
        if (stmt2.length > 0) {
          inward_all_qty = helper.number(stmt2[0].Inward);
        } else {
          inward_all_qty = "00";
        }

        // ALL OUTWARD AT LOCATION
        let stmt3 = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND `loc_out` = :location AND (`trans_type` != 'CANCELLED') AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
          {
            replacements: {
              component: item.component_key,
              date1: fromdate,
              date2: todate,
              location: req.body.location
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let outward_all_qty;
        if (stmt3.length > 0) {
          outward_all_qty = helper.number(stmt3[0].Outward);
        } else {
          outward_all_qty = "00";
        }

        //OPENING BALANCE
        let stmt4 = await invtDB.query(
          "SELECT COALESCE(SUM(QTY), 0) AS `OpeningBalance` FROM ( SELECT `qty` QTY FROM `rm_location` CR WHERE CR.components_id = :component AND CR.loc_in = :location AND (CR.`trans_type` != 'CANCELLED') AND DATE_FORMAT(CR.insert_date, '%Y-%m-%d') < :date1 UNION ALL SELECT - COALESCE(SUM(`qty` + `other_qty`), 0) QTY FROM `rm_location` DR WHERE DR.components_id = :component AND DR.loc_out = :location AND (DR.`trans_type` != 'CANCELLED') AND DATE_FORMAT(DR.insert_date, '%Y-%m-%d') < :date1) t",
          {
            replacements: {
              component: item.component_key,
              date1: fromdate,
              date2: todate,
              location: req.body.location
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let opening_qty;
        if (stmt4.length > 0) {
          opening_qty = helper.number(stmt4[0].OpeningBalance);
        } else {
          opening_qty = "00";
        }

        //CLOSING BALANCE
        let closingBal = opening_qty + (inward_all_qty - outward_all_qty);

        data.push({
          serial_no: count,
          part_code: item.c_part_no,
          part_name: item.c_name,
          uom: item.units_name,
          stockqty_location_in: inward_all_qty,
          stockqty_location_out: outward_all_qty,
          stockqty_open: opening_qty,
          stockqty_close: closingBal,
        });
        count++;

        if (data.length === stmt1.length) {
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
        message: "On the w.e.f Nov 11, 2021: We can provide you 180 days OR (6 months) data only.",
      });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;

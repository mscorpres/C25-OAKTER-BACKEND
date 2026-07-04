let { invtDB } = require("../../../config/db/connection");

require('moment-duration-format');
const Validator = require("validatorjs");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


router.post("/", [auth.isAuthorized], async (req, res) => {
  const valid = new Validator(req.body, {
    // data: "required",
    date: "required",
    type: "required|in:product,department,consolidated,all",
  });

  if (valid.fails()) {
    return res.json({ success: false, message: helper.firstErrorValidatorjs(valid) });
  }

  try {
    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

    if (!date) {
      return res.json({ status: "error", success: false, message: "Please select valid date" });
    }

    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
    const diffDays = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "days");

    if (diffDays > 90) {
      return res.json({ message: "We can provide you 90 days OR (3 months) data only" });
    }

    if (req.body.type == "consolidated") {
      let masterProdDprtNames = await invtDB.query("SELECT * FROM master_prod_dprt", {
        type: invtDB.QueryTypes.SELECT,
      });
      if (masterProdDprtNames.length == 0) {
        return res.json({ status: "error", success: false, message: "Data not found" });
      }
      let data = [];
      for (const row of masterProdDprtNames) {
        let stmt = await invtDB.query(
          "SELECT mis_prod_entry.mis_type, mis_prod_entry.mis_work_hr_in, mis_prod_entry.mis_work_hr_end, mis_prod_entry.mis_over_time, COALESCE( COUNT(mis_prod_entry.mis_line_no), 0 ) AS lineNo, COALESCE( SUM(mis_prod_entry.mis_man_power), 0 ) AS manPower, COALESCE( SUM(mis_prod_entry.mis_output), 0 ) AS output, SUBSTRING( SEC_TO_TIME( SUM( TIME_TO_SEC(mis_prod_entry.mis_work_hr_end) - TIME_TO_SEC(mis_prod_entry.mis_work_hr_in) ) ), 1, 8 ) AS totalWorkHrs, SUBSTRING( SEC_TO_TIME( SUM( TIME_TO_SEC(mis_prod_entry.mis_over_time) ) ), 1, 8 ) AS overTime, master_prod_dprt.dprt_name, COALESCE(products.p_name, components.c_name) AS name, COALESCE(products.p_sku, components.c_part_no) AS code, units.units_name, FLOOR( SUM( TIME_TO_SEC(mis_prod_entry.mis_work_hr_end) - TIME_TO_SEC(mis_prod_entry.mis_work_hr_in) ) / 3600 ) AS totalWorkHrsHrs, FLOOR( ( SUM( TIME_TO_SEC(mis_prod_entry.mis_work_hr_end) - TIME_TO_SEC(mis_prod_entry.mis_work_hr_in) ) % 3600 ) / 60 ) AS totalWorkHrsMin, COUNT(*) AS totalRecords FROM mis_prod_entry LEFT JOIN products ON mis_prod_entry.mis_type = 'FG' AND mis_prod_entry.mis_code = products.product_key LEFT JOIN components ON mis_prod_entry.mis_type != 'FG' AND mis_prod_entry.mis_code = components.component_key LEFT JOIN units ON (mis_prod_entry.mis_type = 'FG' AND products.p_uom = units.units_id) OR (mis_prod_entry.mis_type != 'FG' AND components.c_uom = units.units_id)LEFT JOIN master_prod_dprt ON master_prod_dprt.prod_dprt_key = mis_prod_entry.mis_dprt WHERE DATE_FORMAT( mis_prod_entry.mis_date, '%Y-%m-%d' ) BETWEEN :date1 AND :date2 AND mis_prod_entry.mis_dprt = :dprt GROUP BY master_prod_dprt.dprt_name, products.product_key ORDER BY mis_prod_entry.ID DESC",
          {
            replacements: { date1: fromdate, date2: todate, dprt: row.prod_dprt_key },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt.length === 0) {
        } else {
          stmt.forEach((item) => {
            // Total Hours and Subtract hour as 'totalRecords' for lunch break
            let totalWorkHrs = item.totalWorkHrsHrs; // - item.totalRecords;

            // Calculate total minutes
            let totalMinutes = totalWorkHrs * 60;

            let totalOTHrs = item.overTime;
            const formattedDay = moment.duration(totalMinutes, 'minutes').format('DD[d], HH[h]:mm[m]:ss[s]', { trim: false });

            data.push({
              department: row.dprt_name,
              product: item.name,
              sku: item.code,
              type: item.mis_type,
              unit: item.units_name,
              manPower: item.manPower,
              noOfLines: item.lineNo,
              output: item.output,
              workDay: item.workDay,
              overTm: totalOTHrs,
              totalWorkHrs: {
                hrs: Math.floor(totalWorkHrs),
                min: Math.round((totalWorkHrs % 1) * 60),
                formatted: `${Math.floor(totalWorkHrs)}:${Math.round((totalWorkHrs % 1) * 60)}`,
                totalTimeInMinutes: totalMinutes,
                days: formattedDay,
              },
            });
          });
        }
      }
      return res.json({ success: true, data });
    } else if (req.body.type == "department" || req.body.type == "product" || req.body.type == "all") {

      let data = [];
      let stmt = [];

      if (req.body.type == "department") {
        let valid = new Validator(req.body, {
          data: "required",
        });

        if (valid.fails()) {
          return res.json({ success: false, message: "Select Department" });
        }
        stmt = await invtDB.query(
          "SELECT mis_prod_entry.*, master_prod_dprt.dprt_name, COALESCE(products.p_name, components.c_name) AS name, COALESCE(products.p_sku, components.c_part_no) AS code, units.units_name FROM mis_prod_entry LEFT JOIN products ON mis_prod_entry.mis_type = 'FG' AND mis_prod_entry.mis_code = products.product_key LEFT JOIN components ON mis_prod_entry.mis_type != 'FG' AND mis_prod_entry.mis_code = components.component_key LEFT JOIN units ON (mis_prod_entry.mis_type = 'FG' AND products.p_uom = units.units_id) OR (mis_prod_entry.mis_type != 'FG' AND components.c_uom = units.units_id) LEFT JOIN master_prod_dprt ON master_prod_dprt.prod_dprt_key = mis_prod_entry.mis_dprt WHERE DATE_FORMAT( mis_prod_entry.mis_date, '%Y-%m-%d' ) BETWEEN :date1 AND :date2 AND mis_prod_entry.mis_dprt = :dprt ORDER BY mis_prod_entry.ID DESC",
          {
            replacements: { dprt: req.body.data, date1: fromdate, date2: todate },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else if (req.body.type == "product") {
        let valid = new Validator(req.body, {
          data: "required",
        });

        if (valid.fails()) {
          return res.json({ success: false, message: "Select Product" });
        }
        stmt = await invtDB.query(
          "SELECT mis_prod_entry.*, master_prod_dprt.dprt_name, COALESCE(products.p_name, components.c_name) AS name, COALESCE(products.p_sku, components.c_part_no) AS code, units.units_name FROM mis_prod_entry LEFT JOIN products ON mis_prod_entry.mis_type = 'FG' AND mis_prod_entry.mis_code = products.product_key LEFT JOIN components ON mis_prod_entry.mis_type != 'FG' AND mis_prod_entry.mis_code = components.component_key LEFT JOIN units ON (mis_prod_entry.mis_type = 'FG' AND products.p_uom = units.units_id) OR (mis_prod_entry.mis_type != 'FG' AND components.c_uom = units.units_id) LEFT JOIN master_prod_dprt ON master_prod_dprt.prod_dprt_key = mis_prod_entry.mis_dprt WHERE DATE_FORMAT( mis_prod_entry.mis_date, '%Y-%m-%d' ) BETWEEN :date1 AND :date2 AND mis_prod_entry.mis_code = :mis_code ORDER BY mis_prod_entry.ID DESC",
          {
            replacements: { date1: fromdate, date2: todate, mis_code: req.body.data },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else if (req.body.type == "all") {
        stmt = await invtDB.query(
          "SELECT mis_prod_entry.*, master_prod_dprt.dprt_name, COALESCE(products.p_name, components.c_name) AS name, COALESCE(products.p_sku, components.c_part_no) AS code, units.units_name FROM mis_prod_entry LEFT JOIN products ON mis_prod_entry.mis_type = 'FG' AND mis_prod_entry.mis_code = products.product_key LEFT JOIN components ON mis_prod_entry.mis_type != 'FG' AND mis_prod_entry.mis_code = components.component_key LEFT JOIN units ON (mis_prod_entry.mis_type = 'FG' AND products.p_uom = units.units_id) OR (mis_prod_entry.mis_type != 'FG' AND components.c_uom = units.units_id) LEFT JOIN master_prod_dprt ON master_prod_dprt.prod_dprt_key = mis_prod_entry.mis_dprt WHERE DATE_FORMAT(mis_prod_entry.mis_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 ORDER BY mis_prod_entry.ID DESC",
          {
            replacements: { date1: fromdate, date2: todate },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      }

      for (const item of stmt) {
        const skuData = {
          department: item.dprt_name,
          product: item.name,
          type: item.mis_type,
          sku: item.code,
          unit: item.units_name,
          manPower: item.mis_man_power,
          misShift: item.mis_shift,
          noOfLines: item.mis_line_no,
          output: item.mis_output,
          date: moment(item.mis_date).format("DD-MM-YYYY"),
          shiftStart: item.mis_shift_in,
          shiftEnd: item.mis_shift_end,
          overTm: item.mis_over_time,
          workHrsIn: item.mis_work_hr_in,
          workHrsEnd: item.mis_work_hr_end,
          totalWorkHrs: helper.calculateTotalWorkHrs(item.mis_work_hr_in, item.mis_work_hr_end, '00:00'),
          remark: item.mis_remark,
        };

        data.push(skuData);
      }

      if (data.length == 0) {
        return res.json({ success: false, message: "No Data Found" });
      }

      return res.json({ success: true, data: data, status: "success" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

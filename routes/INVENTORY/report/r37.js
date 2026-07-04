const { invtDB, tallyDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const Validator = require("validatorjs");
const XLSX = require("xlsx");

// Report for job worker inventory by date and part wise.
// router.post("/", [auth.isAuthorized], async (req, res) => {
router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      vendor: "required",
      wise: "required|in:jwid,date",
      data: "required",
    });

    if (valid.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(valid), success: false });
    }

    const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    if (fromdate == "Invalid date" || todate == "Invalid date") {
      return res.json({ message: "Invalid Date", success: false, status: "error" });
    }

    //   const diffDays = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "days");
    //   if (diffDays > 93) {
    //     return res.json({ message: "We can provide you 3 months OR (90 days) data only" });
    //   }

    let mainStmt = await invtDB.query(
      // SELECT * FROM jw_purchase_req WHERE DATE_FORMAT(jw_purchase_req.jw_po_full_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND jw_purchase_req.jw_po_status = 'A' AND jw_po_vendor_reg_id = :vendor ORDER BY jw_purchase_req.jw_po_full_date DESC`,
      `SELECT * FROM jw_purchase_req WHERE jw_po_vendor_reg_id = :vendor AND jw_purchase_req.jw_po_status = 'A'`,
      {
        replacements: { date1: fromdate, date2: todate, vendor: req.body.vendor },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (mainStmt.length == 0) {
      return res.json({ message: "No data found", success: false, status: "error" });
    }

    // GET aLL COMPONENENTS
    // SELECT jw_bom_recipe.*, COALESCE(SUM(jw_bom_recipe.jw_bom_qty),0) as bom_qty, components.c_name, components.c_part_no, units.units_name FROM jw_bom_recipe LEFT JOIN components ON jw_bom_recipe.jw_bom_part = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE jw_bom_recipe.jw_bom_po_trans IN (:jw_id)  GROUP BY jw_bom_recipe.jw_bom_part ORDER BY components.c_part_no ASC
    let stmt_comp = await invtDB.query(
      "SELECT jw_bom_recipe.*, COALESCE(jw_bom_recipe.jw_bom_qty,0) as bom_qty, components.c_name, components.c_part_no, units.units_name FROM jw_bom_recipe LEFT JOIN components ON jw_bom_recipe.jw_bom_part = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE jw_bom_recipe.jw_bom_po_trans IN (:jw_id) GROUP BY jw_bom_recipe.jw_bom_part ORDER BY components.c_part_no ASC",
      {
        replacements: { jw_id: mainStmt.map((item) => item.jw_jw_transaction) },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // const finalData = [];
    // START LOOP
    // for (let i = 0; i < stmt_comp.length; i++) {
    const finalData = stmt_comp.map(async (stmt_comp_item) => {
      // SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `total_issued_rm` FROM `rm_location` WHERE `jw_transaction_id` IN (:transaction_id) AND `components_id` = :component_id AND trans_type = 'JOBWORK' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2
      const stmt_total_iss = await invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `total_issued_rm` FROM `rm_location` WHERE `jw_transaction_id` IN (:transaction_id) AND `components_id` = :component_id AND trans_type = 'JOBWORK' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
        {
          replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt.map((item) => item.jw_jw_transaction), date1: fromdate, date2: todate },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let total_issue_qty = 0;
      if (stmt_total_iss.length > 0) {
        total_issue_qty = stmt_total_iss[0].total_issued_rm;
      }

      const stmt_total_ret = await invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_returned_rm` FROM `rm_location` WHERE `trans_type` = 'TRANSFER' AND `in_jw_transaction_id` IN (:transaction_id) AND `components_id` = :component_id AND trans_mode = 'return' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
        {
          replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt.map((item) => item.jw_jw_transaction), date1: fromdate, date2: todate },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let total_rm_return_qty = 0;
      if (stmt_total_ret.length > 0) {
        total_rm_return_qty = stmt_total_ret[0].total_returned_rm;
      }

      // Total Consumption 1
      const stmt_total_consump = await invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_consumption` FROM `rm_location` WHERE `jw_transaction_id` IN (:transaction_id) AND `components_id` = :component_id AND `trans_type` = 'CONSUMPTION' AND trans_mode = 'default' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
        {
          replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt.map((item) => item.jw_jw_transaction), date1: fromdate, date2: todate },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let total_consumption_value = 0;
      if (stmt_total_consump.length > 0) {
        total_consumption_value = stmt_total_consump[0].total_consumption;
      }

      // Total SFG Consumption 2
      const stmt_total_sfg_consump = await invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_sfg_consumption` FROM `rm_location` WHERE `jw_transaction_id` IN (:transaction_id) AND `components_id` = :component_id AND `trans_type` = 'SFG-CONSUMPTION' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
        {
          replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt.map((item) => item.jw_jw_transaction), date1: fromdate, date2: todate },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let total_sfg_consumption_value = 0;
      if (stmt_total_sfg_consump.length > 0) {
        total_sfg_consumption_value = stmt_total_sfg_consump[0].total_sfg_consumption;
      }

      // //////////////////
      // SELECT COALESCE(SUM(jw_po_order_qty),0) as jw_po_order_qty FROM `jw_purchase_req` WHERE `jw_po_sku` = :skucode AND `jw_jw_transaction` = :jw_id
      // const stmt_jwpo_req2 = await invtDB.query("SELECT COALESCE(SUM(jw_po_order_qty),0) as jw_po_order_qty FROM `jw_purchase_req` WHERE  `jw_jw_transaction` IN (:jw_id)", {
      //   replacements: { jw_id: mainStmt.map((item) => item.jw_jw_transaction) },
      //   type: invtDB.QueryTypes.SELECT,
      // });

      // let jw_order_qty = stmt_jwpo_req2[0].jw_po_order_qty;
      // const sortAccess = helper.number(jw_order_qty * stmt_comp_item.jw_bom_qty - total_issue_qty).toFixed(2);
      // //////////////////

      // //////////////////Closing

      const stmt_total_iss_for_openeing = await invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `total_issued_rm` FROM `rm_location` WHERE `jw_transaction_id` IN (:transaction_id) AND `components_id` = :component_id AND trans_type = 'JOBWORK' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') < :date1",
        {
          replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt.map((item) => item.jw_jw_transaction), date1: fromdate },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let total_issue_qty_for_opening = 0;
      if (stmt_total_iss_for_openeing.length > 0) {
        total_issue_qty_for_opening = stmt_total_iss_for_openeing[0].total_issued_rm;
      }

      const stmt_total_sfg_consump_for_opening = await invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_sf_consumption` FROM `rm_location` WHERE `jw_transaction_id` IN (:transaction_id) AND `components_id` = :component_id AND `trans_type` = 'SFG-CONSUMPTION' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') < :date1",
        {
          replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt.map((item) => item.jw_jw_transaction), date1: fromdate },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let total_sfg_consumption_value_for_opening = 0;
      if (stmt_total_sfg_consump_for_opening.length > 0) {
        total_sfg_consumption_value_for_opening = stmt_total_sfg_consump_for_opening[0].total_sf_consumption;
      }

      const stmt_total_consump_for_opening = await invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_consumption` FROM `rm_location` WHERE `jw_transaction_id` IN (:transaction_id) AND `components_id` = :component_id AND `trans_type` = 'CONSUMPTION' AND trans_mode = 'default' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') < :date1",
        {
          replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt.map((item) => item.jw_jw_transaction), date1: fromdate },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let total_consumption_value_for_opening = 0;
      if (stmt_total_consump_for_opening.length > 0) {
        total_consumption_value_for_opening = stmt_total_consump_for_opening[0].total_consumption;
      }

      const stmt_total_ret_for_opening = await invtDB.query(
        "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_returned_rm` FROM `rm_location` WHERE `trans_type` = 'TRANSFER' AND `in_jw_transaction_id` IN (:transaction_id) AND `components_id` = :component_id AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') < :date1",
        {
          replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt.map((item) => item.jw_jw_transaction), date1: fromdate },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let total_rm_return_qty_for_opening = 0;
      if (stmt_total_ret_for_opening.length > 0) {
        total_rm_return_qty_for_opening = stmt_total_ret_for_opening[0].total_returned_rm;
      }

      // const consump_qty_for_opening = helper.number(
      //   total_consumption_value_for_opening > total_issue_qty_for_opening - total_rm_return_qty_for_opening
      //     ? total_issue_qty_for_opening - total_rm_return_qty_for_opening
      //     : total_consumption_value_for_opening
      // );
      const consump_qty_for_opening = helper.number(total_consumption_value_for_opening);
      const consump_sfg_qty_for_opening = helper.number(total_sfg_consumption_value_for_opening);

      const opening2 = Number(helper.number(total_issue_qty_for_opening - consump_qty_for_opening - consump_sfg_qty_for_opening - total_rm_return_qty_for_opening).toFixed(2));

      // /////////////////Opening

      // const consump_qty = helper.number(total_consumption_value > total_issue_qty - total_rm_return_qty ? total_issue_qty - total_rm_return_qty : total_consumption_value);
      const consump_qty = helper.number(total_consumption_value) + helper.number(total_sfg_consumption_value);

      const inward = Number(helper.number(total_issue_qty).toFixed(2));
      const outward = Number(helper.number(consump_qty + Number(total_rm_return_qty)).toFixed(2));
      // const closing = Number(helper.number(total_issue_qty - consump_qty - total_rm_return_qty).toFixed(2));

      // const opening = closing + outward - inward;
      const closing2 = opening2 + inward - outward;

      // ////////////////// Rate

      // const openingRate = await require("../../../helper/utils/avgRate").getWeightedPurchaseRate_May2026(stmt_comp_item.jw_bom_part);
      const openingRate = await require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(stmt_comp_item.jw_bom_part);

      // const closingRate = await require("../../../helper/utils/avgRate").getWeightedPurchaseRate_May2026(stmt_comp_item.jw_bom_part);
      const closingRate = await require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(stmt_comp_item.jw_bom_part);

      const inwardRate = [];
      const outwardRate = [];

      let fromdate1 = moment(fromdate).format("YYYY-MM-DD");
      const todate1 = moment(todate).format("YYYY-MM-DD");
      while (fromdate1 <= todate1) {
        // const temp = await require("../../../helper/utils/avgRate").getWeightedPurchaseRate_May2026(stmt_comp_item.jw_bom_part);
        const temp = await require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(stmt_comp_item.jw_bom_part);
        inwardRate.push(temp);

        // const temp1 = await require("../../../helper/utils/avgRate").getWeightedPurchaseRate_May2026(stmt_comp_item.jw_bom_part);
        const temp1 = await require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(stmt_comp_item.jw_bom_part);
        outwardRate.push(temp1);

        // console.log(fromdate1, temp, temp1 , "============================");

        fromdate1 = moment(fromdate1).add(1, "days").format("YYYY-MM-DD");
      }

      const avgInward = (inwardRate.reduce((a, b) => Number(a) + Number(b), 0) / inwardRate.length).toFixed(3);
      const avgOutward = (outwardRate.reduce((a, b) => Number(a) + Number(b), 0) / outwardRate.length).toFixed(3);

      // /////////////////////

      return {
        COMPONENT: stmt_comp_item.c_name,
        PART: stmt_comp_item.c_part_no,
        Opening: opening2,
        data: {
          opIssue: total_issue_qty_for_opening,
          opConsump: total_consumption_value_for_opening,
          opSfgConsump: total_sfg_consumption_value_for_opening,
          opReturn: total_rm_return_qty_for_opening,
        },
        // Opening: opening,
        OpeningRate: openingRate,
        OpeningValue: opening2 * openingRate,
        Inward: inward,
        InwardRate: avgInward,
        InwardValue: inward * avgInward,
        Outward: outward,
        OutwardRate: avgOutward,
        OutwardValue: outward * avgOutward,
        // closing: closing,
        closing: closing2,
        closingRate: closingRate,
        closingValue: closing2 * closingRate,
        UNIT: stmt_comp_item.units_name,
      };
    });
    // END LOOP

    const result = await Promise.all(finalData);

    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(result);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const fileName = "r37.xlsx";
    XLSX.writeFile(wb, "./files/excel/" + fileName);

    return res.json({ success: true, data: result, status: "success" });
  } catch (error) {
    console.log(error);
    return helper.errorResponse(res, error);
  }
});

router.post("/allVendor", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      // vendor: "required",
      wise: "required|in:date",
      data: "required",
    });

    if (valid.fails()) {
      return res.json({ success: false, success: "false", message: helper.firstErrorValidatorjs(valid) });
    }

    const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    if (fromdate == "Invalid date" || todate == "Invalid date") {
      return res.json({ message: "Invalid Date", success: false, status: "error" });
    }

    //   const diffDays = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "days");
    //   if (diffDays > 93) {
    //     return res.json({ message: "We can provide you 3 months OR (90 days) data only" });
    //   }

    // const vendorList = ["VEN0495", "VEN0168", "VEN0425"];
    const vendorList = ["VEN0495"];

    const compAvgRate = {};

    const finalData = [];
    for (let v = 0; v < vendorList.length; v++) {
      let mainStmt = await invtDB.query(
        // SELECT * FROM jw_purchase_req WHERE DATE_FORMAT(jw_purchase_req.jw_po_full_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND jw_purchase_req.jw_po_status = 'A' AND jw_po_vendor_reg_id = :vendor ORDER BY jw_purchase_req.jw_po_full_date DESC`,
        `SELECT * FROM jw_purchase_req WHERE jw_po_vendor_reg_id = :vendor AND jw_purchase_req.jw_po_status = 'A' AND jw_jw_transaction = "JWORD/24-25/0400"`,
        {
          replacements: { date1: fromdate, date2: todate, vendor: vendorList[v] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (mainStmt.length == 0) {
        continue;
      }

      // console.log(mainStmt);

      // return;

      // let mainStmt = [
      //   {
      //     jw_jw_transaction: "JWORD/24-25/0400",
      //   },
      // ];

      for (let jwIdIndex = 0; jwIdIndex < mainStmt.length; jwIdIndex++) {
        // GET aLL COMPONENENTS
        // SELECT jw_bom_recipe.*, COALESCE(SUM(jw_bom_recipe.jw_bom_qty),0) as bom_qty, components.c_name, components.c_part_no, units.units_name FROM jw_bom_recipe LEFT JOIN components ON jw_bom_recipe.jw_bom_part = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE jw_bom_recipe.jw_bom_po_trans IN (:jw_id)  GROUP BY jw_bom_recipe.jw_bom_part ORDER BY components.c_part_no ASC
        let stmt_comp = await invtDB.query(
          "SELECT jw_bom_recipe.*, COALESCE(jw_bom_recipe.jw_bom_qty,0) as bom_qty, components.c_name, components.c_part_no, units.units_name FROM jw_bom_recipe LEFT JOIN components ON jw_bom_recipe.jw_bom_part = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE jw_bom_recipe.jw_bom_po_trans = :jw_id  GROUP BY jw_bom_recipe.jw_bom_part ORDER BY components.c_part_no ASC",
          {
            replacements: { jw_id: mainStmt[jwIdIndex].jw_jw_transaction },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        // START LOOP
        // for (let i = 0; i < stmt_comp.length; i++) {
        const jwData = stmt_comp.map(async (stmt_comp_item) => {
          const stmt_total_iss = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `total_issued_rm` FROM `rm_location` WHERE `jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND trans_type = 'JOBWORK' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
            {
              replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt[jwIdIndex].jw_jw_transaction, date1: fromdate, date2: todate },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let total_issue_qty = 0;
          if (stmt_total_iss.length > 0) {
            total_issue_qty = stmt_total_iss[0].total_issued_rm;
          }

          const stmt_total_ret = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_returned_rm` FROM `rm_location` WHERE `trans_type` = 'TRANSFER' AND `in_jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND trans_mode = 'return' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
            {
              replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt[jwIdIndex].jw_jw_transaction, date1: fromdate, date2: todate },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let total_rm_return_qty = 0;
          if (stmt_total_ret.length > 0) {
            total_rm_return_qty = stmt_total_ret[0].total_returned_rm;
          }

          // Total Consumption 2
          const stmt_total_consump = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_consumption` FROM `rm_location` WHERE `jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND `trans_type` = 'CONSUMPTION' AND trans_mode = 'default' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
            {
              replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt[jwIdIndex].jw_jw_transaction, date1: fromdate, date2: todate },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let total_consumption_value = 0;
          if (stmt_total_consump.length > 0) {
            total_consumption_value = stmt_total_consump[0].total_consumption;
          }

          // Total SFG Consumption 2
          const stmt_total_sfg_consump = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_sfg_consumption` FROM `rm_location` WHERE `jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND `trans_type` = 'SFG-CONSUMPTION' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2",
            {
              replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt[jwIdIndex].jw_jw_transaction, date1: fromdate, date2: todate },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let total_sfg_consumption_value = 0;
          if (stmt_total_sfg_consump.length > 0) {
            total_sfg_consumption_value = stmt_total_sfg_consump[0].total_sfg_consumption;
          }

          // //////////////////
          // SELECT COALESCE(SUM(jw_po_order_qty),0) as jw_po_order_qty FROM `jw_purchase_req` WHERE `jw_po_sku` = :skucode AND `jw_jw_transaction` = :jw_id
          // const stmt_jwpo_req2 = await invtDB.query("SELECT COALESCE(SUM(jw_po_order_qty),0) as jw_po_order_qty FROM `jw_purchase_req` WHERE  `jw_jw_transaction` IN (:jw_id)", {
          //   replacements: { jw_id: mainStmt.map((item) => item.jw_jw_transaction) },
          //   type: invtDB.QueryTypes.SELECT,
          // });

          // let jw_order_qty = stmt_jwpo_req2[0].jw_po_order_qty;
          // const sortAccess = helper.number(jw_order_qty * stmt_comp_item.jw_bom_qty - total_issue_qty).toFixed(2);
          // //////////////////

          // //////////////////Closing

          const stmt_total_iss_for_openeing = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `total_issued_rm` FROM `rm_location` WHERE `jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND trans_type = 'JOBWORK' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') < :date1",
            {
              replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt[jwIdIndex].jw_jw_transaction, date1: fromdate },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let total_issue_qty_for_opening = 0;
          if (stmt_total_iss_for_openeing.length > 0) {
            total_issue_qty_for_opening = stmt_total_iss_for_openeing[0].total_issued_rm;
          }

          const stmt_total_sfg_consump_for_opening = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_sf_consumption` FROM `rm_location` WHERE `jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND `trans_type` = 'SFG-CONSUMPTION' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') < :date1",
            {
              replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt[jwIdIndex].jw_jw_transaction, date1: fromdate },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let total_sfg_consumption_value_for_opening = 0;
          if (stmt_total_sfg_consump_for_opening.length > 0) {
            total_sfg_consumption_value_for_opening = stmt_total_sfg_consump_for_opening[0].total_sf_consumption;
          }

          const stmt_total_consump_for_opening = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_consumption` FROM `rm_location` WHERE `jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND `trans_type` = 'CONSUMPTION' AND trans_mode = 'default' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') < :date1",
            {
              replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt[jwIdIndex].jw_jw_transaction, date1: fromdate },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let total_consumption_value_for_opening = 0;
          if (stmt_total_consump_for_opening.length > 0) {
            total_consumption_value_for_opening = stmt_total_consump_for_opening[0].total_consumption;
          }

          const stmt_total_ret_for_opening = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_returned_rm` FROM `rm_location` WHERE `trans_type` = 'TRANSFER' AND `in_jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND trans_mode = 'return' AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') < :date1",
            {
              replacements: { component_id: stmt_comp_item.jw_bom_part, transaction_id: mainStmt[jwIdIndex].jw_jw_transaction, date1: fromdate },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let total_rm_return_qty_for_opening = 0;
          if (stmt_total_ret_for_opening.length > 0) {
            total_rm_return_qty_for_opening = stmt_total_ret_for_opening[0].total_returned_rm;
          }

          // const consump_qty_for_opening = helper.number(
          //   total_consumption_value_for_opening > total_issue_qty_for_opening - total_rm_return_qty_for_opening
          //     ? total_issue_qty_for_opening - total_rm_return_qty_for_opening
          //     : total_consumption_value_for_opening
          // );
          const consump_qty_for_opening = helper.number(total_consumption_value_for_opening);
          const consump_sfg_qty_for_opening = helper.number(total_sfg_consumption_value_for_opening);


          const opening2 = Number(helper.number(total_issue_qty_for_opening - consump_qty_for_opening - consump_sfg_qty_for_opening - total_rm_return_qty_for_opening).toFixed(2));

          // /////////////////Opening

          // const consump_qty = helper.number(total_consumption_value > total_issue_qty - total_rm_return_qty ? total_issue_qty - total_rm_return_qty : total_consumption_value);
          const consump_qty = helper.number(total_consumption_value) + helper.number(total_sfg_consumption_value);

          const inward = Number(helper.number(total_issue_qty).toFixed(2));
          const outward = Number(helper.number(consump_qty + Number(total_rm_return_qty)).toFixed(2));
          // const closing = Number(helper.number(total_issue_qty - consump_qty - total_rm_return_qty).toFixed(2));

          // const opening = closing + outward - inward;
          const closing2 = opening2 + inward - outward;

          // ////////////////// Rate

          let avgInward = 0;
          let avgOutward = 0;
          let openingRate = 0;
          let closingRate = 0;

          if (compAvgRate[stmt_comp_item.jw_bom_part]) {
            avgInward = compAvgRate[stmt_comp_item.jw_bom_part].avgInward;
            avgOutward = compAvgRate[stmt_comp_item.jw_bom_part].avgOutward;
            openingRate = compAvgRate[stmt_comp_item.jw_bom_part].openingRate;
            closingRate = compAvgRate[stmt_comp_item.jw_bom_part].closingRate;
          } else {
            // openingRate = await require("../../../helper/utils/avgRate").getWeightedPurchaseRate_May2026(stmt_comp_item.jw_bom_part);
            openingRate = await require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(stmt_comp_item.jw_bom_part);

            // closingRate = await require("../../../helper/utils/avgRate").getWeightedPurchaseRate_May2026(stmt_comp_item.jw_bom_part);
            closingRate = await require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(stmt_comp_item.jw_bom_part);

            const inwardRate = [];
            const outwardRate = [];

            let fromdate1 = moment(fromdate).format("YYYY-MM-DD");
            const todate1 = moment(todate).format("YYYY-MM-DD");
            while (fromdate1 <= todate1) {
              // const temp = await require("../../../helper/utils/avgRate").getWeightedPurchaseRate_May2026(stmt_comp_item.jw_bom_part);
              const temp = await require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(stmt_comp_item.jw_bom_part);
              inwardRate.push(temp);

              // const temp1 = await require("../../../helper/utils/avgRate").getWeightedPurchaseRate_May2026(stmt_comp_item.jw_bom_part);
              const temp1 = await require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(stmt_comp_item.jw_bom_part);
              outwardRate.push(temp1);

              // console.log(fromdate1, temp, temp1 , "============================");

              fromdate1 = moment(fromdate1).add(1, "days").format("YYYY-MM-DD");
            }

            avgInward = (inwardRate.reduce((a, b) => Number(a) + Number(b), 0) / inwardRate.length).toFixed(3);
            avgOutward = (outwardRate.reduce((a, b) => Number(a) + Number(b), 0) / outwardRate.length).toFixed(3);

            compAvgRate[stmt_comp_item.jw_bom_part] = {
              jw_bom_part: stmt_comp_item.jw_bom_part,
              avgInward: avgInward,
              avgOutward: avgOutward,
              openingRate: openingRate,
              closingRate: closingRate,
            };
          }

          // console.log(compAvgRate);

          // /////////////////////

          return {
            COMPONENT: stmt_comp_item.c_name,
            PART: stmt_comp_item.c_part_no,
            VENDOR: vendorList[v],
            VendorName: "",
            JWId: mainStmt[jwIdIndex].jw_jw_transaction,
            Opening: opening2,
            OpeningRate: openingRate,
            OpeningValue: opening2 * openingRate,
            Inward: inward,
            InwardRate: avgInward,
            InwardValue: inward * avgInward,
            Outward: outward,
            OutwardRate: avgOutward,
            OutwardValue: outward * avgOutward,
            closing: closing2,
            closingRate: closingRate,
            closingValue: closing2 * closingRate,
            UNIT: stmt_comp_item.units_name,
          };
        });
        const result = await Promise.all(jwData);
        finalData.push(...result);
      }
    }
    // END LOOP

    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(finalData);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const fileName = "r37.xlsx";
    XLSX.writeFile(wb, "./files/excel/" + fileName);

    return res.json({ success: true, data: finalData, status: "success" });
  } catch (error) {
    console.log(error);
    return helper.errorResponse(res, error);
  }
});

module.exports = router;
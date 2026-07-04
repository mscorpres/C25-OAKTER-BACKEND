const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const Validator = require("validatorjs");

router.get("/editPl", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt_masters = await tallyDB.query("SELECT `tally_pl_report`.* ,`tally_group`.*  FROM `tally_pl_report`  `tally_pl_report` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_pl_report`.`pl_mgroup` WHERE `parent_id` = '--' ", {
      type: tallyDB.QueryTypes.SELECT,
    });

    let master = [];

    // MASTER
    for (let m = 0; m < stmt_masters.length; m++) {
      let stmt_sub = await tallyDB.query("SELECT `tally_pl_report`.* ,`tally_group`.*  FROM `tally_pl_report` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_pl_report`.`pl_mgroup`  WHERE `parent_id` = :parent", {
        replacements: { parent: stmt_masters[m].pl_mgroup_key },
        type: tallyDB.QueryTypes.SELECT,
      });

      let sub_group = [];
      if (stmt_sub.length > 0) {
        // MASTER SUB GROUPS
        for (let m_subi = 0; m_subi < stmt_sub.length; m_subi++) {
          let sub_sub_group = [];
          if (stmt_sub[m_subi].pl_subgroups) {
            let sub_sub_group_key = stmt_sub[m_subi].pl_subgroups.split(",");

            for (let j = 0; j < sub_sub_group_key.length; j++) {
              let stmt_sub_sub = await tallyDB.query("SELECT `code` , `group_name` , `group_key` , `parent` FROM `tally_group` WHERE `group_key` = :key ", {
                replacements: { key: sub_sub_group_key[j] },
                type: tallyDB.QueryTypes.SELECT,
              });

              sub_sub_group.push({
                label: `(${stmt_sub_sub[0].code}) ${stmt_sub_sub[0].group_name}`,
                value: stmt_sub_sub[0].group_key,
              });
            } // SUB SUB GROUP
          }
          sub_group.push({
            name: `${stmt_sub[m_subi].group_name}`,
            code: stmt_sub[m_subi].code,
            key: stmt_sub[m_subi].group_key,
            type: "Group",
            children: sub_sub_group,
            note: stmt_sub[m_subi].note,
          });
        } //Master Sub Group
      }
      master.push({
        name: stmt_masters[m].group_name,
        type: "Master",
        code: stmt_masters[m].code,
        key: stmt_masters[m].code,
        children: sub_group,
      });
    } //Master Loop

    return res.json({ status: "success", success: true, data: master });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

router.post("/updatePlReport", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      group_code: "required",
    });

    if (validation.fails()) {
      res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }

    if (req.body.subgroups.length <= 0) {
      return res.json({ status: "error", success: false, message: "Select atleast one subgroup" });
    }

    let stmt = await tallyDB.query("UPDATE `tally_pl_report` SET `pl_subgroups`= :subgroups, `update_dt`= :update_dt, `update_by`= :update_by, `pl_note` =:pl_note WHERE `pl_mgroup` = :pl_mgroup", {
      replacements: {
        subgroups: req.body.subgroups.join(","),
        pl_mgroup: req.body.group_code,
        pl_note: req.body.note,
        update_dt: moment(new Date()).tz("Asia/kolkata").format("YYYY-MM-DD"),
        update_by: req.logedINUser,
      },
      type: tallyDB.QueryTypes.UPDATE,
    });

    if (stmt.length > 0) {
      return res.json({ status: "success", success: true, message: " successfully data update" });
    } else {
      return res.json({ status: "error", success: false, message: "something wrong!!!  Please Try Again" });
    }
  } catch (e) {
      return helper.errorResponse(res, e);
  }
});

router.post("/plReport", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      date: "required",
    });

    if (validation.fails()) {
      return res.json({

        status: "error", success: false,
        message: validation.errors.all(),
      });
    }

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdt = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todt = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");


    // EXPENSES MASTER
    let stmt_expenses = await tallyDB.query("SELECT `tally_pl_report`.* ,`tally_group`.*  FROM `tally_pl_report`  `tally_pl_report` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_pl_report`.`pl_mgroup` WHERE `parent_id` = '--' AND `pl_mgroup`= :key", {
      replacements: { key: "TP20220215211029" },
      type: tallyDB.QueryTypes.SELECT,
    });
    let expenses_master = [];
    for (let m = 0; m < stmt_expenses.length; m++) {
      let stmt_sub = await tallyDB.query("SELECT `tally_pl_report`.* ,`tally_group`.*  FROM `tally_pl_report` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_pl_report`.`pl_mgroup`  WHERE `parent_id` = :parent", {
        replacements: { parent: stmt_expenses[m].pl_mgroup_key },
        type: tallyDB.QueryTypes.SELECT,
      });

      let sub_group = [];
      let total_m_credit = 0;
      let total_m_debit = 0;
      let total_m_opening = 0;
      let total_m_closing = 0;
      if (stmt_sub.length > 0) {
        // MASTER SUB GROUPS
        for (let m_subi = 0; m_subi < stmt_sub.length; m_subi++) {
          let sub_sub_group = [];
          let total_sub_credit = 0;
          let total_sub_debit = 0;
          let total_sub_opening = 0;
          let total_sub_closing = 0;
          if (stmt_sub[m_subi].pl_subgroups) {
            let sub_sub_group_key = stmt_sub[m_subi].pl_subgroups.split(",");


            for (let j = 0; j < sub_sub_group_key.length; j++) {
              let stmt_sub_sub = await tallyDB.query("SELECT `code` , `group_name` , `group_key` , `parent` FROM `tally_group` WHERE `group_key` = :key ", {
                replacements: { key: sub_sub_group_key[j] },
                type: tallyDB.QueryTypes.SELECT,
              });

              let stmt_ledgers = await tallyDB.query("SELECT `code` , `ledger_key`, `ladger_name`, `sub_group_key` FROM `tally_ledger` WHERE `sub_group_key` = :key ", {
                replacements: { key: sub_sub_group_key[j] },
                type: tallyDB.QueryTypes.SELECT,
              });
              let legers = [];
              let total_ledger_credit = 0;
              let total_ledger_debit = 0;
              let total_ledger_opening = 0;
              let total_ledger_closing = 0;
              for (let l = 0; l < stmt_ledgers.length; l++) {
                let ledger_item = stmt_ledgers[l];
                let ledger_stmt = await tallyDB.query("SELECT `code` , `ledger_key`, `ladger_name`, `sub_group_key` FROM `tally_ledger` WHERE `ledger_key` = :key ", {
                  replacements: { key: ledger_item.ledger_key },
                  type: tallyDB.QueryTypes.SELECT,
                });
                //
                let cal_stmt = await tallyDB.query("SELECT SUM(debit) as sum_debit , SUM(credit) as sum_credit FROM `tally_ledger_data` WHERE (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) AND `ladger_key`= :ladger_key ", {
                  replacements: {
                    date1: fromdt,
                    date2: todt,
                    ladger_key: ledger_item.ledger_key,
                  },
                  type: tallyDB.QueryTypes.SELECT,
                });

                let stmt_op_debit_credit = await tallyDB.query("SELECT COALESCE(SUM(`tally_ledger_data`.`debit`),0) AS total_debit, COALESCE(SUM(`tally_ledger_data`.`credit`),0) AS total_credit FROM `tally_ledger_data` WHERE (`tally_ledger_data`.`ladger_key`= :ladger_key) AND (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') < :date1 )", {
                  replacements: {
                    date1: fromdt,
                    date2: todt,
                    ladger_key: ledger_item.ledger_key,
                  },
                  type: tallyDB.QueryTypes.SELECT,
                });

                let opening_ledger = 0;
                if (stmt_op_debit_credit.length > 0) {
                  opening_ledger = Number(stmt_op_debit_credit[0].total_debit) - Number(stmt_op_debit_credit[0].total_credit);
                }
                // let closing = Number(Number(opening_ledger) + Number(cal_stmt[0].sum_debit ?? 0) - Number(cal_stmt[0].sum_credit ?? 0)).toFixed(2);
                let closing = Number(Number(cal_stmt[0].sum_debit ?? 0) - Number(cal_stmt[0].sum_credit ?? 0)).toFixed(2);
                legers.push({
                  code: ledger_stmt[0].code,
                  key: ledger_stmt[0].code,
                  sub_groupKey: ledger_stmt[0].sub_group_key,
                  name: decode(ledger_stmt[0].ladger_name),
                  opening: Number(opening_ledger.toFixed(2) ?? 0).toLocaleString("en-IN"),
                  debit: Number(cal_stmt[0].sum_debit ?? 0).toLocaleString("en-IN"),
                  credit: Number(cal_stmt[0].sum_credit ?? 0).toLocaleString("en-IN"),
                  closing: Number(closing).toLocaleString("en-IN"),
                  type: "ledger",
                });

                total_ledger_opening += Number(Number(opening_ledger).toFixed(2)) ?? 0;
                total_ledger_debit += Number(cal_stmt[0].sum_debit ?? 0);
                total_ledger_credit += Number(cal_stmt[0].sum_credit ?? 0);
                total_ledger_closing += Number(closing);
              } // LEDGER LOOP
              // }); // LEDGER LOOP

              sub_sub_group.push({
                name: stmt_sub_sub[0].group_name,
                code: stmt_sub_sub[0].code,
                key: stmt_sub_sub[0].code,
                type: "Sub Group",
                opening: total_ledger_opening.toLocaleString("en-IN"),
                debit: total_ledger_debit.toLocaleString("en-IN"),
                credit: total_ledger_credit.toLocaleString("en-IN"),
                closing: total_ledger_closing.toLocaleString("en-IN"),
                children: legers,
              });

              total_sub_credit += total_ledger_opening;
              total_sub_debit += total_ledger_debit;
              total_sub_opening += total_ledger_credit;
              total_sub_closing += total_ledger_closing;
            } // SUB SUB GROUP
          }

          sub_group.push({
            name: stmt_sub[m_subi].group_name,
            key: stmt_sub[m_subi].code,
            code: stmt_sub[m_subi].code,
            opening: total_sub_opening.toLocaleString("en-IN"),
            type: "Group",
            debit: total_sub_debit.toLocaleString("en-IN"),
            credit: total_sub_credit.toLocaleString("en-IN"),
            closing: total_sub_closing.toLocaleString("en-IN"),
            children: sub_sub_group,
          });
          total_m_opening += Number(total_sub_opening);
          total_m_debit += Number(total_sub_debit);
          total_m_credit += Number(total_sub_credit);
          total_m_closing += Number(total_sub_closing);
        } //Master Sub Group
      }
      expenses_master.push({
        name: stmt_expenses[m].group_name,
        type: "Master",
        code: stmt_expenses[m].code,
        key: stmt_expenses[m].code,
        opening: total_m_opening.toLocaleString("en-IN"),
        debit: total_m_debit.toLocaleString("en-IN"),
        credit: total_m_credit.toLocaleString("en-IN"),
        closing: total_m_closing.toLocaleString("en-IN"),
        closingBalanceFigure: total_m_closing,
        children: sub_group,
      });
    } // EXPENSES Master

    // Income MASTER
    let stmt_income = await tallyDB.query("SELECT `tally_pl_report`.* ,`tally_group`.*  FROM `tally_pl_report`  `tally_pl_report` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_pl_report`.`pl_mgroup` WHERE `parent_id` = '--'  AND `pl_mgroup`= :key", {
      replacements: { key: "TP20220215211016" },
      type: tallyDB.QueryTypes.SELECT,
    });
    let income_master = [];
    for (let m = 0; m < stmt_income.length; m++) {
      let stmt_sub = await tallyDB.query("SELECT `tally_pl_report`.* ,`tally_group`.*  FROM `tally_pl_report` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_pl_report`.`pl_mgroup`  WHERE `parent_id` = :parent", {
        replacements: { parent: stmt_income[m].pl_mgroup_key },
        type: tallyDB.QueryTypes.SELECT,
      });

      let sub_group = [];
      let total_m_credit = 0;
      let total_m_debit = 0;
      let total_m_opening = 0;
      let total_m_closing = 0;
      if (stmt_sub.length > 0) {
        // MASTER SUB GROUPS
        for (let m_subi = 0; m_subi < stmt_sub.length; m_subi++) {
          let sub_sub_group = [];
          let total_sub_credit = 0;
          let total_sub_debit = 0;
          let total_sub_opening = 0;
          let total_sub_closing = 0;
          if (stmt_sub[m_subi].pl_subgroups) {
            let sub_sub_group_key = stmt_sub[m_subi].pl_subgroups.split(",");

            for (let j = 0; j < sub_sub_group_key.length; j++) {
              let stmt_sub_sub = await tallyDB.query("SELECT `code` , `group_name` , `group_key` , `parent` FROM `tally_group` WHERE `group_key` = :key ", {
                replacements: { key: sub_sub_group_key[j] },
                type: tallyDB.QueryTypes.SELECT,
              });

              let stmt_ledgers = await tallyDB.query("SELECT `code` , `ledger_key`, `ladger_name`, `sub_group_key` FROM `tally_ledger` WHERE `sub_group_key` = :key ", {
                replacements: { key: sub_sub_group_key[j] },
                type: tallyDB.QueryTypes.SELECT,
              });
              let legers = [];
              let total_ledger_credit = 0;
              let total_ledger_debit = 0;
              let total_ledger_opening = 0;
              let total_ledger_closing = 0;
              for (let l = 0; l < stmt_ledgers.length; l++) {
                let ledger_stmt = await tallyDB.query("SELECT `code` , `ledger_key`, `ladger_name`, `sub_group_key` FROM `tally_ledger` WHERE `ledger_key` = :key ", {
                  replacements: { key: stmt_ledgers[l].ledger_key },
                  type: tallyDB.QueryTypes.SELECT,
                });
                //
                let cal_stmt = await tallyDB.query("SELECT SUM(debit) as sum_debit , SUM(credit) as sum_credit FROM `tally_ledger_data` WHERE (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) AND `ladger_key`= :ladger_key ", {
                  replacements: {
                    date1: fromdt,
                    date2: todt,
                    ladger_key: stmt_ledgers[l].ledger_key,
                  },
                  type: tallyDB.QueryTypes.SELECT,
                });

                let stmt_op_debit_credit = await tallyDB.query("SELECT COALESCE(SUM(`tally_ledger_data`.`debit`),0) AS total_debit, COALESCE(SUM(`tally_ledger_data`.`credit`),0) AS total_credit FROM `tally_ledger_data` WHERE (`tally_ledger_data`.`ladger_key`= :ladger_key) AND (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') < :date1 )", {
                  replacements: {
                    date1: fromdt,
                    date2: todt,
                    ladger_key: stmt_ledgers[l].ledger_key,
                  },
                  type: tallyDB.QueryTypes.SELECT,
                });

                let opening_ledger = 0;
                if (stmt_op_debit_credit.length > 0) {
                  opening_ledger = Number(stmt_op_debit_credit[0].total_debit) - Number(stmt_op_debit_credit[0].total_credit);
                }
                // let closing = Number(Number(opening_ledger) + Number(cal_stmt[0].sum_debit ?? 0) - Number(cal_stmt[0].sum_credit ?? 0)).toFixed(2);
                let closing = Number(Number(cal_stmt[0].sum_debit ?? 0) - Number(cal_stmt[0].sum_credit ?? 0)).toFixed(2);

                legers.push({
                  code: ledger_stmt[0].code,
                  key: ledger_stmt[0].code,
                  sub_groupKey: ledger_stmt[0].sub_group_key,
                  name: decode(ledger_stmt[0].ladger_name),
                  opening: Number(opening_ledger).toFixed(2).toLocaleString("en-IN") ?? 0,
                  debit: Number(cal_stmt[0].sum_debit ?? 0).toLocaleString("en-IN"),
                  credit: Number(cal_stmt[0].sum_credit ?? 0).toLocaleString("en-IN"),
                  closing: Number(closing).toLocaleString("en-IN"),
                  type: "ledger",
                });
                total_ledger_opening += Number(Number(opening_ledger).toFixed(2)) ?? 0;
                total_ledger_debit += Number(cal_stmt[0].sum_debit ?? 0);
                total_ledger_credit += Number(cal_stmt[0].sum_credit ?? 0);
                total_ledger_closing += Number(closing);
              } // LEDGER LOOP


              sub_sub_group.push({
                name: stmt_sub_sub[0].group_name,
                code: stmt_sub_sub[0].code,
                key: stmt_sub_sub[0].code,
                type: "Sub Group",
                opening: total_ledger_opening.toLocaleString("en-IN"),
                debit: total_ledger_debit.toLocaleString("en-IN"),
                credit: total_ledger_credit.toLocaleString("en-IN"),
                closing: total_ledger_closing.toLocaleString("en-IN"),
                children: legers,
              });
              total_sub_credit += total_ledger_opening;
              total_sub_debit += total_ledger_debit;
              total_sub_opening += total_ledger_credit;
              total_sub_closing += total_ledger_closing;
            } // SUB SUB GROUP
          }

          sub_group.push({
            name: stmt_sub[m_subi].group_name,
            key: stmt_sub[m_subi].code,
            code: stmt_sub[m_subi].code,
            opening: total_sub_opening.toLocaleString("en-IN"),
            type: "Group",
            debit: total_sub_debit.toLocaleString("en-IN"),
            credit: total_sub_credit.toLocaleString("en-IN"),
            closing: total_sub_closing.toLocaleString("en-IN"),
            children: sub_sub_group,
          });
          total_m_opening += Number(total_sub_opening);
          total_m_debit += Number(total_sub_debit);
          total_m_credit += Number(total_sub_credit);
          total_m_closing += Number(total_sub_closing);
        } //Master Sub Group
      }

      income_master.push({
        name: stmt_income[m].group_name,
        type: "Master",
        code: stmt_income[m].code,
        key: stmt_income[m].code,
        opening: total_m_opening.toLocaleString("en-IN"),
        debit: total_m_debit.toLocaleString("en-IN"),
        credit: total_m_credit.toLocaleString("en-IN"),
        closing: total_m_closing.toLocaleString("en-IN"),
        closingIncomeFigure: total_m_closing,
        children: sub_group,
      });
    } // Income Master Loop

    let data = {
      expenses_master: expenses_master,
      income_master: income_master,
      balanace_fig: (income_master[0].closingIncomeFigure - expenses_master[0].closingBalanceFigure).toLocaleString("en-IN"),
    };
    return res.json({ status: "success", success: true, data: data });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

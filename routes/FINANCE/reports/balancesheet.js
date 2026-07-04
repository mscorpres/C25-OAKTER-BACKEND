const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const Validator = require("validatorjs");

// FETCH FOR UPDATE
router.get("/editBalancesheet", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt_masters = await tallyDB.query("SELECT `tally_balancesheet_m`.* ,`tally_group`.*  FROM `tally_balancesheet_m`  `tally_balancesheet_m` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_balancesheet_m`.`bs_mgroup` WHERE `parent_id` = '--' ", {
      type: tallyDB.QueryTypes.SELECT,
    });

    let master = [];

    // MASTER
    for (let m = 0; m < stmt_masters.length; m++) {
      let stmt_sub = await tallyDB.query("SELECT `tally_balancesheet_m`.* ,`tally_group`.*  FROM `tally_balancesheet_m` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_balancesheet_m`.`bs_mgroup`  WHERE `parent_id` = :parent", {
        replacements: { parent: stmt_masters[m].bs_mgroup_key },
        type: tallyDB.QueryTypes.SELECT,
      });

      let sub_group = [];
      if (stmt_sub.length > 0) {
        // MASTER SUB GROUPS
        for (let m_subi = 0; m_subi < stmt_sub.length; m_subi++) {
          let sub_sub_group = [];
          if (stmt_sub[m_subi].bs_subgroups) {
            let sub_sub_group_key = stmt_sub[m_subi].bs_subgroups.split(",");

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

//UPDATE BALANCESHEET
router.post("/updateBalancesheet", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      group_code: "required",
    });

    if (validation.fails()) {
      res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }

    if (req.body.subgroups.length <= 0) {
      return res.json({ status: "error", success: false, message: "Select atleast one Subgroup" });
    }

    let stmt = await tallyDB.query("UPDATE `tally_balancesheet_m` SET `bs_subgroups` =:subgroups , `update_dt` = :update_dt , `update_by` = :update_by , `note` = :note WHERE `bs_mgroup` = :bs_mgroup", {
      replacements: {
        subgroups: req.body.subgroups.join(","),
        bs_mgroup: req.body.group_code,
        note: req.body.note,
        update_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD"),
        update_by: req.logedINUser,
      },
      type: tallyDB.QueryTypes.UPDATE,
    });

    if (stmt.length > 0) {
      return res.json({ status: "success", success: true, message: "successfully data update" });
    } else {
      return res.json({ status: "error", success: false, message: "Something wrong!!! Please Try again!!!" });
    }
  } catch (e) {
      return helper.errorResponse(res, e);
  }
});

//INSERT BALANCESHEET
router.post("/addBalanceSheet", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      sub_group: "required",
      parent: "required",
    });

    let arr1 = req.body.bs_subgroups;
    let parid = req.body.parent;
    if (parid.length > 0) {
      let stmt = await tallyDB.query("INSERT INTO `tally_blancesheet_m`(`name`,`bs_mgroup`, `bs_mgroup_key`,`bs_subgroups`,`parent_id`,`insert_dt`,`insert_by`)VALUES(:name, :bs_mgroup, :bs_mgroup_key, :bs_subgroups, :parent_id, :insert_dt, :insert_by)", {
        replacements: {
          name: req.body.name,
          bs_mgroup: req.body.sub_group,
          bs_mgroup_key: helper.getUniqueNumber(),
          bs_subgroups: arr1.join(","), // req.body.bs_subgroups,
          parent_id: req.body.parent,
          insert_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD"),
          insert_by: req.logedINUser,
        },
        type: tallyDB.QueryTypes.INSERT,
      });
      if (stmt.length > 0) {
        return res.json({ status: "success", success: true, message: "data save successfully" });
      }
    }
  } catch (e) {
      return helper.errorResponse(res, e);
  }
});

// REPORT
router.post("/balanceSheet", [auth.isAuthorized], async (req, res) => {
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

    let stmt_masters = await tallyDB.query("SELECT `tally_balancesheet_m`.* ,`tally_group`.*  FROM `tally_balancesheet_m`  `tally_balancesheet_m` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_balancesheet_m`.`bs_mgroup` WHERE `parent_id` = '--' ", {
      type: tallyDB.QueryTypes.SELECT,
    });

    let master = [];

    // MASTER
    for (let m = 0; m < stmt_masters.length; m++) {
      let stmt_sub = await tallyDB.query("SELECT `tally_balancesheet_m`.* ,`tally_group`.*  FROM `tally_balancesheet_m` LEFT JOIN `tally_group` ON `tally_group`.`group_key` =`tally_balancesheet_m`.`bs_mgroup`  WHERE `parent_id` = :parent", {
        replacements: { parent: stmt_masters[m].bs_mgroup_key },
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
          if (stmt_sub[m_subi].bs_subgroups) {
            let sub_sub_group_key = stmt_sub[m_subi].bs_subgroups.split(",");

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
                let closing = Number(Number(opening_ledger) + Number(cal_stmt[0].sum_debit ?? 0) - Number(cal_stmt[0].sum_credit ?? 0)).toFixed(2);

                if (Number(closing) != 0) {
                  legers.push({
                    code: ledger_stmt[0].code,
                    key: ledger_stmt[0].code,
                    sub_groupKey: ledger_stmt[0].sub_group_key,
                    name: decode(ledger_stmt[0].ladger_name),
                    opening: Number(opening_ledger).toFixed(2) ?? 0,
                    debit: Number(cal_stmt[0].sum_debit ?? 0),
                    credit: Number(cal_stmt[0].sum_credit ?? 0),
                    closing: Number(closing).toLocaleString("en-IN"),
                    type: "ledger",
                  });
                  total_ledger_opening += Number(Number(opening_ledger).toFixed(2)) ?? 0;
                  total_ledger_debit += Number(cal_stmt[0].sum_debit ?? 0);
                  total_ledger_credit += Number(cal_stmt[0].sum_credit ?? 0);
                  total_ledger_closing += Number(closing);
                }
              } // LEDGER LOOP

              let sort_ledger = legers.sort(function (a, b) {
                return a.code - b.code;
              });

              sub_sub_group.push({
                name: stmt_sub_sub[0].group_name,
                code: stmt_sub_sub[0].code,
                key: stmt_sub_sub[0].code,
                type: "Sub Group",
                opening: total_ledger_opening.toLocaleString("en-IN"),
                debit: total_ledger_debit.toLocaleString("en-IN"),
                credit: total_ledger_credit.toLocaleString("en-IN"),
                closing: total_ledger_closing.toLocaleString("en-IN"),
                children: sort_ledger,
              });

              total_sub_credit += total_ledger_opening;
              total_sub_debit += total_ledger_debit;
              total_sub_opening += total_ledger_credit;
              total_sub_closing += total_ledger_closing;
            } // SUB SUB GROUP
          }

          let sort_sub_sub_group = sub_sub_group.sort(function (a, b) {
            return a.code - b.code;
          });

          sub_group.push({
            name: stmt_sub[m_subi].group_name,
            key: stmt_sub[m_subi].code,
            code: stmt_sub[m_subi].code,
            opening: total_sub_opening.toLocaleString("en-IN"),
            type: "Group",
            debit: total_sub_debit.toLocaleString("en-IN"),
            credit: total_sub_credit.toLocaleString("en-IN"),
            closing: total_sub_closing.toLocaleString("en-IN"),
            children: sort_sub_sub_group,
          });
          total_m_opening += Number(total_sub_opening);
          total_m_debit += Number(total_sub_debit);
          total_m_credit += Number(total_sub_credit);
          total_m_closing += Number(total_sub_closing);
        } //Master Sub Group
      }

      let sort_sub_group = sub_group.sort(function (a, b) {
        return a.code - b.code;
      });

      master.push({
        name: stmt_masters[m].group_name,
        type: "Master",
        code: stmt_masters[m].code,
        key: stmt_masters[m].code,
        opening: total_m_opening.toLocaleString("en-IN"),
        debit: total_m_debit.toLocaleString("en-IN"),
        credit: total_m_credit.toLocaleString("en-IN"),
        closing: total_m_closing.toLocaleString("en-IN"),
        children: sort_sub_group,
      });
    } //Master Loop

    return res.json({ status: "success", success: true, data: master });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

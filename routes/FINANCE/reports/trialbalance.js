const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const Validator = require("validatorjs");

router.post("/trailBalanaceReport", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      date: "required",
    });

    if (validation.fails()) {
      return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdt = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todt = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    let ledger_stmt = await tallyDB.query("SELECT code , ledger_key,ladger_name,sub_group_key FROM `tally_ledger`", {
      type: tallyDB.QueryTypes.SELECT,
    });

    let ledger_row_data = [];

    if (ledger_stmt.length > 0) {
      let count = 0;

      // GET DEBIT CREDIT
      ledger_stmt.map(async (ledger_rows) => {
        let cal_stmt = await tallyDB.query("SELECT SUM(debit) as sum_debit , SUM(credit) as sum_credit FROM `tally_ledger_data` WHERE (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) AND `ladger_key`= :ladger_key ", {
          replacements: { date1: fromdt, date2: todt, ladger_key: ledger_rows.ledger_key },
          type: tallyDB.QueryTypes.SELECT,
        });

        let stmt_op_debit_credit = await tallyDB.query("SELECT COALESCE(SUM(`tally_ledger_data`.`debit`),0) AS total_debit, COALESCE(SUM(`tally_ledger_data`.`credit`),0) AS total_credit FROM `tally_ledger_data` WHERE (`tally_ledger_data`.`ladger_key`= :ladger_key) AND (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') < :date1 )", {
          replacements: { date1: fromdt, date2: todt, ladger_key: ledger_rows.ledger_key },
          type: tallyDB.QueryTypes.SELECT,
        });

        let opening_ledger = 0;
        if (stmt_op_debit_credit.length > 0) {
          opening_ledger = Number(stmt_op_debit_credit[0].total_debit) - Number(stmt_op_debit_credit[0].total_credit);
        }

        if (cal_stmt.length > 0) {
          let closing = Number(Number(opening_ledger) + Number(cal_stmt[0].sum_debit ?? 0) - Number(cal_stmt[0].sum_credit ?? 0)).toFixed(2);

          ledger_row_data.push({
            code: Number(ledger_rows.code),
            sub_groupKey: ledger_rows.sub_group_key,
            label: decode(ledger_rows.ladger_name),
            opening: Number(Number(opening_ledger).toFixed(2)).toLocaleString("en-IN") ?? 0,
            debit: closing < 0 ? 0 : Number(closing).toLocaleString("en-IN"),
            credit: closing < 0 ? Math.abs(closing).toLocaleString("en-IN") : 0,
            debitForCalculation: closing < 0 ? 0 : closing,
            creditForCalculation: closing < 0 ? Math.abs(closing) : 0,
            closing: Number(closing).toLocaleString("en-IN"),
          });
        }
        count++;
        if (count == ledger_stmt.length) {
          // GET ALL GROUP
          let stmt = await tallyDB.query("SELECT code , group_name , group_key , parent FROM `tally_group`", {
            type: tallyDB.QueryTypes.SELECT,
          });

          if (stmt.length > 0) {
            tree = (function (data, root) {
              var t = {};

              // ORDER BY Ledger CODE
              ledger_row_data = ledger_row_data.sort((a, b) => a.code - b.code);

              // Filter Ledger By Group Key
              data.forEach(async ({ code, group_name, group_key, parent }) => {
                let ledger_filter = ledger_row_data.filter(function (item) {
                  if (item.sub_groupKey == group_key && (item.debitForCalculation != 0 || item.creditForCalculation != 0)) {
                    return true;
                  }
                });
                let total_debit = 0;
                total_debit = ledger_filter.reduce((n, { debitForCalculation }) => Number(n) + Number(debitForCalculation), 0);
                total_debit = total_debit ?? 0;

                let total_credit = 0;
                total_credit = ledger_filter.reduce((n, { creditForCalculation }) => Number(n) + Number(creditForCalculation), 0);
                total_credit = total_credit ?? 0;

                let ledger_filter2 = ledger_filter.filter((item) => {
                  if (item.code.toString().startsWith("VEN") || item.code.toString().startsWith("CUS")) {
                    return false;
                  } else {
                    return true;
                  }
                });

                Object.assign((t[group_key] = t[group_key] || {}), {
                  parent: parent,
                  key: decode(group_name),
                  code: code,
                  label: decode(group_name),
                  Group_key: group_key,
                  legers: ledger_filter2,
                  total_debit: Number(total_debit.toFixed(2)).toLocaleString("en-IN"),
                  total_credit: Number(total_credit.toFixed(2)).toLocaleString("en-IN"),
                });
                t[parent] = t[parent] || {};
                t[parent].nodes = t[parent].nodes || [];
                t[parent].nodes.push(t[group_key]);
              });
              return t[root].nodes;
            })(stmt, "--");

            return res.json({ status: "success", success: true, data: tree });
          } else {
            return res.json({ status: "error", success: false, message: "No Group Found" });
          }
        }
      }); //ledger stmt
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

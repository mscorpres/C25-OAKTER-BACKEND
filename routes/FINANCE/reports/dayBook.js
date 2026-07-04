const express = require("express");
const router = express.Router();

let { tallyDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const Validator = require("validatorjs");

router.post("/dayBook", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      date: "required",
    });

    if (validation.fails()) {
      res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }

    let result = [];

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    const counterJV = await tallyDB.query("SELECT count(module_used) AS JV FROM ( SELECT insert_date , module_used FROM `tally_ledger_data` WHERE which_module = 'JV' AND (DATE_FORMAT(tally_ledger_data.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2) GROUP BY module_used ORDER BY `tally_ledger_data`.`insert_date` ) t;", {
      replacements: {
        date1: date1,
        date2: date2,
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    const counterBP = await tallyDB.query("SELECT count(module_used) AS BP FROM ( SELECT insert_date , module_used FROM `tally_ledger_data` WHERE which_module = 'BP' AND (DATE_FORMAT(tally_ledger_data.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2) GROUP BY module_used ORDER BY `tally_ledger_data`.`insert_date` ) t;", {
      replacements: {
        date1: date1,
        date2: date2,
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    const counterBR = await tallyDB.query("SELECT count(module_used) AS BR FROM ( SELECT insert_date , module_used FROM `tally_ledger_data` WHERE which_module = 'BR' AND (DATE_FORMAT(tally_ledger_data.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2) GROUP BY module_used ORDER BY `tally_ledger_data`.`insert_date` ) t;", {
      replacements: {
        date1: date1,
        date2: date2,
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    const counterVBT = await tallyDB.query("SELECT count(module_used) AS VBT FROM ( SELECT insert_date , module_used FROM `tally_ledger_data` WHERE which_module LIKE 'VBT%' AND (DATE_FORMAT(tally_ledger_data.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2) GROUP BY module_used ORDER BY `tally_ledger_data`.`insert_date` ) t;", {
      replacements: {
        date1: date1,
        date2: date2,
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    const counterCP = await tallyDB.query("SELECT count(module_used) AS CP FROM ( SELECT insert_date , module_used FROM `tally_ledger_data` WHERE which_module = 'CP' AND (DATE_FORMAT(tally_ledger_data.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2) GROUP BY module_used ORDER BY `tally_ledger_data`.`insert_date` ) t;", {
      replacements: {
        date1: date1,
        date2: date2,
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    const counterCR = await tallyDB.query("SELECT count(module_used) AS CR FROM ( SELECT insert_date , module_used FROM `tally_ledger_data` WHERE which_module = 'CR' AND (DATE_FORMAT(tally_ledger_data.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2) GROUP BY module_used ORDER BY `tally_ledger_data`.`insert_date` ) t;", {
      replacements: {
        date1: date1,
        date2: date2,
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    const counterCNT = await tallyDB.query("SELECT count(module_used) AS CNT FROM ( SELECT insert_date , module_used FROM `tally_ledger_data` WHERE which_module = 'CNT' AND (DATE_FORMAT(tally_ledger_data.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2) GROUP BY module_used ORDER BY `tally_ledger_data`.`insert_date` ) t;", {
      replacements: {
        date1: date1,
        date2: date2,
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    // result.push(counterJV);
    // result.push(counterBP);
    // result.push(counterBR);
    // result.push(counterVBT);
    // result.push(counterCP);
    // result.push(counterCR);
    // result.push(counterCNT);

    result.push({
      "Jurnal Voucher": counterJV[0].JV,
      "Bank Payment": counterBP[0].BP,
      "Bank Recipt": counterBR[0].BR,
      "All VBT": counterVBT[0].VBT,
      "Cash Payment": counterCP[0].CP,
      "Cash Recipt": counterCR[0].CR,
      "All Contra": counterCNT[0].CNT,
    });

    return res.json({ status: "success", success: true, data: result });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");
const htmlToPdf = require("html-pdf-node");

// CREATE NEW JOURNAL VOUCHER
router.post("/create_jv", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    effective_date: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.errors.all() });
  }

  const transaction = await tallyDB.transaction();

  try {
    // NUMBURING FUN
    let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'JV'", {
      type: tallyDB.QueryTypes.SELECT,
    });
    let transaction_code;
    if (stmt_number.length > 0) {
      var suffix = stmt_number[0].suffix;
      suffix = parseInt(suffix) + 1;
      suffix = suffix.toString();
      suffix = suffix.padStart(parseInt(stmt_number[0].number_length_limit), "0");

      transaction_code = stmt_number[0].prefix + "/" + stmt_number[0].session + "/" + suffix;
    } else {
      let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
      transaction_code = "JV/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'JV'", {
      type: tallyDB.QueryTypes.UPDATE,
      transaction: transaction,
    });
    // END NUMBURING FUN

    const jvkey = transaction_code;

    const insert_date = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    let gl_length = req.body.gls.length;

    for (let i = 0; i < gl_length; i++) {
      let validation = new Validator(
        {
          gls: req.body.gls[i],
          debit: Number(req.body.debit[i]),
          credit: Number(req.body.credit[i]),
        },
        {
          gls: "required",
          debit: "required",
          credit: "required",
        }
      );
      if (validation.fails()) {
        return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
      }
    }

    let total_debit = req.body.debit.reduce((a, b) => Number(a) + Number(b), 0);
    let total_credit = req.body.credit.reduce((a, b) => Number(a) + Number(b), 0);
    if (Number(total_credit).toFixed(2) != Number(total_debit).toFixed(2)) {
      return res.json({ status: "success", success: true, message: "Debit ${total_debit} AND Credit ${total_credit} should Be Equle" });
    }

    for (let i = 0; i < gl_length; i++) {
      let stmt = await tallyDB.query("Insert INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, which_module, comment, insert_by ,insert_date , ref_date)VALUES (:ladger_key, :debit , :credit, :module_used , :which_module, :comment , :by_user ,:insert_date , :ref_date)", {
        replacements: {
          ladger_key: req.body.gls[i],
          debit: req.body.debit[i],
          credit: req.body.credit[i],
          module_used: jvkey,
          which_module: "JV",
          comment: req.body.comment[i],
          by_user: req.logedINUser,
          insert_date: insert_date,
          ref_date: moment(req.body.effective_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD"),
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transaction,
      });
      if (stmt.length <= 0) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Transaction Fails" });
      }
      if (gl_length == i + 1) {
        await transaction.commit();
        return res.json({ status: "success", success: true, message: "operation completed" });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH JV LIST
router.post("/jv_list", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    const { wise, data } = req.body;
    let main_stmt;

    if (wise == "date_wise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` WHERE (DATE_FORMAT(`tally_ledger_data`.`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `which_module` = 'JV'",
        {
          replacements: { date1: date1, date2: date2 },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    }
    if (wise == "eff_wise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` WHERE (DATE_FORMAT(`tally_ledger_data`.`ref_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `which_module` = 'JV'",
        {
          replacements: { date1: date1, date2: date2 },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    }
    if (wise == "code_wise") {
      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key`  WHERE `module_used` = :data  AND `which_module` = 'JV'",
        {
          replacements: { data: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    }
    if (wise == "vendor_wise") {
      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key`  WHERE tally_ledger_data.ladger_key = :data  AND `which_module` = 'JV'",
        {
          replacements: { data: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];
    if (main_stmt.length > 0) {
      for (let i = 0; i < main_stmt.length; i++) {
        let temp = {
          module_used: main_stmt[i].module_used,
          ref_date: moment(main_stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          which_module: main_stmt[i].which_module,
          status: main_stmt[i].status,
          account: main_stmt[i].account,
          account_code: main_stmt[i].account_code,
          debit: main_stmt[i].debit,
          credit: main_stmt[i].credit,
          comment: main_stmt[i].comment,
        };
        final.push(temp);
      }
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH JV DETAILS
router.post("/jv_detail", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    jv_key: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query(
      "SELECT  `tally_ledger_data`.`debit`,`tally_ledger_data`.`credit`,`tally_ledger_data`.`insert_date`,`tally_ledger_data`.`ref_date`,`tally_ledger`.`ladger_name`,`tally_ledger`.`code`,`tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON  `tally_ledger_data`.`ladger_key`=`tally_ledger`.`ledger_key` WHERE `module_used` = :data AND `which_module` = 'JV'",
      {
        replacements: { data: req.body.jv_key },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        stmt[i].ref_date = moment(stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY");
        stmt[i].insert_date = moment(stmt[i].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY");
      }

      return res.json({ status: "success", success: true, data: stmt });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// PRINT JOUNAL POSTING
router.post("/jv_print", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    jv_key: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query("SELECT  `tally_ledger`.`ladger_name`,`tally_ledger`.`code`,debit,credit,ref_date,module_used FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON  `tally_ledger_data`.`ladger_key`=`tally_ledger`.`ledger_key` WHERE `module_used` = :data AND `which_module` = 'JV'", {
      replacements: { data: req.body.jv_key },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      let data = {
        jv_code: stmt[0].module_used,
        ref_date: moment(stmt[0].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
      };

      let rows = "";
      let row_total = "";
      let total_debit = 0;
      let total_credit = 0;
      for (let i = 0; i < stmt.length; i++) {
        rows += `
        <tr style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">
          <td style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">${stmt[i].ladger_name}</td>
          <td style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">${stmt[i].debit}</td>
          <td style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">${stmt[i].credit}</td>
        </tr>
        `;
        total_debit += Number(stmt[i].debit);
        total_credit += Number(stmt[i].credit);
      }

      row_total = `
          <tr style="border-left: 1px solid black; border-right: 1px solid black; border-top: 1px solid black" class="no-border">
            <td style="border-left: 1px solid black; border-right: 1px solid black" class="no-border"></td>
            <td style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">
              <strong>${total_debit.toFixed(2)}</strong>
            </td>
            <td style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">
              <strong>${total_credit.toFixed(2)}</strong>
            </td>
          </tr>
      `;

      let options = { format: "A4", margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" } };
      let file = { content: require("./printHtml/jvHtml").printHtml(data, rows, row_total) };

      await htmlToPdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          res.json({ buffer: pdfBuffer });
        })
        .catch((err) => {
          return res.json({ message: "an error while generating file", status: "error", success: false});
        });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// DELETE JV
router.post("/jv_delete", [auth.isAuthorized], async (req, res) => {
  return res.json({ status: "error", success: false, message: "Permission Not allow!!!" });

  let validation = new Validator(req.body, {
    jv_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_data_status` = 'D',`deleted_by` = :deleted_by ,`deleted_date` = :deleted_date WHERE `tally_ledger_data`.`module_used` = :jv_code", {
      replacements: {
        jv_code: req.body.jv_code,
        deleted_by: req.logedINUser,
        deleted_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      },
      type: tallyDB.QueryTypes.UPDATE,
    });
    if (stmt.length > 0) {
      res.json({ status: "success", success: true, message: "Journal Voucher Deletion Success" });
    } else {
      res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// EDIT JV
router.post("/jv_edit", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    jv_key: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query(
      "SELECT `tally_ledger_data`.`ID`, `tally_ledger_data`.`ladger_key`, `tally_ledger_data`.`module_used`, `tally_ledger_data`.`debit`,`tally_ledger_data`.`credit`,`tally_ledger_data`.`insert_date`,`tally_ledger_data`.`ref_date`,`tally_ledger`.`ladger_name`,`tally_ledger`.`code`,`tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON  `tally_ledger_data`.`ladger_key`=`tally_ledger`.`ledger_key` WHERE `module_used` = :data AND `which_module` = 'JV'",
      {
        replacements: { data: req.body.jv_key },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      final = [];
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          trans_id: stmt[i].ID,
          l_key: stmt[i].ladger_key,
          l_name: stmt[i].ladger_name,
          jv_code: stmt[i].module_used,
          debit: stmt[i].debit,
          credit: stmt[i].credit,
          l_code: stmt[i].code,
          comment: stmt[i].comment,
          effective_date: moment(stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
        });
      }

      return res.json({ status: "success", success: true, data: final });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE JV
router.post("/update_jv", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    jv_code: "required",
    effective_date: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  const transaction = await tallyDB.transaction();

  try {
    let arr_length = req.body.trans_id.length;
    for (let i = 0; i < arr_length; i++) {
      let validation = new Validator(
        {
          trans_id: req.body.trans_id[i],
          gls: req.body.gls[i],
          debit: Number(req.body.debit[i]),
          credit: Number(req.body.credit[i]),
        },
        {
          trans_id: "required",
          gls: "required",
          debit: "required",
          credit: "required",
        }
      );
      if (validation.fails()) {
        await transaction.rollback();
        return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
      }
    }

    //
    let total_debit = req.body.debit.reduce((a, b) => +Number(a).toFixed(2) + +Number(b).toFixed(2), 0);
    let total_credit = req.body.credit.reduce((a, b) => +Number(a).toFixed(2) + +Number(b).toFixed(2), 0);
    if (Number(total_credit).toFixed(2) != Number(total_debit).toFixed(2)) {
      return res.json({ status: "success", success: true, message: "Debit ${total_debit} AND Credit ${total_credit} should be equal" });
    }

    // UPDATE JV
    for (let i = 0; i < arr_length; i++) {
      // UPDATE STMT
      let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ladger_key` = :gls, `debit` = :debit, `credit` = :credit, `comment` = :comment, `ref_date` = :ref_date, `update_by` = :update_by, `update_date` = :update_date WHERE `tally_ledger_data`.`ID` = :trans_id", {
        replacements: {
          trans_id: req.body.trans_id[i],
          gls: req.body.gls[i],
          debit: req.body.debit[i],
          credit: req.body.credit[i],
          comment: req.body.comment[i],
          ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
          update_by: req.logedINUser,
          update_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        },
        type: tallyDB.QueryTypes.UPDATE,
        transaction: transaction,
      });
      if (stmt.length <= 0) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Updation failed, please try again!!" });
      }
    }

    await transaction.commit();
    res.json({ status: "success", success: true, message: "Journal Voucher Updation Success" });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

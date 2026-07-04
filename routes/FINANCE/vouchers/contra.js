const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");
const htmlToPdf = require("html-pdf-node");

// CONTRA 01/02 ACCOUNTS (BANK AND CASH)
router.post("/bank_cash_ledgers", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE sub_group_key = 'TP20220219124856' OR sub_group_key = 'TP20220219125242'  LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE (sub_group_key = 'TP20220219124856' OR sub_group_key = 'TP20220219125242') AND (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({
          id: item.ledger_key,
          text: `(${item.code})${item.ladger_name}`,
        });
      });
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Gl Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

//CONTRA 03 ACCOUNTS (CASH)
router.post("/cash_ledgers", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE sub_group_key = 'TP20220219125242'  LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE (sub_group_key = 'TP20220219125242') AND (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({
          id: item.ledger_key,
          text: `(${item.code})${item.ladger_name}`,
        });
      });
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Gl Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// CONTRA 04 ACCOUNT (BANK)
router.post("/bank_ledgers", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE sub_group_key = 'TP20220219124856'  LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE (sub_group_key = 'TP20220219124856') AND (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({
          id: item.ledger_key,
          text: `(${item.code})${item.ladger_name}`,
        });
      });
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Gl Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// CREATE CONTRA
router.post("/create_contra", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    effective_date: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.errors.fails() });
  }

  const transaction = await tallyDB.transaction();

  try {
    // NUMBURING FUN
    let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'CNT'", {
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
      transaction_code = "CNT/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'CNT'", {
      type: tallyDB.QueryTypes.UPDATE,
      transaction: transaction,
    });
    // END NUMBURING FUN

    const ctkey = transaction_code;

    const insert_date = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    let gl_length = req.body.gls.length;

    for (let i = 0; i < gl_length; i++) {
      let validation = new Validator(
        {
          gls: req.body.gls[i],
          debit: req.body.debit[i],
          credit: req.body.credit[i],
        },
        {
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

    let total_debit = req.body.debit.reduce((a, b) => Number(a) + Number(b), 0);
    let total_credit = req.body.credit.reduce((a, b) => Number(a) + Number(b), 0);
    if (total_credit != total_debit) {
      await transaction.rollback();
      return res.json({ status: "success", success: true, message: "Debit ${total_debit} AND Credit ${total_credit} should Be Equle" });
    }

    for (let i = 0; i < gl_length; i++) {
      let stmt = await tallyDB.query("Insert INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, which_module, comment, insert_by ,insert_date , ref_date)VALUES (:ladger_key, :debit , :credit, :module_used , :which_module, :comment , :insert_by ,:insert_date , :ref_date)", {
        replacements: {
          ladger_key: req.body.gls[i],
          debit: req.body.debit[i],
          credit: req.body.credit[i],
          module_used: ctkey,
          which_module: "CNT",
          comment: req.body.comment[i],
          insert_by: req.logedINUser,
          insert_date: insert_date,
          ref_date: moment(req.body.effective_date, "DD-MM-YYYY").tz("Asia/Kolkata").format("YYYY-MM-DD"),
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

// CONTRA REPORT LIST
router.post("/contra_report_list", [auth.isAuthorized], async (req, res) => {
  try {
    const { wise, data } = req.body;
    let validation = new Validator(req.body, {
      wise: "required",
      data: "required",
    });

    if (validation.fails()) {
      return res.json({ status: "error", success: false, message: validation.errors.all() });
    }

    let main_stmt;

    if (wise == "date") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      main_stmt = await tallyDB.query("SELECT * FROM `tally_ledger_data` WHERE (`which_module` = 'CNT') AND (DATE_FORMAT(`tally_ledger_data`.`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2)  GROUP BY module_used ", {
        replacements: { date1: date1, date2: date2 },
        type: tallyDB.QueryTypes.SELECT,
      });
    } else if (wise == "effective") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      main_stmt = await tallyDB.query("SELECT * FROM `tally_ledger_data` WHERE (`which_module` = 'CNT') AND (DATE_FORMAT(`tally_ledger_data`.`ref_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2)  GROUP BY module_used ", {
        replacements: { date1: date1, date2: date2 },
        type: tallyDB.QueryTypes.SELECT,
      });
    } else if (wise == "number") {
      main_stmt = await tallyDB.query("SELECT * FROM `tally_ledger_data` WHERE (`which_module` = 'CNT') AND `module_used` = :data GROUP BY module_used ", {
        replacements: { data: data },
        type: tallyDB.QueryTypes.SELECT,
      });
    } else if (wise == "ledger") {
      main_stmt = await tallyDB.query("SELECT * FROM `tally_ledger_data` WHERE (`which_module` = 'CNT') AND `ladger_key` = :data GROUP BY module_used ", {
        replacements: { data: data },
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      return res.json({ status: "error", success: false, message: "Select valid filter option" });
    }

    if (main_stmt.length > 0) {
      let final_data = [];
      for (let i = 0; i < main_stmt.length; i++) {
        final_data.push({
          create_date: moment(main_stmt[i].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          ref_date: moment(main_stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          contra_number: main_stmt[i].module_used,
          status: main_stmt[i].ledger_data_status,
          ammount: main_stmt[i].debit == 0 ? main_stmt[i].credit : main_stmt[i].debit,
        });
      }
      return res.json({ status: "success", success: true, data: final_data });
    } else {
      return res.json({ status: "error", success: false, message: "Transaction not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// CONTRA REPORT DATA
router.post("/contra_report", [auth.isAuthorized], async (req, res) => {
  try {
    const { data } = req.body;
    let validation = new Validator(req.body, {
      data: "required",
    });

    if (validation.fails()) {
      return res.json({ status: "error", success: false, message: validation.errors.all() });
    }

    const main_stmt = await tallyDB.query("SELECT `tally_ledger_data`.*,tally_ledger.ladger_name,tally_ledger.code as ladger_code FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON `tally_ledger`.`ledger_key` = `tally_ledger_data`.`ladger_key`  WHERE (`which_module` = 'CNT') AND `module_used` = :data", {
      replacements: { data: data },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (main_stmt.length > 0) {
      let final_data = [];
      for (let i = 0; i < main_stmt.length; i++) {
        final_data.push({
          ID: Buffer.from(JSON.stringify(main_stmt[i].ID)).toString('base64'),
          account_name: `${main_stmt[i].ladger_name} (${main_stmt[i].ladger_code})`,
          create_date: moment(main_stmt[i].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          ref_date: moment(main_stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          contra_number: main_stmt[i].module_used,
          debit: main_stmt[i].debit,
          credit: main_stmt[i].credit,
          comment: main_stmt[i].comment,
          status: main_stmt[i].ledger_data_status,
          ledger_key: main_stmt[i].ladger_key,
        });
      }
      return res.json({ status: "success", success: true, data: final_data });
    } else {
      return res.json({ status: "error", success: false, message: "Something wrong !!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});
// CONTRA PRINT
router.post("/contra_print", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query("SELECT  `tally_ledger`.`ladger_name`,debit,credit,ref_date,module_used FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON  `tally_ledger_data`.`ladger_key`=`tally_ledger`.`ledger_key` WHERE `module_used` = :data", {
      replacements: { data: req.body.code },
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
              <strong>${total_debit}</strong>
            </td>
            <td style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">
              <strong>${total_credit}</strong>
            </td>
          </tr>
      `;

      let options = { format: "A4", margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" } };
      let file = { content: require("./printHtml/contraHtml").printHtml(data, rows, row_total) };

      await htmlToPdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          // res.setHeader("Content-disposition", 'inline; filename="vbt.pdf"');
          // res.setHeader("Content-type", "application/pdf");
          // res.send(pdfBuffer);
          res.json({ buffer: pdfBuffer });
          // return res.json({ message: "File Generated successfully..", status: "success", success: true, data: { buffer: pdfBuffer, filename: data.min_txn_id.replace(/\//g, "_") + ".pdf" } });
        })
        .catch((err) => {
          return res.json({ message: "an error while generating file", status: "error", success: false});
        });

      // res.send(require("./printHtml/jvHtml").printHtml(data, rows,row_total));
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// DELETE CONTRA
router.post("/contra_delete", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    contra_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_data_status` = 'D',`deleted_by` = :deleted_by ,`deleted_date` = :deleted_date WHERE `tally_ledger_data`.`module_used` = :contra_code", {
      replacements: {
        contra_code: req.body.contra_code,
        deleted_by: req.logedINUser,
        deleted_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      },
      type: tallyDB.QueryTypes.UPDATE,
    });
    if (stmt.length > 0) {
      res.json({ status: "success", success: true, message: "Contra Deletion Success" });
    } else {
      res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// CONTRA EDIT
router.post("/contra_edit", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    contra_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query("SELECT  `tally_ledger_data`.*,`tally_ledger`.`code`, `tally_ledger`.`ladger_name` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON  `tally_ledger_data`.`ladger_key`=`tally_ledger`.`ledger_key` WHERE `module_used` = :data AND `ledger_data_status` != 'D' ", {
      replacements: { data: req.body.contra_code },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      let final_data = [];
      for (let i = 0; i < stmt.length; i++) {
        let data = {
          ledger_name: `(${stmt[i].code}) ${stmt[i].ladger_name}`,
          ledger_key: stmt[i].ladger_key,
          debit: stmt[i].debit,
          credit: stmt[i].credit,
          ref_date: moment(stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          v_code: stmt[i].module_used,
        };
        final_data.push(data);
      }

      res.json({ status: "success", success: true, data: final_data });
    } else {
      res.json({ status: "error", success: false, message: "Transaction can't be update due to some reason!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// CONTRA UPDATE
router.post("/contra_update", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    contra_code: "required",
    effective_date: "required",
  });
  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.errors.all() });
  }

  const transaction = await tallyDB.transaction();

  try {
    let arr_length = req.body.ID.length;
    for (let i = 0; i < arr_length; i++) {
      let validation = new Validator(
        {
          ID: req.body.ID[i],
          gls: req.body.gls[i],
          debit: Number(req.body.debit[i]),
          credit: Number(req.body.credit[i]),
        },
        {
          ID: "required",
          gls: "required",
          debit: "required",
          credit: "required",
        }
      );
      if (validation.fails()) {
        await transaction.rollback();
        return res.json({ message: validation.errors.all(), status: "error", success: false });
      }
    }

    let total_debit = req.body.debit.reduce((a, b) => Number(a) + Number(b), 0);
    let total_credit = req.body.credit.reduce((a, b) => Number(a) + Number(b), 0);
    if (total_credit != total_debit) {
      await transaction.rollback();
      return res.json({ status: "success", success: true, message: "Debit ${total_debit} and Credit ${total_credit} should Be equal" });
    }

    for (let i = 0; i < arr_length; i++) {
      let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ladger_key` = :ladger_key, `debit` = :debit, `credit` = :credit,`comment` = :comment , `ref_date` = :ref_date, `update_by` = :update_by, `update_date` = :update_date WHERE `tally_ledger_data`.`ID` = :ID", {
        replacements: {
          ladger_key: req.body.gls[i],
          debit: req.body.debit[i],
          credit: req.body.credit[i],
          comment: req.body.comment[i],
          ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
          update_by: req.logedINUser,
          update_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
          ID: Number(Buffer.from(req.body.ID[i], 'base64').toString('utf8')),
        },
        type: tallyDB.QueryTypes.UPDATE,
        transaction: transaction,
      });

      if (stmt.length <= 0) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Error while updating contra." });
      }
    }
    await transaction.commit();
    return res.json({ status: "success", success: true, message: "Contra Updated Successfully" });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

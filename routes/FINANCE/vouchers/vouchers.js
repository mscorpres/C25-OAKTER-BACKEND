const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");
const htmlToPdf = require("html-pdf-node");

// FETCH BANK
router.post("/fetch_bank", [auth.isAuthorized], async (req, res) => {
  try {
    const limit = 10;
    let stmt;
    if (req.body.search) {
      stmt = await tallyDB.query("SELECT code,ladger_name,ledger_key FROM `tally_ledger` WHERE (`code` LIKE :name OR `ladger_name` LIKE :name) ORDER BY `ladger_name` ASC LIMIT :limit", {
        replacements: { name: `%${req.body.search}%`, limit: limit },
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT code,ladger_name,ledger_key FROM `tally_ledger` ORDER BY `ladger_name` ASC LIMIT :limit", { replacements: { limit: limit }, type: tallyDB.QueryTypes.SELECT });
    }

    let final = [];

    stmt.map((item) => {
      final.push({ id: item.ledger_key, text: item.ladger_name + " (" + item.code + ")" });
      if (stmt.length == final.length) {
        res.json(final);
        return;
      }
    });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH BANK HEADER
router.post("/bank_header", [auth.isAuthorized], async (req, res) => {
  try {
    const limit = 10;
    let stmt1, stmt2;
    if (req.body.search) {
      stmt1 = await tallyDB.query("SELECT code,ladger_name,ledger_key FROM `tally_ledger` WHERE (`code` LIKE :name OR `ladger_name` LIKE :name) ORDER BY `ladger_name` ASC LIMIT :limit", {
        replacements: { name: `%${req.body.search}%`, limit: limit },
        type: tallyDB.QueryTypes.SELECT,
      });

      stmt2 = await invtDB.query("SELECT `ven_name`,`ven_register_id` FROM `ven_basic_detail` WHERE (`ven_register_id` LIKE :name OR `ven_name` LIKE :name) LIMIT :limit", {
        replacements: { name: `%${req.body.search}%`, limit: limit },
        type: invtDB.QueryTypes.SELECT,
      });
    } else {
      stmt1 = await tallyDB.query("SELECT code,ladger_name,ledger_key FROM `tally_ledger` ORDER BY `ladger_name` ASC LIMIT :limit", { replacements: { limit: limit }, type: tallyDB.QueryTypes.SELECT });
      stmt2 = await invtDB.query("SELECT `ven_name`,`ven_register_id` FROM `ven_basic_detail` LIMIT :limit", { replacements: { limit: limit }, type: invtDB.QueryTypes.SELECT });
    }

    let final = [];

    stmt1.map((item) => {
      final.push({ id: item.ledger_key, text: item.ladger_name + " (" + item.code + ")" });
      sendRes();
    });
    stmt2.map((item) => {
      final.push({ id: item.ven_register_id, text: item.ven_name + " (" + item.ven_register_id + ")" });
      sendRes();
    });
    function sendRes() {
      if (stmt1.length + stmt2.length == final.length) {
        res.json(final);
        return;
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// INSERT BANK PAYMENT
router.post("/insert_bp", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    account: "required",
    effective_date: "required",
  });

  if (validation.fails()) {
    return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  const transaction = await tallyDB.transaction();

  let glslength = req.body.gls.length;

  for (let i = 0; i < glslength; i++) {
    let validation = new Validator(
      {
        gls: req.body.gls[i],
        debit: Number(req.body.debit[i]),
      },
      {
        gls: "required",
        debit: "required",
      }
    );
    if (validation.fails()) {
      return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }
  }

  // const toFindDublicates = (arry) => arry.filter((item, index) => arry.indexOf(item) !== index);
  // const dubliEle = toFindDublicates(req.body.gls);
  // if (dubliEle.length > 0) {
  //   await transaction.rollback();
  //   res.json({ message: "You have entered a same GLS twice of time in a single request", status: "error", success: false });
  //   return;
  // }

  // NUMBURING FUN
  let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'BP'", {
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
    transaction_code = "BP/" + currYear + "-" + (currYear + 1) + "/0001";
  }

  await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'BP'", {
    type: tallyDB.QueryTypes.UPDATE,
    transaction: transaction,
  });
  // END NUMBURING FUN

  let stmt1;
  let stmt2;
  let total_debit = 0;
  try {
    for (let i = 0; i < glslength; i++) {
      total_debit += Number(req.body.debit[i]);
      stmt1 = await tallyDB.query(
        "INSERT INTO `tally_ledger_data` (`ladger_key`,`currency_type`,`exchange_rate`, `debit` , `credit` , `module_used`, `which_module`, `comment`, `voucher_account`, `insert_date`, `insert_by`, `ref_date`, project_code)VALUES (:ladger_key, :currency_type , :exchange_rate, :debit, :credit, :module_used, :which_module, :comment, :account, :insert_date, :insert_by, :ref_date, :project_code)",
        {
          replacements: {
            ladger_key: req.body.gls[i],
            currency_type: req.body.currency_type[i],
            exchange_rate: req.body.exchange_rate[i],
            debit: Number(req.body.debit[i]) > 0 ? Number(req.body.debit[i]) : 0,
            credit: Number(req.body.debit[i]) > 0 ? 0 : Math.abs(Number(req.body.debit[i])),
            module_used: transaction_code,
            which_module: "BP",
            comment: req.body.comment[i],
            account: req.body.account,
            insert_by: req.logedINUser,
            insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
            ref_date: moment(req.body.effective_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD"),
            project_code: req.body.project_code,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      );
      if (stmt1.length > 0) {
      } else {
        await transaction.rollback();
        return res.json({ message: "an error occured while executing your initial request", status: "error", success: false });
      }
    }

    stmt2 = await tallyDB.query(
      "INSERT INTO `tally_ledger_data` (ladger_key,`currency_type`,`exchange_rate`, debit , credit, module_used, which_module, comment, voucher_account, insert_date, insert_by, ref_date, project_code) VALUES (:ladger_key, :currency_type , :exchange_rate, :debit, :credit, :module_used, :which_module, :comment, :account, :insert_date, :insert_by, :ref_date, :project_code)",
      {
        replacements: {
          ladger_key: req.body.account,
          currency_type: "364907247",
          exchange_rate: 1,
          debit: Number(total_debit) < 0 ? Math.abs(Number(total_debit)) : 0,
          credit: Number(total_debit) > 0 ? Number(total_debit) : 0,
          module_used: transaction_code,
          which_module: "BPM",
          comment: "Master",
          account: transaction_code,
          insert_by: req.logedINUser,
          insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
          ref_date: moment(req.body.effective_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD"),
          project_code: req.body.project_code,
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transaction,
      }
    );

    if (stmt2.length > 0) {
      await transaction.commit();
      return res.json({ message: "operation completed", status: "success", success: true });
    } else {
      await transaction.rollback();
      return res.json({ message: "an error occured while executing your final request", status: "error", success: false });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

//INSERT BANK RECEIPT
router.post("/insert_br", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    account: "required",
    effective_date: "required",
  });

  if (validation.fails()) {
    return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  const transaction = await tallyDB.transaction();
  let glslength = req.body.gls.length;

  for (let i = 0; i < glslength; i++) {
    let validation = new Validator(
      {
        gls: req.body.gls[i],
        credit: Number(req.body.credit[i]),
      },
      {
        gls: "required",
        credit: "required",
      }
    );
    if (validation.fails()) {
      return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }
  }

  // const toFindDublicates = (arry) => arry.filter((item, index) => arry.indexOf(item) !== index);
  // const dubliEle = toFindDublicates(req.body.gls);
  // if (dubliEle.length > 0) {
  //   await transaction.rollback();
  //   res.json({ message: "You have entered a same GLS twice of time in a single request", status: "error", success: false });
  //   return;
  // }

  // NUMBURING FUN
  let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'BR'", {
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
    transaction_code = "BR/" + currYear + "-" + (currYear + 1) + "/0001";
  }

  await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'BR'", {
    type: tallyDB.QueryTypes.UPDATE,
    transaction: transaction,
  });
  // END NUMBURING FUN

  let total_credit = 0;
  try {
    for (let i = 0; i < glslength; i++) {
      total_credit += Number(req.body.credit[i]);
      let stmt1 = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, which_module, comment,voucher_account, insert_date, insert_by, ref_date, project_code)VALUES (:ladger_key, :debit, :credit, :module_used, :which_module, :comment, :account, :insert_date, :insert_by, :ref_date, :project_code)", {
        replacements: {
          ladger_key: req.body.gls[i],
          currency_type: req.body.currency_type[i],
          exchange_rate: req.body.exchange_rate[i],
          debit: Number(req.body.credit[i]) > 0 ? 0 : Math.abs(Number(req.body.credit[i])),
          credit: Number(req.body.credit[i]) > 0 ? Math.abs(Number(req.body.credit[i])) : 0,
          module_used: transaction_code,
          which_module: "BR",
          comment: req.body.comment[i],
          account: req.body.account,
          insert_by: req.logedINUser,
          insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
          ref_date: moment(req.body.effective_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD"),
          project_code: req.body.project_code,
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transaction,
      });
      if (stmt1.length > 0) {
      } else {
        await transaction.rollback();
        return res.json({ message: "an error occured while executing your initial request", status: "error", success: false });
      }
    }

    let stmt2 = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, which_module, comment,voucher_account, insert_date,insert_by, ref_date,project_code)VALUES (:ladger_key, :debit, :credit, :module_used, :which_module, :comment, :account , :insert_date, :insert_by, :ref_date, :project_code)", {
      replacements: {
        ladger_key: req.body.account,
        currency_type: "364907247",
        exchange_rate: 1,
        debit: Number(total_credit) > 0 ? Number(total_credit) : 0,
        credit: Number(total_credit) < 0 ? Math.abs(Number(total_credit)) : 0,
        module_used: transaction_code,
        which_module: "BRM",
        comment: "Master",
        account: transaction_code,
        insert_by: req.logedINUser,
        insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        ref_date: moment(req.body.effective_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD"),
        project_code: req.body.project_code,
      },
      type: tallyDB.QueryTypes.INSERT,
      transaction: transaction,
    });

    if (stmt2.length > 0) {
      await transaction.commit();
      return res.json({ message: "operation completed", status: "success", success: true });
    } else {
      await transaction.rollback();
      return res.json({ message: "an error occured while executing your final request", status: "error", success: false });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// BANK VOUCHER LIST
router.post("/bp_list", [auth.isAuthorized], async (req, res) => {
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
        "SELECT `module_used`, `ref_date`, `which_module`,project_code, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit` as debit, `tally_ledger_data`.`credit` as credit, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account` WHERE (DATE_FORMAT(`tally_ledger_data`.`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND (`which_module` = 'BP') ORDER BY `tally_ledger_data`.`ID` DESC",
        {
          replacements: { date1: date1, date2: date2 },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "eff_wise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`,project_code, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit` as debit, `tally_ledger_data`.`credit` as credit, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account` WHERE (DATE_FORMAT(`tally_ledger_data`.`ref_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND (`which_module` = 'BP') ORDER BY `tally_ledger_data`.`ID` DESC",
        {
          replacements: { date1: date1, date2: date2 },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "key_wise") {
      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`,project_code, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit` as debit, `tally_ledger_data`.`credit` as credit  , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE module_used = :key AND (`which_module` = 'BP') ",
        {
          replacements: { key: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "ledger_wise") {
      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`,project_code, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit` as debit, `tally_ledger_data`.`credit` as credit  , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE voucher_account = :key AND (`which_module` = 'BP') ",
        {
          replacements: { key: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];
    if (main_stmt.length > 0) {
      for (let i = 0; i < main_stmt.length; i++) {
        final.push({
          module_used: main_stmt[i].module_used,
          ref_date: moment(main_stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          which_module: main_stmt[i].which_module,
          project_code: main_stmt[i].project_code,
          status: main_stmt[i].status,
          perticular: main_stmt[i].perticular,
          perticular_code: main_stmt[i].perticular_code,
          bank_name: main_stmt[i].bank_name,
          bank_name_code: main_stmt[i].bank_name_code,
          payment: main_stmt[i].debit > 0 ? main_stmt[i].debit : "-" + main_stmt[i].credit,
          comment: main_stmt[i].comment,
        });
      }
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});
// BANK RECIEPT LIST
router.post("/br_list", [auth.isAuthorized], async (req, res) => {
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
        "SELECT `module_used`, `ref_date`, `which_module`,project_code, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit` as debit, `tally_ledger_data`.`credit` as credit, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account` WHERE (DATE_FORMAT(`tally_ledger_data`.`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND (`which_module` = 'BR') ORDER BY `tally_ledger_data`.`ID` DESC",
        {
          replacements: { date1: date1, date2: date2 },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "eff_wise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`,project_code, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit` as debit, `tally_ledger_data`.`credit` as credit, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account` WHERE (DATE_FORMAT(`tally_ledger_data`.`ref_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND (`which_module` = 'BR') ORDER BY `tally_ledger_data`.`ID` DESC",
        {
          replacements: { date1: date1, date2: date2 },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "key_wise") {
      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`,project_code, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit` as debit, `tally_ledger_data`.`credit` as credit  , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE module_used = :key AND (`which_module` = 'BR') ",
        {
          replacements: { key: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "ledger_wise") {
      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`,project_code, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit` as debit, `tally_ledger_data`.`credit` as credit  , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE voucher_account = :key AND (`which_module` = 'BR') ",
        {
          replacements: { key: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];
    if (main_stmt.length > 0) {
      for (let i = 0; i < main_stmt.length; i++) {
        final.push({
          module_used: main_stmt[i].module_used,
          ref_date: moment(main_stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          which_module: main_stmt[i].which_module,
          status: main_stmt[i].status,
          perticular: main_stmt[i].perticular,
          perticular_code: main_stmt[i].perticular_code,
          bank_name: main_stmt[i].bank_name,
          bank_name_code: main_stmt[i].bank_name_code,
          payment: Number(main_stmt[i].debit) > 0 ? "-" + main_stmt[i].debit : main_stmt[i].credit,
          comment: main_stmt[i].comment,
          project_code: main_stmt[i].project_code,
        });
      }
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// BANK PAYMENT REPORT
router.post("/bank_payment_report", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    v_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query(
      "SELECT `tally_ledger_data`.`insert_date`, `module_used`, `ref_date`, `which_module`,project_code, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit` as debit, `tally_ledger_data`.`credit` as credit  , `tally_ledger_data`.`comment` , `bank`.`ladger_name` as account_name , `bank`.`code` as account_code FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE module_used = :data ",
      {
        replacements: { data: req.body.v_code },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          account_code: stmt[i].account_code,
          account_name: stmt[i].account_name,
          comment: stmt[i].comment,
          payment: stmt[i].debit > 0 ? stmt[i].debit : "-" + stmt[i].credit,
          insert_date: moment(stmt[i].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          particular: "(" + stmt[i].perticular_code + ")" + stmt[i].perticular,
          module_used: stmt[i].module_used,
          ref_date: moment(stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          which_module: stmt[i].which_module,
          project: stmt[i].project_code,
        });
      }
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "no Voucher Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// BANK RECIPT REPORT
router.post("/bank_recipt_report", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    v_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query(
      "SELECT `tally_ledger_data`.`insert_date`, `module_used`, `ref_date`, `which_module`,project_code, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit` as debit, `tally_ledger_data`.`credit` as credit  , `tally_ledger_data`.`comment` , `bank`.`ladger_name` as account_name , `bank`.`code` as account_code FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE module_used = :data ",
      {
        replacements: { data: req.body.v_code },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          account_code: stmt[i].account_code,
          account_name: stmt[i].account_name,
          comment: stmt[i].comment,
          payment: stmt[i].debit > 0 ? "-" + stmt[i].debit : stmt[i].credit,
          insert_date: moment(stmt[i].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          particular: "(" + stmt[i].perticular_code + ")" + stmt[i].perticular,
          module_used: stmt[i].module_used,
          ref_date: moment(stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          which_module: stmt[i].which_module,
          project: stmt[i].project_code,
        });
      }
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "no Voucher Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// BANK PAYMENT PRINT
router.post("/bp_print", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    v_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query(
      "SELECT `tally_ledger_data`.*, `tl_acc`.`ladger_name` AS account_name ,`tl_acc`.`code` as account_code ,`tl_prty`.`ladger_name` AS prty_name,`tl_prty`.`code` AS prty_code FROM  `tally_ledger_data` LEFT JOIN `tally_ledger` `tl_acc` ON `tl_acc`.`ledger_key` = `tally_ledger_data`.`voucher_account` LEFT JOIN `tally_ledger` `tl_prty` ON `tl_prty`.`ledger_key` =`tally_ledger_data`.`ladger_key`  WHERE `module_used` = :data  AND ( `tally_ledger_data`.`which_module` = 'BP' OR `tally_ledger_data`.`which_module` = 'BR' )  ",
      {
        replacements: { data: req.body.v_code },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let data = {
        account: `${stmt[0].account_name} (${stmt[0].account_code})`,
        create_date: moment(stmt[0].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
        effective_date: moment(stmt[0].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
      };

      let particulars = "";
      let total_debit = 0;
      let total_credit = 0;
      for (let i = 0; i < stmt.length; i++) {
        particulars += `
            <tr>
            <td>${stmt[i].prty_code}</td>
            <td>${stmt[i].prty_name}</td>
              <td>${stmt[i].debit}</td>
              <td>${stmt[i].credit}</td>
            </tr>
        `;
        total_debit += Number(stmt[i].debit);
        total_credit += Number(stmt[i].credit);
      }

      data.total_debit = total_debit;
      data.total_credit = total_credit;

      let options = { format: "A4", margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" } };
      let file = { content: require("./printHtml/bp").bp(data, particulars) };

      await htmlToPdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          return res.json({ buffer: pdfBuffer });
        })
        .catch((err) => {
          return res.json({ message: "an error while generating file", status: "error", success: false});
        });
    } else {
      return res.json({ status: "error", success: false, message: "Something wrong, please try again.." });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// BANK RECIEPT PRINT
router.post("/br_print", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    v_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query(
      "SELECT `tally_ledger_data`.*, `tl_acc`.`ladger_name` AS account_name ,`tl_acc`.`code` as account_code ,`tl_prty`.`ladger_name` AS prty_name,`tl_prty`.`code` AS prty_code FROM  `tally_ledger_data` LEFT JOIN `tally_ledger` `tl_acc` ON `tl_acc`.`ledger_key` = `tally_ledger_data`.`voucher_account` LEFT JOIN `tally_ledger` `tl_prty` ON `tl_prty`.`ledger_key` = `tally_ledger_data`.`ladger_key`  WHERE `module_used` = :data  AND ( `tally_ledger_data`.`which_module` = 'BP' OR `tally_ledger_data`.`which_module` = 'BR' ) ",
      {
        replacements: { data: req.body.v_code },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let data = {
        account: `${stmt[0].account_name} (${stmt[0].account_code})`,
        create_date: moment(stmt[0].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
      };
      let particulars = "";
      let total_debit = 0;
      let total_credit = 0;
      for (let i = 0; i < stmt.length; i++) {
        particulars += `
            <tr>
              <td>${stmt[i].prty_code}</td>
              <td>${stmt[i].prty_name}</td>
              <td>${stmt[i].debit}</td>
              <td>${stmt[i].credit}</td>
            </tr>
        `;
        total_debit += Number(stmt[i].debit);
        total_credit += Number(stmt[i].credit);
      }

      data.total_debit = total_debit;
      data.total_credit = total_credit;

      let options = { format: "A4", margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" } };
      let file = { content: require("./printHtml/br").br(data, particulars) };

      await htmlToPdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          res.json({ buffer: pdfBuffer });
        })
        .catch((err) => {
          return res.json({ message: "an error while generating file", status: "error", success: false});
        });
    } else {
      return res.json({ status: "error", success: false, message: "Something wrong, please try again.." });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// DELETE Bank Voucher
router.post("/bank_delete", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    b_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_data_status` = 'D',`deleted_by` = :deleted_by ,`deleted_date` = :deleted_date WHERE `tally_ledger_data`.`module_used` = :b_code", {
      replacements: {
        b_code: req.body.b_code,
        deleted_by: req.logedINUser,
        deleted_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      },
      type: tallyDB.QueryTypes.UPDATE,
    });
    if (stmt.length > 0) {
      res.json({ status: "success", success: true, message: "Voucher Deletion Success" });
    } else {
      res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// EDIT BANK PAYMENT
router.post("/editBP", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    v_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query(
      "SELECT `tally_ledger_data`.`ID`,`tally_ledger_data`.`ladger_key`, `voucher_account`, `module_used`, `ref_date`, `which_module`, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit` ,`tally_ledger_data`.`credit` , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE module_used = :key AND (`which_module` = 'BP')  AND `ledger_data_status` != 'D' ",
      {
        replacements: { key: req.body.v_code },
        type: tallyDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      let finalData = [];
      for (let i = 0; i < stmt.length; i++) {
        let data = {
          tras_id: stmt[i].ID,
          bank_key: stmt[i].voucher_account,
          bank_name: ` (${stmt[i].bank_name_code}) ${stmt[i].bank_name}`,
          particular: stmt[i].perticular,
          particular_code: stmt[i].perticular_code,
          particular_key: stmt[i].ladger_key,
          payment: stmt[i].debit > 0 ? stmt[i].debit : "-" + stmt[i].credit,
          comment: stmt[i].comment,
          ref_date: moment(stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          v_code: stmt[i].module_used,
        };
        finalData.push(data);
      }
      return res.json({ status: "success", success: true, message: "Voucher Data", data: finalData });
    } else {
      return res.json({ status: "error", success: false, message: "Voucher can't be upadete due to some reasone " });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE BANK PAYMENT
router.post("/updateBP", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    account: "required",
    effective_date: "required",
    v_code: "required",
  });
  if (validation.fails()) {
    return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  let glslength = req.body.gls.length;

  for (let i = 0; i < glslength; i++) {
    let validation = new Validator(
      {
        tras_id: req.body.tras_id[i],
        gls: req.body.gls[i],
        debit: Number(req.body.debit[i]),
      },
      {
        gls: "required",
        tras_id: "required",
        debit: "required",
      }
    );
    if (validation.fails()) {
      return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }
  }

  const transaction = await tallyDB.transaction();

  try {
    let total_debit = 0;
    let which_module;
    let module_used;
    let currency_type;
    let exchange_rate;
    let project_code;

    for (let i = 0; i < glslength; i++) {
      total_debit += Number(req.body.debit[i]);

      let findID = await tallyDB.query("SELECT * FROM tally_ledger_data WHERE ID = :tras_id", {
        replacements: { tras_id: req.body.tras_id[i] },
        type: tallyDB.QueryTypes.SELECT,
      })

      if (findID.length > 0) {
        which_module = findID[0].which_module
        module_used = findID[0].module_used
        currency_type = findID[0].currency_type
        exchange_rate = findID[0].exchange_rate
        project_code = findID[0].project_code ? findID[0].project_code : '';
        let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ladger_key` = :gl_key,`voucher_account` = :bank_key,`ref_date` = :ref_date,`debit` = :debit, credit = :credit,`comment` = :comment,`update_by` = :updated_by,`update_date` = :updated_date WHERE `tally_ledger_data`.`ID` = :tras_id AND `tally_ledger_data`.`module_used` = :v_code ", {
          replacements: {
            gl_key: req.body.gls[i],
            bank_key: req.body.account,
            ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
            debit: Number(req.body.debit[i]) > 0 ? Number(req.body.debit[i]) : 0,
            credit: Number(req.body.debit[i]) > 0 ? 0 : Math.abs(Number(req.body.debit[i])),
            comment: req.body.comment[i],
            updated_by: req.logedINUser,
            updated_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
            tras_id: req.body.tras_id[i],
            v_code: req.body.v_code,
          },
        });

        if (stmt.length == 0) {
          await transaction.rollback();
          return res.json({ status: "error", success: false, message: "Updatation Failed, Please try again!!!" });
        }
      } else {
        let main_stmt = await tallyDB.query("INSERT INTO `tally_ledger_data` (`ladger_key`,`currency_type`,`exchange_rate`, `debit` , `credit` , `module_used`, `which_module`, `comment`, `voucher_account`, `insert_date`, `insert_by`, `ref_date`, project_code)VALUES (:gl_key, :currency_type , :exchange_rate, :debit, :credit, :module_used, :which_module, :comment, :account, :insert_date, :insert_by, :ref_date, :project_code)",
          {
            replacements: {
              gl_key: req.body.gls[i],
              currency_type: currency_type,
              exchange_rate: exchange_rate,
              debit: Number(req.body.debit[i]) > 0 ? Number(req.body.debit[i]) : 0,
              credit: Number(req.body.debit[i]) > 0 ? 0 : Math.abs(Number(req.body.debit[i])),
              module_used: module_used,
              which_module: which_module,
              comment: req.body.comment[i],
              account: req.body.account,
              insert_by: req.logedINUser,
              insert_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
              ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
              project_code: project_code,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        if (main_stmt.length <= 0) {
          await transaction.rollback()
          return res.json({ status: 'error', message: 'updation failed...' })
        }
      }

    }

    let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ladger_key` = :gl_key,`ref_date` = :ref_date,`credit` = :credit,`update_by` = :updated_by, `update_date` = :updated_date WHERE `tally_ledger_data`.`module_used` = :v_code AND `voucher_account` = :v_code ", {
      replacements: {
        gl_key: req.body.account,
        bank_key: req.body.v_code,
        ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
        credit: total_debit,
        updated_by: req.logedINUser,
        updated_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        v_code: req.body.v_code,
      },
    });

    if (stmt.length > 0) {
      await transaction.commit();
      return res.json({ status: "success", success: true, message: "Voucher Updated Successfully" });
    } else {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Updatation Failed, Please try again!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// EDIT BANK RECEIPT
router.post("/editBR", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    v_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query(
      "SELECT `tally_ledger_data`.`ID`,`tally_ledger_data`.`ladger_key`, `voucher_account`, `module_used`, `ref_date`, `which_module`, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`credit` , `tally_ledger_data`.`debit` , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE module_used = :key AND (`which_module` = 'BR')  AND `ledger_data_status` != 'D' ",
      {
        replacements: { key: req.body.v_code },
        type: tallyDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      let finalData = [];
      for (let i = 0; i < stmt.length; i++) {
        let data = {
          tras_id: stmt[i].ID,
          bank_key: stmt[i].voucher_account,
          bank_name: ` (${stmt[i].bank_name_code}) ${stmt[i].bank_name}`,
          particular: stmt[i].perticular,
          particular_code: stmt[i].perticular_code,
          particular_key: stmt[i].ladger_key,
          payment: stmt[i].debit > 0 ? "-" + stmt[i].debit : stmt[i].credit,
          comment: stmt[i].comment,
          ref_date: moment(stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          v_code: stmt[i].module_used,
        };
        finalData.push(data);
      }
      return res.json({ status: "success", success: true, message: "Voucher Data", data: finalData });
    } else {
      return res.json({ status: "error", success: false, message: "Voucher can't be upadete due to some reasone " });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE BANK RECEIPT
router.post("/updateBR", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    account: "required",
    effective_date: "required",
    v_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  const transaction = await tallyDB.transaction();

  let glslength = req.body.gls.length;

  for (let i = 0; i < glslength; i++) {
    let validation = new Validator(
      {
        tras_id: req.body.tras_id[i],
        gls: req.body.gls[i],
        credit: Number(req.body.credit[i]),
      },
      {
        gls: "required",
        tras_id: "required",
        credit: "required",
      }
    );
    if (validation.fails()) {
      return res.json({ message: validation.errors.all(), status: "error", success: false });
    }
  }

  try {
    let total_credit = 0;
    for (let i = 0; i < glslength; i++) {
      total_credit += Number(req.body.credit[i]);

      let findID = await tallyDB.query("SELECT * FROM tally_ledger_data WHERE ID = :tras_id", {
        replacements: { tras_id: req.body.tras_id[i] },
        type: tallyDB.QueryTypes.SELECT,
      });

      if (findID.length > 0) {
        let stmt = await tallyDB.query(
          "UPDATE `tally_ledger_data` SET `ladger_key` = :gl_key,`voucher_account` = :bank_key,`ref_date` = :ref_date, `credit` = :credit, debit = :debit ,   `comment` = :comment, `update_by` = :updated_by,`update_date` = :updated_date WHERE `tally_ledger_data`.`ID` = :tras_id AND `tally_ledger_data`.`module_used` = :v_code ",
          {
            replacements: {
              gl_key: req.body.gls[i],
              bank_key: req.body.account,
              ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
              debit: Number(req.body.credit[i]) > 0 ? 0 : Math.abs(Number(req.body.credit[i])),
              credit: Number(req.body.credit[i]) > 0 ? Math.abs(Number(req.body.credit[i])) : 0,
              comment: req.body.comment[i],
              updated_by: req.logedINUser,
              updated_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
              tras_id: req.body.tras_id[i],
              v_code: req.body.v_code,
            },
            type: tallyDB.QueryTypes.UPDATE,
          }
        );

        if (stmt.length == 0) {
          await transaction.rollback();
          return res.json({ status: "error", success: false, message: "Failed to update" });
        }
      } else {
        let insertBR = await tallyDB.query("INSERT INTO `tally_ledger_data` (`ladger_key`, `debit` , `credit` , `module_used`, `which_module`, `comment`, `voucher_account`, `insert_date`, `insert_by`, `ref_date`)VALUES (:gl_key, :debit, :credit, :module_used, :which_module, :comment, :account, :insert_date, :insert_by, :ref_date)", {
          replacements: {
            gl_key: req.body.gls[i],
            debit: Number(req.body.credit[i]) > 0 ? 0 : Math.abs(Number(req.body.credit[i])),
            credit: Number(req.body.credit[i]) > 0 ? Math.abs(Number(req.body.credit[i])) : 0,
            module_used: req.body.v_code,
            which_module: "BR",
            comment: req.body.comment[i],
            account: req.body.account,
            insert_by: req.logedINUser,
            insert_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });

        if (insertBR.length <= 0) {
          await transaction.rollback();
          return res.json({ status: "error", success: false, message: "Failed to update" });
        }
      }

    }

    let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ladger_key` = :gl_key,`ref_date` = :ref_date,`debit` = :debit, credit = :credit , `update_by` = :updated_by, `update_date` = :updated_date WHERE `tally_ledger_data`.`module_used` = :v_code AND `voucher_account` = :v_code ", {
      replacements: {
        gl_key: req.body.account,
        bank_key: req.body.v_code,
        ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
        debit: Number(total_credit) > 0 ? Number(total_credit) : 0,
        credit: Number(total_credit) < 0 ? Math.abs(Number(total_credit)) : 0,
        updated_by: req.logedINUser,
        updated_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        v_code: req.body.v_code,
      },
      type: tallyDB.QueryTypes.UPDATE,
    });

    if (stmt.length > 0) {
      await transaction.commit();
      return res.json({ status: "success", success: true, message: "Voucher Updated Successfully" });
    } else {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Failed to update" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

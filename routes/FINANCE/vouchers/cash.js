const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");
const htmlToPdf = require("html-pdf-node");

// FETCH CASH
router.post("/fetch_cash", [auth.isAuthorized], async (req, res) => {
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

// FETCH CASH HEADER
router.post("/cash_header", [auth.isAuthorized], async (req, res) => {
  try {
    const limit = 10;
    let stmt1, stmt2;
    if (req.body.search) {
      stmt1 = await tallyDB.query("SELECT code,ladger_name,ledger_key FROM `tally_ledger` WHERE (`code` LIKE :name OR `ladger_name` LIKE :name) ORDER BY `ladger_name` ASC LIMIT :limit", {
        replacements: { name: `%${req.body.search}%`, limit: limit },
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt1 = await tallyDB.query("SELECT code,ladger_name,ledger_key FROM `tally_ledger` ORDER BY `ladger_name` ASC LIMIT :limit", { replacements: { limit: limit }, type: tallyDB.QueryTypes.SELECT });
    }

    let final = [];

    if (stmt1.length > 0) {
      for (let i = 0; i < stmt1.length; i++) {
        final.push({ id: stmt1[i].ledger_key, text: stmt1[i].ladger_name + " (" + stmt1[i].code + ")" });
      }
      return res.json(final);
    } else {
      return res.json({ status: "error", success: false, message: "Data Not Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// INSERT CASH PAYMENT
router.post("/insert_cp", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    account: "required",
    effective_date: "required",
  });

  if (validation.fails()) {
    return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  const transaction = await tallyDB.transaction();

  let valid = new Validator(req.body, {
    account: "required",
  });

  if (valid.fails()) {
    return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

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
  let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'CP'", {
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
    transaction_code = "CP/" + currYear + "-" + (currYear + 1) + "/0001";
  }


  await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'CP'", {
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
      stmt1 = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, which_module, comment, voucher_account, insert_date, insert_by, ref_date)VALUES (:ladger_key, :debit, :credit, :module_used, :which_module, :comment, :account, :insert_date, :insert_by, :ref_date)", {
        replacements: {
          ladger_key: req.body.gls[i],
          debit: Number(req.body.debit[i]),
          credit: "0",
          module_used: transaction_code,
          which_module: "CP",
          comment: req.body.comment[i],
          account: req.body.account,
          insert_by: req.logedINUser,
          insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
          ref_date: moment(req.body.effective_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD"),
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

    stmt2 = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, which_module, comment, voucher_account, insert_date, insert_by, ref_date)VALUES (:ladger_key, :debit, :credit, :module_used, :which_module, :comment, :account, :insert_date, :insert_by, :ref_date)", {
      replacements: {
        ladger_key: req.body.account,
        debit: "0",
        credit: total_debit,
        module_used: transaction_code,
        which_module: "CPM",
        comment: "Master",
        account: transaction_code,
        insert_by: req.logedINUser,
        insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        ref_date: moment(req.body.effective_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD"),
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

//INSERT BANK RECEIPT
router.post("/insert_cashreceipt", [auth.isAuthorized], async (req, res) => {
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

  const toFindDublicates = (arry) => arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(req.body.gls);
  if (dubliEle.length > 0) {
    await transaction.rollback();
    res.json({ message: "You have entered a same GLS twice of time in a single request", status: "error", success: false });
    return;
  }

  // NUMBURING FUN
  let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'CR'", {
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
    transaction_code = "CR/" + currYear + "-" + (currYear + 1) + "/0001";
  }

  await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'CR'", {
    type: tallyDB.QueryTypes.UPDATE,
    transaction: transaction,
  });
  // END NUMBURING FUN
  let total_credit = 0;
  try {
    for (let i = 0; i < glslength; i++) {
      total_credit += Number(req.body.credit[i]);
      let stmt1 = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, which_module, comment,voucher_account, insert_date, insert_by, ref_date)VALUES (:ladger_key, :debit, :credit, :module_used, :which_module, :comment, :account, :insert_date, :insert_by, :ref_date)", {
        replacements: {
          ladger_key: req.body.gls[i],
          debit: "0",
          credit: Number(req.body.credit[i]),
          module_used: transaction_code,
          which_module: "CR",
          comment: req.body.comment[i],
          account: req.body.account,
          insert_by: req.logedINUser,
          insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
          ref_date: moment(req.body.effective_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD"),
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

    let stmt2 = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, which_module, comment,voucher_account, insert_date,insert_by, ref_date)VALUES (:ladger_key, :debit, :credit, :module_used, :which_module, :comment, :account , :insert_date, :insert_by, :ref_date)", {
      replacements: {
        ladger_key: req.body.account,
        debit: total_credit,
        credit: "0",
        module_used: transaction_code,
        which_module: "CRM",
        comment: "Master",
        account: transaction_code,
        insert_by: req.logedINUser,
        insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        ref_date: moment(req.body.effective_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD"),
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

// CASH PAYMENT LIST
router.post("/cashpayment_list", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });
  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.errors.all() });
  }

  try {
    const { wise, data } = req.body;
    let main_stmt;

    if (wise == "date_wise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit`  as payment , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account` WHERE (DATE_FORMAT(`tally_ledger_data`.`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND (`which_module` = 'CP') ORDER BY `tally_ledger_data`.`ID` DESC",
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
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit`  as payment , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account` WHERE (DATE_FORMAT(`tally_ledger_data`.`ref_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND (`which_module` = 'CP') ORDER BY `tally_ledger_data`.`ID` DESC",
        {
          replacements: { date1: date1, date2: date2 },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "key_wise") {
      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit`  as payment , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE module_used = :key AND (`which_module` = 'CP') ",
        {
          replacements: { key: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "ledger_wise") {
      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit`  as payment , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE voucher_account = :key AND (`which_module` = 'CP' ) ",
        {
          replacements: { key: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({ status: "error", success: false, message: "Select valid filter option" });
    }

    let final = [];
    if (main_stmt.length > 0) {
      for (let i = 0; i < main_stmt.length; i++) {
        let obj = {
          module_used: main_stmt[i].module_used,
          ref_date: moment(main_stmt[i].ref_date).format("DD-MM-YYYY"),
          which_module: main_stmt[i].which_module,
          status: main_stmt[i].status,
          perticular: main_stmt[i].perticular,
          perticular_code: main_stmt[i].perticular_code,
          bank_name: main_stmt[i].bank_name,
          bank_name_code: main_stmt[i].bank_name_code,
          payment: main_stmt[i].payment,
          comment: main_stmt[i].comment,
        };
        final.push(obj);
      }
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// CASH RECIEPT LIST

router.post("/cashreceipt_list", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });
  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.errors.all() });
  }

  try {
    const { wise, data } = req.body;
    let main_stmt;

    if (wise == "date_wise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`credit` as payment , `tally_ledger_data`.`comment`  FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account` WHERE (DATE_FORMAT(`tally_ledger_data`.`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND (`which_module` = 'CR') ORDER BY `tally_ledger_data`.`ID` DESC",
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
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`credit` as payment , `tally_ledger_data`.`comment`  FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account` WHERE (DATE_FORMAT(`tally_ledger_data`.`ref_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND (`which_module` = 'CR') ORDER BY `tally_ledger_data`.`ID` DESC",
        {
          replacements: { date1: date1, date2: date2 },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "key_wise") {
      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`credit`  as payment , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account` WHERE voucher_account = :key AND (`which_module` = 'CRM') GROUP BY `module_used` ORDER BY tally_ledger_data.ID DESC",
        {
          replacements: { key: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "ledger_wise") {
      main_stmt = await tallyDB.query(
        "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`credit`  as payment , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account` WHERE voucher_account = :key AND (`which_module` = 'CRM') GROUP BY `module_used` ORDER BY tally_ledger_data.ID DESC",
        {
          replacements: { key: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({ status: "error", success: false, message: "Select valid filter option" });
    }

    let final = [];
    if (main_stmt.length > 0) {
      for (let i = 0; i < main_stmt.length; i++) {
        let obj = {
          module_used: main_stmt[i].module_used,
          ref_date: moment(main_stmt[i].ref_date).format("DD-MM-YYYY"),
          which_module: main_stmt[i].which_module,
          status: main_stmt[i].status,
          perticular: main_stmt[i].perticular,
          perticular_code: main_stmt[i].perticular_code,
          bank_name: main_stmt[i].bank_name,
          bank_name_code: main_stmt[i].bank_name_code,
          payment: main_stmt[i].payment,
          comment: main_stmt[i].comment,
        };
        final.push(obj);
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// CASH PAYMENT REPORT
router.post("/cash_payment_report", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    v_code: "required",
  });
  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.errors.all() });
  }

  try {
    let stmt = await tallyDB.query("SELECT tally_ledger_data.*,tally_ledger.ladger_name,tally_ledger.code FROM `tally_ledger_data` LEFT JOIN tally_ledger ON tally_ledger.ledger_key = tally_ledger_data.ladger_key WHERE which_module = 'CP' AND `tally_ledger_data`.`module_used` = :data  ", {
      replacements: { data: req.body.v_code },
      type: tallyDB.QueryTypes.SELECT,
    });

    let stmt2 = await tallyDB.query("SELECT tally_ledger_data.*,tally_ledger.ladger_name,tally_ledger.code FROM `tally_ledger_data` LEFT JOIN tally_ledger ON tally_ledger.ledger_key = tally_ledger_data.ladger_key WHERE which_module = 'CPM' AND `tally_ledger_data`.`module_used` = :data  ", {
      replacements: { data: req.body.v_code },
      type: tallyDB.QueryTypes.SELECT,
    });

    let final = [];
    let header = [];

    if (stmt2.length > 0) {
      header.push({
        account: stmt2[0].ladger_name,
        account_code: stmt2[0].code,
        ref_date: moment(stmt2[0].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
        insert_date: moment(stmt2[0].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
      });
    }

    if (stmt.length > 0) {
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          ID: Buffer.from(JSON.stringify(stmt[i].ID)).toString('base64'),
          particularID: stmt[i].ladger_key,
          particularLabel: `${stmt[i].code} ${stmt[i].ladger_name}`,
          ammount: stmt[i].debit,
          comment: stmt[i].comment,
        });
      }
      return res.json({ status: "success", success: true, data: final, header: header });
    } else {
      return res.json({ status: "error", success: false, message: "no Voucher Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// CASH PAYMENT REPORT
router.post("/cash_receipt_report", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    v_code: "required",
  });
  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.errors.all() });
  }

  try {
    let stmt = await tallyDB.query("SELECT tally_ledger_data.*,tally_ledger.ladger_name,tally_ledger.code FROM `tally_ledger_data` LEFT JOIN tally_ledger ON tally_ledger.ledger_key = tally_ledger_data.ladger_key WHERE which_module = 'CR' AND `tally_ledger_data`.`module_used` = :data  ", {
      replacements: { data: req.body.v_code },
      type: tallyDB.QueryTypes.SELECT,
    });

    let stmt2 = await tallyDB.query("SELECT tally_ledger_data.*,tally_ledger.code, tally_ledger.ladger_name FROM `tally_ledger_data` LEFT JOIN tally_ledger ON tally_ledger.ledger_key = tally_ledger_data.ladger_key WHERE which_module = 'CRM' AND `tally_ledger_data`.`module_used` = :data  ", {
      replacements: { data: req.body.v_code },
      type: tallyDB.QueryTypes.SELECT,
    });

    let final = [];
    let header = [];

    if (stmt2.length > 0) {
      header.push({
        account: stmt2[0].ladger_name,
        account_code: stmt2[0].code,
        ref_date: moment(stmt2[0].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
        insert_date: moment(stmt2[0].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
      });
    }

    if (stmt.length > 0) {
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          ID: Buffer.from(JSON.stringify(stmt[i].ID)).toString('base64'),
          particularID: stmt[i].ladger_key,
          particularLabel: `${stmt[i].code} ${stmt[i].ladger_name}`,
          ammount: stmt[i].credit,
          comment: stmt[i].comment,
        });
      }
      return res.json({ status: "success", success: true, data: final, header: header });
    } else {
      return res.json({ status: "error", success: false, message: "no Voucher Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// edit cash report
router.post("/updateCashReceipt", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    module_used: "required",
    ID: "required"
  });

  if (validation.fails()) {
    return res.json({ status: 'error', message: validation.errors.all() });
  }

  const transaction = await tallyDB.transaction();
  try {
    let total_credit = 0;
    for (let i = 0; i < req.body.ID.length; i++) {
      total_credit += Number(req.body.credit[i]);
      let main_stmt = await tallyDB.query("UPDATE tally_ledger_data SET ladger_key = :ladger_key, credit = :credit, comment= :comment, voucher_account= :voucher_account, ref_date= :ref_date, update_date = :update_dt, update_by = :update_by WHERE module_used = :module_used AND ID = :ID AND which_module = 'CR'", {
        replacements: {
          voucher_account: req.body.account,
          credit: req.body.credit[i],
          comment: req.body.comment[i],
          ladger_key: req.body.gls[i],
          ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
          module_used: req.body.module_used,
          ID: Number(Buffer.from(req.body.ID[i], 'base64').toString('utf8')),
          update_dt: moment(new Date()).tz('Asia/Kolkata').format("YYYY-MM-DD HH:mm:ss"),
          update_by: req.logedINUser
        },
        type: tallyDB.QueryTypes.UPDATE,
        transaction: transaction,
      })
      if (main_stmt.length <= 0) {
        await transaction.rollback();
        return res.json({ status: 'error', message: 'query error' });
      }
    }
    let stmt = await tallyDB.query("UPDATE tally_ledger_data SET ladger_key = :ladger_key, debit = :debit,ref_date= :ref_date, update_date = :update_dt, update_by = :update_by WHERE module_used = :module_used AND which_module = 'CRM'", {
      replacements: {
        ladger_key: req.body.account,
        debit: total_credit,
        ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
        update_dt: moment(new Date()).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
        update_by: req.logedINUser,
        module_used: req.body.module_used
      },
      type: tallyDB.QueryTypes.UPDATE,
      transaction: transaction
    });
    if (stmt.length <= 0) {
      await transaction.rollback()
      return res.json({ status: 'error', message: 'query error' });
    }

    await transaction.commit();
    return res.json({ status: 'success', message: 'updated successfully.' });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
})

// edit cash payment
router.post("/updateCashPayment", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    module_used: "required",
    ID: "required"
  });

  if (validation.fails()) {
    return res.json({ status: 'error', message: validation.errors.all() });
  }

  const transaction = await tallyDB.transaction();
  try {
    let total_debit = 0;
    for (let i = 0; i < req.body.ID.length; i++) {
      total_debit += Number(req.body.debit[i]);
      let main_stmt = await tallyDB.query("UPDATE tally_ledger_data SET ladger_key = :ladger_key, debit= :debit, comment = :comment, voucher_account= :voucher_account, ref_date= :ref_date, update_date = :update_dt, update_by= :update_by WHERE module_used = :module_used AND ID= :ID AND which_module = 'CP'", {
        replacements: {
          voucher_account: req.body.account,
          debit: req.body.debit[i],
          comment: req.body.comment[i],
          ladger_key: req.body.gls[i],
          ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
          module_used: req.body.module_used,
          ID: Number(Buffer.from(req.body.ID[i], 'base64').toString('utf8')),
          update_dt: moment(new Date()).tz('Asia/Kolkata').format("YYYY-MM-DD HH:mm:ss"),
          update_by: req.logedINUser
        },
        type: tallyDB.QueryTypes.UPDATE,
        transaction: transaction
      })
      if (main_stmt.length <= 0) {
        await transaction.rollback();
        return res.json({ status: 'error', message: 'query error' });
      }
    }

    let stmt = await tallyDB.query("UPDATE tally_ledger_data SET ladger_key = :ladger_key, credit = :credit,ref_date= :ref_date, update_date = :update_dt, update_by = :update_by WHERE module_used = :module_used AND which_module = 'CPM' ", {
      replacements: {
        ladger_key: req.body.account,
        credit: total_debit,
        ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
        update_dt: moment(new Date()).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
        update_by: req.logedINUser,
        module_used: req.body.module_used
      },
      type: tallyDB.QueryTypes.UPDATE,
      transaction: transaction
    })
    if (stmt.length <= 0) {
      await transaction.rollback()
      return res.json({ status: 'error', message: 'query error' });
    }

    await transaction.commit();
    return res.json({ status: 'success', message: 'updated successfully.' });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
})

// CASH PAYMENT PRINT
// router.post("/cashp_print", [auth.isAuthorized], async (req, res) => {
//   let validation = new Validator(req.body, {
//     v_code: "required",
//   });
//   if (validation.fails()) {
//     res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
//   }

//   try {
//     let stmt = await tallyDB.query(
//       "SELECT `a`.`ladger_name` as account_name,`a`.`code` as account_code , `u`.`key`, `u`.`debit`, `u`.`ref_date`, `u`.`credit`, `u`.`which_module`, `u`.`module_used`, `u`.`insert_date`, (CASE WHEN `v`.`ven_name` IS null AND `c`.`cust_name` IS null THEN `t`.`ladger_name` WHEN `c`.`cust_name` IS null AND `t`.`ladger_name` IS null THEN `v`.`ven_name` WHEN `v`.`ven_name` AND `t`.`ladger_name` IS null THEN `c`.`cust_name` ELSE '--' END) as value FROM ( SELECT `ladger_key` AS `key`, `debit` AS `debit`, `ref_date` AS `ref_date`, `credit` AS `credit`, `which_module` AS `which_module`, `module_used` AS `module_used`, `insert_date` AS `insert_date`, `voucher_account` FROM `tally_ledger_data`  WHERE `tally_ledger_data`.`module_used`=:data  AND ( `tally_ledger_data`.`which_module` = 'BP' OR `tally_ledger_data`.`which_module` = 'BR' )  ) u LEFT JOIN `mscorpre_ims_invt`.`ven_basic_detail` `v` ON `v`.`ven_register_id` = `u`.`key` LEFT JOIN `tally_ledger` `t` ON `t`.`ledger_key` = `u`.`key` LEFT JOIN `tally_ledger` `a` ON `a`.`ledger_key` = `u`.`voucher_account`  LEFT JOIN `mscorpre_ims_invt`.`customers` `c` ON `c`.`cust_code` = `u`.`key`",
//       {
//         replacements: { data: req.body.v_code },
//         type: tallyDB.QueryTypes.SELECT,
//       }
//     );

//     if (stmt.length > 0) {
//       let data = {
//         account: `${stmt[0].account_name} (${stmt[0].account_code})`,
//         create_date: moment(stmt[0].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
//       };

//       let particulars = "";
//       let total_debit = 0;
//       let total_credit = 0;
//       for (let i = 0; i < stmt.length; i++) {
//         particulars += `
//             <tr>
//               <td>--</td>
//               <td>${stmt[i].value}</td>
//               <td>${stmt[i].debit}</td>
//               <td>${stmt[i].credit}</td>
//             </tr>
//         `;
//         total_debit += Number(stmt[i].debit);
//         total_credit += Number(stmt[i].credit);
//       }

//       data.total_debit = total_debit;
//       data.total_credit = total_credit;

//       let options = { format: "A4", margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" } };
//       let file = { content: require("./printHtml/bp").bp(data, particulars) };

//       await htmlToPdf
//         .generatePdf(file, options)
//         .then((pdfBuffer) => {
//           res.json({ buffer: pdfBuffer });
//           // res.setHeader("Content-disposition", 'inline; filename="br.pdf"');
//           // res.setHeader("Content-type", "application/pdf");
//           // res.send(pdfBuffer);
//           // return res.json({ message: "File Generated successfully..", status: "success", success: true, data: { buffer: pdfBuffer, filename: data.min_txn_id.replace(/\//g, "_") + ".pdf" } });
//         })
//         .catch((err) => {
//           return res.json({ message: "an error while generating file", status: "error", success: false});
//         });
//     } else {
//       return res.json({ status: "error", success: false, message: "Something wrong, please try again.." });
//     }
//   } catch (err) {
//     return res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator", errors: err.stack });
//   }
// });
// // CASH RECIEPT PRINT
// router.post("/cashr_print", [auth.isAuthorized], async (req, res) => {
//   let validation = new Validator(req.body, {
//     v_code: "required",
//   });
//   if (validation.fails()) {
//     res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
//   }

//   try {
//     let stmt = await tallyDB.query(
//       "SELECT `a`.`ladger_name` as account_name,`a`.`code` as account_code , `u`.`key`, `u`.`debit`, `u`.`ref_date`, `u`.`credit`, `u`.`which_module`, `u`.`module_used`, `u`.`insert_date`, (CASE WHEN `v`.`ven_name` IS null AND `c`.`cust_name` IS null THEN `t`.`ladger_name` WHEN `c`.`cust_name` IS null AND `t`.`ladger_name` IS null THEN `v`.`ven_name` WHEN `v`.`ven_name` AND `t`.`ladger_name` IS null THEN `c`.`cust_name` ELSE '--' END) as value FROM ( SELECT `ladger_key` AS `key`, `debit` AS `debit`, `ref_date` AS `ref_date`, `credit` AS `credit`, `which_module` AS `which_module`, `module_used` AS `module_used`, `insert_date` AS `insert_date`, `voucher_account` FROM `tally_ledger_data`  WHERE `tally_ledger_data`.`module_used`=:data  AND ( `tally_ledger_data`.`which_module` = 'BP' OR `tally_ledger_data`.`which_module` = 'BR' )  ) u LEFT JOIN `mscorpre_ims_invt`.`ven_basic_detail` `v` ON `v`.`ven_register_id` = `u`.`key` LEFT JOIN `tally_ledger` `t` ON `t`.`ledger_key` = `u`.`key` LEFT JOIN `tally_ledger` `a` ON `a`.`ledger_key` = `u`.`voucher_account`  LEFT JOIN `mscorpre_ims_invt`.`customers` `c` ON `c`.`cust_code` = `u`.`key`",
//       {
//         replacements: { data: req.body.v_code },
//         type: tallyDB.QueryTypes.SELECT,
//       }
//     );

//     if (stmt.length > 0) {
//       let data = {
//         account: `${stmt[0].account_name} (${stmt[0].account_code})`,
//         create_date: moment(stmt[0].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
//       };
//       let particulars = "";
//       let total_debit = 0;
//       let total_credit = 0;
//       for (let i = 0; i < stmt.length; i++) {
//         particulars += `
//             <tr>
//               <td>--</td>
//               <td>${stmt[i].value}</td>
//               <td>${stmt[i].debit}</td>
//               <td>${stmt[i].credit}</td>
//             </tr>
//         `;
//         total_debit += Number(stmt[i].debit);
//         total_credit += Number(stmt[i].credit);
//       }

//       data.total_debit = total_debit;
//       data.total_credit = total_credit;

//       let options = { format: "A4", margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" } };
//       let file = { content: require("./printHtml/br").br(data, particulars) };

//       await htmlToPdf
//         .generatePdf(file, options)
//         .then((pdfBuffer) => {
//           res.json({ buffer: pdfBuffer });
//           // res.setHeader("Content-disposition", 'inline; filename="br.pdf"');
//           // res.setHeader("Content-type", "application/pdf");
//           // res.send(pdfBuffer);
//           // return res.json({ message: "File Generated successfully..", status: "success", success: true, data: { buffer: pdfBuffer, filename: data.min_txn_id.replace(/\//g, "_") + ".pdf" } });
//         })
//         .catch((err) => {
//           return res.json({ message: "an error while generating file", status: "error", success: false});
//         });
//     } else {
//       return res.json({ status: "error", success: false, message: "Something wrong, please try again.." });
//     }
//   } catch (err) {
//     return res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator", errors: err.stack });
//   }
// });
// DELETE CASH Voucher
// router.post("/cash_delete", [auth.isAuthorized], async (req, res) => {
//   let validation = new Validator(req.body, {
//     cash_code: "required",
//   });
//   if (validation.fails()) {
//     res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
//   }

//   try {
//     let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_data_status` = 'D',`deleted_by` = :deleted_by ,`deleted_date` = :deleted_date WHERE `tally_ledger_data`.`module_used` = :cash_code", {
//       replacements: {
//         cash_code: req.body.cash_code,
//         deleted_by: req.logedINUser,
//         deleted_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
//       },
//       type: tallyDB.QueryTypes.UPDATE,
//     });
//     if (stmt.length > 0) {
//       res.json({ status: "success", success: true, message: "Voucher Deletion Success" });
//     } else {
//       res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator" });
//     }
//   } catch (err) {
//     res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator"});
//   }
// });

// EDIT CASH PAYMENT
// router.post("/editBP", [auth.isAuthorized], async (req, res) => {
//   let validation = new Validator(req.body, {
//     v_code: "required",
//   });
//   if (validation.fails()) {
//     res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
//   }

//   try {
//     let stmt = await tallyDB.query(
//       "SELECT `tally_ledger_data`.`ID`,`tally_ledger_data`.`ladger_key`, `voucher_account`, `module_used`, `ref_date`, `which_module`, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit`  as payment , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE module_used = :key AND (`which_module` = 'BP')  AND `ledger_data_status` != 'D' ",
//       {
//         replacements: { key: req.body.v_code },
//         type: tallyDB.QueryTypes.SELECT,
//       }
//     );
//     if (stmt.length > 0) {
//       let finalData = [];
//       for (let i = 0; i < stmt.length; i++) {
//         let data = {
//           tras_id: stmt[i].ID,
//           bank_key: stmt[i].voucher_account,
//           bank_name: ` (${stmt[i].bank_name_code}) ${stmt[i].bank_name}`,
//           particular: stmt[i].perticular,
//           particular_code: stmt[i].perticular_code,
//           particular_key: stmt[i].ladger_key,
//           payment: stmt[i].payment,
//           comment: stmt[i].comment,
//           ref_date: moment(stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
//           v_code: stmt[i].module_used,
//         };
//         finalData.push(data);
//       }
//       return res.json({ status: "success", success: true, message: "Voucher Data", data: finalData });
//     } else {
//       return res.json({ status: "error", success: false, message: "Voucher can't be upadete due to some reasone " });
//     }
//   } catch (err) {
//     res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator"});
//   }
// });

// // UPDATE CASH PAYMENT
// router.post("/updateBP", [auth.isAuthorized], async (req, res) => {
//   let validation = new Validator(req.body, {
//     account: "required",
//     effective_date: "required",
//     v_code: "required",
//   });
//   if (validation.fails()) {
//     res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
//   }

//   const transaction = await tallyDB.transaction();

//   let glslength = req.body.gls.length;

//   for (let i = 0; i < glslength; i++) {
//     let validation = new Validator(
//       {
//         tras_id: req.body.tras_id[i],
//         gls: req.body.gls[i],
//         debit: Number(req.body.debit[i]),
//       },
//       {
//         gls: "required",
//         tras_id: "required",
//         debit: "required|min:1",
//       }
//     );
//     if (validation.fails()) {
//       return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
//     }
//   }

//   try {
//     let total_debit = 0;
//     for (let i = 0; i < glslength; i++) {
//       total_debit += Number(req.body.debit[i]);
//       let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ladger_key` = :gl_key,`voucher_account` = :bank_key,`ref_date` = :ref_date,`debit` = :debit,`comment` = :comment,`update_by` = :updated_by,`update_date` = :updated_date WHERE `tally_ledger_data`.`ID` = :tras_id AND `tally_ledger_data`.`module_used` = :v_code ", {
//         replacements: {
//           gl_key: req.body.gls[i],
//           bank_key: req.body.account,
//           ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
//           debit: req.body.debit[i],
//           comment: req.body.comment[i],
//           updated_by: req.logedINUser,
//           updated_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
//           tras_id: req.body.tras_id[i],
//           v_code: req.body.v_code,
//         },
//       });

//       if (stmt.length == 0) {
//         await transaction.rollback();
//         return res.json({ status: "error", success: false, message: "Updatation Failed, Please try again!!!" });
//       }
//     }

//     let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ladger_key` = :gl_key,`ref_date` = :ref_date,`credit` = :credit,`update_by` = :updated_by, `update_date` = :updated_date WHERE `tally_ledger_data`.`module_used` = :v_code AND `voucher_account` = :v_code ", {
//       replacements: {
//         gl_key: req.body.account,
//         bank_key: req.body.v_code,
//         ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
//         credit: total_debit,
//         updated_by: req.logedINUser,
//         updated_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
//         v_code: req.body.v_code,
//       },
//     });

//     if (stmt.length > 0) {
//       await transaction.commit();
//       return res.json({ status: "success", success: true, message: "Voucher Updated Successfully" });
//     } else {
//       await transaction.rollback();
//       return res.json({ status: "error", success: false, message: "Updatation Failed, Please try again!!!" });
//     }
//   } catch (err) {
//     await transaction.rollback();
//     res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator"});
//   }
// });

// // EDIT CASH RECEIPT
// router.post("/editBR", [auth.isAuthorized], async (req, res) => {
//   let validation = new Validator(req.body, {
//     v_code: "required",
//   });
//   if (validation.fails()) {
//     res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
//   }

//   try {
//     let stmt = await tallyDB.query(
//       "SELECT `tally_ledger_data`.`ID`,`tally_ledger_data`.`ladger_key`, `voucher_account`, `module_used`, `ref_date`, `which_module`, `ledegr`.`ladger_name` as perticular,`ledegr`.`code` as perticular_code, `bank`.`ladger_name` as bank_name,`bank`.`code` as bank_name_code, `tally_ledger_data`.`debit`  as payment , `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` LEFT JOIN  `tally_ledger` AS bank ON `bank`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE module_used = :key AND (`which_module` = 'BR')  AND `ledger_data_status` != 'D' ",
//       {
//         replacements: { key: req.body.v_code },
//         type: tallyDB.QueryTypes.SELECT,
//       }
//     );
//     if (stmt.length > 0) {
//       let finalData = [];
//       for (let i = 0; i < stmt.length; i++) {
//         let data = {
//           tras_id: stmt[i].ID,
//           bank_key: stmt[i].voucher_account,
//           bank_name: ` (${stmt[i].bank_name_code}) ${stmt[i].bank_name}`,
//           particular: stmt[i].perticular,
//           particular_code: stmt[i].perticular_code,
//           particular_key: stmt[i].ladger_key,
//           payment: stmt[i].payment,
//           comment: stmt[i].comment,
//           ref_date: moment(stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
//           v_code: stmt[i].module_used,
//         };
//         finalData.push(data);
//       }
//       return res.json({ status: "success", success: true, message: "Voucher Data", data: finalData });
//     } else {
//       return res.json({ status: "error", success: false, message: "Voucher can't be upadete due to some reasone " });
//     }
//   } catch (err) {
//     res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator"});
//   }
// });

// // NEED TO BE CHECKED
// // UPDATE BANK RECEIPT
// router.post("/updateBR", [auth.isAuthorized], async (req, res) => {
//   let validation = new Validator(req.body, {
//     account: "required",
//     effective_date: "required",
//     v_code: "required",
//   });
//   if (validation.fails()) {
//     res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
//   }

//   const transaction = await tallyDB.transaction();

//   let glslength = req.body.gls.length;

//   for (let i = 0; i < glslength; i++) {
//     let validation = new Validator(
//       {
//         tras_id: req.body.tras_id[i],
//         gls: req.body.gls[i],
//         credit: Number(req.body.credit[i]),
//       },
//       {
//         gls: "required",
//         tras_id: "required",
//         credit: "required|min:1",
//       }
//     );
//     if (validation.fails()) {
//       return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
//     }
//   }

//   try {
//     let total_credit = 0;
//     for (let i = 0; i < glslength; i++) {
//       total_credit += Number(req.body.credit[i]);
//       let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ladger_key` = :gl_key,`voucher_account` = :bank_key,`ref_date` = :ref_date,`credit` = :credit,`comment` = :comment,`update_by` = :updated_by,`update_date` = :updated_date WHERE `tally_ledger_data`.`ID` = :tras_id AND `tally_ledger_data`.`module_used` = :v_code ", {
//         replacements: {
//           gl_key: req.body.gls[i],
//           bank_key: req.body.account,
//           ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
//           credit: req.body.credit[i],
//           comment: req.body.comment[i],
//           updated_by: req.logedINUser,
//           updated_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
//           tras_id: req.body.tras_id[i],
//           v_code: req.body.v_code,
//         },
//       });

//       if (stmt.length == 0) {
//         await transaction.rollback();
//         return res.json({ status: "error", success: false, message: "Updatation Failed, Please try again!!!" });
//       }
//     }

//     let stmt = await tallyDB.query("UPDATE `tally_ledger_data` SET `ladger_key` = :gl_key,`ref_date` = :ref_date,`debit` = :debit,`update_by` = :updated_by, `update_date` = :updated_date WHERE `tally_ledger_data`.`module_used` = :v_code AND `voucher_account` = :v_code ", {
//       replacements: {
//         gl_key: req.body.account,
//         bank_key: req.body.v_code,
//         ref_date: moment(req.body.effective_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
//         debit: total_credit,
//         updated_by: req.logedINUser,
//         updated_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
//         v_code: req.body.v_code,
//       },
//     });

//     if (stmt.length > 0) {
//       await transaction.commit();
//       return res.json({ status: "success", success: true, message: "Voucher Updated Successfully" });
//     } else {
//       await transaction.rollback();
//       return res.json({ status: "error", success: false, message: "Updatation Failed, Please try again!!!" });
//     }
//   } catch (err) {
//     await transaction.rollback();
//     res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator"});
//   }
// });

module.exports = router;

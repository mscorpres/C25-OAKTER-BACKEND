const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
let { tallyDB, invtDB } = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");

const Validator = require("validatorjs");

// ADD LEDGER
router.post("/addLedger", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    name: "required",
    code: "required",
    sub_group: "required",
    search_name: "required",
    gst: "required",
    tds: "required",
    status: "required",
    type: "required",
  });

  if (validation.fails()) {
    return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }
  const transaction = await tallyDB.transaction();

  try {
    let stmt_check_code = await tallyDB.query("SELECT * FROM `tally_ledger` WHERE `code` = :code", {
      replacements: {
        code: req.body.code,
      },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt_check_code.length > 0) {
      return res.json({ message: "CODE allready Exist!!! ", status: "error", success: false });
    }

    let stmt_check_name = await tallyDB.query("SELECT * FROM `tally_ledger` WHERE `ladger_name` = :name", {
      replacements: {
        name: req.body.name,
      },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt_check_name.length > 0) {
      return res.json({ message: "Name allready Exist!!! ", status: "error", success: false });
    }

    let stmt = await tallyDB.query("INSERT INTO `tally_ledger` (`ledger_type` ,`ladger_name`,`search_name`,`sub_group_key`,`code`,`gst_applicable`,`tds_applicable`,`account_status`,`insert_date`,`inserted_by`,`ledger_key`)VALUES (:ledger_type, :name,:search_name,:sub_group,:code,:gst,:tds,:status,:insertdate,:inserted_by,:ledger)", {
      replacements: {
        ledger_type: req.body.type,
        name: req.body.name,
        search_name: req.body.search_name,
        gst: req.body.gst,
        tds: req.body.tds,
        status: req.body.status,
        ledger: "TP" + moment().format("YYMMDDHHmms"),
        code: req.body.code.trim(),
        sub_group: req.body.sub_group,
        insertdate: moment().format("YYYY-MM-DD HH:mm:ss"),
        inserted_by: req.logedINUser,
      },
      type: tallyDB.QueryTypes.INSERT,
      transaction: transaction,
    });

    if (stmt.length > 0) {
      await transaction.commit();
      return res.json({ message: "Ledger created successfully", status: "success", success: true });
    } else {
      await transaction.rollback();
      return res.json({ message: "an error occured while adding ledger", status: "error", success: false });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// ADD VENDOR LEDGER
router.post("/addVendorLedger", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    name: "required",
    code: "required",
    sub_group: "required",
    search_name: "required",
    gst: "required",
    tds: "required",
    status: "required",
  });

  if (validation.fails()) {
    return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }
  const transaction = await tallyDB.transaction();

  try {
    let stmt_check = await tallyDB.query("SELECT * FROM `tally_ledger` WHERE `code` = :code", {
      replacements: {
        code: req.body.code,
      },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt_check.length > 0) {
      return res.json({ message: "CODE allready Exist!!! ", status: "error", success: false });
    }
    let stmt = await tallyDB.query("INSERT INTO `tally_ledger` (`ledger_type`,`ladger_name`,`search_name`,`sub_group_key`,`code`,`gst_applicable`,`tds_applicable`,`account_status`,`insert_date`,`inserted_by`,`ledger_key`)VALUES ( 'V', :name,:search_name,:sub_group,:code,:gst,:tds,:status,:insertdate,:inserted_by,:ledger)", {
      replacements: {
        name: req.body.name,
        search_name: req.body.search_name,
        gst: req.body.gst,
        tds: req.body.tds,
        status: req.body.status,
        ledger: req.body.code.trim(),
        code: req.body.code.trim(),
        sub_group: req.body.sub_group,
        insertdate: moment().format("YYYY-MM-DD HH:mm:ss"),
        inserted_by: req.logedINUser,
      },
      type: tallyDB.QueryTypes.INSERT,
      transaction: transaction,
    });

    if (stmt.length > 0) {
      await transaction.commit();
      return res.json({ message: "Ledger created successfully", status: "success", success: true });
    } else {
      await transaction.rollback();
      return res.json({ message: "an error occured while adding ledger", status: "error", success: false });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// ADD CUSTOMER LEDGER
router.post("/addCustLedger", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    name: "required",
    code: "required",
    sub_group: "required",
    search_name: "required",
    gst: "required",
    tds: "required",
    status: "required",
  });

  if (validation.fails()) {
    return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }
  const transaction = await tallyDB.transaction();

  try {
    let stmt_check = await tallyDB.query("SELECT * FROM `tally_ledger` WHERE `code` = :code", {
      replacements: {
        code: req.body.code,
      },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt_check.length > 0) {
      return res.json({ message: "CODE allready Exist!!! ", status: "error", success: false });
    }
    let stmt = await tallyDB.query("INSERT INTO `tally_ledger` (`ledger_type`,`ladger_name`,`search_name`,`sub_group_key`,`code`,`gst_applicable`,`tds_applicable`,`account_status`,`insert_date`,`inserted_by`,`ledger_key`)VALUES ( 'CU', :name,:search_name,:sub_group,:code,:gst,:tds,:status,:insertdate,:inserted_by,:ledger)", {
      replacements: {
        name: req.body.name,
        search_name: req.body.search_name,
        gst: req.body.gst,
        tds: req.body.tds,
        status: req.body.status,
        ledger: req.body.code.trim(),
        code: req.body.code.trim(),
        sub_group: req.body.sub_group,
        insertdate: moment().format("YYYY-MM-DD HH:mm:ss"),
        inserted_by: req.logedINUser,
      },
      type: tallyDB.QueryTypes.INSERT,
      transaction: transaction,
    });

    if (stmt.length > 0) {
      await transaction.commit();
      return res.json({ message: "Ledger created successfully", status: "success", success: true });
    } else {
      await transaction.rollback();
      return res.json({ message: "an error occured while adding ledger", status: "error", success: false });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// IN MASTER FETCH ALL LEDGER LIST
router.get("/listAllLedger", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT *,tally_ledger.code as ladger_code,tally_group.code as group_code FROM `tally_ledger` LEFT join tally_group on tally_group.group_key=tally_ledger.sub_group_key ORDER by tally_ledger.id DESC", {
      type: tallyDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      let final = [];
      stmt.map((row) => {
        final.push({
          ladgerName: row.ladger_name,
          ladgerCode: row.ladger_code,
          searchName: row.search_name,
          subGroup: row.group_name + "(" + row.group_code + ")",
          gst: row.gst_applicable,
          tds: row.tds_applicable,
          accountStatus: row.account_status,
          ledgerKey: row.ledger_key
        });
        if (stmt.length == final.length) {
          return res.json(final);
        }
      });
    } else {
      return res.json({ status: "error", success: false, message: "no data found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// All Group Debit Creadit
// Chart Account
router.get("/tally", [auth.isAuthorized], async (req, res) => {
  try {
    // GET ALL LEGER DEBIT CREADIT
    // SELECT ALL LEDGER
    let ledger_stmt = await tallyDB.query("SELECT code , ledger_key,ladger_name,sub_group_key FROM `tally_ledger`", {
      type: tallyDB.QueryTypes.SELECT,
    });

    let ledger_row_data = [];

    if (ledger_stmt.length > 0) {
      let count = 0;
      // GET DEBIT CREADIT
      ledger_stmt.map(async (ledger_rows) => {
        let cal_stmt = await tallyDB.query("SELECT SUM(debit) as sum_debit , SUM(credit) as sum_credit FROM `tally_ledger_data` WHERE `ladger_key`='" + ledger_rows.ledger_key + "'", {
          type: tallyDB.QueryTypes.SELECT,
        });

        if (cal_stmt.length > 0) {
          ledger_row_data.push({
            code: ledger_rows.code,
            sub_groupKey: ledger_rows.sub_group_key,
            label: decode(ledger_rows.ladger_name),
            debit: Number(cal_stmt[0].sum_debit).toFixed(2) ?? 0,
            credit: Number(cal_stmt[0].sum_credit).toFixed(2) ?? 0,
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
              // Filter Ledger By Group Key
              data.forEach(async ({ code, group_name, group_key, parent }) => {
                let ledger_filter = ledger_row_data.filter(function (item) {
                  if (item.sub_groupKey == group_key) {
                    return true;
                  }
                });
                let total_debit = 0;
                total_debit = ledger_filter.reduce((n, { debit }) => Number(n) + Number(debit), 0);
                total_debit = total_debit ?? 0;

                let total_credit = 0;
                total_credit = ledger_filter.reduce((n, { credit }) => Number(n) + Number(credit), 0);
                total_credit = total_credit ?? 0;

                Object.assign((t[group_key] = t[group_key] || {}), {
                  parent: parent,
                  key: decode(group_name),
                  code: code,
                  label: decode(group_name),
                  Group_key: group_key,
                  legers: ledger_filter,
                  total_debit: Number(total_debit).toFixed(2),
                  total_credit: Number(total_credit).toFixed(2),
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

// Chart Account
// DATE WISE
// Chart Account WITH DATE
router.post("/tally", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      date: "required",
    });

    if (validation.fails()) {
      res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdt = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todt = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    let summary = [];

    //SELECT COALESCE(SUM(`credit`),0) AS today_credit, COALESCE(SUM(`debit`),0) AS today_debit, (SELECT COALESCE(SUM(`credit`),0) FROM `tally_ledger_data` WHERE (DATE_FORMAT(ref_date ,'%Y-%m-%d') < '2023-05-03' )) AS op_total_credit, (SELECT COALESCE(SUM(`debit`),0) FROM `tally_ledger_data` WHERE (DATE_FORMAT(ref_date ,'%Y-%m-%d') < '2023-05-03' )) AS op_total_debit FROM `tally_ledger_data` WHERE ( DATE_FORMAT(ref_date, '%Y-%m-%d') BETWEEN '2023-05-03' AND '2023-05-05' );
    // GET TOTAL DEBIT AND CREADIT
    let stmt_total_debit_creadit = await tallyDB.query("SELECT SUM(`tally_ledger_data`.`debit`) AS total_debit, SUM(`tally_ledger_data`.`credit`) AS total_credit FROM `tally_ledger_data` WHERE (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') BETWEEN :date1 AND :date2 )", {
      replacements: { date1: fromdt, date2: todt },
      type: tallyDB.QueryTypes.SELECT,
    });

    let total_ledger_debit = stmt_total_debit_creadit[0].total_debit;
    let total_ledger_credit = stmt_total_debit_creadit[0].total_credit;

    // GET TOTAL DEBIT AND CREADIT FOR OPENENIG
    let stmt2_total_debit_creadit = await tallyDB.query("SELECT SUM(`tally_ledger_data`.`debit`) AS total_debit, SUM(`tally_ledger_data`.`credit`) AS total_credit FROM `tally_ledger_data` WHERE  (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') < :date1 )", {
      replacements: { date1: fromdt, date2: todt },
      type: tallyDB.QueryTypes.SELECT,
    });

    let total_ledger_opening = Number(stmt2_total_debit_creadit[0].total_debit) - Number(stmt2_total_debit_creadit[0].total_credit);
    total_ledger_opening = Number(total_ledger_opening).toFixed(2);

    summary.push({
      total_debit: Number(total_ledger_debit).toFixed(2),
      total_credit: Number(total_ledger_credit).toFixed(2),
      opening: total_ledger_opening,
      closing: Number(Number(total_ledger_opening) + Number(total_ledger_debit) - Number(total_ledger_credit)).toFixed(2),
    });

    // GET ALL LEGER DEBIT CREADIT
    // SELECT ALL LEDGER
    let ledger_stmt = await tallyDB.query("SELECT code , ledger_key,ladger_name,sub_group_key FROM `tally_ledger`", {
      type: tallyDB.QueryTypes.SELECT,
    });

    let ledger_row_data = [];

    if (ledger_stmt.length > 0) {
      let count = 0;
      // GET DEBIT CREADIT
      ledger_stmt.map(async (ledger_rows) => {
        //SELECT SUM(`tally_ledger_data`.`debit`) AS total_debit, SUM(`tally_ledger_data`.`credit`) AS total_credit, ( SELECT SUM(`credit`) FROM `tally_ledger_data` WHERE ( DATE_FORMAT(ref_date, '%Y-%m-%d') BETWEEN '2023-03-05' AND '2023-05-10' AND `ladger_key` = 'TP566033860420' ) ) AS sum_credit, ( SELECT SUM(`debit`) FROM `tally_ledger_data` WHERE ( DATE_FORMAT(ref_date, '%Y-%m-%d') BETWEEN '2023-03-05' AND '2023-05-10' AND `ladger_key` = 'TP566033860420' ) ) AS sum_debit FROM `tally_ledger_data` WHERE ( DATE_FORMAT(ref_date, '%Y-%m-%d') < '2023-03-05' );
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
          ledger_row_data.push({
            code: ledger_rows.code,
            sub_groupKey: ledger_rows.sub_group_key,
            label: decode(ledger_rows.ladger_name),
            opening: Number(opening_ledger).toFixed(2) ?? 0,
            debit: Number(cal_stmt[0].sum_debit).toFixed(2) ?? 0,
            credit: Number(cal_stmt[0].sum_credit).toFixed(2) ?? 0,
            closing: Number(Number(opening_ledger) + Number(cal_stmt[0].sum_debit ?? 0) - Number(cal_stmt[0].sum_credit ?? 0)).toFixed(2),
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
              ledger_row_data = ledger_row_data.sort(function (a, b) {
                return a.code - b.code;
              });

              // Filter Ledger By Group Key
              data.forEach(async ({ code, group_name, group_key, parent }) => {
                let ledger_filter = ledger_row_data.filter(function (item) {
                  if (item.sub_groupKey == group_key) {
                    return true;
                  }
                });
                let total_debit = 0;
                total_debit = ledger_filter.reduce((n, { debit }) => Number(n) + Number(debit), 0);
                total_debit = total_debit ?? 0;

                let total_credit = 0;
                total_credit = ledger_filter.reduce((n, { credit }) => Number(n) + Number(credit), 0);
                total_credit = total_credit ?? 0;

                let total_opening = 0;
                total_opening = ledger_filter.reduce((n, { opening }) => Number(n) + Number(opening), 0);
                total_opening = total_opening ?? 0;

                let total_closing = 0;
                total_closing = ledger_filter.reduce((n, { closing }) => Number(n) + Number(closing), 0);
                total_closing = total_closing ?? 0;

                Object.assign((t[group_key] = t[group_key] || {}), {
                  parent: parent,
                  key: decode(group_name),
                  code: code,
                  label: decode(group_name),
                  Group_key: group_key,
                  legers: ledger_filter,
                  total_opening: Number(total_opening).toFixed(2),
                  total_debit: Number(total_debit).toFixed(2),
                  total_credit: Number(total_credit).toFixed(2),
                  total_closing: Number(total_closing).toFixed(2),
                });
                t[parent] = t[parent] || {};
                t[parent].nodes = t[parent].nodes || [];
                t[parent].nodes.push(t[group_key]);
              });
              return t[root].nodes;
            })(stmt, "--");

            return res.json({ status: "success", success: true, summary: summary, data: tree });
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

// IN MASTER LEDGER REPORT
router.post("/ledger_report", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    data: "required",
    date: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.errors.all() });
  }

  try {
    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    let gl_key = req.body.data;

    let fetchLedgerData = await tallyDB.query(
      "SELECT SUM(`tally_ledger_data`.`debit`) AS debit,`tally_ledger_data`.`ref_date`,SUM(`tally_ledger_data`.`credit`) AS credit,`tally_ledger_data`.`which_module`,`tally_ledger_data`.`module_used`,DATE_FORMAT(`tally_ledger_data`.`insert_date`, '%d-%m-%Y') as insert_date,`ladger_key` , `tally_ledger_data`.`recoStatus` FROM `tally_ledger_data`  WHERE (`tally_ledger_data`.`ladger_key`= :ladger_key) AND (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) AND `ledger_data_status` NOT IN ('D' , 'DE' , 'CN') GROUP BY tally_ledger_data.module_used ORDER BY `tally_ledger_data`.`ref_date` ASC",
      {
        replacements: { date1: date1, date2: date2, ladger_key: gl_key },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    let fetchDebitNote = await tallyDB.query(
      "SELECT SUM(`tally_ledger_data`.`debit`) AS debit,`tally_ledger_data`.`ref_date`,SUM(`tally_ledger_data`.`credit`) AS credit,'DN' AS `which_module`,`tally_ledger_data`.debit_key AS `module_used`,DATE_FORMAT(`tally_ledger_data`.`insert_date`, '%d-%m-%Y') as insert_date,`ladger_key` , `tally_ledger_data`.`recoStatus` FROM `tally_ledger_data`  WHERE (`tally_ledger_data`.`ladger_key`= :ladger_key) AND (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) AND `ledger_data_status` = 'DE' GROUP BY tally_ledger_data.debit_key ORDER BY `tally_ledger_data`.`ref_date` ASC",
      {
        replacements: { date1: date1, date2: date2, ladger_key: gl_key },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    let fetchReturnData = await tallyDB.query(
      "SELECT SUM(`tally_ledger_data`.`debit`) AS debit,`tally_ledger_data`.`ref_date`,SUM(`tally_ledger_data`.`credit`) AS credit,'CN' AS `which_module`,`tally_ledger_data`.debit_key AS `module_used`,DATE_FORMAT(`tally_ledger_data`.`insert_date`, '%d-%m-%Y') as insert_date,`ladger_key` , `tally_ledger_data`.`recoStatus` FROM `tally_ledger_data`  WHERE (`tally_ledger_data`.`ladger_key`= :ladger_key) AND (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) AND `ledger_data_status` = 'CN' GROUP BY tally_ledger_data.debit_key ORDER BY `tally_ledger_data`.`ref_date` ASC",
      {
        replacements: { date1: date1, date2: date2, ladger_key: gl_key },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    let returns = fetchDebitNote.concat(fetchReturnData);

    let stmt = fetchLedgerData.concat(returns);

    let final_data = [];
    if (stmt.length > 0) {
      for (let i = 0; i < stmt.length; i++) {
        let invoice = "--";
        let invoice_date = "--";
        let ref = "--";

        if (stmt[i].which_module == "VBT01" || stmt[i].which_module == "VBT02" || stmt[i].which_module == "VBT03" || stmt[i].which_module == "VBT04" || stmt[i].which_module == "VBT04" || stmt[i].which_module == "VBT05" || stmt[i].which_module == "VBT06" || stmt[i].which_module == "VBT07") {
          let ref_stmt = await tallyDB.query(`SELECT tally_vbt.ven_code,ven_name,vbt_invoice_no,vbt_invoice_date FROM tally_vbt LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id WHERE vbt_key = :vbt_key GROUP BY vbt_key`, {
            replacements: { vbt_key: stmt[i].module_used },
            type: tallyDB.QueryTypes.SELECT,
          });

          if (ref_stmt.length > 0) {
            ref = `( ${ref_stmt[0].ven_code} ) ${ref_stmt[0].ven_name}`;
            invoice = ref_stmt[0].vbt_invoice_no;
            invoice_date = ref_stmt[0].vbt_invoice_date;
          }
        }

        if (stmt[i].which_module == "DN") {
          let ref_stmt = await tallyDB.query(`SELECT tally_vbt.ven_code,ven_name,vbt_invoice_no,vbt_invoice_date FROM tally_vbt LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id WHERE vbt_debit_key = :debitKey GROUP BY vbt_debit_key`, {
            replacements: { debitKey: stmt[i].module_used },
            type: tallyDB.QueryTypes.SELECT,
          });

          if (ref_stmt.length > 0) {
            ref = `( ${ref_stmt[0].ven_code} ) ${ref_stmt[0].ven_name}`;
            invoice = ref_stmt[0].vbt_invoice_no;
            invoice_date = ref_stmt[0].vbt_invoice_date;
          }
        }

        if (stmt[i].which_module == "BP" || stmt[i].which_module == "BPM" || stmt[i].which_module == "BR" || stmt[i].which_module == "BRM" || stmt[i].which_module == "JV" || stmt[i].which_module == "DE" || stmt[i].which_module == "CNT") {
          let ref_stmt = await tallyDB.query("SELECT `ladger_name` FROM `tally_ledger` WHERE `ledger_key` = :key", {
            replacements: { key: stmt[i].ladger_key },
            type: tallyDB.QueryTypes.SELECT,
          });
          if (ref_stmt.length > 0) {
            if (gl_key != ref_stmt[0].ladger_name) {
              ref = ref_stmt[0].ladger_name;
            }
          }
        }


        //sales data
        if (stmt[i].which_module == "INV01" || stmt[i].which_module == "INV02" || stmt[i].which_module == "INV03") {

          const fetchInvoice = await tallyDB.query("SELECT * FROM invoice WHERE invoiceID = :invoiceID", {
            replacements: { invoiceID: stmt[i].module_used },
            type: tallyDB.QueryTypes.SELECT,
          });

          if (fetchInvoice.length > 0) {
            ref = fetchInvoice[0].shippingName;
            invoice = fetchInvoice[0].buyerOrderNo;
            invoice_date = fetchInvoice[0].buyerOrderDate;
          }
        }
        //return data
        if (stmt[i].which_module == "CN") {
          const fetchInvoice = await tallyDB.query("SELECT * FROM invoice WHERE creditNoteID = :invoiceID", {
            replacements: { invoiceID: stmt[i].module_used },
            type: tallyDB.QueryTypes.SELECT,
          });

          if (fetchInvoice.length > 0) {
            ref = fetchInvoice[0].shippingName;
            invoice = fetchInvoice[0].buyerOrderNo;
            invoice_date = fetchInvoice[0].buyerOrderDate;
          }
        }

        final_data.push({
          debit: Number(Number(stmt[i].debit).toFixed(2)).toLocaleString("en-IN"),
          ref_date: moment(stmt[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          credit: Number(Number(stmt[i].credit).toFixed(2)).toLocaleString("en-IN"),
          which_module: stmt[i].which_module,
          module_used: stmt[i].module_used,
          insert_date: stmt[i].insert_date,
          ref: ref,
          invoice_no: invoice,
          invoice_date: invoice_date,
          recoStatus: stmt[i].recoStatus
        });
      }
    }

    if (final_data.length == stmt.length) {
      // Second Process
      let summary = [];

      let stmt1 = await tallyDB.query("SELECT COALESCE(SUM(`tally_ledger_data`.`debit`), 0) AS total_debit, COALESCE(SUM(`tally_ledger_data`.`credit`), 0) AS total_credit FROM `tally_ledger_data` WHERE (`tally_ledger_data`.`ladger_key`= :ladger_key) AND (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) AND `ledger_data_status` != 'D'", {
        replacements: { date1: date1, date2: date2, ladger_key: gl_key },
        type: tallyDB.QueryTypes.SELECT,
      });

      let stmt2 = await tallyDB.query("SELECT COALESCE(SUM(`tally_ledger_data`.`debit`), 0) AS total_debit, COALESCE(SUM(`tally_ledger_data`.`credit`), 0) AS total_credit FROM `tally_ledger_data` WHERE (`tally_ledger_data`.`ladger_key`= :ladger_key) AND (DATE_FORMAT(tally_ledger_data.ref_date ,'%Y-%m-%d') < :date1 ) AND `ledger_data_status` != 'D'", {
        replacements: { date1: date1, date2: date2, ladger_key: gl_key },
        type: tallyDB.QueryTypes.SELECT,
      });

      let opening = Number(stmt2[0].total_debit) - Number(stmt2[0].total_credit);

      let closing = Number(opening) + Number(stmt1[0].total_debit) - Number(stmt1[0].total_credit)

      summary.push({
        total_debit: Number(stmt1[0].total_debit.toFixed(2)).toLocaleString("en-IN"),
        total_credit: Number(stmt1[0].total_credit.toFixed(2)).toLocaleString("en-IN"),
        opening: Number(opening.toFixed(2)).toLocaleString("en-IN"),
        closing: Number(closing.toFixed(2)).toLocaleString("en-IN"),
      });

      return res.json({ status: "success", success: true, data: { summary: summary[0], rows: final_data } });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// IN MASTER LEDGER REPORT
router.post("/ledger_options", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
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

// EDIT LEDGER
router.post("/editLedger", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let stmt = await tallyDB.query("SELECT `tally_ledger`.* ,`tally_group`.`code` as group_code,`tally_group`.`group_name`,`tally_group`.`group_key` FROM `tally_ledger` LEFT JOIN `tally_group` ON `tally_group`.`group_key` = `tally_ledger`.`sub_group_key`  WHERE `ledger_key` = :code", {
      replacements: {
        code: req.body.code,
      },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      return res.json({

        status: "success", success: true,
        data: {
          l_key: stmt[0].ledger_key,
          l_code: stmt[0].code,
          ladger_name: stmt[0].ladger_name,
          search_name: stmt[0].search_name,
          gst_applicable: stmt[0].gst_applicable,
          tds_applicable: stmt[0].tds_applicable,
          account_status: stmt[0].account_status,
          group_key: stmt[0].group_key,
          group_name: `(${stmt[0].group_code}) ${stmt[0].group_name} `,
          ledger_type: stmt[0].ledger_type,
        },
      });
    } else {
      return res.json({ status: "error", success: false, message: "Ledger not found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE LEDGER
router.post("/updateLedger", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    l_key: "required",
    name: "required",
    code: "required",
    sub_group: "required",
    search_name: "required",
    gst: "required",
    tds: "required",
    status: "required",
    type: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }
  try {
    // let stmt = await tallyDB.query("UPDATE `tally_ledger` SET `ladger_name`= :ladger_name,`sub_group_key`= :sub_group_key, `code` = :code, `gst_applicable` = :gst_applicable , `tds_applicable` = :tds_applicable ,`account_status` = :account_status, `search_name` = :search_name, `update_by` = :update_by, `update_date` = :update_date WHERE `tally_ledger`.`ledger_key` = :ledger_key", {

    let stmt = await tallyDB.query(
      " INSERT INTO `tally_ledger` (`ledger_type`, `ladger_name` , `sub_group_key` , `code` , `gst_applicable` , `tds_applicable` , `account_status` , `search_name` ,`ledger_key` ) VALUES ( :ledger_type, :ladger_name ,  :sub_group_key, :code, :gst_applicable , :tds_applicable ,:account_status,:search_name, :ledger_key) ON DUPLICATE KEY UPDATE `ledger_type` = :ledger_type , `ladger_name`= :ladger_name,`sub_group_key`= :sub_group_key, `code` = :code, `gst_applicable` = :gst_applicable , `tds_applicable` = :tds_applicable ,`account_status` = :account_status, `search_name` = :search_name, `update_by` = :update_by, `update_date` = :update_date",
      {
        replacements: {
          ledger_type: req.body.type,
          ledger_key: req.body.l_key,
          ladger_name: req.body.name,
          code: req.body.code,
          sub_group_key: req.body.sub_group,
          gst_applicable: req.body.gst,
          tds_applicable: req.body.tds,
          account_status: req.body.status,
          search_name: req.body.search_name,
          update_by: req.logedINUser,
          update_date: moment().format("YYYY-MM-DD HH:mm:ss"),
        },
        type: tallyDB.QueryTypes.INSERT,
      }
    );
    if (stmt.length > 0) {
      return res.json({ status: "success", success: true, message: "Update successfull!!!" });
    } else {
      return res.json({ status: "error", success: false, message: "Upadation failed!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE TYPE LEDGER
router.post("/update_ledger_type", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    ledger_type: "required",
    ledger_key: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }
  try {
    let stmt = await tallyDB.query("UPDATE `tally_ledger` SET `ledger_type` =:ledger_type  WHERE  `ledger_key` =:ledger_key", {
      replacements: {
        ledger_type: req.body.ledger_type,
        ledger_key: req.body.ledger_key,
      },
      type: tallyDB.QueryTypes.UPDATE,
    });
    if (stmt.length > 0) {
      return res.json({ status: "success", success: true, message: "Ledger type  updation success" });
    } else {
      return res.json({ status: "error", success: false, message: "Something happen wrong!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

router.post("/check_leadger_code", async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      code: "required",
    });
    if (validation.fails()) {
      return res.json({

        status: "error", success: false,
        message: validation.errors.all(),
      });
    }

    let stmt = await tallyDB.query("select COUNT(code) as count from tally_ledger where `code` =:code ", {
      replacements: {
        code: req.body.code,
      },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt[0].count > 0) {
      res.json({ status: "success", success: true, data: { exist: true } });
    } else {
      res.json({ status: "success", success: true, data: { exist: false } });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

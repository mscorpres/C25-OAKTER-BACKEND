const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
const { tallyDB,invtDB } = require("../../../config/db/connection");
const htmlToPdf = require("html-pdf-node");
const xlsx = require("xlsx");

// create debit voucher
router.post("/createDebitVoucher", [auth.isAuthorized], async (req, res) => {

    const transaction = await tallyDB.transaction();

    try {
        let gl_length = req.body.gl_code.length;

        for (let i = 0; i < gl_length; i++) {
            let validation = new Validator({
                effective_date: req.body.effective_date,
                gl_code: req.body.gl_code[i],
                debit: req.body.debit[i],
                credit: req.body.credit[i]
            }, {
                effective_date: "required",
                gl_code: "required",
                debit: "required",
                credit: "required",
            });

            if (validation.fails()) {
                await transaction.rollback();
                return res.json({ status: "error", success: false, message: validation.errors.all() });
            }
        }
        // NUMBURING FUN
        let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'DEBIT'", {
            type: tallyDB.QueryTypes.SELECT,
        });
        var debit_no;
        if (stmt_number.length > 0) {
            var suffix = stmt_number[0].suffix;
            suffix = parseInt(suffix) + 1;
            suffix = suffix.toString();
            suffix = suffix.padStart(parseInt(stmt_number[0].number_length_limit), "0");

            debit_no = stmt_number[0].prefix + "/" + stmt_number[0].session + "/" + suffix;
        } else {
            let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
            debit_no = "VBT01/" + currYear + "-" + (currYear + 1) + "/0001";
        }
        // END NUMBURING FUN

        await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'DEBIT'", {
            type: tallyDB.QueryTypes.UPDATE,
            transaction: transaction,
        });

        let total_debit = req.body.debit.reduce((a, b) => Number(a) + Number(b), 0);
        let total_credit = req.body.credit.reduce((a, b) => Number(a) + Number(b), 0);
        if (Number(total_credit).toFixed(2) != Number(total_debit).toFixed(2)) {
            await transaction.rollback();
            return res.json({ status: "error", success: false, message: "Debit ${total_debit} AND Credit ${total_credit} should Be equal" });
        }

        const insert_date = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

        for (let i = 0; i < gl_length; i++) {
            let stmt = await tallyDB.query("INSERT INTO tally_ledger_data (ladger_key, debit, credit,module_used,which_module,comment,insert_by,insert_date,ref_date) VALUES (:ladger_key, :debit, :credit, :module_used, :which_module, :comment, :by_user, :insert_date, :ref_date)",
                {
                    replacements: {
                        ladger_key: req.body.gl_code[i],
                        debit: req.body.debit[i],
                        credit: req.body.credit[i],
                        module_used: debit_no,
                        which_module: "DE",
                        comment: req.body.comment[i],
                        by_user: req.logedINUser,
                        insert_date: insert_date,
                        ref_date: moment(req.body.effective_date, "DD-MM-YYYY").tz("Asia/Kolkata").format("YYYY-MM-DD"),
                    },
                    type: tallyDB.QueryTypes.INSERT,
                    transaction: transaction,
                });

            if (stmt.length <= 0) {
                await transaction.rollback();
                return res.json({ status: "error", success: false, message: "Transaction Failed!" });
            }
        }

        await transaction.commit();
        return res.json({ status: "success", success: true, message: "Inserted Successfully!" });

    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

// fetch dv list
router.post("/debitVoucherList", [auth.isAuthorized], async (req, res) => {
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
                "SELECT `module_used`, `ref_date`, `which_module`, `DN_Status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` WHERE (DATE_FORMAT(`tally_ledger_data`.`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `which_module` = 'DE'",
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
                "SELECT `module_used`, `ref_date`, `which_module`, `DN_Status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` WHERE (DATE_FORMAT(`tally_ledger_data`.`ref_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `which_module` = 'DE'",
                {
                    replacements: { date1: date1, date2: date2 },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );
        }
        if (wise == "code_wise") {
            main_stmt = await tallyDB.query(
                "SELECT `module_used`, `ref_date`, `which_module`, `DN_Status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key`  WHERE `module_used` = :data  AND `which_module` = 'DE'",
                {
                    replacements: { data: data },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );
        }
        if (wise == "vendor_wise") {
            main_stmt = await tallyDB.query(
                "SELECT `module_used`, `ref_date`, `which_module`, `DN_Status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key`  WHERE tally_ledger_data.ladger_key = :data  AND `which_module` = 'DE'",
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
                    dnStatus: main_stmt[i].status,
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

// FETCH DE DETAILS
router.post("/debitVoucherDetail", [auth.isAuthorized], async (req, res) => {
    let validation = new Validator(req.body, {
        dv_key: "required",
    });
    if (validation.fails()) {
        return res.json({ status: "error", success: false, message: validation.errors.all() });
    }

    try {
        let stmt = await tallyDB.query(
            "SELECT  `tally_ledger_data`.`debit`,`tally_ledger_data`.`credit`,`tally_ledger_data`.`insert_date`,`tally_ledger_data`.`ref_date`,`tally_ledger`.`ladger_name`,`tally_ledger`.`code`,`tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON  `tally_ledger_data`.`ladger_key`=`tally_ledger`.`ledger_key` WHERE `module_used` = :data AND `which_module` = 'DE'",
            {
                replacements: { data: req.body.dv_key },
                type: tallyDB.QueryTypes.SELECT,
            }
        );

        if (stmt.length > 0) {

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


// PRINT DEBIT VOUCHER
router.post("/printDebitVoucher", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    dv_key: "required",
  });
  if (validation.fails()) {
    res.json({ message: "some fields are missing in the form.", data: validation.errors.all(), status: "error", success: false });
  }
 
  try {
    let stmt = await tallyDB.query("SELECT  `tally_ledger`.`ladger_name`,`tally_ledger`.`code`,debit,credit,ref_date,module_used FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON  `tally_ledger_data`.`ladger_key`=`tally_ledger`.`ledger_key` WHERE `module_used` = :data AND `which_module` = 'DE'", {
      replacements: { data: req.body.dv_key },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      let data = {
        dv_code: stmt[0].module_used,
        ref_date: moment(stmt[0].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
      };
 
 
      let grouped = {};
      let groupOrder = [];
 
      for (let i = 0; i < stmt.length; i++) {
        let key = stmt[i].code;
 
        if (!grouped[key]) {
          grouped[key] = {
            ladger_name: stmt[i].ladger_name,
            debit: 0,
            credit: 0,
          };
          groupOrder.push(key);
        }
 
        grouped[key].debit += Number(stmt[i].debit) || 0;
        grouped[key].credit += Number(stmt[i].credit) || 0;
      }
 
      let rows = "";
      let row_total = "";
      let total_debit = 0;
      let total_credit = 0;
 
      for (let g of groupOrder) {
        let row = grouped[g];
        rows += `
          <tr style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">
            <td style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">${row.ladger_name}</td>
            <td style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">${row.debit.toFixed(2)}</td>
            <td style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">${row.credit.toFixed(2)}</td>
          </tr>
          `;
        total_debit += row.debit;
        total_credit += row.credit;
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
      let file = { content: require("./printHtml/dvHtml").printHtml(data, rows, row_total) };
 
      await htmlToPdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          res.json({ buffer: pdfBuffer });
        })
        .catch((err) => {
          return res.json({ code: 500, message: "an error while generating file", status: "error", error: err.stack });
        });
    }
  } catch (err) {
    res.json({ code: 500, status: "error", message: { msg: "Internal Error<br/>If this condition persists, contact your system administrator" }, err: err.stack });
  }
});

// EDIT DEBIT VOUCHER
router.post("/editDebitVoucher", [auth.isAuthorized], async (req, res) => {
    let validation = new Validator(req.body, {
        dv_key: "required",
    });
    if (validation.fails()) {
        return res.json({ status: "error", success: false, message: validation.errors.all() });
    }

    try {
        let stmt = await tallyDB.query(
            "SELECT `tally_ledger_data`.`ID`, `tally_ledger_data`.`ladger_key`, `tally_ledger_data`.`module_used`, `tally_ledger_data`.`debit`,`tally_ledger_data`.`credit`,`tally_ledger_data`.`insert_date`,`tally_ledger_data`.`ref_date`,`tally_ledger`.`ladger_name`,`tally_ledger`.`code`,`tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON  `tally_ledger_data`.`ladger_key`=`tally_ledger`.`ledger_key` WHERE `module_used` = :data AND `which_module` = 'DE'",
            {
                replacements: { data: req.body.dv_key },
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
                    dv_code: stmt[i].module_used,
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

// UPDATE DEBT VOUCHER
router.post("/updateDebitVoucher", [auth.isAuthorized], async (req, res) => {
    let validation = new Validator(req.body, {
        dv_key: "required",
        effective_date: "required",
    });
    if (validation.fails()) {
        return res.json({ status: "error", success: false, message: validation.errors.all() });
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
                return res.json({ message: validation.errors.all(), status: "error", success: false });
            }
        }

        //
        let total_debit = req.body.debit.reduce((a, b) => +Number(a).toFixed(2) + +Number(b).toFixed(2), 0);
        let total_credit = req.body.credit.reduce((a, b) => +Number(a).toFixed(2) + +Number(b).toFixed(2), 0);
        if (Number(total_credit).toFixed(2) != Number(total_debit).toFixed(2)) {
            return res.json({ status: "success", success: true, message: "Debit ${Number(total_debit).toFixed(2)} AND Credit ${Number(total_credit).toFixed(2)} should be equal" });
        }

        // UPDATE DEBIT VOUCHER
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
        res.json({ status: "success", success: true, message: "Debit Voucher updated successfully" });
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

//centralised debit note register
router.get("/register", [auth.isAuthorized], async (req, res) => {
    let validation = new Validator(req.query, {
        wise: "required",
        data: "required",
    });
    if (validation.fails()) {
        return res.status(403).send(Object.values(validation.errors.all())[0].join());
    }

    try {
        const { wise, data } = req.query;
        let array1, array2;

        if (wise == "created_date_wise") {
            const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
            const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
            const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

            array1 = await tallyDB.query(
                "SELECT 'without vbt' AS docType, `module_used` AS vbt_debit_key, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` , tally_ledger_data.insert_date FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` WHERE (DATE_FORMAT(`tally_ledger_data`.`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `which_module` = 'DE' ORDER BY tally_ledger_data.ID DESC",
                {
                    replacements: { date1: date1, date2: date2 },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );

            array2 = await tallyDB.query(
                `SELECT 'with vbt' AS docType, tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key WHERE (DATE_FORMAT(tally_vbt.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND tally_vbt.vbt_status = 'DE'  ORDER BY ID DESC`,
                {
                    replacements: { date1: date1, date2: date2 },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );
        }
        if (wise == "effective_date_wise") {
            const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
            const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
            const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

            array1 = await tallyDB.query(
                "SELECT 'without vbt' AS docType, `module_used` AS vbt_debit_key, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment`, tally_ledger_data.insert_date FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` WHERE (DATE_FORMAT(`tally_ledger_data`.`ref_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `which_module` = 'DE' ORDER BY tally_ledger_data.ID DESC",
                {
                    replacements: { date1: date1, date2: date2 },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );

            array2 = await tallyDB.query(
                `SELECT 'with vbt' AS docType, tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key WHERE (DATE_FORMAT(tally_vbt.effective_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND tally_vbt.vbt_status = 'DE'  ORDER BY ID DESC`,
                {
                    replacements: { date1: date1, date2: date2 },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );
        }
        if (wise == "debit_key_wise") {
            array1 = await tallyDB.query(
                "SELECT 'without vbt' AS docType, module_used AS vbt_debit_key, ref_date, which_module, ledger_data_status as status, ledegr.ladger_name as account,ledegr.code as account_code, tally_ledger_data.debit, tally_ledger_data.credit, tally_ledger_data.comment, tally_ledger_data.insert_date FROM tally_ledger_data LEFT JOIN tally_ledger AS ledegr ON ledegr.ledger_key = tally_ledger_data.ladger_key  WHERE module_used = :data  AND which_module = 'DE' ORDER BY tally_ledger_data.ID DESC",
                {
                    replacements: { data: data },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );

            array2 = await tallyDB.query(
                `SELECT 'with vbt' AS docType, tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no ,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key WHERE tally_vbt.vbt_debit_key = :debitKey AND tally_vbt.vbt_status = 'DE'  ORDER BY ID DESC`,
                {
                    replacements: { debitKey: data },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );
        }
        if (wise == "vendor_wise") {
            array1 = await tallyDB.query(
                "SELECT 'without vbt' AS docType, `module_used` AS vbt_debit_key, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment`, tally_ledger_data.insert_date FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key`  WHERE tally_ledger_data.ladger_key = :data  AND `which_module` = 'DE' ORDER BY tally_ledger_data.ID DESC",
                {
                    replacements: { data: data },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );

            array2 = await tallyDB.query(
                `SELECT 'with vbt' AS docType, tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key WHERE tally_vbt.ven_code = :venid AND tally_vbt.vbt_status = 'DE' ORDER BY ID DESC`,
                {
                    replacements: { venid: data },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );
        }

        if (array1.length === 0 && array2.length === 0) {
            return res.json({ status: "error", success: false, message: "No data found" });
        }

        let final1 = [];
        let final2 = [];
        if (array1.length > 0) {
            for (let i = 0; i < array1.length; i++) {
                final1.push({
                    docType: array1[i].docType,
                    debitNo: array1[i].vbt_debit_key,
                    eff_dt: moment(array1[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
                    type: array1[i].which_module,
                    account: array1[i].account,
                    account_code: array1[i].account_code,
                    debit: array1[i].debit,
                    credit: array1[i].credit,
                    comment: array1[i].comment,
                    create_dt: moment(array1[i].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
                    po_id: "--",
                    project_id: "--",
                    vbt_code: "--",
                    min_id: "--",
                    status: "--",
                    invoice_no: "--",
                    part: "--",
                    part_code: "--",
                    act_qty: "--",
                    rate: "--",
                    taxable_value: "--",
                    cgst: "--",
                    sgst: "--",
                    igst: "--",
                    custom: "--",
                    freight: "--",
                    ven_bill_amm: "--",
                    vbt_gl: "--",
                    cgst_gl: "--",
                    sgst_gl: "--",
                    igst_gl: "--",
                    tds_gl: "--",
                    tds_amm: "--",
                    invoice_dt: "--",
                })
            }
        }

        if (array2.length > 0) {
            for (let i = 0; i < array2.length; i++) {
                final2.push({
                    docType: array2[i].docType,
                    po_id: array2[i].po_number ? array2[i].po_number : "",
                    project_id: array2[i].project_id ? array2[i].project_id : "",
                    vbt_code: array2[i].vbt_key ? array2[i].vbt_key : "",
                    debitNo: array2[i].vbt_debit_key,
                    min_id: array2[i].min_id,
                    status: array2[i].vbt_status,
                    type: array2[i].vbt_type,
                    invoice_no: array2[i].vbt_invoice_no,
                    account: array2[i].ven_name,
                    account_code: array2[i].ven_code,
                    part: array2[i].c_name,
                    part_code: array2[i].c_part_no,
                    act_qty: array2[i].vbt_bill_qty,
                    rate: array2[i].vbt_inrate,
                    taxable_value: array2[i].vbt_taxable_value,
                    cgst: array2[i].vbt_cgst,
                    sgst: array2[i].vbt_sgst,
                    igst: array2[i].vbt_igst,
                    custom: array2[i].custom_duty,
                    freight: array2[i].freight,
                    ven_bill_amm: array2[i].vbt_ven_ammount,
                    vbt_gl: array2[i].gl_name,
                    cgst_gl: array2[i].cgst_gl_name,
                    sgst_gl: array2[i].sgst_gl_name,
                    igst_gl: array2[i].igst_join_name,
                    tds_gl: array2[i].tds_join_name,
                    tds_amm: array2[i].vbt_tds_amount,
                    invoice_dt: array2[i].vbt_invoice_date,
                    eff_dt: moment(array2[i].effective_date).format("DD-MM-YYYY"),
                    create_dt: array2[i].insert_date,
                    debit: "--",
                    credit: "--",
                    comment: "--",
                });
            }
        }

        let result = final1.concat(final2);

        return res.json({ data: result.sort((a, b) => a.debitNo.localeCompare(b.debitNo)) });
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});


const storage1 = multer.diskStorage({
  destination: "tmp",
  filename: function (req, file, cb) {
    cb(
      null,
      "DBT" +
      Date.now() +
      Math.floor(Math.random() * 900 + 100) +
      path.extname(file.originalname),
    );
  },
});
 
const upload1 = multer({ storage: storage1 });
 
const roundTo2 = (num) => Math.round((Number(num) || 0) * 100 + Number.EPSILON) / 100;
 
 
router.post("/upload/item", upload1.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return res.json({
        code: 400,
        message:"No file uploaded. Please upload an Excel file.",
        status: "error",
        success: false,
      });
    }
 
    const filePath = req.file.path;
    const cleanup = () => {
      try { fs.unlinkSync(filePath); } catch (_) { }
    };
 
    const requiredColumns = [
      "Date", "Part Code", "Vendor Code", "Voucher No.", "Voucher Ref. No.",
      "GSTIN/UIN", "Narration", "Quantity", "UOM", "Rate", "Value", "TDS",
      "GL_Name","DN_Status"
    ];
    const MAX_ROWS = 1000;
    const MAX_NARRATION_LENGTH = 200;
 
    const workbook = xlsx.readFile(filePath, { cellDates: true });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      cleanup();
      return res.json({
        code: 400,
        message:"Excel file is empty or invalid.",
        status: "error",
        success: false,
      });
    }
 
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!worksheet || !worksheet["!ref"]) {
      cleanup();
      return res.json({
        code: 400,
        message:"Excel sheet is empty.",
        status: "error",
        success: false,
      });
    }
 
    const range = xlsx.utils.decode_range(worksheet["!ref"]);
    const rawHeaders = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cell = worksheet[xlsx.utils.encode_cell({ r: 0, c: col })];
      rawHeaders.push(cell ? String(cell.v).trim() : "");
    }
 
    const missingHeaders = requiredColumns.filter(
      (reqCol) => !rawHeaders.some((h) => h.toUpperCase() === reqCol.toUpperCase())
    );
 
    if (missingHeaders.length > 0) {
      cleanup();
      return res.json({
        code: 400,
        message:`Missing required columns: ${missingHeaders.join(", ")}`,
        status: "error",
        success: false,
      });
    }
 
    const colIndexMap = {};
    rawHeaders.forEach((header, idx) => {
      colIndexMap[header.toUpperCase()] = idx;
    });
 
    const allRows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    const data = allRows.slice(1);
 
    if (data.length === 0) {
      cleanup();
      return res.status(400).json({
        code: 400,
        message:"Excel file contains no data rows.",
        status: "error",
        success: false,
      });
    }
 
    if (data.length > MAX_ROWS) {
      cleanup();
      return res.status(400).json({
        code: 400,
        message:`Excel file exceeds max limit of ${MAX_ROWS} rows.`,
        status: "error",
        success: false,
      });
    }
 
    const normalizeAmount = (val) => {
      if (val === null || val === undefined || val === "--") return 0;
      if (typeof val === "string") {
        const trimmed = val.trim().replace(/,/g, "");
        if (trimmed === "" || trimmed === "--") return 0;
        const num = Number(trimmed);
        return isNaN(num) ? 0 : roundTo2(num);
      }
      const num = Number(val);
      return isNaN(num) ? 0 : roundTo2(num);
    };
 
    const isBlank = (val) =>
      val === null || val === undefined || String(val).trim() === "";

    for (const row of data) {
      while (row.length < rawHeaders.length) row.push(undefined);
    }
 
    const vendorCodes = [...new Set(data.map((r) => r[colIndexMap["VENDOR CODE"]]).filter(Boolean))];
    const partCodesList = [...new Set(data.map((r) => r[colIndexMap["PART CODE"]]).filter(Boolean))];
    const glCodes = [...new Set(data.map((r) => r[colIndexMap["GL_NAME"]]).filter(Boolean))];
    const tdsCodes = [...new Set(data.map((r) => r[colIndexMap["TDS"]]).filter(Boolean))];
 
    let vendorMap = new Map();
    if (vendorCodes.length > 0) {
      const vendorRows = await tallyDB.query(
        `SELECT code, ladger_name, ledger_key FROM tally_ledger WHERE code IN (:vendorCodes)`,
        {
          replacements: { vendorCodes },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
      vendorMap = new Map(vendorRows.map((v) => [v.code, v]));
    }
 
    let partMap = new Map();
    if (partCodesList.length > 0) {
      const [partRows] = await invtDB.query(
        `SELECT c_part_no, c_name, component_key FROM components WHERE c_part_no IN (:partCodes)`,
        { replacements: { partCodes: partCodesList } }
      );
      partMap = new Map(partRows.map((p) => [p.c_part_no, p]));
    }
 
    let glNameMap = {};
    if (glCodes.length > 0) {
      const glRows = await tallyDB.query(
        `SELECT ledger_key, ladger_name, code FROM tally_ledger WHERE ledger_key IN (:codes) OR code IN (:codes)`,
        {
          replacements: { codes: glCodes },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
      glNameMap = glRows.reduce((acc, r) => {
        const itemObj = { key: r.ledger_key, name: r.ladger_name, code: r.code };
        if (r.code) acc[r.code] = itemObj;
        if (r.ledger_key) acc[r.ledger_key] = itemObj;
        return acc;
      }, {});
    }
 
    let tdsMap = {};
    if (tdsCodes.length > 0) {
      const tdsRows = await tallyDB.query(
        `SELECT tally_tds.tds_key, tally_tds.tds_code, tally_tds.tds_name,
                tally_tds.tds_percent AS tds_amount, tally_tds.tds_gl_code AS gl_key, 
                tally_ledger.code AS gl_code, tally_ledger.ladger_name
         FROM tally_tds
         LEFT JOIN tally_ledger ON tally_tds.tds_gl_code = tally_ledger.ledger_key
         WHERE tally_tds.tds_code IN (:codes)`,
        {
          replacements: { codes: tdsCodes },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
      tdsMap = tdsRows.reduce((acc, r) => {
        acc[r.tds_code] = {
          tds_key: r.tds_key,
          tds_code: r.tds_code,
          name: r.tds_name,
          tds_percent: Number(r.tds_amount || 0),
          gl_code: r.ladger_name,
          gl_key: r.gl_key,
        };
        return acc;
      }, {});
    }
 
    const debitNotesGroupMap = new Map();
 
    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      const rowNumber = rowIndex + 2;
 
      const dateVal = row[colIndexMap["DATE"]];
      const partCode = row[colIndexMap["PART CODE"]];
      const vendorCode = row[colIndexMap["VENDOR CODE"]];
      const voucherNo = row[colIndexMap["VOUCHER NO."]];
      const gstin = row[colIndexMap["GSTIN/UIN"]];
      const narration = row[colIndexMap["NARRATION"]];
      const glCodeKey = row[colIndexMap["GL_NAME"]];
      const rawQuantity = row[colIndexMap["QUANTITY"]];
      const rawRate = row[colIndexMap["RATE"]];
      const dnStatus = row[colIndexMap["DN_STATUS"]];

      const dnStatusArr = ["A","C"];

      if (!dnStatusArr.includes(dnStatus.toUpperCase())) {
        cleanup();
        return res.json({ message: `Validation Failed: Invalid or missing DN_STATUS "${dnStatus}" at row [${rowNumber}]`, status: "error", success: false });
      }
 
      // Validation logic
      if (isBlank(dateVal)) {
        cleanup();
        return res.json({ message:`Validation Failed: Date is required at row [${rowNumber}]`, status: "error", success: false });
      }
      if (isBlank(voucherNo)) {
        cleanup();
        return res.json({  message: `Validation Failed: Voucher No. is required at row [${rowNumber}]`, status: "error", success: false });
      }
      if (isBlank(vendorCode) || !vendorMap.has(vendorCode)) {
        cleanup();
        return res.json({ message: `Validation Failed: Invalid or missing Vendor Code "${vendorCode}" at row [${rowNumber}]`, status: "error", success: false });
      }
      if (isBlank(partCode) || !partMap.has(partCode)) {
        cleanup();
        return res.json({  message: `Validation Failed: Invalid or missing Part Code "${partCode}" at row [${rowNumber}]`, status: "error", success: false });
      }
      if (isBlank(gstin)) {
        cleanup();
        return res.json({ message: `Validation Failed: GSTIN/UIN is required at row [${rowNumber}]`, status: "error", success: false });
      }
      if (isBlank(glCodeKey) || !glNameMap[glCodeKey]) {
        cleanup();
        return res.json({ message: `Validation Failed: Invalid or missing GL_NAME at row [${rowNumber}]`, status: "error", success: false });
      }
      if (!isBlank(narration) && String(narration).length > MAX_NARRATION_LENGTH) {
        cleanup();
        return res.json({ message: `Validation Failed: Narration exceeds ${MAX_NARRATION_LENGTH} characters at row [${rowNumber}]`, status: "error", success: false });
      }

      if(isBlank(dnStatus)){
        cleanup();
        return res.json({ message: `Validation Failed: DN_STATUS is required at row [${rowNumber}]`, status: "error", success: false });
      }
 
      const quantity = normalizeAmount(rawQuantity);
      if (quantity <= 0) {
        cleanup();
        return res.json({ message: `Validation Failed: Quantity is required and must be > 0 at row [${rowNumber}]`, status: "error", success: false });
      }
 
      const rate = normalizeAmount(rawRate);
      if (rate <= 0) {
        cleanup();
        return res.status(400).json({ message: `Validation Failed: Rate is required and must be > 0 at row [${rowNumber}]`, status: "error", success: false });
      }

 
      const value = normalizeAmount(row[colIndexMap["VALUE"]]);
      const igst = normalizeAmount(row[colIndexMap["IGST_INPUT_REVERSAL"]]);
      const sgst = normalizeAmount(row[colIndexMap["SGST_INPUT_REVERSAL"]]);
      const cgst = normalizeAmount(row[colIndexMap["CGST_INPUT_REVERSAL"]]);
 
      // ── Single signed Round_off column ──
      // Negative value => debit, Positive value => credit
      const roundOffRaw = normalizeAmount(row[colIndexMap["ROUND_OFF"]]);
      const roundOffDebit = roundOffRaw < 0 ? Math.abs(roundOffRaw) : 0;
      const roundOffCredit = roundOffRaw > 0 ? roundOffRaw : 0;
 
      const vendorInfo = vendorMap.get(vendorCode);
      const partInfo = partMap.get(partCode);
      const glInfo = glNameMap[glCodeKey] || null;
 
      // TDS Calculation (Treating 2 as 2%, 0.1 as 0.1%)
      const tdsCode = row[colIndexMap["TDS"]];
      const rowTdsDetails = [];
      let itemTdsAmount = 0;
      let tdsPercent = 0;
 
      if (tdsCode && tdsMap[tdsCode]) {
        const masterTds = tdsMap[tdsCode];
        tdsPercent = masterTds.tds_percent || 0;
        itemTdsAmount = roundTo2((value * tdsPercent) / 100);
        // itemTdsAmount = Math.ceil((value * tdsPercent) / 100);
 
        rowTdsDetails.push({
          tdsCode: masterTds.tds_code,
          tdsPercent: tdsPercent,
          tdsAmount: itemTdsAmount,
          masterDetails: {
            tds_key: masterTds.tds_key,
            tds_code: masterTds.tds_code,
            name: masterTds.name,
            gl_code: masterTds.gl_code,
            gl_key: masterTds.gl_key,
          },
        });
      }
 
      const itemObj = {
        partCode,
        partName: partInfo.c_name,
        componentKey: partInfo.component_key,
        narration,
        quantity,
        uom: row[colIndexMap["UOM"]],
        rate,
        value,
        glDetails: glInfo,
        tdsDetails: rowTdsDetails,
        tdsAmount: itemTdsAmount,
      };
 
      // Grouping Key based on Voucher No + Vendor Code
      const groupKey = `${voucherNo.trim().toUpperCase()}_${vendorCode.trim().toUpperCase()}`;
 
      if (!debitNotesGroupMap.has(groupKey)) {
        debitNotesGroupMap.set(groupKey, {
          voucherNo,
          date: dateVal,
          vendorCode: vendorInfo.ledger_key,
          venName: vendorInfo.ladger_name,
          venRegisterId: vendorCode,
          voucherRefNo: row[colIndexMap["VOUCHER REF. NO."]],
          gstin,
          items: [itemObj],
          taxes: {
            igstInputReversal: igst,
            sgstInputReversal: sgst,
            cgstInputReversal: cgst,
          },
          roundOff: roundOffRaw,
          taxableValue: value,
          totalTdsAmount: itemTdsAmount,
          totalValue: roundTo2(value + igst + sgst + cgst - itemTdsAmount + roundOffCredit - roundOffDebit),
          dnStatus: dnStatus == "A" ? "ACTIVE" : "CANCELLED",
        });
      } else {
        const existingGroup = debitNotesGroupMap.get(groupKey);
        existingGroup.items.push(itemObj);

        existingGroup.taxableValue = roundTo2(existingGroup.taxableValue + value);
        existingGroup.totalTdsAmount = roundTo2(existingGroup.totalTdsAmount + itemTdsAmount);
        existingGroup.taxes.igstInputReversal = roundTo2(existingGroup.taxes.igstInputReversal + igst);
        existingGroup.taxes.sgstInputReversal = roundTo2(existingGroup.taxes.sgstInputReversal + sgst);
        existingGroup.taxes.cgstInputReversal = roundTo2(existingGroup.taxes.cgstInputReversal + cgst);
        existingGroup.roundOff = roundTo2(existingGroup.roundOff + roundOffRaw);
        const currentItemTotal = value + igst + sgst + cgst - itemTdsAmount + roundOffCredit - roundOffDebit;
        existingGroup.totalValue = roundTo2(existingGroup.totalValue + currentItemTotal);
      }
    }
 
    cleanup();
 
    const debitNotes = Array.from(debitNotesGroupMap.values());
 
    return res.json({
      code: 200,
      success:true,
      data: { debitNotes },
      message: "Excel file processed successfully.",
      status: "success",
    });
 
  } catch (error) {
    console.log(error);
    if (req.file && req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch (_) { }
    }
    return res.json({
      code: 500,
      message: "Internal Error! If this persists, contact your system administrator.",
      error: error.message,
      status: "error",
      success: false,
    });
  }
});
 
 
router.post("/create-bulk-debit-note", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    debitNotes: "required|array|min:1",
    "debitNotes.*.vendorCode": "required",
    "debitNotes.*.gstin": "required",
    "debitNotes.*.date": "required",
    "debitNotes.*.items": "required|array|min:1",
    "debitNotes.*.items.*.partCode": "required",
    "debitNotes.*.items.*.quantity": "required|numeric",
    "debitNotes.*.items.*.rate": "required|numeric",
    "debitNotes.*.items.*.value": "required|numeric",
    "debitNotes.*.items.*.glDetails.key": "required",
    "debitNotes.*.dnStatus": "required",
  });
 
  if (validation.fails()) {
    return res.json({
      code: 500,
      status: "error",
      message: validation.errors.all(),
    });
  }
 
  const FIXED_LEDGERS = {
    cgst: "TP833329493527",
    sgst: "TP169441804733",
    igst: "TP145525070328",
    roundOff: "TP558350023869",
  };
 
  const insert_by = req.logedINUser;
  // const insert_by = "CRN8527467";
  const insert_date = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
 
  const transaction = await tallyDB.transaction();
 
  try {
    const debitNotesInput = req.body.debitNotes;
    const createdNotes = [];
 
    // Helper: Get next debit voucher number
    const getNextDebitNo = async () => {
      const stmt_number = await tallyDB.query(
        "SELECT * FROM `tally_numbering` WHERE `for_number` = 'DEBIT' FOR UPDATE",
        { type: tallyDB.QueryTypes.SELECT, transaction }
      );
 
      let debit_no;
 
      if (stmt_number.length > 0) {
        let suffix = parseInt(stmt_number[0].suffix) + 1;
        suffix = suffix.toString().padStart(parseInt(stmt_number[0].number_length_limit), "0");
        debit_no = `${stmt_number[0].prefix}/${stmt_number[0].session}/${suffix}`;
 
        await tallyDB.query(
          "UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number` = 'DEBIT'",
          { type: tallyDB.QueryTypes.UPDATE, transaction }
        );
      } else {
        const currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
        const session = `${currYear}-${currYear + 1}`;
        debit_no = `DN/${session}/0001`;
 
        await tallyDB.query(
          "INSERT INTO `tally_numbering` (`for_number`, `prefix`, `session`, `suffix`, `number_length_limit`) VALUES ('DEBIT', 'DN', :session, '0001', 4)",
          { replacements: { session }, type: tallyDB.QueryTypes.INSERT, transaction }
        );
      }
 
      return debit_no;
    };
 
    // Helper: Insert line item into tally_ledger_data (gstin added)
    const insertLedgerLine = async ({
      txnType,
      ladger_key,
      debit = 0,
      credit = 0,
      module_used = "--",
      debit_key,
      effective_date,
      comment = "--",
      dnStatus = "ACTIVE",
    }) => {
      await tallyDB.query(
        `INSERT INTO \`tally_ledger_data\` (
          txn_type,ladger_key, debit, credit, module_used, debit_key, insert_date, 
          which_module, ledger_data_status, ref_date, insert_by,comment,DN_Status
        ) VALUES (
          :txnType,:ladger_key, :debit, :credit, :module_used, :debit_key, :insert_date, 
          :which_module, :ledger_data_status, :effective_date, :insert_by,:comment,:dnStatus
        )`,
        {
          replacements: {
            txnType,
            ladger_key,
            debit,
            credit,
            module_used,
            debit_key,
            insert_date,
            which_module: "DE",
            ledger_data_status: "--",
            effective_date,
            insert_by,
            comment,
            dnStatus
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction,
        }
      );
    };
 
    // Loop through each Debit Note in the array
    for (let n = 0; n < debitNotesInput.length; n++) {
      const note = debitNotesInput[n];

      // ── Normalize dnStatus to DB ENUM ('ACTIVE' | 'CANCELLED') ──
      const rawStatus = String(note.dnStatus || note.DN_Status || "").trim().toUpperCase();
      const dnStatus = (rawStatus === "CANCEL" || rawStatus === "CANCELLED" || rawStatus === "CANCELED")
        ? "CANCELLED"
        : "ACTIVE";
 
      if (!note.items || note.items.length === 0) {
        await transaction.rollback();
        return res.json({
          code: 500,
          status: "error",
          message: `Debit note at index [${n}] (voucher "${note.voucherNo || "-"}") has no items.`,
        });
      }
 
      const noteGstin = note.gstin || "--";
      const taxes = note.taxes || {};
      const igst = Number(taxes.igstInputReversal || 0);
      const sgst = Number(taxes.sgstInputReversal || 0);
      const cgst = Number(taxes.cgstInputReversal || 0);
 
      // ── Single signed Round_off value ──
      // Negative => debit, Positive => credit
      const roundOffValue = Number(note.roundOff || 0);
      const roundOffDebit = roundOffValue < 0 ? Math.abs(roundOffValue) : 0;
      const roundOffCredit = roundOffValue > 0 ? roundOffValue : 0;
 
      const taxableValue = Number(note.taxableValue || 0);
      const totalTdsAmount = Number(note.totalTdsAmount || 0);
      const totalValue = Number(note.totalValue || 0);
 
      // Debit / Credit Balance check
      const calculated_debit = totalValue + roundOffDebit + totalTdsAmount;
      // Credits: Item Values + Tax Reversals + Round-Off Credit
      const calculated_credit = taxableValue + igst + cgst + sgst + roundOffCredit;
 
 
      if (Math.abs(Number(calculated_debit.toFixed(2)) - Number(calculated_credit.toFixed(2))) > 1) {
        await transaction.rollback();
        return res.json({
          code: 500,
          status: "error",
          message: `Debit(${calculated_debit.toFixed(2)}) And Credit Value(${calculated_credit.toFixed(2)}) Not Matched for voucher "${note.voucherNo || "-"}" (index [${n}])!!!`,
        });
      }
 
      const invoiceMoment = moment(note.date, "DD-MM-YYYY", true);
 
      if (!invoiceMoment.isValid()) {
        await transaction.rollback();
 
        return res.json({
          code: 400,
          status: "error",
          message: `Invalid date "${note.date}" for voucher "${note.voucherNo || "-"}" (index [${n}]). Expected format: DD-MM-YYYY`,
        });
      }
 
      const effective_date = invoiceMoment.format("YYYY-MM-DD");
 
      const debit_no = await getNextDebitNo();
      const vbt_debit_key = debit_no;
      let txnType = "--";
 
      // ── 1. Insert Item Entries ──
      for (let i = 0; i < note.items.length; i++) {
        const item = note.items[i];
 
        const componentData = await invtDB.query(
          `SELECT c_type FROM components WHERE component_key = :partCode LIMIT 1`,
          {
            replacements: {
              partCode: item.partCode,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
 
        if (componentData.length === 0) {
          await transaction.rollback();
 
          return res.json({
            code: 500,
            status: "error",
            message: `Component ${item.partCode} not found in components master`,
          });
        }
 
        txnType =
          componentData[0].c_type === "R"
            ? "RAW"
            : componentData[0].c_type === "S"
              ? "SER"
              : "--";
        const itemTds = (item.tdsDetails && item.tdsDetails[0]) || null;
        const itemTdsAmount = Number(item.tdsAmount || (itemTds ? itemTds.tdsAmount : 0) || 0);
        // const vbt_key = item.componentKey || `${debit_no}-${i + 1}`;
 
        if (Number(item.value || 0) > 0) {
          if (!item.glDetails || !item.glDetails.key || item.glDetails.key === "--") {
            await transaction.rollback();
            return res.json({
              code: 500,
              success: false,
              status: "error",
              message:`Something wrong!!! (GL OPTION) — part "${item.partCode}" in voucher "${note.voucherNo || "-"}"`
            });
          }
 
          await insertLedgerLine({
            txnType: txnType,
            ladger_key: item.glDetails.key,
            debit: 0,
            credit: item.value || 0,
            module_used: vbt_debit_key,
            debit_key: "--",
            effective_date,
            insert_date,
            which_module: "DE",
            insert_by,
            comment: item.narration || note.narration || "--",
            dnStatus
          });
        }
 
        // TDS Entry
        if (itemTdsAmount > 0) {
          if (!itemTds || !itemTds.masterDetails || !itemTds.masterDetails.gl_key) {
            await transaction.rollback();
            return res.json({
              code: 500,
              status: "error",
              message: { msg: `Something wrong!!! (TDS OPTION) — part "${item.partCode}" in voucher "${note.voucherNo || "-"}"` },
            });
          }
 
          console.log(itemTds.masterDetails.gl_key, "========= details =====");
          await insertLedgerLine({
            txnType: txnType,
            ladger_key: itemTds.masterDetails.gl_key,
            debit: itemTdsAmount,
            credit: 0,
            module_used: vbt_debit_key,
            debit_key: "--",
            effective_date,
            insert_date,
            which_module: "DE",
            insert_by,
            dnStatus
          });
        }
      }
 
      // ── 2. Tax / Round-Off Entries ──
      if (cgst > 0) {
        await insertLedgerLine({
          txnType: txnType,
          ladger_key: FIXED_LEDGERS.cgst,
          debit: 0,
          credit: cgst,
          module_used: vbt_debit_key,
          debit_key: "--",
          effective_date,
          insert_date,
          which_module: "DE",
          insert_by,
          dnStatus
        });
      }
 
      if (sgst > 0) {
        await insertLedgerLine({
          txnType: txnType,
          ladger_key: FIXED_LEDGERS.sgst,
          debit: 0,
          credit: sgst,
          module_used: vbt_debit_key,
          debit_key: "--",
          effective_date,
          insert_date,
          which_module: "DE",
          insert_by,
          dnStatus
        });
      }
 
      if (igst > 0) {
        await insertLedgerLine({
          txnType: txnType,
          ladger_key: FIXED_LEDGERS.igst,
          debit: 0,
          credit: igst,
          module_used: vbt_debit_key,
          debit_key: "--",
          effective_date,
          insert_date,
          which_module: "DE",
          insert_by,
          dnStatus
        });
      }
 
      // ── Round-Off (single signed value) ──
      // roundOff > 0 -> credit, roundOff < 0 -> debit
      if (roundOffValue !== 0) {
        await insertLedgerLine({
          txnType: txnType,
          ladger_key: FIXED_LEDGERS.roundOff,
          debit: roundOffDebit,
          credit: roundOffCredit,
          module_used: vbt_debit_key,
          debit_key: "--",
          effective_date,
          which_module: "DE",
          insert_by,
          dnStatus
        });
      }
 
      // ── 3. Vendor Entry ──
      await insertLedgerLine({
        txnType: txnType,
        ladger_key: note.vendorCode,
        debit: totalValue,
        credit: 0,
        module_used: vbt_debit_key,
        debit_key: "--",
        effective_date,
        insert_date,
        which_module: "DE",
        insert_by,
        dnStatus
      });
 
      createdNotes.push({
        debitNo: debit_no,
        originalVoucherNo: note.voucherNo || null,
        vendorCode: note.vendorCode,
        totalValue,
        totalTdsAmount,
      });
    }
 
    await transaction.commit();
 
    return res.json({
      code: 200,
      success:true,
      status: "success",
      message: "Insertion Successful",
      data: { debitNotes: createdNotes },
    });
  } catch (error) {
    console.log(error);
    await transaction.rollback();
    return res.json({
      code: 500,
      status: "error",
      message:"Internal Error<br/>If this condition persists, contact your system administrator",
      err: error.stack,
    });
  }
});



router.post("/cancel-debit-note", [auth.isAuthorized], async (req, res) => {
  const { debitNo, cancelReason } = req.body;

  let validation = new Validator(req.body, {
    debitNo: "required",
    cancelReason: "required",
  });
  if (validation.fails()) {
    return res.json({success: false, code: 500, status: "error", message: validation.errors.all() });
  }

  const insert_by = req.logedINUser;
  const update_date = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  let transaction;
  try {
    transaction = await tallyDB.transaction();

    // 1. Check if the debit note exists
    const existingEntries = await tallyDB.query(
      `SELECT module_used, DN_Status
       FROM tally_ledger_data
       WHERE module_used = :debitNo AND which_module = 'DE'
       FOR UPDATE`,
      {
        replacements: { debitNo },
        type: tallyDB.QueryTypes.SELECT,
        transaction,
      }
    );

    if (existingEntries.length === 0) {
      await transaction.rollback();
      return res.json({
        code: 404,
        success: false,
        status: "error",
        message:`Debit Note "${debitNo}" not found.`,
      });
    }

    // 2. Prevent redundant cancellation
    const isAlreadyCancelled = existingEntries.every(
      (row) => row.DN_Status === "CANCELLED"
    );

    if (isAlreadyCancelled) {
      await transaction.rollback();
      return res.json({
        code: 400,
        success: false,
        status: "error",
        message: `Debit Note "${debitNo}" is already cancelled.`,
      });
    }

    // 3. Zero out debit/credit and set status to CANCELLED
    await tallyDB.query(
      `UPDATE tally_ledger_data
       SET DN_Status = 'CANCELLED',
           cancel_reason = :cancelReason,
           update_date = :update_date,
           update_by = :insert_by
       WHERE module_used = :debitNo AND which_module = 'DE'`,
      {
        replacements: { debitNo, cancelReason, update_date, insert_by },
        type: tallyDB.QueryTypes.UPDATE,
        transaction,
      }
    );

    await transaction.commit();

    return res.json({
      code: 200,
      success: true,
      status: "success",
      message: `Debit Note "${debitNo}" has been successfully cancelled.`,
    });
  } catch (error) {
    console.error("Error cancelling debit note:", error);
    if (transaction) await transaction.rollback();
    return res.json({
      code: 500,
      success: false,
      status: "error",
      message: "Internal Error<br/>If this condition persists, contact your system administrator",
      err: error.stack,
    });
  }
});


module.exports = router;
const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
const { tallyDB } = require("../../../config/db/connection");
const htmlToPdf = require("html-pdf-node");


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
                "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` WHERE (DATE_FORMAT(`tally_ledger_data`.`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `which_module` = 'DE'",
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
                "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key` WHERE (DATE_FORMAT(`tally_ledger_data`.`ref_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `which_module` = 'DE'",
                {
                    replacements: { date1: date1, date2: date2 },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );
        }
        if (wise == "code_wise") {
            main_stmt = await tallyDB.query(
                "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key`  WHERE `module_used` = :data  AND `which_module` = 'DE'",
                {
                    replacements: { data: data },
                    type: tallyDB.QueryTypes.SELECT,
                }
            );
        }
        if (wise == "vendor_wise") {
            main_stmt = await tallyDB.query(
                "SELECT `module_used`, `ref_date`, `which_module`, `ledger_data_status` as status, `ledegr`.`ladger_name` as account,`ledegr`.`code` as account_code, `tally_ledger_data`.`debit`, `tally_ledger_data`.`credit`, `tally_ledger_data`.`comment` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` AS ledegr ON `ledegr`.`ledger_key` = `tally_ledger_data`.`ladger_key`  WHERE tally_ledger_data.ladger_key = :data  AND `which_module` = 'DE'",
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
            let file = { content: require("./printHtml/dvHtml").printHtml(data, rows, row_total) };

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

module.exports = router;
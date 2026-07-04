const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/ven_auth");
const permission = require("../../../../middleware/permission");
let { invtDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");
const XLSX = require("xlsx");

// CONSUMPTION REPORT MAIL
router.get("/dailyTransactionMailreport", [auth.isAuthorized], async (req, res) => {
    try {

        const valid = new Validator(req.query , {
            vendor: "required",
            // date: "required",
            // email: "required"
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        // const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
        // const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
        // const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

        const date = moment(new Date()).subtract(1, 'days').format("YYYY-MM-DD")
        const fromdate = date;
        const todate = date;

        const workbook = XLSX.utils.book_new();

        // CONSUMPTION

        const stmt = await invtDB.query("SELECT jw_ven_location.*, components.c_part_no, components.c_name , units.units_name FROM jw_ven_location LEFT JOIN components ON components.component_key = jw_ven_location.jw_ven_rm LEFT JOIN units ON units.units_id = components.c_uom WHERE jw_ven_code = :vendor AND (DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') BETWEEN :data1 AND :data2) AND jw_ven_txn_type = 'RM-CONSUMPTION'", {
            replacements: {
                vendor: req.query.vendor,
                data1: fromdate,
                data2: todate
            },
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt.length > 0) {
            const consumtions_data = [];
            for (let i = 0; i < stmt.length; i++) {
                consumtions_data.push({
                    PART_NO: stmt[i].c_part_no,
                    PART_NAME: stmt[i].c_name,
                    UNIT: stmt[i].units_name,
                    QTY: stmt[i].jw_ven_in_qty,
                    HSN: stmt[i].jw_ven_part_hsn,
                    DOC_REF_NO: stmt[i].jw_ven_challan_ref,
                    DOC_DATE: moment(stmt[i].jw_ven_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
                    CREATE_DATE: moment(stmt[i].jw_ven_insert_dt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
                });
            }
            const worksheet = XLSX.utils.json_to_sheet(consumtions_data);
            XLSX.utils.book_append_sheet(workbook, worksheet, "Consumptions");
        }


        // RM INWARD
        const stmt_rm_inward = await invtDB.query("SELECT jw_ven_location.*, components.c_part_no, components.c_name , units.units_name FROM jw_ven_location LEFT JOIN components ON components.component_key = jw_ven_location.jw_ven_rm LEFT JOIN units ON units.units_id = components.c_uom WHERE jw_ven_code = :vendor AND (DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') BETWEEN :data1 AND :data2) AND jw_ven_txn_type = 'RM-INWARD'", {
            replacements: {
                vendor: req.query.vendor,
                data1: fromdate,
                data2: todate
            },
            type: invtDB.QueryTypes.SELECT
        });


        if (stmt_rm_inward.length > 0) {
            const inward_data = [];
            for (let i = 0; i < stmt_rm_inward.length; i++) {
                inward_data.push({
                    PART_NO: stmt_rm_inward[i].c_part_no,
                    PART_NAME: stmt_rm_inward[i].c_name,
                    UNIT: stmt_rm_inward[i].units_name,
                    QTY: stmt_rm_inward[i].jw_ven_in_qty,
                    HSN: stmt_rm_inward[i].jw_ven_part_hsn,
                    JOB_WORK_ID: stmt_rm_inward[i].jw_ven_jw_ref,
                    CHALLAN_ID: stmt_rm_inward[i].jw_ven_challan_ref,
                    TRANSACTION_ID: stmt_rm_inward[i].jw_ven_txn,
                    CREATE_DATE: moment(stmt_rm_inward[i].jw_ven_insert_dt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
                });
            }
            const worksheet = XLSX.utils.json_to_sheet(inward_data);
            XLSX.utils.book_append_sheet(workbook, worksheet, "RM INWARS");
        }


        // SFG INWARD

        const stmt_sfg_inward = await invtDB.query("SELECT jw_ven_sfg_location.*, admin_login.user_name FROM jw_ven_sfg_location LEFT JOIN admin_login ON admin_login.CustID = jw_ven_sfg_location.jw_ven_sfg_insert_by WHERE jw_ven_id = :vendor AND DATE_FORMAT(jw_ven_sfg_insert_dt ,'%Y-%m-%d') BETWEEN :data1 AND :data2 ", {
            replacements: {
                data1: fromdate,
                data2: todate,
                vendor: req.query.vendor,
            },
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt_sfg_inward.length > 0) {
            const sf_data = [];
            for (let i = 0; i < stmt_sfg_inward.length; i++) {
                sf_data.push({
                    JW_ID: stmt_sfg_inward[i].jw_ven_sfg_jwid,
                    JS_CHALLAN: stmt_sfg_inward[i].jw_ven_sfg_jw_challan,
                    SKU: stmt_sfg_inward[i].jw_ven_sfg_sku,
                    QTY: stmt_sfg_inward[i].jw_ven_sfg_qty,
                    RATE: stmt_sfg_inward[i].jw_ven_sfg_rate,
                    CREATE_DATE: moment(stmt_sfg_inward[i].jw_ven_sfg_insert_dt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY"),
                    CREATE_BY: stmt_sfg_inward[i].user_name
                });
            }
            const worksheet = XLSX.utils.json_to_sheet(sf_data);
            XLSX.utils.book_append_sheet(workbook, worksheet, "SFG INWARD");
        }


        const fileName = "Daily Transaction Report " + date + ".xlsx";
        const filePath = "./files/excel/";

        XLSX.writeFile(workbook, filePath + fileName);

        
        let to = "yogesh.garg@mscorpres.in,vishul@oakter.com";
        // const stmt_get_mail = await invtDB.query("SELECT Email_ID FROM admin_login WHERE CustID IN (:email)", {
        //     replacements: {
        //         email: req.body.email
        //     },
        //     type: invtDB.QueryTypes.SELECT
        // })
        // for (let i = 0; i < stmt_get_mail.length; i++) {
        //     to = to + stmt_get_mail[i].Email_ID + ","
        // }
        const attachment = [
            {
                filename: fileName,
                path: filePath + fileName,
            },
        ]

        helper.sendMail(to, null, "Daily Transaction Report [" + date + "]", "Please find the attachment, as report of daily Daily Transaction based on date " + date, attachment);

        return res.json({ message: "Report generated successfully", status: "success", success: true });

    }
    catch (error) {
        return res.json({ message: "Internal Error!!! If this condition persists, contact your system administrator", status: "error", success: false});
    }
});

module.exports = router;
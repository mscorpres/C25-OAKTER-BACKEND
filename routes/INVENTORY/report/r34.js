const { invtDB } = require("../../../config/db/connection");
const express = require("express");
const router = express.Router();
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

router.post("/", [auth.isAuthorized], async (req, res) => {
    const valid = new Validator(req.body, {
        date: "required",
    });

    if (valid.fails()) {
        return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
    const diffDays = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "days");

    if (diffDays > 90) {
        return res.json({ status: "error", success: false, message: "We can provide you 90 days OR (3 months) data only" });
    }

    try {
        const stmt = await invtDB.query(`
            SELECT 
                rm_location.*, 
                admin_login.user_name, 
                fg_return.qty_return, 
                products.p_name, 
                products.p_sku, 
                fg_return_log.executed_remark AS remark, 
                fg_return_log.executed_qty AS qty -- Fetch qty from fg_return_log
            FROM rm_location 
            LEFT JOIN fg_return ON fg_return.fg_return_txn = rm_location.reversal_txn_id 
            LEFT JOIN admin_login ON admin_login.CustID = rm_location.insert_by 
            LEFT JOIN products ON products.product_key = fg_return.product_id 
            LEFT JOIN fg_return_log ON fg_return_log.fg_return_key = rm_location.fg_rtn_refid 
            WHERE in_module = 'IN-FGRETURN' 
            AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 
            AND fg_return.company_branch = :branch 
            GROUP BY rm_location.reversal_txn_id, rm_location.fg_rtn_refid
        `, {
            replacements: { date1: fromdate, date2: todate, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
        });

        if (stmt.length > 0) {
            const data = [];
            for (let i = 0; i < stmt.length; i++) {
                data.push({
                    reversal_Txn_id: stmt[i].reversal_txn_id,
                    rtn_ref_id: stmt[i].fg_rtn_refid,
                    product: stmt[i].p_name,
                    sku: stmt[i].p_sku,
                    qty: stmt[i].qty, 
                    insert_dt: moment(stmt[i].insert_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
                    create_by: stmt[i].user_name,
                    remark: stmt[i].remark
                });
            }
            return res.json({ status: "success", success: true, data: data });
        }

        return res.json({ status: "error", success: false, message: "No data found" });
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

router.post("/fetchDetail", [auth.isAuthorized], async (req, res) => {
    try {
        const valid = new Validator(req.body, {
            fg_txn_id: "required",
            ref_no: "required"
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const stmt = await invtDB.query("SELECT rm_location.* , admin_login.user_name , fg_return.qty_return , components.c_name , components.c_part_no FROM rm_location LEFT JOIN fg_return ON fg_return.fg_return_txn = rm_location.reversal_txn_id LEFT JOIN admin_login ON admin_login.CustID = rm_location.insert_by LEFT JOIN components ON components.component_key = rm_location.components_id WHERE in_module = 'IN-FGRETURN' AND reversal_txn_id = :reversal_Txn_id AND rm_location.fg_rtn_refid = :ref_no", {
            replacements: { reversal_Txn_id: req.body.fg_txn_id, ref_no: req.body.ref_no },
            type: invtDB.QueryTypes.SELECT,
        });

        if (stmt.length > 0) {
            const data = [];
            for (let i = 0; i < stmt.length; i++) {
                data.push({
                    reversal_Txn_id: stmt[i].reversal_txn_id,
                    components_name: stmt[i].c_name,
                    components_part_no: stmt[i].c_part_no,
                    qty : stmt[i].qty,
                    bomQty : stmt[i].mfg_bom_qty,
                    insert_dt: moment(stmt[i].insert_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
                    create_by: stmt[i].user_name
                });
            }
            return res.json({status: "success", success: true, data: data });
        }

        return res.json({ status: "error", success: false, message: "No data found" });

    }
    catch (err) {
        return helper.errorResponse(res, err);
    }
})

module.exports = router;

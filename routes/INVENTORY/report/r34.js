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
        return res.status(403).json({ success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
    const diffDays = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "days");

    if (diffDays > 90) {
        return res.status(403).json({ message: "We can provide you 90 days OR (3 months) data only" });
    }

    try {
        const stmt = await invtDB.query(`
            SELECT 
                rm_location.*, 
                admin_login.user_name, 
                COALESCE(m3.qty_return, m3.mfg_approve_in_qty, 0) AS qty_return, 
                products.p_name, 
                products.p_sku, 
                fg_return_log.executed_remark AS remark, 
                fg_return_log.executed_qty AS qty
            FROM rm_location 
            INNER JOIN mfg_production_3 m3
              ON m3.mfg_pro_apr_transaction = rm_location.reversal_txn_id
              AND m3.type = 'TRANSFER'
            LEFT JOIN admin_login ON admin_login.CustID = rm_location.insert_by 
            LEFT JOIN products ON products.p_sku = m3.mfg_pro_apr_sku
            LEFT JOIN fg_return_log
              ON fg_return_log.fg_return_key = rm_location.fg_rtn_refid
              AND fg_return_log.fg_return_txn = rm_location.reversal_txn_id
            WHERE rm_location.in_module = 'IN-FGRETURN' 
            AND DATE_FORMAT(rm_location.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2 
            AND rm_location.company_branch = :branch
            AND m3.company_branch = :branch
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
            return res.status(200).json({ success: true, data: data });
        }

        return res.status(404).json({ message: "No data found", success: false, data: null });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ 
            message: "Internal Error. If this condition persists, contact your system administrator", 
            success: false, 
            data: null, 
            err: err.stack 
        });
    }
});

router.post("/fetchDetail", [auth.isAuthorized], async (req, res) => {
    try {
        const valid = new Validator(req.body, {
            fg_txn_id: "required",
            ref_no: "required"
        });

        if (valid.fails()) {
            return res.status(403).json({ success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const stmt = await invtDB.query(
            `SELECT
                rm_location.*,
                admin_login.user_name,
                COALESCE(m3.qty_return, m3.mfg_approve_in_qty, 0) AS qty_return,
                components.c_name,
                components.c_part_no
            FROM rm_location
            INNER JOIN mfg_production_3 m3
              ON m3.mfg_pro_apr_transaction = rm_location.reversal_txn_id
              AND m3.type = 'TRANSFER'
            LEFT JOIN admin_login ON admin_login.CustID = rm_location.insert_by
            LEFT JOIN components ON components.component_key = rm_location.components_id
            WHERE rm_location.in_module = 'IN-FGRETURN'
              AND rm_location.reversal_txn_id = :reversal_Txn_id
              AND rm_location.fg_rtn_refid = :ref_no`,
            {
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
            return res.status(200).json({success: true, data: data });
        }

        return res.status(404).json({ message: "No data found", success: false, data: null });

    }
    catch (err) {
        return res.status(500).json({ message: "Internal Error. If this condition persists, contact your system administrator", success: false, data: null, err: err.stack });
    }
})

module.exports = router;

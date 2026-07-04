const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/ven_auth");
const permission = require("../../../../middleware/permission");
let { invtDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");

// PART TRANSACTION DATE WISE REPORT
router.post("/partTransaction", [auth.isAuthorized], async (req, res) => {
    try {
        const valid = new Validator(req.body, {
            date: "required"
        });

        if (valid.fails()) {
            return res.json({ message: helper.firstErrorValidatorjs(valid), status: "error", success: false });
        }

        const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
        const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
        const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
        
        const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
        if (durationInMonths > 3) {
           return res.json({
             status: "error", success: false,
             message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
             code: "500",
           });
		}

        const stmt_comp = await invtDB.query("SELECT jw_ven_location.* FROM jw_ven_location WHERE DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND jw_ven_code = :vendor GROUP BY jw_ven_rm", {
            replacements: { date1: fromdate, date2: todate, vendor: req.logedINVendor },
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt_comp.length <= 0) {
            return res.json({ message: "Data Not Found", status: "error", success: false });
        }

        const data = [];

        for (let i = 0; i < stmt_comp.length; i++) {
            const stmt = await invtDB.query("SELECT jw_ven_location.*, components.c_part_no , components.c_name , admin_login.user_name as user_name  FROM jw_ven_location LEFT JOIN components ON components.component_key = jw_ven_location.jw_ven_rm LEFT JOIN admin_login ON admin_login.CustID = jw_ven_location.jw_ven_insert_by WHERE DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND jw_ven_rm = :component AND jw_ven_code = :vendor", {
                replacements: { date1: fromdate, date2: todate, component: stmt_comp[i].jw_ven_rm, vendor: req.logedINVendor },
                type: invtDB.QueryTypes.SELECT
            });

            if (stmt.length <= 0) {
                continue;
            }
            for (let j = 0; j < stmt.length; j++) {
                data.push({
                    part: stmt[j].c_part_no,
                    part_code: stmt[j].c_name,
                    type: stmt[j].jw_ven_txn_type == "RM-INWARD" ? "INWARD" : stmt[j].jw_ven_txn_type == "RM-CONSUMPTION" ? "CONSUMPTION" : "NA",
                    qty: stmt[j].jw_ven_in_qty,
                    hsn: stmt[j].jw_ven_part_hsn,
                    txn_id: stmt[j].jw_ven_txn,
                    date: moment(stmt[j].jw_ven_insert_dt, "YYYY-MM-DD HH:mm:ss").tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss"),
                    user: stmt[j].user_name ?? "NA"
                })
            }
        }


        return res.json({ status: "success", success: true, response: { data: data } });

    }
    catch (error) {
        return res.json({ message: "Internal Error!!! If this condition persists, contact your system administrator", status: "error", success: false, errors: error.stack });
    }
})

module.exports = router;
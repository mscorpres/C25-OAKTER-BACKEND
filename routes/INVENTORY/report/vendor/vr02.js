const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/ven_auth");
const permission = require("../../../../middleware/permission");
let { invtDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");

// PART TRANSACTION DATE WISE REPORT
router.post("/", [auth.isAuthorized], async (req, res) => {
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

        // GET ALL COMPONENT OF VENDOR
        const stmt = await invtDB.query("SELECT jw_ven_rm , components.c_part_no , components.c_name FROM jw_ven_location LEFT JOIN components ON components.component_key = jw_ven_location.jw_ven_rm WHERE jw_ven_code = :vendor GROUP BY jw_ven_rm", {
            replacements: { vendor: req.logedINVendor },
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt.length <= 0) {
            return res.json({ message: "Data Not Found", status: "error", success: false });
        }

        const data = [];
        for (let i = 0; i < stmt.length; i++) {

            const stmt_qty = await invtDB.query("SELECT ( SELECT COALESCE(SUM(jw_ven_in_qty), 0) AS inward FROM jw_ven_location WHERE jw_ven_txn_type = 'RM-INWARD' AND jw_ven_rm = :comp AND jw_ven_code = :vendor AND DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) as inward , ( SELECT COALESCE(SUM(jw_ven_in_qty), 0) AS outward FROM jw_ven_location WHERE jw_ven_txn_type = 'RM-CONSUMPTION' AND jw_ven_rm = :comp AND jw_ven_code = :vendor AND DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) as outward, (SELECT COALESCE(SUM(jw_ven_in_qty), 0) AS inward FROM jw_ven_location WHERE jw_ven_txn_type = 'RM-INWARD' AND jw_ven_rm = :comp AND jw_ven_code = :vendor AND DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') < :date1 ) - (SELECT COALESCE(SUM(jw_ven_in_qty), 0) AS outward FROM jw_ven_location WHERE jw_ven_txn_type = 'RM-CONSUMPTION' AND jw_ven_rm = :comp AND jw_ven_code = :vendor AND DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') < :date1) AS opening FROM DUAL",{
                replacements: {
                    comp: stmt[i].jw_ven_rm,
                    vendor: req.logedINVendor,
                    date1: fromdate,
                    date2: todate
                },
                type: invtDB.QueryTypes.SELECT
            });

            data.push({
                part_code : stmt[i].c_part_no,
                part_name : stmt[i].c_name,
                inward: stmt_qty[0].inward,
                outward: stmt_qty[0].outward,
                opening: stmt_qty[0].opening,
				closingDate: moment(todate, "YYYY-MM-DD").format("DD-MM-YYYY"),
                closing: helper.number(stmt_qty[0].opening) + stmt_qty[0].inward - stmt_qty[0].outward
            })

        }

        return res.json({ status: "success", success: true, response: { data: data } });

    }
    catch (error) {
        return res.json({ message: "Internal Error!!! If this condition persists, contact your system administrator", status: "error", success: false, errors: error.stack });
    }
})

module.exports = router;
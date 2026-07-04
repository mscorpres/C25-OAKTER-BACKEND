let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();
const Validator = require("validatorjs");
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


router.post("/", [auth.isAuthorized], async (req, res) => {
    try {
        const valid = new Validator(req.body, {
            wise: "required",
            data: "required",
        });

        if (valid.fails()) {
            return res.json({ message: helper.firstErrorValidatorjs(valid), status: "error", success: false });
        }

        const { wise, data } = req.body;

        let stmt;

        if (wise == "doc_no") {
            stmt = await invtDB.query("SELECT jw_ven_location.*, components.c_part_no, components.c_new_part_no, components.c_name , units.units_name, admin_login.user_name FROM jw_ven_location LEFT JOIN components ON components.component_key = jw_ven_location.jw_ven_rm LEFT JOIN units ON units.units_id = components.c_uom LEFT JOIN admin_login ON admin_login.CustID = jw_ven_location.jw_ven_insert_by WHERE jw_ven_challan_ref = :data AND jw_ven_code = :vendor AND jw_ven_txn_type = 'RM-CONSUMPTION'", {
                replacements: {
                    data: data,
                    vendor: req.body.vendor
                },
                type: invtDB.QueryTypes.SELECT
            });

        } else if (wise == "doc_date") {
            stmt = await invtDB.query("SELECT jw_ven_location.*, components.c_part_no, components.c_new_part_no, components.c_name , units.units_name, admin_login.user_name FROM jw_ven_location LEFT JOIN components ON components.component_key = jw_ven_location.jw_ven_rm LEFT JOIN units ON units.units_id = components.c_uom LEFT JOIN admin_login ON admin_login.CustID = jw_ven_location.jw_ven_insert_by WHERE jw_ven_code = :vendor AND jw_ven_date = :data AND jw_ven_txn_type = 'RM-CONSUMPTION'", {
                replacements: {
                    vendor: req.body.vendor,
                    data: data
                },
                type: invtDB.QueryTypes.SELECT
            })

        } else if (wise == "create_date") {
            const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
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

            stmt = await invtDB.query("SELECT jw_ven_location.*, components.c_part_no, components.c_new_part_no, components.c_name , units.units_name, admin_login.user_name FROM jw_ven_location LEFT JOIN components ON components.component_key = jw_ven_location.jw_ven_rm LEFT JOIN units ON units.units_id = components.c_uom LEFT JOIN admin_login ON admin_login.CustID = jw_ven_location.jw_ven_insert_by WHERE jw_ven_code = :vendor AND (DATE_FORMAT(`jw_ven_insert_dt`,'%Y-%m-%d') BETWEEN :data1 AND :data2) AND jw_ven_txn_type = 'RM-CONSUMPTION'", {
                replacements: {
                    vendor: req.body.vendor,
                    data1: fromdate,
                    data2: todate
                },
                type: invtDB.QueryTypes.SELECT
            });

        } else {
            return res.json({ message: "Please choose valid option!!!", status: "error", success: false });
        }

        if (stmt.length <= 0) {
            return res.json({ message: "No data found!!!", status: "error", success: false });
        }

        // 
        const response_data = [];
        for (let i = 0; i < stmt.length; i++) {
            response_data.push({
                part_no: stmt[i].c_part_no, cat_part_no: stmt[i].c_new_part_no,
                part_name: stmt[i].c_name,
                unit: stmt[i].units_name,
                qty: stmt[i].jw_ven_in_qty,
                hsn: stmt[i].jw_ven_part_hsn,
                doc_ref: stmt[i].jw_ven_challan_ref,
                doc_date: moment(stmt[i].jw_ven_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
                create_dt: moment(stmt[i].jw_ven_insert_dt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
                create_by: stmt[i].user_name, txn_id: stmt[i].jw_ven_txn
            });
        }

        return res.json({ status: "success", success: true, data: response_data });

    }
    catch (err) {
        return helper.errorResponse(res, err);
    }
});

module.exports = router;

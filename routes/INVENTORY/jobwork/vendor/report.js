const express = require("express");
const router = express.Router();



let { invtDB } = require("../../../../config/db/connection");

const auth = require("../../../../middleware/ven_auth");
const Validator = require("validatorjs");

const { encode, decode } = require("html-entities");


checkNegativeValue = (value) => {
    return value < 0 ? 0 : value;
};
function byDate(a, b) {
    return moment(b.date, "DD-MM-YYYY HH:mm:ss") - moment(a.date, "DD-MM-YYYY HH:mm:ss");
}
function byID(a, b) {
    return b.rowcount - a.rowcount;
}

router.post("/vq01", [auth.isAuthorized], async (req, res) => {
    try {
        let IN = '<span class="d-inline-block radius-round p-2 bgc-green"></span>';
        let OUT = '<span class="d-inline-block radius-round p-2 bgc-red"></span>';

        if (req.body.part_code == null) {
            res.json({ status: "error", success: false, message: "Please supply component part code" });
            return;
        } else if (req.body.location == null) {
            res.json({ status: "error", success: false, message: "Please supply location" });
            return;
        } else {
            let stmt1 = await invtDB.query("SELECT * FROM `components` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `components`.`c_part_no` = :partcode OR `components`.`component_key` = :partcode", {
                replacements: { partcode: req.body.part_code },
                type: invtDB.QueryTypes.SELECT,
            });
            if (stmt1.length > 0) {
                let stmt2 = await invtDB.query(
                    "SELECT jw_ven_location.*, jw_ven_location.jw_ven_insert_dt AS inward_date, jw_ven_location.ID AS rowcount , admin_login.user_name , ven_basic_detail.ven_name FROM jw_ven_location LEFT JOIN components ON jw_ven_location.jw_ven_rm = components.component_key LEFT JOIN admin_login ON jw_ven_location.jw_ven_insert_by = admin_login.CustID LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = jw_ven_location.jw_ven_code WHERE jw_ven_location.jw_ven_rm = :component AND jw_ven_code = :vendor ORDER BY jw_ven_location.jw_ven_insert_dt DESC , jw_ven_location.ID ASC",
                    {
                        replacements: { component: stmt1[0].component_key, vendor: req.logedINVendor },
                        type: invtDB.QueryTypes.SELECT,
                    }
                );

                let data = [];
                if (stmt2.length > 0) {
                    count = 0;
                    stmt2.map(async (item) => {
                        let transaction_mode;
                        let transaction_type;
                        let transaction_type_label;
                        let qty_in;
                        let qty_out;//
                        if (item.jw_ven_txn_type == "") {
                            transaction_mode = "N/A";
                        } else if (item.jw_ven_txn_type == "RM-INWARD") {
                            transaction_mode = "MIN";
                            transaction_type = IN;
                            transaction_type_label = "INWARD";
                            qty_in = item.jw_ven_in_qty;
                            qty_out = 0;
                        } else if (item.jw_ven_txn_type == "RM-CONSUMPTION") {
                            transaction_mode = "CONSUMP";
                            transaction_type = OUT;
                            transaction_type_label = "CONSUMPTION";
                            qty_in = 0;
                            qty_out = item.jw_ven_in_qty;
                        } else if (item.jw_ven_txn_type == "RM-TRANSFER") {
                            transaction_mode = "TRANSFER";
                            transaction_type = OUT;
                            transaction_type_label = "TRANSFER";
                            qty_in = item.jw_ven_in_qty;
                            qty_out = item.jw_ven_in_qty;
                        } else {
                            transaction_mode = "N/A";
                            transaction_type = "N/A";
                            transaction_type_label = "N/A";
                            qty_in = "N/A";
                            qty_out = "N/A";
                        }

                        let stmt3 = await invtDB.query("SELECT * FROM location_main WHERE location_key = :location_in AND loc_status = 'ACTIVE' ", {
                            replacements: { location_in: item.jw_ven_loc_in },
                            type: invtDB.QueryTypes.SELECT,
                        });

                        let location_in;
                        if (stmt3.length > 0) {
                            location_in = stmt3[0].loc_name;
                        } else {
                            location_in = "--";
                        }

                        let stmt4 = await invtDB.query("SELECT * FROM location_main WHERE location_key = :location_out  AND loc_status = 'ACTIVE' ", {
                            replacements: { location_out: item.jw_ven_loc_out },
                            type: invtDB.QueryTypes.SELECT,
                        });

                        let location_out;
                        if (stmt4.length > 0) {
                            location_out = stmt4[0].loc_name;
                        } else {
                            location_out = "--";
                        }


                        data.push({
                            serial_no: count + 1,
                            rowcount: item.rowcount,
                            type: transaction_type,
                            transaction: item.jw_ven_txn,
                            qty_in: qty_in,
                            qty_out: qty_out,
                            key: item.jw_ven_rm,
                            location_in: location_in,
                            location_out: location_out,
                            transaction_type: transaction_type_label,
                            mode: transaction_mode,
                            date: moment(item.inward_date).format("DD-MM-YYYY HH:mm:ss"),
                            transaction_by: item.user_name,
                            vendor : item.ven_name
                        });
                        count++;

                        if (stmt2.length == count) {
                            data.sort(byID);
                            myfunction();
                        }
                    });
                } else {
                    res.json({ status: "error", success: false, message: "no any transaction found" });
                    return;
                }

                async function myfunction() {
                    //ALL INWARD
                    let stmt6 = await invtDB.query(
                        "SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Inward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND( `jw_ven_txn_type` = 'RM-INWARD') AND `jw_ven_loc_in` = :location AND `jw_ven_code` = :vendor",
                        {
                            replacements: {
                                component: stmt1[0].component_key,
                                location: req.body.location,
                                vendor: req.logedINVendor,
                            },
                            type: invtDB.QueryTypes.SELECT,
                        }
                    );

                    let inward_all_qty;
                    if (stmt6.length > 0) {
                        inward_all_qty = helper.number(stmt6[0].Inward);
                    } else {
                        inward_all_qty = 0;
                    }

                    // ALL OUTWARD
                    let stmt7 = await invtDB.query(
                        "SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Outward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-CONSUMPTION') AND `jw_ven_loc_out` = :location AND `jw_ven_code` = :vendor",
                        {
                            replacements: {
                                component: stmt1[0].component_key,
                                location: req.body.location,
                                vendor: req.logedINVendor,
                            },
                            type: invtDB.QueryTypes.SELECT,
                        }
                    );

                    let outward_all_qty;
                    if (stmt7.length > 0) {
                        outward_all_qty = helper.number(stmt7[0].Outward);
                    } else {
                        outward_all_qty = 0;
                    }

                    // LAST TRANSACTION DETAIL
                    let stmt8 = await invtDB.query("SELECT * FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-INWARD') ORDER BY `ID` DESC LIMIT 1", {
                        replacements: { component: stmt1[0].component_key },
                        type: invtDB.QueryTypes.SELECT,
                    });


                    let stmt9 = await invtDB.query("SELECT * FROM `jw_ven_location` LEFT JOIN `admin_login` ON `jw_ven_location`.`jw_ven_insert_by` = `admin_login`.`CustID` WHERE `jw_ven_location`.`jw_ven_rm` = :component ORDER BY `jw_ven_location`.`ID` DESC LIMIT 1", {
                        replacements: { component: stmt1[0].component_key },
                        type: invtDB.QueryTypes.SELECT,
                    });
                    let user;
                    let date;
                    if (stmt9.length > 0) {
                        user = stmt9[0].user_name;
                        date = moment(stmt9[0].jw_ven_insert_dt).tz("Asia/Kolkata").format("DD-MM-YYYY");
                    } else {
                        user = "N/A";
                        date = "N/A";
                    }

                    if (data.length == 0) {
                        res.json({ status: "error", success: false, message: "no any transaction found" });
                        return;
                    } else {
                        res.json({ status: "success", success: true, message: "Data fetched successfully", data: { data1: { partno: stmt1[0].c_part_no, component: decode(stmt1[0].c_name), uom: stmt1[0].units_name, closingqty: helper.number(inward_all_qty - outward_all_qty) }, data2: data } });
                        return;
                    }
                }
            } else {
res.json({ status: "error", success: false, message: "no any transaction found" });
                return;
            }
        }
    } catch (error) {
        return helper.errorResponse(res, error);
    }
});


router.post("/vq02", [auth.isAuthorized], async (req, res) => {
    try {

        const valid = new Validator(req.body, {
            component: "required",
            location: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        let inward_all_qty;
        
        //ALL INWARD
        let stmt6 = await invtDB.query(
            "SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Inward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND( `jw_ven_txn_type` = 'RM-INWARD') AND `jw_ven_loc_in` = :location AND `jw_ven_code` = :vendor",
            {
                replacements: {
                    component: req.body.component,
                    location: req.body.location,
                    vendor: req.logedINVendor,
                },
                type: invtDB.QueryTypes.SELECT,
            }
        );

        if (stmt6.length > 0) {
            inward_all_qty = helper.number(stmt6[0].Inward);
        } else {
            inward_all_qty = 0;
        }

        // ALL OUTWARD
        let stmt7 = await invtDB.query(
            "SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Outward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-CONSUMPTION') AND `jw_ven_loc_out` = :location AND `jw_ven_code` = :vendor",
            {
                replacements: {
                    component: req.body.component,
                    location: req.body.location,
                    vendor: req.logedINVendor,
                },
                type: invtDB.QueryTypes.SELECT,
            }
        );

        let outward_all_qty;
        if (stmt7.length > 0) {
            outward_all_qty = helper.number(stmt7[0].Outward);
        } else {
            outward_all_qty = 0;
        }


        return res.json({ status: "success", success: true, message: "Data fetched successfully", data: { closingStock: helper.number(inward_all_qty - outward_all_qty) } });

    }
    catch (error) {
        res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: error.stack }) });
        return;
    }
});

router.post("/compClosing", [auth.isAuthorized], async (req, res) => {
    try {

        const valid = new Validator(req.body, {
            component: "required",
            location: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        let inward_all_qty;
        
        //ALL INWARD
        let stmt6 = await invtDB.query(
            "SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Inward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND( `jw_ven_txn_type` = 'RM-INWARD') AND `jw_ven_loc_in` = :location AND `jw_ven_code` = :vendor",
            {
                replacements: {
                    component: req.body.component,
                    location: req.body.location,
                    vendor: req.logedINVendor,
                },
                type: invtDB.QueryTypes.SELECT,
            }
        );

        if (stmt6.length > 0) {
            inward_all_qty = helper.number(stmt6[0].Inward);
        } else {
            inward_all_qty = 0;
        }

        // ALL OUTWARD
        let stmt7 = await invtDB.query(
            "SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Outward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-CONSUMPTION') AND `jw_ven_loc_out` = :location AND `jw_ven_code` = :vendor",
            {
                replacements: {
                    component: req.body.component,
                    location: req.body.location,
                    vendor: req.logedINVendor,
                },
                type: invtDB.QueryTypes.SELECT,
            }
        );

        let outward_all_qty;
        if (stmt7.length > 0) {
            outward_all_qty = helper.number(stmt7[0].Outward);
        } else {
            outward_all_qty = 0;
        }


        return res.json({ status: "success", success: true, message: "Data fetched successfully", data: { closingStock: helper.number(inward_all_qty - outward_all_qty) } });

    }
    catch (error) {
        res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: error.stack }) });
        return;
    }
});

module.exports = router;
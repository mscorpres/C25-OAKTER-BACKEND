let { invtDB, otherDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

const xlsx = require("xlsx");
const fs = require("fs");

const { htmlTemplate } = require("../../../helper/EmailTemplate/fileDownload");

//Required Passing Parameters:

//1. skucode
//2. date

checkNegativeValue = (value) => {
    return value < 0 ? 0 : value;
};

function byDate(a, b) {
    let d1 = new Date(moment(a.reg_date, "DD-MM-YYYY"));
    let d2 = new Date(moment(b.reg_date, "DD-MM-YYYY"));
    return d2 - d1;
}

router.post("/", [auth.isAuthorized], async (req, res) => {
    try {

        let valid = new Validator(req.body, {
            user_id: "required"
        })

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: valid.errors.all() });
        }

        let db_stmt = await otherDB.query("SELECT * FROM invt_r24 WHERE user_id = :user_id", {
            replacements: { user_id: req.body.user_id },
            type: invtDB.QueryTypes.SELECT
        });

        if (db_stmt.length <= 0) {
            return res.json({ status: "error", success: false, message: "seems an unauthorized user" });
        }


        let parts = db_stmt[0].parts;
        let partsArray = parts.split(",");

        // A21 RM Locations
        let stmt_get_a21_rm = await invtDB.query("SELECT locations FROM location_allotted WHERE loc_all_key = :location_key", {
            replacements: { location_key: "202396161629429" },
            type: invtDB.QueryTypes.SELECT,
        });

        let a21rmlocation = [];
        if (stmt_get_a21_rm.length > 0) {
            for (let loc_i = 0; loc_i < stmt_get_a21_rm.length; loc_i++) {
                a21rmlocation = stmt_get_a21_rm[loc_i].locations.split(",");
            }
        } else {
            return res.json({ status: "error", success: false, message: "RM Location Not Found, contact to administrator" });
        }
        // END

        // A21 SF Locations
        let stmt_get_a21 = await invtDB.query("SELECT locations FROM location_allotted WHERE loc_all_key = :location_key", {
            replacements: { location_key: "202396161713730" },
            type: invtDB.QueryTypes.SELECT,
        });

        let r24Sflocation = [];
        if (stmt_get_a21.length > 0) {
            for (let loc_i = 0; loc_i < stmt_get_a21.length; loc_i++) {
                r24Sflocation = stmt_get_a21[loc_i].locations.split(",");
            }
        } else {
            return res.json({ status: "error", success: false, message: "SF Location Not Found, contact to administrator" });
        }
        // END

        count = 0;
        let data = [];

        for (let i = 0; i < partsArray.length; i++) {

            const stmt_comp = await invtDB.query("SELECT c_part_no , c_name , c_new_part_no FROM components WHERE component_key = :partcode", {
                replacements: { partcode: partsArray[i] },
                type: invtDB.QueryTypes.SELECT
            })

            let Rm_stmt = await invtDB.query(
                "SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as inward, (SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as outward, (SELECT COALESCE(SUM(QTY), 0) AS OpeningBalance FROM ( SELECT qty QTY FROM rm_location CR WHERE CR.components_id = :component AND CR.loc_in IN (:location) AND DATE_FORMAT(CR.insert_date, '%Y-%m-%d') < :date AND CR.trans_type IN ('INWARD','TRANSFER','ISSUE','REJECTION','JOBWORK') UNION ALL SELECT - COALESCE(SUM(qty + other_qty), 0) QTY FROM rm_location DR WHERE DR.components_id = :component AND DR.loc_out IN (:location) AND DATE_FORMAT(DR.insert_date, '%Y-%m-%d') < :date AND DR.trans_type IN ('ISSUE','REJECTION','JOBWORK','TRANSFER')) t) as OpeningBalance FROM DUAL",
                {
                    replacements: {
                        component: partsArray[i],
                        location: a21rmlocation,
                        date: moment(new Date()).format("YYYY-MM-DD"),
                    },
                    type: invtDB.QueryTypes.SELECT,
                }
            );

            let Rm_inward_all_qty = 0, Rm_outward_all_qty = 0, Rm_opening_qty = 0;
            if (Rm_stmt.length > 0) {
                Rm_inward_all_qty = Rm_stmt[0].inward;
                Rm_outward_all_qty = Rm_stmt[0].outward;
                Rm_opening_qty = Rm_stmt[0].OpeningBalance;
            }

            let Sf_stmt = await invtDB.query(
                "SELECT COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION') AND loc_in IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) = :date THEN qty ELSE 0 END ), 0 ) AS inward, COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'CONSUMPTION' ) AND loc_out IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) = :date THEN qty ELSE 0 END ), 0 ) AS outward, COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) < :date THEN qty ELSE 0 END ), 0 ) - COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER', 'CONSUMPTION' ) AND loc_out IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) < :date THEN qty ELSE 0 END ), 0 ) AS OpeningBalance  FROM rm_location WHERE components_id = :component ",
                {
                    replacements: {
                        component: partsArray[i],
                        location: r24Sflocation,
                        date: moment(new Date()).format("YYYY-MM-DD"),
                    },
                    type: invtDB.QueryTypes.SELECT,
                }
            );

            let Sf_inward_all_qty = 0, Sf_outward_all_qty = 0, Sf_opening_qty = 0;
            if (Sf_stmt.length > 0) {
                Sf_inward_all_qty = Sf_stmt[0].inward;
                Sf_outward_all_qty = Sf_stmt[0].outward;
                Sf_opening_qty = Sf_stmt[0].OpeningBalance;
            }

            data.push({
                SERIAL_NO: count + 1,
                PART_NO: stmt_comp[0].c_part_no,
                PART_NO_NEW: stmt_comp[0].c_new_part_no,
                COMPONENT: stmt_comp[0].c_name,
                CURRENT_RM_IN_STORE: Rm_opening_qty,
                TODAY_INWARD_IN_STORE: Rm_inward_all_qty,
                TODAY_OUTWARD_IN_STORE: Rm_outward_all_qty,
                CLOSING_STOCK_STORE: Number((Rm_opening_qty) + Rm_inward_all_qty) - Rm_outward_all_qty,
                TODAY_INWARD_SF: Sf_inward_all_qty,
                // sf_outward: Sf_outward_all_qty,
                SF_CURRENT_RM: Sf_opening_qty,
                SF_DISPATCH_PRODUCT: Sf_outward_all_qty,
                CLOSING_STOCK_SF: Number(Number(Sf_opening_qty) + Number(Sf_inward_all_qty)) - Sf_outward_all_qty,
            });
            count++;
        }

        data.sort(byDate);
        const worksheet = xlsx.utils.json_to_sheet(data);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, "REPORT R24");
        // buffer we use to handle the big file
        xlsx.write(workbook, { bookType: "csv", type: "buffer" });
        let randKey = Math.floor(Math.random() * (999 - 100 + 1)) + 100;
        let fileGenarateName = "./files/excel/R24_" + randKey + ".csv";

        xlsx.writeFile(workbook, fileGenarateName);

        // SEND USER MAIL
        let user = await invtDB.query("SELECT Email_ID,user_name from admin_login WHERE CustID= :username", {
            replacements: {
                username: req.logedINUser,
            },
            type: invtDB.QueryTypes.SELECT,
        });

        let userEmail = user[0].Email_ID;
        let attachment = [
            {
                filename: "R24 REPORT.csv",
                content: fs.readFileSync(fileGenarateName),
            },
        ];
        await helper.sendMail(userEmail, "", "R24 REPORT [File Ready for download] Ref:" + helper.randomNumber(10, 999), htmlTemplate(user[0].user_name, new Date(), "R24 REPORT", ""), attachment);
        //END MAIL

        return res.json({ status: "success", success: true, message: "Report fetched successfully", data: data });
    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }
})

router.post("/old", [auth.isAuthorized], async (req, res) => {
    try {
        const valid = new Validator(req.body, {
            skucode: "required",
            bom: "required",
        })

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: valid.errors.all(), code: "500", });
        }

        let stmt2 = await invtDB.query("SELECT * FROM   bom_recipe   WHERE  bom_product_sku   = :product_sku", {
            replacements: { product_sku: req.body.skucode },
            type: invtDB.QueryTypes.SELECT,
        });

        if (stmt2.length <= 0) {
            return res.json({ status: "error", success: false, message: "Product bom not found!!!" });
        }

        let stmt3 = await invtDB.query("SELECT * FROM  bom_quantity LEFT JOIN  components  ON  bom_quantity.component_id   =  components.component_key  LEFT JOIN units ON components.c_uom = units.units_id WHERE  bom_quantity.subject_under  = :subject ORDER BY   components.c_part_no ASC", {
            replacements: { subject: req.body.bom },
            type: invtDB.QueryTypes.SELECT,
        });

        if (stmt3.length <= 0) {
            return res.json({ status: "error", success: false, message: "Product bom components found!!!" });
        }

        // A21 RM Locations
        let stmt_get_a21_rm = await invtDB.query("SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
            replacements: { location_key: "202396161629429" },
            type: invtDB.QueryTypes.SELECT,
        });

        let a21rmlocation = [];
        if (stmt_get_a21_rm.length > 0) {
            for (let loc_i = 0; loc_i < stmt_get_a21_rm.length; loc_i++) {
                a21rmlocation = stmt_get_a21_rm[loc_i].locations.split(",");
            }
        } else {
            return res.json({ status: "error", success: false, message: "A21 RM Location Not Found, contact to administrator" });
        }
        // END

        // A21 RM Locations
        let stmt_get_a21 = await invtDB.query("SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
            replacements: { location_key: "202396161713730" },
            type: invtDB.QueryTypes.SELECT,
        });

        let r24Sflocation = [];
        if (stmt_get_a21.length > 0) {
            for (let loc_i = 0; loc_i < stmt_get_a21.length; loc_i++) {
                r24Sflocation = stmt_get_a21[loc_i].locations.split(",");
            }
        } else {
            return res.json({ status: "error", success: false, message: "A21 SF Location Not Found, contact to administrator" });
        }
        // END

        const data = [{
            SERIAL_NO: "SKU:-",
            PART_NO: req.body.skucode,
            COMPONENT: "BOM:-",
            CURRENT_RM_IN_STORE: stmt2[0].subject_name,
            TODAY_INWARD_IN_STORE: "",
            TODAY_OUTWARD_IN_STORE: "",
            CLOSING_STOCK_STORE: "",
            TODAY_INWARD_SF: "",
            SF_CURRENT_RM: "",
            SF_DISPATCH_PRODUCT: "",
            CLOSING_STOCK_SF: "",
        }];
        count = 0;

        stmt3.map(async (item) => {

            let Rm_stmt = await invtDB.query(
                "SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as inward, (SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as outward, (SELECT COALESCE(SUM(QTY), 0) AS OpeningBalance FROM ( SELECT qty QTY FROM rm_location CR WHERE CR.components_id = :component AND CR.loc_in IN (:location) AND DATE_FORMAT(CR.insert_date, '%Y-%m-%d') < :date AND CR.trans_type IN ('INWARD','TRANSFER','ISSUE','REJECTION','JOBWORK') UNION ALL SELECT - COALESCE(SUM(qty + other_qty), 0) QTY FROM rm_location DR WHERE DR.components_id = :component AND DR.loc_out IN (:location) AND DATE_FORMAT(DR.insert_date, '%Y-%m-%d') < :date AND DR.trans_type IN ('ISSUE','REJECTION','JOBWORK','TRANSFER')) t) as OpeningBalance FROM DUAL",
                {
                    replacements: {
                        component: item.component_key,
                        location: a21rmlocation,
                        date: moment(new Date()).format("YYYY-MM-DD"),
                    },
                    type: invtDB.QueryTypes.SELECT,
                }
            );

            let Rm_inward_all_qty = 0, Rm_outward_all_qty = 0, Rm_opening_qty = 0;
            if (Rm_stmt.length > 0) {
                Rm_inward_all_qty = Rm_stmt[0].inward;
                Rm_outward_all_qty = Rm_stmt[0].outward;
                Rm_opening_qty = Rm_stmt[0].OpeningBalance;
            }

            let Sf_stmt = await invtDB.query(
                "SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as inward, (SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as outward, (SELECT COALESCE(SUM(QTY), 0) AS OpeningBalance FROM ( SELECT qty QTY FROM rm_location CR WHERE CR.components_id = :component AND CR.loc_in IN (:location) AND DATE_FORMAT(CR.insert_date, '%Y-%m-%d') < :date AND CR.trans_type IN ('INWARD','TRANSFER','ISSUE') UNION ALL SELECT - COALESCE(SUM(qty + other_qty), 0) QTY FROM rm_location DR WHERE DR.components_id = :component AND DR.loc_out IN (:location) AND DATE_FORMAT(DR.insert_date, '%Y-%m-%d') < :date AND DR.trans_type IN ('ISSUE','REJECTION','JOBWORK','TRANSFER')) t) as OpeningBalance FROM DUAL",
                {
                    replacements: {
                        component: item.component_key,
                        location: r24Sflocation,
                        date: moment(new Date()).format("YYYY-MM-DD"),
                    },
                    type: invtDB.QueryTypes.SELECT,
                }
            );

            let Sf_inward_all_qty = 0, Sf_outward_all_qty = 0, Sf_opening_qty = 0;
            if (Sf_stmt.length > 0) {
                Sf_inward_all_qty = Sf_stmt[0].inward;
                Sf_outward_all_qty = Sf_stmt[0].outward;
                Sf_opening_qty = Sf_stmt[0].OpeningBalance;
            }

            data.push({
                SERIAL_NO: count + 1,
                PART_NO: item.c_part_no,
                COMPONENT: item.c_name,
                CURRENT_RM_IN_STORE: Rm_opening_qty,
                TODAY_INWARD_IN_STORE: Rm_inward_all_qty,
                TODAY_OUTWARD_IN_STORE: Rm_outward_all_qty,
                CLOSING_STOCK_STORE: Number((Rm_opening_qty) + Rm_inward_all_qty) - Rm_outward_all_qty,
                TODAY_INWARD_SF: Sf_inward_all_qty,
                //sf_outward: Sf_outward_all_qty,
                SF_CURRENT_RM: Sf_opening_qty,
                SF_DISPATCH_PRODUCT: Sf_outward_all_qty,
                CLOSING_STOCK_SF: Number(Sf_opening_qty + Sf_inward_all_qty) - Sf_outward_all_qty,
            });


            count++;

            if (data.length == stmt3.length) {
                data.sort(byDate);
                const worksheet = xlsx.utils.json_to_sheet(data);
                const workbook = xlsx.utils.book_new();
                xlsx.utils.book_append_sheet(workbook, worksheet, "BOM REPORT R24");
                // buffer we use to handle the big file
                xlsx.write(workbook, { bookType: "csv", type: "buffer" });
                let randKey = Math.floor(Math.random() * (999 - 100 + 1)) + 100;
                let fileGenarateName = "./files/excel/R24_" + randKey + ".csv";

                xlsx.writeFile(workbook, fileGenarateName);

                // SEND USER MAIL
                let user = await invtDB.query("SELECT `Email_ID`,`user_name` from `admin_login` WHERE `CustID`= :username", {
                    replacements: {
                        username: req.logedINUser,
                    },
                    type: invtDB.QueryTypes.SELECT,
                });

                let userEmail = user[0].Email_ID;
                let attachment = [
                    {
                        filename: "R24 BOM REPORT",
                        content: fs.readFileSync(fileGenarateName),
                    },
                ];
                await helper.sendMail(userEmail, "", "R24 BOM REPORT [File Ready for download] Ref:" + helper.randomNumber(10, 999), htmlTemplate(user[0].user_name, new Date(), "R24 BOM REPORT", ""), attachment);
                //END MAIL

                return res.json({ status: "success", success: true, message: "Report fetched successfully", data: data });
            }

        });



    }
    catch (err) {
        return res.json({
            status: "error", success: false,
            success: false,
            message: "Internal Error!!! If this condition persists, contact your system administrator",
            ...(process.env.NODE_ENV === 'development' && { debug: err.stack }),
        });
    }
});

// GET SELECTED VALUES
router.post("/getSelectedValue", [auth.isAuthorized], async (req, res) => {
    try {
        if (req.body.user_id == "") {
            return res.json({ status: "error", success: false, message: "seems an unauthorized user" });
        }

        let stmt = await otherDB.query("SELECT * FROM invt_r24 WHERE user_id = :user_id", { replacements: { user_id: req.body.user_id }, type: otherDB.QueryTypes.SELECT });
        if (stmt.length > 0) {
            let parts = stmt[0].parts;
            let partsArray = parts.split(",");

            let part_options = [];

            for (let i = 0; i < partsArray.length; i++) {
                let comp_stmt = await invtDB.query("SELECT c_name, c_part_no FROM components WHERE component_key = :partcode", {
                    replacements: { partcode: partsArray[i] },
                    type: invtDB.QueryTypes.SELECT,
                });

                if (comp_stmt.length > 0) {
                    part_options.push({
                        id: partsArray[i],
                        text: comp_stmt[0].c_name + " ( " + comp_stmt[0].c_part_no + " )",
                    })
                }
            }


            return res.json({ status: "success", success: true, message: "Selected values fetched", data: { part_options: part_options } });
        } else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

// Update the location report
router.post("/update", [auth.isAuthorized], async (req, res) => {
    let validation = new Validator(req.body, {
        component_part: "required",
    });

    if (validation.fails()) {
        return res.json({ status: "error", success: false, message: "something you missing in form field to supply", errors: validation.errors.all() });
    }

    if (req.body.component_part.length <= 0) {
        return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
    }

    let parts = req.body.component_part.join(",");

    try {
        let stmt2;
        let stmt1 = await otherDB.query("SELECT * FROM invt_r24 WHERE user_id = :userid", { replacements: { userid: req.logedINUser }, type: otherDB.QueryTypes.SELECT });
        if (stmt1.length > 0) {
            stmt2 = await otherDB.query("UPDATE invt_r24 SET parts = :parts WHERE user_id = :userid", {
                replacements: {
                    parts: parts,
                    userid: req.logedINUser,
                },
                type: otherDB.QueryTypes.UPDATE,
            });
        } else {
            stmt2 = await otherDB.query("INSERT INTO invt_r24 (parts, user_id) VALUES(:parts, :userid)", {
                replacements: {
                    parts: parts,
                    userid: req.logedINUser,
                },
                type: otherDB.QueryTypes.INSERT,
            });
        }

        if (stmt2.length > 0) {
            return res.json({ status: "success", success: true, message: "Report updated" });
        } else {
            return res.json({ status: "error", success: false, message: "an error occured while updating the report" });
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

module.exports = router;
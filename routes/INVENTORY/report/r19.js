let { invtDB, otherDB, otherOakterDB } = require("../../../config/db/connection");
const fs = require("fs");

const { encode, decode } = require("html-entities");
const Validator = require("validatorjs");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


var XLSX = require("xlsx");
const multer = require("multer");
const path = require("path");

//! Use of Multer
var storage = multer.diskStorage({
    destination: (req, file, callBack) => {
        callBack(null, "./files/");
    },
    filename: (req, file, callBack) => {
        callBack(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
    },
});

var upload = multer({ storage: storage });

function byPart(a, b) {
    return a.part.localeCompare(b.part, "en", { numeric: true });
}
router.post("/", [auth.isAuthorized], async (req, res) => {
    try {
        let stmt1 = await otherDB.query("SELECT `part_code` FROM `invt_r19` ORDER BY `ID` ASC LIMIT 1", {
            type: otherDB.QueryTypes.SELECT,
        });
        if (stmt1.length > 0) {
            let arr = stmt1[0].part_code.split(",");

            let data = [], bom_qty = 0;
            for (let j = 0; j < arr.length; j++) {
                let stmt2 = await invtDB.query("SELECT `ven_basic_detail`.`ven_name`, `components`.`c_name`, `components`.`component_key`, `components`.`c_new_part_no`, `components`.`c_part_no`, `units`.`units_name`, `po_purchase_req`.`po_vendor_reg_id`, COALESCE( SUM(`po_purchase_req`.`po_order_qty`), 0 ) `totalPOOrder`, COALESCE( SUM(`po_purchase_req`.`po_pending_qty`), 0 ) `totalPending`, COALESCE( SUM(`po_purchase_req`.`po_inward_qty`), 0 ) `totalInward` FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `ven_basic_detail` ON `po_purchase_req`.`po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `po_purchase_req`.`po_part_no` = :component GROUP BY `po_purchase_req`.`po_vendor_reg_id`", {
                    replacements: { component: arr[j] },
                    type: invtDB.QueryTypes.SELECT,
                });
                if (stmt2.length > 0) {
                    for (let i = 0; i < stmt2.length; i++) {
                        let stmt3 = await invtDB.query("SELECT `qty` FROM `bom_quantity` WHERE `product_sku` = :sku AND `subject_under` = :bom AND `component_id` = :component AND `bom_status` = 'A'", {
                            replacements: { component: stmt2[i].component_key, sku: req.body.sku, bom: req.body.bom },
                            type: invtDB.QueryTypes.SELECT,
                        });
                        let esmt = 0;
                        if (stmt3.length > 0) {
                            esmt = stmt3[0].qty
                        } else {
                            esmt = 0
                        }

                        // INWARD AND OUTWARD
                        let stmt4 = await invtDB.query(
                            "SELECT COALESCE(SUM(CASE WHEN trans_type IN ( 'INWARD','TRANSFER' ) THEN qty ELSE 0 END ), 0) AS inward , COALESCE(SUM(CASE WHEN trans_type IN ( 'ISSUE','JOBWORK', 'REJECTION', 'TRANSFER' ) THEN qty ELSE 0 END ), 0) AS outward FROM rm_location WHERE components_id = :component AND trans_type IN ( 'INWARD','ISSUE','JOBWORK', 'REJECTION', 'TRANSFER' )",
                            {
                                replacements: {
                                    component: stmt2[i].component_key
                                },
                                type: invtDB.QueryTypes.SELECT,
                            }
                        );
                        let inward_all_qty;
                        let outward_all_qty;
                        if (stmt4.length > 0) {
                            inward_all_qty = helper.number(stmt4[0].inward);
                            outward_all_qty = helper.number(stmt4[0].outward);
                        } else {
                            inward_all_qty = 0;
                            outward_all_qty = 0;
                        }

                        //TOTAL ROWS
                        let stmt5 = await invtDB.query("SELECT COUNT(`ID`) AS `COUNT` FROM `bom_quantity` WHERE `subject_under` = :subject", {
                            replacements: { subject: req.body.bom },
                            type: invtDB.QueryTypes.SELECT,
                        });

                        bom_qty = stmt5[0].COUNT;


                        data.push({
                            vendor_code: stmt2[i].po_vendor_reg_id,
                            vendor_name: stmt2[i].ven_name,
                            part_code: stmt2[i].c_part_no, cat_part_code: stmt2[i].c_new_part_no,
                            part_name: decode(stmt2[i].c_name),
                            order_qty: stmt2[i].totalPOOrder,
                            pending_qty: stmt2[i].totalPending,
                            inward_qty: stmt2[i].totalInward,
                            closing_qty: inward_all_qty - outward_all_qty,
                            estmt_qty: esmt == 0 ? "N/A" : helper.number(inward_all_qty - outward_all_qty / esmt),
                            del_per: helper.number(stmt2[i].totalPOOrder / stmt2[i].totalInward),
                        });
                    }
                }
            }
            return res.json({ status: "success", success: true, message: "Report fetched successfully", data: data, bom_qty: bom_qty });
        }
    } catch (error) {
        return helper.errorResponse(res, error);
    }
});

// INSERT AND UPDATE PART CODE
router.post("/addPart", [auth.isAuthorized], async (req, res) => {
    let validation = new Validator(req.body, {
        component_part: "required"
    });

    if (validation.fails()) {
        return res.json({ status: "error", success: false, message: "something you missing in form field to supply", errors: validation.errors.all() });
    }
    let parts = req.body.component_part.join(",");

    try {
        let stmt1 = await otherDB.query("SELECT * FROM `invt_r19` WHERE `insert_by` = :userid", { replacements: { userid: "CRN103522" }, type: otherDB.QueryTypes.SELECT });
        if (stmt1.length > 0) {
            stmt2 = await otherDB.query("UPDATE `invt_r19` SET `part_code` = :parts WHERE `insert_by` = :userid", {
                replacements: {
                    parts: parts,
                    userid: "CRN103522",
                },
                type: otherDB.QueryTypes.UPDATE,
            });
        } else {
            return res.json({ status: "error", success: false, message: "you are not a authorized user to update this information" });
        }

        if (stmt1.length > 0) {
            return res.json({ status: "success", success: true, message: "data saved for reporting" });
        } else {
            return res.json({ status: "error", success: false, message: "an error occured while saving the data" });
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

// UPLOAD R19 Master
router.post("/uploadComponents", upload.single("uploadfile"), [auth.isAuthorized], async (req, res) => {
    try {
        var workbook = XLSX.readFile("./files/" + req.file.filename);
        let json_data = XLSX.utils.sheet_to_json(workbook.Sheets.Sheet1);
        const transaction = await otherDB.transaction();
        if (req.query.stage === "1") {
            fs.unlinkSync("./files/" + req.file.filename);
            let data = [];
            let c_part_name;
            json_data.map(async (item) => {
                let stmt1 = await invtDB.query("SELECT `c_name` FROM `components` WHERE `c_part_no` = :part_code", { replacements: { part_code: item.PART_CODE }, type: invtDB.QueryTypes.SELECT });
                if (stmt1.length > 0) {
                    c_part_name = decode(stmt1[0].c_name);
                } else {
                    return res.json({ status: "error", success: false, message: "part code not valid ( " + item.PART_CODE + " )" });
                }
                data.push({ PART_CODE: item.PART_CODE, PART_NAME: c_part_name });
                if (data.length == json_data.length) {
                    return res.json({ status: "success", success: true, message: "File validation completed, ready for upload on server..", data: data });
                }
            });
        } else if (req.query.stage === "2") {
            let arr1 = [], arr2 = [];
            for (let i = 0; i < json_data.length; i++) {
                let stmt = await invtDB.query("SELECT `component_key`, `c_name` FROM `components` WHERE `c_part_no` =:c_part_no", {
                    replacements: {
                        c_part_no: json_data[i].PART_CODE,
                    },
                    type: invtDB.QueryTypes.SELECT,
                });

                arr1.push(stmt[0].component_key);
                arr2.push({ part_code: json_data[i].PART_CODE, component_key: stmt[0].component_key, name: stmt[0].c_name });
            }

            let stmt1 = await otherDB.query("TRUNCATE TABLE `invt_r19`");
            let stmt2 = await otherDB.query("INSERT INTO invt_r19 (`part_code`,`insert_by`,`insert_dt`) VALUES(:part_code, :insert_by, :insert_dt)", {
                replacements: {
                    part_code: arr1.join(),
                    insert_by: req.logedINUser,
                    insert_dt: moment(new Date()).format('YYYY-MM-DD HH:mm:ss'),
                },
                type: otherDB.QueryTypes.INSERT,
                transaction: transaction
            });
            await transaction.commit();
            return res.json({ status: "success", success: true, message: "File Uploaded..", data: arr2 });
        } else {
            await transaction.rollback();
            return res.json({ status: "error", success: false, message: "an error while executing request from client ends." });
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

router.post("/getSelectedComponent", [auth.isAuthorized], async (req, res) => {
    try {
        let stmt = await otherDB.query("SELECT * FROM `invt_r19`", { type: otherDB.QueryTypes.SELECT });
        if (stmt.length > 0) {
            let parts = stmt[0].part_code;
            let partsArray = parts.split(",");

            let part_options = [];

            let count = 0;

            partsArray.forEach(async (part) => {
                let comp_stmt = await invtDB.query("SELECT `c_name`, `c_part_no` FROM `components` WHERE `component_key` = :partcode", {
                    replacements: { partcode: part },
                    type: invtDB.QueryTypes.SELECT,
                });

                if (comp_stmt.length > 0) {
                    part_options.push({
                        part: comp_stmt[0].c_part_no,
                        name: comp_stmt[0].c_name,
                        component_key: part,
                    });

                    part_options.sort(byPart);
                }
                count++;
                sendResult();
            });

            function sendResult() {
                if (count == partsArray.length) {
                    return res.json({ status: "success", success: true, message: "Components fetched successfully", data: part_options });
                } else {
                    //console.log("ERROR ", count, " == ", partsArray.length);
                }
            }
        } else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});


router.post("/addComponent", [auth.isAuthorized], async (req, res) => {
    const t1 = await otherDB.transaction();
    const t2 = await otherOakterDB.transaction();
    try {
        let arr1 = [];
        let arr2 = [];

        const [stmt1, stmt2] = await Promise.all([
            otherDB.query("SELECT `part_code` FROM `invt_r19` LIMIT 1", {
                type: otherDB.QueryTypes.SELECT,
                transaction: t1,
            }),
            otherOakterDB.query("SELECT `part_code` FROM `invt_r19` LIMIT 1", {
                type: otherOakterDB.QueryTypes.SELECT,
                transaction: t2,
            }),
        ]);

        const handleDB = async (stmt, db, arr, t) => {
            if (stmt.length <= 0) {
                await db.query("INSERT INTO `invt_r19`(`part_code`) VALUES(:part_code)", {
                    replacements: { part_code: req.body.component_key },
                    type: db.QueryTypes.INSERT,
                    transaction: t,
                });
            } else {
                arr.push(...stmt[0].part_code.split(","));
                if (arr.includes(req.body.component_key)) {
                    throw new Error("component already exist");
                }
                arr.push(req.body.component_key);
                await db.query("UPDATE `invt_r19` SET `part_code` = :part_code", {
                    replacements: { part_code: arr.join(",") },
                    type: db.QueryTypes.UPDATE,
                    transaction: t,
                });
            }
        };

        await Promise.all([
            handleDB(stmt1, otherDB, arr1, t1),
            handleDB(stmt2, otherOakterDB, arr2, t2),
        ]);

        await Promise.all([t1.commit(), t2.commit()]);

        return res.json({ status: "success", success: true, message: "Component added successfully" });
    } catch (e) {
        await Promise.all([t1.rollback(), t2.rollback()]);
        if (e.message === "component already exist") {
            return res.json({ status: "error", success: false, message: e.message });
        }
        return helper.errorResponse(res, e);
    }
});


router.post("/removeComponent", [auth.isAuthorized], async (req, res) => {
    const t1 = await otherDB.transaction();
    const t2 = await otherOakterDB.transaction();

    try {
        // Fetch current part_code from both DBs
        const [stmt1, stmt2] = await Promise.all([
            otherDB.query("SELECT `part_code` FROM `invt_r19` LIMIT 1", {
                type: otherDB.QueryTypes.SELECT,
                transaction: t1,
            }),
            otherOakterDB.query("SELECT `part_code` FROM `invt_r19` LIMIT 1", {
                type: otherOakterDB.QueryTypes.SELECT,
                transaction: t2,
            }),
        ]);

        const removeComponentFromDB = async (stmt, db, t) => {
            if (stmt.length === 0) return;

            let arr = stmt[0].part_code.split(",");
            const index = arr.indexOf(req.body.component_key);

            if (index === -1) {
                throw new Error("Component not found");
            }

            arr.splice(index, 1);

            await db.query("UPDATE `invt_r19` SET `part_code` = :part_code", {
                replacements: { part_code: arr.join(",") },
                type: db.QueryTypes.UPDATE,
                transaction: t,
            });
        };

        // Remove from both DBs
        await Promise.all([
            removeComponentFromDB(stmt1, otherDB, t1),
            removeComponentFromDB(stmt2, otherOakterDB, t2),
        ]);

        // Commit both transactions
        await Promise.all([t1.commit(), t2.commit()]);

        return res.json({
            status: "success",
            success: true,
            message: "Component removed successfully",
        });
    } catch (e) {
        await Promise.all([t1.rollback(), t2.rollback()]);

        if (e.message === "Component not found") {
            return res.json({
                status: "error",
                success: false,
                message: e.message,
            });
        }

        return helper.errorResponse(res, e);
    }
});

module.exports = router;

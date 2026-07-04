const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB, otherDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");

const multer = require("multer");
const fs = require("fs");
const xlsx = require("xlsx");
const path = require("path");

var storage = multer.diskStorage({
    destination: "./files/excel",
    filename: function (req, file, cb) {
        cb(null, "PART" + helper.getUniqueNumber() + helper.randomNumber(100, 999) + path.extname(file.originalname));
    },
});
var upload = multer({
    storage: storage,
    limits: { fileSize: 5242880 }, // 5 MB (in binary)
});
router.post("/uploadExcel", [auth.isAuthorized, upload.single("file")], async (req, res) => {
    try {

        if (req.file == undefined) {
            return res.json({ status: "error", success: false, message: "No file selected" });
        }

        const excelFilePath = req.file;

        const workbook = xlsx.readFile(excelFilePath.path);

        const worksheet = workbook.Sheets[workbook.SheetNames[0]];

        const excelData = xlsx.utils.sheet_to_json(worksheet);

        for (let i = 0; i < excelData.length; i++) {

            let stmt_check = await otherDB.query("SELECT * FROM `monthly_audit` WHERE `part_code` = :part_code", {
                replacements: { part_code: excelData[i]["PART_NO"] },
                type: otherDB.QueryTypes.SELECT
            });

            if (stmt_check.length > 0) {

            } else {
                let stmt = await otherDB.query("INSERT INTO `monthly_audit`(`part_code`) VALUES (:part_code)", {
                    replacements: { part_code: excelData[i]["PART_NO"] },
                    type: otherDB.QueryTypes.INSERT
                })
            }
        }

        return res.json({ status: "success", success: true, message: "File uploaded successfully", data: {} });

    }
    catch (error) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: error.stack }) });
    }
})

// GET PART LIST
router.get("/getPartList", [auth.isAuthorized], async (req, res) => {
    try {

        const stmt = await otherDB.query("SELECT part_code FROM `monthly_audit`", {
            type: otherDB.QueryTypes.SELECT
        });

        const all_part_code = [];

        for (let i = 0; i < stmt.length; i++) {
            all_part_code.push(stmt[i].part_code);
        };

        const stmt_comp = await invtDB.query("SELECT c_part_no as part_code , c_name as part_name, c_new_part_no as cat_part FROM `components` WHERE c_part_no IN (:part_code) ", {
            replacements: { part_code: all_part_code },
            type: invtDB.QueryTypes.SELECT
        });

        return res.json({ status: "success", success: true, message: "", data: stmt_comp });
    }
    catch (error) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: error.stack }) });
    }
});

// REMOVE PART
router.post("/removePart", [auth.isAuthorized], async (req, res) => {
    try {

        const valid = new Validator(req.body, {
            part_code: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const stmt = await otherDB.query("DELETE FROM `monthly_audit` WHERE `part_code` = :part_code", {
            replacements: { part_code: req.body.part_code },
            type: otherDB.QueryTypes.DELETE
        });

        return res.json({ status: "success", success: true, message: "Part removed successfully", data: {} });

    }
    catch (error) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: error.stack }) });
    }
})

// ADD ONE BY ONE PART
router.post("/addPart", [auth.isAuthorized], async (req, res) => {
    try {

        const valid = new Validator(req.body, {
            component: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const stmt_get_part = await invtDB.query("SELECT c_part_no FROM `components` WHERE component_key = :part_code ", {
            replacements: { part_code: req.body.component },
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt_get_part.length == 0) {
            return res.json({ status: "error", success: false, message: "Part not found" });
        }

        // CHECK IF PART ALREADY ADDED
        const stmt_check = await otherDB.query("SELECT * FROM `monthly_audit` WHERE `part_code` = :part_code", {
            replacements: { part_code: stmt_get_part[0].c_part_no },
            type: otherDB.QueryTypes.SELECT
        });
        if(stmt_check.length > 0) {
            return res.json({ status: "error", success: false, message: "Part already added" });
        }
        // END CHECK

        const stmt = await otherDB.query("INSERT INTO `monthly_audit`(`part_code`) VALUES (:part_code)", {
            replacements: { part_code: stmt_get_part[0].c_part_no },
            type: otherDB.QueryTypes.INSERT
        });

        return res.json({ status: "success", success: true, message: "Part added successfully", data: {} });

    }
    catch (error) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: error.stack }) });
    }
})

module.exports = router

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

let { tallyDB } = require("../../../config/db/connection");

const Validator = require("validatorjs");

//add new tcs
router.post("/add", [auth.isAuthorized], async (req, res) => {
    try {
        let validation = new Validator(req.body, {
            code: "required",
            name: "required",
            description: "required",
            percentage: "required",
            ledger: "required",
        });

        if (validation.fails()) {
            return res.json({ status: "error", success: false, message: validation.errors.all() });
        }

        let checkCode = await tallyDB.query("SELECT * FROM `tally_tcs` WHERE `tcs_code` = :code", {
            replacements: { code: req.body.code },
            type: tallyDB.QueryTypes.SELECT,
        });

        if (checkCode.length > 0) {
            return res.json({ status: "error", success: false, message: "TCS code already alloted" });
        }

        let checkLedger = await tallyDB.query("SELECT * FROM `tally_ledger` WHERE `ledger_key` = :ledger", {
            replacements: { ledger: req.body.ledger },
            type: tallyDB.QueryTypes.SELECT,
        });

        if (checkLedger.length > 0) {
            let insertTcs = await tallyDB.query("INSERT INTO tally_tcs (tcs_name , tcs_code , tcs_description , tcs_percent , tcs_gl_code , tcs_key , insert_by , insert_date) VALUES (:tcsName , :tcsCode , :tcsDescription , :tcsPercent , :tcsGlCode , :tcsKey , :insertBy , :insertDate)", {
                replacements: {
                    tcsName: req.body.name,
                    tcsCode: req.body.code,
                    tcsDescription: req.body.description,
                    tcsPercent: req.body.percentage,
                    tcsGlCode: req.body.ledger,
                    tcsKey: "TCS" + helper.getUniqueNumber(),
                    insertBy: req.logedINUser,
                    insertDate: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                },
                type: tallyDB.QueryTypes.INSERT,
            });

            if (insertTcs.length > 0) {
                return res.json({ status: "success", success: true, message: "TCS added successfully" });
            }
            return res.json({ status: "error", success: false, message: "Something went wrong while creating TCS" });
        }
        return res.json({ status: "error", success: false, message: "G/L code is not valid" });
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

// tcs group ledger options
router.get("/tcsLedgerOptions", [auth.isAuthorized], async (req, res) => {
    try {
        let stmt;
        if (req.query.search == null || req.query.search == "" || req.query.search == undefined) {
            stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE sub_group_key = 'TP20220219125803' LIMIT 50", {
                type: tallyDB.QueryTypes.SELECT,
            });
        } else {
            stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE sub_group_key = 'TP20220219125803' AND (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
                replacements: { name: `%${req.query.search}%` },
                type: tallyDB.QueryTypes.SELECT,
            });
        }

        let final = [];
        if (stmt.length > 0) {
            stmt.map((item) => {
                final.push({
                    id: item.ledger_key,
                    text: `(${item.code})${item.ladger_name}`,
                });
            });
            return res.json({ status: "success", success: true, data: final });
        } else {
            return res.json({ status: "error", success: false, message: "No Gl Found!!!" });
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

// list all tcs
router.get("/list", [auth.isAuthorized], async (req, res) => {
    try {
        let fetchTcs = await tallyDB.query("SELECT tally_tcs.ID , tcs_gl_code , tcs_code , tcs_name , tcs_description , tcs_percent , status , ladger_name , tally_ledger.code as gl_code FROM tally_tcs LEFT JOIN tally_ledger ON tally_tcs.tcs_gl_code = tally_ledger.ledger_key WHERE status = 'open' ", {
            type: tallyDB.QueryTypes.SELECT,
        });

        if (fetchTcs.length > 0) {
            let final = []
            fetchTcs.map((item) => {
                final.push({
                    tcsCode: item.tcs_code,
                    name: item.tcs_name,
                    desc: item.tcs_description,
                    percentage: item.tcs_percent,
                    glCode: item.gl_code,
                    glName: item.ladger_name,
                    glKey: item.tcs_gl_code,
                    status: item.status,
                    ID: Buffer.from(JSON.stringify(item.ID)).toString("base64"),
                })
            })

            return res.json({ status: "success", success: true, data: final });
        } else {
            return res.json({ status: "error", success: false, message: "No Data Found" });
        }
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

// blocked tcs list
router.get("/list/blocked", [auth.isAuthorized], async (req, res) => {
    try {
        let fetchTcs = await tallyDB.query("SELECT tally_tcs.ID , tcs_gl_code , tcs_code , tcs_name , tcs_description , tcs_percent , status , ladger_name , tally_ledger.code as gl_code FROM tally_tcs LEFT JOIN tally_ledger ON tally_tcs.tcs_gl_code = tally_ledger.ledger_key WHERE status = 'closed' ", {
            type: tallyDB.QueryTypes.SELECT,
        });

        if (fetchTcs.length > 0) {
            let final = []
            fetchTcs.map((item) => {
                final.push({
                    tcsCode: item.tcs_code,
                    name: item.tcs_name,
                    desc: item.tcs_description,
                    percentage: item.tcs_percent,
                    glCode: item.gl_code,
                    glName: item.ladger_name,
                    glKey: item.tcs_gl_code,
                    status: item.status,
                    ID: Buffer.from(JSON.stringify(item.ID)).toString("base64"),
                })
            })

            return res.json({ status: "success", success: true, data: final });
        } else {
            return res.json({ status: "error", success: false, message: "No Data Found" });
        }
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

// update tcs
router.put("/update", [auth.isAuthorized], async (req, res) => {
    try {
        let validation = new Validator(req.body, {
            code: "required",
            name: "required",
            description: "required",
            percentage: "required",
            ledger: "required",
            status: "required",
            ID: "required",
        })

        if (validation.fails()) {
            return res.json({ status: "error", success: false, message: validation.errors.all() })
        }

        let fetchTcs = await tallyDB.query("SELECT * FROM `tally_tcs` WHERE `ID` = :rowID", {
            replacements: {
                rowID: Number(Buffer.from(req.body.ID, "base64").toString("utf-8"))
            },
            type: tallyDB.QueryTypes.SELECT
        });

        if (fetchTcs.length > 0) {
            let updateTcs = await tallyDB.query("UPDATE tally_tcs SET tcs_name = :tcsName , tcs_code = :tcsCode , tcs_description = :tcsDescription , tcs_percent = :tcsPercent , tcs_gl_code = :tcsGlCode , status = :status , update_by = :updateBy , update_date = :updateDate WHERE ID = :rowID", {
                replacements: {
                    tcsName: req.body.name,
                    tcsCode: req.body.code,
                    tcsDescription: req.body.description,
                    tcsPercent: req.body.percentage,
                    tcsGlCode: req.body.ledger,
                    status: req.body.status,
                    updateBy: req.logedINUser,
                    updateDate: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                    rowID: Number(Buffer.from(req.body.ID, "base64").toString("utf-8"))
                },
                type: tallyDB.QueryTypes.UPDATE
            });

            if (updateTcs.length > 0) {
                return res.json({ status: "success", success: true, message: "TCS updated successfully" })
            }
            return res.json({ status: "error", success: false, message: "Error while updating TCS" })
        }
        return res.json({ status: 'error', message: 'No Data Found' })
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

// get tcs by gl
router.get("/get", [auth.isAuthorized], async (req, res) => {
    try {
        let validation = new Validator(req.query, {
            gl: "required",
        });

        if (validation.fails()) {
            return res.status(403).send(Object.values(validation.errors.all())[0].join());
        }

        let fetchTcs = await tallyDB.query("SELECT tcs_gl_code , tcs_percent FROM `tally_tcs` WHERE `tcs_gl_code` = :gl", {
            replacements: {
                gl: req.query.gl
            },
            type: tallyDB.QueryTypes.SELECT
        });

        if (fetchTcs.length > 0) {
            return res.json({ gl: fetchTcs[0].tcs_gl_code, percent: fetchTcs[0].tcs_percent });
        }
        return res.json({ status: "error", success: false, message: "not found" });
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

// get all tcs key and name
router.get("/getAllTcs", [auth.isAuthorized], async (req, res) => {
    try {
        let fetchTcs = await tallyDB.query("SELECT `tcs_key`,`tcs_name` FROM `tally_tcs` WHERE status = 'open'", { type: tallyDB.QueryTypes.SELECT });
        if (fetchTcs.length > 0) {
            var data = [];
            fetchTcs.map(async (element) => {
                data.push({
                    tcsKey: element.tcs_key,
                    tcsName: element.tcs_name,
                });

                if (data.length == fetchTcs.length) {
                    return res.json(data);
                }
            });
        }
        return res.json({ status: "error", success: false, message: "No data found" });
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

module.exports = router;
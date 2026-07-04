const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
let { tallyDB, invtDB } = require("../../../config/db/connection");

const Validator = require("validatorjs");

router.get("/fetchInvGroup", [auth.isAuthorized], async (req, res) => {
    try {
        let validation = new Validator(req.query, {
            type: "required"
        });

        if (validation.fails()) {
            return res.status(403).send(Object.values(validation.errors.all())[0].join());
        }

        let fetchGroup = await tallyDB.query("SELECT name , groupKey FROM invoice_module WHERE name = :name", {
            replacements: { name: req.query.type },
            type: tallyDB.QueryTypes.SELECT,
        });

        if (fetchGroup.length > 0) {
            let subGroup = fetchGroup[0].groupKey?.split(",");

            let fetchGroupDetail = await tallyDB.query(`SELECT group_key AS value, CONCAT(code , ' - ', group_name) AS text FROM tally_group WHERE group_key IN (:key)`, {
                replacements: { key: subGroup },
                type: tallyDB.QueryTypes.SELECT,
            });

            return res.json(fetchGroupDetail);
        }
        return res.json({ status: "error", success: false, message: "no data found" });
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

router.put("/updateInvGroup", [auth.isAuthorized], async (req, res) => {
    try {
        let validation = new Validator(req.body, {
            name: "required",
            group: "required",
        });

        if (validation.fails()) {
            return res.status(403).send(Object.values(validation.errors.all())[0].join());
        }

        let updateGroup = await tallyDB.query("UPDATE invoice_module SET groupKey = :group WHERE name = :name", {
            replacements: {
                name: req.body.name,
                group: req.body.group ? req.body.group.join(",") : ""
            },
            type: tallyDB.QueryTypes.UPDATE,
        });

        if (updateGroup.length <= 0) {
            return res.json({ status: "error", success: false, message: "error while updating group" });
        }
        return res.json({ status: "error", success: false, message: "group updated successfully" });
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

module.exports = router;
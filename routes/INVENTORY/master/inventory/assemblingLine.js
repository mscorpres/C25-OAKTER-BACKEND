const express = require("express");
const router = express.Router();



const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");

function uniqueString(length) {
    var result = "";
    var characters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

// Save Assembly Line
router.post("/saveAssemblingLines", [auth.isAuthorized], async (req, res) => {
    const validation = new Validator(
        req.body,
        {
            label: "required"
        },
        {
            label: "Please supply the address label",
        }
    );

    if (validation.fails()) {
        return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
    }

    const t = await invtDB.transaction();

    try {
        let stmt1 = await invtDB.query(
            "INSERT INTO `ims_prod_lines` (`company_branch`,`line_name`,`line_code`,`insert_date`,`insert_by`,`line_leader`) VALUES (:branch, :linename, :linecode, :insert_date, :insert_by,:leader)",
            {
                replacements: {
                    company: req.branch,
                    linename: req.body.line,
                    linecode: await uniqueString(8),
                    insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                    insert_by: req.logedINUser,
                    leader: req.body.leader
                },
                transaction: t,
            }
        );

        if (stmt1.length > 0) {
            t.commit();
            return res.json({ status: "success", success: true, message: "line saved successfully", data: {} });
        } else {
            t.rollback();
            return res.json({ status: "error", success: false, message: "an error occured while adding a new line" });
        }
    } catch (error) {
        return helper.errorResponse(res, error);
    }
});

// Get Assembly Line
router.post("/getAssemblingLines", [auth.isAuthorized], async (req, res) => {
    try {
        const limit = 10;
        let stmt;
        if (req.body.search) {
            stmt = await invtDB.query("SELECT * FROM `ims_prod_lines` WHERE `line_status` = 'A' AND `company_branch` = :branch AND (`line_name` like :name OR `line_code` LIKE :name) ORDER BY `line_name` LIMIT :limit", {
                replacements: { name: `%${req.body.search}%`, limit: limit, branch: req.branch },
                type: invtDB.QueryTypes.SELECT,
            });
        } else {
            stmt = await invtDB.query("SELECT * FROM `ims_prod_lines` WHERE `line_status` = 'A' AND `company_branch` = :branch ORDER BY `line_name` ASC LIMIT :limit", { replacements: { limit: limit, branch: req.branch }, type: invtDB.QueryTypes.SELECT });
        }

        let final = [];

        stmt.map((item) => {
            final.push({ id: item.line_code, text: item.line_name });

            if (stmt.length == final.length) {
                res.json(final);
                return;
            }
        });
    } catch (error) {
        return helper.errorResponse(res, error);
    }
});

// Get Assembly Line 
router.post("/getAssemblingLeaders", [auth.isAuthorized], async (req, res) => {
    let validation = new Validator(req.body, {
        line_key: "required",
    });
    if (validation.fails()) {
        return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
    }

    try {
        let stmt = await invtDB.query("SELECT `line_leader` FROM `ims_prod_lines` WHERE `line_status` = 'A' AND `company_branch` = :branch", {
            replacements: { branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
        });

        if (stmt.length > 0) {
            let line_leader = stmt[0].line_leader.split(",");
            let data = [];
            for (let i = 0; i < line_leader.length; i++) {
                let stmt_sub = await invtDB.query("SELECT `CustID`,`user_name` FROM `admin_login` WHERE `CustID` = :customer", {
                    replacements: { customer: line_leader[i] },
                    type: invtDB.QueryTypes.SELECT,
                });

                data.push({ code: stmt_sub[0].CustID, label: stmt_sub[0].user_name });
            }

            return res.json({ status: "success", success: true, message: "", data: data });
        } else {
            return res.json({ status: "error", success: false, message: "No data Found" });
        }
    } catch (error) {
        return helper.errorResponse(res, error);
    }
});

module.exports = router;

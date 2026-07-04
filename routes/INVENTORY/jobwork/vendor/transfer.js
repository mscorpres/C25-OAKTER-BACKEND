const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

let { invtDB } = require("../../../../config/db/connection");

const auth = require("../../../../middleware/ven_auth");
const Validator = require("validatorjs");
const { encode, decode } = require("html-entities");


// FETCH COMPONENT INFO STOCK FOR TRANSFER 23-01-2024
router.post("/getStock", [auth.isAuthorized], async (req, res) => {
    const validation = new Validator(req.body, {
        component: "required",
        pick_location: "required",
    });

    if (validation.fails()) {
        res.json({ status: "error", success: false, message: "something you missing in form field to supply", data: validation.errors.all() });
        return;
    }
    try {
        let stmt = await invtDB.query(
            "SELECT total_in, total_trn, (total_in - total_trn) AS stock FROM ( SELECT COALESCE( SUM( CASE WHEN jw_ven_location.jw_ven_txn_type = 'RM-INWARD' AND jw_ven_location.jw_ven_loc_in = :pick_location THEN jw_ven_location.jw_ven_in_qty ELSE 0 END ), 0 ) AS total_in, COALESCE( SUM( CASE WHEN jw_ven_location.jw_ven_txn_type = 'RM-TRANSFER' AND jw_ven_location.jw_ven_loc_out = :pick_location THEN jw_ven_location.jw_ven_in_qty ELSE 0 END ), 0 ) AS total_trn FROM jw_ven_location WHERE jw_ven_location.jw_ven_code = :vendor AND jw_ven_location.jw_ven_rm = :component ) AS subquery",
            {
                replacements: {
                    pick_location: req.body.pick_location,
                    component: req.body.component,
                    vendor: req.logedINVendor
                },
                type: invtDB.QueryTypes.SELECT,
            }
        );

        if (stmt.length > 0) {
            return res.json({

                status: "success", success: true,
                data: {
                    location_qty: helper.number(stmt[0].total_in),
                    transfered_qty: helper.number(stmt[0].total_trn),
                    calculated_qty: helper.number(stmt[0].stock),
                }
            });
        } else {
            return res.json({ status: "error", success: false, message: "unregistered component found" });
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});


// SAVE TRANSFER 23-01-2024
router.post("/saveTransfer", [auth.isAuthorized], async (req, res) => {
    const t = await invtDB.transaction();

    let itemLength = req.body.component.length;

    if (itemLength <= 0) {
        t.rollback();
        res.json({ status: "error", success: false, message: "Please add atleast one item" });
        return;
    }

    for (let i = 0; i < itemLength; i++) {
        let itemValidation = new Validator(
            {
                item: req.body.component[i],
                qty: req.body.qty[i],
                pick_location: req.body.pick_location[i],
                drop_location: req.body.drop_location[i]
            },
            {
                item: "required",
                qty: "required|min:1",
                pick_location: "required",
                drop_location: "required"
            }
        );
        if (itemValidation.fails()) {
            t.rollback();
            res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(itemValidation) });
            return;
        }
    }

    let trn_txn_no = await helper.genTransaction("JW_MIN", t);

    try {
        let get_transaction_id = await invtDB.query("SELECT `jw_ven_txn` FROM `jw_ven_location` WHERE `jw_ven_txn` = :transaction_id GROUP BY `jw_ven_txn` LIMIT 1", {
            replacements: { transaction_id: trn_txn_no },
            type: invtDB.QueryTypes.SELECT,
        });

        if (get_transaction_id.length > 0) {
            t.rollback();
            res.json({

                status: "error", success: false,
                message: "alloting transaction id as " + get_transaction_id[0].trn_txn_no + " for transfer has already exist with us, required manual checking or contact to system administrator",
            });
            return;
        } else {
            for (let i = 0; i < itemLength; i++) {
                if (helper.number(req.body.qty[i]) > 0) {
                    let select_res = await invtDB.query(
                        "SELECT total_in, total_trn, (total_in - total_trn) AS stock FROM ( SELECT COALESCE( SUM( CASE WHEN jw_ven_location.jw_ven_txn_type = 'RM-INWARD' AND jw_ven_location.jw_ven_loc_in = :pick_location THEN jw_ven_location.jw_ven_in_qty ELSE 0 END ), 0 ) AS total_in, COALESCE( SUM( CASE WHEN jw_ven_location.jw_ven_txn_type = 'RM-TRANSFER' AND jw_ven_location.jw_ven_loc_out = :pick_location THEN jw_ven_location.jw_ven_in_qty ELSE 0 END ), 0 ) AS total_trn FROM jw_ven_location WHERE jw_ven_location.jw_ven_code = :vendor AND jw_ven_location.jw_ven_rm = :component ) AS subquery",
                        {
                            replacements: {
                                pick_location: req.body.pick_location[i],
                                component: req.body.component[i],
                                vendor: req.logedINVendor
                            },
                            type: invtDB.QueryTypes.SELECT,
                        }
                    );

                    if (select_res.length < 0) {
                        t.rollback();
                        res.json({ message: "no such component found for the transaction", status: "error", success: false });
                        return;
                    }

                    if (helper.number(select_res[0].stock) < helper.number(req.body.qty[i])) {
                        t.rollback();
                        res.json({ message: "sequence [${i + 1}] transaction made for QTY ${helper.number(req.body.qty[i])} is not possible due to less stock at location - [${select_res[0].stock}]", status: "error", success: false });
                        return;
                    }

                    let insert_res = await invtDB.query(
                        "INSERT INTO `jw_ven_location` (jw_ven_code,jw_ven_txn_type, jw_ven_rm, jw_ven_in_qty, jw_ven_loc_in, jw_ven_loc_out, jw_ven_remark, jw_ven_insert_dt, jw_ven_insert_by, jw_ven_txn) VALUES (:vendor,:type, :part, :inqty, :locin, :locout, :remark, :indt, :inby, :transaction)",
                        {
                            replacements: {
                                vendor: req.logedINVendor,
                                type: 'RM-TRANSFER',
                                part: req.body.component[i],
                                inqty: req.body.qty[i],
                                locin: req.body.drop_location[i],
                                locout: req.body.pick_location[i],
                                remark: req.body.remark[i] == "" ? "--" : req.body.remark[i],
                                indt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                                inby: req.logedINUser,
                                transaction: trn_txn_no
                            },
                            type: invtDB.QueryTypes.INSERT,
                            transaction: t,
                        }
                    );
                }

            }

            await t.commit();
            res.json({ status: "success", success: true, message: "RM transfered successfully : " + trn_txn_no, data: { txn: trn_txn_no } });
            return;
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});


module.exports = router;
const express = require("express");
const router = express.Router();
let { invtDB } = require("../../../../config/db/connection");

const auth = require("../../../../middleware/ven_auth");
const Validator = require("validatorjs");
const { encode, decode } = require("html-entities");


// SAVE REJECTION 27-01-2024
router.post("/saveRejection", [auth.isAuthorized], async (req, res) => {
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
            },
            {
                item: "required",
                qty: "required|min:1",
            }
        );
        if (itemValidation.fails()) {
            t.rollback();
            res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(itemValidation) });
            return;
        }
    }

    let getNumber = await invtDB.query("SELECT jw_ven_txn FROM `jw_ven_location` WHERE jw_ven_code = :vendor GROUP BY `jw_ven_txn` ORDER BY `ID` DESC LIMIT 1 FOR UPDATE", {
        type: invtDB.QueryTypes.SELECT, replacements: {
            vendor: req.logedINVendor
        }
    });

    var rej_txn_no;
    if (getNumber.length > 0) {
        rej_txn_no = getNumber[0].jw_ven_txn;
    } else {
        rej_txn_no = "REJ0001";
    }

    try {
        for (let i = 0; i < itemLength; i++) {
            if (helper.number(req.body.qty[i]) > 0) {
                let strings = rej_txn_no.replace(/[0-9]/g, "");
                let digits = (parseInt(rej_txn_no.replace(/[^0-9]/g, "")) + 1).toString().padStart(4, '0');
                rej_txn_no = strings + digits;
                let get_transaction_id = await invtDB.query("SELECT `jw_ven_txn` FROM `jw_ven_location` WHERE `jw_ven_txn` = :transaction_id GROUP BY `jw_ven_txn` LIMIT 1", {
                    replacements: { transaction_id: rej_txn_no },
                    type: invtDB.QueryTypes.SELECT,
                });

                if (get_transaction_id.length > 0) {
                    t.rollback();
                    return res.json({ status: "error", success: false, message: "alloting transaction id as " + get_transaction_id[0].rej_txn_no + " for rejection has already exist with us, required manual checking or contact to system administrator" });
                }
                let insert_res = await invtDB.query(
                    "INSERT INTO `jw_ven_location` (jw_ven_code,jw_ven_txn_type, jw_ven_rm, jw_ven_in_qty, jw_ven_remark, jw_ven_insert_dt, jw_ven_insert_by, jw_ven_txn) VALUES (:vendor,:type, :part, :qty, :remark, :indt, :inby, :transaction)",
                    {
                        replacements: {
                            vendor: req.logedINVendor,
                            type: 'RM-REJECTION',
                            part: req.body.component[i],
                            qty: req.body.qty[i],
                            remark: req.body.remark[i] == "" ? "--" : req.body.remark[i],
                            indt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                            inby: req.logedINUser,
                            transaction: rej_txn_no
                        },
                        type: invtDB.QueryTypes.INSERT,
                        transaction: t,
                    }
                );
            }

        }

        await t.commit();
        res.json({ status: "success", success: true, message: "RM rejection successfully : " + rej_txn_no, data: { txn: rej_txn_no } });
        return;
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});


module.exports = router;
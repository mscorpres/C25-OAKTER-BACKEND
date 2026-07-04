const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const { tallyDB, otherDB } = require("../../../config/db/connection");

const Validator = require("validatorjs");

router.get("/", [auth.isAuthorized], async (req, res) => {
    let validator = new Validator(req.query, {
        componentID: "required",
    });

    if (validator.fails()) {
        return res.json({
            status: "error", success: false,
            success: false,
            message: Object.values(validator.errors.all())[0].join()
        })
    }

    try {
        let fetchTotalQty = await otherDB.query("SELECT r20.total_balance , r20.in_date AS closingDate FROM invt_r20 AS r20 WHERE r20.component_key = :componentID", {
            replacements: {
                componentID: req.query.componentID
            },
            type: otherDB.QueryTypes.SELECT
        })

        if (fetchTotalQty.length <= 0) {
            return res.json({
                status: "error", success: false,
                success: false,
                message: "No data found."
            })
        }

        let fetchItemLedger = await tallyDB.query(`SELECT po_number AS poID , project_id AS project , vbt_inqty AS inQty , vbt_inrate AS inRate , cifPrice , vbt_key AS vbtKey , min_id AS minID , ven_code AS venCode , vbt_invoice_no AS invoiceNo , effective_date AS effectiveDate, insert_date AS insertDate , ven.ven_name AS venName FROM tally_vbt LEFT JOIN ${global.ims_db_name}.ven_basic_detail AS ven ON ven.ven_register_id = ven_code WHERE part_code = :componentID ORDER BY tally_vbt.ID DESC`, {
            replacements: {
                componentID: req.query.componentID
            },
            type: tallyDB.QueryTypes.SELECT
        });

        if (fetchItemLedger.length <= 0) {
            return res.json({
                status: "error", success: false,
                success: false,
                message: "No data found."
            })
        }

        let totalQty = fetchTotalQty[0].total_balance;
        let result = [];
        let totalPrice = 0;
        let totalConsideredQty = 0;

        for (let i = 0; i < fetchItemLedger.length; i++) {
            let vbtInQuantity = fetchItemLedger[i].inQty;
            let vbtInRate = fetchItemLedger[i].inRate;
            let vbtCifRate = fetchItemLedger[i].cifPrice;

            if (totalQty > 0) {
                let consideredQty = Math.min(vbtInQuantity, totalQty);
                totalQty -= consideredQty;
                totalPrice += ((Number(vbtCifRate) > 0 ? Number(vbtCifRate) : Number(vbtInRate)) * Number(consideredQty));
                totalConsideredQty += consideredQty;
                result.push({
                    poID: fetchItemLedger[i].poID,
                    project: fetchItemLedger[i].project,
                    vbtKey: fetchItemLedger[i].vbtKey,
                    minID: fetchItemLedger[i].minID,
                    venCode: fetchItemLedger[i].venCode,
                    invoiceNo: fetchItemLedger[i].invoiceNo,
                    venName: fetchItemLedger[i].venName,
                    consideredQty: consideredQty,
                    inRate: vbtInRate,
                    cifPrice: vbtCifRate ? vbtCifRate : 0,
                    inQty: vbtInQuantity,
                    effectiveDate: moment(fetchItemLedger[i].effectiveDate).format("DD-MM-YYYY"),
                    insertDate: moment(fetchItemLedger[i].insertDate).format("DD-MM-YYYY"),
                    totalValue: (Number(vbtCifRate) > 0 ? Number(vbtCifRate) : Number(vbtInRate)) * Number(consideredQty)
                })
            }

        }
        return res.json({
            status: "success", success: true,
            success: true,
            data: {
                result: result,
                summary: {
                    closingDate: moment(fetchTotalQty[0].closingDate).format("DD-MM-YYYY"),
                    totalPrice: totalPrice,
                    totalConsideredQty: totalConsideredQty
                }
            }
        });
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

module.exports = router;
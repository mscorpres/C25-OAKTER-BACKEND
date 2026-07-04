const router = require("express").Router();
const { tallyDB } = require("../../../config/db/connection");
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

router.get("/generateReport", [auth.isAuthorized], async (req, res) => {
    try {

        const validator = new Validator(req.query, {
            date: "required"
        });

        if (validator.fails()) {
            return res.status(403).send(Object.values(validator.errors.all())[0].join());
        }

        const date = req.query.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
        const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
        const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

        const gstRegex = new RegExp(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/);

        const fetchLedgers = await tallyDB.query("SELECT ladger_key AS customerCode, COALESCE(SUM(`tally_ledger_data`.`debit`), 0) AS total_debit, COALESCE(SUM(`tally_ledger_data`.`credit`), 0) AS total_credit , module_used AS moduleUsed , debit_key AS debitKey , which_module AS whichModule , ref_date AS refDate FROM `tally_ledger_data` WHERE `ladger_key` LIKE :ladgerKey AND `which_module` LIKE :whichModule AND (DATE_FORMAT(tally_ledger_data.ref_date, '%Y-%m-%d') BETWEEN :date1 AND :date2) GROUP BY module_used , debit_key", {
            replacements: {
                date1: date1,
                date2: date2,
                ladgerKey: '%CUS%',
                whichModule: '%INV%',
            },
            type: tallyDB.QueryTypes.SELECT
        });

        let b2bSales = [];
        let b2bCN = [];
        let b2cSales = [];
        let b2cCN = [];

        for (let i = 0; i < fetchLedgers.length; i++) {

            const checkBusiness = await tallyDB.query("SELECT shippingGst AS gst , shippingName AS name , state_code.name AS stateName FROM invoice LEFT JOIN state_code ON state_code.code = invoice.shippingState WHERE invoiceID LIKE :invoiceID AND creditNoteID LIKE :creditNoteID", {
                replacements: {
                    invoiceID: fetchLedgers[i].moduleUsed == "" ? "" : `${fetchLedgers[i].moduleUsed}`,
                    creditNoteID: fetchLedgers[i].debitKey == "--" ? "" : `${fetchLedgers[i].debitKey}`,
                },
                type: tallyDB.QueryTypes.SELECT
            });

            const isB2B = gstRegex.test(checkBusiness[0].gst)

            if (isB2B == true) {

                if (fetchLedgers[i].debitKey != "--" && fetchLedgers[i].debitKey != null && fetchLedgers[i].debitKey != "" && fetchLedgers[i].debitKey != undefined) {
                    const fetchProduct = await tallyDB.query("SELECT COALESCE(SUM(products.taxableValue), 0) AS totalTaxableValue, COALESCE(SUM(products.cgst), 0) AS totalCGST , COALESCE(SUM(products.sgst), 0) AS totalSGST , COALESCE(SUM(products.igst), 0) AS totalIGST , COALESCE(SUM(products.cgst + products.sgst + products.igst), 0) AS totalTax , COALESCE(SUM(products.customerAmount), 0) AS totalCustomerAmount FROM products WHERE creditNoteID = :creditNoteKey GROUP BY creditNoteID HAVING totalTax > 0", {
                        replacements: {
                            creditNoteKey: fetchLedgers[i].debitKey
                        },
                        type: tallyDB.QueryTypes.SELECT
                    });

                    if (fetchProduct.length > 0) {
                        b2bCN.push({
                            customerCode: fetchLedgers[i].customerCode,
                            customerName: checkBusiness[0].name,
                            gstNo: checkBusiness[0].gst,
                            refDate: fetchLedgers[i].refDate,
                            voucherType: "Credit Note",
                            voucherNo: fetchLedgers[i].debitKey,
                            totalTaxableValue: "-" + fetchProduct[0].totalTaxableValue,
                            totalCGST: fetchProduct[0].totalCGST ? "-" + fetchProduct[0].totalCGST : 0,
                            totalSGST: fetchProduct[0].totalSGST ? "-" + fetchProduct[0].totalSGST : 0,
                            totalIGST: fetchProduct[0].totalIGST ? "-" + fetchProduct[0].totalIGST : 0,
                            totalTax: "-" + fetchProduct[0].totalTax,
                            totalCustomerAmount: "-" + fetchProduct[0].totalCustomerAmount,
                            stateName: checkBusiness[0].stateName,
                            invoiceNo: fetchLedgers[i].moduleUsed
                        });
                    }

                } else {
                    const fetchProduct = await tallyDB.query("SELECT COALESCE(SUM(products.taxableValue), 0) AS totalTaxableValue, COALESCE(SUM(products.cgst), 0) AS totalCGST , COALESCE(SUM(products.sgst), 0) AS totalSGST , COALESCE(SUM(products.igst), 0) AS totalIGST , COALESCE(SUM(products.cgst + products.sgst + products.igst), 0) AS totalTax , COALESCE(SUM(products.customerAmount), 0) AS totalCustomerAmount FROM products WHERE invoiceID = :invoiceID AND creditNoteID = '' GROUP BY invoiceID HAVING totalTax > 0", {
                        replacements: {
                            invoiceID: fetchLedgers[i].moduleUsed
                        },
                        type: tallyDB.QueryTypes.SELECT
                    });
                    if (fetchProduct.length > 0) {
                        b2bSales.push({
                            customerCode: fetchLedgers[i].customerCode,
                            customerName: checkBusiness[0].name,
                            gstNo: checkBusiness[0].gst,
                            refDate: fetchLedgers[i].refDate,
                            voucherType: "Sales",
                            voucherNo: fetchLedgers[i].moduleUsed,
                            totalTaxableValue: fetchProduct[0].totalTaxableValue,
                            totalCGST: fetchProduct[0].totalCGST,
                            totalSGST: fetchProduct[0].totalSGST,
                            totalIGST: fetchProduct[0].totalIGST,
                            totalTax: fetchProduct[0].totalTax,
                            totalCustomerAmount: fetchProduct[0].totalCustomerAmount,
                            stateName: checkBusiness[0].stateName,
                            invoiceNo: fetchLedgers[i].moduleUsed
                        });
                    }

                }
            } else {
                if (fetchLedgers[i].debitKey != "--" && fetchLedgers[i].debitKey != null && fetchLedgers[i].debitKey != "" && fetchLedgers[i].debitKey != undefined) {
                    const fetchProduct = await tallyDB.query("SELECT COALESCE(SUM(products.taxableValue), 0) AS totalTaxableValue, COALESCE(SUM(products.cgst), 0) AS totalCGST , COALESCE(SUM(products.sgst), 0) AS totalSGST , COALESCE(SUM(products.igst), 0) AS totalIGST , COALESCE(SUM(products.cgst + products.sgst + products.igst), 0) AS totalTax , COALESCE(SUM(products.customerAmount), 0) AS totalCustomerAmount FROM products WHERE creditNoteID = :creditNoteKey GROUP BY creditNoteID HAVING totalTax > 0", {
                        replacements: {
                            creditNoteKey: fetchLedgers[i].debitKey
                        },
                        type: tallyDB.QueryTypes.SELECT
                    });

                    if (fetchProduct.length > 0) {
                        b2cCN.push({
                            customerCode: fetchLedgers[i].customerCode,
                            customerName: checkBusiness[0].name,
                            gstNo: checkBusiness[0].gst,
                            refDate: fetchLedgers[i].refDate,
                            voucherType: "Credit Note",
                            voucherNo: fetchLedgers[i].debitKey,
                            totalTaxableValue: "-" + fetchProduct[0].totalTaxableValue,
                            totalCGST: fetchProduct[0].totalCGST ? "-" + fetchProduct[0].totalCGST : 0,
                            totalSGST: fetchProduct[0].totalSGST ? "-" + fetchProduct[0].totalSGST : 0,
                            totalIGST: fetchProduct[0].totalIGST ? "-" + fetchProduct[0].totalIGST : 0,
                            totalTax: "-" + fetchProduct[0].totalTax,
                            totalCustomerAmount: "-" + fetchProduct[0].totalCustomerAmount,
                            stateName: checkBusiness[0].stateName,
                            invoiceNo: fetchLedgers[i].moduleUsed
                        });
                    }

                } else {
                    const fetchProduct = await tallyDB.query("SELECT COALESCE(SUM(products.taxableValue), 0) AS totalTaxableValue, COALESCE(SUM(products.cgst), 0) AS totalCGST , COALESCE(SUM(products.sgst), 0) AS totalSGST , COALESCE(SUM(products.igst), 0) AS totalIGST , COALESCE(SUM(products.cgst + products.sgst + products.igst), 0) AS totalTax , COALESCE(SUM(products.customerAmount), 0) AS totalCustomerAmount FROM products WHERE invoiceID = :invoiceID AND creditNoteID = '' GROUP BY invoiceID HAVING totalTax > 0", {
                        replacements: {
                            invoiceID: fetchLedgers[i].moduleUsed
                        },
                        type: tallyDB.QueryTypes.SELECT
                    });

                    if (fetchProduct.length > 0) {
                        b2cSales.push({
                            customerCode: fetchLedgers[i].customerCode,
                            customerName: checkBusiness[0].name,
                            gstNo: checkBusiness[0].gst,
                            refDate: fetchLedgers[i].refDate,
                            voucherType: "Sales",
                            voucherNo: fetchLedgers[i].moduleUsed,
                            totalTaxableValue: fetchProduct[0].totalTaxableValue,
                            totalCGST: fetchProduct[0].totalCGST,
                            totalSGST: fetchProduct[0].totalSGST,
                            totalIGST: fetchProduct[0].totalIGST,
                            totalTax: fetchProduct[0].totalTax,
                            totalCustomerAmount: fetchProduct[0].totalCustomerAmount,
                            stateName: checkBusiness[0].stateName,
                            invoiceNo: fetchLedgers[i].moduleUsed
                        });
                    }

                }
            }
        }

        return res.status(200).send({
            "B2B Invoices": b2bSales,
            "Credit or Debit Notes (Registered)": b2bCN,
            "B2C (Small) Invoices": b2cSales.concat(b2cCN)
        });

    } catch (error) {
        return helper.errorResponse(res, error);
    }
});


module.exports = router
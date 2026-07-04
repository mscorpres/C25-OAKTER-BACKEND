const express = require("express")
const router = express.Router()
const auth = require("../../../middleware/auth")
const permission = require("../../../middleware/permission")
const Validator = require("validatorjs")
const { tallyDB, invtDB } = require("../../../config/db/connection")
const xlsx = require("xlsx");
const multer = require("multer");
const path = require("path");

var storage = multer.diskStorage({
    destination: (req, file, callBack) => {
        callBack(null, "./files/po/");
    },
    filename: (req, file, callBack) => {
        callBack(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
    },
});

var uploadPurchase = multer({ storage: storage });

router.post("/deleteVbt", [auth.isAuthorized], async (req, res) => {
    try {
        let validation = new Validator(req.body, {
            vbtKey: "required"
        })

        if (validation.fails()) {
            return res.json({ status: 'error', message: validation.errors.all() })
        }

        const transactionTally = await tallyDB.transaction()
        const transactionInventory = await invtDB.transaction()

        let stmt = await tallyDB.query("SELECT vbt_key , min_id FROM tally_vbt WHERE vbt_key = :vbtKey AND vbt_debit_key = '--' AND vbt_status != 'D'", {
            replacements: {
                vbtKey: req.body.vbtKey,
            },
            type: tallyDB.QueryTypes.SELECT,
        })

        if (stmt.length > 0) {
            for (let i = 0; i < stmt.length; i++) {
                let updateTallyVbt = await tallyDB.query("UPDATE tally_vbt SET vbt_status = 'D', deleted_by = :user , deleted_date = :deletedDate WHERE vbt_key = :vbtKey", {
                    replacements: {
                        vbtKey: stmt[i].vbt_key,
                        user: req.logedINUser,
                        deletedDate: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                    },
                    type: tallyDB.QueryTypes.UPDATE,
                    transaction: transactionTally,
                })

                if (updateTallyVbt.length <= 0) {
                    await transactionTally.rollback()
                    return res.json({ status: 'error', message: 'error while updating vbt status' })
                }

                let updateTallyLedger = await tallyDB.query("UPDATE tally_ledger_data SET ledger_data_status = 'D' , deleted_by = :user , deleted_date = :deletedDate WHERE module_used = :vbtKey", {
                    replacements: {
                        vbtKey: stmt[i].vbt_key,
                        user: req.logedINUser,
                        deletedDate: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                    },
                    type: tallyDB.QueryTypes.UPDATE,
                    transaction: transactionTally,
                })

                if (updateTallyLedger.length <= 0) {
                    await transactionTally.rollback()
                    return res.json({ status: 'error', message: 'error while updating ledger status' })
                }

                let updateInvtMin = await invtDB.query("UPDATE rm_location SET vbp_status = 'N' WHERE in_transaction_id = :min", {
                    replacements: {
                        min: stmt[i].min_id,
                    },
                    type: invtDB.QueryTypes.UPDATE,
                    transaction: transactionInventory,
                })
                if (updateInvtMin.length <= 0) {
                    await transactionTally.rollback()
                    await transactionInventory.rollback()
                    return res.json({ status: 'error', message: 'error while updating min status' })
                }
                await transactionInventory.commit()
                await transactionTally.commit()
                return res.json({ status: 'success', message: 'vbt status updated successfully.' })
            }
        }
        return res.json({ status: 'error', message: 'no vbt found' })

    } catch (err) {
        return helper.errorResponse(res, err);
    }
})

// update project id and jobwork id in vbt6
router.post("/updateProjectVbt", [auth.isAuthorized], async (req, res) => {
    const transaction = await tallyDB.transaction();
    try {
        let stmt = await tallyDB.query(`SELECT t.vbt_key , t.min_id , i.in_transaction_id, i.in_jw_transaction_id, j.jw_project_name FROM mscorpre_ims_tally.tally_vbt AS t LEFT JOIN ${global.ims_db_name}.rm_location AS i ON i.in_transaction_id = t.min_id AND i.in_jw_transaction_id != '--' LEFT JOIN ${global.ims_db_name}.jw_purchase_req AS j ON j.jw_jw_transaction = i.in_jw_transaction_id AND j.jw_project_name != '--' WHERE t.vbt_type = :vbtType AND t.project_id = '--' AND t.min_id NOT IN ('--','') GROUP BY t.min_id`, {
            replacements: {
                vbtType: "VBT06"
            },
            type: tallyDB.QueryTypes.SELECT
        })

        if (stmt.length <= 0) {
            await transaction.rollback();
            return res.json({ status: 'error', message: "no data found" })
        }

        for (let i = 0; i < stmt.length; i++) {
            let stmt1 = await tallyDB.query("UPDATE tally_vbt SET project_id = :projectID AND jw_id = :jwID WHERE vbt_key = :vbtKey AND min_id = :minID", {
                replacements: {
                    vbtKey: stmt[i].vbt_key,
                    minID: stmt[i].min_id,
                    projectID: stmt[i].jw_project_name ? stmt[i].jw_project_name : "--",
                    jwID: stmt[i].in_jw_transaction_id ? stmt[i].in_jw_transaction_id : "--"
                },
                type: tallyDB.QueryTypes.UPDATE,
                transaction: transaction
            })

            if (stmt1.length <= 0) {
                await transaction.rollback();
                return res.json({ status: 'error', message: 'error while updating data' })
            }
        }
        await transaction.commit();
        return res.json({ status: 'success', message: 'updated successfully' })
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

// update all vbt's project id and po id except vbt6
router.post("/updateTallyVbt", [auth.isAuthorized], async (req, res) => {
    const transaction = await tallyDB.transaction()
    try {
        let stmt = await tallyDB.query(`SELECT min_id, ${global.ims_db_name}.po_purchase_req.po_project_name, ${global.ims_db_name}.po_purchase_req.po_transaction FROM tally_vbt LEFT JOIN ${global.ims_db_name}.rm_location ON ${global.ims_db_name}.rm_location.in_transaction_id = tally_vbt.min_id LEFT JOIN ${global.ims_db_name}.po_purchase_req ON ${global.ims_db_name}.po_purchase_req.po_transaction = ${global.ims_db_name}.rm_location.in_po_transaction_id WHERE tally_vbt.vbt_type IN ('VBT01','VBT02','VBT03','VBT04','VBT05') AND tally_vbt.project_id = '--' AND tally_vbt.po_number = '--' GROUP BY tally_vbt.min_id`, {
            type: tallyDB.QueryTypes.SELECT,
        })

        if (stmt.length > 0) {
            for (let i = 0; i < stmt.length; i++) {
                let stmt1 = await tallyDB.query("UPDATE tally_vbt SET po_number = :po_number, project_id = :project_id WHERE min_id = :min_id", {
                    replacements: {
                        min_id: stmt[i].min_id,
                        project_id: stmt[i].po_project_name ?? "--",
                        po_number: stmt[i].po_transaction ?? "--",
                    },
                    type: tallyDB.QueryTypes.UPDATE,
                    transaction: transaction,
                })

                if (stmt1.length <= 0) {
                    await transaction.rollback()
                    return res.json({ status: 'error', message: 'error while updating...' })
                }

            }
            await transaction.commit()
            return res.json({ status: 'success', message: "updated successfully..." })
        }
        return res.json({ status: 'error', message: 'no data' })
    } catch (err) {
        return helper.errorResponse(res, err);
    }
})

router.post("/insertApTable", async (req, res) => {
    const transaction = await tallyDB.transaction();
    try {
        const table = xlsx.readFile('Working.csv');
        const sheet = table.Sheets[table.SheetNames[0]];
        let arr = [];
        const rows = xlsx.utils.sheet_to_json(sheet);

        const insert_date = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

        for (let i = 0; i < rows.length; i++) {
            let insertAp = await tallyDB.query("INSERT INTO tally_ap (ap_key , ap_ven_code , ap_ref_no , ap_os_amm, ap_so_amm , ap_so_ref_no , project_id , po_number , ap_type , insert_by , insert_dt) VALUES (:apKey , :venCode , :refNo , :osAmm , :soAmm , :soRefNo , :projectId , :poNumber , :apType , :insertBy , :insertDt)", {
                replacements: {
                    apKey: rows[i].ap_key,
                    venCode: rows[i].ap_ven_code,
                    refNo: rows[i].ap_ref_no,
                    osAmm: rows[i].ap_so_amm,
                    soAmm: rows[i].ap_so_amm,
                    soRefNo: rows[i].ap_so_ref_no,
                    projectId: rows[i].project_id ? rows[i].project_id : "--",
                    poNumber: rows[i].po_number ? rows[i].po_number : "--",
                    apType: "VENDOR",
                    insertBy: "CRN6668049",
                    insertDt: insert_date,
                },
                type: tallyDB.QueryTypes.INSERT,
                transaction: transaction
            })

            if (insertAp.length <= 0) {
                await transaction.rollback()
                return res.json({ status: 'error', message: 'error while inserting data' })
            }
        }
        await transaction.commit()
        return res.json({ status: 'success', message: 'inserted successfully' })

    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

router.post("/purchase", [auth.isAuthorized], uploadPurchase.single('file'), async (req, res) => {
    const transaction = await invtDB.transaction();
    try {

        let workbook = xlsx.readFile(`./files/po/${req.file.filename}`, {
            type: 'binary',
            cellDates: true,
            cellNF: false,
            cellText: false
        });


        let purchaseData = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);


        let final = [];
        for (let i = 0; i < purchaseData.length; i++) {

            const main_stmt = await tallyDB.query(`SELECT tally_vbt.* , ven_basic_detail.ven_name AS vendor , components.c_part_no AS partCode FROM tally_vbt LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON ven_basic_detail.ven_register_id = tally_vbt.ven_code LEFT JOIN ${global.ims_db_name}.components ON components.component_key = tally_vbt.part_code WHERE po_number = :poNumber`, {
                replacements: {
                    poNumber: purchaseData[i].po
                },
                type: tallyDB.QueryTypes.SELECT
            });

            for (let j = 0; j < main_stmt.length; j++) {

                let minData, minDate;
                if (main_stmt[j].min_id != '--' && main_stmt[j].min_id != null && main_stmt[j].min_id != '') {

                    minData = await invtDB.query(`SELECT minTable.insert_date AS minDate FROM ${global.ims_db_name}.rm_location AS minTable WHERE minTable.in_transaction_id = :minID AND minTable.components_id = :partCode LIMIT 1`, {
                        replacements: {
                            minID: main_stmt[j].min_id,
                            partCode: main_stmt[j].part_code
                        },
                        type: invtDB.QueryTypes.SELECT
                    })

                    minDate = moment(minData[0]?.minDate).format("DD-MM-YYYY");

                }

                let voucherType;

                if (main_stmt[j].vbt_type == "VBT01" || main_stmt[j].vbt_type == "VBT04" || main_stmt[j].vbt_type == "VBT05") {
                    voucherType = 'Purchase';
                }
                if (main_stmt[j].vbt_type == "VBT02" || main_stmt[j].vbt_type == "VBT06") {
                    voucherType = 'Purchase-Services';
                }
                if (main_stmt[j].vbt_type == "VBT03") {
                    voucherType = 'Purchase-Import(Goods)';
                }
                if (main_stmt[j].vbt_type == "VBT07") {
                    voucherType = 'RCM-Invoice';
                }

                final.push({
                    'Voucher Type': voucherType,
                    'VBT Number': main_stmt[j].vbt_key,
                    'Effective Date': moment(main_stmt[j].effective_date).format("DD-MM-YYYY"),
                    'Party Name': main_stmt[j].vendor,
                    'Receipt No': main_stmt[j].min_id,
                    'Receipt Date': minDate,
                    'Order No': main_stmt[j].po_number,
                    'Supplier Invoice No': main_stmt[j].vbt_invoice_no,
                    'Supplier Invoice Date': main_stmt[j].vbt_invoice_date,
                    'Item Code': main_stmt[j].partCode,
                    'Quantity': main_stmt[j].vbt_inqty,
                    'Rate': main_stmt[j].vbt_inrate,
                    'Amount': main_stmt[j].vbt_taxable_value,
                    'Total Value': main_stmt[j].vbt_ven_ammount
                })
            }
        }

        const workbook1 = xlsx.utils.book_new();
        const worksheet = xlsx.utils.json_to_sheet(final);
        xlsx.utils.book_append_sheet(workbook1, worksheet, "Details");
        xlsx.writeFile(workbook1, `./files/purchaseData/${req.file.filename}`);

        await transaction.commit();
        return res.json({
            success: true,
            message: "File uploaded successfully",
            status: "success",
        })
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

module.exports = router
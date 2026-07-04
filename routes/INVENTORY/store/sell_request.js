const express = require("express");
const router = express.Router();
const fs = require("fs");

let { format } = require("timeago.js");

let { invtDB, otherDB, tallyDB } = require("../../../config/db/connection");


const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const { encode, decode } = require("html-entities");


const Validator = require("validatorjs");

const SOPrint = require("../store/sell_print");
var xlsx = require("xlsx");
const multer = require("multer");
const path = require("path");
const html_to_pdf = require("html-pdf-node");


// CREATE SELL Order
// CREATE SELL Order
router.post("/createSellRequest", [auth.isAuthorized], async (req, res) => {
    try {
        const valid_header = new Validator(req.body.headers, {
            so_type: "required|in:component,product",
            customer: "required",
            customer_branch: "required",
            customer_address: "required",
            customer_gstin: "required",
            bill_id: "required",
            billing_address: "required",
            shipping_id: "required",
            shipping_address: "required",
        });

        if (valid_header.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid_header) });
        }

        const comp_len = req.body.materials.items.length;
        const comp_qty = req.body.materials.qty.length;
        const comp_price = req.body.materials.price.length;
        const comp_gst_rate = req.body.materials.gst_rate.length;

        if (comp_len == 0 || comp_qty == 0 || comp_price == 0 || comp_gst_rate == 0) {
            return res.json({ status: "error", success: false, message: "Please add at least one item!" });
        }

        if (comp_len != comp_qty || comp_len != comp_price || comp_len != comp_gst_rate) {
            return res.json({ status: "error", success: false, message: "Please fill all inputs" });
        }

        for (let i = 0; i < comp_len; i++) {

            const valid_materila = new Validator({
                items: req.body.materials.items[i],
                qty: req.body.materials.qty[i],
                hsn: req.body.materials.hsn[i],
                price: req.body.materials.price[i],
                gst_rate: req.body.materials.gst_rate[i],
                cgst: req.body.materials.cgst[i],
                sgst: req.body.materials.sgst[i],
                igst: req.body.materials.igst[i],
                gst_type: req.body.materials.gst_type[i],
                currency: req.body.materials.currency[i],
                exchange_rate: req.body.materials.exchange_rate[i],
            }, {
                items: "required",
                qty: "required|numeric",
                hsn: "required",
                price: "required",
                gst_rate: "required|numeric",
                gst_type: ["required_if:gst_rate,!=,0", "required_if:gst_rate,!=,I", "required_if:gst_rate,!=,L"],
                cgst: "required|numeric",
                sgst: "required|numeric",
                igst: "required|numeric",
                currency: "required",
                exchange_rate: "required|numeric",
            });

            if (valid_materila.fails()) {
                return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid_materila) });
            }

        }

        const toFindDublicates = (arry) => arry.filter((item, index) => arry.indexOf(item) !== index);
        const dubliEle = toFindDublicates(req.body.materials.items);
        if (dubliEle.length > 0) {
            return res.json({ status: "error", success: false, message: "You have entered the same items twice in a single request" });
        }

    } catch (err) {
        return helper.errorResponse(res, err);
    }

    const transaction = await invtDB.transaction();

    try {

        const comp_len = req.body.materials.items.length;
        // 

        var in_txn_no = await helper.genTransaction("SO", transaction);
        
        
        // 
        const insert_dt = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

        for (let i = 0; i < comp_len; i++) {
            const stmt_insert = await invtDB.query("INSERT INTO sell_request (company_branch , so_req_id, so_type, so_customer, so_item, so_item_qty, so_item_price, so_hsn_sac, so_gst_type , so_currency , so_exchange_rate , so_due_date , so_due_day , so_gst_rate , so_cgst , so_sgst ,so_igst , so_item_remark, so_project_id, so_cost_center, so_delivery_term, so_payment_term, so_terms_condition ,so_quotation_detail , so_comment , insert_by, insert_dt , bill_id , billing_address , shipping_id , shipping_address , shipping_pan , shipping_gstin , so_cust_branch , so_cust_addr , so_cust_gstin , so_pending_qty ) VALUES ( :company_branch , :so_req_key , :so_type , :so_customer , :so_product , :so_comp_qty , :so_comp_price , :so_hsn_sac , :so_gst_type , :so_currency , :so_exchange_rate , :so_due_date , :so_due_day , :so_gst_rate , :so_cgst , :so_sgst , :so_igst , :so_item_remark , :so_project_id , :so_cost_center , :so_delivery_term , :so_payment_term , :so_terms_condition , :so_quotation_detail , :so_comment , :insert_by , :insert_dt , :bill_id , :billing_address , :shipping_id , :shipping_address , :shipping_pan , :shipping_gstin , :so_cust_branch , :so_cust_addr , :so_cust_gstin , :so_pending_qty )", {
                replacements: {
                    company_branch: req.branch,
                    so_req_key: in_txn_no,
                    so_type: req.body.headers.so_type,
                    so_customer: req.body.headers.customer,
                    so_product: req.body.materials.items[i],
                    so_comp_qty: req.body.materials.qty[i],
                    so_pending_qty: req.body.materials.qty[i],
                    so_comp_price: req.body.materials.price[i],
                    so_hsn_sac: req.body.materials.hsn[i],
                    so_gst_type: req.body.materials.gst_type[i],
                    so_currency: req.body.materials.currency[i],
                    so_exchange_rate: req.body.materials.exchange_rate[i],
                    so_due_day: req.body.headers?.due_day ?? "--",
                    so_due_date: moment(req.body.materials.due_date[i], "DD-MM-YYYY").format("YYYY-MM-DD"),
                    so_gst_rate: req.body.materials.gst_rate[i],
                    so_cgst: req.body.materials.cgst[i],
                    so_sgst: req.body.materials.sgst[i],
                    so_igst: req.body.materials.igst[i],
                    so_item_remark: req.body.materials?.remark[i] ?? "--",
                    so_project_id: req.body.headers?.project ?? "--",
                    so_cost_center: req.body.headers?.cost_center ?? "--",
                    so_delivery_term: req.body.headers?.delivery_term ?? "--",
                    so_payment_term: req.body.headers?.payment_term ?? "--",

                    so_terms_condition: req.body.headers?.terms_condition ?? "--",
                    so_quotation_detail: req.body.headers?.quotation_detail ?? "--",

                    insert_by: req.logedINUser,
                    insert_dt: insert_dt,
                    so_comment: req.body.headers?.comment ?? "--",
                    bill_id: req.body.headers.bill_id,
                    billing_address: req.body.headers.billing_address,
                    shipping_id: req.body.headers.shipping_id,
                    shipping_address: req.body.headers.shipping_address,
                    shipping_pan: req.body.headers?.shipping_pan ?? "--",
                    shipping_gstin: req.body.headers?.shipping_gstin ?? "--",
                    so_cust_branch: req.body.headers.customer_branch,
                    so_cust_addr: req.body.headers.customer_address,
                    so_cust_gstin: req.body.headers.customer_gstin,
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: transaction
            })

        }

        // CREATE SO REQUEST LOG
        const stmt_log = await invtDB.query("INSERT INTO sell_request_log ( so_req_key, so_status, so_comment, insert_dt, insert_by , log_status) VALUES ( :so_req_key , :so_req_status , :so_req_comment , :insert_dt , :insert_by , :log_status )", {
            replacements: {
                so_req_key: in_txn_no,
                so_req_status: 'P',
                so_req_comment: req.body.headers.comment,
                insert_dt: insert_dt,
                insert_by: req.logedINUser,
                log_status: "Created"
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction
        });

        await transaction.commit();
        return res.json({ status: "success", success: true, message: "Sell Order Created Successfully.", data: { txn: in_txn_no } });

    } catch (err) {
        return helper.errorResponse(res, err);
    }

});


// CANCEL SALES ORDER 
// CREATED ON [01-02-2024] - [MS0014]
// LAST UPDATED [] - []
router.post("/CancelSO", [auth.isAuthorized], async (req, res) => {
    let validation = new Validator(req.body, {
        so: "required",
        remark: "required",
    });
    if (validation.fails()) {
        return res.json({ status: "error", success: false, message: "Something is missing in form field to supply", data: validation.errors.all() });
    }
    try {
        const t = await invtDB.transaction();
        let stmt1 = await invtDB.query("SELECT * FROM `sell_request` WHERE `so_req_id` = :poid AND `company_branch` =:branch", { replacements: { poid: req.body.so, branch: req.branch }, type: invtDB.QueryTypes.SELECT });
        if (stmt1.length > 0) {
            if (stmt1[0].po_status == "C") {
                return res.json({ status: "error", success: false, message: "Sales Order already closed" });
            } else {
                let stmt2 = await invtDB.query("UPDATE `sell_request` SET `so_close_remark` = :remark, `so_status` = :status WHERE `so_req_id` = :poid", {
                    replacements: { remark: req.body.remark.replace(/\n/g, "<br>"), status: "C", poid: req.body.so },
                    type: invtDB.QueryTypes.UPDATE,
                    transaction: t,
                });
                if (stmt2.length > 0) {
                    t.commit();
                    return res.json({ status: "success", success: true, message: "Sales Order closed successfully" });
                } else {
                    t.rollback();
                    return res.json({ status: "error", success: false, message: "Unable to close the sales order due to some technical issue" });
                }
            }
        } else {
            return res.json({ status: "error", success: false, message: "No SO Found" });
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});


// CREATE PO REQUEST WITH EXCEL
const excel_storage = multer.diskStorage({
    destination: "./files/excel",
    filename: function (req, file, cb) {
        cb(null, "SELL_REQ" + helper.getUniqueNumber() + helper.randomNumber(100, 999) + path.extname(file.originalname));
    },
});
const upload_po_req_file = multer({
    storage: excel_storage,
    limits: { fileSize: 5242880 }, // 5 MB (in binary)
    fileFilter: function (_req, file, cb) {
        // Allowed ext
        const filetypes = /csv/;
        // Check ext
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        // Check mime
        const mimetype = filetypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb("Error: CSV Only!");
        }
    },
});
router.post("/uploadSellReqFile", [auth.isAuthorized, upload_po_req_file.single("file")], async (req, res) => {
    try {
        const valid_header = new Validator(req.body, {
            sell_type: "required",
            customer: "required",
            project: "required",
            cost_center: "required",
            delivery_term: "required",
            payment_term: "required",
            comment: "required",
        });

        if (valid_header.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid_header) });
        }
    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
    }

    const transaction = await invtDB.transaction();
    try {

        if (!req.file) {
            await transaction.rollback();
            return res.json({ status: "error", success: false, message: "Please upload file" });
        }

        const file = req.file;
        // console.log(file);
        const file_name = file.originalname;
        // GET CSV FILE DATA IN xlsx
        const workbook = xlsx.readFile(file.path);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(worksheet);
        const data_length = data.length;

        if (data_length == 0) {
            await transaction.rollback();
            return res.json({ status: "error", success: false, message: "Please fill all inputs" });
        }

        for (let i = 0; i < data_length; i++) {
            const valid = new Validator({
                SKU: data[i].SKU,
                QTY: data[i].QTY,
                PRICE: data[i].PRICE
            }, {
                SKU: "required",
                QTY: "required",
                PRICE: "required"
            });

            if (valid.fails()) {
                await transaction.rollback();
                return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
            }
        }

        const key = helper.getUniqueNumber();
        const insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");

        for (let i = 0; i < data_length; i++) {

            const get_product = await invtDB.query("SELECT product_key FROM products WHERE p_sku = :product", {
                replacements: {
                    product: data[i].SKU
                },
                type: invtDB.QueryTypes.SELECT
            });

            if (get_product.length == 0) {
                await transaction.rollback();
                return res.json({ status: "error", success: false, message: `PART CODE NOT FOUND: ${data[i].SKU} at ROW ${i + 1} not found` });
            }

            // INSERT QUERY
            const stmt_insert = await invtDB.query("INSERT INTO sell_request ( sell_req_key, sell_type, sell_customer, sell_product, sell_comp_qty, sell_comp_price, sell_hsn_sac, sell_gst_rate, sell_comp_remark, sell_project_id, sell_cost_center, sell_delivery_term, sell_payment_term, request_by, approved_by, sell_comment , insert_by, insert_dt) VALUES ( :sell_req_key , :sell_type , :sell_customer , :sell_product , :sell_comp_qty , :sell_comp_price , :sell_hsn_sac , :sell_gst_rate , :sell_comp_remark , :sell_project_id , :sell_cost_center , :sell_delivery_term , :sell_payment_term , :request_by , :approved_by , :sell_comment , :insert_by , :insert_dt )", {
                replacements: {
                    sell_req_key: key,
                    sell_type: req.body.sell_type,
                    sell_customer: req.body.customer,
                    sell_product: data[i].SKU,
                    sell_comp_qty: data[i].QTY,
                    sell_comp_price: data[i].PRICE,
                    sell_hsn_sac: data[i].HSN ?? "--",
                    sell_gst_rate: data[i].GST_RATE ?? 0,
                    sell_comp_remark: data[i].REMARK ?? "--",
                    sell_project_id: req.body.project,
                    sell_cost_center: req.body.cost_center,
                    sell_delivery_term: req.body.delivery_term,
                    sell_payment_term: req.body.payment_term,
                    request_by: "--",
                    approved_by: "--",
                    insert_by: req.logedINUser,
                    insert_dt: insert_dt,
                    sell_comment: req.body.comment
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: transaction
            })

        }

        // CREATE PO REQUEST LOG
        const stmt_log = await invtDB.query("INSERT INTO sell_request_log ( sell_req_key, sell_req_status, sell_req_comment, insert_dt, insert_by) VALUES ( :sell_req_key , :sell_req_status , :sell_req_comment , :insert_dt , :insert_by )", {
            replacements: {
                sell_req_key: key,
                sell_req_status: 'P',
                sell_req_comment: req.body.comment,
                insert_dt: insert_dt,
                insert_by: req.logedINUser
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction
        });

        fs.unlinkSync(req.file.path);

        await transaction.commit();
        return res.json({ status: "success", success: true, message: "SELL REQUEST CREATED SUCCESSFULLY" });

    }
    catch (err) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
    }

});

// // APPROVE PO REQUEST
// router.post("/updateStatus", [auth.isAuthorized], async (req, res) => {
//     const transaction = await invtDB.transaction();
//     try {
//         const valid = new Validator(req.body, {
//             sell_req_id: "required",
//             status: "required|in:R,A",
//             comment: "required",
//         });

//         if (valid.fails()) {
//             await transaction.rollback();
//             return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
//         }

//         const check_sell_ststus = await invtDB.query("SELECT sell_req_status FROM sell_request WHERE sell_req_key = :sell_req_id AND sell_status != 'P'", {
//             replacements: {
//                 sell_req_id: req.body.sell_req_id
//             },
//             type: invtDB.QueryTypes.SELECT
//         });

//         if (check_sell_ststus.length > 0) {
//             await transaction.rollback();
//             return res.json({ status: "error", success: false, message: "SELL Request already approved or rejected" });
//         }

//         const stmt = await invtDB.query("UPDATE sell_request SET sell_req_status = :status, sell_req_comment = :comment WHERE sell_req_key = :sell_req_id", {
//             replacements: {
//                 sell_req_id: req.body.sell_req_id,
//                 status: req.body.status,
//                 comment: req.body.comment
//             },
//             type: invtDB.QueryTypes.UPDATE,
//             transaction: transaction
//         });

//         const stmt_log = await invtDB.query("INSERT INTO sell_request_log ( sell_req_key, sell_req_status, sell_req_comment, insert_dt, insert_by) VALUES ( :sell_req_key , :sell_req_status , :sell_req_comment , :insert_dt , :insert_by )", {
//             replacements: {
//                 sell_req_key: req.body.sell_req_id,
//                 sell_req_status: req.body.status,
//                 sell_req_comment: req.body.comment,
//                 insert_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
//                 insert_by: req.logedINUser
//             },
//             type: invtDB.QueryTypes.INSERT,
//             transaction: transaction
//         });

//         await transaction.commit();
//         return res.json({ status: "success", success: true, message: "Successfully updated Sell Request!!!" });

//     }
//     catch (err) {
//         await transaction.rollback();
//         return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
//     }
// });

// Fetch Item Data
router.post("/fetchItem", [auth.isAuthorized], async (req, res) => {
    try {

        const valid = new Validator(req.body, {
            code: "required",
        })

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: valid.errors.all() });
        }

        let stmt = await invtDB.query("SELECT products.p_name AS name, products.p_sku AS code, products.product_key AS keycode, units.units_name, products.p_hsncode AS hsncode FROM products LEFT JOIN units ON products.p_uom = units.units_id WHERE products.p_sku = :key UNION SELECT components.c_name, components.c_part_no, components.component_key, units.units_name, components.c_hsn FROM components LEFT JOIN units ON components.c_uom = units.units_id WHERE components.c_part_no = :key", {
            replacements: { key: req.body.code },
            type: invtDB.QueryTypes.SELECT,
        });

        if (stmt.length > 0) {
            let final = {
                name: stmt[0].name,
                code: stmt[0].code,
                key: stmt[0].keycode,
                uom: stmt[0].units_name,
                hsn: stmt[0].hsncode,
                rate: "",
            };

            return res.json({ status: "success", success: true, data: final });
        } else {
            return res.json({ status: "error", success: false, message: "Item not found" });
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

// FETCH PO REQUEST LIST
router.post("/fetchSellRequestList", [auth.isAuthorized], async (req, res) => {
    try {

        const valid = new Validator(req.body, {
            wise: "required|in:DATE,SONO,CC",
            data: "required"
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const { wise, data } = req.body;

        let stmt;

        if (wise == "DATE") {
            const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
            const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
            const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

            stmt = await invtDB.query("SELECT sell_request.*,  admin_login.user_name FROM sell_request LEFT JOIN admin_login ON admin_login.CustID = sell_request.insert_by WHERE DATE_FORMAT(sell_request.insert_dt,'%Y-%m-%d') BETWEEN :fromdate AND :todate GROUP BY so_req_id ORDER BY insert_dt DESC", {
                replacements: {
                    fromdate: fromdate,
                    todate: todate
                },
                type: invtDB.QueryTypes.SELECT
            });
        }

        if (wise == "SONO") {
            stmt = await invtDB.query("SELECT sell_request.*,  admin_login.user_name FROM sell_request LEFT JOIN admin_login ON admin_login.CustID = sell_request.insert_by WHERE sell_request.so_req_id LIKE :data GROUP BY so_req_id ORDER BY insert_dt DESC", {
                replacements: {
                    data: `%${data}%`
                },
                type: invtDB.QueryTypes.SELECT
            });
        }


        if (wise == "CC") {
            stmt = await invtDB.query("SELECT sell_request.*,  admin_login.user_name FROM sell_request LEFT JOIN admin_login ON admin_login.CustID = sell_request.insert_by WHERE sell_request.sell_cost_center = :data GROUP BY so_req_id ORDER BY insert_dt DESC", {
                replacements: {
                    data: data
                },
                type: invtDB.QueryTypes.SELECT
            });
        }



        if (stmt.length > 0) {

            const data = [];

            for (let i = 0; i < stmt.length; i++) {
                data.push({
                    req_id: stmt[i].so_req_id,
                    type: stmt[i].so_type,
                    customer: stmt[i].so_customer,
                    project_id: stmt[i].so_project_id,
                    cost_center: stmt[i].so_cost_center,
                    delivery_term: stmt[i].so_delivery_term,
                    payment_term: stmt[i].so_payment_term,
                    create_by: stmt[i].user_name,
                    create_dt: moment(stmt[i].insert_dt).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss"),
                });
            }

            return res.json({ status: "success", success: true, data: data });

        } else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }
    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
    }
});

// FETCH product DETAILS
router.post("/fetchSellRequestDetails", [auth.isAuthorized], async (req, res) => {
    try {

        const valid = new Validator(req.body, {
            req_id: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const stmt = await invtDB.query("SELECT CASE WHEN sell_request.so_type = 'product' THEN products.p_name ELSE components.c_name END AS item_name, CASE WHEN sell_request.so_type = 'product' THEN products.p_sku ELSE components.c_part_no END AS item_part_no, CASE WHEN sell_request.so_type = 'product' THEN products.product_key ELSE components.component_key END AS item_key, sell_request.* FROM sell_request LEFT JOIN products ON sell_request.so_type = 'product' AND products.product_key = sell_request.so_item LEFT JOIN components ON sell_request.so_type = 'component' AND components.component_key = sell_request.so_item WHERE sell_request.so_req_id = :so_req_key", {
            replacements: { so_req_key: req.body.req_id },
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt.length > 0) {

            const data = [];
            for (let i = 0; i < stmt.length; i++) {
                data.push({
                    item_name: stmt[i].item_name,
                    item_code: stmt[i].item_part_no,
                    qty: stmt[i].so_item_qty,
                    unit: stmt[i].so_item_unit,
                    price: stmt[i].so_item_price,
                    remark: stmt[i].so_item_remark,
                    hsn_sac: stmt[i].so_hsn_sac,
                    gst_rate: stmt[i].so_gst_rate
                })
            }

            return res.json({ status: "success", success: true, data: data });

        } else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }
    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
    }
});

// Fetch SO for Update
// Fetch SO for Update
router.post("/fetchData4Update", [auth.isAuthorized], async (req, res) => {

    const validation = new Validator(req.body, {
        sono: "required",
    });

    if (validation.fails()) {
        return res.json({ status: "error", success: false, message: "Something is missing in form field to supply", data: validation.errors.all() });
    }
    const so_transaction = req.body.sono;

    try {

        const result = await invtDB.query("SELECT CASE WHEN sell_request.so_type = 'product' THEN products.p_name ELSE components.c_name END AS item_name, CASE WHEN sell_request.so_type = 'product' THEN products.p_sku ELSE components.c_part_no END AS item_part_no, CASE WHEN sell_request.so_type = 'product' THEN products.product_key ELSE components.component_key END AS item_key, sell_request.* , project_master.project_description FROM sell_request LEFT JOIN products ON sell_request.so_type = 'product' AND products.product_key = sell_request.so_item LEFT JOIN components ON sell_request.so_type = 'component' AND components.component_key = sell_request.so_item LEFT JOIN project_master ON project_master.project_name = sell_request.so_project_id  WHERE sell_request.so_req_id = :so_req_key AND sell_request.company_branch = :branch AND sell_request.so_status = :status", {
            replacements: {
                so_req_key: so_transaction,
                status: "P",
                branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
        });

        if (result.length > 0) {
            if (result[0].so_status !== "P") {
                return res.json({ status: "error", success: false, message: "SO marked as closed, meaning you can't amend" });
            }

            const result2 = await invtDB.query(
                "SELECT CASE WHEN sell_request.so_type = 'product' THEN products.p_name ELSE components.c_name END AS item_name, CASE WHEN sell_request.so_type = 'product' THEN products.p_sku ELSE components.c_part_no END AS item_part_no, CASE WHEN sell_request.so_type = 'product' THEN products.product_key ELSE components.component_key END AS item_key, sell_request.*, sell_request.ID AS soUpdateID , ims_currency.currency_symbol FROM sell_request LEFT JOIN products ON sell_request.so_type = 'product' AND products.product_key = sell_request.so_item LEFT JOIN components ON sell_request.so_type = 'component' AND components.component_key = sell_request.so_item LEFT JOIN ims_currency ON sell_request.so_currency = ims_currency.currency_id WHERE sell_request.so_req_id = :transaction AND sell_request.company_branch = :branch",
                {
                    replacements: {
                        transaction: so_transaction,
                        branch: req.branch,
                    },
                    type: invtDB.QueryTypes.SELECT,
                }
            );

            if (result2.length > 0) {

                materials = [], client = [], billaddress = [], shipaddress = [], client_ship_address = [];
                let result3;
                let count = 0;
                for (let i = 0; i < result2.length; i++) {

                    selectLabel = "--N/A--";
                    selectValue = "0";

                    if (result2[i].so_type == "component") {
                        selectLabel = "Component";
                        selectValue = "component";
                    } else if (result2[i].so_type == "product") {
                        selectLabel = "Product";
                        selectValue = "product";
                    }

                    // CLIENT DETAIL
                    let client_detail = await tallyDB.query("SELECT * FROM client_basic_detail WHERE client_basic_detail.code = :code", {
                        replacements: { code: result2[i].so_customer },
                        type: tallyDB.QueryTypes.SELECT,
                    });
                    selectedClient = "--";
                    clientname = "NA"
                    if (client_detail.length > 0) {
                        if (client_detail[0].code == "--") {
                            selectedClient = { value: result2[i].code, label: result2[i].code };
                        } else {
                            selectedClient = { value: client_detail[0].code, label: client_detail[0].name };
                            clientname = client_detail[0].name
                        }
                    }

                    // ADDRESS DETAIL
                    let address_detail = await tallyDB.query("SELECT * FROM client_address_detail WHERE client_address_detail.addressID = :clientaddress", {
                        replacements: { clientaddress: result2[i].so_cust_branch },
                        type: tallyDB.QueryTypes.SELECT,
                    });
                    selectedAddress = "";
                    client_state_name = "N/R";
                    if (address_detail.length > 0) {
                        if (address_detail[0].so_cust_branch !== "--") {
                            client_state_name = address_detail[0].state;
                            selectedAddressLabel = { value: address_detail[0].so_cust_branch, label: address_detail[0].address };
                        } else {
                            selectedAddressLabel = { value: "0", label: "- - ADDRESS N/A - -" };
                        }
                        client_gstid = address_detail[0].gst;
                    }

                    let shipment_to = result2[i].shipping_id;
                    let shipment_address = result2[i].shipping_address;
                    let shipment_gstid = result2[i].shipping_gstin;
                    let shipment_panno = result2[i].shipping_pan;

                    // GET BILL ADDRESS
                    let bill_address_detail = await invtDB.query("SELECT * FROM `billing_address` WHERE `billing_code` = :code", {
                        replacements: { code: result2[i].bill_id },
                        type: invtDB.QueryTypes.SELECT,
                    });


                    let billing_address = "N/A";
                    let billing_code = "--";
                    let billing_name = "- N/A -";
                    let billing_cinno = "N/A";
                    let billing_panno = "N/A";
                    let billing_gstid = "N/A";
                    if (bill_address_detail.length > 0) {
                        billing_code = bill_address_detail[0].billing_code;
                        billing_address = bill_address_detail[0].billing_address;
                        billing_name = bill_address_detail[0].billing_lable;
                        billing_gstid = bill_address_detail[0].billing_gstno;
                        billing_cinno = bill_address_detail[0].billing_cin;
                        billing_panno = bill_address_detail[0].billing_pan;

                        if (result2[i].bill_id !== "") {
                            billing_address = result2[i].bill_id;
                        }
                    }

                    gsttype = [{ id: 0, text: "-- TYPE --" }];
                    if (result2[i].so_gst_type === "L") {
                        gsttype = [{ id: "L", text: "LOCAL" }];
                    } else if (result2[i].so_gst_type === "I") {
                        gsttype = [{ id: "I", text: "INTER STATE" }];
                    }

                    // COST DETAIL
                    let cost_center = await invtDB.query("SELECT * FROM `cost_center` WHERE `cost_center_key` = :costkey", {
                        replacements: { costkey: result2[i].so_cost_center },
                        type: invtDB.QueryTypes.SELECT,
                    });
                    selectedCostCenter = "--";
                    if (cost_center.length > 0) {
                        selectedCostCenter = { value: cost_center[0].cost_center_key, label: cost_center[0].cost_center_name + " (" + cost_center[0].cost_center_short_name + ")" };
                    } else {
                        selectedCostCenter = { value: 0, label: "--" };
                    }

                    materials.push({
                        updateid: Buffer.from(result2[i].soUpdateID.toString(), "utf-8").toString("base64"),
                        item_code: result2[i].item_part_no,
                        item_name: result2[i].item_name,
                        itemKey: result2[i].so_item,
                        selectedItem: [{ id: result2[i].so_item, text: decode(result2[i].item_name) + " ( " + result2[i].item_part_no + " )" }],
                        orderqty: helper.number(result2[i].so_item_qty),
                        unitname: result2[i].units_name,
                        rate: result2[i].so_item_price,
                        currency: result2[i].so_currency,
                        currency_symbol: result2[i].currency_symbol,
                        gsttype: gsttype,
                        taxablevalue: (helper.number(result2[i].so_item_qty) * helper.number(result2[i].so_item_price)).toFixed(2),
                        exchangerate: result2[i].so_exchange_rate,
                        exchangetaxablevalue: (helper.number(result2[i].so_item_qty) * helper.number(result2[i].so_item_price) * helper.number(result2[i].so_exchange_rate)).toFixed(2),
                        hsncode: result2[i].so_hsn_sac,
                        gstrate: result2[i].so_gst_rate,
                        cgst: result2[i].so_cgst_rate,
                        sgst: result2[i].so_sgst_rate,
                        igst: result2[i].so_igst_rate,
                        cgst: result2[i].so_cgst,
                        sgst: result2[i].so_sgst,
                        igst: result2[i].so_igst,
                        remark: result2[i].so_item_remark,
                        orderid: result2[i].so_req_id,
                        due_date: moment(result[0].so_due_date, "YYYY-MM-DD").format("DD-MM-YYYY")
                    });
                    count++;
                    if (count == result2.length) {
                        client.push({
                            soType_value: selectValue,
                            soType_label: selectLabel,
                            clientcode: selectedClient,
                            clientname: clientname,
                            clientbranch: selectedAddressLabel,
                            clientaddress: result2[0].so_cust_addr,

                            paymentterms: result[0].so_payment_term,
                            due_date: moment(result[0].so_due_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
                            projectname: result[0].so_project_id,
                            project_description: result[0].project_description,

                            terms_condition: result[0].so_terms_condition,
                            quotation_detail: result[0].so_quotation_detail,


                            socomment: result[0].so_comment,
                            termsofcondition: result[0].terms_condition,
                            costcenter: selectedCostCenter,
                            country: "INDIA",
                            clientgst: client_gstid,
                            orderid: result[0].so_req_id,
                            soDueDate: result[0].so_due_day
                        });

                        billaddress = {
                            addrbillid: billing_code,
                            billaddress: billing_name,
                            addrbillname: billing_address,
                            billpanno: billing_panno,
                            billcinno: billing_cinno,
                            billgstid: billing_gstid,
                        };

                        shipaddress = {
                            addrshipid: shipment_to,
                            shipaddress: shipment_address,
                            addrshipname: shipment_address,
                            shippanno: shipment_panno,
                            shipgstid: shipment_gstid,
                        };

                        return res.json({ status: "success", success: true, data: { materials: materials, client: client, bill: billaddress, ship: shipaddress } });
                    }
                }

            } else {
                return res.json({ status: "error", success: false, message: "No SO found" });
            }
        } else {
            return res.json({ status: "error", success: false, message: "SO has been closed therefore it can't be updated" });
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
    // next();
});

//UPDATE SO DATA
router.post("/soDataUpdate", [auth.isAuthorized], async (req, res) => {
    try {
        const valid_header = new Validator(req.body.headers, {
            so_id: "required",
            so_type: "required|in:component,product",
            customer: "required",
            project: "required",
            cost_center: "required",
            delivery_term: "required",
            payment_term: "required",
            comment: "required",
            customer_branch: "required",
            customer_address: "required",
            customer_gstin: "required",
            bill_id: "required",
            billing_address: "required",
            shipping_id: "required",
            shipping_address: "required",
            shipping_pan: "required",
            shipping_gstin: "required",
            terms_condition: "required",
            quotation_detail: "required"
        });
        if (valid_header.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid_header) });
        }

        const comp_len = req.body.materials.items.length;
        const comp_qty = req.body.materials.qty.length;
        const comp_price = req.body.materials.price.length;
        const comp_gst_rate = req.body.materials.gst_type.length;

        if (comp_len == 0 || comp_qty == 0 || comp_price == 0 || comp_gst_rate == 0) {
            return res.json({ status: "error", success: false, message: "Please add at least one item!" });
        }

        if (comp_len != comp_qty || comp_len != comp_price || comp_len != comp_gst_rate) {
            return res.json({ status: "error", success: false, message: "Please fill all inputs" });
        }

        for (let i = 0; i < comp_len; i++) {

            const valid_materila = new Validator({
                items: req.body.materials.items[i],
                qty: req.body.materials.qty[i],
                hsn: req.body.materials.hsn[i],
                price: req.body.materials.price[i],
                gst_rate: req.body.materials.gst_rate[i],
                cgst: req.body.materials.cgst[i],
                sgst: req.body.materials.sgst[i],
                igst: req.body.materials.igst[i],
                gst_type: req.body.materials.gst_type[i],
                currency: req.body.materials.currency[i],
                exchange_rate: req.body.materials.exchange_rate[i],
            }, {
                items: "required",
                qty: "required|numeric",
                hsn: "required",
                price: "required",
                gst_rate: "required|numeric",
                cgst: "required|numeric",
                sgst: "required|numeric",
                igst: "required|numeric",
                gst_type: ["required_if:gst_rate,!=,0", "required_if:gst_rate,!=,I", "required_if:gst_rate,!=,L"],
                currency: "required",
                exchange_rate: "required|numeric",
            });

            if (valid_materila.fails()) {
                return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid_materila) });
            }

            // VALIDATION
            if (req.body.materials.qty[i] <= 0) {
                return res.json({ status: "error", success: false, message: `Quantity should be greater than 0 at row ${i + 1}` });
            }
            if (moment(req.body.due_date, "DD-MM-YYYY").diff(moment(new Date(), "DD-MM-YYYY"), "days") == 0) {
                return res.json({ status: "error", success: false, message: "Due Date couldn't be equal to SO creating date" });
            }

            // END VALIDATION
        }

        const toFindDublicates = (arry) => arry.filter((item, index) => arry.indexOf(item) !== index);
        const dubliEle = toFindDublicates(req.body.materials.items);
        if (dubliEle.length > 0) {
            return res.json({ status: "error", success: false, message: "You have entered the same items twice in a single request" });
        }
    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
    }

    const transaction = await invtDB.transaction();

    try {

        const stmt_check = await invtDB.query("SELECT * FROM sell_request WHERE so_req_id = :so_id AND so_status = 'A' ", {
            replacements: {
                so_id: req.body.headers.so_id
            },
            type: invtDB.QueryTypes.SELECT,
        });

        if (stmt_check.length > 0) {
            await transaction.rollback();
            return res.json({ status: "error", success: false, message: "SO is active, can't update." });
        }

        const comp_len = req.body.materials.items.length;

        // 
        const update_date = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

        for (let i = 0; i < comp_len; i++) {

            if (req.body.materials.updaterow[i] == 0) {

                const stmt_insert = await invtDB.query("INSERT INTO sell_request (company_branch , so_req_id, so_type, so_customer, so_item, so_item_qty, so_item_price, so_hsn_sac, so_gst_type , so_currency , so_exchange_rate , so_due_date , so_due_day , so_gst_rate , so_cgst , so_sgst ,so_igst , so_item_remark, so_project_id, so_cost_center, so_delivery_term, so_payment_term, so_terms_condition ,so_quotation_detail , so_comment , insert_by, insert_dt , bill_id , billing_address , shipping_id , shipping_address , shipping_pan , shipping_gstin , so_cust_branch , so_cust_addr , so_cust_gstin , so_pending_qty ) VALUES ( :company_branch , :so_req_key , :so_type , :so_customer , :so_product , :so_comp_qty , :so_comp_price , :so_hsn_sac , :so_gst_type , :so_currency , :so_exchange_rate , :so_due_date , :so_due_day , :so_gst_rate , :so_cgst , :so_sgst , :so_igst , :so_item_remark , :so_project_id , :so_cost_center , :so_delivery_term , :so_payment_term , :so_terms_condition , :so_quotation_detail , :so_comment , :insert_by , :insert_dt , :bill_id , :billing_address , :shipping_id , :shipping_address , :shipping_pan , :shipping_gstin , :so_cust_branch , :so_cust_addr , :so_cust_gstin , :so_pending_qty )", {
                    replacements: {
                        company_branch: req.branch,
                        so_req_key: req.body.headers.so_id,
                        so_type: req.body.headers.so_type,
                        so_customer: req.body.headers.customer,
                        so_product: req.body.materials.items[i],
                        so_comp_qty: req.body.materials.qty[i],
                        so_pending_qty: req.body.materials.qty[i],
                        so_comp_price: req.body.materials.price[i],
                        so_hsn_sac: req.body.materials.hsn[i],
                        so_gst_type: req.body.materials.gst_type[i],
                        so_currency: req.body.materials.currency[i],
                        so_exchange_rate: req.body.materials.exchange_rate[i],
                        so_due_day: req.body.headers.due_day,
                        so_due_date: moment(req.body.materials.due_date[i], "DD-MM-YYYY").format("YYYY-MM-DD"),
                        so_gst_rate: req.body.materials.gst_rate[i],
                        so_cgst: req.body.materials.cgst[i],
                        so_sgst: req.body.materials.sgst[i],
                        so_igst: req.body.materials.igst[i],
                        so_item_remark: req.body.materials?.remark[i] ?? "--",
                        so_project_id: req.body.headers.project,
                        so_cost_center: req.body.headers.cost_center,
                        so_delivery_term: req.body.headers.delivery_term,
                        so_payment_term: req.body.headers.payment_term,

                        so_terms_condition: req.body.headers.terms_condition,
                        so_quotation_detail: req.body.headers.quotation_detail,

                        insert_by: req.logedINUser,
                        insert_dt: update_date,
                        so_comment: req.body.headers.comment,
                        bill_id: req.body.headers.bill_id,
                        billing_address: req.body.headers.billing_address,
                        shipping_id: req.body.headers.shipping_id,
                        shipping_address: req.body.headers.shipping_address,
                        shipping_pan: req.body.headers.shipping_pan,
                        shipping_gstin: req.body.headers.shipping_gstin,
                        so_cust_branch: req.body.headers.customer_branch,
                        so_cust_addr: req.body.headers.customer_address,
                        so_cust_gstin: req.body.headers.customer_gstin
                    },
                    type: invtDB.QueryTypes.INSERT,
                    transaction: transaction
                })

            } else {
                const stmt_update = await invtDB.query("UPDATE sell_request SET so_type = :so_type , so_customer = :so_customer , so_cust_branch = :so_cust_branch , so_cust_addr = :so_cust_addr , so_cust_gstin = :so_cust_gstin , bill_id = :bill_id , billing_address = :billing_address , shipping_id = :shipping_id , shipping_address = :shipping_address , shipping_pan = :shipping_pan , shipping_gstin = :shipping_gstin , so_item = :so_item , so_item_qty = :so_item_qty , so_item_price = :so_item_price , so_hsn_sac = :so_hsn_sac , so_gst_type = :so_gst_type , so_currency = :so_currency , so_exchange_rate = :so_exchange_rate , so_due_date = :so_due_date , so_due_day = :so_due_day , so_gst_rate = :so_gst_rate , so_cgst = :so_cgst , so_sgst = :so_sgst , so_igst = :so_igst , so_item_remark = :so_item_remark , so_project_id = :so_project_id , so_cost_center = :so_cost_center , so_delivery_term = :so_delivery_term , so_payment_term = :so_payment_term  , so_terms_condition = :so_terms_condition , so_quotation_detail = :so_quotation_detail, so_comment = :so_comment , update_by = :update_by , update_date = :update_dt WHERE ID = :so_id", {
                    replacements: {
                        so_id: Buffer.from(req.body.materials.updaterow[i], "base64").toString(),
                        so_req_key: req.body.headers.so_id,
                        so_type: req.body.headers.so_type,
                        so_customer: req.body.headers.customer,
                        so_item: req.body.materials.items[i],
                        so_item_qty: req.body.materials.qty[i],
                        so_pending_qty: req.body.materials.qty[i],
                        so_item_price: req.body.materials.price[i],
                        so_hsn_sac: req.body.materials.hsn[i],
                        so_gst_type: req.body.materials.gst_type[i],
                        so_currency: req.body.materials.currency[i],
                        so_exchange_rate: req.body.materials.exchange_rate[i],
                        so_due_day: req.body.headers.due_day,
                        so_due_date: moment(req.body.materials.due_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
                        so_gst_rate: req.body.materials.gst_rate[i],
                        so_cgst: req.body.materials.cgst[i],
                        so_sgst: req.body.materials.sgst[i],
                        so_igst: req.body.materials.igst[i],
                        so_item_remark: req.body.materials?.remark[i] ?? "--",
                        so_project_id: req.body.headers.project,
                        so_cost_center: req.body.headers.cost_center,
                        so_delivery_term: req.body.headers.delivery_term,
                        so_payment_term: req.body.headers.payment_term,


                        so_terms_condition: req.body.headers.terms_condition,
                        so_quotation_detail: req.body.headers.quotation_detail,

                        update_by: req.logedINUser,
                        update_dt: update_date,
                        so_comment: req.body.headers.comment,
                        bill_id: req.body.headers.bill_id,
                        billing_address: req.body.headers.billing_address,
                        shipping_id: req.body.headers.shipping_id,
                        shipping_address: req.body.headers.shipping_address,
                        shipping_pan: req.body.headers.shipping_pan,
                        shipping_gstin: req.body.headers.shipping_gstin,
                        so_cust_branch: req.body.headers.customer_branch,
                        so_cust_addr: req.body.headers.customer_address,
                        so_cust_gstin: req.body.headers.customer_gstin
                    },
                    type: invtDB.QueryTypes.UPDATE,
                    transaction: transaction
                });
            }

        }

        // CREATE SO REQUEST LOG
        const stmt_log = await invtDB.query("INSERT INTO sell_request_log ( so_req_key, so_status, so_comment, insert_dt, insert_by , log_status) VALUES ( :so_req_key , :so_req_status , :so_req_comment , :insert_dt , :insert_by , :log_status)", {
            replacements: {
                so_req_key: req.body.headers.so_id,
                so_req_status: 'P',
                so_req_comment: req.body.headers.comment,
                insert_dt: update_date,
                insert_by: req.logedINUser,
                log_status: "Updated"
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction
        });

        await transaction.commit();
        return res.json({ status: "success", success: true, message: "Successfully Updated Sell Order." });

    } catch (err) {
        return helper.errorResponse(res, err);
    }

})


// PRINT SELL ORDER 
router.post("/printSellOrder", async (req, res) => {
    let validation = new Validator(req.body, {
        so_id: "required",
    });
    if (validation.fails()) {
        return res.json({ status: "error", success: false, message: "Something is missing in form field to supply", data: validation.errors.all() });
    }

    try {

        const stmt = await invtDB.query("SELECT CASE WHEN sell_request.so_type = 'product' THEN products.p_name ELSE components.c_name END AS item_name, CASE WHEN sell_request.so_type = 'product' THEN products.p_sku ELSE components.c_part_no END AS item_part_no, CASE WHEN sell_request.so_type = 'product' THEN products.product_key ELSE components.component_key END AS item_key, sell_request.* FROM sell_request LEFT JOIN products ON sell_request.so_type = 'product' AND products.product_key = sell_request.so_item LEFT JOIN components ON sell_request.so_type = 'component' AND components.component_key = sell_request.so_item WHERE sell_request.so_req_id = :so_req_key", {
            replacements: { so_req_key: req.body.so_id },
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt.length > 0) {

            const cust_name = await tallyDB.query("SELECT name FROM client_basic_detail WHERE code = :code", {
                replacements: { code: stmt[0].so_customer },
                type: invtDB.QueryTypes.SELECT
            });

            let client_name = cust_name[0].name;

            const name = await invtDB.query("SELECT user_name FROM admin_login WHERE CustID = :user_id", {
                replacements: { user_id: stmt[0].insert_by },
                type: invtDB.QueryTypes.SELECT
            });

            let user = name[0].user_name;

            let items_data = [];

            let total_row_value = 0;
            let total_row_amount = 0;
            let sum_total_qty = 0;
            let sum_total_value = 0;
            let sum_total_cgst = 0;
            let sum_total_sgst = 0;
            let sum_total_igst = 0;
            let sum_total_amt = 0;

            let count = 1;

            stmt.forEach((item) => {
                total_row_value = helper.number(item.so_item_qty) * helper.number(item.so_item_price);
                total_row_amount = helper.number(total_row_value) + helper.number(item.so_sgst) + helper.number(item.so_cgst) + helper.number(item.so_igst);
                items_data += `
				<tr class="no-bottom-border">
                    <td>${count}</td>
                    <td>${item.item_name}</td>
					<td>${item.so_hsn_sac}</td>
					<td>${item.item_part_no}</td>                    
                    <td>${helper.number(item.so_item_qty)}</td>
                    <td>${item.so_item_price}</td>
                    <td>${total_row_value}</td>
                    <td>${item.so_cgst}</td>
                    <td>${item.so_sgst}</td>
                    <td>${item.so_igst}</td>
                    <td>${total_row_amount.toFixed(2)}</td>
                </tr>
				`;
                count = count + 1;
                sum_total_qty += helper.number(item.so_item_qty);
                sum_total_value += total_row_value;
                sum_total_cgst += helper.number(item.so_cgst);
                sum_total_sgst += helper.number(item.so_sgst);
                sum_total_igst += helper.number(item.so_igst);
                sum_total_amt += total_row_amount;
            });


            let data = {
                customer_name: client_name,
                customer_address: stmt[0].so_cust_addr,
                billing_address: stmt[0].billing_address,
                shipping_address: stmt[0].shipping_address,
                so_id: stmt[0].so_req_id,
                so_delivery_term: stmt[0].so_delivery_term,
                insert_by: user,
                insert_dt: stmt[0].insert_dt,
                sum_total_qty: sum_total_qty,
                sum_total_value: sum_total_value,
                sum_total_cgst: sum_total_cgst,
                sum_total_sgst: sum_total_sgst,
                sum_total_igst: sum_total_igst,
                sum_total_amt: sum_total_amt.toFixed(2),
                sum_total_amt_in_word: helper.amount_to_word(sum_total_amt.toFixed(2)) + " Only",
            };

            let html = SOPrint.sell_print(data, items_data);

            let fileName = "SELL-" + data.so_id.replace(/\//g, "_") + ".pdf";

            let options = { format: "A4", margin: { top: "5px", bottom: "10px", left: "10px", right: "10px" } };
            let file = { content: html };
            html_to_pdf
                .generatePdf(file, options)
                .then((pdfBuffer) => {

                    return res.json({ status: "success", success: true, message: "File Generated successfully.", data: { buffer: pdfBuffer, filename: fileName } });
                })
                .catch((err) => {
                    return res.json({ status: "error", success: false, message: "An error occurred while generating file", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
                });
        }

        else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }

    } catch (error) {
        return helper.errorResponse(res, error);
    }
});

module.exports = router

const express = require("express");
const router = express.Router();

let { invtDB } = require("../../../config/db/connection");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

// GET ALL FGIN LOCATIONS
router.post("/fgin_locations", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query("SELECT locations FROM location_allotted WHERE loc_all_key = :location_key", {
      replacements: { location_key: "20231028175257107" },
      type: invtDB.QueryTypes.SELECT,
    });

    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    locations = await invtDB.query("SELECT location_key as id , loc_name as text FROM `location_main` WHERE `location_key` IN (:location_defined)", {
      replacements: { location_defined: loc_ids },
      type: invtDB.QueryTypes.SELECT,
    });
    return res.json({ status: "success", success: true, message: "", data: locations });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// MIN FG/SFG INWARD
// router.post("/savefginward", [auth.isAuthorized, auth.checkDuplicacy_db], async (req, res) => {
//   let validation = new Validator(req.body, {
//     cust_name: "required",
//     cust_addr: "required",
//     product: "required",
//     qty: "required",
//     rate: "required",
//     doc_id: "required",
//     hsn_code: "required",
//     gst_type: "required",
//     location: "required",
//   });

//   if (validation.fails()) {
//     return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
//   }

//   const transaction = await invtDB.transaction();

//   try {

//     let transactionID = await helper.genTransaction("FGMIN", transaction);

//     let product_length = req.body.product.length;

//     for (let i = 0; i < product_length; i++) {

//       if (req.body.qty[i] <= 0) {
//         await transaction.rollback();
//         return res.json({ status: "error", success: false, message: "Quantity must be greater than zero" });
//       }

//       let stmt_prod = await invtDB.query("SELECT product_key, p_hsncode FROM products WHERE product_key = :key", {
//         replacements: { key: req.body.product[i] },
//         type: invtDB.QueryTypes.SELECT,
//       });

//       if (stmt_prod.length > 0) {
//         let stmt1 = await invtDB.query(
//           "INSERT INTO mfg_production_4 (company_branch,currency_type,exchange_rate,fgin_cust_name,fgin_cust_addr,mfg_pro_apr_sku,mfg_approve_in_qty,mfg_pro_apr_by,mfg_pro_apr_date,mfg_pro_apr_fulldate,mfg_pro_apr_transaction,mfg_pro_location_in,type,fgin_type,fgin_rate,fgin_hsn_code,fgin_gst_type,fgin_gst_rate,fgin_gst_cgst,fgin_gst_sgst,fgin_gst_igst,fgin_doc_id,fgin_doc_date,fgin_remark) VALUES (:branch, :currency, :exchange, :cust_name, :cust_addr, :sku, :totalIn, :by, :insertdate, :fulldate, :transaction, :location, 'IN', 'RETURN', :rate, :hsncode, :gsttype, :gstrate, :cgst, :sgst, :igst, :doc_id, :doc_date, :remark)",
//           {
//             replacements: {
//               branch: req.branch,
//               currency: req.body.currency[i],
//               exchange: req.body.exchange[i],
//               cust_name: req.body.cust_name,
//               cust_addr: req.body.cust_addr,
//               sku: req.body.product[i],
//               totalIn: req.body.qty[i],
//               by: req.logedINUser,
//               insertdate: moment(new Date()).tz("Asia/Kolkata").format("DD-MM-YYYY"),
//               fulldate: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
//               transaction: transactionID,
//               doc_id: req.body.doc_id,
//               doc_date: req.body.doc_date == null ? '--' : req.body.doc_date,
//               rate: req.body.rate[i],
//               location: req.body.location[i],
//               hsncode: req.body.hsn_code[i],
//               gsttype: req.body.gst_type[i],
//               gstrate: req.body.gstrate[i],
//               cgst: helper.gstCalculation(req.body.gstrate[i], req.body.rate[i] * req.body.qty[i], req.body.gst_type[i]).cgst,
//               sgst: helper.gstCalculation(req.body.gstrate[i], req.body.rate[i] * req.body.qty[i], req.body.gst_type[i]).sgst,
//               igst: helper.gstCalculation(req.body.gstrate[i], req.body.rate[i] * req.body.qty[i], req.body.gst_type[i]).igst,
//               remark: req.body.remark[i] == null ? '--' : req.body.remark[i],
//             },
//             type: invtDB.QueryTypes.INSERT,
//             transaction: transaction,
//           }
//         );

//         if (stmt1.length === 0) {
//           await transaction.rollback();
//           return res.json({ status: "error", success: false, message: "Internal Error contact to system administrator" });
//         }
//       } else {
//         await transaction.rollback();
//         return res.json({ status: "error", success: false, message: "Product SKU not matched" });
//       }
//     }

//     await transaction.commit();
//     return res.json({ status: "success", success: true, message: "FG/SFG MIN created Successfully", data: { txn: transactionID } });

//   } catch (error) {
//       return helper.errorResponse(res, error);
//   }
// });


router.post("/savefginward", [auth.isAuthorized, auth.checkDuplicacy_db], async (req, res) => {
  if (req.body.vendortype == "v01") {
    const validation = new Validator(req.body, {
      vendor: "required",
      vendorbranch: "required",
      address: "required",
      attachment: "required",
      vendortype: "required",
      cost_center: "required",
      project_id: "required",
    });

    if (validation.fails()) {
      res.json({ success: false, status: "error", message: helper.firstErrorValidatorjs(validation) });
      return;
    }
  }

  if (req.body.vendortype == "s01") {
    const validation = new Validator(req.body, {
      vendortype: "required",
    });

    if (validation.fails()) {
      res.json({ success: false, status: "error", message: helper.firstErrorValidatorjs(validation) });
      return;
    }
  }

  let check_branch = await invtDB.query("SELECT `branch_code` FROM `branches` WHERE `branch_code` = :branchcode", {
    replacements: { branchcode: req.branch },
    type: invtDB.QueryTypes.SELECT,
  });
  if (check_branch.length == 0) {
    res.json({ success: false, status: "error", message: "You haven't OR selected an invalid company branch" });
    return;
  }

  let itemLength = req.body.product.length;
  if (itemLength <= 0) {
    res.json({ success: false, status: "error", message: "Please add atleast one item" });
    return;
  }

  // currency validation
  let itemCurrencys = [];
  for (let i = 0; i < itemLength; i++) {
    itemCurrencys.push(req.body.currency[i]);
  }
  let uniqueItemCurrencys = [...new Set(itemCurrencys)];
  if (uniqueItemCurrencys.length > 1) {
    res.json({ code: 500, message: "Please select same currency", status: "error" });
    return;
  }

  for (let i = 0; i < itemLength; i++) {
    if (req.body.gst_type[i] === "LOCAL") req.body.gst_type[i] = "L";
    if (req.body.gst_type[i] === "INTER") req.body.gst_type[i] = "I";
  }

  for (let i = 0; i < itemLength; i++) {
    let itemValidation = new Validator(
      {
        item: req.body.product[i],
        qty: req.body.qty[i],
        rate: req.body.rate[i],
        currency: req.body.currency[i],
        gst_rate: req.body.gstrate[i],
        gst_type: req.body.gst_type[i],
        location: req.body.location[i],
        exchange: req.body.exchange[i],
      },
      {
        item: "required",
        qty: "required|min:1",
        rate: "required",
        currency: "required",
        gst_rate: "required|numeric",
        gst_type: ["required_if:gst_rate,!=,0", "required_if:gst_rate,!=,I", "required_if:gst_rate,!=,L"],
        location: "required",
        exchange: "required|numeric",
      }
    );
    if (itemValidation.fails()) {
      res.json({ code: 500, message: helper.firstErrorValidatorjs(itemValidation), status: "error" });
      return;
    }
  }

  const transaction = await invtDB.transaction();

  try {
    let transactionID;
    let insert_dt = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    let s01Data = [];

    let stmt2 = await invtDB.query("SELECT * FROM ims_numbering WHERE for_number = 'FGMIN' FOR UPDATE", {
      transaction: transaction,
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt2.length > 0) {
      var suffix = stmt2[0].suffix;
      suffix = parseInt(suffix) + 1;
      suffix = suffix.toString();
      suffix = suffix.padStart(parseInt(stmt2[0].number_length_limit), "0");
      transactionID = stmt2[0].prefix + "/" + stmt2[0].session + "/" + suffix;
    } else {
      let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
      transactionID = "FGIN/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    await invtDB.query("UPDATE ims_numbering SET suffix = suffix + 1 WHERE for_number = 'FGMIN'", {
      transaction: transaction,
      type: invtDB.QueryTypes.UPDATE,
    });

    let product_length = req.body.product.length;

    for (let i = 0; i < product_length; i++) {
      if (req.body.qty[i] <= 0) {
        await transaction.rollback();
        return res.json({ code: 500, status: "error", message: { msg: "Quantity must be greater than zero" } });
      }

      let stmt_prod = await invtDB.query("SELECT product_key, p_name, p_hsncode, p_sku FROM products WHERE product_key = :key", {
        replacements: { key: req.body.product[i] },
        type: invtDB.QueryTypes.SELECT,
      });

      if (stmt_prod.length > 0) {
        let inward_type = req.body.vendortype === "s01" ? "SALES-RETURN" : req.body.vendortype === "v01" ? "VENDOR" : "--";

        const gstCalc = helper.gstCalculation(
          req.body.gstrate[i],
          req.body.rate[i] * req.body.qty[i],
          req.body.gst_type[i]
        );
        const cgst = gstCalc?.cgst ?? 0;
        const sgst = gstCalc?.sgst ?? 0;
        const igst = gstCalc?.igst ?? 0;

        let stmt1 = await invtDB.query(
          `INSERT INTO mfg_production_3 
          (txn_session,company_branch, mfg_pro_apr_sku, inward_type, mfg_approve_in_qty, currency_type, in_fg_rate, 
           mfg_pro_location_in, vendor_type, in_vendor_branch, in_vendor_name, in_vendor_addr, 
           in_fg_invoice_id, in_fg_invoice_date, fg_hsn_code, fg_gst_type, fg_gst_rate, fg_cgst, 
           fg_sgst, fg_igst, exchange_rate, mfg_pro_apr_fulldate, mfg_pro_apr_by, 
           fg_out_remark, type, mfg_project_id, mfg_cost_center, mfg_pro_apr_transaction) 
         VALUES 
          (:txn_session,:branch, :sku, :inward_type, :totalIn, :currency, :rate, 
           :location, :vendortype, :vendor_branch, :vendor_code, :vendor_address, 
           :invoice_id, :invoiceDate, :hsnCode, :gstType, :gstRate, :cgst, 
           :sgst, :igst, :exchange, :insertDt, :insertBy, 
           :remark, 'FGMIN', :project_id, :cost_center, :transactionID)`,
          {
            replacements: {
              txn_session: helper.generateTxnSession(),
              branch: req.branch,
              sku: stmt_prod[0].p_sku,
              inward_type: inward_type,
              totalIn: req.body.qty[i],
              currency: req.body.currency[i],
              rate: req.body.rate[i],
              location: req.body.location[i],
              vendortype: req.body.vendortype,
              invoice_id: req.body.invoice ?? "--",
              invoiceDate: req.body.invoice_date ?? "--",
              vendor_branch: req.body.vendorbranch ? req.body.vendorbranch : "--",
              vendor_address: req.body.address ? req.body.address.replace(/\n/g, " ") : "--",
              vendor_code: req.body.vendor ? req.body.vendor : "--",
              hsnCode: req.body.hsn_code[i],
              gstType: req.body.gst_type[i],
              gstRate: req.body.gstrate[i],
              cgst,
              sgst,
              igst,
              exchange: req.body.exchange[i],
              insertDt: insert_dt,
              insertBy: req.logedINUser,
              remark: req.body.remark[i] == null ? "--" : req.body.remark[i],
              project_id: req.body.project_id ?? "--",
              cost_center: req.body.cost_center ?? "--",
              transactionID: transactionID,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        // ================= SAVE ATTACHMENTS (INVOICES) =================

        let str = req.body.attachment;
        let arr = str.split(",");
        let fileLength = arr.length;
        for (let j = 0; j < fileLength; j++) {
          await invtDB.query(
            `INSERT INTO ims_min_invoices(min_inv_file, min_inv_by, min_inv_dt, min_min_id) VALUES (:fileurl, :invby, :invdate, :minid)`,
            {
              replacements: {
                fileurl: arr[j],
                invby: req.logedINUser,
                invdate: insert_dt,
                minid: transactionID,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: transaction,
            }
          );
        }


        // ================= S01 SALES RETURN DATA PUSH =================
        if (req.body.vendortype === "s01") {
          s01Data.push({
            sku: stmt_prod[0].p_sku,
            skuName: stmt_prod[0].p_name,
            vendor_code: req.body.vendor ? req.body.vendor : "--",
            vendortype: req.body.vendortype,
            vendor_branch: req.body.vendorbranch ? req.body.vendorbranch : "--",
            vendor_address: req.body.address ? req.body.address.replace(/\n/g, " ") : "--",
            project_id: req.body.project_id ?? "--",
            cost_center: req.body.cost_center ?? "--",
            invoice_id: req.body.invoice ?? "--",
            InvoiceDate: req.body.invoice_date
              ? moment(req.body.invoice_date, "DD-MM-YYYY").format("YYYY/MM/DD HH:mm:ss")
              : moment(insert_dt).format("YYYY/MM/DD HH:mm:ss"),
            transactionID: transactionID,
            UNIT: isNaN(parseInt(req.body.qty[i])) ? 0 : parseInt(req.body.qty[i]),
            Rate: isNaN(parseFloat(req.body.rate[i])) ? 0 : parseFloat(req.body.rate[i]),
            CGST: cgst,
            SGST: sgst,
            IGST: igst,
            FgMINDate: moment(insert_dt).format("YYYY/MM/DD HH:mm:ss"),
          });
        }

        if (!stmt1 || stmt1[1] === 0) {
          await transaction.rollback();
          return res.json({ code: 200, status: "error", message: "Internal Error contact to system administrator" });
        }
      } else {
        await transaction.rollback();
        return res.json({ code: 500, status: "error", message: { msg: "Product SKU not matched" } });
      }
    }

    await transaction.commit();
    res.json({ code: 200, data: { txn: transactionID }, status: "success", message: "FG/SFG MIN created Successfully" })

  } catch (err) {
    console.log(err);
    await transaction.rollback();
    return res.json({
      code: 500,
      status: "error",
      message: { msg: "Internal Error !!! If this condition persists, contact your system administrator" },
      error: err.stack,
    });
  }
});


router.post("/getFGMinTransactionByDate", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({ success: false, status: "error", message: "pick the type firstly.." });
  }

  try {
    let stmt;

    if (req.body.wise === "datewise") {
      const date = moment(req.body.data, "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        `SELECT mfg_production_3.*, mfg_production_3.mfg_pro_apr_fulldate AS inward_date, products.p_name, products.p_sku, products.p_hsncode, admin_login.user_name FROM mfg_production_3 LEFT JOIN admin_login ON mfg_production_3.mfg_pro_apr_by = admin_login.CustID LEFT JOIN products ON mfg_production_3.mfg_pro_apr_sku = products.p_sku WHERE DATE(mfg_production_3.mfg_pro_apr_fulldate) = :date AND mfg_production_3.type = 'FGMIN' AND mfg_production_3.mfg_pro_apr_transaction IS NOT NULL AND mfg_production_3.mfg_pro_apr_transaction != '--' ORDER BY mfg_production_3.mfg_pro_apr_fulldate DESC`,
        {
          replacements: { date },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (req.body.wise === "minwise") {
      stmt = await invtDB.query(
        `SELECT mfg_production_3.*, mfg_production_3.mfg_pro_apr_fulldate AS inward_date, products.p_name, products.p_sku, products.p_hsncode, admin_login.user_name FROM mfg_production_3 LEFT JOIN admin_login ON mfg_production_3.mfg_pro_apr_by = admin_login.CustID LEFT JOIN products ON mfg_production_3.mfg_pro_apr_sku = products.p_sku WHERE mfg_production_3.mfg_pro_apr_transaction LIKE CONCAT('%', :trans, '%') AND mfg_production_3.type = 'FGMIN' AND mfg_production_3.mfg_pro_apr_transaction IS NOT NULL AND mfg_production_3.mfg_pro_apr_transaction != '--' ORDER BY mfg_production_3.mfg_pro_apr_fulldate DESC`,
        {
          replacements: { trans: req.body.data },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt.length > 0) {
      let final_data = [];

      stmt.map(async (item, index) => {
        let invoiceStatus = false;

        // Check invoices
        let checkInvoices = await invtDB.query(
          "SELECT * FROM ims_min_invoices WHERE min_min_id = :txn",
          {
            replacements: { txn: item.mfg_pro_apr_transaction },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (checkInvoices.length > 0) {
          invoiceStatus = true;
        }

        // Get location name
        let stmt0 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE'",
          {
            replacements: { location: item.mfg_pro_location_in },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let location = stmt0.length > 0 ? stmt0[0].loc_name : "N/A";

        // Get vendor name
        let vendorname = "--";
        if (item.in_vendor_name && item.in_vendor_name !== "--" && item.in_vendor_name !== "") {
          let stmt1 = await invtDB.query(
            "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendorname",
            {
              replacements: { vendorname: item.in_vendor_name },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          vendorname = stmt1.length > 0 ? stmt1[0].ven_name : "--";
        }

        final_data.push({
          id: index + 1,
          datetime: moment(item.inward_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
          sku: item.p_sku,
          transaction: item.mfg_pro_apr_transaction,
          print_id: item.mfg_pro_apr_transaction,
          vendorname: vendorname,
          inqty: helper.number(item.mfg_approve_in_qty),
          invoice: item.in_fg_invoice_id || "--",
          location: location,
          inby: item.user_name,
          invoiceStatus: invoiceStatus,
        });

        if (stmt.length == final_data.length) {
          return res.json({ success: true, status: "success", message: "Data found", data: final_data });
        }
      });

    } else {
      return res.json({
        success: false,
        status: "error",
        message: "Could not find the transaction for the date you have supplied OR already cancelled",
      });
    }

  } catch (err) {
    console.log(err);
    return res.json({
      success: false,
      status: "error",
      message: "Internal Error!!! If this condition persists, contact your system administrator",
      error: err.stack,
    });
  }
});

const storage1 = multer.diskStorage({
  destination: "FGtmp",
  filename: function (req, file, cb) {
    cb(null, "TRY" + Date.now() + Math.floor(Math.random() * 900 + 100) + path.extname(file.originalname));
  },
});

const upload1 = multer({ storage: storage1 });

router.post("/upload/item", upload1.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({
      
        message: { msg: "No file uploaded. Please upload an Excel file." },
        status: "error",
        success: false,
      });
    }

    const expectedColumns = ["P_SKU", "QTY", "RATE", "HSN", "GST_TYPE", "GST_RATE", "LOCATION", "REMARK"];

    const filePath = req.file.path;

    const workbook = xlsx.readFile(filePath);

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        code: 400,
        message: { msg: "Excel file is empty or invalid. Please ensure the file contains at least one sheet." },
        status: "error",
        success: false,
      });
    }

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    if (!worksheet || !worksheet["!ref"]) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        code: 400,
        message: { msg: "Excel sheet is empty. Please ensure the sheet contains data." },
        status: "error",
        success: false,
      });
    }

    const headers = [];
    const range = xlsx.utils.decode_range(worksheet["!ref"]);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = xlsx.utils.encode_cell({ r: 0, c: col });
      const cell = worksheet[cellAddress];
      headers.push(cell ? cell.v : null);
    }

    if (headers.length !== expectedColumns.length) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        code: 400,
        message: { msg: `Excel column validation failed. Expected ${expectedColumns.length} columns but found ${headers.length} columns.` },
        status: "error",
        success: false,
      });
    }

    const mismatches = headers
      .map((header, index) => {
        const headerStr = header && typeof header === "string" ? header.trim().toUpperCase() : "";
        const expectedStr = expectedColumns[index] ? expectedColumns[index].toUpperCase() : "";
        if (headerStr !== expectedStr) {
          return {
            column: `Column ${String.fromCharCode(65 + index)}`,
            actual: header || "Empty",
            expected: expectedColumns[index] || "N/A",
          };
        }
        return null;
      })
      .filter(Boolean);

    if (mismatches.length > 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        code: 400,
        message: { msg: "Excel column validation failed." },
        mismatches,
        status: "error",
        success: false,
      });
    }

    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    const data = rows.slice(1);

    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      const rowNumber = rowIndex + 2;

      if (!row || row.length < 8) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message: { msg: `Excel column validation failed\nRow ${rowNumber} is missing required columns. Please ensure all 10 columns are present.` },
          status: "error",
          success: false,
        });
      }

      const qty = Number(row[1]);
      if (isNaN(qty) || qty <= 0 || row[1] === null || row[1] === undefined) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message: { msg: `Excel column validation failed\nQTY must be a non-zero number at row number [${rowNumber}]` },
          status: "error",
          success: false,
        });
      }

      const hsn = row[3];
      if (hsn !== null && hsn !== undefined && hsn !== "--") {
        const hsnStr = String(hsn);
        if (![6, 8].includes(hsnStr.length) || isNaN(hsn)) {
          fs.unlinkSync(filePath);
          return res.status(400).json({
            code: 400,
            message: { msg: `Excel column validation failed\nHSN must be '--', a 6-digit, or an 8-digit number at row number [${rowNumber}]` },
            status: "error",
            success: false,
          });
        }
      }



      const remark = row[7];
      if (remark && typeof remark === "string" && remark.length > 100) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message: { msg: `Excel column validation failed\nREMARK length must be less than 100 characters at row number [${rowNumber}]` },
          status: "error",
          success: false,
        });
      }

      const gstType = row[4];
      if (!gstType || (gstType !== "LOCAL" && gstType !== "INTER STATE")) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message: { msg: `Excel column validation failed\nGST_TYPE must be 'LOCAL' or 'INTER STATE' at row number [${rowNumber}]` },
          status: "error",
          success: false,
        });
      }

      row[4] = gstType === "LOCAL" ? { text: "LOCAL", value: "L" } : { text: "INTER STATE", value: "I" };

      const gstRate = Number(row[5]);
      if (isNaN(gstRate) || gstRate < 0 || row[5] === null || row[5] === undefined) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message: { msg: `Excel column validation failed\nGST_RATE must be a non-negative number at row number [${rowNumber}]` },
          status: "error",
          success: false,
        });
      }

      const location = row[6];
      if (!location || location === null || location === undefined) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message: { msg: `Excel column validation failed\nLOCATION is required at row number [${rowNumber}]` },
          status: "error",
          success: false,
        });
      }

      const locationData = await invtDB.query("SELECT `loc_name`, `location_key` FROM `location_main` WHERE `loc_name` = :location", {
        replacements: { location },
        type: invtDB.QueryTypes.SELECT,
      });

      if (!locationData || locationData.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message: { msg: `Excel column validation failed\nLOCATION '${location}' does not exist in the database at row number [${rowNumber}]` },
          status: "error",
          success: false,
        });
      }

      row[6] = { text: locationData[0].loc_name, value: locationData[0].location_key };

      const p_sku = row[0];
      if (!p_sku || p_sku === null || p_sku === undefined) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message: { msg: `Excel column validation failed\P_SKU is required at row number [${rowNumber}]` },
          status: "error",
          success: false,
        });
      }

      const pSkuData = await invtDB.query("SELECT `p_name`, `product_key`, `p_sku` FROM `products` WHERE `p_sku` = :p_sku", {
        replacements: { p_sku },
        type: invtDB.QueryTypes.SELECT,
      });

      if (!pSkuData || pSkuData.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          code: 400,
          message: { msg: `Excel column validation failed\nPART_CODE '${p_sku}' does not exist in the database at row number [${rowNumber}]` },
          status: "error",
          success: false,
        });
      }

      row[0] = {
        name: pSkuData[0].p_name,
        key: pSkuData[0].product_key,
        pSku: pSkuData[0].p_sku,
      };
    }

    // fs.unlinkSync(filePath);

    const transformedHeaders = headers.map((header) => {
      if (!header || typeof header !== "string") {
        return header || "Unknown";
      }
      return header.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    });

    return res.status(200).json({
      code: 200,
      data: {
        headers: transformedHeaders,
        rows: data,
      },
      message: "Excel file validated successfully.",
      status: "success",
    });
  } catch (error) {
    console.log(error)
    if (req.file && req.file.path) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({

      code: 500,
      message: { msg: "Internal Error! If this persists, contact your system administrator." },
      error: error.message,
      status: "error",
      success: false,
    });
  }
});



module.exports = router;

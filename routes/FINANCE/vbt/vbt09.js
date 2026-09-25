const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const { invtDB, tallyDB } = require("../../../config/db/connection");
const Validator = require("validatorjs");
const moment = require("moment");




router.post("/fetch_vbt09", async (req, res) => {
  let validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      success:false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
  }

  try {
    const { wise, data } = req.body;

    let main_stmt;

    if (wise == "date_wise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      main_stmt = await invtDB.query(
        `SELECT 
        'FG' AS type,
          mfg_pro_apr_fulldate AS min_in_date,
          mfg_pro_apr_transaction AS min_transaction,
          mfg_pro_apr_sku AS part_code,
          in_vendor_name AS ven_code,
          vbp_status
        FROM mfg_production_3
        WHERE type = 'FGMIN'
          AND inward_type = 'VENDOR'
          AND DATE(mfg_pro_apr_fulldate) BETWEEN :date1 AND :date2
          AND vbp_status = 'N'
        ORDER BY ID DESC`,
        {
          replacements: {
            date1: date1,
            date2: date2,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

    } else if (wise == "vendor_wise") {

      main_stmt = await invtDB.query(
        `SELECT 
        'FG' AS type,
          mfg_pro_apr_fulldate AS min_in_date,
          mfg_pro_apr_transaction AS min_transaction,
          mfg_pro_apr_sku AS part_code,
          in_vendor_name AS ven_code,
          vbp_status
        FROM mfg_production_3
        WHERE type = 'FGMIN'
          AND inward_type = 'VENDOR'
          AND in_vendor_name = :ven
          AND vbp_status = 'N'
        ORDER BY ID`,
        {
          replacements: {
            ven: data,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

    } else if (wise == "min_wise") {

      main_stmt = await invtDB.query(
        `SELECT 
        'FG' AS type,
          mfg_pro_apr_fulldate AS min_in_date,
          mfg_pro_apr_transaction AS min_transaction,
          mfg_pro_apr_sku AS part_code,
          in_vendor_name AS ven_code,
          vbp_status
        FROM mfg_production_3
        
        WHERE type = 'FGMIN'
          AND inward_type = 'VENDOR'
          AND mfg_pro_apr_transaction LIKE :min
          AND vbp_status = 'N'
        ORDER BY ID`,
        {
          replacements: {
            min: `%${data}%`,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (main_stmt && main_stmt.length > 0) {
      for (let i = 0; i < main_stmt.length; i++) {
        main_stmt[i].min_in_date = moment(
          main_stmt[i].min_in_date
        ).format("DD/MM/YYYY");
        main_stmt[i].vbp_status = main_stmt[i].vbp_status == "N" ? "PENDING" : main_stmt[i].vbp_status;
      }

      return res.json({
        success:true,
        message: "Sales return FG MIN fetched successfully",
        status: "success",
        data: main_stmt,
      });
    } else {
      return res.json({
        success:false,
        status: "error",
        message:  "No Data Found!!!",
      });
    }
  } catch (err) {
    console.log(err);
    return res.json({
      success:false,
      status: "error",
      message: "Internal Error<br/>If this condition persists, contact your system administrator",
      errors: err.stack,
    });
  }
});


router.post("/fetch_multi_fg_min_data", async (req, res) => {
  let validation = new Validator(req.body, {
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      success:false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
  }

  const data = req.body.data;

  try {
    const final_data = [];

    for (const item of data) {
      let main_stmt = [];

      // FG QUERY ONLY
      if (item.type == "FG") {
        main_stmt = await invtDB.query(
          `
          SELECT
            mfg_production_3.mfg_pro_apr_sku AS itemCode,
            products.p_name AS itemName,
            mfg_production_3.mfg_approve_in_qty AS qty,
            mfg_production_3.in_fg_rate AS rate,
            mfg_production_3.fg_hsn_code AS hsnCode,
            mfg_production_3.fg_gst_rate AS gstRate,
            mfg_production_3.fg_cgst AS cgst,
            mfg_production_3.fg_sgst AS sgst,
            mfg_production_3.fg_igst AS igst,
            mfg_production_3.fg_gst_type AS gstType,
            mfg_production_3.in_vendor_name AS venCode,
            mfg_production_3.in_vendor_addr AS vendorAddress,
            mfg_production_3.in_vendor_branch AS vendorBranch,
            mfg_production_3.in_fg_invoice_id AS invoiceId,

            '--' AS poInvoiceId,
            '--' AS jwInvoiceId,

            ven_basic_detail.ven_tds AS tds,
            ven_basic_detail.ven_name AS venName,

            units.units_name AS uom,

            mfg_production_3.mfg_pro_apr_transaction AS transaction,

            '--' AS acknowledgeIRN,

            mfg_production_3.mfg_pro_apr_fulldate AS fullDate

          FROM mfg_production_3

          LEFT JOIN products
            ON mfg_production_3.mfg_pro_apr_sku = products.p_sku

          LEFT JOIN units
            ON products.p_uom = units.units_id

          LEFT JOIN ven_basic_detail
            ON mfg_production_3.in_vendor_name = ven_basic_detail.ven_register_id

          WHERE mfg_production_3.mfg_pro_apr_transaction = :min_id
            AND mfg_production_3.type = 'FGMIN'
            AND mfg_production_3.inward_type = 'VENDOR'
            AND mfg_production_3.vendor_type = 'v01'
            AND mfg_production_3.vbp_status IN ('N', 'NOTELIGIBLE')
          `,
          {
            replacements: {
              min_id: item.minTxn,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      }

      if (!main_stmt.length) {
        return res.json({
          success:false,
          status: "error",
          message: `No data Found for transaction ${item.minTxn}`,
        });
      }

      for (const row of main_stmt) {

        // GSTIN
        const gstIn_stmt = await invtDB.query(
          `
          SELECT ven_add_gst
          FROM ven_address_detail
          WHERE ven_id = :ven_id AND ven_address_id = :venAddressId
          `,
          {
            replacements: {
              ven_id: row.venCode,
              venAddressId: row.vendorBranch
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        const gstin_option = gstIn_stmt.map(
          (v) => v.ven_add_gst
        );

        // INVOICE
        let invoice =
          row.invoiceId !== "--"
            ? row.invoiceId
            : row.poInvoiceId !== "--"
              ? row.poInvoiceId
              : row.jwInvoiceId;

        // TDS
        let tds_option = [];

        if (row.tds && row.tds !== "--") {
          const tds_keys = row.tds.split(",");

          for (const key of tds_keys) {
            const tds_data = await tallyDB.query(
              `
              SELECT
                tds_name,
                tds_percent,
                tds_key,
                tds_code,
                tds_gl_code,
                ladger_name,
                ledger_key
              FROM tally_tds
              LEFT JOIN tally_ledger
                ON tally_tds.tds_gl_code = tally_ledger.ledger_key
              WHERE tds_key = :key
              `,
              {
                replacements: {
                  key: key.trim(),
                },
                type: tallyDB.QueryTypes.SELECT,
              }
            );

            tds_option.push(...tds_data);
          }
        }

        // VENDOR ADDRESS
        const vendor_address = row.vendorAddress;

        // PURCHASE GL CODE / TDS CODE
        let purchaseGLCode = [];
        let tdsCode = [];

        final_data.push({
          transaction: row.transaction,
          itemCode: row.itemCode,
          itemName: row.itemName,
          qty: row.qty,
          rate: row.rate,
          value: (
            Number(row.rate) * Number(row.qty)
          ).toFixed(2),

          hsnCode: row.hsnCode,
          gstType: row.gstType,
          gstRate: row.gstRate,
          cgst: row.cgst,
          sgst: row.sgst,
          igst: row.igst,

          tds: tds_option,

          venCode: row.venCode,
          invoiceId: invoice,
          venAddress: vendor_address,
          venName: row.venName,

          uom: row.uom,
          gstin: gstin_option,

          acknowledgeIRN: row.acknowledgeIRN,

          purchaseGLCode: purchaseGLCode,
          tdsCode: tdsCode,

          fullDate: moment(row.fullDate).format("DD-MM-YYYY"),
        });
      }
    }

    return res.json({
      success:true,
      status: "success",
      data: final_data,
    });

  } catch (error) {
    console.log(error);

    return res.json({
      success:false,
      status: "error",
      message: "Internal Error",
      error: error.stack,
    });
  }
});


// ADD VBT09
router.post("/add_vbt09", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    ven_code: "required",
    ven_address: "required",
    invoice_no: "required",
    invoice_date: "required",
    comment: "required",
    vbt_gstin: "required",
    invoice_no: "required",
    bill_amount: "required",
    inrPrice: "required",
    cifPrice: "required",
    cifValue: "required",
    eff_date: "required"
  });

  if (validation.fails()) {
    return res.json({
      success:false,
      status: "error",
      message: validation.errors.all(),
    });
  }

  const transaction = await tallyDB.transaction();
  const transactioninvt = await invtDB.transaction();

  try {
    if (moment(req.body.invoice_date, "DD-MM-YYYY") > moment(req.body.eff_date, "DD-MM-YYYY")) {
      return res.json({ success:false, status: 'error', message: 'effective date must be greater than invoice date' });
    }
    let part_length = req.body.part_code.length;
    let total_debit = 0;
    let total_credit = 0;
    let total_ven_ammount = 0;

    for (let i = 0; i < part_length; i++) {
      let row_valid = new Validator(
        {
          cgst_gl: req.body.cgst_gl[i],
          sgst_gl: req.body.sgst_gl[i],
          igst_gl: req.body.igst_gl[i],
        },
        {
          cgst_gl: "required",
          sgst_gl: "required",
          igst_gl: "required",
        }
      );
      if (row_valid.fails()) {
        return res.json({ success:false, message: row_valid.errors.all(), status: "error" });
      }
      total_debit += Number(req.body.cgsts[i]) + Number(req.body.igsts[i]) + Number(req.body.sgsts[i]) + Number(req.body.freight[i]) + Number(req.body.bill_qty[i]) * Number(req.body.in_rates[i]);

      total_credit += Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]);
    }

    if (req.body.round_type == "-") {
      total_debit -= Number(req.body.round_value);
    } else {
      total_debit += Number(req.body.round_value);
    }
    for (let i = 0; i < part_length; i++) {
      // total_ven_ammount += (Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]));
      total_ven_ammount += Number(req.body.ven_amounts[i]);
    }

    if (Math.abs(Number(req.body.bill_amount) - Number(total_ven_ammount).toFixed(2)) != 0) {
      return res.json({ success:false, status: "error", message: `Bill ammount ${req.body.bill_amount} and Vendor amount ${total_ven_ammount} not match ` } );
    }

    if (Math.abs(Number(Number(total_credit).toFixed(2)) - Number(Number(total_debit).toFixed(2))) != 0) {
      return res.json({
        success:false,
        status: "error",
        message: `Debit(${total_debit}) And Credit Value(${total_credit}) not matched`,
      });
    }

    // NUMBURING FUN
    let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'VBT09' FOR UPDATE", {
      type: tallyDB.QueryTypes.SELECT,
      transaction: transaction,
    });
    var vbt_no;
    if (stmt_number.length > 0) {
      var suffix = stmt_number[0].suffix;
      suffix = parseInt(suffix) + 1;
      suffix = suffix.toString();
      suffix = suffix.padStart(parseInt(stmt_number[0].number_length_limit), "0");

      vbt_no = stmt_number[0].prefix + "/" + stmt_number[0].session + "/" + suffix;
    } else {
      let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
      vbt_no = "VBT09/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'VBT09'", {
      type: tallyDB.QueryTypes.UPDATE,
      transaction: transaction,
    });
    // END NUMBURING FUN

    const vbt_key = vbt_no;
    const insert_data = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const effective_data = moment(req.body.eff_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD");
    const insert_by = req.logedINUser;

    let lastInsertedID;

    for (let i = 0; i < part_length; i++) {
      let findProject = await invtDB.query("SELECT mfg_project_id FROM mfg_production_3 WHERE mfg_pro_apr_transaction = :min", {
        replacements: {
          min: req.body.min_key[i],
        },
        type: invtDB.QueryTypes.SELECT,
      });

      if (findProject.length <= 0) {
        return res.json({ success:false, status: 'error', message: 'error while getting project id and number.' })
      }

      let part_key = await invtDB.query(
        `SELECT product_key FROM products WHERE p_sku = :p_sku`,
        {
          replacements: {
            p_sku: req.body.part_code[i],
          },
          type: invtDB.QueryTypes.SELECT,
          transaction: transactioninvt,
        }
      );

      console.log(part_key, "============part key");

      if (part_key.length == 0) {
        return res.json({
          success:false,
          status: "error",
          message: `Product not found for part code ${req.body.part_code[i]}`,
        });
      }

      console.log(part_key, "============part key")

      let stmt = await tallyDB.query(
        "INSERT INTO `tally_vbt` (txn_type, `part_code`, project_id, `vbt_inqty`,`vbt_bill_qty`, `vbt_inrate`, `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `freight`, `vbt_freight_gl`, `vbp_gst_ass_value`, `vbt_cgst`,`vbt_cgst_gl`, `vbt_sgst`,`vbt_sgst_gl`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `tds_code`, `tds_gl`, `vbt_ven_ammount`, `vbt_key`, `insert_by`, `insert_date`, `min_id` , inrPrice , cifPrice , cifValue ,`vbt_tds_ass_val`,`vbt_tds_amount`, `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `item_description` , billAmount) VALUES (:type, :part_code, :project_id, :in_qtys, :vbt_bill_qty, :in_rates, :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate,  :freight, :freight_gl, :gst_ass_vals, :cgsts, :cgsts_gl, :sgsts, :sgsts_gl, :igsts, :igsts_gl, :g_l_codes, :tds_codes, :tds_gl, :ven_amounts, :vbt_key, :insert_by, :insert_date, :min_id , :inrPrice, :cifPrice, :cifValue, :tds_ass_vals, :tds_amounts,:ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT09' , :effective_date , :item_description , :billAmount )",
        {
          replacements: {
            type:"FG",
            project_id: findProject[0].mfg_project_id,
            vbt_key: vbt_key,
            in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i],
            in_rates: req.body.in_rates[i],
            taxable_values: req.body.taxable_values[i],
            part_code: part_key[0].product_key,
            hsn_code: req.body.hsn_code[i],
            in_gst_types: req.body.in_gst_types[i],
            freight: req.body.freight[i],
            // freight value is going in purchase gl
            freight_gl: req.body.g_l_codes[i],
            gst_ass_vals: req.body.gst_ass_vals[i],
            cgsts: req.body.cgsts[i],
            // cgsts_gl: "TP274965899340",
            cgsts_gl: req.body.cgst_gl[i],
            sgsts: req.body.sgsts[i],
            // sgsts_gl: "TP385675494002",
            sgsts_gl: req.body.sgst_gl[i],
            igsts: req.body.igsts[i],
            // igsts_gl: "TP486973272469",
            igsts_gl: req.body.igst_gl[i],
            g_l_codes: req.body.g_l_codes[i],
            tds_codes: req.body.tds_codes[i],
            tds_gl: req.body.tds_gl_code[i],
            tds_ass_vals: req.body.tds_ass_vals[i],
            tds_amounts: req.body.tds_amounts[i],
            ven_amounts: Number(req.body.ven_amounts[i]).toFixed(2),
            vbt_gst_rate: req.body.vbp_gst_rate[i],
            insert_by: req.logedINUser,
            insert_date: insert_data,
            min_id: req.body.min_key[i],
            inrPrice: req.body.inrPrice[i],
            cifPrice: req.body.cifPrice[i],
            cifValue: req.body.cifValue[i],
            // Header
            ven_address: req.body.ven_address,
            invoice_no: req.body.invoice_no,
            invoice_date: req.body.invoice_date,
            comment: req.body.comment,
            ven_code: req.body.ven_code,
            vbt_gstin: req.body.vbt_gstin,
            effective_date: effective_data,
            item_description: req.body.item_description?.[i] ? req.body.item_description[i] : "",
            billAmount: req.body.bill_amount,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      ); //End Insert VBT

      lastInsertedID = stmt[0];

      if (Number(req.body.cgsts[i]) > 0) {
        let insert_cgst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            // ladger_key: "TP274965899340",
            ladger_key: req.body.cgst_gl[i],
            debit: req.body.cgsts[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT09",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }
      if (Number(req.body.igsts[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            // ladger_key: "TP486973272469",
            ladger_key: req.body.igst_gl[i],
            debit: req.body.igsts[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT09",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      if (Number(req.body.sgsts[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
          replacements: {
            // ladger_key: "TP385675494002",
            ladger_key: req.body.sgst_gl[i],
            debit: req.body.sgsts[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT09",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }
      // freight value is going in purchase gl
      if (Number(req.body.freight[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: req.body.g_l_codes[i],
            debit: req.body.freight[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT09",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }
      // GL
      if (Number(req.body.taxable_values[i]) > 0) {
        let insert_gst_ass_vals = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
          replacements: {
            ladger_key: req.body.g_l_codes[i],
            debit: req.body.taxable_values[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT09",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }
      if (req.body.tds_amounts[i] != 0) {

        if (req.body.tds_gl_code[i] == "--") {
          await transaction.rollback();
          return res.json({ success:false, status: 'error', message: { msg: 'TDS Gl not selected.' } })
        }

        let insert_tds_gl_code = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
          replacements: {
            ladger_key: req.body.tds_gl_code[i],
            debit: "0",
            credit: req.body.tds_amounts[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT09",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }
      // VENDOR
      let insert_ven_gl = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
        replacements: {
          ladger_key: req.body.ven_code,
          debit: "0",
          credit: Number(req.body.ven_amounts[i]).toFixed(2),
          module_used: vbt_key,
          insert_date: insert_data,
          which_module: "VBT09",
          effective_date: effective_data,
          insert_by: insert_by,
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transaction,
      });

      //   UPDATE MIN STATUS
      let update_stmt = await invtDB.query("UPDATE `mfg_production_3` SET `vbp_status` = 'Y' WHERE  `mfg_pro_apr_transaction` = :min AND `mfg_pro_apr_sku`= :part", {
        replacements: {
          min: req.body.min_key[i],
          part: req.body.part_code[i],
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transactioninvt,
      });
    } //END FOR LOOP

    if (lastInsertedID) {
      await tallyDB.query("UPDATE tally_vbt SET round_off_sign = :round_off_sign , round_off_amt = :round_off_amt , round_off_gl = :round_off_gl WHERE ID = :id", {
        replacements: {
          id: lastInsertedID,
          round_off_sign: req.body.round_type ?? "--",
          round_off_amt: req.body.round_value ?? "",
          round_off_gl: "TP558350023869",
        },
        type: tallyDB.QueryTypes.UPDATE,
        transaction: transaction
      })
    }

    if (req.body.round_value != 0) {
      let repl;
      if (req.body.round_type == "+") {
        repl = {
          ladger_key: "TP558350023869",
          debit: req.body.round_value,
          credit: "0",
          module_used: vbt_key,
          insert_date: insert_data,
          which_module: "VBT09",
          effective_date: effective_data,
          insert_by: insert_by,
        };
      }
      if (req.body.round_type == "-") {
        repl = {
          ladger_key: "TP558350023869",
          debit: "0",
          credit: req.body.round_value,
          module_used: vbt_key,
          insert_date: insert_data,
          which_module: "VBT09",
          effective_date: effective_data,
          insert_by: insert_by,
        };
      }

      let inset_round_gl = await tallyDB.query("Insert INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, 	insert_by)VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
        replacements: repl,
        type: tallyDB.QueryTypes.UPDATE,
        transaction: transaction,
      });
    }

    await transaction.commit();
    await transactioninvt.commit();
    return res.json({ success:true, status: "success", message: "Insertion Successfull" });
  } catch (error) {
    await transaction.rollback();
    await transactioninvt.rollback();
    return res.json({ success:false, status: "error", message:"Internal Error<br/>If this condition persists, contact your system administrator", err: error.stack });
  }
});

router.get("/vbt09_gl_options", async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT `vbt_group_key` FROM `vbt_module` WHERE `vbt_module`='vbt09'", {
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      let str_gl_keys = stmt[0].vbt_group_key;
      let gl_key_arr = str_gl_keys.split(",");
      if (gl_key_arr.length > 0) {
        let options = [];
        for (let i = 0; i < gl_key_arr.length; i++) {
          let stmt1 = await tallyDB.query("SELECT ledger_key, ladger_name, code FROM `tally_ledger` WHERE `sub_group_key`=:key", {
            replacements: { key: gl_key_arr[i] },
            type: tallyDB.QueryTypes.SELECT,
          });
          if (stmt1.length > 0) {
            for (let j = 0; j < stmt1.length; j++) {
              options.push({ id: stmt1[j].ledger_key, text: `${stmt1[j].ladger_name} (${stmt1[j].code})` });
            }
          }
        }
        return res.json(options);
      }
    } else {
      return res.json({ success:false, status: "error", message: "No G/L Mapping Found!!" });
    }
  } catch (err) {
    return res.json({ success:false, status: "error", message: "Internal Error<br/>If this condition persists, contact your system administrator", err: err.stack });
  }
});


module.exports = router;
const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");

const Validator = require("validatorjs");

// VBT01 // PURCHASE GOODS
// FETCH VBT
// router.post("/fetch_vbt01", [auth.isAuthorized], async (req, res) => {
//   let validation = new Validator(req.body, {
//     wise: "required",
//     data: "required",
//   });

//   if (validation.fails()) {
//     res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
//   }

//   try {
//     const { wise, data } = req.body;

//     let main_stmt;

//     if (wise == "date_wise") {
//       const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
//       const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
//       const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

//       main_stmt = await invtDB.query(
//         "SELECT rm_location.backend_remark AS remark,`rm_location`.`insert_date` AS `min_in_date`, `rm_location`.`in_transaction_id` AS `min_transaction`, rm_location.vbp_status, `components`.`c_part_no` AS `part_code`, `rm_location`.`in_vendor_name` AS `ven_code`, `ven_basic_detail`.`ven_name` FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id=components.component_key LEFT JOIN `ven_basic_detail` ON  rm_location.in_vendor_name=ven_basic_detail.ven_register_id  WHERE `trans_type`='INWARD' AND DATE_FORMAT(rm_location.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND (`rm_location`.`vendor_type` = 'v01' ) AND `vbp_status` IN ('N', 'NOTELIGIBLE') ORDER BY `rm_location`.`ID` DESC",
//         {
//           replacements: { date1: date1, date2: date2 },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );
//     } else if (wise == "vendor_wise") {
//       main_stmt = await invtDB.query(
//         "SELECT rm_location.backend_remark AS remark,`rm_location`.`insert_date` AS `min_in_date`, `rm_location`.`in_transaction_id` AS `min_transaction`, rm_location.vbp_status, `components`.`c_part_no` AS `part_code`, `rm_location`.`in_vendor_name` AS `ven_code`, `ven_basic_detail`.`ven_name` FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id=components.component_key LEFT JOIN `ven_basic_detail` ON  rm_location.in_vendor_name=ven_basic_detail.ven_register_id  WHERE `trans_type`='INWARD' AND `in_vendor_name` = :ven AND (`rm_location`.`vendor_type` = 'v01') AND `vbp_status` IN ('N', 'NOTELIGIBLE')GROUP BY `rm_location`.`in_transaction_id` ORDER BY rm_location.ID",
//         {
//           replacements: { ven: data },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );
//     } else if (wise == "min_wise") {
//       main_stmt = await invtDB.query(
//         "SELECT rm_location.backend_remark AS remark,`rm_location`.`insert_date` AS `min_in_date`, `rm_location`.`in_transaction_id` AS `min_transaction`, rm_location.vbp_status, `components`.`c_part_no` AS `part_code`, `rm_location`.`in_vendor_name` AS `ven_code`, `ven_basic_detail`.`ven_name` FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id=components.component_key LEFT JOIN `ven_basic_detail` ON  rm_location.in_vendor_name=ven_basic_detail.ven_register_id  WHERE `trans_type`='INWARD' AND `in_transaction_id` LIKE :min AND (`rm_location`.`vendor_type` = 'v01') AND `vbp_status` IN ('N', 'NOTELIGIBLE') ORDER BY rm_location.ID",
//         {
//           replacements: { min: `%${data}%` },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );
//     }

//     let final = [];

//     if (main_stmt.length > 0) {
//       let pending = [];
//       let nonPending = [];

//       for (let i = 0; i < main_stmt.length; i++) {
//         main_stmt[i].remark = main_stmt[i].remark === '' ? 'NA' : "VBP has disabled for further process with remark by user - " + main_stmt[i].remark;
//         main_stmt[i].vbp_status = main_stmt[i].vbp_status === 'N' ? 'PENDING' : main_stmt[i].vbp_status === 'NOTELIGIBLE' ? 'DISABLED' : 'PROCESSED';
//         main_stmt[i].min_in_date = moment(main_stmt[i].min_in_date, "YYYY-MM-DD HH:mm:ss").format("DD/MM/YYYY");

//         if (main_stmt[i].vbp_status === 'PENDING') {
//           pending.push(main_stmt[i]);
//         } else {
//           nonPending.push(main_stmt[i]);
//         }
//       }

//       return res.json({ status: "success", success: true, data: pending, disable: nonPending });

//     } else {
//       return res.json({ status: "success", success: true, data: [], disable: [] });
//     }
//   } catch (err) {
//       return helper.errorResponse(res, err);
//   }
// });
router.post("/fetch_vbt01", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
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
         CASE components.c_type
            WHEN 'R' THEN 'RAW'
            WHEN 'S' THEN 'SER'
            ELSE '--'
          END AS type,
          rm_location.backend_remark AS remark,
          rm_location.insert_date AS minDate,
          rm_location.in_transaction_id AS transaction,
          rm_location.vbp_status AS vbpStatus,
          components.c_part_no AS itemCode,
          rm_location.in_vendor_name AS venCode,
          ven_basic_detail.ven_name AS venName
      FROM rm_location
      LEFT JOIN components 
          ON rm_location.components_id = components.component_key
      LEFT JOIN ven_basic_detail 
          ON rm_location.in_vendor_name = ven_basic_detail.ven_register_id
      WHERE rm_location.trans_type = 'INWARD'
      AND DATE_FORMAT(rm_location.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2
      AND rm_location.vendor_type = 'v01'
      AND rm_location.vbp_status IN ('N','NOTELIGIBLE')

      UNION ALL

      SELECT 
        'FG' AS type,
          mfg_production_3.fg_out_remark AS remark,
          mfg_production_3.mfg_pro_apr_fulldate AS minDate,
          mfg_production_3.mfg_pro_apr_transaction AS transaction,
          mfg_production_3.vbp_status AS vbpStatus,
          products.p_sku AS itemCode,
          mfg_production_3.in_vendor_name AS venCode,
          ven_basic_detail.ven_name AS venName
      FROM mfg_production_3
      LEFT JOIN products 
          ON mfg_production_3.mfg_pro_apr_sku = products.p_sku
      LEFT JOIN ven_basic_detail 
          ON mfg_production_3.in_vendor_name = ven_basic_detail.ven_register_id
      WHERE mfg_production_3.type = 'FGMIN'
      AND DATE_FORMAT(mfg_production_3.mfg_pro_apr_fulldate,'%Y-%m-%d') BETWEEN :date1 AND :date2
      AND mfg_production_3.vendor_type = 'v01' AND mfg_production_3.vbp_status IN ('N','NOTELIGIBLE')

      ORDER BY minDate DESC`,
        {
          replacements: { date1: date1, date2: date2 },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "vendor_wise") {
      main_stmt = await invtDB.query(
        `SELECT 
          CASE components.c_type
            WHEN 'R' THEN 'RAW'
            WHEN 'S' THEN 'SER'
            ELSE '--'
          END AS type,
            rm_location.backend_remark AS remark,
            rm_location.insert_date AS minDate,
            rm_location.in_transaction_id AS transaction,
            rm_location.vbp_status AS vbpStatus,
            components.c_part_no AS itemCode,
            rm_location.in_vendor_name AS venCode,
            ven_basic_detail.ven_name AS venName
        FROM rm_location
        LEFT JOIN components 
            ON rm_location.components_id = components.component_key
        LEFT JOIN ven_basic_detail 
            ON rm_location.in_vendor_name = ven_basic_detail.ven_register_id
        WHERE rm_location.trans_type = 'INWARD'
        AND rm_location.in_vendor_name = :ven
        AND rm_location.vendor_type = 'v01'
        AND rm_location.vbp_status IN ('N','NOTELIGIBLE')

        UNION ALL

        SELECT 
          'FG' AS type,
            mfg_production_3.fg_out_remark AS remark,
            mfg_production_3.mfg_pro_apr_fulldate AS minDate,
            mfg_production_3.mfg_pro_apr_transaction AS transaction,
            mfg_production_3.vbp_status AS vbpStatus,
            products.p_sku AS itemCode,
            mfg_production_3.in_vendor_name AS venCode,
            ven_basic_detail.ven_name AS venName
        FROM mfg_production_3
        LEFT JOIN products 
            ON mfg_production_3.mfg_pro_apr_sku = products.p_sku
        LEFT JOIN ven_basic_detail 
            ON mfg_production_3.in_vendor_name = ven_basic_detail.ven_register_id
        WHERE mfg_production_3.type = 'FGMIN'
        AND mfg_production_3.in_vendor_name = :ven
        AND mfg_production_3.vendor_type = 'v01'
        AND mfg_production_3.vbp_status IN ('N','NOTELIGIBLE')

        ORDER BY minDate DESC`,
        {
          replacements: { ven: data },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "min_wise") {
      main_stmt = await invtDB.query(
        `SELECT 
          CASE components.c_type
            WHEN 'R' THEN 'RAW'
            WHEN 'S' THEN 'SER'
            ELSE '--'
          END AS type,
            rm_location.backend_remark AS remark,
            rm_location.insert_date AS minDate,
            rm_location.in_transaction_id AS transaction,
            rm_location.vbp_status AS vbpStatus,
            components.c_part_no AS itemCode,
            rm_location.in_vendor_name AS venCode,
            ven_basic_detail.ven_name AS venName
        FROM rm_location
        LEFT JOIN components 
            ON rm_location.components_id = components.component_key
        LEFT JOIN ven_basic_detail 
            ON rm_location.in_vendor_name = ven_basic_detail.ven_register_id
        WHERE rm_location.trans_type = 'INWARD'
        AND rm_location.in_transaction_id LIKE :min
        AND rm_location.vendor_type = 'v01'
        AND rm_location.vbp_status IN ('N','NOTELIGIBLE')

        UNION ALL

        SELECT 
          'FG' AS type,
            mfg_production_3.fg_out_remark AS remark,
            mfg_production_3.mfg_pro_apr_fulldate AS minDate,
            mfg_production_3.mfg_pro_apr_transaction AS transaction,
            mfg_production_3.vbp_status AS vbpStatus,
            products.p_sku AS itemCode,
            mfg_production_3.in_vendor_name AS venCode,
            ven_basic_detail.ven_name AS venName
        FROM mfg_production_3
        LEFT JOIN products 
            ON mfg_production_3.mfg_pro_apr_sku = products.p_sku
        LEFT JOIN ven_basic_detail 
            ON mfg_production_3.in_vendor_name = ven_basic_detail.ven_register_id
        WHERE mfg_production_3.type = 'FGMIN'
        AND mfg_production_3.mfg_pro_apr_transaction LIKE :min
        AND mfg_production_3.vendor_type = 'v01'
        AND mfg_production_3.vbp_status IN ('N','NOTELIGIBLE')

        ORDER BY minDate DESC`,
        {
          replacements: { min: `%${data}%` },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    }

    if (main_stmt.length > 0) {
      let pending = [];
      let nonPending = [];

      for (let i = 0; i < main_stmt.length; i++) {
        main_stmt[i].remark =
          main_stmt[i].remark === ""
            ? "NA"
            : "VBP has disabled for further process with remark by user - " +
              main_stmt[i].remark;
        main_stmt[i].vbpStatus =
          main_stmt[i].vbpStatus === "N"
            ? "PENDING"
            : main_stmt[i].vbpStatus === "NOTELIGIBLE"
              ? "DISABLED"
              : "PROCESSED";
        main_stmt[i].minDate = moment(
          main_stmt[i].minDate,
          "YYYY-MM-DD HH:mm:ss",
        ).format("DD/MM/YYYY");

        if (main_stmt[i].vbpStatus === "PENDING") {
          pending.push(main_stmt[i]);
        } else {
          nonPending.push(main_stmt[i]);
        }
      }

      return res.json({
        success: true,
        status: "success",
        data: pending,
        disable: nonPending,
      });
    } else {
      return res.json({
        success: true,
        status: "success",
        data: [],
        disable: [],
      });
    }
  } catch (err) {
    return helper.errorResponse(res, error);
  }
});

// Fetch MIN DATA (SINGLE MIN NO)
router.post("/fetch_minData", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    min_id: "required",
  });

  if (validation.fails()) {
    res.json({
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
      success: false,
    });
  }

  try {
    let main_stmt = await invtDB.query(
      "SELECT `c_part_no`, `c_name`, `qty`, `in_po_rate`, `in_hsn_code`, `in_gst_type`, `in_gst_rate`, `in_gst_cgst`, `in_gst_sgst`, `in_gst_igst`,`in_vendor_name`,`in_vendor_addr`,`in_invoice_id`,`in_po_invoice_id`,`in_jw_invoice_id`,`ven_basic_detail`.`ven_tds`,`ven_basic_detail`.`ven_name`,`units_name`,`in_po_transaction_id` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom`=`units`.`units_id` LEFT JOIN `ven_basic_detail` ON `rm_location`.`in_vendor_name`=`ven_basic_detail`.`ven_register_id`  WHERE `in_transaction_id` = :min_id AND `rm_location`.`trans_type` = 'INWARD' ",
      {
        replacements: { min_id: req.body.min_id },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (main_stmt.length > 0) {
      let final_data = [];
      for (let i = 0; i < main_stmt.length; i++) {
        // GST
        // let gst_type;
        // if (main_stmt[i].in_gst_type == "I") {
        //   gst_type = "Inter State";
        // } else if (main_stmt[i].in_gst_type == "L") {
        //   gst_type = "Local";
        // } else {
        //   gst_type = main_stmt[i].in_gst_type;
        // }

        // GST VENDOR
        let gstIn_stmt = await invtDB.query(
          "SELECT `ven_add_gst` FROM `ven_address_detail` WHERE `ven_id` = :ven_id",
          {
            replacements: { ven_id: main_stmt[i].in_vendor_name },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        // GST IN NO
        let gstin_option = [];
        if (gstIn_stmt.length > 0) {
          gstIn_stmt.map((item) => {
            gstin_option.push(item.ven_add_gst);
          });
        }

        let invoice;
        if (main_stmt[i].in_invoice_id != "--") {
          invoice = main_stmt[i].in_invoice_id;
        } else if (main_stmt[i].in_po_invoice_id != "--") {
          invoice = main_stmt[i].in_po_invoice_id;
        } else if (main_stmt[i].in_jw_invoice_id != "--") {
          invoice = main_stmt[i].in_jw_invoice_id;
        }

        let tds_option = [];
        if (main_stmt[i].ven_tds != null && main_stmt[i].ven_tds != "--") {
          let tds_keys = main_stmt[i].ven_tds.split(",");
          for (let k = 0; k < tds_keys.length; k++) {
            let tds_data = await tallyDB.query(
              "SELECT tds_name, tds_percent, tds_key, tds_code, tds_gl_code, ladger_name, ledger_key FROM `tally_tds` LEFT JOIN `tally_ledger` ON `tally_tds`.`tds_gl_code`= `tally_ledger`.`ledger_key`  WHERE `tds_key`=:key",
              {
                replacements: { key: tds_keys[k] },
                type: tallyDB.QueryTypes.SELECT,
              },
            );

            if (tds_data.length > 0) {
              for (let j = 0; j < tds_data.length; j++) {
                tds_option.push(tds_data[j]);
              }
            }
          }
        }
        // END TDS OPTIONS

        let vendor_address = [];
        if (main_stmt[i].in_po_transaction_id != "--") {
          let ven_add_stmt = await invtDB.query(
            "SELECT `po_vendor_address` FROM `po_purchase_req` WHERE `po_transaction` = :po_transaction_id",
            {
              replacements: {
                po_transaction_id: main_stmt[i].in_po_transaction_id,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );
          if (ven_add_stmt.length > 0) {
            vendor_address = ven_add_stmt[0].po_vendor_address;
          }
        } else {
          vendor_address = main_stmt[i].in_vendor_addr;
        }
        // END VENDOR ADDRESS

        final_data.push({
          min_id: req.body.min_id,
          c_part_no: main_stmt[i].c_part_no,
          c_name: main_stmt[i].c_name,
          qty: main_stmt[i].qty,
          in_po_rate: main_stmt[i].in_po_rate,
          value: (
            Number(main_stmt[i].in_po_rate) * Number(main_stmt[i].qty)
          ).toFixed(2),
          in_hsn_code: main_stmt[i].in_hsn_code,
          in_gst_type: main_stmt[i].in_gst_type,
          in_gst_rate: main_stmt[i].in_gst_rate,
          in_gst_cgst: main_stmt[i].in_gst_cgst,
          in_gst_sgst: main_stmt[i].in_gst_sgst,
          in_gst_igst: main_stmt[i].in_gst_igst,
          ven_tds: tds_option,
          ven_code: main_stmt[i].in_vendor_name,
          invoice_id: invoice,
          in_vendor_addr: vendor_address,
          ven_name: main_stmt[i].ven_name,
          comp_unit: main_stmt[i].units_name,
          gstin_option: gstin_option,
        });

        if (final_data.length == main_stmt.length) {
          return res.json({
            status: "success",
            success: true,
            data: final_data,
          });
        }
      } //End For Loop
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No data Found",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// Aman optimized: singldfe batch query + batch lookups for RAW/FG)
router.post("/fetch_multi_min_data", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, { data: "required" });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.errors.all() });
  }

  const data = req.body.data;

  try {
    const final_data = [];

    for (const item of data) {
      let main_stmt = [];

      // FG QUERY
      if (item.type === "FG") {
        main_stmt = await invtDB.query(
          `
        SELECT 
        p_sku AS itemCode,
        p_name AS itemName,
        mfg_approve_in_qty AS qty,
        in_fg_rate AS rate,
        fg_hsn_code AS hsnCode,
        fg_gst_type AS gstType,
        fg_gst_rate AS gstRate,
        fg_cgst AS cgst,
        fg_sgst AS sgst,
        fg_igst AS igst,
        in_vendor_name AS venCode,
        in_vendor_addr AS vendorAddress,
        in_fg_invoice_id AS invoiceId,
        '--' AS poInvoiceId,
        '--' AS jwInvoiceId,
        ven_basic_detail.ven_tds AS tds,
        ven_basic_detail.ven_name AS venName,
        units_name AS uom,
        mfg_pro_apr_transaction AS transaction,
        '--' AS acknowledgeIRN
        FROM mfg_production_3
        LEFT JOIN products ON mfg_production_3.mfg_pro_apr_sku = products.p_sku
        LEFT JOIN units ON products.p_uom = units.units_id
        LEFT JOIN ven_basic_detail ON mfg_production_3.in_vendor_name = ven_basic_detail.ven_register_id
        WHERE mfg_pro_apr_transaction = :min_id
        AND type = 'FGMIN'
        AND vendor_type = 'v01'
        AND vbp_status IN ('N','NOTELIGIBLE')
        `,
          {
            replacements: { min_id: item.minTxn },
            type: invtDB.QueryTypes.SELECT,
          },
        );
      }

      // RAW QUERY
      if (item.type === "RAW" || item.type === "SER") {

        main_stmt = await invtDB.query(
          `
        SELECT 
        c_part_no AS itemCode,
        c_name AS itemName,
        qty,
        in_po_rate AS rate,
        in_hsn_code AS hsnCode,
        in_gst_type AS gstType,
        in_gst_rate AS gstRate,
        in_gst_cgst AS cgst,
        in_gst_sgst AS sgst,
        in_gst_igst AS igst,
        in_vendor_name AS venCode,
        in_vendor_addr AS vendorAddress,
        in_invoice_id AS invoiceId,
        in_po_invoice_id AS poInvoiceId,
        in_jw_invoice_id AS jwInvoiceId,
        ven_basic_detail.ven_tds AS tds,
        ven_basic_detail.ven_name AS venName,
        units_name AS uom,
        in_transaction_id AS transaction,
        ackwlg_irn AS acknowledgeIRN
        FROM rm_location
        LEFT JOIN components ON rm_location.components_id = components.component_key
        LEFT JOIN units ON components.c_uom = units.units_id
        LEFT JOIN ven_basic_detail ON rm_location.in_vendor_name = ven_basic_detail.ven_register_id
        WHERE in_transaction_id = :min_id
        AND trans_type = 'INWARD' AND rm_location.vbp_status IN ('N','NOTELIGIBLE')
        `,
          {
            replacements: { min_id: item.minTxn },
            type: invtDB.QueryTypes.SELECT,
          },
        );
      }

      if (!main_stmt.length) {
        return res.json({ status: "error", success: false, message: "No data Found" });
      }

      for (const row of main_stmt) {
        // GSTIN
        const gstIn_stmt = await invtDB.query(
          "SELECT ven_add_gst FROM ven_address_detail WHERE ven_id = :ven_id",
          {
            replacements: { ven_id: row.venCode },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        const gstin_option = gstIn_stmt.map((v) => v.ven_add_gst);

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
            SELECT tds_name,tds_percent,tds_key,tds_code,tds_gl_code,
            ladger_name,ledger_key
            FROM tally_tds
            LEFT JOIN tally_ledger 
            ON tally_tds.tds_gl_code = tally_ledger.ledger_key
            WHERE tds_key = :key`,
              {
                replacements: { key },
                type: tallyDB.QueryTypes.SELECT,
              },
            );

            tds_option.push(...tds_data);
          }
        }

        // VENDOR ADDRESS
        let vendor_address = row.vendorAddress;

        if (item.type === "RAW") {
          const ven_add_stmt = await invtDB.query(
            "SELECT po_vendor_address FROM po_purchase_req WHERE po_transaction = :id",
            {
              replacements: { id: row.transaction },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          if (ven_add_stmt.length) {
            vendor_address = ven_add_stmt[0].po_vendor_address;
          }
        }

        final_data.push({
          transaction: row.transaction,
          itemCode: row.itemCode,
          itemName: row.itemName,
          qty: row.qty,
          rate: row.rate,
          value: (Number(row.rate) * Number(row.qty)).toFixed(2),
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
        });
      }
    }

    return res.json({ status: "success", data: final_data, message: "Data fetched successfully", success: true });
  } catch (error) {
    return res.json({ status: "error", success: false, message: "an error occurred while process your request" });
  }
});

// ADD VBT01
// router.post("/add_vbt01", [auth.isAuthorized], async (req, res) => {
//   let validation = new Validator(req.body, {
//     ven_code: "required",
//     ven_address: "required",
//     invoice_no: "required",
//     invoice_date: "required",
//     comment: "required",
//     vbt_gstin: "required",
//     invoice_no: "required",
//     bill_amount: "required",
//     inrPrice: "required",
//     cifPrice: "required",
//     cifValue: "required",
//     eff_date: "required"
//   });

//   if (validation.fails()) {
//     return res.json({

//       status: "error", success: false,
//       message: validation.errors.all(),
//     });
//   }

//   const transaction = await tallyDB.transaction();
//   const transactioninvt = await invtDB.transaction();

//   try {
//     if (moment(req.body.invoice_date, "DD-MM-YYYY") > moment(req.body.eff_date, "DD-MM-YYYY")) {
//       return res.json({ status: "error", success: false, message: "effective date must be greater than invoice date" });
//     }
//     let comp_length = req.body.component.length;
//     let total_debit = 0;
//     let total_credit = 0;

//     for (let i = 0; i < comp_length; i++) {
//       let row_valid = new Validator(
//         {
//           cgst_gl: req.body.cgst_gl[i],
//           sgst_gl: req.body.sgst_gl[i],
//           igst_gl: req.body.igst_gl[i],
//         },
//         {
//           cgst_gl: "required",
//           sgst_gl: "required",
//           igst_gl: "required",
//         }
//       );
//       if (row_valid.fails()) {
//         return res.json({ message: row_valid.errors.all(), status: "error", success: false });
//       }

//       total_debit += Number(req.body.cgsts[i]) + Number(req.body.igsts[i]) + Number(req.body.sgsts[i]) + Number(req.body.freight[i]) + Number(req.body.bill_qty[i]) * Number(req.body.in_rates[i]);

//       total_credit += Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]);
//     }

//     if (req.body.round_type == "-") {
//       total_debit -= Number(req.body.round_value);
//     } else {
//       total_debit += Number(req.body.round_value);
//     }

//     let total_ven_ammount = 0;
//     for (let i = 0; i < comp_length; i++) {
//       total_ven_ammount += (Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]));
//     }

//     if (Math.abs(Number(req.body.bill_amount) - Number(total_ven_ammount).toFixed(2)) != 0) {
//       return res.json({ status: "error", success: false, message: "Bill amount ${req.body.bill_amount} and Vendor amount ${total_ven_ammount} not match " });
//     }

//     if (Math.abs(Number(Number(total_credit).toFixed(2)) - Number(Number(total_debit).toFixed(2))) != 0) {
//       return res.json({
//         status: "error", success: false,
//         message: `Debit(${Number(total_debit).toFixed(2)}) And Credit Value(${Number(total_credit).toFixed(2)}) not matched`,
//       });
//     }

//     // NUMBURING FUN
//     let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'VBT01' FOR UPDATE", {
//       type: tallyDB.QueryTypes.SELECT,
//       transaction: transaction,
//     });
//     var vbt_no;
//     if (stmt_number.length > 0) {
//       var suffix = stmt_number[0].suffix;
//       suffix = parseInt(suffix) + 1;
//       suffix = suffix.toString();
//       suffix = suffix.padStart(parseInt(stmt_number[0].number_length_limit), "0");

//       vbt_no = stmt_number[0].prefix + "/" + stmt_number[0].session + "/" + suffix;
//     } else {
//       let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
//       vbt_no = "VBT01/" + currYear + "-" + (currYear + 1) + "/0001";
//     }
//     // END NUMBURING FUN

//     await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'VBT01'", {
//       type: tallyDB.QueryTypes.UPDATE,
//       transaction: transaction,
//     });

//     const vbt_key = vbt_no;
//     const insert_data = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
//     const effective_data = moment(req.body.eff_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD");
//     const insert_by = req.logedINUser;

//     let lastInsertedID;

//     for (let i = 0; i < comp_length; i++) {

//       let comp_key = await invtDB.query("SELECT component_key FROM components WHERE c_part_no= :p_no", {
//         replacements: { p_no: req.body.part_code[i] },
//         type: invtDB.QueryTypes.SELECT,
//       });

//       let stmt_check_min = await invtDB.query("SELECT ID FROM `rm_location` WHERE  `in_transaction_id` = :min AND `components_id`= :comp AND `vbp_status` = 'Y' ", {
//         replacements: {
//           min: req.body.min_key[i],
//           comp: comp_key[0].component_key,
//         },
//         type: invtDB.QueryTypes.SELECT,
//       });

//       if (stmt_check_min.length > 0) {
//         await transaction.rollback();
//         await transactioninvt.rollback();
//         return res.json({ status: "error", success: false, message: "${req.body.min_key[i]} already created!!!" });
//       }

//       let findProject = await invtDB.query("SELECT in_po_transaction_id, po_project_name FROM rm_location LEFT JOIN po_purchase_req ON po_purchase_req.po_transaction = rm_location.in_po_transaction_id WHERE in_transaction_id = :min GROUP BY in_transaction_id", {
//         replacements: {
//           min: req.body.min_key[i],
//         },
//         type: invtDB.QueryTypes.SELECT,
//       });

//       if (findProject.length <= 0) {
//         return res.json({ status: 'error', message: 'error while getting project id and number.' })
//       }

//       let stmt = await tallyDB.query(
//         "INSERT INTO `tally_vbt` ( `part_code`,po_number, project_id, `vbt_inqty`,`vbt_bill_qty`, `vbt_inrate`, `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `freight`, `vbt_freight_gl`, `vbp_gst_ass_value`, `vbt_cgst`,`vbt_cgst_gl`, `vbt_sgst`,`vbt_sgst_gl`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `tds_code`, `tds_gl`, `vbt_ven_ammount`, `vbt_key`, `insert_by`, `insert_date`, `min_id` , inrPrice , cifPrice , cifValue , `vbt_tds_ass_val`,`vbt_tds_amount`, `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `item_description` , billAmount ) VALUES (:part_code, :po_number, :project_id, :in_qtys, :vbt_bill_qty, :in_rates, :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate,  :freight, :freight_gl, :gst_ass_vals, :cgsts, :cgsts_gl, :sgsts, :sgsts_gl, :igsts, :igsts_gl, :g_l_codes, :tds_codes, :tds_gl, :ven_amounts, :vbt_key, :insert_by, :insert_date, :min_id, :inrPrice, :cifPrice, :cifValue, :tds_ass_vals, :tds_amounts,:ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT01' , :effective_date , :item_description , :billAmount )",
//         {
//           replacements: {
//             po_number: findProject[0].in_po_transaction_id ? findProject[0].in_po_transaction_id : "--",
//             project_id: findProject[0].po_project_name ? findProject[0].po_project_name : "--",
//             vbt_key: vbt_key,
//             in_qtys: req.body.in_qtys[i],
//             vbt_bill_qty: req.body.bill_qty[i],
//             in_rates: req.body.in_rates[i],
//             taxable_values: req.body.taxable_values[i],
//             part_code: comp_key[0].component_key,
//             hsn_code: req.body.hsn_code[i],
//             in_gst_types: req.body.in_gst_types[i],
//             freight: req.body.freight[i],
//             freight_gl: "TP550175734290",
//             gst_ass_vals: req.body.gst_ass_vals[i],
//             cgsts: req.body.cgsts[i],
//             // cgsts_gl: "TP274965899340",
//             cgsts_gl: req.body.cgst_gl[i],
//             sgsts: req.body.sgsts[i],
//             // sgsts_gl: "TP385675494002",
//             sgsts_gl: req.body.sgst_gl[i],
//             igsts: req.body.igsts[i],
//             // igsts_gl: "TP486973272469",
//             igsts_gl: req.body.igst_gl[i],
//             g_l_codes: req.body.g_l_codes[i],
//             tds_codes: req.body.tds_codes[i],
//             tds_gl: req.body.tds_gl_code[i],
//             tds_ass_vals: req.body.tds_ass_vals[i],
//             tds_amounts: req.body.tds_amounts[i],
//             ven_amounts: req.body.ven_amounts[i],
//             vbt_gst_rate: req.body.vbp_gst_rate[i],
//             insert_by: req.logedINUser,
//             insert_date: insert_data,
//             min_id: req.body.min_key[i],
//             inrPrice: req.body.inrPrice[i],
//             cifPrice: req.body.cifPrice[i],
//             cifValue: req.body.cifValue[i],
//             // Header
//             ven_address: req.body.ven_address,
//             invoice_no: req.body.invoice_no,
//             invoice_date: req.body.invoice_date,
//             comment: req.body.comment,
//             ven_code: req.body.ven_code,
//             vbt_gstin: req.body.vbt_gstin,
//             effective_date: effective_data,
//             item_description: req.body.item_description?.[i] ? req.body.item_description[i] : "",
//             billAmount: req.body.bill_amount,
//           },
//           type: tallyDB.QueryTypes.INSERT,
//           transaction: transaction,
//         }
//       ); //End Insert VBT

//       lastInsertedID = stmt[0];

//       if (Number(req.body.cgsts[i]) > 0) {
//         let insert_cgst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
//           replacements: {
//             // ladger_key: "TP274965899340",
//             ladger_key: req.body.cgst_gl[i],
//             debit: req.body.cgsts[i],
//             credit: "0",
//             module_used: vbt_key,
//             insert_date: insert_data,
//             which_module: "VBT01",
//             effective_date: effective_data,
//             insert_by: insert_by,
//           },
//           type: tallyDB.QueryTypes.INSERT,
//           transaction: transaction,
//         });
//       }
//       if (Number(req.body.igsts[i]) > 0) {
//         let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
//           replacements: {
//             // ladger_key: "TP486973272469",
//             ladger_key: req.body.igst_gl[i],
//             debit: req.body.igsts[i],
//             credit: "0",
//             module_used: vbt_key,
//             insert_date: insert_data,
//             which_module: "VBT01",
//             effective_date: effective_data,
//             insert_by: insert_by,
//           },
//           type: tallyDB.QueryTypes.INSERT,
//           transaction: transaction,
//         });
//       }
//       if (Number(req.body.sgsts[i]) > 0) {
//         let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
//           replacements: {
//             // ladger_key: "TP385675494002",
//             ladger_key: req.body.sgst_gl[i],
//             debit: req.body.sgsts[i],
//             credit: "0",
//             module_used: vbt_key,
//             insert_date: insert_data,
//             which_module: "VBT01",
//             effective_date: effective_data,
//             insert_by: insert_by,
//           },
//           type: tallyDB.QueryTypes.INSERT,
//           transaction: transaction,
//         });
//       }
//       if (Number(req.body.freight[i]) > 0) {
//         let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
//           replacements: {
//             ladger_key: "TP550175734290",
//             debit: req.body.freight[i],
//             credit: "0",
//             module_used: vbt_key,
//             insert_date: insert_data,
//             which_module: "VBT01",
//             effective_date: effective_data,
//             insert_by: insert_by,
//           },
//           type: tallyDB.QueryTypes.INSERT,
//           transaction: transaction,
//         });
//       }
//       // GL
//       if (Number(req.body.taxable_values[i]) > 0) {
//         if (req.body.g_l_codes[i] == "--") {
//           await transaction.rollback();
//           await transactioninvt.rollback();
//           return res.json({ status: "error", success: false, message: "Something wrong!!! (GL OPTION) " });
//         }
//         let insert_gst_ass_vals = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
//           replacements: {
//             ladger_key: req.body.g_l_codes[i],
//             debit: req.body.taxable_values[i],
//             credit: "0",
//             module_used: vbt_key,
//             insert_date: insert_data,
//             which_module: "VBT01",
//             effective_date: effective_data,
//             insert_by: insert_by,
//           },
//           type: tallyDB.QueryTypes.INSERT,
//           transaction: transaction,
//         });
//       }
//       if (req.body.tds_amounts[i] != 0) {
//         if (req.body.tds_gl_code[i] == "--") {
//           await transaction.rollback();
//           await transactioninvt.rollback();
//           return res.json({ status: "error", success: false, message: "Something wrong!!! (TDS OPTION) " });
//         }

//         let insert_tds_gl_code = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
//           replacements: {
//             ladger_key: req.body.tds_gl_code[i],
//             debit: "0",
//             credit: req.body.tds_amounts[i],
//             module_used: vbt_key,
//             insert_date: insert_data,
//             which_module: "VBT01",
//             effective_date: effective_data,
//             insert_by: insert_by,
//           },
//           type: tallyDB.QueryTypes.INSERT,
//           transaction: transaction,
//         });
//       }
//       // VENDOR
//       let insert_ven_gl = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
//         replacements: {
//           ladger_key: req.body.ven_code,
//           debit: "0",
//           credit: req.body.ven_amounts[i],
//           module_used: vbt_key,
//           insert_date: insert_data,
//           which_module: "VBT01",
//           effective_date: effective_data,
//           insert_by: insert_by,
//         },
//         type: tallyDB.QueryTypes.INSERT,
//         transaction: transaction,
//       });

//       //   UPDATE MIN STATUS
//       let update_stmt = await invtDB.query("UPDATE `rm_location` SET `vbp_status` = 'Y' WHERE  `in_transaction_id` = :min AND `components_id`= :comp", {
//         replacements: {
//           min: req.body.min_key[i],
//           comp: comp_key[0].component_key,
//         },
//         type: invtDB.QueryTypes.UPDATE,
//         transaction: transactioninvt,
//       });
//     } //END FOR LOOP

//     if (lastInsertedID) {
//       await tallyDB.query("UPDATE tally_vbt SET round_off_sign = :round_off_sign , round_off_amt = :round_off_amt , round_off_gl = :round_off_gl WHERE ID = :id", {
//         replacements: {
//           id: lastInsertedID,
//           round_off_sign: req.body.round_type ?? "--",
//           round_off_amt: req.body.round_value ?? "",
//           round_off_gl: "TP558350023869",
//         },
//         type: tallyDB.QueryTypes.UPDATE,
//         transaction: transaction
//       })
//     }

//     if (req.body.round_value != 0) {
//       let repl;
//       if (req.body.round_type == "+") {
//         repl = {
//           ladger_key: "TP558350023869",
//           debit: req.body.round_value,
//           credit: "0",
//           module_used: vbt_key,
//           insert_date: insert_data,
//           which_module: "VBT01",
//           effective_date: effective_data,
//           insert_by: insert_by,
//         };
//       }
//       if (req.body.round_type == "-") {
//         repl = {
//           ladger_key: "TP558350023869",
//           debit: "0",
//           credit: req.body.round_value,
//           module_used: vbt_key,
//           insert_date: insert_data,
//           which_module: "VBT01",
//           effective_date: effective_data,
//           insert_by: insert_by,
//         };
//       }

//       let inset_round_gl = await tallyDB.query("Insert INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, 	insert_by)VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
//         replacements: repl,
//         type: tallyDB.QueryTypes.UPDATE,
//         transaction: transaction,
//       });
//     }

//     await transaction.commit();
//     await transactioninvt.commit();
//     return res.json({ status: "success", success: true, message: "Insertion Successfull" });
//   } catch (error) {
//       return helper.errorResponse(res, error);
//   }
// });
router.post("/add_vbt01", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    ven_code: "required",
    ven_address: "required",
    invoice_no: "required",
    invoice_date: "required",
    comment: "required",
    vbt_gstin: "required",
    bill_amount: "required",
    inrPrice: "required",
    cifPrice: "required",
    cifValue: "required",
    eff_date: "required",
  });

  if (validation.fails()) {
    return res.json({
      code: 500,
      status: "error",
      message: validation.errors.all(),
    });
  }

  const queryType = req.query.type;

  if (
    !queryType ||
    (queryType !== "FG" && queryType !== "RAW" && queryType !== "SER")
  ) {
    return res.json({
      success: false,
      status: "error",
      message: "Invalid type",
    });
  }

  const transaction = await tallyDB.transaction();
  const transactioninvt = await invtDB.transaction();

  const insert_data = moment(new Date())
    .tz("Asia/Kolkata")
    .format("YYYY-MM-DD HH:mm:ss");
  const effective_data = moment(req.body.eff_date, "DD-MM-YYYY")
    .tz("Asia/Kolkata")
    .format("YYYY-MM-DD");
  const insert_by = req.logedINUser;
  let vbt_key;

  const insertLedger = (txnType, ladger_key, debit, credit) =>
    tallyDB.query(
      `INSERT INTO tally_ledger_data
         (txn_type, ladger_key, debit, credit, module_used, insert_date, which_module, ref_date, insert_by)
       VALUES
         (:txnType, :ladger_key, :debit, :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)`,
      {
        replacements: {
          txnType,
          ladger_key,
          debit,
          credit,
          module_used: vbt_key,
          insert_date: insert_data,
          which_module: "VBT01",
          effective_date: effective_data,
          insert_by,
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction,
      },
    );

  try {
    if (
      moment(req.body.invoice_date, "DD-MM-YYYY") >
      moment(req.body.eff_date, "DD-MM-YYYY")
    ) {
      await transaction.rollback();
      await transactioninvt.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "effective date must be greater than invoice date",
      });
    }

    const comp_length = req.body.component.length;

    let total_debit = 0;
    let total_credit = 0;

    for (let i = 0; i < comp_length; i++) {
      const row_valid = new Validator(
        {
          cgst_gl: req.body.cgst_gl[i],
          sgst_gl: req.body.sgst_gl[i],
          igst_gl: req.body.igst_gl[i],
        },
        { cgst_gl: "required", sgst_gl: "required", igst_gl: "required" },
      );
      if (row_valid.fails()) {
        await transaction.rollback();
        await transactioninvt.rollback();
        return res.json({
          success: false,
          status: "error",
          message: row_valid.errors.all(),
        });
      }

      total_debit +=
        Number(req.body.cgsts[i]) +
        Number(req.body.igsts[i]) +
        Number(req.body.sgsts[i]) +
        Number(req.body.freight[i]) +
        Number(req.body.bill_qty[i]) * Number(req.body.in_rates[i]);

      total_credit +=
        Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]);
    }

    if (req.body.round_type === "-") {
      total_debit -= Number(req.body.round_value);
    } else {
      total_debit += Number(req.body.round_value);
    }

    let total_ven_amount = 0;
    for (let i = 0; i < comp_length; i++) {
      total_ven_amount +=
        Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]);
    }

    if (
      Math.abs(
        Number(req.body.bill_amount) - Number(total_ven_amount.toFixed(2)),
      ) !== 0
    ) {
      await transaction.rollback();
      await transactioninvt.rollback();
      return res.json({
        success: false,
        status: "error",
        message: `Bill amount ${req.body.bill_amount} and Vendor amount ${total_ven_amount} not match`,
      });
    }

    if (
      Math.abs(
        Number(total_credit.toFixed(2)) - Number(total_debit.toFixed(2)),
      ) !== 0
    ) {
      await transaction.rollback();
      await transactioninvt.rollback();
      return res.json({
        success: false,
        status: "error",
        message: `Debit(${total_debit.toFixed(2)}) And Credit Value(${total_credit.toFixed(2)}) not matched`,
      });
    }

    const stmt_number = await tallyDB.query(
      "SELECT * FROM `tally_numbering` WHERE `for_number` = 'VBT01' FOR UPDATE",
      { type: tallyDB.QueryTypes.SELECT, transaction },
    );

    let vbt_no;
    if (stmt_number.length > 0) {
      const row = stmt_number[0];
      const suffix = String(parseInt(row.suffix) + 1).padStart(
        parseInt(row.number_length_limit),
        "0",
      );
      vbt_no = `${row.prefix}/${row.session}/${suffix}`;
    } else {
      const currYear = parseInt(
        new Date().getFullYear().toString().substr(2, 2),
      );
      vbt_no = `VBT01/${currYear}-${currYear + 1}/0001`;
    }

    await tallyDB.query(
      "UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'VBT01'",
      { type: tallyDB.QueryTypes.UPDATE, transaction },
    );

    vbt_key = vbt_no;

    let lastInsertedID, comp_key;

    for (let i = 0; i < comp_length; i++) {
      if (queryType == "RAW" || queryType == "SER") {
        comp_key = await invtDB.query(
          "SELECT component_key AS item_key, c_type FROM components WHERE c_part_no= :p_no",
          {
            replacements: { p_no: req.body.part_code[i] },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (comp_key.length <= 0) {
          await transaction.rollback();
          await transactioninvt.rollback();
          return res.json({
            success: false,
            status: "error",
            message: `Component ${req.body.part_code[i]} not found in master!!!`,
          });
        }
      }

      if (queryType == "FG") {
        comp_key = await invtDB.query(
          "SELECT product_key AS item_key, p_sku FROM products WHERE p_sku= :p_no",
          {
            replacements: { p_no: req.body.part_code[i] },
            type: invtDB.QueryTypes.SELECT,
          },
        );
        if (comp_key.length <= 0) {
          await transaction.rollback();
          await transactioninvt.rollback();
          return res.json({
            success: false,
            status: "error",
            message: `Product ${req.body.part_code[i]} not found in master!!!`,
          });
        }
      }

      const txnType = comp_key[0].c_type === "S" ? "--" : queryType;

      if (queryType == "RAW" || queryType == "SER") {
        const stmt_check_min = await invtDB.query(
          "SELECT ID FROM `rm_location` WHERE `in_transaction_id` = :min AND `components_id`= :comp AND `vbp_status` = 'Y'",
          {
            replacements: {
              min: req.body.min_key[i],
              comp: comp_key[0].item_key,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (stmt_check_min.length > 0) {
          await transaction.rollback();
          await transactioninvt.rollback();
          return res.json({
            success: false,
            status: "error",
            message: `${req.body.min_key[i]} already created!!!`,
          });
        }
      }

      if (queryType == "FG") {
        const stmt_check_min = await invtDB.query(
          "SELECT ID FROM `mfg_production_3` WHERE `mfg_pro_apr_transaction` = :min AND `mfg_pro_apr_sku`= :sku AND `vbp_status` = 'Y'",
          {
            replacements: {
              min: req.body.min_key[i],
              sku: comp_key[0].p_sku,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );
        if (stmt_check_min.length > 0) {
          await transaction.rollback();
          await transactioninvt.rollback();
          return res.json({
            success: false,
            status: "error",
            message: `${req.body.min_key[i]} already created!!!`,
          });
        }
      }

      let findProject = [];
      if (queryType == "RAW" || queryType == "SER") {
        findProject = await invtDB.query(
          `SELECT rm_location.in_po_transaction_id, rm_location.rm_loc_project_id, project_master.project_name
           FROM rm_location
           LEFT JOIN project_master ON project_master.project_name = rm_location.rm_loc_project_id
           WHERE rm_location.in_transaction_id = :min
           GROUP BY rm_location.in_transaction_id`,
          {
            replacements: { min: req.body.min_key[i] },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (findProject.length <= 0) {
          await transaction.rollback();
          await transactioninvt.rollback();
          return res.json({
            code: 500,
            status: "error",
            message: { msg: "error while getting project id and number." },
          });
        }
      }

      const stmt = await tallyDB.query(
        `INSERT INTO tally_vbt
           (txn_type, part_code, po_number, project_id, vbt_inqty, vbt_bill_qty, vbt_inrate,
            vbt_taxable_value, hsn_code, vbt_gst_type, vbt_gst_rate, freight, vbt_freight_gl,
            vbp_gst_ass_value, vbt_cgst, vbt_cgst_gl, vbt_sgst, vbt_sgst_gl, vbt_igst, vbt_igst_gl,
            gl_code, tds_code, tds_gl, vbt_ven_ammount, vbt_key, insert_by, insert_date, min_id,
            inrPrice, cifPrice, cifValue, vbt_tds_ass_val, vbt_tds_amount, ven_address,
            vbt_invoice_no, vbt_invoice_date, vbt_comment, ven_code, vbt_gstin, vbt_type,
            effective_date, item_description, billAmount)
         VALUES
           (:txnType, :part_code, :po_number, :project_id, :in_qtys, :vbt_bill_qty, :in_rates,
            :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate, :freight, :freight_gl,
            :gst_ass_vals, :cgsts, :cgsts_gl, :sgsts, :sgsts_gl, :igsts, :igsts_gl,
            :g_l_codes, :tds_codes, :tds_gl, :ven_amounts, :vbt_key, :insert_by, :insert_date, :min_id,
            :inrPrice, :cifPrice, :cifValue, :tds_ass_vals, :tds_amounts, :ven_address,
            :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT01',
            :effective_date, :item_description, :billAmount)`,
        {
          replacements: {
            txnType,
            po_number: queryType == "RAW" || queryType == "SER" ? findProject[0].in_po_transaction_id : "--",
            project_id: queryType == "RAW" || queryType == "SER" ? findProject[0].project_name : "--",
            vbt_key,
            in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i],
            in_rates: req.body.in_rates[i],
            taxable_values: req.body.taxable_values[i],
            part_code: comp_key[0].item_key,
            hsn_code: req.body.hsn_code[i],
            in_gst_types: req.body.in_gst_types[i],
            freight: req.body.freight[i],
            freight_gl: "TP550175734290",
            gst_ass_vals: req.body.gst_ass_vals[i],
            cgsts: req.body.cgsts[i],
            cgsts_gl: req.body.cgst_gl[i],
            sgsts: req.body.sgsts[i],
            sgsts_gl: req.body.sgst_gl[i],
            igsts: req.body.igsts[i],
            igsts_gl: req.body.igst_gl[i],
            g_l_codes: req.body.g_l_codes[i],
            tds_codes: req.body.tds_codes[i],
            tds_gl: req.body.tds_gl_code[i],
            tds_ass_vals: req.body.tds_ass_vals[i],
            tds_amounts: req.body.tds_amounts[i],
            ven_amounts: req.body.ven_amounts[i],
            vbt_gst_rate: req.body.vbp_gst_rate[i],
            insert_by,
            insert_date: insert_data,
            min_id: req.body.min_key[i],
            inrPrice: req.body.inrPrice[i],
            cifPrice: req.body.cifPrice[i],
            cifValue: req.body.cifValue[i],
            ven_address: req.body.ven_address,
            invoice_no: req.body.invoice_no,
            invoice_date: req.body.invoice_date,
            comment: req.body.comment,
            ven_code: req.body.ven_code,
            vbt_gstin: req.body.vbt_gstin,
            effective_date: effective_data,
            item_description: req.body.item_description?.[i] ?? "",
            billAmount: req.body.bill_amount,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction,
        },
      );

      lastInsertedID = stmt[0];

      if (Number(req.body.cgsts[i]) > 0)
        await insertLedger(
          txnType,
          req.body.cgst_gl[i],
          req.body.cgsts[i],
          "0",
        );
      if (Number(req.body.igsts[i]) > 0)
        await insertLedger(
          txnType,
          req.body.igst_gl[i],
          req.body.igsts[i],
          "0",
        );
      if (Number(req.body.sgsts[i]) > 0)
        await insertLedger(
          txnType,
          req.body.sgst_gl[i],
          req.body.sgsts[i],
          "0",
        );
      if (Number(req.body.freight[i]) > 0)
        await insertLedger(txnType, "TP550175734290", req.body.freight[i], "0");

      if (Number(req.body.taxable_values[i]) > 0) {
        if (req.body.g_l_codes[i] === "--") {
          await transaction.rollback();
          await transactioninvt.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "Something wrong!!! (GL OPTION)",
          });
        }
        await insertLedger(
          txnType,
          req.body.g_l_codes[i],
          req.body.taxable_values[i],
          "0",
        );
      }

      if (req.body.tds_amounts[i] != 0) {
        if (req.body.tds_gl_code[i] === "--") {
          await transaction.rollback();
          await transactioninvt.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "Something wrong!!! (TDS OPTION)",
          });
        }
        await insertLedger(
          txnType,
          req.body.tds_gl_code[i],
          "0",
          req.body.tds_amounts[i],
        );
      }

      await insertLedger(
        txnType,
        req.body.ven_code,
        "0",
        req.body.ven_amounts[i],
      );

      if (queryType == "RAW" || queryType == "SER") {
        await invtDB.query(
          "UPDATE rm_location SET vbp_status = 'Y' WHERE in_transaction_id = :min AND components_id= :comp",
          {
            replacements: {
              min: req.body.min_key[i],
              comp: comp_key[0].item_key,
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transactioninvt,
          },
        );
      } else if (queryType == "FG") {
        await invtDB.query(
          "UPDATE mfg_production_3 SET vbp_status = 'Y' WHERE mfg_pro_apr_transaction = :min AND mfg_pro_apr_sku= :sku",
          {
            replacements: {
              min: req.body.min_key[i],
              sku: comp_key[0].p_sku,
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transactioninvt,
          },
        );
      }
    }

    if (lastInsertedID) {
      await tallyDB.query(
        `UPDATE tally_vbt SET round_off_sign = :round_off_sign, round_off_amt = :round_off_amt, round_off_gl = :round_off_gl WHERE ID = :id`,
        {
          replacements: {
            id: lastInsertedID,
            round_off_sign: req.body.round_type ?? "--",
            round_off_amt: req.body.round_value ?? "",
            round_off_gl: "TP558350023869",
          },
          type: tallyDB.QueryTypes.UPDATE,
          transaction,
        },
      );
    }

    if (req.body.round_value != 0) {
      const txnType = comp_key[0].c_type === "S" ? "--" : queryType;

      const isPositive = req.body.round_type === "+";
      await insertLedger(
        txnType,
        "TP558350023869",
        isPositive ? req.body.round_value : "0",
        isPositive ? "0" : req.body.round_value,
      );
    }

    await transaction.commit();
    await transactioninvt.commit(); 
    return res.json({
      success: true,
      status: "success",
      message: "Insertion Successfull",
    });
  } catch (error) {
    await transaction.rollback();
    await transactioninvt.rollback();
    return helper.errorResponse(res, error);
  }
});

// VBT01 GL GROUP OPTION
router.get("/vbt01_gl_options", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await tallyDB.query(
      "SELECT `vbt_group_key` FROM `vbt_module` WHERE `vbt_module`='vbt01'",
      {
        type: tallyDB.QueryTypes.SELECT,
      },
    );
    if (stmt.length > 0) {
      let str_gl_keys = stmt[0].vbt_group_key;
      let gl_key_arr = str_gl_keys.split(",");
      if (gl_key_arr.length > 0) {
        let options = [];
        for (let i = 0; i < gl_key_arr.length; i++) {
          let stmt1 = await tallyDB.query(
            "SELECT ledger_key, ladger_name, code FROM `tally_ledger` WHERE `sub_group_key`=:key",
            {
              replacements: { key: gl_key_arr[i] },
              type: tallyDB.QueryTypes.SELECT,
            },
          );
          if (stmt1.length > 0) {
            for (let j = 0; j < stmt1.length; j++) {
              options.push({
                id: stmt1[j].ledger_key,
                text: `${stmt1[j].ladger_name} (${stmt1[j].code})`,
              });
            }
          }
        }
        return res.json({
          status: "success",
          success: true,
          message: "G/L Found Successfully",
          data: options,
        });
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No G/L Mapping Found!!",
      });
    }
  } catch (err) {
    return res.json({ status: "error", success: false, message: "an error occurred while process your request" });
  }
});

// VBT EDIT
router.post("/vbt_edit", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    vbt_code: "required",
  });
  if (validation.fails()) {
    return res.json({
      message: validation.errors.all(),
      status: "error",
      success: false,
    });
  }
  try {
    let final = [];

    for (let j = 0; j < req.body.vbt_code.length; j++) {
      let stmt = await tallyDB.query(
        `SELECT tally_vbt.*,components.c_part_no, components.c_name, ven_basic_detail.ven_name,gl.ladger_name as gl_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON components.component_key = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON ven_basic_detail.ven_register_id = tally_vbt.ven_code LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key WHERE vbt_key=:vbt_code AND (vbt_status != 'D' AND vbt_status != 'DE')`,
        {
          replacements: { vbt_code: req.body.vbt_code[j] },
          type: tallyDB.QueryTypes.SELECT,
        },
      );

      if (stmt.length > 0) {
        for (let i = 0; i < stmt.length; i++) {
          let tds_stmt = await tallyDB.query(
            "SELECT `tally_tds`.`tds_name`,`tally_tds`.`tds_code`,`tally_ledger`.`ladger_name`,`tally_ledger`.`code` FROM `tally_tds` LEFT JOIN `tally_ledger` ON `tally_ledger`.`ledger_key` = `tally_tds`.`tds_gl_code` WHERE `tds_key`=:tds_code ",
            {
              replacements: { tds_code: stmt[i].tds_code },
              type: tallyDB.QueryTypes.SELECT,
            },
          );
          let tds_name = "--";
          let tds_code = "--";
          let tds_gl_name = "--";
          let tds_gl_code = "--";
          if (tds_stmt.length > 0) {
            tds_name = tds_stmt[0].tds_name;
            tds_code = tds_stmt[0].tds_code;
            tds_gl_name = tds_stmt[0].ladger_name;
            tds_gl_code = tds_stmt[0].code;
          }

          final.push({
            item: stmt[i].part_code,
            item_code: stmt[i].c_part_no,
            item_name: stmt[i].c_name,
            inqty: stmt[i].vbt_inqty,
            vbt_qty: stmt[i].vbt_bill_qty,
            inrate: stmt[i].vbt_inrate,
            taxable_value: stmt[i].vbt_taxable_value,
            hsn_code: stmt[i].hsn_code,
            gst_type: stmt[i].vbt_gst_type,
            gst_rate: stmt[i].vbt_gst_rate,
            freight: stmt[i].vbt_freight,
            gst_ass_value: stmt[i].vbp_gst_ass_value,
            cgst: stmt[i].vbt_cgst,
            sgst: stmt[i].vbt_sgst,
            igst: stmt[i].vbt_igst,
            gl_code: stmt[i].gl_code,
            gl_name: stmt[i].gl_name,
            tds_code: stmt[i].tds_code,
            tds_name: `(${tds_code}) ${tds_name}`,
            tds_gl: stmt[i].tds_gl,
            tds_gl_name: `(${tds_gl_code}) ${tds_gl_name} `,
            tds_ass_val: stmt[i].vbt_tds_ass_val,
            tds_amount: stmt[i].vbt_tds_amount,
            ven_ammount: stmt[i].vbt_ven_ammount,
            vbt_key: stmt[i].vbt_key,
            min_id: stmt[i].min_id,
            ven_code: stmt[i].ven_code,
            ven_name: stmt[i].ven_name,
            invoice_no: stmt[i].vbt_invoice_no,
            ven_address: stmt[i].ven_address,
            comment: stmt[i].vbt_comment,
            invoice_date: stmt[i].vbt_invoice_date,
            gstin: stmt[i].vbt_gstin,
            effective_date: moment(stmt[i].effective_date, "YYYY-MM-DD").format(
              "DD-MM-YYYY",
            ),
          });
        }
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "VBT can't be edit due to some reason!!!",
        });
      }
    }
    return res.json({ status: "success", success: true, data: final });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// VBT UPDATE
router.post("/vbt_update", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    vbt_code: "required",
    ven_code: "required",
    ven_address: "required",
    invoice_no: "required",
    invoice_date: "required",
    comment: "required",
    gstin: "required",
    eff_date: "required",
  });

  if (validation.fails()) {
    res.json({
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
      success: false,
    });
  }

  const transaction = await tallyDB.transaction();

  try {
    let comp_length = req.body.component.length;
    let total_debit = 0;
    let total_credit = 0;

    for (let i = 0; i < comp_length; i++) {
      total_debit +=
        Number(req.body.cgsts[i]) +
        Number(req.body.igsts[i]) +
        Number(req.body.sgsts[i]) +
        Number(req.body.freight[i]) +
        Number(req.body.bill_qty[i]) * Number(req.body.in_rates[i]);
      total_credit +=
        Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]);
    }

    // if (req.body.round_type == "+") {
    //   total_debit = total_debit + req.body.round_value;
    // }
    // if (req.body.round_type == "-") {
    //   total_debit = total_debit - req.body.round_value;
    // }

    if (Number(total_credit).toFixed(2) != Number(total_debit).toFixed(2)) {
      return res.json({
        status: "error",
        success: false,
        message: `Debit(${Number(total_debit).toFixed(2)}) And Credit Value(${Number(total_credit).toFixed(2)}) Not Matched!!!`,
      });
    }

    const vbt_key = req.body.vbt_code;
    const update_date = moment(new Date())
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD HH:mm:ss");
    const effective_data = moment(req.body.eff_date, "DD-MM-YYYYY")
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD");
    const update_by = req.logedINUser;

    let ledger_del_stmt = await tallyDB.query(
      "DELETE FROM `tally_ledger_data` WHERE `module_used`=:vbt_key",
      {
        replacements: { vbt_key: vbt_key },
        type: tallyDB.QueryTypes.DELETE,
        transaction: transaction,
      },
    );

    if (ledger_del_stmt.length > 0) {
      // DELETED
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "VBT can't be update due to some reason!!!",
      });
    }

    for (let i = 0; i < comp_length; i++) {
      let stmt = await tallyDB.query(
        "UPDATE `tally_vbt` SET `vbt_inqty` = :in_qtys , `vbt_bill_qty` = :vbt_bill_qty , `vbt_inrate` = :in_rates , `vbt_taxable_value` = :vbt_taxable_value , `hsn_code` = :hsn_code , `vbt_gst_type` = :in_gst_types , `vbt_gst_rate` = :vbt_gst_rate, `freight` = :freight , `vbp_gst_ass_value` = :gst_ass_vals , `vbt_cgst` = :cgsts , `vbt_sgst` = :sgsts , `vbt_igst` = :igsts , `gl_code` = :g_l_codes , `tds_code` = :tds_codes , `tds_gl` = :tds_gl , `vbt_tds_ass_val` = :tds_ass_vals , `vbt_tds_amount` = :tds_amounts , `vbt_ven_ammount` = :ven_amounts , `vbt_invoice_no` = :invoice_no , `ven_address` = :ven_address , `vbt_comment` = :comment , `vbt_invoice_date` = :invoice_date , `vbt_gstin` = :vbt_gstin , `update_by` = :update_by , `update_date` = :update_date , `effective_date` = :effective_date  WHERE `vbt_key` = :vbt_key AND `part_code` = :part_code AND `min_id` = :min_id ",
        {
          replacements: {
            vbt_key: vbt_key,
            in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i],
            in_rates: req.body.in_rates[i],
            taxable_values: req.body.taxable_values[i],
            part_code: req.body.part_code[i],
            hsn_code: req.body.hsn_code[i],
            in_gst_types: req.body.in_gst_types[i],
            freight: req.body.freight[i],
            vbt_gst_rate: req.body.vbp_gst_rate[i],
            gst_ass_vals: req.body.gst_ass_vals[i],
            cgsts: req.body.cgsts[i],
            sgsts: req.body.sgsts[i],
            igsts: req.body.igsts[i],
            g_l_codes: req.body.g_l_codes[i],
            tds_codes: req.body.tds_codes[i],
            tds_gl: req.body.tds_gl_code[i],
            tds_ass_vals: req.body.tds_ass_vals[i],
            tds_amounts: req.body.tds_amounts[i],
            ven_amounts: req.body.ven_amounts[i],
            update_by: update_by,
            update_date: update_date,
            min_id: req.body.min_key[i],
            // Header
            ven_address: req.body.ven_address,
            invoice_no: req.body.invoice_no,
            invoice_date: req.body.invoice_date,
            comment: req.body.comment,
            ven_code: req.body.ven_code,
            vbt_gstin: req.body.vbt_gstin,
            effective_date: effective_data,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        },
      ); //End Insert VBT

      if (Number(req.body.cgsts[i]) > 0) {
        let insert_cgst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, update_date, which_module, ref_date, update_by) VALUES (:ladger_key, :debit , :credit, :module_used, :update_date, :which_module,  :effective_date, :update_by)",
          {
            replacements: {
              ladger_key: "TP274965899340",
              debit: req.body.cgsts[i],
              credit: "0",
              module_used: vbt_key,
              update_date: update_date,
              which_module: "VBT01",
              effective_date: effective_data,
              update_by: update_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
      if (Number(req.body.igsts[i]) > 0) {
        let insert_igst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, update_date, which_module, ref_date, update_by) VALUES (:ladger_key, :debit , :credit, :module_used, :update_date, :which_module,  :effective_date, :update_by)",
          {
            replacements: {
              ladger_key: "TP486973272469",
              debit: req.body.igsts[i],
              credit: "0",
              module_used: vbt_key,
              update_date: update_date,
              which_module: "VBT01",
              effective_date: effective_data,
              update_by: update_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }

      if (Number(req.body.sgsts[i]) > 0) {
        let insert_igst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: "TP385675494002",
              debit: req.body.sgsts[i],
              credit: "0",
              module_used: vbt_key,
              insert_date: update_date,
              which_module: "VBT01",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
      if (Number(req.body.freight[i]) > 0) {
        let insert_igst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: "TP550175734290",
              debit: req.body.freight[i],
              credit: "0",
              module_used: vbt_key,
              insert_date: update_date,
              which_module: "VBT01",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
      // GL
      if (Number(req.body.taxable_values[i]) > 0) {
        let insert_gst_ass_vals = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: req.body.g_l_codes[i],
              debit: req.body.taxable_values[i],
              credit: "0",
              module_used: vbt_key,
              insert_date: update_date,
              which_module: "VBT01",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
      if (req.body.tds_gl_code[i] != 0) {
        let insert_tds_gl_code = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: req.body.tds_gl_code[i],
              debit: "0",
              credit: req.body.tds_amounts[i],
              module_used: vbt_key,
              insert_date: update_date,
              which_module: "VBT01",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
      // VENDOR
      let insert_ven_gl = await tallyDB.query(
        "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)",
        {
          replacements: {
            ladger_key: req.body.ven_code,
            debit: "0",
            credit: req.body.ven_amounts[i],
            module_used: vbt_key,
            insert_date: update_date,
            which_module: "VBT01",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        },
      );
    } //END FOR LOOP

    if (req.body.round_value != 0) {
      let repl;
      if (req.body.round_type == "+") {
        repl = {
          ladger_key: "TP558350023869",
          debit: req.body.round_value,
          credit: "0",
          module_used: vbt_key,
          insert_date: update_date,
          which_module: "VBT01",
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
          insert_date: update_date,
          which_module: "VBT01",
          effective_date: effective_data,
          insert_by: insert_by,
        };
      }

      let inset_round_gl = await tallyDB.query(
        "Insert INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, 	insert_by)VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)",
        {
          replacements: repl,
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        },
      );
    }

    await transaction.commit();
    return res.json({
      status: "success",
      success: true,
      message: "Insertion Successfull",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// VBT DEBIT NODE
router.post("/debit/create", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    vbt_code: "required",
    ven_code: "required",
    ven_address: "required",
    invoice_no: "required",
    invoice_date: "required",
    comment: "required",
    vbt_gstin: "required",
    component: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: validation.errors.all(),
    });
  }

  const transaction = await tallyDB.transaction();

  try {
    let comp_length = req.body.component.length;
    let total_debit = 0;
    let total_credit = 0;

    for (let i = 0; i < comp_length; i++) {
      if (Number(req.body.bill_qty[i]) == 0) {
        total_debit +=
          Number(req.body.cgsts[i]) +
          Number(req.body.igsts[i]) +
          Number(req.body.sgsts[i]) +
          Number(req.body.freight[i]) +
          Number(req.body.totalRateDifference[i]);
      } else {
        total_debit +=
          Number(req.body.cgsts[i]) +
          Number(req.body.igsts[i]) +
          Number(req.body.sgsts[i]) +
          Number(req.body.freight[i]) +
          Number(req.body.bill_qty[i]) * Number(req.body.in_rates[i]);
      }

      total_credit +=
        Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]);
    }

    let total_ven_ammount = 0;
    for (let i = 0; i < comp_length; i++) {
      total_ven_ammount += Number(req.body.ven_amounts[i]);
    }

    if (
      Math.abs(
        Number(Number(total_credit).toFixed(2)) -
          Number(Number(total_debit).toFixed(2)),
      ) > 1
    ) {
      return res.json({
        status: "error",
        success: false,
        message: `Debit(${total_debit}) And Credit Value(${total_credit}) Not Matched!!!`,
      });
    }

    // NUMBURING FUN
    let stmt_number = await tallyDB.query(
      "SELECT * FROM `tally_numbering` WHERE `for_number` = 'DEBIT' FOR UPDATE",
      {
        type: tallyDB.QueryTypes.SELECT,
        transaction: transaction,
      },
    );
    var debit_no;
    if (stmt_number.length > 0) {
      var suffix = stmt_number[0].suffix;
      suffix = parseInt(suffix) + 1;
      suffix = suffix.toString();
      suffix = suffix.padStart(
        parseInt(stmt_number[0].number_length_limit),
        "0",
      );

      debit_no =
        stmt_number[0].prefix + "/" + stmt_number[0].session + "/" + suffix;
    } else {
      let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
      debit_no = "DN/" + currYear + "-" + (currYear + 1) + "/0001";
    }
    // END NUMBURING FUN

    await tallyDB.query(
      "UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'DEBIT'",
      {
        type: tallyDB.QueryTypes.UPDATE,
        transaction: transaction,
      },
    );

    const vbt_debit_key = debit_no;
    const insert_data = moment(new Date())
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD HH:mm:ss");
    const effective_data = moment(req.body.eff_date, "DD-MM-YYYY")
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD");
    const insert_by = req.logedINUser;

    for (let i = 0; i < comp_length; i++) {
      const vbt_key = req.body.vbt_code[i];
      let stmt_vbt_qty = await tallyDB.query(
        "SELECT SUM(vbt_bill_qty) as  vbt_bill_qty FROM `tally_vbt` WHERE  `part_code` = :part_code AND `vbt_key` = :vbt_key AND `vbt_status` != 'DE'",
        {
          replacements: {
            part_code: req.body.component[i],
            vbt_key: vbt_key,
          },
          type: tallyDB.QueryTypes.SELECT,
        },
      );

      let stmt_debit_qty = await tallyDB.query(
        "SELECT SUM(vbt_bill_qty) AS pen_qty FROM `tally_vbt` WHERE  `part_code` = :part_code AND `vbt_key` = :vbt_key AND `vbt_status` = 'DE' ",
        {
          replacements: {
            part_code: req.body.component[i],
            vbt_key: vbt_key,
          },
          type: tallyDB.QueryTypes.SELECT,
        },
      );

      if (stmt_debit_qty.length > 0) {
        if (
          Number(req.body.bill_qty[i]) >
          Number(stmt_vbt_qty[0].vbt_bill_qty) -
            Number(stmt_debit_qty[0].pen_qty)
        ) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Please enter Valid Debit QTY.",
          });
        }
      }

      if (
        moment(req.body.invoice_date[i], "DD-MM-YYYY") >
        moment(req.body.eff_date, "DD-MM-YYYY")
      ) {
        return res.json({
          status: "error",
          message: "effective date must be greater than invoice date",
        });
      }

      let findProject = await invtDB.query(
        "SELECT in_po_transaction_id, po_project_name FROM rm_location LEFT JOIN po_purchase_req ON po_purchase_req.po_transaction = rm_location.in_po_transaction_id WHERE in_transaction_id = :min GROUP BY in_transaction_id",
        {
          replacements: {
            min: req.body.min_key[i],
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (findProject.length <= 0) {
        return res.json({
          status: "error",
          message: "error while getting project id and number.",
        });
      }

      let stmt = await tallyDB.query(
        "INSERT INTO `tally_vbt` ( `part_code`, po_number, project_id, `vbt_bill_qty`, `vbt_inrate`, `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `freight`, `vbt_freight_gl`, `vbp_gst_ass_value`, `vbt_cgst`,`vbt_cgst_gl`, `vbt_sgst`,`vbt_sgst_gl`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `tds_code`, `tds_gl`, `vbt_ven_ammount`, `vbt_key`, `vbt_debit_key` , `insert_by`, `insert_date`, `min_id`,`vbt_tds_ass_val`,`vbt_tds_amount`, `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `vbt_status`) VALUES (:part_code, :po_number, :project_id, :vbt_bill_qty, :in_rates, :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate, :freight, :freight_gl, :gst_ass_vals, :cgsts, :cgsts_gl, :sgsts, :sgsts_gl, :igsts, :igsts_gl, :g_l_codes, :tds_codes, :tds_gl, :ven_amounts, :vbt_key, :vbt_debit_key , :insert_by, :insert_date, :min_id, :tds_ass_vals, :tds_amounts, :ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT01' , :effective_date, :vbt_status )",
        {
          replacements: {
            po_number: findProject[0].in_po_transaction_id
              ? findProject[0].in_po_transaction_id
              : "--",
            project_id: findProject[0].po_project_name
              ? findProject[0].po_project_name
              : "--",
            vbt_status: "DE",
            vbt_key: vbt_key,
            vbt_debit_key: vbt_debit_key,
            // in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i] ? req.body.bill_qty[i] : 0,
            in_rates: req.body.in_rates[i],
            taxable_values: req.body.taxable_values[i],
            part_code: req.body.component[i],
            hsn_code: req.body.hsn_code[i],
            in_gst_types: req.body.in_gst_types[i],
            freight: req.body.freight[i],
            freight_gl: req.body.freight_gl[i],
            gst_ass_vals: req.body.gst_ass_vals[i],
            cgsts: req.body.cgsts[i],
            cgsts_gl: "TP833329493527",
            sgsts: req.body.sgsts[i],
            sgsts_gl: "TP169441804733",
            igsts: req.body.igsts[i],
            igsts_gl: "TP145525070328",
            g_l_codes: req.body.g_l_codes[i],
            tds_codes: req.body.tds_codes[i] ? req.body.tds_codes[i] : "",
            tds_gl: req.body.tds_gl_code[i] ? req.body.tds_gl_code[i] : "",
            tds_ass_vals: req.body.tds_ass_vals[i]
              ? req.body.tds_ass_vals[i]
              : "",
            tds_amounts: req.body.tds_amounts[i] ? req.body.tds_amounts[i] : "",
            ven_amounts: req.body.ven_amounts[i],
            vbt_gst_rate: req.body.vbp_gst_rate[i],
            insert_by: req.logedINUser,
            insert_date: insert_data,
            min_id: req.body.min_key[i],
            // Header
            ven_address: req.body.ven_address,
            invoice_no: req.body.invoice_no[i],
            invoice_date: req.body.invoice_date[i],
            comment: req.body.comment,
            ven_code: req.body.ven_code,
            vbt_gstin: req.body.vbt_gstin,
            effective_date: effective_data,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        },
      ); //End Insert VBT

      if (Number(req.body.cgsts[i]) > 0) {
        let insert_cgst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: "TP833329493527",
              // debit: req.body.cgsts[i],
              // credit: "0",
              credit: req.body.cgsts[i],
              debit: "0",
              module_used: vbt_key,
              debit_key: vbt_debit_key,
              insert_date: insert_data,
              which_module: "VBT01",
              ledger_data_status: "DE",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
      if (Number(req.body.igsts[i]) > 0) {
        let insert_igst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: "TP145525070328",
              // debit: req.body.igsts[i],
              // credit: "0",
              credit: req.body.igsts[i],
              debit: "0",
              module_used: vbt_key,
              debit_key: vbt_debit_key,
              insert_date: insert_data,
              which_module: "VBT01",
              ledger_data_status: "DE",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
      if (Number(req.body.sgsts[i]) > 0) {
        let insert_igst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: "TP169441804733",
              // debit: req.body.sgsts[i],
              // credit: "0",
              credit: req.body.sgsts[i],
              debit: "0",
              module_used: vbt_key,
              debit_key: vbt_debit_key,
              insert_date: insert_data,
              which_module: "VBT01",
              ledger_data_status: "DE",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
      if (Number(req.body.freight[i]) > 0) {
        let insert_igst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: req.body.freight_gl[i] ?? "TP550175734290",
              // debit: req.body.freight[i],
              // credit: "0",
              credit: req.body.freight[i],
              debit: "0",
              module_used: vbt_key,
              debit_key: vbt_debit_key,
              insert_date: insert_data,
              which_module: "VBT01",
              ledger_data_status: "DE",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
      // GL
      if (Number(req.body.taxable_values[i]) > 0) {
        if (req.body.g_l_codes[i] == "--") {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Something wrong!!! (GL OPTION) ",
          });
        }
        let insert_gst_ass_vals = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: req.body.g_l_codes[i],
              // debit: req.body.taxable_values[i],
              // credit: "0",
              credit: req.body.taxable_values[i],
              debit: "0",
              module_used: vbt_key,
              debit_key: vbt_debit_key,
              insert_date: insert_data,
              which_module: "VBT01",
              ledger_data_status: "DE",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }
      if (req.body.tds_amounts[i] != 0) {
        if (req.body.tds_gl_code[i] == "--") {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Something wrong!!! (TDS OPTION) ",
          });
        }

        let insert_tds_gl_code = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: req.body.tds_gl_code[i],
              // debit: "0",
              // credit: req.body.tds_amounts[i],
              credit: "0",
              debit: req.body.tds_amounts[i],
              module_used: vbt_key,
              debit_key: vbt_debit_key,
              insert_date: insert_data,
              which_module: "VBT01",
              ledger_data_status: "DE",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }

      if (req.body.round_value ? req.body.round_value : 0 != 0) {
        let repl;
        if (req.body.round_type == "+") {
          repl = {
            ladger_key: "TP558350023869",
            debit: "0",
            credit: req.body.round_value,
            module_used: vbt_key,
            debit_key: vbt_debit_key,
            insert_date: insert_data,
            which_module: "VBT01",
            ledger_data_status: "DE",
            effective_date: effective_data,
            insert_by: insert_by,
          };
        }
        if (req.body.round_type == "-") {
          repl = {
            ladger_key: "TP558350023869",
            debit: req.body.round_value,
            credit: "0",
            module_used: vbt_key,
            debit_key: vbt_debit_key,
            insert_date: insert_data,
            which_module: "VBT01",
            ledger_data_status: "DE",
            effective_date: effective_data,
            insert_by: insert_by,
          };
        }

        let insert_round_gl = await tallyDB.query(
          "Insert INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)",
          {
            replacements: repl,
            type: tallyDB.QueryTypes.UPDATE,
            transaction: transaction,
          },
        );
      }

      // VENDOR
      let insert_ven_gl = await tallyDB.query(
        "INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)",
        {
          replacements: {
            ladger_key: req.body.ven_code,
            // debit: "0",
            // credit: req.body.ven_amounts[i],
            credit: "0",
            debit: req.body.ven_amounts[i],
            module_used: vbt_key,
            debit_key: vbt_debit_key,
            insert_date: insert_data,
            which_module: "VBT01",
            ledger_data_status: "DE",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        },
      );
    } //END FOR LOOP

    await transaction.commit();
    return res.json({
      status: "success",
      success: true,
      message: "Insertion Successful",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// Fetch DEBIT REPORT
router.post("/fetchDebit", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: validation.errors.all(),
    });
  }

  try {
    let main_stmt;
    let { data } = req.body;

    main_stmt = await tallyDB.query(
      `SELECT tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key WHERE tally_vbt.ven_code = :venid ORDER BY ID DESC`,
      {
        replacements: { venid: data },
        type: tallyDB.QueryTypes.SELECT,
      },
    );

    if (main_stmt.length > 0) {
      let final = [];

      for (let i = 0; i < main_stmt.length; i++) {
        final.push({
          vbt_code: main_stmt[i].vbt_key,
          min_id: main_stmt[i].min_id,
          status: main_stmt[i].vbt_status,
          type: main_stmt[i].vbt_type,
          invoice_no: main_stmt[i].vbt_invoice_no,
          vendor: main_stmt[i].ven_name,
          ven_code: main_stmt[i].ven_code,
          part: main_stmt[i].c_name,
          part_code: main_stmt[i].c_part_no,
          act_qty: main_stmt[i].vbt_inqty,
          rate: main_stmt[i].vbt_inrate,
          taxable_value: main_stmt[i].vbt_taxable_value,
          cgst: main_stmt[i].vbt_cgst,
          sgst: main_stmt[i].vbt_sgst,
          igst: main_stmt[i].vbt_igst,
          custum: main_stmt[i].custom_duty,
          freight: main_stmt[i].freight,
          ven_bill_amm: main_stmt[i].vbt_ven_ammount,
          vbt_gl: main_stmt[i].gl_name,
          cgst_gl: main_stmt[i].cgst_gl_name,
          sgst_gl: main_stmt[i].sgst_gl_name,
          igst_gl: main_stmt[i].igst_join_name,
          tds_gl: main_stmt[i].tds_join_name,
          tds_amm: main_stmt[i].vbt_tds_amount,
          invoice_dt: main_stmt[i].vbt_invoice_date,
          create_dt: moment(main_stmt[i].insert_date, "YYYY-MM-DD").format(
            "DD-MM-YYYY",
          ),
        });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No Data Found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//update vbt
router.put("/update", [auth.isAuthorized], async (req, res) => {
  const transaction = await tallyDB.transaction();

  try {
    let validation = new Validator(req.body, {
      ven_code: "required",
      ven_address: "required",
      invoice_no: "required",
      invoice_date: "required",
      comment: "required",
      vbt_gstin: "required",
      vbtKey: "required",
      bill_amount: "required",
      inrPrice: "required",
      cifPrice: "required",
      cifValue: "required",
    });

    if (validation.fails()) {
      return res
        .status(403)
        .send(Object.values(validation.errors.all())[0].join());
    }

    let checkSettled = await tallyDB.query(
      "SELECT * FROM tally_ap WHERE ap_ref_no = :vbtKey",
      {
        replacements: {
          vbtKey: req.body.vbtKey,
        },
        type: tallyDB.QueryTypes.SELECT,
      },
    );

    if (checkSettled.length > 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Oops ! This VBT is already settled",
      });
    }

    if (
      moment(req.body.invoice_date, "DD-MM-YYYY") >
      moment(req.body.eff_date, "DD-MM-YYYY")
    ) {
      return res.json({
        status: "error",
        success: false,
        message: "Invoice date cannot be greater than effective date",
      });
    }

    let comp_length = req.body.component.length;
    let total_debit = 0;
    let total_credit = 0;

    for (let i = 0; i < comp_length; i++) {
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
        },
      );

      if (row_valid.fails()) {
        return res
          .status(403)
          .send(Object.values(row_valid.errors.all())[0].join());
      }

      total_debit +=
        Number(req.body.cgsts[i]) +
        Number(req.body.igsts[i]) +
        Number(req.body.sgsts[i]) +
        Number(req.body.freight[i]) +
        Number(req.body.bill_qty[i]) * Number(req.body.in_rates[i]);

      total_credit +=
        Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]);
    }

    if (req.body.roundOffSign == "-") {
      total_debit -= Number(req.body.roundOffValue);
    } else {
      total_debit += Number(req.body.roundOffValue);
    }

    let total_ven_ammount = 0;

    for (let i = 0; i < comp_length; i++) {
      total_ven_ammount +=
        Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]);
    }

    if (
      Math.abs(
        Number(req.body.bill_amount) - Number(total_ven_ammount).toFixed(2),
      ) != 0
    ) {
      return res
        .status(403)
        .send(
          `Bill amount ${req.body.bill_ammount} and Vendor amount ${total_ven_ammount} are not equal`,
        );
    }

    if (
      Math.abs(
        Number(Number(total_credit).toFixed(2)) -
          Number(Number(total_debit).toFixed(2)),
      ) != 0
    ) {
      return res
        .status(403)
        .send(`Debit ${total_debit} and Credit ${total_credit} are not equal`);
    }

    const vbt_key = req.body.vbtKey;
    const updatedAt = moment(new Date())
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD HH:mm:ss");
    const updatedBy = req.logedINUser;

    const insert_data = req.body.insertDate;
    const insert_by = req.body.insertBy;

    const effective_data = moment(req.body.eff_date, "DD-MM-YYYY")
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD");

    let deleteVbt = await tallyDB.query(
      "DELETE FROM tally_vbt WHERE vbt_key = :vbtKey AND vbt_type = 'VBT01' AND vbt_debit_key = '--'",
      {
        replacements: { vbtKey: vbt_key },
        type: tallyDB.QueryTypes.DELETE,
        transaction: transaction,
      },
    );

    let deleteTallyLedgerData = await tallyDB.query(
      "DELETE FROM tally_ledger_data WHERE module_used = :vbtKey AND which_module = 'VBT01' AND debit_key = '--'",
      {
        replacements: { vbtKey: vbt_key },
        type: tallyDB.QueryTypes.DELETE,
        transaction: transaction,
      },
    );

    let lastInsertedID;

    for (let i = 0; i < comp_length; i++) {
      let comp_key = await invtDB.query(
        "SELECT component_key FROM components WHERE c_part_no= :p_no",
        {
          replacements: { p_no: req.body.part_code[i] },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      let stmt = await tallyDB.query(
        "INSERT INTO `tally_vbt` ( `part_code`,po_number, project_id, `vbt_inqty`,`vbt_bill_qty`, `vbt_inrate`, `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `freight`, `vbt_freight_gl`, `vbp_gst_ass_value`, `vbt_cgst`,`vbt_cgst_gl`, `vbt_sgst`,`vbt_sgst_gl`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `tds_code`, `tds_gl`, `vbt_ven_ammount`, `vbt_key`, `insert_by`, `insert_date`, `min_id` , inrPrice , cifPrice , cifValue ,`vbt_tds_ass_val`,`vbt_tds_amount`, `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `item_description` , update_date , update_by , billAmount) VALUES (:part_code, :po_number, :project_id, :in_qtys, :vbt_bill_qty, :in_rates, :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate,  :freight, :freight_gl, :gst_ass_vals, :cgsts, :cgsts_gl, :sgsts, :sgsts_gl, :igsts, :igsts_gl, :g_l_codes, :tds_codes, :tds_gl, :ven_amounts, :vbt_key, :insert_by, :insert_date, :min_id, :inrPrice, :cifPrice, :cifValue, :tds_ass_vals, :tds_amounts,:ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT01' , :effective_date , :item_description , :update_date , :update_by , :billAmount)",
        {
          replacements: {
            po_number: req.body.poNumber?.[i] ? req.body.poNumber[i] : "",
            project_id: req.body.projectID?.[i] ? req.body.projectID[i] : "",
            vbt_key: vbt_key,
            in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i],
            in_rates: req.body.in_rates[i],
            taxable_values: req.body.taxable_values[i],
            part_code: comp_key[0].component_key,
            hsn_code: req.body.hsn_code[i],
            in_gst_types: req.body.in_gst_types[i],
            freight: req.body.freight[i],
            freight_gl: "TP550175734290",
            gst_ass_vals: req.body.gst_ass_vals[i],
            cgsts: req.body.cgsts[i] ? req.body.cgsts[i] : "0",
            // cgsts_gl: "TP274965899340",
            cgsts_gl: req.body.cgst_gl[i],
            sgsts: req.body.sgsts[i] ? req.body.sgsts[i] : "0",
            // sgsts_gl: "TP385675494002",
            sgsts_gl: req.body.sgst_gl[i],
            igsts: req.body.igsts[i] ? req.body.igsts[i] : "0",
            // igsts_gl: "TP486973272469",
            igsts_gl: req.body.igst_gl[i],
            g_l_codes: req.body.g_l_codes[i],
            tds_codes: req.body.tds_codes?.[i] ? req.body.tds_codes[i] : "",
            tds_gl: req.body.tds_gl_code?.[i] ? req.body.tds_gl_code[i] : "",
            tds_ass_vals: req.body.tds_ass_vals?.[i]
              ? req.body.tds_ass_vals[i]
              : "",
            tds_amounts: req.body.tds_amounts?.[i]
              ? req.body.tds_amounts[i]
              : "",
            ven_amounts: req.body.ven_amounts[i],
            vbt_gst_rate: req.body.vbp_gst_rate[i],
            insert_by: insert_by,
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
            item_description: req.body.item_description?.[i]
              ? req.body.item_description[i]
              : "",
            update_date: updatedAt,
            update_by: updatedBy,
            billAmount: req.body.bill_amount,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        },
      );

      lastInsertedID = stmt[0];

      if (Number(req.body.cgsts[i]) > 0) {
        let insert_cgst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)",
          {
            replacements: {
              // ladger_key: "TP274965899340",
              ladger_key: req.body.cgst_gl[i],
              debit: req.body.cgsts[i],
              credit: "0",
              module_used: vbt_key,
              insert_date: insert_data,
              which_module: "VBT01",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }

      if (Number(req.body.igsts[i]) > 0) {
        let insert_igst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)",
          {
            replacements: {
              // ladger_key: "TP486973272469",
              ladger_key: req.body.igst_gl[i],
              debit: req.body.igsts[i],
              credit: "0",
              module_used: vbt_key,
              insert_date: insert_data,
              which_module: "VBT01",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }

      if (Number(req.body.sgsts[i]) > 0) {
        let insert_igst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)",
          {
            replacements: {
              // ladger_key: "TP385675494002",
              ladger_key: req.body.sgst_gl[i],
              debit: req.body.sgsts[i],
              credit: "0",
              module_used: vbt_key,
              insert_date: insert_data,
              which_module: "VBT01",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }

      if (Number(req.body.freight[i]) > 0) {
        let insert_igst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: "TP550175734290",
              debit: req.body.freight[i],
              credit: "0",
              module_used: vbt_key,
              insert_date: insert_data,
              which_module: "VBT01",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }

      if (Number(req.body.taxable_values[i]) > 0) {
        if (req.body.g_l_codes[i] == "--") {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "GL option not selected",
          });
        }
        let insert_gst_ass_vals = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: req.body.g_l_codes[i],
              debit: req.body.taxable_values[i],
              credit: "0",
              module_used: vbt_key,
              insert_date: insert_data,
              which_module: "VBT01",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }

      if (req.body.tds_amounts[i] != 0) {
        if (req.body.tds_gl_code[i] == "--") {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "TDS Gl not selected",
          });
        }

        let insert_tds_gl_code = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: req.body.tds_gl_code[i],
              debit: "0",
              credit: req.body.tds_amounts[i],
              module_used: vbt_key,
              insert_date: insert_data,
              which_module: "VBT01",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );
      }

      let insert_ven_gl = await tallyDB.query(
        "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)",
        {
          replacements: {
            ladger_key: req.body.ven_code,
            debit: "0",
            credit: req.body.ven_amounts[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT01",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        },
      );
    }

    if (lastInsertedID) {
      await tallyDB.query(
        "UPDATE tally_vbt SET round_off_sign = :round_off_sign , round_off_amt = :round_off_amt , round_off_gl = :round_off_gl WHERE ID = :id",
        {
          replacements: {
            id: lastInsertedID,
            round_off_sign: req.body.roundOffSign ?? "--",
            round_off_amt: req.body.roundOffValue ?? "",
            round_off_gl: "TP558350023869",
          },
          type: tallyDB.QueryTypes.UPDATE,
          transaction: transaction,
        },
      );
    }

    if (req.body.roundOffValue != 0) {
      let repl;
      if (req.body.roundOffSign == "+") {
        repl = {
          ladger_key: "TP558350023869",
          debit: req.body.roundOffValue,
          credit: "0",
          module_used: vbt_key,
          insert_date: insert_data,
          which_module: "VBT01",
          effective_date: effective_data,
          insert_by: insert_by,
        };
      }
      if (req.body.roundOffSign == "-") {
        repl = {
          ladger_key: "TP558350023869",
          debit: "0",
          credit: req.body.roundOffValue,
          module_used: vbt_key,
          insert_date: insert_data,
          which_module: "VBT01",
          effective_date: effective_data,
          insert_by: insert_by,
        };
      }

      let inset_round_gl = await tallyDB.query(
        "Insert INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, 	insert_by)VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)",
        {
          replacements: repl,
          type: tallyDB.QueryTypes.UPDATE,
          transaction: transaction,
        },
      );
    }

    await transaction.commit();
    return res.json({
      status: "error",
      success: false,
      message: "VBT updated successfully",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;

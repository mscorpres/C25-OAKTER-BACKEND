const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");

// VBT04 // FIXED ASSET
// FETCH VBT
router.post("/fetch_vbt04", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    const { wise, data } = req.body;

    let main_stmt;

    if (wise == "date_wise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      main_stmt = await invtDB.query(
        "SELECT `rm_location`.`insert_date` AS `min_in_date`, `rm_location`.`in_transaction_id` AS `min_transaction`, `components`.`c_part_no` AS `part_code`, `rm_location`.`in_vendor_name` AS `ven_code`, `ven_basic_detail`.`ven_name` FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id=components.component_key LEFT JOIN `ven_basic_detail` ON  rm_location.in_vendor_name=ven_basic_detail.ven_register_id  WHERE `trans_type`='INWARD' AND DATE_FORMAT(rm_location.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND (`rm_location`.`vendor_type` = 'v01' ) AND `vbp_status`='N' ORDER BY `rm_location`.`ID` DESC",
        {
          replacements: { date1: date1, date2: date2 },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "vendor_wise") {
      main_stmt = await invtDB.query(
        "SELECT `rm_location`.`insert_date` AS `min_in_date`, `rm_location`.`in_transaction_id` AS `min_transaction`, `components`.`c_part_no` AS `part_code`, `rm_location`.`in_vendor_name` AS `ven_code`, `ven_basic_detail`.`ven_name` FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id=components.component_key LEFT JOIN `ven_basic_detail` ON  rm_location.in_vendor_name=ven_basic_detail.ven_register_id  WHERE `trans_type`='INWARD' AND `in_vendor_name` = :ven AND (`rm_location`.`vendor_type` = 'v01') AND `vbp_status`='N'  GROUP BY `rm_location`.`in_transaction_id` ORDER BY rm_location.ID",
        {
          replacements: { ven: data },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "min_wise") {
      main_stmt = await invtDB.query(
        "SELECT `rm_location`.`insert_date` AS `min_in_date`, `rm_location`.`in_transaction_id` AS `min_transaction`, `components`.`c_part_no` AS `part_code`, `rm_location`.`in_vendor_name` AS `ven_code`, `ven_basic_detail`.`ven_name` FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id=components.component_key LEFT JOIN `ven_basic_detail` ON  rm_location.in_vendor_name=ven_basic_detail.ven_register_id  WHERE `trans_type`='INWARD' AND `in_transaction_id` = :min AND (`rm_location`.`vendor_type` = 'v01') AND `vbp_status`='N' ORDER BY rm_location.ID",
        {
          replacements: { min: data },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];

    if (main_stmt.length > 0) {
      for (let i = 0; i < main_stmt.length; i++) {
        main_stmt[i].min_in_date = moment(main_stmt[i].min_in_date, "YYYY-MM-DD HH:mm:ss").format("DD/MM/YYYY");
      }

      return res.json({ status: "success", success: true, data: main_stmt });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// Fetch MIN DATA (SINGLE MIN NO)
router.post("/fetch_minData", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    min_id: "required",
  });

  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let main_stmt = await invtDB.query(
      "SELECT `c_part_no`, `c_name`, `qty`, `in_po_rate`, `in_hsn_code`, `in_gst_type`, `in_gst_rate`, `in_gst_cgst`, `in_gst_sgst`, `in_gst_igst`,`in_vendor_name`,`in_vendor_addr`,`in_invoice_id`,`in_po_invoice_id`,`in_jw_invoice_id`,`ven_basic_detail`.`ven_tds`,`ven_basic_detail`.`ven_name`,`units_name`,`in_po_transaction_id` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom`=`units`.`units_id` LEFT JOIN `ven_basic_detail` ON `rm_location`.`in_vendor_name`=`ven_basic_detail`.`ven_register_id`  WHERE `in_transaction_id` = :min_id  AND `rm_location`.`trans_type` = 'INWARD'",
      {
        replacements: { min_id: req.body.min_id },
        type: invtDB.QueryTypes.SELECT,
      }
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
        let gstIn_stmt = await invtDB.query("SELECT `ven_add_gst` FROM `ven_address_detail` WHERE `ven_id` = :ven_id", {
          replacements: { ven_id: main_stmt[i].in_vendor_name },
          type: invtDB.QueryTypes.SELECT,
        });

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
            // tds_keys.map(async (tds_key) => {
            let tds_data = await tallyDB.query("SELECT tds_name, tds_percent, tds_key, tds_code, tds_gl_code, ladger_name, ledger_key FROM `tally_tds` LEFT JOIN `tally_ledger` ON `tally_tds`.`tds_gl_code`= `tally_ledger`.`ledger_key`  WHERE `tds_key`=:key", {
              replacements: { key: tds_keys[k] },
              type: tallyDB.QueryTypes.SELECT,
            });

            if (tds_data.length > 0) {
              // tds_data.map((data) => {
              //   tds_option.push(data);
              // });
              for (let j = 0; j < tds_data.length; j++) {
                tds_option.push(tds_data[j]);
              }
            }
            // });
          }
        }
        // END TDS OPTIONS

        let vendor_address = [];
        if (main_stmt[i].in_po_transaction_id != "--") {
          let ven_add_stmt = await invtDB.query("SELECT `po_vendor_address` FROM `po_purchase_req` WHERE `po_transaction` = :po_transaction_id", {
            replacements: { po_transaction_id: main_stmt[i].in_po_transaction_id },
            type: invtDB.QueryTypes.SELECT,
          });
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
          value: (Number(main_stmt[i].in_po_rate) * Number(main_stmt[i].qty)).toFixed(2),
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
          return res.json({ status: "success", success: true, data: final_data });
        }
      } //End For Loop
    } else {
      return res.json({ status: "error", success: false, message: "No data Found" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// Fetch MULTIPLE MIN DATA
router.post("/fetch_multi_min_data", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    mins: "required",
  });

  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  const mins = req.body.mins;
  try {
    let count = 0;
    let final_data = [];
    for (let a = 0; a < mins.length; a++) {
      count++;
      let main_stmt = await invtDB.query(
        "SELECT `c_part_no`, `c_name`, `qty`, `in_po_rate`, `in_hsn_code`, `in_gst_type`, `in_gst_rate`, `in_gst_cgst`, `in_gst_sgst`, `in_gst_igst`,`in_vendor_name`,`in_vendor_addr`,`in_invoice_id`,`in_po_invoice_id`,`in_jw_invoice_id`,`ven_basic_detail`.`ven_tds`,`ven_basic_detail`.`ven_name`,`units_name`,`in_po_transaction_id` , ackwlg_irn FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom`=`units`.`units_id` LEFT JOIN `ven_basic_detail` ON `rm_location`.`in_vendor_name`=`ven_basic_detail`.`ven_register_id`  WHERE `in_transaction_id` = :min_id  AND `rm_location`.`trans_type` = 'INWARD'",
        {
          replacements: { min_id: mins[a] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (main_stmt.length > 0) {
        let part_count = 0;
        for (let i = 0; i < main_stmt.length; i++) {
          part_count++;
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
          let gstIn_stmt = await invtDB.query("SELECT `ven_add_gst` FROM `ven_address_detail` WHERE `ven_id` = :ven_id", {
            replacements: { ven_id: main_stmt[i].in_vendor_name },
            type: invtDB.QueryTypes.SELECT,
          });

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
            for (let i = 0; i < tds_keys.length; i++) {
              let tds_data = await tallyDB.query("SELECT tds_name, tds_percent, tds_key, tds_code, tds_gl_code, ladger_name, ledger_key FROM `tally_tds` LEFT JOIN `tally_ledger` ON `tally_tds`.`tds_gl_code`= `tally_ledger`.`ledger_key`  WHERE `tds_key`=:key", {
                replacements: { key: tds_keys[i] },
                type: tallyDB.QueryTypes.SELECT,
              });

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
            let ven_add_stmt = await invtDB.query("SELECT `po_vendor_address` FROM `po_purchase_req` WHERE `po_transaction` = :po_transaction_id", {
              replacements: { po_transaction_id: main_stmt[i].in_po_transaction_id },
              type: invtDB.QueryTypes.SELECT,
            });
            if (ven_add_stmt.length > 0) {
              vendor_address = ven_add_stmt[0].po_vendor_address;
            }
          } else {
            vendor_address = main_stmt[i].in_vendor_addr;
          }
          // END VENDOR ADDRESS

          final_data.push({
            transaction: mins[a],
            itemCode: main_stmt[i].c_part_no,
            itemName: main_stmt[i].c_name,
            qty: main_stmt[i].qty,
            rate: main_stmt[i].in_po_rate,
            value: (Number(main_stmt[i].in_po_rate) * Number(main_stmt[i].qty)).toFixed(2),
            hsnCode: main_stmt[i].in_hsn_code,
            gstType: main_stmt[i].in_gst_type,
            gstRate: main_stmt[i].in_gst_rate,
            cgst: main_stmt[i].in_gst_cgst,
            sgst: main_stmt[i].in_gst_sgst,
            igst: main_stmt[i].in_gst_igst,
            tds: tds_option,
            venCode: main_stmt[i].in_vendor_name,
            invoiceId: invoice,
            venAddress: vendor_address,
            venName: main_stmt[i].ven_name,
            uom: main_stmt[i].units_name,
            gstin: gstin_option,
            acknowledgeIRN: main_stmt[i].ackwlg_irn,
          });
        } //End For Loop
      } else {
        return res.json({ status: "error", success: false, message: "No data Found" });
      }
    } //END MIN LOOP
    return res.json({ status: "success", success: true, data: final_data });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// ADD VBT04
router.post("/add_vbt04", [auth.isAuthorized], async (req, res) => {
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
	eff_date : "required"
  });

  if (validation.fails()) {
    return res.json({

      status: "error", success: false,
      message: validation.errors.all(),
    });
  }

  const transaction = await tallyDB.transaction();
  const transactioninvt = await invtDB.transaction();

  try {
    if (moment(req.body.invoice_date, "DD-MM-YYYY") > moment(req.body.eff_date, "DD-MM-YYYY")) {
      return res.json({ status: 'error', message: 'effective date must be greater than invoice date' });
    }
    let comp_length = req.body.component.length;
    let total_debit = 0;
    let total_credit = 0;
    let total_ven_ammount = 0;

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
        }
      );
      if (row_valid.fails()) {
        return res.json({ message: row_valid.errors.all(), status: "error", success: false });
      }
      total_debit += Number(req.body.cgsts[i]) + Number(req.body.igsts[i]) + Number(req.body.sgsts[i]) + Number(req.body.freight[i]) + Number(req.body.bill_qty[i]) * Number(req.body.in_rates[i]);

      total_credit += Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]);
    }

    if (req.body.round_type == "-") {
      total_debit -= Number(req.body.round_value);
    } else {
      total_debit += Number(req.body.round_value);
    }
    for (let i = 0; i < comp_length; i++) {
      total_ven_ammount += (Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]));
    }

    if (Math.abs(Number(req.body.bill_amount) - Number(total_ven_ammount).toFixed(2)) != 0) {
      return res.json({ status: "error", success: false, message: "Bill ammount ${req.body.bill_ammount} and Vendor amount ${total_ven_ammount} not match " });
    }

    if (Math.abs(Number(Number(total_credit).toFixed(2)) - Number(Number(total_debit).toFixed(2))) != 0) {
      return res.json({

        status: "error", success: false,
        message: `Debit(${total_debit}) And Credit Value(${total_credit}) not matched`,
      });
    }

    // NUMBURING FUN
    let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'VBT04' FOR UPDATE", {
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
      vbt_no = "VBT04/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'VBT04'", {
      type: tallyDB.QueryTypes.UPDATE,
      transaction: transaction,
    });
    // END NUMBURING FUN

    const vbt_key = vbt_no;
    const insert_data = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const effective_data = moment(req.body.eff_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD");
    const insert_by = req.logedINUser;

    let lastInsertedID;

    for (let i = 0; i < comp_length; i++) {
      let comp_key = await invtDB.query("SELECT `component_key` FROM `components` WHERE `c_part_no` = :p_no", {
        replacements: { p_no: req.body.part_code[i] },
        type: invtDB.QueryTypes.SELECT,
      });

      let findProject = await invtDB.query("SELECT in_po_transaction_id, po_project_name FROM rm_location LEFT JOIN po_purchase_req ON po_purchase_req.po_transaction = rm_location.in_po_transaction_id WHERE in_transaction_id = :min GROUP BY in_transaction_id", {
        replacements: {
          min: req.body.min_key[i],
        },
        type: invtDB.QueryTypes.SELECT,
      });

      if (findProject.length <= 0) {
        return res.json({ status: 'error', message: 'error while getting project id and number.' })
      }

      let stmt = await tallyDB.query(
        "INSERT INTO `tally_vbt` ( `part_code`, po_number, project_id, `vbt_inqty`,`vbt_bill_qty`, `vbt_inrate`, `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `freight`, `vbt_freight_gl`, `vbp_gst_ass_value`, `vbt_cgst`,`vbt_cgst_gl`, `vbt_sgst`,`vbt_sgst_gl`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `tds_code`, `tds_gl`, `vbt_ven_ammount`, `vbt_key`, `insert_by`, `insert_date`, `min_id` , inrPrice , cifPrice , cifValue ,`vbt_tds_ass_val`,`vbt_tds_amount`, `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `item_description` , billAmount) VALUES (:part_code,:po_number, :project_id, :in_qtys, :vbt_bill_qty, :in_rates, :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate,  :freight, :freight_gl, :gst_ass_vals, :cgsts, :cgsts_gl, :sgsts, :sgsts_gl, :igsts, :igsts_gl, :g_l_codes, :tds_codes, :tds_gl, :ven_amounts, :vbt_key, :insert_by, :insert_date, :min_id , :inrPrice, :cifPrice, :cifValue, :tds_ass_vals, :tds_amounts,:ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT04' , :effective_date , :item_description , :billAmount )",
        {
          replacements: {
            po_number: findProject[0].in_po_transaction_id ? findProject[0].in_po_transaction_id : "--",
            project_id: findProject[0].po_project_name ? findProject[0].po_project_name : "--",
            vbt_key: vbt_key,
            in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i],
            in_rates: req.body.in_rates[i],
            taxable_values: req.body.taxable_values[i],
            part_code: comp_key[0].component_key,
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
            which_module: "VBT04",
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
            which_module: "VBT04",
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
            which_module: "VBT04",
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
            which_module: "VBT04",
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
            which_module: "VBT04",
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
          return res.json({ status: 'error', message: 'TDS Gl not selected.' })
        }

        let insert_tds_gl_code = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
          replacements: {
            ladger_key: req.body.tds_gl_code[i],
            debit: "0",
            credit: req.body.tds_amounts[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT04",
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
          which_module: "VBT04",
          effective_date: effective_data,
          insert_by: insert_by,
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transaction,
      });

      //   UPDATE MIN STATUS
      let update_stmt = await invtDB.query("UPDATE `rm_location` SET `vbp_status` = 'Y' WHERE  `in_transaction_id` = :min AND `components_id`= :comp", {
        replacements: {
          min: req.body.min_key[i],
          comp: comp_key[0].component_key,
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
          which_module: "VBT04",
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
          which_module: "VBT04",
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
    return res.json({ status: "success", success: true, message: "Insertion Successfull" });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// VBT04 GL GROUP OPTION
router.get("/vbt04_gl_options", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT `vbt_group_key` FROM `vbt_module` WHERE `vbt_module`='vbt04'", {
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
      return res.json({ status: "error", success: false, message: "No G/L Mapping Found!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// VBT DELETE
router.post("/vbt_delete", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    vbt_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }
  const transaction = await tallyDB.transaction();
  try {
    let stmt = await tallyDB.query("UPDATE `tally_vbt` SET `vbt_status` = 'D',`deleted_by` = :deleted_by ,`deleted_date` = :deleted_date WHERE `tally_vbt`.`vbt_key` = :vbt_code", {
      replacements: {
        vbt_code: req.body.vbt_code,
        deleted_by: req.logedINUser,
        deleted_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      },
      type: tallyDB.QueryTypes.UPDATE,
      transaction: transaction,
    });
    if (stmt.length > 0) {
      let stmt1 = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_data_status` = 'D',`deleted_by` = :deleted_by ,`deleted_date` = :deleted_date WHERE `tally_ledger_data`.`module_used` = :vbt_code", {
        replacements: {
          vbt_code: req.body.vbt_code,
          deleted_by: req.logedINUser,
          deleted_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        },
        type: tallyDB.QueryTypes.UPDATE,
        transaction: transaction,
      });
      if (stmt1.length > 0) {
        await transaction.commit();
        res.json({ status: "success", success: true, message: "Voucher Deletion Success" });
      } else {
        await transaction.rollback();
        res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator" });
      }
    } else {
      await transaction.rollback();
      res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// VBT EDIT
router.post("/vbt_edit", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    vbt_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }
  try {
    let stmt = await tallyDB.query(`SELECT tally_vbt.*,components.c_part_no, components.c_name, ven_basic_detail.ven_name,gl.ladger_name as gl_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON components.component_key = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON ven_basic_detail.ven_register_id = tally_vbt.ven_code LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key WHERE vbt_key=:vbt_code AND (vbt_status != 'D' AND vbt_status != 'DE')`, {
      replacements: { vbt_code: req.body.vbt_code },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        let tds_stmt = await tallyDB.query("SELECT `tally_tds`.`tds_name`,`tally_tds`.`tds_code`,`tally_ledger`.`ladger_name`,`tally_ledger`.`code` FROM `tally_tds` LEFT JOIN `tally_ledger` ON `tally_ledger`.`ledger_key` = `tally_tds`.`tds_gl_code` WHERE `tds_key`=:tds_code ", {
          replacements: { tds_code: stmt[i].tds_code },
          type: tallyDB.QueryTypes.SELECT,
        });
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

        let pending_qty = stmt[i].vbt_bill_qty;
        let stmt_vbt_qty = await tallyDB.query("SELECT SUM(vbt_bill_qty) AS pen_qty FROM `tally_vbt` WHERE  `part_code` = :part_code AND `vbt_key` = :vbt_key AND `vbt_status` = 'DE' ", {
          replacements: {
            part_code: stmt[i].part_code,
            vbt_key: stmt[i].vbt_key,
          },
          type: tallyDB.QueryTypes.SELECT,
        });

        if (stmt_vbt_qty.length > 0) {
          pending_qty = Number(stmt[i].vbt_bill_qty) - stmt_vbt_qty[0].pen_qty;
        }

        final.push({
          item: stmt[i].part_code,
          item_code: stmt[i].c_part_no,
          item_name: stmt[i].c_name,
          inqty: stmt[i].vbt_inqty,
          bill_qty: stmt[i].vbt_bill_qty,
          inrate: stmt[i].vbt_inrate,
          pending_qty: pending_qty,
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
          invoice_no: stmt[i].vbt_invoice_no,
          ven_address: stmt[i].ven_address,
          comment: stmt[i].vbt_comment,
          invoice_date: stmt[i].vbt_invoice_date,
          gstin: stmt[i].vbt_gstin,
          effective_date: moment(stmt[i].effective_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
        });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "VBT can't be edit due to some reasone!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// DEBIT VBT04
router.post("/debit_vbt04", [auth.isAuthorized], async (req, res) => {
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

      status: "error", success: false,
      message: validation.errors.all(),
    });
  }

  const transaction = await tallyDB.transaction();

  try {
    let comp_length = req.body.component.length;
    let total_debit = 0;
    let total_credit = 0;

    for (let i = 0; i < comp_length; i++) {

      if (Number(req.body.bill_qty[i]) <= 0) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Bill QTY must be greater than zero" });
      }
      total_debit += Number(req.body.cgsts[i]) + Number(req.body.igsts[i]) + Number(req.body.sgsts[i]) + Number(req.body.freight[i]) + Number(req.body.bill_qty[i]) * Number(req.body.in_rates[i]);
      total_credit += Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]);
    }

    let total_ven_ammount = 0;
    for (let i = 0; i < comp_length; i++) {
      total_ven_ammount += Number(req.body.ven_amounts[i]);
    }

    if (Math.abs(Number(Number(total_credit).toFixed(2)) - Number(Number(total_debit).toFixed(2))) > 1) {
      return res.json({

        status: "error", success: false,
        message: `Debit(${total_debit}) And Credit Value(${total_credit}) Not Matched!!!`,
      });
    }

    // NUMBURING FUN
    let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'DEBIT'", {
      type: tallyDB.QueryTypes.SELECT,
    });
    var debit_no;
    if (stmt_number.length > 0) {
      var suffix = stmt_number[0].suffix;
      suffix = parseInt(suffix) + 1;
      suffix = suffix.toString();
      suffix = suffix.padStart(parseInt(stmt_number[0].number_length_limit), "0");

      debit_no = stmt_number[0].prefix + "/" + stmt_number[0].session + "/" + suffix;
    } else {
      let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
      debit_no = "VBT01/" + currYear + "-" + (currYear + 1) + "/0001";
    }
    // END NUMBURING FUN

    await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'DEBIT'", {
      type: tallyDB.QueryTypes.UPDATE,
      transaction: transaction,
    });

    const vbt_debit_key = debit_no;
    const insert_data = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const effective_data = moment(req.body.eff_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD");
    const insert_by = req.logedINUser;

    for (let i = 0; i < comp_length; i++) {
      const vbt_key = req.body.vbt_code[i];
      let stmt_vbt_qty = await tallyDB.query("SELECT SUM(vbt_bill_qty) as  vbt_bill_qty FROM `tally_vbt` WHERE  `part_code` = :part_code AND `vbt_key` = :vbt_key AND `vbt_status` != 'DE'", {
        replacements: {
          part_code: req.body.component[i],
          vbt_key: vbt_key,
        },
        type: tallyDB.QueryTypes.SELECT,
      });

      let stmt_debit_qty = await tallyDB.query("SELECT SUM(vbt_bill_qty) AS pen_qty FROM `tally_vbt` WHERE  `part_code` = :part_code AND `vbt_key` = :vbt_key AND `vbt_status` = 'DE' ", {
        replacements: {
          part_code: req.body.component[i],
          vbt_key: vbt_key,
        },
        type: tallyDB.QueryTypes.SELECT,
      });

      if (stmt_debit_qty.length > 0) {
        if (Number(req.body.bill_qty[i]) > Number(stmt_vbt_qty[0].vbt_bill_qty) - Number(stmt_debit_qty[0].pen_qty)) {
          await transaction.rollback();
          return res.json({ status: "error", success: false, message: "Please enter Valid Debit QTY." });
        }
      }
		
		if (moment(req.body.invoice_date[i], "DD-MM-YYYY") > moment(req.body.eff_date, "DD-MM-YYYY")) {
        return res.json({ status: 'error', message: 'effective date must be greater than invoice date' });
      }

      let findProject = await invtDB.query("SELECT in_po_transaction_id, po_project_name FROM rm_location LEFT JOIN po_purchase_req ON po_purchase_req.po_transaction = rm_location.in_po_transaction_id WHERE in_transaction_id = :min GROUP BY in_transaction_id", {
        replacements: {
          min: req.body.min_key[i],
        },
        type: invtDB.QueryTypes.SELECT,
      });

      if (findProject.length <= 0) {
        return res.json({ status: 'error', message: 'error while getting project id and number.' })
      }

      let stmt = await tallyDB.query(
        "INSERT INTO `tally_vbt` ( `part_code`, po_number, project_id, `vbt_bill_qty`, `vbt_inrate`, `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `freight`, `vbt_freight_gl`, `vbp_gst_ass_value`, `vbt_cgst`,`vbt_cgst_gl`, `vbt_sgst`,`vbt_sgst_gl`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `tds_code`, `tds_gl`, `vbt_ven_ammount`, `vbt_key`, `vbt_debit_key` , `insert_by`, `insert_date`, `min_id`,`vbt_tds_ass_val`,`vbt_tds_amount`, `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `vbt_status`) VALUES (:part_code,  :po_number, :project_id, :vbt_bill_qty, :in_rates, :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate, :freight, :freight_gl, :gst_ass_vals, :cgsts, :cgsts_gl, :sgsts, :sgsts_gl, :igsts, :igsts_gl, :g_l_codes, :tds_codes, :tds_gl, :ven_amounts, :vbt_key, :vbt_debit_key , :insert_by, :insert_date, :min_id, :tds_ass_vals, :tds_amounts, :ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT04' , :effective_date, :vbt_status )",
        {
          replacements: {
			po_number: findProject[0].in_po_transaction_id ? findProject[0].in_po_transaction_id : "--",
            project_id: findProject[0].po_project_name ? findProject[0].po_project_name : "--",
            vbt_status: "DE",
            vbt_key: vbt_key,
            vbt_debit_key: vbt_debit_key,
            // in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i],
            in_rates: req.body.in_rates[i],
            taxable_values: req.body.taxable_values[i],
            part_code: req.body.component[i],
            hsn_code: req.body.hsn_code[i],
            in_gst_types: req.body.in_gst_types[i],
            freight: req.body.freight[i],
            freight_gl: req.body.freight_gl[i] , //"TP550175734290",
            gst_ass_vals: req.body.gst_ass_vals[i],
            cgsts: req.body.cgsts[i],
            cgsts_gl: "TP833329493527",
            sgsts: req.body.sgsts[i],
            sgsts_gl: "TP169441804733",
            igsts: req.body.igsts[i],
            igsts_gl: "TP145525070328",
            g_l_codes: req.body.g_l_codes[i],
            tds_codes: req.body.tds_codes[i],
            tds_gl: req.body.tds_gl_code[i],
            tds_ass_vals: req.body.tds_ass_vals[i],
            tds_amounts: req.body.tds_amounts[i],
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
        }
      ); //End Insert VBT

      if (Number(req.body.cgsts[i]) > 0) {
        let insert_cgst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP833329493527",
            // debit: req.body.cgsts[i],
            // credit: "0",
            credit: req.body.cgsts[i],
            debit: "0",
            module_used: vbt_key,
            debit_key: vbt_debit_key,
            insert_date: insert_data,
            which_module: "VBT04",
            ledger_data_status: "DE",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }
      if (Number(req.body.igsts[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP145525070328",
            // debit: req.body.igsts[i],
            // credit: "0",
            credit: req.body.igsts[i],
            debit: "0",
            module_used: vbt_key,
            debit_key: vbt_debit_key,
            insert_date: insert_data,
            which_module: "VBT04",
            ledger_data_status: "DE",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }
      if (Number(req.body.sgsts[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP169441804733",
            // debit: req.body.sgsts[i],
            // credit: "0",
            credit: req.body.sgsts[i],
            debit: "0",
            module_used: vbt_key,
            debit_key: vbt_debit_key,
            insert_date: insert_data,
            which_module: "VBT04",
            ledger_data_status: "DE",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }
      if (Number(req.body.freight[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)", {
          replacements: {
            ladger_key: req.body.freight_gl[i],//"TP550175734290",
            // debit: req.body.freight[i],
            // credit: "0",
            credit: req.body.freight[i],
            debit: "0",
            module_used: vbt_key,
            debit_key: vbt_debit_key,
            insert_date: insert_data,
            which_module: "VBT04",
            ledger_data_status: "DE",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }
      // GL
      if (Number(req.body.taxable_values[i]) > 0) {
        if (req.body.g_l_codes[i] == "--") {
          await transaction.rollback();
          return res.json({

            status: "error", success: false,
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
              which_module: "VBT04",
              ledger_data_status: "DE",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );
      }
      if (req.body.tds_amounts[i] != 0) {
        if (req.body.tds_gl_code[i] == "--") {
          await transaction.rollback();
          await transactioninvt.rollback();
          return res.json({

            status: "error", success: false,
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
              which_module: "VBT04",
              ledger_data_status: "DE",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );
      }
      // VENDOR
      let insert_ven_gl = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit, credit, module_used, debit_key , insert_date, which_module, ledger_data_status , ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :debit_key , :insert_date, :which_module, :ledger_data_status , :effective_date, :insert_by)", {
        replacements: {
          ladger_key: req.body.ven_code,
          // debit: "0",
          // credit: req.body.ven_amounts[i],
          credit: "0",
          debit: req.body.ven_amounts[i],
          module_used: vbt_key,
          debit_key: vbt_debit_key,
          insert_date: insert_data,
          which_module: "VBT04",
          ledger_data_status: "DE",
          effective_date: effective_data,
          insert_by: insert_by,
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transaction,
      });
    } //END FOR LOOP

    await transaction.commit();
    return res.json({

      status: "success", success: true,
      message: "Insertion Successfull",
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//vbt 4 update api
router.put("/update", [auth.isAuthorized], async (req, res) => {
  const transaction = await tallyDB.transaction();


  try {
    let validation = new Validator(req.body, {
      vbtKey: "required",
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
    });

    if (validation.fails()) {
      return res.status(403).send(Object.values(validation.errors.all())[0].join());
    }

    let checkSettled = await tallyDB.query("SELECT * FROM tally_ap WHERE ap_ref_no = :vbtKey", {
      replacements: {
        vbtKey: req.body.vbtKey
      },
      type: tallyDB.QueryTypes.SELECT
    });

    if (checkSettled.length > 0) {
      return res.json({ status: "error", success: false, message: "Oops ! This VBT is already settled" });
    }

    if (moment(req.body.invoice_date, "DD-MM-YYYY") > moment(req.body.eff_date, "DD-MM-YYYY")) {
      return res.json({ status: "error", success: false, message: "Invoice date cannot be greater than effective date" });
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
        }
      );
      if (row_valid.fails()) {
        return res.status(403).send(Object.values(row_valid.errors.all())[0].join());
      }
      total_debit += Number(req.body.cgsts[i]) + Number(req.body.igsts[i]) + Number(req.body.sgsts[i]) + Number(req.body.freight[i]) + Number(req.body.bill_qty[i]) * Number(req.body.in_rates[i]);

      total_credit += Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]);
    }

    if (req.body.roundOffSign == "-") {
      total_debit -= Number(req.body.roundOffValue);
    } else {
      total_debit += Number(req.body.roundOffValue);
    }

    let total_ven_ammount = 0;
    for (let i = 0; i < comp_length; i++) {
      total_ven_ammount += (Number(req.body.ven_amounts[i]) + Number(req.body.tds_amounts[i]));
    }

    if (Math.abs(Number(req.body.bill_amount) - Number(total_ven_ammount).toFixed(2)) != 0) {
      return res.status(403).send(`Bill amount ${req.body.bill_ammount} and Vendor amount ${total_ven_ammount} are not equal`);
    }

    if (Math.abs(Number(Number(total_credit).toFixed(2)) - Number(Number(total_debit).toFixed(2))) != 0) {
      return res.status(403).send(`Debit ${total_debit} and Credit ${total_credit} are not equal`);
    }

    const vbt_key = req.body.vbtKey;
    const updatedAt = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const updatedBy = req.logedINUser;

    const insert_data = req.body.insertDate;
    const insert_by = req.body.insertBy;

    const effective_data = moment(req.body.eff_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD");

    let deleteVbt = await tallyDB.query("DELETE FROM tally_vbt WHERE vbt_key = :vbtKey AND vbt_type = 'VBT04' AND vbt_debit_key = '--'", {
      replacements: { vbtKey: vbt_key },
      type: tallyDB.QueryTypes.DELETE,
      transaction: transaction
    });

    let deleteTallyLedgerData = await tallyDB.query("DELETE FROM tally_ledger_data WHERE module_used = :vbtKey AND which_module = 'VBT04' AND debit_key = '--'", {
      replacements: { vbtKey: vbt_key },
      type: tallyDB.QueryTypes.DELETE,
      transaction: transaction
    });

    let lastInsertedID;

    for (let i = 0; i < comp_length; i++) {
      let comp_key = await invtDB.query("SELECT `component_key` FROM `components` WHERE `c_part_no` = :p_no", {
        replacements: { p_no: req.body.part_code[i] },
        type: invtDB.QueryTypes.SELECT,
      });

      let stmt = await tallyDB.query(
        "INSERT INTO `tally_vbt` ( `part_code`, po_number, project_id, `vbt_inqty`,`vbt_bill_qty`, `vbt_inrate`, `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `freight`, `vbt_freight_gl`, `vbp_gst_ass_value`, `vbt_cgst`,`vbt_cgst_gl`, `vbt_sgst`,`vbt_sgst_gl`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `tds_code`, `tds_gl`, `vbt_ven_ammount`, `vbt_key`, `insert_by`, `insert_date`, `min_id` , inrPrice , cifPrice , cifValue ,`vbt_tds_ass_val`,`vbt_tds_amount`, `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `item_description` , update_date , update_by , billAmount ) VALUES (:part_code,:po_number, :project_id, :in_qtys, :vbt_bill_qty, :in_rates, :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate,  :freight, :freight_gl, :gst_ass_vals, :cgsts, :cgsts_gl, :sgsts, :sgsts_gl, :igsts, :igsts_gl, :g_l_codes, :tds_codes, :tds_gl, :ven_amounts, :vbt_key, :insert_by, :insert_date, :min_id , :inrPrice, :cifPrice, :cifValue, :tds_ass_vals, :tds_amounts,:ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT04' , :effective_date , :item_description , :update_date , :update_by , :billAmount)",
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
            item_description: req.body.item_description?.[i] ? req.body.item_description[i] : "",
            update_date: updatedAt,
            update_by: updatedBy,
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
            which_module: "VBT04",
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
            which_module: "VBT04",
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
            which_module: "VBT04",
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
            which_module: "VBT04",
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
            which_module: "VBT04",
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
          return res.json({ status: "error", success: false, message: "TDS Gl not selected" });
        }

        let insert_tds_gl_code = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
          replacements: {
            ladger_key: req.body.tds_gl_code[i],
            debit: "0",
            credit: req.body.tds_amounts[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT04",
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
          which_module: "VBT04",
          effective_date: effective_data,
          insert_by: insert_by,
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transaction,
      });
    } //END FOR LOOP

    if (lastInsertedID) {
      await tallyDB.query("UPDATE tally_vbt SET round_off_sign = :round_off_sign , round_off_amt = :round_off_amt , round_off_gl = :round_off_gl WHERE ID = :id", {
        replacements: {
          id: lastInsertedID,
          round_off_sign: req.body.roundOffSign ?? "--",
          round_off_amt: req.body.roundOffValue ?? "",
          round_off_gl: "TP558350023869",
        },
        type: tallyDB.QueryTypes.UPDATE,
        transaction: transaction
      })
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
          which_module: "VBT04",
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
          which_module: "VBT04",
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
    return res.json({ status: "error", success: false, message: "VBT updated successfully" });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

module.exports = router;

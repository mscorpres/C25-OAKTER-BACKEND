const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");

// VBTJW // JOBWORK
router.post("/fetch_vbtjw", [auth.isAuthorized], async (req, res) => {
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
        "SELECT `rm_location`.`insert_date` AS `min_in_date`, `rm_location`.`in_transaction_id` AS `min_transaction`, rm_location.vbp_status, `components`.`c_part_no` AS `part_code`, `rm_location`.`in_vendor_name` AS `ven_code`, `ven_basic_detail`.`ven_name` FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id=components.component_key LEFT JOIN `ven_basic_detail` ON  rm_location.in_vendor_name=ven_basic_detail.ven_register_id  WHERE `trans_type`='INWARD' AND DATE_FORMAT(rm_location.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND (`rm_location`.`vendor_type` = 'j01' OR `rm_location`.`vendor_type` = 'v01' ) AND `rm_location`.`vbp_status` IN ('N', 'NOTELIGIBLE') ORDER BY `rm_location`.`ID` DESC",
        {
          replacements: { date1: date1, date2: date2 },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "vendor_wise") {
      main_stmt = await invtDB.query(
        "SELECT `rm_location`.`insert_date` AS `min_in_date`, `rm_location`.`in_transaction_id` AS `min_transaction`, rm_location.vbp_status, `components`.`c_part_no` AS `part_code`, `rm_location`.`in_vendor_name` AS `ven_code`, `ven_basic_detail`.`ven_name` FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id=components.component_key LEFT JOIN `ven_basic_detail` ON  rm_location.in_vendor_name=ven_basic_detail.ven_register_id  WHERE `trans_type`='INWARD' AND `in_vendor_name` = :ven AND (`rm_location`.`vendor_type` = 'j01' OR `rm_location`.`vendor_type` = 'v01' ) AND `rm_location`.`vbp_status` IN ('N', 'NOTELIGIBLE') GROUP BY `rm_location`.`in_transaction_id` ORDER BY rm_location.ID",
        {
          replacements: { ven: data },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "min_wise") {
      main_stmt = await invtDB.query(
        "SELECT `rm_location`.`insert_date` AS `min_in_date`, `rm_location`.`in_transaction_id` AS `min_transaction`, rm_location.vbp_status, `components`.`c_part_no` AS `part_code`, `rm_location`.`in_vendor_name` AS `ven_code`, `ven_basic_detail`.`ven_name` FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id=components.component_key LEFT JOIN `ven_basic_detail` ON  rm_location.in_vendor_name=ven_basic_detail.ven_register_id  WHERE `trans_type`='INWARD' AND `in_transaction_id` = :min AND (`rm_location`.`vendor_type` = 'j01' OR `rm_location`.`vendor_type` = 'v01' ) AND `rm_location`.`vbp_status` IN ('N', 'NOTELIGIBLE') ORDER BY rm_location.ID",
        {
          replacements: { min: data },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "jw") {
      main_stmt = await invtDB.query(
        "SELECT `rm_location`.`insert_date` AS `min_in_date`, `rm_location`.`in_transaction_id` AS `min_transaction`, rm_location.vbp_status, `components`.`c_part_no` AS `part_code`, `rm_location`.`in_vendor_name` AS `ven_code`, `ven_basic_detail`.`ven_name` FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id=components.component_key LEFT JOIN `ven_basic_detail` ON  rm_location.in_vendor_name=ven_basic_detail.ven_register_id  WHERE `trans_type`='INWARD' AND `rm_location`.`in_jw_transaction_id` = :jw AND `rm_location`.`vbp_status` IN ('N', 'NOTELIGIBLE') ORDER BY rm_location.ID",
        {
          replacements: { jw: data },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    let final = [];

    if (main_stmt.length > 0) {
      let pending = [];
      let nonPending = [];
      for (let i = 0; i < main_stmt.length; i++) {
        main_stmt[i].vbp_status = main_stmt[i].vbp_status == 'N' ? 'PENDING' : main_stmt[i].vbp_status == 'NOTELIGIBLE' ? 'DISABLED' : 'PROCESSED';
        main_stmt[i].min_in_date = moment(main_stmt[i].min_in_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY");

        if (main_stmt[i].vbp_status === 'PENDING') {
          pending.push(main_stmt[i]);
        } else {
          nonPending.push(main_stmt[i]);
        }
      }

      return res.json({ status: "success", success: true, data: pending, disable: nonPending });
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
      "SELECT `jw_po_vendor_address`, `c_part_no`, `c_name`, `qty`, `in_po_rate`, `in_hsn_code`, `in_gst_type`, `in_gst_rate`, `in_gst_cgst`, `in_gst_sgst`, `in_gst_igst`, `in_vendor_name`, `in_vendor_addr`, `in_invoice_id`, `in_po_invoice_id`, `in_jw_invoice_id`, `ven_basic_detail`.`ven_tds`, `ven_basic_detail`.`ven_name`, `units_name`, `in_po_transaction_id` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `ven_basic_detail` ON `rm_location`.`in_vendor_name` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `jw_purchase_req` ON `jw_purchase_req`.`jw_jw_transaction` = `rm_location`.`in_jw_transaction_id` WHERE `in_transaction_id` = :min_id AND `rm_location`.`trans_type` = 'INWARD'",
      {
        replacements: { min_id: req.body.min_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (main_stmt.length > 0) {
      let final_data = [];
      for (let i = 0; i < main_stmt.length; i++) {
        // GST
        //let gst_type;
        //if (main_stmt[i].in_gst_type == "I") {
          //gst_type = "Inter State";
        //} else if (main_stmt[i].in_gst_type == "L") {
         // gst_type = "Local";
        //} else {
         // gst_type = main_stmt[i].in_gst_type;
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
            let tds_data = await tallyDB.query("SELECT tds_name, tds_percent, tds_key, tds_code, tds_gl_code, ladger_name, ledger_key FROM `tally_tds` LEFT JOIN `tally_ledger` ON `tally_tds`.`tds_gl_code`= `tally_ledger`.`ledger_key`  WHERE `tds_key`=:key", {
              replacements: { key: tds_keys[k] },
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
          in_vendor_addr: main_stmt[i].jw_po_vendor_address,
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
    let final_data = [];
    for (let a = 0; a < mins.length; a++) {
      let main_stmt = await invtDB.query(
        "SELECT `jw_po_vendor_address`, `c_part_no`, `c_name`, `qty`, `in_po_rate`, `in_hsn_code`, `in_gst_type`, `in_gst_rate`, `in_gst_cgst`, `in_gst_sgst`, `in_gst_igst`, `in_vendor_name`, `in_vendor_addr`, `in_invoice_id`, `in_po_invoice_id`, `in_jw_invoice_id`, `ven_basic_detail`.`ven_tds`, `ven_basic_detail`.`ven_name`, `units_name`, `in_po_transaction_id` , ackwlg_irn FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `ven_basic_detail` ON `rm_location`.`in_vendor_name` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `jw_purchase_req` ON `jw_purchase_req`.`jw_jw_transaction` = `rm_location`.`in_jw_transaction_id` WHERE `in_transaction_id` = :min_id AND `rm_location`.`trans_type` = 'INWARD' ",
        {
          replacements: { min_id: mins[a] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (main_stmt.length > 0) {
        for (let i = 0; i < main_stmt.length; i++) {
          // GST
          //let gst_type;
          //if (main_stmt[i].in_gst_type == "I") {
            //gst_type = "Inter State";
          //} else if (main_stmt[i].in_gst_type == "L") {
           // gst_type = "Local";
          //} else {
           // gst_type = main_stmt[i].in_gst_type;
          //}

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
            venAddress: main_stmt[i].jw_po_vendor_address,
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

// ADD VBT JW
router.post("/add_vbt06", [auth.isAuthorized], async (req, res) => {
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
    return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
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

    let total_ven_ammount = 0;
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
    let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'VBT06' FOR UPDATE", {
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
      vbt_no = "VBT06/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'VBT06'", {
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
      let comp_key = await invtDB.query("SELECT component_key FROM components WHERE c_part_no= :p_no", {
        replacements: { p_no: req.body.part_code[i] },
        type: invtDB.QueryTypes.SELECT,
      });

      let findProject = [{ in_jw_transaction_id: null, jw_project_name: null }];
      if (req.body.min_key[i] != "") {
        findProject = await invtDB.query("SELECT in_jw_transaction_id, jw_project_name FROM rm_location LEFT JOIN jw_purchase_req ON jw_purchase_req.jw_jw_transaction = rm_location.in_jw_transaction_id WHERE in_transaction_id = :min GROUP BY in_transaction_id", {
          replacements: {
            min: req.body.min_key[i],
          },
          type: invtDB.QueryTypes.SELECT,
        });

        if (findProject.length <= 0) {
          return res.json({ status: 'error', message: 'error while getting project id and number.' })
        }
      }

      let stmt = await tallyDB.query(
        "INSERT INTO `tally_vbt` ( `part_code`, project_id, jw_id, `vbt_inqty`,`vbt_bill_qty`, `vbt_inrate`, `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `vbp_gst_ass_value`, `vbt_cgst`,`vbt_cgst_gl`, `vbt_sgst`,`vbt_sgst_gl`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `tds_code`, `tds_gl`, `vbt_ven_ammount`, `vbt_key`, `insert_by`, `insert_date`, `min_id` , inrPrice , cifPrice , cifValue ,`vbt_tds_ass_val`,`vbt_tds_amount`, `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `item_description` , billAmount) VALUES (:part_code, :project_id, :jw_id, :in_qtys, :vbt_bill_qty, :in_rates, :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate,   :gst_ass_vals, :cgsts, :cgsts_gl, :sgsts, :sgsts_gl, :igsts, :igsts_gl, :g_l_codes, :tds_codes, :tds_gl, :ven_amounts, :vbt_key, :insert_by, :insert_date, :min_id , :inrPrice, :cifPrice, :cifValue, :tds_ass_vals, :tds_amounts,:ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT06' , :effective_date , :item_description , :billAmount)",
        {
          replacements: {
            jw_id: findProject[0].in_jw_transaction_id ? findProject[0].in_jw_transaction_id : "--",
            project_id: findProject[0].jw_project_name ? findProject[0].jw_project_name : "--",
            vbt_key: vbt_key,
            in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i],
            in_rates: req.body.in_rates[i],
            taxable_values: req.body.taxable_values[i],
            part_code: comp_key[0].component_key,
            hsn_code: req.body.hsn_code[i],
            in_gst_types: req.body.in_gst_types[i],
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
            ven_amounts: req.body.ven_amounts[i],
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
            which_module: "VBT06",
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
            which_module: "VBT06",
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
            which_module: "VBT06",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }
      // if (req.body.comp_key[i] === "Ser002") {
      //   let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
      //     replacements: {
      //       ladger_key: "TP550175734290",
      //       debit: req.body.req.body.in_rates[i],
      //       credit: "0",
      //       module_used: vbt_key,
      //       insert_date: insert_data,
      //       which_module: "VBT06",
      //       effective_date: effective_data,
      //       insert_by: insert_by,
      //     },
      //     type: tallyDB.QueryTypes.INSERT,
      //     transaction: transaction,
      //   });
      // }

      // GL
      if (Number(req.body.taxable_values[i]) > 0) {
        let insert_gst_ass_vals = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
          replacements: {
            ladger_key: req.body.g_l_codes[i],
            debit: req.body.taxable_values[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT06",
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
          await transactioninvt.rollback();
          return res.json({ status: "error", success: false, message: "Invalid TDS selection" });
        }
        let insert_tds_gl_code = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
          replacements: {
            ladger_key: req.body.tds_gl_code[i],
            debit: "0",
            credit: req.body.tds_amounts[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT06",
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
          credit: req.body.ven_amounts[i],
          module_used: vbt_key,
          insert_date: insert_data,
          which_module: "VBT06",
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
          which_module: "VBT06",
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
          which_module: "VBT06",
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

// VBT06 GL GROUP OPTION
router.get("/vbt06_gl_options", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT `vbt_group_key` FROM `vbt_module` WHERE `vbt_module`='vbt06'", {
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
      return res.json({ status: "error", success: false, message: "No G/L Mapping Found!!!" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//vbt06 update api
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
      invoice_no: "required",
      vbtKey: "required",
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

    let deleteVbt = await tallyDB.query("DELETE FROM tally_vbt WHERE vbt_key = :vbtKey AND vbt_type = 'VBT06' AND vbt_debit_key = '--'", {
      replacements: { vbtKey: vbt_key },
      type: tallyDB.QueryTypes.DELETE,
      transaction: transaction
    });

    let deleteTallyLedgerData = await tallyDB.query("DELETE FROM tally_ledger_data WHERE module_used = :vbtKey AND which_module = 'VBT06' AND debit_key = '--'", {
      replacements: { vbtKey: vbt_key },
      type: tallyDB.QueryTypes.DELETE,
      transaction: transaction
    });

    let lastInsertedID;

    for (let i = 0; i < comp_length; i++) {
      let comp_key = await invtDB.query("SELECT component_key FROM components WHERE c_part_no= :p_no", {
        replacements: { p_no: req.body.part_code[i] },
        type: invtDB.QueryTypes.SELECT,
      });

      let stmt = await tallyDB.query(
        "INSERT INTO `tally_vbt` ( `part_code`, project_id, jw_id, `vbt_inqty`,`vbt_bill_qty`, `vbt_inrate`, `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `vbp_gst_ass_value`, `vbt_cgst`,`vbt_cgst_gl`, `vbt_sgst`,`vbt_sgst_gl`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `tds_code`, `tds_gl`, `vbt_ven_ammount`, `vbt_key`, `insert_by`, `insert_date`, `min_id` , inrPrice , cifPrice , cifValue ,`vbt_tds_ass_val`,`vbt_tds_amount`, `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `item_description` , update_date , update_by , billAmount) VALUES (:part_code, :project_id, :jw_id, :in_qtys, :vbt_bill_qty, :in_rates, :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate,   :gst_ass_vals, :cgsts, :cgsts_gl, :sgsts, :sgsts_gl, :igsts, :igsts_gl, :g_l_codes, :tds_codes, :tds_gl, :ven_amounts, :vbt_key, :insert_by, :insert_date, :min_id , :inrPrice, :cifPrice, :cifValue, :tds_ass_vals, :tds_amounts,:ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT06' , :effective_date , :item_description , :update_date , :update_by , :billAmount)",
        {
          replacements: {
            jw_id: req.body.jwID?.[i] ? req.body.jwID[i] : "--",
            project_id: req.body.projectID?.[i] ? req.body.projectID[i] : "",
            vbt_key: vbt_key,
            in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i],
            in_rates: req.body.in_rates[i],
            taxable_values: req.body.taxable_values[i],
            part_code: comp_key[0].component_key,
            hsn_code: req.body.hsn_code[i],
            in_gst_types: req.body.in_gst_types[i],
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
            which_module: "VBT06",
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
            which_module: "VBT06",
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
            which_module: "VBT06",
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
            which_module: "VBT06",
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
            which_module: "VBT06",
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
          credit: req.body.ven_amounts[i],
          module_used: vbt_key,
          insert_date: insert_data,
          which_module: "VBT06",
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
          which_module: "VBT06",
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
          which_module: "VBT06",
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

const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");

// VBT03 // PURCHASE GOODS
// FETCH VBT
router.post("/fetch_vbt03", [auth.isAuthorized], async (req, res) => {
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
        //let gst_type;
        //if (main_stmt[i].in_gst_type == "I") {
          //gst_type = "Inter State";
        //} else if (main_stmt[i].in_gst_type == "L") {
          //gst_type = "Local";
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
        "SELECT `c_part_no`, `c_name`, `qty`, `in_po_rate`, `in_hsn_code`, `in_gst_type`, `in_gst_rate`, `in_gst_cgst`, `in_gst_sgst`, `in_gst_igst`,`in_vendor_name`,`in_vendor_addr`,`in_invoice_id`,`in_po_invoice_id`,`in_jw_invoice_id`,`ven_basic_detail`.`ven_tds`,`ven_basic_detail`.`ven_name`,`units_name`,`in_po_transaction_id` , ackwlg_irn FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom`=`units`.`units_id` LEFT JOIN `ven_basic_detail` ON `rm_location`.`in_vendor_name`=`ven_basic_detail`.`ven_register_id`  WHERE `in_transaction_id` = :min_id AND `rm_location`.`trans_type` = 'INWARD'",
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
          //let gst_type;
          //if (main_stmt[i].in_gst_type == "I") {
            //gst_type = "Inter State";
          //} else if (main_stmt[i].in_gst_type == "L") {
            //gst_type = "Local";
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
            tds_keys.map(async (tds_key) => {
              let tds_data = await tallyDB.query("SELECT tds_name, tds_percent, tds_key, tds_code, tds_gl_code, ladger_name, ledger_key FROM `tally_tds` LEFT JOIN `tally_ledger` ON `tally_tds`.`tds_gl_code`= `tally_ledger`.`ledger_key`  WHERE `tds_key`=:key", {
                replacements: { key: tds_key },
                type: tallyDB.QueryTypes.SELECT,
              });

              if (tds_data.length > 0) {
                tds_data.map((data) => {
                  tds_option.push(data);
                });
              }
            });
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

// ADD VBT03
router.post("/add_vbt03", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    ven_code: "required",
    ven_address: "required",
    invoice_no: "required",
    invoice_date: "required",
    comment: "required",
    vbt_gstin: "required",
    invoice_no: "required",
    eff_date: "required",
    bill_amount: "required",
    inrPrice: "required",
    cifPrice: "required",
    cifValue: "required",
  });

  if (validation.fails()) {
    return res.status(403).send(Object.values(validation.errors.all())[0].join());
  }

  const transaction = await tallyDB.transaction();
  const transactioninvt = await invtDB.transaction();

  try {
    if (moment(req.body.invoice_date, "DD-MM-YYYY") > moment(req.body.eff_date, "DD-MM-YYYY")) {
      return res.json({ status: "error", success: false, message: "effective date must be greater than invoice date" });
    }
    let comp_length = req.body.component.length;

    // Numbering Function
    let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'VBT03' FOR UPDATE", {
      type: tallyDB.QueryTypes.SELECT,
      transaction: transaction
    });
    var vbt_key;
    if (stmt_number.length > 0) {
      var suffix = stmt_number[0].suffix;
      suffix = parseInt(suffix) + 1;
      suffix = suffix.toString();
      suffix = suffix.padStart(parseInt(stmt_number[0].number_length_limit), "0");

      vbt_key = stmt_number[0].prefix + "/" + stmt_number[0].session + "/" + suffix;
    } else {
      let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
      vbt_key = "VBT03/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'VBT03'", {
      type: tallyDB.QueryTypes.UPDATE,
      transaction: transaction,
    });
    // END Numbering Function

    const insert_data = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const effective_data = moment(req.body.eff_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD");

    if (effective_data == "Invalid date") {
      await transaction.rollback();
      await transactioninvt.rollback();
      return res.json({ status: "error", success: false, message: "Invalid Effective Date" });
    }

    const insert_by = req.logedINUser;
    for (let i = 0; i < comp_length; i++) {
      let comp_key = await invtDB.query("SELECT `component_key` FROM `components` WHERE `c_part_no` = :p_no", {
        replacements: { p_no: req.body.part_code[i] },
        type: invtDB.QueryTypes.SELECT,
      });

       let purchaseImport = Number(req.body.ven_amounts[i]) + Number(req.body.freight[i]) + Number(req.body.custom_duty[i])+ Number(req.body.other_charges[i]) + Number(req.body.sws[i]);
      let findProject = await invtDB.query("SELECT in_po_transaction_id, po_project_name FROM rm_location LEFT JOIN po_purchase_req ON po_purchase_req.po_transaction = rm_location.in_po_transaction_id WHERE in_transaction_id = :min GROUP BY in_transaction_id", {
        replacements: {
          min: req.body.min_key[i],
        },
        type: invtDB.QueryTypes.SELECT,
      });

      if (findProject.length <= 0) {
        return res.json({ status: "error", success: false, message: "error while getting project id and number." });
      }

      let stmt = await tallyDB.query(
        "INSERT INTO `tally_vbt` ( `part_code`, po_number, project_id, `vbt_inqty`,`vbt_bill_qty`, `vbt_inrate` , `currency_type`, `exchange_rate` , `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `freight`, `vbt_freight_gl`, `vbp_gst_ass_value`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `vbt_ven_ammount`, `vbt_key`, `insert_by`, `insert_date`, `min_id` , inrPrice , cifPrice , cifValue , `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `insurance_value` ,`custom_duty`, `sws` , misc , `other_charges` ,`vbt_other_data` , `item_description` , billAmount ) VALUES (:part_code, :po_number, :project_id, :in_qtys, :vbt_bill_qty, :in_rates, :currency , :exchange  , :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate,  :freight, :freight_gl, :gst_ass_vals, :igsts, :igsts_gl, :g_l_codes, :ven_amounts, :vbt_key, :insert_by, :insert_date, :min_id, :inrPrice, :cifPrice, :cifValue, :ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT03' , :effective_date, :insurance_value , :custom_duty , :sws , :misc , :other_charges , :other_data , :item_description , :billAmount )",
        {
          replacements: {
            po_number: findProject[0].in_po_transaction_id ? findProject[0].in_po_transaction_id : "--",
            project_id: findProject[0].po_project_name ? findProject[0].po_project_name : "--",
            vbt_key: vbt_key,
            in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i],
            in_rates: req.body.in_rates[i],
            currency: req.body.currency[i],
            exchange: req.body.currency[i] == "364907247" ? 1 : req.body.exchange[i],
            taxable_values: req.body.taxable_values[i],
            part_code: comp_key[0].component_key,
            hsn_code: req.body.hsn_code[i],
            in_gst_types: req.body.in_gst_types[i],
            freight: req.body.freight[i],
            freight_gl: "TP22091214202", //Freight Inward - Import

            insurance_value: req.body.insurance[i],
            custom_duty: req.body.custom_duty[i],
            sws: req.body.sws[i],
            misc: req.body.misc[i],
            other_charges: req.body.other_charges[i],

            gst_ass_vals: req.body.gst_ass_vals[i],
            vbt_gst_rate: req.body.vbp_gst_rate[i],
            igsts: req.body.igsts[i],
            igsts_gl: "TP230116154346", //Custom Duty Icegate(IGST Input)
            g_l_codes: req.body.g_l_codes[i],

            ven_amounts: req.body.ven_amounts[i],
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
            other_data: JSON.stringify({
              port_code: req.body.port_code,
              port_name: req.body.port_name,
              boe_no: req.body.boe_no,
              boe_date: req.body.boe_date,
              cha: req.body.cha,
              hawb_no: req.body.hawb_no,
              mawb_no: req.body.mawb_no,
            }),
            item_description: req.body.item_description?.[i] ? req.body.item_description[i] : "",
            billAmount: req.body.bill_amount,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      ); //End Insert VBT

      // Custom Duty
      if (Number(req.body.custom_duty[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP113287468529",
            debit: "0",
            credit: req.body.custom_duty[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }
		
		      // Custum Duty For Other Charge
      if (Number(req.body.other_charges[i]) > 0) {
        let insert_igst = await tallyDB.query(
          "INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)",
          {
            replacements: {
              ladger_key: "TP113287468529",
              debit: "0",
              credit: req.body.other_charges[i],
              module_used: vbt_key,
              insert_date: insert_data,
              which_module: "VBT03",
              effective_date: effective_data,
              insert_by: insert_by,
            },
            type: tallyDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );
      }

      // Custom Duty FOR SWS
      if (Number(req.body.sws[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP113287468529",
            debit: "0",
            credit: req.body.sws[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }


      // MISC AD
      if (Number(req.body.misc[i]) > 0) {
        let misc_debit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230214145235",
            debit: req.body.misc[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
        let misc_credit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230214145235",
            debit: "0",
            credit: req.body.misc[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // Custom Duty Icegate (IGST Input) ** FOR GST
      if (Number(req.body.igsts[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230116154346",
            debit: "0",
            credit: req.body.igsts[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // IGST INPUT (Import)
      if (Number(req.body.igsts[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES ( :ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP857253446030",
            debit: req.body.igsts[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // Insurance Exp-Import
      if (Number(req.body.insurance[i]) > 0) {
        let insert_insurance_debit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230213105740",
            debit: req.body.insurance[i],
            credit: 0,
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
        let insert_insurance_credit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230213105740",
            debit: 0,
            credit: req.body.insurance[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // Freight Inward - Import
      if (Number(req.body.freight[i]) > 0) {
        let insert_freight = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP22091214202",
            debit: "0",
            credit: req.body.freight[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // GL
      if (Number(purchaseImport) > 0) {
        let insert_gst_ass_vals = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
          replacements: {
            ladger_key: req.body.g_l_codes[i],
            debit: purchaseImport,
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
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
          which_module: "VBT03",
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

    await transaction.commit();
    await transactioninvt.commit();
    return res.json({ status: "error", success: false, message: "Insertion Successfull" });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// VBT03 GL GROUP OPTION
router.get("/vbt03_gl_options", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT `vbt_group_key` FROM `vbt_module` WHERE `vbt_module`='VBT03'", {
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      if (stmt[0].vbt_group_key == null) {
        return res.json({ status: "error", success: false, message: "G/L Account not mapped!!!" });
      }
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

// VBT EDIT
router.post("/vbt_edit", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    vbt_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }
  try {
    let stmt = await tallyDB.query(`SELECT tally_vbt.*,components.c_part_no, components.c_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON components.component_key = tally_vbt.part_code WHERE vbt_key=:vbt_code AND (vbt_status != 'D' AND vbt_status != 'DE')`, {
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

        final.push({
          item: stmt[i].part_code,
          item_code: stmt[i].c_part_no,
          item_name: stmt[i].c_name,
          inqty: stmt[i].vbt_inqty,
          bill_qty: stmt[i].vbt_bill_qty,
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

// VBT DEBIT NODE
router.post("/add_vbt03", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    ven_code: "required",
    ven_address: "required",
    invoice_no: "required",
    invoice_date: "required",
    comment: "required",
    vbt_gstin: "required",
    invoice_no: "required",
  });

  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  const transaction = await tallyDB.transaction();
  const transactioninvt = await invtDB.transaction();

  try {
    let comp_length = req.body.component.length;

    // let total_debit = 0;
    // let total_credit = 0;

    // for (let i = 0; i < comp_length; i++) {
    //   total_debit += Number(req.body.gst_ass_vals[i]);
    //   total_credit += Number(req.body.insurance[i]) + Number(req.body.ven_amounts[i]) + Number(req.body.freight[i]) + Number(req.body.custom_duty[i]);
    // }

    // if (Number(Number(total_credit).toFixed(2)) != Number(Number(total_debit).toFixed(2))) {
    //   return res.json({
    //
    //     status: "error", success: false,
    //     message: {
    //       msg: `Debit(${Number(total_debit).toFixed(2)}) And Credit Value(${Number(total_credit).toFixed(2)}) Not Matched!!!`,
    //     },
    //   });
    // }
    // NUMBURING FUN
    let stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = 'VBT03'", {
      type: tallyDB.QueryTypes.SELECT,
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
      vbt_no = "VBT03/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    await tallyDB.query("UPDATE `tally_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'VBT03'", {
      type: tallyDB.QueryTypes.UPDATE,
      transaction: transaction,
    });
    // END NUMBURING FUN

    const vbt_key = vbt_no;
    const insert_data = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const effective_data = moment(req.body.eff_date, "DD-MM-YYYYY").tz("Asia/Kolkata").format("YYYY-MM-DD");

    if (effective_data == "Invalid date") {
      await transaction.rollback();
      await transactioninvt.rollback();
      return res.json({ status: "error", success: false, message: "Invalid Effective Date" });
    }

    const insert_by = req.logedINUser;
    for (let i = 0; i < comp_length; i++) {
      let comp_key = await invtDB.query("SELECT `component_key` FROM `components` WHERE `c_part_no` = :p_no", {
        replacements: { p_no: req.body.part_code[i] },
        type: invtDB.QueryTypes.SELECT,
      });
      let stmt = await tallyDB.query(
        "INSERT INTO `tally_vbt` ( `part_code`, `vbt_inqty`,`vbt_bill_qty`, `vbt_inrate` , `currency_type`, `exchange_rate` , `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `freight`, `vbt_freight_gl`, `vbp_gst_ass_value`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `vbt_ven_ammount`, `vbt_key`, `insert_by`, `insert_date`, `min_id`, `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `insurance_value` ,`custom_duty`, `sws` , `other_charges` ,`vbt_other_data`  ) VALUES (:part_code, :in_qtys, :vbt_bill_qty, :in_rates, :currency , :exchange  , :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate,  :freight, :freight_gl, :gst_ass_vals, :igsts, :igsts_gl, :g_l_codes, :ven_amounts, :vbt_key, :insert_by, :insert_date, :min_id, :ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT03' , :effective_date, :insurance_value , :custom_duty , :sws , :other_charges , :other_data )",
        {
          replacements: {
            vbt_key: vbt_key,
            in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i],
            in_rates: req.body.in_rates[i],
            currency: req.body.currency[i],
            exchange: req.body.currency[i] == "364907247" ? 1 : req.body.exchange[i],
            taxable_values: req.body.taxable_values[i],
            part_code: comp_key[0].component_key,
            hsn_code: req.body.hsn_code[i],
            in_gst_types: req.body.in_gst_types[i],
            freight: req.body.freight[i],
            freight_gl: "TP22091214202", //Freight Inward - Import

            insurance_value: req.body.insurance[i],
            custom_duty: req.body.custom_duty[i],
            sws: req.body.sws[i],
            misc: req.body.misc[i],
            other_charges: req.body.other_charges[i],

            gst_ass_vals: Number(req.body.gst_ass_vals[i]) - Number(req.body.misc[i]) - Number(req.body.insurance[i]),
            vbt_gst_rate: req.body.vbp_gst_rate[i],
            igsts: req.body.igsts[i],
            igsts_gl: "TP230116154346", //Custom Duty Icegate(IGST Input)
            g_l_codes: req.body.g_l_codes[i],

            ven_amounts: req.body.ven_amounts[i],
            insert_by: req.logedINUser,
            insert_date: insert_data,
            min_id: req.body.min_key[i],
            // Header
            ven_address: req.body.ven_address,
            invoice_no: req.body.invoice_no,
            invoice_date: req.body.invoice_date,
            comment: req.body.comment,
            ven_code: req.body.ven_code,
            vbt_gstin: req.body.vbt_gstin,
            effective_date: effective_data,
            other_data: JSON.stringify({
              port_code: req.body.port_code,
              port_name: req.body.port_name,
              boe_no: req.body.boe_no,
              boe_date: req.body.boe_no,
              cha: req.body.cha,
              hawb_no: req.body.hawb_no,
              mawb_no: req.body.mawb_no,
            }),
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      ); //End Insert VBT

      // Custom Duty
      if (Number(req.body.custom_duty[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP113287468529",
            debit: "0",
            credit: req.body.custom_duty[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // Custom Duty FOR SWS
      if (Number(req.body.sws[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP113287468529",
            debit: "0",
            credit: req.body.sws[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // MISC AD
      if (Number(req.body.misc[i]) > 0) {
        let misc_debit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230214145235",
            debit: req.body.misc[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
        let misc_credit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230214145235",
            debit: "0",
            credit: req.body.misc[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // Custom Duty Icegate (IGST Input) ** FOR GST
      if (Number(req.body.igsts[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230116154346",
            debit: "0",
            credit: req.body.igsts[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // IGST INPUT (Import)
      if (Number(req.body.igsts[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES ( :ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP857253446030",
            debit: req.body.igsts[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // Insurance Exp-Import
      if (Number(req.body.insurance[i]) > 0) {
        let insert_insurance_debit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230213105740",
            debit: req.body.insurance[i],
            credit: 0,
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
        let insert_insurance_credit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230213105740",
            debit: 0,
            credit: req.body.insurance[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // Freight Inward - Import
      if (Number(req.body.freight[i]) > 0) {
        let insert_freight = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP22091214202",
            debit: "0",
            credit: req.body.freight[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // GL
      if (Number(req.body.gst_ass_vals[i]) > 0) {
        let insert_gst_ass_vals = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
          replacements: {
            ladger_key: req.body.g_l_codes[i],
            debit: Number(req.body.gst_ass_vals[i]) - Number(req.body.misc[i]) - Number(req.body.insurance[i]),
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
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
          which_module: "VBT03",
          effective_date: effective_data,
          insert_by: insert_by,
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transaction,
      });
    } //END FOR LOOP

    await transaction.commit();
    await transactioninvt.commit();
    return res.json({ status: "success", success: true, message: "Insertion Successfull" });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//update vbt3
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
      eff_date: "required",
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
      return res.json({ status: "error", success: false, message: "effective date must be greater than invoice date" });
    }

    let comp_length = req.body.component.length;

    const vbt_key = req.body.vbtKey;
    const updatedAt = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const updatedBy = req.logedINUser;

    const insert_data = req.body.insertDate;
    const insert_by = req.body.insertBy;

    const effective_data = moment(req.body.eff_date, "DD-MM-YYYY").tz("Asia/Kolkata").format("YYYY-MM-DD");

    let deleteVbt = await tallyDB.query("DELETE FROM tally_vbt WHERE vbt_key = :vbtKey AND vbt_type = 'VBT03' AND vbt_debit_key = '--'", {
      replacements: { vbtKey: vbt_key },
      type: tallyDB.QueryTypes.DELETE,
      transaction: transaction
    });

    let deleteTallyLedgerData = await tallyDB.query("DELETE FROM tally_ledger_data WHERE module_used = :vbtKey AND which_module = 'VBT03' AND debit_key = '--'", {
      replacements: { vbtKey: vbt_key },
      type: tallyDB.QueryTypes.DELETE,
      transaction: transaction
    });

    for (let i = 0; i < comp_length; i++) {
      let comp_key = await invtDB.query("SELECT `component_key` FROM `components` WHERE `c_part_no` = :p_no", {
        replacements: { p_no: req.body.part_code[i] },
        type: invtDB.QueryTypes.SELECT,
      });

      let purchaseImport = Number(req.body.ven_amounts[i]) + Number(req.body.freight[i]) + Number(req.body.custom_duty[i]) + Number(req.body.sws[i]);

      let stmt = await tallyDB.query(
        "INSERT INTO `tally_vbt` ( `part_code`, po_number, project_id, `vbt_inqty`,`vbt_bill_qty`, `vbt_inrate` , `currency_type`, `exchange_rate` , `vbt_taxable_value`, `hsn_code`, `vbt_gst_type`, `vbt_gst_rate`, `freight`, `vbt_freight_gl`, `vbp_gst_ass_value`, `vbt_igst`,`vbt_igst_gl`, `gl_code`, `vbt_ven_ammount`, `vbt_key`, `insert_by`, `insert_date`, `min_id` , inrPrice , cifPrice , cifValue , `ven_address`, `vbt_invoice_no`, `vbt_invoice_date`, `vbt_comment`,`ven_code`, `vbt_gstin`,`vbt_type` , `effective_date` , `insurance_value` ,`custom_duty`, `sws` , `other_charges` ,`vbt_other_data` , `item_description` , update_date , update_by , billAmount) VALUES (:part_code, :po_number, :project_id, :in_qtys, :vbt_bill_qty, :in_rates, :currency , :exchange  , :taxable_values, :hsn_code, :in_gst_types, :vbt_gst_rate,  :freight, :freight_gl, :gst_ass_vals, :igsts, :igsts_gl, :g_l_codes, :ven_amounts, :vbt_key, :insert_by, :insert_date, :min_id, :inrPrice, :cifPrice, :cifValue, :ven_address, :invoice_no, :invoice_date, :comment, :ven_code, :vbt_gstin, 'VBT03' , :effective_date, :insurance_value , :custom_duty , :sws , :other_charges , :other_data , :item_description , :update_date , :update_by , :billAmount)",
        {
          replacements: {
            po_number: req.body.poNumber?.[i] ? req.body.poNumber[i] : "",
            project_id: req.body.projectID?.[i] ? req.body.projectID[i] : "",
            vbt_key: vbt_key,
            in_qtys: req.body.in_qtys[i],
            vbt_bill_qty: req.body.bill_qty[i],
            in_rates: req.body.in_rates[i],
            currency: req.body.currency[i],
            exchange: req.body.currency[i] == "364907247" ? 1 : req.body.exchange[i],
            taxable_values: req.body.taxable_values[i],
            part_code: comp_key[0].component_key,
            hsn_code: req.body.hsn_code[i],
            in_gst_types: req.body.in_gst_types[i],
            freight: req.body.freight[i],
            freight_gl: "TP22091214202", //Freight Inward - Import

            insurance_value: req.body.insurance[i],
            custom_duty: req.body.custom_duty[i],
            sws: req.body.sws[i],
            misc: req.body.misc[i],
            other_charges: req.body.other_charges[i],

            gst_ass_vals: req.body.gst_ass_vals[i],
            vbt_gst_rate: req.body.vbp_gst_rate[i],
            igsts: req.body.igsts[i],
            igsts_gl: "TP230116154346", //Custom Duty Icegate(IGST Input)
            g_l_codes: req.body.g_l_codes[i],

            ven_amounts: req.body.ven_amounts[i],
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
            other_data: JSON.stringify({
              port_code: req.body.port_code,
              port_name: req.body.port_name,
              boe_no: req.body.boe_no,
              boe_date: req.body.boe_date,
              cha: req.body.cha,
              hawb_no: req.body.hawb_no,
              mawb_no: req.body.mawb_no,
            }),
            item_description: req.body.item_description?.[i] ? req.body.item_description[i] : "",
            update_date: updatedAt,
            update_by: updatedBy,
            billAmount: req.body.bill_amount,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      ); //End Insert VBT

      // Custom Duty
      if (Number(req.body.custom_duty[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP113287468529",
            debit: "0",
            credit: req.body.custom_duty[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // Custom Duty FOR SWS
      if (Number(req.body.sws[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP113287468529",
            debit: "0",
            credit: req.body.sws[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // MISC AD
      if (Number(req.body.misc[i]) > 0) {
        let misc_debit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230214145235",
            debit: req.body.misc[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
        let misc_credit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230214145235",
            debit: "0",
            credit: req.body.misc[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // Custom Duty Icegate (IGST Input) ** FOR GST
      if (Number(req.body.igsts[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230116154346",
            debit: "0",
            credit: req.body.igsts[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // IGST INPUT (Import)
      if (Number(req.body.igsts[i]) > 0) {
        let insert_igst = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES ( :ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP857253446030",
            debit: req.body.igsts[i],
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // Insurance Exp-Import
      if (Number(req.body.insurance[i]) > 0) {
        let insert_insurance_debit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230213105740",
            debit: req.body.insurance[i],
            credit: 0,
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
        let insert_insurance_credit = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP230213105740",
            debit: 0,
            credit: req.body.insurance[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // Freight Inward - Import
      if (Number(req.body.freight[i]) > 0) {
        let insert_freight = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module,  :effective_date, :insert_by)", {
          replacements: {
            ladger_key: "TP22091214202",
            debit: "0",
            credit: req.body.freight[i],
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
            effective_date: effective_data,
            insert_by: insert_by,
          },
          type: tallyDB.QueryTypes.INSERT,
          transaction: transaction,
        });
      }

      // GL
      if (Number(purchaseImport) > 0) {
        let insert_gst_ass_vals = await tallyDB.query("INSERT INTO `tally_ledger_data` (ladger_key, debit , credit, module_used, insert_date, which_module, ref_date, insert_by) VALUES (:ladger_key, :debit , :credit, :module_used, :insert_date, :which_module, :effective_date, :insert_by)", {
          replacements: {
            ladger_key: req.body.g_l_codes[i],
            debit: purchaseImport,
            credit: "0",
            module_used: vbt_key,
            insert_date: insert_data,
            which_module: "VBT03",
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
          which_module: "VBT03",
          effective_date: effective_data,
          insert_by: insert_by,
        },
        type: tallyDB.QueryTypes.INSERT,
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

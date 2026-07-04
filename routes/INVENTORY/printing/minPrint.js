let { invtDB } = require("../../../config/db/connection");


const express = require("express");
const router = express.Router();

const htmlToPdf = require("html-pdf-node");
const fs = require("fs");

const Validator = require("validatorjs");

const auth = require("./../../../middleware/auth");
const permission = require("./../../../middleware/permission");

const minHtml = require("./minHtml");

// Print MIN
router.post("/printSingleMin", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    transaction: "required",
  });
  if (validation.fails()) {
    return res.json({ success: false, status: "error", message: "something you missing in form field to supply", data: validation.errors.all() });
  }

  try {
    let stmt = await invtDB.query(
      "SELECT *, `rm_location`.`insert_date` AS `material_in_date` FROM `rm_location` LEFT JOIN `ven_basic_detail` ON `rm_location`.`in_vendor_name` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `ven_address_detail` ON `ven_basic_detail`.`ven_register_id` = `ven_address_detail`.`ven_id` LEFT JOIN `po_purchase_req` ON `rm_location`.`in_po_transaction_id` = `po_purchase_req`.`po_transaction` LEFT JOIN `cost_center` ON `cost_center`.`cost_center_key` = `po_purchase_req`.`po_cost_center` LEFT JOIN `shipment_address` ON `shipment_address`.`shipment_code` = `po_purchase_req`.`po_ship_id` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` WHERE (`rm_location`.`in_transaction_id` = :transaction OR `rm_location`.`transfer_transaction_id` = :transaction)",
      {
        replacements: { transaction: req.body.transaction },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      remark = stmt[0].remark;

      min_in_date = stmt[0].material_in_date;
      inward_by = stmt[0].user_name + " / (" + stmt[0].Email_ID + ")";
      inward_date = stmt[0].material_in_date;

      if (stmt[0].ven_name == "" || stmt[0].ven_name == "--" || stmt[0].ven_name == null || stmt[0].ven_name == "null") {
        vendor_name = "N/A";
      } else {
        vendor_name = stmt[0].ven_name;
      }

      if (stmt[0].ven_register_id == "" || stmt[0].ven_register_id == "--" || stmt[0].ven_register_id == null) {
        vendor_id = "N/A";
      } else {
        vendor_id = stmt[0].ven_register_id;
      }

      //VENDOR ADDRESS AND GST
      let stmt1;
      if (stmt[0].in_po_transaction_id !== "" && stmt[0].in_po_transaction_id !== "--") {
        stmt1 = await invtDB.query("SELECT * FROM `ven_address_detail` WHERE `ven_address_id` = :address_id", {
          replacements: { address_id: stmt[0].po_ven_add_id },
          type: invtDB.QueryTypes.SELECT,
        });
        if (stmt1.length > 0) {
          vendor_address = stmt1[0].ven_address;
          vendor_city = stmt1[0].ven_city;
          vendor_state = stmt1[0].ven_state;
          vendor_pincode = stmt1[0].ven_pincode;
          vendor_gst = stmt1[0].ven_add_gst;
        } else {
          if (stmt[0].ven_address == "" && stmt[0].ven_address == "--") {
            vendor_address = "N/A";
          } else {
            vendor_address = stmt[0].ven_address;
          }

          if (stmt[0].ven_city == "" || stmt[0].ven_city == "--") {
            vendor_city = "N/A";
          } else {
            vendor_city = stmt[0].ven_city;
          }

          if (stmt[0].ven_state == "" || stmt[0].ven_state == "--") {
            vendor_state = "N/A";
          } else {
            vendor_state = stmt[0].ven_state;
          }

          if (stmt[0].ven_pincode == "" || stmt[0].ven_pincode == "--") {
            vendor_pincode = "N/A";
          } else {
            vendor_pincode = stmt[0].ven_pincode;
          }

          if (stmt[0].ven_add_gst == "" || stmt[0].ven_add_gst == "--") {
            vendor_gst = "N/A";
          } else {
            vendor_gst = stmt[0].ven_add_gst;
          }
        }
      } else if (stmt[0].in_jw_transaction_id != "" && stmt[0].in_jw_transaction_id != "--") {
        // FOR JW
        stmt1 = await invtDB.query(
          "SELECT jw_purchase_req.*, cost_center_name, ven_address_detail.ven_address, ven_address_detail.ven_city, ven_address_detail.ven_state, ven_address_detail.ven_pincode, ven_address_detail.ven_add_gst " +
          "FROM `jw_purchase_req` " +
          "LEFT JOIN ven_address_detail ON ven_address_detail.ven_address_id = jw_purchase_req.jw_po_ven_add_id " +
          "LEFT JOIN cost_center ON cost_center.cost_center_key = jw_purchase_req.jw_cost_center " +
          "WHERE `jw_jw_transaction` = :jw_id GROUP BY jw_jw_transaction",
          {
            replacements: { jw_id: stmt[0].in_jw_transaction_id },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt1.length > 0) {
          vendor_address = stmt1[0].jw_po_vendor_address;
          vendor_city = stmt1[0].ven_city;
          vendor_state = stmt1[0].ven_state;
          vendor_pincode = stmt1[0].ven_pincode;
          vendor_gst = stmt1[0].ven_add_gst;
        } else {
          if (stmt[0].ven_address == "" && stmt[0].ven_address == "--") {
            vendor_address = "N/A";
          } else {
            vendor_address = stmt[0].ven_address;
          }

          if (stmt[0].ven_city == "" || stmt[0].ven_city == "--") {
            vendor_city = "N/A";
          } else {
            vendor_city = stmt[0].ven_city;
          }

          if (stmt[0].ven_state == "" || stmt[0].ven_state == "--") {
            vendor_state = "N/A";
          } else {
            vendor_state = stmt[0].ven_state;
          }

          if (stmt[0].ven_pincode == "" || stmt[0].ven_pincode == "--") {
            vendor_pincode = "N/A";
          } else {
            vendor_pincode = stmt[0].ven_pincode;
          }

          if (stmt[0].ven_add_gst == "" || stmt[0].ven_add_gst == "--") {
            vendor_gst = "N/A";
          } else {
            vendor_gst = stmt[0].ven_add_gst;
          }
        }
        // FOR JW
      } else {
        stmt1 = await invtDB.query("SELECT * FROM `ven_address_detail` WHERE `ven_address_id` = :address_id", {
          replacements: { address_id: stmt[0].in_vendor_branch },
          type: invtDB.QueryTypes.SELECT,
        });
        if (stmt1.length > 0) {
          vendor_address = stmt1[0].ven_address;
          vendor_city = stmt1[0].ven_city;
          vendor_state = stmt1[0].ven_state;
          vendor_pincode = stmt1[0].ven_pincode;
          vendor_gst = stmt1[0].ven_add_gst;
        } else {
          if (stmt[0].ven_address == "" && stmt[0].ven_address == "--") {
            vendor_address = "N/A";
          } else {
            vendor_address = stmt[0].ven_address;
          }

          if (stmt[0].ven_city == "" || stmt[0].ven_city == "--") {
            vendor_city = "N/A";
          } else {
            vendor_city = stmt[0].ven_city;
          }

          if (stmt[0].ven_state == "" || stmt[0].ven_state == "--") {
            vendor_state = "N/A";
          } else {
            vendor_state = stmt[0].ven_state;
          }

          if (stmt[0].ven_pincode == "" || stmt[0].ven_pincode == "--") {
            vendor_pincode = "N/A";
          } else {
            vendor_pincode = stmt[0].ven_pincode;
          }

          if (stmt[0].ven_add_gst == "" || stmt[0].ven_add_gst == "--") {
            vendor_gst = "N/A";
          } else {
            vendor_gst = stmt[0].ven_add_gst;
          }
        }
      }

      if (stmt[0].in_po_invoice_id !== "--") {
        invoice_id = stmt[0].in_po_invoice_id;
      } else {
        invoice_id = stmt[0].in_invoice_id;
      }

      delivery_gst = stmt[0].shipment_gstin ? stmt[0].shipment_gstin : "--";

      if (stmt[0].po_vendor_address !== "" && stmt[0].po_vendor_address !== "--") {
        delivery_address = stmt[0].po_ship_address;
      } else {
        delivery_address = stmt[0].shipment_address;
      }
      delivery_address = delivery_address ? delivery_address : "--";

      material_in_txn = stmt[0].in_transaction_id;
      material_in_invno = stmt[0].in_invoice_id;

      cost_center_value = "--";

      material_in_type_label = "JW/PO Number :";
      cost_center_label = "";
      cost_center_value = "";
      material_in_jwpono = "NOT AVAILABLE";
      if (stmt[0].in_po_transaction_id !== "" && stmt[0].in_po_transaction_id !== "--") {
        material_in_type_label = "PO Number :";
        cost_center_label = "Cost Center :";
        cost_center_value = stmt[0].cost_center_name == null ? "N/A" : stmt[0].cost_center_name;
        material_in_jwpono = stmt[0].in_po_transaction_id;
        project_name = stmt[0].po_project_name == null ? "N/A" : stmt[0].po_project_name;
      } else if (stmt[0].in_jw_transaction_id !== "" && stmt[0].in_jw_transaction_id !== "--") {
        material_in_type_label = "JW Number :";
        cost_center_label = "Cost Center :";
        cost_center_value = stmt1[0].cost_center_name ?? "--";
        material_in_jwpono = stmt[0].in_jw_transaction_id;
        project_name = stmt1[0].jw_project_name ?? "--";
      } else if (stmt[0].wo_transaction_id !== "" && stmt[0].wo_transaction_id !== "--") {
        const stmt_min_cost_project = await invtDB.query("SELECT * FROM  `cost_center` WHERE cost_center_key = :cost_center_key", {
          replacements: { cost_center_key: stmt[0].rm_loc_cost_center },
          type: invtDB.QueryTypes.SELECT,
        });

        material_in_type_label = "PO Number :";
        cost_center_label = "Cost Center :";

        if (stmt_min_cost_project.length > 0) {
          cost_center_value = stmt_min_cost_project[0]?.cost_center_name == null ? "N/A" : stmt_min_cost_project[0]?.cost_center_name;
          material_in_jwpono = stmt[0].wo_transaction_id;
        }

        project_name = stmt[0].rm_loc_project_id == null ? "N/A" : stmt[0].rm_loc_project_id;
      } else {
        // FOR MIN
        material_in_type_label = "JW/PO Number :";
        cost_center_label = "";
        cost_center_value = "";
        material_in_jwpono = "NOT AVAILABLE";

        //
        let stmt_min_cost_project = await invtDB.query(
          "SELECT cost_center_name FROM rm_location LEFT JOIN cost_center ON cost_center.cost_center_key = rm_location.rm_loc_cost_center WHERE rm_location.in_transaction_id = :in_transaction_id",
          {
            replacements: { in_transaction_id: stmt[0].in_transaction_id },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt_min_cost_project.length > 0) {
          project_name = stmt[0].rm_loc_project_id ?? "N/A";
          cost_center_label = "Cost Center :";
          cost_center_value = stmt_min_cost_project[0].cost_center_name ?? "--";
        } else {
          project_name = "NOT AVAILABLE";
        }
        //
      }

     min_txn_id = stmt[0].in_transaction_id == "--" ? stmt[0].transfer_transaction_id : stmt[0].in_transaction_id ;

      po_rate = stmt[0].po_order_rate;
    } else {
      return res.json({ success: false, status: "error", message: "No Min Found" });
    }

    //FETCH COMPONENTS
    let stmt1 = await invtDB.query(
      "SELECT * FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `ims_currency` ON `ims_currency`.`currency_id` = `rm_location`.`currency_type` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `all_groups` ON `all_groups`.`group_id` = `components`.`c_group` LEFT JOIN `location_main` ON `rm_location`.`loc_in` = `location_main`.`location_key` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` LEFT JOIN `branches` ON `branches`.`branch_code` = `rm_location`.`company_branch` WHERE (`rm_location`.`in_transaction_id` = :transaction OR `rm_location`.`transfer_transaction_id` = :transaction) AND (`rm_location`.`trans_type` IN ('INWARD', 'TRANSFER', 'REVERSE')) ORDER BY `rm_location`.`insert_date` ASC",
      {
        replacements: { transaction: req.body.transaction },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt1.length > 0) {
      let count = 0;
      let revers_count = 0;

      let items_data = "";
      let ser_data = "";
      let items_data_reverse = "";
      let ser_data_reverse = "";
      let sum_norm_amt = 0;
      let sum_tax_amt = 0;
      let sum_total_amt = 0;

      let total_row_amount = 0;

      let tax_calculation = 0;
      let totalQTY = 0;

      let min_done_by = stmt1[0].user_name;
      for (i = 0; i < stmt1.length; i++) {
        let normal_amount,
          tax_amount = 0;
        if (stmt1[i].in_hsn_code !== "--") {
          han_code = stmt1[i].in_hsn_code;
        } else {
          han_code = "N/A";
        }

        if (stmt1[i].any_remark !== "" && stmt1[i].any_remark !== "--" && stmt1[i].any_remark !== null) {
          remark = "<br/><i>remark: " + stmt1[i].any_remark + "</i>";
        } else if (stmt1[i].rejection_any_remark !== "" && stmt1[i].rejection_any_remark !== "--" && stmt1[i].rejection_any_remark !== null) {
          remark = "<br/><i>remark: " + stmt1[i].rejection_any_remark + "</i>";
        } else if (stmt1[i].any_remark !== "" && stmt1[i].any_remark !== "--" && stmt1[i].any_remark !== null) {
        } else {
          remark = "";
        }

        if (stmt1[i].c_group !== "" && stmt1[i].c_group !== "--") {
          group_name = stmt1[i].group_name;
        } else {
          group_name = "";
        }

        if (stmt1[i].in_gst_rate !== "") {
          gst_rate = stmt1[i].in_gst_rate + " %";
        } else {
          gst_rate = "0 %";
        }

        normal_amount = (Number(stmt1[i].qty) + Number(stmt1[i].other_qty)) * Number(stmt1[i].in_po_rate) * Number(stmt1[i].exchange_rate);
      

        if (stmt1[i].in_gst_rate !== "") {
          tax_amount = (normal_amount * Number(stmt1[i].in_gst_rate)) / 100;
        } else {
          tax_amount = (normal_amount * Number(stmt1[i].in_gst_rate)) / 100;
        }

        total_row_amount = normal_amount + tax_amount + Number(stmt1[i].custom_duty) + Number(stmt1[i].freight_charge);

        if (stmt1[i].c_type == "R" && (stmt1[i].trans_type == "INWARD" || stmt1[i].trans_type == "TRANSFER")) {
          items_data += `<tr>
                    <td>${count + 1}</td>
                    <td>${stmt1[i].c_part_no}<br/>(${stmt1[i].c_new_part_no})</td>
                    <td>${stmt1[i].c_name}<br/><b><i>HSN: ${han_code} & Grp: ${group_name}</i></b>${remark}</td>
                    <td>${stmt1[i].units_name}</td>
                    <td>${Number(stmt1[i].qty) + Number(stmt1[i].other_qty)} @ ${(stmt1[i].in_po_rate * stmt1[i].exchange_rate).toFixed(2)}</td>
                    <td>${stmt1[i].currency_symbol == null || stmt1[i].currency_symbol == "--" ? normal_amount.toFixed(2) : '₹' + normal_amount.toFixed(2)}</td>
                    <td>${stmt1[i].custom_duty}</td>
                    <td>${stmt1[i].freight_charge}</td>
                    <td>${gst_rate}</td>
                    <td>${tax_amount.toFixed()}</td>
                    <td>${stmt1[i].currency_symbol == null || stmt1[i].currency_symbol == "--" ? total_row_amount.toFixed(2) : '₹' + total_row_amount.toFixed(2)}</td>
					          <td>${stmt1[i].loc_name}</td>
                </tr>`;
          count++;
          sum_norm_amt += normal_amount;
          sum_tax_amt += tax_amount;
          tax_calculation = 0;
          sum_total_amt += total_row_amount;
          totalQTY += Number(stmt1[i].qty) + Number(stmt1[i].other_qty);
        }

        if (stmt1[i].c_type == "S" && (stmt1[i].trans_type == "INWARD" || stmt1[i].trans_type == "TRANSFER")) {
          ser_data += `<tr>
                    <td>${count + 1}</td>
                    <td>${stmt1[i].c_part_no}<br/>(${stmt1[i].c_new_part_no})</td>
                    <td>${stmt1[i].c_name}<br/><b><i>HSN: ${han_code} & Grp: ${group_name}</i></b>${remark}</td>
                    <td>${stmt1[i].units_name}</td>
                    <td>${Number(stmt1[i].qty) + Number(stmt1[i].other_qty)} @ ${(stmt1[i].in_po_rate * stmt1[i].exchange_rate).toFixed(2)}</td>
                    <td>${stmt1[i].currency_symbol == null || stmt1[i].currency_symbol == "--" ? normal_amount.toFixed(2) : '₹' + normal_amount.toFixed(2)}</td>
                    <td>${stmt1[i].custom_duty}</td>
                    <td>${stmt1[i].freight_charge}</td>
                    <td>${gst_rate}</td>
                    <td>${tax_amount.toFixed()}</td>
                    <td>${stmt1[i].currency_symbol == null || stmt1[i].currency_symbol == "--" ? total_row_amount.toFixed(2) : '₹' + total_row_amount.toFixed(2)}</td>
					<td>${stmt1[i].loc_name}</td>
                </tr>`;
          count++;
          sum_norm_amt += normal_amount;
          sum_tax_amt += tax_amount;
          tax_calculation = 0;
          sum_total_amt += total_row_amount;
          totalQTY += Number(stmt1[i].qty) + Number(stmt1[i].other_qty);
        }

        if (stmt1[i].c_type == "R" && stmt1[i].trans_type == "REVERSE") {
          items_data_reverse += `<tr>
                    <td>${revers_count + 1}</td>
                    <td>${stmt1[i].c_part_no}<br/>(${stmt1[i].c_new_part_no})</td>
                    <td>${stmt1[i].c_name}<br/><b><i>HSN: ${han_code} & Grp: ${group_name}</i></b>${remark}</td>
                    <td>${stmt1[i].units_name}</td>
                    <td>${Number(stmt1[i].qty) + Number(stmt1[i].other_qty)} @ ${(stmt1[i].in_po_rate * stmt1[i].exchange_rate).toFixed(2)}</td>
                    <td>${stmt1[i].currency_symbol == null || stmt1[i].currency_symbol == "--" ? normal_amount.toFixed(2) : '₹' + normal_amount.toFixed(2)}</td>
                    <td>${gst_rate}</td>
                    <td>${tax_amount.toFixed()}</td>
                    <td>${stmt1[i].currency_symbol == null || stmt1[i].currency_symbol == "--" ? total_row_amount.toFixed(2) : '₹' + total_row_amount.toFixed(2)}</td>
                    <td>--</td>
                </tr>`;
          revers_count++;
        }

        if (stmt1[i].c_type == "S" && stmt1[i].trans_type == "REVERSE") {
          ser_data_reverse += `<tr>
                    <td>${revers_count + 1}</td>
                    <td>${stmt1[i].c_part_no}<br/>(${stmt1[i].c_new_part_no})</td>
                    <td>${stmt1[i].c_name}<br/><b><i>HSN: ${han_code} & Grp: ${group_name}</i></b>${remark}</td>
                    <td>${stmt1[i].units_name}</td>
                    <td>${Number(stmt1[i].qty) + Number(stmt1[i].other_qty)} @ ${(stmt1[i].in_po_rate * stmt1[i].exchange_rate).toFixed(2)}</td>
                    <td>${stmt1[i].currency_symbol == null || stmt1[i].currency_symbol == "--" ? normal_amount.toFixed(2) : '₹' + normal_amount.toFixed(2)}</td>
                    <td>${gst_rate}</td>
                    <td>${tax_amount.toFixed()}</td>
                    <td>${stmt1[i].currency_symbol == null || stmt1[i].currency_symbol == "--" ? total_row_amount.toFixed(2) :  '₹' + total_row_amount.toFixed(2)}</td>
                    <td>--</td>
                </tr>`;
          revers_count++;
        }
      }

      let data = {
        cost_center_label: cost_center_label,
        cost_center_value: cost_center_value,
        project_name: project_name,
        min_txn_id: min_txn_id,
        material_in_type_label: material_in_type_label,
        material_in_jwpono: material_in_jwpono,
        po_rate: po_rate,
        material_in_txn: material_in_txn,
        material_in_invno: material_in_invno,
        delivery_address: delivery_address,
        delivery_gst: delivery_gst,
        invoice_id: invoice_id,
        vendor_gst: vendor_gst,
        branch: stmt1[0].branch_name,
        vendor_pincode: vendor_pincode,
        vendor_state: vendor_state,
        vendor_city: vendor_city,
        vendor_address: vendor_address,
        vendor_id: vendor_id,
        vendor_name: vendor_name,
        inward_date: moment(inward_date, "").format("DD-MM-YYYY hh:mm A") + " IST",
        sum_norm_amt: stmt1[0].currency_symbol == null || stmt1[0].currency_symbol == "--" ? sum_norm_amt.toFixed() : '₹' + " " + sum_norm_amt.toFixed(),
        sum_tax_amt: sum_tax_amt.toFixed(),
        sum_total_amt: stmt1[0].currency_symbol == null || stmt1[0].currency_symbol == "--" ? sum_total_amt.toFixed(2) : '₹' + " " + sum_total_amt.toFixed(2),
        totalQTY: totalQTY,
        min_done_by: min_done_by,
        acknowledgement_id: stmt1[0].ackwlg_irn,
      };
      console.log("data")

      let html = minHtml.minHtml(data, items_data + ser_data, items_data_reverse + ser_data_reverse);


      let options = { format: "A4", margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" } };
      let file = { content: html };
      await htmlToPdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          // const fs = require("fs");
          //fs.writeFileSync(data.min_txn_id.replace(/\//g, "_") + ".pdf", pdfBuffer);

          // res.setHeader("Content-disposition", "attachment; filename=" + data.min_txn_id.replace(/\//g, "_") + ".pdf");
          // res.setHeader("Content-type", "application/pdf");
          // res.send(pdfBuffer);

          // return;

          return res.json({ success: true, status: "success", message: "File Generated successfully..", data: { buffer: pdfBuffer, filename: data.min_txn_id.replace(/\//g, "_") + ".pdf" } });
        })
        .catch((err) => {
          return res.json({ success: false, status: "error", message: "an error while generating file" });
        });
    } else {
      return res.json({ success: false, status: "error", message: "No any part found in transaction" });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

module.exports = router;

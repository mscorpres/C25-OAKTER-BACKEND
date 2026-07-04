let { invtDB } = require("../../../config/db/connection");


const QRCode = require("qrcode");
const htmlToPdf = require("html-pdf-node");
const fs = require("fs");
const Validator = require("validatorjs");

const getLableHtml = require("./label");

const express = require("express");
const router = express.Router();

const auth = require("./../../../middleware/auth");
const permission = require("./../../../middleware/permission");

router.post("/generateBoxLabel", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      transaction: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: "Select MIN No.!!!" });
    }

    let data = [];

    const stmt1 = await invtDB.query(
      "SELECT  rm_location.in_vendor_name, rm_location.in_transaction_id, rm_location.qty, rm_location.components_id, cost_center.cost_center_name, project_master.project_name FROM rm_location LEFT JOIN po_purchase_req ON po_purchase_req.po_part_no = rm_location.components_id AND po_purchase_req.po_transaction = rm_location.in_po_transaction_id LEFT JOIN cost_center ON cost_center.cost_center_key = po_purchase_req.po_cost_center LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name WHERE rm_location.in_transaction_id = :min_transaction_id AND rm_location.trans_type = 'INWARD';",
      {
        replacements: { min_transaction_id: req.body.transaction },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt1.length > 0) {
      const numberOfPart = stmt1.length;
      for (let i = 0; i < numberOfPart; i++) {
        let min_no = stmt1[i].in_transaction_id;
        let in_date = moment(stmt1[i].insert_date).tz("Asia/Kolkata").format("DD-MM-YYYY");
        let in_qty = stmt1[i].qty;

        let stmt2 = await invtDB.query("SELECT `c_part_no`,`c_name`,`c_uom`,`units_name`,`component_key` FROM `components` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `components`.`component_key` = :component_key", {
          replacements: { component_key: stmt1[i].components_id },
          type: invtDB.QueryTypes.SELECT,
        });

        if (stmt2.length > 0) {
          let part_code = stmt2[0].c_part_no;
          let part_name = stmt2[0].c_name;
          let part_uom = stmt2[0].units_name;
          let component_key = stmt2[0].component_key;
          let prj_name = stmt1[i].cost_center_name;
          let prj_id = stmt1[i].project_name;

          let vendor_name = "";
          let vendor_code = "";

          if (stmt1[i].in_vendor_name != "--" && stmt1[i].in_vendor_name != "") {
            let stmt3 = await invtDB.query("SELECT * from `ven_basic_detail` WHERE `ven_register_id` = :vendor_code", {
              replacements: { vendor_code: stmt1[i].in_vendor_name },
              type: invtDB.QueryTypes.SELECT,
            });
            if (stmt3.length > 0) {
              vendor_name = stmt3[0].ven_name;
              vendor_code = stmt3[0].ven_register_id;
            } else {
              vendor_name = "N/D"; // not defined
              vendor_code = "N/D"; // not defined
            }
          } else {
            vendor_name = "N/A"; //not applicable
            vendor_code = "N/A"; //not applicable
          }

          //   GET BOX DATA
          let stmt_min_boxes = await invtDB.query("SELECT tbl_box_markup.box_loc_in , tbl_box_markup.box_qty FROM tbl_box_markup WHERE box_in_transaction_id = :min_trans AND box_component_id = :comp", {
            replacements: { min_trans: req.body.transaction, comp: stmt1[i].components_id },
            type: invtDB.QueryTypes.SELECT,
          });

          if (stmt_min_boxes.length > 0) {
            let numberOfBoxes = stmt_min_boxes.length;
            for (let j = 0; j < numberOfBoxes; j++) {
              let BOXNO = stmt_min_boxes[j].box_loc_in;
              let inBoxQty = stmt_min_boxes[j].box_qty;

              data.push({
                min_no: min_no,
                in_date: in_date,
                in_qty: in_qty,
                part_code: part_code,
                part_name: part_name,
                part_uom: part_uom,
                vendor_name: vendor_name,
                vendor_code: vendor_code,
                component_key: component_key,
                prj_name: prj_name ?? "NA",
                prj_id: prj_id ?? "NA",
                BOXNO: BOXNO,
                inBoxQty: inBoxQty,
              });
            } // end for box
          }
        }
      } // end for min component

      let head = getLableHtml.getHeaderHtml();
      let body = "";

      let data_length = data.length;
      for (let i = 0; i < data_length; i++) {
        let qr_data = JSON.stringify(data[i]);
        let img = await QRCode.toDataURL(qr_data);

        if (i % 2 == 0) {
          body += "<tr>";
        }
        body += getLableHtml.getBoxBodyHtml(data[i], img);
        if (i % 2 != 0) {
          body += "</tr>";
        }
      }

      let footer = getLableHtml.getFooterHtml();

      // HTML TO PDF
      let options = { format: "A4" };
      let file = { content: head + body + footer };
      let pdfBuffer = await htmlToPdf.generatePdf(file, options);

      return res.json({

        message: "Label Generated..",
        status: "success", success: true,
        data: {
          buffer: pdfBuffer,
          filename: "LP " + req.body.transaction + ".pdf",
        },
      });
    } else {
      return res.json({ status: "error", success: false, message: "Min No. not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

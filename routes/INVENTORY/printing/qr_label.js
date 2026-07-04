let { invtDB } = require("../../../config/db/connection");


const QRCode = require("qrcode");
const htmlToPdf = require("html-pdf-node");
const fs = require("fs");

const getLableHtml = require("./label");

const express = require("express");
const router = express.Router();

const auth = require("./../../../middleware/auth");
const permission = require("./../../../middleware/permission");

router.post("/generateQR", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query(
      "SELECT `rm_location`.`insert_date`, `rm_location`.`in_vendor_name`, `rm_location`.`in_transaction_id`, `rm_location`.`qty`, `rm_location`.`components_id`, `cost_center`.`cost_center_name`, `project_master`.`project_name` , location_main.loc_name FROM `rm_location` LEFT JOIN `po_purchase_req` ON `po_purchase_req`.`po_part_no` = `rm_location`.`components_id` AND `po_purchase_req`.`po_transaction` = `rm_location`.`in_po_transaction_id` LEFT JOIN `cost_center` ON `cost_center`.`cost_center_key` = `po_purchase_req`.`po_cost_center` LEFT JOIN `project_master` ON `project_master`.`project_name` = `po_purchase_req`.`po_project_name` LEFT JOIN location_main ON `location_main`.`location_key` = `rm_location`.`loc_in` WHERE `rm_location`.`in_transaction_id` = :min_transaction_id AND `rm_location`.`trans_type` = 'INWARD'",
      {
        replacements: { min_transaction_id: req.body.minId },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt1.length > 0) {
      var data = [];
      stmt1.forEach(async (item) => {
        let min_no = item.in_transaction_id;
        let in_date = moment(item.insert_date).tz("Asia/Kolkata").format("DD-MM-YYYY");
        let in_qty = item.qty;
        let loc_in = item.loc_name;

        let stmt2 = await invtDB.query("SELECT `c_part_no`,`c_name`,`c_uom`,`units_name`,`component_key` FROM `components` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `components`.`component_key` = :component_key", {
          replacements: { component_key: item.components_id },
          type: invtDB.QueryTypes.SELECT,
        });
        if (stmt2.length > 0) {
          let part_code = stmt2[0].c_part_no;
          let part_name = stmt2[0].c_name;
          let part_uom = stmt2[0].units_name;
          let component_key = stmt2[0].component_key;
          let prj_name = item.cost_center_name;
          let prj_id = item.project_name;

          let vendor_name, vendor_code;

          if (item.in_vendor_name != "--" && item.in_vendor_name != "") {
            let stmt3 = await invtDB.query("SELECT * from `ven_basic_detail` WHERE `ven_register_id` = :vendor_code", {
              replacements: { vendor_code: item.in_vendor_name },
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
            prj_name: prj_name,
            prj_id: prj_id,
            loc_in: loc_in,
          });

          if (stmt1.length == data.length) {
            let head = getLableHtml.getHeaderHtml();
            let body = "";

            let data_length = data.length;
            let data_index = 0;
            let br = 0;
            data.forEach(async (item) => {
              let qr_data = JSON.stringify(item);
              let img = await QRCode.toDataURL(qr_data);

              // let pos = req.body.components.part_code.indexOf(item.part_code);
              let pos = req.body.components.findIndex((x) => x.partCode == item.part_code);
              
              let count = req.body.components[pos].labelQty;
              if (pos != -1) {
                for (let i = 0; i < count; i++) {
                  if (i % 2 == 0) {
                    br++;
                    body += "<tr>";
                  }
                  body += getLableHtml.getBodyHtml(item, img);
                  if (i % 2 != 0) {
                    body += "</tr>";
                  }
                }
              }
              data_index++;
              if (data_index == data_length) {
                let foot = getLableHtml.getFooterHtml();
                // HTML TO PDF
                let options = { format: "A4" };
                let file = { content: head + body + foot };
                htmlToPdf
                  .generatePdf(file, options)
                  .then((pdfBuffer) => {

                    // const fs = require("fs");
                    // fs.writeFileSync("LP.pdf", pdfBuffer);

                    return res.json({
                      message: "Label Generated..",
                      success: true,
                      data: {
                        buffer: pdfBuffer,
                        filename: "LP " + min_no + ".pdf",
                      },
                    });
                  })
                  .catch((err) => {
                    return res.json({
                      success: false,
                      message: "error while generating print",
                      status: "error", success: false,
                    });
                  });
              }
            });
          }
        } else {
          return res.json({
            success: false,
            message: "part code not found",
            status: "error", success: false,
          });
        }
      });
    } else {
      return res.json({
        success: false,
        message: "MIN not found",
        status: "error", success: false,
      });
    }
  } catch (err) {
    return res.json({
      success: false,
      message: "Internal Error<br/>If this condition persists, contact your system administrator",
      error: err.stack,
    });
  }
});

router.post("/getComponents", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query("SELECT * FROM rm_location WHERE in_transaction_id = :min_transaction_id AND trans_type = 'INWARD'", {
      replacements: { min_transaction_id: req.body.transaction },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt1.length > 0) {
      var data = [];
      stmt1.forEach(async (item) => {
        let stmt2 = await invtDB.query("SELECT c_part_no,c_name,c_uom , pia_status FROM components LEFT JOIN units ON units.units_id = components.c_uom WHERE components.component_key = :component_key", {
          replacements: { component_key: item.components_id },
          type: invtDB.QueryTypes.SELECT,
        });
        if (stmt2.length > 0) {

          const checkStmt = await invtDB.query("SELECT * FROM tbl_box_lable WHERE bl_min = :bl_min AND bl_component = :bl_component", {
            replacements: {
              bl_min: req.body.transaction,
              bl_component: item.components_id,
            },
            type: invtDB.QueryTypes.SELECT,
          });

          let allReadyPrinted = false;
          let boxes = [];
          if (checkStmt.length > 0) {
            allReadyPrinted = true;

            for (let i = 0; i < checkStmt.length; i++) {
              boxes.push({ label: checkStmt[i].bl_box, qty: checkStmt[i].bl_box_qty });
            }

          }


          data.push({
            min_no: item.in_transaction_id,
            min_qty: item.qty,
            component_key: item.components_id,
            part_code: stmt2[0].c_part_no,
            part_name: stmt2[0].c_name,
            part_uom: stmt2[0].units_name,
            pia_status: stmt2[0].pia_status,
            allReadyPrinted: allReadyPrinted,
            boxes: boxes
          });

          if (stmt1.length == data.length) {
            return res.send({ success: true, data: data });
          }
        } else {
          return res.json({ success: false, message: "part code not found" });
        }
      });
    } else {
      return res.json({ message: "MIN not found", success: false });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// GET MINS
router.post("/getMinsTransaction", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.searchTerm == "" || req.body.searchTerm == undefined || req.body.searchTerm == null) {
      stmt = await invtDB.query("SELECT in_transaction_id FROM `rm_location` GROUP BY `in_transaction_id` ORDER BY `insert_date` DESC LIMIT :limit", {
        replacements: { limit: 50 },
        type: invtDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await invtDB.query("SELECT in_transaction_id FROM `rm_location` WHERE `in_transaction_id` LIKE :search OR `in_vendor_name` LIKE :search GROUP BY `in_transaction_id` ORDER BY `insert_date` DESC LIMIT :limit", {
        replacements: { search: "%" + req.body.searchTerm + "%", limit: 50 },
        type: invtDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let result = [];
      stmt.map(async (item) => {
        result.push({
          id: item.in_transaction_id,
          text: item.in_transaction_id,
        });
      });
      return res.json({ status: "success", success: true, message: "Data fetched successfully", data: result });
    } else {
      return res.json({

        message: "MIN not found",
        status: "error", success: false,
      });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();

let { invtDB, otherDB, tallyDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
var html_to_pdf = require("html-pdf-node");

const multer = require("multer");
const path = require("path");
const XLSX = require("xlsx");
const fs = require("fs");

checkIfZero = (value) => {
  value = value > 0 ? value : 0;
  return value;
};

const getDeliveryChallanData = async (wise, data, download, req) => {
  if (wise == "datewise") {
    const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    stmt = await invtDB.query(
      "SELECT *, COALESCE(wo_delivery_challan.wo_challan_txn_id, 'N/A') AS challan_no FROM wo_delivery_challan LEFT JOIN " +
        tallyDB.config.database +
        ".client_basic_detail ON wo_delivery_challan.wo_client_id = client_basic_detail.code LEFT JOIN " +
        ims_db_name +
        ".products ON wo_delivery_challan.wo_secondary_product_id = products.product_key WHERE DATE_FORMAT(wo_delivery_challan.wo_insert_dt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND wo_delivery_challan.challan_status != :status AND wo_delivery_challan.wo_del_challan_status = 'CREATED' AND wo_delivery_challan.company_branch = :branch ORDER BY wo_delivery_challan.ID DESC",
      {
        replacements: {
          date1: date1,
          date2: date2,
          status: "C",
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
  } else if (wise == "clientwise") {
    stmt = await invtDB.query(
      "SELECT *, COALESCE(wo_delivery_challan.wo_challan_txn_id, 'N/A') AS challan_no FROM wo_delivery_challan LEFT JOIN " +
        tallyDB.config.database +
        ".client_basic_detail ON wo_delivery_challan.wo_client_id = client_basic_detail.code LEFT JOIN " +
        ims_db_name +
        ".products ON wo_delivery_challan.wo_secondary_product_id = products.product_key WHERE wo_delivery_challan.wo_client_id = :clientid AND wo_delivery_challan.challan_status != :status AND wo_delivery_challan.wo_del_challan_status = 'CREATED' AND wo_delivery_challan.company_branch = :branch ORDER BY wo_delivery_challan.ID DESC",
      {
        replacements: { clientid: data, status: "C", branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );
  } else {
    return new Error("Please select valid filter method");
  }

  let final = [];
  if (stmt.length > 0) {
    if (download == "yes") {
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          delivery_challan_dt: moment(
            stmt[i].wo_insert_dt,
            "YYYY-MM-DD"
          ).format("DD-MM-YYYY"),
          challan_id: stmt[i].challan_no,
          client: stmt[i].name,
          client_code: stmt[i].wo_client_id,
          item_name: stmt[i].p_name,
          item_qty: stmt[i].wo_order_qty,
          item_rate: stmt[i].wo_order_rate,
          item_value: stmt[i].wo_order_qty * stmt[i].wo_order_rate,
          hsn_code: stmt[i].wo_hsncode,
          ewaybill_no: stmt[i].wo_eway_no,
          ewaybillStatus: stmt[i].wo_ewaybill_status,
        });
      }
    } else if (download == "no") {
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          delivery_challan_dt: moment(
            stmt[i].wo_insert_dt,
            "YYYY-MM-DD"
          ).format("DD-MM-YYYY"),
          challan_id: stmt[i].challan_no,
          client: stmt[i].name,
          client_code: stmt[i].wo_client_id,
          item_name: stmt[i].p_name,
          item_qty: stmt[i].wo_order_qty,
          item_rate: stmt[i].wo_order_rate,
          item_value: stmt[i].wo_order_qty * stmt[i].wo_order_rate,
          challan_type: "delivery",
          ewaybill_no: stmt[i].wo_eway_no,
          ewaybillStatus: stmt[i].wo_ewaybill_status,
        });
      }
    }
  }
  return final;
};

const getReturnChallanData = async (wise, data, download, req) => {
  if (wise == "datewise") {
    const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    stmt = await invtDB.query(
      "SELECT *, COALESCE(wo_material_challan.wo_challan_txn_id, 'N/A') AS challan_no FROM wo_material_challan LEFT JOIN " +
        tallyDB.config.database +
        ".client_basic_detail ON wo_material_challan.wo_client_id = client_basic_detail.code LEFT JOIN " +
        ims_db_name +
        ".products ON wo_material_challan.wo_product_id = products.product_key WHERE DATE_FORMAT(wo_material_challan.wo_insert_dt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND wo_material_challan.challan_status != :status AND wo_material_challan.wo_del_challan_status = 'CREATED' AND wo_material_challan.company_branch = :branch GROUP BY wo_material_challan.wo_challan_txn_id ORDER BY wo_material_challan.wo_insert_dt DESC",
      {
        replacements: {
          date1: date1,
          date2: date2,
          status: "C",
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
  } else if (wise == "clientwise") {
    stmt = await invtDB.query(
      "SELECT *, COALESCE(wo_material_challan.wo_challan_txn_id, 'N/A') AS challan_no FROM wo_material_challan LEFT JOIN " +
        tallyDB.config.database +
        ".client_basic_detail ON wo_material_challan.wo_client_id = client_basic_detail.code LEFT JOIN " +
        ims_db_name +
        ".products ON wo_material_challan.wo_product_id = products.product_key WHERE wo_material_challan.wo_client_id = :clientid AND wo_material_challan.challan_status != :status AND wo_material_challan.wo_del_challan_status = 'CREATED' AND wo_material_challan.company_branch = :branch GROUP BY wo_material_challan.wo_challan_txn_id ORDER BY wo_material_challan.wo_insert_dt DESC",
      {
        replacements: { clientid: data, status: "C", branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );
  } else {
    return new Error("Please select valid filter method");
  }

  let final = [];
  if (stmt.length > 0) {
    if (download == "yes") {
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          delivery_challan_dt: moment(
            stmt[i].wo_insert_dt,
            "YYYY-MM-DD HH:mm:ss"
          ).format("DD-MM-YYYY"),
          challan_id: stmt[i].challan_no,
          client: stmt[i].name,
          client_code: stmt[i].wo_client_id,
          item_name: stmt[i].p_name,
          item_qty: stmt[i].wo_order_qty,
          item_rate: stmt[i].wo_order_rate,
          item_value: stmt[i].wo_order_qty * stmt[i].wo_order_rate,
          hsn_code: stmt[i].wo_hsncode,
        });
      }
    } else if (download == "no") {
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          delivery_challan_dt: moment(
            stmt[i].wo_insert_dt,
            "YYYY-MM-DD HH:mm:ss"
          ).format("DD-MM-YYYY"),
          challan_id: stmt[i].challan_no,
          client: stmt[i].name,
          client_code: stmt[i].wo_client_id,
          item_name: stmt[i].p_name,
          item_qty: stmt[i].wo_order_qty,
          item_rate: stmt[i].wo_order_rate,
          item_value: stmt[i].wo_order_qty * stmt[i].wo_order_rate,
          challan_type: "return",
        });
      }
    }
  }
  return final;
};

const getScrapeChallanData = async (wise, data, download, req) => {
  if (wise == "datewise") {
    const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    stmt = await invtDB.query(
      "SELECT *, COALESCE(wo_scrap_challan.wo_challan_id, 'N/A') AS challan_no FROM wo_scrap_challan LEFT JOIN " +
        tallyDB.config.database +
        ".client_basic_detail ON wo_scrap_challan.wo_client_id = client_basic_detail.code LEFT JOIN " +
        ims_db_name +
        ".components ON wo_scrap_challan.wo_component_id = components.component_key WHERE DATE_FORMAT(wo_scrap_challan.wo_insert_dt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND wo_scrap_challan.challan_status != :status AND wo_scrap_challan.company_branch = :branch GROUP BY wo_scrap_challan.wo_challan_id ORDER BY wo_scrap_challan.wo_insert_dt DESC",
      {
        replacements: {
          date1: date1,
          date2: date2,
          status: "C",
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
  } else if (wise == "clientwise") {
    stmt = await invtDB.query(
      "SELECT *, COALESCE(wo_scrap_challan.wo_challan_id, 'N/A') AS challan_no FROM wo_scrap_challan LEFT JOIN " +
        tallyDB.config.database +
        ".client_basic_detail ON wo_scrap_challan.wo_client_id = client_basic_detail.code LEFT JOIN " +
        ims_db_name +
        ".components ON wo_scrap_challan.wo_component_id = components.component_key WHERE wo_scrap_challan.wo_client_id = :clientid AND wo_scrap_challan.challan_status != :status AND wo_scrap_challan.company_branch = :branch GROUP BY wo_scrap_challan.wo_challan_id ORDER BY wo_scrap_challan.wo_insert_dt DESC",
      {
        replacements: { clientid: data, status: "C", branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );
  } else {
    return new Error("Please select valid filter method");
  }

  let final = [];
  if (stmt.length > 0) {
    if (download == "yes") {
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          delivery_challan_dt: moment(
            stmt[i].wo_insert_dt,
            "YYYY-MM-DD"
          ).format("DD-MM-YYYY"),
          challan_id: stmt[i].challan_no,
          client: stmt[i].name,
          client_code: stmt[i].wo_client_id,
          item_name: stmt[i].c_name,
          item_qty: stmt[i].wo_order_qty,
          item_rate: stmt[i].wo_order_rate,
          item_value: stmt[i].wo_order_qty * stmt[i].wo_order_rate,
          hsn_code: stmt[i].wo_hsn_code,
          ewaybill_no: stmt[i].wo_eway_no,
          ewaybillStatus: stmt[i].wo_ewaybill_status,
        });
      }
    } else if (download == "no") {
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          delivery_challan_dt: moment(
            stmt[i].wo_insert_dt,
            "YYYY-MM-DD"
          ).format("DD-MM-YYYY"),
          challan_id: stmt[i].challan_no,
          client: stmt[i].name,
          client_code: stmt[i].wo_client_id,
          item_name: stmt[i].c_name,
          item_qty: stmt[i].wo_order_qty,
          item_rate: stmt[i].wo_order_rate,
          item_value: stmt[i].wo_order_qty * stmt[i].wo_order_rate,
          challan_type: "scrape",
          ewaybill_no: stmt[i].wo_eway_no,
          ewaybillStatus: stmt[i].wo_ewaybill_status,
        });
      }
    }
  }
  return final;
};

// GET WO CHALLAN CREATE LOCATIONS
router.get("/woChallanLocations", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: "20220621142318" },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    for (let i = 0; i < loc_ids.length; i++) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `location_main` WHERE `location_key` = :location_defined",
        {
          replacements: { location_defined: loc_ids[i] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      stmt2.forEach((element) => {
        locations.push({ id: element.location_key, text: element.loc_name });
      });

      if (i == loc_ids.length - 1) {
        return res.json({ status: "success", success: true, data: locations });
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// PRINT WO Delivery CHALLAN
router.post(
  "/printWorkorderDeliveryChallan",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        challan_id: "required",
        ref_id: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      const { challan_id, ref_id } = req.body;
      let file = {
        url: `${process.env.API_URL}/helper/PRINT/PHP/WO/WOdelivery_challan.php?invoice=${challan_id}&refid=${ref_id}`,
      };
      let options = { format: "A4" };
      await html_to_pdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          let filename = req.body.challan_id.replace(/[/]/g, "_") + ".pdf";
          return res.json({
            status: "success",
            success: true,
            message: "file generated successfully...",
            data: { buffer: pdfBuffer, filename: filename },
          });
        })
        .catch((err) => {
          return res.json({
            status: "error",
            success: false,
            message: "error while generating file...",
          });
        });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// SAVE CREATE Shipment
router.post("/saveCreateShipment", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    let validation = new Validator(req.body.header, {
      billingaddrid: "required",
      billingaddr: "required",
      transaction_id: "required",
      dispatchfromaddrid: "required",
      dispatchfromaddr: "required",
    });

    if (validation.fails()) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    let valid = new Validator(req.body.material, {
      qty: "required|min:1|not_in:0",
      product: "required",
      secondary_product: "required",
      rate: "required|min:1|not_in:0",
      hsncode: "required",
    });

    if (valid.fails()) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    let stmt_check_billadd = await tallyDB.query(
      "SELECT * FROM `client_address_detail` WHERE `addressID` = :code",
      {
        replacements: { code: req.body.header.billingaddrid },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (stmt_check_billadd.length > 0) {
      let stmt_check_disp = await tallyDB.query(
        "SELECT * FROM `client_address_detail` WHERE `addressID` = :code",
        {
          replacements: { code: req.body.header.dispatchfromaddrid },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (stmt_check_disp.length > 0) {
        let stmt_wo = await invtDB.query(
          "SELECT * FROM `wo_purchase_req` WHERE `wo_transaction` = :work_id AND `company_branch` = :branch",
          {
            replacements: {
              work_id: req.body.header.transaction_id,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt_wo.length > 0) {
          if (stmt_wo[0].wo_status == "C") {
            await transaction.rollback();
            return res.json({
              status: "error",
              success: false,
              message:
                "an error encountered while executing request bcz the Work Order has been marked as (ON HOLD / BLOCKED) for any transactions related, please contact to authorized person to resolve this issue..",
            });
          } else {
            let client_id = stmt_wo[0].wo_client_id;
            let client_address_id = stmt_wo[0].wo_client_add_id;
            let client_address = stmt_wo[0].wo_client_address;

            let TransID = await helper.genTransaction(
              "WO_SHIPMENT",
              transaction
            );

            let stmt_prod = await invtDB.query(
              "SELECT * FROM `products` WHERE `product_key` = :product_key",
              {
                replacements: { product_key: req.body.material.product },
                type: invtDB.QueryTypes.SELECT,
              }
            );

            if (stmt_prod.length > 0) {
              let stmt_insert_wo_1 = await invtDB.query(
                "INSERT INTO `wo_delivery_challan` (`company_branch`,`wo_shipment_id`,`wo_vehicle`,`wo_billing_id`,`wo_billing_address`,`wo_client_id`,`wo_client_address`,`wo_client_add_id`,`wo_product_id`,`wo_secondary_product_id`,`wo_order_qty`,`wo_order_rate`,`wo_hsncode`,`wo_sku_description`,`wo_gst_rate`,`wo_eway_no`,`wo_ship_doc_no`,`wo_other_ref`,`wo_dispatch_to_id`,`wo_dispatch_to__line1`,`wo_dispatch_to_pincode`,`wo_insert_dt`,`wo_insert_by`,`wo_transaction`,`wo_dispatch_gstin`) VALUES(:branch,:shipment_id,:vehicle,:billing_id,:billing_address, :client_id, :client_address, :address_id, :product_id, :secondary_product_id, :order_qty, :order_rate, :hsncode, :sku_desc, :gst_rate, :eway_no, :ship_doc_no, :other_ref, :dispatch_id, :dispatch_line_1, :dispatch_pincode, :insert_dt, :insert_by, :wo_transaction, :gstin)",
                {
                  replacements: {
                    branch: req.branch,
                    shipment_id: TransID,
                    vehicle:
                      req.body.header.vehicle == null
                        ? "--"
                        : req.body.header.vehicle,
                    billing_id: req.body.header.billingaddrid,
                    billing_address: req.body.header.billingaddr.replace(
                      /\n/g,
                      "<br>"
                    ),
                    client_id: client_id,
                    client_address: client_address.replace(/\n/g, "<br>"),
                    address_id: client_address_id,
                    product_id: req.body.material.product,
                    secondary_product_id:
                      req.body.material.secondary_product == null
                        ? "--"
                        : req.body.material.secondary_product,
                    order_qty: req.body.material.qty,
                    order_rate: req.body.material.rate,
                    hsncode: req.body.material.hsncode,
                    sku_desc:
                      req.body.material.sku_desc == null
                        ? "--"
                        : req.body.material.sku_desc.replace(/\n/g, "<br>"),
                    gst_rate:
                      req.body.material.gst_rate == null
                        ? "--"
                        : req.body.material.gst_rate,
                    eway_no:
                      req.body.header.eway_no == null
                        ? "--"
                        : req.body.header.eway_no,
                    ship_doc_no:
                      req.body.header.ship_doc_no == null
                        ? "--"
                        : req.body.header.ship_doc_no,
                    other_ref:
                      req.body.header.other_ref == null
                        ? "--"
                        : req.body.header.other_ref,
                    dispatch_id: req.body.header.dispatchfromaddrid,
                    dispatch_line_1: req.body.header.dispatchfromaddr.replace(
                      /\n/g,
                      "<br>"
                    ),
                    dispatch_pincode:
                      req.body.header.dispatchfrompincode == null
                        ? "--"
                        : req.body.header.dispatchfrompincode,
                    insert_dt: moment(
                      req.body.material.insert_dt,
                      "DD-MM-YYYY"
                    ).format("YYYY-MM-DD"),
                    insert_by: req.logedINUser,
                    wo_transaction: req.body.header.transaction_id,
                    gstin:
                      req.body.header.dispatchfromgst == null
                        ? "--"
                        : req.body.header.dispatchfromgst,
                  },
                  type: invtDB.QueryTypes.INSERT,
                  transaction: transaction,
                }
              );

              const length = req.body.component.length;
              for (let i = 0; i < length; i++) {
                //INWARD
                let stmt_in = await invtDB.query(
                  "SELECT SUM ( wo_m_received_qty ) AS total_in_quantity FROM wo_material_received WHERE wo_m_work_id = :wo_id AND wo_insert_type = 'IN' AND wo_min_id = :min_id AND wo_m_component = :component ",
                  {
                    replacements: {
                      wo_id: req.body.header.transaction_id,
                      min_id: req.body.doc_id[i],
                      component: req.body.component[i],
                    },
                    type: invtDB.QueryTypes.SELECT,
                  }
                );

                let totalIN = 0;
                if (stmt_in.length > 0) {
                  totalIN = stmt_in[0].total_in_quantity;
                }

                //OUTWARD
                let stmt_out = await invtDB.query(
                  "SELECT COALESCE(SUM(wo_out_qty),0 ) AS total_out_quantity FROM wo_material_received WHERE wo_m_work_id = :wo_id AND wo_insert_type = 'OUT' AND wo_m_status != 'C' AND wo_min_id = :min_id AND wo_m_component = :component ",
                  {
                    replacements: {
                      wo_id: req.body.header.transaction_id,
                      min_id: req.body.doc_id[i],
                      component: req.body.component[i],
                    },
                    type: invtDB.QueryTypes.SELECT,
                  }
                );

                let totalOUT = 0;
                if (stmt_out.length > 0) {
                  totalOUT = stmt_out[0].total_out_quantity;
                }

                let available_quantity = totalIN - totalOUT;

                if (
                  parseInt(req.body.out_qty[i]) > parseInt(available_quantity)
                ) {
                  await transaction.rollback();
                  return res.json({
                    status: "error",
                    success: false,
                    message: "You don'have available qty for OUT",
                  });
                }

                let stmt_insert = await invtDB.query(
                  "INSERT INTO `wo_material_received` (`company_branch`, `wo_m_client`, `wo_m_component`, `wo_m_sku`, `wo_min_id`, `wo_min_date`, `wo_m_work_id`, `wo_challan_id`, `wo_challan_date`, `wo_out_eway_bill`, `wo_out_rate`, `wo_out_qty`, `wo_out_type`, `wo_insert_type`) VALUES (:branch,:client,:component,:sku,:min_id,:min_date,:work_id,:challan_id,:challan_date,:out_eway_bill,:out_rate,:out_qty,'DELIVERY','OUT')",
                  {
                    replacements: {
                      branch: req.branch,
                      client: client_id,
                      component: req.body.component[i],
                      sku: req.body.material.product,
                      min_id: req.body.doc_id[i],
                      min_date: moment(
                        req.body.doc_date[i],
                        "DD-MM-YYYY"
                      ).format("YYYY-MM-DD"),
                      work_id: req.body.header.transaction_id,
                      challan_id: TransID,
                      challan_date: moment(
                        req.body.material.insert_dt,
                        "DD-MM-YYYY"
                      ).format("YYYY-MM-DD"),
                      out_eway_bill:
                        req.body.header.eway_no == null
                          ? "--"
                          : req.body.header.eway_no,
                      out_rate: req.body.out_rate[i],
                      out_qty: req.body.out_qty[i],
                    },
                    type: invtDB.QueryTypes.INSERT,
                    transaction: transaction,
                  }
                );
              }

              //UPDATE ISSUE QUANTITY
              let stmt_update = await invtDB.query(
                "UPDATE `wo_purchase_req` SET `wo_issue_qty` = `wo_issue_qty` + :qty WHERE `wo_transaction` = :work_id",
                {
                  replacements: {
                    work_id: req.body.header.transaction_id,
                    qty: req.body.material.qty,
                  },
                  type: invtDB.QueryTypes.UPDATE,
                  transaction: transaction,
                }
              );
            } else {
              await transaction.rollback();
              return res.json({
                status: "error",
                success: false,
                message:
                  "some of the products you have try to input by inspect or through the developer console, you may will suspend.. stop such actions",
              });
            }

            await transaction.commit();
            return res.json({
              status: "success",
              success: true,
              message: "Shipment generated successfully...",
            });
          }
        } else {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "an error encountered while executing request bcz might you are trying to break the rules as per our guidlines, you may will suspended!",
          });
        }
      } else {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message:
            "an error encountered while executing request bcz you have select an invalid dispatch from address, please reload the page and try again..",
        });
      }
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "billing address is not valid",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//CREATE SHIPMENT WITH EXCEL
const shipment_data = multer.diskStorage({
  destination: (req, file, callBack) => {
    callBack(null, "./files/excel/");
  },
  filename: (req, file, callBack) => {
    callBack(
      null,
      file.fieldname + "WO" + Date.now() + path.extname(file.originalname)
    );
  },
});

const shipment = multer({
  storage: shipment_data,
});

router.post(
  "/saveShipmentthroughExcel",
  [auth.isAuthorized, shipment.single("file")],
  async (req, res) => {
    if (req.file == undefined) {
      return res.json({
        status: "error",
        success: false,
        message: "Please select file!!!",
      });
    }

    const excelFilePath = req.file;
    const workbook = XLSX.readFile(excelFilePath.path, {
      type: "binary",
      cellDates: true,
      cellNF: false,
      cellText: false,
    });

    //const workbook = XLSX.readFile(excelFilePath.path);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const excelData = XLSX.utils.sheet_to_json(worksheet);

    const validation = new Validator(req.body, {
      billingaddrid: "required",
      transaction_id: "required",
      dispatchaddrid: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    const transaction = await invtDB.transaction();

    const billing_id = req.body.billingaddrid;
    const wo_id = req.body.transaction_id;
    const dispatch_id = req.body.dispatchaddrid;

    let stmt_check_billadd = await tallyDB.query(
      "SELECT * FROM `client_address_detail` WHERE `addressID` = :code",
      {
        replacements: { code: billing_id },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    let billing_address = stmt_check_billadd[0].address;

    let stmt_check_disp = await tallyDB.query(
      "SELECT * FROM `client_address_detail` WHERE `addressID` = :code",
      {
        replacements: { code: dispatch_id },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    let dispatch_address = stmt_check_disp[0].address;

    let stmt_wo = await invtDB.query(
      "SELECT * FROM `wo_purchase_req` WHERE `wo_transaction` = :work_id AND `company_branch` = :branch",
      {
        replacements: { work_id: wo_id, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let client_id, client_address_id, client_address;
    if (stmt_wo.length > 0) {
      client_id = stmt_wo[0].wo_client_id;
      client_address_id = stmt_wo[0].wo_client_add_id;
      client_address = stmt_wo[0].wo_client_address;
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Work Order not present",
      });
    }

    try {
      for (let i = 0; i < excelData.length; i++) {
        const row = excelData[i];
        const date = moment(row.DATE, "YYYY-MM-DD")
          .add(1, "day")
          .format("YYYY-MM-DD");

        if (!row.PRODUCT) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Please fill all row data!!!",
          });
        }

        let product_key, p_hsn;
        const result = await invtDB.query(
          "SELECT product_key, p_hsncode FROM products WHERE is_enabled = 'Y' AND p_name = :product_name",
          {
            replacements: { product_name: row.PRODUCT },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (result.length > 0) {
          product_key = result[0].product_key;
          p_hsn = result[0].p_hsncode;
        } else {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: `Product (${row.PRODUCT}) is not valid or disabled for further transaction..`,
          });
        }

        let TransID = await helper.genTransaction("WO_SHIPMENT", transaction);

        let stmt_insert_wo_1 = await invtDB.query(
          "INSERT INTO `wo_delivery_challan` (`company_branch`,`wo_shipment_id`,`wo_vehicle`,`wo_billing_id`,`wo_billing_address`,`wo_client_id`,`wo_client_address`,`wo_client_add_id`,`wo_secondary_product_id`,`wo_product_id`,`wo_order_qty`,`wo_order_rate`,`wo_hsncode`,`wo_eway_no`,`wo_ship_doc_no`,`wo_other_ref`,`wo_dispatch_to_id`,`wo_dispatch_to__line1`,`wo_insert_dt`,`wo_insert_by`,`wo_transaction`,`wo_challan_txn_id`,`wo_del_challan_status`) VALUES(:branch,:shipment_id,:vehicle,:billing_id,:billing_address, :client_id, :client_address, :address_id, :secondary_product_id, :product_id, :order_qty, :order_rate, :hsncode, :eway_no, :ship_doc_no, :other_ref, :dispatch_id, :dispatch_line_1, :insert_dt, :insert_by, :wo_transaction, :challan_id, 'CREATED')",
          {
            replacements: {
              branch: req.branch,
              shipment_id: TransID,
              billing_id: billing_id,
              billing_address: billing_address.replace(/\n/g, "<br>"),
              client_id: client_id,
              client_address: client_address.replace(/\n/g, "<br>"),
              address_id: client_address_id,
              secondary_product_id: product_key,
              product_id: product_key,
              order_qty: row.QTY,
              order_rate: row.RATE,
              hsncode: p_hsn,
              vehicle: row.VEHICLE_NO == null ? "--" : row.VEHICLE_NO,
              eway_no: row.EWAY_NO == null ? "--" : row.EWAY_NO,
              ship_doc_no: row.SHIP_DOC_NO == null ? "--" : row.SHIP_DOC_NO,
              other_ref: row.OTHER_REF == null ? "--" : row.OTHER_REF,
              dispatch_id: dispatch_id,
              dispatch_line_1: dispatch_address.replace(/\n/g, "<br>"),
              insert_dt: date,
              insert_by: req.logedINUser,
              wo_transaction: wo_id,
              challan_id: row.CHALLAN_NO,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        //UPDATE ISSUE QUANTITY
        let stmt_update = await invtDB.query(
          "UPDATE `wo_purchase_req` SET `wo_issue_qty` = `wo_issue_qty` + :qty WHERE `wo_transaction` = :work_id",
          {
            replacements: { work_id: wo_id, qty: row.QTY },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transaction,
          }
        );
      }

      await transaction.commit();
      return res.json({
        message: "Challan created successfully",
        status: "success",
        success: true,
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// PREVIEW UPLOAD  DATA
router.post(
  "/previewExcelShipmentData",
  [auth.isAuthorized, shipment.single("file")],
  async (req, res) => {
    if (req.file == undefined) {
      return res.json({
        status: "error",
        success: false,
        message: "Please select file!!!",
      });
    }

    const excelFilePath = req.file;

    const workbook = XLSX.readFile(excelFilePath.path, {
      type: "binary",
      cellDates: true,
      cellNF: false,
      cellText: false,
    });

    //const workbook = XLSX.readFile(excelFilePath.path);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const excelData = XLSX.utils.sheet_to_json(worksheet);

    try {
      for (let i = 0; i < excelData.length; i++) {
        const row = excelData[i];

        if (!row.PRODUCT) {
          return res.json({
            status: "error",
            success: false,
            message: "Please fill all row data!!!",
          });
        }

        let product_key, p_hsn;
        const result = await invtDB.query(
          "SELECT product_key, p_hsncode FROM products WHERE is_enabled = 'Y' AND p_name = :product_name",
          {
            replacements: { product_name: row.PRODUCT },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (result.length > 0) {
          product_key = result[0].product_key;
          p_hsn = result[0].p_hsncode;
        } else {
          return res.json({
            status: "error",
            success: false,
            message: `Product (${row.PRODUCT}) is not valid or disabled for further transaction..`,
          });
        }

        row.DATE = moment(row.DATE, "YYYY-MM-DD")
          .add(1, "day")
          .format("DD-MM-YYYY");
      }
      return res.json({ data: excelData, status: "success", success: true });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH WORK ORDER SHIPMENT LIST
router.post("/getWorkOrderShipment", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      data: "required",
      wise: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    const { data, wise } = req.body;
    let stmt;

    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        "SELECT *, COALESCE(wo_delivery_challan.wo_shipment_id, 'N/A') AS shipment_no FROM wo_delivery_challan LEFT JOIN products ON wo_delivery_challan.wo_product_id = products.product_key LEFT JOIN " +
          tallyDB.config.database +
          ".client_basic_detail ON wo_delivery_challan.wo_client_id = client_basic_detail.code WHERE DATE_FORMAT(wo_delivery_challan.wo_insert_dt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND wo_delivery_challan.challan_status != :status AND wo_delivery_challan.company_branch = :branch ORDER BY wo_delivery_challan.ID DESC",
        {
          replacements: {
            date1: date1,
            date2: date2,
            status: "C",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "clientwise") {
      stmt = await invtDB.query(
        "SELECT *, COALESCE(wo_delivery_challan.wo_shipment_id, 'N/A') AS shipment_no FROM wo_delivery_challan LEFT JOIN products ON wo_delivery_challan.wo_product_id = products.product_key LEFT JOIN " +
          tallyDB.config.database +
          ".client_basic_detail ON wo_delivery_challan.wo_client_id = client_basic_detail.code WHERE wo_delivery_challan.wo_client_id = :clientid AND wo_delivery_challan.challan_status != :status AND wo_delivery_challan.company_branch = :branch ORDER BY wo_delivery_challan.ID DESC",
        {
          replacements: { clientid: data, status: "C", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "wo_transaction_wise") {
      stmt = await invtDB.query(
        "SELECT *, COALESCE(wo_delivery_challan.wo_shipment_id, 'N/A') AS shipment_no FROM wo_delivery_challan LEFT JOIN products ON wo_delivery_challan.wo_product_id = products.product_key LEFT JOIN " +
          tallyDB.config.database +
          ".client_basic_detail ON wo_delivery_challan.wo_client_id = client_basic_detail.code WHERE wo_delivery_challan.wo_transaction LIKE CONCAT('%', :wo_id, '%') AND wo_delivery_challan.challan_status != :status AND wo_delivery_challan.company_branch = :branch ORDER BY wo_delivery_challan.ID DESC",
        {
          replacements: { wo_id: data, status: "C", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Please select valid filter method",
      });
    }

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        let stmt1 = await invtDB.query(
          "SELECT `challan_status`, `wo_del_challan_status` FROM `wo_delivery_challan` WHERE `wo_shipment_id` = :shipment_id AND `wo_delivery_challan`.`company_branch` = :branch",
          {
            replacements: {
              shipment_id: stmt[i].shipment_no,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        // STATUS

        let del_challan_status = stmt1[0].wo_del_challan_status;
        let shipment_status = stmt1[0].challan_status;

        final.push({
          shipment_dt: moment(stmt[i].wo_insert_dt, "YYYY-MM-DD").format(
            "DD-MM-YYYY"
          ),
          wo_transaction_id: stmt[i].wo_transaction,
          shipment_id: stmt[i].shipment_no,
          sku: stmt[i].wo_product_id,
          sku_code: stmt[i].p_sku,
          m_sku: stmt[i].wo_m_sku,
          client: stmt[i].name,
          client_code: stmt[i].wo_client_id,
          clientaddress: stmt[i].wo_client_address.replace(/<br>/g, "\n"),
          client_add_id: stmt[i].wo_client_add_id,
          billingaddress: stmt[i].wo_billing_address.replace(/<br>/g, "\n"),
          billing_id: stmt[i].wo_billing_id,
          dispatchaddress: stmt[i].wo_dispatch_to__line1.replace(/<br>/g, "\n"),
          dispatch_id: stmt[i].wo_dispatch_to_id,
          wo_sku_name: stmt[i].p_name,
          wo_order_qty: stmt[i].wo_order_qty,
          wo_order_rate: stmt[i].wo_order_rate,
          del_challan_status: del_challan_status,
          shipment_status: shipment_status,
        });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "no orders were found that match the given search criteria",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// EDIT WO SHIPMENT
router.post("/editWorkorderShipment", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      shipment_no: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    let stmt = await invtDB.query(
      "SELECT wo_delivery_challan.*, wo_delivery_challan.ID AS row_id, products.product_key, products.p_name, products.p_sku, units.units_name, client_basic_detail.name FROM wo_delivery_challan LEFT JOIN " +
        tallyDB.config.database +
        ".client_basic_detail ON client_basic_detail.code = wo_delivery_challan.wo_client_id LEFT JOIN products ON wo_delivery_challan.wo_product_id = products.product_key LEFT JOIN units ON products.p_uom = units.units_id WHERE wo_delivery_challan.wo_shipment_id = :shipment AND wo_delivery_challan.company_branch =:branch ORDER BY products.p_sku",
      {
        replacements: { shipment: req.body.shipment_no, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let stmt_2 = await invtDB.query(
      "SELECT wo_material_received.*, components.component_key, components.c_name, components.c_part_no FROM wo_material_received LEFT JOIN components ON wo_material_received.wo_m_component = components.component_key WHERE wo_challan_id = :shipment AND company_branch =:branch",
      {
        replacements: { shipment: req.body.shipment_no, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let min_out_data = [];
    for (let i = 0; i < stmt_2.length; i++) {
      min_out_data.push({
        row_id: stmt_2[i].ID,
        wo_id: stmt_2[i].wo_transaction,
        component_name: stmt_2[i].c_name,
        component_part_no: stmt_2[i].c_part_no,
        component_key: stmt_2[i].component_key,
        wo_min_id: stmt_2[i].wo_min_id,
        wo_min_date: stmt_2[i].wo_min_date,
        wo_out_rate: stmt_2[i].wo_out_rate,
        wo_out_qty: stmt_2[i].wo_out_qty,
      });
    }

    if (stmt.length > 0) {
      let stmt_client_datail = await tallyDB.query(
        "SELECT * FROM client_basic_detail WHERE code = :client_id",
        {
          replacements: { client_id: stmt[0].wo_client_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      let selectedClient,
        selectedAddressLabel,
        client_address = "";
      if (stmt_client_datail.length > 0) {
        selectedClient = {
          value: stmt_client_datail[0].code,
          label: stmt_client_datail[0].name,
        };
      } else {
        selectedClient = { value: "0", label: "N/A" };
      }

      let stmt_client_branch = await tallyDB.query(
        "SELECT * FROM client_address_detail WHERE addressID = :address_id",
        {
          replacements: { address_id: stmt[0].wo_client_add_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (stmt_client_branch.length > 0) {
        if (stmt[0].wo_client_address != "") {
          client_address = stmt_client_branch[0].city;
          selectedAddressLabel = {
            value: stmt[0].wo_client_add_id,
            label: stmt_client_branch[0].address,
          };
        } else {
          client_address = stmt_client_branch[0].city;
          selectedAddressLabel = { value: "0", label: "- - ADDRESS N/A - -" };
        }
      }

      let billing_addr = await tallyDB.query(
        "SELECT * FROM `client_address_detail` WHERE `addressID` = :billingcode",
        {
          replacements: { billingcode: stmt[0].wo_billing_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (billing_addr.length > 0) {
        selectBillingLabel = {
          value: stmt[0].wo_billing_id,
          label: billing_addr[0].city,
        };
      } else {
        selectBillingLabel = { value: "0", label: "N/A" };
      }

      let dispatch_addr = await tallyDB.query(
        "SELECT * FROM `client_address_detail` WHERE `addressID` = :dispatchcode",
        {
          replacements: { dispatchcode: stmt[0].wo_dispatch_to_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (dispatch_addr.length > 0) {
        selectDispatchLabel = {
          value: stmt[0].wo_dispatch_to_id,
          label: dispatch_addr[0].city,
        };
      } else {
        selectDispatchLabel = { value: "0", label: "N/A" };
      }

      return res.json({
        status: "success",
        success: true,
        material: {
          trans_row_id: Buffer.from(stmt[0].row_id.toString()).toString(
            "base64"
          ),
          product_key: stmt[0].product_key,
          product_name: stmt[0].p_name,
          product_sku: stmt[0].p_sku,
          sku_desc: stmt[0].wo_sku_description.replace(/<br>/g, "\n"),
          product_rate: stmt[0].wo_order_rate,
          hsn_code: stmt[0].wo_hsncode,
          unit_name: stmt[0].units_name,
          received_qty: stmt[0].wo_order_qty,
        },
        header: {
          clientcode: selectedClient,
          clientaddress: selectedAddressLabel,
          client_branch: client_address,

          eway_no: stmt[0].wo_eway_no,
          ship_doc_no: stmt[0].wo_ship_doc_no,
          other_ref: stmt[0].wo_other_ref,
          vehicle: stmt[0].wo_vehicle,

          billing_info: selectBillingLabel,
          billing_address: stmt[0].wo_billing_address.replace(/<br>/g, "\n"),

          dispatch_info: selectDispatchLabel,
          dispatch_address: stmt[0].wo_dispatch_to__line1.replace(
            /<br>/g,
            "\n"
          ),

          wo_id: stmt[0].wo_transaction,
          shipment_id: stmt[0].wo_shipment_id,
          challan_remark: stmt[0].wo_remark,
        },
        min_out_data: min_out_data,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "unable to fetch any shipment",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPDATE WO SHIPMENT
router.post("/updateWO_Shipment", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    var header = req.body.header;
    var material = req.body.material;
    var min_out = req.body.min_out;

    let validation = new Validator(req.body, {
      shipment_id: "required",
      wo_id: "required",
    });

    if (validation.fails()) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    let validation1 = new Validator(
      {
        product: material.product,
        qty: material.qty,
        rate: material.rate,
      },
      {
        product: "required",
        qty: "required|min:1",
        rate: "required|min:1",
      }
    );

    if (validation1.fails()) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    let stmt = await invtDB.query(
      "SELECT * FROM `wo_delivery_challan` WHERE `wo_shipment_id` = :shipment_id AND `wo_transaction` = :wo_id AND `company_branch` = :branch",
      {
        replacements: {
          shipment_id: req.body.shipment_id,
          wo_id: req.body.wo_id,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let previous_qty = stmt[0].wo_order_qty;

    if (stmt.length > 0) {
      let data = moment(stmt[0].wo_insert_dt, "YYYY-MM-DD HH:mm:ss").format(
        "YYYY-MM-DD HH:mm:ss"
      );
      let date = new Date(data);
      let diff = new Date() - date;
      let hours = diff / 1000 / 60 / 60;

      if (hours > 6000) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message:
            "updation denied due to time limitaion bonding upto 48h only ",
        });
      } else {
        let stmt_updt_wo1 = await invtDB.query(
          "UPDATE `wo_delivery_challan` SET `wo_client_add_id`= :clientbranch, `wo_client_address`= :clientaddress, `wo_eway_no` = :eway, `wo_ship_doc_no` = :ship_doc, `wo_vehicle` = :vehicle, `wo_other_ref` = :other_ref, `wo_billing_id` = :billingid, `wo_billing_address` = :billingaddress, `wo_dispatch_to_id` = :dispatchid, `wo_dispatch_to__line1` = :dispatchaddress, `wo_remark` = :challan_remark, `wo_update_dt` = :update_dt, `wo_update_by` = :update_by WHERE `wo_shipment_id` = :shipment",
          {
            replacements: {
              clientbranch: header.clientbranch,
              clientaddress: header.clientaddress.replace(/\n/g, "<br>"),
              eway: header.eway,
              ship_doc: header.ship_doc,
              vehicle: header.vehicle,
              other_ref: header.other_ref,
              billingid: header.billingid,
              billingaddress: header.billingaddress.replace(/\n/g, "<br>"),
              dispatchid: header.dispatchid,
              dispatchaddress: header.dispatchaddress.replace(/\n/g, "<br>"),
              shipment: req.body.shipment_id,
              challan_remark: header.challan_remark,
              update_dt: moment(new Date())
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD HH:mm:ss"),
              update_by: req.logedINUser,
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transaction,
          }
        );

        let stmt_updt_wo2 = await invtDB.query(
          "UPDATE `wo_delivery_challan` SET `wo_order_qty`= :qty, `wo_hsncode`= :hsncode, `wo_order_rate`= :rate , `wo_sku_description` = :wo_sku_desc WHERE `wo_product_id`= :product AND `wo_shipment_id` = :shipment",
          {
            replacements: {
              qty: material.qty,
              hsncode: material.hsncode,
              rate: material.rate,
              product: material.product,
              shipment: req.body.shipment_id,
              wo_sku_desc: material.wo_sku_desc.replace(/\n/g, "<br>"),
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transaction,
          }
        );

        //UPDATE ISSUE QUANTITY
        let stmt_update = await invtDB.query(
          "UPDATE `wo_purchase_req` SET `wo_issue_qty` = (`wo_issue_qty` + :qty) - :previous_qty WHERE `wo_transaction` = :wo_id",
          {
            replacements: {
              wo_id: req.body.wo_id,
              qty: material.qty,
              previous_qty: previous_qty,
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transaction,
          }
        );

        const comp_len = req.body.min_out.comp.length;

        //UPDATE WO_MATERIAL_RECEIVED
        if (stmt_updt_wo2.length > 0) {
          for (let i = 0; i < comp_len; i++) {
            let stmt_rm_update = await invtDB.query(
              "UPDATE `wo_material_received` SET `wo_out_qty`= :qty, `wo_out_eway_bill`= :eway, `wo_m_update_dt`= :update_dt, `wo_m_update_by`= :update_by WHERE `ID` = :id AND `wo_m_component` = :comp AND `wo_m_work_id` = :wo_id AND `wo_challan_id` = :shipment",
              {
                replacements: {
                  id: min_out.id[i],
                  comp: min_out.comp[i],
                  qty: min_out.qty[i],
                  eway: header.eway,
                  update_dt: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm:ss"),
                  update_by: req.logedINUser,
                  wo_id: req.body.wo_id,
                  shipment: req.body.shipment_id,
                },
                type: invtDB.QueryTypes.UPDATE,
                transaction: transaction,
              }
            );
          }
        } else {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "an operation for updation has failed, while updating the Challan..",
          });
        }

        await transaction.commit();
        return res.json({
          status: "success",
          success: true,
          message: "Shipment has been updated successfully",
        });
      }
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message:
          "an error encountered while executing request bcz might you are trying to break the rules as per our guidlines, you may will suspended!",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// CANCEL WO SHIPMENT
router.post("/woShipmentCancel", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    let validation = new Validator(req.body, {
      wo_id: "required",
      shipment_id: "required",
    });

    if (validation.fails()) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: validation.errors.all(),
      });
    }

    let stmt_check = await invtDB.query(
      "SELECT * FROM `wo_delivery_challan` WHERE `wo_shipment_id` = :shipment_id AND `wo_transaction` = :wo_id AND `company_branch` = :branch",
      {
        replacements: {
          shipment_id: req.body.shipment_id,
          wo_id: req.body.wo_id,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let qty = stmt_check[0].wo_order_qty;

    let stmt = await invtDB.query(
      "UPDATE wo_delivery_challan SET challan_status = 'C', challan_can_remark = :remark WHERE wo_transaction = :wo_id AND wo_shipment_id = :shipment_id",
      {
        replacements: {
          remark: req.body.remark == null ? "--" : req.body.remark,
          wo_id: req.body.wo_id,
          shipment_id: req.body.shipment_id,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      }
    );

    let stmtUpdate = await invtDB.query(
      "UPDATE wo_material_received SET wo_m_status = 'C' WHERE wo_challan_id = :shipment_id AND wo_m_work_id = :wo_id AND wo_insert_type = 'OUT'",
      {
        replacements: {
          shipment_id: req.body.shipment_id,
          wo_id: req.body.wo_id,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      }
    );

    if (stmt.length > 0) {
      //UPDATE ISSUE QUANTITY
      let stmt_update = await invtDB.query(
        "UPDATE `wo_purchase_req` SET `wo_issue_qty` = `wo_issue_qty` - :qty WHERE `wo_transaction` = :wo_id",
        {
          replacements: { wo_id: req.body.wo_id, qty: qty },
          type: invtDB.QueryTypes.UPDATE,
          transaction: transaction,
        }
      );

      await transaction.commit();
      return res.json({
        status: "success",
        success: true,
        message: "Shipment cancelled successfully",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// CREATE DELIVERY CHALLAN
router.post(
  "/createDeliveryChallan",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      let validation = new Validator(req.body, {
        shipment_id: "required|array",
        wo_transaction_id: "required|array",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      let TransID = await helper.genTransaction("WO_DEL_CHALLAN", transaction);

      for (let i = 0; i < req.body.shipment_id.length; i++) {
        let stmt_wo = await invtDB.query(
          "SELECT * FROM `wo_delivery_challan` WHERE `wo_transaction` = :wo_id AND `wo_shipment_id` = :shipment_id",
          {
            replacements: {
              wo_id: req.body.wo_transaction_id[i],
              shipment_id: req.body.shipment_id[i],
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (
          req.body.client_id === stmt_wo[0].wo_client_id &&
          req.body.client_address_id === stmt_wo[0].wo_client_add_id &&
          req.body.billing_id === stmt_wo[0].wo_billing_id &&
          req.body.dispatch_id === stmt_wo[0].wo_dispatch_to_id
        ) {
          //UPDATE CHALLAN STATUS
          let stmt_update = await invtDB.query(
            "UPDATE `wo_delivery_challan` SET `wo_challan_txn_id` = :challan_id , `wo_del_challan_status` = 'CREATED', `wo_remark` = :remark WHERE `wo_transaction` = :wo_id AND `wo_shipment_id` = :shipment",
            {
              replacements: {
                challan_id: TransID,
                wo_id: req.body.wo_transaction_id[i],
                shipment: req.body.shipment_id[i],
                remark: req.body.remark == null ? "--" : req.body.remark,
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            }
          );

          if (stmt_update.length < 0) {
            await transaction.rollback();
            return res.json({
              status: "error",
              success: false,
              message: "an error challan status not updated",
            });
          }
        } else {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Client is not same for all shipment",
          });
        }
      }

      await transaction.commit();
      return res.json({
        status: "success",
        success: true,
        message: "Delivery Challan generated successfully...",
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH DELIVERY CHALLAN LIST
router.post("/fetchDeliveryChallan", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      data: "required",
      wise: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    const { data, wise } = req.body;
    let stmt;

    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        "SELECT *, COALESCE(wo_delivery_challan.wo_challan_txn_id, 'N/A') AS challan_no FROM wo_delivery_challan LEFT JOIN " +
          tallyDB.config.database +
          ".client_basic_detail ON wo_delivery_challan.wo_client_id = client_basic_detail.code WHERE DATE_FORMAT(wo_delivery_challan.wo_insert_dt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND wo_delivery_challan.challan_status != :status AND wo_delivery_challan.wo_del_challan_status = 'CREATED' AND wo_delivery_challan.company_branch = :branch GROUP BY wo_delivery_challan.wo_challan_txn_id ORDER BY wo_delivery_challan.ID DESC",
        {
          replacements: {
            date1: date1,
            date2: date2,
            status: "C",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "clientwise") {
      stmt = await invtDB.query(
        "SELECT *, COALESCE(wo_delivery_challan.wo_challan_txn_id, 'N/A') AS challan_no FROM wo_delivery_challan LEFT JOIN " +
          tallyDB.config.database +
          ".client_basic_detail ON wo_delivery_challan.wo_client_id = client_basic_detail.code WHERE wo_delivery_challan.wo_client_id = :clientid AND wo_delivery_challan.challan_status != :status AND wo_delivery_challan.wo_del_challan_status = 'CREATED' AND wo_delivery_challan.company_branch = :branch GROUP BY wo_delivery_challan.wo_challan_txn_id ORDER BY wo_delivery_challan.ID DESC",
        {
          replacements: { clientid: data, status: "C", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Please select valid filter method",
      });
    }

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          delivery_challan_dt: moment(
            stmt[i].wo_insert_dt,
            "YYYY-MM-DD"
          ).format("DD-MM-YYYY"),
          challan_id: stmt[i].challan_no,
          wo_chlln_txn_id: stmt[i].wo_challan_txn_id,
          client: stmt[i].name,
          client_code: stmt[i].wo_client_id,
          clientaddress: stmt[i].wo_client_address.replace(/<br>/g, ""),
          billingaddress: stmt[i].wo_billing_address.replace(/<br>/g, ""),
          shippingaddress: stmt[i].wo_dispatch_to__line1.replace(/<br>/g, ""),
        });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "no orders were found that match the given search criteria",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET DELIVERY CHALLAN DETAILS
router.post(
  "/getDeliveryChallanDetails",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        challan_id: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      let stmt;

      stmt = await invtDB.query(
        "SELECT * FROM wo_delivery_challan LEFT JOIN products ON wo_delivery_challan.wo_secondary_product_id = products.product_key LEFT JOIN " +
          tallyDB.config.database +
          ".client_basic_detail ON wo_delivery_challan.wo_client_id = client_basic_detail.code WHERE wo_delivery_challan.wo_challan_txn_id = :challan_id AND wo_delivery_challan.wo_del_challan_status = :status AND wo_delivery_challan.company_branch = :branch ",
        {
          replacements: {
            challan_id: req.body.challan_id,
            status: "CREATED",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        let final = [];
        for (let i = 0; i < stmt.length; i++) {
          final.push({
            delivery_challan_dt: moment(
              stmt[i].wo_insert_dt,
              "YYYY-MM-DD HH:mm:ss"
            ).format("DD-MM-YYYY HH:mm:ss"),
            wo_transaction_id: stmt[i].wo_transaction,
            wo_shipment_id: stmt[i].wo_shipment_id,
            sku: stmt[i].wo_product_id,
            sku_code: stmt[i].p_sku,
            m_sku: stmt[i].wo_m_sku,
            client: stmt[i].name,
            client_code: stmt[i].wo_client_id,
            clientaddress: stmt[i].wo_client_address,
            billingaddress: stmt[i].wo_billing_address,
            shippingaddress: stmt[i].wo_dispatch_to__line1,
            wo_sku_name: stmt[i].p_name,
            wo_order_qty: stmt[i].wo_order_qty,
            wo_order_rate: stmt[i].wo_order_rate,
          });
        }

        return res.json({ status: "success", success: true, data: final });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "no orders were found that match the given search criteria",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// GET REPORT OF DELIVERY CHALLAN
router.post("/fetch_DC_report", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
    });
  }
  try {
    let stmt1;
    if (searchBy == "date") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt1 = await invtDB.query(
        `SELECT wo_material_received.*, components.*, SUM(wo_material_received.wo_m_received_qty) AS total_min_qty
FROM wo_material_received
LEFT JOIN components ON wo_material_received.wo_m_component = components.component_key
WHERE wo_material_received.company_branch = :branch
AND wo_material_received.wo_insert_type = 'IN'
AND DATE_FORMAT(wo_material_received.wo_min_date,'%Y-%m-%d') BETWEEN :from AND :to
GROUP BY wo_material_received.wo_m_component, wo_material_received.wo_min_id, wo_material_received.wo_m_received_rate, DATE_FORMAT(wo_material_received.wo_min_date,'%Y-%m-%d')
ORDER BY wo_material_received.wo_min_date DESC`,
        {
          replacements: { branch: req.branch, from: fromdate, to: todate },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "search method is not valid",
      });
    }

    if (stmt1.length === 0) {
      return res.json({
        status: "error",
        success: false,
        message: "No Data Found",
      });
    }

    // Extract all min IDs from stmt1
    const min_id = stmt1.map((item) => item.wo_min_id);

    // Fetch all stmt2 records in a single query using transactionIds
    const stmt2 = await invtDB.query(
      "SELECT * FROM wo_material_received WHERE wo_material_received.wo_insert_type = 'OUT' AND wo_material_received.wo_min_id IN (:transactions) ORDER BY wo_material_received.ID DESC",
      {
        replacements: { transactions: min_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // Now, process stmt1 and stmt2 to generate the result
    const result = await Promise.all(
      stmt1.map(async (item, index) => {
        const relatedStmt2 = stmt2.filter(
          (challanCreated) =>
            challanCreated.wo_min_id === item.wo_min_id &&
            challanCreated.wo_m_component === item.wo_m_component &&
            challanCreated.wo_out_rate === item.wo_m_received_rate
        );

        const minQty = item.total_min_qty;
        const sumChallanQty = relatedStmt2.reduce(
          (sum, challanCreated) => sum + parseInt(challanCreated.wo_out_qty),
          0
        );
        const pendingQty = parseInt(minQty) - sumChallanQty;

        const challanPromises = relatedStmt2.map(
          async (challanCreated, index) => {
            const challan = await runQueryAndGetChallanNo(
              challanCreated.wo_challan_id,
              challanCreated.wo_out_type
            );

            return {
              serial_no: "Dispatch",
              challan_no: challan?.challanNo ?? "--",
              challan_date: moment(challanCreated.wo_challan_date).format(
                "DD-MM-YYYY"
              ),
              challan_qty: challanCreated.wo_out_qty,
              challan_rate: challanCreated.wo_out_rate,
              challan_value:
                parseInt(challanCreated.wo_out_qty) *
                parseInt(challanCreated.wo_out_rate),
              challan_eway: challan?.ewayNo ?? "--",
            };
          }
        );

        const challanResults = await Promise.all(challanPromises);

        return {
          serial_no: "Received",
          min_id: item.wo_min_id,
          part_code: item.c_part_no,
          part_name: item.c_name,
          min_qty: item.total_min_qty,
          min_rate: item.wo_m_received_rate,
          min_value:
            parseInt(item.wo_m_received_qty) *
            parseInt(item.wo_m_received_rate),
          min_eway: item.wo_min_eway_bill,
          min_date: moment(item.wo_min_date).format("DD-MM-YYYY"),
          challan: challanResults,
          pending_qty: pendingQty,
        };
      })
    );

    async function runQueryAndGetChallanNo(woChallanId, type) {
      let stmt4;

      if (type == "DELIVERY" || type == "--") {
        stmt4 = await invtDB.query(
          "SELECT wo_challan_txn_id, wo_eway_no FROM wo_delivery_challan WHERE wo_del_challan_status = 'CREATED' AND wo_shipment_id = :shipment_id",
          {
            replacements: { shipment_id: woChallanId },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else {
        stmt4 = await invtDB.query(
          "SELECT wo_challan_txn_id, wo_eway_no FROM wo_material_challan WHERE wo_del_challan_status = 'CREATED' AND wo_shipment_id = :shipment_id",
          {
            replacements: { shipment_id: woChallanId },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      }

      if (stmt4 && stmt4.length > 0) {
        const challanNo = stmt4[0].wo_challan_txn_id;
        const ewayNo = stmt4[0].wo_eway_no;
        return { challanNo, ewayNo };
      } else {
        return null;
      }
    }

    return res.json({ status: "success", success: true, data: result });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// SAVE CREATE RETURN CHALLAN
router.post(
  "/saveCreateReturnChallan",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      let validation = new Validator(req.body.header, {
        billingaddrid: "required",
        billingaddr: "required",
        transaction_id: "required",
        dispatchfromaddrid: "required",
        dispatchfromaddr: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      let component_length = req.body.material.component.length;

      for (let i = 0; i < component_length; i++) {
        let valid = new Validator({
          qty: req.body.material.qty[i],
          component: req.body.material.component[i],
          rate: req.body.material.rate[i],
          hsncode: req.body.material.hsncode[i],
        });

        if (valid.fails()) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "something you missing in form field to supply",
          });
        }
      }

      let stmt_check_billadd = await tallyDB.query(
        "SELECT * FROM `client_address_detail` WHERE `addressID` = :code",
        {
          replacements: { code: req.body.header.billingaddrid },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (stmt_check_billadd.length > 0) {
        let stmt_check_disp = await tallyDB.query(
          "SELECT * FROM `client_address_detail` WHERE `addressID` = :code",
          {
            replacements: { code: req.body.header.dispatchfromaddrid },
            type: tallyDB.QueryTypes.SELECT,
          }
        );

        if (stmt_check_disp.length > 0) {
          let stmt_wo = await invtDB.query(
            "SELECT * FROM `wo_purchase_req` WHERE `wo_transaction` = :work_id AND `company_branch` = :branch",
            {
              replacements: {
                work_id: req.body.header.transaction_id,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (stmt_wo.length > 0) {
            if (stmt_wo[0].wo_status == "C") {
              await transaction.rollback();
              return res.json({
                status: "error",
                success: false,
                message:
                  "an error encountered while executing request bcz the Work Order has been marked as (ON HOLD / BLOCKED) for any transactions related, please contact to authorized person to resolve this issue..",
              });
            } else {
              let client_id = stmt_wo[0].wo_client_id;
              let client_type = stmt_wo[0].wo_client_type;
              let client_address_id = stmt_wo[0].wo_client_add_id;
              let client_address = stmt_wo[0].wo_client_address;

              let TransID = await helper.genTransaction(
                "WO_SHIPMENT",
                transaction
              );

              let stmt_comp;
              for (let i = 0; i < component_length; i++) {
                if (
                  req.body.material.qty[i] == null ||
                  req.body.material.qty[i] == "--" ||
                  req.body.material.qty[i] == ""
                ) {
                  continue;
                }

                stmt_comp = await invtDB.query(
                  "SELECT * FROM `components` WHERE `component_key` = :component_key",
                  {
                    replacements: {
                      component_key: req.body.material.component[i],
                    },
                    type: invtDB.QueryTypes.SELECT,
                  }
                );

                if (stmt_comp.length > 0) {
                  let stmt_insert_wo_1 = await invtDB.query(
                    "INSERT INTO `wo_material_challan` (`company_branch`,`wo_shipment_id`,`wo_vehicle`,`wo_billing_id`,`wo_billing_address`,`wo_client_id`,`wo_client_address`,`wo_client_add_id`,`wo_component_id`,`wo_product_id`,`wo_order_qty`,`wo_order_rate`,`wo_hsncode`,`wo_eway_no`,`wo_ship_doc_no`,`wo_other_ref`, `wo_comp_remark`,`wo_dispatch_to_id`,`wo_dispatch_to__line1`,`wo_insert_dt`,`wo_insert_by`,`wo_transaction`) VALUES(:branch,:shipment_id, :vehicle,  :billing_id,:billing_address, :client_id, :client_address, :address_id, :component_id, :product_id, :order_qty, :order_rate, :hsncode, :eway, :ship_doc_no, :other_ref, :remark, :dispatch_id, :dispatch_line_1, :insert_dt, :insert_by, :wo_transaction)",
                    {
                      replacements: {
                        branch: req.branch,
                        shipment_id: TransID,
                        vehicle:
                          req.body.header.vehicle == null
                            ? "--"
                            : req.body.header.vehicle,
                        billing_id: req.body.header.billingaddrid,
                        billing_address: req.body.header.billingaddr.replace(
                          /\n/g,
                          "<br>"
                        ),
                        client_id: client_id,
                        client_address: client_address,
                        address_id: client_address_id,
                        component_id: req.body.material.component[i],
                        product_id: req.body.product_id,
                        order_qty: req.body.material.qty[i],
                        order_rate: req.body.material.rate[i],
                        hsncode: req.body.material.hsncode[i],
                        eway:
                          req.body.header.eway_no == null
                            ? "--"
                            : req.body.header.eway_no,
                        ship_doc_no:
                          req.body.header.ship_doc == null
                            ? "--"
                            : req.body.header.ship_doc,
                        other_ref:
                          req.body.header.other_ref == null
                            ? "--"
                            : req.body.header.other_ref,
                        dispatch_id: req.body.header.dispatchfromaddrid,
                        dispatch_line_1:
                          req.body.header.dispatchfromaddr.replace(
                            /\n/g,
                            "<br>"
                          ),
                        insert_dt: moment(
                          req.body.header.insert_dt,
                          "DD-MM-YYYY"
                        ).format("YYYY-MM-DD"),
                        insert_by: req.logedINUser,
                        wo_transaction: req.body.header.transaction_id,
                        remark:
                          req.body.material.remark[i] == null
                            ? "--"
                            : req.body.material.remark[i].replace(
                                /\n/g,
                                "<br>"
                              ),
                      },
                      type: invtDB.QueryTypes.INSERT,
                      transaction: transaction,
                    }
                  );
                } else {
                  await transaction.rollback();
                  return res.json({
                    status: "error",
                    success: false,
                    message:
                      "some of the component you have try to input by inspect or through the developer console, you may will suspend.. stop such actions",
                  });
                }
              }

              const length = req.body.component.length;
              for (let i = 0; i < length; i++) {
                let stmt_insert = await invtDB.query(
                  "INSERT INTO `wo_material_received` (`company_branch`, `wo_m_client`, `wo_m_component`, `wo_m_sku`, `wo_min_id`, `wo_min_date`, `wo_m_work_id`, `wo_challan_id`, `wo_challan_date`, `wo_out_eway_bill`, `wo_out_rate`, `wo_out_qty`, `wo_out_type`, `wo_insert_type`) VALUES (:branch,:client,:component,:sku,:min_id,:min_date,:work_id,:challan_id,:challan_date,:out_eway_bill,:out_rate,:out_qty,'RETURN','OUT')",
                  {
                    replacements: {
                      branch: req.branch,
                      client: client_id,
                      component: req.body.component[i],
                      sku: req.body.product_id,
                      min_id: req.body.doc_id[i],
                      min_date: moment(
                        req.body.doc_date[i],
                        "DD-MM-YYYY"
                      ).format("YYYY-MM-DD"),
                      work_id: req.body.header.transaction_id,
                      challan_id: TransID,
                      challan_date: moment(
                        req.body.header.insert_dt,
                        "DD-MM-YYYY"
                      ).format("YYYY-MM-DD"),
                      out_eway_bill:
                        req.body.header.eway_no == null
                          ? "--"
                          : req.body.header.eway_no,
                      out_rate: req.body.out_rate[i],
                      out_qty: req.body.out_qty[i],
                    },
                    type: invtDB.QueryTypes.INSERT,
                    transaction: transaction,
                  }
                );
              }

              await transaction.commit();
              return res.json({
                status: "success",
                success: true,
                message: "Return challan generated successfully...",
              });
            }
          } else {
            await transaction.rollback();
            return res.json({
              status: "error",
              success: false,
              message:
                "an error encountered while executing request bcz might you are trying to break the rules as per our guidlines, wo not present",
            });
          }
        } else {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "an error encountered while executing request bcz you have select an invalid dispatch from address, please reload the page and try again..",
          });
        }
      } else {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "billing address is not valid",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH WORK ORDER RETURN CHALLAN LIST
router.post(
  "/getWorkOrderReturnShipment",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        data: "required",
        wise: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      const { data, wise } = req.body;
      let stmt;

      if (wise == "datewise") {
        const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
        const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
        const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

        stmt = await invtDB.query(
          "SELECT *, COALESCE(wo_material_challan.wo_shipment_id, 'N/A') AS shipment_no FROM wo_material_challan LEFT JOIN components ON wo_material_challan.wo_component_id = components.component_key LEFT JOIN products ON wo_material_challan.wo_product_id = products.product_key LEFT JOIN " +
            tallyDB.config.database +
            ".client_basic_detail ON wo_material_challan.wo_client_id = client_basic_detail.code WHERE DATE_FORMAT(wo_material_challan.wo_insert_dt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND wo_material_challan.challan_status != :status AND wo_material_challan.company_branch = :branch GROUP BY wo_material_challan.wo_shipment_id ORDER BY wo_material_challan.wo_insert_dt DESC",
          {
            replacements: {
              date1: date1,
              date2: date2,
              status: "C",
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else if (wise == "clientwise") {
        stmt = await invtDB.query(
          "SELECT *, COALESCE(wo_material_challan.wo_shipment_id, 'N/A') AS shipment_no FROM wo_material_challan LEFT JOIN components ON wo_material_challan.wo_component_id = components.component_key LEFT JOIN products ON wo_material_challan.wo_product_id = products.product_key LEFT JOIN " +
            tallyDB.config.database +
            ".client_basic_detail ON wo_material_challan.wo_client_id = client_basic_detail.code WHERE wo_material_challan.wo_client_id = :clientid AND wo_material_challan.challan_status != :status AND wo_material_challan.company_branch = :branch GROUP BY wo_material_challan.wo_shipment_id ORDER BY wo_material_challan.wo_insert_dt DESC",
          {
            replacements: { clientid: data, status: "C", branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else if (wise == "wo_transaction_wise") {
        stmt = await invtDB.query(
          "SELECT *, COALESCE(wo_material_challan.wo_shipment_id, 'N/A') AS shipment_no FROM wo_material_challan LEFT JOIN components ON wo_material_challan.wo_component_id = components.component_key LEFT JOIN products ON wo_material_challan.wo_product_id = products.product_key LEFT JOIN " +
            tallyDB.config.database +
            ".client_basic_detail ON wo_material_challan.wo_client_id = client_basic_detail.code WHERE wo_material_challan.wo_transaction LIKE CONCAT('%', :wo_id, '%') AND wo_material_challan.challan_status != :status AND wo_material_challan.company_branch = :branch GROUP BY wo_material_challan.wo_shipment_id ORDER BY wo_material_challan.wo_insert_dt DESC",
          {
            replacements: { wo_id: data, status: "C", branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "Please select valid filter method",
        });
      }

      if (stmt.length > 0) {
        let final = [];
        for (let i = 0; i < stmt.length; i++) {
          let stmt1 = await invtDB.query(
            "SELECT `wo_shipment_id`,`challan_status`,`wo_del_challan_status` FROM `wo_material_challan` WHERE `wo_shipment_id` = :shipment_id AND `wo_material_challan`.`company_branch` = :branch",
            {
              replacements: {
                shipment_id: stmt[i].shipment_no,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let del_challan_status = stmt1[0].wo_del_challan_status;
          let shipment_status = stmt1[0].challan_status;

          final.push({
            shipment_dt: moment(stmt[i].wo_insert_dt, "YYYY-MM-DD").format(
              "DD-MM-YYYY"
            ),
            wo_transaction_id: stmt[i].wo_transaction,
            shipment_id: stmt[i].shipment_no,
            part_code: stmt[i].c_part_no,
            client: stmt[i].name,
            client_code: stmt[i].wo_client_id,
            sku_code: stmt[i].p_sku,
            wo_sku_name: stmt[i].p_name,
            wo_component_name: stmt[i].c_name,
            clientaddress: stmt[i].wo_client_address.replace(/<br>/g, "\n"),
            billingaddress: stmt[i].wo_billing_address.replace(/<br>/g, "\n"),
            shippingaddress: stmt[i].wo_dispatch_to__line1.replace(
              /<br>/g,
              "\n"
            ),
            client_address_id: stmt[i].wo_client_add_id,
            billing_id: stmt[i].wo_billing_id,
            dispatch_id: stmt[i].wo_dispatch_to_id,
            wo_order_qty: stmt[i].wo_order_qty,
            wo_order_rate: stmt[i].wo_order_rate,
            del_challan_status: del_challan_status,
            shipment_status: shipment_status,
          });
        }

        return res.json({ status: "success", success: true, data: final });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "no orders were found that match the given search criteria",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH SO SHIPMENT ITEM DETAILS
router.post(
  "/fetchWOShipmentDetails",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      const valid = new Validator(req.body, {
        wo_shipment_id: "required",
      });

      if (valid.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      const stmt = await invtDB.query(
        "SELECT * FROM wo_material_challan LEFT JOIN components ON wo_material_challan.wo_component_id = components.component_key WHERE wo_material_challan.wo_shipment_id = :wo_shipment_id",
        {
          replacements: { wo_shipment_id: req.body.wo_shipment_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        const data = [];
        for (let i = 0; i < stmt.length; i++) {
          data.push({
            part_name: stmt[i].c_name,
            part_code: stmt[i].c_part_no,
            part_key: stmt[i].component_key,
            qty: stmt[i].wo_order_qty,
            price: stmt[i].wo_order_rate,
            hsn: stmt[i].wo_hsncode,
            remark: stmt[i].wo_comp_remark,
          });
        }

        return res.json({ status: "success", success: true, data: data });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "no data found",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// Fetch WO Return Shipment for UPDATE
router.post("/fetchReturn_edit", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      shipment_no: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    let stmt = await invtDB.query(
      "SELECT wo_material_challan.*, wo_material_challan.ID AS row_id, components.component_key, components.c_name, components.c_part_no, units.units_name, client_basic_detail.name FROM wo_material_challan LEFT JOIN " +
        tallyDB.config.database +
        ".client_basic_detail ON client_basic_detail.code = wo_material_challan.wo_client_id LEFT JOIN components ON wo_material_challan.wo_component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE wo_material_challan.wo_shipment_id = :shipment AND wo_material_challan.company_branch =:branch ORDER BY components.c_part_no",
      {
        replacements: { shipment: req.body.shipment_no, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let stmt_2 = await invtDB.query(
      "SELECT wo_material_received.*, components.component_key, components.c_name, components.c_part_no FROM wo_material_received LEFT JOIN components ON wo_material_received.wo_m_component = components.component_key WHERE wo_challan_id = :shipment AND company_branch =:branch",
      {
        replacements: { shipment: req.body.shipment_no, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let min_out_data = [];
    for (let i = 0; i < stmt_2.length; i++) {
      min_out_data.push({
        row_id: stmt_2[i].ID,
        wo_id: stmt_2[i].wo_transaction,
        component_name: stmt_2[i].c_name,
        component_part_no: stmt_2[i].c_part_no,
        component_key: stmt_2[i].component_key,
        wo_min_id: stmt_2[i].wo_min_id,
        wo_min_date: stmt_2[i].wo_min_date,
        wo_out_rate: stmt_2[i].wo_out_rate,
        wo_out_qty: stmt_2[i].wo_out_qty,
      });
    }

    if (stmt.length > 0) {
      let stmt_client_detail = await tallyDB.query(
        "SELECT * FROM client_basic_detail WHERE code = :client_id",
        {
          replacements: { client_id: stmt[0].wo_client_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      let selectedClient,
        selectedAddressLabel,
        client_address = "";
      if (stmt_client_detail.length > 0) {
        selectedClient = {
          value: stmt_client_detail[0].code,
          label: stmt_client_detail[0].name,
        };
      } else {
        selectedClient = { value: "0", label: "N/A" };
      }

      let stmt_client_branch = await tallyDB.query(
        "SELECT * FROM client_address_detail WHERE addressID = :address_id",
        {
          replacements: { address_id: stmt[0].wo_client_add_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (stmt_client_branch.length > 0) {
        if (stmt[0].wo_client_address != "") {
          client_address = stmt_client_branch[0].city;
          selectedAddressLabel = {
            value: stmt[0].wo_client_add_id,
            label: stmt_client_branch[0].address,
          };
        } else {
          client_address = stmt_client_branch[0].city;
          selectedAddressLabel = { value: "0", label: "- - ADDRESS N/A - -" };
        }
      }

      let billing_addr = await tallyDB.query(
        "SELECT * FROM `client_address_detail` WHERE `addressID` = :billingcode",
        {
          replacements: { billingcode: stmt[0].wo_billing_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (billing_addr.length > 0) {
        selectBillingLabel = {
          value: stmt[0].wo_billing_id,
          label: billing_addr[0].city,
        };
      } else {
        selectBillingLabel = { value: "0", label: "N/A" };
      }

      let dispatch_addr = await tallyDB.query(
        "SELECT * FROM `client_address_detail` WHERE `addressID` = :dispatchcode",
        {
          replacements: { dispatchcode: stmt[0].wo_dispatch_to_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (dispatch_addr.length > 0) {
        selectDispatchLabel = {
          value: stmt[0].wo_dispatch_to_id,
          label: dispatch_addr[0].city,
        };
      } else {
        selectDispatchLabel = { value: "0", label: "N/A" };
      }

      let material = [];

      for (let i = 0; i < stmt.length; i++) {
        material.push({
          row_id: stmt[i].row_id,
          component_key: stmt[i].component_key,
          component_name: stmt[i].c_name,
          part_no: stmt[i].c_part_no,
          part_rate: stmt[i].wo_order_rate,
          hsn_code: stmt[i].wo_hsncode,
          unit_name: stmt[i].units_name,
          part_qty: stmt[i].wo_order_qty,
          remarks: stmt[i].wo_comp_remark,
        });
      }
      return res.json({
        status: "success",
        success: true,
        material: material,
        header: {
          clientcode: selectedClient,
          clientaddress: selectedAddressLabel,
          client_branch: client_address,

          ship_doc_no: stmt[0].wo_ship_doc_no,
          eway_no: stmt[0].wo_eway_no,
          other_ref: stmt[0].wo_other_ref,
          vehicle: stmt[0].wo_vehicle,

          billing_info: selectBillingLabel,
          billing_address: stmt[0].wo_billing_address.replace(/<br>/g, "\n"),

          dispatch_info: selectDispatchLabel,
          dispatch_address: stmt[0].wo_dispatch_to__line1.replace(
            /<br>/g,
            "\n"
          ),

          wo_id: stmt[0].wo_transaction,
          shipment_id: stmt[0].wo_shipment_id,
          challan_remark: stmt[0].wo_remark,
        },
        min_out_data: min_out_data,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "unable to fetch any challan transaction",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPDATE WO RETURN SHIPMENT
router.post(
  "/updateWO_ReturnShipment",
  [auth.isAuthorized],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      var header = req.body.header;
      var material = req.body.material;
      var min_out = req.body.min_out;

      let validation = new Validator(req.body, {
        shipment_id: "required",
        wo_id: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      let comp_length = material.component.length;
      let qty_length = material.qty.length;
      let rate_length = material.rate.length;

      if (comp_length != qty_length || comp_length != rate_length) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "invalid data found",
        });
      }

      for (let i = 0; i < comp_length; i++) {
        let validation = new Validator(
          {
            component: material.component[i],
            qty: material.qty[i],
            rate: material.rate[i],
          },
          {
            component: "required",
            qty: "required|min:1",
            rate: "required|min:1",
          }
        );

        if (validation.fails()) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "something you missing in form field to supply",
          });
        }
      }

      let stmt = await invtDB.query(
        "SELECT * FROM `wo_material_challan` WHERE `wo_shipment_id` = :shipment_id AND `company_branch` = :branch",
        {
          replacements: {
            shipment_id: req.body.shipment_id,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt.length > 0) {
        let data = moment(stmt[0].wo_insert_dt, "YYYY-MM-DD HH:mm:ss").format(
          "YYYY-MM-DD HH:mm:ss"
        );
        let date = new Date(data);
        let diff = new Date() - date;
        let hours = diff / 1000 / 60 / 60;

        if (hours > 6000) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "updation denied due to time limitaion bonding upto 48h only ",
          });
        } else {
          let stmt_updt_wo1 = await invtDB.query(
            "UPDATE `wo_material_challan` SET `wo_client_add_id`= :clientaddid, `wo_client_address`= :clientaddress, `wo_eway_no` = :eway_no, `wo_ship_doc_no` = :ship_doc_no, `wo_vehicle` = :vehicle, `wo_other_ref` = :other_ref, `wo_billing_id` = :billingid, `wo_billing_address` = :billingaddress, `wo_dispatch_to_id` = :dispatchid, `wo_dispatch_to__line1` = :dispatchaddress, `wo_remark` = :challan_remark, `wo_update_dt` = :update_dt, `wo_update_by` = :update_by WHERE `wo_shipment_id` = :shipment",
            {
              replacements: {
                clientaddid: header.clientadd_id,
                clientaddress: header.clientaddress.replace(/\n/g, "<br>"),
                eway_no: header.eway_no,
                ship_doc_no: header.ship_doc_no,
                vehicle: header.vehicle,
                other_ref: header.other_ref,
                billingid: header.billingid,
                billingaddress: header.billingaddress.replace(/\n/g, "<br>"),
                dispatchid: header.dispatchid,
                dispatchaddress: header.dispatchaddress.replace(/\n/g, "<br>"),
                challan_remark: header.challan_remark,
                update_dt: moment(new Date())
                  .tz("Asia/Kolkata")
                  .format("YYYY-MM-DD HH:mm:ss"),
                update_by: req.logedINUser,
                shipment: req.body.shipment_id,
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            }
          );

          for (let i = 0; i < comp_length; i++) {
            let stmt_updt_wo2 = await invtDB.query(
              "UPDATE `wo_material_challan` SET `wo_order_qty`= :qty, `wo_hsncode`= :hsncode, `wo_order_rate`= :rate , `wo_comp_remark` = :wo_comp_remark WHERE `wo_component_id`= :component AND `wo_shipment_id` = :shipment AND `ID` =:id",
              {
                replacements: {
                  id: material.id[i],
                  component: material.component[i],
                  qty: material.qty[i],
                  hsncode: material.hsncode[i],
                  rate: material.rate[i],
                  shipment: req.body.shipment_id,
                  wo_comp_remark: material.remark[i],
                },
                type: invtDB.QueryTypes.UPDATE,
                transaction: transaction,
              }
            );

            const comp_len = req.body.min_out.comp.length;

            //UPDATE WO material received
            if (stmt_updt_wo2.length > 0) {
              for (let i = 0; i < comp_len; i++) {
                let stmt_rm_update = await invtDB.query(
                  "UPDATE `wo_material_received` SET `wo_out_qty`= :qty, `wo_out_eway_bill`= :eway, `wo_m_update_dt`= :update_dt, `wo_m_update_by`= :update_by WHERE `ID` = :id AND `wo_m_component` = :comp AND `wo_m_work_id` = :wo_id AND `wo_challan_id` = :shipment",
                  {
                    replacements: {
                      id: min_out.id[i],
                      comp: min_out.comp[i],
                      qty: min_out.qty[i],
                      eway: header.eway_no,
                      update_dt: moment(new Date())
                        .tz("Asia/Kolkata")
                        .format("YYYY-MM-DD HH:mm:ss"),
                      update_by: req.logedINUser,
                      wo_id: req.body.wo_id,
                      shipment: req.body.shipment_id,
                    },
                    type: invtDB.QueryTypes.UPDATE,
                    transaction: transaction,
                  }
                );
              }
            } else {
              await transaction.rollback();
              return res.json({
                status: "error",
                success: false,
                message:
                  "an operation for updation has failed, while updating the Challan..",
              });
            }
          }
          await transaction.commit();
          return res.json({
            status: "success",
            success: true,
            message:
              "Return Shipment transaction has been updated successfully",
          });
        }
      } else {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message:
            "an error encountered while executing request bcz might you are trying to break the rules as per our guidlines, you may will suspended!",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// CANCEL WO RETURN SHIPMENT
router.post(
  "/woReturnShipmentCancel",
  [auth.isAuthorized],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      let validation = new Validator(req.body, {
        wo_id: "required",
        shipment_id: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: validation.errors.all(),
        });
      }

      let stmt_check = await invtDB.query(
        "SELECT * FROM `wo_material_challan` WHERE `wo_shipment_id` = :shipment_id AND `wo_transaction` = :wo_id AND `company_branch` = :branch",
        {
          replacements: {
            shipment_id: req.body.shipment_id,
            wo_id: req.body.wo_id,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let qty = stmt_check[0].wo_order_qty;

      let stmt = await invtDB.query(
        "UPDATE wo_material_challan SET challan_status = 'C', challan_can_remark = :remark WHERE wo_transaction = :wo_id AND wo_shipment_id = :shipment_id",
        {
          replacements: {
            remark: req.body.remark == null ? "--" : req.body.remark,
            wo_id: req.body.wo_id,
            shipment_id: req.body.shipment_id,
          },
          type: invtDB.QueryTypes.UPDATE,
          transaction: transaction,
        }
      );

      if (stmt.length > 0) {
        //Delete out data

        let stmt_delete = await invtDB.query(
          "DELETE FROM `wo_material_received` WHERE `wo_challan_id` = :shipment_id AND `wo_m_work_id` = :wo_id AND `company_branch` = :branch",
          {
            replacements: {
              shipment_id: req.body.shipment_id,
              wo_id: req.body.wo_id,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.DELETE,
            transaction: transaction,
          }
        );

        await transaction.commit();
        return res.json({
          status: "success",
          success: true,
          message: "Return Shipment cancelled successfully",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// CREATE DELIVERY RETURN CHALLAN
router.post(
  "/createDeliveryReturnChallan",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      let validation = new Validator(req.body, {
        shipment_id: "required|array",
        wo_transaction_id: "required|array",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      let TransID = await helper.genTransaction("WO_DEL_CHALLAN", transaction);

      for (let i = 0; i < req.body.shipment_id.length; i++) {
        let stmt_wo = await invtDB.query(
          "SELECT * FROM `wo_material_challan` WHERE `wo_transaction` = :wo_id AND `wo_shipment_id` = :shipment_id",
          {
            replacements: {
              wo_id: req.body.wo_transaction_id[i],
              shipment_id: req.body.shipment_id[i],
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (
          req.body.client_id === stmt_wo[0].wo_client_id &&
          req.body.client_address_id === stmt_wo[0].wo_client_add_id &&
          req.body.billing_id === stmt_wo[0].wo_billing_id &&
          req.body.dispatch_id === stmt_wo[0].wo_dispatch_to_id
        ) {
          //UPDATE CHALLAN STATUS
          let stmt_update = await invtDB.query(
            "UPDATE `wo_material_challan` SET `wo_challan_txn_id` = :challan_id , `wo_del_challan_status` = 'CREATED', `wo_remark` = :remark WHERE `wo_transaction` = :wo_id AND `wo_shipment_id` = :shipment",
            {
              replacements: {
                challan_id: TransID,
                wo_id: req.body.wo_transaction_id[i],
                shipment: req.body.shipment_id[i],
                remark:
                  req.body.remark == null
                    ? "--"
                    : req.body.remark.replace(/\n/g, "<br>"),
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            }
          );

          if (stmt_update.length < 0) {
            await transaction.rollback();
            return res.json({
              status: "error",
              success: false,
              message: "an error challan status not updated",
            });
          }
        } else {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Client is not same for all shipment",
          });
        }
      }

      await transaction.commit();
      return res.json({
        status: "success",
        success: true,
        message: "WO Return Delivery Challan generated successfully...",
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH DELIVERY CHALLAN LIST
router.post(
  "/fetchReturnDeliveryChallan",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        data: "required",
        wise: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      const { data, wise } = req.body;
      let stmt;

      if (wise == "datewise") {
        const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
        const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
        const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

        stmt = await invtDB.query(
          "SELECT *, COALESCE(wo_material_challan.wo_challan_txn_id, 'N/A') AS challan_no FROM wo_material_challan LEFT JOIN " +
            tallyDB.config.database +
            ".client_basic_detail ON wo_material_challan.wo_client_id = client_basic_detail.code WHERE DATE_FORMAT(wo_material_challan.wo_insert_dt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND wo_material_challan.challan_status != :status AND wo_material_challan.wo_del_challan_status = 'CREATED' AND wo_material_challan.company_branch = :branch GROUP BY wo_material_challan.wo_challan_txn_id ORDER BY wo_material_challan.wo_insert_dt DESC",
          {
            replacements: {
              date1: date1,
              date2: date2,
              status: "C",
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else if (wise == "clientwise") {
        stmt = await invtDB.query(
          "SELECT *, COALESCE(wo_material_challan.wo_challan_txn_id, 'N/A') AS challan_no FROM wo_material_challan LEFT JOIN " +
            tallyDB.config.database +
            ".client_basic_detail ON wo_material_challan.wo_client_id = client_basic_detail.code WHERE wo_material_challan.wo_client_id = :clientid AND wo_material_challan.challan_status != :status AND wo_material_challan.wo_del_challan_status = 'CREATED' AND wo_material_challan.company_branch = :branch GROUP BY wo_material_challan.wo_challan_txn_id ORDER BY wo_material_challan.wo_insert_dt DESC",
          {
            replacements: { clientid: data, status: "C", branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "Please select valid filter method",
        });
      }

      if (stmt.length > 0) {
        let final = [];
        for (let i = 0; i < stmt.length; i++) {
          final.push({
            delivery_challan_dt: moment(
              stmt[i].wo_insert_dt,
              "YYYY-MM-DD HH:mm:ss"
            ).format("DD-MM-YYYY"),
            challan_id: stmt[i].challan_no,
            wo_chlln_txn_id: stmt[i].wo_challan_txn_id,
            client: stmt[i].name,
            client_code: stmt[i].wo_client_id,
            clientaddress: stmt[i].wo_client_address.replace(/<br>/g, ""),
            billingaddress: stmt[i].wo_billing_address.replace(/<br>/g, ""),
            shippingaddress: stmt[i].wo_dispatch_to__line1.replace(/<br>/g, ""),
          });
        }

        return res.json({ status: "success", success: true, data: final });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "no orders were found that match the given search criteria",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// GET DELIVERY CHALLAN DETAILS
router.post(
  "/fetchReturnDeliveryChallanDetails",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        challan_id: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      let stmt;

      stmt = await invtDB.query(
        "SELECT * FROM wo_material_challan LEFT JOIN components ON wo_material_challan.wo_component_id = components.component_key LEFT JOIN " +
          tallyDB.config.database +
          ".client_basic_detail ON wo_material_challan.wo_client_id = client_basic_detail.code WHERE wo_material_challan.wo_challan_txn_id = :challan_id AND wo_material_challan.wo_del_challan_status = :status AND wo_material_challan.company_branch = :branch ",
        {
          replacements: {
            challan_id: req.body.challan_id,
            status: "CREATED",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        let final = [];
        for (let i = 0; i < stmt.length; i++) {
          final.push({
            delivery_challan_dt: moment(
              stmt[i].wo_insert_dt,
              "YYYY-MM-DD HH:mm:ss"
            ).format("DD-MM-YYYY HH:mm:ss"),
            wo_shipment_id: stmt[i].wo_shipment_id,
            wo_transaction_id: stmt[i].wo_transaction,
            wo_part_key: stmt[i].wo_component_id,
            wo_part_no: stmt[i].c_part_no,
            wo_part_name: stmt[i].c_name,
            wo_order_qty: stmt[i].wo_order_qty,
            wo_order_rate: stmt[i].wo_order_rate,
            client: stmt[i].name,
            client_code: stmt[i].wo_client_id,
            clientaddress: stmt[i].wo_client_address,
            billingaddress: stmt[i].wo_billing_address,
            shippingaddress: stmt[i].wo_dispatch_to__line1,
          });
        }

        return res.json({ status: "success", success: true, data: final });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "no orders were found that match the given search criteria",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// PRINT WO Return CHALLAN
router.post(
  "/printWorkorderReturnChallan",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        challan_id: "required",
        ref_id: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      const { challan_id, ref_id } = req.body;
      let file = {
        url: `${process.env.API_URL}/helper/PRINT/PHP/WO/WOreturn_challan.php?invoice=${challan_id}&refid=${ref_id}`,
      };
      let options = { format: "A4" };
      await html_to_pdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          let filename = req.body.challan_id.replace(/[/]/g, "_") + ".pdf";
          return res.json({
            status: "success",
            success: true,
            message: "file generated successfully...",
            data: { buffer: pdfBuffer, filename: filename },
          });
        })
        .catch((err) => {
          return res.json({
            status: "error",
            success: false,
            message: "error while generating file...",
          });
        });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// SAVE CREATE SCRAP CHALLAN
router.post(
  "/saveCreateScrapChallan",
  [auth.isAuthorized],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      let validation = new Validator(req.body.header, {
        billingid: "required",
        billingaddr: "required",
        client_id: "required",
        client_addr_id: "required",
        clientaddr: "required",
        dispatchid: "required",
        dispatchaddr: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      let component_length = req.body.material.component.length;

      for (let i = 0; i < component_length; i++) {
        let valid = new Validator({
          qty: req.body.material.qty[i],
          component: req.body.material.component[i],
          rate: req.body.material.rate[i],
          hsncode: req.body.material.hsncode[i],
        });

        if (valid.fails()) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "something you missing in form field to supply",
          });
        }
      }

      let TransID = await helper.genTransaction("WO_DEL_CHALLAN", transaction);

      let stmt_comp;
      for (let i = 0; i < component_length; i++) {
        if (
          req.body.material.qty[i] == null ||
          req.body.material.qty[i] == "--" ||
          req.body.material.qty[i] == ""
        ) {
          continue;
        }

        stmt_comp = await invtDB.query(
          "SELECT * FROM `components` WHERE `component_key` = :component_key",
          {
            replacements: { component_key: req.body.material.component[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt_comp.length > 0) {
          let stmt_insert_wo_1 = await invtDB.query(
            "INSERT INTO wo_scrap_challan (company_branch,billfromcode,wo_billing_id,wo_billing_address,wo_client_id,wo_client_address,wo_client_add_id,wo_dispatch_id,wo_dispatch_address,wo_component_id,wo_order_qty,wo_order_rate,wo_hsn_code,wo_comp_remark,wo_eway_no,wo_ship_doc_no,wo_other_ref,wo_vehicle,wo_insert_dt,wo_insert_by,wo_challan_id,wo_challan_remark) VALUES(:branch,:billfromcode, :billing_id,:billing_address, :client_id,:client_address,:client_address_id,:dispatch_id,:dispatch_address,:component_id,:order_qty,:order_rate,:hsncode,:comp_remark,:eway,:ship_doc_no,:other_ref,:vehicle,:insert_dt,:insert_by,:wo_challan_id,:challan_remark)",
            {
              replacements: {
                branch: req.branch,
                billing_id: req.body.header.billingid,
                billfromcode: "L2QSPZUV",
                billing_address: req.body.header.billingaddr.replace(
                  /\n/g,
                  "<br>"
                ),
                client_id: req.body.header.client_id,
                client_address: req.body.header.clientaddr,
                client_address_id: req.body.header.client_addr_id,
                dispatch_id: req.body.header.dispatchid,
                dispatch_address: req.body.header.dispatchaddr.replace(
                  /\n/g,
                  "<br>"
                ),
                component_id: req.body.material.component[i],
                order_qty: req.body.material.qty[i],
                order_rate: req.body.material.rate[i],
                hsncode: req.body.material.hsncode[i],
                comp_remark:
                  req.body.material.comp_remark[i] == null
                    ? "--"
                    : req.body.material.comp_remark[i].replace(/\n/g, "<br>"),
                eway:
                  req.body.header.eway_no == null
                    ? "--"
                    : req.body.header.eway_no,
                ship_doc_no:
                  req.body.header.ship_doc == null
                    ? "--"
                    : req.body.header.ship_doc,
                other_ref:
                  req.body.header.other_ref == null
                    ? "--"
                    : req.body.header.other_ref,
                vehicle:
                  req.body.header.vehicle == null
                    ? "--"
                    : req.body.header.vehicle,
                insert_dt: moment(
                  req.body.header.insert_dt,
                  "DD-MM-YYYY"
                ).format("YYYY-MM-DD"),
                insert_by: req.logedINUser,
                wo_challan_id: TransID,
                challan_remark:
                  req.body.header.challan_remark == null
                    ? "--"
                    : req.body.header.challan_remark,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: transaction,
            }
          );
        } else {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Component not found",
          });
        }
      }

      await transaction.commit();
      return res.json({
        status: "success",
        success: true,
        message: "Scrap challan generated successfully...",
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH SCRAP CHALLAN LIST
router.post("/fetchScrapChallanlist", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      data: "required",
      wise: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    const { data, wise } = req.body;
    let stmt;

    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        "SELECT *, COALESCE(wo_scrap_challan.wo_challan_id, 'N/A') AS challan_no FROM wo_scrap_challan LEFT JOIN components ON wo_scrap_challan.wo_component_id = components.component_key LEFT JOIN " +
          tallyDB.config.database +
          ".client_basic_detail ON wo_scrap_challan.wo_client_id = client_basic_detail.code WHERE DATE_FORMAT(wo_scrap_challan.wo_insert_dt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND wo_scrap_challan.challan_status != :status AND wo_scrap_challan.company_branch = :branch GROUP BY wo_scrap_challan.wo_challan_id ORDER BY wo_scrap_challan.wo_insert_dt DESC",
        {
          replacements: {
            date1: date1,
            date2: date2,
            status: "C",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "clientwise") {
      stmt = await invtDB.query(
        "SELECT *, COALESCE(wo_scrap_challan.wo_challan_id, 'N/A') AS challan_no FROM wo_scrap_challan LEFT JOIN components ON wo_scrap_challan.wo_component_id = components.component_key LEFT JOIN " +
          tallyDB.config.database +
          ".client_basic_detail ON wo_scrap_challan.wo_client_id = client_basic_detail.code WHERE wo_scrap_challan.wo_client_id = :clientid AND wo_scrap_challan.challan_status != :status AND wo_scrap_challan.company_branch = :branch GROUP BY wo_scrap_challan.wo_challan_id ORDER BY wo_scrap_challan.wo_insert_dt DESC",
        {
          replacements: { clientid: data, status: "C", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Please select valid filter method",
      });
    }

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          challan_dt: moment(stmt[i].wo_insert_dt, "YYYY-MM-DD").format(
            "DD-MM-YYYY"
          ),
          challan_id: stmt[i].challan_no,
          client: stmt[i].name,
          client_code: stmt[i].wo_client_id,
          clientaddress: stmt[i].wo_client_address.replace(/<br>/g, "\n"),
          billingaddress: stmt[i].wo_billing_address.replace(/<br>/g, "\n"),
          shippingaddress: stmt[i].wo_dispatch_address.replace(/<br>/g, "\n"),
          client_address_id: stmt[i].wo_client_add_id,
          billing_id: stmt[i].wo_billing_id,
          dispatch_id: stmt[i].wo_dispatch_id,
          challan_status: stmt[i].challan_status,
        });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "no orders were found that match the given search criteria",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH SCRAP CHALLAN DETAILS
router.post(
  "/fetchScrapChallanDetails",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      const valid = new Validator(req.body, {
        challan_id: "required",
      });

      if (valid.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }

      const stmt = await invtDB.query(
        "SELECT * FROM wo_scrap_challan LEFT JOIN components ON wo_scrap_challan.wo_component_id = components.component_key WHERE wo_scrap_challan.wo_challan_id = :wo_challan_id",
        {
          replacements: { wo_challan_id: req.body.challan_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        const data = [];
        for (let i = 0; i < stmt.length; i++) {
          data.push({
            part_name: stmt[i].c_name,
            part_code: stmt[i].c_part_no,
            part_key: stmt[i].component_key,
            qty: stmt[i].wo_order_qty,
            price: stmt[i].wo_order_rate,
            hsn: stmt[i].wo_hsncode,
            remark: stmt[i].wo_comp_remark,
          });
        }

        return res.json({ status: "success", success: true, data: data });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "no data found",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// Fetch WO SCRAP CHALLAN for Edit
router.post("/editWO_ScrapChallan", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      challan_no: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    let stmt = await invtDB.query(
      "SELECT wo_scrap_challan.*, wo_scrap_challan.ID AS row_id, components.component_key, components.c_name, components.c_part_no, units.units_name, client_basic_detail.name FROM wo_scrap_challan LEFT JOIN " +
        tallyDB.config.database +
        ".client_basic_detail ON client_basic_detail.code = wo_scrap_challan.wo_client_id LEFT JOIN components ON wo_scrap_challan.wo_component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE wo_scrap_challan.wo_challan_id = :challan AND wo_scrap_challan.company_branch =:branch ORDER BY components.c_part_no",
      {
        replacements: { challan: req.body.challan_no, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let stmt_client_detail = await tallyDB.query(
        "SELECT * FROM client_basic_detail WHERE code = :client_id",
        {
          replacements: { client_id: stmt[0].wo_client_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      let selectedClient,
        selectedAddressLabel,
        client_address = "";
      if (stmt_client_detail.length > 0) {
        selectedClient = {
          value: stmt_client_detail[0].code,
          label: stmt_client_detail[0].name,
        };
      } else {
        selectedClient = { value: "0", label: "N/A" };
      }

      let stmt_client_branch = await tallyDB.query(
        "SELECT * FROM client_address_detail WHERE addressID = :address_id",
        {
          replacements: { address_id: stmt[0].wo_client_add_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (stmt_client_branch.length > 0) {
        if (stmt[0].wo_client_address != "") {
          client_address = stmt_client_branch[0].city;
          selectedAddressLabel = {
            value: stmt[0].wo_client_add_id,
            label: stmt_client_branch[0].address,
          };
        } else {
          client_address = stmt_client_branch[0].city;
          selectedAddressLabel = { value: "0", label: "- - ADDRESS N/A - -" };
        }
      }

      let billing_addr = await tallyDB.query(
        "SELECT * FROM `client_address_detail` WHERE `addressID` = :billingcode",
        {
          replacements: { billingcode: stmt[0].wo_billing_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (billing_addr.length > 0) {
        selectBillingLabel = {
          value: stmt[0].wo_billing_id,
          label: billing_addr[0].city,
        };
      } else {
        selectBillingLabel = { value: "0", label: "N/A" };
      }

      let dispatch_addr = await tallyDB.query(
        "SELECT * FROM `client_address_detail` WHERE `addressID` = :dispatchcode",
        {
          replacements: { dispatchcode: stmt[0].wo_dispatch_id },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (dispatch_addr.length > 0) {
        selectDispatchLabel = {
          value: stmt[0].wo_dispatch_id,
          label: dispatch_addr[0].city,
        };
      } else {
        selectDispatchLabel = { value: "0", label: "N/A" };
      }

      let material = [];

      for (let i = 0; i < stmt.length; i++) {
        material.push({
          row_id: stmt[i].row_id,
          component_key: stmt[i].component_key,
          component_name: stmt[i].c_name,
          part_no: stmt[i].c_part_no,
          part_rate: stmt[i].wo_order_rate,
          hsn_code: stmt[i].wo_hsn_code,
          unit_name: stmt[i].units_name,
          out_qty: stmt[i].wo_order_qty,
          remarks: stmt[i].wo_comp_remark.replace(/<br>/g, "\n"),
        });
      }
      return res.json({
        status: "success",
        success: true,
        material: material,
        header: {
          clientcode: selectedClient,
          clientaddress: selectedAddressLabel,
          client_branch: client_address,

          eway_no: stmt[0].wo_eway_no,
          ship_doc_no: stmt[0].wo_ship_doc_no,
          other_ref: stmt[0].wo_other_ref,
          vehicle: stmt[0].wo_vehicle,

          billing_info: selectBillingLabel,
          billing_address: stmt[0].wo_billing_address.replace(/<br>/g, "\n"),

          dispatch_info: selectDispatchLabel,
          dispatch_address: stmt[0].wo_dispatch_address.replace(/<br>/g, "\n"),

          wo_id: stmt[0].wo_transaction,
          challan_id: stmt[0].wo_challan_id,
          challan_remark: stmt[0].wo_challan_remark,
        },
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "unable to fetch any challan transaction",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPDATE WO SCRAP CHALLAN
router.post("/updateWO_ScrapChallan", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    var header = req.body.header;
    var material = req.body.material;

    let validation = new Validator(req.body, {
      challan_id: "required",
    });

    if (validation.fails()) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    let comp_length = material.component.length;
    let qty_length = material.qty.length;
    let rate_length = material.rate.length;

    if (comp_length != qty_length || comp_length != rate_length) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "invalid data found",
      });
    }

    for (let i = 0; i < comp_length; i++) {
      let validation = new Validator(
        {
          component: material.component[i],
          qty: material.qty[i],
          rate: material.rate[i],
        },
        {
          component: "required",
          qty: "required|min:1",
          rate: "required|min:1",
        }
      );

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
        });
      }
    }

    let stmt = await invtDB.query(
      "SELECT * FROM `wo_scrap_challan` WHERE `wo_challan_id` = :challan_id AND `company_branch` = :branch",
      {
        replacements: { challan_id: req.body.challan_id, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      let data = moment(stmt[0].wo_insert_dt, "YYYY-MM-DD HH:mm:ss").format(
        "YYYY-MM-DD HH:mm:ss"
      );
      let date = new Date(data);
      let diff = new Date() - date;
      let hours = diff / 1000 / 60 / 60;

      if (hours > 6000) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message:
            "updation denied due to time limitaion bonding upto 48h only ",
        });
      } else {
        let stmt_updt_wo1 = await invtDB.query(
          "UPDATE `wo_scrap_challan` SET `wo_client_add_id`= :clientaddid, `wo_client_address`= :clientaddress, `wo_eway_no` = :eway_no, `wo_ship_doc_no` = :ship_doc_no, `wo_vehicle` = :vehicle, `wo_other_ref` = :other_ref, `wo_billing_id` = :billingid, `wo_billing_address` = :billingaddress, `wo_dispatch_id` = :dispatchid, `wo_dispatch_address` = :dispatchaddress, `wo_challan_remark` = :challan_remark, `wo_update_dt` = :update_dt, `wo_update_by` = :update_by WHERE `wo_challan_id` = :challan",
          {
            replacements: {
              clientaddid: header.clientadd_id,
              clientaddress: header.clientaddress,
              eway_no: header.eway_no,
              ship_doc_no: header.ship_doc_no,
              vehicle: header.vehicle,
              other_ref: header.other_ref,
              billingid: header.billingid,
              billingaddress: header.billingaddress,
              dispatchid: header.dispatchid,
              dispatchaddress: header.dispatchaddress,
              challan_remark: header.challan_remark,
              update_dt: moment(new Date())
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD HH:mm:ss"),
              update_by: req.logedINUser,
              challan: req.body.challan_id,
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transaction,
          }
        );

        for (let i = 0; i < comp_length; i++) {
          let stmt_updt_wo2 = await invtDB.query(
            "UPDATE `wo_scrap_challan` SET `wo_order_qty`= :qty, `wo_hsn_code`= :hsncode, `wo_order_rate`= :rate, `wo_comp_remark` = :wo_remark WHERE `wo_component_id`= :component AND `wo_challan_id` = :challan AND `ID` =:id",
            {
              replacements: {
                id: material.id[i],
                qty: material.qty[i],
                hsncode: material.hsncode[i],
                rate: material.rate[i],
                component: material.component[i],
                challan: req.body.challan_id,
                wo_remark:
                  material.remark[i] == ""
                    ? null
                    : material.remark[i].replace(/\n/g, "<br>"),
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            }
          );

          if (stmt_updt_wo2.length <= 0) {
            await transaction.rollback();
            return res.json({
              status: "error",
              success: false,
              message:
                "an operation for updation has failed, while updating the Challan..",
            });
          }
        }
        await transaction.commit();
        return res.json({
          status: "success",
          success: true,
          message: "Scrap challan transaction has been updated successfully",
        });
      }
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message:
          "an error encountered while executing request bcz might you are trying to break the rules as per our guidlines, you may will suspended!",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// CANCEL SCRAP CHALLAN
router.post("/woScrapChallanCancel", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    let validation = new Validator(req.body, {
      challan_id: "required",
    });

    if (validation.fails()) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: validation.errors.all(),
      });
    }

    let stmt_check = await invtDB.query(
      "SELECT * FROM `wo_scrap_challan` WHERE `wo_challan_id` = :challan_id AND `company_branch` = :branch",
      {
        replacements: { challan_id: req.body.challan_id, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt_check.length == 0) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Challan does not exist",
      });
    }

    let stmt = await invtDB.query(
      "UPDATE wo_scrap_challan SET challan_status = 'C', challan_can_remark = :remark WHERE wo_challan_id = :challan_id",
      {
        replacements: {
          remark: req.body.remark == null ? "--" : req.body.remark,
          challan_id: req.body.challan_id,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      }
    );

    if (stmt.length > 0) {
      await transaction.commit();
      return res.json({
        status: "success",
        success: true,
        message: "Scrap Challan cancelled successfully",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// PRINT WO SCRAP CHALLAN
router.post("/printScrapChallan", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      challan_id: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    const { challan_id, ref_id } = req.body;
    let file = {
      url: `${process.env.API_URL}/helper/PRINT/PHP/WO/WOscrap_challan.php?invoice=${challan_id}`,
    };
    let options = { format: "A4" };
    await html_to_pdf
      .generatePdf(file, options)
      .then((pdfBuffer) => {
        let filename = req.body.challan_id.replace(/[/]/g, "_") + ".pdf";
        return res.json({
          status: "success",
          success: true,
          message: "file generated successfully...",
          data: { buffer: pdfBuffer, filename: filename },
        });
      })
      .catch((err) => {
        return res.json({
          status: "error",
          success: false,
          message: "error while generating file...",
        });
      });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// WO view challan
router.get("/woViewChallan/:type", [auth.isAuthorized], async (req, res) => {
  try {
    const paramValidation = new Validator(req.params, {
      type: "required|in:delivery,return,scrape,all",
    });

    if (paramValidation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(paramValidation),
      });
    }

    const queryValidation = new Validator(req.query, {
      data: "required",
      wise: "required",
      download: "required|in:yes,no",
    });

    if (queryValidation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(queryValidation),
      });
    }

    let { data, wise, download } = req.query;

    let param = req.params.type;

    let stmt = [];

    if (param == "delivery") {
      const deliveryData = await getDeliveryChallanData(
        wise,
        data,
        download,
        req
      );

      if (deliveryData instanceof Error) {
        return res.json({
          message: deliveryData.message,
          status: "error",
          success: false,
        });
      }

      let finalData = deliveryData.sort((a, b) =>
        a.challan_id.localeCompare(b.challan_id)
      );

      if (download == "yes") {
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(finalData);
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
        const buffer = XLSX.write(workbook, {
          type: "buffer",
          bookType: "xlsx",
        });
        return res.json({
          status: "success",
          success: true,
          data: buffer,
        });
      }

      return res.json({
        status: "success",
        success: true,
        data: finalData,
      });
    } else if (param == "return") {
      const returnData = await getReturnChallanData(wise, data, download, req);

      if (returnData instanceof Error) {
        return res.json({
          status: "error",
          success: false,
          message: returnData.message,
        });
      }

      let finalData = returnData.sort((a, b) =>
        a.challan_id.localeCompare(b.challan_id)
      );

      if (download == "yes") {
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(finalData);
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
        const buffer = XLSX.write(workbook, {
          type: "buffer",
          bookType: "xlsx",
        });
        return res.json({
          status: "success",
          success: true,
          data: buffer,
        });
      }

      return res.json({
        status: "success",
        success: true,
        data: finalData,
      });
    } else if (param == "scrape") {
      const scrapData = await getScrapeChallanData(wise, data, download, req);

      if (scrapData instanceof Error) {
        return res.json({
          status: "error",
          success: false,
          message: scrapData.message,
        });
      }

      let finalData = scrapData.sort((a, b) =>
        a.challan_id.localeCompare(b.challan_id)
      );

      if (download == "yes") {
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(finalData);
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
        const buffer = XLSX.write(workbook, {
          type: "buffer",
          bookType: "xlsx",
        });
        return res.json({
          status: "success",
          success: true,
          data: buffer,
        });
      }
      return res.json({
        status: "success",
        success: true,
        data: finalData,
      });
    } else if (param == "all") {
      const deliveryData = await getDeliveryChallanData(
        wise,
        data,
        download,
        req
      );
      const returnData = await getReturnChallanData(wise, data, download, req);
      const scrapData = await getScrapeChallanData(wise, data, download, req);

      if (
        deliveryData instanceof Error ||
        returnData instanceof Error ||
        scrapData instanceof Error
      ) {
        return res.json({
          status: "error",
          success: false,
          message:
            deliveryData instanceof Error
              ? deliveryData.message
              : returnData instanceof Error
              ? returnData.message
              : scrapData instanceof Error
              ? scrapData.message
              : null,
        });
      }

      const allData = deliveryData.concat(returnData, scrapData);

      let finalData = allData.sort((a, b) =>
        a.challan_id.localeCompare(b.challan_id)
      );

      if (download == "yes") {
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(finalData);
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
        const buffer = XLSX.write(workbook, {
          type: "buffer",
          bookType: "xlsx",
        });
        return res.json({
          status: "success",
          success: true,
          data: buffer,
        });
      }

      return res.json({
        status: "success",
        success: true,
        data: finalData,
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//get wo challan data for ewaybill
router.post("/scrape_wo_challan", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    challan_no: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something is missing in the form fields",
    });
  }

  try {
    const stmt = await invtDB.query(
      `SELECT wsc.*, wsc.ID AS row_id, 
              c.component_key, c.c_name, c.c_part_no, c.c_specification, 
              u.units_name 
       FROM wo_scrap_challan wsc 
       LEFT JOIN components c ON wsc.wo_component_id = c.component_key 
       LEFT JOIN units u ON c.c_uom = u.units_id 
       WHERE wsc.wo_challan_id = :challan_no`,
      {
        replacements: { challan_no: req.body.challan_no },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length === 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Unable to fetch any work order scrap challan transaction",
      });
    }

    const woData = stmt[0];

    // Fetch billing address using wo_billing_id
    const billingAddr = await invtDB.query(
      `SELECT cad.*, cbd.name AS client_name 
       FROM ${tallyDB.config.database}.client_address_detail cad 
       LEFT JOIN ${tallyDB.config.database}.client_basic_detail cbd ON cad.clientCode = cbd.code 
       WHERE cad.addressID = :addressID`,
      {
        replacements: { addressID: woData.wo_billing_id || "" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // Fetch state for bill_to
    let stmtBillingState = [];
    if (billingAddr.length > 0 && billingAddr[0].state) {
      stmtBillingState = await invtDB.query(
        "SELECT * FROM state_code WHERE state_code = :code",
        {
          replacements: { code: String(billingAddr[0].state).padStart(2, "0") },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    // Fetch dispatch/shipping address using wo_dispatch_id
    const dispatchAddr = await invtDB.query(
      `SELECT cad.*, cbd.name AS client_name 
       FROM ${tallyDB.config.database}.client_address_detail cad 
       LEFT JOIN ${tallyDB.config.database}.client_basic_detail cbd ON cad.clientCode = cbd.code 
       WHERE cad.addressID = :addressID`,
      {
        replacements: { addressID: woData.wo_dispatch_id || "" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // Fetch state for ship_to
    let stmtDispatchState = [];
    if (dispatchAddr.length > 0 && dispatchAddr[0].state) {
      stmtDispatchState = await invtDB.query(
        "SELECT * FROM state_code WHERE state_code = :code",
        {
          replacements: {
            code: String(dispatchAddr[0].state).padStart(2, "0"),
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    const items = stmt.map((row) => ({
      ID: row.row_id,
      component_name: row.c_name || "--",
      component_description: row.c_specification || "--",
      part_no: row.c_part_no || "--",
      qty: row.wo_order_qty || "0",
      rate: row.wo_order_rate || "0",
      unit_name: row.units_name ? row.units_name.toUpperCase() : "",
      hsn_code: row.wo_hsn_code || "",
      taxable_amount: (
        (row.wo_order_rate || 0) * (row.wo_order_qty || 0)
      ).toFixed(3),
      remarks: row.wo_comp_remark || "",
    }));

    const dispatchFrom = {
      legalName: "Riot Labz Private Limited",
      address1: "A-21, Hosiery Complex, Block A Road",
      address2: "Noida Phase-2, Yakubpur, Noida, (UP) - 201305",
      gstin: "09AAHCR1005Q1Z4",
      state: {
        state_name: "Uttar Pradesh",
        state_code: "9",
      },
      pincode: "201305",
    };

    const ship_from = {
      legalName: "Riot Labz Private Limited",
      address1: "A-21, Hosiery Complex, Block A Road",
      address2: "Noida Phase-2, Yakubpur, Noida, (UP) - 201305",
      gst: "09AAHCR1005Q1Z4",
      state: {
        state_name: "Uttar Pradesh",
        state_code: "9",
      },
      pincode: "201305",
    };

    const response = {
      status: "success",
      success: true,
      data: {
        challan_id: woData.wo_challan_id,
        bill_from: dispatchFrom,
        bill_to: {
          client:
            billingAddr.length > 0
              ? billingAddr[0].client_name || billingAddr[0].clientCode
              : "Unknown Client",
          gst: billingAddr.length > 0 ? billingAddr[0].gst : "",
          state: {
            state_code:
              stmtBillingState.length > 0
                ? stmtBillingState[0].state_code
                : billingAddr.length > 0
                ? String(billingAddr[0].state).padStart(2, "0")
                : "",
            state_name:
              stmtBillingState.length > 0 ? stmtBillingState[0].state_name : "",
          },
          location: billingAddr.length > 0 ? billingAddr[0].city : "",
          address1:
            woData.wo_billing_address ||
            (billingAddr.length > 0 ? billingAddr[0].address : ""),
          address2: "",
          pincode: billingAddr.length > 0 ? billingAddr[0].pinCode : "",
        },
        ship_from: ship_from,
        ship_to: {
          company:
            dispatchAddr.length > 0
              ? dispatchAddr[0].client_name || dispatchAddr[0].clientCode
              : "Unknown Company",
          gst: dispatchAddr.length > 0 ? dispatchAddr[0].gst : "",
          state: {
            state_code:
              stmtDispatchState.length > 0
                ? stmtDispatchState[0].state_code
                : dispatchAddr.length > 0
                ? String(dispatchAddr[0].state).padStart(2, "0")
                : "",
            state_name:
              stmtDispatchState.length > 0
                ? stmtDispatchState[0].state_name
                : "",
          },
          address1:
            woData.wo_dispatch_address ||
            (dispatchAddr.length > 0 ? dispatchAddr[0].address : ""),
          address2: "",
          pincode: dispatchAddr.length > 0 ? dispatchAddr[0].pinCode : "",
        },
        total_amount: items
          .reduce((sum, item) => sum + Number(item.taxable_amount), 0)
          .toFixed(3),
        wo_status: woData.wo_challan_status,
        wo_ewaybill_no: woData.wo_eway_no || "",
        vehicle: woData.wo_vehicle || "",
      },
      items: items,
      message: "Work Order Scrap Challan Details Fetched Successfully",
    };

    return res.json(response);
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//fetch wo delivery challan without scrap

router.post(
  "/fetch_wo_delivery_challan",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      challan_no: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "Something is missing in the form fields",
      });
    }

    try {
      const stmt = await invtDB.query(
        `SELECT wdc.*, wdc.ID AS row_id, 
              pp.product_key AS primary_product_key, pp.p_name AS primary_product_name, pp.p_sku AS primary_product_sku, pp.p_description AS primary_product_desc, ppu.units_name AS primary_product_unit,
              sp.product_key AS secondary_product_key, sp.p_name AS secondary_product_name, sp.p_sku AS secondary_product_sku, sp.p_description AS secondary_product_desc, spu.units_name AS secondary_product_unit,
              SUM(wdc.wo_order_qty) AS total_quantity
       FROM wo_delivery_challan wdc 
       LEFT JOIN products pp ON wdc.wo_product_id = pp.product_key 
       LEFT JOIN units ppu ON pp.p_uom = ppu.units_id 
       LEFT JOIN products sp ON wdc.wo_secondary_product_id = sp.product_key 
       LEFT JOIN units spu ON sp.p_uom = spu.units_id 
       WHERE wdc.wo_challan_txn_id = :challan_no
       GROUP BY wdc.wo_secondary_product_id, wdc.wo_order_rate`,
        {
          replacements: { challan_no: req.body.challan_no },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length === 0) {
        return res.json({
          message:
            "Unable to fetch any work order delivery challan transaction",
          status: "error",
          success: false,
        });
      }

      const woData = stmt[0];

      const billingAddr = await invtDB.query(
        `SELECT cad.*, cbd.name AS client_name 
       FROM ${tallyDB.config.database}.client_address_detail cad 
       LEFT JOIN ${tallyDB.config.database}.client_basic_detail cbd ON cad.clientCode = cbd.code 
       WHERE cad.addressID = :addressID`,
        {
          replacements: { addressID: woData.wo_billing_id || "" },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      const billingState = await invtDB.query(
        "SELECT * FROM state_code WHERE state_code = :code",
        {
          replacements: {
            code:
              billingAddr.length > 0
                ? billingAddr[0].state.padStart(2, "0")
                : "",
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      const dispatchAddr = await invtDB.query(
        `SELECT cad.*, cbd.name AS client_name 
       FROM ${tallyDB.config.database}.client_address_detail cad 
       LEFT JOIN ${tallyDB.config.database}.client_basic_detail cbd ON cad.clientCode = cbd.code 
       WHERE cad.addressID = :addressID`,
        {
          replacements: { addressID: woData.wo_dispatch_to_id || "" },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      const dispatchState = await invtDB.query(
        "SELECT * FROM state_code WHERE state_code = :code",
        {
          replacements: {
            code:
              dispatchAddr.length > 0
                ? dispatchAddr[0].state.padStart(2, "0")
                : "",
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      const items = stmt.map((row) => ({
        ID: stmt.indexOf(row) + 1,
        component_name: row.secondary_product_name,
        component_description: row.secondary_product_desc,
        part_rate: row.wo_order_rate,
        qty: row.total_quantity,
        rate: row.wo_order_rate,
        unit_name: row.secondary_product_unit,
        hsn_code: row.wo_hsncode,
        taxable_amount: (
          (row.wo_order_rate || 0) * (row.total_quantity || 0)
        ).toFixed(3),
        remarks: row.wo_sku_description,
      }));

      const totalQty = items.reduce((sum, item) => sum + Number(item.qty), 0);
      const totalAmount = items
        .reduce((sum, item) => sum + Number(item.taxable_amount), 0)
        .toFixed(2);

      const dispatchFrom = {
        legalName: "Riot Labz Private Limited",
        address1: "HO: D-57, 2nd Floor, Sector-6, Noida -201301",
        address2: "WH: A21, Phase II, Hosiery Complex, Noida -201305",
        gstin: "09AAHCR1005Q1Z4",
        // pan: "AAHCR1005Q",
        state: {
          state_name: "Uttar Pradesh",
          state_code: "9",
        },
        pincode: "201301",
        // cin: "U29253DL2014PTC273460"
      };

      const ship_from = {
        legalName: "Riot Labz Private Limited",
        address1: "A-21, Hosiery Complex, Block A Road",
        address2: "Noida Phase-2, Yakubpur, Noida, (UP) - 201305",
        gst: "09AAHCR1005Q1Z4",
        // pan: "AAHCR1005Q",
        state: {
          state_name: "Uttar Pradesh",
          state_code: "9",
        },
        pincode: "201305",
        // cin: "U29253DL2014PTC273460"
      };

      const response = {
        status: "success",
        success: true,
        data: {
          challan_id: woData.wo_challan_txn_id,

          bill_from: dispatchFrom,
          bill_to: {
            client:
              billingAddr.length > 0
                ? billingAddr[0].client_name.replace("(Debtor)", "")
                : "",
            gst: billingAddr.length > 0 ? billingAddr[0].gst : "",
            // pan: billingAddr.length > 0 ? billingAddr[0].panNo : "",
            state: {
              state_code:
                billingState.length > 0 ? billingState[0].state_code : "",
              state_name:
                billingState.length > 0 ? billingState[0].state_name : "",
            },
            address1:
              billingAddr.length > 0
                ? billingAddr[0].address
                : woData.wo_billing_address || "",
            address2: "",
            pincode: billingAddr.length > 0 ? billingAddr[0].pinCode : "",
          },
          ship_to: {
            company:
              dispatchAddr.length > 0
                ? dispatchAddr[0].client_name.replace("(Debtor)", "")
                : "",
            address1:
              dispatchAddr.length > 0
                ? dispatchAddr[0].address
                : woData.wo_dispatch_to__line1 || "",
            gst: dispatchAddr.length > 0 ? dispatchAddr[0].gst : "",
            // pan: dispatchAddr.length > 0 ? dispatchAddr[0].panNo : "",
            // phone: dispatchAddr.length > 0 ? dispatchAddr[0].phoneNo : "",
            state: {
              state_code:
                dispatchState.length > 0 ? dispatchState[0].state_code : "",
              state_name:
                dispatchState.length > 0 ? dispatchState[0].state_name : "",
            },
            pincode: dispatchAddr.length > 0 ? dispatchAddr[0].pinCode : "",
          },
          ship_from: ship_from,

          eway_bill_no: woData.wo_eway_no || "",
          ewaybill_status: woData.wo_ewaybill_status || "",

          other_ref: woData.wo_other_ref || "",
          dispatch_through: "By Road",
          vehicle: woData.wo_vehicle || "",
          quantity: totalQty,
          total_amount: totalAmount,

          remarks: woData.wo_remark || "",
        },
        items: items,
        message: "Work Order Delivery Challan Details Fetched Successfully",
      };

      return res.json(response);
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

module.exports = router;

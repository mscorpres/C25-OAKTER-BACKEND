const express = require("express");
const router = express.Router();
const fs = require("fs");

let { format } = require("timeago.js");

let { invtDB, otherDB, tallyDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const { encode, decode } = require("html-entities");

const Validator = require("validatorjs");

var xlsx = require("xlsx");
const multer = require("multer");
const path = require("path");

// SAVE SALES ORDER SHIPMENT
router.post("/saveSOShipment", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();

  try {
    let validation = new Validator(req.body.header, {
      bill_id: "required",
      bill_addr: "required",
      so_id: "required",
      ship_id: "required",
      ship_addr: "required",
      ship_pan: "required",
      ship_gstin: "required",
    });

    if (validation.fails()) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Something is missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    let item_length = req.body.material.item.length;

    for (let i = 0; i < item_length; i++) {
      let valid = new Validator({
        qty: req.body.material.qty[i],
        item: req.body.material.item[i],
        rate: req.body.material.rate[i],
        picklocation: req.body.material.picklocation[i],
        hsncode: req.body.material.hsncode[i],
      });

      if (valid.fails()) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Something is missing in form field to supply",
          data: valid.errors.all(),
        });
      }
    }

    let stmt_so = await invtDB.query(
      "SELECT * FROM `sell_request` WHERE `so_req_id` = :so_id AND `company_branch` = :branch",
      {
        replacements: { so_id: req.body.header.so_id, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt_so.length > 0) {
      if (stmt_so[0].so_status == "C") {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          success: false,
          message: "The Sales Order has been marked as closed",
        });
      } else {
        let cust = stmt_so[0].so_customer;
        let cust_address_id = stmt_so[0].so_cust_branch;
        let cust_address = stmt_so[0].so_cust_addr;
        let bill_id = stmt_so[0].bill_id;
        let ship_id = stmt_so[0].shipping_id;
        let billing_address = stmt_so[0].billing_address;
        let shipping_address = stmt_so[0].shipping_address;

        let TransID = await helper.genTransaction("SO_SHIPMENT", transaction);

        for (let i = 0; i < item_length; i++) {
          let stmt_item;
          if (stmt_so[0].so_type == "product") {
            stmt_item = await invtDB.query(
              "SELECT * FROM `products` WHERE `product_key` = :product_key",
              {
                replacements: { product_key: req.body.material.item[i] },
                type: invtDB.QueryTypes.SELECT,
              }
            );
          } else {
            stmt_item = await invtDB.query(
              "SELECT * FROM `components` WHERE `component_key` = :component_key",
              {
                replacements: { component_key: req.body.material.item[i] },
                type: invtDB.QueryTypes.SELECT,
              }
            );
          }
          if (stmt_item.length > 0) {
            if (
              req.body.material.picklocation[i] == "" ||
              req.body.material.picklocation[i] == null ||
              req.body.material.picklocation[i] == undefined
            ) {
              await transaction.rollback();
              return res.json({
                status: "error",
                success: false,
                success: false,
                message: "Please select the location",
              });
            }

            let stmt_insert_soship = await invtDB.query(
              "INSERT INTO so_shipment_challan (company_branch,so_cust,so_type,so_cust_addrid,so_cust_addr,so_bill_id,so_bill_addr,so_ship_id,so_ship_addr,so_ship_pan,so_ship_gstin,so_item,so_item_qty,so_item_rate,so_item_gst_rate,so_item_hsn,so_pick_location,so_item_remark,so_eway_no,so_other_ref,so_vehicle_no,so_id,so_insert_dt,so_insert_by,so_shipment_id) VALUES (:branch,:cust,:so_type,:cust_addrid,:cust_addr,:bill_id,:bill_addr,:ship_id,:ship_addr,:ship_pan,:ship_gstin,:item,:qty,:rate,:gst_rate,:hsn,:pick_loc,:remark,:eway_no,:other_ref,:vehicle_no,:so_id,:insert_dt,:insert_by,:shipment_id)",
              {
                replacements: {
                  branch: req.branch,
                  cust: cust,
                  so_type: stmt_so[0].so_type,
                  cust_addrid: cust_address_id,
                  cust_addr: cust_address,
                  bill_id: req.body.header.bill_id,
                  bill_addr: req.body.header.bill_addr,
                  ship_id: req.body.header.ship_id,
                  ship_addr: req.body.header.ship_addr,
                  ship_pan: req.body.header.ship_pan,
                  ship_gstin: req.body.header.ship_gstin,
                  item: req.body.material.item[i],
                  qty: req.body.material.qty[i],
                  rate: req.body.material.rate[i],
                  gst_rate: stmt_so[0].so_gst_rate,
                  hsn: req.body.material.hsncode[i],
                  pick_loc: req.body.material.picklocation[i],
                  remark:
                    req.body.material.remark[i] == null
                      ? "--"
                      : req.body.material.remark[i],
                  eway_no: req.body.header.eway_no,
                  other_ref: req.body.header.other_ref,
                  vehicle_no: req.body.header.vehicle_no,
                  so_id: req.body.header.so_id,
                  insert_dt: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm:ss"),
                  insert_by: req.logedINUser,
                  shipment_id: TransID,
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: transaction,
              }
            );

            if (stmt_insert_soship.length > 0) {
              //UPDATE ISSUE QUANTITY
              let stmt_update = await invtDB.query(
                "UPDATE `sell_request` SET `so_inward_qty` = `so_inward_qty` + :qty WHERE `so_req_id` = :so_id AND `so_item` = :item",
                {
                  replacements: {
                    so_id: req.body.header.so_id,
                    qty: req.body.material.qty[i],
                    item: req.body.material.item[i],
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
                success: false,
                message: "Error while inserting the data",
              });
            }
          } else {
            await transaction.rollback();
            return res.json({
              status: "error",
              success: false,
              success: false,
              message: "Some of the items are disabled for the transaction",
            });
          }
        }
        await transaction.commit();
        return res.json({
          status: "success",
          success: true,
          success: true,
          message: "SO Shipment generated successfully.",
        });
      }
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        success: false,
        message: "No data found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH SALES ORDER SHIPMENT LIST
router.post(
  "/fetchSalesOrderShipmentlist",
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
          message: "Something is missing in form field to supply",
          data: validation.errors.all(),
        });
      }

      const { data, wise } = req.body;
      let stmt;

      if (wise == "datewise") {
        const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
        const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
        const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

        stmt = await invtDB.query(
          "SELECT *, COALESCE(so_shipment_challan.so_shipment_id, 'N/A') AS shipment_no FROM so_shipment_challan LEFT JOIN " +
            tally_db_name +
            ".client_basic_detail ON so_shipment_challan.so_cust = client_basic_detail.code WHERE DATE_FORMAT(so_shipment_challan.so_insert_dt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND so_shipment_challan.so_shipment_status != :status AND so_shipment_challan.company_branch = :branch GROUP BY so_shipment_challan.so_shipment_id ORDER BY so_shipment_challan.ID DESC",
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
          "SELECT *, COALESCE(so_shipment_challan.so_shipment_id, 'N/A') AS shipment_no FROM so_shipment_challan LEFT JOIN " +
            tally_db_name +
            ".client_basic_detail ON so_shipment_challan.so_cust = client_basic_detail.code WHERE so_shipment_challan.so_cust = :clientid AND so_shipment_challan.so_shipment_status != :status AND so_shipment_challan.company_branch = :branch GROUP BY so_shipment_challan.so_shipment_id ORDER BY so_shipment_challan.ID DESC",
          {
            replacements: { clientid: data, status: "C", branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else if (wise == "so_id_wise") {
        stmt = await invtDB.query(
          "SELECT *, COALESCE(so_shipment_challan.so_shipment_id, 'N/A') AS shipment_no FROM so_shipment_challan LEFT JOIN " +
            tally_db_name +
            ".client_basic_detail ON so_shipment_challan.so_cust = client_basic_detail.code WHERE so_shipment_challan.so_id LIKE CONCAT('%', :so_id, '%') AND so_shipment_challan.so_shipment_status != :status AND so_shipment_challan.company_branch = :branch GROUP BY so_shipment_challan.so_shipment_id ORDER BY so_shipment_challan.ID DESC",
          {
            replacements: { so_id: data, status: "C", branch: req.branch },
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
            "SELECT `so_shipment_status`, `so_del_challan_status` FROM `so_shipment_challan` WHERE `so_shipment_id` = :shipment_id AND `so_shipment_challan`.`company_branch` = :branch",
            {
              replacements: {
                shipment_id: stmt[i].shipment_no,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          // STATUS

          let del_challan_status = stmt1[0].so_del_challan_status;
          let shipment_status = stmt1[0].so_shipment_status;

          final.push({
            shipment_dt: moment(
              stmt[i].so_insert_dt,
              "YYYY-MM-DD HH:mm:ss"
            ).format("DD-MM-YYYY HH:mm:ss"),
            so_id: stmt[i].so_id,
            shipment_id: stmt[i].shipment_no,
            client: stmt[i].name,
            client_code: stmt[i].so_cust,
            clientaddress: stmt[i].so_cust_addr,
            client_add_id: stmt[i].so_cust_addrid,
            billingaddress: stmt[i].so_bill_addr,
            billing_id: stmt[i].so_bill_id,
            shippingaddress: stmt[i].so_ship_addr,
            shipping_id: stmt[i].so_ship_id,
            del_challan_status: del_challan_status,
            shipment_status: shipment_status,
          });
        }

        return res.json({ status: "success", success: true, data: final });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "No orders were found that match the given search criteria",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH SO SHIPMENT ITEM DETAILS
router.post(
  "/fetchSOShipmentDetails",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      const valid = new Validator(req.body, {
        so_shipment_id: "required",
      });

      if (valid.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "Something is missing in form field to supply",
          data: valid.errors.all(),
        });
      }

      const stmt = await invtDB.query(
        "SELECT CASE WHEN so_shipment_challan.so_type = 'product' THEN products.p_name ELSE components.c_name END AS item_name, CASE WHEN so_shipment_challan.so_type = 'product' THEN products.p_sku ELSE components.c_part_no END AS item_part_no, CASE WHEN so_shipment_challan.so_type = 'product' THEN products.product_key ELSE components.component_key END AS item_key, so_shipment_challan.* FROM so_shipment_challan LEFT JOIN products ON so_shipment_challan.so_type = 'product' AND products.product_key = so_shipment_challan.so_item LEFT JOIN components ON so_shipment_challan.so_type = 'component' AND components.component_key = so_shipment_challan.so_item WHERE so_shipment_challan.so_shipment_id = :so_shipment_id",
        {
          replacements: { so_shipment_id: req.body.so_shipment_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        const data = [];
        for (let i = 0; i < stmt.length; i++) {
          let stmt_loc = await invtDB.query(
            "SELECT * FROM location_main WHERE location_key = :loc",
            {
              replacements: { loc: stmt[i].so_pick_location },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          data.push({
            item_name: stmt[i].item_name,
            item_code: stmt[i].item_part_no,
            qty: stmt[i].so_item_qty,
            price: stmt[i].so_item_rate,
            hsn: stmt[i].so_item_hsn,
            remark: stmt[i].so_item_remark,
            gst_rate: stmt[i].so_gst_rate,
            item_pick_location: stmt[i].so_pick_location,
            item_pick_location_name: stmt_loc[0].loc_name,
          });
        }

        return res.json({ status: "success", success: true, data: data });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "No data found",
        });
      }
    } catch (err) {
      //console.log(err)
      return res.json({
        status: "error",
        success: false,
        message:
          "Internal Error!!! If this condition persists, contact your system administrator",
        debug: process.env.NODE_ENV === "development" ? err.stack : undefined,
      });
    }
  }
);

// FETCH DATA to EDIT SHIPMENT
router.post(
  "/fetchShipmentforUpdate",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        shipment_id: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "Something is missing in form field to supply",
          data: validation.errors.all(),
        });
      }

      let stmt = await invtDB.query(
        "SELECT CASE WHEN so_shipment_challan.so_type = 'product' THEN products.p_name ELSE components.c_name END AS item_name, CASE WHEN so_shipment_challan.so_type = 'product' THEN products.product_key ELSE components.component_key END AS item_key, so_shipment_challan.* FROM so_shipment_challan LEFT JOIN products ON so_shipment_challan.so_type = 'product' AND products.product_key = so_shipment_challan.so_item LEFT JOIN components ON so_shipment_challan.so_type = 'component' AND components.component_key = so_shipment_challan.so_item WHERE so_shipment_challan.so_shipment_id = :shipment_id",
        {
          replacements: {
            shipment_id: req.body.shipment_id,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        let stmt_client_detail = await tallyDB.query(
          "SELECT * FROM client_basic_detail WHERE code = :client_id",
          {
            replacements: { client_id: stmt[0].so_cust },
            type: tallyDB.QueryTypes.SELECT,
          }
        );

        let Client;
        if (stmt_client_detail.length > 0) {
          Client = {
            code: stmt_client_detail[0].code,
            name: stmt_client_detail[0].name,
            pan: stmt_client_detail[0].panNo,
          };
        }

        let stmt_client_branch = await tallyDB.query(
          "SELECT * FROM client_address_detail WHERE addressID = :address_id",
          {
            replacements: { address_id: stmt[0].so_cust_addrid },
            type: tallyDB.QueryTypes.SELECT,
          }
        );

        let ClientLabel;
        if (stmt_client_branch.length > 0) {
          ClientLabel = {
            id: stmt[0].so_cust_addrid,
            label: stmt_client_branch[0].city,
          };
        }

        let billing_addr = await invtDB.query(
          "SELECT * FROM billing_address WHERE billing_code = :billingcode",
          {
            replacements: { billingcode: stmt[0].so_bill_id },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let BillingLabel;
        if (billing_addr.length > 0) {
          BillingLabel = {
            id: stmt[0].so_bill_id,
            label: billing_addr[0].billing_lable,
            pan: billing_addr[0].billing_pan,
            gst: billing_addr[0].billing_gstno,
          };
        }

        let ShipLabel = {
          ship_id: stmt[0].so_ship_id,
          ship_pan: stmt[0].so_ship_pan,
          gst: stmt[0].so_ship_gstin,
        };

        let material = [];

        for (let i = 0; i < stmt.length; i++) {
          let stmt_so = await invtDB.query(
            "SELECT * FROM sell_request WHERE so_req_id = :so_id AND so_item = :item",
            {
              replacements: { so_id: stmt[i].so_id, item: stmt[i].so_item },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let gst_type;
          if (stmt_so[0].so_gst_type === "L") {
            gst_type = "LOCAL";
          } else {
            gst_type = "INTER STATE";
          }

          let stmt_loc = await invtDB.query(
            "SELECT * FROM location_main WHERE location_key = :loc",
            {
              replacements: { loc: stmt[i].so_pick_location },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          material.push({
            updateID: stmt[i].ID,
            item_key: stmt[i].item_key,
            item_name: stmt[i].item_name,
            item_rate: stmt[i].so_item_rate,
            item_qty: stmt[i].so_item_qty,
            hsn_code: stmt[i].so_item_hsn,
            item_pick_location: {
              loc_name: stmt_loc[0].loc_name,
              loc_key: stmt[i].so_pick_location,
            },
            item_remarks: stmt[i].so_item_remark,
            item_exchange_rate: stmt_so[0].so_exchange_rate,
            item_due_date: stmt_so[0].so_due_date,
            item_gst_type: gst_type,
            item_gstrate: stmt_so[0].so_gst_rate,
            cgst: stmt_so[0].so_cgst,
            sgst: stmt_so[0].so_sgst,
            igst: stmt_so[0].so_igst,
          });
        }
        return res.json({
          status: "success",
          success: true,
          success: true,
          data: {
            material: material,
            header: {
              client: Client,
              client_info: ClientLabel,
              client_address: stmt[0].so_cust_addr,

              eway_bill: stmt[0].so_eway_no,
              other_ref: stmt[0].so_other_ref,
              vehicle: stmt[0].so_vehicle_no,

              billing_info: BillingLabel,
              billing_address: stmt[0].so_bill_addr,

              shipping_info: ShipLabel,
              shipping_address: stmt[0].so_ship_addr,

              so_id: stmt[0].so_id,
              so_shipment_id: stmt[0].so_shipment_id,
            },
          },
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "Unable to fetch any Shipment",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

//UPDATE SO SHIPMENT
router.post("/updateSOshipment", [auth.isAuthorized], async (req, res) => {
  const valid_header = new Validator(req.body.headers, {
    so_id: "required",
    so_shipment_id: "required",
    bill_id: "required",
    bill_addr: "required",
    ship_id: "required",
    ship_addr: "required",
    ship_pan: "required",
    ship_gstin: "required",
  });
  if (valid_header.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(valid_header),
    });
  }

  const comp_len = req.body.materials.item.length;
  const comp_qty = req.body.materials.qty.length;
  const comp_price = req.body.materials.rate.length;

  if (comp_len == 0 || comp_qty == 0 || comp_price == 0) {
    return res.json({
      status: "error",
      success: false,
      message: "Please add at least one item!",
    });
  }

  if (comp_len != comp_qty || comp_len != comp_price) {
    return res.json({
      status: "error",
      success: false,
      message: "Please fill all inputs",
    });
  }

  for (let i = 0; i < comp_len; i++) {
    const valid_material = new Validator(
      {
        item: req.body.materials.item[i],
        qty: req.body.materials.qty[i],
        hsn: req.body.materials.hsn[i],
        rate: req.body.materials.rate[i],
      },
      {
        item: "required",
        qty: "required|numeric",
        hsn: "required",
        rate: "required|min:1",
      }
    );

    if (valid_material.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(valid_material),
      });
    }

    // VALIDATION
    if (req.body.materials.qty[i] <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: `Quantity should be greater than 0 at row ${i + 1}`,
      });
    }
  }

  const transaction = await invtDB.transaction();

  try {
    const stmt_check = await invtDB.query(
      "SELECT * FROM so_shipment_challan WHERE so_shipment_id = :so_shipment_id",
      {
        replacements: {
          so_shipment_id: req.body.headers.so_shipment_id,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt_check.length > 0) {
      let data = moment(
        stmt_check[0].so_insert_dt,
        "YYYY-MM-DD HH:mm:ss"
      ).format("YYYY-MM-DD HH:mm:ss");
      let date = new Date(data);
      let diff = new Date() - date;
      let hours = diff / 1000 / 60 / 60;

      if (hours > 48) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          success: false,
          message: "Update denied due to time limitation (48 hours only)",
        });
      } else {
        const comp_len = req.body.materials.item.length;

        const update_date = moment(new Date())
          .tz("Asia/Kolkata")
          .format("YYYY-MM-DD HH:mm:ss");

        for (let i = 0; i < comp_len; i++) {
          const stmt_update = await invtDB.query(
            "UPDATE so_shipment_challan SET so_bill_id = :bill_id, so_bill_addr = :bill_addr , so_ship_id = :ship_id , so_ship_addr = :ship_addr , so_ship_pan = :ship_pan , so_ship_gstin = :ship_gstin , so_eway_no = :so_eway_no , so_other_ref = :so_other_ref , so_vehicle_no = :so_vehicle_no , so_item = :so_item , so_item_qty = :so_item_qty , so_item_rate = :so_item_rate , so_item_hsn = :so_item_hsn, so_item_remark = :so_item_remark, so_update_by = :update_by , so_update_dt = :update_dt WHERE ID = :id AND so_id = :so_id AND so_shipment_id = :so_shipment_id",
            {
              replacements: {
                id: req.body.materials.updaterow[i],
                so_id: req.body.headers.so_id,
                so_shipment_id: req.body.headers.so_shipment_id,
                bill_id: req.body.headers.bill_id,
                bill_addr: req.body.headers.bill_addr,
                ship_id: req.body.headers.ship_id,
                ship_addr: req.body.headers.ship_addr,
                ship_pan: req.body.headers.ship_pan,
                ship_gstin: req.body.headers.ship_gstin,
                so_eway_no: req.body.headers.eway_no,
                so_other_ref: req.body.headers.other_ref,
                so_vehicle_no: req.body.headers.vehicle_no,
                so_item: req.body.materials.item[i],
                so_item_qty: req.body.materials.qty[i],
                so_item_rate: req.body.materials.rate[i],
                so_item_hsn: req.body.materials.hsn[i],
                so_item_remark: req.body.materials?.remark[i] ?? "--",
                update_by: req.logedINUser,
                update_dt: update_date,
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            }
          );

          if (stmt_update.length > 0) {
            //UPDATE ISSUE QUANTITY
            let stmt_issue = await invtDB.query(
              "UPDATE `sell_request` SET `so_inward_qty` = `so_inward_qty` + :qty WHERE `so_req_id` = :so_id AND `so_item` = :item",
              {
                replacements: {
                  so_id: req.body.headers.so_id,
                  qty: req.body.materials.qty[i],
                  item: req.body.materials.item[i],
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
              success: false,
              message: "Error while updating the data",
            });
          }
        }
      }
      await transaction.commit();
      return res.json({
        status: "success",
        success: true,
        message: "Successfully Updated SO Shipment",
      });
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Shipment not present",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//CANCEL SO SHIPMENT
router.post("/cancelSOshipment", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    so_shipment_id: "required",
    remark: "required",
  });
  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something is missing in form field to supply",
      data: validation.errors.all(),
    });
  }
  try {
    const t = await invtDB.transaction();
    let stmt1 = await invtDB.query(
      "SELECT * FROM so_shipment_challan WHERE so_shipment_id = :so_shipment_id",
      {
        replacements: {
          so_shipment_id: req.body.so_shipment_id,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt1.length > 0) {
      if (stmt1[0].so_shipment_status == "C") {
        return res.json({
          status: "error",
          success: false,
          message: "Shipment already cancelled",
        });
      } else {
        let stmt2 = await invtDB.query(
          "UPDATE so_shipment_challan SET so_cancel_remark = :remark, so_shipment_status = :status WHERE so_shipment_id = :so_shipment_id",
          {
            replacements: {
              remark: req.body.remark,
              status: "C",
              so_shipment_id: req.body.so_shipment_id,
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: t,
          }
        );
        if (stmt2.length > 0) {
          t.commit();
          return res.json({
            status: "success",
            success: true,
            message: "Shipment cancelled successfully",
          });
        } else {
          t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "Unable to cancel the shipment due to some technical issue",
          });
        }
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No Shipment Found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// CREATE DELIVERY CHALLAN
router.post("/createDeliveryChallan", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    let validation = new Validator(req.body, {
      shipment_id: "required|array",
      so_id: "required|array",
    });

    if (validation.fails()) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Something is missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    let TransID = await helper.genTransaction("SO_DEL_CHALLAN", transaction);

    for (let i = 0; i < req.body.shipment_id.length; i++) {
      let stmt_so = await invtDB.query(
        "SELECT * FROM `so_shipment_challan` WHERE `so_id` = :so_id AND `so_shipment_id` = :shipment_id",
        {
          replacements: {
            so_id: req.body.so_id[i],
            shipment_id: req.body.shipment_id[i],
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (
        req.body.client_id === stmt_so[0].so_cust &&
        req.body.client_addr_id === stmt_so[0].so_cust_addrid &&
        req.body.bill_id === stmt_so[0].so_bill_id &&
        req.body.ship_id === stmt_so[0].so_ship_id
      ) {
        //UPDATE CHALLAN STATUS
        let stmt_update = await invtDB.query(
          "UPDATE `so_shipment_challan` SET `so_challan_id` = :challan_id , `so_del_challan_status` = 'Y', `so_challan_remark` = :remark WHERE `so_id` = :so_id AND `so_shipment_id` = :shipment",
          {
            replacements: {
              challan_id: TransID,
              so_id: req.body.so_id[i],
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
            success: false,
            message: "An error occurred - challan status not updated",
          });
        }
      } else {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          success: false,
          message: "Client is not the same for all shipments",
        });
      }
    }

    await transaction.commit();
    return res.json({
      status: "success",
      success: true,
      success: true,
      message: "Delivery Challan generated successfully.",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

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
        message: "Something is missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    const { data, wise } = req.body;
    let stmt;

    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        "SELECT *, COALESCE(so_shipment_challan.so_challan_id, 'N/A') AS challan_no FROM so_shipment_challan LEFT JOIN " +
          tally_db_name +
          ".client_basic_detail ON so_shipment_challan.so_cust = client_basic_detail.code WHERE DATE_FORMAT(so_shipment_challan.so_insert_dt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND so_shipment_challan.so_shipment_status != :status AND so_shipment_challan.so_del_challan_status = 'Y' AND so_shipment_challan.company_branch = :branch GROUP BY so_shipment_challan.so_challan_id ORDER BY so_shipment_challan.so_insert_dt DESC",
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
        "SELECT *, COALESCE(so_shipment_challan.so_challan_id, 'N/A') AS challan_no FROM so_shipment_challan LEFT JOIN " +
          tally_db_name +
          ".client_basic_detail ON so_shipment_challan.so_cust = client_basic_detail.code WHERE so_shipment_challan.so_cust = :clientid AND so_shipment_challan.so_shipment_status != :status AND so_shipment_challan.so_del_challan_status = 'Y' AND so_shipment_challan.company_branch = :branch GROUP BY so_shipment_challan.so_challan_id ORDER BY so_shipment_challan.so_insert_dt DESC",
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
            stmt[i].so_insert_dt,
            "YYYY-MM-DD HH:mm:ss"
          ).format("DD-MM-YYYY"),
          so_challan_id: stmt[i].challan_no,
          client: stmt[i].name,
          client_code: stmt[i].so_cust,
          clientaddress: stmt[i].so_cust_addr.replace(/<br>/g, ""),
          billingaddress: stmt[i].so_bill_addr.replace(/<br>/g, ""),
          shippingaddress: stmt[i].so_ship_addr.replace(/<br>/g, ""),
        });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No orders were found that match the given search criteria",
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
          message: "Something is missing in form field to supply",
          data: validation.errors.all(),
        });
      }

      let stmt;

      stmt = await invtDB.query(
        "SELECT CASE WHEN so_shipment_challan.so_type = 'product' THEN products.p_name ELSE components.c_name END AS item_name, CASE WHEN so_shipment_challan.so_type = 'product' THEN products.p_sku ELSE components.c_part_no END AS item_part_no, CASE WHEN so_shipment_challan.so_type = 'product' THEN products.product_key ELSE components.component_key END AS item_key, client_basic_detail.*, so_shipment_challan.* FROM so_shipment_challan LEFT JOIN products ON so_shipment_challan.so_type = 'product' AND products.product_key = so_shipment_challan.so_item LEFT JOIN components ON so_shipment_challan.so_type = 'component' AND components.component_key = so_shipment_challan.so_item LEFT JOIN " +
          tally_db_name +
          ".client_basic_detail ON so_shipment_challan.so_cust = client_basic_detail.code WHERE so_shipment_challan.so_challan_id = :challan_id AND so_shipment_challan.so_del_challan_status = :status AND so_shipment_challan.company_branch = :branch ",
        {
          replacements: {
            challan_id: req.body.challan_id,
            status: "Y",
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
              stmt[i].so_insert_dt,
              "YYYY-MM-DD HH:mm:ss"
            ).format("DD-MM-YYYY HH:mm:ss"),
            so_id: stmt[i].so_id,
            shipment_id: stmt[i].so_shipment_id,
            item_id: stmt[i].item_key,
            item_part_no: stmt[i].item_part_no,
            item_name: stmt[i].item_name,
            item_qty: stmt[i].so_item_qty,
            item_rate: stmt[i].so_item_rate,
            client: stmt[i].name,
            client_code: stmt[i].so_cust,
            clientaddress: stmt[i].so_cust_addr,
            billingaddress: stmt[i].so_bill_addr,
            shippingaddress: stmt[i].so_ship_addr,
          });
        }

        return res.json({ status: "success", success: true, data: final });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "No data were found that match the given search criteria",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

module.exports = router;

const express = require("express");
const router = express.Router();

let { invtDB, otherDB, tallyDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
var html_to_pdf = require("html-pdf-node");

const multer = require("multer");
const path = require("path");

const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

// Create Work Order
router.post(
  "/createWorkOrderReq",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const transaction = await invtDB.transaction();

    try {
      let validation = new Validator(req.body, {
        client_name: "required",
        qty: "required",
        gstrate: "required",
        gsttype: "required|in:L,I",
        product: "required",
        rate: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
          data: validation.errors.all(),
        });
      }

      if (req.body.qty <= 0) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Order qty should be grater than zero!!!",
        });
      }

      let stmt_check = await invtDB.query(
        "SELECT `p_sku`,`p_name`,`is_enabled`,`m_sku` FROM `products` WHERE `product_key` = :product_key",
        {
          replacements: { product_key: req.body.product },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt_check.length > 0) {
        let p_sku_code = stmt_check[0].p_sku;
        let m_sku_code = stmt_check[0].m_sku;

        if (stmt_check[0].is_enabled == "N") {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: `product skucode [${p_sku_code}] - [${m_sku_code}] can not be execute bcz it has been disabled for this transaction`,
          });
        }

        let wo_txn_no = await helper.genTransaction("CREATE_WO", transaction);

        let stmt_check_txn = await invtDB.query(
          "SELECT `wo_transaction` FROM `wo_purchase_req` WHERE `wo_transaction` = :transaction_id GROUP BY `wo_transaction` LIMIT 1",
          {
            replacements: { transaction_id: wo_txn_no },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt_check_txn.length > 0) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: `alloting transaction id as [${wo_txn_no}] for WO has already exist with us, required manual checking or contact to system administrator.`,
          });
        } else {
          let recipe_id;
          let stmt_product_rec = await invtDB.query(
            "SELECT `subject_id` FROM `bom_recipe` WHERE (`bom_product_sku` = :sku_code_1 OR `bom_product_sku` = :sku_code_2)",
            {
              replacements: {
                sku_code_1: p_sku_code,
                sku_code_2: m_sku_code,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt_product_rec.length > 0) {
            recipe_id = stmt_product_rec[0].subject_id;
          } else {
            await transaction.rollback();
            return res.json({
              status: "error",
              success: false,
              message: "we unable to fetch the product recipe..",
            });
          }

          let stmt_bill_add = await tallyDB.query(
            "SELECT * FROM `client_address_detail` WHERE `addressID` = :code",
            {
              replacements: { code: req.body.billingaddrid },
              type: tallyDB.QueryTypes.SELECT,
            }
          );
          if (stmt_bill_add.length > 0) {
            let stmt_ship_add = await tallyDB.query(
              "SELECT * FROM `client_address_detail` WHERE `addressID` = :code",
              {
                replacements: { code: req.body.dispatch_id },
                type: tallyDB.QueryTypes.SELECT,
              }
            );
            if (stmt_ship_add.length > 0) {
              let stmt_client = await tallyDB.query(
                "SELECT * FROM `client_basic_detail` WHERE `code` = :clientname",
                {
                  replacements: { clientname: req.body.client_name },
                  type: tallyDB.QueryTypes.SELECT,
                }
              );
              if (stmt_client.length > 0) {
                let stmt_insert_wo = await invtDB.query(
                  "INSERT INTO `wo_purchase_req` (`wo_remark`,`wo_payment_terms_day`,`company_branch`,`wo_billing_add_id`,`wo_billing_addr`,`wo_transaction`,`wo_issue_qty`,`wo_dispatch_addr`,`wo_ship_id`,`wo_terms_condition`,`wo_payment_terms`,`wo_project_name`,`wo_cost_center`,`wo_client_id`,`wo_client_address`,`wo_client_add_id`,`wo_sku`,`wo_subject_id`,`wo_order_qty`,`wo_order_rate`,`wo_duedate`,`wo_insert_date`,`wo_insert_by`,`wo_sku_transaction`,`wo_client_type`, `wo_hsncode`, `wo_gsttype`, `wo_gstrate`, `wo_sgst`, `wo_cgst`, `wo_igst`)VALUES (:remark,:termsdays,:branch,:billingaddrid,:billingaddr,:wotransaction,'0',:dispatch_address,:dispatch_id,:termscondition,:paymentterms,:project_id,:cost_center,:clientid,:client_address,:client_branch,:sku,:recipe,:qty,:rate,:duedate,:insertdate,:by,:skutransaction,:clienttype,:hsncode,:gsttype,:gstrate,:sgst,:cgst,:igst)",
                  {
                    replacements: {
                      remark: req.body.remark == "" ? "--" : req.body.remark,
                      termsdays:
                        req.body.paymenttermsday == ""
                          ? 30
                          : req.body.paymenttermsday,
                      branch: req.branch,
                      billingaddrid: req.body.billingaddrid,
                      billingaddr: req.body.billingaddr.replace(/\n/g, "<br>"),
                      termscondition: req.body.termscondition,
                      paymentterms: req.body.paymentterms,
                      project_id: req.body.project,
                      cost_center: req.body.cost_center,
                      clientid: req.body.client_name,
                      client_address: req.body.client_address.replace(
                        /\n/g,
                        "<br>"
                      ),
                      client_branch: req.body.client_branch,
                      sku: req.body.product,
                      recipe: recipe_id,
                      rate: req.body.rate,
                      duedate: req.body.duedate,
                      qty: req.body.qty,
                      insertdate: req.body.insert_dt,
                      by: req.logedINUser,
                      skutransaction: wo_txn_no,
                      wotransaction: wo_txn_no,
                      clienttype: req.body.client_type,
                      hsncode: req.body.hsncode,
                      gsttype: req.body.gsttype,
                      gstrate: req.body.gstrate,
                      sgst: `${
                        helper.gstCalculation(
                          req.body.gstrate,
                          req.body.rate * req.body.qty,
                          req.body.gsttype
                        ).sgst
                      }`,
                      cgst: `${
                        helper.gstCalculation(
                          req.body.gstrate,
                          req.body.rate * req.body.qty,
                          req.body.gsttype
                        ).cgst
                      }`,
                      igst: `${
                        helper.gstCalculation(
                          req.body.gstrate,
                          req.body.rate * req.body.qty,
                          req.body.gsttype
                        ).igst
                      }`,
                      dispatch_address: req.body.dispatch_address.replace(
                        /\n/g,
                        "<br>"
                      ),
                      dispatch_id: req.body.dispatch_id,
                    },
                    type: invtDB.QueryTypes.INSERT,
                    transaction: transaction,
                  }
                );
                if (stmt_insert_wo.length > 0) {
                  await transaction.commit();
                  return res.json({
                    status: "success",
                    success: true,
                    message: `Work Order created successfully...transaction ref ID. [${wo_txn_no}]`,
                  });
                }
              } else {
                await transaction.rollback();
                return res.json({
                  status: "error",
                  success: false,
                  message: "client is not registered yet",
                });
              }
            } else {
              await transaction.rollback();
              return res.json({
                status: "error",
                success: false,
                message: "shipment address is not valid",
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
        }
      } else {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message:
            "some product can not be operate bcz of might be it disabled for transaction or does not exist with us",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// Fetch Product Data
router.post("/fetchProductData", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      product_key: "required",
    });

    if (valid.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: valid.errors.all(),
      });
    }

    let stmt = await invtDB.query(
      "SELECT * FROM `products` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE `products`.`product_key` = :key",
      {
        replacements: { key: req.body.product_key },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let final = {
        product_name: stmt[0].p_name,
        product_sku: stmt[0].p_sku,
        unit: stmt[0].units_name,
        hsn: stmt[0].p_hsncode,
        gstrate: stmt[0].p_gst_rate_tax,
        rate: "",
      };

      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: final,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Product not found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH WORK ORDER
router.post("/fetch_WorkOrder", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      wise: "required",
      data: "required",
    });
    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
    }
    const { wise, data } = req.body;

    let stmt;
    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        "SELECT * FROM wo_purchase_req LEFT JOIN products ON wo_purchase_req.wo_sku = products.product_key LEFT JOIN units ON products.p_uom = units.units_id LEFT JOIN admin_login ON wo_purchase_req.wo_insert_by = admin_login.CustID LEFT JOIN " +
          tally_db_name +
          ".client_basic_detail ON wo_purchase_req.wo_client_id = " +
          tally_db_name +
          ".client_basic_detail.code WHERE DATE_FORMAT(wo_purchase_req.wo_insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND wo_purchase_req.wo_status = 'A' ORDER BY wo_purchase_req.ID DESC",
        {
          replacements: { date1: date1, date2: date2 },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "wo_transaction_wise") {
      stmt = await invtDB.query(
        "SELECT * FROM wo_purchase_req LEFT JOIN products ON wo_purchase_req.wo_sku = products.product_key LEFT JOIN units ON products.p_uom = units.units_id LEFT JOIN admin_login ON wo_purchase_req.wo_insert_by = admin_login.CustID LEFT JOIN " +
          tally_db_name +
          ".client_basic_detail ON wo_purchase_req.wo_client_id = " +
          tally_db_name +
          ".client_basic_detail.code WHERE wo_purchase_req.wo_transaction LIKE CONCAT('%', :wo_id, '%') AND wo_purchase_req.wo_status = 'A' ORDER BY wo_purchase_req.ID DESC",
        {
          replacements: { wo_id: data },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "clientwise") {
      stmt = await invtDB.query(
        "SELECT * FROM wo_purchase_req LEFT JOIN products ON wo_purchase_req.wo_sku = products.product_key LEFT JOIN units ON products.p_uom = units.units_id LEFT JOIN admin_login ON wo_purchase_req.wo_insert_by = admin_login.CustID LEFT JOIN " +
          tally_db_name +
          ".client_basic_detail ON wo_purchase_req.wo_client_id = " +
          tally_db_name +
          ".client_basic_detail.code WHERE wo_client_id = :clientid AND wo_purchase_req.wo_status = 'A' ORDER BY wo_purchase_req.ID DESC",
        {
          replacements: { clientid: data },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "wo_sfg_wise") {
      stmt = await invtDB.query(
        "SELECT * FROM wo_purchase_req LEFT JOIN products ON wo_purchase_req.wo_sku = products.product_key LEFT JOIN units ON products.p_uom = units.units_id LEFT JOIN admin_login ON wo_purchase_req.wo_insert_by = admin_login.CustID LEFT JOIN " +
          tally_db_name +
          ".client_basic_detail ON wo_purchase_req.wo_client_id = " +
          tally_db_name +
          ".client_basic_detail.code WHERE wo_sku = :sfgcode AND wo_purchase_req.wo_status = 'A' ORDER BY wo_purchase_req.ID DESC",
        {
          replacements: { sfgcode: data },
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
          date: moment(stmt[i].wo_insert_date, "YYYY-MM-DD").format(
            "DD-MM-YYYY"
          ),
          woid: stmt[i].wo_transaction,
          wo_sku_transaction: stmt[i].wo_sku_transaction,
          client: stmt[i].name,
          clientcode: stmt[i].wo_client_id,
          clientaddress: stmt[i].wo_client_address,
          clientAddressId: stmt[i].wo_client_add_id,
          billingaddress: stmt[i].wo_billing_addr,
          billingAddrId: stmt[i].wo_billing_add_id,
          shippingaddress: stmt[i].wo_dispatch_addr,
          shippingAddrId: stmt[i].wo_ship_id,
          skucode: stmt[i].p_sku,
          skuname: stmt[i].p_name,
          sku: stmt[i].wo_sku,
          hsn_code: stmt[i].wo_hsncode,
          bom_id: stmt[i].wo_subject_id,
          requiredqty: stmt[i].wo_order_qty + " / " + stmt[i].wo_issue_qty,
          bom_recipe: stmt[i].wo_bom_recipe,
          wo_status: stmt[i].wo_status,
        });
      }
      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: final,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "no orders were found that match the given search criteria.",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Close WO
router.post("/close_WO", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      skucode: "required",
      transaction: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    let { skucode, transaction } = req.body;

    let stmt = await invtDB.query(
      "SELECT * FROM `wo_purchase_req` WHERE `wo_transaction` = :wo_id AND `wo_sku` = :skucode",
      {
        replacements: { wo_id: transaction, skucode: skucode },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      if (stmt[0].wo_status == "C") {
        return res.json({
          status: "error",
          success: false,
          message: "Work Order already close",
        });
      } else {
        let stmt_update = await invtDB.query(
          "UPDATE `wo_purchase_req` SET `wo_close_remark` = :remark, `wo_status` = 'C' WHERE `wo_transaction` = :woid AND `wo_sku` = :skucode",
          {
            replacements: {
              woid: transaction,
              skucode: skucode,
              remark: req.body.remark == null ? "--" : req.body.remark,
            },
            type: invtDB.QueryTypes.UPDATE,
          }
        );
        if (stmt_update.length > 0) {
          return res.json({
            status: "success",
            success: true,
            message: "Work Order closed successfully",
          });
        } else {
          return res.json({
            status: "error",
            success: false,
            message:
              "unable to close the Work order due to some technical issue- contact developer...",
          });
        }
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "unable to fetch any Work order for proceed the action",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// OPEN WO
router.post("/open_WO", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      transaction: "required",
      skucode: "required",
    });
    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    let stmt_check = await invtDB.query(
      "SELECT * FROM `wo_purchase_req` WHERE `wo_transaction` = :wo_id AND `wo_sku` = :skucode",
      {
        replacements: {
          wo_id: req.body.transaction,
          skucode: req.body.skucode,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt_check.length > 0) {
      if (stmt_check[0].wo_status == "A") {
        return res.json({
          status: "error",
          success: false,
          message: "Work Order already actived",
        });
      } else {
        let stmt_update = await invtDB.query(
          "UPDATE `wo_purchase_req` SET `wo_status` = :status WHERE `wo_transaction` = :wo_id AND `wo_sku` = :skucode",
          {
            replacements: {
              wo_id: req.body.transaction,
              skucode: req.body.skucode,
              status: "A",
            },
            type: invtDB.QueryTypes.UPDATE,
          }
        );

        if (stmt_update.length > 0) {
          return res.json({
            status: "success",
            success: true,
            message: "Work Order re-opened successfully",
          });
        } else {
          return res.json({
            status: "error",
            success: false,
            message:
              "unable to activate the work order due to some technical issue- contact developer...",
          });
        }
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "unable to fetch any work order for proceed the action",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//Print WO Analysis
router.post("/print_wo_analysis", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      transaction: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    let { transaction } = req.body;

    let file = {
      url: `${process.env.API_URL}/helper/PRINT/PHP/WO/WOPO.php?invoice=${transaction}`,
    };

    let options = { format: "A4" };
    await html_to_pdf
      .generatePdf(file, options)
      .then((pdfBuffer) => {
        let filename = req.body.transaction + ".pdf";
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
          ...(process.env.NODE_ENV === "development" && { debug: err.stack }),
        });
      });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH WO COMPLETED LIST
router.post(
  "/fetch_wo_completed_list",
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
          "SELECT * FROM `wo_purchase_req` LEFT JOIN `products` ON `wo_purchase_req`.`wo_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `wo_purchase_req`.`wo_insert_by` = `admin_login`.`CustID` WHERE `wo_purchase_req`.`company_branch` = :branch AND DATE_FORMAT(`wo_purchase_req`.`wo_insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `wo_purchase_req`.`wo_status` = 'C' GROUP BY `wo_purchase_req`.`wo_transaction` ORDER BY `wo_purchase_req`.`wo_insert_date` DESC",
          {
            replacements: { date1: date1, date2: date2, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else if (wise == "clientwise") {
        stmt = await invtDB.query(
          "SELECT * FROM `wo_purchase_req` LEFT JOIN `products` ON `wo_purchase_req`.`wo_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `wo_purchase_req`.`wo_insert_by` = `admin_login`.`CustID` WHERE `wo_purchase_req`.`company_branch` = :branch AND `wo_client_id` = :clientid AND `wo_purchase_req`.`wo_status` = 'C' GROUP BY `wo_purchase_req`.`wo_transaction` ORDER BY `wo_purchase_req`.`wo_insert_date` DESC",
          {
            replacements: { clientid: data, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else if (wise == "wo_transaction_wise") {
        stmt = await invtDB.query(
          "SELECT * FROM `wo_purchase_req` LEFT JOIN `products` ON `wo_purchase_req`.`wo_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `wo_purchase_req`.`wo_insert_by` = `admin_login`.`CustID` WHERE `wo_purchase_req`.`company_branch` = :branch AND `wo_purchase_req`.`wo_transaction` LIKE CONCAT('%', :wo_id, '%') AND `wo_purchase_req`.`wo_status` = 'C' GROUP BY `wo_purchase_req`.`wo_transaction` ORDER BY `wo_purchase_req`.`wo_insert_date` DESC",
          {
            replacements: { wo_id: data, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else if (wise == "wo_sfg_wise") {
        stmt = await invtDB.query(
          "SELECT * FROM `wo_purchase_req` LEFT JOIN `products` ON `wo_purchase_req`.`wo_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `wo_purchase_req`.`wo_insert_by` = `admin_login`.`CustID` WHERE `wo_purchase_req`.`company_branch` = :branch AND `wo_sku` = :sfgcode AND `wo_purchase_req`.`wo_status` = 'C' GROUP BY `wo_purchase_req`.`wo_transaction` ORDER BY `wo_purchase_req`.`wo_insert_date` DESC",
          {
            replacements: { sfgcode: data, branch: req.branch },
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
            status: stmt[i].wo_status,
            date: moment(stmt[i].wo_insert_date, "YYYY-MM-DD").format(
              "DD-MM-YYYY"
            ),
            transaction_id: stmt[i].wo_transaction,
            bom_id: stmt[i].wo_subject_id,
            sku_code: stmt[i].p_sku,
            sku_key: stmt[i].product_key,
            sku_name: stmt[i].p_name,
            ord_qty: stmt[i].wo_order_qty + " / " + stmt[i].wo_issue_qty,
          });
        }

        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: final,
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "no orders were found that match the given search criteria.",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// VIEW COMPLETED WO DETAILS
router.post(
  "/view_completed_wo_details",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        wocode: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: validation.errors.errors,
        });
      }

      let stmt = await invtDB.query(
        "SELECT *, COALESCE(SUM(`wo_order_qty`), 0) AS `totalInward` FROM `wo_material_challan` WHERE `wo_transaction` = :transaction AND `company_branch` = :branch GROUP BY `wo_challan_ref_id`",
        {
          replacements: { transaction: req.body.wocode, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        let final = [];

        for (let i = 0; i < stmt.length; i++) {
          final.push({
            challantxn: stmt[i].wo_challan_txn_id,
            challandate: moment(stmt[i].wo_insert_dt, "YYYY-MM-DD").format(
              "DD-MM-YYYY"
            ),
            challanqty: stmt[0].totalInward,
            refid: Buffer.from(stmt[i].wo_challan_ref_id.toString()).toString(
              "base64"
            ),
            transaction: Buffer.from(req.body.wocode.toString()).toString(
              "base64"
            ),
            skucode: Buffer.from(stmt[i].wo_component_id.toString()).toString(
              "base64"
            ),
          });
        }

        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: final,
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "No data found",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// PRINT WO COMPLETED LIST
router.post(
  "/print_wo_completed_list",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        transaction: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
          data: validation.errors.all(),
        });
      }

      let { transaction } = req.body;

      let file = {
        url: `${process.env.API_URL}/helper/PRINT/PHP/WO/WOPO.php?invoice=${transaction}`,
      };

      let options = { format: "A4" };
      await html_to_pdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          let filename = "workorder_comp.pdf";
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
            ...(process.env.NODE_ENV === "development" && { debug: err.stack }),
          });
        });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

//Create MIN for Work Order
router.post(
  "/woMIN",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const validation = new Validator(req.body, {
      woid: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    let itemLength = req.body.component.length;
    for (let i = 0; i < itemLength; i++) {
      let itemValidation = new Validator(
        {
          item: req.body.component[i],
          qty: req.body.qty[i],
          rate: req.body.rate[i],
          hsncode: req.body.hsncode[i],
          location: req.body.location[i],
          gst_type: req.body.gsttype[i],
        },
        {
          item: "required",
          qty: "required",
          rate: "required",
          hsncode: "required",
          location: "required",
          gst_type: [
            "required_if:gst_rate,!=,0",
            "required_if:gst_rate,!=,I",
            "required_if:gst_rate,!=,L",
          ],
        }
      );
      if (itemValidation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "Validation error",
          data: itemValidation.errors.all(),
        });
      }
    }

    const t = await invtDB.transaction();

    try {
      let stmt1 = await invtDB.query(
        "SELECT `branch_code` FROM `branches` WHERE `branch_code` = :branchcode",
        {
          replacements: {
            branchcode: req.branch,
            status: "C",
          },
          type: invtDB.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (stmt1.length > 0) {
        let in_txn_no = await helper.genTransaction("MIN", t);

        let stmt3 = await invtDB.query(
          "SELECT * FROM `wo_purchase_req` WHERE `wo_transaction` = :wo_transaction",
          {
            replacements: { wo_transaction: req.body.woid },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let client_pan = await tallyDB.query(
          "SELECT panNo FROM `client_basic_detail` WHERE `code` = :client_code",
          {
            replacements: { client_code: stmt3[0].wo_client_id },
            type: tallyDB.QueryTypes.SELECT,
          }
        );

        let vendor_code = await invtDB.query(
          "SELECT ven_register_id FROM `ven_basic_detail` WHERE `ven_pan_no` = :pan_no",
          {
            replacements: { pan_no: client_pan[0].panNo },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt3.length > 0) {
          let insert_dt = moment(new Date())
            .tz("Asia/Kolkata")
            .format("YYYY-MM-DD HH:mm:ss");
          for (let i = 0; i < itemLength; i++) {
            if (
              req.body.qty[i] == "0" ||
              req.body.qty[i] == "--" ||
              req.body.rate[i] == "0" ||
              req.body.rate[i] == "--" ||
              req.body.location[i] == "--"
            ) {
              await t.rollback();
              return res.json({
                message: "Please supply all values",
                status: "error",
                success: false,
              });
            }

            let stmt_total_rec = await invtDB.query(
              "SELECT COALESCE(SUM(`wo_m_received_qty`),0 ) AS `total_received_quantity` FROM `wo_material_received` WHERE `wo_insert_type` = 'IN' AND `wo_m_work_id` = :transaction_id AND `wo_m_component` = :component_id",
              {
                replacements: {
                  component_id: req.body.component[i],
                  transaction_id: req.body.woid,
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );
            let total_received_qty;
            if (stmt_total_rec.length > 0) {
              total_received_qty = stmt_total_rec[0].total_received_quantity;
            }

            // let pending_quantity = stmt3[0].wo_order_qty - total_received_qty;
            // if(parseInt(req.body.qty[i]) > pending_quantity){
            //   await t.rollback();
            //   return res.json({
            //
            //    message: "MIN quantity not be greater than Work Order Quantity",
            //    status: "error", success: false,
            //   });
            //  }

            let gstrate;
            if (req.body.gstrate[i] == "--") {
              gstrate = 0;
            } else {
              gstrate = req.body.gstrate[i];
            }

            let stmt4 = await invtDB.query(
              "INSERT INTO `rm_location` (`in_module`,`in_client_addr`,`in_client_branch`,`company_branch`,`min_ewaybill`,`in_gst_cgst`,`in_gst_sgst`,`in_gst_igst`,`in_hsn_code`,`vendor_type`,`in_vendor_name`,`in_invoice_id`,`components_id`,`in_po_rate`,`qty`,`loc_in`,`insert_date`,`insert_by`,`in_transaction_id`,`wo_transaction_id`,`in_wo_invoice_id`, `in_wo_invoice_date`, `trans_type`,`in_client_name`,`in_gst_rate`,`in_gst_type`,`any_remark`,`rm_loc_project_id`,`rm_loc_cost_center`,`is_auto_cons`)VALUES ('IN-WO',:client_address,:client_branch,:branch,:min_ewaybill,:cgst,:sgst,:igst,:hsncode,:client_type,:vendor_name,:in_invoice_id,:component,:wo_rate,:qty,:location_in,:insertdate,:insertby,:in_transaction_id,:wo_transaction_id,:wo_invoice_id, :wo_invoice_date,:in_type,:client_name,:gstrate,:gsttype,:remark,:project_id,:cost_center,'N')",
              {
                replacements: {
                  client_address: stmt3[0].wo_client_address,
                  client_branch: stmt3[0].wo_client_add_id,
                  branch: req.branch,
                  min_ewaybill:
                    req.body.ewaybill == null ? "--" : req.body.ewaybill,
                  cgst: `${
                    helper.gstCalculation(
                      gstrate,
                      req.body.rate[i] * req.body.qty[i],
                      req.body.gsttype[i]
                    ).cgst
                  }`,
                  sgst: `${
                    helper.gstCalculation(
                      gstrate,
                      req.body.rate[i] * req.body.qty[i],
                      req.body.gsttype[i]
                    ).sgst
                  }`,
                  igst: `${
                    helper.gstCalculation(
                      gstrate,
                      req.body.rate[i] * req.body.qty[i],
                      req.body.gsttype[i]
                    ).igst
                  }`,
                  hsncode:
                    req.body.hsncode[i] == null ? "--" : req.body.hsncode[i],
                  client_type: "j01",
                  vendor_name: vendor_code[0].ven_register_id,
                  in_invoice_id: req.body.doc_id,

                  component: req.body.component[i],
                  wo_rate: req.body.rate[i],
                  qty: req.body.qty[i],
                  location_in: req.body.location[i],
                  insertdate: insert_dt,
                  insertby: req.logedINUser,
                  in_transaction_id: in_txn_no,
                  wo_transaction_id: req.body.woid,
                  wo_invoice_id: req.body.doc_id,
                  wo_invoice_date: req.body.doc_date,
                  in_type: "INWARD",
                  client_name: stmt3[0].wo_client_id,
                  gstrate: gstrate,
                  gsttype: req.body.gsttype[i],
                  remark:
                    req.body.remark[i] == null ? "--" : req.body.remark[i],
                  project_id: stmt3[0].wo_project_name,
                  cost_center: stmt3[0].wo_cost_center,
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: t,
              }
            );

            if (stmt4.length > 0) {
              let stmt_insert = await invtDB.query(
                "INSERT INTO `wo_material_received` (`company_branch`,`wo_m_client`,`wo_m_sku`,`wo_m_bom`,`wo_m_component`, `wo_min_id`, `wo_min_date`, `wo_min_eway_bill`, `wo_m_received_rate`, `wo_m_received_qty`, `wo_m_work_id`, `wo_m_insert_dt`,`wo_m_insert_by`,`wo_m_transaction_id`,`wo_insert_type`) VALUES (:branch,:client,:sku,:bom,:component,:min_id,:min_date,:min_ewaybill,:received_rate,:received_qty,:work_id,:insert_dt,:insert_by,:transaction,'IN')",
                {
                  replacements: {
                    branch: req.branch,
                    client: stmt3[0].wo_client_id,
                    sku: stmt3[0].wo_sku,
                    bom: stmt3[0].wo_subject_id,
                    component: req.body.component[i],
                    min_id: req.body.doc_id,
                    min_date: moment(req.body.doc_date, "DD-MM-YYYY").format(
                      "YYYY-MM-DD"
                    ),
                    min_ewaybill:
                      req.body.ewaybill == null ? "--" : req.body.ewaybill,
                    received_rate: req.body.rate[i],
                    received_qty: req.body.qty[i],
                    work_id: req.body.woid,
                    insert_dt: insert_dt,
                    insert_by: req.logedINUser,
                    transaction: in_txn_no,
                  },
                  type: invtDB.QueryTypes.INSERT,
                  transaction: t,
                }
              );
            } else {
              await t.rollback();
              return res.json({
                status: "error",
                success: false,
                message: "Not Insert received quantity",
              });
            }
          }

          // let finalCheck = await invtDB.query(
          //   "INSERT INTO transaction_ids (transaction_id, module_type) SELECT * FROM (SELECT :txn, 'MIN-WO') AS tmp WHERE NOT EXISTS ( SELECT transaction_id FROM transaction_ids WHERE transaction_id = :txn ) LIMIT 1",
          //   {
          //     replacements: { txn: in_txn_no },
          //     transaction: t,
          //     type: invtDB.QueryTypes.INSERT,
          //   }
          // );

          await t.commit();
          return res.json({
            status: "success",
            success: true,
            message:
              "WO Material-IN completed..!!!transaction ref ID. [&#35;" +
              in_txn_no +
              "]",
            status: "success",
            transaction_id: in_txn_no,
          });
        } else {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "MIN operation cancelled bcz it seem WO ID not exist in our records",
          });
        }
      }
      // } else {
      //   await t.rollback();
      //   return res.json({
      //     status: "error",
      //     success: false,
      //     message: "You have selected an invalid company branch",
      //   });
      // }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

//FETCH ALL MIN FOR WORK ORDER
router.post("/fetch_wo_mins", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      wo_id: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: validation.errors.all(),
      });
    }

    let stmt = await invtDB.query(
      "SELECT *, SUM(wo_m_received_qty) AS total_min_qty FROM wo_material_received LEFT JOIN components ON wo_material_received.wo_m_component = components.component_key WHERE wo_m_work_id = :wo_id AND wo_insert_type = 'IN' AND company_branch = :branch GROUP BY wo_m_component, wo_min_id, wo_m_received_rate",
      {
        replacements: { wo_id: req.body.wo_id, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        let stmt_2 = await invtDB.query(
          "SELECT * FROM wo_material_received WHERE wo_m_work_id = :wo_id AND wo_m_status != 'C' AND wo_insert_type = 'OUT' AND wo_min_id = :min_id AND wo_m_component = :component AND wo_out_rate = :out_rate",
          {
            replacements: {
              wo_id: req.body.wo_id,
              min_id: stmt[i].wo_min_id,
              component: stmt[i].wo_m_component,
              out_rate: stmt[i].wo_m_received_rate,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let totalOUT = 0;
        for (let j = 0; j < stmt_2.length; j++) {
          totalOUT = parseInt(totalOUT) + parseInt(stmt_2[j].wo_out_qty);
        }

        let pending_quantity = stmt[i].total_min_qty - totalOUT;

        if (pending_quantity == 0) {
          continue;
        }

        final.push({
          component_name: stmt[i].c_name,
          part_code: stmt[i].c_part_no,
          component_key: stmt[i].component_key,
          min_id: stmt[i].wo_min_id,
          min_date: moment(stmt[i].wo_min_date, "YYYY-MM-DD").format(
            "DD-MM-YYYY"
          ),
          min_eway_bill: stmt[i].wo_min_eway_bill,
          min_rate: stmt[i].wo_m_received_rate,
          min_available_qty: pending_quantity,
          transaction: stmt[i].wo_m_transaction_id,
        });
      }

      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: final,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No data found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//ALL BOM Components
router.post("/allbomcomponents", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      subject_id: "required",
      wo_id: "required",
      getComponents: "required",
    });

    if (valid.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: valid.errors.all(),
      });
    }

    //Get Work Order details
    const stmt3 = await invtDB.query(
      "SELECT * FROM wo_purchase_req LEFT JOIN products ON wo_purchase_req.wo_sku = products.product_key LEFT JOIN units ON products.p_uom = units.units_id LEFT JOIN bom_recipe ON wo_purchase_req.wo_subject_id = bom_recipe.subject_id LEFT JOIN admin_login ON wo_purchase_req.wo_insert_by = admin_login.CustID LEFT JOIN " +
        tally_db_name +
        ".client_basic_detail ON wo_purchase_req.wo_client_id = " +
        tally_db_name +
        ".client_basic_detail.code WHERE wo_purchase_req.wo_transaction LIKE CONCAT('%', :wo_id, '%') AND wo_purchase_req.wo_status = 'A' ORDER BY wo_purchase_req.wo_insert_date DESC",
      {
        replacements: { wo_id: req.body.wo_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    async function getChidBom(sku) {
      let child_comps = [];
      let stmt_child = await invtDB.query(
        "SELECT bom_quantity.* , components.c_name, components.c_part_no , components.component_key , units.units_name FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE bom_quantity.product_sku = :product_sku AND components.c_type = 'R' AND components.c_is_enabled = 'Y'",
        {
          replacements: { product_sku: sku },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt_child.length > 0) {
        let stmt_bom = await invtDB.query(
          "SELECT * FROM bom_recipe WHERE subject_id = :subject_id LIMIT 1",
          {
            replacements: { subject_id: stmt_child[0].subject_under },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        for (let i = 0; i < stmt_child.length; i++) {
          childBoms.push({
            product_sku: stmt_child[i].product_sku,
            component_part_no: stmt_child[i].c_part_no,
            component_name: stmt_child[i].c_name,
            component_key: stmt_child[i].component_key,
            unit: stmt_child[i].units_name,
            quantity: stmt_child[i].qty,
          });

          if (stmt.length - 1 != i) {
            child_comps.push(stmt_child[i].c_part_no);
          }
          if (stmt_child.length - 1 == i) {
            for (let j = 0; j < child_comps.length; j++) {
              await getChidBom(child_comps[j]);
            }
          }
        }
      }
    }
    let final_data = [];
    let childBoms = [];

    let stmt = await invtDB.query(
      "SELECT bom_quantity.* , components.c_name, components.c_part_no , components.component_key , units.units_name FROM bom_quantity LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE bom_quantity.subject_under = :subject AND components.c_type = 'R' AND components.c_is_enabled = 'Y' ",
      {
        replacements: { subject: req.body.subject_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let stmt_bom = await invtDB.query(
        "SELECT bom_recipe.*, products.p_name FROM bom_recipe LEFT JOIN products ON bom_recipe.bom_product_sku = products.p_sku WHERE subject_id = :subject_id",
        {
          replacements: { subject_id: stmt[0].subject_under },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      for (let i = 0; i < stmt.length; i++) {
        final_data.push({
          product_sku: stmt[i].product_sku,
          component_part_no: stmt[i].c_part_no,
          component_name: stmt[i].c_name,
          component_key: stmt[i].component_key,
          unit: stmt[i].units_name,
          quantity: stmt[i].qty,
        });

        await getChidBom(stmt[i].c_part_no);
      }

      if (req.body.getComponents) {
        data = [...final_data, ...childBoms];
      } else {
        data = [];
      }

      return res.json({
        status: "success",
        success: true,
        data: {
          details: {
            date: moment(stmt3[0].wo_insert_date, "YYYY-MM-DD HH:mm:ss").format(
              "DD-MM-YYYY HH:mm:ss"
            ),
            woid: stmt3[0].wo_transaction,
            wo_sku_transaction: stmt3[0].wo_sku_transaction,
            client: stmt3[0].name,
            clientcode: stmt3[0].wo_client_id,
            skucode: stmt3[0].p_sku,
            skuname: stmt3[0].p_name,
            sku: stmt3[0].wo_sku,
            bom_id: stmt3[0].wo_subject_id,
            bom_name: stmt3[0].subject_name,
            requiredqty: stmt3[0].wo_order_qty + " / " + stmt3[0].wo_issue_qty,
            bom_recipe: stmt3[0].wo_bom_recipe,
            wo_status: stmt3[0].wo_status,
            created_by: stmt3[0].user_name,
          },
          components: data,
        },
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// SAVE WO MATERIAL RECEIVED
router.post(
  "/save_wo_material_received",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      let validation = new Validator(req.body, {
        wo_trans_id: "required",
      });
      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
          data: validation.errors.all(),
        });
      }

      const { wo_trans_id } = req.body;

      let stmt = await invtDB.query(
        "SELECT `wo_m_transaction_id` FROM `wo_material_received` WHERE `wo_insert_type` = 'FINALIZE' GROUP BY `wo_m_transaction_id` ORDER BY ID DESC LIMIT 1",
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let received_trans_id = "MTIS0001";

      if (stmt.length > 0) {
        received_trans_id = stmt[0].wo_m_transaction_id;
        let arr = received_trans_id.split(/(?<=[A-Za-z])(?=[0-9]+)/i);
        let str = arr[0];
        let num = parseInt(arr[1]);
        received_trans_id = str + String(num + 1).padStart(4, "0");
      }

      let comp_length = req.body.component.length;
      let bom_qty_length = req.body.bom_qty.length;

      if (comp_length != bom_qty_length) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "component and bom qty length not matched",
        });
      }

      for (let i = 0; i < comp_length; i++) {
        let comp_validation = new Validator(
          {
            component: req.body.component[i],
          },
          {
            component: "required",
          }
        );
        if (comp_validation.fails()) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: comp_validation.errors.all(),
          });
        }
      }

      let stmt_check = await invtDB.query(
        "SELECT * FROM `wo_purchase_req` WHERE `wo_transaction` = :workorder_id AND `company_branch` = :branch",
        {
          replacements: { workorder_id: wo_trans_id, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt_check.length > 0) {
        if (stmt_check[0].wo_status == "C") {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "we are unable to process the workorder transaction against you supplied bcz it closed or on hold for further transaction's. Pls contact to authorized person to fix this issue..",
          });
        }

        let bom_recipe = stmt_check[0].wo_subject_id;
        let product_sku = stmt_check[0].wo_sku;
        let client_code = stmt_check[0].wo_client_id;

        for (let i = 0; i < comp_length; i++) {
          if (req.body.bom_qty[i] != "") {
            let stmt_insert = await invtDB.query(
              "INSERT INTO `wo_material_received` (`company_branch`,`wo_m_client`,`wo_m_sku`,`wo_m_bom`,`wo_m_component`,`wo_m_bom_qty`,`wo_m_work_id`,`wo_m_insert_dt`,`wo_m_insert_by`,`wo_m_transaction_id`)VALUES (:branch,:client,:sku,:bom,:component,:bom_qty,:work_id,:insert_dt,:insert_by,:transaction)",
              {
                replacements: {
                  branch: req.branch,
                  client: client_code,
                  sku: product_sku,
                  bom: bom_recipe,
                  component: req.body.component[i],
                  bom_qty: req.body.bom_qty[i],
                  work_id: wo_trans_id,
                  insert_dt: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm:ss"),
                  insert_by: req.logedINUser,
                  transaction: received_trans_id,
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: transaction,
              }
            );

            if (stmt_insert.length > 0) {
              let stmt_update = await invtDB.query(
                "UPDATE `wo_purchase_req` SET `wo_bom_recipe` = 'CREATED' WHERE `wo_transaction` = :work_id AND `wo_bom_recipe` = 'PENDING'",
                {
                  replacements: { work_id: wo_trans_id },
                  type: invtDB.QueryTypes.UPDATE,
                }
              );
            } else {
              await transaction.rollback();
              return res.json({
                status: "error",
                success: false,
                message: "unable to insert material received transaction",
              });
            }
          }
        }
        await transaction.commit();
        return res.json({
          status: "success",
          success: true,
          message: "material received transaction successfully completed",
        });
      } else {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "an error while executing the workorder transaction",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

//VIEW ALL COMPONENTS IN WORK ORDER
router.post(
  "/fetchComponentListforWO",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        skucode: "required",
        wo_transaction: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "something you missing in form field to supply",
          data: validation.errors.all(),
        });
      }

      let stmt_product = await invtDB.query(
        "SELECT * FROM `products` WHERE (`product_key` = :productkey)",
        {
          replacements: { productkey: req.body.skucode },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt_product.length > 0) {
        let product_name = stmt_product[0].p_name;
        let product_sku;
        if (stmt_product[0].p_sku != "--") {
          product_sku = stmt_product[0].p_sku;
        } else {
          product_sku = stmt_product[0].m_sku;
        }

        let stmt_wo_req = await invtDB.query(
          "SELECT * FROM wo_purchase_req LEFT JOIN wo_material_received ON wo_purchase_req.wo_sku = wo_material_received.wo_m_sku LEFT JOIN bom_recipe ON wo_purchase_req.wo_subject_id = bom_recipe.subject_id LEFT JOIN products ON wo_material_received.wo_m_sku = products.product_key LEFT JOIN units ON products.p_uom = units.units_id LEFT JOIN admin_login ON wo_purchase_req.wo_insert_by = admin_login.CustID LEFT JOIN " +
            tally_db_name +
            ".client_basic_detail ON wo_purchase_req.wo_client_id = " +
            tally_db_name +
            ".client_basic_detail.code WHERE wo_material_received.wo_m_sku = :skucode AND wo_material_received.wo_insert_type = 'FINALIZE' AND wo_purchase_req.wo_transaction = :wo_id LIMIT 1",
          {
            replacements: {
              skucode: req.body.skucode,
              wo_id: req.body.wo_transaction,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let header = [];
        if (stmt_wo_req.length > 0) {
          header.push({
            sku_code: stmt_wo_req[0].p_sku,
            product_name: stmt_wo_req[0].p_name,
            subject_id: stmt_wo_req[0].subject_id,
            subject_name: stmt_wo_req[0].subject_name,
            workorder_id: stmt_wo_req[0].wo_transaction,
            registered_date: moment(
              stmt_wo_req[0].wo_insert_date,
              "YYYY-MM-DD HH:mm:ss"
            ).format("DD-MM-YYYY HH:mm:ss"),
            created_by: stmt_wo_req[0].user_name,
            ordered_qty:
              stmt_wo_req[0].wo_order_qty + " " + stmt_wo_req[0].units_name,
            client_name: stmt_wo_req[0].name,
          });

          let stmt_wo_req2 = await invtDB.query(
            "SELECT * FROM `wo_purchase_req` WHERE `wo_sku` = :skucode AND `wo_transaction` = :wo_id",
            {
              replacements: {
                skucode: req.body.skucode,
                wo_id: req.body.wo_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (stmt_wo_req2.length > 0) {
            let wo_order_qty = stmt_wo_req2[0].wo_order_qty;
            let wo_tran_id = stmt_wo_req2[0].wo_transaction;

            let stmt_comp = await invtDB.query(
              "SELECT * FROM `wo_material_received` LEFT JOIN `components` ON `wo_material_received`.`wo_m_component` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `wo_material_received`.`wo_m_sku` = :skucode AND `wo_material_received`.`wo_insert_type` = 'FINALIZE' AND `wo_material_received`.`wo_m_work_id` = :wo_id ORDER BY `components`.`c_part_no` ASC",
              {
                replacements: {
                  skucode: req.body.skucode,
                  wo_id: req.body.wo_transaction,
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );

            if (stmt_comp.length > 0) {
              let final = [];
              for (let i = 0; i < stmt_comp.length; i++) {
                let stmt_total_rec = await invtDB.query(
                  "SELECT COALESCE(SUM(`wo_m_received_qty`),0 ) AS `total_received_quantity`,  `wo_m_received_rate` FROM `wo_material_received` WHERE `wo_insert_type` = 'IN' AND `wo_m_work_id` = :transaction_id AND `wo_m_component` = :component_id",
                  {
                    replacements: {
                      component_id: stmt_comp[i].component_key,
                      transaction_id: wo_tran_id,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  }
                );
                let total_received_qty;
                let total_inward_value;
                if (stmt_total_rec.length > 0) {
                  total_received_qty =
                    stmt_total_rec[0].total_received_quantity;
                  total_inward_value =
                    stmt_total_rec[0].total_received_quantity *
                    stmt_total_rec[0].wo_m_received_rate;
                } else {
                  total_received_qty = 0;
                  total_inward_value = 0;
                }

                let stmt_total_out = await invtDB.query(
                  "SELECT COALESCE(SUM(`wo_out_qty`),0 ) AS `total_out_quantity`, `wo_out_rate` FROM `wo_material_received` WHERE `wo_insert_type` = 'OUT' AND (`wo_out_type` = 'DELIVERY' OR `wo_out_type` = '--') AND `wo_m_work_id` = :transaction_id AND `wo_m_component` = :component_id",
                  {
                    replacements: {
                      component_id: stmt_comp[i].component_key,
                      transaction_id: wo_tran_id,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  }
                );
                let total_out_qty;
                let total_out_value;
                if (stmt_total_out.length > 0) {
                  total_out_qty = stmt_total_out[0].total_out_quantity;
                  total_out_value =
                    stmt_total_out[0].total_out_quantity *
                    stmt_total_out[0].wo_out_rate;
                } else {
                  total_out_qty = 0;
                  total_out_value = 0;
                }

                let stmt_total_rtn = await invtDB.query(
                  "SELECT COALESCE(SUM(`wo_out_qty`),0 ) AS `total_rtn_quantity`, `wo_out_rate` FROM `wo_material_received` WHERE `wo_insert_type` = 'OUT' AND `wo_out_type` = 'RETURN' AND `wo_m_work_id` = :transaction_id AND `wo_m_component` = :component_id",
                  {
                    replacements: {
                      component_id: stmt_comp[i].component_key,
                      transaction_id: wo_tran_id,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  }
                );
                let total_rtn_qty;
                let total_rtn_value;
                if (stmt_total_rtn.length > 0) {
                  total_rtn_qty = stmt_total_rtn[0].total_rtn_quantity;
                  total_rtn_value =
                    stmt_total_rtn[0].total_rtn_quantity *
                    stmt_total_rtn[0].wo_out_rate;
                } else {
                  total_rtn_qty = 0;
                  total_rtn_value = 0;
                }

                final.push({
                  required_qty: helper
                    .number(wo_order_qty * stmt_comp[i].wo_m_bom_qty)
                    .toFixed(4),
                  received_qty: total_received_qty,
                  pending_qty: helper
                    .number(
                      wo_order_qty * stmt_comp[i].wo_m_bom_qty -
                        total_received_qty
                    )
                    .toFixed(4),
                  comsump_qty: helper
                    .number(total_out_qty * stmt_comp[i].wo_m_bom_qty)
                    .toFixed(4),
                  rm_return_qty: total_rtn_qty,
                  p_with_wo: helper
                    .number(
                      total_received_qty -
                        total_out_qty * stmt_comp[i].wo_m_bom_qty
                    )
                    .toFixed(4),
                  component_name: stmt_comp[i].c_name,
                  component_key: stmt_comp[i].component_key,
                  component_hsn: stmt_comp[i].c_hsn,
                  part_code: stmt_comp[i].c_part_no,
                  new_part_code: stmt_comp[i].c_new_part_no,
                  bom_uom: stmt_comp[i].units_name,
                  bom_rate: stmt_comp[i].wo_m_received_rate,
                  bom_qty: helper.number(stmt_comp[i].wo_m_bom_qty).toFixed(4),
                  out_value: total_out_value,
                  in_value: total_inward_value,
                  rm_rtn_value: total_rtn_value,

                  test_calculation:
                    "Order= " +
                    wo_order_qty +
                    " *  BOM QTY " +
                    stmt_comp[i].wo_m_bom_qty +
                    " - " +
                    total_received_qty,
                });
              }
              return res.json({
                status: "success",
                success: true,
                message: "Data fetched successfully",
                data: { header: header, items: final },
              });
            } else {
              return res.json({
                status: "error",
                success: false,
                message: "Component Not Found",
              });
            }
          } else {
            return res.json({
              status: "error",
              success: false,
              message: `invalid transaction id, we couldn't find anything.. against product sku [${product_sku}]`,
            });
          }
        } else {
          return res.json({
            status: "error",
            success: false,
            message: `BOM not found for this SKU [${product_sku}]`,
          });
        }
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "not a valid SKU supplied",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

//ADD ATTACHMENT WO in MIN
var wo_storage = multer.diskStorage({
  destination: (req, file, callBack) => {
    callBack(null, "./uploads/minInvoices");
  },
  filename: (req, file, callBack) => {
    callBack(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});
var wo_uploadfile = multer({ storage: wo_storage });

router.post(
  "/uploadAttachment",
  [auth.isAuthorized, wo_uploadfile.array("files")],
  async (req, res) => {
    try {
      let filesLenth = req.files.length;

      if (filesLenth <= 0) {
        return res.json({
          status: "error",
          success: false,
          message: "add some attachment",
        });
      }
      if (req.body.doc_name == "") {
        return res.json({
          status: "error",
          success: false,
          message: "add attachment file(s) name",
        });
      }

      let files = [];
      if (filesLenth > 0) {
        for (let i = 0; i < filesLenth; i++) {
          files.push(req.files[i].filename);
        }
      }

      files = files.toString();

      const transaction = await invtDB.transaction();
      let stmt = await invtDB.query(
        "INSERT INTO `ims_min_invoices` (`doc_file_name`,`min_inv_file`,`min_inv_by`,`min_inv_dt`,`min_min_id`,`trans_type`,`attachment_id`) VALUES(:label,:file,:by,:date,:wo,:type,:attachment_id)",
        {
          replacements: {
            label: req.body.doc_name,
            file: files,
            by: req.logedINUser,
            date: moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss"),
            wo: req.body.woid,
            type: "WO",
            attachment_id: helper.getUniqueNumber(),
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      );
      if (stmt.length > 0) {
        //
        const formData = new FormData();
        for (let i = 0; i < filesLenth; i++) {
          const fileStream = fs.createReadStream(
            "./uploads/minInvoices/" + req.files[i].filename
          );
          formData.append("files[]", fileStream);
        }

        const response = await axios.post(
          "https://media.mscorpres.net/oakterIms/uploades/minUpload.php",
          formData,
          {
            headers: {
              "Content-Type": "multipart/form-data",
            },
          }
        );
        if (response.data.code == 500) {
          throw new Error(response.data.message);
        }
        //

        await transaction.commit();
        return res.json({
          status: "success",
          success: true,
          message: "File attached successfully",
          data: files,
        });
      } else {
        fs.unlinkSync("./uploads/minInvoices" + req.file.filename);
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "an error occured while uploading attachment",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

module.exports = router;

const express = require("express");
const router = express.Router();

let { invtDB } = require("../../config/db/connection");

const Validator = require("validatorjs");

const helper = require("./../../helper/helper");
const axios = require("axios");

async function getBomPendingWithJobwork(jwID, locIn, locOut, component) {
  const [row] = await invtDB.query(
    `
    SELECT
      /* TOTAL ISSUE QTY (JOBWORK) */
      COALESCE(SUM(
        CASE
          WHEN trans_type = 'JOBWORK'
           AND jw_transaction_id = :jwID
           AND components_id = :component
           AND loc_in = :locOut
          THEN qty + other_qty
          ELSE 0
        END
      ), 0) AS total_issue_qty,

      /* TOTAL RM RETURN QTY */
      COALESCE(SUM(
        CASE
          WHEN trans_type IN( 'TRANSFER', 'SFG-CONSUMPTION', 'CONSUMPTION' )
           AND jw_transaction_id = :jwID
           AND components_id = :component
           AND trans_mode IN ('return', 'default')
           AND loc_out = :locOut
          THEN qty + other_qty
          ELSE 0
        END
      ), 0) AS total_rm_return_qty
    FROM rm_location
    `,
    {
      replacements: {
        jwID,
        component,
        locIn,
        locOut,
      },
      type: invtDB.QueryTypes.SELECT,
    }
  );

  const total_issue_qty = row?.total_issue_qty || 0;
  const total_rm_return_qty = row?.total_rm_return_qty || 0;

  return {
    total_issue_qty,
    total_rm_return_qty,
  };
}

exports.savejwsfinward = async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    let validation = new Validator(req.body, {
      product: "required",
      qty: "required",
      rate: "required",
      attachment: "required",
      invoice: "required",
      drop_location: "required",
      ewaybill: "required",
    });

    if (validation.fails()) {
      await transaction.rollback();
      return res.json({
        success: false,
        message: helper.firstErrorValidatorjs(validation),
        status: "error",
      });
    }

    if (req.body.qty <= 0) {
      await transaction.rollback();
      return res.json({
        success: false,
        message: "Quantity should be greater than 0",
        status: "error",
      });
    }

    const {
      product,
      qty,
      rate,
      invoice,
      drop_location,
      component,
      remark,
      jobwork_trans_id,
      consCompcomponents,
      consQty,
      consRemark,
      vendortype,
      vendor,
      invoice_date,
    } = req.body;

    let stmt_prod = await invtDB.query(
      "SELECT `product_key` FROM `products` WHERE (`p_sku` = :sku OR `m_sku` = :sku)",
      {
        replacements: { sku: product },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt_prod.length > 0) {
      let stmt_check_jw = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` WHERE `company_branch` = :branch AND `jw_jw_transaction` = :jobwork_id AND `jw_po_sku` = :productcode",
        {
          replacements: {
            jobwork_id: jobwork_trans_id,
            productcode: stmt_prod[0].product_key,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt_check_jw.length > 0) {
        const recipe_code = stmt_check_jw[0].jw_po_recipe;
        let stmt_check_recipe = await invtDB.query(
          "SELECT `sfg_mapped_rm` FROM `bom_recipe` WHERE `subject_id` = :recipe_code",
          {
            replacements: { recipe_code: recipe_code },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt_check_recipe.length > 0) {
          if (stmt_check_recipe[0].sfg_mapped_rm != "--") {
            let stmt3 = await invtDB.query(
              "SELECT `component_key` FROM `components` WHERE `component_key` = :component_key",
              {
                replacements: { component_key: component },
                type: invtDB.QueryTypes.SELECT,
              }
            );

            if (stmt3.length > 0) {
              let stmt4 = await invtDB.query(
                "SELECT * FROM `location_main` WHERE `location_key` = :location_key AND loc_status = 'ACTIVE'",
                {
                  replacements: { location_key: drop_location },
                  type: invtDB.QueryTypes.SELECT,
                }
              );

              if (stmt4.length > 0) {
                const insert_date = moment(new Date())
                  .tz("Asia/Kolkata")
                  .format("YYYY-MM-DD HH:mm:ss");

                if (stmt_check_jw[0].jw_po_status == "C") {
                  await transaction.rollback();
                  return res.json({
                    success: false,
                    message:
                      "JW PO is on hold. Contact authorized person to reopen.",
                    status: "error",
                  });
                } else if (
                  helper.number(stmt_check_jw[0].jw_po_issue_qty) +
                    helper.number(qty) >
                  helper.number(stmt_check_jw[0].jw_po_order_qty)
                ) {
                  await transaction.rollback();
                  return res.json({
                    success: false,
                    message: `Quantity exceeds PO order: ${stmt_check_jw[0].jw_po_issue_qty} + ${qty} > ${stmt_check_jw[0].jw_po_order_qty}`,
                    status: "error",
                  });
                } else {
                  let stmt_min_no = await invtDB.query(
                    "SELECT * FROM `ims_numbering` WHERE `for_number` = 'MIN' FOR UPDATE",
                    {
                      type: invtDB.QueryTypes.SELECT,
                      transaction: transaction,
                    }
                  );
                  let in_txn_no;
                  let intxn_suffix = "0001";
                  if (stmt_min_no.length > 0) {
                    var suffix = stmt_min_no[0].suffix;
                    suffix = parseInt(suffix) + 1;
                    suffix = suffix.toString();
                    suffix = suffix.padStart(
                      parseInt(stmt_min_no[0].number_length_limit),
                      "0"
                    );
                    intxn_suffix = suffix;
                    in_txn_no =
                      stmt_min_no[0].prefix +
                      "/" +
                      stmt_min_no[0].session +
                      "/" +
                      suffix;
                  } else {
                    let currYear = parseInt(
                      new Date().getFullYear().toString().substr(2, 2)
                    );
                    in_txn_no =
                      "MIN/" + currYear + "-" + (currYear + 1) + "/0001";
                  }

                  let stmt_update = await invtDB.query(
                    "UPDATE `ims_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'MIN'",
                    {
                      type: invtDB.QueryTypes.UPDATE,
                      transaction: transaction,
                    }
                  );

                  if (stmt_update.length > 0) {
                    let stmt_tranid = await invtDB.query(
                      "SELECT `transaction_id` FROM `transaction_ids` WHERE `transaction_id` = :transaction_id LIMIT 1",
                      {
                        replacements: { transaction_id: in_txn_no },
                        type: invtDB.QueryTypes.SELECT,
                      }
                    );

                    if (stmt_tranid.length > 0) {
                      await transaction.rollback();
                      return res.json({
                        success: false,
                        message: `Transaction ID ${in_txn_no} already exists. Contact system administrator.`,
                        status: "error",
                      });
                    } else {
                      // CHANGED: Insert file references in database (files already in S3 from upload-invoice API)
                      let str = req.body.attachment;
                      let arr = str.split(",");
                      let fileLength = arr.length;
                      for (let i = 0; i < fileLength; i++) {
                        let insert_res_2 = await invtDB.query(
                          "INSERT INTO `ims_min_invoices` (`min_inv_file`, `min_inv_by`, `min_inv_dt`, `min_min_id`) VALUES(:fileurl, :invby, :invdate, :minid)",
                          {
                            replacements: {
                              fileurl: arr[i], // Just store filename, file already in S3
                              invby: req.logedINUser,
                              invdate: moment(new Date())
                                .tz("Asia/Kolkata")
                                .format("YYYY-MM-DD HH:mm:ss"),
                              minid: in_txn_no,
                            },
                            type: invtDB.QueryTypes.INSERT,
                            transaction: transaction,
                          }
                        );
                      }

                      let checkVendor = await invtDB.query(
                        "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor_id",
                        {
                          replacements: {
                            vendor_id: stmt_check_jw[0].jw_po_vendor_reg_id,
                          },
                          type: invtDB.QueryTypes.SELECT,
                        }
                      );

                      if (checkVendor.length == 0) {
                        await transaction.rollback();
                        return res.json({
                          success: false,
                          status: "error",
                            message: "Vendor not found",
                        });
                      }

                      let stmt_insert = await invtDB.query(
                        "INSERT INTO `rm_location` (`in_module`,`min_ewaybill`,`currency_type`,`company_branch`,`vendor_type`,`components_id`,`in_po_rate`,`qty`,`loc_in`,`any_remark`,`insert_date`,`insert_by`,`in_transaction_id`,`in_jw_transaction_id`,`in_invoice_id`,`trans_type`,`in_vendor_name`, eInv_applicability, ackwlg_irn, qr_status) VALUES ('IN-JWI',:ewaybill,'364907247',:branch,:vendor_type,:component,:jw_rate,:qty,:location_in,:remark,:insertdate,:insertby,:in_transaction_id,:jw_transaction_id,:jw_invoice_id,'INWARD',:vendor_name, :einv_applicability, :ackwlg_irn, :qr_status)",
                        {
                          replacements: {
                            ewaybill:
                              req.body.ewaybill == ""
                                ? "--"
                                : req.body.ewaybill,
                            branch: req.branch,
                            component: component,
                            jw_rate: rate,
                            qty: qty,
                            location_in: drop_location,
                            remark:
                              remark == null ||
                              remark == undefined ||
                              remark == ""
                                ? "--"
                                : remark,
                            insertdate: insert_date,
                            insertby: req.logedINUser,
                            in_transaction_id: in_txn_no,
                            jw_transaction_id: jobwork_trans_id,
                            jw_invoice_id: invoice,
                            vendor_name: stmt_check_jw[0].jw_po_vendor_reg_id,
                            vendor_type: stmt_check_jw[0].jw_po_vendor_type,
                            einv_applicability:
                              checkVendor[0].ven_einvoice_status,
                            ackwlg_irn: req.body.irn ?? "--",
                            qr_status: req.body.qrScan ?? "--",
                          },
                          type: invtDB.QueryTypes.INSERT,
                          transaction: transaction,
                        }
                      );

                      if (stmt_insert.length > 0) {
                        let stmt_update_jw = await invtDB.query(
                          "UPDATE `jw_purchase_req` SET `jw_po_issue_qty` = `jw_po_issue_qty` + :qty WHERE `jw_jw_transaction` = :transaction AND `jw_po_sku` = :skucode",
                          {
                            replacements: {
                              qty: qty,
                              transaction: jobwork_trans_id,
                              skucode: stmt_prod[0].product_key,
                            },
                            type: invtDB.QueryTypes.UPDATE,
                            transaction: transaction,
                          }
                        );

                        if (stmt_update_jw.length > 0) {
                          let finalCheck = await invtDB.query(
                            "INSERT INTO transaction_ids (transaction_id, module_type) SELECT * FROM (SELECT :txn, 'MIN-JW-INWARD') AS tmp WHERE NOT EXISTS ( SELECT transaction_id FROM transaction_ids WHERE transaction_id = :txn ) LIMIT 1",
                            {
                              replacements: { txn: in_txn_no },
                              transaction: transaction,
                              type: invtDB.QueryTypes.INSERT,
                            }
                          );

                          if (finalCheck.length > 0) {
                            if (consCompcomponents.length != consQty.length) {
                              await transaction.rollback();
                              return res.json({
                                success: false,
                                status: "error",
                                message:
                                  "Consumption components and quantity mismatch",
                              });
                            }

                            for (
                              let i = 0;
                              i < consCompcomponents.length;
                              i++
                            ) {
                              const validConsumption = new Validator(
                                {
                                  component: consCompcomponents[i],
                                  qty: consQty[i],
                                },
                                {
                                  component: "required",
                                  qty: "required",
                                }
                              );

                              if (validConsumption.fails()) {
                                await transaction.rollback();
                                return res.json({
                                  success: false,
                                  status: "error",
                                  message:
                                    helper.firstErrorValidatorjs(
                                      validConsumption
                                    ),
                                });
                              }
                            }

                            const out_txn_id = "JWCONS" + intxn_suffix;
                            for (
                              let i = 0;
                              i < consCompcomponents.length;
                              i++
                            ) {
                              let componentKey = consCompcomponents[i], consumeQty = helper.number(consQty[i]);

                              let jwBomQtyStmt = await invtDB.query(
                                "SELECT * FROM jw_bom_recipe WHERE jw_bom_recipe.jw_bom_po_trans = :jw_id AND jw_bom_part = :comp",
                                {
                                  replacements: {
                                    jw_id: jobwork_trans_id,
                                    comp: componentKey,
                                  },
                                  type: invtDB.QueryTypes.SELECT,
                                }
                              );

                              if (jwBomQtyStmt.length <= 0) {
                                await transaction.rollback();
                                return res.json({
                                  success: false,
                                  status: "error",
                                  message: `Component not found in BOM at row ${
                                    i + 1
                                  }`,
                                });
                              }

                              
                              const  { total_issue_qty, total_rm_return_qty }  =
                                await getBomPendingWithJobwork(
                                  jobwork_trans_id,
                                  stmt_check_jw[0].ven_location,
                                  stmt_check_jw[0].ven_location,
                                  componentKey
                                );

                              if (
                                consumeQty > helper.number(total_issue_qty - total_rm_return_qty)
                              ) {
                                await transaction.rollback();
                                return res.json({
                                  success: false,
                                  message: `Insufficient jobwork stock for component [${componentKey}] at row ${
                                    i + 1
                                  } | Availble Qty is: ${total_issue_qty - total_rm_return_qty}`,
                                  data: {
                                    required: consumeQty,
                                    available: total_issue_qty - total_rm_return_qty,
                                  },
                                });
                              }

                              console.log(
                                "=============================",
                                stmt_check_jw[0].ven_location,
                                componentKey
                              );

                              const consCompStmt = await invtDB.query(
                                "INSERT INTO rm_location (in_transaction_id, company_branch, trans_type, components_id, qty, mfg_bom_qty, out_transaction_id, jw_transaction_id, insert_date, insert_by, any_remark, in_invoice_id, loc_out) VALUES (:in_transaction_id, :branch, :trans_type, :components_id, :qty, :mfg_bom_qty, :out_transaction_id, :jw_transaction_id, :insert_date, :insert_by, :any_remark, :jw_invoice_id, :loc_out)",
                                {
                                  replacements: {
                                    branch: req.branch,
                                    trans_type: "SFG-CONSUMPTION",
                                    components_id: componentKey,
                                    qty: consumeQty,
                                    mfg_bom_qty: jwBomQtyStmt[0].jw_bom_qty,
                                    out_transaction_id: out_txn_id,
                                    jw_transaction_id: jobwork_trans_id,
                                    insert_date: insert_date,
                                    insert_by: req.logedINUser,
                                    any_remark:
                                      consRemark[i] == null ||
                                      consRemark[i] == undefined ||
                                      consRemark[i] == ""
                                        ? "--"
                                        : consRemark[i],
                                    in_transaction_id: in_txn_no,
                                    jw_invoice_id: invoice,
                                    loc_out: stmt_check_jw[0].ven_location,
                                  },
                                  type: invtDB.QueryTypes.INSERT,
                                  transaction: transaction,
                                }
                              );

                              if (consCompStmt.length <= 0) {
                                await transaction.rollback();
                                return res.json({
                                  status: "error",
                                  success: false,
                                  message: "Error saving consumption data",
                                });
                              }
                            }

                            await transaction.commit();

                            let payload = { Data: [] };
                            let apiStatus = "ERROR";
                            let externalResult;
                            try {
                              const data = [];
                              const itemLength =
                                consCompcomponents?.length || 0;

                              for (let i = 0; i < itemLength; i++) {
                                let partCodeName = "";
                                let partname = "";
                                const currentComponentKey =
                                  consCompcomponents[i];
                                const currentConsumeQty = helper.number(
                                  consQty[i]
                                );

                                if (currentComponentKey) {
                                  const componentResult = await invtDB.query(
                                    "SELECT c_part_no, c_name FROM `components` WHERE `component_key` = :partCode LIMIT 1",
                                    {
                                      replacements: {
                                        partCode: currentComponentKey,
                                      },
                                      type: invtDB.QueryTypes.SELECT,
                                    }
                                  );
                                  partCodeName =
                                    componentResult.length > 0
                                      ? componentResult[0].c_part_no
                                      : "";
                                  partname =
                                    componentResult.length > 0
                                      ? componentResult[0].c_name
                                      : "";
                                }

                                data.push({
                                  PARTCode: partCodeName,
                                  PARTCodeName: partname,
                                  VendorName:
                                    vendortype === "p01"
                                      ? "--"
                                      : vendor || "--",
                                  InvoiceDate: moment(
                                    invoice_date?.[0] || insert_date
                                  ).format("YYYY/MM/DD HH:mm:ss"),
                                  MinNumber: in_txn_no,
                                  UNIT: currentConsumeQty,
                                  Rate: isNaN(parseFloat(rate))
                                    ? 0
                                    : parseFloat(rate),
                                  MINDate: moment(insert_date).format(
                                    "YYYY/MM/DD HH:mm:ss"
                                  ),
                                });
                              }

                              payload = { Data: data };

                              console.log(
                                "Payload for external API:",
                                JSON.stringify(payload, null, 2)
                              );

                              if (process.env.STAGE === "PROD") {
                                try {
                                  const response = await axios.post(
                                    "http://dev.oakter.co:84/Oakter/Report/SaveComponentInwardData",
                                    payload,
                                    {
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                    }
                                  );

                                  console.log("API Response:", response.data);

                                  apiStatus =
                                    response.data.OverAllStatus === "PASS"
                                      ? "PASS"
                                      : "FAIL";

                                  if (
                                    response &&
                                    response.data &&
                                    response.data.OverAllStatus === "PASS"
                                  ) {
                                    externalResult = {
                                      status: "PASS",
                                      message: "External API call successful",
                                      details: response.data.Status,
                                    };
                                  } else if (response && response.data) {
                                    externalResult = {
                                      status: "FAIL",
                                      message: `External API call failed: ${response.data.Status.join(
                                        ", "
                                      )}`,
                                      details: response.data.Status,
                                    };
                                  }

                                  try {
                                    await invtDB.query(
                                      "INSERT INTO api_payload_log (min_number, api_status, payload, log_dt) VALUES (:minNumber, :apiStatus, :payload, :log_dt)",
                                      {
                                        replacements: {
                                          minNumber: in_txn_no,
                                          apiStatus: apiStatus,
                                          payload: JSON.stringify(payload),
                                          log_dt: moment(insert_date).format(
                                            "YYYY-MM-DD HH:mm:ss"
                                          ),
                                        },
                                        type: invtDB.QueryTypes.INSERT,
                                      }
                                    );
                                  } catch (dbError) {
                                    console.error(
                                      "Failed to log payload to api_payload_log:",
                                      dbError.message
                                    );
                                  }
                                } catch (error) {
                                  console.error("External API Error:", {
                                    message: error.message,
                                    response: error.response
                                      ? {
                                          status: error.response.status,
                                          data: error.response.data,
                                        }
                                      : "No response data",
                                  });

                                  externalResult = {
                                    status: "ERROR",
                                    message: `Failed to call external API: ${error.message}`,
                                    details: error.response?.data || null,
                                  };

                                  try {
                                    await invtDB.query(
                                      "INSERT INTO api_payload_log (min_number, api_status, payload, log_dt) VALUES (:minNumber, :apiStatus, :payload, :log_dt)",
                                      {
                                        replacements: {
                                          minNumber: in_txn_no,
                                          apiStatus: "ERROR",
                                          payload: JSON.stringify(payload),
                                          log_dt: moment(insert_date).format(
                                            "YYYY-MM-DD HH:mm:ss"
                                          ),
                                        },
                                        type: invtDB.QueryTypes.INSERT,
                                      }
                                    );
                                  } catch (dbError) {
                                    console.error(
                                      "Failed to log payload to api_payload_log:",
                                      dbError.message
                                    );
                                  }
                                }
                              } else {
                                externalResult = {
                                  status: "SKIPPED",
                                  message:
                                    "External API call skipped (UAT/DEV environment)",
                                  details: null,
                                };

                                console.log(
                                  `[UAT/DEV] Skipping external API call. Payload would be:`,
                                  JSON.stringify(payload, null, 2)
                                );

                                try {
                                  await invtDB.query(
                                    "INSERT INTO api_payload_log (min_number, api_status, payload, log_dt) VALUES (:minNumber, :apiStatus, :payload, :log_dt)",
                                    {
                                      replacements: {
                                        minNumber: in_txn_no,
                                        apiStatus: "SKIPPED",
                                        payload: JSON.stringify(payload),
                                        log_dt: moment(insert_date).format(
                                          "YYYY-MM-DD HH:mm:ss"
                                        ),
                                      },
                                      type: invtDB.QueryTypes.INSERT,
                                    }
                                  );
                                } catch (dbError) {
                                  console.error(
                                    "Failed to log payload to api_payload_log:",
                                    dbError.message
                                  );
                                }
                              }
                            } catch (error) {
                              console.error(
                                "Error in external API integration:",
                                {
                                  message: error.message,
                                  stack: error.stack,
                                  response: error.response
                                    ? {
                                        status: error.response.status,
                                        data: error.response.data,
                                      }
                                    : "No response data",
                                }
                              );

                              externalResult = {
                                status: "ERROR",
                                message: `Error in external API integration: ${error.message}`,
                                details: error.response?.data || null,
                              };

                              if (
                                payload &&
                                payload.Data &&
                                payload.Data.length > 0
                              ) {
                                try {
                                  await invtDB.query(
                                    "INSERT INTO api_payload_log (min_number, api_status, payload, log_dt) VALUES (:minNumber, :apiStatus, :payload, :log_dt)",
                                    {
                                      replacements: {
                                        minNumber: in_txn_no,
                                        apiStatus: "ERROR",
                                        payload: JSON.stringify(payload),
                                        log_dt: moment(insert_date).format(
                                          "YYYY-MM-DD HH:mm:ss"
                                        ),
                                      },
                                      type: invtDB.QueryTypes.INSERT,
                                    }
                                  );
                                } catch (dbError) {
                                  console.error(
                                    "Failed to log payload to api_payload_log:",
                                    dbError.message
                                  );
                                }
                              }
                            }

                            return res.json({
                              status: "success",
                              success: true,
                              message: `FG/SFG inward request added successfully with transaction id [${in_txn_no}]`,
                              data: {
                                txn: in_txn_no,
                                externalStatus:
                                  externalResult?.status || "SKIPPED",
                                externalDetails:
                                  externalResult?.details || null,
                              },
                            });
                          } else {
                            await transaction.rollback();
                            return res.json({
                              success: false,
                              status: "error",
                              message: "Transaction route is busy. Try again.",
                            });
                          }
                        } else {
                          await transaction.rollback();
                          return res.json({
                            success: false,
                            status: "error",
                            message: "Error updating purchase request",
                          });
                        }
                      } else {
                        await transaction.rollback();
                        return res.json({
                          success: false,
                          status: "error",
                          message: "Error saving location data",
                        });
                      }
                    }
                  } else {
                    await transaction.rollback();
                    return res.json({
                      success: false,
                      status: "error",
                      message: "Error updating transaction number",
                    });
                  }
                }
              } else {
                await transaction.rollback();
                return res.json({
                  success: false,
                  status: "error",
                  message: "Invalid location provided",
                });
              }
            } else {
              await transaction.rollback();
              return res.json({
                success: false,
                status: "error",
                message: "Invalid component code",
              });
            }
          } else {
            await transaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message: "No SFG inwarding RM mapped",
            });
          }
        } else {
          await transaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "BOM recipe deleted",
          });
        }
      } else {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Jobwork transaction not found",
        });
      }
    } else {
      await transaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "Jobwork product SKU not matched",
      });
    }
  } catch (err) {
    console.log(err);
    await transaction.rollback();
    return helper.errorResponse(res, err);
  }
};

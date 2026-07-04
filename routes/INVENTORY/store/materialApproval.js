const express = require("express");
const router = express.Router();


let { invtDB, refbDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

const { encode, decode } = require("html-entities");
var fs = require("fs");
var path = require("path");
var html_to_pdf = require("html-pdf-node");

function byPart(a, b) {
  return a.partno.localeCompare(b.partno, "en", { numeric: true });
}

// Fetch Pending Request for Material Approval
router.post(
  "/fetchTransactionForApproval",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let stmt = await invtDB.query(
        "SELECT *, `material_request`.`ID` AS `row_id`, `material_request`.`insert_date` AS `request_date` FROM `material_request` LEFT JOIN `admin_login` ON `material_request`.`inserted_by` = `admin_login`.`CustID` WHERE `material_request`.`transaction_type` = :status AND `material_request`.`req_debit` != '0' AND `material_request`.`req_debit` != '' AND `material_request`.`transaction_mode` = '--' AND `material_request`.`company_branch` = :branch GROUP BY `material_request`.`transaction_id` ORDER BY `material_request`.`insert_date` DESC",
        {
          replacements: { status: "O", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt.length > 0) {
        let finalResult = [];
        stmt.forEach((element) => {
          finalResult.push({
            user_name: element.user_name,
            transaction_id: element.transaction_id,
            insert_full_date: moment(element.request_date)
              .tz("Asia/Kolkata")
              .format("DD-MM-YYYY hh:mm A"),
          });
        });

        res.json({
          status: "success",
          success: true,
          message: "Request fetched successfully",
          data: finalResult,
        });
        return;
      } else {
        res.json({
          status: "error",
          success: false,
          message: "No request found",
        });
        return;
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// Fetch Items inside the transaction request
router.post("/fetchTransactionItems", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    transaction: "required",
  });

  if (validation.fails()) {
    res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
    return;
  }

  try {
    let result = await invtDB.query(
      `SELECT 
    material_request.ID AS OutID, 
    material_request.transaction_id AS transactionID, 
    material_request.components_key AS my_component_name,
    material_request.req_remark,
    material_request.req_debit,
    material_request.mfgqty,
    material_request.comment,
    products.p_name,
    products.p_sku,
    bom_recipe.subject_id,
    bom_recipe.subject_name,
    components.c_name,
    components.c_part_no,
    units.units_name,
    location_main.location_key,
    location_main.loc_name
  FROM material_request 
  LEFT JOIN products ON material_request.product = products.p_sku 
  LEFT JOIN bom_recipe ON material_request.bom = bom_recipe.subject_id 
  LEFT JOIN components ON material_request.components_key = components.component_key 
  LEFT JOIN units ON components.c_uom = units.units_id 
  LEFT JOIN location_main ON material_request.location_id = location_main.location_key 
  LEFT JOIN rm_location ON material_request.components_key = rm_location.components_id 
  WHERE components.c_type = 'R' 
    AND components.c_is_enabled = 'Y' 
    AND material_request.transaction_id = :transaction 
    AND material_request.transaction_type NOT IN ('OA', 'C') 
    AND material_request.req_debit != '0' 
    AND material_request.req_debit != '' 
    AND material_request.company_branch = :branch 
  GROUP BY material_request.components_key 
  ORDER BY components.c_part_no ASC
  LIMIT 100 OFFSET 0`,
      {
        replacements: { transaction: req.body.transaction, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (result.length > 0) {
      let materialData = [];
      let HeaderData = [];
      let count = 0;
      result.map(async (item) => {
        // let total_credit = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `totalCreditComponent` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'TRANSFER')", {
        //   replacements: { component: item.my_component_name, branch: req.branch },
        //   type: invtDB.QueryTypes.SELECT,
        // });

        // let credit;
        // if (total_credit.length > 0) {
        //   credit = helper.number(total_credit[0].totalCreditComponent);
        // } else {
        //   credit = 0;
        // }

        // total_debit = await invtDB.query("SELECT COALESCE(SUM(`qty` + `other_qty`), 0) AS `totalDebitComponent` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'CONSUMPTION' AND `trans_type` != 'INWARD' AND `trans_type` != 'CANCELLED')", {
        //   replacements: { component: item.my_component_name, branch: req.branch },
        //   type: invtDB.QueryTypes.SELECT,
        // });
        // let debit;
        // if (total_debit.length > 0) {
        //   debit = helper.number(total_debit[0].totalDebitComponent);
        // } else {
        //   debit = 0;
        // }

        // check empty value
        if (item.p_name) {
          productname = item.p_name;
        } else {
          productname = "N/A";
        }

        if (item.p_sku) {
          skucode = item.p_sku;
        } else {
          skucode = "--";
        }

        if (item.subject_id) {
          subjectID = item.p_sku;
        } else {
          subjectID = "--";
        }

        if (item.subject_name) {
          subjectname = item.subject_name;
        } else {
          subjectname = "N/A (-)";
        }

        materialData.push({
          authIdentity: item.OutID,
          remark: item.req_remark,
          compKey: item.my_component_name,
          component: decode(item.c_name).toUpperCase(),
          requiredQty: item.req_debit,
          partno: item.c_part_no,
          unit: item.units_name.toUpperCase(),
        });

        HeaderData.push({
          sku: skucode,
          product: productname,
          bomKey: subjectID,
          bom: subjectname,
          locationKey: item.location_key,
          location: decode(item.loc_name),
          mfgqty: item.mfgqty,
          comment: item.comment,
          transaction: item.transactionID,
        });
        count++;

        if (count == result.length) {
          materialData.sort(byPart);
          res.json({
            status: "success",
            success: true,
            message: "Items fetched successfully",
            data: { header: HeaderData, material: materialData },
          });
          return;
        }
      });
    } else {
      res.json({ status: "error", success: false, message: "No items found." });
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Fetch Locations inside the transaction request approval module
router.get(
  "/fetchLocationAllotedTransApprv",
  [auth.isAuthorized],
  async (req, res) => {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE  `loc_all_key` = :location_key",
      {
        replacements: { location_key: "20220212144802" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt1.length > 0) {
      let arr = stmt1[0].locations.split(",");
      let locs = [];

      for (let i = 0; i < arr.length; i++) {
        let stmt2 = await invtDB.query(
          "SELECT `location_key`, `loc_name` FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
          {
            replacements: { location_defined: arr[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        for (let j = 0; j < stmt2.length; j++) {
          locs.push({ id: stmt2[j].location_key, text: stmt2[j].loc_name });
        }
      }

      return res.json({
        status: "success",
        success: true,
        message: "Locations fetched successfully",
        data: locs,
      });
    }
  }
);

// SAVE TRANSACTION REQUEST APPROVAL
router.post(
  "/AllowComponentsApproval",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    let validation = new Validator(req.body, {
      authKey: "required",
      issueQty: "required|min:0",
      pickLocation: "required",
    });

    if (validation.fails()) {
      res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
      return;
    }

    let t = await invtDB.transaction();
    try {
      let stmt1 = await invtDB.query(
        "SELECT * FROM `material_request` WHERE `ID` = :row AND `components_key` = :component AND `company_branch` = :branch",
        {
          replacements: {
            row: req.body.authKey,
            component: req.body.component,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt1.length > 0) {
        if (stmt1[0].transaction_type == "OA") {
          return res.json({
            status: "error",
            success: false,
            message: "transaction is already approved...",
          });
        }
        if (stmt1[0].transaction_type == "C") {
          return res.json({
            status: "error",
            success: false,
            message: "transaction is already cancelled...",
          });
        }
        let stmt2 = await invtDB.query(
          "SELECT * FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :pic_loc",
          {
            replacements: {
              component: req.body.component,
              pic_loc: req.body.pickLocation,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt2.length > 0) {
          if (
            helper.number(stmt1[0].req_debit) < helper.number(req.body.issueQty)
          ) {
            return res.json({
              status: "error",
              success: false,
              message:
                stmt1[0].req_debit +
                " can't approve max than user demanded quantity",
            });
          }
          // ALL INWARD
          let stmtInward = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER') AND `loc_in` = :pic_loc",
            {
              replacements: {
                component: req.body.component,
                pic_loc: req.body.pickLocation,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let inward_all_qtyl;
          if (stmtInward.length > 0) {
            inward_all_qty = helper.number(stmtInward[0].Inward);
          } else {
            inward_all_qty = 0;
          }

          // ALL OUTWARD
          let stmtOutward = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'CONSUMPTION' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER') AND `loc_out` = :pic_loc",
            {
              replacements: {
                component: req.body.component,
                pic_loc: req.body.pickLocation,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let outward_all_qty;
          if (stmtOutward.length > 0) {
            outward_all_qty = helper.number(stmtOutward[0].Outward);
          } else {
            outward_all_qty = 0;
          }

          if (
            helper.number(inward_all_qty - outward_all_qty) < req.body.issueQty
          ) {
            return res.json({
              status: "error",
              success: false,
              message:
                "unable to accept request because of quantity not available in yet stocks, the current qty are [" +
                (inward_all_qty - outward_all_qty) +
                "] at your pick location.",
            });
          } else {
            let stmt3 = await invtDB.query(
              "SELECT `ID` FROM `rm_location` ORDER BY `ID` DESC LIMIT 1",
              {
                type: invtDB.QueryTypes.SELECT,
              }
            );

            let date =
              new Date().getDate().toString() +
              (new Date().getMonth() + 1 > 9
                ? new Date().getMonth() + 1
                : "0" + (new Date().getMonth() + 1)) +
              new Date().getFullYear().toString().slice(-2);
            if (stmt3.length > 0) {
              transactionKey = date + (parseInt(stmt3[0].ID) + 1).toString();
            } else {
              transactionKey = date + "1";
            }
            let stmt4 = await invtDB.query(
              "INSERT INTO `rm_location` (`company_branch`,`trans_type`,`components_id`,`loc_in`,`loc_out`,`qty`,`any_remark`,`bom_subject_id`,`insert_date`,`insert_by`,`out_transaction_id`)VALUES (:branch,:type,:component,:loc_in,:loc_out,:qty,:remark,:subject,:indate,:inby,:out_transaction_id)",
              {
                replacements: {
                  branch: req.branch,
                  type: "ISSUE",
                  component: req.body.component,
                  loc_in: req.body.location,
                  loc_out: req.body.pickLocation,
                  qty: req.body.issueQty,
                  remark: req.body.remark == "" ? "--" : req.body.remark,
                  subject: req.body.subject == null ? "--" : req.body.subject,
                  indate: moment().format("YYYY-MM-DD HH:mm:ss"),
                  inby: req.logedINUser,
                  out_transaction_id: transactionKey,
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: t,
              }
            );

            let stmt5 = await invtDB.query(
              "UPDATE `material_request` SET `transaction_type` = :type, `approval_transaction` = :approve_txn WHERE `ID` = :identity AND components_key = :component",
              {
                replacements: {
                  type: "OA",
                  approve_txn: transactionKey,
                  component: req.body.component,
                  identity: req.body.authKey,
                },
                type: invtDB.QueryTypes.UPDATE,
                transaction: t,
              }
            );

            if (parseInt(req.body.issueQty) < 0) {
              await t.rollback();
              res.json({
                status: "error",
                success: false,
                message: "order QTY couldn't be zero OR in negative!!!",
              });
              return;
            } else {
              let stmt6 = await invtDB.query(
                "SELECT `c_name`, `c_part_no`, `units`.`units_name` FROM `components` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `component_key` = :component_key",
                {
                  replacements: { component_key: req.body.component },
                  type: invtDB.QueryTypes.SELECT,
                  transaction: t,
                }
              );
              if (stmt6.length > 0) {
                await t.commit();
                res.json({
                  status: "success",
                  success: true,
                  message:
                    "request approved...!!! Txn ID: " + `${transactionKey}`,
                });
                return;
              } else {
                await t.rollback();
                res.json({
                  status: "error",
                  success: false,
                  message: "requested component is not valid or deleted",
                });
                return;
              }
            }
          }
        } else {
          await t.rollback();
          res.json({
            status: "error",
            success: false,
            message: "component not available on your selected location",
          });
          return;
        }
      } else {
        await t.rollback();
        res.json({
          status: "error",
          success: false,
          message: "invalid request",
        });
        return;
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// Print Request
router.post("/print_request", [auth.isAuthorized], async (req, res) => {
  try {
    let file = {
      url: `${process.env.API_URL}/helper/PRINT/PHP/RMAPPROVE/print_materiaReq.php?transaction=${req.body.transaction}`,
    };
    let options = { format: "A4" };

    html_to_pdf
      .generatePdf(file, options)
      .then((pdfBuffer) => {
        return res.json({
          status: "success",
          success: true,
          message: "file generated successfully...",
          data: { buffer: pdfBuffer, filename: req.body.transaction + ".pdf" },
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

// Cancel Comonent
router.post(
  "/AllowComponentsCancellation",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(
      req.body,
      {
        authKey: "required",
        remark: "required",
        component: "required",
      },
      {
        authKey: "Something happend wrong",
      }
    );

    if (validation.fails()) {
      res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    try {
      let stmt = await invtDB.query(
        "SELECT * FROM `material_request` WHERE `ID` = :row AND `components_key` = :component AND `company_branch` = :branch",
        {
          replacements: {
            row: req.body.authKey,
            component: req.body.component,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        stmt.map(async (row) => {
          let stmt1 = await invtDB.query(
            "SELECT * FROM `material_request` WHERE `ID` = :row AND `components_key` = :component AND `company_branch` = :branch",
            {
              replacements: {
                row: req.body.authKey,
                component: req.body.component,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt1.length > 0) {
            if (stmt1[0].transaction_type == "OA") {
              return res.json({
                status: "error",
                success: false,
                message:
                  "transaction is already approved since can not be cancelled...",
              });
            }
            if (stmt1[0].transaction_type == "C") {
              return res.json({
                status: "error",
                success: false,
                message: "transaction is already cancelled...",
              });
            }

            let stmt2 = await invtDB.query(
              "UPDATE `material_request` SET `transaction_type` = :type, `rej_comment` = :remark WHERE `ID` = :identity AND components_key = :component AND `transaction_id` = :transaction",
              {
                replacements: {
                  type: "C",
                  remark: req.body.remark,
                  identity: req.body.authKey,
                  component: req.body.component,
                  transaction: row.transaction_id,
                },
                type: invtDB.QueryTypes.UPDATE,
              }
            );
            if (stmt2.length > 0) {
              return res.json({
                status: "success",
                success: true,
                message: "component cancelled successfully...",
              });
            } else {
              return res.json({
                status: "error",
                success: false,
                message: "an error occured while updating the status",
              });
            }
          } else {
            return res.json({
              status: "error",
              success: false,
              message: "invalid request...",
            });
          }
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "order component is not valid or deleted",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// CANCELL REQUEST
router.post("/requestCancellation", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(
    req.body,
    {
      transaction: "required",
      remark: "required",
    },
    {
      transaction: "Something happend wrong",
    }
  );

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }

  const t = await invtDB.transaction();
  try {
    let stmt = await invtDB.query(
      "SELECT * FROM `material_request` WHERE transaction_id = :transaction AND `company_branch` = :branch AND transaction_type NOT IN ('C','OA')",
      {
        replacements: { branch: req.branch, transaction: req.body.transaction },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      for (let i = 0; i < stmt.length; i++) {
        if (stmt[i].transaction_type == "C") {
          t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "transaction is already cancelled...",
          });
        }
        if (stmt[i].transaction_type == "OA") {
          t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "transaction is already approved since can not be cancelled...",
          });
        }
      }

      for (let i = 0; i < stmt.length; i++) {
        let stmt2 = await invtDB.query(
          "UPDATE `material_request` SET `transaction_type` = :type, `rej_comment` = :remark  , updated_by = :updated_by , update_date = :update_date  WHERE `ID` = :identity AND components_key = :componentAND `transaction_id` = :transaction",
          {
            replacements: {
              type: "C",
              remark: req.body.remark,
              identity: stmt[i].ID,
              component: stmt[i].components_key,
              transaction: req.body.transaction,
              updated_by: req.logedINUser,
              update_date: moment()
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD HH:mm:ss"),
            },
            transaction: t,
          }
        );

        if (stmt2[0].affectedRows < 1) {
          t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "an error occured while updating the status",
          });
        }
      }

      await t.commit();
      return res.json({
        status: "success",
        success: true,
        message: "request cancelled successfully...",
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "order component is not valid or deleted",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// REFURBISH MIN TRANSACTION
// router.post("/refurbish/AllowComponentsApproval", [auth.isAuthorized], async (req, res) => {
//   const validation = new Validator(req.body, {
//     component: "required",
//     qty: "required",
//     location: "required",
//     remark: "required",
//   });

//   if (validation.fails()) {
//     res.json({ status: "error", success: false, message: "something you missing in form field to supply", data: validation.errors.all() });
//     return;
//   }

//   let itemLength = req.body.component.length;

//   if (itemLength <= 0) {
//     res.json({ status: "error", success: false, message: "Please add atleast one item" });
//     return;
//   }

//   for (let i = 0; i < itemLength; i++) {
//     let itemValidation = new Validator(
//       {
//         item: req.body.component[i],
//         qty: req.body.qty[i],
//         location: req.body.location[i],
//       },
//       {
//         item: "required",
//         qty: "required|min:1",
//         location: "required",
//       }
//     );
//     if (itemValidation.fails()) {
//       res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(itemValidation) });
//       return;
//     }
//   }

//   const t = await refbDB.transaction();
//   try {
// 	let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");
//     for (let i = 0; i < itemLength; i++) {
//       if (helper.number(req.body.qty[i]) > 0) {
//         // ALL INWARD
//         let stmtInward = await refbDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'ISSUE' OR `trans_type` = 'TRANSFER') AND `loc_in` = :location AND `company_branch` =:branch", {
//           replacements: { component: req.body.component[i], location: req.body.location[i], branch: req.branch },
//           type: refbDB.QueryTypes.SELECT,
//         });

//         let inward_all_qty;
//         if (stmtInward.length > 0) {
//           inward_all_qty = helper.number(stmtInward[0].Inward);
//         } else {
//           inward_all_qty = 0;
//         }

//         // ALL OUTWARD
//         let stmtOutward = await refbDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'ISSUE' OR `trans_type` = 'TRANSFER') AND `loc_out` = :location AND `company_branch` = :branch", {
//           replacements: { component: req.body.component[i], location: req.body.location[i], branch: req.branch },
//           type: refbDB.QueryTypes.SELECT,
//         });

//         let outward_all_qty;
//         if (stmtOutward.length > 0) {
//           outward_all_qty = helper.number(stmtOutward[0].Outward);
//         } else {
//           outward_all_qty = 0;
//         }

//         if (helper.number(inward_all_qty - outward_all_qty) < req.body.qty[i]) {
//           return res.json({ status: "error", success: false, message: "unable to accept request because of quantity not available in yet stocks, the current qty are [" + (inward_all_qty - outward_all_qty) + "] at your pick location." });
//         } else {
//           let stmt3 = await refbDB.query("SELECT `ID` FROM `rm_location` ORDER BY `ID` DESC LIMIT 1", {
//             type: refbDB.QueryTypes.SELECT,
//           });

//           let date = new Date().getDate().toString() + (new Date().getMonth() + 1 > 9 ? new Date().getMonth() + 1 : "0" + (new Date().getMonth() + 1)) + new Date().getFullYear().toString().slice(-2);
//           if (stmt3.length > 0) {
//             transactionKey = date + (parseInt(stmt3[0].ID) + 1).toString();
//           } else {
//             transactionKey = date + "1";
//           }
//           let stmt4 = await refbDB.query("INSERT INTO `rm_location` (`company_branch`,`trans_type`,`components_id`,`loc_out`,`qty`,`any_remark`,`insert_date`,`insert_by`,`out_transaction_id`)VALUES (:branch,:type,:component,:loc_out,:qty,:remark,:indate,:inby,:out_transaction_id)", {
//             replacements: {
//               branch: req.branch,
//               type: "ISSUE",
//               component: req.body.component[i],
//               loc_out: req.body.location[i],
//               qty: req.body.qty[i],
//               remark: req.body.remark[i] == "" ? "--" : req.body.remark[i],
//               indate: insert_dt,
//               inby: req.logedINUser,
//               out_transaction_id: transactionKey,
//             },
//             type: refbDB.QueryTypes.INSERT,
//             transaction: t,
//           });
//         }
//       }

//       await t.commit();
//       res.json({ status: "success", success: true, message: "RM issued with TXN ID : " + transactionKey, data: { txn: transactionKey } });
//       return;
//     }
//   } catch (err) {
//       return helper.errorResponse(res, err);
//   }
// });

// WITH UOM
// router.post("/refurbish/getComponentDetailsByCode", [auth.isAuthorized], async (req, res) => {
//   const validation = new Validator(req.body, {
//     component_code: "required",
//     location: "required",
//   });

//   if (validation.passes()) {
//     try {
//       const result = await refbDB.query("SELECT * FROM `components` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `components`.`component_key` = :key AND `components`.`c_is_enabled` = 'Y'", {
//         replacements: { key: req.body.component_code },
//         type: refbDB.QueryTypes.SELECT,
//       });
//       if (result.length > 0) {
//         // ALL INWARD
//         let stmtInward = await refbDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'ISSUE' OR `trans_type` = 'TRANSFER') AND `loc_in` = :location AND `company_branch` =:branch", {
//           replacements: { component: req.body.component_code, location: req.body.location, branch: req.branch },
//           type: refbDB.QueryTypes.SELECT,
//         });

//         let inward_all_qtyl;
//         if (stmtInward.length > 0) {
//           inward_all_qty = helper.number(stmtInward[0].Inward);
//         } else {
//           inward_all_qty = 0;
//         }

//         // ALL OUTWARD
//         let stmtOutward = await refbDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'ISSUE' OR `trans_type` = 'TRANSFER') AND `loc_out` = :location AND `company_branch` = :branch", {
//           replacements: { component: req.body.component_code, location: req.body.location, branch: req.branch },
//           type: refbDB.QueryTypes.SELECT,
//         });

//         let outward_all_qty;
//         if (stmtOutward.length > 0) {
//           outward_all_qty = helper.number(stmtOutward[0].Outward);
//         } else {
//           outward_all_qty = 0;
//         }

//         let currentQty = 0;
//         if (result.length > 0) {
//           currentQty = helper.number(inward_all_qty) - helper.number(outward_all_qty);
//         }

//         return res.json({ status: "success", success: true, message: "success", data: { currentQty: currentQty, unit: result[0].units_name } });
//       } else {
//         return res.json({ status: "error", success: false, message: "Component not found" });
//       }
//     } catch (err) {
//         return helper.errorResponse(res, err);
//     }
//   } else {
//     return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
//   }
// });

module.exports = router;

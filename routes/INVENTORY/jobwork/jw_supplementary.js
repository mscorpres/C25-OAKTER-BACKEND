const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../../config/db/connection");


const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

router.post("/fetchJwOption", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (
      (req.body.searchTerm == undefined || req.body.searchTerm == "",
      req.body.searchTerm == null)
    ) {
      stmt = await invtDB.query(
        "SELECT `jw_jw_transaction` FROM `jw_purchase_req` GROUP BY `jw_jw_transaction` ORDER BY `ID` DESC LIMIT 50",
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT `jw_jw_transaction` FROM `jw_purchase_req` WHERE `jw_jw_transaction` LIKE :name GROUP BY `jw_jw_transaction` ORDER BY `jw_jw_transaction` DESC LIMIT 50",
        {
          replacements: { name: `%${req.body.searchTerm}%` },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt.length > 0) {
      let final = [];
      stmt.map((item) => {
        final.push({
          id: item.jw_jw_transaction,
          text: item.jw_jw_transaction,
        });
      });

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
        message: "no data found",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// FETCH SUPPLEMENTARY DATA
router.post(
  "/fetchSupplementaryData",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        sup_jobwork_id: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "Validation error",
          data: validation.errors.errors,
        });
      }

      let stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :jw_transaction",
        {
          replacements: { jw_transaction: req.body.sup_jobwork_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        if (stmt[0].jw_po_bom_recipe != "CREATED") {
          return res.json({
            status: "error",
            success: false,
            message:
              "we didn't found any recipe against of this Jobwork, Please create the recipe first to update the same",
          });
        } else {
          let stmt_header = await invtDB.query(
            "SELECT `units`.`units_name`, `jw_purchase_req`.`jw_po_order_qty`, `jw_purchase_req`.`jw_po_full_date`, `jw_purchase_req`.`jw_jw_transaction`, `products`.`p_name`, `products`.`p_sku`, `bom_recipe`.`subject_name`, `ven_basic_detail`.`ven_name`, `ven_address_detail`.`ven_address`, `jw_purchase_req`.`jw_po_vendor_address` FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `units`.`units_id` = `products`.`p_uom` LEFT JOIN `bom_recipe` ON `jw_purchase_req`.`jw_po_recipe` = `bom_recipe`.`subject_id` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `ven_address_detail` ON `jw_purchase_req`.`jw_po_ven_add_id` = `ven_address_detail`.`ven_address_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` WHERE `jw_purchase_req`.`jw_jw_transaction` = :jw_transaction",
            {
              replacements: { jw_transaction: req.body.sup_jobwork_id },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let headers;

          if (stmt_header.length > 0) {
            headers = {
              sku_code: stmt_header[0].p_sku,
              product_name: stmt_header[0].p_name,
              subject_name: stmt_header[0].subject_name,
              jobwork_id: stmt_header[0].jw_jw_transaction,
              registered_date: moment(stmt_header[0].jw_po_full_date).format(
                "DD-MM-YYYY"
              ),
              created_by: stmt_header[0].user_name,
              ordered_qty:
                stmt_header[0].jw_po_order_qty +
                " " +
                stmt_header[0].units_name,
              vendor_name: stmt_header[0].ven_name,
            };
          }

          let stmt_comp = await invtDB.query(
            "SELECT *,`jw_bom_recipe`.`ID` AS `rowID` FROM `jw_purchase_req` LEFT JOIN `jw_bom_recipe` ON `jw_bom_recipe`.`jw_bom_po_trans` = `jw_purchase_req`.`jw_jw_transaction` AND `jw_bom_recipe`.`jw_bom_sku` = `jw_purchase_req`.`jw_po_sku` LEFT JOIN `components` ON `jw_bom_recipe`.`jw_bom_part` = `components`.`component_key` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `jw_purchase_req`.`jw_jw_transaction` = :jw_transaction",
            {
              replacements: { jw_transaction: req.body.sup_jobwork_id },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let component = [];
          if (stmt_comp.length > 0) {
            for (let i = 0; i < stmt_comp.length; i++) {
              let part_alt = [
                {
                  alt_component_part: "N/A",
                  alt_component_name: "N/A",
                  alt_component_key: "N/A",
                },
              ];
              if (
                stmt_comp[i].jw_bom_part_status === "ALT" &&
                stmt_comp[i].jw_bom_alt_part &&
                stmt_comp[i].jw_bom_alt_part !== "--"
              ) {
                const altPartKey = stmt_comp[i].jw_bom_alt_part
                  .split(",")
                  .map((p) => p.trim());

                if (altPartKey.length > 0) {
                  const altResults = await invtDB.query(
                    `SELECT c_part_no, c_name , component_key
           FROM components 
           WHERE component_key IN (:altPartKey)`,
                    {
                      replacements: { altPartKey },
                      type: invtDB.QueryTypes.SELECT,
                    }
                  );

                  if (altResults.length > 0) {
                    part_alt = altResults.map((alt) => ({
                      alt_component_part: alt.c_part_no,
                      alt_component_key: alt.component_key,
                      alt_component_name: alt.c_name,
                    }));
                  }
                }
              }
              component.push({
                row_id: Buffer.from(stmt_comp[i].rowID.toString()).toString(
                  "base64"
                ),
                component_key: stmt_comp[i].component_key,
                component_name: stmt_comp[i].c_name,
                component_part: stmt_comp[i].c_part_no,
                component_uom: stmt_comp[i].units_name,
                recipe_qty: stmt_comp[i].jw_bom_qty,
                part_status: stmt_comp[i].jw_bom_part_status,
                part_alt: part_alt,
              });
            }
          }

          return res.json({
            status: "success",
            success: true,
            message: "Data fetched successfully",
            data: { headers: headers, components: component },
          });
        }
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "unable to fetch any jobwork",
        });
      }
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

// UPDATE JOBWORK RECIPE
// router.post("/updateJobworkRecipe", [auth.isAuthorized], async (req, res) => {
//   const transaction = await invtDB.transaction();
//   try {
//     let validation = new Validator(req.body, {
//       original_po: "required",
//     });

//     if (validation.fails()) {
//       return res.json({
//
//         status: "error", success: false,
//         message: validation.errors.errors,
//       });
//     }

//     const row_lenth = req.body.row.length;

//     for (let i = 0; i < row_lenth; i++) {
//       let valid = new Validator(
//         {
//           qty: req.body.qty[i],
//           part: req.body.part[i],
//           row: req.body.row[i],
//         },
//         {
//           qty: "required",
//           part: "required",
//           row: "required",
//         }
//       );
//       if (valid.fails()) {
//         await transaction.rollback();
//         return res.json({
//
//           status: "error", success: false,
//           message: valid.errors.all(),
//         });
//       }

//       if (req.body.qty[i] <= 0) {
//         await transaction.rollback();
//         return res.json({
//
//           status: "error", success: false,
//           message: "PO recipe Qty should be greater than zero/0",
//         });
//       }
//     }

//     let stmt = await invtDB.query(
//       "SELECT * FROM `jw_bom_recipe` WHERE `jw_bom_po_trans` = :jw_transaction",
//       {
//         replacements: { jw_transaction: req.body.original_po },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );

//     if (stmt.length > 0) {
//       let sku_code = stmt[0].jw_bom_sku;
//       let jw_transaction_id = stmt[0].jw_bom_po_trans;
//       let bom_recipe_id = stmt[0].jw_bom_create_trans;

//       for (let i = 0; i < row_lenth; i++) {
//         if (req.body.row[i] == 0) {
//           // INSERT
//           let stmt_check_comp = await invtDB.query(
//             "SELECT * FROM `components` WHERE `component_key` = :component",
//             {
//               replacements: { component: req.body.part[i] },
//               type: invtDB.QueryTypes.SELECT,
//             }
//           );

//           if (stmt_check_comp.length > 0) {
//             let stmt_dup_comp = await invtDB.query(
//               "SELECT * FROM `jw_bom_recipe` WHERE `jw_bom_part` = :component AND `jw_bom_sku_trans` = :jw_transaction",
//               {
//                 replacements: {
//                   component: req.body.part[i],
//                   jw_transaction: req.body.original_po,
//                 },
//                 type: invtDB.QueryTypes.SELECT,
//               }
//             );

//             if (stmt_dup_comp.length > 0) {
//               await transaction.rollback();
//               return res.json({
//
//                 status: "error", success: false,
//                 message: {
//                   msg: "you have already saved the part as in recipe and again you are trying to add same",
//                 },
//               });
//             } else {
//               let stmt_insert = await invtDB.query(
//                 "INSERT INTO `jw_bom_recipe`(`company_branch`,`jw_bom_sku`,`jw_bom_part`,`jw_bom_qty`,`jw_bom_po_trans`,`jw_bom_sku_trans`,`jw_bom_insert_dt`,`jw_bom_insert_by`,`jw_bom_create_trans`, jw_bom_rate) VALUES (:branch,:sku, :part, :qty, :jw_trans, :sku_trans, :insert_dt, :insert_by, :create_trans, :rate)",
//                 {
//                   replacements: {
//                     branch: req.branch,
//                     sku: sku_code,
//                     part: req.body.part[i],
//                     qty: req.body.qty[i],
//                     jw_trans: jw_transaction_id,
//                     sku_trans: jw_transaction_id,
//                     insert_dt: moment(new Date())
//                       .tz("Asia/Kolkata")
//                       .format("YYYY-MM-DD HH:mm:ss"),
//                     insert_by: req.logedINUser,
//                     create_trans: bom_recipe_id,
//                     rate: "0", //req.body.rate[i]
//                   },
//                   type: invtDB.QueryTypes.INSERT,
//                   transaction: transaction,
//                 }
//               );

//               if (stmt_insert.length <= 0) {
//                 await transaction.rollback();
//                 return res.json({
//
//                   status: "error", success: false,
//                   message: "error while updating PO",
//                 });
//               }
//             }
//           } else {
//             await transaction.rollback();
//             return res.json({
//
//               status: "error", success: false,
//               message: {
//                 msg: "some of the component is not valid, please reload the page and contact to system administrator",
//               },
//             });
//           }
//         } else {
//           // UPDATE
//           let stmt_check_comp = await invtDB.query(
//             "SELECT * FROM `components` WHERE `component_key` = :component",
//             {
//               replacements: { component: req.body.part[i] },
//               type: invtDB.QueryTypes.SELECT,
//             }
//           );

//           if (stmt_check_comp.length > 0) {
//             let stmt_update = await invtDB.query(
//               "UPDATE `jw_bom_recipe` SET `jw_bom_qty` = :qty, jw_bom_rate = :rate, `jw_bom_insert_dt` = :insert_dt, `jw_bom_insert_by` = :insert_by, `jw_bom_create_trans` = :create_trans WHERE `ID` = :row AND `jw_bom_po_trans` = :jw_trans AND `jw_bom_part` = :part",
//               {
//                 replacements: {
//                   qty: req.body.qty[i],
//                   insert_dt: moment(new Date())
//                     .tz("Asia/Kolkata")
//                     .format("YYYY-MM-DD HH:mm:ss"),
//                   insert_by: req.logedINUser,
//                   create_trans: bom_recipe_id,
//                   row: Buffer.from(req.body.row[i], "base64").toString("ascii"),
//                   jw_trans: jw_transaction_id,
//                   part: req.body.part[i],
//                   rate: "0", //req.body.rate[i]
//                 },
//                 type: invtDB.QueryTypes.UPDATE,
//                 transaction: transaction,
//               }
//             );

//             if (stmt_update.length <= 0) {
//               await transaction.rollback();
//               return res.json({
//
//                 status: "error", success: false,
//                 message: "error while updating PO",
//               });
//             }
//           } else {
//             await transaction.rollback();
//             return res.json({
//
//               status: "error", success: false,
//               message: {
//                 msg: "some of the component is not valid, please reload the page and contact to system administrator",
//               },
//             });
//           }
//         }
//       } // END FOR LOOP

//       await transaction.commit();
//       return res.json({
//
//         status: "success", success: true,
//         message: "PO updated successfully...",
//       });
//     } else {
//       await transaction.rollback();
//       return res.json({
//
//         status: "error", success: false,
//         message: "Jobwork transaction ID is not valid",
//       });
//     }
//   } catch (error) {
//     await transaction.rollback();
//     return res.json({
//
//       status: "error", success: false,
//       message: {
//         msg: "Internal Error<br/>If this condition persists, contact your system administrator",
//       },
//,
//     });
//   }
// });

router.post("/updateJobworkRecipe", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    let validation = new Validator(req.body, {
      original_po: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "Validation error",
        data: validation.errors.errors,
      });
    }

    const row_lenth = req.body.row.length;

    // helper to get alt components for a given row/component
    const getAltComponents = (rowId, compKey) => {
      const alt = req.body.alternate_components?.find(
        (item) => item.row_id === rowId && item.component_key === compKey
      );
      return alt?.alt_components || [];
    };

    let stmt = await invtDB.query(
      "SELECT * FROM `jw_bom_recipe` WHERE `jw_bom_po_trans` = :jw_transaction",
      {
        replacements: { jw_transaction: req.body.original_po },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let sku_code = stmt[0].jw_bom_sku;
      let jw_transaction_id = stmt[0].jw_bom_po_trans;
      let bom_recipe_id = stmt[0].jw_bom_create_trans;

      for (let i = 0; i < row_lenth; i++) {
        let valid = new Validator(
          {
            qty: req.body.qty[i],
            part: req.body.part[i],
            row: req.body.row[i],
          },
          {
            qty: "required",
            part: "required",
            row: "required",
          }
        );
        if (valid.fails()) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Validation error",
            data: valid.errors.all(),
          });
        }

        if (req.body.qty[i] <= 0) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "PO recipe Qty should be greater than zero/0",
          });
        }

        const component_key = req.body.part[i];
        const encoded_row_id = req.body.row[i];
        // Fix: Only decode if encoded_row_id is not 0 to avoid TypeError
        const decoded_row_id =
          encoded_row_id == 0
            ? 0
            : Buffer.from(encoded_row_id, "base64").toString("ascii");
        const alt_components = getAltComponents(encoded_row_id, component_key);
        const alt_part_str =
          alt_components.length > 0 ? alt_components.join(",") : "--";
        const part_status = alt_components.length > 0 ? "ALT" : "ACTIVE";

        if (encoded_row_id == 0) {
          // INSERT
          let stmt_check_comp = await invtDB.query(
            "SELECT * FROM `components` WHERE `component_key` = :component",
            {
              replacements: { component: component_key },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (stmt_check_comp.length > 0) {
            let stmt_dup_comp = await invtDB.query(
              "SELECT * FROM `jw_bom_recipe` WHERE `jw_bom_part` = :component AND `jw_bom_sku_trans` = :jw_transaction",
              {
                replacements: {
                  component: component_key,
                  jw_transaction: req.body.original_po,
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );

            if (stmt_dup_comp.length > 0) {
              await transaction.rollback();
              return res.json({
                status: "error",
                success: false,
                message:
                  "You have already saved the part in the recipe and again you are trying to add the same.",
              });
            } else {
              const stmt_insert = await invtDB.query(
                "INSERT INTO `jw_bom_recipe`(`company_branch`,`jw_bom_sku`,`jw_bom_part`,`jw_bom_qty`,`jw_bom_po_trans`,`jw_bom_sku_trans`,`jw_bom_insert_dt`,`jw_bom_insert_by`,`jw_bom_create_trans`, `jw_bom_rate`, `jw_bom_alt_part`, `jw_bom_part_status`) VALUES (:branch,:sku, :part, :qty, :jw_trans, :sku_trans, :insert_dt, :insert_by, :create_trans, :rate, :alt_parts, :status)",
                {
                  replacements: {
                    branch: req.branch,
                    sku: sku_code,
                    part: component_key,
                    qty: req.body.qty[i],
                    jw_trans: jw_transaction_id,
                    sku_trans: jw_transaction_id,
                    insert_dt: moment(new Date())
                      .tz("Asia/Kolkata")
                      .format("YYYY-MM-DD HH:mm:ss"),
                    insert_by: req.logedINUser,
                    create_trans: bom_recipe_id,
                    rate: "0", // replace with real rate if needed
                    alt_parts: alt_part_str,
                    status: part_status,
                  },
                  type: invtDB.QueryTypes.INSERT,
                  transaction: transaction,
                }
              );

              if (stmt_insert.length <= 0) {
                await transaction.rollback();
                return res.json({
                  status: "error",
                  success: false,
                  message: "Error while inserting PO",
                });
              }
            }
          } else {
            await transaction.rollback();
            return res.json({
              status: "error",
              success: false,
              message:
                "Component not valid. Please reload and contact system administrator.",
            });
          }
        } else {
          // UPDATE
          let stmt_check_comp = await invtDB.query(
            "SELECT * FROM `components` WHERE `component_key` = :component",
            {
              replacements: { component: component_key },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (stmt_check_comp.length > 0) {
            let stmt_update = await invtDB.query(
              "UPDATE `jw_bom_recipe` SET `jw_bom_qty` = :qty, `jw_bom_rate` = :rate, `jw_bom_insert_dt` = :insert_dt, `jw_bom_insert_by` = :insert_by, `jw_bom_create_trans` = :create_trans, `jw_bom_alt_part` = :alt_parts, `jw_bom_part_status` = :status WHERE `ID` = :row AND `jw_bom_po_trans` = :jw_trans AND `jw_bom_part` = :part",
              {
                replacements: {
                  qty: req.body.qty[i],
                  insert_dt: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm:ss"),
                  insert_by: req.logedINUser,
                  create_trans: bom_recipe_id,
                  row: decoded_row_id,
                  jw_trans: jw_transaction_id,
                  part: component_key,
                  rate: "0", // replace with actual rate if available
                  alt_parts: alt_part_str,
                  status: part_status,
                },
                type: invtDB.QueryTypes.UPDATE,
                transaction: transaction,
              }
            );

            if (stmt_update.length <= 0) {
              await transaction.rollback();
              return res.json({
                status: "error",
                success: false,
                message: "Error while updating PO",
              });
            }
          } else {
            await transaction.rollback();
            return res.json({
              status: "error",
              success: false,
              message:
                "Component not valid. Please reload and contact system administrator.",
            });
          }
        }
      }

      await transaction.commit();
      return res.json({
        status: "success",
        success: true,
        message: "PO updated successfully...",
      });
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Jobwork transaction ID is not valid",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// GET COMPONENT DATA
router.post("/getComponentData", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT * FROM `components` LEFT JOIN `units`ON `components`.`c_uom` = `units`.`units_id` WHERE `components`.`component_key` = :key AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y'",
      {
        replacements: { key: req.body.component },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let final = {
        name: stmt[0].c_name,
        unit: stmt[0].units_name.toUpperCase(),
        part: stmt[0].c_part_no,
        key: stmt[0].component_key,
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
        message: "unable to fetch any registered components from database",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;

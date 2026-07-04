const express = require("express");
const router = express.Router();

let { invtDB, otherDB , invtOakterDB} = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

router.post("/fetchProductData", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    search: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: helper.firstErrorValidatorjs(validation),
      status: "error",
    });
  }

  try {
    let stmt = await invtDB.query(
      "SELECT `subject_id`,`subject_name` FROM `bom_recipe` WHERE `bom_product_sku` = :skucode AND bom_status = 'ENABLE'",
      {
        replacements: { skucode: req.body.search },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    let boms = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        boms.push({ id: item.subject_id, text: item.subject_name });
      });

      let prod_stmt = await invtDB.query(
        "SELECT * FROM `products` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE `p_sku` = :sku OR `m_sku` = :sku",
        {
          replacements: { sku: req.body.search },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (prod_stmt.length > 0) {
        product_name = prod_stmt[0].p_name;
        product_sku = prod_stmt[0].p_sku;
        uom = prod_stmt[0].units_name;
      }

      let totalRequestQTY = 0;
      let totalAccept4Consumption = 0;

      let stmt2 = await invtDB.query(
        "SELECT COALESCE(SUM(`prod_planned_qty`), 0) AS `totalReqPPRQTY` , COALESCE(SUM(`prod_executed_qty`), 0) AS `prod_executed_qty` FROM `mfg_production_1` WHERE `mfg_production_1`.`phase1_status` = 'A' AND `prod_product_sku` = :sku GROUP BY `prod_product_sku`",
        {
          replacements: { sku: req.body.search },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt2.length > 0) {
        totalRequestQTY = stmt2[0].totalReqPPRQTY;
        totalAccept4Consumption = stmt2[0].prod_executed_qty;
      }

      // let stmt3 = await invtDB.query("SELECT COALESCE(SUM(`mfg_prod_planing_qty`),0) AS totalConsumpAccepted, COALESCE(SUM(`mfg_prod_in`), 0) AS totalDonePPRQTY FROM `mfg_production_2` WHERE `mfg_sku` = :sku AND `mfg_prod_type` = 'C' GROUP BY `mfg_sku`", {
      //   replacements: { sku: req.body.search },
      //   type: invtDB.QueryTypes.SELECT,
      // });

      // if (stmt3.length > 0) {
      //   totalAccept4Consumption = stmt3[0].totalConsumpAccepted;
      // }

      let opening = 0;
      let open_stmt = await invtDB.query(
        "SELECT COALESCE(SUM(QTY), 0) AS `OpeningBalance` FROM ( SELECT `mfg_approve_in_qty` QTY FROM `mfg_production_3` CR WHERE CR.mfg_pro_apr_sku = :sku UNION ALL SELECT - fgout_approve_out_qty QTY FROM `mfg_production_3` DR WHERE DR.fgout_pro_apr_sku = :productkey ) t",
        {
          replacements: {
            productkey: prod_stmt[0].product_key,
            sku: req.body.search,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (open_stmt.length > 0) {
        opening = open_stmt[0].OpeningBalance;
        let other = {
          // existingplanedQty: helper.number(totalRequestQTY) - helper.number(totalAccept4Consumption),
          existingplanedQty:
            helper.number(totalRequestQTY) -
            helper.number(totalAccept4Consumption),
          stockInHand: opening,
          product_name: product_name,
          product_sku: product_sku,
          uom: uom,
        };

        return res.json({
          status: "success",
          data: {
            other: other,
            bom: boms,
          },
          success: true,
        });
      } else {
        return res.json({
          success: false,
          status: "error",
          message:
            "Internal Error!!! If this condition persists, contact your system administrator",
        });
      }
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "No Bom Found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.post(
  "/createPPR",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    let validation = new Validator(req.body, {
      product: "required",
      recipe: "required",
      qty: "required",
      duedate: "required",
      location: "required",
      customer: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        message: helper.firstErrorValidatorjs(validation),
        success: false,
      });
    }

    const t1 = await invtDB.transaction();

    try {
      function randomString(length = 10) {
        var result = "";
        var characters =
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        var charactersLength = characters.length;
        for (var i = 0; i < length; i++) {
          result += characters.charAt(
            Math.floor(Math.random() * charactersLength)
          );
        }
        return result;
      }

      if (req.body.project == "") {
        return res.json({
          status: "error",
          message: "w.e.f 12-Dec-2022, Project ID is mandatory to create PPR",
          success: false,
        });
      }
      let stmt = await invtDB.query(
        "SELECT `prod_transaction` FROM `mfg_production_1` GROUP BY `prod_transaction` ORDER BY `ID` DESC LIMIT 1",
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let transactionCode;

      if (stmt.length > 0) {
        transactionCode = stmt[0].prod_transaction;
      } else {
        transactionCode = "PR001";
      }

      let stmt_check_product = await invtDB.query(
        "SELECT * FROM products WHERE p_sku = :sku AND is_enabled = 'Y'",
        {
          replacements: {
            sku: req.body.product,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt_check_product.length <= 0) {
        return res.json({
          status: "error",
          success: false,
          message: "SKU not found or disabled",
        });
      }

      if (helper.number(req.body.qty) > 0) {
        let strings = transactionCode.replace(/[0-9]/g, "");
        let digits = (
          parseInt(transactionCode.replace(/[^0-9]/g, "")) + 1
        ).toString();
        if (digits.length < 2) digits = ("0" + digits).substr(-2);
        transactionCode = strings + digits;

        if (req.body.recipe == "" && req.body.recipe == null) {
          return res.json({
            success: false,
            message: "SKU BOM not provided",
            status: "error",
          });
        }

        let stmt1 = await invtDB.query(
          "INSERT INTO `mfg_production_1` (`prod_branch`,`prod_project`,`prod_type`,`prod_comment`,`prod_product_sku`,`prod_bom_subject`,`prod_customer_name`,`prod_planned_qty`,`prod_location`,`prod_due_date`,`prod_inserted_by`,`prod_insert_date`,`prod_transaction`,`ppr_randomcode`,`prod_rqd_status`)VALUES (:branch,:project,:type,:comment,:sku,:subject,:name,:qty,:location,:duedate,:by,:insertdate,:transactionid,:random,:rdqstatus)",
          {
            replacements: {
              branch: req.branch,
              type: req.body.requesttype,
              comment: req.body.comment,
              project: req.body.project,
              sku: req.body.product,
              subject: req.body.recipe,
              name: req.body.customer,
              qty: req.body.qty,
              location: req.body.location,
              duedate: req.body.duedate,
              by: req.logedINUser,
              insertdate: moment(new Date())
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD HH:mm:ss"),
              transactionid: transactionCode,
              random: randomString(),
              rdqstatus: "D",
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: t1,
          }
        );

        if (stmt1.length > 0) {
          if (
            helper.preg_match(
              /^(0[1-9]|[1-2][0-9]|3[0-1])-(0[1-9]|1[0-2])-[0-9]{4}$/,
              req.body.duedate
            )
          ) {
            if (
              moment(req.body.duedate, "DD-MM-YYYY").diff(
                moment(new Date(), "DD-MM-YYYY"),
                "days"
              ) < 0
            ) {
              t1.rollback();
              return res.json({
                status: "error",
                message:
                  "PPR due date couldn't be less than requesting creating date",
                success: false,
              });
            } else if (
              moment(req.body.duedate, "DD-MM-YYYY").isSame(moment(), "day")
            ) {
              t1.rollback();
              return res.json({
                status: "error",
                message: "PPR due date couldn't be equal to creating date",
                success: false,
              });
            } else {
              t1.commit();
              return res.json({
                status: "success",
                message:
                  "PPR created successfully..<br/>TxnID : #" + transactionCode,
                success: true,
              });
            }
          } else {
            t1.rollback();
            return res.json({
              status: "error",
              message:
                "PPR due date couldn't be other than DD-MM-YYYY OR left blank",
              success: false,
            });
          }
        } else {
          t1.rollback();
          return res.json({
            status: "error",
            message:
              "an error while handling your request (2), contact system administrator..",
            success: false,
          });
        }
      } else {
        t1.rollback();
        return res.json({
          message:
            "an error while executing your request (1), contact system administrator..",
          success: false,
          status: "error",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// Fetch PPR data for update
router.post("/fetchData4Update", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    ppr: "required",
    skucode: "required",
  });

  const { ppr, sku, access } = req.body;

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Validation failed",
    });
  }

  try {
    const stmt = await invtDB.query(
      "SELECT `mfg_production_1`.*, `project_master`.`project_name`, `project_master`.`project_description`, `units`.`units_name`, `products`.`p_name`, `bom_recipe`.`subject_name`, `location_main`.`loc_name` FROM `mfg_production_1` LEFT JOIN `products` ON `mfg_production_1`.`prod_product_sku` = `products`.`p_sku` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `bom_recipe` ON `mfg_production_1`.`prod_bom_subject` = `bom_recipe`.`subject_id` LEFT JOIN `project_master` ON `project_master`.`project_name` = `mfg_production_1`.`prod_project` LEFT JOIN `location_main` ON `location_main`.`location_key` = `mfg_production_1`.`prod_location` WHERE `mfg_production_1`.`prod_transaction` = :ppr AND `mfg_production_1`.`prod_product_sku` = :sku AND `mfg_production_1`.`prod_branch` = :branch",
      {
        replacements: {
          ppr: req.body.ppr,
          sku: req.body.skucode,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      if (stmt[0].phase1_status == "C") {
        res.json({
          status: "error",
          success: false,
          message: "PPR has been closed therefore it can't be update",
        });
        return;
      } else {
        let checkPPRStatus = await invtDB.query(
          "SELECT * FROM `mfg_production_2` WHERE `mfg_ref_id` = :ppr AND `mfg_sku` = :sku GROUP BY `mfg_ref_id`",
          {
            replacements: { ppr: req.body.ppr, sku: req.body.skucode },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (checkPPRStatus > 0) {
          res.json({
            status: "error",
            success: false,
            message: "PPR has been opened therefore it can't be update...",
          });
          return;
        }

        res.json({
          success: true,
          status: "success",
          data: {
            product: {
              sku: {
                id: stmt[0].prod_product_sku,
                text: "(" + stmt[0].prod_product_sku + ") " + stmt[0].p_name,
              },
              bom: { id: stmt[0].prod_bom_subject, text: stmt[0].subject_name },
              uom: stmt[0].units_name,
              qty: stmt[0].prod_planned_qty,
              duedate: stmt[0].prod_due_date,
              section: { id: stmt[0].prod_location, text: stmt[0].loc_name },
              rqd: stmt[0].prod_rqd_status,
              customer: stmt[0].prod_customer_name,
            },
            type: stmt[0].prod_type,
            project: { id: stmt[0].project_name, text: stmt[0].project_name },
            project_description: stmt[0].project_description,
            remark: stmt[0].prod_comment,
          },
        });
        return;
      }
    } else {
      res.json({
        status: "error",
        success: false,
        message: "PPR not found for update",
      });
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET ALL BOM COMPONENT INSIDE THE RQD BOM
router.post("/fetchRQDBom", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    sku: "required",
    bom: "required",
    qty: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }
  try {
    let stmt1;
    if (req.body.rqd == "E") {
      let stmt0 = await otherDB.query(
        "SELECT * FROM `invt_projects` WHERE project_ppr_no = :ppr AND project_ppr_sku = :sku AND project_ppr_bom = :bom",
        {
          replacements: {
            ppr: req.body.ppr,
            sku: req.body.sku,
            bom: req.body.bom,
          },
          type: otherDB.QueryTypes.SELECT,
        }
      );
      if (stmt0.length == 0) {
        return res.json({
          status: "error",
          success: false,
          message: "Invalid Project BOM requirement configured",
        });
      }
      stmt0 = await otherDB.query(
        `SELECT A.c_part_no, A.c_name, A.component_key, B.project_ppr_sku, B.project_rm_category, B.project_rate, B.project_requirement, B.project_ppr_bom_qty, C.units_name FROM ${global.ims_db_name}.components A JOIN ${global.other_db_name}.invt_projects B ON A.component_key = B.project_rm JOIN ${global.ims_db_name}.units C ON A.c_uom = C.units_id WHERE B.project_ppr_no = :ppr AND B.project_ppr_sku = :sku AND B.project_ppr_bom = :bom`,
        {
          replacements: {
            ppr: req.body.ppr,
            sku: req.body.sku,
            bom: req.body.bom,
          },
          type: otherDB.QueryTypes.SELECT,
        }
      );
      if (stmt0.length > 0) {
        let result = [];
        for (let i = 0; i < stmt0.length; i++) {
          stmt1 = await invtDB.query(
            `SELECT COALESCE(SUM(P.po_order_qty), 0) totalReq_Qty, COALESCE(SUM(P.po_inward_qty), 0) Inward FROM ${global.other_db_name}.invt_projects I LEFT JOIN ${global.ims_db_name}.po_purchase_req P ON I.project_rm = P.po_part_no WHERE I.project_ppr_bom = :subject_id AND I.project_ppr_sku = :sku AND I.project_rm = :component`,
            {
              replacements: {
                subject_id: req.body.bom,
                component: stmt0[i].component_key,
                sku: stmt0[0].project_ppr_sku,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let order, inward;
          if (stmt1.length > 0) {
            (order = stmt1[0].totalReq_Qty), (inward = stmt1[0].Inward);
          } else {
            order = 0;
            inward = 0;
          }

          // GET closing Stock
          let location_key = "2023112717950595";

          // RM Store STOCK LOCATION
          let stmt_get_rm = await invtDB.query(
            "SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key",
            {
              replacements: { location_key: location_key },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let all_rm_location = [];
          if (stmt_get_rm.length > 0) {
            for (let loc_i = 0; loc_i < stmt_get_rm.length; loc_i++) {
              all_rm_location = stmt_get_rm[loc_i].locations.split(",");
            }
          }

          // ALL INWARD
          let stmt2 = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_in` IN (:location)",
            {
              replacements: {
                component: stmt0[i].component_key,
                location: all_rm_location,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let inward_all_qty;
          if (stmt2.length > 0) {
            inward_all_qty = helper.number(stmt2[0].Inward);
          } else {
            inward_all_qty = 0;
          }

          // ALL OUTWARD
          let outward_all_qty;
          let stmt3 = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_out` IN (:location)",
            {
              replacements: {
                component: stmt0[i].component_key,
                location: all_rm_location,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt3.length > 0) {
            outward_all_qty = helper.number(stmt3[0].Outward);
          } else {
            outward_all_qty = 0;
          }

          result.push({
            serial: i + 1,
            part: stmt0[i].c_part_no,
            name: stmt0[i].c_name,
            category: stmt0[i].project_rm_category,
            qty: stmt0[i].project_requirement,
            component: stmt0[i].component_key,
            uom: stmt0[i].units_name,
            rate: stmt0[i].project_rate,
            bomqty: stmt0[i].project_ppr_bom_qty,
            popendingqty: helper.number(order - inward),
            branchstock: helper.number(inward_all_qty - outward_all_qty),
          });
        }
        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: result,
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "no components were found",
        });
      }
    } else if (req.body.rqd == "D") {
      async function getChildBomComponent(sku, qty) {
        let child_comps = [];

        let stmt2 = await invtDB.query(
          "SELECT `bom_quantity`.`qty`, `bom_quantity`.`bom_catergory`, `components`.`component_key`, `components`.`c_part_no`, `components`.`c_name`, `units`.`units_name` FROM `bom_quantity` LEFT JOIN `components` ON `components`.`component_key` = `bom_quantity`.`component_id` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `bom_quantity`.`product_sku` = :product_sku AND( `bom_quantity`.`bom_status` = 'A' OR `bom_quantity`.`bom_status` = 'ALT')",
          {
            replacements: { product_sku: sku },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt2.length > 0) {
          let stmt3;
          for (let i = 0; i < stmt2.length; i++) {
            stmt3 = await invtDB.query(
              "SELECT COALESCE( SUM(`po_order_qty`), 0 ) `totalReq_Qty`, COALESCE( SUM(`po_inward_qty`), 0 ) `Inward` FROM `po_purchase_req` WHERE `po_part_no` = :component AND `po_pending_qty` != 0",
              {
                replacements: { component: stmt2[i].component_key },
                type: invtDB.QueryTypes.SELECT,
              }
            );
            let order, inward;
            if (stmt3.length > 0) {
              (order = stmt3[0].totalReq_Qty), (inward = stmt3[0].Inward);
            } else {
              order = 0;
              inward = 0;
            }

            // GET closing Stock
            let location_key = "2023112717950595";

            // RM Store STOCK LOCATION
            let stmt_get_rm = await invtDB.query(
              "SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key",
              {
                replacements: { location_key: location_key },
                type: invtDB.QueryTypes.SELECT,
              }
            );

            let all_rm_location = [];
            if (stmt_get_rm.length > 0) {
              for (let loc_i = 0; loc_i < stmt_get_rm.length; loc_i++) {
                all_rm_location = stmt_get_rm[loc_i].locations.split(",");
              }
            }

            // ALL INWARD
            let stmt4 = await invtDB.query(
              "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_in` IN (:location)",
              {
                replacements: {
                  component: stmt2[i].component_key,
                  location: all_rm_location,
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );
            let inward_all_qty;
            if (stmt4.length > 0) {
              inward_all_qty = helper.number(stmt4[0].Inward);
            } else {
              inward_all_qty = 0;
            }

            // ALL OUTWARD
            let outward_all_qty;
            let stmt5 = await invtDB.query(
              "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_out` IN (:location)",
              {
                replacements: {
                  component: stmt2[i].component_key,
                  location: all_rm_location,
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );
            if (stmt5.length > 0) {
              outward_all_qty = helper.number(stmt5[0].Outward);
            } else {
              outward_all_qty = 0;
            }

            childBoms.push({
              //serial: i + 1,
              part: stmt2[i].c_part_no,
              name: stmt2[i].c_name,
              qty: stmt2[i].qty * req.body.qty * qty,
              category: stmt2[i].bom_catergory,
              component: stmt2[i].component_key,
              uom: stmt2[i].units_name,
              rate: "0",
              bomqty: stmt2[i].qty,
              popendingqty: helper.number(order - inward),
              branchstock: helper.number(inward_all_qty - outward_all_qty),
            });

            child_comps.push(stmt2[i].c_part_no);

            if (stmt2.length - 1 == i) {
              for (let j = 0; j < child_comps.length; j++) {
                await getChildBomComponent(child_comps[j], stmt2[i].qty);
              }
            }
          }
        }
      }

      stmt1 = await invtDB.query(
        "SELECT `bom_quantity`.`qty`, `bom_quantity`.`bom_catergory`, `components`.`component_key`, `components`.`c_part_no`, `components`.`c_name`, `units`.`units_name` FROM `bom_quantity` LEFT JOIN `components` ON `components`.`component_key` = `bom_quantity`.`component_id` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `bom_quantity`.`subject_under` = :subject_id AND( `bom_quantity`.`bom_status` = 'A' OR `bom_quantity`.`bom_status` = 'ALT')",
        {
          replacements: { subject_id: req.body.bom },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let result = [];
      let childBoms = [];

      if (stmt1.length > 0) {
        let stmt0;
        for (let i = 0; i < stmt1.length; i++) {
          stmt0 = await invtDB.query(
            "SELECT COALESCE( SUM(`po_order_qty`), 0 ) `totalReq_Qty`, COALESCE( SUM(`po_inward_qty`), 0 ) `Inward` FROM `po_purchase_req` WHERE `po_part_no` = :component AND `po_pending_qty` != 0",
            {
              replacements: { component: stmt1[i].component_key },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let order, inward;
          if (stmt0.length > 0) {
            (order = stmt0[0].totalReq_Qty), (inward = stmt0[0].Inward);
          } else {
            order = 0;
            inward = 0;
          }

          // GET closing Stock
          let location_key = "2023112717950595";

          // RM Store STOCK LOCATION
          let stmt_get_rm = await invtDB.query(
            "SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key",
            {
              replacements: { location_key: location_key },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let all_rm_location = [];
          if (stmt_get_rm.length > 0) {
            for (let loc_i = 0; loc_i < stmt_get_rm.length; loc_i++) {
              all_rm_location = stmt_get_rm[loc_i].locations.split(",");
            }
          }

          // ALL INWARD
          let stmt2 = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_in` IN (:location)",
            {
              replacements: {
                component: stmt1[i].component_key,
                location: all_rm_location,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let inward_all_qty;
          if (stmt2.length > 0) {
            inward_all_qty = helper.number(stmt2[0].Inward);
          } else {
            inward_all_qty = 0;
          }

          // ALL OUTWARD
          let outward_all_qty;
          let stmt3 = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_out` IN (:location)",
            {
              replacements: {
                component: stmt1[i].component_key,
                location: all_rm_location,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt3.length > 0) {
            outward_all_qty = helper.number(stmt3[0].Outward);
          } else {
            outward_all_qty = 0;
          }

          result.push({
            //serial: i + 1,
            part: stmt1[i].c_part_no,
            name: stmt1[i].c_name,
            qty: stmt1[i].qty * req.body.qty,
            category: stmt1[i].bom_catergory,
            component: stmt1[i].component_key,
            uom: stmt1[i].units_name,
            rate: "0",
            bomqty: stmt1[i].qty,
            popendingqty: helper.number(order - inward),
            branchstock: helper.number(inward_all_qty - outward_all_qty),
          });

          await getChildBomComponent(stmt1[i].c_part_no, stmt1[i].qty);
        }

        const data = [...result, ...childBoms];
        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: data,
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "no component found that match the SKU BOM",
        });
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Invalid RQD status",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPDATE BOM RQD FOR PROJECT
router.post("/update_RQDBomRM", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    sku: "required",
    rqd: "required",
    ppr: "required",
    bom: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  let component_length = req.body.component.length;

  for (let i = 0; i < component_length; i++) {
    let validation = new Validator(
      {
        component: req.body.component[i],
        rate: helper.number(req.body.rate[i]),
        req_qty: helper.number(req.body.req_qty[i]),
        sku: req.body.sku,
        bom: req.body.bom,
        ppr: req.body.ppr,
      },
      {
        component: "required",
        ppr: "required",
        rate: "required",
        req_qty: "required|min:0",
        sku: "required",
        bom: "required",
      }
    );
    if (validation.fails()) {
      return res.json({
        success: false,
        message: helper.firstErrorValidatorjs(validation),
        status: "error",
      });
    }
  }

  const toFindDublicates = (arry) =>
    arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(req.body.component);
  if (dubliEle.length > 0) {
    res.json({
      success: false,
      message:
        "You have supplied a same component twice of time in a single request",
      status: "error",
    });
    return;
  }

  const t1 = await invtDB.transaction();
  const t2 = await otherDB.transaction();

  try {
    let stmt1 = await otherDB.query(
      "SELECT *  FROM `invt_projects` WHERE `project_ppr_no` = :ppr AND `project_ppr_sku` = :sku AND project_ppr_bom = :bom",
      {
        replacements: {
          ppr: req.body.ppr,
          sku: req.body.sku,
          bom: req.body.bom,
        },
        type: otherDB.QueryTypes.SELECT,
      }
    );
    let stmt2;
    if (stmt1.length == 0) {
      let bom1, sku1;

      //Check child BOM
      for (let i = 0; i < component_length; i++) {
        let get_partno = await invtDB.query(
          "SELECT c_part_no FROM components WHERE component_key = :key",
          {
            replacements: { key: req.body.component[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let getchild_bom = await invtDB.query(
          "SELECT subject_under, product_sku FROM bom_quantity WHERE product_sku = :sku",
          {
            replacements: { sku: get_partno[0].c_part_no },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (getchild_bom.length > 0) {
          (bom1 = getchild_bom[0].subject_under),
            (sku1 = getchild_bom[0].product_sku);
          break;
        } else {
          continue;
        }
      }

      // INSERT QUERY
      for (let i = 0; i < component_length; i++) {
        if (
          String(req.body.req_qty[i]).trim() !== "" &&
          helper.number(req.body.req_qty[i]) > 0
        ) {
          let getBOMQty = await invtDB.query(
            "SELECT `qty` FROM `bom_quantity` WHERE `subject_under` = :bom AND `product_sku` = :sku AND `component_id` = :component",
            {
              replacements: {
                bom: req.body.bom,
                sku: req.body.sku,
                component: req.body.component[i],
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let bom_qty;

          if (getBOMQty.length == 0) {
            let getBOMQty2 = await invtDB.query(
              "SELECT `qty` FROM `bom_quantity` WHERE `subject_under` = :bom AND `product_sku` = :sku AND `component_id` = :component",
              {
                replacements: {
                  bom: bom1,
                  sku: sku1,
                  component: req.body.component[i],
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );

            if (getBOMQty2.length > 0) {
              bom_qty = getBOMQty2[0].qty;
            } else {
              t1.rollback();
              t2.rollback();
              return res.json({
                success: false,
                message: "component not mapped with the BOM you have selected",
                status: "error",
              });
            }
          } else {
            bom_qty = getBOMQty[0].qty;
          }

          stmt2 = await otherDB.query(
            "INSERT INTO `invt_projects` (project_name, project_ppr_no, project_ppr_sku, project_ppr_bom, project_rm_category, project_ppr_ord_qty, project_ppr_bom_qty, project_rm, project_rate, project_requirement, project_insert_by, project_insert_dt, status)VALUES (:project_name, :ppr, :sku, :bom, :category, :ppr_qty, :bom_qty, :component, :rate, :req_qty, :insert_by, :insert_dt, 'S')",
            {
              replacements: {
                project_name: req.body.project_name,
                ppr: req.body.ppr,
                sku: req.body.sku,
                bom: req.body.bom,
                category: req.body.category[i],
                ppr_qty: req.body.ppr_qty,
                bom_qty: bom_qty,
                component: req.body.component[i],
                rate: req.body.rate[i],
                req_qty: req.body.req_qty[i],
                insert_by: req.logedINUser,
                insert_dt: moment(new Date())
                  .tz("Asia/Kolkata")
                  .format("YYYY-MM-DD HH:mm:ss"),
              },
              type: otherDB.QueryTypes.INSERT,
              transaction: t2,
            }
          );
        }
      }
    } else {
      // UPDATE QUERY
      for (let i = 0; i < component_length; i++) {
        if (helper.number(req.body.req_qty[i]) !== "") {
          stmt2 = await otherDB.query(
            "UPDATE `invt_projects` SET `project_rm_category` = :category, `project_ppr_ord_qty` = :ord_qty, `project_requirement` = :req_qty, `project_rate` = :rate WHERE project_rm = :component AND project_ppr_no = :ppr AND project_ppr_sku = :sku AND project_ppr_bom = :bom",
            {
              replacements: {
                category: req.body.category[i],
                ord_qty: req.body.ppr_qty,
                rate: req.body.rate[i],
                req_qty: req.body.req_qty[i],
                component: req.body.component[i],
                ppr: req.body.ppr,
                sku: req.body.sku,
                bom: req.body.bom,
              },
              type: otherDB.QueryTypes.UPDATE,
              transaction: t2,
            }
          );
        }
      }
    }

    let updatePPR = await invtDB.query(
      "UPDATE `mfg_production_1` SET `prod_rqd_status` = :status WHERE `prod_product_sku` = :sku AND `prod_bom_subject` = :bom AND `prod_transaction` = :ppr",
      {
        replacements: {
          status: "E",
          ppr: req.body.ppr,
          sku: req.body.sku,
          bom: req.body.bom,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: t1,
      }
    );
    if (updatePPR.length == 0) {
      t1.rollback();
      t2.rollback();
      return res.json({
        success: false,
        message:
          "an error while updating PPR RQD status, contact system administrator..",
        status: "error",
      });
    }
    t1.commit();
    t2.commit();
    return res.json({
      success: true,
      message: "RQD Updated",
      status: "success",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPDATE PPR
router.post("/updatePPR", [auth.isAuthorized], async (req, res) => {
  var header = req.body.header;
  var ppr = req.body.ppr;

  let validation_header = new Validator(
    {
      ppr: header.ppr,
      type: header.type,
    },
    {
      ppr: "required",
      type: "required",
    }
  );
  if (validation_header.fails()) {
    res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation_header),
    });
    return;
  }

  let validation_ppr = new Validator(
    {
      sku: ppr.sku,
      bom: ppr.bom,
      qty: ppr.qty,
    },
    {
      sku: "required",
      bom: "required",
      qty: "required|min:1",
    }
  );
  if (validation_ppr.fails()) {
    res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation_ppr),
    });
    return;
  }

  const t1 = await invtDB.transaction(),
    t2 = await otherDB.transaction();

  try {
    if (header.project == "") {
      t1.rollback();
      t2.rollback();
      return res.json({
        status: "error",
        message: "w.e.f 12-Dec-2022, Project ID is mandatory to update PPR",
        success: false,
      });
    }
    const stmt = await invtDB.query(
      "SELECT * FROM `mfg_production_1` WHERE `prod_transaction` = :ppr AND `prod_product_sku` = :sku AND `prod_branch` = :branch GROUP BY prod_transaction",
      {
        replacements: {
          ppr: header.ppr,
          sku: ppr.sku,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      if (stmt[0].phase1_status == "C") {
        t1.rollback();
        t2.rollback();
        res.json({
          status: "error",
          success: false,
          message: "PPR has been closed therefore it can't be update",
        });
        return;
      } else if (
        stmt[0].prod_rqd_status == "E" &&
        ppr.sku != stmt[0].prod_product_sku &&
        ppr.bom != stmt[0].prod_bom_subject
      ) {
        t1.rollback();
        t2.rollback();
        res.json({
          status: "error",
          success: false,
          message:
            "RQD has been finalized for the SKU therefore it can't be update in other SKU",
        });
        return;
      }

      let updateInvt = await invtDB.query(
        "UPDATE mfg_production_1 SET prod_product_sku = :sku, prod_bom_subject = :bom, prod_customer_name = :customer, prod_planned_qty = :qty, prod_project = :project, prod_type = :type, prod_comment = :remark, prod_due_date = :duedate WHERE prod_transaction = :transaction",
        {
          replacements: {
            sku: ppr.sku,
            bom: ppr.bom,
            customer: ppr.customer,
            qty: ppr.qty,
            project: header.project,
            type: header.type,
            transaction: header.ppr,
            remark: header.remark,
            duedate: ppr.duedate,
          },
          type: invtDB.QueryTypes.UPDATE,
          transaction: t1,
        }
      );
      if (updateInvt.length > 0) {
        if (stmt[0].prod_rqd_status == "E") {
          let updateOther = await otherDB.query(
            "UPDATE `invt_projects` SET `project_ppr_ord_qty` = :ppr_qty, `project_name` = :project WHERE `project_ppr_no` = :ppr AND `project_ppr_sku` = :sku",
            {
              replacements: {
                project: header.project,
                sku: ppr.sku,
                ppr: header.ppr,
                ppr_qty: ppr.qty,
              },
              type: otherDB.QueryTypes.UPDATE,
              transaction: t2,
            }
          );
          if (updateOther.length > 0) {
            t1.commit();
            t2.commit();
            return res.json({
              status: "success",
              success: true,
              message: "PPR updated with RQD has been successfully",
            });
          } else {
            t1.rollback();
            t2.rollback();
            return res.json({
              status: "error",
              success: false,
              message: "an error occured while updating PPR with RQD",
            });
          }
        } else {
          t1.commit();
          t2.rollback();
          return res.json({
            status: "success",
            success: true,
            message: "PPR updated without RQD has been successfully",
          });
        }
      } else {
        t1.rollback();
        t2.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "an error occured while updating PPR",
        });
      }
    } else {
      t1.rollback();
      t2.rollback();
      res.json({
        status: "error",
        success: false,
        message: "PPR not found for update",
      });
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// CLOSE PPR
router.post("/closePPR", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    sku: "required",
    ppr: "required",
    remark: "required",
  });

  const { sku, ppr, remark } = req.body;

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  const t1 = await invtDB.transaction(),
    t2 = await otherDB.transaction();

  try {
    let stmt = await invtDB.query(
      "SELECT * FROM `mfg_production_1` WHERE `prod_transaction` = :transaction AND `prod_product_sku` = :sku AND `mfg_production_1`.`prod_branch` = :branch",
      {
        replacements: {
          sku: sku,
          transaction: ppr,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      if (stmt[0].phase1_status == "C") {
        t1.commit();
        t2.commit();
        return res.json({
          success: false,
          status: "error",
          message: "PPR already closed",
        });
      } else {
        let update_stmt = await invtDB.query(
          "UPDATE `mfg_production_1` SET `phase1_status` = 'C', `cancellation_remark` = :remark WHERE `prod_transaction` = :transaction AND `prod_product_sku` = :sku",
          {
            replacements: {
              sku: sku,
              transaction: ppr,
              remark:
                remark +
                " @ " +
                moment().format("DD-MM-YYYY HH:mm:ss") +
                " BY: " +
                req.logedINUser,
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: t1,
          }
        );
        if (update_stmt.length > 0) {
          if (stmt[0].prod_rqd_status == "E") {
            let updateOther = await otherDB.query(
              "UPDATE `invt_projects` SET `status` = 'C' WHERE `project_ppr_no` = :ppr AND `project_ppr_sku` = :sku",
              {
                replacements: {
                  sku: sku,
                  ppr: ppr,
                  status: "C",
                },
                type: otherDB.QueryTypes.UPDATE,
                transaction: t2,
              }
            );
            if (updateOther.length > 0) {
              t1.commit();
              t2.commit();
              return res.json({
                status: "success",
                success: true,
                message: "PPR & RQD Closed",
              });
            } else {
              t1.rollback();
              t2.rollback();
              return res.json({
                status: "error",
                success: false,
                message: "an error occured while updating PPR with RQD",
              });
            }
          } else {
            t1.commit();
            t2.rollback();
            return res.json({
              success: true,
              status: "success",
              message: "PPR Closed",
            });
          }
        } else {
          t1.rollback();
          t2.rollback();
          return res.json({
            success: false,
            status: "error",
            message:
              "unable to close the PPR due to some technical issue - contact developer...",
          });
        }
      }
    } else {
      t1.rollback();
      t2.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "something happend really wrong - contact developer",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Add BOM OUT DATA
router.post(
  "/executePPR",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    let validation = new Validator(req.body, {
      sku: "required",
      ppr: "required",
      mfg_qty: "required",
      sending_location: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    const t1 = await invtDB.transaction(),
      t2 = await otherDB.transaction();

    try {
      if (req.body.mfg_qty < 1) {
        return res.json({
          success: false,
          status: "error",
          message: "zero value not acceptable",
        });
      }

      let stmt = await invtDB.query(
        "SELECT `mfg_production_1`.`ppr_randomcode`,`mfg_production_1`.`prod_transaction`, `mfg_production_1`.`prod_planned_qty`, `bom_quantity`.`product_sku` , mfg_production_1.prod_executed_qty FROM `bom_quantity` LEFT JOIN `bom_recipe` ON `bom_quantity`.`subject_under` = `bom_recipe`.`subject_id` LEFT JOIN `mfg_production_1` ON `bom_quantity`.`product_sku` = `mfg_production_1`.`prod_product_sku` LEFT JOIN location_main ON mfg_production_1.prod_location = location_main.location_key WHERE `bom_quantity`.`product_sku` = :sku AND `mfg_production_1`.`prod_transaction` = :ppr AND `mfg_production_1`.`prod_branch` = :branch GROUP BY `bom_recipe`.`subject_name` ORDER BY `bom_recipe`.`subject_name` ASC",
        {
          replacements: {
            sku: req.body.sku,
            ppr: req.body.ppr,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let MaxConsumptQtyis = 0;
      if (stmt.length > 0) {
        // let stmt0 = await invtDB.query("SELECT COALESCE(SUM(`mfg_prod_planing_qty`),0) AS totalYetConsupted, `mfg_sku`,`mfg_ref_id` FROM mfg_production_2 WHERE `mfg_sku` = :sku AND `mfg_ref_id` = :ppr AND mfg_production_2.mfg_prod_type = 'C'", {
        //   replacements: {
        //     sku: req.body.sku,
        //     ppr: req.body.ppr,
        //   },
        //   type: invtDB.QueryTypes.SELECT,
        //   transaction: t1
        // });
        // if (stmt0.length > 0) {
        // MaxConsumptQtyis = helper.number(stmt[0].prod_planned_qty) - helper.number(stmt0[0].totalYetConsupted);
        MaxConsumptQtyis =
          helper.number(stmt[0].prod_planned_qty) -
          helper.number(stmt[0].prod_executed_qty);
        if (helper.number(MaxConsumptQtyis) < helper.number(req.body.mfg_qty)) {
          t1.rollback();
          t2.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "executing QTY is can't be accept",
          });
        }
        // }
      } else {
        t1.rollback();
        t2.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "something happed wrong, contact to system administrator",
        });
      }

      let stmt1 = await invtDB.query(
        "SELECT * FROM `mfg_production_1` WHERE `prod_transaction` = :ppr AND `prod_product_sku` = :sku AND `phase1_status` = 'A' AND `mfg_production_1`.`prod_branch` = :branch",
        {
          replacements: {
            sku: req.body.sku,
            ppr: req.body.ppr,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
          transaction: t1,
        }
      );

      if (stmt1.length > 0) {
        let mfg_transaction = await helper.genTransaction("MFG", t1);

        let stmt3 = await invtDB.query(
          "SELECT * FROM `mfg_production_2` WHERE `mfg_ref_id` = :ppr AND `mfg_sku` = :sku ORDER BY ID DESC LIMIT 1",
          {
            replacements: {
              ppr: stmt1[0].prod_transaction,
              sku: stmt1[0].prod_product_sku,
            },
            type: invtDB.QueryTypes.SELECT,
            transaction: t1,
          }
        );

        let stepcount;
        if (stmt3.length > 0) {
          stepcount = helper.number(stmt3[0].step_count) + 1;
        } else {
          stepcount = 1;
        }

        let pprcreatedBY;
        let stmt4 = await invtDB.query(
          "SELECT * FROM `mfg_production_1` WHERE `prod_product_sku` = :sku AND `prod_transaction` = :ppr ORDER BY ID DESC LIMIT 1",
          {
            replacements: {
              ppr: stmt1[0].prod_transaction,
              sku: stmt1[0].prod_product_sku,
            },
            type: invtDB.QueryTypes.SELECT,
            transaction: t1,
          }
        );
        if (stmt4.length > 0) {
          pprcreatedBY = stmt4[0].prod_inserted_by;
        } else {
          pprcreatedBY = "CRN103522";
        }

        let insertDate = moment(new Date())
          .tz("Asia/Kolkata")
          .format("YYYY-MM-DD HH:mm:ss");

        let stmt5 = await invtDB.query(
          "INSERT INTO `mfg_production_2` (`company_branch`,`mfg_prod_planing_qty`,`mfg_sku`,`mfg_send_location`,`mfg_con_location`,`mfg_comment`,`mfg_insert_date`,`mfg_full_date`,`mfg_approved_by`,`mfg_transaction`,`mfg_ref_id`,`step_count`,`mfg_prod_type`,`mfg_ppr_created_by`) VALUES (:branch,:mfgqty,:sku,:sendLoc,:conLoc,:comment,:insertdate,:fulldate,:by,:transaction,:ppr,:count,:type,:pprinsertedby)",
          {
            replacements: {
              branch: req.branch,
              mfgqty: req.body.mfg_qty,
              sku: stmt1[0].prod_product_sku,
              sendLoc: req.body.sending_location,
              conLoc: req.body.con_location,
              comment: req.body.comment,
              insertdate: insertDate,
              fulldate: insertDate,
              by: req.logedINUser,
              transaction: mfg_transaction,
              ppr: stmt1[0].prod_transaction,
              count: stepcount,
              type: "C",
              pprinsertedby: pprcreatedBY,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: t1,
          }
        );
        if (stmt5.length > 0) {
          let itemLength = req.body.component.length;
          if (itemLength == 0) {
            t1.rollback();
            t2.rollback();
            return res.json({
              success: false,
              message:
                "some are the component(s) are really required to create a new FG",
              status: "error",
            });
          }

          // Track weighted rates for calculating FG rate
          let totalWeightedCost = 0;

          for (let i = 0; i < req.body.component.length; i++) {
            if (
              helper.number(req.body.con_qty[i]) > 0 &&
              String(req.body.con_qty[i]).trim() !== ""
            ) {
              // GET BOM QTY AT THE TIME OF MFG
              const stmt_bom_qty = await invtDB.query(
                "SELECT * FROM bom_quantity WHERE subject_under = :bom AND component_id = :comp",
                {
                  replacements: {
                    bom: stmt4[0].prod_bom_subject,
                    comp: req.body.component[i],
                  },
                  type: invtDB.QueryTypes.SELECT,
                }
              );

              // Calculate weighted purchase rate at the time of consumption
              let componentWeightedRate = 0;
              try {
                const consumptionDate = moment(insertDate).format("YYYY-MM-DD HH:mm:ss");
                componentWeightedRate = await require("../../../helper/utils/avgRate").getWeightedPurchaseRate(
                  req.body.component[i],
                  consumptionDate
                );
                // Use exact value as returned, no conversion
                componentWeightedRate = componentWeightedRate || 0;
              } catch (e) {
                console.log("Error calculating weighted purchase rate for component:", req.body.component[i], e);
                componentWeightedRate = 0;
              }

              // Check if component has RFP partcode - ignore for weighted rate calculation
              const componentCheck = await invtDB.query(
                "SELECT c_new_part_no FROM components WHERE component_key = :component_key",
                {
                  replacements: { component_key: req.body.component[i] },
                  type: invtDB.QueryTypes.SELECT,
                }
              );

              // Skip RFP components from weighted rate calculation
              const isRFP = componentCheck.length > 0 && componentCheck[0].c_new_part_no && componentCheck[0].c_new_part_no.includes('RFP');

              // Calculate weighted cost: cons_qty × weighted_rate (only consumed qty, not reject)
              // Only for non-RFP components
              if (!isRFP) {
                const cons_qty = req.body.con_qty[i] || 0; // Only consumed qty, not reject
                const weightedCost = cons_qty * componentWeightedRate;
                totalWeightedCost += weightedCost;
              }

              let comp_stmt = await invtDB.query(
                "INSERT INTO `rm_location` (`company_branch`,`trans_type`,`components_id`,`qty`,`other_qty` , mfg_bom_qty ,`loc_out`,`insert_date`,`insert_by`,`mfg_ppr_trans_id_1`,`mfg_ppr_trans_id_2`,`mfg_step_count`,`bom_subject_id`,`any_remark`,`in_po_rate`) VALUES(:branch, 'CONSUMPTION', :component, :qty, :other_qty, :bom_qty, :loc_out, :insert_date, :insert_by, :mfg_id_1, :mfg_id_2, :step_count, :subject, :remark, :weighted_rate)",
                {
                  replacements: {
                    branch: req.branch,
                    component: req.body.component[i],
                    qty: req.body.con_qty[i],
                    other_qty: req.body.reject[i],
                    bom_qty: stmt_bom_qty[0].qty,
                    loc_out: req.body.sending_location,
                    insert_date: insertDate,
                    insert_by: req.logedINUser,
                    mfg_id_1: stmt1[0].prod_transaction,
                    mfg_id_2: mfg_transaction,
                    step_count: stepcount,
                    subject: stmt1[0].prod_bom_subject,
                    remark: req.body.remark[i],
                    weighted_rate: componentWeightedRate,
                  },
                  type: invtDB.QueryTypes.INSERT,
                  transaction: t1,
                }
              );

              // ALL INWARD
              let component_qty_yet_in_location;
              let stmt6 = await invtDB.query(
                "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :location AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER')",
                {
                  replacements: {
                    component: req.body.component[i],
                    location: req.body.sending_location,
                    branch: req.branch,
                  },
                  type: invtDB.QueryTypes.SELECT,
                }
              );
              if (stmt6.length > 0) {
                component_qty_yet_in_location = helper.number(stmt6[0].Inward);
              } else {
                component_qty_yet_in_location = 0;
              }

              // ALL OUTWARD
              let component_qty_yet_out_location;
              let stmt7 = await invtDB.query(
                "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND `loc_out` = :location AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER')",
                {
                  replacements: {
                    component: req.body.component[i],
                    location: req.body.sending_location,
                    branch: req.branch,
                  },
                  type: invtDB.QueryTypes.SELECT,
                }
              );
              if (stmt7.length > 0) {
                component_qty_yet_out_location = helper.number(
                  stmt7[0].Outward
                );
              } else {
                component_qty_yet_out_location = 0;
              }

              if (
                helper.number(
                  component_qty_yet_in_location - component_qty_yet_out_location
                ) >= helper.number(req.body.con_qty[i] + req.body.reject[i])
              ) {
                if (stmt1[0].prod_rqd_status == "E") {
                  let selectRQD = await otherDB.query(
                    "SELECT * FROM invt_projects WHERE `project_ppr_no` = :ppr AND project_ppr_sku = :sku AND project_rm = :component",
                    {
                      replacements: {
                        ppr: req.body.ppr,
                        sku: req.body.sku,
                        component: req.body.component[i],
                      },
                      type: otherDB.QueryTypes.SELECT,
                    }
                  );
                  if (selectRQD.length > 0) {
                    let updatePPR;
                    for (let j = 0; j < selectRQD.length; j++) {
                      updatePPR = await otherDB.query(
                        "UPDATE invt_projects SET executed_qty = :executed_qty WHERE project_ppr_no = :ppr AND project_rm = :component",
                        {
                          replacements: {
                            ppr: req.body.ppr,
                            component: selectRQD[j].project_rm,
                            executed_qty: helper.number(
                              (helper.number(stmt1[0].prod_executed_qty) +
                                helper.number(req.body.mfg_qty)) *
                                helper.number(selectRQD[j].project_ppr_bom_qty)
                            ),
                          },
                          type: otherDB.QueryTypes.UPDATE,
                          transaction: t2,
                        }
                      );
                    }
                    if (updatePPR.length == 0) {
                      await t2.rollback();
                      return res.json({
                        success: false,
                        message:
                          "an error occured while updating component(s) information in RQD",
                        status: "error",
                      });
                    }
                  }
                }
              } else {
                t1.rollback();
                t2.rollback();
                return res.json({
                  success: false,
                  message:
                    component_qty_yet_in_location +
                    "-" +
                    component_qty_yet_out_location +
                    " = " +
                    req.body.component[i] +
                    " attension: some of the component are not avaiable at the pick location",
                  status: "error",
                });
              }
            }
          }

          // Calculate FG Weighted Purchase Rate: Σ(cons_qty × weighted_rate) ÷ FG_qty
          const fg_qty = req.body.mfg_qty || 0;
          const calculatedFG_Rate = fg_qty > 0 ? totalWeightedCost / fg_qty : 0;

          // Update mfg_production_2 with calculated in_fg_rate
          await invtDB.query(
            "UPDATE `mfg_production_2` SET `in_fg_rate` = :fg_rate WHERE `mfg_transaction` = :mfg_transaction AND `mfg_ref_id` = :ppr AND `company_branch` = :branch",
            {
              replacements: {
                fg_rate: calculatedFG_Rate,
                mfg_transaction: mfg_transaction,
                ppr: stmt1[0].prod_transaction,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: t1,
            }
          );

          let stmt8 = await invtDB.query(
            "UPDATE `mfg_production_1` SET `prod_executed_qty`= prod_executed_qty + :execute_qty WHERE `prod_product_sku` = :skucode AND `prod_transaction` = :ppr",
            {
              replacements: {
                execute_qty: req.body.mfg_qty,
                skucode: req.body.sku,
                ppr: req.body.ppr,
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: t1,
            }
          );
          if (stmt8.length > 0) {
            t1.commit();
            t2.commit();
            return res.json({
              success: true,
              status: "success",
              message: `Request Saved..<br/>transaction ref ID [&#35; ${mfg_transaction} . ]`,
            });
          } else {
            t1.rollback();
            t2.rollback();
            return res.json({
              success: false,
              status: "error",
              message: "an error occured while updating your request",
            });
          }
        } else {
          t1.rollback();
          t2.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "an error occured while executing your request",
          });
        }
      } else {
        t1.rollback();
        t2.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "PPR already closed therefore it can't proceed",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// GET PPR LOCATIONS
router.get("/locations", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT loc_name,location_key,loc_address FROM `location_main` WHERE (`location_key` = '1668585009820' OR `location_key` = '20220602154513' OR `location_key` = '20220602154904' OR `location_key` = '20220519163322' OR `location_key` = '202012173928' OR `location_key` = '202101150335' OR `location_key` = '20210920110257' OR `location_key` = '20210920110750' OR `location_key` = '20210910143759' OR `location_key` = '20220727171856') AND loc_status = 'ACTIVE'  ORDER BY `loc_name` ASC",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      let data = [];
      stmt.map((item) => {
        data.push({
          location_key: item.location_key,
          name: item.loc_name,
          address: item.loc_address,
        });
      });

      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: data,
      });
    } else {
      return res.json({
        status: "error",
        message: "No locations found",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET PPR SECTION LOCATIONS
router.get("/ppr_section_location", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: "2022115103752749" },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    for (let i = 0; i < loc_ids.length; i++) {
      let stmt2 = await invtDB.query(
        "SELECT loc_name,location_key,loc_address FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: loc_ids[i] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      stmt2.forEach((item) => {
        locations.push({
          location_key: item.location_key,
          name: item.loc_name,
          address: item.loc_address,
        });
      });

      if (i == loc_ids.length - 1) {
        return res.json({
          status: "success",
          success: true,
          message: "Locations fetched successfully",
          data: locations,
        });
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET MFG LOCATIONS
router.get("/mfg_locations", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: "20220212163026" },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    for (let i = 0; i < loc_ids.length; i++) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: loc_ids[i] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      stmt2.forEach((element) => {
        locations.push({ id: element.location_key, text: element.loc_name });
      });

      if (i == loc_ids.length - 1) {
        return res.json({
          status: "success",
          success: true,
          data: locations,
        });
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// CHECK LOCATION
router.post("/checkLocation", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    location_key: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      message: helper.firstErrorValidatorjs(validation),
      success: false,
    });
  }

  try {
    let stmt = await invtDB.query(
      "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
      {
        replacements: {
          location: req.body.location_key,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      return res.json({
        status: "success",
        data: {
          location_id: stmt[0].location_key,
          location_name: stmt[0].loc_name,
        },
        success: true,
      });
    } else {
      return res.json({
        status: "error",
        message: "location not found",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH PENDING PPR
router.post("/fetchPendingPpr", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    searchBy: "required",
    searchValue: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  try {
    let main_stmt;
    if (req.body.searchBy == "skuwise") {
      let stmt = await invtDB.query(
        "SELECT * FROM `products` WHERE `product_key` = :product_key",
        {
          replacements: { product_key: req.body.searchValue },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        main_stmt = await invtDB.query(
          "SELECT `mfg_production_1`.*, `admin_login`.`user_name`, `products`.`p_name`  FROM `mfg_production_1` LEFT JOIN `products` ON `mfg_production_1`.`prod_product_sku` = `products`.`p_sku` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `mfg_production_1`.`prod_inserted_by` WHERE `mfg_production_1`.`phase1_status` = 'A' AND `mfg_production_1`.`prod_product_sku` = :sku AND  `mfg_production_1`.`prod_branch` = :branch ORDER BY `mfg_production_1`.`ID` DESC",
          {
            replacements: { sku: stmt[0].p_sku, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (main_stmt.length > 0) {
          sec_process();
        } else {
          return res.json({
            status: "error",
            message: "no any records found",
            success: false,
          });
        }
      } else {
        return res.json({
          status: "error",
          message: "SKU not valid and no longer registered with us",
          success: false,
        });
      }
    } else if (req.body.searchBy == "pprtype") {
      main_stmt = await invtDB.query(
        "SELECT `mfg_production_1`.*, `admin_login`.`user_name`, `products`.`p_name`  FROM `mfg_production_1` LEFT JOIN `products` ON `mfg_production_1`.`prod_product_sku` = `products`.`p_sku`  LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `mfg_production_1`.`prod_inserted_by` WHERE `mfg_production_1`.`phase1_status` = 'A' AND `mfg_production_1`.`prod_type` = :type AND `mfg_production_1`.`prod_branch` = :branch ORDER BY `mfg_production_1`.`ID` DESC",
        {
          replacements: { type: req.body.searchValue, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (main_stmt.length > 0) {
        sec_process();
      } else {
        return res.json({
          status: "error",
          message: "no any records found",
          success: false,
        });
      }
    } else if (req.body.searchBy == "datewise") {
      let data = req.body.searchValue;
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      let date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      let date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months"
      );
      if (durationInMonths > 3) {
        return res.json({
          status: "error",
          message:
            "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          success: false,
        });
      }

      main_stmt = await invtDB.query(
        "SELECT `mfg_production_1`.*, `admin_login`.`user_name`, `products`.`p_name` FROM `mfg_production_1` LEFT JOIN `products` ON `mfg_production_1`.`prod_product_sku` = `products`.`p_sku`  LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `mfg_production_1`.`prod_inserted_by` WHERE `mfg_production_1`.`phase1_status` = 'A' AND DATE_FORMAT(`mfg_production_1`.`prod_insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `mfg_production_1`.`prod_branch` = :branch ORDER BY `mfg_production_1`.`ID` DESC",
        {
          replacements: { date1: date1, date2: date2, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (main_stmt.length > 0) {
        sec_process();
      } else {
        return res.json({
          status: "error",
          message: "no any records found",
          success: false,
        });
      }
    } else if (req.body.searchBy == "pprno") {
      main_stmt = await invtDB.query(
        "SELECT `mfg_production_1`.*, `admin_login`.`user_name`,`products`.`p_name` FROM `mfg_production_1` LEFT JOIN `products` ON `mfg_production_1`.`prod_product_sku` = `products`.`p_sku`  LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `mfg_production_1`.`prod_inserted_by` WHERE `mfg_production_1`.`phase1_status` = 'A' AND `mfg_production_1`.`prod_transaction` = :ppr AND `mfg_production_1`.`prod_branch` = :branch ORDER BY `mfg_production_1`.`ID` DESC",
        {
          replacements: { ppr: req.body.searchValue, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (main_stmt.length > 0) {
        sec_process();
      } else {
        return res.json({
          status: "error",
          message: "no any records found",
          success: false,
        });
      }
    } else {
      return res.json({
        status: "error",
        message: "Invalid search type",
        success: false,
      });
    }

    function sec_process() {
      if (main_stmt.length > 0) {
        let count = 0;
        result = [];
        let main_count = 0;
        main_stmt.map(async (item) => {
          main_count++;

          //CHECK RQD MAPPED STATUS
          let check_rqd = await otherDB.query(
            "SELECT * FROM invt_projects WHERE `project_ppr_no` = :ppr AND project_ppr_sku = :sku",
            {
              replacements: {
                ppr: item.prod_transaction,
                sku: item.prod_product_sku,
              },
              type: otherDB.QueryTypes.SELECT,
            }
          );
          let rqd_status;
          if (check_rqd.length > 0) {
            rqd_status = [
              {
                client: check_rqd[0].client_session,
                server: check_rqd[0].server_session,
              },
            ];
          } else {
            rqd_status = false;
          }

          // let stmt0 = await invtDB.query(
          //   "SELECT `admin_login`.`user_name`, COALESCE(SUM(mfg_production_1.`prod_planned_qty`), 0) AS `totalReqQTY`, `prod_transaction`,`prod_product_sku` FROM `mfg_production_1` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `mfg_production_1`.`prod_inserted_by` WHERE `prod_transaction` = :ppr AND `prod_product_sku` = :sku AND  `mfg_production_1`.`prod_branch` = :branch",
          //   {
          //     replacements: {
          //       ppr: item.prod_transaction,
          //       sku: item.prod_product_sku,
          //       branch: req.branch,
          //     },
          //     type: invtDB.QueryTypes.SELECT,
          //   }
          // );
          // let totalReqQTY;
          // let username;
          // if (stmt0.length == 0) {
          //   return res.json({
          //     code: 500,
          //     status: "error",
          //     message: "unable to fetch total req qty",
          // });
          // totalReqQTY = stmt0[0].totalReqQTY;
          // username = stmt0[0].user_name;
          //}

          // TOTAL CONSUMPTION QTY
          // let totalConsumpQTY;
          // let stmt1 = await invtDB.query("SELECT COALESCE(SUM(`mfg_prod_planing_qty`), 0) AS `totalConsumpQTY`,`mfg_ref_id`,`mfg_sku`,`ppr_randomcode` FROM `mfg_production_2` WHERE `mfg_ref_id` = :ppr AND `mfg_sku` = :sku AND `ppr_randomcode` = :random", {
          //   replacements: {
          //     ppr: item.prod_transaction,
          //     sku: item.prod_product_sku,
          //     random: item.ppr_randomcode,
          //   },
          //   type: invtDB.QueryTypes.SELECT,
          // });
          // if (stmt1.length > 0) {
          //   totalConsumpQTY = stmt1[0].totalConsumpQTY

          // } else {
          //   return res.json({
          //     code: 500,
          //     status: "error",
          //     message: "unable to fetch total consumption qty",
          //   });
          // }

          if (
            helper.number(item.prod_planned_qty) >
            helper.number(item.prod_executed_qty)
          ) {
            result.push({
              prod_transaction: item.prod_transaction,
              prod_type: item.prod_type.toUpperCase(),
              prod_customer: item.prod_customer_name,
              prod_insert_by: item.user_name,
              prod_insert_dt: moment(item.prod_insert_date).format(
                "DD-MM-YYYY HH:mm:ss"
              ),
              prod_planned_qty: item.prod_planned_qty,
              prod_due_date: item.prod_due_date,
              prod_name: item.p_name,
              prod_project: item.prod_project == "" ? "N/A" : item.prod_project,
              prod_product_sku: item.prod_product_sku,
              totalConsumption: item.prod_executed_qty,
              consumptionRemaining:
                helper.number(item.prod_planned_qty) -
                  helper.number(item.prod_executed_qty) ?? 0,
              rqd_status: rqd_status,
            });
          }
          count++;

          if (count == main_stmt.length) {
            return res.json({
              status: "success",
              success: true,
              message: "Data fetched successfully",
              data: result,
            });
          }
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "No data found",
        });
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH PPR COMPONENT DEATIL FOR CREATE MFG
// router.post(
//   "/fetchPprComponentDetails",
//   [auth.isAuthorized],
//   async (req, res) => {
//     let validation = new Validator(req.body, {
//       skucode: "required",
//       pprrequest: "required",
//     });

//     if (validation.fails()) {
//       return res.json({
//         status: "error",
//         success: false,
//         message: helper.firstErrorValidatorjs(validation),
//       });
//     }

//     try {
//       let header_data;
//       let stmt = await invtDB.query(
//         "SELECT * FROM `products` WHERE (`p_sku` = :sku)",
//         {
//           replacements: { sku: req.body.skucode },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );
//       if (stmt.length > 0) {
//         let product_name = stmt[0].p_name;
//         let product_sku = stmt[0].p_sku;

//         let stmt1 = await invtDB.query(
//           "SELECT * FROM `bom_quantity` LEFT JOIN `bom_recipe` ON `bom_quantity`.`subject_under` = `bom_recipe`.`subject_id` LEFT JOIN `mfg_production_1` ON `bom_quantity`.`product_sku` = `mfg_production_1`.`prod_product_sku` LEFT JOIN location_main ON mfg_production_1.prod_location = location_main.location_key WHERE `bom_quantity`.`product_sku` = :sku AND `bom_quantity`.`subject_under` = bom_recipe.subject_id AND `mfg_production_1`.`prod_bom_subject` = bom_quantity.subject_under AND `mfg_production_1`.`prod_transaction` = :req  GROUP BY `bom_recipe`.`subject_name` ORDER BY `bom_recipe`.`subject_name` ASC",
//           {
//             replacements: {
//               sku: req.body.skucode,
//               req: req.body.pprrequest,
//             },
//             type: invtDB.QueryTypes.SELECT,
//           }
//         );

//         if (stmt1.length > 0) {
//           let stmt2 = await invtDB.query(
//             "SELECT COALESCE(SUM(`mfg_prod_planing_qty`),0) AS totalYetConsupted, `mfg_sku`,`mfg_ref_id` FROM mfg_production_2 WHERE `mfg_sku` = :sku AND `mfg_ref_id` = :req AND mfg_prod_type = 'C'",
//             {
//               replacements: {
//                 sku: req.body.skucode,
//                 req: req.body.pprrequest,
//               },
//               type: invtDB.QueryTypes.SELECT,
//             }
//           );

//           let ConsumptedQtyis;
//           if (stmt2.length > 0) {
//             ConsumptedQtyis = stmt2[0].totalYetConsupted;
//           } else {
//             ConsumptedQtyis = 0;
//           }

//           header_data = {
//             key: stmt1[0].subject_id,
//             bom: stmt1[0].subject_name,
//             mfg:
//               helper.number(stmt1[0].prod_planned_qty) -
//               helper.number(ConsumptedQtyis),
//             comment: stmt1[0].prod_comment,
//             sku: product_sku,
//             productname_sku: product_name + " / " + product_sku,
//             productionLocKey: stmt1[0].prod_location,
//             productionLocName: stmt1[0].loc_name,
//             pprid: req.body.pprrequest,
//           };

//           let comp_result = [];

//           // Fetch Component Details
//           let comp_stmt = await invtDB.query(
//             "SELECT * FROM `bom_recipe` LEFT JOIN `bom_quantity` ON `bom_recipe`.`subject_id` = `bom_quantity`.`subject_under` LEFT JOIN `components` ON `bom_quantity`.`component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `bom_recipe`.`subject_id` = :bom AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND `components`.`c_is_enabled` = 'Y' AND `bom_quantity`.`bom_status` != 'I' GROUP BY `components`.`component_key` ORDER BY `components`.`c_name` ASC",
//             {
//               replacements: { bom: header_data.key },
//               type: invtDB.QueryTypes.SELECT,
//             }
//           );

//           if (comp_stmt.length > 0) {
//             comp_stmt.forEach(async (comp_data) => {
//               // ALL INWARD
//               let INWARD_stmt = await invtDB.query(
//                 "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :location AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER')",
//                 {
//                   replacements: {
//                     component: comp_data.component_key,
//                     location: header_data.productionLocKey,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );

//               let component_qty_yet_in_location = 0;
//               if (INWARD_stmt.length > 0) {
//                 component_qty_yet_in_location = helper.number(
//                   INWARD_stmt[0].Inward
//                 );
//               }
//               // ALL OUTWARD
//               let out_stmt = await invtDB.query(
//                 "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND `loc_out` = :location AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER')",
//                 {
//                   replacements: {
//                     component: comp_data.component_key,
//                     location: header_data.productionLocKey,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );
//               let component_qty_yet_out_location = 0;
//               if (out_stmt.length) {
//                 component_qty_yet_out_location = helper.number(
//                   out_stmt[0].Outward
//                 );
//               }

//               const avgRate =
//                 await require("../../../helper/utils/avgRate").getWeightedPurchaseRate(
//                   comp_data.component_key,
//                   moment(new Date()).format("YYYY-MM-DD HH:mm:ss")
//                 );

//               comp_result.push({
//                 key: comp_data.component_key,
//                 partno: comp_data.c_part_no,
//                 name: comp_data.c_name,
//                 qty: comp_data.qty,
//                 unit: comp_data.units_name,
//                 type: comp_data.bom_catergory,
//                 location_qty: parseInt(
//                   component_qty_yet_in_location - component_qty_yet_out_location
//                 ),
//                 avgRate: avgRate,
//               });

//               if (comp_stmt.length == comp_result.length) {
//                 return res.json({
//                   status: "success",
//                   success: true,
//                   data: { header_data: header_data, comp_data: comp_result },
//                 });
//               }
//             });
//           } else {
//             return res.json({
//               success: false,
//               status: "error",
//               message: "We could not fetch any data linked with that SKU.",
//             });
//           }
//         } else {
//           return res.json({
//             status: "error",
//             success: false,
//             message: "BOM not found for this SKU",
//           });
//         }
//       } else {
//         return res.json({
//           status: "error",
//           success: false,
//           message: "not an valid SKU",
//         });
//       }
//     } catch (err) {
//       return helper.errorResponse(res, err);
//     }
//   }
// );
router.post(
  "/fetchPprComponentDetails",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      skucode: "required",
      pprrequest: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    try {
      const stmt = await invtDB.query(
        "SELECT * FROM `products` WHERE `p_sku` = :sku",
        {
          replacements: { sku: req.body.skucode },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (!stmt.length) {
        return res.json({
          status: "error",
          success:false,
          message: "not an valid SKU",
        });
      }

      const product_name = stmt[0].p_name;
      const product_sku = stmt[0].p_sku;

      const [stmt1, stmt2] = await Promise.all([
        invtDB.query(
          `SELECT * FROM bom_quantity
         LEFT JOIN bom_recipe      ON bom_quantity.subject_under   = bom_recipe.subject_id
         LEFT JOIN mfg_production_1 ON bom_quantity.product_sku     = mfg_production_1.prod_product_sku
         LEFT JOIN location_main    ON mfg_production_1.prod_location = location_main.location_key
         WHERE bom_quantity.product_sku          = :sku
           AND bom_quantity.subject_under         = bom_recipe.subject_id
           AND mfg_production_1.prod_bom_subject  = bom_quantity.subject_under
           AND mfg_production_1.prod_transaction  = :req
         GROUP BY bom_recipe.subject_name
         ORDER BY bom_recipe.subject_name ASC`,
          {
            replacements: { sku: req.body.skucode, req: req.body.pprrequest },
            type: invtDB.QueryTypes.SELECT,
          },
        ),
        invtDB.query(
          `SELECT COALESCE(SUM(mfg_prod_planing_qty), 0) AS totalYetConsupted,
                mfg_sku, mfg_ref_id
         FROM   mfg_production_2
         WHERE  mfg_sku      = :sku
           AND  mfg_ref_id   = :req
           AND  mfg_prod_type = 'C'`,
          {
            replacements: { sku: req.body.skucode, req: req.body.pprrequest },
            type: invtDB.QueryTypes.SELECT,
          },
        ),
      ]);

      if (!stmt1.length) {
        return res.json({
          status: "error",
          success:false,
          message: "BOM not found for this SKU",
        });
      }

      const consumedQty = stmt2.length
        ? helper.number(stmt2[0].totalYetConsupted)
        : 0;

      const header_data = {
        key: stmt1[0].subject_id,
        bom: stmt1[0].subject_name,
        mfg: helper.number(stmt1[0].prod_planned_qty) - consumedQty,
        comment: stmt1[0].prod_comment,
        sku: product_sku,
        productname_sku: `${product_name} / ${product_sku}`,
        productionLocKey: stmt1[0].prod_location,
        productionLocName: stmt1[0].loc_name,
        pprid: req.body.pprrequest,
      };

      const comp_stmt = await invtDB.query(
        `SELECT * FROM bom_recipe
       LEFT JOIN bom_quantity ON bom_recipe.subject_id      = bom_quantity.subject_under
       LEFT JOIN components   ON bom_quantity.component_id  = components.component_key
       LEFT JOIN units        ON components.c_uom           = units.units_id
       WHERE bom_recipe.subject_id       = :bom
         AND components.c_type           = 'R'
         AND components.c_is_enabled     = 'Y'
         AND bom_quantity.bom_status     != 'I'
       GROUP BY components.component_key
       ORDER BY components.c_name ASC`,
        {
          replacements: { bom: header_data.key },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (!comp_stmt.length) {
        return res.json({
          success:false,
          status: "error",
          message: "We could not fetch any data linked with that SKU.",
        });
      }

      const comp_result = await Promise.all(
        comp_stmt.map(async (comp_data) => {
          const [INWARD_stmt, out_stmt, avgRateStmt] = await Promise.all([
            invtDB.query(
              `SELECT COALESCE(SUM(qty + other_qty), 0) AS Inward
           FROM rm_location
           WHERE components_id = :component
             AND loc_in = :location
             AND trans_type IN (
               'INWARD',
               'ISSUE',
               'JOBWORK',
               'REJECTION',
               'TRANSFER'
             )`,
              {
                replacements: {
                  component: comp_data.component_key,
                  location: header_data.productionLocKey,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),

            invtDB.query(
              `SELECT COALESCE(SUM(qty + other_qty), 0) AS Outward
           FROM rm_location
           WHERE components_id = :component
             AND loc_out = :location
             AND trans_type IN (
               'CONSUMPTION',
               'ISSUE',
               'JOBWORK',
               'REJECTION',
               'TRANSFER'
             )`,
              {
                replacements: {
                  component: comp_data.component_key,
                  location: header_data.productionLocKey,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),

            // Weighted average rate
            require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(
              comp_data.component_key,
            ),
          ]);

          const inQty = INWARD_stmt.length
            ? helper.number(INWARD_stmt[0].Inward)
            : 0;

          const outQty = out_stmt.length
            ? helper.number(out_stmt[0].Outward)
            : 0;

          return {
            key: comp_data.component_key,
            partno: comp_data.c_part_no,
            name: comp_data.c_name,
            qty: comp_data.qty,
            unit: comp_data.units_name,
            type: comp_data.bom_catergory,
            location_qty: parseInt(inQty - outQty),
            avgRate: avgRateStmt || 0,
          };
        }),
      );

      return res.json({
        status: "success",
        success:true,
        data: { header_data, comp_data: comp_result },
      });
    } catch (err) {
      console.error(err);
      return helper.errorResponse(res, err);
    }
  },
);

// FETCH COMPLETE PPR
router.post("/fetchCompletePpr", [auth.isAuthorized], async (req, res) => {
  try {
    let main_stmt;
    if (req.body.searchBy == "skuwise") {
      let product_key = req.body.searchValue;
      let stmt = await invtDB.query(
        "SELECT * FROM `products` WHERE `product_key` = :product_key",
        {
          replacements: { product_key: product_key },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        main_stmt = await invtDB.query(
          "SELECT * FROM `mfg_production_1` LEFT JOIN `products` ON `mfg_production_1`.`prod_product_sku` = `products`.`p_sku` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `mfg_production_1`.`prod_inserted_by` WHERE `mfg_production_1`.`prod_product_sku` = :sku AND prod_branch = :branch ORDER BY `mfg_production_1`.`ID` DESC",
          {
            replacements: { sku: stmt[0].p_sku, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "SKU not valid and no longer registered with us",
        });
      }
    } else if (req.body.searchBy == "pprtype") {
      main_stmt = await invtDB.query(
        "SELECT * FROM `mfg_production_1` LEFT JOIN `products` ON `mfg_production_1`.`prod_product_sku` = `products`.`p_sku` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `mfg_production_1`.`prod_inserted_by` WHERE `mfg_production_1`.`prod_type` = :status AND prod_branch = :branch ORDER BY `mfg_production_1`.`ID` DESC",
        {
          replacements: { status: req.body.searchValue, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (req.body.searchBy == "pprno") {
      main_stmt = await invtDB.query(
        "SELECT * FROM `mfg_production_1` LEFT JOIN `products` ON `mfg_production_1`.`prod_product_sku` = `products`.`p_sku` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `mfg_production_1`.`prod_inserted_by` WHERE `mfg_production_1`.`prod_transaction` = :pprno AND prod_branch = :branch ORDER BY `mfg_production_1`.`ID` DESC",
        {
          replacements: { pprno: req.body.searchValue, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Select the valid filter type to fetch the records..",
      });
    }

    if (main_stmt.length > 0) {
      let count = 1;
      let final = [];
      main_stmt.map(async (row) => {
        let totalReqQTY;
        let stmt0 = await invtDB.query(
          "SELECT COALESCE(SUM(`prod_planned_qty`), 0) AS totalReqQTY,prod_transaction,prod_product_sku FROM `mfg_production_1` WHERE prod_transaction = :ppr AND prod_product_sku = :sku AND `mfg_production_1`.`prod_branch` = :branch",
          {
            replacements: {
              ppr: row.prod_transaction,
              sku: row.prod_product_sku,
              // random: row.ppr_randomcode,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt0.length > 0) {
          totalReqQTY = stmt0[0].totalReqQTY;
        } else {
          totalReqQTY = 0;
        }

        stmt0.map(async (row0) => {
          let totalConsumpQTY = 0;
          // let stmt00 = await invtDB.query("SELECT COALESCE(SUM(`mfg_prod_planing_qty`), 0) AS totalConsumpQTY,mfg_ref_id,mfg_sku,ppr_randomcode FROM `mfg_production_2` WHERE mfg_ref_id = :ppr AND mfg_sku = :sku AND ppr_randomcode = :random", {
          let stmt00 = await invtDB.query(
            "SELECT COALESCE(SUM(`prod_executed_qty`), 0) AS totalConsumpQTY FROM `mfg_production_1` WHERE  `prod_transaction` = :ppr AND prod_product_sku = :sku",
            {
              replacements: {
                ppr: row.prod_transaction,
                sku: row.prod_product_sku,
                random: row.ppr_randomcode,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (stmt00.length > 0) {
            totalConsumpQTY = stmt00[0].totalConsumpQTY ?? 0;
          }

          stmt00.map(async (row00) => {
            // let stmt1 = await invtDB.query(
            //   "SELECT mfg_production_1.prod_inserted_by, mfg_production_1.prod_type, mfg_production_1.ID, mfg_production_1.prod_product_sku, mfg_production_1.prod_insert_date, mfg_production_1.prod_transaction, mfg_production_2.mfg_transaction, mfg_production_1.prod_due_date, mfg_production_1.prod_bom_subject, products.p_name FROM bom_recipe JOIN mfg_production_1 ON bom_recipe.bom_product_sku = mfg_production_1.prod_product_sku LEFT JOIN mfg_production_2 ON bom_recipe.bom_product_sku = mfg_production_2.mfg_sku AND mfg_production_2.mfg_ref_id = mfg_production_1.prod_transaction LEFT JOIN products ON bom_recipe.bom_product_sku = products.p_sku WHERE mfg_production_1.prod_transaction = :ppr AND mfg_production_1.prod_product_sku = :sku AND mfg_production_2.mfg_prod_type = 'C' AND `mfg_production_1`.`prod_branch` = :branch GROUP BY mfg_production_1.prod_transaction, mfg_production_1.prod_product_sku ORDER BY mfg_production_1.ID DESC",
            //   {
            //     replacements: {
            //       ppr: row.prod_transaction,
            //       sku: row.prod_product_sku,
            //       branch: req.branch,
            //     },
            //     type: invtDB.QueryTypes.SELECT,
            //   }
            // );

            if (
              row0.totalReqQTY <= row00.totalConsumpQTY ||
              row.phase1_status == "C"
            ) {
              let consumptionRemaining = 0;
              if (
                row.phase1_status == "C" &&
                row.prod_planned_qty - row00.totalConsumpQTY > "0"
              ) {
                consumptionRemaining =
                  helper.number(row.prod_planned_qty) -
                  helper.number(row00.totalConsumpQTY);
              } else {
                consumptionRemaining =
                  helper.number(row.prod_planned_qty) -
                    helper.number(row00.totalConsumpQTY) ?? 0;
              }
              final.push({
                count: count,
                prod_transaction: row.prod_transaction,
                prod_type: row.prod_type.toUpperCase(),
                prod_customer: row.prod_customer_name,
                prod_insert_by: row.user_name,
                prod_insert_dt: moment(row.prod_insert_date).format(
                  "DD-MM-YYYY HH:mm:ss"
                ),
                prod_planned_qty: row.prod_planned_qty,
                prod_due_date: row.prod_due_date,
                prod_name: row.p_name,
                prod_project: row.prod_project == "" ? "N/A" : row.prod_project,
                prod_product_sku: row.prod_product_sku,
                totalConsumption: row00.totalConsumpQTY,
                consumptionRemaining: consumptionRemaining,
              });
              count++;
            } else {
              count++;
            }

            if (main_stmt.length == count - 1) {
              if (final.length > 0) {
                return res.json({
                  status: "success",
                  success: true,
                  data: final,
                });
              } else {
                return res.json({
                  status: "error",
                  success: false,
                  message:
                    "no orders were found that match the given search criteria",
                });
              }
            }
          });
        });
      });
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

// SAVE BOM RM FOR PROJECT
router.post("/save_pprBomRM", [auth.isAuthorized], async (req, res) => {
  let component_length = req.body.component.length;

  for (let i = 0; i < component_length; i++) {
    let validation = new Validator(
      {
        component: req.body.component[i],
        rate: helper.number(req.body.rate[i]),
        qty: helper.number(req.body.req_qty[i]),
      },
      {
        component: "required",
        rate: "required",
        qty: "required|min:0",
      }
    );
    if (validation.fails()) {
      return res.json({
        success: false,
        message: helper.firstErrorValidatorjs(validation),
        status: "error",
      });
    }
  }

  const toFindDublicates = (arry) =>
    arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(req.body.component);
  if (dubliEle.length > 0) {
    res.json({
      success: false,
      message:
        "You have supplied a same component twice of time in a single request",
      status: "error",
    });
    return;
  }

  const t = await otherDB.transaction();

  try {
    let stmt = await otherDB.query(
      "SELECT `project_key` FROM `invt_projects` GROUP BY `project_key` ORDER BY `ID` DESC LIMIT 1",
      {
        type: otherDB.QueryTypes.SELECT,
      }
    );
    let transactionCode;

    if (stmt.length > 0) {
      stmt.map((item) => {
        transactionCode = item.project_key;
        let strings = transactionCode.replace(/[0-9]/g, "");
        let digits = (
          Number(transactionCode.replace(/[^0-9]/g, "")) + 1
        ).toString();
        if (digits.length < 3) digits = ("000" + digits).substr(-3);
        transactionCode = strings + digits;
      });
    } else {
      transactionCode = "PRBOM001";
    }

    function randomString(length = 15) {
      var result = "";
      var characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      var charactersLength = characters.length;
      for (var i = 0; i < length; i++) {
        result += characters.charAt(
          Math.floor(Math.random() * charactersLength)
        );
      }
      return result;
    }
    let random = randomString();
    for (let i = 0; i < component_length; i++) {
      if (helper.number(req.body.req_qty[i]) !== "") {
        let stmt1 = await invtDB.query(
          "SELECT `qty` FROM `bom_quantity` WHERE `subject_under` = :subject_id AND `product_sku` = :sku AND `component_id` = :component",
          {
            replacements: {
              subject_id: req.body.bom,
              sku: req.body.skucode,
              component: req.body.component[i],
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt1.length == 0) {
          t.rollback();
          return res.json({
            success: false,
            message: "component not mapped with the BOM you have selected ..",
            status: "error",
          });
        }
        let stmt2 = await otherDB.query(
          "INSERT INTO `invt_projects` (`project_rm_category`,`project_ppr_bom_qty`,`server_session`,`client_session`,`project_ppr_sku`,`project_ppr_bom`,`project_ppr_ord_qty`,`project_rm`,`project_requirement`,`project_insert_by`,`project_insert_dt`,`project_key`,`project_rate`)VALUES (:category,:bom_qty,:server,:client,:sku,:bom,:order_qty,:component,:requirement,:by,:insertdate,:key,:rate)",
          {
            replacements: {
              category: req.body.category[i],
              bom_qty: stmt1[0].qty,
              server: random,
              client: req.body.clientref,
              sku: req.body.skucode,
              bom: req.body.bom,
              order_qty: req.body.ord_qty,
              component: req.body.component[i],
              requirement: req.body.req_qty[i],
              by: req.logedINUser,
              insertdate: moment(new Date())
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD HH:mm:ss"),
              key: transactionCode,
              rate: req.body.rate[i],
            },
            type: otherDB.QueryTypes.INSERT,
            transaction: t,
          }
        );

        if (stmt2.length > 0) {
          if (i == component_length - 1) {
            if (req.body.serverref !== "") {
              let stmt1 = await otherDB.query(
                "DELETE FROM `invt_projects` WHERE `client_session` = :client AND `project_ppr_sku` = :sku AND `project_ppr_bom` = :bom AND `server_session` = :server",
                {
                  replacements: {
                    client: req.body.clientref,
                    sku: req.body.skucode,
                    bom: req.body.bom,
                    server: req.body.serverref,
                  },
                  type: otherDB.QueryTypes.DELETE,
                  transaction: t,
                }
              );
            }
            t.commit();
            return res.json({
              status: "success",
              message: "Requirement saved..",
              data: { serverref: random },
              success: true,
            });
          }
        } else {
          t.rollback();
          return res.json({
            success: false,
            message:
              "an error while executing your request, contact system administrator..",
            status: "error",
          });
        }
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// CLOSE PPR
router.post("/delete_pprBomRM", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    serverref: "required",
    clientref: "required",
  });

  const { serverref, clientref } = req.body;

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  const t = await otherDB.transaction();

  try {
    let stmt0 = await otherDB.query(
      "SELECT `project_key` FROM `invt_projects` WHERE `client_session` = :client AND `server_session` = :server",
      {
        replacements: { client: clientref, server: serverref },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (stmt0.length > 0) {
      let stmt1 = await otherDB.query(
        "DELETE FROM `invt_projects` WHERE `client_session` = :client AND `server_session` = :server",
        {
          replacements: { client: clientref, server: serverref },
          type: otherDB.QueryTypes.DELETE,
          transaction: t,
        }
      );
      t.commit();
      return res.json({
        success: true,
        status: "success",
        message: "Requirement deleted",
      });
    } else {
      t.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "an error while fetching the BOM requirement",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH PROJECT BOM REPORT FINAL
router.post(
  "/fetch_finalProjectBomReport",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let stmt = await invtDB.query(
        `SELECT A.c_part_no, A.c_name, A.component_key, B.project_rm_category, B.project_requirement, B.project_ppr_bom_qty , B.project_rate, B.project_description, B.project_ppr_ord_qty, B.project_ppr_no, B.project_ppr_sku, C.units_name FROM ${global.ims_db_name}.components A JOIN ${global.other_db_name}.invt_projects B ON A.component_key = B.project_rm JOIN ${global.ims_db_name}.units C ON A.c_uom = C.units_id LEFT JOIN ${global.ims_db_name}.po_purchase_req D ON B.project_rm = D.po_part_no WHERE B.project_name = :project GROUP BY B.project_rm`,
        {
          replacements: {
            project: req.body.project,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt.length > 0) {
        let data = [];
        let stmt_get_a21 = await invtDB.query(
          "SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key",
          {
            replacements: { location_key: "202352216475456" },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let a21_locations = [];
        if (stmt_get_a21.length > 0) {
          for (let loc_i = 0; loc_i < stmt_get_a21.length; loc_i++) {
            a21_locations = stmt_get_a21[loc_i].locations.split(",");
          }
        } else {
          return res.json({
            status: "error",
            success: false,
            message: "Branch Location Not Found, contact to administrator",
          });
        }

        let stmt_get_sf21 = await invtDB.query(
          "SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key",
          {
            replacements: { location_key: "20235231231574" },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        let sf21_locations = [];
        if (stmt_get_sf21.length > 0) {
          for (let loc_i = 0; loc_i < stmt_get_sf21.length; loc_i++) {
            sf21_locations = stmt_get_sf21[loc_i].locations.split(",");
          }
        } else {
          return res.json({
            status: "error",
            success: false,
            message: "Branch Location Not Found, contact to administrator",
          });
        }

        stmt.map(async (item) => {
          let stmt0 = await otherDB.query(
            "SELECT COALESCE(SUM(`project_requirement`), 0) `project_requirement`, `project_name` FROM `invt_projects` WHERE `project_rm` = :component AND `project_name` = :project AND status != 'C'",
            {
              replacements: {
                project: req.body.project,
                component: item.component_key,
              },
              type: otherDB.QueryTypes.SELECT,
            }
          );
          let requiremnt = 0;
          if (stmt0.length > 0) {
            requiremnt = stmt0[0].project_requirement;
          }

          // GET A21 INWARD AND SF21 INWARD

          // LIVE
          // SELECT COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'TRANSFER') AND loc_in IN (:a21_locations) THEN qty ELSE 0 END ), 0 ) AS inward, COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER' ) AND loc_out IN (:a21_locations) THEN qty ELSE 0 END ), 0 ) AS outward, COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND loc_in IN (:sf21_locations) THEN qty ELSE 0 END ), 0 ) AS sf_inward, COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER', 'CONSUMPTION' ) AND loc_out IN (:sf21_locations) THEN qty ELSE 0 END ), 0 ) AS sf_outward, (SELECT COALESCE(SUM(`po_order_qty`), 0) FROM `po_purchase_req` WHERE (`po_project_name` = :project AND `po_part_no` = :component) AND (`po_status` = 'A' OR `po_status` = 'C' AND `po_inward_qty` != '0') ) `total_ord_qty`, (SELECT COALESCE(SUM(`po_pending_qty`), 0) FROM `po_purchase_req` WHERE (`po_project_name` = :project AND `po_part_no` = :component) AND (`po_status` = 'A')) `total_pending_qty`, (SELECT COALESCE(SUM(`po_inward_qty`), 0) FROM `po_purchase_req` WHERE (`po_project_name` = :project AND `po_part_no` = :component) AND (`po_status` = 'A' OR `po_status` = 'C' AND `po_inward_qty` != '0')) `total_inward_qty` FROM rm_location WHERE components_id = :component

          let stmt2 = await invtDB.query(
            "SELECT COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'TRANSFER') AND loc_in IN (:a21_locations) THEN qty ELSE 0 END ), 0 ) AS inward, COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER' ) AND loc_out IN (:a21_locations) THEN qty ELSE 0 END ), 0 ) AS outward, COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND loc_in IN (:sf21_locations) THEN qty ELSE 0 END ), 0 ) AS sf_inward, COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER', 'CONSUMPTION' ) AND loc_out IN (:sf21_locations) THEN qty ELSE 0 END ), 0 ) AS sf_outward, (SELECT COALESCE(SUM(`po_order_qty`), 0) FROM `po_purchase_req` WHERE (`po_project_name` = :project AND `po_part_no` = :component) AND (`po_status` = 'A' OR `po_status` = 'C' AND `po_inward_qty` != '0') ) `total_ord_qty`, (SELECT COALESCE(SUM(`po_pending_qty`), 0) FROM `po_purchase_req` WHERE (`po_project_name` = :project AND `po_part_no` = :component) AND (`po_status` = 'A')) `total_pending_qty`, (SELECT COALESCE(SUM(`po_inward_qty`), 0) FROM `po_purchase_req` WHERE (`po_project_name` = :project AND `po_part_no` = :component) AND (`po_status` = 'A' OR `po_status` = 'C' AND `po_inward_qty` != '0') ) `total_inward_qty` FROM rm_location WHERE components_id = :component ",
            {
              replacements: {
                component: item.component_key,
                project: req.body.project,
                a21_locations: a21_locations,
                sf21_locations: sf21_locations,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let inward_all_qty = 0;
          let outward_all_qty = 0;
          let total_ord_qty = 0;
          let total_inward_qty = 0;
          let total_pending_qty = 0;
          let sf_inward_all_qty = 0;
          let sf_outward_all_qty = 0;
          if (stmt2.length > 0) {
            total_ord_qty = stmt2[0].total_ord_qty;
            total_inward_qty = stmt2[0].total_inward_qty;
            total_pending_qty = stmt2[0].total_pending_qty;
            inward_all_qty = stmt2[0].inward;
            outward_all_qty = stmt2[0].outward;
            sf_inward_all_qty = stmt2[0].sf_inward;
            sf_outward_all_qty = stmt2[0].sf_outward;
          }

          let stmt4 = await invtDB.query(
            "SELECT COALESCE(SUM(`po_order_qty`),0) `totalReq_Qty`, COALESCE(SUM(`po_inward_qty`),0) `Inward` FROM `po_purchase_req` WHERE (`po_part_no` = :component AND `po_project_name` = :project) AND (`po_status` = 'A' OR `po_status` = 'C' AND `po_inward_qty` != 0)",
            {
              replacements: {
                component: item.component_key,
                project: req.body.project,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let stmt11 = await invtDB.query(
            "SELECT SUM(prod_planned_qty) as prod_planned_qty, SUM(prod_executed_qty) as prod_executed_qty FROM mfg_production_1 WHERE prod_transaction = :ppr",
            {
              replacements: {
                ppr: item.project_ppr_no,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          // let project_ppr_bom_qty_stmt = await otherDB.query("SELECT SUM(project_ppr_bom_qty) AS project_ppr_bom_qty, project_ppr_ord_qty, project_ppr_no FROM invt_projects WHERE project_name = :project AND  project_rm = :component AND status != 'C'", {
          let project_ppr_bom_qty_stmt = await otherDB.query(
            "SELECT SUM(project_ppr_bom_qty) AS project_ppr_bom_qty, project_ppr_ord_qty, project_ppr_no FROM invt_projects WHERE project_name = :project AND  project_rm = :component",
            {
              replacements: {
                project: req.body.project,
                component: item.component_key,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let po_transit =
            stmt4[0].totalReq_Qty > stmt4[0].Inward
              ? helper.number(stmt4[0].totalReq_Qty - stmt4[0].Inward)
              : 0;
          let pendingReqQty =
            Number(stmt11[0].prod_planned_qty - stmt11[0].prod_executed_qty) *
            helper.number(project_ppr_bom_qty_stmt[0].project_ppr_bom_qty ?? 0);

          let branch_stock = helper.number(inward_all_qty - outward_all_qty);
          let sf_stock = helper.number(sf_inward_all_qty - sf_outward_all_qty);

          let stmt5 = await invtDB.query(
            `SELECT COALESCE(SUM(mscorpre_ims_tally.tally_vbt.vbt_bill_qty),0) AS dnQty ,mscorpre_ims_tally.tally_vbt.ven_code, ${global.ims_db_name}.components.c_part_no FROM ${global.ims_db_name}.components LEFT JOIN mscorpre_ims_tally.tally_vbt ON mscorpre_ims_tally.tally_vbt.part_code = ${global.ims_db_name}.components.component_key AND mscorpre_ims_tally.tally_vbt.project_id = :project AND vbt_debit_key != '--' WHERE ${global.ims_db_name}.components.c_part_no = :cPart`,
            {
              replacements: {
                project: req.body.project,
                cPart: item.c_part_no,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let debitQuantity = stmt5[0].dnQty;

          data.push({
            part: item.c_part_no,
            type:
              item.project_rm_category == "P"
                ? "PART"
                : item.project_rm_category == "O"
                ? "OTHER"
                : item.project_rm_category == "PCK"
                ? "PACKING"
                : item.project_rm_category == "PCB"
                ? "PCB"
                : "NA",
            key: item.component_key,
            bomqty: project_ppr_bom_qty_stmt[0].project_ppr_bom_qty, //item.project_ppr_bom_qty,
            bomrate: item.project_rate,
            name: item.c_name,
            unit: item.units_name,
            project: req.body.project,
            requirement: requiremnt,
            order_qty: total_ord_qty,
            inward_qty: total_inward_qty,
            pending_qty: total_pending_qty,
            branch_stock: branch_stock,
            sf_stock: sf_stock,
            po_transit: po_transit,
            pending_reqqty: pendingReqQty > 0 ? pendingReqQty : 0,
            // over_st_qty: helper.number(inward_all_qty - outward_all_qty) + helper.number(po_transit) - helper.number(stmt11[0].prod_planned_qty - stmt11[0].prod_executed_qty),
            over_st_qty:
              Number(total_pending_qty) +
              helper.number(branch_stock) +
              helper.number(sf_stock) -
              pendingReqQty,
            dnQty: debitQuantity,
          });

          if (data.length == stmt.length) {
            return res.json({
              status: "success",
              success: true,
              message: "Data fetched successfully",
              data: data,
            });
          }
        });
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "project name not found while fetching the BOM requirement",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH PROJECT BOM REPORT GROUP WISE
router.post(
  "/fetch_groupProjectBomReport",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let stmt0 = await invtDB.query(
        " SELECT components.c_part_no, components.c_name, units.units_name, ven_basic_detail.ven_name, ven_basic_detail.ven_register_id, COALESCE(SUM( CASE WHEN po_status IN  ('A', 'C') THEN po_order_qty ELSE 0 END ), 0) AS total_order, COALESCE(SUM( CASE WHEN po_status IN  ('A') THEN po_pending_qty ELSE 0 END ),0) AS pending_qty, COALESCE(SUM( CASE WHEN po_status IN  ('A' , 'C') THEN po_inward_qty ELSE 0 END ),0) AS inward_qty FROM po_purchase_req LEFT JOIN ven_basic_detail ON po_purchase_req.po_vendor_reg_id = ven_basic_detail.ven_register_id LEFT JOIN components ON components.component_key = po_purchase_req.po_part_no LEFT JOIN units ON units.units_id = components.c_uom WHERE po_project_name = :project AND po_part_no = :part GROUP BY po_purchase_req.po_vendor_reg_id ",
        {
          replacements: {
            part: req.body.part,
            project: req.body.project,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt0.length > 0) {
        let data = [];
        for (let i = 0; i < stmt0.length; i++) {
          data.push({
            part: stmt0[i].c_part_no,
            name: stmt0[i].c_name,
            unit: stmt0[i].units_name,
            ven_code: stmt0[i].ven_register_id,
            ven_name: stmt0[i].ven_name,
            total_ord: stmt0[i].total_order,
            pending_qty: stmt0[i].pending_qty,
            inward_qty: stmt0[i].inward_qty,
          });
        }
        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: data,
        });
      } else {
        return res.json({
          status: "error",
          message: "project name not found while fetching the BOM requirement",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH PROJECT DETAILS
router.post("/fetchProjectInfo", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await otherDB.query(
      "SELECT `project_description` FROM `invt_projects` WHERE `project_name` = :project GROUP BY `project_name` LIMIT 1",
      {
        replacements: {
          project: req.body.project,
        },
        type: otherDB.QueryTypes.SELECT,
      }
    );
    let requiremnt = 0;
    if (stmt.length > 0) {
      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: {
          detail:
            stmt[0].project_description == ""
              ? "--"
              : stmt[0].project_description,
        },
      });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "project name not found to update details",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.post("/updatePPRDetail", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt0 = await otherDB.query(
      "SELECT * FROM `invt_projects` WHERE `project_name` = :project GROUP BY `project_name`",
      {
        replacements: {
          project: req.body.project,
        },
        type: otherDB.QueryTypes.SELECT,
      }
    );
    if (stmt0.length > 0) {
      let stmt1 = await otherDB.query(
        "UPDATE `invt_projects` SET `project_description` = :detail WHERE `project_name` = :project",
        {
          replacements: {
            detail: req.body.detail,
            project: req.body.project,
          },
          type: otherDB.QueryTypes.UPDATE,
        }
      );
      return res.json({
        success: true,
        status: "success",
        message:
          "project detail mapped with project name (" +
          req.body.project +
          ") successfully",
      });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "project name not found to update details",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET ALL BOM COMPONENT INSIDE THE BOM
router.post(
  "/fetchRQDComponent4Update",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      sku: "required",
      bom: "required",
      ppr: "required",
      server: "required",
      client: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(validation),
      });
    }
    try {
      let stmt = await otherDB.query(
        "SELECT `project_key` FROM `invt_projects` WHERE `server_session` = :server AND `client_session` = :client",
        {
          replacements: {
            server: req.body.server,
            client: req.body.client,
          },
          type: otherDB.QueryTypes.SELECT,
        }
      );
      if (stmt.length == 0) {
        return res.json({
          status: "error",
          success: false,
          message: "Invalid Project BOM requirement configured",
        });
      }
      let stmt0 = await otherDB.query(
        `SELECT A.c_part_no, A.c_name, A.component_key, B.project_ppr_sku, B.project_rm_category, B.project_rate, B.project_requirement, B.project_ppr_bom_qty, C.units_name FROM ${global.ims_db_name}.components A JOIN ${global.other_db_name}.invt_projects B ON A.component_key = B.project_rm JOIN ${global.ims_db_name}.units C ON A.c_uom = C.units_id WHERE B.server_session = :server AND B.client_session = :client`,
        {
          replacements: {
            server: req.body.server,
            client: req.body.client,
          },
          type: otherDB.QueryTypes.SELECT,
        }
      );
      if (stmt0.length > 0) {
        let result = [];
        for (let i = 0; i < stmt0.length; i++) {
          stmt1 = await invtDB.query(
            `SELECT COALESCE(SUM(P.po_order_qty), 0) totalReq_Qty, COALESCE(SUM(P.po_inward_qty), 0) Inward FROM ${global.other_db_name}.invt_projects I LEFT JOIN ${global.ims_db_name}.po_purchase_req P ON I.project_rm = P.po_part_no WHERE I.project_ppr_bom = :subject_id AND I.project_ppr_sku = :sku AND I.project_rm = :component`,
            {
              replacements: {
                subject_id: req.body.bom,
                component: stmt0[i].component_key,
                sku: stmt0[0].project_ppr_sku,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let order, inward;
          if (stmt1.length > 0) {
            (order = stmt1[0].totalReq_Qty), (inward = stmt1[0].Inward);
          } else {
            order = 0;
            inward = 0;
          }
          // ALL INWARD
          let stmt2 = await invtDB.query(
            "SELECT COALESCE(SUM(qty+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'TRANSFER')",
            {
              replacements: {
                component: stmt0[i].component_key,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          let inward_all_qty;
          if (stmt2.length > 0) {
            inward_all_qty = helper.number(stmt2[0].Inward);
          } else {
            inward_all_qty = 0;
          }

          // ALL OUTWARD
          let outward_all_qty;
          let stmt3 = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'INWARD' AND `trans_type` != 'CONSUMPTION' AND `trans_type` != 'CANCELLED')",
            {
              replacements: {
                component: stmt0[i].component_key,
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt3.length > 0) {
            outward_all_qty = helper.number(stmt3[0].Outward);
          } else {
            outward_all_qty = 0;
          }

          result.push({
            serial: i + 1,
            part: stmt0[i].c_part_no,
            name: stmt0[i].c_name,
            category: stmt0[i].project_rm_category,
            qty: stmt0[i].project_requirement,
            component: stmt0[i].component_key,
            uom: stmt0[i].units_name,
            rate: stmt0[i].project_rate,
            bomqty: stmt0[i].project_ppr_bom_qty,
            popendingqty: helper.number(order - inward),
            branchstock: helper.number(inward_all_qty - outward_all_qty),
          });
        }
        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: result,
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "no components were found",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// Fetch All Projects
router.post("/allProjects", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      `SELECT 
        pm.project_name, 
        pm.project_status, 
        pm.project_description, 
        pm.project_costcenter,
        cc.cost_center_name,
        pm.insert_date 
      FROM project_master pm
      LEFT JOIN cost_center cc ON pm.project_costcenter = cc.cost_center_key
      GROUP BY pm.project_name
      ORDER BY pm.insert_date DESC`,
      { type: invtDB.QueryTypes.SELECT }
    );

    if (stmt.length > 0) {
      data = [];
      for (let i = 0; i < stmt.length; i++) {
        data.push({
          project: stmt[i].project_name,
          status: stmt[i].project_status,
          description: stmt[i].project_description,
          // costcenter: stmt[i].project_costcenter,
          costcenter: stmt[i].cost_center_name || "N/A",
          insert_dt: moment(stmt[i].insert_date, "YYYY-MM-DD HH:mm:ss").format(
            "DD-MM-YYYY HH:mm:ss"
          ),
        });
      }
      res.json({
        status: "success",
        data: data,
        success: true,
      });
      return;
    } else {
      return res.json({
        success: false,
        message: "No data found",
        status: "error",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Update PPR
router.put("/update/project", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    project: "required",
    description: "required",
    qty: "required|min:1",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  try {
    let stmt = await invtDB.query(
      "UPDATE `project_master` SET `project_name` = :project, `project_description` = :description, `project_costcenter` = :costcenter, `projectQty` = :qty, bomsubjectid = :bomSubject, update_by = :update_by, update_dt = :update_dt WHERE `project_name` = :project",
      {
        replacements: {
          project: req.body.project,
          description: req.body.description,
          costcenter: req.body.costcenter ? req.body.costcenter : null,
          qty: req.body.qty,
          bomSubject: req.body.bomSubject,
          update_by: req.logedINUser,
          update_dt: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        },
        type: invtDB.QueryTypes.UPDATE,
      }
    );
    if (stmt.length == 0) {
      return res.json({
        success: false,
        message: "project name not found to update",
        status: "error",
      });
    }
    return res.json({
      success: true,
      status: "success",
      message: "project name updated successfully",
    });
  } catch (err) {
    t1.rollback();
    return helper.errorResponse(res, err);
  }
});


// GET ALL BOM COMPONENT FOR VIEW
router.post(
  "/fetchRQDComponent4View",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      sku: "required",
      ppr: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(validation),
      });
    }
    try {
      // let query = await invtDB.query("SELECT COALESCE(SUM(`mfg_prod_planing_qty`), 0) AS `totalConsumpQTY`,`mfg_ref_id`,`mfg_sku` FROM `mfg_production_2` WHERE `mfg_ref_id` = :ppr AND `mfg_sku` = :sku AND mfg_prod_type = 'C'", {
      let query = await invtDB.query(
        "SELECT COALESCE(SUM(prod_executed_qty), 0) AS totalConsumpQTY FROM mfg_production_1 WHERE prod_transaction = :ppr AND prod_product_sku = :sku",
        {
          replacements: {
            ppr: req.body.ppr,
            sku: req.body.sku,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (query.length == 0) {
        return res.json({
          success: false,
          status: "error",
          message: "unable to fetch PPR",
        });
      }

      let stmt0 = await otherDB.query(
        `SELECT A.c_part_no, A.c_name, A.component_key, B.project_ppr_sku, B.project_rm_category, B.project_rate, B.project_requirement, B.project_ppr_bom_qty, C.units_name FROM ${global.ims_db_name}.components A JOIN ${global.other_db_name}.invt_projects B ON A.component_key = B.project_rm JOIN ${global.ims_db_name}.units C ON A.c_uom = C.units_id WHERE B.project_ppr_no = :ppr AND B.project_ppr_sku = :sku`,
        {
          replacements: {
            ppr: req.body.ppr,
            sku: req.body.sku,
          },
          type: otherDB.QueryTypes.SELECT,
        }
      );
      if (stmt0.length > 0) {
        let result = [];

        const totalConsumpQTY = query[0].totalConsumpQTY;
        for (let i = 0; i < stmt0.length; i++) {
          result.push({
            part: stmt0[i].c_part_no,
            name: stmt0[i].c_name,
            category:
              stmt0[i].project_rm_category == "P"
                ? "PART"
                : stmt0[i].project_rm_category == "O"
                ? "OTHER"
                : stmt0[i].project_rm_category == "PCK"
                ? "PACKING"
                : stmt0[i].project_rm_category == "PCB"
                ? "PCB"
                : "N/A",
            req_qty: stmt0[i].project_requirement,
            uom: stmt0[i].units_name,
            rate: stmt0[i].project_rate,
            bom_qty: stmt0[i].project_ppr_bom_qty,
            executed_qty: helper.number(
              totalConsumpQTY * stmt0[i].project_ppr_bom_qty
            ),
            remaining_qty: helper.number(
              stmt0[i].project_requirement -
                totalConsumpQTY * stmt0[i].project_ppr_bom_qty
            ),
          });
        }
        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: result,
          totalConsumpQTY: totalConsumpQTY,
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "no components were found",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// Get List of Mapped Projects with BOM
router.get("/list/bom/:project", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT bom_recipe.*, admin_login.user_name AS bom_insert_by FROM bom_recipe LEFT JOIN admin_login ON admin_login.CustID = bom_recipe.inserted_by WHERE bom_project = :project",
      {
        replacements: {
          project: req.params.project,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "No data found",
      });
    }
    let result = [];
    for (let i = 0; i < stmt.length; i++) {
      result.push({
        bomType:
          stmt[i].bom_recipe_type == "semi"
            ? "SEMI"
            : stmt[i].bom_recipe_type == "default"
            ? "DEFAULT"
            : "N/A",
        bomSKU: stmt[i].bom_product_sku,
        projectName: stmt[i].bom_project,
        bomSubject: stmt[i].subject_name,
        bomStatus: stmt[i].bom_status,
        bomInsertBy: stmt[i].bom_insert_by,
        bomInsertDt: moment(stmt[i].insert_dt, "YYYY-MM-DD HH:mm:ss").format(
          "DD-MM-YYYY HH:mm:ss"
        ),
      });
    }
    return res.json({
      status: "success",
      success: true,
      message: "Data fetched successfully",
      data: result,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// ADD NEW COMPONENT IN RQD
router.post("/addNewComponentInRqd", [auth.isAuthorized], async (req, res) => {
  const valid = new Validator(req.body, {
    ppr: "required",
    skucode: "required",
    bom: "required",
    component: "required",
    rate: "required",
  });

  if (valid.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(valid),
    });
  }

  try {
    // check if COMPONENT ALL IN RQD
    const check_comp = await otherDB.query(
      "SELECT * FROM `invt_projects` WHERE `project_ppr_no` = :ppr AND `project_ppr_sku` = :sku AND project_ppr_bom = :bom AND project_rm = :component ORDER BY `project_ppr_no` DESC LIMIT 1 ",
      {
        replacements: {
          ppr: req.body.ppr,
          sku: req.body.skucode,
          bom: req.body.bom,
          component: req.body.component,
        },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (check_comp.length > 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Component already in RQD",
      });
    }

    // check if PPR RQD
    const check = await otherDB.query(
      "SELECT * FROM `invt_projects` WHERE `project_ppr_no` = :ppr AND `project_ppr_sku` = :sku AND project_ppr_bom = :bom ORDER BY `project_ppr_no` DESC LIMIT 1 ",
      {
        replacements: {
          ppr: req.body.ppr,
          sku: req.body.skucode,
          bom: req.body.bom,
        },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (check.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "PPR RQD not found",
      });
    }

    // check if component exist IN BOM
    const stmt = await invtDB.query(
      "SELECT * FROM bom_quantity WHERE subject_under = :subject AND component_id = :component",
      {
        replacements: {
          subject: req.body.bom,
          component: req.body.component,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Component not found in BOM",
      });
    }

    const stmt_insert = await otherDB.query(
      "INSERT INTO invt_projects( project_name, project_ppr_no, project_ppr_sku, project_ppr_bom, project_rm_category, project_ppr_ord_qty, project_ppr_bom_qty, project_rm, project_rate, project_requirement, project_insert_by, project_insert_dt, project_key, client_session, server_session, status, project_description) VALUES ( :project_name, :ppr, :sku, :bom, :catergory, :ppr_ord_qty, :qty, :component, :rate, :requirement, :insert_by, :insert_dt, :key, :client_session, :server_session, :status, :project_description )",
      {
        replacements: {
          project_name: check[0].project_name,
          ppr: check[0].project_ppr_no,
          sku: check[0].project_ppr_sku,
          bom: check[0].project_ppr_bom,
          catergory: stmt[0].bom_catergory,
          ppr_ord_qty: check[0].project_ppr_ord_qty,
          qty: stmt[0].qty,
          component: stmt[0].component_id,
          rate: req.body.rate,
          requirement: check[0].project_ppr_ord_qty * stmt[0].qty,
          insert_by: req.logedINUser,
          insert_dt: moment(new Date())
            .tz("Asia/Kolkata")
            .format("YYYY-MM-DD HH:mm:ss"),
          key: check[0].project_key,
          client_session: check[0].client_session,
          server_session: check[0].server_session,
          status: "S",
          project_description: check[0].project_description,
        },
        type: otherDB.QueryTypes.INSERT,
      }
    );

    if (stmt_insert.length > 0) {
      return res.json({
        status: "success",
        success: true,
        message: "Component added successfully",
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message:
          "Internal Error<br/>If this condition persists, contact your system administrator",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// REMOVE COMPONENT FROM RQD
router.post(
  "/removeComponentFromRqd",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      const valid = new Validator(req.body, {
        ppr: "required",
        skucode: "required",
        bom: "required",
        component: "required",
      });

      if (valid.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: helper.firstErrorValidatorjs(valid),
        });
      }

      // check if COMPONENT ALL IN RQD
      const check_comp = await otherDB.query(
        "SELECT * FROM `invt_projects` WHERE `project_ppr_no` = :ppr AND `project_ppr_sku` = :sku AND project_ppr_bom = :bom AND project_rm = :component ORDER BY `project_ppr_no` DESC LIMIT 1 ",
        {
          replacements: {
            ppr: req.body.ppr,
            sku: req.body.skucode,
            bom: req.body.bom,
            component: req.body.component,
          },
          type: otherDB.QueryTypes.SELECT,
        }
      );

      if (check_comp.length <= 0) {
        return res.json({
          status: "error",
          success: false,
          message: "Component not found in RQD",
        });
      }

      const stmt_remove = await otherDB.query(
        "DELETE FROM invt_projects WHERE project_ppr_no = :ppr AND project_ppr_sku = :sku AND project_ppr_bom = :bom AND project_rm = :component",
        {
          replacements: {
            ppr: req.body.ppr,
            sku: req.body.skucode,
            bom: req.body.bom,
            component: req.body.component,
          },
        }
      );

      if (stmt_remove[0].affectedRows > 0) {
        return res.json({
          status: "success",
          success: true,
          message: "Component removed successfully",
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "Something went wrong! Please try again...",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// ADD NEW COMPONENT IN RQD
router.post("/addNewComponentInRqd", [auth.isAuthorized], async (req, res) => {
  const valid = new Validator(req.body, {
    ppr: "required",
    skucode: "required",
    bom: "required",
    component: "required",
    rate: "required",
  });

  if (valid.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(valid),
    });
  }

  try {
    // check if COMPONENT ALL IN RQD
    const check_comp = await otherDB.query(
      "SELECT * FROM `invt_projects` WHERE `project_ppr_no` = :ppr AND `project_ppr_sku` = :sku AND project_ppr_bom = :bom AND project_rm = :component ORDER BY `project_ppr_no` DESC LIMIT 1 ",
      {
        replacements: {
          ppr: req.body.ppr,
          sku: req.body.skucode,
          bom: req.body.bom,
          component: req.body.component,
        },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (check_comp.length > 0) {
      return res.json({
        status: "error",
        success: false,
        message: "Component already in RQD",
      });
    }

    // check if PPR RQD
    const check = await otherDB.query(
      "SELECT * FROM `invt_projects` WHERE `project_ppr_no` = :ppr AND `project_ppr_sku` = :sku AND project_ppr_bom = :bom ORDER BY `project_ppr_no` DESC LIMIT 1 ",
      {
        replacements: {
          ppr: req.body.ppr,
          sku: req.body.skucode,
          bom: req.body.bom,
        },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (check.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "PPR RQD not found",
      });
    }

    // check if component exist IN BOM
    // const stmt = await invtDB.query("SELECT * FROM bom_quantity WHERE subject_under = :subject AND component_id = :component", {
    //  replacements: {
    //   subject: req.body.bom,
    //   component: req.body.component
    //  },
    //  type: invtDB.QueryTypes.SELECT,
    // });

    // if (stmt.length <= 0) {
    //  return res.json({ status: "error", success: false, message: "Component not found in BOM" });
    // }

    const stmt_insert = await otherDB.query(
      "INSERT INTO invt_projects( project_name, project_ppr_no, project_ppr_sku, project_ppr_bom, project_rm_category, project_ppr_ord_qty, project_ppr_bom_qty, project_rm, project_rate, project_requirement, project_insert_by, project_insert_dt, project_key, client_session, server_session, status, project_description) VALUES ( :project_name, :ppr, :sku, :bom, :catergory, :ppr_ord_qty, :qty, :component, :rate, :requirement, :insert_by, :insert_dt, :key, :client_session, :server_session, :status, :project_description )",
      {
        replacements: {
          project_name: check[0].project_name,
          ppr: check[0].project_ppr_no,
          sku: check[0].project_ppr_sku,
          bom: check[0].project_ppr_bom,
          catergory: stmt[0].bom_catergory,
          ppr_ord_qty: check[0].project_ppr_ord_qty,
          qty: stmt[0].qty,
          component: stmt[0].component_id,
          rate: req.body.rate,
          requirement: check[0].project_ppr_ord_qty * stmt[0].qty,
          insert_by: req.logedINUser,
          insert_dt: moment(new Date())
            .tz("Asia/Kolkata")
            .format("YYYY-MM-DD HH:mm:ss"),
          key: check[0].project_key,
          client_session: check[0].client_session,
          server_session: check[0].server_session,
          status: "S",
          project_description: check[0].project_description,
        },
        type: otherDB.QueryTypes.INSERT,
      }
    );

    if (stmt_insert.length > 0) {
      return res.json({
        status: "success",
        success: true,
        message: "Component added successfully",
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message:
          "Internal Error<br/>If this condition persists, contact your system administrator",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// REMOVE COMPONENT FROM RQD
router.post(
  "/removeComponentFromRqd",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      const valid = new Validator(req.body, {
        ppr: "required",
        skucode: "required",
        bom: "required",
        component: "required",
      });

      if (valid.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: helper.firstErrorValidatorjs(valid),
        });
      }

      // check if COMPONENT ALL IN RQD
      const check_comp = await otherDB.query(
        "SELECT * FROM `invt_projects` WHERE `project_ppr_no` = :ppr AND `project_ppr_sku` = :sku AND project_ppr_bom = :bom AND project_rm = :component ORDER BY `project_ppr_no` DESC LIMIT 1 ",
        {
          replacements: {
            ppr: req.body.ppr,
            sku: req.body.skucode,
            bom: req.body.bom,
            component: req.body.component,
          },
          type: otherDB.QueryTypes.SELECT,
        }
      );

      if (check_comp.length <= 0) {
        return res.json({
          status: "error",
          success: false,
          message: "Component not found in RQD",
        });
      }

      const stmt_remove = await otherDB.query(
        "DELETE FROM invt_projects WHERE project_ppr_no = :ppr AND project_ppr_sku = :sku AND project_ppr_bom = :bom AND project_rm = :component",
        {
          replacements: {
            ppr: req.body.ppr,
            sku: req.body.skucode,
            bom: req.body.bom,
            component: req.body.component,
          },
        }
      );

      if (stmt_remove[0].affectedRows > 0) {
        return res.json({
          status: "success",
          success: true,
          message: "Component removed successfully",
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "Something went wrong! Please try again...",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

router.post("/updateMissedExecution", async (req, res) => {
  let valid = new Validator(req.body, {
    date: "required",
  });

  if (valid.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Validation error",
      data: valid.errors.all(),
    });
  }

  try {
    let date = moment(req.body.date, "DD-MM-YYYY")
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD");

    if (date == "Invalid date") {
      return res.json({
        status: "error",
        success: false,
        message: "Invalid date",
      });
    }

    let stmt_get_ppr = await invtDB.query(
      "SELECT prod_transaction , prod_product_sku FROM mfg_production_1 WHERE DATE_FORMAT(prod_insert_date, '%Y-%m-%d') >= :date ",
      {
        replacements: {
          date: date,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    for (let i = 0; i < stmt_get_ppr.length; i++) {
      let stmt = await invtDB.query(
        "SELECT COALESCE(SUM(mfg_prod_planing_qty), 0) AS totalConsumpQTY FROM mfg_production_2 WHERE mfg_prod_type = 'C' AND mfg_ref_id = :ppr AND mfg_sku = :sku",
        {
          replacements: {
            ppr: stmt_get_ppr[i].prod_transaction,
            sku: stmt_get_ppr[i].prod_product_sku,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt.length > 0) {
        let update = await invtDB.query(
          "UPDATE mfg_production_1 SET prod_executed_qty = :newQTY WHERE prod_transaction = :ppr AND prod_product_sku = :sku",
          {
            replacements: {
              newQTY: stmt[0].totalConsumpQTY,
              ppr: stmt_get_ppr[i].prod_transaction,
              sku: stmt_get_ppr[i].prod_product_sku,
            },
            type: invtDB.QueryTypes.UPDATE,
          }
        );
        if (update.length > 0) {
          // console.log("Updated successfully");
          // console.log(stmt_get_ppr[i].prod_transaction);
          // console.log(stmt_get_ppr[i].prod_product_sku);
          //   return res.json({ status: "success", success: true, message: "Updated successfully" });
        } else {
          // console.log("Update failed");
          // console.log(stmt_get_ppr[i].prod_transaction);
          // console.log(stmt_get_ppr[i].prod_product_sku);
          //   return res.json({ code: 500, status: "error", message: "Update failed" });
        }
      } else {
        // console.log("Nothing to update");
        // return;
      }
    } // FOR

    return res.json({
      status: "success",
      success: true,
      message: "Updated successfully",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

module.exports = router;

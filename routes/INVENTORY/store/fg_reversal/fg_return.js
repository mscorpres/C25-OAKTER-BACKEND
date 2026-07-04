const express = require("express");
const router = express.Router();

let { invtDB } = require("../../../../config/db/connection");

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
const Validator = require("validatorjs");

// SAVE FG RETURN
router.post("/saveFG_return", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();

  try {
    let validation = new Validator(req.body, {
      product_sku: "required",
      bom_id: "required",
      qty_return: "required",
      fg_status: "required|in:OK,NG",
    });

    if (validation.fails()) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Something you missing in form field to supply.", data: validation.errors.all() });
    }

    let stmt_product = await invtDB.query("SELECT * FROM products WHERE p_sku = :product_sku", {
      replacements: { product_sku: req.body.product_sku },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt_product.length > 0) {
      let stmt_fg_return;
      let transactionID = await helper.genTransaction("FGRTN", transaction);

      if (req.body.fg_status == "OK") {
        stmt_fg_return = await invtDB.query(
          "INSERT INTO fg_return (company_branch,product_id,fg_bom,qty_return,location_in,fg_status,remark, executed_qty, fg_return_txn,insert_dt,insert_by) VALUES (:branch, :product_id, :fg_bom, :qty_return, :location_in, :fg_status, :remark, :executed_qty, :fg_return_txn, :insert_dt, :insert_by)",
          {
            replacements: {
              branch: req.branch,
              product_id: stmt_product[0].product_key,
              fg_bom: req.body.bom_id,
              qty_return: req.body.qty_return,
              executed_qty: req.body.qty_return,
              location_in: req.body.location_in == null ? "--" : req.body.location_in,
              fg_status: req.body.fg_status,
              remark: req.body.remark == null ? "--" : req.body.remark,
              fg_return_txn: transactionID,
              insert_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
              insert_by: req.logedINUser,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        stmt_fg_return = await invtDB.query(
          "INSERT INTO mfg_production_3 (company_branch , in_module ,mfg_pro_apr_sku,mfg_approve_in_qty,mfg_pro_apr_by,mfg_pro_apr_date,mfg_pro_apr_fulldate,mfg_pro_apr_transaction,mfg_ref_transid_1,mfg_ref_transid_2,mfg_pro_location_in,mfgphase2_insert_date,type,ppr_created_by,mfg_created_by) VALUES (:branch, 'IN-FGRTN' , :sku, :totalIn, :by, :insertdate, :fulldate, :transaction, :ppr_id, :mfg_id, :location, :mfginsertdate,'IN', :pprcreatedby, :mfgcreatedby)",
          {
            replacements: {
              branch: req.branch,
              sku: stmt_product[0].p_sku,
              totalIn: helper.number(req.body.qty_return),
              by: req.logedINUser,
              insertdate: moment(new Date()).tz("Asia/Kolkata").format("DD-MM-YYYY"),
              fulldate: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
              transaction: transactionID,
              ppr_id: "--",
              mfg_id: "--",
              location: req.body.location_in == null ? "--" : req.body.location_in,
              mfginsertdate: "--",
              pprcreatedby: "--",
              mfgcreatedby: "--",
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );
      } else {
        stmt_fg_return = await invtDB.query(
          "INSERT INTO fg_return (company_branch,product_id,fg_bom,qty_return,location_in,fg_status,remark,fg_return_txn,insert_dt,insert_by) VALUES (:branch, :product_id, :fg_bom, :qty_return, :location_in, :fg_status, :remark, :fg_return_txn, :insert_dt, :insert_by)",
          {
            replacements: {
              branch: req.branch,
              product_id: stmt_product[0].product_key,
              fg_bom: req.body.bom_id,
              qty_return: req.body.qty_return,
              location_in: req.body.location_in == null ? "--" : req.body.location_in,
              fg_status: req.body.fg_status,
              remark: req.body.remark == null ? "--" : req.body.remark,
              fg_return_txn: transactionID,
              insert_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
              insert_by: req.logedINUser,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );
      }

      if (stmt_fg_return.length > 0) {
        await transaction.commit();
        return res.json({ status: "success", success: true, message: "FG Return added successfully." });
      } else {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Internal Error! If this condition persists, contact your system administrator." });
      }
    } else {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Product not found." });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH FG RETURN
router.post("/fetchFG_returnlist", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      data: "required",
      wise: "required",
    });

    if (validation.fails()) {
      return res.json({ status: "error", success: false, message: "Something you missing in form field to supply.", data: validation.errors.all() });
    }

    const { data, wise } = req.body;
    let stmt;

    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        "SELECT * FROM fg_return LEFT JOIN products ON fg_return.product_id = products.product_key LEFT JOIN admin_login ON fg_return.insert_by = admin_login.CustID LEFT JOIN bom_recipe ON fg_return.fg_bom = bom_recipe.subject_id WHERE DATE_FORMAT(fg_return.insert_dt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND fg_return.company_branch = :branch AND fg_return.fg_status = 'NG' AND fg_return.qty_return != fg_return.executed_qty",
        {
          replacements: { date1: date1, date2: date2, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "skuwise") {
      stmt = await invtDB.query(
        "SELECT * FROM fg_return LEFT JOIN products ON fg_return.product_id = products.product_key LEFT JOIN admin_login ON fg_return.insert_by = admin_login.CustID LEFT JOIN bom_recipe ON fg_return.fg_bom = bom_recipe.subject_id WHERE fg_return.product_id = :product_id AND fg_return.company_branch = :branch AND fg_return.fg_status = 'NG' AND fg_return.qty_return != fg_return.executed_qty",
        {
          replacements: { product_id: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({ status: "error", success: false, message: "Please select valid filter method." });
    }

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        let loc_name;
        let stmt_loc = await invtDB.query("SELECT loc_name FROM location_main WHERE location_key = :key", {
          replacements: { key: stmt[i].location_in },
          type: invtDB.QueryTypes.SELECT,
        });

        if (stmt_loc.length > 0) {
          loc_name = stmt_loc[0].loc_name;
        } else {
          loc_name = "--";
        }

        let stmt_unit = await invtDB.query("SELECT units_name FROM units WHERE units_id = :id", {
          replacements: { id: stmt[i].p_uom },
          type: invtDB.QueryTypes.SELECT,
        });

        final.push({
          product_id: stmt[i].product_id,
          product_sku: stmt[i].p_sku,
          product_name: stmt[i].p_name,
          product_uom: stmt_unit[0].units_name,
          qty_return: stmt[i].qty_return,
          exe_qty: stmt[i].executed_qty,
          remaining_qty: stmt[i].qty_return - stmt[i].executed_qty,
          bom_id: stmt[i].fg_bom,
          bom_name: stmt[i].subject_name,
          location_in: stmt[i].location_in,
          location_name: loc_name,
          fg_status: stmt[i].fg_status,
          remark: stmt[i].remark,
          fg_return_txn_id: stmt[i].fg_return_txn,
          insert_dt: moment(stmt[i].insert_dt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
          insert_by: stmt[i].user_name,
        });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No data were found that match the given search criteria." });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH COMPONENT DEATIL FOR EXECUTE FG REVERSAL
router.post("/fetchComponentDetails", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    product_id: "required",
    fg_return_txn: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  try {
    let header_data;
    let stmt = await invtDB.query("SELECT * FROM products WHERE product_key = :product_key", {
      replacements: { product_key: req.body.product_id },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      let product_name = stmt[0].p_name;
      let product_sku = stmt[0].p_sku;

      let stmt2 = await invtDB.query(
        "SELECT * FROM fg_return LEFT JOIN bom_recipe ON fg_return.fg_bom = bom_recipe.subject_id WHERE product_id = :product_id AND fg_return_txn = :fg_return_txn AND fg_status = 'NG'",
        {
          replacements: {
            product_id: req.body.product_id,
            fg_return_txn: req.body.fg_return_txn,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      header_data = {
        bom_id: stmt2[0].subject_id,
        bom: stmt2[0].subject_name,
        left_qty: helper.number(stmt2[0].qty_return) - helper.number(stmt2[0].executed_qty),
        remark: stmt2[0].remark,
        sku: product_sku,
        productname_sku: product_name + " / " + product_sku,
      };

      let comp_result = [];

      // Fetch Component Details
      let comp_stmt = await invtDB.query(
        "SELECT * FROM `bom_recipe` LEFT JOIN `bom_quantity` ON `bom_recipe`.`subject_id` = `bom_quantity`.`subject_under` LEFT JOIN `components` ON `bom_quantity`.`component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `bom_recipe`.`subject_id` = :bom AND `components`.`c_is_enabled` = 'Y' AND `bom_quantity`.`bom_status` != 'I' GROUP BY `components`.`component_key` ORDER BY `components`.`c_name` ASC",
        {
          replacements: { bom: header_data.bom_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (comp_stmt.length > 0) {
        comp_stmt.forEach(async (comp_data) => {
          comp_result.push({
            key: comp_data.component_key,
            partno: comp_data.c_part_no,
            name: comp_data.c_name,
            qty: comp_data.qty,
            unit: comp_data.units_name,
            type: comp_data.bom_catergory,
          });

          if (comp_stmt.length == comp_result.length) {
            return res.json({
              status: "success", success: true,
              success: true,
              data: { header_data: header_data, comp_data: comp_result },
            });
          }
        });
      } else {
        return res.json({
          status: "error", success: false,
          success: false,
          message: "We could not fetch any data linked with that SKU.",
        });
      }
    } else {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Not a valid SKU.",
      });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// EXECUTE PENDING FG_REVERSAL if status is NOT OK
router.post("/executeFG_reversal", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    product_id: "required",
    qty: "required",
    location: "required",
    fg_return_txn: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }

  const transaction = await invtDB.transaction();

  try {
    if (req.body.qty < 1) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Zero value not acceptable.",
      });
    }

    let stmt = await invtDB.query("SELECT * FROM fg_return WHERE product_id = :product_id AND fg_return_txn = :fg_return_txn AND fg_status = 'NG'", {
      replacements: {
        product_id: req.body.product_id,
        fg_return_txn: req.body.fg_return_txn,
      },
      type: invtDB.QueryTypes.SELECT,
    });

    let MaxInwardQtyis = 0;
    if (stmt.length > 0) {
      MaxInwardQtyis = helper.number(stmt[0].qty_return) - helper.number(stmt[0].executed_qty);
      if (helper.number(MaxInwardQtyis) < helper.number(req.body.qty)) {
        transaction.rollback();
        return res.json({
          status: "error", success: false,
          success: false,
          message: "Executing QTY cannot be accepted.",
        });
      }
    } else {
      transaction.rollback();
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Something happened wrong, contact system administrator.",
      });
    }

    let insertDate = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const transactionID = helper.getUniqueNumber();

    for (let i = 0; i < req.body.component.length; i++) {
      if (req.body.comp_qty[i] != 0 || req.body.comp_qty[i] != "") {
        const stmt_bom_qty = await invtDB.query("SELECT * FROM bom_quantity WHERE subject_under = :bom AND component_id = :comp", {
          replacements: {
            bom: stmt[0].fg_bom,
            comp: req.body.component[i],
          },
          type: invtDB.QueryTypes.SELECT,
        });

        let comp_stmt = await invtDB.query(
          "INSERT INTO rm_location (company_branch,in_module,trans_type,inward_type,vendor_type,components_id,qty,mfg_bom_qty,loc_in,reversal_txn_id , fg_rtn_refid ,insert_date,insert_by,bom_subject_id,any_remark) VALUES(:branch, 'IN-FGRETURN', 'INWARD', 'FG-RETURN','p01', :component, :qty, :bom_qty, :loc_in, :txn_id , :fg_rtn_refid, :insert_date, :insert_by, :subject_id, :remark)",
          {
            replacements: {
              branch: req.branch,
              component: req.body.component[i],
              qty: req.body.comp_qty[i],
              bom_qty: stmt_bom_qty[0].qty,
              loc_in: req.body.location,
              txn_id: req.body.fg_return_txn,
              fg_rtn_refid: transactionID,
              insert_date: insertDate,
              insert_by: req.logedINUser,
              subject_id: stmt[0].fg_bom,
              remark: req.body.remark[i] == null ? "--" : req.body.remark[i],
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );
      }
    }

    // LOG
    const stmtLog = await invtDB.query(
      "INSERT INTO fg_return_log( fg_return_key, fg_return_txn, executed_qty, executed_remark , 	insert_by , insert_dt) VALUES ( :fg_return_key, :fg_return_txn, :executed_qty, :executed_remark , :insert_by , :insert_dt )",
      {
        replacements: {
          fg_return_key: transactionID,
          fg_return_txn: req.body.fg_return_txn,
          executed_qty: req.body.qty,
          executed_remark: req.body.comment ?? "--",
          insert_by: req.logedINUser,
          insert_dt: insertDate,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      }
    );

    let stmt8 = await invtDB.query("UPDATE fg_return SET executed_qty = executed_qty + :execute_qty WHERE product_id = :product_id AND fg_return_txn = :fg_return_txn AND fg_status = 'NG'", {
      replacements: {
        execute_qty: req.body.qty,
        product_id: req.body.product_id,
        fg_return_txn: req.body.fg_return_txn,
      },
      type: invtDB.QueryTypes.UPDATE,
      transaction: transaction,
    });

    if (stmt8.length > 0) {
      transaction.commit();
      return res.json({
        status: "success", success: true,
        success: true,
        message: "FG Return Executed Successfully.",
      });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

router.post("/fetchReturnCompleted", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    date: "required",
  });
  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
  }

  try {
    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    const stmt = await invtDB.query(
      "SELECT fg_return.*, products.p_name , products.p_sku , admin_login.user_name AS outBy  FROM fg_return LEFT JOIN products ON fg_return.product_id = products.product_key LEFT JOIN admin_login ON admin_login.CustID = fg_return.insert_by WHERE (fg_status = 'OK' OR fg_return.qty_return = fg_return.executed_qty) AND  DATE_FORMAT(insert_dt, '%Y-%m-%d') BETWEEN :date1 AND :date2",
      {
        replacements: {
          date1: date1,
          date2: date2,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length == 0) {
      return res.json({ status: "error", success: false, message: "No data found." });
    }

    const data = [];

    for (let i = 0; i < stmt.length; i++) {
      data.push({
        date: moment(stmt[i].insert_dt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY"),
        txn_id: stmt[i].fg_return_txn,
        sku: stmt[i].p_sku,
        name: stmt[i].p_name,
        in_qty: stmt[i].qty_return,
        exe_qty: stmt[i].executed_qty,
        outBy: stmt[i].outBy,
        remarks: stmt[i].any_remark,
      });
    }

    return res.json({ status: "success", success: true, data: data });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

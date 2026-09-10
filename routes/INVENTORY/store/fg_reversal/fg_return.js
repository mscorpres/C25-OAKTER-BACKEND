const express = require("express");
const router = express.Router();

let { invtDB } = require("../../../../config/db/connection");

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
const Validator = require("validatorjs");
const FG_RETURN_TRANSFER_LOCATION = "1788943506425";


async function getFgTransferStockQty(sku, branch, locationKey, transaction) {
  const stockRows = await invtDB.query(
    `SELECT
      COALESCE(SUM(CASE WHEN mfg_pro_location_in = :locationKey THEN COALESCE(mfg_approve_in_qty, 0) ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN fgout_pro_location_out = :locationKey THEN COALESCE(mfg_approve_in_qty, 0) ELSE 0 END), 0) AS net_qty
    FROM mfg_production_3
    WHERE type = 'TRANSFER'
      AND fg_status = 'ACTIVE'
      AND (company_branch = :branch OR :branch IS NULL)
      AND mfg_pro_apr_sku = :sku
      AND (mfg_pro_location_in = :locationKey OR fgout_pro_location_out = :locationKey)`,
    {
      replacements: { locationKey, branch, sku },
      type: invtDB.QueryTypes.SELECT,
      transaction,
    }
  );

  return stockRows.length ? helper.number(stockRows[0].net_qty) : 0;
}


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
    const locationKey = FG_RETURN_TRANSFER_LOCATION;
    const branch = req.branch;

    const stmt = await invtDB.query(
      `SELECT
        m3.ID,
        m3.mfg_pro_apr_sku,
        m3.mfg_pro_apr_bom,
        COALESCE(NULLIF(m3.qty_return, 0), m3.mfg_approve_in_qty, 0) AS qty_return,
        COALESCE(m3.executed_qty, 0) AS executed_qty,
        m3.mfg_pro_location_in,
        m3.fg_status,
        m3.fg_out_remark,
        m3.mfg_pro_apr_transaction,
        m3.mfg_pro_apr_fulldate,
        m3.mfg_pro_apr_by,
        products.product_key,
        products.p_sku,
        products.p_name,
        units.units_name,
        bom_recipe.subject_name,
        COALESCE(loc_in.loc_name, '--') AS location_name,
        COALESCE(admin_login.user_name, 'N/A') AS user_name,
        helper_stock.net_qty AS transfer_stock_qty
      FROM mfg_production_3 m3
      LEFT JOIN products ON products.p_sku = m3.mfg_pro_apr_sku
      LEFT JOIN units ON products.p_uom = units.units_id
      LEFT JOIN bom_recipe ON bom_recipe.subject_id = m3.mfg_pro_apr_bom
      LEFT JOIN location_main loc_in ON loc_in.location_key = m3.mfg_pro_location_in
      LEFT JOIN admin_login ON admin_login.CustID = m3.mfg_pro_apr_by
      INNER JOIN (
        SELECT
          mfg_pro_apr_sku,
          SUM(CASE WHEN mfg_pro_location_in = :locationKey THEN COALESCE(mfg_approve_in_qty, 0) ELSE 0 END) -
          SUM(CASE WHEN fgout_pro_location_out = :locationKey THEN COALESCE(mfg_approve_in_qty, 0) ELSE 0 END) AS net_qty
        FROM mfg_production_3
        WHERE type = 'TRANSFER'
          AND fg_status = 'ACTIVE'
          AND (company_branch = :branch OR :branch IS NULL)
          AND (mfg_pro_location_in = :locationKey OR fgout_pro_location_out = :locationKey)
        GROUP BY mfg_pro_apr_sku
        HAVING net_qty > 0
      ) AS helper_stock ON helper_stock.mfg_pro_apr_sku = m3.mfg_pro_apr_sku
      WHERE m3.type = 'TRANSFER'
        AND m3.fg_status = 'ACTIVE'
        AND m3.company_branch = :branch
        AND m3.mfg_pro_location_in = :locationKey
        AND COALESCE(NULLIF(m3.qty_return, 0), m3.mfg_approve_in_qty, 0) > COALESCE(m3.executed_qty, 0)
      ORDER BY m3.mfg_pro_apr_fulldate DESC, m3.ID DESC`,
      {
        replacements: { locationKey, branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      const final = stmt.map((item) => {
        const qtyReturn = helper.number(item.qty_return);
        const executedQty = helper.number(item.executed_qty);

        return {
          product_id: item.product_key || "--",
          product_sku: item.p_sku || item.mfg_pro_apr_sku || "--",
          product_name: item.p_name || "--",
          product_uom: item.units_name || "--",
          qty_return: qtyReturn,
          exe_qty: executedQty,
          remaining_qty: qtyReturn - executedQty,
          bom_id: item.mfg_pro_apr_bom || "--",
          bom_name: item.subject_name || "--",
          location_in: item.mfg_pro_location_in || "--",
          location_name: item.location_name || "--",
          fg_status: item.fg_status || "NG",
          remark: item.fg_out_remark || "--",
          fg_return_txn_id: item.mfg_pro_apr_transaction || "--",
          insert_dt: item.mfg_pro_apr_fulldate
            ? moment(item.mfg_pro_apr_fulldate, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss")
            : "--",
          insert_by: item.user_name || "N/A",
          transfer_stock_qty: helper.number(item.transfer_stock_qty),
        };
      });

      return res.json({ success: true, data: final, message: null });
    }

    return res.json({
      success: false,
      data: null,
      message: "no data were found that match the given search criteria",
    });
  } catch (err) {
    console.log(err);
    return res.json({
      success: false,
      data: null,
      message: "Internal Error !!! If this condition persists, contact your system administrator",
      error: err.stack,
    });
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
      success: false,
      data: null,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  try {
    const stmt = await invtDB.query("SELECT * FROM products WHERE product_key = :product_key", {
      replacements: { product_key: req.body.product_id },
      type: invtDB.QueryTypes.SELECT,
    });

    if (!stmt.length) {
      return res.json({
        success: false,
        data: null,
        message: "not an valid SKU",
      });
    }

    const product_name = stmt[0].p_name;
    const product_sku = stmt[0].p_sku;

    const stmt2 = await invtDB.query(
      `SELECT
        m3.*,
        bom_recipe.subject_id,
        bom_recipe.subject_name
      FROM mfg_production_3 m3
      LEFT JOIN products ON products.p_sku = m3.mfg_pro_apr_sku
      LEFT JOIN bom_recipe ON bom_recipe.subject_id = m3.mfg_pro_apr_bom
      WHERE products.product_key = :product_id
        AND m3.mfg_pro_apr_transaction = :fg_return_txn
        AND m3.type = 'TRANSFER'
        AND m3.fg_status = 'ACTIVE'
        AND m3.company_branch = :branch
        AND m3.mfg_pro_location_in = :locationKey`,
      {
        replacements: {
          product_id: req.body.product_id,
          fg_return_txn: req.body.fg_return_txn,
          branch: req.branch,
          locationKey: FG_RETURN_TRANSFER_LOCATION,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!stmt2.length) {
      return res.json({
        success: false,
        data: null,
        message: "We could not fetch any data linked with that SKU.",
      });
    }

    const qtyReturn = helper.number(stmt2[0].qty_return ?? stmt2[0].mfg_approve_in_qty);
    const executedQty = helper.number(stmt2[0].executed_qty ?? 0);
    const bomId = stmt2[0].mfg_pro_apr_bom || stmt2[0].subject_id;

    const header_data = {
      bom_id: bomId,
      bom: stmt2[0].subject_name,
      left_qty: qtyReturn - executedQty,
      remark: stmt2[0].fg_out_remark || "--",
      sku: product_sku,
      productname_sku: product_name + " / " + product_sku,
    };

    const comp_stmt = await invtDB.query(
      "SELECT * FROM `bom_recipe` LEFT JOIN `bom_quantity` ON `bom_recipe`.`subject_id` = `bom_quantity`.`subject_under` LEFT JOIN `components` ON `bom_quantity`.`component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `bom_recipe`.`subject_id` = :bom AND `components`.`c_is_enabled` = 'Y' AND `bom_quantity`.`bom_status` != 'I' GROUP BY `components`.`component_key` ORDER BY `components`.`c_name` ASC",
      {
        replacements: { bom: bomId },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!comp_stmt.length) {
      return res.json({
        success: false,
        data: null,
        msg: "We could not fetch any data linked with that SKU.",
      });
    }

    const comp_result = comp_stmt.map((comp_data) => ({
      key: comp_data.component_key,
      partno: comp_data.c_part_no,
      name: comp_data.c_name,
      qty: comp_data.qty,
      unit: comp_data.units_name,
      type: comp_data.bom_catergory,
    }));

    return res.json({
      success: true,
      message: null,
      data: { header_data: header_data, comp_data: comp_result },
    });
  } catch (err) {
    return res.json({
      success: false,
      message: "Internal Error!!! If this condition persists, contact your system administrator",
      status: "error",
      error: err.stack,
    });
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
      success: false,
      data: null,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  const transaction = await invtDB.transaction();

  try {
    const executeQty = helper.number(req.body.qty);
    if (executeQty < 1) {
      await transaction.rollback();
      return res.json({
        success: false,
        data: null,
        message: "zero value not acceptable",
      });
    }

    const productRows = await invtDB.query("SELECT * FROM products WHERE product_key = :product_key", {
      replacements: { product_key: req.body.product_id },
      type: invtDB.QueryTypes.SELECT,
      transaction,
    });

    if (!productRows.length) {
      await transaction.rollback();
      return res.json({
        success: false,
        data: null,
        message: "not an valid SKU",
      });
    }

    let stmt = await invtDB.query(
      `SELECT m3.*, products.p_sku
      FROM mfg_production_3 m3
      LEFT JOIN products ON products.p_sku = m3.mfg_pro_apr_sku
      WHERE products.product_key = :product_id
        AND m3.mfg_pro_apr_transaction = :fg_return_txn
        AND m3.type = 'TRANSFER'
        AND m3.fg_status = 'ACTIVE'
        AND m3.company_branch = :branch
        AND m3.mfg_pro_location_in = :locationKey`,
      {
        replacements: {
          product_id: req.body.product_id,
          fg_return_txn: req.body.fg_return_txn,
          branch: req.branch,
          locationKey: FG_RETURN_TRANSFER_LOCATION,
        },
        type: invtDB.QueryTypes.SELECT,
        transaction,
      }
    );

    let MaxInwardQtyis = 0;
    if (stmt.length > 0) {
      MaxInwardQtyis =
        helper.number(stmt[0].qty_return ?? stmt[0].mfg_approve_in_qty) - helper.number(stmt[0].executed_qty ?? 0);
      if (helper.number(MaxInwardQtyis) < executeQty) {
        await transaction.rollback();
        return res.json({
          success: false,
          data: null,
          message: "executing QTY is can't be accept",
        });
      }
    } else {
      await transaction.rollback();
      return res.json({
        success: false,
        data: null,
        message: "something happened wrong, contact to system administrator",
      });
    }

    const availableTransferQty = await getFgTransferStockQty(productRows[0].p_sku, req.branch || null, FG_RETURN_TRANSFER_LOCATION, transaction);
    if (executeQty > availableTransferQty) {
      await transaction.rollback();
      return res.json({
        success: false,
        data: null,
        message: `Insufficient FG transfer stock for ${productRows[0].p_name} (${productRows[0].p_sku}) at return location. Current Stock [${availableTransferQty}]`,
      });
    }

    let insertDate = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const transactionID = helper.getUniqueNumber();
    const executeRemark = (req.body.comment ?? "--").toString().trim() || "--";

    const transferConsume = await invtDB.query(
      "INSERT INTO mfg_production_3 (txn_session, company_branch, mfg_pro_apr_sku, mfg_pro_apr_bom, mfg_approve_in_qty, mfg_pro_apr_by, mfg_pro_apr_fulldate, mfg_pro_apr_transaction, mfg_ref_transid_1, mfg_ref_transid_2, mfg_pro_location_in, fgout_pro_location_out, mfgphase2_insert_date, type, fg_status, fg_out_remark, ppr_created_by, mfg_created_by) VALUES (:txn_session, :branch, :sku, :bom, :totalIn, :by, :fulldate, :transaction, :ppr_id, :mfg_id, :loc_in, :fgout_loc_out, :insertdate, 'TRANSFER', 'ACTIVE', :remark, :pprcreatedby, :mfgcreatedby)",
      {
        replacements: {
          txn_session: helper.generateTxnSession(),
          branch: req.branch,
          sku: productRows[0].p_sku,
          bom: stmt[0].mfg_pro_apr_bom,
          totalIn: executeQty,
          by: req.logedINUser,
          fulldate: insertDate,
          transaction: transactionID,
          ppr_id: req.body.fg_return_txn,
          mfg_id: "--",
          loc_in: "--",
          fgout_loc_out: FG_RETURN_TRANSFER_LOCATION,
          insertdate: insertDate,
          remark: executeRemark,
          pprcreatedby: req.logedINUser,
          mfgcreatedby: req.logedINUser,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction,
      }
    );

    if (!transferConsume.length) {
      await transaction.rollback();
      return res.json({
        success: false,
        data: null,
        message: "Failed to consume FG transfer stock for this return",
      });
    }

    for (let i = 0; i < req.body.component.length; i++) {
      if (req.body.comp_qty[i] != 0 || req.body.comp_qty[i] != "") {
        const stmt_bom_qty = await invtDB.query("SELECT * FROM bom_quantity WHERE subject_under = :bom AND component_id = :comp", {
          replacements: {
            bom: stmt[0].mfg_pro_apr_bom,
            comp: req.body.component[i],
          },
          type: invtDB.QueryTypes.SELECT,
        });

        let comp_stmt = await invtDB.query(
          "INSERT INTO rm_location (txn_session,company_branch,in_module,trans_type, inward_type, vendor_type,components_id,qty,mfg_bom_qty,loc_in,reversal_txn_id , fg_rtn_refid ,insert_date,insert_by,bom_subject_id,any_remark) VALUES(:txn_session,:branch, 'IN-FGRETURN', 'INWARD', 'FG-RETURN', 'p01', :component, :qty, :bom_qty, :loc_in, :txn_id , :fg_rtn_refid, :insert_date, :insert_by, :subject_id, :remark)",
          {
            replacements: {
              txn_session: helper.generateTxnSession(),
              branch: req.branch,
              component: req.body.component[i],
              qty: req.body.comp_qty[i],
              bom_qty: stmt_bom_qty[0].qty,
              loc_in: req.body.location,
              txn_id: req.body.fg_return_txn,
              fg_rtn_refid: transactionID,
              insert_date: insertDate,
              insert_by: req.logedINUser,
              subject_id: stmt[0].mfg_pro_apr_bom,
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
          executed_qty: executeQty,
          executed_remark: executeRemark,
          insert_by: req.logedINUser,
          insert_dt: insertDate,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      }
    );

    let stmt8 = await invtDB.query(
      "UPDATE mfg_production_3 SET executed_qty = COALESCE(executed_qty, 0) + :execute_qty WHERE ID = :id AND type = 'TRANSFER' AND fg_status = 'ACTIVE'",
      {
        replacements: {
          execute_qty: executeQty,
          id: stmt[0].ID,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      }
    );

    if (stmt8.length > 0) {
      await transaction.commit();
      return res.status(200).json({
        success: true,
        data: { transactionID },
        message: "FG Return Executed Successfully",
      });
    }

    await transaction.rollback();
    return res.json({
      success: false,
      data: null,
      message: "Internal Error !!! If this condition persists, contact your system administrator",
    });
  } catch (err) {
    console.log(err);
    await transaction.rollback();
    return res.json({
      success: false,
      data: null,
      message: "Internal Error !!! If this condition persists, contact your system administrator",
      err: err.stack,
    });
  }
});

router.post("/fetchReturnCompleted", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    date: "required",
  });
  if (validation.fails()) {
    return res.status(400).json({ success: false, message: { msg: helper.firstErrorValidatorjs(validation) } });
  }

  try {
    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    const stmt = await invtDB.query(
      `SELECT
        m3.mfg_pro_apr_transaction,
        m3.mfg_pro_apr_sku,
        m3.mfg_pro_apr_fulldate,
        COALESCE(NULLIF(m3.qty_return, 0), m3.mfg_approve_in_qty, 0) AS qty_return,
        COALESCE(m3.executed_qty, 0) AS executed_qty,
        m3.fg_out_remark,
        products.p_name,
        products.p_sku,
        admin_login.user_name AS outBy
      FROM mfg_production_3 m3
      LEFT JOIN products ON products.p_sku = m3.mfg_pro_apr_sku
      LEFT JOIN admin_login ON admin_login.CustID = m3.mfg_pro_apr_by
      WHERE m3.type = 'TRANSFER'
        AND m3.fg_status = 'ACTIVE'
        AND m3.company_branch = :branch
        AND m3.mfg_pro_location_in = :locationKey
        AND COALESCE(NULLIF(m3.qty_return, 0), m3.mfg_approve_in_qty, 0) > 0
        AND COALESCE(m3.executed_qty, 0) >= COALESCE(NULLIF(m3.qty_return, 0), m3.mfg_approve_in_qty, 0)
        AND DATE_FORMAT(m3.mfg_pro_apr_fulldate, '%Y-%m-%d') BETWEEN :date1 AND :date2
      ORDER BY m3.mfg_pro_apr_fulldate DESC, m3.ID DESC`,
      {
        replacements: {
          date1: date1,
          date2: date2,
          branch: req.branch,
          locationKey: FG_RETURN_TRANSFER_LOCATION,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length == 0) {
      return res.status(500).json({ success: false, message: "No data found" });
    }

    const data = stmt.map((item) => ({
      date: item.mfg_pro_apr_fulldate
        ? moment(item.mfg_pro_apr_fulldate, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY")
        : "--",
      txn_id: item.mfg_pro_apr_transaction || "--",
      sku: item.p_sku || item.mfg_pro_apr_sku || "--",
      name: item.p_name || "--",
      in_qty: helper.number(item.qty_return),
      exe_qty: helper.number(item.executed_qty),
      outBy: item.outBy || "N/A",
      remarks: item.fg_out_remark || "--",
    }));

    return res.status(200).json({ success: true, data: data });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal Error !!! If this condition persists, contact your system administrator", err: err.stack });
  }
});

module.exports = router;

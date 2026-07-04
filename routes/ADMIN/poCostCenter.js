const express = require("express");
const router = express.Router();

const auth = require("../../middleware/auth");
let { otherDB } = require("../../config/db/connection");

const Validator = require("validatorjs");


// MAP COSTCENTER WITH USER
router.post("/mapPoUserCostcenter", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      user_id: "required",
      costcenter_id: "required",
    });
    if (validation.fails()) {
      return res.json({ success: false, status: "error", message: validation.errors.all() });
    }

    let stmt_check = await otherDB.query("SELECT * FROM ims_po_user_costcenter WHERE user_id = :user_id AND cost_center = :costcenter_id", {
      replacements: {
        user_id: req.body.user_id,
        costcenter_id: req.body.costcenter_id,
      },
      type: otherDB.QueryTypes.SELECT,
    });

    if (stmt_check.length > 0) {
      return res.json({ success: false, status: "error", message: "Costcenter already mapped" });
    }

    const stmt_map = await otherDB.query("INSERT INTO ims_po_user_costcenter( user_id, cost_center, insert_by, insert_dt) VALUES ( :user_id, :costcenter_id, :insert_by, :insert_dt ) ", {
      replacements: {
        user_id: req.body.user_id,
        costcenter_id: req.body.costcenter_id,
        insert_by: req.logedINUser,
        insert_dt: moment(new Date()).format("YYYY-MM-DD"),
      },
      type: otherDB.QueryTypes.INSERT,
    });

    if (stmt_map.length > 0) {
      return res.json({ success: true, status: "success", message: "Costcenter added" });
    } else {
      return res.json({ success: false, status: "error", message: "Internal Error" });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH MAPPED USER COST CENTER
router.get("/fetchPoUserCostcenter", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await otherDB.query(
      `SELECT user.user_name AS user_name , cost_center_name, user.CustID AS user_id, cost.cost_center_key AS costcenter_key FROM ims_po_user_costcenter LEFT JOIN ${global.ims_db_name}.admin_login user ON user.CustID = ims_po_user_costcenter.user_id LEFT JOIN ${global.ims_db_name}.cost_center cost ON cost.cost_center_key = ims_po_user_costcenter.cost_center`,
      {
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      return res.json({ success: true, status: "success", data: stmt });
    } else {
      return res.json({ success: false, status: "error", message: "No Data Available!!!" });
    }
  } catch (e) {
    return helper.errorResponse(res, e);
  }
});

//Delete Mapped User Cost Center
router.post("/deletePOUserCostcenter", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    user_id: "required",
    costcenter_id: "required",
  });

  if (validation.fails()) {
    return res.json({ success: false, message:  "something you missing" , data: validation.errors.all(), status: "error" });
  }

  const transactionOt = await otherDB.transaction();

  try {
    let pagestsmt = await otherDB.query("SELECT user_id, cost_center FROM `ims_po_user_costcenter` WHERE `user_id` = :user_id AND `cost_center` = :costcenter_id", {
      replacements: { user_id: req.body.user_id, costcenter_id: req.body.costcenter_id },
      type: otherDB.QueryTypes.SELECT,
    });
    if (pagestsmt.length > 0) {
      let stmt1 = await otherDB.query("DELETE FROM `ims_po_user_costcenter` WHERE `user_id` = :user_id AND `cost_center` = :costcenter_id", {
        replacements: { user_id: req.body.user_id, costcenter_id: req.body.costcenter_id },
        type: otherDB.QueryTypes.DELETE,
        transaction: transactionOt,
      });
      await transactionOt.commit();
      return res.json({ success: true, message: "User deleted successfully", status: "success" });
    } else {
      transactionOt.rollback();
      return res.json({ success: false, message:"No User found" , status: "error" });
    }
  } catch (err) {
    transactionOt.rollback();
    return helper.errorResponse(res, err);
  }
});

module.exports = router;

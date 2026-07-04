const express = require("express");
const router = express.Router();

let { invtDB, refbDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const { encode, decode } = require("html-entities");


const Validator = require("validatorjs");

// GET LAST BOX NUMBER
router.post("/getMarkupID", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query("SELECT box_loc_in FROM tbl_box_markup WHERE box_trans_type = 'INWARD' ORDER BY LENGTH(box_loc_in) DESC, box_loc_in DESC LIMIT 0,1", {
      replacements: { type: "INWARD" },
      type: invtDB.QueryTypes.SELECT,
    });
    let markupCode;

    if (stmt.length > 0) {
      min_last_box = stmt[0].box_loc_in;
      let strings = min_last_box.replace(/[0-9]/g, "");
      let digits = parseInt(min_last_box.replace(/[^0-9]/g, "")).toString();
      if (digits.length < 3) digits = ("0" + digits).substr(-2);
      markupCode = digits;
    } else {
      markupCode = "00";
    }
    return res.json({ status: "success", success: true, message: "", data: { markupCode: parseInt(markupCode) } });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// GET MINS FOR MARKUP
router.post("/getMinsTransaction4Markup", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.searchTerm == "" || req.body.searchTerm == undefined || req.body.searchTerm == null) {
      stmt = await invtDB.query("SELECT in_transaction_id FROM `rm_location` GROUP BY `in_transaction_id` WHERE `qty` != `settle_qty` ORDER BY `insert_date` DESC LIMIT :limit", {
        replacements: { limit: 50 },
        type: invtDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await invtDB.query("SELECT `in_transaction_id` FROM `rm_location` WHERE (`in_transaction_id` LIKE :search OR `in_vendor_name` LIKE :search) AND `qty` != `settle_qty` GROUP BY `in_transaction_id` ORDER BY `insert_date` DESC LIMIT :limit", {
        replacements: { search: "%" + req.body.searchTerm + "%", limit: 50 },
        type: invtDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let result = [];

      const length = stmt.length;

      for (let i = 0; i < length; i++) {
        result.push({ id: stmt[i].in_transaction_id, text: stmt[i].in_transaction_id });
      }

      return res.json({ status: "success", success: true, message: "", data: result });
    } else {
      return res.json({ status: "error", success: false, message: "MIN not found" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});
// GET MINS FOR MARKUP
router.post("/getMarkupedMins", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.searchTerm == "" || req.body.searchTerm == undefined || req.body.searchTerm == null) {
      stmt = await invtDB.query("SELECT in_transaction_id FROM `rm_location` GROUP BY `in_transaction_id` WHERE  `settle_qty` != '0' ORDER BY `insert_date` DESC LIMIT :limit", {
        replacements: { limit: 50 },
        type: invtDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await invtDB.query("SELECT `in_transaction_id` FROM `rm_location` WHERE (`in_transaction_id` LIKE :search OR `in_vendor_name` LIKE :search) AND `settle_qty` != '0' GROUP BY `in_transaction_id` ORDER BY `insert_date` DESC LIMIT :limit", {
        replacements: { search: "%" + req.body.searchTerm + "%", limit: 50 },
        type: invtDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let result = [];

      const length = stmt.length;

      for (let i = 0; i < length; i++) {
        result.push({ id: stmt[i].in_transaction_id, text: stmt[i].in_transaction_id });
      }

      return res.json({ status: "success", success: true, message: "", data: result });
    } else {
      return res.json({ status: "error", success: false, message: "MIN not found" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/getComponents", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query("SELECT `in_transaction_id`,`qty`,`settle_qty`,`components_id` FROM `rm_location` WHERE `in_transaction_id` = :min_transaction_id AND `trans_type` = 'INWARD'", {
      replacements: { min_transaction_id: req.body.transaction },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt1.length > 0) {
      var data = [];
      for (let i = 0; i < stmt1.length; i++) {
        let stmt2 = await invtDB.query("SELECT `c_part_no`,`c_name`,`units_name` FROM `components` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `components`.`component_key` = :component_key", {
          replacements: { component_key: stmt1[i].components_id },
          type: invtDB.QueryTypes.SELECT,
        });
        if (stmt2.length > 0) {
          data.push({
            min_no: stmt1[i].in_transaction_id,
            part_code: stmt2[0].c_part_no,
            part_id: stmt1[i].components_id,
            part_name: stmt2[0].c_name,
            part_uom: stmt2[0].units_name,
            qty: Number(stmt1[i].qty) - Number(stmt1[i].settle_qty),
          });
        }
      }
      return res.json({ status: "success", success: true, message: "", data: data });
    } else {
      return res.json({ status: "error", success: false, message: "MIN not found" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// SAVE SETTLE

router.post("/saveSattle", [auth.isAuthorized, auth.checkDuplicacy_db], async (req, res) => {
  const transaction = await invtDB.transaction();

  try {
    let validation = new Validator(req.body, {
      min_no: "required",
      part_id: "required",
    });

    if (validation.fails()) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
    }

    let box_length = req.body.box_no.length;

    if (box_length <= 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Please fill atleast one box" });
    }

    if (box_length != req.body.item_qty.length) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Something wrong Please try Again!!!" });
    }

    for (let i = 0; i < box_length; i++) {
      let valid = new Validator(
        {
          box_no: req.body.box_no[i],
          item_qty: req.body.item_qty[i],
        },
        {
          box_no: "required",
          item_qty: "required|min:1",
        }
      );

      if (valid.fails()) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
      }
    }

    const total_box_item_qty = req.body.item_qty.reduce((partialSum, a) => Number(partialSum) + Number(a), 0);

    if (total_box_item_qty != Number(req.body.min_qty)) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: `Min QTY (${req.body.min_qty}) != Total Item In Box Qty  (${total_box_item_qty} )` });
    }

    let total_qty = 0;
    let stmt0;
    for (let i = 0; i < box_length; i++) {
      stmt0 = await invtDB.query("SELECT * FROM `rm_location` WHERE `components_id` = :components_id AND `in_transaction_id` = :in_transaction_id ", {
        replacements: { components_id: req.body.part_id, in_transaction_id: req.body.min_no },
        type: invtDB.QueryTypes.SELECT,
      });

      if (stmt0[0].qty == stmt0[0].settle_qty) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Please check settle QTY" });
      }

      let stmt_box_check = await invtDB.query("SELECT * FROM `tbl_box_markup` WHERE `box_loc_in` = :location", {
        replacements: { location: req.body.box_no[i] },
        type: invtDB.QueryTypes.SELECT,
      });
      if (stmt_box_check.length > 0) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: `BOX No. ${req.body.box_no[i]} Already Exist!!!` });
      }

      total_qty += Number(req.body.item_qty[i]);
      let stmt1 = await invtDB.query("INSERT INTO `tbl_box_markup` (`box_trans_type`, `box_component_id` , `box_loc_in`, `box_qty` , `box_in_transaction_id` , `insert_date` , `insert_by`) VALUES ( :trans_type,:components_id , :loc_in , :qty , :in_transaction_id , :insert_date , :insert_by) ", {
        replacements: {
          trans_type: "INWARD",
          components_id: req.body.part_id,
          loc_in: req.body.box_no[i],
          qty: req.body.item_qty[i],
          in_transaction_id: req.body.min_no,
          insert_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
          insert_by: req.logedINUser,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      });
    }

    let stmt_update = await invtDB.query("UPDATE `rm_location` SET `settle_qty` = :settle_qty WHERE `components_id` = :components_id AND `in_transaction_id` = :in_transaction_id", {
      replacements: {
        components_id: req.body.part_id,
        in_transaction_id: req.body.min_no,
        settle_qty: Number(total_qty) + Number(stmt0[0].settle_qty),
      },
      type: invtDB.QueryTypes.UPDATE,
      transaction: transaction,
    });

    if (stmt_update.length > 0) {
      await transaction.commit();
      return res.json({ status: "success", success: true, message: "Transaction successfull...", data: {} });
    } else {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Something wrong, Please try again" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});


// FTECH BOXS
router.post("/getBoxes", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query("SELECT tbl_box_markup.box_loc_in , tbl_box_markup.box_qty , components.c_name , components.c_part_no FROM tbl_box_markup LEFT JOIN components ON components.component_key = tbl_box_markup.box_component_id WHERE box_in_transaction_id = :min_trans ", {
      replacements: { min_trans: req.body.transaction },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          box_no: stmt[i].box_loc_in,
          qty: stmt[i].box_qty,
          part_name: stmt[i].c_name,
          part_code: stmt[i].c_part_no,
        });
      }

      return res.json({ status: "success", success: true, message: "", data: final });
    } else {
      return res.json({ status: "error", success: false, message: "BOX Not Found" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// GET BOXES BY COMPONENET
// FETCH MIN INFORMATION FOR SETTLE
router.post("/fetchAvailableStockBoxes", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query("SELECT box_loc_in FROM tbl_box_markup WHERE box_component_id = :component AND (box_trans_type = 'INWARD' OR box_trans_type = 'TRANSFER') AND box_in_flag != 'F' GROUP BY box_loc_in ORDER BY box_loc_in ASC", {
      replacements: {
        component: req.body.component,
      },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt1.length > 0) {
      let data = [];
      let inward_all_qty = 0,
        outward_all_qty = 0;

      for (let i = 0; i < stmt1.length; i++) {
        //ALL INWARD
        let stmt2 = await invtDB.query("SELECT COALESCE(SUM(box_qty), 0) AS Inward FROM tbl_box_markup WHERE box_component_id = :component AND (box_trans_type = 'INWARD' OR box_trans_type = 'TRANSFER') AND box_loc_in = :location", {
          replacements: {
            component: req.body.component,
            location: stmt1[i].box_loc_in,
          },
          type: invtDB.QueryTypes.SELECT,
        });

        if (stmt2.length > 0) {
          inward_all_qty = helper.number(stmt2[0].Inward);
        } else {
          inward_all_qty = 0;
        }

        // ALL OUTWARD
        let stmt3 = await invtDB.query("SELECT COALESCE(SUM(box_qty), 0) AS Outward FROM tbl_box_markup WHERE box_component_id = :component AND (box_trans_type = 'ISSUE') AND box_loc_out = :location", {
          replacements: {
            component: req.body.component,
            location: stmt1[i].box_loc_in,
          },
          type: invtDB.QueryTypes.SELECT,
        });

        if (stmt3.length > 0) {
          outward_all_qty = helper.number(stmt3[0].Outward);
        } else {
          outward_all_qty = 0;
        }

        data.push({
          stock: inward_all_qty - outward_all_qty,
          box_name: stmt1[i].box_loc_in,
        });
      }
      return res.json({ status: "success", success: true, message: "", data: data });
    } else {
      return res.json({ status: "error", success: false, message: "no data found" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});


module.exports = router;

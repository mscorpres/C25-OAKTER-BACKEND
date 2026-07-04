const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

let { tallyDB } = require("../../../config/db/connection");

const Validator = require("validatorjs");

//LIST OF TDS NATURE
router.get("/nature_of_tds", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT `tally_tds`.`tds_gl_code`, `tds_code` , `tds_name`, `tds_description` , `tds_percent` , `tds_key` , `ladger_name` , `tally_ledger`.`code` as gl_code FROM `tally_tds` LEFT JOIN `tally_ledger` ON `tally_tds`.`tds_gl_code`= `tally_ledger`.`ledger_key`", {
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          tds_key: stmt[i].tds_key,
          tds_code: stmt[i].tds_code,
          name: stmt[i].tds_name,
          desc: stmt[i].tds_description,
          percentage: stmt[i].tds_percent,
          gl_code: "(" + stmt[i].gl_code + ")" + stmt[i].ladger_name,
          gl_key: stmt[i].tds_gl_code,
        });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// Add New Nature of Tds
router.post("/add_new_nature_of_tds", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    code: "required",
    name: "required",
    description: "required",
    percentage: "required",
    ledger: "required",
  });

  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let check_stmt = await tallyDB.query("SELECT * FROM `tally_tds` WHERE `tds_code` = :code", {
      replacements: { code: req.body.code },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (check_stmt.length > 0) {
      return res.json({ status: "error", success: false, message: "TDS code already alloted" });
    } else {
      let chesk_ledger_stmt = await tallyDB.query("SELECT * FROM `tally_ledger` WHERE `ledger_key` = :gl_code", {
        replacements: { gl_code: req.body.ledger },
        type: tallyDB.QueryTypes.SELECT,
      });
      if (chesk_ledger_stmt.length > 0) {
        let insert_stmt = await tallyDB.query("INSERT INTO `tally_tds` (`tds_name`, `tds_code`, `tds_description`, `tds_percent`, `tds_gl_code`, `tds_key`, `insert_by`, `insert_date`)VALUES (:tds_name, :tds_code , :tds_description, :tds_percent, :tds_gl_code, :tds_key, :insert_by, :insert_date)", {
          replacements: {
            tds_name: req.body.name,
            tds_code: req.body.code,
            tds_description: req.body.description,
            tds_percent: req.body.percentage,
            tds_gl_code: req.body.ledger,
            tds_key: "TDS" + helper.getUniqueNumber(),
            insert_by: req.logedINUser,
            insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"), //date("Y-m-d H:i:s"),
          },
          type: tallyDB.QueryTypes.INSERT,
        });

        if (insert_stmt.length > 0) {
          return res.json({ status: "success", success: true, message: "Nature Of TDS created...." });
        } else {
          return res.json({ status: "error", success: false, message: "Something went wrong to create Nature of TDS" });
        }
      } else {
        return res.json({ status: "error", success: false, message: "G/L code is not valid" });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// Fetch TDS By KEy For UPDATE
router.post("/fetch_nature_of_tds_update", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    tds_key: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.fails() });
  }

  try {
    let stmt = await tallyDB.query("SELECT `tally_tds`.* ,`tally_ledger`.`ladger_name`,`tally_ledger`.`code` FROM `tally_tds` LEFT JOIN `tally_ledger` ON `tally_ledger`.`ledger_key` =`tally_tds`.`tds_gl_code` WHERE `tds_key` = :tds_key", {
      replacements: { tds_key: req.body.tds_key },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      let data = {
        tds_code: stmt[0].tds_code,
        tds_name: stmt[0].tds_name,
        tds_description: stmt[0].tds_description,
        tds_percent: stmt[0].tds_percent,
        tds_key: stmt[0].tds_key,
        tds_gl_code: stmt[0].tds_gl_code,
        tds_gl: `(${stmt[0].code})` + stmt[0].ladger_name,
      };
      return res.json({ status: "success", success: true, data: data });
    } else {
      return res.json({ status: "error", success: false, message: "Something went wrong !!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE NATURE OF TDS
router.post("/update_new_nature_of_tds", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    code: "required",
    name: "required",
    description: "required",
    percentage: "required",
    ledger: "required",
    tds_key: "required",
  });

  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let check_stmt = await tallyDB.query("SELECT * FROM `tally_tds` WHERE `tds_code` = :tds_code AND `tds_key` != :tds_key", {
      replacements: { tds_code: req.body.code, tds_key: req.body.tds_key },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (check_stmt.length > 0) {
      return res.json({ status: "error", success: false, message: "'TDS code already alloted" });
    } else {
      let check_ledger = await tallyDB.query("SELECT * FROM `tally_ledger` WHERE `ledger_key` = :gl_code", {
        replacements: { gl_code: req.body.ledger },
        type: tallyDB.QueryTypes.SELECT,
      });

      if (check_ledger.length > 0) {
        let update_stmt = await tallyDB.query("UPDATE `tally_tds` SET `tds_name` = :tds_name, `tds_code` = :tds_code , `tds_description` = :tds_description, `tds_percent` = :tds_percent, `tds_gl_code` = :tds_gl_code, `upadte_by` = :upadte_by ,`update_date` = :update_date WHERE `tds_key` = :tds_key", {
          replacements: {
            tds_name: req.body.name,
            tds_code: req.body.code,
            tds_description: req.body.description,
            tds_percent: req.body.percentage,
            tds_gl_code: req.body.ledger,
            tds_key: req.body.tds_key,
            upadte_by: req.logedINUser,
            update_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"), //date("Y-m-d H:i:s"),
          },
        });

        if (update_stmt.length > 0) {
          return res.json({ status: "success", success: true, message: "TDS updated.." });
        } else {
          return res.json({ status: "error", success: false, message: "Updatation Failed...." });
        }
      } else {
        return res.json({ status: "error", success: false, message: "G/L code is not valid" });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// ONLY TDS GROUP LEDGERS OPTION
router.post("/tds_ledger_options", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE sub_group_key = 'TP20220219125803' LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE sub_group_key = 'TP20220219125803' AND (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({
          id: item.ledger_key,
          text: `(${item.code})${item.ladger_name}`,
        });
      });
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Gl Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

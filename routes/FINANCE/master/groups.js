const express = require("express");
const router = express.Router();

let { tallyDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");

// CREATE NEW MASTER GROUP
router.post("/create_master_group", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    group_name: "required",
    code: "required",
  });

  if (validation.fails()) {
    return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let check_stmt = await tallyDB.query("SELECT * FROM `tally_group` WHERE `group_name` = :group_name OR `code` =:code", {
      replacements: { group_name: req.body.group_name, code: req.body.code },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (check_stmt.length > 0) {
      return res.json({ message: "Group Allready Available...", status: "error", success: false });
    } else {
      let stmt = await tallyDB.query("INSERT INTO `tally_group` (`group_name`,`group_key`,`insert_date`,`inserted_by`,`code`)VALUES (:group_name,:group_key,:insertdate,:inserted_by,:code)", {
        replacements: {
          group_name: req.body.group_name,
          insertdate: moment().format("YYYY-MM-DD hh:mm:ss"),
          inserted_by: req.logedINUser,
          group_key: "TP" + helper.getUniqueNumber(),
          code: req.body.code,
        },
        type: tallyDB.QueryTypes.INSERT,
      });

      if (stmt.length > 0) {
        return res.json({ status: "success", success: true, message: "Group Added Successfully...." });
      } else {
        return res.json({ status: "error", success: false, message: "Something wrong! group not created" });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});
//GET MASTER GROUP LIST
router.get("/master_group_list", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT group_name,code FROM `tally_group` WHERE `parent`='--' ORDER BY `id` DESC", {
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      return res.json({ status: "success", success: true, data: stmt });
    } else {
      return res.json({ status: "error", success: false, message: "No Master Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// CREATE NEW SUB GROUP
router.post("/create_sub_group", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    group_name: "required",
    code: "required",
    parent: "required",
  });

  if (validation.fails()) {
    return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let check_stmt = await tallyDB.query("SELECT * FROM `tally_group` WHERE `group_name` = :group_name OR `code` =:code", {
      replacements: { group_name: req.body.group_name, code: req.body.code },
      type: tallyDB.QueryTypes.SELECT,
    });
    if (check_stmt.length > 0) {
      return res.json({ message: "Sub Group Allready Available...", status: "error", success: false });
    } else {
      let stmt = await tallyDB.query("INSERT INTO `tally_group` (`group_name`,`group_key`,`insert_date`,`inserted_by`,`code`, `parent`)VALUES (:group_name,:group_key,:insertdate,:inserted_by,:code, :parent)", {
        replacements: {
          group_name: req.body.group_name.trim(),
          insertdate: moment().format("YYYY-MM-DD hh:mm:ss"),
          inserted_by: req.logedINUser,
          group_key: "TP" + helper.getUniqueNumber(),
          code: req.body.code.trim(),
          parent: req.body.parent,
        },
        type: tallyDB.QueryTypes.INSERT,
      });

      if (stmt.length > 0) {
        return res.json({ status: "success", success: true, message: "Group Added Successfully...." });
      } else {
        return res.json({ status: "error", success: false, message: "Something wrong! group not Created" });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// Fetch All Group
router.get("/sub_group_list", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT tally_group.group_name,tally_group.code , t2.group_name AS parent FROM `tally_group` LEFT JOIN tally_group AS t2 ON tally_group.parent=t2.group_key  WHERE `tally_group`.`parent` != '--' ORDER BY `tally_group`.`id` DESC", {
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      return res.json({ status: "success", success: true, data: stmt });
    } else {
      return res.json({ status: "error", success: false, message: "No Sub-Group Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// Fetch All Group In Tree
router.get("/sub_group_tree", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT group_name,code,group_key,parent  FROM `tally_group`", {
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      tree = (function (data, root) {
        var t = {};
        data.forEach(({ code, group_name, group_key, parent }) => {
          Object.assign((t[group_key] = t[group_key] || {}), { key: group_name, label: `${group_name}(${code})`, Group_key: group_key });
          t[parent] = t[parent] || {};
          t[parent].nodes = t[parent].nodes || [];
          t[parent].nodes.push(t[group_key]);
        });
        return t[root].nodes;
      })(stmt, "--");

      return res.json({ status: "success", success: true, data: tree });
    } else {
      return res.json({ status: "error", success: false, message: "No Sub-Group Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// Fetch ALL Group For Select Option
router.post("/getSubgroup", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == undefined || req.body.search == "") {
      stmt = await tallyDB.query("SELECT code , group_name , group_key FROM `tally_group` LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT code , group_name , group_key FROM `tally_group` WHERE code LIKE :search OR group_name LIKE :search  LIMIT 50", {
        replacements: { search: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }
    if (stmt.length > 0) {
      let final = [];
      stmt.map((item) => {
        final.push({ id: item.group_key, label: `${item.group_name} ( ${item.code} ) ` });
        if (final.length == stmt.length) {
          return res.json({ status: "success", success: true, data: final });
        }
      });
    } else {
      return res.json({ status: "error", success: false, message: "No Sub-Group Found" });
    }
  } catch (err) {
    return res.status({ code: 500, status: "error", message: "Internal Error<br/>If this condition persists, contact your system administrator", err: err.stack });
  }
});

module.exports = router;

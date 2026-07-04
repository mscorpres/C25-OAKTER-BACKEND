const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB, invtOakterDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");

// get all Groups
router.get("/allGroups", [auth.isAuthorized], async (req, res) => {

	try {

		const result = await invtDB.query("SELECT * FROM all_groups", { type: invtDB.QueryTypes.SELECT });

		if (result.length > 0) {
			return res.json({ status: "success", success: true, message: "", data: result });
		} else {
			return res.json({ status: "error", success: false, message: "No Group Found!!!" });
		}

	}
	catch (error) {
		return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: error.stack }) });
	}

});

// insert new Group
router.post("/insert", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    group_name: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Group name required",
    });
  }

  const groupName = helper.trimString(req.body.group_name);
  const groupId = "GRP" + Date.now();

  let tx1, tx2;

  try {
    [tx1, tx2] = await Promise.all([
      invtDB.transaction(),
      invtOakterDB.transaction(),
    ]);

    const check = await invtDB.query(
      "SELECT 1 FROM all_groups WHERE group_name = :group_name LIMIT 1",
      {
        replacements: { group_name: groupName },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (check.length > 0) {
      await tx1.rollback();
      await tx2.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Group already exists",
      });
    }

    const insertSQL = `
      INSERT INTO all_groups (group_name, group_id)
      VALUES (:group_name, :group_id)
    `;

    const payload = {
      group_name: groupName,
      group_id: groupId,
    };

    await Promise.all([
      invtDB.query(insertSQL, {
        replacements: payload,
        type: invtDB.QueryTypes.INSERT,
        transaction: tx1,
      }),
      invtOakterDB.query(insertSQL, {
        replacements: payload,
        type: invtOakterDB.QueryTypes.INSERT,
        transaction: tx2,
      }),
    ]);

    await Promise.all([tx1.commit(), tx2.commit()]);

    return res.json({
      status: "success",
      success: true,
      message: "Group created successfully",
      data: {},
    });
  } catch (error) {
    if (tx1) await tx1.rollback();
    if (tx2) await tx2.rollback();

    return helper.errorResponse(res, error);
  }
});


// Fetch Group for SELECT 2
router.post("/groupSelect2", [auth.isAuthorized], async (req, res) => {
	try {
		const result = await invtDB.query("SELECT `group_id`, `group_name` FROM `all_groups`", { type: invtDB.QueryTypes.SELECT });
		let data = [];

		result.map((item) => {
			data.push({ id: item.group_id, text: item.group_name });
		});

		return res.json({ status: "success", success: true, data: data });
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});


// GET ALL GROUPS
// router.get("/refurbish/allGroups", [auth.isAuthorized], async (req, res) => {
// 	try {
// 		const result = await refbDB.query("SELECT * FROM all_groups", { type: refbDB.QueryTypes.SELECT });
// 		return res.json({ status: "success", success: true, message: "", data: result });
// 	} catch (error) {
// 	    return helper.errorResponse(res, error);
// 	}
// });

// Fetch Group for SELECT 2
// router.post("/refurbish/groupSelect2", [auth.isAuthorized], async (req, res) => {
// 	try {
// 		const result = await refbDB.query("SELECT `group_id`, `group_name` FROM `all_groups`", { type: refbDB.QueryTypes.SELECT });
// 		let data = [];

// 		result.map((item) => {
// 			data.push({ id: item.group_id, text: item.group_name });
// 		});

// 		return res.json({ status: "success", success: true, message: "", data: data });
// 	} catch (error) {
// 	    return helper.errorResponse(res, error);
// 	}
// });

module.exports = router;

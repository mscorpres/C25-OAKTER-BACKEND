const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/auth");
let { invtDB, invtOakterDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");
const helper = require("../../../../helper/helper");

// get all Subgroups
router.get("/list", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query(
      "SELECT all_sub_groups.*, all_groups.group_name FROM all_sub_groups LEFT JOIN all_groups ON all_sub_groups.group_id = all_groups.group_id",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length == 0) {
      return res.json({
        success: false,
        status: "error",
        message: "No Subgroup Found!!!",
      });
    }

    const response = [];
    for (let i = 0; i < result.length; i++) {
      response.push({
        group: { name: result[i].group_name, key: result[i].group_id },
        subGroup: {
          name: result[i].sub_group_name,
          key: result[i].sub_group_id,
        },
        subGroupDesc:
          result[i].sub_group_desc == "--"
            ? "description not added"
            : result[i].sub_group_desc,
        createdAt: result[i].insert_dt,
      });
    }
    return res.json({ success: true, status: "success", data: response });
  } catch (err) {
    console.log(err);
    return res.json({
      success: false,
      message:
        "Internal Error!!!If this condition persists, contact your system administrator",
      status: "error",
    });
  }
});

// add new Subgroup
router.post("/add", [auth.isAuthorized], async (req, res) => {
  const validationRules = {
    groupId: "required|string",
    subGroupName: "required|string|max:100",
    subGroupDesc: "string|max:255",
  };

  const validation = new Validator(req.body, validationRules);
  if (validation.fails()) {
    return res.json({
      success: false,
      status: "error",
      message:
        "Something is missing in the request.\nPlease contact to your system administrator.",
    });
  }

  const { groupId, subGroupName, subGroupDesc } = req.body;
  const subGroupId = helper.getUniqueTxnID();

  let tx1, tx2;

  try {
    [tx1, tx2] = await Promise.all([
      invtDB.transaction(),
      invtOakterDB.transaction(),
    ]);

    const checkGroup = await invtDB.query(
      "SELECT 1 FROM all_groups WHERE group_id = :groupId LIMIT 1",
      {
        replacements: { groupId },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (checkGroup.length === 0) {
      await tx1.rollback();
      await tx2.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "Group not found",
      });
    }

    const checkExist = await invtDB.query(
      `SELECT 1 
       FROM all_sub_groups 
       WHERE group_id = :groupId
       LIMIT 1`,
      {
        replacements: { groupId },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (checkExist.length > 0) {
      await tx1.rollback();
      await tx2.rollback();
      return res.json({
        success: false,
        status: "error",
        message:
          "Either the Group is already mapped",
      });
    }

    const insertSQL = `
      INSERT INTO all_sub_groups
      (group_id, sub_group_id, sub_group_name, sub_group_desc, insert_dt, insert_by)
      VALUES
      (:group_id, :sub_group_id, :sub_group_name, :sub_group_desc, :insert_dt, :insert_by)
    `;

    const payload = {
      group_id: groupId,
      sub_group_id: subGroupId,
      sub_group_name: subGroupName,
      sub_group_desc: subGroupDesc,
      insert_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
      insert_by: req.logedINUser,
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
      success: true,
      status: "success",
      message: "Sub-Group Added Successfully",
    });
  } catch (err) {
    if (tx1) await tx1.rollback();
    if (tx2) await tx2.rollback();

    return helper.errorResponse(res, err);
  }
});

// Delete Subgroup
router.delete("/delete/:subGroup", [auth.isAuthorized], async (req, res) => {
  const validationRules = {
    subGroup: "required|string",
  };
  const validation = new Validator(req.params, validationRules);
  if (validation.fails()) {
    return res.json({
      success: false,
      status: "error",
      message:
        "Something is missing in the request.\nPlease contact to your system administrator.",
    });
  }

  try {
    const { subGroup } = req.params;
    const result = await invtDB.query(
      "DELETE FROM all_sub_groups WHERE sub_group_id = :subGroup",
      {
        replacements: { subGroup: subGroup },
        type: invtDB.QueryTypes.DELETE,
      }
    );
    return res.json({
      success: true,
      status: "success",
      message: "Sub-Group Deleted",
    });
  } catch (err) {
    return res.json({
      success: false,
      message:
        "Internal Error!!!If this condition persists, contact your system administrator",
      status: "error",
    });
  }
});

// update Subgroup
router.put("/edit/:subGroup", [auth.isAuthorized], async (req, res) => {
  const validationRules = {
    groupId: "required|string",
    subGroupName: "required|string|max:100",
    subGroupDesc: "string|max:255",
  };

  const validation = new Validator(req.body, validationRules);
  if (validation.fails()) {
    return res.json({
      success: false,
      status: "error",
      message:
        "Something is missing in the request.\nPlease contact to your system administrator.",
    });
  }

  const { subGroup } = req.params;
  const { groupId, subGroupName, subGroupDesc } = req.body;

  let tx1, tx2;

  try {
    [tx1, tx2] = await Promise.all([
      invtDB.transaction(),
      invtOakterDB.transaction(),
    ]);

    const [data] = await invtDB.query(
      `
      SELECT 
          sg.ID AS subGroupId,
          g.group_id AS validGroup,
          m.ID AS mappedGroup
       FROM all_sub_groups sg
       LEFT JOIN all_groups g 
            ON g.group_id = :groupId
       LEFT JOIN all_sub_groups m
            ON m.group_id = :groupId AND m.sub_group_id != :subGroup
       WHERE sg.sub_group_id = :subGroup
       LIMIT 1
      `,
      {
        replacements: { subGroup, groupId },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (!data) {
      await tx1.rollback();
      await tx2.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "Sub-Group not found",
      });
    }

    if (!data.validGroup) {
      await tx1.rollback();
      await tx2.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "Group not found",
      });
    }

    if (data.mappedGroup) {
      await tx1.rollback();
      await tx2.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "This Group is already mapped with another Sub-Group",
      });
    }

    const updateSQL = `
      UPDATE all_sub_groups 
      SET sub_group_name = :subGroupName,
          sub_group_desc = :subGroupDesc,
          group_id = :groupId
      WHERE sub_group_id = :subGroup
    `;

    const payload = {
      subGroup,
      subGroupName,
      subGroupDesc,
      groupId,
    };

    await Promise.all([
      invtDB.query(updateSQL, {
        replacements: payload,
        type: invtDB.QueryTypes.UPDATE,
        transaction: tx1,
      }),
      invtOakterDB.query(updateSQL, {
        replacements: payload,
        type: invtOakterDB.QueryTypes.UPDATE,
        transaction: tx2,
      }),
    ]);

    await Promise.all([tx1.commit(), tx2.commit()]);

    return res.json({
      success: true,
      status: "success",
      message: "Sub-Group Updated Successfully",
    });
  } catch (err) {
    if (tx1) await tx1.rollback();
    if (tx2) await tx2.rollback();

    return helper.errorResponse(res, err);
  }
});

module.exports = router;

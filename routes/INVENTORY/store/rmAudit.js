const express = require("express");
const router = express.Router();

let { invtDB } = require("../../../config/db/connection");

const { encode, decode } = require("html-entities");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

//STOCK CHECK
router.post("/RMStock", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    component: "required",
  });

  if (validation.fails()) {
    res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
    return;
  }

  // return res.json({
  //   status: "error",
  //   success: false,
  //   message: "This Utility is disabled",
  // });

  try {
    let location_key = "";
    // A21 R1 store LOCATION
    if (req.branch == "BRALWR36") {
      location_key = "202381510340465";
    }
    // B29 R1 store LOCATION
    if (req.branch == "BRMSC029") {
      location_key = "2023815103533746";
    }

    // BRANCH R1 store STOCK LOCATION
    let stmt_get_a21 = await invtDB.query(
      "SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: location_key },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let all_branch__location = [];
    if (stmt_get_a21.length > 0) {
      for (let loc_i = 0; loc_i < stmt_get_a21.length; loc_i++) {
        all_branch__location = stmt_get_a21[loc_i].locations.split(",");
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Branch Location Not Found, contact to administrator",
      });
    }

    //ALL INWARD
    let stmt6 = await invtDB.query(
      "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_in` IN (:location)",
      {
        replacements: {
          component: req.body.component,
          location: all_branch__location,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let inward_all_qty = 0;
    if (stmt6.length > 0) {
      inward_all_qty = helper.number(stmt6[0].Inward);
    }

    // ALL OUTWARD
    let stmt7 = await invtDB.query(
      "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_out` IN (:location)",
      {
        replacements: {
          component: req.body.component,
          location: all_branch__location,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let outward_all_qty = 0;
    if (stmt7.length > 0) {
      outward_all_qty = helper.number(stmt7[0].Outward);
    }

    // END

    // // ALL INWARD AT LOCATION
    // let stmt1 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'TRANSFER' )", {
    // 	replacements: { component: req.body.component },
    // 	type: invtDB.QueryTypes.SELECT,
    // });
    // let inward_all_qty;
    // if (stmt1.length > 0) {
    // 	inward_all_qty = helper.number(stmt1[0].Inward);
    // } else {
    // 	inward_all_qty = 0;
    // }

    // // ALL OUTWARD AT LOCATION
    // let stmt2 = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type NOT IN ('INWARD' ,'CANCELLED')", {
    // 	replacements: { component: req.body.component },
    // 	type: invtDB.QueryTypes.SELECT,
    // });
    // let outward_all_qty;
    // if (stmt2.length > 0) {
    // 	outward_all_qty = helper.number(stmt2[0].Outward);
    // } else {
    // 	outward_all_qty = 0;
    // }

    let stmt3 = await invtDB.query(
      "SELECT * FROM `components` LEFT JOIN `units`ON `components`.`c_uom` = `units`.`units_id` WHERE `components`.`component_key` = :key AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y'",
      {
        replacements: { key: req.body.component },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt3.length > 0) {
      // return res.json({ status: "success", success: true, data: { name: stmt3[0].c_name, unit: stmt3[0].units_name, available_qty: helper.number(inward_all_qty - outward_all_qty) } });
      return res.json({
        status: "success",
        success: true,
        message: "Stock fetched successfully",
        data: {
          name: stmt3[0].c_name,
          unit: stmt3[0].units_name,
          available_qty: helper.number(
            helper.number(inward_all_qty) - helper.number(outward_all_qty)
          ),
        },
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "unregistered component found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// CREATE FGOUT
router.post(
  "/saveAudit",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    let validation = new Validator(req.body, {
      branch: "required",
      component: "required",
      closing: "required",
      audit: "required",
    });
    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "Validation error",
        data: validation.errors.all(),
      });
    }

    // return res.json({
    //   status: "error",
    //   success: false,
    //   message: "This Utility is disabled",
    // });

    let rm_length = req.body.component.length;

    for (let i = 0; i < rm_length; i++) {
      let validation = new Validator(
        {
          component: req.body.component[i],
          closing: helper.number(req.body.closing[i]),
          audit: helper.number(req.body.audit[i]),
        },
        {
          component: "required",
          closing: "required|min:0",
          audit: "required|min:0",
        }
      );
      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: "Validation error",
          data: validation.errors.all(),
        });
      }
    }

    const toFindDublicates = (arry) =>
      arry.filter((item, index) => arry.indexOf(item) !== index);
    const dubliEle = toFindDublicates(req.body.component);
    if (dubliEle.length > 0) {
      res.json({
        status: "error",
        success: false,
        message:
          "You have entered a same component twice of time in a single request",
      });
      return;
    }

    const t = await invtDB.transaction();

    try {
      let stmt = await invtDB.query(
        "SELECT `audit_ref_id` FROM `ims_rm_audit` GROUP BY `audit_ref_id` ORDER BY ID DESC LIMIT 1",
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let transactionCode;

      if (stmt.length > 0) {
        transactionCode = stmt[0].audit_ref_id;
        let strings = transactionCode.replace(/[0-9]/g, "");
        let digits = (
          helper.number(transactionCode.replace(/[^0-9]/g, "")) + 1
        ).toString();
        if (digits.length < 3) digits = ("000" + digits).substr(-3);
        transactionCode = strings + digits;
      } else {
        transactionCode = "AUD001";
      }

      const log_code = helper.getUniqueNumber();

      for (let i = 0; i < rm_length; i++) {
        if (helper.number(req.body.audit[i]) !== "") {
          if (
            helper.number(req.body.audit[i]) ==
            helper.number(req.body.closing[i])
          ) {
            let stmt1 = await invtDB.query(
              "INSERT INTO `ims_rm_audit` (`company_branch`,`component_key`,`closing_qty`,`audit_qty`,`audit_dt`,`audit_by`,`audit_ref_id`,`audit_remark`)VALUES (:branch,:part,:closing,:audit,:date,:by,:transaction,:remark)",
              {
                replacements: {
                  branch: req.branch,
                  part: req.body.component[i],
                  closing: helper.number(req.body.closing[i]),
                  audit: helper.number(req.body.audit[i]),
                  date: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm:ss"),
                  by: req.logedINUser,
                  transaction: transactionCode,
                  remark: req.body.remark[i],
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: t,
              }
            );
            if (stmt1.length > 0) {
              if (i == rm_length - 1) {
                await t.commit();
                return res.json({
                  status: "success",
                  success: true,
                  message: "Audit Saved..<br>TxnID: #" + transactionCode,
                });
              }
            } else {
              t.rollback();
              return res.json({
                status: "error",
                success: false,
                message: "an error while executing your request",
              });
            }
          } else {
            let stmt1 = await invtDB.query(
              "INSERT INTO  ims_rm_audit_log  ( company_branch , component_key , closing_qty , audit_qty , audit_dt , audit_by , audit_remark , audit_log_key )VALUES (:branch,:part,:closing,:audit,:date,:by,:remark , :audit_log_key)",
              {
                replacements: {
                  branch: req.branch,
                  part: req.body.component[i],
                  closing: helper.number(req.body.closing[i]),
                  audit: helper.number(req.body.audit[i]),
                  date: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm:ss"),
                  by: req.logedINUser,
                  remark: req.body.remark[i],
                  audit_log_key: log_code,
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: t,
              }
            );
            if (stmt1.length > 0) {
              if (i == rm_length - 1) {
                await t.commit();
                return res.json({
                  status: "success",
                  success: true,
                  message: "Audit Saved..<br>TxnID: #" + transactionCode,
                });
              }
            } else {
              t.rollback();
              return res.json({
                status: "error",
                success: false,
                message: "an error while executing your request",
              });
            }
          }
        }
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// Fetch Pending/Un-Approved Audit
// Reupdated by Shiv, 15-04, 2024
router.post("/fetchPendingAudit", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      status: "required|in:pending,reject",
    });

    if (valid.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(valid),
      });
    }

    // return res.json({
    //   status: "error",
    //   success: false,
    //   message: "This Utility is disabled",
    // });

    let stmt;
    if (req.body.status == "pending") {
      stmt = await invtDB.query(
        " SELECT ims_rm_audit_log.*, components.c_part_no , components.c_name , admin_login.user_name FROM ims_rm_audit_log LEFT JOIN components ON components.component_key = ims_rm_audit_log.component_key LEFT JOIN admin_login ON admin_login.CustID = ims_rm_audit_log.audit_by WHERE status IN ('pending') ",
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (req.body.status == "reject") {
      stmt = await invtDB.query(
        "SELECT t.* FROM ( SELECT ims_rm_audit_log.*, components.c_part_no, components.c_name, admin_login.user_name, ROW_NUMBER() OVER (PARTITION BY ims_rm_audit_log.component_key, ims_rm_audit_log.audit_log_key ORDER BY ims_rm_audit_log.ID DESC) AS rn FROM ims_rm_audit_log LEFT JOIN components ON components.component_key = ims_rm_audit_log.component_key LEFT JOIN admin_login ON admin_login.CustID = ims_rm_audit_log.audit_by ) AS t WHERE t.rn = 1 AND t.status = 'reject' AND NOT EXISTS ( SELECT 1 FROM ims_rm_audit_log AS next_entry WHERE next_entry.component_key = t.component_key AND next_entry.audit_log_key = t.audit_log_key AND next_entry.ID > t.ID AND next_entry.status IN ('pending', 'approved') )",
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt.length > 0) {
      let data = [];
      for (let i = 0; i < stmt.length; i++) {
        data.push({
          audit_key: Buffer.from(stmt[i].ID.toString(), "utf-8").toString(
            "base64"
          ),
          component_key: stmt[i].component_key,
          part_code: stmt[i].c_part_no,
          part_name: stmt[i].c_name,
          ims_qty: stmt[i].closing_qty,
          audit_qty: stmt[i].audit_qty,
          audit_dt: moment(stmt[i].audit_dt, "YYYY-MM-DD HH:mm:ss").format(
            "DD-MM-YYYY hh:mm:ss"
          ),
          audit_remark: stmt[i].audit_remark,
          status: stmt[i].status,
          by: stmt[i].user_name ?? "NA",
          logCount: stmt[i].log_count,
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
        success: false,
        message: "no data found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPDATE STATUS AUDIT
router.post("/updateAudit", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    audit_key: "required",
    status: "required|in:approved,reject",
    component_key: "required",
  });

  if (validation.fails()) {
    res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
    return;
  }

  // return res.json({
  //   status: "error",
  //   success: false,
  //   message: "This Utility is disabled",
  // });

  const transaction = await invtDB.transaction();
  try {
    const audit_key = Buffer.from(req.body.audit_key, "base64").toString(
      "ascii"
    );

    const stmt_status = await invtDB.query(
      "SELECT * FROM ims_rm_audit_log WHERE ID = :audit_key AND component_key = :component_key ",
      {
        replacements: {
          audit_key: audit_key,
          component_key: req.body.component_key,
        },
        type: invtDB.QueryTypes.SELECT,
        transaction: transaction,
      }
    );

    if (stmt_status.length > 0) {
      if (stmt_status[0].status == "approved") {
        return res.json({
          status: "error",
          success: false,
          message: "Already Approved",
        });
      }

      let stmt = await invtDB.query(
        "SELECT `audit_ref_id` FROM `ims_rm_audit` GROUP BY `audit_ref_id` ORDER BY ID DESC LIMIT 1",
        {
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let transactionCode;

      if (stmt.length > 0) {
        transactionCode = stmt[0].audit_ref_id;
        let strings = transactionCode.replace(/[0-9]/g, "");
        let digits = (
          helper.number(transactionCode.replace(/[^0-9]/g, "")) + 1
        ).toString();
        if (digits.length < 3) digits = ("000" + digits).substr(-3);
        transactionCode = strings + digits;
      } else {
        transactionCode = "AUD001";
      }

      const stmt_update = await invtDB.query(
        "UPDATE ims_rm_audit_log SET status = :status , update_by = :update_by , update_dt = :update_dt  WHERE ID = :audit_key AND component_key = :component_key ",
        {
          replacements: {
            status: req.body.status,
            audit_key: audit_key,
            component_key: req.body.component_key,
            update_by: req.logedINUser,
            update_dt: moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss"),
          },
          type: invtDB.QueryTypes.UPDATE,
          transaction: transaction,
        }
      );

      if (req.body.status == "approved") {
        const stmt_insert = await invtDB.query(
          "INSERT INTO  ims_rm_audit  ( company_branch , component_key , closing_qty , audit_qty , audit_dt , audit_by , audit_ref_id , audit_remark , log_ref_id )VALUES (:branch,:part,:closing,:audit,:date,:by,:transaction,:remark , :log_ref)",
          {
            replacements: {
              branch: stmt_status[0].company_branch,
              part: stmt_status[0].component_key,
              closing: stmt_status[0].closing_qty,
              audit: stmt_status[0].audit_qty,
              date: stmt_status[0].audit_dt,
              by: stmt_status[0].audit_by,
              transaction: transactionCode,
              remark: stmt_status[0].audit_remark,
              log_ref: stmt_status[0].audit_log_key,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );
      }

      await transaction.commit();
      return res.json({
        status: "success",
        success: true,
        message: "Audit Updated Successfully",
      });
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Entry Not Found!!!",
      });
    }
  } catch (err) {
    await transaction.rollback();
    return res.json({
      status: "error",
      success: false,
      message:
        "Internal Error!!! If this condition persists, contact your system administrator",
      ...(process.env.NODE_ENV === "development" && { debug: err.stack }),
    });
  }
});

// UPDATE REJECTED AUDIT
router.post("/updateRejectedAudit", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    audit_key: "required",
    component_key: "required",
    audit_qty: "required|numeric",
  });

  if (validation.fails()) {
    res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
    return;
  }

  // return res.json({
  //   status: "error",
  //   success: false,
  //   message: "This Utility is disabled",
  // });

  const transaction = await invtDB.transaction();

  try {
    const audit_key = Buffer.from(req.body.audit_key, "base64").toString(
      "ascii"
    );

    const stmt_status = await invtDB.query(
      "SELECT * FROM ims_rm_audit_log WHERE ID = :audit_key AND component_key = :component_key ORDER BY ID DESC LIMIT 1 ",
      {
        replacements: {
          audit_key: audit_key,
          component_key: req.body.component_key,
        },
        type: invtDB.QueryTypes.SELECT,
        transaction: transaction,
      }
    );

    if (stmt_status.length > 0) {
      if (stmt_status[0].status != "reject") {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Audit Not Rejected",
        });
      }

      const stmt_insert = await invtDB.query(
        "INSERT INTO  ims_rm_audit_log  ( company_branch , component_key , closing_qty , audit_qty , audit_dt , audit_by , audit_remark , audit_log_key , log_count)VALUES (:branch,:part,:closing,:audit,:date,:by,:remark , :audit_log_key , :log_count)",
        {
          replacements: {
            branch: stmt_status[0].company_branch,
            part: stmt_status[0].component_key,
            closing: stmt_status[0].closing_qty,
            audit: req.body.audit_qty,
            date: moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss"),
            by: req.logedINUser,
            remark: req.body.audit_remark ?? "",
            audit_log_key: stmt_status[0].audit_log_key,
            log_count: helper.number(stmt_status[0].log_count) + 1,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      );

      await transaction.commit();
      return res.json({
        status: "success",
        success: true,
        message: "Audit Updated Successfully",
      });
    } else {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Entry Not Found!!!",
      });
    }
  } catch (err) {
    await transaction.rollback();
    return res.json({
      status: "error",
      success: false,
      message:
        "Internal Error!!! If this condition persists, contact your system administrator",
      ...(process.env.NODE_ENV === "development" && { debug: err.stack }),
    });
  }
});

// FETCH AUDITS
router.post("/fetchAudit", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.searchBy;
  const searchValue = req.body.searchValue;

  const validation = new Validator(req.body, {
    searchBy: "required",
    searchValue: "required",
  });

  if (validation.fails()) {
    res.json({
      status: "error",
      success: false,
      message: "Validation error",
      data: validation.errors.all(),
    });
    return;
  }

  // return res.json({
  //   status: "error",
  //   success: false,
  //   message: "This Utility is disabled",
  // });

  try {
    let stmt0;
    if (searchBy == "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months"
      );
      if (durationInMonths > 3) {
        return res.json({
          status: "error",
          success: false,
          message:
            "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
        });
      }

      stmt0 = await invtDB.query(
        "SELECT *, `admin_login`.`user_name` FROM `ims_rm_audit` LEFT JOIN `components` ON `components`.`component_key` = `ims_rm_audit`.`component_key` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `ims_rm_audit`.`audit_by` WHERE (DATE_FORMAT(`ims_rm_audit`.`audit_dt`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `ims_rm_audit`.`company_branch` = :branch",
        {
          replacements: { date1: fromdate, date2: todate, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "partwise") {
      stmt0 = await invtDB.query(
        "SELECT *, `admin_login`.`user_name` FROM `ims_rm_audit` LEFT JOIN `components` ON `components`.`component_key` = `ims_rm_audit`.`component_key` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `ims_rm_audit`.`audit_by` WHERE `ims_rm_audit`.`component_key` = :component AND `ims_rm_audit`.`company_branch` = :branch",
        {
          replacements: { component: searchValue, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt0.length > 0) {
      let data = [];
      let count = 0;
      stmt0.map(async (item) => {
        data.push({
          name: decode(item.c_name),
          part: item.c_part_no,
          cat_part: item.c_new_part_no,
          uom: item.units_name,
          cl: item.closing_qty,
          rm: item.audit_qty,
          remark: item.audit_remark,
          dt: moment(item.audit_dt)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY HH:mm:ss"),
          by: item.user_name,
          audit_key: item.log_ref_id,
        });
        count++;

        if (stmt0.length == count) {
          res.json({
            status: "success",
            success: true,
            message: "Audit data fetched successfully",
            data: data,
          });
          return;
        }
      });
    } else {
      res.json({ status: "error", success: false, message: "No Data Found" });
      return;
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// View Logs
router.post("/fetchAuditLog", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    audit_key: "required",
  });

  if (validation.fails()) {
    res.json({
      status: "error",
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
    return;
  }

  // return res.json({
  //   status: "error",
  //   success: false,
  //   message: "This Utility is disabled",
  // });

  try {
    const stmt = await invtDB.query(
      "SELECT ims_rm_audit_log.*, a.user_name as audit_by , b.user_name as update_by  FROM ims_rm_audit_log LEFT JOIN admin_login a ON a.CustID = ims_rm_audit_log.audit_by LEFT JOIN admin_login b ON b.CustID = ims_rm_audit_log.update_by WHERE audit_log_key = :audit_key ",
      {
        replacements: {
          audit_key: req.body.audit_key,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let data = [];

      for (let i = 0; i < stmt.length; i++) {
        data.push({
          ims_qty: stmt[i].closing_qty,
          audit_qty: stmt[i].audit_qty,
          audit_by: stmt[i].audit_by,
          update_user: stmt[i].update_by ?? "NA",
          update_date:
            stmt[i].update_dt != "--"
              ? moment(stmt[i].update_dt)
                  .tz("Asia/Kolkata")
                  .format("DD-MM-YYYY HH:mm:ss")
              : "--",
          audit_dt: moment(stmt[i].audit_dt)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY HH:mm:ss"),
          remark: stmt[i].audit_remark,
          status: stmt[i].audit_status,
        });
      }

      return res.json({
        status: "success",
        success: true,
        message: "Audit log fetched successfully",
        data: data,
      });
    } else {
      res.json({ status: "error", success: false, message: "No Data Found" });
      return;
    }
  } catch (error) {
    res.json({
      status: "error",
      success: false,
      message: "Something went wrong. Please try again later",
      ...(process.env.NODE_ENV === "development" && { debug: error.stack }),
    });
    return;
  }
});

// FETCH REPORT [R14]
router.post("/fetchAuditReport", [auth.isAuthorized], async (req, res) => {
  // return res.json({
  //   status: "error",
  //   success: false,
  //   message: "This Utility is disabled",
  // });

  try {
    let stmt1 = await invtDB.query(
      "SELECT components.c_name, components.c_part_no, components.c_new_part_no ,components.component_key, units.units_name FROM components LEFT JOIN units ON units.units_id = components.c_uom WHERE components.c_type = 'R' AND components.c_is_enabled = 'Y'",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );
    const data = [];
    count = 0;
    stmt1.map(async (item) => {
      let stmt2 = await invtDB.query(
        "SELECT ims_rm_audit.*, admin_login.user_name FROM ims_rm_audit LEFT JOIN admin_login ON admin_login.CustID = ims_rm_audit.audit_by WHERE ims_rm_audit.component_key = :component AND ims_rm_audit.company_branch = :branch ORDER BY ims_rm_audit.ID DESC LIMIT 1",
        {
          replacements: {
            component: item.component_key,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let closing_qty, audit_qty, remark, audit_dt, audit_by;
      if (stmt2.length > 0) {
        (closing_qty = stmt2[0].closing_qty),
          (audit_qty = stmt2[0].audit_qty),
          (remark = stmt2[0].audit_remark),
          (audit_dt = moment(stmt2[0].audit_dt)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY HH:mm:ss")),
          (audit_by = stmt2[0].user_name);
      } else {
        (closing_qty = "--"),
          (audit_qty = "--"),
          (remark = "--"),
          (audit_dt = "--"),
          (audit_by = "--");
      }

      data.push({
        name: decode(item.c_name),
        part: item.c_part_no,
        new_part: item.c_new_part_no,
        uom: item.units_name,
        cl: closing_qty,
        rm: audit_qty,
        remark: remark,
        dt: audit_dt,
        by: audit_by,
      });
      count++;

      if (stmt1.length == count) {
        res.json({
          status: "success",
          success: true,
          message: "Audit report fetched successfully",
          data: data,
        });
        return;
      }
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;

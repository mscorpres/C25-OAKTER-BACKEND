const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB } = require("../../../../config/db/connection");

const { encode, decode } = require("html-entities");
const Validator = require("validatorjs");

// qa_sfg_sku is what QCA lot transfer writes into mfg_production_2/_3 as mfg_sku,
// so a blank or unknown value here silently breaks production and the MFG reports.
// Returns { error } on failure, { skus } (trimmed) on success.
async function validateSfgSkus(sfg_sku, expectedLength) {
  if (!Array.isArray(sfg_sku) || sfg_sku.length === 0) {
    return { error: "Please provide the SFG SKU for each process" };
  }

  if (sfg_sku.length !== expectedLength) {
    return { error: "SFG SKU must be provided for every process" };
  }

  const skus = sfg_sku.map((sku) => (sku === null || sku === undefined ? "" : String(sku).trim()));

  if (skus.some((sku) => sku === "")) {
    return { error: "SFG SKU cannot be empty for any process" };
  }

  const uniqueSkus = [...new Set(skus)];
  const existing = await invtDB.query("SELECT p_sku FROM products WHERE p_sku IN (:skus)", {
    replacements: { skus: uniqueSkus },
    type: invtDB.QueryTypes.SELECT,
  });

  const found = new Set(existing.map((row) => row.p_sku));
  const missing = uniqueSkus.filter((sku) => !found.has(sku));

  if (missing.length > 0) {
    return { error: `SFG SKU not found in products: ${missing.join(", ")}` };
  }

  return { skus };
}

// add new process
router.post("/insert_Process", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    processName: "required",
    processDesc: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
  }

  const transaction = await invtDB.transaction();

  try {
    let process_code = await helper.genTransaction("PS", transaction);

    const check = await invtDB.query("SELECT * FROM qa_process_master WHERE process_code = :process_code OR process_name = :process_name", {
      replacements: { process_code: process_code, process_name: req.body.processName },
      type: invtDB.QueryTypes.SELECT,
    });

    if (check.length > 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Process already exists" });
    }

    const result = await invtDB.query(
      "INSERT INTO qa_process_master (process_key,process_code, process_name, process_desc, insert_by, insert_dt) VALUES (:process_key, :process_code, :process_name , :process_desc , :insert_by , :insert_dt )",
      {
        replacements: {
          process_key: helper.randomNumber(1000000, 9999999),
          process_code: process_code,
          process_name: req.body.processName,
          process_desc: req.body.processDesc,
          insert_by: req.logedINUser,
          insert_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      }
    );

    if (result.length > 0) {
      await transaction.commit();
      return res.json({ status: "success", success: true, message: "Process added successfully", data: {} });
    } else {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Failed to Insert Process" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//Update Process
router.post("/updateProcess", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    process_code: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
  }

  const transaction = await invtDB.transaction();

  try {
    const existingProcess = await invtDB.query("SELECT * FROM qa_process_master WHERE process_code = ?", {
      replacements: [req.body.process_code],
      type: invtDB.QueryTypes.SELECT,
    });

    if (existingProcess.length === 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Process not found" });
    }

    const result = await invtDB.query(
      "UPDATE qa_process_master SET process_name = :process_name, process_desc = :process_desc, update_by = :update_by, update_date = :update_dt WHERE process_code = :process_code",
      {
        replacements: {
          process_code: req.body.process_code,
          process_name: req.body.process_name,
          process_desc: req.body.process_desc,
          update_by: req.logedINUser,
          update_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      }
    );

    if (result.length > 0) {
      await transaction.commit();
      return res.json({ status: "success", success: true, message: "Process updated successfully", data: {} });
    } else {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Failed to Update Process" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//get all process
router.get("/fetch_Process", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query("SELECT process_code, process_name, process_desc FROM qa_process_master", { type: invtDB.QueryTypes.SELECT });

    if (result.length > 0) {
      return res.json({ status: "success", success: true, data: result });
    } else {
      return res.json({ status: "error", success: false, message: "No Process Found!!!" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//view process
router.post("/view_process", [auth.isAuthorized], async (req, res) => {
  try {
    const limit = 10;
    let stmt;
    if (req.body.searchTerm) {
      stmt = await invtDB.query("SELECT * FROM qa_process_master WHERE (process_name LIKE :search OR process_code LIKE :search) ORDER BY process_name ASC LIMIT :limit", {
        replacements: { search: `%${req.body.searchTerm}%`, limit: limit },
        type: invtDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await invtDB.query("SELECT * FROM qa_process_master ORDER BY process_name ASC LIMIT :limit", { replacements: { limit: limit }, type: invtDB.QueryTypes.SELECT });
    }

    if (stmt.length > 0) {
      let final = [];

      stmt.map((item) => {
        final.push({ id: item.process_key, text: "(" + item.process_code + ") " + decode(item.process_name) });

        if (stmt.length == final.length) {
          return res.json({ status: "success", success: true, data: final });
        }
      });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//Map QA Process with SKU
router.post("/createQAProcess", [auth.isAuthorized], async (req, res) => {
  const valid = new Validator(req.body, {
    sku: "required",
    sfg_sku: "required|array",
    bomRequired: "required|array",
    subject: "required|array",
    process: "required|array",
    processLevel: "required|array",
    processRemark: "required|array",
    processLoc: "required|array",
    pass_loc: "required|array",
    fail_loc: "required|array",
    lot_size: "required|array",
  });

  if (valid.fails()) {
    return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
  }

  const sfgCheck = await validateSfgSkus(req.body.sfg_sku, req.body.process.length);

  if (sfgCheck.error) {
    return res.json({ status: "error", success: false, message: sfgCheck.error });
  }

  const stmt_validate = await invtDB.query("SELECT * FROM qa_process WHERE qa_sku = :sku", {
    replacements: { sku: req.body.sku },
    type: invtDB.QueryTypes.SELECT,
  });

  if (stmt_validate.length > 0) {
    return res.json({ status: "error", success: false, message: "SKU already exists" });
  }

  const transaction = await invtDB.transaction();

  let sku = req.body.sku;
  let processLength = req.body.process.length;

  try {
    for (let i = 0; i < processLength; i++) {
      const Subject = req.body.bomRequired[i] === "YES";

      const process = req.body.process[i];
      const processLevel = req.body.processLevel[i];

      const existingProcess = await invtDB.query("SELECT * FROM qa_process WHERE qa_sku = :sku AND (qa_process = :process OR qa_process_level = :processLevel)", {
        replacements: { sku, process, processLevel },
        type: invtDB.QueryTypes.SELECT,
        transaction: transaction,
      });

      if (existingProcess.length > 0) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: `Duplicate process (${process}) for SKU ${sku}` });
      }

      const stmt_create = await invtDB.query(
        "INSERT INTO qa_process (qa_sku, qa_sfg_sku, qa_subject , qa_process, qa_process_level , bom_required , qa_process_remark , process_loc, process_pass_loc, process_fail_loc, lot_size, qa_process_key, insert_by, insert_dt) VALUES ( :sku ,:sfg_sku , :subject , :process , :processLevel , :bomRequired , :processRemark , :processLoc , :pass_loc , :fail_loc , :lot_size , :processKey , :insert_by , :insert_dt)",
        {
          replacements: {
            sku: sku,
            sfg_sku: sfgCheck.skus[i],
            subject: Subject ? req.body.subject[i] : "--",
            process: process,
            processLevel: processLevel,
            bomRequired: req.body.bomRequired[i],
            processRemark: req.body.processRemark[i],
            processLoc: req.body.processLoc[i],
            pass_loc: req.body.pass_loc[i],
            fail_loc: req.body.fail_loc[i],
            lot_size: req.body.lot_size[i],
            processKey: helper.getUniqueNumber(),
            insert_by: req.logedINUser,
            insert_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      );

      if (stmt_create.length === 0) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Failed to Insert QA Process" });
      }
    }

    await transaction.commit();
    return res.json({ status: "success", success: true, message: "Successfully Inserted QA Process", data: {} });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// FETCH QA PROCESS
router.post("/fetchQAProcess", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    sku: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Please provide sku" });
  }

  try {
    const stmt = await invtDB.query(
      "SELECT qa_process.*, subject_name, process_name, process_location.loc_name AS process_loc_name, process_pass_location.loc_name AS process_pass_loc_name, process_fail_location.loc_name AS process_fail_loc_name FROM qa_process LEFT JOIN bom_recipe ON qa_process.qa_subject = bom_recipe.subject_id LEFT JOIN qa_process_master ON qa_process.qa_process = qa_process_master.process_key LEFT JOIN location_main AS process_location ON qa_process.process_loc = process_location.location_key LEFT JOIN location_main AS process_pass_location ON qa_process.process_pass_loc = process_pass_location.location_key LEFT JOIN location_main AS process_fail_location ON qa_process.process_fail_loc = process_fail_location.location_key WHERE qa_sku = :sku",
      {
        replacements: { sku: req.body.sku },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let result = [];
      for (let i = 0; i < stmt.length; i++) {
        result.push({
          bomrequired: stmt[i].bom_required,
          qa_sfg_sku: stmt[i].qa_sfg_sku,
          qa_process_level: stmt[i].qa_process_level,
          qa_process_key: stmt[i].qa_process_key,
          qa_process_remark: stmt[i].qa_process_remark,
          qa_lot_size: stmt[i].lot_size,
          bom: {
            id: stmt[i].qa_subject,
            name: stmt[i].subject_name,
          },
          process: {
            key: stmt[i].qa_process,
            name: stmt[i].process_name,
          },
          process_loc: {
            key: stmt[i].process_loc,
            name: stmt[i].process_loc_name,
          },
          pass_loc: {
            key: stmt[i].process_pass_loc,
            name: stmt[i].process_pass_loc_name,
          },
          fail_loc: {
            key: stmt[i].process_fail_loc,
            name: stmt[i].process_fail_loc_name,
          },
        });
      }

      return res.json({ status: "success", success: true, message: "", data: result });
    } else {
      return res.json({ status: "error", success: false, message: "No QA_Process Found!!!" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//Update Mapped Process QA
router.post("/updateMappedQAProcess", [auth.isAuthorized], async (req, res) => {
  const valid = new Validator(req.body, {
    sku: "required",
    sfg_sku: "required|array",
    process: "required|array",
  });

  if (valid.fails()) {
    return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
  }

  const sfgCheck = await validateSfgSkus(req.body.sfg_sku, req.body.process.length);

  if (sfgCheck.error) {
    return res.json({ status: "error", success: false, message: sfgCheck.error });
  }

  const transaction = await invtDB.transaction();

  try {
    for (let i = 0; i < req.body.process.length; i++) {
      const qaProcessKey = req.body.qa_process_key[i];

      // Check if the QA Process with the specified QA process key exists
      const existingProcess = await invtDB.query("SELECT * FROM qa_process WHERE qa_sku = :sku AND qa_process_key = :qaProcessKey", {
        replacements: { sku: req.body.sku, qaProcessKey },
        type: invtDB.QueryTypes.SELECT,
        transaction: transaction,
      });

      const Subject = req.body.bomRequired[i] === "YES";

      if (existingProcess.length === 0) {
        // If the QA Process does not exist, insert a new entry
        const insertStmt = await invtDB.query(
          "INSERT INTO qa_process (qa_sku, qa_sfg_sku, qa_process_key, qa_subject, bom_required, qa_process, qa_process_level, qa_process_remark, process_loc, process_pass_loc, process_fail_loc, lot_size, insert_by, insert_dt) VALUES (:sku, :sfg_sku, :qaProcessKey, :subject, :bomRequired, :process, :processLevel, :processRemark, :processLoc, :pass_loc, :fail_loc, :lot_size, :insert_by, :insert_dt)",
          {
            replacements: {
              sku: req.body.sku,
              sfg_sku: sfgCheck.skus[i],
              qaProcessKey: helper.getUniqueNumber(),
              subject: Subject ? req.body.subject[i] : "--",
              bomRequired: req.body.bomRequired[i],
              process: req.body.process[i],
              processLevel: req.body.processLevel[i],
              processRemark: req.body.processRemark[i],
              processLoc: req.body.processLoc[i],
              pass_loc: req.body.pass_loc[i],
              fail_loc: req.body.fail_loc[i],
              lot_size: req.body.lot_size[i],
              insert_by: req.logedINUser,
              insert_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        if (insertStmt[0] === 0) {
          await transaction.rollback();
          return res.json({ status: "error", success: false, message: "Failed to Insert QA Process" });
        }
      } else {
        // If the QA Process exists, update the existing entry
        const updateStmt = await invtDB.query(
          "UPDATE qa_process SET qa_sfg_sku = :sfg_sku, qa_subject = :subject, bom_required = :bomRequired, qa_process = :process, qa_process_level = :processLevel, qa_process_remark = :processRemark, process_loc = :processLoc, process_pass_loc = :pass_loc, process_fail_loc = :fail_loc, lot_size = :lot_size, update_by = :update_by, update_dt = :update_dt WHERE qa_sku = :sku AND qa_process_key = :qaProcessKey",
          {
            replacements: {
              sku: req.body.sku,
              qaProcessKey,
              sfg_sku: sfgCheck.skus[i],
              subject: Subject ? req.body.subject[i] : "--",
              bomRequired: req.body.bomRequired[i],
              process: req.body.process[i],
              processLevel: req.body.processLevel[i],
              processRemark: req.body.processRemark[i],
              processLoc: req.body.processLoc[i],
              pass_loc: req.body.pass_loc[i],
              fail_loc: req.body.fail_loc[i],
              lot_size: req.body.lot_size[i],
              update_by: req.logedINUser,
              update_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transaction,
          }
        );

        if (updateStmt[0] === 0) {
          await transaction.rollback();
          return res.json({ status: "error", success: false, message: `Failed to Update QA Process with QA Process Key ${qaProcessKey}` });
        }
      }
    }

    await transaction.commit();
    return res.json({ status: "success", success: true, message: "Successfully Updated/Inserted QA Process", data: {} });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;

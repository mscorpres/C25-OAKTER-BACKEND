const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
const multer = require("multer");

const path = require("path");
const XLSX = require("xlsx");
const fs = require("fs");

// IMPORT PART RATE WITH EXCEL
const jw_rate = multer.diskStorage({
  destination: (req, file, callBack) => {
    callBack(null, "./files/excel/");
  },
  filename: (req, file, callBack) => {
    callBack(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
  },
});
const rateUpload = multer({
  storage: jw_rate,
});

router.post("/insertPartRatethroughExcel", [auth.isAuthorized, rateUpload.single("file")], async (req, res) => {
  if (req.file == undefined) {
    return res.json({ status: "error", success: false, message: "Please select file!!!" });
  }

  const excelFilePath = req.file;
  const workbook = XLSX.readFile(excelFilePath.path);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const excelData = XLSX.utils.sheet_to_json(worksheet);

  const validation = new Validator(req.body, {
    jobwork_id: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
  }

  const jw_id = req.body.jobwork_id;

  const components = excelData
    .map((item, index) => {
      return { PARTCODE: item.PART_CODE, ROW: index + 1 };
    })
    .reverse();
  const comp_length = components.length;

  // CHECK DUBLICATE COMPONENT
  if (comp_length > 0) {
    const PARTCODES = components.map((item) => item.PARTCODE);
    const toFindDuplicates = (arry) => arry.filter(({ PARTCODE }, index) => PARTCODES.includes(PARTCODE, index + 1));
    const duplicateElementa = toFindDuplicates(components).reverse();
    if (duplicateElementa.length > 0) {
      return res.json({ status: "error", success: false, message: "dublicate component", data: duplicateElementa });
    }
  } else {
    return res.json({ status: "error", success: false, message: "add atleast one component.." });
  }

  const transaction = await otherDB.transaction();

  try {
    for (let i = 0; i < excelData.length; i++) {
      const row = excelData[i];

      if (!row.PART_CODE) {
        return res.json({ status: "error", success: false, message: "Please fill all row data!!!" });
      }

      let component_key;
      const result = await invtDB.query("SELECT component_key FROM components WHERE c_is_enabled = 'Y' AND c_type = 'R' AND c_part_no = :partcode", {
        replacements: { partcode: row.PART_CODE },
        type: invtDB.QueryTypes.SELECT,
      });
      if (result.length > 0) {
        component_key = result[0].component_key;
      } else {
        return res.json({ status: "error", success: false, message: `Part code (${row.PART_CODE}) is not valid` });
      }

      let checkUpdate = await invtDB.query("SELECT jw_po_bom_recipe FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :jwtransfer", {
        replacements: { jwtransfer: jw_id },
        type: invtDB.QueryTypes.SELECT,
      });
      if(checkUpdate.length == 0) {
        return res.json({ status: "error", success: false, message: `JOBWORK (${jw_id}) is not exist` });
      }

      let stmt_update = await invtDB.query("UPDATE `jw_bom_recipe` SET jw_bom_rate = :rate WHERE `jw_bom_po_trans` = :jw_trans AND `jw_bom_part` = :part", {
        replacements: {
          rate: row.PART_RATE,
          jw_trans: jw_id,
          part: component_key,
        }, 
        type: invtDB.QueryTypes.UPDATE,
      });

      if (stmt_update[0] == 0) {
        return res.json({ status: "error", success: false, message: `an error occured while updating part rate` });
      }
    }
    await transaction.commit();
    return res.json({ status: "success", success: true, message: "Part Rates inserted successfully", data: {} });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// Preview PART RATE DATA
router.post("/previewRateExcelData", [auth.isAuthorized, rateUpload.single("file")], async (req, res) => {
  if (req.file == undefined) {
    return res.json({ status: "error", success: false, message: "Please select file!!!" });
  }

  const excelFilePath = req.file;
  const workbook = XLSX.readFile(excelFilePath.path);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const excelData = XLSX.utils.sheet_to_json(worksheet);

  const components = excelData
    .map((item, index) => {
      return { PARTCODE: item.PART_CODE, ROW: index + 1 };
    })
    .reverse();
  const comp_length = components.length;

  // CHECK DUBLICATE COMPONENT
  if (comp_length > 0) {
    const PARTCODES = components.map((item) => item.PARTCODE);
    const toFindDuplicates = (arry) => arry.filter(({ PARTCODE }, index) => PARTCODES.includes(PARTCODE, index + 1));
    const duplicateElementa = toFindDuplicates(components).reverse();
    if (duplicateElementa.length > 0) {
      return res.json({ status: "error", success: false, message: "dublicate component", data: duplicateElementa });
    }
  } else {
    return res.json({ status: "error", success: false, message: "add atleast one component.." });
  }

  try {
    for (let i = 0; i < excelData.length; i++) {
      const row = excelData[i];

      if (!row.PART_CODE) {
        return res.json({ status: "error", success: false, message: "Please fill all row data!!!" });
      }

      const result = await invtDB.query("SELECT component_key, c_name, units_name FROM components LEFT JOIN units ON components.c_uom = units.units_id WHERE c_is_enabled = 'Y' AND c_type = 'R' AND c_part_no = :partcode", {
        replacements: { partcode: row.PART_CODE },
        type: invtDB.QueryTypes.SELECT,
      });
      if (result.length > 0) {
        excelData[i].PART_NAME = result[0].c_name;
        excelData[i].PART_UOM = result[0].units_name;
      } else {
        return res.json({ status: "error", success: false, message: `Part code (${row.PARTCODE}) is not valid or disabled for further transaction..` });
      }
    }
    return res.json({ status: "success", success: true, message: "", data: excelData });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;

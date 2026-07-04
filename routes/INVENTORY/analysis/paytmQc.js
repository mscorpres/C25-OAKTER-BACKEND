const express = require("express");
const router = express.Router();
const Validator = require("validatorjs");
var XLSX = require("xlsx");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

let { invtDB, otherDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

var storage = multer.diskStorage({
  destination: (req, file, callBack) => {
    callBack(null, "./uploads/paytmQc");
  },
  filename: (req, file, callBack) => {
    callBack(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
  },
});

var uploadfile = multer({ storage: storage });

// FILE UPLOAD
router.post("/uploadFile", [auth.isAuthorized, uploadfile.single("file")], async (req, res) => {
  try {
    var workbook = XLSX.readFile("./uploads/paytmQc/" + req.file.filename);
    let json_data = XLSX.utils.sheet_to_json(workbook.Sheets.Sheet1, { header: 2, raw: false, dateNF: "yyyy-mm-dd" });
    fs.unlinkSync("./uploads/paytmQc/" + req.file.filename);
    if (json_data.length <= 0) {
      return res.json({ status: "error", success: false, message: "Please check the file " });
    }

    const insert_dt = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    let total_insert = 0;
    for (let i = 0; i < json_data.length; i++) {
      const transaction = await invtDB.transaction();

      if (json_data[i]["IMEI No."].toString().length !== 15) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: `IMEI No. (${json_data[i]["IMEI No."]}) not valid at row no. ${i}` });
      }

      let stmt_check = await invtDB.query("SELECT `imei_no` FROM `paytm_qc` WHERE `imei_no` = :imei", {
        replacements: { imei: json_data[i]["IMEI No."] },
        type: invtDB.QueryTypes.SELECT,
      });
      if (stmt_check.length > 0) {
        await transaction.rollback();
        // return res.json({ status: "error", success: false, message: "${json_data[i]["IMEI No."]} already Exist " });
      } else {
        let stmt_insert = await invtDB.query(
          "INSERT INTO `paytm_qc` (`date`, `qc_result`, `category`, `issue_observe`, `imei_no`, `sku_code`, `device_type`, `defects_type`, `actual_problems`, `correction_by`, `after_correction_status`, `insert_dt`, `insert_by`) VALUES ( :date , :qc_result , :category, :issue_observe , :imei_no , :sku_code , :device_type , :defects_type, :actual_problems , :correction_by , :after_correction_status , :insert_dt, :insert_by )",
          {
            replacements: {
              date: moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD"),
              // date: json_data[i]["Date"],
              qc_result: json_data[i]["QC Result"],
              category: json_data[i]["Category"],
              issue_observe: json_data[i]["Issue observe"],
              imei_no: json_data[i]["IMEI No."],
              sku_code: json_data[i]["SKU Code"],
              device_type: json_data[i]["Device Type"],
              defects_type: json_data[i]["Defects Type"],
              actual_problems: json_data[i]["Actual Problems Name"],
              correction_by: json_data[i]["Correction by Santosh"],
              after_correction_status: json_data[i]["After Correction Status"],
              insert_dt: insert_dt,
              insert_by: req.logedINUser,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        if (stmt_insert.length <= 0) {
          await transaction.rollback();
          return res.json({ status: "error", success: false, message: "Something Happen wrong !!! <br /> Try again... " });
        }
        await transaction.commit();
        total_insert++;
      }
    }
    return res.json({ status: "success", success: true, message: `File Uploaded <br /> Total row (${total_insert})` });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

//FETCH FOR EDIT
router.post("/editPaytmQc", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      imei_no: "required",
    });

    if (validation.fails()) {
      res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }

    let stmt = await invtDB.query("SELECT * FROM `paytm_qc` WHERE `imei_no` = :imei", {
      replacements: { imei: req.body.imei_no },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      let data = {
        date: stmt[0].date,
        qc_result: stmt[0].qc_result,
        category: stmt[0].category,
        issue_observe: stmt[0].issue_observe,
        imei_no: stmt[0].imei_no,
        sku_code: stmt[0].sku_code,
        device_type: stmt[0].device_type,
        defects_type: stmt[0].defects_type,
        actual_problems: stmt[0].actual_problems,
        correction_by: stmt[0].correction_by,
        after_correction_status: stmt[0].after_correction_status,
        remark: stmt[0].remark,
      };

      return res.json({ status: "success", success: true, data: data });
    } else {
      return res.json({ status: "error", success: false, message: imei_no + " not found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE IMEI DATA
router.post("/updatePaytmQc", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      imei_no: "required",
    });

    if (validation.fails()) {
      res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }

    let stmt_update = await invtDB.query("UPDATE `paytm_qc` SET `defects_type`= :defects_type, `actual_problems` = :actual_problems , `correction_by` = :correction_by , `after_correction_status` = :after_correction_status , `update_dt` = :update_dt , `update_by` = :update_by , `remark` = :remark WHERE `imei_no` = :imei_no", {
      replacements: {
        imei_no: req.body.imei_no,
        defects_type: req.body.defects_type,
        actual_problems: req.body.actual_problems,
        correction_by: req.body.correction_by,
        after_correction_status: req.body.after_correction_status,
        remark: req.body.remark,
        update_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        update_by: req.logedINUser,
      },
      type: invtDB.QueryTypes.UPDATE,
    });

    if (stmt_update.length > 0) {
      return res.json({ status: "success", success: true, message: "IMEI " + req.body.imei_no + " </br> updation success" });
    } else {
      return res.json({ status: "error", success: false, message: "Something happen wrong!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH PAYTM QC REPORT
router.post("/fetchPaytmQcReport", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      data: "required",
    });

    if (validation.fails()) {
      return res.json({});
    }

    let data = req.body.data;

    const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    let stmt = await invtDB.query("SELECT * FROM `paytm_qc` WHERE DATE_FORMAT(`date`,'%Y-%m-%d') BETWEEN :date1 AND :date2", {
      replacements: { date1: date1, date2: date2 },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      let final = [];
      let chart_data = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

      for (let i = 0; i < stmt.length; i++) {
        if (stmt[i].issue_observe == "Device validation fail") {
          chart_data[0] = chart_data[0] + 1;
        }
        if (stmt[i].issue_observe == "QR Glass Problem") {
          chart_data[1] = chart_data[1] + 1;
        }
        if (stmt[i].issue_observe == "Speaker Not Working") {
          chart_data[2] = chart_data[2] + 1;
        }
        if (stmt[i].issue_observe == "LCD display Issue") {
          chart_data[3] = chart_data[3] + 1;
        }
        if (stmt[i].issue_observe == "Body Gap") {
          chart_data[4] = chart_data[4] + 1;
        }
        if (stmt[i].issue_observe == "LED light not working") {
          chart_data[5] = chart_data[5] + 1;
        }
        if (stmt[i].issue_observe == "Button not working") {
          chart_data[6] = chart_data[6] + 1;
        }
        if (stmt[i].issue_observe == "Body Scratch") {
          chart_data[7] = chart_data[7] + 1;
        }
        if (stmt[i].issue_observe == "Device assembly Issue (improper fitment etc.)") {
          chart_data[8] = chart_data[8] + 1;
        }
        if (stmt[i].issue_observe == "IMEI sticker printing issue (not scannable)") {
          chart_data[9] = chart_data[9] + 1;
        }
        if (stmt[i].issue_observe == "Help desk sticker missing") {
          chart_data[10] = chart_data[10] + 1;
        }
        if (stmt[i].issue_observe == "Body Internal Problem (Loose Screw)") {
          chart_data[11] = chart_data[11] + 1;
        }
        if (stmt[i].issue_observe == "Rubber feet missing") {
          chart_data[12] = chart_data[12] + 1;
        }
        if (stmt[i].issue_observe == "Speaker cover damage") {
          chart_data[13] = chart_data[13] + 1;
        }
        if (stmt[i].issue_observe == "IMEI Mismatch") {
          chart_data[14] = chart_data[14] + 1;
        }
        if (stmt[i].issue_observe == "Language mismatch on device and packaging box") {
          chart_data[15] = chart_data[15] + 1;
        }
        if (stmt[i].issue_observe == "QR code missing") {
          chart_data[16] = chart_data[16] + 1;
        }
        if (stmt[i].issue_observe == "Device not working") {
          chart_data[17] = chart_data[17] + 1;
        }
        if (stmt[i].issue_observe == "Body Internal Problem(Loose Screw)") {
          chart_data[18] = chart_data[18] + 1;
        }
        if (stmt[i].issue_observe == "USB Jack ") {
          chart_data[19] = chart_data[19] + 1;
        }
        if (stmt[i].issue_observe == "Other") {
          chart_data[20] = chart_data[20] + 1;
        }
        if (stmt[i].issue_observe == "Key pad Issue") {
          chart_data[21] = chart_data[21] + 1;
        }
        if (stmt[i].issue_observe == "SIM LOCK") {
          chart_data[22] = chart_data[22] + 1;
        }
        if (stmt[i].issue_observe == "SIM Network Issue") {
          chart_data[23] = chart_data[23] + 1;
        }

        final.push({
          date: moment(stmt[i].date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          qc_result: stmt[i].qc_result,
          category: stmt[i].category,
          issue_observe: stmt[i].issue_observe,
          imei_no: stmt[i].imei_no,
          sku_code: stmt[i].sku_code,
          device_type: stmt[i].device_type,
          defects_type: stmt[i].defects_type,
          actual_problems: stmt[i].actual_problems,
          correction_by: stmt[i].correction_by,
          after_correction_status: stmt[i].after_correction_status,
          remark: stmt[i].remark,
        });
      }

      return res.json({ status: "success", success: true, data: final, chart_data: chart_data });
    } else {
      return res.json({ status: "error", success: false, message: "Data Not Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

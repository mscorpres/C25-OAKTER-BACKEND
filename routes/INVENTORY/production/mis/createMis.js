const express = require("express");
const router = express.Router();

let { invtDB } = require("../../../../config/db/connection");
const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
const Validator = require("validatorjs");


router.post("/add", [auth.isAuthorized], async (req, res) => {
  let codeLength = req.body.code.length;

  if (codeLength <= 0) {
    return res.json({ status: "error", success: false, message: "Please add atleast one SKU/Component" });
  }

  /*if (new Set(req.body.code).size !== codeLength) {
    return res.json({ success: false, message: "Duplicate entries found in the SKU / Component" });
  }*/

	// Combine all entries to check for duplicates based on your custom logic
	  const entries = req.body.code.map((code, index) => ({
		department: req.body.department,
		lineNo: req.body.lineNo[index],
		code: req.body.code[index],
		shiftIn: req.body.shiftIn[index],
		shiftEnd: req.body.shiftEnd[index],
		date: req.body.date[index],
		type: req.body.type[index],
	  }));

	  const seen = new Set();
	  for (const entry of entries) {
		const key = `${entry.department}-${entry.lineNo}-${entry.code}-${entry.shiftIn}-${entry.shiftEnd}-${entry.date}-${entry.type}`;
		if (seen.has(key)) {
		  return res.json({ success: false, message: "Duplicate entries found in the SKU / Component" });
		}
		seen.add(key);
	  }

	
  for (let i = 0; i < codeLength; i++) {
    let codeValidation = new Validator(
      {
        shiftCode: req.body.shiftCode[i],
        department: req.body.department,
        code: req.body.code[i],
        type: req.body.type[i],
        manPower: req.body.manPower[i],
        lineNo: req.body.lineNo[i],
        output: req.body.output[i],
        shiftIn: req.body.shiftIn[i],
        shiftEnd: req.body.shiftEnd[i],
        overTime: req.body.overTime[i],
        workHoursIn: req.body.workHoursIn[i],
        workHoursEnd: req.body.workHoursEnd[i],
        remarks: req.body.remarks[i],
        date: req.body.date[i],
      },
      {
        shiftCode: "required",
        department: "required",
        code: "required",
        type: "required",
        manPower: "required",
        lineNo: "required",
        output: "required",
        shiftIn: "required",
        shiftEnd: "required",
        workHoursIn: "required",
        workHoursEnd: "required",
        date: "required",
      }
    );
    if (codeValidation.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(codeValidation) });
    }
  }

  try {
    const todayDate = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")
    const txnID = helper.getUniqueTxnID();
    const t = await invtDB.transaction();

    let check, stmt;
    for (let i = 0; i < codeLength; i++) {
      if (helper.number(req.body.manPower[i]) > 0) {
        // check duplicate entry
        check = await invtDB.query("SELECT ID FROM mis_prod_entry WHERE mis_dprt = :department AND mis_line_no = :line AND mis_code = :code AND mis_shift_in = :shiftIn AND mis_shift_end = :shiftEnd AND DATE_FORMAT(mis_date, '%Y-%m-%d') = :date AND mis_type = :type", {
          replacements: {
            department: req.body.department,
            line: req.body.lineNo[i],
            code: req.body.code[i],
            shiftIn: req.body.shiftIn[i],
            shiftEnd: req.body.shiftEnd[i],
            date: moment(req.body.date[i], "DD-MM-YYYY").format("YYYY-MM-DD"),
			  type: req.body.type[i]
          },
          type: invtDB.QueryTypes.SELECT
        });

        if (check.length > 0) {
          return res.json({ status: "error", success: false, message: "a duplicate entry found for the sequence no. [" + (i + 1) + "]" });
        }

        stmt = await invtDB.query(
          "INSERT INTO `mis_prod_entry` (mis_dprt , mis_type, mis_code, mis_shift, mis_man_power, mis_line_no , mis_output, mis_date , mis_shift_in, mis_shift_end, mis_over_time, mis_work_hr_in , mis_work_hr_end, mis_remark, mis_entry_date, mis_save_by, mis_txn) VALUE(:department, :type, :code, :shiftCode, :manPower, :lineNo, :output, :mis_date, :shiftIn, :shiftEnd, :overTime, :workHoursIn, :workHoursEnd, :remarks, :date, :saveBy,  :txn)", {
          replacements: {
            department: req.body.department,
            type: req.body.type[i],
            code: req.body.code[i],
            shiftCode: req.body.shiftCode[i],
            manPower: req.body.manPower[i],
            lineNo: req.body.lineNo[i],
            output: req.body.output[i],
            shiftIn: req.body.shiftIn[i],
            shiftEnd: req.body.shiftEnd[i],
            overTime: req.body.overTime[i] ?? "00:00",
            workHoursIn: req.body.workHoursIn[i],
            workHoursEnd: req.body.workHoursEnd[i],
            remarks: req.body.remarks[i] ?? '--',
            mis_date: moment(req.body.date[i], "DD-MM-YYYY").format("YYYY-MM-DD"),
            date: todayDate,
            saveBy: req.logedINUser,
            txn: txnID
          }, type: invtDB.QueryTypes.INSERT, transaction: t
        });

      }
    }

    if (stmt.length == 0) {
      await t.rollback();
      return res.json({ status: "error", success: false, message: "an error occured while recording MIS" });
    }
    await t.commit();
    return res.json({ status: "success", success: true, message: "MIS Recorded", data: { txn: txnID } });

  } catch (err) {
      return helper.errorResponse(res, err);
  }
});


router.post("/createDprt", [auth.isAuthorized], async (req, res) => {
    try {
        const valid = new Validator(req.body, {
            department: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const dprt = await invtDB.query("SELECT * FROM master_prod_dprt WHERE dprt_name = :department", {
            replacements: {
                department: req.body.department
            },
            type: invtDB.QueryTypes.SELECT
        });

        if (dprt.length > 0) {
            return res.json({ status: "error", success: false, message: "Department already exists" });
        }

        const stmt = await invtDB.query("INSERT INTO master_prod_dprt (dprt_name, prod_dprt_key, dprt_insert_by , dprt_insert_dt ) VALUE( :department, :prod_dprt_key, :dprt_insert_by , :dprt_insert_dt )", {
            replacements: {
                department: req.body.department,
                prod_dprt_key: helper.getUniqueNumber(),
                dprt_insert_by: req.logedINUser,
                dprt_insert_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")
            },
            type: invtDB.QueryTypes.INSERT
        });

        return res.json({ status: "success", success: true, message: "Department created successfully" });

    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "internally something happend wrong, contact to administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }
})

router.get("/shiftList", [auth.isAuthorized], async (req, res) => {
  try {
    const shiftList = await invtDB.query("SELECT shift_key as id , shift as name , start_hour as start , end_hour as end FROM mis_shift_time", {
      type: invtDB.QueryTypes.SELECT,
    });
    return res.json({ status: "success", success: true, message: "Data fetched successfully", data: shiftList });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

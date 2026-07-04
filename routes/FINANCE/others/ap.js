const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");
const xlsx = require("xlsx");
const multer = require("multer");
const path = require("path");
let fs = require('fs');


//for multer
var storage = multer.diskStorage({
  destination: (req, file, callBack) => {
    callBack(null, "./files/apBillSetup/");
  },
  filename: (req, file, callBack) => {
    callBack(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
  },
});

var upload = multer({ storage: storage });

// FETCH VENDORS IN LEDGER
router.post("/fetchVendorLedger", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'V' LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'V' AND (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          id: stmt[i].ledger_key,
          text: `(${stmt[i].code})${stmt[i].ladger_name}`,
        });
      }
      return res.json(final);
    } else {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH VENDOR IN VBT
router.post("/fetchVendorVbt", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      vendor: "required",
    });

    if (validation.fails()) {
      return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT `vbt_key` FROM `tally_vbt` WHERE `vbt_ap_status` = 'O' AND `ven_code` = :vendor GROUP BY `vbt_key` LIMIT 50 ", {
        replacements: { vendor: req.body.vendor },
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT `vbt_key` FROM `tally_vbt` WHERE `vbt_ap_status` = 'O' AND `ven_code` = :vendor AND `vbt_key` = :vbt_key GROUP BY `vbt_key` LIMIT 50 ", {
        replacements: { vendor: req.body.vendor, vbt_key: req.body.vbt_code },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          id: stmt[i].vbt_key,
          text: stmt[i].vbt_key,
        });
      }

      return res.json(final);
    } else {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH VBT AMMOUNT
router.post("/fetchVoucherData", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      vbt_code: "required",
    });

    if (validation.fails()) {
      return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }

    let data = {};

    // GET VENDOR AND REF_NO.
    let stmt = await tallyDB.query("SELECT `ven_code`, `vbt_key` FROM `tally_vbt` WHERE `vbt_key` = :vbt_key GROUP BY `vbt_key` ", {
      replacements: { vbt_key: req.body.vbt_code },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      data.vendor = stmt[0].ven_code;
      data.ref_no = stmt[0].vbt_key;
    } else {
      return res.json({ status: "error", success: false, message: "Something wrong !!! Please try again" });
    }

    // GET TOTAL VENDOR AMMOUNT
    let stmt_total_amm = await tallyDB.query("SELECT SUM(`vbt_ven_ammount`) as ven_ammount  FROM `tally_vbt` WHERE `vbt_key` = :vbt_key ", {
      replacements: { vbt_key: req.body.vbt_code },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (stmt_total_amm.length > 0) {
      data.ven_ammount = Number(stmt_total_amm[0].ven_ammount).toFixed(0);

      let stmt_pend = await tallyDB.query("SELECT SUM(`ap_os_amm`) as total_ap_os_amm FROM `tally_ap` WHERE `ap_so_ref_no` = :v_key ", {
        replacements: { v_key: stmt[0].vbt_key },
        type: tallyDB.QueryTypes.SELECT,
      });
      if (stmt_pend.length > 0) {
        // PENDIG AMMOUNT
        data.os_amm = Number(data.ven_ammount) - Number(stmt_pend[0].total_ap_os_amm);
      } else {
        // TOTAL AMMOUNT
        data.os_amm = data.ven_ammount;
      }

      return res.json({ status: "success", success: true, data: data });
    } else {
      return res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH AP DATA
router.post("/fetchApData", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      vendor: "required",
    });

    if (validation.fails()) {
      return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }

    let data = [];
    // GET VENDOR BILL DATA
    let stmt = await tallyDB.query("SELECT po_number , project_id ,  `ven_code`, `vbt_key`, `vbt_invoice_no`, `vbt_invoice_date`, min_id FROM `tally_vbt` WHERE `vbt_ap_status` = 'O' AND `ven_code` = :vendor GROUP BY `vbt_key`,po_number", {
      replacements: { vendor: req.body.vendor },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      for (let i = 0; i < stmt.length; i++) {

        // GET TOTAL VENDOR AMMOUNT
        let debitVenAmount = 0
        let stmt_total_amm = await tallyDB.query("SELECT SUM(`vbt_ven_ammount`) as ven_ammount  FROM `tally_vbt` WHERE `vbt_key` = :vbt_key AND vbt_status != 'DE' AND po_number = :poID", {
          replacements: {
            vbt_key: stmt[i].vbt_key,
            poID: stmt[i].po_number
          },
          type: tallyDB.QueryTypes.SELECT,
        });

        // total vendor amount of debit note
        let stmt_total_amm1 = await tallyDB.query("SELECT SUM(`vbt_ven_ammount`) as ven_ammount  FROM `tally_vbt` WHERE `vbt_key` = :vbt_key AND vbt_status = 'DE' AND po_number = :poID", {
          replacements: {
            vbt_key: stmt[i].vbt_key,
            poID: stmt[i].po_number
          },
          type: tallyDB.QueryTypes.SELECT,
        });

        if (stmt_total_amm1.length > 0) {
          debitVenAmount = stmt_total_amm1[0].ven_ammount;
        }

        let stmt_pend = await tallyDB.query("SELECT SUM(`ap_os_amm`) as total_ap_os_amm FROM `tally_ap` WHERE `ap_ref_no` = :v_key AND po_number = :poID ", {
          replacements: {
            v_key: stmt[i].vbt_key,
            poID: stmt[i].po_number
          },
          type: tallyDB.QueryTypes.SELECT,
        });

        let os_amm = stmt_total_amm[0].ven_ammount;

        if (stmt_pend.length > 0) {
          // PENDIG AMMOUNT
          os_amm = Number(stmt_total_amm[0].ven_ammount) - Number(stmt_pend[0].total_ap_os_amm);
        }

        let stmt_amt = await tallyDB.query("SELECT SUM(vbt_ven_ammount) as vendorAmount FROM tally_vbt WHERE vbt_key = :vbt_key AND vbt_status != 'DE'", {
          replacements: {
            vbt_key: stmt[i].vbt_key,
          },
          type: tallyDB.QueryTypes.SELECT,
        });

        let debitBillAmount = 0

        let stmt_amt1 = await tallyDB.query("SELECT SUM(vbt_ven_ammount) as vendorDebitAmount FROM tally_vbt WHERE vbt_key = :vbt_key AND vbt_status = 'DE'", {
          replacements: {
            vbt_key: stmt[i].vbt_key,
          },
          type: tallyDB.QueryTypes.SELECT,
        });

        if (stmt_amt1.length > 0) {
          debitBillAmount = stmt_amt1[0].vendorDebitAmount;
        }

        data.push({
          v_key: stmt[i].vbt_key,
          v_code: stmt[i].ven_code,
          invoice_number: stmt[i].vbt_invoice_no,
          invoice_date: stmt[i].vbt_invoice_date,
          os_amm: Number(os_amm).toFixed(0) - Number(debitVenAmount).toFixed(0),
          clear_amm: Number(stmt_total_amm[0].ven_ammount).toFixed(0) - Number(os_amm).toFixed(0),
          ammount: Number(stmt_total_amm[0].ven_ammount).toFixed(0) - Number(debitVenAmount).toFixed(0),
          totalBillAmount: Number(stmt_amt[0].vendorAmount).toFixed(0) - Number(debitBillAmount).toFixed(0),
          po_id: stmt[i].po_number,
          project: stmt[i].project_id ?? "--",
          cost_center: "--",
        });
      } // END FOR
    }

    // FETCH VOUCHER DATA
    let voucher_data = [];
    let jvData = [];

    let stmt_voucher_data = await tallyDB.query(
      "SELECT `tally_ledger_data`.`debit`, tally_ledger_data.credit, `tally_ledger_data`.`module_used` , `tally_ledger_data`.`ref_date` , `tally_ledger`.`ladger_name` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON `tally_ledger`.`ledger_key`=`tally_ledger_data`.`voucher_account` WHERE `ledger_ap_status` != 'C' AND `which_module` IN ('BP','CP','JV') AND `ladger_key` = :vendor ",
      {
        replacements: { vendor: req.body.vendor },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (stmt_voucher_data.length > 0) {
      for (let i = 0; i < stmt_voucher_data.length; i++) {
        let stmt_so_ammt = await tallyDB.query("SELECT SUM(ap_so_amm) as total_ap_so_amm FROM `tally_ap` WHERE `ap_so_ref_no` = :v_code AND ap_ven_code = :venCode ", {
          replacements: {
            v_code: stmt_voucher_data[i].module_used,
            venCode: req.body.vendor
          },
          type: tallyDB.QueryTypes.SELECT,
        });
        let os_amm = stmt_voucher_data[i].debit;
        if (stmt_so_ammt.length > 0) {
          // PENDING AMMOUNT
          os_amm = Number(stmt_voucher_data[i].debit) - Number(stmt_so_ammt[0].total_ap_so_amm);

        }

        if (os_amm != 0) {
          voucher_data.push({
            os_amm: os_amm,
            voucher_code: stmt_voucher_data[i].module_used,
            bank: stmt_voucher_data[i].ladger_name,
            effective_date: moment(stmt_voucher_data[i].ref_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
            so_amm: stmt_so_ammt[0].total_ap_so_amm ?? 0,
            bank_amount: stmt_voucher_data[i].debit
          });
        }

        let jvOutstanding = Number(stmt_voucher_data[i].credit);
        let jvSettledAmount = await tallyDB.query("SELECT SUM(ap_so_amm) AS totalApSoAmount FROM tally_ap WHERE ap_ref_no = :jv AND ap_ven_code = :venCode", {
          replacements: {
            jv: stmt_voucher_data[i].module_used,
            venCode: req.body.vendor
          },
          type: tallyDB.QueryTypes.SELECT,
        });

        if (jvSettledAmount.length > 0) {
          jvOutstanding -= Number(jvSettledAmount[0].totalApSoAmount);
        }

        if (jvOutstanding != 0) {
          jvData.push({
            v_key: stmt_voucher_data[i].module_used,
            v_code: req.body.vendor,
            invoice_number: "--",
            invoice_date: "--",
            os_amm: Number(jvOutstanding.toFixed(2)),
            clear_amm: Number(jvSettledAmount[0].totalApSoAmount).toFixed(2),
            ammount: Number(stmt_voucher_data[i].credit).toFixed(2),
            totalBillAmount: Number(stmt_voucher_data[i].credit).toFixed(2),
            po_id: "--",
            project: "--",
            cost_center: "--",
          })
        }

      }
    }

    let billData = data.concat(jvData);

    return res.json({ status: "success", success: true, bill_data: billData, voucher_data: voucher_data });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

//fetch ap data through file upload 
router.post("/fetchApDataFile", [auth.isAuthorized], upload.single("file"), async (req, res) => {
  try {
    let workbook = xlsx.readFile("./files/apBillSetup/" + req.file.filename);
    let jsonData = xlsx.utils.sheet_to_json(workbook.Sheets.Sheet1);
    let result = [];
    for (let i = 0; i < jsonData.length; i++) {
      if (jsonData[i].osAmount) {
        result.push({
          invoice_date: jsonData[i].invoiceDate,
          invoice_number: jsonData[i].invoiceNo,
          os_amm: jsonData[i].pendingAmount,
          ammount: jsonData[i].billAmount,
          clear_amm: jsonData[i].settledAmount,
          totalBillAmount: jsonData[i].totalBillAmount,
          v_key: jsonData[i].vbtNo,
          project: jsonData[i].project,
          cost_center: jsonData[i].costCenter,
          po_id: jsonData[i].poID,
          selectedAmount: jsonData[i].osAmount
        });
      }
    }
    return res.status(200).send(result);
  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

// FETCH OPEN BANK PAYMETS
router.post("/fetchBpVouchers", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;

    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT `module_used` FROM `tally_ledger_data` WHERE `which_module` = 'BPM' AND `ledger_ap_status` = 'O' ", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT `module_used` FROM `tally_ledger_data` WHERE `which_module` = 'BPM' AND `ledger_ap_status` = 'O' AND `module_used` =   :name ", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          id: stmt[i].module_used,
          text: stmt[i].module_used,
        });
      }
      return res.json(final);
    } else {
      return res.json({ status: "error", success: false, message: "Data Not Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH BANK PAYMENT DATA
router.post("/fetchPaymentData", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      v_code: "required",
    });

    if (validation.fails()) {
      return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }

    let data = {};

    let stmt = await tallyDB.query("SELECT `credit`, `module_used` FROM `tally_ledger_data` WHERE `which_module` = 'BPM' AND `module_used` = :v_code ", {
      replacements: { v_code: req.body.v_code },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      // data.payment_amm = stmt[0].credit;
      data.v_code = stmt[0].module_used;
      let stmt_so_ammt = await tallyDB.query("SELECT SUM(ap_so_amm) as total_ap_so_amm FROM `tally_ap` WHERE `ap_ref_no` = :v_code ", {
        replacements: { v_code: stmt[0].module_used },
        type: tallyDB.QueryTypes.SELECT,
      });

      if (stmt_so_ammt.length > 0) {
        // PENDING AMMOUNT
        data.so_amm = Number(stmt[0].credit) - Number(stmt_so_ammt[0].total_ap_so_amm);
      } else {
        // TOTAL AMMOUNT IS PENDING AMMOUNT
        data.so_amm = stmt[0].credit;
      }

      return res.json({ status: "success", success: true, data: data });
    } else {
      return res.json({ status: "error", success: false, message: "Data Not Found!!! Please check again" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// INSERT AP DATA (BILL SETUP)
router.post("/insertAp", [auth.isAuthorized], async (req, res) => {
  const transaction = await tallyDB.transaction();

  try {
    let validation = new Validator(req.body, {
      so_ref_no: "required",
      so_ammount: "required",
      vendor: "required",
    });
    if (validation.fails()) {
      await transaction.rollback();
      return res.json({ message: Object.values(validation.errors.all())[0].join() , status: "error", success: false });
    }

    let ref_length = req.body.ref_no.length;

    if (ref_length <= 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Please check input fields!" });
    }

    let total_input_os_amm = 0;
    for (let i = 0; i < ref_length; i++) {
      let validation = new Validator(
        {
          ref_no: req.body.ref_no[i],
          os_ammount: req.body.os_ammount[i],
        },
        {
          ref_no: "required",
          os_ammount: "required",
        }
      );
      if (validation.fails()) {
        await transaction.rollback();
        return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
      }
      total_input_os_amm += Number(Number(req.body.os_ammount[i]).toFixed(0));
    } // END FOR LOOP

    if (Number(total_input_os_amm) > Number(req.body.so_ammount)) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Amount not matched." });
    }

    const key = "VEN" + helper.getUniqueNumber();
    const insert_dt = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    for (let i = 0; i < ref_length; i++) {
      // CHECK IF BILL SET
      let stmt_check_bill_set;

      if (req.body.ref_no[i].startsWith("JV")) {
        stmt_check_bill_set = await tallyDB.query("SELECT module_used FROM tally_ledger_data WHERE `which_module` = 'JV' AND `module_used` = :v_key AND ledger_ap_status = 'C' AND ladger_key = :vendor", {
          replacements: { v_key: req.body.ref_no[i], vendor: req.body.vendor },
          type: tallyDB.QueryTypes.SELECT,
        })
      } else {
        stmt_check_bill_set = await tallyDB.query("SELECT `vbt_key` FROM `tally_vbt` WHERE `vbt_ap_status` = 'C' AND `vbt_key` = :v_key ", {
          replacements: { v_key: req.body.ref_no[i] },
          type: tallyDB.QueryTypes.SELECT,
        });
      }
      if (stmt_check_bill_set.length > 0) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "${req.body.ref_no[i]} No. ${Number(req.body.os_ammount[i]).toFixed(0)} already settled " });
      }

      let stmt_total_ven_amm;

      if (req.body.ref_no[i].startsWith("JV")) {
        stmt_total_ven_amm = await tallyDB.query("SELECT SUM(credit) AS ven_ammount FROM `tally_ledger_data` WHERE `which_module` = 'JV' AND `module_used` = :vbt_key AND ladger_key = :ladger", {
          replacements: {
            vbt_key: req.body.ref_no[i],
            ladger: req.body.vendor
          },
          type: tallyDB.QueryTypes.SELECT,
        })
      } else {
        // GET TOTAL VENDOR AMMOUNT
        stmt_total_ven_amm = await tallyDB.query("SELECT SUM(`vbt_ven_ammount`) as ven_ammount  FROM `tally_vbt` WHERE `vbt_key` = :vbt_key ", {
          replacements: { vbt_key: req.body.ref_no[i] },
          type: tallyDB.QueryTypes.SELECT,
        });
      }

      // CHECK OS AMMOUNT(BILL)
      let stmt_check_os_amm = await tallyDB.query("SELECT COALESCE(SUM(`ap_os_amm`), 0) as total_ap_os_amm FROM `tally_ap` WHERE `ap_so_ref_no` = :v_key ", {
        replacements: { v_key: req.body.ref_no[i] },
        type: tallyDB.QueryTypes.SELECT,
      });

      // CHECK OS AMMOUNT(BILL) IS LESS THAN PENDING AMM
      if (Number(req.body.os_ammount[i]) > Number(stmt_total_ven_amm[0].ven_ammount).toFixed(0) - Number(stmt_check_os_amm[0].total_ap_os_amm).toFixed(0)) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Please check the bill ammount again..." });
      }

      // // GET TOTAL SO AMMOUNT (PAYMENT)
      let stmt_total_so = await tallyDB.query("SELECT `debit`, `module_used` FROM `tally_ledger_data` WHERE `which_module` IN ('BP','CP' ,'JV') AND `module_used` = :v_code AND ladger_key = :vendor", {
        replacements: {
          v_code: req.body.so_ref_no,
          vendor: req.body.vendor
        },
        type: tallyDB.QueryTypes.SELECT,
      });
      // CHECK TOAL SO AMMOUNT (PAYMENT)
      let stmt_so_ammt = await tallyDB.query("SELECT SUM(ap_so_amm) as total_ap_so_amm FROM `tally_ap` WHERE `ap_ref_no` = :v_code ", {
        replacements: { v_code: req.body.so_ref_no },
        type: tallyDB.QueryTypes.SELECT,
      });

      if (Number(stmt_total_so[0].credit) - Number(stmt_so_ammt[0].total_ap_so_amm) < Number(req.body.so_ammount[i])) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Please check the payment ammount again..." });
      }

      // let so_ammt = Number(req.body.so_amm) - Number(req.body.os_ammount[i]).toFixed(0);

      let stmt = await tallyDB.query("INSERT INTO `tally_ap` (`ap_type` , `ap_key`, `ap_ven_code` , `ap_ref_no` , `ap_os_amm` , `ap_so_amm` , `ap_so_ref_no` , project_id , po_number, `insert_by` , `insert_dt` ) VALUES ( :ap_type, :ap_key , :ap_ven_code , :ap_ref_no, :ap_os_amm , :ap_so_amm , :ap_so_ref_no , :project , :poID ,  :insert_by , :insert_dt ) ", {
        replacements: {
          ap_type: "VENDOR",
          ap_key: key,
          ap_ven_code: req.body.vendor,
          ap_ref_no: req.body.ref_no[i],
          ap_os_amm: Number(req.body.os_ammount[i]).toFixed(0),
          ap_so_amm: Number(req.body.os_ammount[i]).toFixed(0),
          ap_so_ref_no: req.body.so_ref_no,
          project: req.body.project[i],
          poID: req.body.poID[i],
          insert_by: req.logedINUser,
          insert_dt: insert_dt,
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transaction,
      });

      if (stmt.length > 0) {
        // IF PENDING AMMOUNT (OS AMM)(BILL) IS ZERO SETOFF

        if (Number(stmt_check_os_amm[0].total_ap_os_amm).toFixed(0) == Number(req.body.os_ammount[i]).toFixed(0)) {

          if (req.body.ref_no[i].startsWith("VBT")) {
            let stmt_update = await tallyDB.query("UPDATE `tally_vbt` SET `vbt_ap_status` = 'C' WHERE `vbt_key` = :vbt_key ", {
              replacements: { vbt_key: req.body.ref_no[i] },
              type: tallyDB.QueryTypes.UPDATE,
              transaction: transaction,
            });
          }
          let stmt_update_2 = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_ap_status` = 'C' WHERE `module_used` = :v_key AND ladger_key = :vendor", {
            replacements: {
              v_key: req.body.ref_no[i],
              vendor: req.body.vendor
            },
            type: tallyDB.QueryTypes.UPDATE,
            transaction: transaction,
          });
        } else if (Number(req.body.os_ammount[i]).toFixed(0) == Number(stmt_total_ven_amm[0].ven_ammount).toFixed(0)) {

          if (req.body.ref_no[i].startsWith("VBT")) {
            let stmt_update = await tallyDB.query("UPDATE `tally_vbt` SET `vbt_ap_status` = 'C' WHERE `vbt_key` = :vbt_key ", {
              replacements: { vbt_key: req.body.ref_no[i] },
              type: tallyDB.QueryTypes.UPDATE,
              transaction: transaction,
            });
          }
          let stmt_update_2 = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_ap_status` = 'C' WHERE `module_used` = :v_key AND ladger_key = :vendor", {
            replacements: {
              v_key: req.body.ref_no[i],
              vendor: req.body.vendor
            },
            type: tallyDB.QueryTypes.UPDATE,
            transaction: transaction,
          });
        }
        // IF PENDING (SO)(PAY) IS ZERO SETOFF
        if (Number(stmt_total_so[0].credit).toFixed(0) == Number(stmt_so_ammt[0].total_ap_so_amm).toFixed(0)) {
          let stmt_update_bp = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_ap_status` = 'C' WHERE  `which_module` IN ('BPM','CPM','JV') AND `module_used` = :v_key ", {
            replacements: { v_key: req.body.so_ref_no },
            type: tallyDB.QueryTypes.UPDATE,
            transaction: transaction,
          });
        } else if (Number(req.body.so_ammount) == Number(req.body.os_ammount[i]).toFixed(0)) {
          let stmt_update_bp = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_ap_status` = 'C' WHERE `which_module` IN ('BPM','CPM','JV') AND `module_used` = :v_key ", {
            replacements: { v_key: req.body.so_ref_no },
            type: tallyDB.QueryTypes.UPDATE,
            transaction: transaction,
          });
        }
      } else {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Something wrong!!! please try again" });
      }
    }
    await transaction.commit();
    return res.json({ status: "success", success: true, message: "App Bill Setup Successfull" });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// INSERT AP DATA (PAYMENT SETUP)
router.post("/paymentSetup", [auth.isAuthorized], async (req, res) => {
  const transaction = await tallyDB.transaction();

  try {
    let validation = new Validator(req.body, {
      ref_no: "required",
      os_ammount: "required",
    });
    if (validation.fails()) {
      await transaction.rollback();
      return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
    }

    let ref_length = req.body.so_ref_no.length;
    if (ref_length <= 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Please check input fields!!!" });
    }

    let total_input_so_ammount = 0;
    for (let i = 0; i < ref_length; i++) {
      let validation = new Validator(
        {
          so_ref_no: req.body.so_ref_no[i],
          so_ammount: req.body.so_ammount[i],
        },
        {
          so_ref_no: "required",
          so_ammount: "required",
        }
      );
      if (validation.fails()) {
        await transaction.rollback();
        return res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
      }
      total_input_so_ammount += Number(Number(req.body.so_ammount[i]).toFixed(0));
    } // END FOR LOOP

    if (Number(total_input_so_ammount) > Number(req.body.os_ammount)) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Check ammount!!!" });
    }

    const key = "PAY" + helper.getUniqueNumber();
    const insert_dt = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    for (let i = 0; i < ref_length; i++) {
      // CHECK IF BILL SET
      let stmt_check_bill_set = await tallyDB.query("SELECT `vbt_key` FROM `tally_vbt` WHERE `vbt_ap_status` = 'C' AND `vbt_key` = :v_key ", {
        replacements: { v_key: req.body.ref_no },
        type: tallyDB.QueryTypes.SELECT,
      });

      if (stmt_check_bill_set.length > 0) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "${req.body.ref_no[i]} No. ${Number(req.body.os_ammount[i]).toFixed(0)} already setteled " });
      }

      // GET TOTAL VENDOR AMMOUNT
      let stmt_total_ven_amm = await tallyDB.query("SELECT SUM(`vbt_ven_ammount`) as ven_ammount  FROM `tally_vbt` WHERE `vbt_key` = :vbt_key ", {
        replacements: { vbt_key: req.body.ref_no },
        type: tallyDB.QueryTypes.SELECT,
      });
      // CHECK OS AMMOUNT(BILL)
      let stmt_check_os_amm = await tallyDB.query("SELECT COALESCE(SUM(`ap_so_amm`), 0) as total_ap_so_amm FROM `tally_ap` WHERE `ap_ref_no` = :v_key ", {
        replacements: { v_key: req.body.ref_no },
        type: tallyDB.QueryTypes.SELECT,
      });

      // CHECK OS AMMOUNT(BILL) IS LESS THAN PENDING AMM
      if (Number(req.body.so_ammount[i]) > Number(stmt_total_ven_amm[0].ven_ammount).toFixed(0) - Number(stmt_check_os_amm[0].total_ap_so_amm).toFixed(0)) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Please check the bill ammount again..." });
      }

      // // GET TOTAL SO AMMOUNT (PAYMENT)
      let stmt_total_so = await tallyDB.query("SELECT `credit`, `module_used` FROM `tally_ledger_data` WHERE `which_module` IN ('BPM', 'CPM') AND `module_used` = :v_code ", {
        replacements: { v_code: req.body.so_ref_no[i] },
        type: tallyDB.QueryTypes.SELECT,
      });
      // CHECK TOAL SO AMMOUNT (PAYMENT)
      let stmt_so_ammt = await tallyDB.query("SELECT SUM(ap_so_amm) as total_ap_so_amm FROM `tally_ap` WHERE `ap_so_ref_no` = :v_code ", {
        replacements: { v_code: req.body.so_ref_no[i] },
        type: tallyDB.QueryTypes.SELECT,
      });

      if (Number(stmt_total_so[0].credit) - Number(stmt_so_ammt[0].total_ap_so_amm) < Number(req.body.so_ammount[i])) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Please check the payment ammount again..." });
      }

      // let so_ammt = Number(req.body.so_amm) - Number(req.body.so_ammount[i]).toFixed(0);

      let stmt = await tallyDB.query("INSERT INTO `tally_ap` (`ap_type` , `ap_key` , `ap_ref_no` , `ap_os_amm` , `ap_so_amm` , `ap_so_ref_no` , `insert_by` , `insert_dt` ) VALUES ( :ap_type, :ap_key , :ap_ref_no, :ap_os_amm , :ap_so_amm , :ap_so_ref_no , :insert_by , :insert_dt ) ", {
        replacements: {
          ap_type: "PAYMENT",
          ap_key: key,
          ap_ref_no: req.body.ref_no,
          ap_os_amm: Number(req.body.so_ammount[i]).toFixed(0),
          ap_so_amm: Number(req.body.so_ammount[i]).toFixed(0),
          ap_so_ref_no: req.body.so_ref_no[i],
          insert_by: req.logedINUser,
          insert_dt: insert_dt,
        },
        type: tallyDB.QueryTypes.INSERT,
        transaction: transaction,
      });

      if (stmt.length > 0) {
        // IF PENDING AMMOUNT (OS AMM)(BILL) IS ZERO SETOFF

        if (Number(total_input_so_ammount).toFixed(0) == Number(stmt_total_ven_amm[0].ven_ammount).toFixed(0) - Number(stmt_so_ammt[0].total_ap_so_amm)) {
          let stmt_update = await tallyDB.query("UPDATE `tally_vbt` SET `vbt_ap_status` = 'C' WHERE `vbt_key` = :vbt_key ", {
            replacements: { vbt_key: req.body.ref_no },
            type: tallyDB.QueryTypes.UPDATE,
            transaction: transaction,
          });
          let stmt_update_2 = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_ap_status` = 'C' WHERE `module_used` = :v_key ", {
            replacements: { v_key: req.body.ref_no },
            type: tallyDB.QueryTypes.UPDATE,
            transaction: transaction,
          });
        }
        // IF PENDING (SO)(PAY) IS ZERO SETOFF

        let stmt_update_bp = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_ap_status` = 'C' WHERE `which_module` IN ('BP','CP') AND `module_used` = :v_key ", {
          replacements: { v_key: req.body.so_ref_no[i] },
          type: tallyDB.QueryTypes.UPDATE,
          transaction: transaction,
        });
      } else {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "Something wrong!!! please try again" });
      }
    }
    await transaction.commit();
    return res.json({ status: "success", success: true, message: "App. Payment Setuped..." });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});


router.get("/fetchApReport", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.query, {
      vendor: "required",
    });

    if (validation.fails()) {
      return res.status(403).send(Object.values(validation.errors.all())[0].join());
    }

    let stmt = await tallyDB.query(`SELECT mscorpre_ims_tally.tally_ap.* , ${global.ims_db_name}.admin_login.user_name FROM mscorpre_ims_tally.tally_ap LEFT JOIN ${global.ims_db_name}.admin_login ON ${global.ims_db_name}.admin_login.CustID = tally_ap.insert_by WHERE mscorpre_ims_tally.tally_ap.ap_ven_code = :vendor `, {
      replacements: { vendor: req.query.vendor },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        let vbt_invoice_date = '--'
        let vbt_invoice_no = '--'
        let ven_ammount = '--'
        let ven_name = '--'
        let vbt_ap_status = '--'

        let stmt_total_ven_amm = await tallyDB.query(`SELECT SUM(vbt_ven_ammount) as ven_ammount , vbt_invoice_no , vbt_ap_status ,vbt_invoice_date, ${global.ims_db_name}.ven_basic_detail.ven_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON ${global.ims_db_name}.ven_basic_detail.ven_register_id = tally_vbt.ven_code WHERE vbt_key = :vbt_key GROUP BY tally_vbt.vbt_key`, {
          replacements: {
            vbt_key: stmt[i].ap_ref_no,

          },
          type: tallyDB.QueryTypes.SELECT,
        });

        if (stmt_total_ven_amm.length > 0) {
          vbt_invoice_date = stmt_total_ven_amm[0].vbt_invoice_date,
            vbt_invoice_no = stmt_total_ven_amm[0].vbt_invoice_no,
            ven_ammount = Number(stmt_total_ven_amm[0].ven_ammount).toFixed(0),
            ven_name = stmt_total_ven_amm[0].ven_name,
            vbt_ap_status = stmt_total_ven_amm[0].vbt_ap_status == "C" ? "CLOSED" : "OPEN"
        }

        let stmt_bank_detail = await tallyDB.query("SELECT `tally_ledger`.`ladger_name`, `tally_ledger`.`code` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON `tally_ledger`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE `module_used` = :bp GROUP BY module_used  ", {
          replacements: { bp: stmt[i].ap_so_ref_no },
          type: tallyDB.QueryTypes.SELECT,
        });

        let bank_name;
        let bank_code;

        if (stmt_bank_detail.length > 0) {
          bank_name = stmt_bank_detail[0].ladger_name;
          bank_code = stmt_bank_detail[0].code
        }

        final.push({
          // type: stmt[i].ap_type,
          // ap_code: stmt[i].ap_key,
          // so_amm: stmt[i].ap_so_amm,
          soRefNo: stmt[i].ap_so_ref_no,
          bank: bank_name ? bank_name : '--',
          bankCode: bank_code ? bank_code : '--',
          refNo: stmt[i].ap_ref_no,
          invoiceDate: vbt_invoice_date,
          invoiceNumber: vbt_invoice_no,
          billAmm: ven_ammount,
          osAmmount: stmt[i].ap_os_amm,
          vendor: stmt[i].ap_ven_code ? stmt[i].ap_ven_code : '--',
          status: vbt_ap_status,
          projectId: stmt[i].project_id ? stmt[i].project_id : '--',
          poNumber: stmt[i].po_number ? stmt[i].po_number : '--',
          venName: ven_name,
          ID: Buffer.from(JSON.stringify(stmt[i].ID)).toString('base64'),
          insertBy: stmt[i].user_name,
          insertDate: moment(stmt[i].insert_dt).format("DD-MM-YYYY")
        });
      }

      return res.json(final);
    } else {
      return res.json({ status: "error", success: false, message: "No data found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// OPEN AP
router.post("/openAp", [auth.isAuthorized], async (req, res) => {
  const transaction = await tallyDB.transaction();
  try {
    let validation = new Validator(req.body, {
      vbt_code: "required|array",
      bank_code: "required|array",
      ID: "required|array",
    });

    if (validation.fails()) {
      await transaction.rollback();
      return res.status(403).send(Object.values(validation.errors.all())[0].join());
    }

    for (let i = 0; i < req.body.ID.length; i++) {
      let stmt = await tallyDB.query("SELECT `ap_ref_no`,`ap_so_ref_no` FROM `tally_ap` WHERE ID = :id ", {
        replacements: { id: Number(Buffer.from(req.body.ID[i], 'base64').toString('utf-8')) },
        type: tallyDB.QueryTypes.SELECT,
      });

      if (stmt.length > 0) {
        let findDebitNote = await tallyDB.query("SELECT * FROM tally_vbt WHERE vbt_key = :vbt AND vbt_status != :vbtStatus", {
          replacements: {
            vbt: req.body.vbt_code[i],
            vbtStatus: 'DE'
          },
          type: tallyDB.QueryTypes.SELECT
        })

        if (findDebitNote.length <= 0) {
          await transaction.rollback()
          return res.status(403).send(`Cannot delete ${req.body.vbt_code[i]} entry because Debit Note is made`)
        }

        let stmt_update = await tallyDB.query("UPDATE `tally_vbt` SET `vbt_ap_status` ='O' WHERE `vbt_key` = :vbt AND vbt_status != :vbtStatus", {
          replacements: {
            vbt: req.body.vbt_code[i],
            vbtStatus: 'DE'
          },
          type: tallyDB.QueryTypes.UPDATE,
          transaction: transaction,
        });

        let stmt_update2 = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_ap_status` = 'O' WHERE `module_used` = :vbt ", {
          replacements: { vbt: req.body.vbt_code[i] },
          type: tallyDB.QueryTypes.UPDATE,
          transaction: transaction,
        });

        let stmt_update3 = await tallyDB.query("UPDATE `tally_ledger_data` SET `ledger_ap_status` = 'O' WHERE `which_module` IN ('BP','CP') AND `module_used` = :voucher", {
          replacements: { voucher: req.body.bank_code[i] },
          type: tallyDB.QueryTypes.UPDATE,
          transaction: transaction,
        });

        let stmt_del = await tallyDB.query("DELETE FROM `tally_ap` WHERE ID = :id ", {
          replacements: { id: Number(Buffer.from(req.body.ID[i], 'base64').toString('utf-8')) },
          type: tallyDB.QueryTypes.DELETE,
          transaction: transaction,
        });

      } else {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "data not found" });
      }
    }

    await transaction.commit();

    return res.json({ status: "error", success: false, message: "entry deleted successfully" });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// ap report of all vendors
router.get("/fetchAccountsPayableReport", [auth.isAuthorized], async (req, res) => {
  try {

    let validation = new Validator(req.query, {
      vbtType: "required",
    });

    if (validation.fails()) {
      return res.status(403).send(Object.values(validation.errors.all()[0].join()));
    }

    let stmt = await tallyDB.query(`SELECT mscorpre_ims_tally.tally_ap.* , ${global.ims_db_name}.admin_login.user_name FROM mscorpre_ims_tally.tally_ap LEFT JOIN ${global.ims_db_name}.admin_login ON ${global.ims_db_name}.admin_login.CustID = tally_ap.insert_by WHERE tally_ap.ap_ref_no LIKE :vbtType`, {
      replacements: {
        vbtType: `%${req.query.vbtType}%`
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        let vbt_invoice_date = '--'
        let vbt_invoice_no = '--'
        let ven_ammount = '--'
        let ven_name = '--'
        let vbt_ap_status = '--'

        let stmt_total_ven_amm = await tallyDB.query(`SELECT SUM(vbt_ven_ammount) as ven_ammount , vbt_invoice_no , vbt_ap_status ,vbt_invoice_date, ${global.ims_db_name}.ven_basic_detail.ven_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON ${global.ims_db_name}.ven_basic_detail.ven_register_id = tally_vbt.ven_code WHERE vbt_key = :vbt_key GROUP BY tally_vbt.vbt_key`, {
          replacements: {
            vbt_key: stmt[i].ap_ref_no,
          },
          type: tallyDB.QueryTypes.SELECT,
        });

        if (stmt_total_ven_amm.length > 0) {
          vbt_invoice_date = stmt_total_ven_amm[0].vbt_invoice_date,
            vbt_invoice_no = stmt_total_ven_amm[0].vbt_invoice_no,
            ven_ammount = Number(stmt_total_ven_amm[0].ven_ammount).toFixed(0),
            ven_name = stmt_total_ven_amm[0].ven_name,
            vbt_ap_status = stmt_total_ven_amm[0].vbt_ap_status == "C" ? "CLOSED" : "OPEN"
        }

        let stmt_bank_detail = await tallyDB.query("SELECT `tally_ledger`.`ladger_name`, `tally_ledger`.`code` FROM `tally_ledger_data` LEFT JOIN `tally_ledger` ON `tally_ledger`.`ledger_key` = `tally_ledger_data`.`voucher_account`  WHERE `module_used` = :bp GROUP BY module_used  ", {
          replacements: { bp: stmt[i].ap_so_ref_no },
          type: tallyDB.QueryTypes.SELECT,
        });

        let bank_name;
        let bank_code;

        if (stmt_bank_detail.length > 0) {
          bank_name = stmt_bank_detail[0].ladger_name;
          bank_code = stmt_bank_detail[0].code
        }

        final.push({
          soRefNo: stmt[i].ap_so_ref_no,
          bank: bank_name ? bank_name : '--',
          bankCode: bank_code ? bank_code : '--',
          refNo: stmt[i].ap_ref_no,
          invoiceDate: vbt_invoice_date,
          invoiceNumber: vbt_invoice_no,
          billAmm: ven_ammount,
          osAmmount: stmt[i].ap_os_amm,
          vendor: stmt[i].ap_ven_code ? stmt[i].ap_ven_code : '--',
          status: vbt_ap_status,
          projectId: stmt[i].project_id ? stmt[i].project_id : '--',
          poNumber: stmt[i].po_number ? stmt[i].po_number : '--',
          venName: ven_name,
          ID: Buffer.from(JSON.stringify(stmt[i].ID)).toString('base64'),
          insertBy: stmt[i].user_name,
          insertDate: moment(stmt[i].insert_dt).format("DD-MM-YYYY")
        });
      }

      return res.json(final);
    } else {
      return res.json({ status: "error", success: false, message: "No data found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

//api to get sub groups of sundry creditors
router.get("/fetchSubGroup/sundryCreditor", [auth.isAuthorized], async (req, res) => {
  try {
    let fetchSubGroups = await tallyDB.query("SELECT CONCAT ('(', code , ')' , group_name) AS text , group_key AS value FROM tally_group WHERE parent = 'TP20220219125831'", {
      type: tallyDB.QueryTypes.SELECT
    });

    if (fetchSubGroups.length > 0) {
      return res.json(fetchSubGroups);
    }
    return res.json({ status: "error", success: false, message: "No data found" });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

//accounts payable report for all vendors in single report
router.get("/allApData", [auth.isAuthorized], async (req, res) => {
  try {

    let validation = new Validator(req.query, {
      groupKey: 'required'
    });

    if (validation.fails()) {
      return res.status(403).send(Object.values(validation.errors.all())[0].join());
    }

    let fetchVendors = await tallyDB.query("SELECT code FROM tally_ledger WHERE sub_group_key = :groupKey", {
      replacements: { groupKey: req.query.groupKey },
      type: tallyDB.QueryTypes.SELECT
    });

    if (fetchVendors.length === 0) {
      return res.json({ status: "error", success: false, message: "No vendors found" });
    }

    let data = [];
    for (let x = 0; x < fetchVendors.length; x++) {
      // GET VENDOR BILL DATA
      let stmt = await tallyDB.query(`SELECT po_number , project_id ,  ven_code, vbt_key, vbt_invoice_no, vbt_invoice_date, min_id , ven_code , effective_date , ${global.ims_db_name}.po_purchase_req.payment_terms_day AS paymentTermsDay FROM tally_vbt LEFT JOIN ${global.ims_db_name}.po_purchase_req ON  ${global.ims_db_name}.po_purchase_req.po_transaction = tally_vbt.po_number WHERE vbt_ap_status = 'O' AND ven_code = :vendor GROUP BY vbt_key,po_number`, {
        type: tallyDB.QueryTypes.SELECT,
        replacements: { vendor: fetchVendors[x].code }
      });

      if (stmt.length > 0) {
        for (let i = 0; i < stmt.length; i++) {

          // GET TOTAL VENDOR AMMOUNT
          let debitVenAmount = 0
          let stmt_total_amm = await tallyDB.query("SELECT SUM(`vbt_ven_ammount`) as ven_ammount  FROM `tally_vbt` WHERE `vbt_key` = :vbt_key AND vbt_status != 'DE' AND po_number = :poID", {
            replacements: {
              vbt_key: stmt[i].vbt_key,
              poID: stmt[i].po_number
            },
            type: tallyDB.QueryTypes.SELECT,
          });

          // total vendor amount of debit note
          let stmt_total_amm1 = await tallyDB.query("SELECT SUM(`vbt_ven_ammount`) as ven_ammount  FROM `tally_vbt` WHERE `vbt_key` = :vbt_key AND vbt_status = 'DE' AND po_number = :poID", {
            replacements: {
              vbt_key: stmt[i].vbt_key,
              poID: stmt[i].po_number
            },
            type: tallyDB.QueryTypes.SELECT,
          });

          if (stmt_total_amm1.length > 0) {
            debitVenAmount = stmt_total_amm1[0].ven_ammount;
          }

          let stmt_pend = await tallyDB.query("SELECT SUM(`ap_os_amm`) as total_ap_os_amm FROM `tally_ap` WHERE `ap_ref_no` = :v_key AND po_number = :poID ", {
            replacements: {
              v_key: stmt[i].vbt_key,
              poID: stmt[i].po_number
            },
            type: tallyDB.QueryTypes.SELECT,
          });

          let os_amm = stmt_total_amm[0].ven_ammount;

          if (stmt_pend.length > 0) {
            // PENDIG AMMOUNT
            os_amm = Number(stmt_total_amm[0].ven_ammount) - Number(stmt_pend[0].total_ap_os_amm);
          }

          let stmt_amt = await tallyDB.query("SELECT SUM(vbt_ven_ammount) as vendorAmount FROM tally_vbt WHERE vbt_key = :vbt_key AND vbt_status != 'DE'", {
            replacements: {
              vbt_key: stmt[i].vbt_key,
            },
            type: tallyDB.QueryTypes.SELECT,
          });

          let debitBillAmount = 0

          let stmt_amt1 = await tallyDB.query("SELECT SUM(vbt_ven_ammount) as vendorDebitAmount FROM tally_vbt WHERE vbt_key = :vbt_key AND vbt_status = 'DE'", {
            replacements: {
              vbt_key: stmt[i].vbt_key,
            },
            type: tallyDB.QueryTypes.SELECT,
          });

          if (stmt_amt1.length > 0) {
            debitBillAmount = stmt_amt1[0].vendorDebitAmount;
          }

          let poDetails, jwDetails, costCenter, orderNo;

          if (stmt[i].po_number != '--' && stmt[i].po_number != null && stmt[i].po_number != '') {

            poDetails = await invtDB.query("SELECT poTable.po_insert_date AS poDate , poTable.po_ship_id AS poShipId , poTable.po_cost_center FROM po_purchase_req AS poTable WHERE poTable.po_transaction = :poNumber", {
              replacements: {
                poNumber: stmt[i].po_number
              },
              type: invtDB.QueryTypes.SELECT
            });

            costCenter = await invtDB.query("SELECT costCenter.cost_center_short_name FROM cost_center AS costCenter WHERE costCenter.cost_center_key = :costCenterKey", {
              replacements: {
                costCenterKey: poDetails[0].po_cost_center
              },
              type: invtDB.QueryTypes.SELECT
            });

            orderNo = stmt[i].po_number;

          }

          if (stmt[i].jw_id != '--' && stmt[i].jw_id != null && stmt[i].jw_id != '') {

            jwDetails = await invtDB.query("SELECT jwTable.jw_po_ship_id AS jwShipId , jwTable.jw_po_full_date AS jwDate , jwTable.jw_cost_center FROM jw_purchase_req AS jwTable WHERE jwTable.jw_jw_transaction = :jwNumber", {
              replacements: {
                jwNumber: stmt[i].jw_id
              },
              type: invtDB.QueryTypes.SELECT
            });

            costCenter = await invtDB.query("SELECT costCenter.cost_center_short_name FROM cost_center AS costCenter WHERE costCenter.cost_center_key = :costCenterKey", {
              replacements: {
                costCenterKey: jwDetails[0].jw_cost_center
              },
              type: invtDB.QueryTypes.SELECT
            });

            orderNo = stmt[i].jw_id;
          }

          const currDate = moment(new Date()).format("YYYY-MM-DD");

          data.push({
            vbtKey: stmt[i].vbt_key,
            vendorCode: stmt[i].ven_code,
            invoiceNumber: stmt[i].vbt_invoice_no,
            invoiceDate: stmt[i].vbt_invoice_date,
            effectiveDate: moment(stmt[i].effective_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
            osAmm: Number(os_amm).toFixed(0) - Number(debitVenAmount).toFixed(0),
            clearAmm: Number(stmt_total_amm[0].ven_ammount).toFixed(0) - Number(os_amm).toFixed(0),
            amount: Number(stmt_total_amm[0].ven_ammount).toFixed(0) - Number(debitVenAmount).toFixed(0),
            totalBillAmount: Number(stmt_amt[0].vendorAmount).toFixed(0) - Number(debitBillAmount).toFixed(0),
            poID: orderNo ?? "--",
            project: stmt[i].project_id ?? "--",
            costCenter: costCenter?.[0].cost_center_short_name ? costCenter[0].cost_center_short_name : '--',
            type: "payable",
            dueDate: moment(stmt[i].effective_date, "YYYY-MM-DD").add(stmt[i].paymentTermsDay, "days").format("DD-MM-YYYY"),
            ageInvoiceWise: moment(currDate).diff(moment(stmt[i].vbt_invoice_date, "DD-MM-YYYY").format("YYYY-MM-DD"), "days") ?? "--",
            ageEffectiveWise: moment(currDate).diff(stmt[i].effective_date, "days") ?? "--",
          });
        } // END FOR
      }

    }

    return res.json(data);

  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;
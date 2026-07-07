const express = require("express");
const router = express.Router();

var bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

const multer = require("multer");

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");

const helper = require("../../../../helper/helper");

let {
  invtDB,
  tallyDB,
  invtOakterDB,
} = require("../../../../config/db/connection");


const Validator = require("validatorjs");
const e = require("express");

function getRandomCode(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
//

// Ensure folder exists or create it
const uploadFolder = path.join(__dirname, "./../../../../uploads/vendorDoc");
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadFolder); // Use the ensured folder
  },
  filename: function (req, file, cb) {
    cb(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
}); // 5MB



// GET GSTIN DETAILS
router.get("/check/gstin/details", [auth.isAuthorized], async (req, res) => {
  const gstin = req.query.gstin;

  if (!gstin) {
    return res.status(400).json({
      success: false,
      status: "error",
      message: "GSTIN is required",
    });
  }

  const result = await helper.gstInfo(gstin);

  if (!result.success) {
    return res.json(result);
  }

  return res.json(result);
});


router.post(
  "/addVendor",
  [auth.isAuthorized, upload.array("file")],
  async (req, res) => {
    const vendor = JSON.parse(req.body.vendor);
    const branch = JSON.parse(req.body.branch)
    // console.log("Branchs", branch);

    // Vendor validation
    const validation_vendor = new Validator(vendor, {
      vendorname: "required",
      panno: "required",
      eInvoice: "required",
    });
    if (validation_vendor.fails()) {
      return res.json({
        message: helper.firstErrorValidatorjs(validation_vendor),
        status: "error",
        success: false,
      });
    }

    // Branch validation
    const validation_branch = new Validator(branch, {
      branch: "required",
      state: "required",
      city: "required",
      address: "required",
      pincode: "required",
      mobile: "required",
      gstin: "required",
    });
    if (validation_branch.fails()) {
      return res.json({
        message: helper.firstErrorValidatorjs(validation_branch),
        status: "error",
        success: false,
      });
    }

    // MSME validation
    if (vendor.msme_status === "Y") {
      const validation_msme = new Validator(vendor, {
        msme_year: "required",
        msme_id: "required",
        msme_type: "required",
        msme_activity: "required",
      });
      if (validation_msme.fails()) {
        return res.json({
          message: helper.firstErrorValidatorjs(validation_msme),
          status: "error",
          success: false,
        });
      }

      if (!/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(vendor.msme_id)) {
        return res.json({
          message: "MSME number is not valid",
          status: "error",
          success: false,
        });
      }
    }

    const t1 = await invtDB.transaction();
    const t2 = await invtOakterDB.transaction();

    try {
      const filename = req?.file?.filename ?? "--";
      // const filename = req.files?.[0]?.filename ?? "--";

      // Generate vendor registration code
      const lastVendor = await invtDB.query(
        "SELECT `ven_register_id` FROM `ven_basic_detail` ORDER BY `ID` DESC LIMIT 1 FOR UPDATE",
        { type: invtDB.QueryTypes.SELECT, transaction: t1 }
      );

      let registrationCode;
      if (lastVendor.length > 0) {
        const vendor_last_id = lastVendor[0].ven_register_id;
        const strings = vendor_last_id.replace(/[0-9]/g, "");
        let digits = (
          parseInt(vendor_last_id.replace(/[^0-9]/g, "")) + 1
        ).toString();
        if (digits.length < 4) digits = ("000" + digits).substr(-4);
        registrationCode = strings + digits;
      } else {
        registrationCode = "VEN0001";
      }

      // Check state code
      const stateCheck = await invtDB.query(
        "SELECT * FROM `state_code` WHERE `state_code` = :statecode",
        {
          replacements: { statecode: branch.state },
          type: invtDB.QueryTypes.SELECT,
          transaction: t1,
        }
      );
      if (stateCheck.length === 0) {
        await Promise.all([t1.rollback(), t2.rollback()]);
        return res.json({
          message: "State code not found",
          status: "error",
          code: 404,
          success: false,
        });
      }

      // Check duplicates
      const [panCheck, nameCheck, regCheck] = await Promise.all([
        invtDB.query("SELECT * FROM ven_basic_detail WHERE ven_pan_no = :pan", {
          replacements: { pan: vendor.panno },
          type: invtDB.QueryTypes.SELECT,
          transaction: t1,
        }),
        invtDB.query("SELECT * FROM ven_basic_detail WHERE ven_name = :name", {
          replacements: { name: vendor.vendorname },
          type: invtDB.QueryTypes.SELECT,
          transaction: t1,
        }),
        invtDB.query(
          "SELECT * FROM ven_basic_detail WHERE ven_register_id = :reg",
          {
            replacements: { reg: registrationCode },
            type: invtDB.QueryTypes.SELECT,
            transaction: t1,
          }
        ),
      ]);

      if (panCheck.length > 0 || nameCheck.length > 0 || regCheck.length > 0) {
        await Promise.all([t1.rollback(), t2.rollback()]);
        let errorMsg =
          panCheck.length > 0
            ? "PAN No is already exists"
            : nameCheck.length > 0
              ? "Vendor name is already exists"
              : "Alloting vendor code is already exists";
        return res.json({ message: errorMsg, status: "error", success: false });
      }

      // Prepare payloads
      const vendorPayload = {
        term_day: vendor.term_days || 30,
        name: vendor.vendorname,
        pan: vendor.panno,
        cin: vendor?.cinno || "--",
        fulldate: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        vendor_id: registrationCode,
        vendor_file: filename,
        msme_status: vendor.msme_status,
        msme_year: vendor.msme_year || "--",
        msme_id: vendor.msme_id || "--",
        msme_type: vendor.msme_type || "--",
        msme_activity: vendor.msme_activity || "--",
        einvoice_status: vendor.eInvoice,
        einvoice_date:
          vendor.eInvoice === "Y" ? vendor.dateOfApplicability : "--",
        // bankName: branch.bank_name || "--",
        // bankIfsc: branch.ifs_code || "--",
        // bankBranch: branch.branch || "--",
        // bankAccountNo: branch.account_no || "--",
        // bankTransactionType: branch.transaction_type || "--",
        // vendorCurrency: branch.ledger_currency || "--",
        msme_effective_from: moment(vendor.msme_effective_from, "DD-MM-YYYY").format("YYYY-MM-DD"),
        documentName: vendor.documentName?.[0] || "--"
      };

      const insertVendorSQL = `
      INSERT INTO ven_basic_detail
      (ven_einvoice_status, ven_einvoice_date, ven_terms_day, ven_name, ven_pan_no, ven_cin_no, insert_full_date, ven_register_id, vendor_file, ven_msme_status, ven_msme_year, ven_msme_id, ven_msme_type, ven_msme_activity, msme_effective_from,	documentName)
      VALUES (:einvoice_status, :einvoice_date, :term_day, :name, :pan, :cin, :fulldate, :vendor_id, :vendor_file, :msme_status, :msme_year, :msme_id, :msme_type, :msme_activity, :msme_effective_from, :documentName)
    `;

      const addressPayload = {
        addressid: "SIV" + getRandomCode(999999999, 100000000),
        label: branch.branch,
        state: branch.state,
        city: branch.city,
        address: branch.address,
        pincode: branch.pincode,
        fax: branch?.fax || "--",
        email: branch.email ?? "n/a",
        mobile: branch.mobile,
        vendor_id: registrationCode,
        insertdt: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        insertby: req.logedINUser,
        gst: branch.gstin,
        bankName: branch.bank_name || "--",
        bankIfsc: branch.ifs_code || "--",
        bankBranch: branch.branch || "--",
        bankAccountNo: branch.account_no || "--",
        bankTransactionType: branch.transaction_type || "--",
        vendorCurrency: branch.ledger_currency || "--",
      };

      const insertAddressSQL = `
      INSERT INTO ven_address_detail
      (ven_address_id, ven_add_label, ven_state, ven_city, ven_address, ven_pincode, ven_fax, ven_email, ven_mobile, ven_id, ven_insert_dt, ven_insert_by, ven_add_gst,ven_bank_name, ven_bank_ifsc, ven_bank_ac, ven_bank_tt, ven_bank_branch, ven_transaction_cur)
      VALUES (:addressid, :label, :state, :city, :address, :pincode, :fax, :email, :mobile, :vendor_id, :insertdt, :insertby, :gst, :bankName, :bankIfsc, :bankAccountNo, :bankTransactionType, :bankBranch, :vendorCurrency)
    `;

      // Insert vendor and branch into both DBs
      await Promise.all([
        invtDB.query(insertVendorSQL, {
          replacements: vendorPayload,
          transaction: t1,
          type: invtDB.QueryTypes.INSERT,
        }),
        invtDB.query(insertAddressSQL, {
          replacements: addressPayload,
          transaction: t1,
          type: invtDB.QueryTypes.INSERT,
        }),
        invtOakterDB.query(insertVendorSQL, {
          replacements: vendorPayload,
          transaction: t2,
          type: invtOakterDB.QueryTypes.INSERT,
        }),
        invtOakterDB.query(insertAddressSQL, {
          replacements: addressPayload,
          transaction: t2,
          type: invtOakterDB.QueryTypes.INSERT,
        }),
      ]);

      await Promise.all([t1.commit(), t2.commit()]);

      return res.json({
        message: `Vendor with branch added successfully..<br/> RegID: #${registrationCode}`,
        status: "success",
        success: true,
        code: 200,
      });
    } catch (err) {
      console.error("Error in /addVendor:", err);
      await Promise.all([t1.rollback(), t2.rollback()]);
      return res.json({
        code: 500,
        message: err.message || "Something went wrong",
        status: "error",
        success: false,
      });
    }
  }
);


// ADD VENDOR BRANCH ONLY
router.post("/addVendorBranch", [auth.isAuthorized], async (req, res) => {
  const vendor = req.body.vendor;
  const branch = req.body.branch;

  if (!vendor?.vendorname) {
    return res.json({
      message: "Select the vendor to map the branch with.",
      status: "error",
      success: false,
    });
  }

  // Branch validation
  const validation = new Validator(branch, {
    branch: "required",
    state: "required",
    city: "required",
    address: "required",
    pincode: "required",
    mobile: "required",
    gstin: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: "Something is missing in the branch form fields.",
      status: "error",
      success: false,
    });
  }

  const t1 = await invtDB.transaction();
  const t2 = await invtOakterDB.transaction();

  try {
    // Check state code exists
    const stateCheck = await invtDB.query(
      "SELECT * FROM state_code WHERE state_code = :statecode",
      {
        replacements: { statecode: branch.state },
        type: invtDB.QueryTypes.SELECT,
        transaction: t1,
      }
    );
    if (stateCheck.length === 0) {
      await Promise.all([t1.rollback(), t2.rollback()]);
      return res.json({
        message: "State code not found in our records.",
        status: "error",
        success: false,
      });
    }

    // Check vendor exists
    const vendorCheckDB = await invtDB.query(
      "SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor_code",
      {
        replacements: { vendor_code: vendor.vendorname },
        type: invtDB.QueryTypes.SELECT,
        transaction: t1,
      }
    );
    const vendorCheckOakter = await invtOakterDB.query(
      "SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor_code",
      {
        replacements: { vendor_code: vendor.vendorname },
        type: invtOakterDB.QueryTypes.SELECT,
        transaction: t2,
      }
    );

    if (vendorCheckDB.length === 0 || vendorCheckOakter.length === 0) {
      await Promise.all([t1.rollback(), t2.rollback()]);
      return res.json({
        message: "Vendor does not exist in one or both DBs.",
        status: "error",
        success: false,
      });
    }

    // Prepare branch payload
    const branchPayload = {
      addressid: "SIV" + getRandomCode(999999999, 100000000),
      label: branch.branch,
      state: branch.state,
      city: branch.city,
      address: branch.address,
      pincode: branch.pincode,
      fax: branch.fax,
      email: branch.email,
      mobile: branch.mobile,
      vendor_id: vendor.vendorname,
      insertdt: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      insertby: req.logedINUser,
      gst: branch.gstin,
      bankName: branch.bank_name || "--",
      bankIfsc: branch.ifs_code || "--",
      bankBranch: branch.bank_branch || "--",
      bankAccountNo: branch.account_no || "--",
      bankTransactionType: branch.transaction_type || "--",
      vendorCurrency: branch.ledger_currency || "--",
    };

    const insertSQL = `
      INSERT INTO ven_address_detail
      (ven_address_id, ven_add_label, ven_state, ven_city, ven_address, ven_pincode, ven_fax, ven_email, ven_mobile, ven_id, ven_insert_dt, ven_insert_by, ven_add_gst, ven_bank_name, ven_bank_ifsc, ven_bank_ac, ven_bank_tt, ven_bank_branch, ven_transaction_cur)
      VALUES (:addressid, :label, :state, :city, :address, :pincode, :fax, :email, :mobile, :vendor_id, :insertdt, :insertby, :gst, :bankName, :bankIfsc, :bankAccountNo, :bankTransactionType, :bankBranch, :vendorCurrency)
    `;

    // Insert into both DBs
    await Promise.all([
      invtDB.query(insertSQL, {
        replacements: branchPayload,
        transaction: t1,
        type: invtDB.QueryTypes.INSERT,
      }),
      invtOakterDB.query(insertSQL, {
        replacements: branchPayload,
        transaction: t2,
        type: invtOakterDB.QueryTypes.INSERT,
      }),
    ]);

    await Promise.all([t1.commit(), t2.commit()]);

    return res.json({
      message: "Vendor's branch added successfully in both DBs.",
      status: "success",
      success: true,
    });
  } catch (err) {
    await Promise.all([t1.rollback(), t2.rollback()]);
    return helper.errorResponse(res, err);
  }
});

// GET ALL VENDORS
router.get("/getAll", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query("SELECT * FROM `ven_basic_detail`", {
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt1.length > 0) {
      let data = [];
      stmt1.map(async (element) => {
        data.push({
          vendor_code: element.ven_register_id,
          vendor_name: element.ven_name,
          vendor_pan: element.ven_pan_no ?? "N/A",
          vendor_gst: element.ven_gst_no ?? "N/A",
          vendor_status: element.status,
          msme: {
            regID: element.ven_msme_id ?? "N/A",
            status: element.ven_msme_status == "Y" ? "MSME" : "Non-MSME",
            year: element.ven_msme_year ?? "N/A",
            type: element.ven_msme_type ?? "N/A",
            activity: element.ven_msme_activity ?? "N/A",
          },
          meta: {
            lastUpdateDt: element.update_full_date ?? "--",
          },
        });

        if (data.length == stmt1.length) {
          return res.json({ data: data, status: "success", success: true });
        }
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET ALL TDS
router.get("/getAllTds", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await tallyDB.query(
      "SELECT `tds_key`,`tds_name` FROM `tally_tds`",
      { type: tallyDB.QueryTypes.SELECT }
    );
    if (stmt1.length > 0) {
      var data = [];
      stmt1.map(async (element) => {
        data.push({
          tds_key: element.tds_key,
          tds_name: element.tds_name,
        });

        if (data.length == stmt1.length) {
          return res.json({ data: data, status: "success", success: true });
        }
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET ALL LOCATION
router.get("/getAllLocation", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query(
      "SELECT `location_key`,`loc_name` FROM `location_main` WHERE `loc_for` = 'JW'  AND loc_status = 'ACTIVE' ",
      { type: invtDB.QueryTypes.SELECT }
    );
    if (stmt1.length > 0) {
      var data = [];
      stmt1.map(async (element) => {
        data.push({
          location_key: element.location_key,
          loc_name: element.loc_name,
        });

        if (data.length == stmt1.length) {
          return res.json({ data: data, status: "success", success: true });
        }
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET ACCOUNT AND SUB ACCOUNT
router.get("/getAccountSubAccount", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await tallyDB.query(
      "SELECT `group_name`,`group_key` FROM `tally_group`",
      { type: tallyDB.QueryTypes.SELECT }
    );
    if (stmt1.length > 0) {
      var data = [];
      stmt1.map(async (element) => {
        data.push({
          tds_key: element.group_key,
          group_name: element.group_name,
        });

        if (data.length == stmt1.length) {
          return res.json({ data: data, status: "success", success: true });
        }
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//  VENDOR FOR UPDATE
// router.post("/getVendor", [auth.isAuthorized], async (req, res) => {
//   try {
//     let stmt1 = await invtDB.query(
//       "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor",
//       {
//         replacements: { vendor: req.body.vendor_id },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );
//     if (stmt1.length > 0) {
//       let data = [];
//       stmt1.map(async (element) => {
//         let tds, location;
//         if (element.ven_tds !== null) {
//           tds = element.ven_tds.split(",");
//         }

//         if (element.ven_location !== null) {
//           location = element.ven_location.split(",");
//         }

//         let msme_data = [];

//         stmt1.forEach((element) => {
//           const ven_msme_year = element.ven_msme_year
//             ? element.ven_msme_year.split(",")
//             : [];
//           const ven_msme_type = element.ven_msme_type
//             ? element.ven_msme_type.split(",")
//             : [];
//           const ven_msme_activity = element.ven_msme_activity
//             ? element.ven_msme_activity.split(",")
//             : [];

//           for (let i = 0; i < ven_msme_year.length; i++) {
//             msme_data.push({
//               year: ven_msme_year[i],
//               type: ven_msme_type[i],
//               activity: ven_msme_activity[i],
//             });
//           }
//         });

//         data.push({
//           vendor_code: element.ven_register_id,
//           vendor_name: element.ven_name,
//           vendor_pan: element.ven_pan_no ?? "N/A",
//           vendor_cin: element.ven_cin_no ?? "N/A",
//           vendor_term_days: element.ven_terms_day,
//           vendor_status: element.status,
//           vendor_tds: tds,
//           vendor_loc: location,
//           vendor_msme_status: element.ven_msme_status,
//           vendor_msme_id: element.ven_msme_id,
//           msme_data: msme_data,
//         });

//         if (data.length == stmt1.length) {
//           return res.json({ data: data, status: "success", success: true });
//         }
//       });
//     } else {
//       return res.json({
//         message: "vendor does not exists in our records..",
//         status: "error",
//         success: false,
//       });
//     }
//   } catch (err) {
//     return helper.errorResponse(res, err);
//   }
// });

router.post("/getVendor", [auth.isAuthorized], async (req, res) => {
  try {
    const [vendor] = await invtDB.query(
      `SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor`,
      {
        replacements: { vendor: req.body.vendor_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // console.log(vendor, "rrrrvvv")

    if (!vendor) {
      return res.json({
        code: 500,
        success: false,
        status: "error",
        message: "vendor does not exists in our records..",
      });
    }

    const splitOrNull = (val) => (val ? val.split(",") : null);

    const tds = splitOrNull(vendor.ven_tds);
    const location = splitOrNull(vendor.ven_location);

    const ven_msme_year = splitOrNull(vendor.ven_msme_year) || [];
    const ven_msme_type = splitOrNull(vendor.ven_msme_type) || [];
    const ven_msme_activity = splitOrNull(vendor.ven_msme_activity) || [];

    const msme_data = ven_msme_year.map((year, i) => ({
      year,
      type: ven_msme_type[i] ?? null,
      activity: ven_msme_activity[i] ?? null,
    }));

    const eInvoiceEnabled = vendor.ven_einvoice_status === "Y";

    const data = [{
      vendor_code: vendor.ven_register_id,
      vendor_name: vendor.ven_name,
      vendor_pan: vendor.ven_pan_no ?? "N/A",
      vendor_cin: vendor.ven_cin_no ?? "N/A",
      vendor_term_days: vendor.ven_terms_day,
      vendor_status: vendor.status,
      vendor_tds: tds,
      vendor_loc: location,
      vendor_msme_status: vendor.ven_msme_status,
      vendor_msme_id: vendor.ven_msme_id,
      msme_data: msme_data,
      eInvoice: {
        status: eInvoiceEnabled ? "Y" : "N",
        date: eInvoiceEnabled ? moment(vendor.ven_einvoice_date).format("DD-MM-YYYY") : "--",
      },
      // dateOfApplicability: vendor.ven_einvoice_date,
      // group: vendor.group_name,
      // transaction_type: vendor.ven_bank_tt,
      // account_no: vendor.ven_bank_ac,
      // ifs_code: vendor.ven_bank_ifsc,
      // bank_name: vendor.ven_bank_name,
      // bank_branch: vendor.ven_bank_branch,
      // ledger_currency: vendor.ven_transaction_cur,
      msme_effective_from: vendor.msme_effective_from
    }];

    return res.json({
      success: true,
      status: "success",
      code: 200,
      data: data,
    });

  } catch (err) {
    console.log(err);
    return res.json({
      success: false,
      code: 500,
      status: "error",
      message: "Internal Error<br/>If this condition persists, contact your system administrator",
      error: err.stack,
    });
  }
});
// UPDATE VENDOR DETAILS
router.post(
  "/updateVendor",
  [auth.isAuthorized, upload.single("uploadfile")],
  async (req, res) => {

    const vendor = JSON.parse(req.body.vendor);
    console.log("vendor ---", vendor);

    const t1 = await invtDB.transaction();
    const t2 = await invtOakterDB.transaction();

    try {

      const filename = req?.file?.filename ?? null;

      const existingVendorDB = await invtDB.query(
        "SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor",
        {
          replacements: { vendor: vendor.vendorcode },
          type: invtDB.QueryTypes.SELECT,
          transaction: t1,
        }
      );

      const existingVendorOakter = await invtOakterDB.query(
        "SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor",
        {
          replacements: { vendor: vendor.vendorcode },
          type: invtOakterDB.QueryTypes.SELECT,
          transaction: t2,
        }
      );

      if (!existingVendorDB.length || !existingVendorOakter.length) {
        await Promise.all([t1.rollback(), t2.rollback()]);
        return res.json({
          message: "Vendor does not exist in one or both DBs.",
          status: "error",
          success: false,
        });
      }

      const updatePayload = {
        name: vendor.vendorname,
        pan: vendor.panno,
        cin: vendor.cinno || "--",

        term_day: vendor.term_days || 30,

        todaydate: moment().format("YYYY-MM-DD HH:mm:ss"),
        user: req.logedINUser,

        tds: Array.isArray(vendor.tally_tds)
          ? vendor.tally_tds.join(",")
          : vendor.tally_tds || "--",

        // location: Array.isArray(vendor.vendor_loc)
        //   ? vendor.vendor_loc.join(",")
        //   : vendor.vendor_loc || "--",

        vendor_file: filename ?? existingVendorDB[0].vendor_file,

        msme_status: vendor.msme_status,

        msme_year: Array.isArray(vendor.msme_year)
          ? vendor.msme_year.join(",")
          : vendor.msme_year || "--",

        msme_id: vendor.msme_id || "--",

        msme_type: Array.isArray(vendor.msme_type)
          ? vendor.msme_type.join(",")
          : vendor.msme_type || "--",

        msme_activity: Array.isArray(vendor.msme_activity)
          ? vendor.msme_activity.join(",")
          : vendor.msme_activity || "--",

        ven_einvoice_status: vendor.eInvoice,

        ven_einvoice_date:
          vendor.eInvoice === "Y"
            ? moment(vendor.dateOfApplicability, "DD-MM-YYYY").format("YYYY-MM-DD")
            : "--",

        // ven_bank_name:
        //   vendor.bank_name ?? existingVendorDB[0].ven_bank_name,

        // ven_bank_ifsc:
        //   vendor.ifs_code ?? existingVendorDB[0].ven_bank_ifsc,

        // ven_bank_ac:
        //   vendor.account_no ?? existingVendorDB[0].ven_bank_ac,

        // ven_bank_tt:
        //   vendor.transaction_type ?? existingVendorDB[0].ven_bank_tt,

        // bank_branch:
        //   vendor.bank_branch ?? existingVendorDB[0].ven_bank_branch,

        // ven_transaction_cur:
        //   vendor.ledger_currency ?? existingVendorDB[0].ven_transaction_cur,

        msme_effective_from: vendor.msme_effective_from
          ? moment(vendor.msme_effective_from, "DD-MM-YYYY").format("YYYY-MM-DD")
          : existingVendorDB[0].msme_effective_from,

        vendor_reg_id: vendor.vendorcode
      };

      console.log(updatePayload, "---update payload")

      const updateSQL = `
      UPDATE ven_basic_detail
      SET ven_name = :name,
          ven_pan_no = :pan,
          ven_cin_no = :cin,
          ven_terms_day = :term_day,
          update_full_date = :todaydate,
          update_by = :user,
          ven_tds = :tds,
          vendor_file = :vendor_file,
          ven_msme_status = :msme_status,
          ven_msme_year = :msme_year,
          ven_msme_id = :msme_id,
          ven_msme_type = :msme_type,
          ven_msme_activity = :msme_activity,
          ven_einvoice_status = :ven_einvoice_status,
          ven_einvoice_date = :ven_einvoice_date,
          msme_effective_from = :msme_effective_from
      WHERE ven_register_id = :vendor_reg_id
      `;

      console.log(updateSQL, "---update sql")
      await Promise.all([
        invtDB.query(updateSQL, {
          replacements: updatePayload,
          transaction: t1,
          type: invtDB.QueryTypes.UPDATE,
        }),
        invtOakterDB.query(updateSQL, {
          replacements: updatePayload,
          transaction: t2,
          type: invtOakterDB.QueryTypes.UPDATE,
        }),
      ]);

      await Promise.all([t1.commit(), t2.commit()]);

      return res.json({
        message: "Vendor updated successfully in both DBs.",
        status: "success",
        success: true,
        code: 200
      });

    } catch (err) {
      console.log(err)
      await Promise.all([t1.rollback(), t2.rollback()]);
      return helper.errorResponse(res, err);

    }
  }
);

router.put("/updateVendorLocation", [auth.isAuthorized], async (req, res) => {

  const t1 = await invtDB.transaction();

  try {

    const { vendorcode, vendor_loc } = req.body;

    if (!vendorcode || !vendor_loc) {
      return res.json({
        code: 400,
        success: false,
        status: "error",
        message: "Vendor code and vendor location are required",
      });
    }


    const existingVendorDB = await invtDB.query(
      "SELECT ven_register_id FROM ven_basic_detail WHERE ven_register_id = :vendor",
      {
        replacements: { vendor: vendorcode },
        type: invtDB.QueryTypes.SELECT,
        transaction: t1,
      }
    );


    if (!existingVendorDB.length) {
      await t1.rollback();
      return res.json({
        code: 400,
        success: false,
        status: "error",
        message: "Vendor does not exist",
      });
    }

    const payload = {
      location: vendor_loc,
      todaydate: moment().format("YYYY-MM-DD HH:mm:ss"),
      user: req.logedINUser,
      vendor: vendorcode,
    };

    const updateSQL = `UPDATE ven_basic_detail SET ven_location = :location, update_full_date = :todaydate, update_by = :user WHERE ven_register_id = :vendor`;

    await invtDB.query(updateSQL, {
      replacements: payload,
      transaction: t1,
      type: invtDB.QueryTypes.UPDATE,
    });

    await t1.commit();

    return res.json({
      success: true,
      code: 200,
      status: "success",
      message: "Vendor location updated successfully",
    });

  } catch (err) {
    await t1.rollback();
    return helper.errorResponse(res, err);
  }
});

// GET ALL BRANCH LIST AGAINST VENDOR CODE
router.post("/getAllBranchList", [auth.isAuthorized], async (req, res) => {
  try {
    if (req.body.vendor_id) {
      let stmt = await invtDB.query(
        "SELECT * FROM `ven_address_detail` WHERE (`ven_id` = :name) ORDER BY `ven_add_label` ASC",
        {
          replacements: { name: req.body.vendor_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let final = [];

      stmt.map((item) => {
        final.push({ id: item.ven_address_id, text: item.ven_add_label });

        if (stmt.length == final.length) {
          res.json({ data: final, status: "success", success: true });
          return;
        }
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH DETAILS OF BRANCH AGAINST BRANCH ADDRESS ID
router.post("/getBranchDetails", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT * FROM `ven_address_detail` LEFT JOIN `state_code` ON `state_code`.`state_code` = `ven_address_detail`.`ven_state` WHERE (`ven_address_id` = :address_code)",
      {
        replacements: { address_code: req.body.addresscode },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      let final = [];
      stmt.map((data) => {
        final.push({
          address_code: data.ven_address_id,
          label: data.ven_add_label,
          city: data.ven_city,
          statecode: data.state_code,
          statename: data.state_name,
          address: data.ven_address,
          pincode: data.ven_pincode,
          fax: data.ven_fax,
          email_id: data.ven_fax,
          mobile_no: data.ven_mobile,
          vendor_code: data.ven_id,
          gstin: data.ven_add_gst,
          transaction_type: data.ven_bank_tt || "--",
          account_no: data.ven_bank_ac || "--",
          ifs_code: data.ven_bank_ifsc || "--",
          bank_name: data.ven_bank_name || "--",
          bank_branch: data.ven_bank_branch || "--",
          ledger_currency: data.ven_transaction_cur || "--",
        });

        if (stmt.length == final.length) {
          res.json({ data: final, status: "success", success: true });
          return;
        }
      });
    } else {
      return res.json({
        message: "an error occured while fetching the details",
        status: "error",
        success: false,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPDATE VENDOR BRANCh
router.post("/updateBranchDetails", [auth.isAuthorized], async (req, res) => {
  // const validation = new Validator(req.body, {
  //   label: "required",
  //   state: "required",
  //   city: "required",
  //   address: "required",
  //   pincode: "required",
  //   mobile: "required",
  //   gstid: "required",
  //   address_code: "required",
  //   vendor_code: "required",
  //   email: "required",
  // });

  // if (validation.fails()) {
  //   return res.json({
  //     message: "Something is missing in the form fields",
  //     data: validation.errors.all(),
  //     status: "error",
  //     success: false,
  //   });
  // }

  const t1 = await invtDB.transaction();
  const t2 = await invtOakterDB.transaction(); // Dual DB transaction

  try {
    // Check if branch exists
    const branchDetails = await invtDB.query(
      "SELECT * FROM `ven_address_detail` WHERE `ven_address_id` = :address_id",
      {
        replacements: { address_id: req.body.address_code },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!branchDetails.length) {
      if (!t1.finished) await t1.rollback();
      if (!t2.finished) await t2.rollback();
      return res.json({
        message: "Branch not found",
        status: "error",
        success: false,
      });
    }

    // Prepare replacement data
    const branchData = {
      label: req.body.label,
      state: req.body.state,
      city: req.body.city,
      address: req.body.address.replace(/\n/g, "<br>"),
      pincode: req.body.pincode,
      fax: req.body.fax ?? "--",
      email: req.body.email,
      mobile: req.body.mobile,
      gstid: req.body.gstid,
      updatedt: moment().format("YYYY-MM-DD HH:mm:ss"),
      updateby: req.logedINUser,
      address_code: req.body.address_code,
      bankName: req.body.bank_name || "--",
      bankIfsc: req.body.ifs_code || "--",
      bankBranch: req.body.bank_branch || "--",
      bankAccountNo: req.body.account_no || "--",
      bankTransactionType: req.body.transaction_type || "--",
      vendorCurrency: req.body.ledger_currency || "--",
    };

    const updateSQL = `
      UPDATE ven_address_detail SET 
        ven_add_label = :label,
        ven_state = :state,
        ven_city = :city,
        ven_address = :address,
        ven_pincode = :pincode,
        ven_fax = :fax,
        ven_email = :email,
        ven_mobile = :mobile,
        ven_add_gst = :gstid,
        ven_update_dt = :updatedt,
        ven_update_by = :updateby,
        ven_bank_name = :bankName,
        ven_bank_ifsc = :bankIfsc,
        ven_bank_branch = :bankBranch,
        ven_bank_ac = :bankAccountNo,
        ven_bank_tt = :bankTransactionType,
        ven_transaction_cur = :vendorCurrency
      WHERE ven_address_id = :address_code
    `;

    // Update in both DBs simultaneously
    const [stmt1, stmt2] = await Promise.all([
      invtDB.query(updateSQL, {
        replacements: branchData,
        type: invtDB.QueryTypes.UPDATE,
        transaction: t1,
      }),
      invtOakterDB.query(updateSQL, {
        replacements: branchData,
        type: invtOakterDB.QueryTypes.UPDATE,
        transaction: t2,
      }),
    ]);

    // Check affected rows
    const affectedRows1 = stmt1[0]?.affectedRows ?? stmt1[0] ?? 0;
    const affectedRows2 = stmt2[0]?.affectedRows ?? stmt2[0] ?? 0;

    if (affectedRows1 === 0 && affectedRows2 === 0) {
      if (!t1.finished) await t1.rollback();
      if (!t2.finished) await t2.rollback();
      return res.json({
        message: "Branch not found or no changes made",
        status: "error",
        success: false,
      });
    }

    await Promise.all([t1.commit(), t2.commit()]);

    return res.json({
      message: "Vendor branch updated successfully",
      status: "success",
      success: true,
    });
  } catch (err) {
    if (!t1.finished) await t1.rollback();
    if (!t2.finished) await t2.rollback();

    console.error("Error in /updateBranchDetails:", err);
    return helper.errorResponse(res, err);
  }
});

// UPDATE VENDOR STATUS
router.post("/updateVendorStatus", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    status: "required",
    vendor_code: "required",
  });

  if (validation.fails()) {
    return res.json({
      message: "Something is missing in form fields",
      data: validation.errors.all(),
      status: "error",
      success: false,
    });
  }

  const { status, vendor_code } = req.body;

  if (status !== "A" && status !== "B") {
    return res.json({
      status: "error",
      success: false,
      message: "Invalid status value received from client",
    });
  }

  const t1 = await invtDB.transaction();
  const t2 = await invtOakterDB.transaction();

  try {
    const [vendorDB, vendorOakter] = await Promise.all([
      invtDB.query(
        "SELECT ven_register_id FROM ven_basic_detail WHERE ven_register_id = :vendor_code",
        {
          replacements: { vendor_code },
          type: invtDB.QueryTypes.SELECT,
          transaction: t1,
        }
      ),
      invtOakterDB.query(
        "SELECT ven_register_id FROM ven_basic_detail WHERE ven_register_id = :vendor_code",
        {
          replacements: { vendor_code },
          type: invtOakterDB.QueryTypes.SELECT,
          transaction: t2,
        }
      ),
    ]);

    if (vendorDB.length === 0 || vendorOakter.length === 0) {
      await Promise.all([t1.rollback(), t2.rollback()]);
      return res.json({
        status: "error",
        success: false,
        message: "Vendor not found in one or both databases",
      });
    }

    const updatePayload = {
      status,
      vendor_code,
      update_by: req.logedINUser,
      update_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
    };

    await Promise.all([
      invtDB.query(
        "UPDATE ven_basic_detail SET status = :status, update_by = :update_by, update_full_date = :update_date WHERE ven_register_id = :vendor_code",
        {
          replacements: updatePayload,
          transaction: t1,
          type: invtDB.QueryTypes.UPDATE,
        }
      ),
      invtOakterDB.query(
        "UPDATE ven_basic_detail SET status = :status, update_by = :update_by, update_full_date = :update_date WHERE ven_register_id = :vendor_code",
        {
          replacements: updatePayload,
          transaction: t2,
          type: invtOakterDB.QueryTypes.UPDATE,
        }
      ),
    ]);

    await Promise.all([t1.commit(), t2.commit()]);

    return res.json({
      status: "success",
      success: true,
      message:
        status === "A" ? "Vendor marked as ACTIVE" : "Vendor marked as BLOCKED",
    });
  } catch (err) {
    await Promise.all([t1.rollback(), t2.rollback()]);
    return helper.errorResponse(res, err);
  }
});

router.post("/addLogin", [auth.isAuthorized], async (req, res) => {
  if (req.body.vendor == null || req.body.vendor == "") {
    return res.json({
      status: "error",
      success: false,
      message: "vendor name is required..",
    });
  }
  if (req.body.mobile == "") {
    return res.json({
      status: "error",
      success: false,
      message: "vendor mobile number is required..",
    });
  }
  if (
    req.body.mobile.toString().length < 10 ||
    req.body.mobile.toString().length > 10
  ) {
    return res.json({
      status: "error",
      success: false,
      message:
        "vendor mobile number would be in 10 digit without leading with 0 or country code (91) or any speacial characters",
    });
  }
  if (!/^[6-9][0-9]{9}$/.test(req.body.mobile)) {
    return res.json({
      status: "error",
      success: false,
      message: "vendor mobile number is not valid or fit on the pattern..",
    });
  }
  if (req.body.email == "") {
    return res.json({
      status: "error",
      success: false,
      message: "vendor e-mail address is required..",
    });
  }
  if (
    !/^([a-zA-Z0-9_\.\-])+\@(([a-zA-Z0-9\-])+\.)+([a-zA-Z0-9]{2,4})+$/.test(
      req.body.email
    )
  ) {
    return res.json({
      status: "error",
      success: false,
      message: "vendor e-mail address is not valid or fit on the pattern..",
    });
  }
  if (req.body.password == "") {
    return res.json({
      status: "error",
      success: false,
      message: "vendor temporary password is required..",
    });
  }
  if (
    !/^(?=.*\d)(?=.*[!@#$%^&*])(?=.*[a-z])(?=.*[A-Z]).{8,}$/.test(
      req.body.password
    )
  ) {
    return res.json({
      status: "error",
      success: false,
      message:
        "vendor temporary password is not valid or fit on the pattern (must 8 char min length with 1 UPPERCASE, 1 lowercase, 1 special char [!@#$%^&*])",
    });
  }

  const t = await invtDB.transaction();

  try {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor",
      {
        replacements: { vendor: req.body.vendor },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt1.length == 0) {
      t.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "vendor not exist for mapping..",
      });
    } else {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `ven_basic_detail` WHERE `ven_login_password` != '--' AND `ven_register_id` = :vendor",
        {
          replacements: { vendor: req.body.vendor },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt2.length > 0) {
        t.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "vendor already register for login..",
        });
      } else {
        let stmt3 = await invtDB.query(
          "SELECT * FROM `ven_basic_detail` WHERE `ven_login_mobile` = :mobile AND `ven_register_id` != :vendor",
          {
            replacements: { vendor: req.body.vendor, mobile: req.body.mobile },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt3.length > 0) {
          t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "vendor mobile for login already exist..",
          });
        } else {
          let stmt4 = await invtDB.query(
            "SELECT * FROM `ven_basic_detail` WHERE `ven_login_email` = :email AND `ven_register_id` != :vendor",
            {
              replacements: { vendor: req.body.vendor, email: req.body.email },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt4.length > 0) {
            t.rollback();
            return res.json({
              status: "error",
              success: false,
              message: "vendor email for login already exist..",
            });
          } else {
            let stmt5 = await invtDB.query(
              "UPDATE `ven_basic_detail` SET `ven_login_email` = :email, `ven_login_mobile` = :mobile, `ven_login_password` = :password1, `ven_temp_password` = :password2 WHERE `ven_register_id` = :vendor_reg_id",
              {
                replacements: {
                  email: req.body.email,
                  mobile: req.body.mobile,
                  password1: await bcrypt.hash(req.body.password, 10),
                  password2: req.body.password,
                  vendor_reg_id: req.body.vendor,
                },
                type: invtDB.QueryTypes.UPDATE,
                transaction: t,
              }
            );
            if (stmt5.length > 0) {
              t.commit();
              return res.json({
                message: "Vendor credentials mapped..",
                status: "success",
                success: true,
              });
            } else {
              t.rollback();
              return res.json({
                message: "an error while adding login credentials..",
                status: "error",
                success: false,
              });
            }
          }
        }
      }
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const xlsx = require("xlsx");

let { invtDB } = require("../../../../config/db/connection");

const auth = require("../../../../middleware/ven_auth");
const Validator = require("validatorjs");
const { encode, decode } = require("html-entities");

function byPart(a, b) {
  return a.partno.localeCompare(b.partno, "en", { numeric: true });
}

// Fetch Pending Request for Material Inward
router.post("/fetchPendingJWChallan", [auth.isAuthorized], async (req, res) => {
  const date = req.body.searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
  const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
  const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
  const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
  if (durationInMonths > 3) {
    return res.json({ status: "error", success: false, message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only" });
  }

  try {
    let stmt = await invtDB.query(
      "SELECT `jw_ven_challan`.`jw_jobwork_id`, `jw_ven_challan`.`jw_challan_id`, `jw_ven_challan`.`jw_insert_dt`, `admin_login`.`user_name` FROM `jw_ven_challan` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `jw_ven_challan`.`jw_insert_by` LEFT JOIN jw_material_challan ON jw_material_challan.jw_challan_txn_id = jw_ven_challan.jw_challan_id WHERE ( jw_ven_challan.`jw_trans_type` = 'P' AND DATE_FORMAT(jw_ven_challan.`jw_insert_dt`, '%Y-%m-%d') BETWEEN :date1 AND :date2 ) AND jw_ven_challan.jw_ven = :vendor AND jw_material_challan.challan_status = 'A' GROUP BY jw_ven_challan.`jw_trans_type`, jw_ven_challan.`jw_challan_ref`",
      {
        replacements: { date1: fromdate, date2: todate, vendor: req.logedINVendor },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      let finalResult = [], count = 0;
      stmt.forEach((element) => {
        finalResult.push({
          jobwork: element.jw_jobwork_id,
          challan: element.jw_challan_id,
          insert_by: element.user_name,
          insert_dt: moment(element.jw_insert_dt).tz("Asia/Kolkata").format("DD-MM-YYYY hh:mm A"),
        });
        count++;
        if (stmt.length == count) {
          res.json({ status: "success", success: true, message: "Data fetched successfully", data: finalResult });
          return;
        }
      });
    } else {
      res.json({ status: "error", success: false, message: "No request found" });
      return;
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

//Open all Component mapped with Request for Material Inward
router.post("/fetchPendingJWChallanRM", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT `components`.`c_part_no`, `components`.`component_key`, `components`.`c_name`, `jw_ven_challan`.`jw_jobwork_id`, `jw_ven_challan`.`jw_challan_id`, `jw_ven_challan`.`jw_qty`, `jw_ven_challan`.`jw_rate`, `units`.`units_name`, (SELECT 	jw_hsncode FROM jw_material_challan WHERE jw_component_id = `components`.`component_key` AND jw_jobwork_id = :jw AND 	jw_challan_id = :challan LIMIT 1) AS hsn FROM `jw_ven_challan` LEFT JOIN `components` ON `jw_ven_challan`.`jw_part` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_trans_type` = 'P' AND `jw_jobwork_id` = :jw AND `jw_challan_id` = :challan AND jw_ven_challan.jw_ven = :vendor",
      {
        replacements: { jw: req.body.jw, challan: req.body.challan, vendor: req.logedINVendor },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmt.length > 0) {
      let finalResult = [];
      for (let i = 0; i < stmt.length; i++) {
        let select_res = await invtDB.query(
          "SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) as `in_qty` FROM `jw_ven_location` WHERE `jw_ven_jw_ref` = :jobwork AND `jw_ven_rm` = :component AND `jw_ven_challan_ref` = :challan",
          {
            replacements: {
              component: stmt[i].component_key,
              jobwork: stmt[i].jw_jobwork_id,
              challan: stmt[i].jw_challan_id
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let in_qty = 0, jw_qty = 0;
        if (select_res.length > 0) {
          in_qty = helper.number(select_res[0].in_qty);
          jw_qty = helper.number(stmt[i].jw_qty);
        }

        finalResult.push({
          part_no: stmt[i].c_part_no,
          part_key: stmt[i].component_key,
          part_name: stmt[i].c_name,
          uom: stmt[i].units_name,
          hsn: stmt[i].hsn ?? '--',
          jw_qty: stmt[i].jw_qty,
          jw_leftqty: jw_qty - in_qty,
          jw_rate: stmt[i].jw_rate
        });
      }
      res.json({ status: "success", success: true, message: "Data fetched successfully", data: finalResult });
      return;

    } else {
      res.json({ status: "error", success: false, message: "No request found" });
      return;
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// Fetch Alloted Location for Jobwork Vendor MIN
router.get("/fetchAllotedLocation", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query("SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor", {
      replacements: { vendor: req.logedINVendor },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt1.length > 0) {
      let arr = stmt1[0].ven_location.split(",");
      let locs = [];
      let stmt2;

      for (let i = 0; i < arr.length; i++) {
        stmt2 = await invtDB.query("SELECT `location_key`, `loc_name`, loc_purpose FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ", {
          replacements: { location_defined: arr[i] },
          type: invtDB.QueryTypes.SELECT,
        });

        if (stmt2.length > 0) {
          locs.push(
            {
              id: stmt2[0].location_key,
              text: stmt2[0].loc_name,
              type: stmt2[0].loc_purpose
            }
          );
        }
      }

      if (locs.length > 0) {
        return res.json({ status: "success", success: true, message: "Data fetched successfully", data: locs });
      } else {
        return res.json({ status: "error", success: false, message: "No location found" });
      }

    } else {
      res.json({ status: "error", success: false, message: "No location found" });
      return;
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});
// MIN TRANSACTION
router.post("/minVendorRM", [auth.isAuthorized], async (req, res) => {

  const t = await invtDB.transaction();

  let itemLength = req.body.component.length;

  if (itemLength <= 0) {
    t.rollback();
    res.json({ status: "error", success: false, message: "Please add atleast one item" });
    return;
  }

  for (let i = 0; i < itemLength; i++) {
    let itemValidation = new Validator(
      {
        item: req.body.component[i]
      },
      {
        item: "required"
      }
    );
    if (itemValidation.fails()) {
      t.rollback();
      res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(itemValidation) });
      return;
    }
  }
  

  let in_txn_no = await helper.genTransaction("JW_MIN", t);
 
  try {
    let get_transaction_id = await invtDB.query("SELECT `jw_ven_txn` FROM `jw_ven_location` WHERE `jw_ven_txn` = :transaction_id GROUP BY `jw_ven_txn` LIMIT 1", {
      replacements: { transaction_id: in_txn_no },
      type: invtDB.QueryTypes.SELECT,
    });

    if (get_transaction_id.length > 0) {
      t.rollback();
      res.json({ status: "error", success: false, message: "alloting transaction id as " + get_transaction_id[0].in_txn_no + " for MIN has already exist with us, required manual checking or contact to system administrator" });
      return;
    } else {
      for (let i = 0; i < itemLength; i++) {
        if (helper.number(req.body.qty[i]) > 0) {
          let select_res = await invtDB.query(
            "SELECT `jw_ven_challan`.`jw_qty` as `challan_qty`, jw_ven_challan.jw_ven AS jw_vendor, COALESCE(SUM(`jw_ven_location`.`jw_ven_in_qty`), 0) as `in_qty` FROM `jw_ven_challan` LEFT JOIN `jw_ven_location` ON `jw_ven_challan`.`jw_part` = `jw_ven_location`.`jw_ven_rm` AND `jw_ven_challan`.`jw_challan_id` = `jw_ven_location`.`jw_ven_challan_ref` AND `jw_ven_challan`.`jw_jobwork_id` = `jw_ven_location`.`jw_ven_jw_ref` WHERE `jw_ven_challan`.`jw_jobwork_id` = :jobwork AND `jw_ven_challan`.`jw_part` = :component AND `jw_ven_challan`.`jw_challan_id` = :challan AND jw_ven_challan.jw_ven = :vendor",
            {
              replacements: {
                component: req.body.component[i],
                jobwork: req.body.jw_ref,
                challan: req.body.challan_ref,
                vendor: req.logedINVendor
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (select_res.length < 0) {
            t.rollback();
            res.json({ status: "error", success: false, message: "no such pending challan found for transaction" });
            return;
          }

          if (select_res[0].challan_qty < helper.number(select_res[0].in_qty) + helper.number(req.body.qty[i])) {
            t.rollback();
            res.json({ status: "error", success: false, message: ` ${i + 1} challan made for qty ${select_res[0].challan_qty} and you have already done ${select_res[0].in_qty} quantity.!!! MIN quantity is exceed...` });
            return;
          }
          let insert_res = await invtDB.query(
            "INSERT INTO `jw_ven_location` (`jw_ven_code`,`jw_ven_rm`,`jw_ven_in_qty`,`jw_ven_loc_in`,`jw_ven_challan_ref`,`jw_ven_jw_ref`,`jw_ven_insert_dt`,`jw_ven_insert_by`,`jw_ven_txn`,`jw_ven_remark`,`jw_ven_txn_type`,`jw_ven_part_hsn`)VALUES (:vendor,:part,:inqty,:locin,:challan_ref,:jowbork_ref,:indt,:inby,:transaction,:remark,'RM-INWARD',:hsncode)",
            {
              replacements: {
                vendor: select_res[0].jw_vendor,
                part: req.body.component[i],
                inqty: req.body.qty[i],
                locin: req.body.location[i],
                challan_ref: req.body.challan_ref,
                jowbork_ref: req.body.jw_ref,
                indt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                inby: req.logedINUser,
                transaction: in_txn_no,
                remark: req.body.remark[i] == "" ? "--" : req.body.remark[i],
                hsncode: req.body.hsncode[i]
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: t,
            }
          );

          if (helper.number(select_res[0].in_qty) + helper.number(req.body.qty[i]) == select_res[0].challan_qty) {
            let updateStatus = await invtDB.query("UPDATE `jw_ven_challan` SET `jw_trans_type` = 'IN' WHERE `jw_jobwork_id` = :jobwork AND `jw_challan_id` = :challan AND `jw_part` = :component AND jw_ven_challan.jw_ven = :vendor", {
              replacements: {
                jobwork: req.body.jw_ref,
                challan: req.body.challan_ref,
                component: req.body.component[i],
                vendor: select_res[0].jw_vendor
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: t,
            });
          }
        }
      }

      await t.commit();
      res.json({ status: "success", success: true, message: "MIN has been created with TXN ID : " + in_txn_no, data: { txn: in_txn_no } });
      return;
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPLOAD INVOICE
var storage = multer.diskStorage({
  destination: "uploads/minInvoices",
  filename: function (req, file, cb) {
    cb(null, "INV" + helper.getUniqueNumber() + helper.randomNumber(100, 999) + path.extname(file.originalname));
  },
});

var upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 5 }, // 5 MB
});

router.post("/upload-invoice", [auth.isAuthorized, upload.array("files")], async (req, res) => {
  let filesLenth = req.files.length;

  if (filesLenth <= 0) {
    res.json({ status: "error", success: false, message: "Somthing went wrong" });
    return;
  }

  let files = [];
  if (filesLenth > 0) {
    for (let i = 0; i < filesLenth; i++) {
      files.push(req.files[i].filename);
    }
  }
  // array to string
  files = files.toString();
  res.json({ status: "success", success: true, message: "Files uploaded successfully", data: files });
  return;
});

// RM CONSUMPTION
router.post("/rmConsp", [auth.isAuthorized], async (req, res) => {

    const valid = new Validator(req.body, {
        challan_no: "required",
        challan_date: "required",
        type: "required|in:consumption,rejection,shortage",
    });

    if (valid.fails()) {
        return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    let itemLength = req.body.component.length;

    if (itemLength <= 0) {
        res.json({ status: "error", success: false, message: "Please add atleast one item" });
        return;
    }

    for (let i = 0; i < itemLength; i++) {
        let itemValidation = new Validator(
            {
                item: req.body.component[i],
                qty: req.body.qty[i],
                location: req.body.pick_location[i],
            },
            {
                item: "required",
                qty: "required|min:1",
                location: "required",
            }
        );
        if (itemValidation.fails()) {
            res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(itemValidation) });
            return;
        }
    }
    let stmt1 = await invtDB.query("SELECT `ID` FROM `jw_ven_location` ORDER BY `ID` DESC LIMIT 1", {
        type: invtDB.QueryTypes.SELECT,
    });
    let date = new Date().getDate().toString() + (new Date().getMonth() + 1 > 9 ? new Date().getMonth() + 1 : "0" + (new Date().getMonth() + 1)) + new Date().getFullYear().toString().slice(-2);
    if (stmt1.length > 0) {
        transactionKey = date + (parseInt(stmt1[0].ID) + 1).toString();
    } else {
        transactionKey = date + "1";
    }

    const t = await invtDB.transaction();
    try {
        let get_transaction_id = await invtDB.query("SELECT `jw_ven_txn` FROM `jw_ven_location` WHERE `jw_ven_txn` = :transaction_id GROUP BY `jw_ven_txn` LIMIT 1", {
            replacements: { transaction_id: transactionKey },
            type: invtDB.QueryTypes.SELECT
        });

        if (get_transaction_id.length > 0) {
            res.json({ status: "error", success: false, message: "alloting transaction id as " + transactionKey + " for material consumption has already exist with us, required manual checking or contact to system administrator" });
            return;
        } else {
            for (let i = 0; i < itemLength; i++) {
                if (helper.number(req.body.qty[i]) > 0) {
                    // GET PART CODE
                    let getPartInfo = await invtDB.query("SELECT `c_part_no` FROM `components` WHERE `component_key` = :component", {
                        replacements: { component: req.body.component[i] },
                        type: invtDB.QueryTypes.SELECT
                    });
                    if (getPartInfo.length == 0) {
                        res.json({ status: "error", success: false, message: "part code you have supplied was incorrect" });
                        return;
                    }
                    // ALL INWARD
                    let stmtInward = await invtDB.query("SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Inward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-INWARD') AND `jw_ven_code` = :vendor AND `jw_ven_loc_in` = :location", {
                        replacements: { component: req.body.component[i], location: req.body.pick_location[i], vendor: req.logedINVendor },
                        type: invtDB.QueryTypes.SELECT,
                    });

                    let inward_all_qty;
                    if (stmtInward.length > 0) {
                        inward_all_qty = helper.number(stmtInward[0].Inward);
                    } else {
                        inward_all_qty = 0;
                    }

                    // ALL OUTWARD
                    let stmtOutward = await invtDB.query("SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Outward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-CONSUMPTION') AND `jw_ven_code` = :vendor AND `jw_ven_loc_out` = :location", {
                        replacements: { component: req.body.component[i], location: req.body.pick_location[i], vendor: req.logedINVendor },
                        type: invtDB.QueryTypes.SELECT,
                    });

                    let outward_all_qty;
                    if (stmtInward.length > 0) {
                        outward_all_qty = helper.number(stmtOutward[0].Outward);
                    } else {
                        outward_all_qty = 0;
                    }

                    if (helper.number(inward_all_qty - outward_all_qty) < req.body.qty[i]) {
                        return res.json({ status: "error", success: false, message: "unable to accept request because of the quantity not available in yet stocks for the partcode [" + getPartInfo[0].c_part_no + "], the current qty are [" + (inward_all_qty - outward_all_qty) + "] at your pick location." });
                    } else {
                        let insert_res = await invtDB.query(
                            "INSERT INTO `jw_ven_location` (`jw_ven_code`,`jw_ven_rm`,`jw_ven_in_qty`,`jw_ven_loc_out`,`jw_ven_challan_ref`,`jw_ven_insert_dt`,`jw_ven_insert_by`,`jw_ven_txn`,`jw_ven_remark`,`jw_ven_txn_type`, jw_ven_date , jw_ven_attach , type , consumed_product , consumed_product_qty)VALUES (:vendor,:part,:qty,:locout,:challan_ref,:indt,:inby,:transaction,:remark,'RM-CONSUMPTION', :jw_date , :jw_attach , :type , :consumed_product , :consumed_product_qty)",
                            {
                                replacements: {
                                    vendor: req.logedINVendor,
                                    part: req.body.component[i],
                                    qty: req.body.qty[i],
                                    locout: req.body.pick_location[i],
                                    challan_ref: req.body.challan_no,
                                    indt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                                    inby: req.logedINUser,
                                    transaction: transactionKey,
                                    remark: req.body.remark[i] == "" ? "--" : req.body.remark[i],
                                    jw_date: moment(req.body.challan_date, "DD-MM-YYYY").format("YYYY-MM-DD"),
                                    jw_attach: req.body.jobwork_attach ?? "--",
                                    type: req.body.type,
                                    consumed_product: req.body.product ?? "--",
                                    consumed_product_qty: req.body.consumed_product_qty ?? "--"
                                },
                                type: invtDB.QueryTypes.INSERT,
                                transaction: t,
                            }
                        );
                    }
                }
            }

            // 
            let valid_file = new Validator(req.body, {
                jobwork_attach: "required",
            });

            if (valid_file.passes()) {
                const files = req.body.jobwork_attach.split(",");
                const filesLenth = files.length;
                const formData = new FormData();
                for (let i = 0; i < filesLenth; i++) {
                    const fileStream = fs.createReadStream("./uploads/minInvoices/" + files[i]);
                    formData.append("files[]", fileStream);
                }
                const response = await axios.post("https://media.mscorpres.co.in/oakterIms/uploades/vendorRmConsumption.php", formData, {
                    headers: {
                        "Content-Type": "multipart/form-data",
                    },
                });
                if (response.data.code == 500) {
                    //throw new Error(response.data.message);
                    return res.json({ status: "error", success: false, message: response?.data?.message });
                }
            }
            //


            await t.commit();
            res.json({ status: "success", success: true, message: "MIN has been consumpted with TXN ID : " + transactionKey, data: { txn: transactionKey } });
            return;
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

var storage1 = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "files/excel/");
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    },
});
var upload1 = multer({ storage: storage1 });

router.post("/getDocumentData", upload1.single("jobwork_attach"), async (req, res) => {
    try {
        const validation = new Validator(req, {
            file: "required"
        });

        if (validation.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
        }

        let workbook = xlsx.readFile("./files/excel/" + req.file.filename);

        let data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        let result = [];

        for (let i = 0; i < data.length; i++) {

            const fetchComponent = await invtDB.query("SELECT * FROM `components` WHERE `c_part_no` = :key ", {
                replacements: { key: data[i].partCode },
                type: invtDB.QueryTypes.SELECT,
            });

            if (fetchComponent.length <= 0) {
                return res.json({ status: "error", success: false, message: "component with part code " + data[i].partCode + " not found" });
            }

            result.push({
                component: {
                    text: `${fetchComponent[0].c_part_no} - ${fetchComponent[0].c_name}`,
                    value: fetchComponent[0].component_key
                },
                quantity: data[i].qty,
                remarks: data[i].remark ?? "--"
            })

        }

        return res.json({ status: "success", success: true, message: "Data fetched successfully", data: result });
    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

// MFG TRANSACTION
router.post("/sfgCreate", [auth.isAuthorized], async (req, res) => {
  let itemLength = req.body.component.length;

  if (itemLength <= 0) {
    res.json({ status: "error", success: false, message: "Please add atleast one item" });
    return;
  }

  for (let i = 0; i < itemLength; i++) {
    let itemValidation = new Validator(
      {
        item: req.body.component[i],
        qty: req.body.qty[i],
        location: req.body.put_location[i],
      },
      {
        item: "required",
        qty: "required|min:1",
        location: "required",
      }
    );
    if (itemValidation.fails()) {
      res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(itemValidation) });
      return;
    }
  }
  let stmt1 = await invtDB.query("SELECT `ID` FROM `jw_ven_location` ORDER BY `ID` DESC LIMIT 1", {
    type: invtDB.QueryTypes.SELECT,
  });
  let date = new Date().getDate().toString() + (new Date().getMonth() + 1 > 9 ? new Date().getMonth() + 1 : "0" + (new Date().getMonth() + 1)) + new Date().getFullYear().toString().slice(-2);
  if (stmt1.length > 0) {
    transactionKey = date + (parseInt(stmt1[0].ID) + 1).toString();
  } else {
    transactionKey = date + "1";
  }

  const t = await invtDB.transaction();
  try {
    let get_transaction_id = await invtDB.query("SELECT `jw_ven_txn` FROM `jw_ven_location` WHERE `jw_ven_txn` = :transaction_id GROUP BY `jw_ven_txn` LIMIT 1", {
      replacements: { transaction_id: transactionKey },
      type: invtDB.QueryTypes.SELECT
    });

    if (get_transaction_id.length > 0) {
      res.json({

        message: "alloting transaction id as " + transactionKey + " for material consumption has already exist with us, required manual checking or contact to system administrator",
      });
      return;
    } else {
      for (let i = 0; i < itemLength; i++) {
        if (helper.number(req.body.qty[i]) > 0) {
          let insert_res = await invtDB.query(
            "INSERT INTO `jw_ven_location` (`jw_ven_code`,`jw_ven_rm`,`jw_ven_in_qty`,`jw_ven_loc_out`,`jw_ven_challan_ref`,`jw_ven_insert_dt`,`jw_ven_insert_by`,`jw_ven_txn`,`jw_ven_remark`,`jw_ven_txn_type`,`jw_ven_jw_ref`)VALUES (:vendor,:part,:qty,:locin,:challan_ref,:indt,:inby,:transaction,:remark,'SFG-CREATE',:jw_ref)",
            {
              replacements: {
                vendor: req.logedINVendor,
                part: req.body.component[i],
                qty: req.body.qty[i],
                locin: req.body.put_location[i],
                challan_ref: req.body.challan == null ? "--" : req.body.challan,
                indt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                inby: req.logedINUser,
                transaction: transactionKey,
                remark: req.body.remark[i] == "" ? "--" : req.body.remark[i],
                jw_ref: req.body.jobwork == null ? "--" : req.body.jobwork
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: t,
            }
          );
        }
      }

      await t.commit();
      res.json({ status: "success", success: true, message: "SFG has been shifted to the location with TXN ID : " + transactionKey, data: { txn: transactionKey } });
      return;
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH ALL PENDING JW CHALLAN
router.post("/fetchPChallan", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    let limit = 10;
    if (req.body.search == "") {
      stmt = await otherDB.query("SELECT `jw_po_issue_qty` FROM `jw_purchase_req` WHERE (`jw_jw_transaction` != '' OR `jw_jw_transaction` != '--') GROUP BY `jw_jw_transaction` ORDER BY `ID` ASC LIMIT :limit", {
        replacements: { limit: limit },
        type: otherDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await otherDB.query("SELECT `jw_po_issue_qty` FROM `jw_purchase_req` WHERE (`jw_jw_transaction` != '' OR `jw_jw_transaction` != '--') AND (`jw_jw_transaction` LIKE :name) GROUP BY `jw_jw_transaction` ORDER BY `ID` LIMIT :limit", {
        replacements: { name: `%${req.body.search}%`, limit: limit },
        type: otherDB.QueryTypes.SELECT,
      });
    }

    let final = [];
    if (stmt.length > 0) {
      stmt.map((item) => {
        final.push({ id: item.jw_jw_transaction, text: item.jw_jw_transaction });

        if (stmt.length == final.length) {
          res.json(final);
          return;
        }
      });
    } else {
      res.json([{ id: "0", text: "No Data Found" }]);
      return;
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// GET RM STOCK AT LOCATION
router.post("/compStock", [auth.isAuthorized], async (req, res) => {
  try {
    if (req.body.component == null) {
      return res.json({ status: "error", success: false, message: "Please supply the valid component" });
    }
    if (req.body.pick_location == null) {
      return res.json({ status: "error", success: false, message: "Please supply the valid pick location" });
    }

    let stmt_inward = await invtDB.query("SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Inward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-INWARD') AND `jw_ven_loc_in` = :location AND `jw_ven_code` = :vendor", {
      replacements: {
        component: req.body.component,
        location: req.body.pick_location,
        vendor: req.logedINVendor,
      },
      type: invtDB.QueryTypes.SELECT,
    });

    let inward_all_qty = 0;
    if (stmt_inward.length > 0) {
      inward_all_qty = stmt_inward[0].Inward;
    }

    let stmt_outward = await invtDB.query("SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Outward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-CONSUMPTION') AND `jw_ven_loc_out` = :location AND `jw_ven_code` = :vendor", {
      replacements: {
        component: req.body.component,
        location: req.body.pick_location,
        vendor: req.logedINVendor,
      },
      type: invtDB.QueryTypes.SELECT,
    });

    let outward_all_qty = 0;
    if (stmt_outward.length > 0) {
      outward_all_qty = stmt_outward[0].Outward;
    }

    let closingBal = inward_all_qty - outward_all_qty > 0 ? inward_all_qty - outward_all_qty : 0;

    return res.json({ status: "success", success: true, message: "Data fetched successfully", data: { closingStock: closingBal } });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// GET SFG STOCK AT LOCATION
router.post("/sfgStock", [auth.isAuthorized], async (req, res) => {
  try {
    if (req.body.component == null) {
      return res.json({ status: "error", success: false, message: "Please supply the valid SFG component" });
    }
    if (req.body.put_location == null) {
      return res.json({ status: "error", success: false, message: "Please supply the valid put location" });
    }

    let stmt_inward = await invtDB.query("SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Inward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-INWARD') AND `jw_ven_loc_in` = :location AND `jw_ven_code` = :vendor", {
      replacements: {
        component: req.body.component,
        location: req.body.put_location,
        vendor: req.logedINVendor,
      },
      type: invtDB.QueryTypes.SELECT,
    });

    let inward_all_qty = 0;
    if (stmt_inward.length > 0) {
      inward_all_qty = stmt_inward[0].Inward;
    }

    let stmt_outward = await invtDB.query("SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Outward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-CONSUMPTION') AND `jw_ven_loc_out` = :location AND `jw_ven_code` = :vendor", {
      replacements: {
        component: req.body.component,
        location: req.body.put_location,
        vendor: req.logedINVendor,
      },
      type: invtDB.QueryTypes.SELECT,
    });

    let outward_all_qty = 0;
    if (stmt_outward.length > 0) {
      outward_all_qty = stmt_outward[0].Outward;
    }

    let closingBal = inward_all_qty - outward_all_qty > 0 ? inward_all_qty - outward_all_qty : 0;

    return res.json({ status: "success", success: true, message: "Data fetched successfully", data: { closingStock: closingBal } });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// GET COMPONENT INFORMATION WITH UOM AN STOCK FOR JOBWORK VENDOR
router.post("/getComponentDetailsByCode", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    component_code: "required"
  });

  if (validation.passes()) {
    try {
      const result = await invtDB.query("SELECT * FROM `components` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `components`.`component_key` = :key AND `components`.`c_is_enabled` = 'Y'", {
        replacements: { key: req.body.component_code },
        type: invtDB.QueryTypes.SELECT,
      });
      if (result.length > 0) {
        return res.json({ status: "success", success: true, message: "Data fetched successfully", data: { key: req.body.component_code, unit: result[0].units_name, hsn: result[0].c_hsn, mfgCode: result[0].manufacturing_code } });
      } else {
        return res.json({ status: "error", success: false, message: "component not found" });
      }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
  } else {
    return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
  }
});

// GET ALL JOBWORK ID
router.post("/getAllJW", [auth.isAuthorized], async (req, res) => {
  try {
    let result;

    if (req.body.search == "" || req.body.search == undefined) {
      result = await invtDB.query("SELECT `jw_jw_transaction` FROM `jw_purchase_req` WHERE `jw_po_vendor_reg_id` = :vendor AND jw_po_status = 'A' LIMIT :limit", {
        replacements: {
          limit: 10,
          vendor: req.logedINVendor
        },
        type: invtDB.QueryTypes.SELECT,
      });
    } else {
      result = await invtDB.query("SELECT `jw_jw_transaction` FROM `jw_purchase_req` WHERE `jw_jw_transaction` LIKE :jobwork AND `jw_po_vendor_reg_id` = :vendor AND jw_po_status = 'A'", {
        replacements: {
          jobwork: `%${req.body.search}%`,
          vendor: req.logedINVendor
        },
        type: invtDB.QueryTypes.SELECT,
      });
    }
    if (result.length > 0) {
      let final = [];

      result.map((item) => {
        final.push({ id: item.jw_jw_transaction, text: item.jw_jw_transaction });
      });

      if (result.length == final.length) {
        res.json(final);
        return;
      }
    } else {
      res.json({ status: "error", success: false, message: "No Data Found" });
    }
    return;
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// GET CHALLAN ASSOSCIATED WITH JOBWORK ID
router.post("/getJWChallan", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    jobwork: "required",
  });

  if (validation.fails()) {
    res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
    return;
  }

  if (validation.passes()) {
    invtDB
      .query("SELECT `jw_challan_txn_id` FROM `jw_material_challan` WHERE `jw_transaction` = :jobwork GROUP BY jw_challan_txn_id", { replacements: { jobwork: req.body.jobwork }, type: invtDB.QueryTypes.SELECT })
      .then((result) => {
        let final = [];

        result.map((item) => {
          final.push({ id: item.jw_challan_txn_id, text: item.jw_challan_txn_id });
        });

        if (result.length == final.length) {
          res.json({ status: "success", success: true, message: "Data fetched successfully", data: final });
          return;
        }
      })
      .catch((err) => {
        res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator" });
      });
  }
});

// FETCH PENDING SFG INWARD SENT BY VENDOE TO STORE EXECUTIVE
router.post("/fetchVendorSFG", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt0 = await invtDB.query(
      "SELECT * FROM `jw_ven_location` WHERE `jw_ven_txn_type` = :type AND `jw_ven_code` = :vendor GROUP BY `jw_ven_txn` ORDER BY `ID` DESC",
      {
        replacements: { type: 'SFG-CREATE', vendor: req.body.data },
        type: invtDB.QueryTypes.SELECT
      }
    );

    resData = [];
    count = 0;
    if (stmt0.length > 0) {
      stmt0.forEach(async (item0) => {
        resData.push({
          jw_txn: item0.jw_ven_jw_ref,
          challan_txn: item0.jw_ven_challan_ref,
          vendor: item0.jw_ven_code,
          indt: moment(item0.jw_ven_insert_dt).tz("Asia/Kolkata").format("DD-MM-YYYY hh:mm A"),
          sfg_txn: item0.jw_ven_txn
        });
        count++;
        if (count == stmt0.length) {
          res.json({ status: "success", success: true, message: "Data fetched successfully", data: resData });
          return;
        }
      });
    } else {
      res.json({ status: "error", success: false, message: "No data found" });
      return;
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//FETCH SFG INSIDE THE TRANSACTION FOR INWARD SEND BY VENDOR TO STORE EXECUTIVE
router.post("/fetchVendorSFGdetails", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt0 = await invtDB.query(
      "SELECT `jw_ven_location`.*, `components`.`component_key`, `components`.`c_part_no`, `components`.`c_name`, `units`.`units_name` FROM `jw_ven_location` LEFT JOIN `components` ON `jw_ven_location`.`jw_ven_rm` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_ven_txn_type` = :type AND `jw_ven_challan_ref` = :challan AND `jw_ven_jw_ref` = :jw AND `jw_ven_txn` = :sfgtxn ORDER BY `ID` DESC",
      {
        replacements: { type: 'SFG-CREATE', challan: req.body.challan, jw: req.body.jw, sfgtxn: req.body.sfgtxn },
        type: invtDB.QueryTypes.SELECT
      }
    );

    let stmt1 = await invtDB.query(
      "SELECT `jw_ven_location`.*, `components`.`component_key`, `components`.`c_part_no`, `components`.`c_name`, `units`.`units_name` FROM `jw_ven_location` LEFT JOIN `components` ON `jw_ven_location`.`jw_ven_rm` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_ven_txn_type` = :type AND `jw_ven_challan_ref` = :challan AND `jw_ven_jw_ref` = :jw AND `jw_ven_txn` = :sfgtxn ORDER BY `ID` DESC",
      {
        replacements: { type: 'SFG-CREATE', challan: req.body.challan, jw: req.body.jw, sfgtxn: req.body.sfgtxn },
        type: invtDB.QueryTypes.SELECT
      }
    );

    resData = [];
    count = 0;
    if (stmt0.length > 0) {
      stmt0.forEach(async (item0) => {
        resData.push({
          component: item0.c_name,
          part: item0.c_part_no,
          key: item0.component_key,
          unit: item0.units_name,
          remark: item0.jw_ven_remark
        });
        count++;
        if (count == stmt0.length) {
          res.json({ status: "success", success: true, message: "Data fetched successfully", data: resData });
          return;
        }
      });
    } else {
      res.json({ status: "error", success: false, message: "No data found" });
      return;
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});


// FETCH COMPONENTS STOCK BY LOCATION AND VENDOR
router.post("/getComponentsStockByLocation", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      location: "required",
      component: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    // ALL INWARD
    let stmtInward = await invtDB.query("SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Inward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-INWARD') AND `jw_ven_code` = :vendor AND `jw_ven_loc_in` = :location", {
      replacements: {
        component: req.body.component,
        location: req.body.location,
        vendor: req.logedINVendor
      },
      type: invtDB.QueryTypes.SELECT,
    });

    let inward_all_qty = 0;
    if (stmtInward.length > 0) {
      inward_all_qty = helper.number(stmtInward[0].Inward);
    }

    // ALL OUTWARD
    let stmtOutward = await invtDB.query("SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) AS `Outward` FROM `jw_ven_location` WHERE `jw_ven_rm` = :component AND (`jw_ven_txn_type` = 'RM-CONSUMPTION') AND `jw_ven_code` = :vendor AND `jw_ven_loc_out` = :location", {
      replacements: {
        component: req.body.component,
        location: req.body.location,
        vendor: req.logedINVendor
      },
      type: invtDB.QueryTypes.SELECT,
    });

    let outward_all_qty = 0;
    if (stmtInward.length > 0) {
      outward_all_qty = helper.number(stmtOutward[0].Outward);
    }

    return res.json({ status: "success", success: true, message: "Data fetched successfully", data: { stock: helper.number(inward_all_qty - outward_all_qty) } });

  }
  catch (error) {
    res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: error.stack }) });
  }
})


// GET SKU DETAILS FRO CREATE SFG
router.post("/getJwSkuDetails", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      jw_id: "required",
    })

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    const stmt = await invtDB.query("SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE `jw_purchase_req`.`jw_jw_transaction` = :jw_id AND `jw_purchase_req`.`jw_po_status` = 'A' ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC", {
      replacements: {
        jw_id: req.body.jw_id,
      },
      type: invtDB.QueryTypes.SELECT,
    })

    if (stmt.length <= 0) {
      return res.json({ status: "error", success: false, message: "no orders were found that match the given search JW ID." });
    }

    let data = {
      po_sku_transaction: stmt[0].jw_po_sku_transaction,
      skucode: stmt[0].p_sku,
      skuname: stmt[0].p_name,
      sku: stmt[0].jw_po_sku,
      ord_qty: stmt[0].jw_po_order_qty,
      rate: stmt[0].jw_po_order_rate,
      pending_qty: stmt[0].jw_po_order_qty - stmt[0].jw_ven_sfg_inward,
    }

    return res.json({ status: "success", success: true, message: "Data fetched successfully", data: data });

  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//INWARD SFG FROM VEDNOR
router.post("/sfgInward", [auth.isAuthorized], async (req, res) => {

  const t = await invtDB.transaction();
  try {

    const valid = new Validator(req.body, {
      jw_id: "required",
      jw_challan: "required",
      sku: "required",
      qty: "required",
      rate: "required"
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    // VALIDATION
    const stmt_check_qty = await invtDB.query("SELECT * FROM jw_purchase_req WHERE jw_jw_transaction = :jw_id", {
      replacements: {
        jw_id: req.body.jw_id
      },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt_check_qty.length <= 0) {
      await t.rollback();
      return res.json({ status: "error", success: false, message: "Invalid JW ID" });
    }


    if (Number(stmt_check_qty[0].jw_po_order_qty) <= Number(stmt_check_qty[0].jw_ven_sfg_inward)) {
      await t.rollback();
      return res.json({ status: "error", success: false, message: "JW ALREADY INWARD" });
    }

    if (Number(req.body.qty) > Number(stmt_check_qty[0].jw_po_order_qty) - Number(stmt_check_qty[0].jw_ven_sfg_inward)) {
      await t.rollback();
      return res.json({ status: "error", success: false, message: "INVALID QUANTITY" });
    }

    // VALIDATION END


    const stmt = await invtDB.query("INSERT INTO jw_ven_sfg_location(	jw_ven_id, jw_ven_sfg_jwid, jw_ven_sfg_jw_challan, jw_ven_sfg_sku, jw_ven_sfg_qty, jw_ven_sfg_rate, jw_ven_sfg_remark, jw_ven_sfg_txnid, jw_ven_sfg_insert_dt, jw_ven_sfg_insert_by) VALUES ( 	:jw_ven_id, :jw_id, :jw_challan, :sku, :qty, :rate, :remark, :txnid, :insert_dt, :insert_by)", {
      replacements: {
        jw_id: req.body.jw_id,
        jw_challan: req.body.jw_challan,
        sku: req.body.sku,
        qty: req.body.qty,
        rate: req.body.rate,
        remark: req.body.remark ?? "--",
        txnid: helper.getUniqueNumber(),
        insert_dt: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        insert_by: req.logedINUser,
        jw_ven_id: req.logedINVendor
      },
      type: invtDB.QueryTypes.INSERT,
      transaction: t
    });

    // UPDATE QTY 
    const stmt_update = await invtDB.query("UPDATE jw_purchase_req SET jw_ven_sfg_inward = jw_ven_sfg_inward + :qty WHERE jw_jw_transaction = :jw_id", {
      replacements: {
        qty: req.body.qty,
        jw_id: req.body.jw_id
      },
      type: invtDB.QueryTypes.UPDATE,
      transaction: t
    });

    await t.commit();

    return res.json({ status: "success", success: true, message: "Successfully Inserted SFG Inward" });

  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// LIST ALL SFG FROM INWARD VENDOR
router.post("/vendorSfgInwardList", [auth.isAuthorized], async (req, res) => {
  try {

    const valid = new Validator(req.body, {
      wise: "required|in:JW,SFG,DATE",
      data: "required",
    })

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    const { data, wise } = req.body

    let stmt;

    if (wise == "JW") {

      stmt = await invtDB.query("SELECT jw_ven_sfg_location.*, admin_login.user_name FROM jw_ven_sfg_location LEFT JOIN admin_login ON admin_login.CustID = jw_ven_sfg_location.jw_ven_sfg_insert_by WHERE jw_ven_sfg_jwid = :jw_id AND jw_ven_id = :vendor ", {
        replacements: {
          jw_id: data,
          vendor: req.logedINVendor
        },
        type: invtDB.QueryTypes.SELECT
      });

    } else if (wise == "SFG") {

      stmt = await invtDB.query("SELECT jw_ven_sfg_location.*, admin_login.user_name FROM jw_ven_sfg_location LEFT JOIN admin_login ON admin_login.CustID = jw_ven_sfg_location.jw_ven_sfg_insert_by WHERE jw_ven_sfg_sku = :sku AND jw_ven_id = :vendor ", {
        replacements: {
          sku: data,
          vendor: req.logedINVendor
        },
        type: invtDB.QueryTypes.SELECT
      });

    } else if (wise == "DATE") {

      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query("SELECT jw_ven_sfg_location.*, admin_login.user_name FROM jw_ven_sfg_location LEFT JOIN admin_login ON admin_login.CustID = jw_ven_sfg_location.jw_ven_sfg_insert_by WHERE jw_ven_id = :vendor AND DATE_FORMAT(jw_ven_sfg_insert_dt ,'%Y-%m-%d') BETWEEN :data1 AND :data2 ", {
        replacements: {
          data1: fromdate,
          data2: todate,
          vendor: req.logedINVendor
        },
        type: invtDB.QueryTypes.SELECT
      });

    }



    if (stmt.length == 0) {
      return res.json({ status: "error", success: false, message: "No Data Found" });
    }

    const res_data = [];
    for (let i = 0; i < stmt.length; i++) {
      res_data.push({
        jw_id: stmt[i].jw_ven_sfg_jwid,
        jw_challan: stmt[i].jw_ven_sfg_jw_challan,
        sku: stmt[i].jw_ven_sfg_sku,
        qty: stmt[i].jw_ven_sfg_qty,
        rate: stmt[i].jw_ven_sfg_rate,
        create_date: moment(stmt[i].jw_ven_sfg_insert_dt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY"),
        create_by: stmt[i].user_name
      })
    }

    return res.json({ status: "success", success: true, message: "Data fetched successfully", data: res_data });

  }
  catch (error) {
    res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: error.stack }) });
  }
});

// GET COMPLETE DATA
router.post("/getCompleteData", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      date: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    if (fromdate == "Invalid date" || todate == "Invalid date") {
      return res.json({ status: "error", success: false, message: "Invalid Date" });
    }

    if (moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "days") > "90") {
      return res.json({ status: "error", success: false, message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only" });
    }

    const stmt = await invtDB.query("SELECT  admin_login.user_name , ven_basic_detail.ven_name, `components`.`c_part_no`, `components`.`component_key`, `components`.`c_name`, `jw_ven_challan`.`jw_jobwork_id`, `jw_ven_challan`.`jw_challan_id`, `jw_ven_challan`.`jw_qty`, `jw_ven_challan`.`jw_rate`, `units`.`units_name`, (SELECT jw_hsncode FROM jw_material_challan WHERE jw_component_id = `components`.`component_key` AND jw_jobwork_id = jw_ven_challan.jw_jobwork_id AND 	jw_challan_id = jw_ven_challan.jw_challan_id LIMIT 1) AS hsn, jw_ven_challan.jw_insert_dt FROM `jw_ven_challan` LEFT JOIN `components` ON `jw_ven_challan`.`jw_part` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = jw_ven_challan.jw_ven  LEFT JOIN admin_login ON admin_login.CustID = jw_ven_challan.jw_insert_by  WHERE `jw_trans_type` = 'IN' AND DATE_FORMAT(`jw_ven_challan`.`jw_insert_dt`, '%Y-%m-%d') BETWEEN :date1 AND :date2 AND jw_ven_challan.jw_ven = :vendor ", {
      replacements: {
        date1: fromdate,
        date2: todate,
        vendor: req.logedINVendor
      },
      type: invtDB.QueryTypes.SELECT
    });

    if (stmt.length > 0) {
      let finalResult = [];
      for (let i = 0; i < stmt.length; i++) {
        let select_res = await invtDB.query(
          "SELECT COALESCE(SUM(`jw_ven_in_qty`), 0) as `in_qty` FROM `jw_ven_location` WHERE `jw_ven_jw_ref` = :jobwork AND `jw_ven_rm` = :component AND `jw_ven_challan_ref` = :challan",
          {
            replacements: {
              component: stmt[i].component_key,
              jobwork: stmt[i].jw_jobwork_id,
              challan: stmt[i].jw_challan_id
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let in_qty = 0, jw_qty = 0, close_date = "NA";
        if (select_res.length > 0) {
          in_qty = helper.number(select_res[0].in_qty);
          jw_qty = helper.number(stmt[i].jw_qty);
          close_date = moment(select_res[0].close_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss");
        }

        if (jw_qty == in_qty) {
          finalResult.push({
            part_no: stmt[i].c_part_no,
            part_name: stmt[i].c_name,
            uom: stmt[i].units_name,
            hsn: stmt[i].hsn ?? '--',
            jw_qty: stmt[i].jw_qty,
            jw_leftqty: jw_qty - in_qty,
            jobwork: stmt[i].jw_jobwork_id,
            challan: stmt[i].jw_challan_id,
            ven_name: stmt[i].ven_name,
            entry_by: stmt[i].user_name,
            challan_date: moment(stmt[i].jw_insert_dt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
			rate : stmt[i].jw_rate,
			totalValue : stmt[i].jw_rate * stmt[i].jw_qty,
          });
        }
      }

      if (finalResult.length > 0) {
        return res.json({ status: "success", success: true, message: "Data fetched successfully", data: finalResult });
      } else {
        return res.json({ status: "error", success: false, message: "Data not found" });
      }


    } else {
      res.json({ status: "error", success: false, message: "Data not found" });
      return;
    }
  }
  catch (error) {
    res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: error.stack }) });
  }
})

// GET BOM RECIPE MAPPED WITH JOBWORK
router.post("/getBomItem", [auth.isAuthorized], async (req, res) => {
    try {
      const valid = new Validator(req.body, {
        jwID: "required",
        sfgCreateQty: "required",
      });
  
      if (valid.fails()) {
        return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
      }
  
      let stmt_jwpo_req = await invtDB.query(
        "SELECT * FROM jw_purchase_req LEFT JOIN jw_bom_recipe ON jw_purchase_req.jw_po_sku = jw_bom_recipe.jw_bom_sku LEFT JOIN bom_recipe ON jw_purchase_req.jw_po_recipe = bom_recipe.subject_id WHERE jw_purchase_req.jw_jw_transaction = :jw_id LIMIT 1",
        {
          replacements: { jw_id: req.body.jwID },
          type: invtDB.QueryTypes.SELECT,
        }
      );
  
      if (stmt_jwpo_req.length > 0) {
        let stmt_comp = await invtDB.query("SELECT * FROM jw_bom_recipe LEFT JOIN components ON jw_bom_recipe.jw_bom_part = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE jw_bom_recipe.jw_bom_po_trans = :jw_id ORDER BY components.c_part_no ASC", {
          replacements: { jw_id: req.body.jwID },
          type: invtDB.QueryTypes.SELECT,
        });
  
        if (stmt_comp.length > 0) {
          result = [];
          for (let i = 0; i < stmt_comp.length; i++) {
            let stmt2 = await invtDB.query("SELECT COALESCE(SUM(qty+other_qty),0 ) AS total_issued_rm FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'JOBWORK' ", {
              replacements: { component_id: stmt_comp[i].component_key, transaction_id: req.body.jwID },
              type: invtDB.QueryTypes.SELECT,
            });
            let total_issue_qty;
            if (stmt2.length > 0) {
              total_issue_qty = stmt2[0].total_issued_rm;
            } else {
              total_issue_qty = 0;
            }
  
            let stmt3 = await invtDB.query("SELECT COALESCE(SUM(qty+other_qty),0 ) AS total_returned_rm FROM rm_location WHERE trans_type = 'INWARD' AND in_jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_mode = 'return'", {
              replacements: { component_id: stmt_comp[i].component_key, transaction_id: req.body.jwID },
              type: invtDB.QueryTypes.SELECT,
            });
            let total_rm_return_qty;
            if (stmt3.length > 0) {
              total_rm_return_qty = stmt3[0].total_returned_rm;
            } else {
              total_rm_return_qty = 0;
            }
  
            let consump_qty = helper.number((stmt_jwpo_req[0].jw_po_issue_qty * stmt_comp[i].jw_bom_qty) > (total_issue_qty - total_rm_return_qty) ? (total_issue_qty - total_rm_return_qty) : (stmt_jwpo_req[0].jw_po_issue_qty * stmt_comp[i].jw_bom_qty));
  
            result.push({
              key: stmt_comp[i].component_key,
              part_no: stmt_comp[i].c_part_no,
              part_name: stmt_comp[i].c_name,
              uom: stmt_comp[i].units_name,
              bom_qty: helper.number(stmt_comp[i].jw_bom_qty),
              rqd_qty: helper.number(stmt_comp[i].jw_bom_qty) * helper.number(req.body.sfgCreateQty),
              pendingStock: helper.number(total_issue_qty - consump_qty - total_rm_return_qty).toFixed(2),
            })
          }
  
          return res.json({ status: "success", success: true, message: "Data fetched successfully", data: result });
        } else {
          return res.json({ status: "error", success: false, message: "BOM configuration not found" });
        }
      } else {
        return res.json({ status: "error", success: false, message: 'Invalid transaction id we could not find anything.. against product sku [${product_sku}]' });
      }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
  })

module.exports = router;
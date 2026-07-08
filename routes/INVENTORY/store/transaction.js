const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const xlsx = require("xlsx");
const axios = require("axios");
const fs = require("fs");

let { invtDB, refbDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const { encode, decode } = require("html-entities");

const Validator = require("validatorjs");
const { s3Config } = require("../../../config/awsConfig");

// GET TRANSACTION TYPE IN
router.get("/transactionIn", [auth.isAuthorized],  async (req, res) => {
  const type = req.query.type;

  const validation = new Validator(req.query, {
    data: "required",
    type: "required",
  });

  if (validation.passes()) {
    if (type == "M") {
      const searchValue = req.query.data;

      if (!/([0-9]{2})-([0-9]{2})-([0-9]{4})/gi.test(searchValue)) {
        res.json({
          success: false,
          message: "Invalid date format",
          status: "error",
        });
        return;
      }

      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      let date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      let date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months",
      );
      if (durationInMonths > 3) {
        return res.json({
          status: "error",
          message:
            "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          success: false,
        });
      }

      invtDB
        .query(
          "SELECT *, `rm_location`.`insert_date`, cost_center.cost_center_name, cost_center.cost_center_short_name FROM `rm_location` LEFT JOIN `components` ON rm_location.components_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN location_main ON rm_location.loc_in = location_main.location_key LEFT JOIN admin_login ON rm_location.insert_by = admin_login.CustID LEFT JOIN cost_center ON cost_center.cost_center_key = rm_location.rm_loc_cost_center WHERE `components`.`c_type` IN ('R', 'S') AND `components`.`c_is_enabled` = 'Y' AND DATE_FORMAT(rm_location.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND (`rm_location`.trans_type = 'INWARD' OR ( rm_location.trans_type = 'TRANSFER' AND rm_location.trans_mode = 'return' AND rm_location.vendor_type = 'j01' AND rm_location.in_jw_transaction_id != '--' )) AND `rm_location`.in_module != 'PART-CONV' AND components.c_is_enabled = 'Y' ORDER BY rm_location.insert_date DESC",
          {
            replacements: { date1: date1, date2: date2 },
            type: invtDB.QueryTypes.SELECT,
          },
        )
        .then(async (result) => {
          if (result.length > 0) {
            // BUG 2 FIX: use Promise.all instead of forEach+async to avoid race condition
            const finalResult = await Promise.all(
              result.map(async (element) => {
                let invoiceStatus = false;
                let checkInvoices = await invtDB.query(
                  "SELECT * FROM ims_min_invoices WHERE min_min_id = :txn",
                  {
                    replacements: { txn: element.in_transaction_id },
                    type: invtDB.QueryTypes.SELECT,
                  },
                );
                if (checkInvoices.length > 0) {
                  invoiceStatus = true;
                }

                let vendor = "",
                  cost_center = "";
                if (element.rm_loc_cost_center == "--") {
                  cost_center = "N/A";
                } else {
                  cost_center =
                    element.cost_center_name == ""
                      ? "N/A"
                      : element.cost_center_name +
                        " (" +
                        element.cost_center_short_name +
                        ")";
                }

                if (element.vendor_type == "v01") {
                  vendor = "Vendor";
                } else if (element.vendor_type == "j01") {
                  vendor = "JWI";
                } else if (element.vendor_type == "s01") {
                  vendor = "SortIn";
                } else if (element.vendor_type == "r01") {
                  vendor = "RejIn";
                } else if (element.vendor_type == "p01") {
                  vendor = "ProdReturn";
                } else {
                  vendor = "N/A";
                }

                let vendorName;
                let stmt_vendorName = await invtDB.query(
                  "SELECT `ven_name` FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor",
                  {
                    replacements: { vendor: element.in_vendor_name },
                    type: invtDB.QueryTypes.SELECT,
                  },
                );
                if (stmt_vendorName.length > 0) {
                  vendorName = stmt_vendorName[0].ven_name;
                } else {
                  vendorName = "N/A";
                }

                let project_name, invoice_number, po_number;
                if (element.in_po_invoice_id !== "--") {
                  invoice_number = element.in_po_invoice_id;
                  po_number = element.in_po_transaction_id;

                  let stmt_otherdata = await invtDB.query(
                    "SELECT po_purchase_req.po_project_name FROM `po_purchase_req` WHERE po_purchase_req.po_transaction = :po",
                    {
                      replacements: { po: po_number },
                      type: invtDB.QueryTypes.SELECT,
                    },
                  );
                  if (stmt_otherdata.length > 0) {
                    project_name =
                      stmt_otherdata[0].po_project_name == ""
                        ? "N/A"
                        : stmt_otherdata[0].po_project_name;
                  } else {
                    project_name = "N/A";
                  }
                } else {
                  if (element.in_invoice_id !== "--") {
                    invoice_number = element.in_invoice_id;
                    po_number = "N/A";
                  } else {
                    invoice_number = "N/A";
                    po_number = "N/A";
                  }
                  project_name = "N/A";
                }

                let currency;  
                if (
                  element.currency_type == "--" ||
                  element.currency_type == "" ||
                  element.currency_type == "364907247"
                ) {
                  currency = "INR";
                } else {
                  currency = "USD";
                }

                let inQty = parseInt(element.qty) + parseInt(element.other_qty);

                let hsncode = "";
                if (element.in_hsn_code !== "" && element.in_hsn_code !== "--") {
                  hsncode = element.in_hsn_code;
                } else {
                  hsncode = "--";
                }

                return {
                  DATE: helper.dateFormat(element.insert_date, "YYYY-MM-DD HH:mm:ss", "DD-MM-YYYY HH:mm:ss"),
                  DOC_DATE: helper.dateFormat(element.in_wo_invoice_date, "YYYY-MM-DD HH:mm:ss", "DD-MM-YYYY HH:mm:ss"),
                  COMPONENT: decode(element.c_name),
                  PART: element.c_part_no,
                  PART_NEW: element.c_new_part_no,
                  HSNCODE: hsncode,
                  TYPE: vendor,
                  LOCATION: element.loc_name,
                  RATE: element.in_po_rate,
                  CURRENCY: currency,
                  INQTY: inQty,
                  UNIT: element.units_name,
                  VENDOR: vendorName,
                  PONUMBER: po_number,
                  INVOICENUMBER: invoice_number,
                  TRANSACTION:
                    element.in_transaction_id == "--"
                      ? element.transfer_transaction_id
                      : element.in_transaction_id,
                  ISSUEBY: element.user_name,
                  COMMENT: element.any_remark == "" ? "--" : element.any_remark,
                  PROJECT: project_name,
                  COSTCENTER: cost_center,
                  invoiceStatus: invoiceStatus,
                  MST_MFGCODE: element.manufacturing_code,
                  MNL_MFGCODE: element.manual_mfg_code,
                };
              })
            );

            return res.json({
              success: true,
              status: "success",
              data: finalResult,
            });
          } else {
            return res.json({
              success: false,
              message: "No Data Found",
              status: "error",
            });
          }
        })
        .catch((err) => {
          return helper.errorResponse(res, err);
        });
    } else if (type == "P") {
      const po = req.query.data;
      invtDB
        .query(
          "SELECT *, rm_location.insert_date FROM rm_location LEFT JOIN components ON rm_location.components_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id LEFT JOIN location_main ON rm_location.loc_in = location_main.location_key LEFT JOIN admin_login ON rm_location.insert_by = admin_login.CustID WHERE components.c_type IN ('R', 'S') AND `components`.`c_is_enabled` = 'Y' AND (rm_location.trans_type = 'INWARD' OR (rm_location.trans_type = 'TRANSFER' AND rm_location.trans_mode = 'return' AND rm_location.vendor_type = 'j01' AND rm_location.in_jw_transaction_id != '--' )) AND `rm_location`.in_module != 'PART-CONV' AND  (rm_location.in_po_transaction_id = :po_order AND rm_location.in_po_transaction_id != '--') ORDER BY rm_location.insert_date DESC",
          { replacements: { po_order: po }, type: invtDB.QueryTypes.SELECT },
        )
        .then(async (result) => {
          if (result.length > 0) {
            var finalResult = [];
            var itemsProcessed = 0;
            result.forEach(async (element, inx, arr) => {
              var result2 = await invtDB.query(
                "SELECT * FROM po_purchase_req WHERE po_transaction = :po",
                {
                  replacements: { po: element.in_po_transaction_id },
                  type: invtDB.QueryTypes.SELECT,
                },
              );
              if (result2.length > 0) {
                finalResult.push({
                  ...element,
                  ...{ ven_name: result2[0].po_vendor_name },
                });
              } else {
                var result3 = await invtDB.query(
                  "SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor",
                  {
                    replacements: { vendor: element.in_vendor_name },
                    type: invtDB.QueryTypes.SELECT,
                  },
                );
                finalResult.push({
                  ...element,
                  ...{ ven_name: result3[0].ven_name },
                });
              }

              itemsProcessed++;

              if (itemsProcessed === arr.length) {
                myfun();
              }
            });

            function myfun() {
              let finalResult2 = [];
              finalResult.forEach(async (element) => {
                let vendor = "";
                let invoice_number, po_number, currency;

                if (element.vendor_type == "v01") {
                  vendor = "Vendor";
                } else if (element.vendor_type == "j01") {
                  vendor = "JWI";
                } else if (element.vendor_type == "s01") {
                  vendor = "SortIn";
                } else if (element.vendor_type == "r01") {
                  vendor = "RejIn";
                } else if (element.vendor_type == "p01") {
                  vendor = "ProdReturn";
                } else {
                  vendor = "N/A";
                }

                if (element.in_po_invoice_id !== "--") {
                  invoice_number = element.in_po_invoice_id;
                  po_number = element.in_po_transaction_id;
                } else {
                  if (element.in_invoice_id !== "--") {
                    invoice_number = element.in_invoice_id;
                    po_number = "N/A";
                  } else {
                    invoice_number = "N/A";
                    po_number = "N/A";
                  }
                }

                if (
                  element.currency_type == "--" ||
                  element.currency_type == "" ||
                  element.currency_type == "364907247"
                ) {
                  currency = "INR";
                } else {
                  currency = "USD";
                }

                let vendorName;
                let stmt_vendorName;
                stmt_vendorName = await invtDB.query(
                  "SELECT `po_vendor_name` FROM `po_purchase_req` WHERE `po_transaction` = :po",
                  {
                    replacements: { po: element.in_po_transaction_id },
                    type: invtDB.QueryTypes.SELECT,
                  },
                );
                if (stmt_vendorName.length > 0) {
                  vendorName = stmt_vendorName[0].po_vendor_name;
                } else {
                  stmt_vendorName = await invtDB.query(
                    "SELECT `ven_name`FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor",
                    {
                      replacements: { vendor: element.in_vendor_name },
                      type: invtDB.QueryTypes.SELECT,
                    },
                  );
                  if (stmt_vendorName.length > 0) {
                    vendorName = stmt_vendorName[0].ven_name;
                  } else {
                    vendorName = "N/A";
                  }
                }

                let inQty = parseInt(element.qty) + parseInt(element.other_qty);

                let hsncode = "";
                if (
                  element.in_hsn_code !== "" &&
                  element.in_hsn_code !== "--"
                ) {
                  hsncode = element.in_hsn_code;
                } else {
                  hsncode = "--";
                }

                finalResult2.push({
                  DATE: moment(
                    element.insert_date,
                    "YYYY-MM-DD HH:mm:ss",
                  ).format("DD-MM-YYYY HH:mm:ss"),
                  COMPONENT: decode(element.c_name),
                  PART: element.c_part_no,
                  PART_NEW: element.c_new_part_no,
                  HSNCODE: hsncode,
                  TYPE: vendor,
                  LOCATION: element.loc_name,
                  RATE: element.in_po_rate,
                  CURRENCY: currency,
                  INQTY: inQty,
                  UNIT: element.units_name,
                  VENDOR: vendorName,
                  PONUMBER: po_number,
                  INVOIVENUMBER: invoice_number,
                  TRANSACTION:
                    element.in_transaction_id == "--"
                      ? element.transfer_transaction_id
                      : element.in_transaction_id,
                  ISSUEBY: element.user_name,
                  COMMENT: element.any_remark,
                  MST_MFGCODE: element.manufacturing_code,
                  MNL_MFGCODE: element.manual_mfg_code,
                });

                if (finalResult2.length == result.length) {
                  const worksheet = xlsx.utils.json_to_sheet(finalResult2);
                  const workbook = xlsx.utils.book_new();

                  xlsx.utils.book_append_sheet(
                    workbook,
                    worksheet,
                    "Transaction Inward",
                  );

                  xlsx.write(workbook, { bookType: "csv", type: "buffer" });

                  let randKey =
                    Math.floor(Math.random() * (999 - 100 + 1)) + 100;

                  xlsx.writeFile(
                    workbook,
                    "./files/excel/TRANIN" + randKey + ".xlsx",
                  );

                  return res.json({
                    success: true,
                    data: finalResult2,
                    status: "success",
                  });
                }
              });
            }
          } else {
            return res.json({
              success: false,
              message: "No data Found",
              status: "error",
            });
          }
        })
        .catch((err) => {
          console.log(err);
          helper.errorResponse(res, err);
        });
    } else {
      return res.json({
        success: false,
        message: "You have selected an invalid operation",
        status: "error",
      });
    }
  } else {
    res.json({
      success: false,
      message: helper.firstErrorValidatorjs(validation),
      status: "error",
    });
  }
  return;
});

// GET TRANSACTION TYPE OUT
router.get("/transactionOut", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.query, {
    data: "required",
    type: "required|in:ISSUE,JOBWORK,REJECTION,CONSUMPTION,SFG-CONSUMPTION,TRANSFER",
  });

  if (!validation.passes()) {
    return res.json({
      success: false,
      message: helper.firstErrorValidatorjs(validation),
      status: "error",
    });
  }

  try {
    const { data, type } = req.query;

    if (!/([0-9]{2})-([0-9]{2})-([0-9]{4})/gi.test(data)) {
      return res.json({
        success: false,
        message: "Invalid date format",
        status: "error",
      });
    }

    const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

    const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
      moment(date[0], "DD-MM-YYYY"),
      "months",
    );

    if (durationInMonths > 3) {
      return res.json({
        status: "error",
        message:
          "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
        success: false,
      });
    }
    const finalResult = await invtDB.query(
      `
      SELECT 
        c.c_name,
        c.c_part_no,
        c.c_new_part_no,
        u.units_name,
        lm.loc_name,
        loc2.loc_name AS loc_out,
        al.user_name,
        rl.insert_date,
        rl.trans_type,
        rl.components_id,
        rl.in_vendor_name,
        rl.out_transaction_id,
        rl.jw_transaction_id,
        rl.jw_challan_id,
        rl.qty,
        vb.ven_name,
        vb.ven_register_id

      FROM rm_location rl

      LEFT JOIN components c 
        ON rl.components_id = c.component_key

      LEFT JOIN units u 
        ON c.c_uom = u.units_id

      LEFT JOIN location_main lm 
        ON rl.loc_in = lm.location_key 
        AND rl.loc_in <> '--'

      LEFT JOIN location_main loc2 
        ON rl.loc_out = loc2.location_key

      LEFT JOIN admin_login al 
        ON rl.insert_by = al.CustID

      LEFT JOIN ven_basic_detail vb 
        ON vb.ven_register_id = rl.in_vendor_name

      WHERE 
        c.c_type = 'R'
        AND c.c_is_enabled = 'Y'
        AND DATE_FORMAT(rl.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2
        AND rl.trans_type = :type
        AND (
          rl.trans_type <> 'TRANSFER'
          OR rl.trans_mode = 'return'
        )
        AND (
          rl.trans_type <> 'CONSUMPTION'
          OR (
              rl.jw_transaction_id != '--'
              AND rl.trans_mode = 'default'
          )
        )
      ORDER BY rl.insert_date DESC
      `,
      {
        replacements: { date1, date2, type },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (!finalResult.length) {
      return res.json({
        success: false,
        message: "Transaction not found",
        status: "error",
      });
    }

    const txnPairs = finalResult.map((r) => ({
      out_transaction_id: r.out_transaction_id,
      components_id: r.components_id,
    }));

    const uniquePairs = [
      ...new Map(
        txnPairs.map((item) => [
          `${item.out_transaction_id}_${item.components_id}`,
          item,
        ]),
      ).values(),
    ];

    let requestMap = new Map();

    if (uniquePairs.length) {
      const requestData = await invtDB.query(
        `
        SELECT 
          mr.approval_transaction,
          mr.components_key,
          al.user_name
        FROM material_request mr
        LEFT JOIN admin_login al 
          ON al.CustID = mr.inserted_by
        WHERE (mr.approval_transaction, mr.components_key) IN (
          ${uniquePairs.map(() => "(?, ?)").join(",")}
        )
        `,
        {
          replacements: uniquePairs.flatMap((obj) => [
            obj.out_transaction_id,
            obj.components_id,
          ]),
          type: invtDB.QueryTypes.SELECT,
        },
      );

      requestData.forEach((r) => {
        requestMap.set(
          `${r.approval_transaction}_${r.components_key}`,
          r.user_name,
        );
      });
    }

    const result = finalResult.map((item) => {
      const key = `${item.out_transaction_id}_${item.components_id}`;
      const requestedBy = requestMap.get(key) || "--";

      let transaction_mode = "N/A";
      let transaction_id = "N/A";

      switch (item.trans_type) {
        case "ISSUE":
        case "CONSUMPTION":
        case "SFG-CONSUMPTION":
        case "TRANSFER":
          transaction_mode = item.trans_type;
          transaction_id = `TXN ID: ${item.out_transaction_id}`;
          break;

        case "JOBWORK":
          transaction_mode = "JOBWORK";
          transaction_id = `JW TXN ID: ${item.jw_transaction_id} !!! CHALLAN TXN ID: ${item.jw_challan_id}`;
          break;

        case "REJECTION":
          transaction_mode = "REJECTION";
          break;
      }

      return {
        DATE: moment(item.insert_date).format("DD-MM-YYYY HH:mm:ss"),
        COMPONENT: decode(item.c_name),
        PART: item.c_part_no,
        PART_NEW: item.c_new_part_no,
        FROMLOCATION: item.loc_out ?? "--",
        TOLOCATION: item.loc_name ?? "--",
        OUTQTY: `${item.qty}`,
        UNIT: item.units_name,
        ISSUEBY: item.user_name,
        TYPE: transaction_mode,
        TRANSACTION: transaction_id,
        VENDORCODE: item.ven_register_id ?? "--",
        VENDORNAME: item.ven_name ?? "--",
        REQUESTEDBY: requestedBy,
      };
    });

    return res.json({
      success: true,
      data: result,
      status: "success",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPLOAD INVOICE
// var storage = multer.diskStorage({
//   destination: "uploads/minInvoices",
//   filename: function (req, file, cb) {
//     cb(null, "INV" + helper.getUniqueNumber() + helper.randomNumber(100, 999) + path.extname(file.originalname));
//   },
// });

// var upload = multer({ storage: storage });
// router.post("/upload-invoice", [auth.isAuthorized, upload.array("files")], async (req, res) => {
//   let filesLenth = req.files.length;

//   if (filesLenth <= 0) {
//     res.json({ message: "Somthing went wrong", status: "error", success: false });
//     return;
//   }

//   let files = [];
//   if (filesLenth > 0) {
//     for (let i = 0; i < filesLenth; i++) {
//       files.push(req.files[i].filename);
//     }
//   }
//   // array to string
//   files = files.toString();
//   res.json({ status: "success", success: true, message: "Document uploaded successfully", data: files });
//   return;
// });

//S3 BUCKET UPLOAD INVOICE

var storage = multer.memoryStorage();

var upload = multer({ storage: storage });

router.post(
  "/upload-invoice",
  [auth.isAuthorized, upload.array("files")],
  async (req, res) => {
    let filesLength = req.files.length;

    if (filesLength <= 0) {
      res.json({
        status: "error",
        success: false,
        message: "Something went wrong",
      });
      return;
    }

    let files = [];

    if (filesLength > 0) {
      for (let i = 0; i < filesLength; i++) {
        try {
          const filename =
            "INV" +
            helper.getUniqueNumber() +
            helper.randomNumber(100, 999) +
            path.extname(req.files[i].originalname);

          // Determine file mimetype
          const fileExt = path.extname(req.files[i].originalname).toLowerCase();
          const mimeTypes = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".pdf": "application/pdf",
            ".gif": "image/gif",
          };
          const mimetype =
            mimeTypes[fileExt] ||
            req.files[i].mimetype ||
            "application/octet-stream";

          const s3Key = `uploads/2025/2025-09/uploads/minInvoices/${filename}`;

          await s3Config.uploadFile(
            {
              buffer: req.files[i].buffer,
              mimetype: mimetype,
            },
            s3Key,
          );

          files.push(filename);
        } catch (s3Error) {
          return helper.errorResponse(res, s3Error);
        }
      }
    }

    files = files.toString();

    res.json({
      status: "success",
      success: true,
      message: "Document uploaded successfully",
      data: files,
    });
    return;
  },
);

// MIN TRANSACTION
router.post(
  "/min_transaction",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    if (req.body.vendortype == "v01") {
      const validation = new Validator(req.body, {
        vendor: "required",
        vendorbranch: "required",
        address: "required",
        attachment: "required",
        vendortype: "required",
        cost_center: "required",
        project_id: "required",
      });

      if (validation.fails()) {
        res.json({
          status: "error",
          success: false,
          message: helper.firstErrorValidatorjs(validation),
        });
        return;
      }
    }
    if (req.body.vendortype == "p01") {
      const validation = new Validator(req.body, {
        vendortype: "required",
      });

      if (validation.fails()) {
        res.json({
          status: "error",
          success: false,
          message: helper.firstErrorValidatorjs(validation),
        });
        return;
      }
    }

    if (req.body.vendortype == "j01") {
      const validation = new Validator(req.body, {
        vendor: "required",
        vendorbranch: "required",
        address: "required",
        attachment: "required",
        vendortype: "required",
        ewaybill: "required",
        cost_center: "required",
        project_id: "required",
      });

      if (validation.fails()) {
        res.json({
          status: "error",
          success: false,
          message: helper.firstErrorValidatorjs(validation),
        });
        return;
      }
    }

    let check_branch = await invtDB.query(
      "SELECT `branch_code` FROM `branches` WHERE `branch_code` = :branchcode",
      {
        replacements: { branchcode: req.branch },
        type: invtDB.QueryTypes.SELECT,
      },
    );
    if (check_branch.length == 0) {
      res.json({
        status: "error",
        success: false,
        message: "You haven't OR selected an invalid company branch",
      });
      return;
    }

    let itemLength = req.body.component.length;

    if (itemLength <= 0) {
      res.json({
        status: "error",
        success: false,
        message: "Please add atleast one item",
      });
      return;
    }

    let itemCurrencys = [];
    for (let i = 0; i < itemLength; i++) {
      itemCurrencys.push(req.body.currency[i]);
    }
    let uniqueItemCurrencys = [...new Set(itemCurrencys)];
    if (uniqueItemCurrencys.length > 1) {
      res.json({
        status: "error",
        success: false,
        message: "Please select same currency",
      });
      return;
    }
    // end curruncy validation

    for (let i = 0; i < itemLength; i++) {
      let itemValidation = new Validator(
        {
          item: req.body.component[i],
          qty: req.body.qty[i],
          rate: req.body.rate[i],
          currency: req.body.currency[i],
          gst_rate: req.body.gstrate[i],
          gst_type: req.body.gsttype[i],
        },
        {
          item: "required",
          qty: "required|min:1",
          rate: "required",
          currency: "required",
          gst_rate: "required|numeric",
          gst_type: [
            "required_if:gst_rate,!=,0",
            "required_if:gst_rate,!=,I",
            "required_if:gst_rate,!=,L",
          ],
        },
      );
      if (itemValidation.fails()) {
        res.json({
          status: "error",
          success: false,
          message: helper.firstErrorValidatorjs(itemValidation),
        });
        return;
      }
    }

    const t = await invtDB.transaction();
    try {
      let in_txn_no = await helper.genTransaction("MIN", t);
      let out_txn_no = helper.getUniqueNumber();

      let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");

      let einv_applicability = "--";
      if (req.body.vendortype != "p01") {
        let checkVendor = await invtDB.query(
          "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor_id",
          {
            replacements: { vendor_id: req.body.vendor },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        einv_applicability = checkVendor[0].ven_einvoice_status;
      }
      for (let i = 0; i < itemLength; i++) {
        if (helper.number(req.body.qty[i]) > 0) {
          let inward_type =
            req.body.vendortype === "p01" ? "MANUAL-PRODUCTION" : "";
          const gstCalculation = helper.gstCalculation(
            req.body.gstrate[i],
            req.body.rate[i] * req.body.qty[i],
            req.body.gsttype[i],
          );
          const cgst = gstCalculation.cgst || 0;
          const sgst = gstCalculation.sgst || 0;
          const igst = gstCalculation.igst || 0;

          let insert_res = await invtDB.query(
            "INSERT INTO `rm_location` (manual_mfg_code, `in_module`, `inward_type` ,`min_ewaybill`,`currency_type`,`exchange_rate`,`company_branch`,`vendor_type`,`components_id`,`loc_in`,`qty`,`insert_date`,`insert_by`,`in_transaction_id`,`in_invoice_id`,`in_vendor_name`,`in_vendor_branch`,`in_vendor_addr`,`in_hsn_code`,`in_gst_type`,`in_gst_rate`,`in_gst_cgst`,`in_gst_sgst`,`in_gst_igst`,`in_po_rate`,`any_remark`,`is_auto_cons`, rm_loc_project_id , rm_loc_cost_center, eInv_applicability, ackwlg_irn, qr_status)VALUES (:manual_mfg_code,'IN-MIN',:inward_type,:ewaybill,:currency,:exchange,:branch,:vendortype,:component,:location_in,:qty,:insertdate,:insertby,:transaction_id,:invoice_id,:vendor_code,:vendor_branch,:vendor_address,:hsncode,:gsttype,:gstrate,:cgst,:sgst,:igst,:rate,:comment,'N', :project_id , :cost_center, :einv_applicability, :ackwlg_irn, :qr_status)",
            {
              replacements: {
                manual_mfg_code: req.body.manual_mfg_code[i] ?? "--",
                ewaybill: req.body.ewaybill == "" ? "--" : req.body.ewaybill,
                inward_type: inward_type,
                currency: req.body.currency[i],
                exchange: req.body.exchange[i],
                branch: req.branch,
                vendortype: req.body.vendortype,
                component: req.body.component[i],
                location_in: req.body.location[i],
                qty: req.body.qty[i],
                insertdate: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
                insertby: req.logedINUser,
                transaction_id: in_txn_no,
                invoice_id:
                  req.body.vendortype == "p01"
                    ? (req.body.invoice[i] ?? "--")
                    : req.body.invoice[i],
                vendor_code: req.body.vendor ? req.body.vendor : "--",
                vendor_branch: req.body.vendorbranch
                  ? req.body.vendorbranch
                  : "--",
                vendor_address: req.body.address
                  ? req.body.address.replace(/\n/g, "<br>")
                  : "--",
                hsncode: req.body.hsncode[i] ? req.body.hsncode[i] : "--",
                gsttype: req.body.gsttype[i],
                gstrate: req.body.gstrate[i],
                cgst: cgst, // Fix: Use the calculated cgst value
                sgst: sgst, // Fix: Use the calculated sgst value
                igst: igst, // Fix: Use the calculated igst value
                rate:
                  req.body.currency[i] == "364907247"
                    ? Number(req.body.rate[i]).toFixed(2)
                    : Number(req.body.rate[i]).toFixed(2),
                comment: req.body.remark[i] == "" ? "--" : req.body.remark[i],
                project_id: req.body.project_id ?? "--",
                cost_center: req.body.cost_center ?? "--",
                einv_applicability: einv_applicability,
                ackwlg_irn: req.body.irn ?? "--",
                qr_status: req.body.qrScan ?? "--",
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: t,
            },
          );
          // Auto Consump
          if (req.body.out_location[i] !== 0) {
             const { rate: existingWAR, qty: existingQty } =
              await require("../../../helper/utils/newAvgRate").lastNewWeightedAverageRateWithStock(
                req.body.component[i],
              );

            const thisQty = helper.number(req.body.qty[i]);
            const thisRate = helper.number(req.body.rate[i]);
            const totalQty = existingQty + thisQty;

            const autoConsumpRate = parseFloat(
              (totalQty > 0
                ? (existingQty * existingWAR + thisQty * thisRate) / totalQty
                : thisRate
              ).toFixed(10),
            );
            let stmt4 = await invtDB.query(
              "INSERT INTO `rm_location` (`company_branch`,`trans_type`,`components_id`,`loc_in`,`loc_out`,`qty`,`insert_date`,`insert_by`,`in_transaction_id`,`out_transaction_id`,`is_auto_cons`,`any_remark`,in_po_rate)VALUES (:branch,:type,:component,:loc_in,:loc_out,:qty,:indate,:inby,:in_transaction_id,:out_transaction_id,'Y',:comment, :in_po_rate)",
              {
                replacements: {
                  branch: req.branch,
                  type: "ISSUE",
                  component: req.body.component[i],
                  loc_in: req.body.out_location[i],
                  loc_out: req.body.location[i],
                  qty: req.body.qty[i],
                  indate: moment().format("YYYY-MM-DD HH:mm:ss"),
                  inby: req.logedINUser,
                  in_transaction_id: in_txn_no,
                  out_transaction_id: out_txn_no,
                  comment: req.body.remark[i] == "" ? "--" : req.body.remark[i],
                  in_po_rate: autoConsumpRate
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: t,
              },
            );
          }
        }
      }

      if (req.body.vendortype != "p01") {
        let str = req.body.attachment;
        let arr = str.split(",");
        let fileLength = arr.length;
        for (let i = 0; i < fileLength; i++) {
          let insert_res_2 = await invtDB.query(
            "INSERT INTO `ims_min_invoices` (`min_inv_file`, `min_inv_by`, `min_inv_dt`, `min_min_id`) VALUES(:fileurl, :invby, :invdate, :minid)",
            {
              replacements: {
                fileurl: arr[i],
                invby: req.logedINUser,
                invdate: moment(new Date())
                  .tz("Asia/Kolkata")
                  .format("YYYY-MM-DD HH:mm:ss"),
                minid: in_txn_no,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: t,
            },
          );
        }
      }

      await t.commit();

      let payload = { Data: [] };
      let apiStatus = null;
      let externalResult;
      try {
        const data = [];
        const itemLength = req.body.component?.length || 0;

        for (let i = 0; i < itemLength; i++) {
          let partCodeName = "";
          let partname = "";
          if (req.body.component[i]) {
            const componentResult = await invtDB.query(
              "SELECT c_part_no, c_name FROM `components` WHERE `component_key` = :partCode LIMIT 1",
              {
                replacements: { partCode: req.body.component[i] },
                type: invtDB.QueryTypes.SELECT,
              },
            );
            partCodeName =
              componentResult.length > 0 ? componentResult[0].c_part_no : "";
            partname =
              componentResult.length > 0 ? componentResult[0].c_name : "";
          }

          // Fix: Include GST values in the payload for external API
          const gstCalculation = helper.gstCalculation(
            req.body.gstrate[i],
            req.body.rate[i] * req.body.qty[i],
            req.body.gsttype[i],
          );
          const cgst = gstCalculation.cgst || 0;
          const sgst = gstCalculation.sgst || 0;
          const igst = gstCalculation.igst || 0;

          data.push({
            PARTCode: partCodeName,
            PARTCodeName: partname,
            VendorName:
              req.body.vendortype === "p01" ? "--" : req.body.vendor || "--",
            InvoiceDate: req.body.invoiceDate?.[i]
              ? moment(req.body.invoiceDate[i], "DD-MM-YYYY").format(
                "YYYY/MM/DD HH:mm:ss",
              )
              : moment(insert_dt).format("YYYY/MM/DD HH:mm:ss"),
            MinNumber: in_txn_no,
            UNIT: isNaN(parseInt(req.body.qty[i]))
              ? 0
              : parseInt(req.body.qty[i]),
            Rate: isNaN(parseFloat(req.body.rate[i]))
              ? 0
              : parseFloat(req.body.rate[i]),
            CGST: cgst, // Fix: Add CGST to payload
            SGST: sgst, // Fix: Add SGST to payload
            IGST: igst, // Fix: Add IGST to payload
            MINDate: moment(insert_dt).format("YYYY/MM/DD HH:mm:ss"),
          });
        }

        payload = { Data: data };

        const response = await axios.post(
          "http://dev.oakter.co:84/Oakter/Report/SaveComponentInwardData",
          payload,
          {
            headers: { "Content-Type": "application/json" },
          },
        );

        apiStatus = response.data.OverAllStatus === "PASS" ? "PASS" : "FAIL";

        try {
          await invtDB.query(
            "INSERT INTO api_payload_log (min_number, api_status, payload, log_dt) VALUES (:minNumber, :apiStatus, :payload, :log_dt)",
            {
              replacements: {
                minNumber: in_txn_no,
                apiStatus: apiStatus,
                payload: JSON.stringify(payload),
                log_dt: moment(insert_dt).format("YYYY-MM-DD HH:mm:ss"),
              },
              type: invtDB.QueryTypes.INSERT,
            },
          );
        } catch (dbError) {
          // console.error('Failed to log payload to api_payload_log:', dbError.message);
        }

        externalResult = {
          status: apiStatus,
          message:
            apiStatus === "PASS"
              ? "External API call successful"
              : `External API call failed: ${response.data.Status.join(", ")}`,
          details: response.data.Status,
        };
      } catch (error) {
        apiStatus = "ERROR";

        try {
          await invtDB.query(
            "INSERT INTO api_payload_log (min_number, api_status, payload, log_dt) VALUES (:minNumber, :apiStatus, :payload, :log_dt)",
            {
              replacements: {
                minNumber: in_txn_no,
                apiStatus: apiStatus,
                payload: JSON.stringify(payload),
                log_dt: moment(insert_dt).format("YYYY-MM-DD HH:mm:ss"),
              },
              type: invtDB.QueryTypes.INSERT,
            },
          );
        } catch (dbError) {
          // console.error('Failed to log payload to api_payload_log:', dbError.message);
        }

        externalResult = {
          status: apiStatus,
          message: `Failed to call external API: ${error.message}`,
          details: error.response?.data || null,
        };
      }

      return res.json({
        message: `MIN done with TXN ID: ${in_txn_no}.`,
        status: "success",
        data: {
          txn: in_txn_no,
          externalStatus: externalResult.status,
          externalDetails: externalResult.details,
        },
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  },
);

// fetchAllComponentsStatus
router.post(
  "/fetchAllComponentsStatus",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      transId: "required",
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

    try {
      let response = await invtDB.query(
        "SELECT *, `material_request`.`ID` AS `req_id` FROM `material_request` LEFT JOIN `components` ON `components`.`component_key` = `material_request`.`components_key` WHERE `material_request`.`transaction_id` = :transaction ORDER BY `components`.`c_name` ASC",
        {
          replacements: { transaction: req.body.transId },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (response.length <= 0) {
        res.json({
          status: "error",
          success: false,
          message: "not a valid transaction...",
        });
      } else {
        // let result2 ;
        final = [];
        response.map(async (item, inx) => {
          result2 = await invtDB.query(
            "SELECT * FROM `material_approve` WHERE `components_key` = :component AND `preventDblEntry_token` = :token_id",
            {
              replacements: {
                component: item.components_key,
                token_id: item.req_id,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          if (result2.length > 0) {
            executeqty = result[0].debit;

            if (result2[0].transaction_type == "O") {
              status = "PENDING";
              badge = "warning";
            }
            if (result2[0].transaction_type == "OA") {
              status = "APPROVED";
              badge = "success";
            }
            if (result2[0].transaction_type == "REJ") {
              status = "CANCELLED";
              badge = "danger";
            } else {
              status = "CANCELLED";
              badge = "danger";
            }
          } else {
            if (item.transaction_type == "O") {
              status = "PENDING";
              badge = "warning";
              executeqty = "--";
            } else if (item.transaction_type == "C") {
              status = "CANCELLED";
              executeqty = "0";
              badge = "danger";
            } else if (item.transaction_type == "OA") {
              status = "APPROVED";
              executeqty = "--";
              badge = "success";
            } else {
              status = "FETCHING";
              executeqty = "--";
              badge = "secondary";
            }
          }
          final.push({
            components: decode(item.c_name),
            partcode: item.c_part_no,
            reqqty: item.req_debit,
            executeqty: executeqty,
            status: status,
            badge: badge,
            remark_issue: item.comment,
            remark_cancel: item.rej_comment,
          });

          if (response.length == final.length) {
            res.json({
              status: "success",
              success: true,
              message: "Data fetched successfully",
              data: final,
            });
            return;
          }
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  },
);

// GET LOCATION by type
router.post("/getLocationInMin", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE  `loc_all_key` = :location_key",
      {
        replacements: { location_key: "20220212103028" },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (stmt.length > 0) {
      loc_options = [];

      let str_arr = stmt[0].locations.split(",");
      const stmt2 = await invtDB.query(
        "SELECT location_key,loc_name FROM `location_main` WHERE `location_key` IN (:location_defined) AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: str_arr },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt2.length > 0) {
        for (let i = 0; i < stmt2.length; i++) {
          loc_options.push({
            id: stmt2[i].location_key,
            text: stmt2[i].loc_name,
          });
        }
      }

      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: loc_options,
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
  return;
});

router.post(
  "/getMaterialRequestPickLocation",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      // STATANDARD LOCATION

      let stmt = await invtDB.query(
        "SELECT * FROM `location_allotted` WHERE  `loc_all_key` = :location_key",
        {
          replacements: { location_key: "20220212103028" },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt.length > 0) {
        str_arr = stmt[0].locations.split(",");
      }

      loc_options = [];
      const stmt2 = await invtDB.query(
        "SELECT location_key,loc_name FROM `location_main` WHERE `location_key` IN (:location_defined) AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: str_arr },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt2.length > 0) {
        for (let i = 0; i < stmt2.length; i++) {
          loc_options.push({
            id: stmt2[i].location_key,
            text: stmt2[i].loc_name,
          });
        }
      }

      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: loc_options,
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
    return;
  },
);

// GET AUTO CONSUMPTION LOCATION LIST
router.get(
  "/fetchAutoConsumpLocation",
  [auth.isAuthorized],
  async (req, res) => {
    let stmt1 = await invtDB.query(
      "SELECT `locations` FROM `location_allotted` WHERE  `loc_all_key` = :location_key",
      {
        replacements: { location_key: "20220913142318" },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    for (let i = 0; i < loc_ids.length; i++) {
      let stmt2 = await invtDB.query(
        "SELECT `location_key`,`loc_name` FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: loc_ids[i] },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      stmt2.forEach((element) => {
        locations.push({ id: element.location_key, text: element.loc_name });
      });

      if (i == loc_ids.length - 1) {
        return res.json({
          status: "success",
          success: true,
          message: "Locations fetched successfully",
          data: locations,
        });
      }
    }
  },
);

// FETCH FOR PRINTING MIN
router.post("/getMinTransactionByDate", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({ success: false, status: "error", message: "pick the type firstly.." });
  }

  try {
    let stmt;

    if (req.body.wise === "datewise") {
      const date = moment(req.body.data, "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        `
        SELECT 
          rm_location.*,
          rm_location.insert_date AS inward_date,
          components.c_name,
          components.c_part_no,
          components.c_new_part_no,
          admin_login.user_name
        FROM rm_location
        LEFT JOIN admin_login 
          ON rm_location.insert_by = admin_login.CustID
        LEFT JOIN components 
          ON rm_location.components_id = components.component_key
        LEFT JOIN units 
          ON components.c_uom = units.units_id
        WHERE DATE(rm_location.insert_date) = :date
          AND components.c_is_enabled = 'Y'
          AND rm_location.trans_type IN ('INWARD','TRANSFER')
          AND (
            (rm_location.in_transaction_id IS NOT NULL AND rm_location.in_transaction_id != '--')
            OR
            (rm_location.transfer_transaction_id IS NOT NULL AND rm_location.transfer_transaction_id != '--')
          )
        ORDER BY rm_location.insert_date DESC
        `,
        {
          replacements: { date },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    }

    if (req.body.wise === "minwise") {
      stmt = await invtDB.query(
        `
        SELECT 
          rm_location.*,
          rm_location.insert_date AS inward_date,
          components.c_name,
          components.c_part_no,
          components.c_new_part_no,
          admin_login.user_name
        FROM rm_location
        LEFT JOIN admin_login 
          ON rm_location.insert_by = admin_login.CustID
        LEFT JOIN components 
          ON rm_location.components_id = components.component_key
        LEFT JOIN units 
          ON components.c_uom = units.units_id
        WHERE (
            rm_location.in_transaction_id LIKE CONCAT('%', :trans, '%')
            OR
            rm_location.transfer_transaction_id LIKE CONCAT('%', :trans, '%')
          )
          AND rm_location.trans_type IN ('INWARD','TRANSFER')
          AND components.c_is_enabled = 'Y'
          AND (
            (rm_location.in_transaction_id IS NOT NULL AND rm_location.in_transaction_id != '--')
            OR
            (rm_location.transfer_transaction_id IS NOT NULL AND rm_location.transfer_transaction_id != '--')
          )
        ORDER BY rm_location.insert_date DESC
        `,
        {
          replacements: { trans: req.body.data },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    }

    if (stmt.length > 0) {
      let final_data = [];
      stmt.map(async (item) => {
        let invoiceStatus = false,
          consumptionStatus = false;
        let checkInvoices = await invtDB.query("SELECT * FROM ims_min_invoices WHERE min_min_id = :txn", {
          replacements: { txn: item.in_transaction_id },
          type: invtDB.QueryTypes.SELECT,
        });
        if (checkInvoices.length > 0) {
          invoiceStatus = true;
        }

        let checkConsumption = await invtDB.query("SELECT trans_type FROM rm_location WHERE in_transaction_id = :txn AND trans_type = 'SFG-CONSUMPTION'", {
          replacements: { txn: item.in_transaction_id },
          type: invtDB.QueryTypes.SELECT,
        });
        if (checkConsumption.length > 0) {
          consumptionStatus = true;
        }
        let stmt0 = await invtDB.query("SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ", {
          replacements: { location: item.loc_in },
          type: invtDB.QueryTypes.SELECT,
        });

        let location = "--";
        if (stmt0.length > 0) {
          location = stmt0[0].loc_name;
        } else {
          location = "N/A";
        }

        let vendorname = "--";
        if (item.in_vendor_name !== "" && item.in_vendor_name !== null && item.vendor_name !== 0) {
          let stmt1 = await invtDB.query("SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendorname", {
            replacements: { vendorname: item.in_vendor_name },
            type: invtDB.QueryTypes.SELECT,
          });

          if (stmt1.length > 0) {
            vendorname = stmt1[0].ven_name;
          } else {
            vendorname = "--";
          }
        } else {
          vendorname = "--";
        }

        let invoice = "--";
        if (item.in_po_invoice_id !== "--") {
          invoice = item.in_po_invoice_id;
        } else {
          invoice = item.in_invoice_id;
        }

        final_data.push({
          datetime: moment(item.inward_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
          partcode: item.c_part_no,
          cat_part: item.c_new_part_no,
          transaction: item.in_transaction_id !== "--" ? item.in_transaction_id : item.transfer_transaction_id,
          print_id: item.in_transaction_id !== "--" ? item.in_transaction_id : item.transfer_transaction_id,
          vendorname: vendorname,
          inqty: helper.number(item.qty) + helper.number(item.other_qty),
          invoice: invoice,
          location: location,
          inby: item.user_name,
          invoiceStatus: invoiceStatus,
          consumptionStatus: consumptionStatus,
        });

        if (stmt.length == final_data.length) {
          return res.json({ success: true, status: "success", message: "Sucess", data: final_data });
        }
      });
    } else {
      return res.json({ success: false, status: "error", message: "could not find the transaction the date you have supplied OR already cancelled" });
    }
  } catch (err) {
    console.log(err);
    return helper.errorResponse(res, err);
  }
});

// FETCH MIN DETAILS
router.post("/fetchMINData", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    min_transaction: "required",
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
  try {
    let stmt1 = await invtDB.query(
      "SELECT *, `rm_location`.`ID` AS `InID` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `location_main` ON `rm_location`.`loc_in` = `location_main`.`location_key` LEFT JOIN `ven_basic_detail` ON `rm_location`.`in_vendor_name` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `ven_address_detail` ON `rm_location`.`in_vendor_branch` = `ven_address_detail`.`ven_address_id` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` WHERE `rm_location`.`in_transaction_id` = :transaction AND `rm_location`.`trans_type` = 'INWARD' AND components.c_is_enabled = 'Y'",
      {
        replacements: {
          transaction: req.body.min_transaction,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );
    if (stmt1.length > 0) {
      let data = [],
        serial_no = 1;

      stmt1.map(async (item) => {
        let gsttype, gstrate, hsncode;
        if (item.in_gst_type == "L") {
          gsttype = "Local";
        } else if (item.in_gst_type == "I") {
          gsttype = "Interstate";
        } else {
          gsttype = "N/A";
        }

        if (
          item.in_gst_rate !== "--" &&
          item.in_gst_rate !== "" &&
          item.in_gst_rate !== "0"
        ) {
          gstrate = item.in_gst_rate + "%";
        } else {
          gstrate = "N/A";
        }

        if (item.in_hsn_code !== "--") {
          hsncode = item.in_hsn_code;
        } else {
          hsncode = "N/A";
        }

        data.push({
          serial_no: serial_no,
          hsncode: hsncode,
          gsttype: gsttype,
          gstrate: gstrate,
          componentKey: item.components_id,
          componentName: item.c_name,
          uom: item.units_name,
          location: item.loc_name,
          po_transaction_id: item.in_po_transaction_id,
          invoice_id:
            item.in_invoice_id == "--"
              ? item.in_po_invoice_id
              : item.in_invoice_id,
          remark: item.any_remark,
          partno: item.c_part_no,
          key: Buffer.from(item.InID.toString()).toString("base64"),
          inward_qty: parseInt(item.qty) + parseInt(item.other_qty),
          min_date: moment(item.insert_date)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY HH:mm:ss"),
        });
        serial_no++;

        if (stmt1.length == data.length) {
          res.json({
            data: data,
            header: {
              insert_by: item.user_name + " (" + item.CustID + ")",
              transaction: item.in_transaction_id,
              insert_by_useremail: item.Email_ID,
              insert_by_usermobile: item.Mobile_No,
            },
            status: "success",
            success: true,
          });
          return;
        }
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "no any MIN found to related your post request",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// INSERT REJECTION OUT
router.post("/updateMIN", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    min_transaction: "required",
    branch: "required",
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

  // Disabled Feature wef Nov 29, 2024
  return res.json({
    status: "error",
    success: false,
    message:
      "This feature is disabled as of Nov 29, 2024 for security reasons, please contact your system administrator for updates",
  });

  let component_length = req.body.component.length;
  for (let i = 0; i < component_length; i++) {
    let itemValidation = new Validator(
      {
        component: req.body.component[i],
        invoice: req.body.invoice[i],
      },
      {
        component: "required",
        invoice: "required",
      },
    );
    if (itemValidation.fails()) {
      res.json({
        status: "error",
        success: false,
        message: "Validation error",
        data: itemValidation.errors.all(),
      });
      return;
    }
  }

  const t = await invtDB.transaction();

  try {
    for (let i = 0; i < component_length; i++) {
      if (req.body.invoice[i] !== "") {
        let stmt1 = await invtDB.query(
          "SELECT * FROM `rm_location` WHERE `components_id` = :component AND `in_transaction_id` = :min_txn AND `trans_type` = 'INWARD' AND `ID` = :key",
          {
            replacements: {
              component: req.body.component[i],
              min_txn: req.body.min_transaction,
              key: Buffer.from(req.body.key[i], "base64").toString("ascii"),
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );
        if (stmt1.length > 0) {
          if (
            moment(Date.now() - 10 * 24 * 3600 * 1000).format("YYYY-MM-DD") >
            stmt1[0].insert_date
          ) {
            // 10 days
            t.rollback();
            return res.json({
              status: "error",
              success: false,
              message: "You can't update MIN after 10 days",
            });
          } else {
            if (stmt1[0].vbp_status == "Y") {
              t.rollback();
              return res.json({
                message:
                  "You can't update MIN because this component is already used in VBP (Vendor Bill Posting)\nto update the same pls contact to the finance department first..",
                status: "error",
                success: false,
              });
            }
            if (stmt1[0].in_po_transaction_id !== "--") {
              let stmt2 = await invtDB.query(
                "UPDATE `rm_location` SET `in_po_invoice_id` = :invoice , `any_remark` = :remark, `update_by` = :updateby, `update_date` = :updatedate WHERE `components_id` = :component AND `in_transaction_id` = :min_txn AND `trans_type` = 'INWARD' AND `ID` = :key",
                {
                  replacements: {
                    invoice: req.body.invoice[i],
                    component: req.body.component[i],
                    min_txn: req.body.min_transaction,
                    key: Buffer.from(req.body.key[i], "base64").toString(
                      "ascii",
                    ),
                    remark: req.body.remark[i],
                    updateby: req.logedINUser,
                    updatedate: moment()
                      .tz("Asia/Kolkata")
                      .format("YYYY-MM-DD HH:mm:ss"),
                  },
                  type: invtDB.QueryTypes.UPDATE,
                  transaction: t,
                },
              );
            } else {
              let stmt2 = await invtDB.query(
                "UPDATE `rm_location` SET `in_invoice_id` = :invoice, `any_remark` = :remark, `update_by` = :updateby, `update_date` = :updatedate WHERE `components_id` = :component AND `in_transaction_id` = :min_txn AND `trans_type` = 'INWARD' AND `ID` = :key",
                {
                  replacements: {
                    invoice: req.body.invoice[i],
                    component: req.body.component[i],
                    min_txn: req.body.min_transaction,
                    key: Buffer.from(req.body.key[i], "base64").toString(
                      "ascii",
                    ),
                    remark: req.body.remark[i],
                    updateby: req.logedINUser,
                    updatedate: moment()
                      .tz("Asia/Kolkata")
                      .format("YYYY-MM-DD HH:mm:ss"),
                  },
                  type: invtDB.QueryTypes.UPDATE,
                  transaction: t,
                },
              );
            }
            if (i == component_length - 1) {
              t.commit();
              return res.json({
                status: "success",
                success: true,
                message: "MIN Updated Successfully",
              });
            }
          }
        } else {
          t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "getting some misconfiguration issue's while executing your request for MIN Update",
          });
        }
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH View Approval Status
router.post("/viewApprovalStatus", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      date: "required",
      user: "required",
    });

    if (validation.fails()) {
      res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    let stmt = await invtDB.query(
      "SELECT *, COUNT(`ID`) AS `totalROW` FROM `material_request` WHERE `inserted_by` = :user AND DATE_FORMAT(`insert_date`,'%Y-%m-%d') = :date GROUP BY `transaction_id` ORDER BY `material_request`.`ID` DESC",
      {
        replacements: {
          user: req.body.user,
          date: moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD"),
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        let location = "N/A";
        let stmt_loc = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
          {
            replacements: { location: stmt[i].location_id },
            type: invtDB.QueryTypes.SELECT,
          },
        );
        if (stmt_loc.length > 0) {
          location = stmt_loc[0].loc_name;
        }

        final.push({
          location: location,
          transaction: stmt[i].transaction_id,
          datetime: moment(
            stmt[i].insert_full_date,
            "YYYY-MM-DD HH:mm:ss",
          ).format("DD-MM-YYYY HH:mm:ss"),
          totalrm: stmt[i].totalROW,
        });
      }
      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: final,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message:
          "could not find the pending request raised through your account..",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH Fetch All Component Status
router.post(
  "/fetchAllComponentStatus",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        transactionid: "required",
      });

      if (validation.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: helper.firstErrorValidatorjs(validation),
        });
      }

      let stmt = await invtDB.query(
        "SELECT * FROM `material_request` LEFT JOIN `components` ON `components`.`component_key` = `material_request`.`components_key` WHERE `material_request`.`transaction_id` = :transaction ORDER BY `components`.`c_name` ASC",
        {
          replacements: { transaction: req.body.transactionid },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt.length > 0) {
        let final = [];

        for (let i = 0; i < stmt.length; i++) {
          let component_name = stmt[i].c_name;
          let status = "";
          let executeqty = "";

          let stmt0 = await invtDB.query(
            "SELECT COALESCE(SUM(`qty`),0) AS `qty` FROM `rm_location` WHERE `components_id` = :component AND `out_transaction_id` = :approve_txn",
            {
              replacements: {
                approve_txn: stmt[i].approval_transaction,
                component: stmt[i].components_key,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          if (
            stmt[i].transaction_type == "OA" &&
            stmt[i].approval_transaction !== "--"
          ) {
            status = "APPROVED";
            executeqty = stmt0[0].qty;
          } else if (
            stmt[i].transaction_type == "O" &&
            stmt[i].approval_transaction == "--"
          ) {
            status = "PENDING";
            executeqty = "--";
          } else if (
            stmt[i].transaction_type == "C" &&
            stmt[i].approval_transaction == "--"
          ) {
            status = "CANCELLED";
            executeqty = "0";
          } else {
            status = "FETCHING";
            executeqty = "--";
          }

          final.push({
            components: component_name,
            partcode: stmt[i].c_part_no,
            reqqty: stmt[i].req_debit,
            executeqty: executeqty,
            status: status,
            remark_issue: stmt[i].comment == "" ? "--" : stmt[i].comment,
            remark_cancel:
              stmt[i].rej_comment == "" ? "--" : stmt[i].rej_comment,
            approve_txn_id: stmt[i].approval_transaction,
          });
        }

        return res.json({
          status: "success",
          success: true,
          message: "Data fetched successfully",
          data: final,
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "not a valid transaction..",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  },
);
// FETCH MIN FROM COMPONENT KEY
router.post("/fetchMINSWithComponentKey", async (req, res) => {
  try {
    if (!req.body.components_id) {
      return res.json({
        status: "error",
        success: false,
        message: "Please provide valid component",
      });
    }
    let stmt_ven = await invtDB.query(
      "select `loc_in`,`in_transaction_id`,`qty`,`any_remark`,rm_location.`insert_date`,`insert_by`,`user_name`,loc_name FROM `rm_location` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` LEFT join location_main ON rm_location.loc_in = location_main.location_key where `rm_location`.components_id = :components_id and trans_type = 'INWARD' ORDER BY rm_location.insert_date DESC limit 5;",
      {
        replacements: {
          components_id: req.body.components_id,
        },

        type: invtDB.QueryTypes.SELECT,
      },
    );
    if (stmt_ven.length > 0) {
      let finals = [];
      for (let i = 0; i < stmt_ven.length; i++) {
        finals.push({
          index: i,
          loc_in: stmt_ven[i].loc_in,
          qty: stmt_ven[i].qty,
          any_remark: stmt_ven[i].any_remark,
          insert_date: stmt_ven[i].insert_date,
          insert_by: stmt_ven[i].insert_by,
          user_name: stmt_ven[i].user_name,
          loc_name: stmt_ven[i].loc_name,
          transactionId: stmt_ven[i].in_transaction_id,
        });
      }
      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: finals,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "no component found",
      });
    }
  } catch (e) {
    return helper.errorResponse(res, e);
  }
});

// GET LOCATION by type
router.post(
  "/refurbish/getLocationInMin",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let stmt = await refbDB.query(
        "SELECT * FROM `location_allotted` WHERE  `loc_all_key` = :location_key",
        {
          replacements: { location_key: "20220212103028" },
          type: refbDB.QueryTypes.SELECT,
        },
      );

      if (stmt.length > 0) {
        loc_options = [];
        stmt.map((item) => {
          str_arr = item.locations.split(",");
          str_arr.map(async (item2) => {
            let stmt2 = await refbDB.query(
              "SELECT location_key,loc_name FROM `location_main` WHERE `location_key` = :location_defined  AND loc_status = 'ACTIVE' ",
              {
                replacements: { location_defined: item2 },
                type: refbDB.QueryTypes.SELECT,
              },
            );

            if (stmt2.length > 0) {
              stmt2.map((item3) => {
                loc_options.push({
                  id: item3.location_key,
                  text: item3.loc_name,
                });
              });
            }
            if (str_arr.length == loc_options.length) {
              return res.json({
                status: "success",
                success: true,
                message: "Data fetched successfully",
                data: loc_options,
              });
            }
          });
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
    return;
  },
);

// MIN - ADD Part code via CSV

const storage1 = multer.diskStorage({
  destination: "tmp",
  filename: function (req, file, cb) {
    cb(
      null,
      "TRY" +
      Date.now() +
      Math.floor(Math.random() * 900 + 100) +
      path.extname(file.originalname),
    );
  },
});

const upload1 = multer({ storage: storage1 });

router.post("/upload/item", upload1.single("file"), async (req, res) => {
  try {
    const expectedColumns = [
      "PART_CODE",
      "MANUAL_MFG_CODE",
      "QTY",
      "RATE",
      "HSN",
      "LOCATION",
      "AUTO_CONSUMP",
      "REMARK",
      "GST_TYPE",
      "GST_RATE",
    ];

    const filePath = req.file.path;

    const workbook = xlsx.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const headers = [];
    const range = xlsx.utils.decode_range(worksheet["!ref"]);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = xlsx.utils.encode_cell({ r: 0, c: col });
      const cell = worksheet[cellAddress];
      headers.push(cell ? cell.v : null);
    }

    const mismatches = headers
      .map((header, index) => {
        if (
          header?.trim().toUpperCase() !== expectedColumns[index].toUpperCase()
        ) {
          return {
            column: `Column ${String.fromCharCode(65 + index)}`,
            actual: header,
            expected: expectedColumns[index],
          };
        }
        return null;
      })
      .filter(Boolean);

    if (mismatches.length > 0) {
      fs.unlinkSync(filePath);
      return res.json({
        status: "error",
        success: false,
        message: "Excel column validation failed.",
        mismatches,
      });
    }

    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    const data = rows.slice(1);

    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      const rowNumber = rowIndex + 2;

      const qty = Number(row[2]);
      if (isNaN(qty) || qty <= 0) {
        return res.json({
          status: "error",
          success: false,
          message: `Excel column validation failed\nQTY must be a non-zero number at row number [${rowNumber}]`,
        });
      }

      const hsn = row[4];
      if (
        hsn !== "--" &&
        (![6, 8].includes(String(hsn).length) || isNaN(hsn))
      ) {
        return res.json({
          status: "error",
          success: false,
          message: `Excel column validation failed\nHSN must be '--', a 6-digit, or an 8-digit number at row number [${rowNumber}]`,
        });
      }

      const autoConsump = row[6];
      if (autoConsump !== 1 && autoConsump !== 0) {
        console.log(autoConsump);
        return res.json({
          status: "error",
          success: false,
          message: `Excel column validation failed\nAUTO_CONSUMP must be '0' or '1' at row number [${rowNumber}]\n(1 for Yes, 0 for No)`,
        });
      }

      const remark = row[7];
      if (remark && remark.length > 100) {
        return res.json({
          status: "error",
          success: false,
          message: `Excel column validation failed\nREMARK length must be less than 100 characters at row number [${rowNumber}]`,
        });
      }

      const gstType = row[8];
      if (gstType !== "LOCAL" && gstType !== "INTER STATE") {
        return res.json({
          status: "error",
          success: false,
          message: `Excel column validation failed\nGST_TYPE must be 'LOCAL' or 'INTER STATE' at row number [${rowNumber}]`,
        });
      }

      row[8] =
        gstType === "LOCAL"
          ? { text: "LOCAL", value: "L" }
          : { text: "INTER STATE", value: "I" };

      const gstRate = row[9];
      if (gstRate < 0 || isNaN(gstRate)) {
        return res.json({
          status: "error",
          success: false,
          message: `Excel column validation failed\nGST_RATE must be a non-zero number at row number [${rowNumber}]`,
        });
      }

      const location = row[5];
      const locationData = await invtDB.query(
        "SELECT `loc_name`, `location_key` FROM `location_main` WHERE `loc_name` = :location",
        {
          replacements: { location },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (!locationData || locationData.length === 0) {
        return res.json({
          status: "error",
          success: false,
          message: `Excel column validation failed\nLOCATION '${location}' does not exist in the database at row number [${rowNumber}]`,
        });
      }

      row[5] = {
        text: locationData[0].loc_name,
        value: locationData[0].location_key,
      };

      const partCode = row[0];
      const partCodeData = await invtDB.query(
        "SELECT `c_name`, `component_key`, `c_part_no` FROM `components` WHERE `c_part_no` = :partcode",
        {
          replacements: { partcode: partCode },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (!partCodeData || partCodeData.length === 0) {
        return res.json({
          status: "error",
          success: false,
          message: `Excel column validation failed\nPART_CODE '${partCode}' does not exist in the database at row number [${rowNumber}]`,
        });
      }

      row[0] = {
        name: partCodeData[0].c_name,
        key: partCodeData[0].component_key,
        partNo: partCodeData[0].c_part_no,
      };
    }

    fs.unlinkSync(filePath);

    const transformedHeaders = headers.map((header) =>
      header.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
    );

    return res.json({
      status: "success",
      success: true,
      message: "Excel file validated successfully.",
      data: { headers: transformedHeaders, rows: data },
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;

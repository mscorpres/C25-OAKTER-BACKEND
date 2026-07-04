const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
let csvToJson = require("convert-csv-to-json");
var html_to_pdf = require("html-pdf-node");
const multer = require("multer");
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");
const { decode } = require("html-entities");
const axios = require("axios");
const FormData = require("form-data");
let { format } = require("timeago.js");

// Use of Multer
var upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callBack) => {
      callBack(null, "./uploads/temp/");
    },
    filename: (req, file, callBack) => {
      callBack(
        null,
        file.fieldname + "-" + Date.now() + path.extname(file.originalname),
      );
    },
  }),
});

checkIfZero = (value) => {
  value = value > 0 ? value : 0;
  return value;
};

// Create Job Work
router.post(
  "/createJobWorkReq",
  [auth.isAuthorized, permission.isPermittedMethod("CREATE")],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      let validation = new Validator(req.body, {
        poType: "required",
        vendor: "required",
        vendorType: "required",

        vendorBranch: "required",
        vendorAddress: "required",

        product: "required",
        bom: "required",
        qty: "required|numeric|min:1",

        rate: "required|numeric|min:0",

        gstType: "required|in:L,I",
        gstRate: "required|numeric",

        hsnCode: "required",

        project: "required",

        costCenter: "required",
        raiseBy: "required",

        pickLocation: "required",
        venJwLocation: "required",

        billingAddressId: "required",
        billingAddress: "required",

        dispatchId: "required",
        dispatchAddress: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          success: false,
          message: "something you missing in form field to supply",
          status: "error",
          data: validation.errors.all(),
        });
      }

      if (req.body.qty <= 0) {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Order qty should be grater than zero!!!",
        });
      }

      if (req.body.costCenter == null) {
        res.json({
          success: false,
          message: "supply the PO cost center",
          status: "error",
        });
        return;
      }
      let getLeaderMails = await otherDB.query(
        `SELECT ims_po_team_leader, leader.Email_ID
       FROM ims_po_team
       LEFT JOIN ${global.ims_db_name}.admin_login leader
       ON leader.CustID = ims_po_team.ims_po_team_leader
       WHERE ims_po_team_member = :raise_by AND po_cost_center = :cost_center`,
        {
          replacements: {
            raise_by: req.body.raiseBy,
            cost_center: req.body.costCenter,
          },
          type: otherDB.QueryTypes.SELECT,
        },
      );

      if (getLeaderMails.length === 0) {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message:
            "'JW Raise By' user is not assigned to any team for the cost center to raise Job Work PO",
        });
      }

      let stmt_check = await invtDB.query(
        "SELECT `p_sku`,`p_name`,`is_enabled`,`m_sku` FROM `products` WHERE `product_key` = :product_key AND is_enabled = 'Y'",
        {
          replacements: { product_key: req.body.product },
          type: invtDB.QueryTypes.SELECT,
        },
      );
      if (stmt_check.length > 0) {
        let p_sku_code = stmt_check[0].p_sku;
        let m_sku_code = stmt_check[0].m_sku;

        if (stmt_check[0].is_enabled == "N") {
          await transaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: `product skucode [${p_sku_code}] can not be execute bcz it has been disabled for this transaction`,
          });
        } else {
          let stmt_trans_code = await invtDB.query(
            "SELECT * FROM `ims_numbering` WHERE `for_number` = 'CREATE_JW_PO' FOR UPDATE",
            {
              type: invtDB.QueryTypes.SELECT,
              transaction: transaction,
            },
          );
          let jw_txn_no;
          if (stmt_trans_code.length > 0) {
            var suffix = stmt_trans_code[0].suffix;
            suffix = parseInt(suffix) + 1;
            suffix = suffix.toString();
            suffix = suffix.padStart(
              parseInt(stmt_trans_code[0].number_length_limit),
              "0",
            );
            jw_txn_no =
              stmt_trans_code[0].prefix +
              "/" +
              stmt_trans_code[0].session +
              "/" +
              suffix;
          } else {
            let currYear = parseInt(
              new Date().getFullYear().toString().substr(2, 2),
            );
            jw_txn_no = "JWORD/" + currYear + "-" + (currYear + 1) + "/0001";
          }

          let stmt_update = await invtDB.query(
            "UPDATE `ims_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'CREATE_JW_PO'",
            {
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            },
          );
          if (stmt_update.length > 0) {
            let stmt_check_txn = await invtDB.query(
              "SELECT `jw_jw_transaction` FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :transaction_id GROUP BY `jw_jw_transaction` LIMIT 1",
              {
                replacements: { transaction_id: jw_txn_no },
                type: invtDB.QueryTypes.SELECT,
              },
            );
            if (stmt_check_txn.length > 0) {
              await transaction.rollback();
              return res.json({
                success: false,
                status: "error",
                message: `alloting transaction id as [${jw_txn_no}] for JW PO has already exist with us, required manual checking or contact to system administrator.`,
              });
            } else {
              let stmt_bill_add = await invtDB.query(
                "SELECT * FROM `billing_address` WHERE `billing_code` = :code",
                {
                  replacements: { code: req.body.billingAddressId },
                  type: invtDB.QueryTypes.SELECT,
                },
              );
              if (stmt_bill_add.length > 0) {
                let stmt_ship_add = await invtDB.query(
                  "SELECT * FROM `shipment_address` WHERE `shipment_code` = :code",
                  {
                    replacements: { code: req.body.dispatchId },
                    type: invtDB.QueryTypes.SELECT,
                  },
                );
                if (stmt_ship_add.length > 0) {
                  let stmt_vendor = await invtDB.query(
                    "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendorid",
                    {
                      replacements: { vendorid: req.body.vendor },
                    },
                  );
                  if (stmt_vendor.length > 0) {
                    let stmt_insert_jw = await invtDB.query(
                      "INSERT INTO jw_purchase_req (jw_po_remark, jw_raise_by, jw_project_name, jw_cost_center, jw_payment_terms_day, company_branch, jw_po_billing_add_id, jw_po_billing_addr, jw_jw_transaction, jw_po_issue_qty,jw_po_dispatch_addr, jw_po_ship_id,jw_terms_condition,jw_quotation_detail,jw_payment_terms,jw_po_vendor_reg_id,jw_po_vendor_address,jw_po_ven_add_id,jw_po_sku,location, ven_location,jw_po_recipe,jw_po_order_qty,jw_po_order_rate, jw_po_duedate,jw_part_remark,jw_po_insert_by,jw_po_full_date,jw_po_sku_transaction,jw_po_vendor_type, jw_po_hsncode, jw_po_gsttype, jw_po_gstrate, jw_po_sgst, jw_po_cgst, jw_po_igst)VALUES (:poremark, :jw_raise_by,:projectname,:costcenter,:termsdays,:branch,:billingaddrid,:billingaddr,:jwtransaction,'0',:dispatch_address,:dispatch_id,:termscondition,:quoationdetail,:paymentterms,:vendor,:vendor_address,:vendor_branch,:sku, :pick_location, :ven_location,:recipe,:qty,:rate,:duedate,:part_remark,:by,:fulldate,:skutransaction, :vendortype,:hsncode,:gsttype,:gstrate,:sgst,:cgst,:igst)",
                      {
                        replacements: {
                          poremark:
                            req.body.poRemark == "" ? "--" : req.body.poRemark,
                          projectname: req.body.project,
                          costcenter: req.body.costCenter,
                          termsdays:
                            req.body.termsDay == "" ? 30 : req.body.termsDay,
                          branch: req.branch,
                          billingaddrid: req.body.billingAddressId,
                          billingaddr: req.body.billingAddress.replace(
                            /\n/g,
                            "<br>",
                          ),
                          termscondition: req.body.termsCondition,
                          quoationdetail: req.body.quotationDetail,
                          paymentterms: req.body.paymentTerms,
                          vendor: req.body.vendor,
                          vendor_address: req.body.vendorAddress,
                          vendor_branch: req.body.vendorBranch,
                          sku: req.body.product,
                          recipe: req.body.bom,
                          rate: req.body.rate,
                          duedate: req.body.dueDate,
                          part_remark: req.body.partRemark,
                          qty: req.body.qty,
                          by: req.logedINUser,
                          fulldate: moment(new Date())
                            .tz("Asia/Kolkata")
                            .format("YYYY-MM-DD HH:mm:ss"),
                          skutransaction: jw_txn_no,
                          pick_location: req.body.pickLocation,
                          ven_location: req.body.venJwLocation,
                          jwtransaction: jw_txn_no,
                          vendortype: req.body.vendorType,
                          hsncode: req.body.hsnCode,
                          gsttype: req.body.gstType,
                          gstrate: req.body.gstRate,
                          sgst: `${
                            helper.gstCalculation(
                              req.body.gstRate,
                              req.body.rate * req.body.qty,
                              req.body.gstType,
                            ).sgst
                          }`,
                          cgst: `${
                            helper.gstCalculation(
                              req.body.gstRate,
                              req.body.rate * req.body.qty,
                              req.body.gstType,
                            ).cgst
                          }`,
                          igst: `${
                            helper.gstCalculation(
                              req.body.gstRate,
                              req.body.rate * req.body.qty,
                              req.body.gstType,
                            ).igst
                          }`,
                          dispatch_address: req.body.dispatchAddress.replace(
                            /\n/g,
                            "<br>",
                          ),
                          dispatch_id: req.body.dispatchId,
                          jw_raise_by: req.body.raiseBy ?? "--",
                        },
                        type: invtDB.QueryTypes.INSERT,
                        transaction: transaction,
                      },
                    );
                    if (stmt_insert_jw.length > 0) {
                      await transaction.commit();
                      return res.json({
                        success: true,
                        status: "success",
                        message: `Jobwork PO created successfully.\nTransaction ref ID. [${jw_txn_no}]`,
                      });
                    }
                  } else {
                    await transaction.rollback();
                    return res.json({
                      success: false,
                      status: "error",
                      message: "vendor is not registered yet",
                    });
                  }
                } else {
                  await transaction.rollback();
                  return res.json({
                    success: false,
                    status: "error",
                    message: "shipment address is not valid",
                  });
                }
              } else {
                await transaction.rollback();
                return res.json({
                  success: false,
                  status: "error",
                  message: "billing address is not valid",
                });
              }
            }
          } else {
            await transaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message:
                "an operation for updation in transaction has failed, while creating JW..",
            });
          }
        }
      } else {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message:
            "some product can not be operate bcz of might be it disabled for transaction or does not exist with us",
        });
      }
    } catch (err) {
      console.log(err);
      await transaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message:
          "an error occurred while creating Job Work PO.\nPlease contact to system administrator.",
        error: err.stack,
      });
    }
  },
);

// UPLOAD VENDOR PRICING
// router.post("/uploadVendorPricing", upload.single("uploadfile"), [auth.isAuthorized], async (req, res) => {
//   try {
//     const file_path = "./uploads/" + req.file.filename;
//     let json_data = csvToJson.fieldDelimiter(",").getJsonFromCsv(file_path);

//     const transaction = await invtDB.transaction();

//     if (req.query.stage === "1") {
//       fs.unlinkSync(file_path);
//       let data = [];
//       let c_part_name;
//       json_data.map(async (item) => {
//         let stmt1 = await invtDB.query("SELECT `c_name` FROM `components` WHERE `c_part_no` = :part_code", { replacements: { part_code: item.PART_CODE }, type: invtDB.QueryTypes.SELECT });
//         if (stmt1.length > 0) {
//           c_part_name = decode(stmt1[0].c_name);
//         } else {
//           return res.json({ message: "part code not valid ( " + item.PART_CODE + " )", status: "error", success: false });
//         }
//         data.push({ VENDOR_CODE: item.VENDOR_CODE, PART_CODE: item.PART_CODE, PART_NAME: c_part_name, RATE: item.RATE });
//         if (data.length == json_data.length) {
//           return res.json({ data: { data }});
//         }
//       });
//     } else if (req.query.stage === "2") {
//       let count = 0;
//       json_data.map(async (item) => {
//         let stmt1 = await invtDB.query("SELECT `component_key` FROM `components` WHERE `c_part_no` = :part_code", { replacements: { part_code: item.PART_CODE }, type: invtDB.QueryTypes.SELECT });
//         if (stmt1.length > 0) {
//           for (const data of stmt1) {
//             let stmt2 = await invtDB.query("INSERT INTO `jw_vendor_pricing` (`jwvp_vendor`, `jwvp_rate`, `jwvp_partcode`, `jwvp_insert_dt`, `jwvp_insert_by`) VALUES ( :vendor, :rate, :part, :insert_dt, :insert_by)", {
//               replacements: {
//                 vendor: item.VENDOR_CODE,
//                 rate: item.RATE,
//                 part: data.component_key,
//                 insert_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
//                 insert_by: req.logedINUser,
//               },
//               type: invtDB.QueryTypes.INSERT,
//               transaction: transaction,
//             });
//           }
//           count++;
//           if (count == json_data.length) {
//             await transaction.commit();
//             fs.unlinkSync(file_path);
//             return res.json({ status: "success", success: true, message: "file uploaded successfully.." });
//           }
//         } else {
//           fs.unlinkSync(file_path);
//           await transaction.rollback();
//           return res.json({ status: "error", success: false, message: "part code: (" + item.PART_CODE + ") does not exist" });
//         }
//       });
//     } else {
//       return res.json({ message: "an error while executing request from client ends.", status: "error", success: false });
//     }
//   } catch (err) {
//     return res.json({ message: "Internal Error<br/>If this condition persists, contact your system administrator", status: "error", success: false });
//   }
// });

// Fetch Product Data4Table
router.get("/fetchProductData4Table", [auth.isAuthorized], async (req, res) => {
  const { key } = req.query;
  if (!key)
    return res.json({
      success: false,
      message: "Something you are missing in form field to supply",
      status: "error",
    });
  try {
    let stmt = await invtDB.query(
      "SELECT products.p_hsncode, products.p_gst_rate_tax, units.units_name, bom_recipe.subject_name, bom_recipe.subject_id FROM `products` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN bom_recipe ON bom_recipe.bom_product_sku = products.p_sku WHERE `products`.`product_key` = :key AND bom_recipe.bom_status = 'ENABLE'",
      {
        replacements: { key: key },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (stmt.length > 0) {
      const bom = stmt
        .filter((r) => r.subject_id !== null)
        .map((r) => ({
          name: r.subject_name,
          key: r.subject_id,
        }));

      let final = {
        unit: stmt[0].units_name.toUpperCase(),
        hsn: stmt[0].p_hsncode,
        gstRate: stmt[0].p_gst_rate_tax,
        rate: "",
        bom: bom,
      };

      return res.json({ success: true, status: "success", data: final });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "Product not found",
      });
    }
  } catch (err) {
    console.log(
      "*************************************** this is the error",
      err,
    );
  }
});

// FETCH JOBWORK ID

router.post("/jw_analysis", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      wise: "required",
      data: "required",
    });
    if (validation.fails()) {
      res.json({
        message: "Something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
        success: false,
      });
    }
    const { wise, data, advanced = false, dateRange = null } = req.body;

    let stmt;
    let replacements = { session: req.session };

    // Original filters
    if (!advanced) {
      if (wise === "datewise") {
        const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
        const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
        const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
        replacements.date1 = date1;
        replacements.date2 = date2;

        stmt = await invtDB.query(
          "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `project_master` ON `jw_purchase_req`.`jw_project_name` = `project_master`.`project_name` WHERE DATE_FORMAT(`jw_purchase_req`.`jw_po_full_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `jw_purchase_req`.`jw_po_status` = 'A' AND jw_purchase_req.txn_session = :session ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
          {
            replacements,
            type: invtDB.QueryTypes.SELECT,
          },
        );
      } else if (wise === "jw_transaction_wise") {
        replacements.jw_id = data;
        stmt = await invtDB.query(
          "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `project_master` ON `jw_purchase_req`.`jw_project_name` = `project_master`.`project_name` WHERE `jw_purchase_req`.`jw_jw_transaction` LIKE CONCAT('%', :jw_id, '%') AND `jw_purchase_req`.`jw_po_status` = 'A' AND jw_purchase_req.txn_session = :session ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
          {
            replacements,
            type: invtDB.QueryTypes.SELECT,
          },
        );
      } else if (wise === "vendorwise") {
        replacements.venid = data;
        stmt = await invtDB.query(
          "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `project_master` ON `jw_purchase_req`.`jw_project_name` = `project_master`.`project_name` WHERE `jw_po_vendor_reg_id` = :venid AND `jw_purchase_req`.`jw_po_status` = 'A' AND jw_purchase_req.txn_session = :session ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
          {
            replacements,
            type: invtDB.QueryTypes.SELECT,
          },
        );
      } else if (wise === "jw_sfg_wise") {
        replacements.sfgcode = data;
        stmt = await invtDB.query(
          "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `project_master` ON `jw_purchase_req`.`jw_project_name` = `project_master`.`project_name` WHERE `jw_po_sku` = :sfgcode AND `jw_purchase_req`.`jw_po_status` = 'A' AND jw_purchase_req.txn_session = :session ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
          {
            replacements,
            type: invtDB.QueryTypes.SELECT,
          },
        );
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "Please select valid filter method",
        });
      }
    }
    // Advanced filters
    else {
      if (!dateRange || !dateRange.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g)) {
        return res.json({
          success: false,
          status: "error",
          message: "Invalid or missing date range for advanced filter",
        });
      }

      const date = dateRange.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      replacements.date1 = date1;
      replacements.date2 = date2;

      let baseQuery =
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `project_master` ON `jw_purchase_req`.`jw_project_name` = `project_master`.`project_name` WHERE DATE_FORMAT(`jw_purchase_req`.`jw_po_full_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `jw_purchase_req`.`jw_po_status` = 'A' AND jw_purchase_req.txn_session = :session";

      if (wise === "vendorwise") {
        baseQuery += " AND `jw_po_vendor_reg_id` = :venid";
        replacements.venid = data;
      } else if (wise === "jw_sfg_wise") {
        baseQuery += " AND `jw_po_sku` = :sfgcode";
        replacements.sfgcode = data;
      } else if (wise === "jw_transaction_wise") {
        baseQuery += " AND `jw_jw_transaction` LIKE CONCAT('%', :jw_id, '%')";
        replacements.jw_id = data;
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "Please select valid filter method for advanced filter",
        });
      }

      baseQuery += " ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC";

      stmt = await invtDB.query(baseQuery, {
        replacements,
        type: invtDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          date: moment(stmt[i].jw_po_full_date, "YYYY-MM-DD HH:mm:ss").format(
            "DD-MM-YYYY HH:mm:ss",
          ),
          jwid: stmt[i].jw_jw_transaction,
          po_sku_transaction: stmt[i].jw_po_sku_transaction,
          vendor: stmt[i].ven_name + "( " + stmt[i].jw_po_vendor_reg_id + " )",
          skucode: stmt[i].p_sku,
          skuname: stmt[i].p_name,
          sku: stmt[i].jw_po_sku,
          requiredqty:
            stmt[i].jw_po_order_qty + " / " + stmt[i].jw_po_issue_qty,
          bom_recipe: stmt[i].jw_po_bom_recipe,
          po_status: stmt[i].jw_po_status,
          po_bom_recipe: stmt[i].jw_po_bom_recipe,
          project_name: stmt[i].project_name || "--",
          project_description: stmt[i].project_description || "--",
        });
      }
      return res.json({ success: true, status: "success", data: final });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "No orders were found that match the given search criteria.",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});
// FETCH JW ANLY FOR COMP UPADATE
router.post("/fetchJwAnlyUpdate", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      jw_transaction: "required",
      po_transaction: "required",
      skucode: "required",
    });
    if (validation.fails()) {
      res.json({
        success: false,
        message: "Something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
    }

    const { jw_transaction, po_transaction, skucode } = req.body;

    let stmt = await invtDB.query(
      "SELECT * FROM `products` WHERE (`product_key` = :sku) AND is_enabled = 'Y' ",
      {
        replacements: { sku: skucode },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (stmt.length > 0) {
      let product_sku = "";
      if (stmt[0].p_sku != "--") {
        product_sku = stmt[0].p_sku;
      } else if (stmt[0].m_sku == "--") {
        product_sku = stmt[0].m_sku;
      } else {
        product_sku = stmt[0].s_sku;
      }

      let stmt_jw_po_rec = await invtDB.query(
        "SELECT `jw_po_recipe` FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :jw_transaction_id AND `jw_po_sku_transaction` = :po_transaction_id",
        {
          replacements: {
            jw_transaction_id: jw_transaction,
            po_transaction_id: po_transaction,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt_jw_po_rec.length > 0) {
        let stmt_jw_po_req = await invtDB.query(
          "SELECT * FROM jw_purchase_req LEFT JOIN bom_quantity ON jw_purchase_req.jw_po_recipe = bom_quantity.subject_under LEFT JOIN products ON bom_quantity.product_sku = products.p_sku OR bom_quantity.product_sku = products.m_sku LEFT JOIN bom_recipe ON bom_quantity.subject_under = bom_recipe.subject_id LEFT JOIN units ON products.p_uom = units.units_id LEFT JOIN admin_login ON jw_purchase_req.jw_po_insert_by = admin_login.CustID LEFT JOIN ven_basic_detail ON jw_purchase_req.jw_po_vendor_reg_id = ven_basic_detail.ven_register_id WHERE bom_quantity.bom_status = 'A' AND jw_purchase_req.jw_jw_transaction = :jw_id AND jw_purchase_req.jw_po_recipe = :subject GROUP BY jw_purchase_req.jw_po_bom_recipe",
          {
            replacements: {
              jw_id: jw_transaction,
              subject: stmt_jw_po_rec[0].jw_po_recipe,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (stmt_jw_po_req.length > 0) {
          let jw_status = "";
          if (
            stmt_jw_po_req[0].jw_po_issue_qty == "0" &&
            stmt_jw_po_req[0].jw_po_status == "A"
          ) {
            jw_status = "Created";
          } else if (
            stmt_jw_po_req[0].jw_po_issue_qty !== "0" &&
            stmt_jw_po_req[0].jw_po_status == "A"
          ) {
            jw_status = "Processing...";
          } else {
            jw_status = "Closed";
          }

          let headers = {
            sku_code: stmt_jw_po_req[0].p_sku,
            product_name: stmt_jw_po_req[0].p_name,
            subject_id: stmt_jw_po_req[0].subject_id,
            subject_name: stmt_jw_po_req[0].subject_name,
            jobwork_sku_id: po_transaction,
            jobwork_id: stmt_jw_po_req[0].jw_jw_transaction,
            registered_date: moment(
              stmt_jw_po_req[0].jw_po_full_date,
              "YYYY-MM-DD HH:mm:ss",
            ).format("DD-MM-YYYY HH:mm:ss "),
            created_by: stmt_jw_po_req[0].user_name,
            ordered_qty:
              stmt_jw_po_req[0].jw_po_order_qty +
              " " +
              stmt_jw_po_req[0].units_name,
            proceed_qty: stmt_jw_po_req[0].jw_po_issue_qty,
            jw_status: jw_status,
            vendor_name: stmt_jw_po_req[0].ven_name,
          };

          let jw_po_req2 = await invtDB.query(
            "SELECT * FROM jw_purchase_req LEFT JOIN bom_quantity ON jw_purchase_req.jw_po_recipe = bom_quantity.subject_under LEFT JOIN components ON bom_quantity.component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE ( jw_purchase_req.jw_po_sku = :product ) AND (bom_quantity.bom_status = 'A' OR bom_quantity.bom_status = 'ALT') AND jw_purchase_req.jw_jw_transaction = :jw_transaction AND jw_purchase_req.jw_po_sku_transaction = :po_sku_transaction ORDER BY components.c_part_no ASC",
            {
              replacements: {
                product: skucode,
                jw_transaction: jw_transaction,
                po_sku_transaction: po_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          if (jw_po_req2.length > 0) {
            let final = [];

            for (let i = 0; i < jw_po_req2.length; i++) {
              let alt_components = [];

              if (jw_po_req2[i].bom_status == "ALT") {
                const stmt_alt_comp = await invtDB.query(
                  `SELECT components.c_part_no, components.c_new_part_no, components.c_name, components.component_key 
       FROM alternative_components 
       LEFT JOIN components ON components.component_key = alternative_components.alt_daughter_component 
       WHERE alt_mother_component = :mother_component_key AND alt_subject = :subject`,
                  {
                    replacements: {
                      mother_component_key: jw_po_req2[i].component_key,
                      subject: jw_po_req2[i].jw_po_recipe,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  },
                );

                if (stmt_alt_comp.length > 0) {
                  alt_components = stmt_alt_comp.map((row) => ({
                    alt_component_part: row.c_part_no,
                    alt_component_key: row.component_key,
                    alt_component_name: decode(row.c_name),
                  }));
                } else {
                  alt_components = [
                    {
                      alt_component_part: "N/A",
                      alt_component_key: "N/A",
                      alt_component_name: "N/A",
                    },
                  ];
                }
              } else {
                alt_components = [
                  {
                    alt_component_part: "N/A",
                    alt_component_key: "N/A",
                    alt_component_name: "N/A",
                  },
                ];
              }

              final.push({
                component_name: jw_po_req2[i].c_name,
                component_key: jw_po_req2[i].component_key,
                part_code: jw_po_req2[i].c_part_no,
                bom_req_qty: jw_po_req2[i].qty,
                uom: jw_po_req2[i].units_name,
                rate: 0,
                part_status:
                  jw_po_req2[i].bom_status == "A"
                    ? "Active"
                    : jw_po_req2[i].bom_status == "ALT"
                      ? "Alternate"
                      : "Inactive",
                part_alt: alt_components,
              });
            }

            return res.json({
              success: true,
              status: "success",
              data: {
                header: headers,
                body: final,
              },
            });
          } else {
            return res.json({
              success: false,
              status: "error",
              message: "BOM not found for the selected SKU",
            });
          }
        } else {
          return res.json({
            success: false,
            status: "error",
            message: "could not found any mapped recipe to with jobwork",
          });
        }
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "could not found any mapped recipe to with jobwork",
        });
      }
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "not a valid SKU supplied",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// UPDATE JW ANALY FOR COMP
router.post(
  "/updateJwAnlyComp",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      let validation = new Validator(req.body, {
        trans_id: "required",
        sku_trans_id: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          success: false,
          message: "Something you missing in form field to supply",
          data: validation.errors.all(),
          status: "error",
        });
      }

      let comp_length = req.body.component.length;
      let qty_length = req.body.qty.length;

      if (comp_length !== qty_length) {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Invalid Data",
        });
      }

      for (let i = 0; i < comp_length; i++) {
        let valid = new Validator(
          {
            component: req.body.component[i],
            qty: req.body.qty[i],
            rate: req.body.rate[i],
          },
          {
            component: "required",
            qty: "required",
            rate: "required",
          },
        );

        if (valid.fails()) {
          await transaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: valid.errors.all(),
          });
        }

        if (helper.number(req.body.qty[i]) <= 0) {
          await transaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "Invalid Quantity",
          });
        }
      }

      let stmt_jw_pur_req = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :jobwork_id AND `jw_po_sku_transaction` = :jb_sku_trans_id",
        {
          replacements: {
            jobwork_id: req.body.trans_id,
            jb_sku_trans_id: req.body.sku_trans_id,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt_jw_pur_req.length > 0) {
        const productkey = stmt_jw_pur_req[0].jw_po_sku;

        if (stmt_jw_pur_req[0].jw_po_bom_recipe == "CREATED") {
          await transaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: {
              message:
                "we are unable to perform the action bcz it seems you have already created the material recipe.",
            },
          });
        }

        let stmt_tranid = await invtDB.query(
          "SELECT `jw_bom_create_trans` FROM `jw_bom_recipe` GROUP BY `jw_bom_create_trans` ORDER BY ID DESC LIMIT 1",
          { type: invtDB.QueryTypes.SELECT },
        );

        let bom_trans_id = "BMID0001";
        if (stmt_tranid.length > 0) {
          let arr = stmt_tranid[0].jw_bom_create_trans.split(
            /(?<=[A-Za-z])(?=[0-9]+)/i,
          );
          let str = arr[0];
          let num = parseInt(arr[1]);
          bom_trans_id = str + String(num + 1).padStart(4, "0");
        }

        for (let i = 0; i < comp_length; i++) {
          let stmt_check_jw_pur = await invtDB.query(
            "SELECT * FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :jobwork_id AND `jw_po_sku_transaction` = :po_jw_transaction AND `company_branch` = :branch",
            {
              replacements: {
                jobwork_id: req.body.trans_id,
                po_jw_transaction: req.body.sku_trans_id,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          if (
            stmt_check_jw_pur.length == 0 ||
            stmt_check_jw_pur[0].jw_po_status == "C"
          ) {
            await transaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message:
                "Jobwork transaction is either closed, on hold, or not found.",
            });
          }

          let bom_recipe = stmt_check_jw_pur[0].jw_po_recipe;
          let product_sku = stmt_check_jw_pur[0].jw_po_sku;

          let stmt2 = await invtDB.query(
            "SELECT * FROM `bom_quantity` WHERE `subject_under` = :subject AND `component_id` = :component_key",
            {
              replacements: {
                subject: bom_recipe,
                component_key: req.body.component[i],
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          if (stmt2.length == 0) {
            await transaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message: "Component not found in original master BOM. ",
            });
          }

          let stmt3 = await invtDB.query(
            "SELECT * FROM `jw_bom_recipe` WHERE `jw_bom_sku`  = :sku AND `jw_bom_po_trans` = :jw_transaction AND `jw_bom_part` = :component_key AND `company_branch` = :branch",
            {
              replacements: {
                sku: product_sku,
                jw_transaction: req.body.trans_id,
                component_key: req.body.component[i],
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          if (stmt3.length > 0) {
            await transaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message: `Duplicate component found in recipe at line ${i + 1}. Component Key: ${req.body.component[i]}`,
            });
          }

          let altArray = [];
          if (
            req.body.part_alt &&
            req.body.part_alt[req.body.component[i]] &&
            Array.isArray(req.body.part_alt[req.body.component[i]])
          ) {
            altArray = req.body.part_alt[req.body.component[i]];
          }

          const alt_part = altArray.length > 0 ? altArray.join(",") : "--";
          const part_status = altArray.length > 0 ? "ALT" : "ACTIVE";

          let stmt_insert = await invtDB.query(
            "INSERT INTO `jw_bom_recipe` (`jw_bom_rate`,`company_branch`,`jw_bom_sku`,`jw_bom_part`,`jw_bom_qty`,`jw_bom_po_trans`,`jw_bom_sku_trans`,`jw_bom_insert_dt`,`jw_bom_insert_by`,`jw_bom_create_trans`, `jw_bom_alt_part`, `jw_bom_part_status`) VALUES (:rate,:branch,:productkey,:component,:qty,:job_id,:job_sku_id,:insert_dt,:insert_by,:transaction,:alt_part,:part_status)",
            {
              replacements: {
                rate: req.body.rate[i],
                branch: req.branch,
                productkey: product_sku,
                component: req.body.component[i],
                qty: req.body.qty[i],
                job_id: req.body.trans_id,
                job_sku_id: req.body.sku_trans_id,
                insert_dt: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
                insert_by: req.logedINUser,
                transaction: bom_trans_id,
                alt_part: alt_part,
                part_status: part_status,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: transaction,
            },
          );

          let stmt_update = await invtDB.query(
            "UPDATE `jw_purchase_req` SET `jw_po_bom_recipe` = 'CREATED' WHERE `jw_jw_transaction` = :jobwork_id AND `jw_po_sku_transaction` = :jb_sku_trans_id AND `jw_po_bom_recipe` = 'PENDING'",
            {
              replacements: {
                jobwork_id: req.body.trans_id,
                jb_sku_trans_id: req.body.sku_trans_id,
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            },
          );

          if (stmt_update.length == 0) {
            await transaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message: "Error updating BOM status in purchase request.",
            });
          }
        }

        await transaction.commit();
        return res.json({
          success: true,
          status: "success",
          message: "BOM recipe created successfully.",
        });
      } else {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Transaction not found.",
        });
      }
    } catch (err) {
      await transaction.rollback();
      return helper.errorResponse(res, err);
    }
  },
);

//TABLE ANALYSIS
// router.post("/fetchTableAnly", [auth.isAuthorized], async (req, res) => {
//   try {
//     let validation = new Validator(req.body, {
//       skucode: "required",
//       jw_transaction: "required",
//       po_transaction: "required",
//     });

//     if (validation.fails()) {
//       return res.json({
//         code: 500,
//         message: { msg: "something you missing in form field to supply" },
//         data: validation.errors.all(),
//         status: "error",
//       });
//     }

//     let stmt_product = await invtDB.query(
//       "SELECT * FROM `products` WHERE (`product_key` = :productkey)",
//       {
//         replacements: { productkey: req.body.skucode },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );
//     if (stmt_product.length > 0) {
//       let product_name = stmt_product[0].p_name;
//       let product_sku;
//       if (stmt_product[0].p_sku != "--") {
//         product_sku = stmt_product[0].p_sku;
//       } else if (stmt_product[0].m_sku != "--") {
//         product_sku = stmt_product[0].m_sku;
//       } else {
//         product_sku = stmt_product[0].s_sku;
//       }

//       let stmt_jwpo_req = await invtDB.query(
//         "SELECT * FROM `jw_purchase_req` LEFT JOIN `jw_bom_recipe` ON `jw_purchase_req`.`jw_po_sku` = `jw_bom_recipe`.`jw_bom_sku` LEFT JOIN `bom_recipe` ON `jw_purchase_req`.`jw_po_recipe` = `bom_recipe`.`subject_id` LEFT JOIN `products` ON `jw_bom_recipe`.`jw_bom_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_bom_recipe`.`jw_bom_sku` = :skucode AND `jw_purchase_req`.`jw_jw_transaction` = :jw_id LIMIT 1",
//         {
//           replacements: {
//             skucode: req.body.skucode,
//             jw_id: req.body.jw_transaction,
//           },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );

//       if (stmt_jwpo_req.length > 0) {
//         let jw_status;
//         let header = [];
//         if (
//           stmt_jwpo_req[0].jw_po_issue_qty == "0" &&
//           stmt_jwpo_req[0].jw_po_status == "A"
//         ) {
//           jw_status = "Created";
//         } else if (
//           stmt_jwpo_req[0].jw_po_issue_qty !== "0" &&
//           stmt_jwpo_req[0].jw_po_status == "A"
//         ) {
//           jw_status = "Processing...";
//         } else {
//           jw_status = "Closed";
//         }

//         header.push({
//           sku_code: stmt_jwpo_req[0].p_sku,
//           product_name: stmt_jwpo_req[0].p_name,
//           subject_id: stmt_jwpo_req[0].subject_id,
//           subject_name: stmt_jwpo_req[0].subject_name,
//           jobwork_id: stmt_jwpo_req[0].jw_jw_transaction,
//           registered_date: moment(
//             stmt_jwpo_req[0].jw_po_full_date,
//             "YYYY-MM-DD HH:mm:ss"
//           ).format("DD-MM-YYYY HH:mm:ss"),
//           created_by: stmt_jwpo_req[0].user_name,
//           ordered_qty:
//             stmt_jwpo_req[0].jw_po_order_qty +
//             " " +
//             stmt_jwpo_req[0].units_name,
//           proceed_qty: stmt_jwpo_req[0].jw_po_issue_qty,
//           jw_status: jw_status,
//           vendor_name: stmt_jwpo_req[0].ven_name,
//         });

//         let stmt_jwpo_req2 = await invtDB.query(
//           "SELECT * FROM `jw_purchase_req` WHERE `jw_po_sku` = :skucode AND `jw_jw_transaction` = :jw_id",
//           {
//             replacements: {
//               skucode: req.body.skucode,
//               jw_id: req.body.jw_transaction,
//             },
//             type: invtDB.QueryTypes.SELECT,
//           }
//         );

//         if (stmt_jwpo_req2.length > 0) {
//           let jw_order_qty = stmt_jwpo_req2[0].jw_po_order_qty;
//           let jw_tran_id = stmt_jwpo_req2[0].jw_jw_transaction;
//           let jw_issue_qty = stmt_jwpo_req2[0].jw_po_issue_qty;

//           let stmt_comp = await invtDB.query(
//             "SELECT * FROM `jw_bom_recipe` LEFT JOIN `components` ON `jw_bom_recipe`.`jw_bom_part` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN bom_quantity ON bom_quantity.component_id = jw_bom_recipe.jw_bom_part AND bom_quantity.subject_under = :bomSubject WHERE `jw_bom_recipe`.`jw_bom_sku` = :skucode AND `jw_bom_recipe`.`jw_bom_po_trans` = :jw_id ORDER BY `components`.`c_part_no` ASC",
//             {
//               replacements: {
//                 bomSubject: stmt_jwpo_req[0].jw_po_recipe,
//                 skucode: req.body.skucode,
//                 jw_id: req.body.jw_transaction,
//               },
//               type: invtDB.QueryTypes.SELECT,
//             }
//           );

//           if (stmt_comp.length > 0) {
//             let final = [];
//             for (let i = 0; i < stmt_comp.length; i++) {
//               let bom_status;
//               if (stmt_comp[i].bom_status == "A") {
//                 bom_status =
//                   'ACTIVE';
//               } else if (stmt_comp[i].bom_status == "ALT") {
//                 bom_status =
//                   'ALTERNATIVE';
//               } else {
//                 bom_status =
//                   'INACTIVE';
//               }

//               //FETCH ALTERNATIVE PART CODES
//               let alt_component_part = [];
//               let alt_component_name = [];
//               console.log("===========================");
//               let checkAlt = await invtDB.query(
//                 "SELECT * FROM `alternative_components` WHERE `alt_mother_component` = :component AND `alt_subject` = :subject AND `alt_product_sku` = :product AND `alt_type` = 'default'",
//                 {
//                   replacements: {
//                     component: stmt_comp[i].component_id,
//                     subject: stmt_jwpo_req[0].jw_po_recipe,
//                     product: product_sku,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );

//               if (checkAlt.length > 0) {
//                 if (stmt_comp[i].bom_status == "ALT") {
//                   console.log("====", checkAlt[0].bom_status, "====", checkAlt[0].alt_daughter_component);
//                   let stmt9 = await invtDB.query(
//                     "SELECT c_part_no, c_name FROM `components` WHERE `component_key` = :component",
//                     {
//                       replacements: {
//                         component: checkAlt[0].alt_daughter_component,
//                       },
//                       type: invtDB.QueryTypes.SELECT,
//                     }
//                   );
//                   if (stmt9.length > 0) {
//                     alt_component_part.push(stmt9[0].c_part_no);
//                     alt_component_name.push(decode(stmt9[0].c_name));
//                   } else {
//                     alt_component_part.push("--");
//                     alt_component_name.push("--");
//                   }
//                 } else {
//                   alt_component_part = ["N/A"];
//                   alt_component_name = ["N/A"];
//                 }
//               } else {
//                 alt_component_part = ["N/A"];
//                 alt_component_name = ["N/A"];
//               }

//               console.log(
//                 "ALTERNATIVE PARTS: ",
//                 alt_component_part,
//                 alt_component_name
//               );

//               if (alt_component_name.length == 0) {
//                 alt_component_part = "--";
//                 alt_component_name = "--";
//               }

//               let issue_rate = 0;
//               let stmt_jwbom_req = await invtDB.query(
//                 "SELECT COALESCE(`jw_m_issue_rate`, 0) AS `issue_rate` FROM `jw_material_issue` WHERE `jw_m_sku` = :skucode AND `jw_m_job_id` = :jw_id AND `jw_m_component` = :component_id",
//                 {
//                   replacements: {
//                     skucode: req.body.skucode,
//                     jw_id: req.body.jw_transaction,
//                     component_id: stmt_comp[i].component_key,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );
//               if (stmt_jwbom_req.length > 0) {
//                 issue_rate = stmt_jwbom_req[0].issue_rate;
//               }

//               let stmt_total_iss = await invtDB.query(
//                 "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `total_issued_rm` FROM `rm_location` WHERE `jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND trans_type = 'JOBWORK' ",
//                 {
//                   replacements: {
//                     component_id: stmt_comp[i].component_key,
//                     transaction_id: jw_tran_id,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );
//               let total_issue_qty;
//               if (stmt_total_iss.length > 0) {
//                 total_issue_qty = stmt_total_iss[0].total_issued_rm;
//               } else {
//                 total_issue_qty = 0;
//               }

//               let stmt_total_ret = await invtDB.query(
//                 "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_returned_rm` FROM `rm_location` WHERE `trans_type` = 'INWARD' AND `in_jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND trans_mode = 'return'",
//                 {
//                   replacements: {
//                     component_id: stmt_comp[i].component_key,
//                     transaction_id: jw_tran_id,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );
//               let total_rm_return_qty, total_rm_return_value;
//               if (stmt_total_ret.length > 0) {
//                 total_rm_return_qty = stmt_total_ret[0].total_returned_rm;
//                 total_rm_return_value = total_rm_return_qty;
//               } else {
//                 total_rm_return_qty = 0;
//               }

//               let stmt_total_consump = await invtDB.query(
//                 "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_consumption` FROM `rm_location` WHERE `jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND `trans_type` = 'SFG-CONSUMPTION' ",
//                 {
//                   replacements: {
//                     component_id: stmt_comp[i].component_key,
//                     transaction_id: jw_tran_id,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );
//               let total_consumption_value;
//               if (stmt_total_consump.length > 0) {
//                 total_consumption_value =
//                   stmt_total_consump[0].total_consumption;
//               } else {
//                 total_consumption_value = 0;
//               }

//               let stmt_total_out = await invtDB.query(
//                 "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_outward`, `in_po_rate` FROM `rm_location` WHERE `jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND `trans_type` = 'JOBWORK'",
//                 {
//                   replacements: {
//                     component_id: stmt_comp[i].component_key,
//                     transaction_id: jw_tran_id,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );
//               let total_outward_value;
//               if (stmt_total_out.length > 0) {
//                 total_outward_value = stmt_total_out[0].total_outward;
//               } else {
//                 total_outward_value = 0;
//               }

//               let stmt_total_in = await invtDB.query(
//                 "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_inward`, `in_po_rate` FROM `rm_location` WHERE `in_jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND `trans_type` = 'INWARD' AND `bom_subject_id` = '--' AND `in_vendor_branch` = '--' AND `in_vendor_addr` = '--'",
//                 {
//                   replacements: {
//                     component_id: stmt_comp[i].component_key,
//                     transaction_id: jw_tran_id,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );
//               let total_inward_value;
//               if (stmt_total_in.length > 0) {
//                 total_inward_value = stmt_total_in[0].total_inward;
//               } else {
//                 total_inward_value = 0;
//               }

//               // Find Last Avg Rate
//               let stmt_check_avg_rate = await invtDB.query(
//                 "SELECT * FROM jw_material_challan WHERE jw_component_id = :component_id AND jw_transaction = :transaction_id",
//                 {
//                   replacements: {
//                     component_id: stmt_comp[i].component_key,
//                     transaction_id: jw_tran_id,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );
//               let lastAvg_rate = 0;
//               if (stmt_check_avg_rate.length > 0) {
//                 lastAvg_rate = stmt_check_avg_rate[0].jw_order_rate;
//               } else {
//                 lastAvg_rate = 0;
//               }

//               let consump_qty = helper.number(
//                 total_consumption_value > total_issue_qty - total_rm_return_qty
//                   ? total_issue_qty - total_rm_return_qty
//                   : total_consumption_value
//               );

//               final.push({
//                 required_qty: helper
//                   .number(jw_order_qty * stmt_comp[i].jw_bom_qty)
//                   .toFixed(2),
//                 issue_qty: total_issue_qty,
//                 pending_qty: helper
//                   .number(
//                     jw_order_qty * stmt_comp[i].jw_bom_qty - total_issue_qty
//                   )
//                   .toFixed(2),
//                 comsump_qty: consump_qty.toFixed(2),
//                 rm_return_qty: total_rm_return_qty,
//                 p_with_jw: helper
//                   .number(total_issue_qty - consump_qty - total_rm_return_qty)
//                   .toFixed(2),
//                 component_name: stmt_comp[i].c_name,
//                 component_key: stmt_comp[i].component_key,
//                 part_code: stmt_comp[i].c_part_no,
//                 bom_cat: "--",
//                 avgRate: lastAvg_rate,
//                 bom_uom: stmt_comp[i].units_name,
//                 bom_rate: stmt_comp[i].jw_bom_rate,
//                 bom_qty: helper.number(stmt_comp[i].jw_bom_qty).toFixed(2),
//                 outward_value: helper.number(
//                   total_issue_qty * stmt_comp[i].jw_bom_rate
//                 ),
//                 inward_value: total_inward_value,
//                 consump_qty_value: helper.number(
//                   consump_qty * stmt_comp[i].jw_bom_rate
//                 ),
//                 rtn_inward_value: helper.number(
//                   total_rm_return_qty * stmt_comp[i].jw_bom_rate
//                 ),
//                 bom_status: bom_status,
//                 bomalt_part: alt_component_part,
//                 bomalt_name: alt_component_name,
//               });
//               if (stmt_comp.length == final.length) {
//                 return res.json({
//                   code: 200,
//                   status: "success",
//                   header: header,
//                   data: final,
//                 });
//               }
//             }
//           } else {
//             return res.json({
//               code: 500,
//               status: "error",
//               message: { msg: `Component Not Found` },
//             });
//           }
//         } else {
//           return res.json({
//             code: 500,
//             status: "error",
//             message: {
//               msg: `invalid transaction id, we couldn\'t find anything.. against product sku [${product_sku}]'`,
//             },
//           });
//         }
//       } else {
//         return res.json({
//           code: 500,
//           status: "error",
//           message: { msg: `BOM not found for this SKU [${product_sku}]'` },
//         });
//       }
//     } else {
//       return res.json({
//         code: 500,
//         status: "error",
//         message: { msg: "not a valid SKU supplied" },
//       });
//     }
//   } catch (err) {
//     console.log(err.stack);
//     return res.json({
//       code: 500,
//       status: "error",
//       message: { msg: "Query Error" },
//       error: err.stack,
//     });
//   }
// });

router.post("/fetchTableAnly", [auth.isAuthorized], async (req, res) => {
  try {
    // Input validation
    const validation = new Validator(req.body, {
      skucode: "required",
      jw_transaction: "required",
      po_transaction: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: "Missing required form fields",
        data: validation.errors.all(),
        status: "error",
      });
    }

    const { skucode, jw_transaction } = req.body;

    // Fetch product data
    const [product] = await invtDB.query(
      "SELECT p_name, p_sku, m_sku FROM `products` WHERE `product_key` = :productkey",
      {
        replacements: { productkey: skucode },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (!product) {
      return res.json({
        success: false,
        status: "error",
        message: "Invalid SKU supplied",
      });
    }

    const product_sku =
      product.p_sku !== "--"
        ? product.p_sku
        : product.m_sku !== "--"
          ? product.m_sku
          : product.s_sku;

    // Fetch JW PO request with related data
    const [jwpo_req] = await invtDB.query(
      `SELECT jpr.jw_po_order_qty, jpr.jw_jw_transaction, jpr.jw_po_issue_qty, jpr.jw_po_status, 
              jpr.jw_po_full_date, jpr.jw_po_recipe, p.p_name, p.p_sku, b.subject_name, b.subject_id, 
              u.units_name, al.user_name, vbd.ven_name
       FROM jw_purchase_req jpr
       LEFT JOIN jw_bom_recipe jbr ON jpr.jw_po_sku = jbr.jw_bom_sku
       LEFT JOIN bom_recipe b ON jpr.jw_po_recipe = b.subject_id
       LEFT JOIN products p ON jbr.jw_bom_sku = p.product_key
       LEFT JOIN units u ON p.p_uom = u.units_id
       LEFT JOIN admin_login al ON jpr.jw_po_insert_by = al.CustID
       LEFT JOIN ven_basic_detail vbd ON jpr.jw_po_vendor_reg_id = vbd.ven_register_id
       WHERE jbr.jw_bom_sku = :skucode AND jpr.jw_jw_transaction = :jw_id
       LIMIT 1`,
      {
        replacements: { skucode, jw_id: jw_transaction },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (!jwpo_req) {
      return res.json({
        success: false,
        status: "error",
        message: `BOM not found for SKU [${product_sku}]`,
      });
    }

    // Prepare header data
    const jw_status =
      jwpo_req.jw_po_issue_qty === "0" && jwpo_req.jw_po_status === "A"
        ? "Created"
        : jwpo_req.jw_po_issue_qty !== "0" && jwpo_req.jw_po_status === "A"
          ? "Processing..."
          : "Closed";

    const header = [
      {
        sku_code: jwpo_req.p_sku,
        product_name: jwpo_req.p_name,
        subject_id: jwpo_req.subject_id,
        subject_name: jwpo_req.subject_name,
        jobwork_id: jwpo_req.jw_jw_transaction,
        registered_date: moment(
          jwpo_req.jw_po_full_date,
          "YYYY-MM-DD HH:mm:ss",
        ).format("DD-MM-YYYY HH:mm:ss"),
        created_by: jwpo_req.user_name,
        ordered_qty: `${jwpo_req.jw_po_order_qty} ${jwpo_req.units_name}`,
        proceed_qty: jwpo_req.jw_po_issue_qty,
        jw_status,
        vendor_name: jwpo_req.ven_name,
      },
    ];

    // Fetch components data
    const components = await invtDB.query(
      `SELECT jbr.jw_bom_qty, jbr.jw_bom_rate, jbr.jw_bom_part, jbr.jw_bom_alt_part, jw_bom_part_status, c.c_name, c.c_part_no, c.component_key, 
              u.units_name
       FROM jw_bom_recipe jbr
       LEFT JOIN components c ON jbr.jw_bom_part = c.component_key
       LEFT JOIN units u ON c.c_uom = u.units_id
       WHERE jbr.jw_bom_sku = :skucode AND jbr.jw_bom_po_trans = :jw_id
       ORDER BY c.c_part_no ASC`,
      {
        replacements: {
          bomSubject: jwpo_req.jw_po_recipe,
          skucode,
          jw_id: jw_transaction,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (!components.length) {
      return res.json({
        success: false,
        status: "error",
        message: "Component Not Found",
      });
    }

    // Process components in parallel
    const final = await Promise.all(
      components.map(async (comp) => {
        let alt_components = [];
        // Fetch alternative components
        if (
          comp.jw_bom_part_status === "ALT" &&
          comp.jw_bom_alt_part &&
          comp.jw_bom_alt_part !== "--"
        ) {
          const partKey = comp.jw_bom_alt_part.split(",").map((p) => p.trim());

          if (partKey.length > 0) {
            const alts = await invtDB.query(
              `SELECT c.c_part_no, c.c_name 
         FROM components c 
         WHERE c.component_key IN (:partKey)`,
              {
                replacements: { partKey },
                type: invtDB.QueryTypes.SELECT,
              },
            );

            if (alts.length > 0) {
              alt_components = alts.map((alt) => ({
                alt_component_part: alt.c_part_no,
                alt_component_name: decode(alt.c_name),
              }));
            }
          }
        }

        // Fetch quantities in parallel
        const [
          [total_sfg_consump],
          [total_iss],
          [total_ret],
          [total_consump],
          [total_in],
          [avg_rate],
        ] = await Promise.all([
          invtDB.query(
            "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_sfg_consump FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'SFG-CONSUMPTION' AND trans_mode = 'default'",
            {
              replacements: {
                component_id: comp.component_key,
                transaction_id: jwpo_req.jw_jw_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          ),

          invtDB.query(
            "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_issued_rm FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'JOBWORK'",
            {
              replacements: {
                component_id: comp.component_key,
                transaction_id: jwpo_req.jw_jw_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          ),
          invtDB.query(
            "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_returned_rm FROM rm_location WHERE trans_type = 'TRANSFER' AND in_jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_mode = 'return'",
            {
              replacements: {
                component_id: comp.component_key,
                transaction_id: jwpo_req.jw_jw_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          ),
          invtDB.query(
            "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_consumption FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'CONSUMPTION' AND trans_mode = 'default'",
            {
              replacements: {
                component_id: comp.component_key,
                transaction_id: jwpo_req.jw_jw_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          ),

          invtDB.query(
            "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_inward FROM rm_location WHERE in_jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'INWARD' AND bom_subject_id = '--' AND in_vendor_branch = '--' AND in_vendor_addr = '--'",
            {
              replacements: {
                component_id: comp.component_key,
                transaction_id: jwpo_req.jw_jw_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          ),
          invtDB.query(
            "SELECT jw_order_rate FROM jw_material_challan WHERE jw_component_id = :component_id AND jw_transaction = :transaction_id",
            {
              replacements: {
                component_id: comp.component_key,
                transaction_id: jwpo_req.jw_jw_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          ),
        ]);

        const consump_qty = helper.number(
          total_consump.total_consumption >
            total_iss.total_issued_rm - total_ret.total_returned_rm
            ? total_iss.total_issued_rm - total_ret.total_returned_rm
            : total_consump.total_consumption,
        );

        return {
          required_qty: helper
            .number(jwpo_req.jw_po_order_qty * comp.jw_bom_qty)
            .toFixed(2),
          issue_qty: total_iss.total_issued_rm,
          pending_qty: helper
            .number(
              jwpo_req.jw_po_order_qty * comp.jw_bom_qty -
                total_iss.total_issued_rm,
            )
            .toFixed(2),
          comsump_qty: consump_qty.toFixed(2),
          rm_return_qty: total_ret.total_returned_rm,
          p_with_jw: helper
            .number(
              total_iss.total_issued_rm -
                (total_sfg_consump.total_sfg_consump +
                  total_ret.total_returned_rm +
                  consump_qty),
            )
            .toFixed(2),
          component_name: comp.c_name,
          part_code: comp.c_part_no,
          bom_cat: "--",
          avgRate: avg_rate?.jw_order_rate || 0,
          bom_uom: comp.units_name,
          bom_rate: comp.jw_bom_rate,
          bom_qty: helper.number(comp.jw_bom_qty).toFixed(3),
          outward_value: helper.number(
            total_iss.total_issued_rm * comp.jw_bom_rate,
          ),
          inward_value: total_in.total_inward,
          sfg_consump_qty_value: helper.number(
            total_sfg_consump.total_sfg_consump,
          ),
          consump_qty_value: helper.number(consump_qty * comp.jw_bom_rate),
          rtn_inward_value: helper.number(
            total_ret.total_returned_rm * comp.jw_bom_rate,
          ),
          alts_status: comp.jw_bom_part_status,
          alts: alt_components,
        };
      }),
    );

    return res.json({
      success: true,
      status: "success",
      data: {
        header,
        body: final,
      },
    });
  } catch (err) {
    console.error(err);
    return helper.errorResponse(res, err);
  }
});
// CANCEL PO
router.post(
  "/closePO",
  [auth.isAuthorized, permission.isPermittedMethod("CANCEL")],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        skucode: "required",
        transaction: "required",
        remark: "required",
      });

      if (validation.fails()) {
        res.json({
          success: false,
          message: "something you missing in form field to supply",
          data: validation.errors.all(),
          status: "error",
        });
      }

      let { skucode, transaction, remark } = req.body;

      let stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :jw_id AND `jw_po_sku` = :skucode",
        {
          replacements: { jw_id: transaction, skucode: skucode },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt.length > 0) {
        if (stmt[0].jw_po_status == "C") {
          return res.json({
            success: false,
            status: "error",
            message: "Purchase Order already close",
          });
        } else {
          let stmt_update = await invtDB.query(
            "UPDATE `jw_purchase_req` SET `jw_close_remark` = :remark, `jw_po_status` = 'C' WHERE `jw_jw_transaction` = :jwid AND `jw_po_sku` = :skucode",
            {
              replacements: {
                jwid: transaction,
                skucode: skucode,
                remark: remark,
              },
              type: invtDB.QueryTypes.UPDATE,
            },
          );
          if (stmt_update.length > 0) {
            return res.json({
              success: true,
              status: "success",
              message: "Purchase Order closed successfully",
            });
          } else {
            return res.json({
              success: false,
              status: "error",
              message:
                "unable to close the purchase order due to some technical issue- contact developer...",
            });
          }
        }
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "unable to fetch any purchase order for proceed the action",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  },
);

// OPEN JW PO
router.post("/openPO", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      transaction: "required",
      skucode: "required",
    });
    if (validation.fails()) {
      res.json({
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
    }

    let stmt_check = await invtDB.query(
      "SELECT * FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :jw_id AND `jw_po_sku` = :skucode",
      {
        replacements: {
          jw_id: req.body.transaction,
          skucode: req.body.skucode,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (stmt_check.length > 0) {
      if (stmt_check[0].jw_po_status == "A") {
        return res.json({
          success: false,
          status: "error",
          message: "Purchase Order already actived",
        });
      } else {
        let stmt_update = await invtDB.query(
          "UPDATE `jw_purchase_req` SET `jw_po_status` = :status WHERE `jw_jw_transaction` = :jwid AND `jw_po_sku` = :skucode",
          {
            replacements: {
              jwid: req.body.transaction,
              skucode: req.body.skucode,
              status: "A",
            },
            type: invtDB.QueryTypes.UPDATE,
          },
        );

        if (stmt_update.length > 0) {
          return res.json({
            success: true,
            status: "success",
            message: "Purchase Order re-opened successfully",
          });
        } else {
          return res.json({
            success: false,
            status: "error",
            message:
              "unable to activate the purchase order due to some technical issue- contact developer...",
          });
        }
      }
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "unable to fetch any purchase order for proceed the action",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// JW RM ISSUE LIST
router.post("/jw_rm_issue_list", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      data: "required",
      wise: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: validation.errors.errors,
      });
    }

    const { data, wise } = req.body;
    let stmt;
    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE DATE_FORMAT(`jw_purchase_req`.`jw_po_full_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `jw_purchase_req`.`jw_po_status` = 'A' AND `jw_purchase_req`.`company_branch` = :branch ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { date1: date1, date2: date2, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "jw_transaction_wise") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_jw_transaction` LIKE CONCAT('%', :jwcode, '%') AND `jw_purchase_req`.`jw_po_status` = 'A' AND `jw_purchase_req`.`company_branch` = :branch ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { jwcode: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "vendorwise") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_po_vendor_reg_id` = :vendor AND `jw_purchase_req`.`jw_po_status` = 'A' AND `jw_purchase_req`.`company_branch` = :branch ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { vendor: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "jw_sfg_wise") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_po_sku` = :sku AND `jw_purchase_req`.`jw_po_status` = 'A' AND `jw_purchase_req`.`company_branch` = :branch ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { sku: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "Please select valid filter method",
      });
    }

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          sku: stmt[i].jw_po_sku,
          po_status: stmt[i].jw_po_status,
          po_bom_recipe: stmt[i].jw_po_bom_recipe,
          vendor: `${stmt[i].ven_name} (${stmt[i].jw_po_vendor_reg_id})`,
          date: moment(stmt[i].jw_po_full_date, "YYYY-MM-DD HH:mm:ss").format(
            "DD-MM-YYYY",
          ),
          productkey: stmt[i].product_key,
          skucode: stmt[i].p_sku,
          product: stmt[i].p_name,
          jw_transaction_id: stmt[i].jw_jw_transaction,
          sku_transaction_id: stmt[i].jw_po_sku_transaction,
          actionby: stmt[i].user_name,
          puom: stmt[i].units_name,
          req_qty: stmt[i].jw_po_order_qty,
        });
      }

      return res.json({ success: true, status: "success", data: final });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "no entry found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// JW Material Request List
router.post(
  "/jw_material_request_list",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        skucode: "required",
        jw_transaction: "required",
        po_transaction: "required",
      });

      if (validation.fails()) {
        res.json({
          success: false,
          message: "something you missing in form field to supply",
          data: validation.errors.all(),
          status: "error",
        });
      }

      let { skucode, jw_transaction, po_transaction } = req.body;
      const productkey = skucode;

      let stmt = await invtDB.query(
        "SELECT * FROM `products` WHERE (`product_key` = :productkey)",
        {
          replacements: { productkey: productkey },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt.length > 0) {
        let product_name = stmt[0].p_name;
        let product_sku, product_m_sku;

        if (stmt[0].p_sku !== "--") {
          product_sku = stmt[0].p_sku;
          product_m_sku = stmt[0].m_sku;
        } else if (stmt[0].m_sku !== "--") {
          product_m_sku = stmt[0].m_sku;
          product_sku = stmt[0].p_sku;
        } else {
          product_sku = stmt[0].s_sku;
          product_m_sku = stmt[0].m_sku;
        }

        let stmt_header = await invtDB.query(
          "SELECT * FROM `jw_purchase_req` LEFT JOIN `bom_recipe` ON `jw_purchase_req`.`jw_po_recipe` = `bom_recipe`.`subject_id` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `jw_bom_recipe` ON `jw_purchase_req`.`jw_po_sku` = `jw_bom_recipe`.`jw_bom_sku` AND `jw_purchase_req`.`jw_jw_transaction` = `jw_bom_recipe`.`jw_bom_po_trans` AND `jw_purchase_req`.`jw_po_sku_transaction` = `jw_bom_recipe`.`jw_bom_sku_trans` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE (`jw_purchase_req`.`jw_po_sku` = :productkey) AND `jw_bom_recipe`.`jw_bom_po_trans` = :jw_id AND `jw_bom_recipe`.`jw_bom_sku_trans` = :po_jw_transaction AND `jw_purchase_req`.`company_branch` = :branch LIMIT 1",
          {
            replacements: {
              productkey: productkey,
              jw_id: jw_transaction,
              po_jw_transaction: po_transaction,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );
        let headers = [];
        if (stmt_header.length > 0) {
          let jw_status = "";
          if (
            stmt_header[0].jw_po_issue_qty == "0" &&
            stmt_header[0].jw_po_status == "A"
          ) {
            jw_status = "Created";
          } else if (
            stmt_header[0].jw_po_issue_qty !== "0" &&
            stmt_header[0].jw_po_status == "A"
          ) {
            jw_status = "Processing...";
          } else {
            jw_status = "Closed";
          }

          headers.push({
            sku_code: stmt_header[0].p_sku,
            product_name: stmt_header[0].p_name,
            subject_id: stmt_header[0].subject_id,
            subject_name: stmt_header[0].subject_name,
            po_jobwork_id: stmt_header[0].jw_po_sku_transaction,
            jw_jobwork_id: stmt_header[0].jw_jw_transaction,
            registered_date: moment(
              stmt_header[0].jw_po_full_date,
              "YYYY-MM-DD HH:mm:ss",
            ).format("DD-MM-YYYY"),
            created_by: stmt_header[0].user_name,
            ordered_qty:
              stmt_header[0].jw_po_order_qty + " " + stmt_header[0].units_name,
            proceed_qty: stmt_header[0].jw_po_issue_qty,
            jw_status: jw_status,
            vendor_name: stmt_header[0].ven_name,
          });

          let stmt_check_trans = await invtDB.query(
            "SELECT * FROM `jw_purchase_req` WHERE `jw_po_sku` = :skucode AND `jw_jw_transaction` = :jw_id AND `company_branch` = :branch",
            {
              replacements: {
                skucode: productkey,
                jw_id: jw_transaction,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          if (stmt_check_trans.length > 0) {
            let jw_order_qty = stmt_check_trans[0].jw_po_order_qty;
            let jw_location_key = stmt_check_trans[0].location;

            let stmt_comp = await invtDB.query(
              "SELECT * FROM `jw_bom_recipe` LEFT JOIN `components` ON `jw_bom_recipe`.`jw_bom_part` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE (`jw_bom_recipe`.`jw_bom_sku` = :productkey) AND `jw_bom_recipe`.`jw_bom_po_trans` = :jw_id AND `jw_bom_recipe`.`company_branch` = :branch ORDER BY `components`.`c_part_no` ASC",
              {
                replacements: {
                  productkey: productkey,
                  jw_id: jw_transaction,
                  branch: req.branch,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            );

            if (stmt_comp.length > 0) {
              let components = [];
              stmt_comp.map(async (item) => {
                let query = await invtDB.query(
                  "SELECT components.c_name, components.component_key, components.c_part_no ,COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_issued_rm`, (SELECT COALESCE(SUM(`qty`+`other_qty`), 0) FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'TRANSFER') AND `company_branch` = :branch) Inward ,(SELECT COALESCE(SUM(`qty`+`other_qty`), 0) FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'CONSUMPTION' AND `trans_type` != 'INWARD' AND `trans_type` != 'CANCELLED') AND `company_branch` = :branch) Outward FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` WHERE `rm_location`.`jw_transaction_id` = :jw_transaction AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND `components`.`component_key` = :component AND `rm_location`.`company_branch` = :branch",
                  {
                    replacements: {
                      component: item.jw_bom_part,
                      branch: req.branch,
                      jw_transaction: jw_transaction,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  },
                );
                let inward_all_qty, outward_all_qty, total_issue_qty;
                if (query.length > 0) {
                  inward_all_qty = query[0].Inward;
                  outward_all_qty = query[0].Outward;
                  total_issue_qty = query[0].total_issued_rm;
                } else {
                  ((inward_all_qty = 0),
                    (outward_all_qty = 0),
                    (total_issue_qty = 0));
                }

                // CHANGED: Get available qty based on specific location from jw_purchase_req table
                let location_based_available_qty = 0;
                if (jw_location_key) {
                  const location_stock_query = await invtDB.query(
                    "SELECT COALESCE(SUM(CASE WHEN trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND loc_in = :location_key THEN qty ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND loc_out = :location_key THEN qty ELSE 0 END), 0) AS available_stock FROM rm_location WHERE components_id = :component_id",
                    {
                      replacements: {
                        location_key: jw_location_key,
                        component_id: item.jw_bom_part,
                      },
                      type: invtDB.QueryTypes.SELECT,
                    },
                  );

                  if (location_stock_query.length > 0) {
                    location_based_available_qty =
                      location_stock_query[0].available_stock || 0;
                  }
                }

                let stmt_total_ret = await invtDB.query(
                  "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_returned_rm` FROM `rm_location` WHERE `trans_type` = 'INWARD' AND `in_jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND trans_mode = 'return'",
                  {
                    replacements: {
                      component_id: item.jw_bom_part,
                      transaction_id: jw_transaction,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  },
                );
                let total_rm_return_qty, total_rm_return_value;
                if (stmt_total_ret.length > 0) {
                  total_rm_return_qty = stmt_total_ret[0].total_returned_rm;
                  total_rm_return_value = total_rm_return_qty;
                } else {
                  total_rm_return_qty = 0;
                }
                let stmt_total_consump = await invtDB.query(
                  "SELECT COALESCE(SUM(`qty`+`other_qty`),0 ) AS `total_consumption` FROM `rm_location` WHERE `jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND `trans_type` = 'SFG-CONSUMPTION' ",
                  {
                    replacements: {
                      component_id: item.jw_bom_part,
                      transaction_id: jw_transaction,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  },
                );
                let total_consumption_value;
                if (stmt_total_consump.length > 0) {
                  total_consumption_value =
                    stmt_total_consump[0].total_consumption;
                } else {
                  total_consumption_value = 0;
                }
                let stmt_total_iss = await invtDB.query(
                  "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `total_issued_rm` FROM `rm_location` WHERE `jw_transaction_id` = :transaction_id AND `components_id` = :component_id AND trans_type = 'JOBWORK' ",
                  {
                    replacements: {
                      component_id: item.jw_bom_part,
                      transaction_id: jw_transaction,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  },
                );
                let total_issue_qty2;
                if (stmt_total_iss.length > 0) {
                  total_issue_qty2 = stmt_total_iss[0].total_issued_rm;
                } else {
                  total_issue_qty2 = 0;
                }

                let consump_qty = helper.number(
                  total_consumption_value >
                    total_issue_qty2 - total_rm_return_qty
                    ? total_issue_qty2 - total_rm_return_qty
                    : total_consumption_value,
                );
                let pendingQty = helper
                  .number(total_issue_qty2 - consump_qty - total_rm_return_qty)
                  .toFixed(2);
                // Added: Logic to fetch alternative components
                let alt_components = [];
                if (
                  item.jw_bom_part_status === "ALT" &&
                  item.jw_bom_alt_part &&
                  item.jw_bom_alt_part !== "--"
                ) {
                  const partKey = item.jw_bom_alt_part
                    .split(",")
                    .map((p) => p.trim());

                  if (partKey.length > 0) {
                    const alts = await invtDB.query(
                      `SELECT c.c_part_no, c.c_name 
                       FROM components c 
                       WHERE c.component_key IN (:partKey)`,
                      {
                        replacements: { partKey },
                        type: invtDB.QueryTypes.SELECT,
                      },
                    );

                    if (alts.length > 0) {
                      alt_components = alts.map((alt) => ({
                        alt_component_part: alt.c_part_no,
                        alt_component_name: decode(alt.c_name),
                      }));
                    }
                  }
                }
                // End Added

                components.push({
                  required_qty: jw_order_qty * item.jw_bom_qty,
                  // pending_qty: pendingQty,
                  pending_qty:
                    jw_order_qty * item.jw_bom_qty - total_issue_qty2,
                  // pending_qty: jw_order_qty * item.jw_bom_qty - total_issue_qty,
                  component_name: item.c_name,
                  component_key: item.component_key,
                  part_code: item.c_part_no,
                  bom_req_qty: item.jw_bom_qty,
                  available_qty: checkIfZero(location_based_available_qty),
                  // available_qty: checkIfZero(inward_all_qty - outward_all_qty),
                  alts_status: item.jw_bom_part_status, // Added: Include alternative part status
                  alts: alt_components, // Added: Include alternative components
                });

                if (stmt_comp.length == components.length) {
                  return res.json({
                    status: "success",
                    success: true,
                    data: {
                      header: headers,
                      components: components,
                    },
                  });
                }
              });
            }
          } else {
            return res.json({
              success: false,
              status: "error",
              message: `an invalid transaction ID found`,
            });
          }
        } else {
          return res.json({
            success: false,
            status: "error",
            message: `seems the recipe is not created for the this transaction`,
          });
        }
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "no entry found",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  },
);

// SAVE JW METERIAL RM ISSUE
router.post(
  "/save_jw_material_issue",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      let validation = new Validator(req.body, {
        jobwork_jw_trans_id: "required",
        jobwork_po_trans_id: "required",
      });
      if (validation.fails()) {
        res.json({
          success: false,
          message: "something you missing in form field to supply",
          data: validation.errors.all(),
          status: "error",
        });
      }

      const { jobwork_jw_trans_id, jobwork_po_trans_id } = req.body;

      let stmt = await invtDB.query(
        "SELECT `jw_m_transaction_id` FROM `jw_material_issue` GROUP BY `jw_m_transaction_id` ORDER BY ID DESC LIMIT 1",
        {
          type: invtDB.QueryTypes.SELECT,
        },
      );

      let issue_trans_id = "MTIS0001";

      if (stmt.length > 0) {
        issue_trans_id = stmt[0].jw_m_transaction_id;
        let arr = issue_trans_id.split(/(?<=[A-Za-z])(?=[0-9]+)/i);
        let str = arr[0];
        let num = parseInt(arr[1]);
        issue_trans_id = str + String(num + 1).padStart(4, "0");
      }

      let comp_length = req.body.component.length;
      let issue_qty_length = req.body.issue_qty.length;

      if (comp_length != issue_qty_length) {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "component and issue qty length not matched",
        });
      }

      for (let i = 0; i < comp_length; i++) {
        let comp_validation = new Validator(
          {
            component: req.body.component[i],
            // issue_qty: req.body.issue_qty[i],
          },
          {
            component: "required",
            // issue_qty: "required",
          },
        );
        if (comp_validation.fails()) {
          await transaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: comp_validation.errors.all(),
          });
        }
      }

      let stmt_check = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :jobwork_id AND `jw_po_sku_transaction` = :po_jw_transaction AND `company_branch` = :branch",
        {
          replacements: {
            jobwork_id: jobwork_jw_trans_id,
            po_jw_transaction: jobwork_po_trans_id,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt_check.length > 0) {
        if (stmt_check[0].jw_po_status == "C") {
          await transaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message:
              "we are unable to process the jobwork transaction against you supplied bcz it closed or on hold for further transaction's. Pls contact to authorized person to fix this issue..",
          });
        }

        let bom_recipe = stmt_check[0].jw_po_recipe;
        let product_sku = stmt_check[0].jw_po_sku;
        let sku_trans_id = stmt_check[0].jw_po_sku_transaction;
        let vendor_code = stmt_check[0].jw_po_vendor_reg_id;

        for (let i = 0; i < comp_length; i++) {
          // let stmt_check_comp = await invtDB.query("SELECT * FROM `bom_quantity` WHERE `subject_under` = :subject AND `component_id` = :component_key", {
          //   replacements: { subject: bom_recipe, component_key: req.body.component[i] },
          //   type: invtDB.QueryTypes.SELECT,
          // });

          // if (stmt_check_comp.length > 0) {
          //   let stmt_inw = await invtDB.query(
          //     "SELECT *, COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units`ON `components`.`c_uom` = `units`.`units_id` WHERE `components`.`c_type` = 'R' AND `components`.`component_key` = :component AND (`rm_location`.`trans_type` = 'INWARD' OR `rm_location`.`trans_type` = 'TRANSFER')",
          //     {
          //       replacements: { component: req.body.component[i] },
          //       type: invtDB.QueryTypes.SELECT,
          //     }
          //   );
          //   let inward_all_qty = stmt_inw.length > 0 ? stmt_inw[0].Inward : 0;
          //   let stmt_outw = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'CONSUMPTION' AND `trans_type` != 'INWARD' AND `trans_type` != 'CANCELLED')", {
          //     replacements: { component: req.body.component[i] },
          //     type: invtDB.QueryTypes.SELECT,
          //   });
          //   let outward_all_qty = stmt_outw.length > 0 ? stmt_outw[0].Outward : 0;

          if (req.body.issue_qty[i] != "") {
            let stmt_insert = await invtDB.query(
              "INSERT INTO `jw_material_issue` (`company_branch`,`jw_m_vendor`,`jw_m_sku_trans_id`,`jw_m_sku`,`jw_m_recipe`,`jw_m_component`,`jw_m_issue_qty`,`jw_m_job_id`,`jw_m_insert_dt`,`jw_m_insert_by`,`jw_m_transaction_id`)VALUES (:branch,:vendor,:job_sku_id,:sku,:recipe,:component,:issue_qty,:job_id,:insert_dt,:insert_by,:transaction)",
              {
                replacements: {
                  branch: req.branch,
                  vendor: vendor_code,
                  job_sku_id: sku_trans_id,
                  sku: product_sku,
                  recipe: bom_recipe,
                  component: req.body.component[i],
                  issue_qty: req.body.issue_qty[i],
                  job_id: jobwork_jw_trans_id,
                  insert_dt: moment(new Date())
                    .tz("Asia/Kolkata")
                    .format("YYYY-MM-DD HH:mm:ss"),
                  insert_by: req.logedINUser,
                  transaction: issue_trans_id,
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: transaction,
              },
            );

            if (stmt_insert.length <= 0) {
              await transaction.rollback();
              return res.json({
                success: false,
                status: "error",
                message: "unable to insert material issue transaction",
              });
            }
          }
        }
        await transaction.commit();
        return res.json({
          success: true,
          status: "success",
          message: "material issue transaction successfully completed",
        });
      } else {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "an error while executing the jobwork transaction",
        });
      }
    } catch (err) {
      await transaction.rollback();
      return helper.errorResponse(res, err);
    }
  },
);

// JW SF INWARD
router.post("/jw_sf_inward", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      wise: "required",
      data: "required",
    });

    if (validation.fails()) {
      res.json({
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
    }

    const { wise, data } = req.body;

    let stmt;

    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_purchase_req`.`company_branch` = :branch AND DATE_FORMAT(`jw_purchase_req`.`jw_po_full_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `jw_purchase_req`.`jw_po_status` = 'A' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { date1: date1, date2: date2, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "vendorwise") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_purchase_req`.`company_branch` = :branch AND `jw_po_vendor_reg_id` = :venid AND `jw_purchase_req`.`jw_po_status` = 'A' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { venid: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "jw_transaction_wise") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_purchase_req`.`company_branch` = :branch AND `jw_purchase_req`.`jw_jw_transaction` LIKE CONCAT('%', :jw_id, '%') AND `jw_purchase_req`.`jw_po_status` = 'A' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { jw_id: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "jw_sfg_wise") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_purchase_req`.`company_branch` = :branch AND `jw_po_sku` = :sfgcode AND `jw_purchase_req`.`jw_po_status` = 'A' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { sfgcode: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "invalid wise found.",
      });
    }

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          date: moment(stmt[i].jw_po_full_date, "YYYY-MM-DD HH:mm:ss").format(
            "DD-MM-YYYY",
          ),
          transaction_id: stmt[i].jw_jw_transaction,
          vendor: stmt[i].ven_name + "( " + stmt[i].jw_po_vendor_reg_id + " )",
          vendorCode: stmt[i].jw_po_vendor_reg_id,
          sku_code: stmt[i].p_sku,
          sku_name: stmt[i].p_name,
          sku: stmt[i].product_key,
          ord_qty: stmt[i].jw_po_order_qty + " / " + stmt[i].jw_po_issue_qty,
        });
      }

      return res.json({ success: true, status: "success", data: final });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "no orders were found that match the given search criteria.",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH JW SF INWARD COMPONENTS
router.get(
  "/fetch_jw_sf_inward_components",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.query, {
        transaction: "required",
        skucode: "required",
      });

      if (validation.fails()) {
        const firstKey = Object.keys(validation.errors.errors)[0];
        const firstError = validation.errors.errors[firstKey][0];

        return res.json({
          success: false,
          status: "error",
          message: firstError,
        });
      }

      const { transaction, skucode } = req.query;

      let stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `jw_bom_recipe` ON `jw_purchase_req`.`jw_po_sku` = `jw_bom_recipe`.`jw_bom_sku` LEFT JOIN `bom_recipe` ON `jw_purchase_req`.`jw_po_recipe` = `bom_recipe`.`subject_id` LEFT JOIN `products` ON `jw_bom_recipe`.`jw_bom_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_bom_recipe`.`jw_bom_sku` = :productkey AND `jw_purchase_req`.`jw_jw_transaction` = :jw_id AND `jw_purchase_req`.`company_branch` = :branch LIMIT 1",
        {
          replacements: {
            productkey: skucode,
            jw_id: transaction,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt.length > 0) {
        let jw_status = "";
        if (stmt[0].jw_po_issue_qty == "0" && stmt[0].jw_po_status == "A") {
          jw_status = "Created";
        } else if (
          stmt[0].jw_po_issue_qty !== "0" &&
          stmt[0].jw_po_status == "A"
        ) {
          jw_status = "Processing...";
        } else {
          jw_status = "Closed";
        }

        let header = {
          product: {
            sku: stmt[0].p_sku,
            name: stmt[0].p_name,
          },
          bom: {
            key: stmt[0].subject_id,
            name: stmt[0].subject_name,
          },
          jobworkID: stmt[0].jw_jw_transaction,
          registereDt: moment(stmt[0].jw_po_full_date, "YYYY-MM-DD").format(
            "DD-MM-YYYY",
          ),
          createdBy: stmt[0].user_name,
          orderedQty: stmt[0].jw_po_order_qty + " " + stmt[0].units_name,
          jwStatus: jw_status,
          proceedQty: stmt[0].jw_po_issue_qty,
          vendor: {
            name: stmt[0].ven_name,
            code: stmt[0].jw_po_vendor_reg_id,
          },
          einvoiceStatus: stmt[0].ven_einvoice_status,
          costCenter: stmt[0].jw_cost_center,
        };

        let stmt2 = await invtDB.query(
          "SELECT * FROM `jw_purchase_req` WHERE `jw_jw_transaction` = :transaction AND `jw_po_sku` = :productkey AND `jw_purchase_req`.`company_branch` = :branch GROUP BY `jw_jw_transaction`",
          {
            replacements: {
              transaction: transaction,
              productkey: skucode,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (stmt2.length > 0) {
          let stmt3 = await invtDB.query(
            "SELECT `jw_purchase_req`.`jw_jw_transaction`, `jw_purchase_req`.`jw_po_order_qty`, `jw_purchase_req`.`jw_po_issue_qty`, `jw_purchase_req`.`jw_po_sku`, `jw_purchase_req`.`jw_po_recipe`, `bom_recipe`.`sfg_mapped_rm`, `components`.`c_name`, `components`.`c_part_no`, `units`.`units_name` FROM `jw_purchase_req` LEFT JOIN `bom_recipe` ON `jw_purchase_req`.`jw_po_recipe` = `bom_recipe`.`subject_id` LEFT JOIN `components` ON `bom_recipe`.`sfg_mapped_rm` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_purchase_req`.`jw_jw_transaction` = :transaction AND `jw_purchase_req`.`jw_po_sku` = :productkey AND `components`.`c_is_enabled` = 'Y' AND `jw_purchase_req`.`company_branch` = :branch GROUP BY `jw_purchase_req`.`jw_jw_transaction`",
            {
              replacements: {
                transaction: transaction,
                productkey: skucode,
                branch: req.branch,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );
          let final = [];
          if (stmt3.length > 0) {
            for (let i = 0; i < stmt3.length; i++) {
              final.push({
                component: {
                  name: stmt3[i].c_name,
                  part: stmt3[i].c_part_no,
                  key: stmt3[i].sfg_mapped_rm,
                },
                unit: stmt3[i].units_name,
                orderQty:
                  helper.number(stmt3[i].jw_po_order_qty) -
                  helper.number(stmt3[i].jw_po_issue_qty),
              });
            }

            return res.json({
              success: true,
              status: "success",
              data: {
                header: header,
                body: final,
              },
            });
          } else {
            return res.json({
              success: false,
              status: "error",
              message:
                "seems the product is not exist or it is under disabled mode therefore it can't be proceed for further transaction..",
            });
          }
        } else {
          return res.json({
            success: false,
            status: "error",
            message:
              "PO has been closed therefore it can't be proceed for further transaction..",
          });
        }
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "..unable to fetch any transaction request",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  },
);

// GET BOM RECIPE MAPPED WITH JOBWORK
async function getTotalPending(component, locIn, locOut, jwID) {
  const [row] = await invtDB.query(
    `
    SELECT
      /* TOTAL ISSUE QTY (JOBWORK) */
      COALESCE(SUM(
        CASE
          WHEN trans_type = 'JOBWORK'
           AND jw_transaction_id = :jwID
           AND components_id = :component
           AND loc_in = :locOut
          THEN qty + other_qty
          ELSE 0
        END
      ), 0) AS total_issue_qty,
 
      /* TOTAL RM RETURN QTY */
      COALESCE(SUM(
        CASE
          WHEN trans_type IN( 'TRANSFER', 'SFG-CONSUMPTION', 'CONSUMPTION' )
           AND jw_transaction_id = :jwID
           AND components_id = :component
           AND trans_mode IN ('return', 'default')
           AND loc_out = :locOut
          THEN qty + other_qty
          ELSE 0
        END
      ), 0) AS total_rm_return_qty
    FROM rm_location
    `,
    {
      replacements: {
        jwID,
        component,
        locIn,
        locOut,
      },
      type: invtDB.QueryTypes.SELECT,
    },
  );

  const total_issue_qty = row?.total_issue_qty || 0;
  const total_rm_return_qty = row?.total_rm_return_qty || 0;

  return {
    total_issue_qty,
    total_rm_return_qty,
  };
}

// router.get("/getBomItem", [auth.isAuthorized], async (req, res) => {
//   try {
//     const valid = new Validator(req.query, {
//       jwID: "required",
//       sfgCreateQty: "required",
//     });

//     if (valid.fails()) {
//       return res.json({
//         success: false,
//         message: helper.firstErrorValidatorjs(valid),
//         status: "error",
//       });
//     }

//     let stmt_jwpo_req = await invtDB.query(
//       "SELECT * FROM jw_purchase_req LEFT JOIN jw_bom_recipe ON jw_purchase_req.jw_po_sku = jw_bom_recipe.jw_bom_sku LEFT JOIN bom_recipe ON jw_purchase_req.jw_po_recipe = bom_recipe.subject_id WHERE jw_purchase_req.jw_jw_transaction = :jw_id LIMIT 1",
//       {
//         replacements: { jw_id: req.query.jwID },
//         type: invtDB.QueryTypes.SELECT,
//       },
//     );

//     if (stmt_jwpo_req.length > 0) {
//       if (stmt_jwpo_req[0].ven_location == "--") {
//         return res.json({
//           success: false,
//           status: "error",
//           message:
//             "Vendor location is not assigned, please map the location to proceed further..",
//         });
//       }
//       let stmt_comp = await invtDB.query(
//         "SELECT * FROM jw_bom_recipe LEFT JOIN components ON jw_bom_recipe.jw_bom_part = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE jw_bom_recipe.jw_bom_po_trans = :jw_id ORDER BY components.c_part_no ASC",
//         {
//           replacements: { jw_id: req.query.jwID },
//           type: invtDB.QueryTypes.SELECT,
//         },
//       );

//       if (stmt_comp.length > 0) {

//         result = [];

//         for (let i = 0; i < stmt_comp.length; i++) {
//           const { total_issue_qty, total_rm_return_qty } =
//             await getTotalPending(
//               stmt_comp[i].component_key,
//               stmt_jwpo_req[0].ven_location,
//               stmt_jwpo_req[0].ven_location,
//               req.query.jwID,
//             );

//           const consump_qty = helper.number(
//             stmt_jwpo_req[0].jw_po_issue_qty * stmt_comp[i].jw_bom_qty >
//               total_issue_qty - total_rm_return_qty
//               ? total_issue_qty - total_rm_return_qty
//               : stmt_jwpo_req[0].jw_po_issue_qty * stmt_comp[i].jw_bom_qty,
//           );

//           result.push({
//             key: stmt_comp[i].component_key,
//             catPartName: stmt_comp[i].c_new_part_no,
//             part_no: stmt_comp[i].c_part_no,
//             part_name: stmt_comp[i].c_name,
//             uom: stmt_comp[i].units_name,
//             bom_qty: helper.number(stmt_comp[i].jw_bom_qty),
//             rqd_qty:
//               helper.number(stmt_comp[i].jw_bom_qty) *
//               helper.number(req.query.sfgCreateQty),
//             pendingWithjobwork: helper
//               .number(total_issue_qty - total_rm_return_qty)
//               .toFixed(0),
//             pia_status: stmt_comp[i].pia_status,
//           });
//         }

//         return res.json({ success: true, status: "success", data: result });
//       } else {
//         return res.json({
//           success: false,
//           message: "BOM configuration not found",
//           status: "error",
//         });
//       }
//     } else {
//       return res.json({
//         success: false,
//         status: "error",
//         message:
//           "Invalid transaction id we could not find anything.. against product sku [${product_sku}]",
//       });
//     }
//   } catch (err) {
//     console.log(err);
//     return helper.errorResponse(res, err);
//   }
// });
router.post("/bom-items", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.query, {
      jwID: "required",
      sfgCreateQty: "required",
      type: "required|in:manual,excel",
    });

    if (valid.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: helper.firstErrorValidatorjs(valid),
      });
    }

    const isExcel = req.query.type === "excel";
    const jwID = req.query.jwID;
    const sfgCreateQty = helper.number(req.query.sfgCreateQty);

    let excelParts = [];
    let excelRemarks = [];

    if (isExcel) {
      excelParts = Array.isArray(req.body.part)
        ? req.body.part
        : String(req.body.part ?? "").split(",").map((s) => s.trim()).filter(Boolean);

      excelRemarks = Array.isArray(req.body.remark)
        ? req.body.remark
        : String(req.body.remark ?? "").split(",").map((s) => s.trim()).filter(Boolean);

      if (excelParts.length === 0) {
        return res.json({
          success: false,
          status: "error",
          message: "part[] is required for excel transaction",
        });
      }
    }

    const [stmt_jwpo_req] = await invtDB.query(
      `SELECT jw_purchase_req.*, jw_bom_recipe.*, bom_recipe.*
       FROM jw_purchase_req
       LEFT JOIN jw_bom_recipe ON jw_purchase_req.jw_po_sku = jw_bom_recipe.jw_bom_sku
       LEFT JOIN bom_recipe ON jw_purchase_req.jw_po_recipe = bom_recipe.subject_id
       WHERE jw_purchase_req.jw_jw_transaction = :jwID
       LIMIT 1`,
      { replacements: { jwID }, type: invtDB.QueryTypes.SELECT }
    );

    if (!stmt_jwpo_req) {
      return res.json({
        success: false,
        status: "error",
        message: "Invalid transaction id, could not find anything against product sku",
      });
    }

    if (stmt_jwpo_req.ven_location === "--") {
      return res.json({
        success: false,
        status: "error",
        message: "Vendor location is not assigned, please map the location to proceed further..",
      });
    }

    const venLocation = stmt_jwpo_req.ven_location;

    const stmt_comp = await invtDB.query(
      `SELECT
        components.component_key,
        components.c_part_no,
        components.c_new_part_no,
        components.c_name,
        components.c_specification,
        components.pia_status,
        units.units_name,
        jw_bom_recipe.jw_bom_qty
       FROM jw_bom_recipe
       LEFT JOIN components ON components.component_key = jw_bom_recipe.jw_bom_part
       LEFT JOIN units ON units.units_id = components.c_uom
       WHERE jw_bom_recipe.jw_bom_po_trans = :jwID
       ORDER BY components.c_part_no ASC`,
      { replacements: { jwID }, type: invtDB.QueryTypes.SELECT }
    );

    if (stmt_comp.length === 0) {
      return res.json({
        success: false,
        status: "error",
        message: "BOM configuration not found",
      });
    }

    if (isExcel) {
      const validBomPartNos = new Set(
        stmt_comp.map((r) => String(r.c_part_no).toLowerCase())
      );

      const invalidParts = excelParts
        .map((part, row) => ({ row, part }))
        .filter(({ part }) => !validBomPartNos.has(String(part).trim().toLowerCase()));

      if (invalidParts.length > 0) {
        return res.json({
          success: false,
          status: "error",
          message: invalidParts
            .map(({ row, part }) => `\`${part}\` in row {${row}} is not exist in BOM`)
            .join(", "),
        });
      }
    }

    const itemsToProcess = isExcel
      ? excelParts.map((part, i) => ({
          comp: stmt_comp.find(
            (r) => String(r.c_part_no).toLowerCase() === String(part).trim().toLowerCase()
          ),
          remarkIndex: i,
        }))
      : stmt_comp.map((comp) => ({ comp, remarkIndex: null }));

    const result = await Promise.all(
      itemsToProcess.map(async ({ comp, remarkIndex }) => {
        const { total_issue_qty, total_rm_return_qty } = await getTotalPending(
          comp.component_key,
          venLocation,
          venLocation,
          jwID
        );

        const pending = helper.number(total_issue_qty - total_rm_return_qty);

        const entry = {
          key:                comp.component_key,
          cat_part_code:      comp.c_new_part_no,
          part_no:            comp.c_part_no,
          part_name:          comp.c_name,
          specification:      comp.c_specification,
          uom:                comp.units_name,
          bom_qty:            helper.number(comp.jw_bom_qty),
          rqd_qty:            helper.number(comp.jw_bom_qty) * sfgCreateQty,
          pending_jw_qty: pending.toFixed(0),
          pia_status:         comp.pia_status,
        };

        if (isExcel) {
          entry.remark = excelRemarks[remarkIndex] ?? "";
        }

        return entry;
      })
    );

    return res.json({ success: true, status: "success", data: result });

  } catch (err) {
    console.log(err);
    return helper.errorResponse(res, err);
  }
});


// SAVE JW SF INWARD
router.post(
  "/savejwsfinward",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    try {
      const check_min_type = await otherDB.query(
        "SELECT * FROM erp_setting WHERE setting_code = '65432' ",
        {
          type: otherDB.QueryTypes.SELECT,
        },
      );

      if (check_min_type.length > 0) {
        if (check_min_type[0].setting_value == "cost_center") {
          // CHECK COST CENTER VALIDATION

          const cost_center_loc = await invtDB.query(
            "SELECT * FROM location_main WHERE loc_costcenter = :cost_center",
            {
              replacements: {
                cost_center: req.body.cost_center,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          if (cost_center_loc.length == 0) {
            res.json({
              success: false,
              status: "error",
              message: "Location not found for this cost center",
            });
            return;
          }

          const cc_locs = [];
          for (let i = 0; i < cost_center_loc.length; i++) {
            cc_locs.push(cost_center_loc[i].location_key);
          }
          const intersection = cc_locs.filter((element) =>
            req.body.drop_location.includes(element),
          );

          if (intersection.length == 0) {
            res.json({
              message: "Cost center not found for this location",
              status: false,
            });
            return;
          }
          return require("../../../controller/jobwork/jobworkC").savejwsfinward(
            req,
            res,
          );
        } else if (check_min_type[0].setting_value == "standard") {
          return require("../../../controller/jobwork/jobworkC").savejwsfinward(
            req,
            res,
          );
        } else {
          return res.json({
            success: false,
            status: "error",
            message: "Setup not found for location !!!",
          });
        }
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "JW MIN Setting Not Found ",
        });
      }
    } catch (err) {
      console.log(err);
      return helper.errorResponse(res, err);
    }
  },
);

// FETCH JW RM RETURN
router.post("/fetchJwRmReturn", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      data: "required",
      wise: "required",
    });

    if (validation.fails()) {
      res.json({
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
    }

    const { data, wise } = req.body;
    let stmt;

    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE DATE_FORMAT(`jw_purchase_req`.`jw_po_full_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `jw_purchase_req`.`jw_po_status` = 'A' AND `jw_purchase_req`.`company_branch` = :branch GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { date1: date1, date2: date2, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "vendorwise") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_po_vendor_reg_id` = :venid AND `jw_purchase_req`.`jw_po_status` = 'A' AND `jw_purchase_req`.`company_branch` = :branch GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { venid: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "jw_transaction_wise") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_purchase_req`.`jw_jw_transaction` LIKE CONCAT('%', :jw_id, '%') AND `jw_purchase_req`.`jw_po_status` = 'A' AND `jw_purchase_req`.`company_branch` = :branch GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { jw_id: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "jw_sfg_wise") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_po_sku` = :sfgcode AND `jw_purchase_req`.`jw_po_status` = 'A' AND `jw_purchase_req`.`company_branch` = :branch GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { sfgcode: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "Please select valid filter method",
      });
    }

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          date: moment(stmt[i].jw_po_full_date, "YYYY-mm-DD HH:mm:ss").format(
            "DD-MM-YYYY",
          ),
          transaction_id: stmt[i].jw_jw_transaction,
          sku_code: stmt[i].p_sku,
          vendor: stmt[i].ven_name + " (" + stmt[i].jw_po_vendor_reg_id + ")",
          vendorCode: stmt[i].jw_po_vendor_reg_id,
          sku_name: stmt[i].p_name,
          ord_qty: stmt[i].jw_po_order_qty,
          sku: stmt[i].product_key,
        });
      }
      return res.json({ success: true, status: "success", data: final });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "no orders were found that match the given search criteria.",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

async function functionQtyInwardReturn(
  transaction,
  component,
  warehouseLoc,
  venLocation,
) {
  const [row] = await invtDB.query(
    `
    SELECT
      /* 🔹 Total Issued to Vendor */
      COALESCE(
        SUM(
          CASE
            WHEN trans_type = 'JOBWORK'
             AND jw_transaction_id = :transaction_id
             AND components_id = :component_id
             AND loc_in = :venLocation
             AND loc_out = :warehouseLoc
            THEN (qty + other_qty)
            ELSE 0
          END
        ), 0
      ) AS total_issue_qty,
 
      /* 🔹 Total Returned from Vendor */
      COALESCE(
        SUM(
          CASE
            WHEN trans_type = 'INWARD'
             AND in_jw_transaction_id = :transaction_id
             AND components_id = :component_id
             AND trans_mode = 'return'
             AND loc_in = :venLocation
             AND loc_out = :warehouseLoc
            THEN (qty + other_qty)
            ELSE 0
          END
        ), 0
      ) AS total_return_qty
 
    FROM rm_location
    `,
    {
      replacements: {
        transaction_id: transaction,
        component_id: component,
        warehouseLoc,
        venLocation,
      },
      type: invtDB.QueryTypes.SELECT,
    },
  );

  const total_issue_qty = Number(row?.total_issue_qty || 0);
  const total_return_qty = Number(row?.total_return_qty || 0);

  return {
    total_issue_qty,
    total_return_qty,
  };
}

// Get JW RM Return Data
router.post("/getJwRmReturnData", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      skucode: "required",
      transaction: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: validation.errors.errors,
      });
    }

    const { skucode, transaction } = req.body;

    let stmt = await invtDB.query(
      "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_purchase_req`.`jw_po_sku` = :productcode AND `jw_purchase_req`.`jw_jw_transaction` = :transaction AND `jw_purchase_req`.`company_branch` = :branch GROUP BY `jw_purchase_req`.`jw_jw_transaction`",
      {
        replacements: {
          productcode: skucode,
          transaction: transaction,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (stmt.length > 0) {
      let stmt_0 = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` WHERE `jw_po_bom_recipe` = 'CREATED' AND  `jw_jw_transaction` = :transaction AND `company_branch` = :branch",
        {
          replacements: { transaction: transaction, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
      if (stmt_0.length > 0) {
        let jw_status = "";
        if (stmt[0].jw_po_issue_qty == "0" && stmt[0].jw_po_status == "A") {
          jw_status = "Created";
        } else if (
          stmt[0].jw_po_issue_qty !== "0" &&
          stmt[0].jw_po_status == "A"
        ) {
          jw_status = "Processing...";
        } else {
          jw_status = "Closed";
        }

        let header = {
          sku_code: stmt[0].p_sku,
          product_name: stmt[0].p_name,
          jobwork_id: stmt[0].jw_jw_transaction,
          registered_date: moment(stmt[0].jw_po_full_date, "YYYY-MM-DD").format(
            "DD-MM-YYYY",
          ),
          created_by: stmt[0].user_name,
          ordered_qty: stmt[0].jw_po_order_qty + " " + stmt[0].units_name,
          jw_status: jw_status,
          proceed_qty: stmt[0].jw_po_issue_qty,
          vendor: {
            name: stmt[0].ven_name,
            code: stmt[0].ven_register_id,
          },
        };

        let stmt2 = await invtDB.query(
          "SELECT * FROM `jw_purchase_req` WHERE `company_branch` = :branch AND `jw_jw_transaction` = :transaction AND `jw_po_sku` = :productcode GROUP BY `jw_jw_transaction`",
          {
            replacements: {
              transaction: transaction,
              productcode: skucode,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );

        if (stmt2.length > 0) {
          // let bom_subject = stmt2[0].jw_po_recipe;
          let stmt3 = await invtDB.query(
            "SELECT * FROM `jw_bom_recipe` LEFT JOIN `components` ON `jw_bom_recipe`.`jw_bom_part` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_bom_recipe`.`jw_bom_sku` = :productcode AND `jw_bom_recipe`.`jw_bom_po_trans` = :transaction AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' ORDER BY `components`.`c_part_no` ASC",
            {
              replacements: { productcode: skucode, transaction: transaction },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          if (stmt3.length > 0) {
            let final = [];

            for (let i = 0; i < stmt3.length; i++) {
              let hsncode = "--";
              if (stmt3[i].c_hsn != "--") {
                hsncode = stmt3[i].c_hsn;
              }

              // PENDING WITH JOBWORKPO

              const [
                [total_sfg_consump],
                [total_iss],
                [total_ret],
                [total_consump],
              ] = await Promise.all([
                invtDB.query(
                  "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_sfg_consump FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'SFG-CONSUMPTION' AND trans_mode = 'default'",
                  {
                    replacements: {
                      component_id: stmt3[i].component_key,
                      transaction_id: transaction,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  },
                ),

                invtDB.query(
                  "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_issued_rm FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'JOBWORK'",
                  {
                    replacements: {
                      component_id: stmt3[i].component_key,
                      transaction_id: transaction,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  },
                ),

                invtDB.query(
                  "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_returned_rm FROM rm_location WHERE trans_type = 'TRANSFER' AND in_jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_mode = 'return'",
                  {
                    replacements: {
                      component_id: stmt3[i].component_key,
                      transaction_id: transaction,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  },
                ),

                invtDB.query(
                  "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_consumption FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'CONSUMPTION' AND trans_mode = 'default'",
                  {
                    replacements: {
                      component_id: stmt3[i].component_key,
                      transaction_id: transaction,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  },
                ),
              ]);

              const consump_qty = helper.number(
                total_consump.total_consumption >
                  total_iss.total_issued_rm - total_ret.total_returned_rm
                  ? total_iss.total_issued_rm - total_ret.total_returned_rm
                  : total_consump.total_consumption,
              );

              const stmt_jwpo_req = await invtDB.query(
                "SELECT jw_po_issue_qty FROM jw_purchase_req LEFT JOIN jw_bom_recipe ON jw_purchase_req.jw_po_sku = jw_bom_recipe.jw_bom_sku LEFT JOIN bom_recipe ON jw_purchase_req.jw_po_recipe = bom_recipe.subject_id WHERE jw_purchase_req.jw_jw_transaction = :jw_id LIMIT 1",
                {
                  replacements: { jw_id: transaction },
                  type: invtDB.QueryTypes.SELECT,
                },
              );

              const pendingWithJw = helper
                .number(
                  total_iss.total_issued_rm -
                    (total_sfg_consump.total_sfg_consump +
                      total_ret.total_returned_rm +
                      consump_qty),
                )
                .toFixed(2);

              // END PENDING WITH JOBWORKPO
              // if (stmt3[i].component_key == '20243212419118') {

              //   console.log("=================================");

              //   console.log(
              //     consump_qty,
              //     total_iss.total_issued_rm,
              //     total_ret.total_returned_rm,
              //     total_sfg_consump.total_sfg_consump,
              //     pendingWithJw,
              //   );
              //   console.log("=================================");
              // }

              final.push({
                jobwork_id: stmt3[i].jw_bom_po_trans,
                component: stmt3[i].c_name,
                component_key: stmt3[i].component_key,
                unitsname: stmt3[i].units_name,
                partcode: stmt3[i].c_part_no,
                gst_rate: stmt3[i].c_gst,
                hsncode: hsncode,
                pendingWithJw: pendingWithJw,
              });
            }

            return res.json({
              success: true,
              status: "success",
              data: {
                header: header,
                body: final,
              },
            });
          } else {
            return res.json({
              success: false,
              status: "error",
              message: "PO may be close or part are disabled.",
            });
          }
        } else {
          return res.json({
            success: false,
            status: "error",
            message: {
              msg: "PO has been closed therefore it can't be update..2",
            },
          });
        }
      } else {
        return res.json({
          success: false,
          status: "error",
          message:
            "you can not return the materials, first create it's BOM and challan for the same..",
        });
      }
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "unable to fetch any transaction request",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET RM RETURN LOCATIONS
// router.get("/jw_rm_return_location", [auth.isAuthorized], async (req, res) => {
//   try {
//     let stmt1 = await invtDB.query(
//       "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
//       {
//         replacements: { location_key: "20220212163440" },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );
//     // string to array
//     let loc_ids = stmt1[0].locations.split(",");
//     let locations = [];
//     for (let i = 0; i < loc_ids.length; i++) {
//       let stmt2 = await invtDB.query(
//         "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
//         {
//           replacements: { location_defined: loc_ids[i] },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );

//       stmt2.forEach((element) => {
//         locations.push({ id: element.location_key, text: element.loc_name });
//       });

//       if (i == loc_ids.length - 1) {
//         return res.json({ code: 200, status: "success", data: locations });
//       }
//     }
//   } catch (err) {
//     return res.json({
//       code: 500,
//       message: {
//         msg: "Internal Error<br/>If this condition persists, contact your system administrator",
//       },
//       status: "error",
//       error: err.stack,
//     });
//   }
// });

router.get("/jw_rm_return_location", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.query, {
    vendor: "required",
    jw: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: validation.errors.all(),
      status: "error",
    });
  }

  try {
    let stmt = await invtDB.query(
      `SELECT location
       FROM jw_purchase_req
       WHERE jw_jw_transaction = :jw
       AND jw_po_vendor_reg_id = :vendor`,
      {
        replacements: {
          jw: req.query.jw,
          vendor: req.query.vendor,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (
      stmt.length === 0 ||
      !stmt[0].location ||
      stmt[0].location.trim() === "--"
    ) {
      return res.json({
        success: false,
        status: "error",
        message: "Vendor not found OR Return Location not yet configured",
      });
    }

    let locations = await invtDB.query(
      `SELECT 
         l.location_key AS \`key\`,
         l.loc_name AS \`name\`
       FROM location_main l
       WHERE FIND_IN_SET(
         l.location_key,
         REPLACE(:ven_location, ' ', '')
       )`,
      {
        replacements: {
          ven_location: stmt[0].location,
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    return res.json({
      success: true,
      status: "success",
      data: locations,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Upload the File While Creating JW RETURN
router.post(
  "/uploadRTNFile",
  upload.single("file"),
  [auth.isAuthorized],
  async (req, res) => {
    try {
      // VALIDATE FILE
      if (req.file == undefined) {
        return res.json({
          success: false,
          status: "error",
          message: "Please select a file",
        });
      }

      // Validate file extension (should be .xlsx)
      const fileExtension = req.file.originalname.split(".").pop();
      if (fileExtension !== "xlsx") {
        return res.json({
          success: false,
          status: "error",
          message: "File format must be .xlsx",
        });
      }

      var workbook = XLSX.readFile("./uploads/temp/" + req.file.filename);
      let json_data = XLSX.utils.sheet_to_json(workbook.Sheets.Sheet1);

      let data = [];
      let errors = [];
      let invoiceNoSet = new Set();
      let partCodeMap = new Map();
      let partCodes = json_data.map((item) => item.PARTCODE);

      let componentData = await invtDB.query(
        "SELECT `c_part_no`, `c_name` FROM `components` WHERE `c_part_no` IN (:part_codes)",
        {
          replacements: { part_codes: partCodes },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      let componentMap = new Map();
      componentData.forEach((component) => {
        componentMap.set(component.c_part_no, component.c_name);
      });

      // Check for empty PARTCODE or INVOICE
      await Promise.all(
        json_data.map(async (item, index) => {
          if (!item.PARTCODE || item.PARTCODE.replace(/\s+/g, "") === "") {
            errors.push(
              `PARTCODE is empty or contains only spaces in row no. ${
                index + 2
              }`,
            );
            return;
          }

          if (!item.INVOICE || item.INVOICE.replace(/\s+/g, "") === "") {
            errors.push(
              `INVOICE is empty or contains only spaces in row no. ${index + 2}`,
            );
            return;
          }

          // Rest of your logic here
          if (!componentMap.has(item.PARTCODE)) {
            errors.push(
              `Part code not valid (${item.PARTCODE}) in file row no. ${
                index + 2
              }`,
            );
            return;
          }

          let c_part_name = componentMap.get(item.PARTCODE);

          // Track unique INVOICE with trimmed spaces
          invoiceNoSet.add(item.INVOICE.replace(/\s+/g, ""));
          if (invoiceNoSet.size > 1) {
            errors.push(
              `Multiple INVOICE values found. Error in row no. ${index + 2}`,
            );
            return;
          }

          // Check for duplicate PARTCODEs
          if (partCodeMap.has(item.PARTCODE)) {
            let rows = partCodeMap.get(item.PARTCODE);
            rows.push(index + 2);
            partCodeMap.set(item.PARTCODE, rows);
          } else {
            partCodeMap.set(item.PARTCODE, [index + 2]);
          }

          data.push({
            partCode: item.PARTCODE.trim(),
            partName: c_part_name,
            qty: item.QTY,
            rate: item.RATE,
            hsn: item.HSNCODE,
            invoice: item.INVOICE.replace(/\s+/g, ""),
          });
        }),
      );

      let duplicates = [];
      partCodeMap.forEach((rows, partCode) => {
        if (rows.length > 1) {
          duplicates.push(
            `Part code ${partCode} found in rows: ${rows.join(", ")}`,
          );
        }
      });

      if (duplicates.length > 0) {
        errors.push(`Duplicate part codes found: ${duplicates.join("; ")}`);
      }

      if (errors.length > 0) {
        return res.json({
          success: false,
          message: errors.join("; "),
          status: "error",
        });
      }

      // Unlink file
      fs.unlinkSync("./uploads/temp/" + req.file.filename);
      return res.json({ data, success: true, status: "success" });
    } catch (err) {
      console.log(err);
      return helper.errorResponse(res, err);
    }
  },
);

// SAVE JW RM RETURN
router.post(
  "/saveJwRmReturn",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      const validation = new Validator(req.body, {
        trans_id: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: validation.errors.all(),
        });
      }

      const { trans_id } = req.body;
      const compo_length = req.body.component.length;

      /* 🔹 Check BOM exists */
      const stmt_jw_pur_req = await invtDB.query(
        "SELECT * FROM jw_purchase_req WHERE jw_po_bom_recipe = 'CREATED'",
        { type: invtDB.QueryTypes.SELECT },
      );

      if (!stmt_jw_pur_req.length) {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message:
            "You can not return the materials, first create it's BOM and challan for the same..",
        });
      }

      /* 🔹 Fetch JW + BOM data */
      const stmt = await invtDB.query(
        `
        SELECT *, jbr.jw_bom_part, jbr.jw_bom_qty
        FROM jw_purchase_req
        LEFT JOIN jw_bom_recipe jbr ON jbr.jw_bom_sku = jw_purchase_req.jw_po_sku
        LEFT JOIN products ON jw_purchase_req.jw_po_sku = products.p_sku
        LEFT JOIN units ON products.p_uom = units.units_id
        LEFT JOIN admin_login ON jw_purchase_req.jw_po_insert_by = admin_login.CustID
        LEFT JOIN ven_basic_detail ON jw_purchase_req.jw_po_vendor_reg_id = ven_basic_detail.ven_register_id
        WHERE jw_purchase_req.jw_jw_transaction = :transaction
          AND jw_purchase_req.company_branch = :branch
        `,
        {
          replacements: { transaction: trans_id, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (!stmt.length) {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Invalid Jobwork transaction",
        });
      }

      const bomQtyMap = {};
      stmt.forEach((r) => {
        bomQtyMap[r.jw_bom_part] = helper.number(r.jw_bom_qty);
      });

      const {
        ven_register_id: vendor,
        jw_po_vendor_address: address,
        jw_po_vendor_type: vendor_type,
        jw_po_ven_add_id: branch,
        jw_po_recipe: recipe,
        location,
        ven_location,
        jw_po_issue_qty,
      } = stmt[0];

      /* 🔹 Generate MIN number */
      const [numRow] = await invtDB.query(
        "SELECT * FROM ims_numbering WHERE for_number='MIN' FOR UPDATE",
        { transaction, type: invtDB.QueryTypes.SELECT },
      );

      let in_txn_no;
      let out_txn_no = helper.getUniqueNumber();
      let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");

      if (numRow) {
        let suffix = String(Number(numRow.suffix) + 1).padStart(
          numRow.number_length_limit,
          "0",
        );
        in_txn_no = `${numRow.prefix}/${numRow.session}/${suffix}`;
      } else {
        let y = new Date().getFullYear().toString().slice(-2);
        in_txn_no = `MIN/${y}-${Number(y) + 1}/0001`;
      }

      await invtDB.query(
        "UPDATE ims_numbering SET suffix = suffix + 1 WHERE for_number='MIN'",
        { transaction },
      );

      /* 🔁 COMPONENT LOOP */
      for (let i = 0; i < compo_length; i++) {
        const componentId = req.body.component[i];
        const bomQty = bomQtyMap[componentId] || 0;

        /* 🔹 Get vendor issued & returned qty */
        const [[total_sfg_consump], [total_iss], [total_ret], [total_consump]] =
          await Promise.all([
            invtDB.query(
              "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_sfg_consump FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'SFG-CONSUMPTION' AND trans_mode = 'default'",
              {
                replacements: {
                  component_id: componentId,
                  transaction_id: trans_id,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),

            invtDB.query(
              "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_issued_rm FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'JOBWORK'",
              {
                replacements: {
                  component_id: componentId,
                  transaction_id: trans_id,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),

            invtDB.query(
              "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_returned_rm FROM rm_location WHERE trans_type = 'TRANSFER' AND in_jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_mode = 'return'",
              {
                replacements: {
                  component_id: componentId,
                  transaction_id: trans_id,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),

            invtDB.query(
              "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_consumption FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'CONSUMPTION' AND trans_mode = 'default'",
              {
                replacements: {
                  component_id: componentId,
                  transaction_id: trans_id,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),
          ]);

        const consump_qty = helper.number(
          total_consump.total_consumption >
            total_iss.total_issued_rm - total_ret.total_returned_rm
            ? total_iss.total_issued_rm - total_ret.total_returned_rm
            : total_consump.total_consumption,
        );

        const pendingWithJw = helper
          .number(
            total_iss.total_issued_rm -
              (total_sfg_consump.total_sfg_consump +
                total_ret.total_returned_rm +
                consump_qty),
          )
          .toFixed(2);
        // const { total_issue_qty, total_return_qty } =
        //   await functionQtyInwardReturn(
        //     trans_id,
        //     componentId,
        //     location,
        //     ven_location
        //   );

        /* 🔹 Consumption logic (UNCHANGED) */
        // const maxConsumableQty = helper.number(jw_po_issue_qty * bomQty);
        // const pendingQty = helper.number(total_issue_qty - total_return_qty);

        // const consump_qty =
        //   maxConsumableQty > pendingQty ? pendingQty : maxConsumableQty;

        // /* 🔹 Vendor stock AFTER consumption logic */
        // const vendorStock = helper.number(
        //   total_issue_qty - consump_qty - total_return_qty
        // );

        // if(componentId == '20243212419118') {
        //   console.log("=================================");
        //   console.log("ISSUE QTY",total_iss.total_issued_rm);
        //   console.log("SFG CONSUMPTION",total_sfg_consump.total_sfg_consump);
        //   console.log("RETURNED",total_ret.total_returned_rm);
        //   console.log("CONSUMPTION",consump_qty);
        //   console.log("PENDING WITH JW",pendingWithJw);
        //   console.log("=================================");
        //   return;
        // }

        if (pendingWithJw < helper.number(req.body.qty[i])) {
          await transaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: `Insufficient stock for component row ${
              i + 1
            }. Available: ${pendingWithJw}`,
          });
        }

        /* 🔹 INSERT RM RETURN (INWARD) */
        await invtDB.query(
          "INSERT INTO `rm_location` (`min_ewaybill`,`trans_mode`,`trans_type`,`company_branch`,`jw_transaction_id`,`in_jw_transaction_id`,`bom_subject_id`,`vendor_type`,`components_id`,`loc_in`,`loc_out`,`qty`,`insert_date`,`insert_by`,`transfer_transaction_id`,`in_invoice_id`,`in_vendor_name`,`in_vendor_branch`,`in_vendor_addr`,`in_hsn_code`,`in_po_rate`,`rejection_any_remark`)VALUES (:ewaybill,:transmode,:transtype,:branch,:jobwork_id,:in_jw_transaction_id,:recipe,:vendorType,:component,:location_in,:location_out,:qty,:insertdate,:insertby,:transaction_id,:invoice_id,:vendor_code,:vendor_branch,:vendor_address,:hsncode,:rate,:remark)",
          {
            replacements: {
              ewaybill: req.body.ewaybill == "" ? "--" : req.body.ewaybill,
              transmode: "return",
              transtype: "TRANSFER",
              branch: req.branch,
              jobwork_id: trans_id,
              in_jw_transaction_id: trans_id,
              recipe: recipe,
              vendorType: "j01",
              component: componentId,
              location_in: req.body.in_location[i],
              location_out: ven_location,
              qty: req.body.qty[i],
              insertdate: insert_dt,
              insertby: req.logedINUser,
              transaction_id: in_txn_no,
              invoice_id: req.body.invoice[i],
              vendor_code: vendor,
              vendor_branch: branch,
              vendor_address: address,
              hsncode: req.body.hsncode[i],
              rate: req.body.rate[i],
              remark: req.body.remark[i] == "" ? "--" : req.body.remark[i],
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );

        /* 🔹 AUTO CONSUMPTION ISSUE (ORIGINAL LOGIC) */
        if (req.body.out_location[i] != 0) {
          await invtDB.query(
            "INSERT INTO `rm_location` (`company_branch`,`trans_type`,`components_id`,`loc_in`,`loc_out`,`qty`,`insert_date`,`insert_by`,`transfer_transaction_id`,`out_transaction_id`,`is_auto_cons`,`any_remark`)VALUES (:branch,:type,:component,:loc_in,:loc_out,:qty,:indate,:inby,:transaction_id,:out_transaction_id,'Y',:comment)",
            {
              replacements: {
                branch: req.branch,
                type: "ISSUE",
                component: componentId,
                loc_in: req.body.out_location[i],
                loc_out: req.body.in_location[i],
                qty: req.body.qty[i],
                indate: moment().format("YYYY-MM-DD HH:mm:ss"),
                inby: req.logedINUser,
                transaction_id: in_txn_no,
                out_transaction_id: out_txn_no,
                comment: req.body.remark[i] == "" ? "--" : req.body.remark[i],
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: transaction,
            },
          );
        }
      }

      /* 🔹 Save transaction reference */
      await invtDB.query(
        "INSERT INTO transaction_ids (transaction_id,module_type) VALUES (:txn,'MIN-JW-RETURN')",
        { replacements: { txn: in_txn_no }, transaction },
      );

      await transaction.commit();

      return res.json({
        success: true,
        status: "success",
        data: { txn: in_txn_no },
        message:
          "RM return inward completed successfully. Transaction ref ID [" +
          in_txn_no +
          "]",
      });
    } catch (err) {
      console.error(err);
      await transaction.rollback();
      return helper.errorResponse(res, err);
    }
  },
);

// FETCH JW COMPLECTED LIST
router.post(
  "/fetch_jw_completed_list",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        data: "required",
        wise: "required",
      });

      if (validation.fails()) {
        return res.json({
          success: false,
          message: "something you missing in form field to supply",
          status: "error",
        });
      }

      const { data, wise } = req.body;
      let stmt;

      if (wise == "datewise") {
        const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
        const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
        const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

        stmt = await invtDB.query(
          "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` WHERE `jw_purchase_req`.`company_branch` = :branch AND DATE_FORMAT(`jw_purchase_req`.`jw_po_full_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `jw_purchase_req`.`jw_po_status` = 'C' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
          {
            replacements: { date1: date1, date2: date2, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          },
        );
      } else if (wise == "vendorwise") {
        stmt = await invtDB.query(
          "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` WHERE `jw_purchase_req`.`company_branch` = :branch AND `jw_po_vendor_reg_id` = :venid AND `jw_purchase_req`.`jw_po_status` = 'C' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
          {
            replacements: { venid: data, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          },
        );
      } else if (wise == "jw_transaction_wise") {
        stmt = await invtDB.query(
          "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` WHERE `jw_purchase_req`.`company_branch` = :branch AND `jw_purchase_req`.`jw_jw_transaction` LIKE CONCAT('%', :jw_id, '%') AND `jw_purchase_req`.`jw_po_status` = 'C' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
          {
            replacements: { jw_id: data, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          },
        );
      } else if (wise == "jw_sfg_wise") {
        stmt = await invtDB.query(
          "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` WHERE `jw_purchase_req`.`company_branch` = :branch AND `jw_po_sku` = :sfgcode AND `jw_purchase_req`.`jw_po_status` = 'C' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
          {
            replacements: { sfgcode: data, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          },
        );
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "Please select valid filter method",
        });
      }

      if (stmt.length > 0) {
        let final = [];

        for (let i = 0; i < stmt.length; i++) {
          final.push({
            status: "--",
            date: moment(stmt[i].jw_po_full_date, "YYYY-MM-DD").format(
              "DD-MM-YYYY",
            ),
            transaction_id: stmt[i].jw_jw_transaction,
            sku_code: stmt[i].p_sku,
            sku_key: stmt[i].product_key,
            sku_name: stmt[i].p_name,
            ord_qty: stmt[i].jw_po_order_qty + " / " + stmt[i].jw_po_issue_qty,
          });
        }

        return res.json({ success: true, status: "success", data: final });
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "no orders were found that match the given search criteria.",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  },
);

// VIEW COMPLETED JW DETAILS
router.post(
  "/view_completed_jw_details",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        jwcode: "required",
      });

      if (validation.fails()) {
        return res.json({
          success: false,
          status: "error",
          message: validation.errors.errors,
        });
      }

      let stmt = await invtDB.query(
        "SELECT *, COALESCE(SUM(`jw_order_qty`), 0) AS `totalInward` FROM `jw_material_challan` WHERE `jw_transaction` = :transaction AND `company_branch` = :branch GROUP BY `jw_challan_ref_id`",
        {
          replacements: { transaction: req.body.jwcode, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (stmt.length > 0) {
        let final = [];

        for (let i = 0; i < stmt.length; i++) {
          final.push({
            challantxn: stmt[i].jw_challan_txn_id,
            challandate: moment(stmt[i].jw_insert_dt, "YYYY-MM-DD").format(
              "DD-MM-YYYY",
            ),
            challanqty: stmt[0].totalInward,
            refid: Buffer.from(stmt[i].jw_challan_ref_id.toString()).toString(
              "base64",
            ),
            transaction: Buffer.from(req.body.jwcode.toString()).toString(
              "base64",
            ),
            skucode: Buffer.from(stmt[i].jw_component_id.toString()).toString(
              "base64",
            ),
          });
        }

        return res.json({ success: true, status: "success", data: final });
      } else {
        return res.json({
          success: false,
          status: "error",
          message: "No data found",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  },
);

// FETCH SF-CONSUMPT COMPONENT
router.post(
  "/getjwsfinwardConsumption",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        minTxn: "required",
      });
      if (validation.fails()) {
        res.json({
          success: false,
          message: validation.errors.all(),
        });
      }

      let stmt = await invtDB.query(
        "SELECT components.c_part_no, components.c_new_part_no, components.c_name, units.units_name, admin_login.user_name AS insert_user, rm_location.* FROM rm_location LEFT JOIN components ON components.component_key = rm_location.components_id LEFT JOIN units ON units.units_id = components.c_uom LEFT JOIN admin_login ON admin_login.CustID = rm_location.insert_by WHERE rm_location.trans_type = 'SFG-CONSUMPTION' AND rm_location.in_transaction_id = :minTxn",
        {
          replacements: { minTxn: req.body.minTxn },
          type: invtDB.QueryTypes.SELECT,
        },
      );
      if (stmt.length > 0) {
        let final = [];
        for (let i = 0; i < stmt.length; i++) {
          final.push({
            date: moment(stmt[i].insert_date, "YYYY-MM-DD HH:mm:ss").format(
              "DD-MM-YYYY HH:mm:ss",
            ),
            by: stmt[i].insert_user,
            partName: stmt[i].c_name,
            partCode: stmt[i].c_part_no,
            catPartCode: stmt[i].c_new_part_no,
            qty: stmt[i].qty,
            uom: stmt[i].units_name,
            invNo: stmt[i].in_invoice_id,
            jwID: stmt[i].jw_transaction_id,
          });
        }
        return res.json({
          success: true,
          message: "Report Generated",
          data: final,
        });
      } else {
        return res.json({
          success: false,
          data: null,
          message:
            "no any consumption found associated with the transaction ID",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  },
);

// PRINT JW COMPLETE CALLAN
router.post(
  "/print_jw_complete_challan",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let validation = new Validator(req.body, {
        refid: "required",
        transaction: "required",
      });

      if (validation.fails()) {
        res.json({
          success: false,
          message: validation.errors.all(),
          status: "error",
        });
      }

      let { refid, transaction } = req.body;

      let file = {
        url:
          "https://www.mscorpres.com/ims/192.198.0.1:2021/pages/mypage/jobwork_order/print-jw/create_jw_challan2?invoice=" +
          transaction +
          "&refid=" +
          refid,
      };

      let options = { format: "A4" };
      await html_to_pdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          let filename = "jobwork_comp.pdf";
          return res.json({
            success: true,
            status: "success",
            message: "file generated successfully...",
            data: { buffer: pdfBuffer, filename: filename },
          });
        })
        .catch((err) => {
          return res.json({
            success: false,
            status: "error",
            message: "error while generating file...",
          });
        });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  },
);
// PRINT JW Analysis
router.post("/print_jw_analysis", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      transaction: "required",
    });

    if (validation.fails()) {
      res.json({
        success: false,
        message: validation.errors.all(),
        status: "error",
      });
    }
    let { transaction } = req.body;

    let file = {
      url: `${process.env.API_URL}/helper/PRINT/PHP/JW/JWPO.php?invoice=${transaction}`,
    };

    let options = { format: "A4" };
    await html_to_pdf
      .generatePdf(file, options)
      .then((pdfBuffer) => {
        let filename = req.body.transaction + ".pdf";
        return res.json({
          success: true,
          status: "success",
          message: "file generated successfully...",
          data: { buffer: pdfBuffer, filename: filename },
        });
      })
      .catch((err) => {
        return res.json({
          success: false,
          status: "error",
          message: "error while generating file...",
        });
      });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//FETCH PENDING JW FOR APPROVAL

router.post("/fetchneededApprovalJW", [auth.isAuthorized], async (req, res) => {
  try {
    // Check permission
    const isPermission = await helper.checkPermission(
      "jw-approve",
      req.logedINUser,
    );
    if (!isPermission) {
      return res.json({
        success: false,
        status: "error",
        message: "Permission denied",
      });
    }

    // Extract search parameters
    const searchBy = req.body.wise;
    const searchValue = req.body.data;

    // Validate input
    const validation = new Validator(req.body, {
      wise: "required",
      data: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: "Something you are missing in form field to supply",
        status: "error",
      });
    }

    let result = [];
    // Query based on search type
    if (searchBy === "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      if (!date || date.length !== 2) {
        return res.json({
          success: false,
          status: "error",
          message: "Invalid date format",
        });
      }

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months",
      );

      if (durationInMonths > 3) {
        return res.json({
          success: false,
          status: "error",
          message:
            "On the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
        });
      }

      result = await invtDB.query(
        `SELECT jw_purchase_req.*, ven_basic_detail.*, admin_login.user_name AS jw_po_created_by, 
                raised_by.user_name AS raise_by, cost_center.*, project_master.*,
                COALESCE(jw_purchase_req.jw_po_order_qty, 0) - COALESCE(jw_purchase_req.jw_po_issue_qty, 0) AS totalIn_Qty
         FROM jw_purchase_req 
         LEFT JOIN ven_basic_detail ON jw_purchase_req.jw_po_vendor_reg_id = ven_basic_detail.ven_register_id 
         LEFT JOIN admin_login ON jw_purchase_req.jw_po_insert_by = admin_login.CustID 
         LEFT JOIN admin_login raised_by ON raised_by.CustID = jw_purchase_req.jw_raise_by 
         LEFT JOIN cost_center ON jw_purchase_req.jw_cost_center = cost_center.cost_center_key 
         LEFT JOIN project_master ON jw_purchase_req.jw_project_name = project_master.project_name 
         WHERE DATE_FORMAT(jw_purchase_req.jw_po_full_date, '%Y-%m-%d') BETWEEN :datefrom AND :dateto 
         AND jw_purchase_req.jw_po_status = :status 
         AND jw_purchase_req.company_branch = :branch 
         AND jw_purchase_req.approval_status = 'P'
         ORDER BY jw_purchase_req.jw_project_name DESC`,
        {
          replacements: {
            datefrom: fromdate,
            dateto: todate,
            status: "A",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (searchBy === "powise") {
      result = await invtDB.query(
        `SELECT jw_purchase_req.*, ven_basic_detail.*, admin_login.user_name AS jw_po_created_by, 
                raised_by.user_name AS raise_by, cost_center.*, project_master.*,
                COALESCE(jw_purchase_req.jw_po_order_qty, 0) - COALESCE(jw_purchase_req.jw_po_issue_qty, 0) AS totalIn_Qty
         FROM jw_purchase_req 
         LEFT JOIN ven_basic_detail ON jw_purchase_req.jw_po_vendor_reg_id = ven_basic_detail.ven_register_id 
         LEFT JOIN admin_login ON jw_purchase_req.jw_po_insert_by = admin_login.CustID 
         LEFT JOIN admin_login raised_by ON raised_by.CustID = jw_purchase_req.jw_raise_by 
         LEFT JOIN cost_center ON jw_purchase_req.jw_cost_center = cost_center.cost_center_key 
         LEFT JOIN project_master ON jw_purchase_req.jw_project_name = project_master.project_name 
         WHERE jw_purchase_req.jw_jw_transaction LIKE CONCAT('%', :jw_id, '%') 
         AND jw_purchase_req.jw_po_status = :status 
         AND jw_purchase_req.company_branch = :branch 
         AND jw_purchase_req.approval_status = 'P'
         ORDER BY jw_purchase_req.jw_project_name DESC`,
        {
          replacements: { jw_id: searchValue, status: "A", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (searchBy === "vendorwise") {
      result = await invtDB.query(
        `SELECT jw_purchase_req.*, ven_basic_detail.*, admin_login.user_name AS jw_po_created_by, 
                raised_by.user_name AS raise_by, cost_center.*, project_master.*,
                COALESCE(jw_purchase_req.jw_po_order_qty, 0) - COALESCE(jw_purchase_req.jw_po_issue_qty, 0) AS totalIn_Qty
         FROM jw_purchase_req 
         LEFT JOIN ven_basic_detail ON jw_purchase_req.jw_po_vendor_reg_id = ven_basic_detail.ven_register_id 
         LEFT JOIN admin_login ON jw_purchase_req.jw_po_insert_by = admin_login.CustID 
         LEFT JOIN admin_login raised_by ON raised_by.CustID = jw_purchase_req.jw_raise_by 
         LEFT JOIN cost_center ON jw_purchase_req.jw_cost_center = cost_center.cost_center_key 
         LEFT JOIN project_master ON jw_purchase_req.jw_project_name = project_master.project_name 
         WHERE jw_purchase_req.jw_po_vendor_reg_id = :venid 
         AND jw_purchase_req.jw_po_status = :status 
         AND jw_purchase_req.company_branch = :branch 
         AND jw_purchase_req.approval_status = 'P'
         ORDER BY jw_purchase_req.jw_project_name DESC`,
        {
          replacements: { venid: searchValue, status: "A", branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (searchBy === "projectwise") {
      result = await invtDB.query(
        `SELECT jw_purchase_req.*, ven_basic_detail.*, admin_login.user_name AS jw_po_created_by, 
                raised_by.user_name AS raise_by, cost_center.*, project_master.*,
                COALESCE(jw_purchase_req.jw_po_order_qty, 0) - COALESCE(jw_purchase_req.jw_po_issue_qty, 0) AS totalIn_Qty
         FROM jw_purchase_req 
         LEFT JOIN ven_basic_detail ON jw_purchase_req.jw_po_vendor_reg_id = ven_basic_detail.ven_register_id 
         LEFT JOIN admin_login ON jw_purchase_req.jw_po_insert_by = admin_login.CustID 
         LEFT JOIN admin_login raised_by ON raised_by.CustID = jw_purchase_req.jw_raise_by 
         LEFT JOIN cost_center ON jw_purchase_req.jw_cost_center = cost_center.cost_center_key 
         LEFT JOIN project_master ON jw_purchase_req.jw_project_name = project_master.project_name 
         WHERE jw_purchase_req.jw_project_name = :project 
         AND jw_purchase_req.jw_po_status = :status 
         AND jw_purchase_req.company_branch = :branch 
         AND jw_purchase_req.approval_status = 'P'
         ORDER BY jw_purchase_req.jw_project_name DESC`,
        {
          replacements: {
            project: searchValue,
            status: "A",
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "Please select a valid filter method",
      });
    }

    // Process results
    if (result.length > 0) {
      let finalResult = [];
      for (let i = 0; i < result.length; i++) {
        // Check for pending quantity
        if (result[i].totalIn_Qty > 0) {
          // Check approval permission
          const stmt_valid_apprval_user = await otherDB.query(
            `SELECT ims_po_team_leader 
             FROM ims_po_team 
             WHERE ims_po_team_member = :ims_po_team_member 
             AND po_cost_center = :po_cost_center`,
            {
              replacements: {
                ims_po_team_member: result[i].jw_raise_by,
                po_cost_center: result[i].jw_cost_center,
              },
              type: otherDB.QueryTypes.SELECT,
            },
          );

          if (
            stmt_valid_apprval_user.length > 0 &&
            (stmt_valid_apprval_user[0].ims_po_team_leader ===
              req.logedINUser ||
              ["CRN615672", "CRN103522", "CRN6668049"].includes(
                req.logedINUser,
              ))
          ) {
            finalResult.push({
              jw_transaction: result[i].jw_jw_transaction,
              vendor_name: result[i].ven_name ?? "NA",
              jw_comment: result[i].jw_po_remark ?? "--",
              vendor_id: result[i].jw_po_vendor_reg_id,
              jw_reg_date: moment(
                result[i].jw_po_full_date,
                "YYYY-MM-DD HH:mm:ss",
              ).format("DD-MM-YYYY HH:mm:ss"),
              jw_reg_by: result[i].jw_po_created_by ?? "NA",
              due_date: result[i].jw_po_duedate || "--",
              time_ago: format(result[i].jw_po_full_date, "en_US"),
              jw_trans_encrypt: result[i].jw_jw_transaction,
              jw_status: result[i].jw_po_status,
              jw_costcenter: result[i].cost_center_short_name
                ? `${result[i].cost_center_short_name} ( ${result[i].cost_center_name} )`
                : "NA",
              jw_projectname: result[i].jw_project_name ?? "NA",
              project_description: result[i].project_description ?? "NA",
              approval_status: result[i].approval_status ?? "P",
              requested_by: result[i].raise_by ?? "NA",
              remark: result[i].jw_po_remark ?? "--",
              deviation_remark: result[i].jw_close_remark ?? "--",
              reject_remark: result[i].jw_close_remark ?? "--",
            });
          }
        }
      }

      if (finalResult.length > 0) {
        return res.json({
          success: true,
          status: "success",
          data: finalResult,
        });
      } else {
        return res.json({
          success: false,
          message: "No JW purchase orders found",
          status: "error",
        });
      }
    }

    return res.json({
      success: false,
      message: "No JW purchase orders found",
      status: "error",
    });
  } catch (err) {
    console.error("Error:", err);
    return helper.errorResponse(res, err);
  }
});

// Approve po
router.post("/updateJWApproval", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    jwid: "required|array",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: validation.errors.all(),
      status: "error",
    });
  }

  try {
    for (let i = 0; i < req.body.jwid.length; i++) {
      let t = await invtDB.transaction();

      try {
        // Update approval status
        let stmt = await invtDB.query(
          "UPDATE `jw_purchase_req` SET `approval_status` = :approval_status, `jw_approve_by` = :user WHERE `approval_status` = :pending_status AND `jw_jw_transaction` = :transaction",
          {
            replacements: {
              approval_status: "A",
              user: req.logedINUser,
              pending_status: "P",
              transaction: req.body.jwid[i],
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: t,
          },
        );

        // Check if any rows were updated
        if (stmt[1] > 0) {
          await t.commit();
        } else {
          await t.rollback();
          return res.json({
            success: false,
            message: `No JW purchase order found for approval: ${req.body.jwid[i]}`,
          });
        }
      } catch (err) {
        await t.rollback();
        throw err; // Rethrow to outer catch block
      }
    }

    return res.json({
      success: true,
      status: "success",
      message: "JW purchase orders approved for further processing",
    });
  } catch (err) {
    console.error("Error:", err);
    return helper.errorResponse(res, err);
  }
});

//Reject po
router.post("/rejectJW", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      jwid: "required|array",
      remark: "required",
    });

    if (valid.fails()) {
      return res.json({
        success: false,
        status: "error",
        message: valid.errors.all(),
      });
    }

    for (let i = 0; i < req.body.jwid.length; i++) {
      let transaction = await invtDB.transaction();
      try {
        // Check if JW purchase order exists
        const stmt = await invtDB.query(
          "SELECT ID, approval_status FROM jw_purchase_req WHERE jw_jw_transaction = :jw_id",
          {
            replacements: { jw_id: req.body.jwid[i] },
            type: invtDB.QueryTypes.SELECT,
            transaction: transaction,
          },
        );

        if (stmt.length > 0) {
          // Check if already rejected
          if (stmt[0].approval_status === "R") {
            await transaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message: "JW purchase order ALREADY REJECTED!!!",
            });
          }

          // Update approval status and rejection remark
          const stmt_update = await invtDB.query(
            "UPDATE jw_purchase_req SET approval_status = :status, jw_approve_by = :jw_approve_by, jw_rej_remark = :remark WHERE jw_jw_transaction = :jwid",
            {
              replacements: {
                status: "R",
                jw_approve_by: req.logedINUser,
                remark: req.body.remark,
                jwid: req.body.jwid[i],
              },
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            },
          );

          if (stmt_update[1] > 0) {
            await transaction.commit();
          } else {
            await transaction.rollback();
            return res.json({
              success: false,
              status: "error",
              message: "JW Purchase Order Rejection FAILED",
            });
          }
        } else {
          await transaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "Something wrong!!!",
          });
        }
      } catch (err) {
        await transaction.rollback();
        return helper.errorResponse(res, err);
      }
    }

    return res.json({
      success: true,
      status: "success",
      message: "JW Purchase Orders Rejected",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// JW RM - Consumption
router.get("/rm-consumption/view", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.query, {
      wise: "required",
      data: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: validation.errors.all(),
        status: "error",
      });
    }

    const { wise, data } = req.query;

    let stmt;

    if (wise == "date") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_purchase_req`.`company_branch` = :branch AND DATE_FORMAT(`jw_purchase_req`.`jw_po_full_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `jw_purchase_req`.`jw_po_status` = 'A' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { date1: date1, date2: date2, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "vendor") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_purchase_req`.`company_branch` = :branch AND `jw_po_vendor_reg_id` = :venid AND `jw_purchase_req`.`jw_po_status` = 'A' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { venid: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "jw") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_purchase_req`.`company_branch` = :branch AND `jw_purchase_req`.`jw_jw_transaction` LIKE CONCAT('%', :jw_id, '%') AND `jw_purchase_req`.`jw_po_status` = 'A' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { jw_id: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else if (wise == "sfg") {
      stmt = await invtDB.query(
        "SELECT * FROM `jw_purchase_req` LEFT JOIN `products` ON `jw_purchase_req`.`jw_po_sku` = `products`.`product_key` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `jw_purchase_req`.`jw_po_insert_by` = `admin_login`.`CustID` LEFT JOIN `ven_basic_detail` ON `jw_purchase_req`.`jw_po_vendor_reg_id` = `ven_basic_detail`.`ven_register_id` WHERE `jw_purchase_req`.`company_branch` = :branch AND `jw_po_sku` = :sfgcode AND `jw_purchase_req`.`jw_po_status` = 'A' GROUP BY `jw_purchase_req`.`jw_jw_transaction` ORDER BY `jw_purchase_req`.`jw_po_full_date` DESC",
        {
          replacements: { sfgcode: data, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "invalid wise found.",
      });
    }

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        final.push({
          date: moment(stmt[i].jw_po_full_date, "YYYY-MM-DD HH:mm:ss").format(
            "DD-MM-YYYY",
          ),
          transaction: stmt[i].jw_jw_transaction,
          vendor: {
            name: stmt[i].ven_name,
            code: stmt[i].jw_po_vendor_reg_id,
          },
          product: {
            sku: stmt[i].p_sku,
            name: stmt[i].p_name,
            skey: stmt[i].product_key,
          },
          qty: {
            order: stmt[i].jw_po_order_qty,
            consump: stmt[i].jw_po_consup_qty,
          },
        });
      }

      return res.json({ success: true, status: "success", data: final });
    } else {
      return res.json({
        success: false,
        status: "error",
        message: "no orders were found that match the given search criteria.",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// List of all components used in BOM
router.get(
  "/rm-consumption/view/bom",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      const validator = new Validator(req.query, {
        jw: "required|string",
      });

      if (validator.fails()) {
        return res.json({
          success: false,
          status: "error",
          message: helper.firstErrorValidatorjs(validator),
        });
      }

      const { jw } = req.query;

      /* ================= HEADER ================= */
      const [h] = await invtDB.query(
        `
        SELECT 
          jw_purchase_req.*,
          bom_recipe.subject_id,
          bom_recipe.subject_name,
          products.p_sku,
          products.p_name,
          units.units_name,
          admin_login.user_name,
          ven_basic_detail.ven_name,
          ven_basic_detail.ven_einvoice_status
        FROM jw_purchase_req
        LEFT JOIN jw_bom_recipe 
          ON jw_purchase_req.jw_po_sku = jw_bom_recipe.jw_bom_sku
        LEFT JOIN bom_recipe 
          ON jw_purchase_req.jw_po_recipe = bom_recipe.subject_id
        LEFT JOIN products 
          ON jw_bom_recipe.jw_bom_sku = products.product_key
        LEFT JOIN units 
          ON products.p_uom = units.units_id
        LEFT JOIN admin_login 
          ON jw_purchase_req.jw_po_insert_by = admin_login.CustID
        LEFT JOIN ven_basic_detail 
          ON jw_purchase_req.jw_po_vendor_reg_id = ven_basic_detail.ven_register_id
        WHERE jw_purchase_req.jw_jw_transaction = :jw
        LIMIT 1
        `,
        {
          replacements: { jw },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (!h) {
        return res.json({
          success: false,
          status: "error",
          message: "Invalid transaction ID we could not find anything.",
        });
      }

      /* ================= COMPONENTS ================= */
      const components = await invtDB.query(
        `
        SELECT 
          components.component_key,
          components.c_part_no,
          components.c_new_part_no,
          components.c_name,
          units.units_name,
          jw_bom_recipe.jw_bom_qty
        FROM jw_bom_recipe
        LEFT JOIN components 
          ON jw_bom_recipe.jw_bom_part = components.component_key
        LEFT JOIN units 
          ON components.c_uom = units.units_id
        WHERE jw_bom_recipe.jw_bom_po_trans = :jw
        ORDER BY components.c_part_no ASC
        `,
        {
          replacements: { jw },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      if (!components.length) {
        return res.json({
          success: false,
          status: "error",
          message: "BOM configuration not found",
        });
      }

      /* ================= JW STATUS ================= */
      let jwStatus = "Closed";
      if (h.jw_po_status === "A" && Number(h.jw_po_issue_qty) === 0) {
        jwStatus = "Created";
      } else if (h.jw_po_status === "A") {
        jwStatus = "Processing...";
      }

      /* ================= HEADER RESPONSE ================= */
      const header = {
        product: {
          sku: h.p_sku,
          name: h.p_name,
          uom: h.units_name,
        },
        bom: {
          key: h.subject_id,
          name: h.subject_name,
        },
        jobworkID: h.jw_jw_transaction,
        registereDt: moment(h.jw_po_full_date).format("DD-MM-YYYY"),
        createdBy: h.user_name,
        orderedQty: `${h.jw_po_order_qty} ${h.units_name}`,
        jwStatus,
        proceedQty: h.jw_po_issue_qty,
        vendor: {
          name: h.ven_name,
          code: h.jw_po_vendor_reg_id,
        },
        einvoiceStatus: h.ven_einvoice_status,
        costCenter: h.jw_cost_center,
      };

      /* ================= BODY (ASYNC SAFE) ================= */
      const body = [];

      for (const c of components) {
        const [[total_sfg_consump], [total_iss], [total_ret], [total_consump]] =
          await Promise.all([
            invtDB.query(
              "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_sfg_consump FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'SFG-CONSUMPTION' AND trans_mode = 'default'",
              {
                replacements: {
                  component_id: c.component_key,
                  transaction_id: h.jw_jw_transaction,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),

            invtDB.query(
              "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_issued_rm FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'JOBWORK'",
              {
                replacements: {
                  component_id: c.component_key,
                  transaction_id: h.jw_jw_transaction,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),

            invtDB.query(
              "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_returned_rm FROM rm_location WHERE trans_type = 'TRANSFER' AND in_jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_mode = 'return'",
              {
                replacements: {
                  component_id: c.component_key,
                  transaction_id: h.jw_jw_transaction,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),

            invtDB.query(
              "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_consumption FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'CONSUMPTION' AND trans_mode = 'default'",
              {
                replacements: {
                  component_id: c.component_key,
                  transaction_id: h.jw_jw_transaction,
                },
                type: invtDB.QueryTypes.SELECT,
              },
            ),
          ]);

        const pendingWithJw = helper
          .number(
            total_iss.total_issued_rm -
              (total_sfg_consump.total_sfg_consump +
                total_ret.total_returned_rm +
                total_consump.total_consumption),
          )
          .toFixed(2);

        body.push({
          key: c.component_key,
          catPartCode: c.c_new_part_no,
          partNo: c.c_part_no,
          partName: c.c_name,
          uom: c.units_name,
          venLocationStock: pendingWithJw,
        });
      }

      return res.json({
        success: true,
        status: "success",
        data: {
          header,
          body,
        },
      });
    } catch (err) {
      console.error(err);
      return helper.errorResponse(res, err);
    }
  },
);

// Upload File

// Save Consumption
router.post("/rm-consumption/save", [auth.isAuthorized], async (req, res) => {
  const validator = new Validator(req.body, {
    jw: "required|string",
    challanNo: "required|string",
    component: "required|array",
    consumpQty: "required|array",
    consumpLoc: "required",
    remark: "array",
  });

  if (validator.fails()) {
    return res.json({
      success: false,
      status: "error",
      message: validator.errors.all(),
    });
  }

  const {
    jw,
    challanNo,
    challanDt,
    component,
    consumpQty,
    remark,
    consumpLoc,
  } = req.body;

  const transaction = await invtDB.transaction();

  try {
    const stmt = await invtDB.query(
      `
      SELECT 
        jpr.approval_status,
        jpr.ven_location,
        jpr.location,
        jpr.jw_jw_transaction,
        jpr.jw_po_issue_qty,
        jbr.jw_bom_part,
        jbr.jw_bom_qty
      FROM jw_purchase_req jpr
      LEFT JOIN jw_bom_recipe jbr
        ON jpr.jw_po_sku = jbr.jw_bom_sku
      WHERE jpr.jw_jw_transaction = :jw
      `,
      {
        replacements: { jw },
        type: invtDB.QueryTypes.SELECT,
        transaction,
      },
    );

    if (!stmt.length) {
      await transaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "JW purchase order not found",
      });
    }

    if (stmt[0].approval_status === "R") {
      await transaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "JW purchase order already rejected",
      });
    }

    const bomQtyMap = {};
    for (const row of stmt) {
      bomQtyMap[row.jw_bom_part] = helper.number(row.jw_bom_qty);
    }

    const insertDt = moment().format("YYYY-MM-DD HH:mm:ss");
    const outtxnID = helper.generateTxnID();

    for (let i = 0; i < component.length; i++) {
      if (!consumpQty[i] || helper.number(consumpQty[i]) <= 0) {
        continue;
      }
      const componentId = component[i];
      const bomQty = bomQtyMap[componentId];

      const [[total_sfg_consump], [total_iss], [total_ret], [total_consump]] =
        await Promise.all([
          invtDB.query(
            "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_sfg_consump FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'SFG-CONSUMPTION' AND trans_mode = 'default'",
            {
              replacements: {
                component_id: componentId,
                transaction_id: stmt[0].jw_jw_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          ),

          invtDB.query(
            "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_issued_rm FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'JOBWORK'",
            {
              replacements: {
                component_id: componentId,
                transaction_id: stmt[0].jw_jw_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          ),

          invtDB.query(
            "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_returned_rm FROM rm_location WHERE trans_type = 'TRANSFER' AND in_jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_mode = 'return'",
            {
              replacements: {
                component_id: componentId,
                transaction_id: stmt[0].jw_jw_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          ),

          invtDB.query(
            "SELECT COALESCE(SUM(qty+other_qty), 0) AS total_consumption FROM rm_location WHERE jw_transaction_id = :transaction_id AND components_id = :component_id AND trans_type = 'CONSUMPTION' AND trans_mode = 'default'",
            {
              replacements: {
                component_id: componentId,
                transaction_id: stmt[0].jw_jw_transaction,
              },
              type: invtDB.QueryTypes.SELECT,
            },
          ),
        ]);

      const vendorStock = helper
        .number(
          total_iss.total_issued_rm -
            (total_sfg_consump.total_sfg_consump +
              total_ret.total_returned_rm +
              total_consump.total_consumption),
        )
        .toFixed(2);

      /**
       * Stock check (existing logic)
       */
      if (vendorStock >= helper.number(consumpQty[i])) {
        await invtDB.query(
          `
        INSERT INTO rm_location
          (
            in_module,
            trans_type,
            components_id,
            qty,
            loc_in,
            loc_out,
            out_transaction_id,
            jw_transaction_id,
            any_remark,
            insert_date,
            insert_by,
            in_invoice_id,
            invoice_date
          )
        VALUES
          (
            'JW-IN',
            'CONSUMPTION',
            :component,
            :qty,
            :locIn,
            :locOut,
            :outTxnID,
            :jw,
            :remark,
            :insertDt,
            :insertBy,
            :invID,
            :invDt
          )
        `,
          {
            replacements: {
              component: componentId,
              qty: consumpQty[i],
              locIn: consumpLoc,
              locOut: stmt[0].ven_location,
              outTxnID: outtxnID,
              jw,
              remark: remark?.[i] || null,
              insertDt,
              insertBy: req.logedINUser,
              invID: challanNo,
              invDt: moment(challanDt, "DD-MM-YYYY").format("YYYY-MM-DD"),
            },
            transaction,
          },
        );
      } else {
        await transaction.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Vendor stock not enough",
        });
      }
    }

    await transaction.commit();

    return res.json({
      success: true,
      status: "success",
      message: "RM consumption saved successfully",
      data: {
        txn: outtxnID,
      },
    });
  } catch (err) {
    console.error("rm-consumption/save error:", err);
    await transaction.rollback();
    return helper.errorResponse(res, err);
  }
});

// Show JW-RM-CONSUMPTION Report
router.get(
  "/jw-rm-consumption-report",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      const { date } = req.query;

      if (!date) {
        return res.json({
          success: false,
          status: "error",
          message: "Date range is required",
        });
      }
      const dateArr = date.split("-");

      if (dateArr.length !== 6) {
        return res.json({
          success: false,
          status: "error",
          message: "Invalid date range format",
        });
      }

      const fromDate = moment(
        `${dateArr[0]}-${dateArr[1]}-${dateArr[2]}`,
        "DD-MM-YYYY",
      ).format("YYYY-MM-DD");

      const toDate = moment(
        `${dateArr[3]}-${dateArr[4]}-${dateArr[5]}`,
        "DD-MM-YYYY",
      ).format("YYYY-MM-DD");

      if (!moment(fromDate).isValid() || !moment(toDate).isValid()) {
        return res.json({
          success: false,
          status: "error",
          message: "Invalid date values",
        });
      }

      const data = {
        txnDt: "2025-09-27",
        type: "--",
        part: {
          code: "COMP-001",
          name: "Steel Rod",
          catCode: "RAW-MAT",
        },
        from: "MAIN-WH",
        to: "JW-VENDOR-01",
        qty: "120",
        uom: "KG",
        remark: "RM consumption for jobwork",
        jw: "JW202509001",
        txn: "TXN998877",
        by: "admin",
      };

      return res.json({
        success: true,
        status: "success",
        data,
      });
    } catch (err) {
      console.error("jw-rm-consumption-report error:", err);
      return res.json({
        success: false,
        status: "error",
        message: "Something went wrong. Please try again.",
      });
    }
  },
);

router.get("/warehouse/location", [auth.isAuthorized], async (req, res) => {
  try {
    const costcenter = req.query.cc;
    const search = req.query.search;

    let baseQuery = `
      SELECT 
        location_key,
        CASE 
          WHEN :costcenter IS NOT NULL 
               AND FIND_IN_SET(:costcenter, loc_costcenter)
          THEN CONCAT(loc_name, ' [ CC ]')
          ELSE loc_name
        END AS loc_name
      FROM location_main
      WHERE loc_type = '1'
        AND loc_status = 'ACTIVE'
        AND company_branch = :branch
    `;

    let replacements = {
      costcenter: costcenter || null,
      branch: req.branch,
    };

    if (costcenter && search) {
      baseQuery += `
        AND (
              FIND_IN_SET(:costcenter, loc_costcenter)
              OR loc_name LIKE :search
            )
      `;
      replacements.search = `%${search}%`;
    } else if (costcenter) {
      baseQuery += ` AND FIND_IN_SET(:costcenter, loc_costcenter) `;
    } else if (search) {
      baseQuery += ` AND loc_name LIKE :search `;
      replacements.search = `%${search}%`;
    }

    baseQuery += ` LIMIT 10`;

    const result = await invtDB.query(baseQuery, {
      replacements,
      type: invtDB.QueryTypes.SELECT,
    });

    if (result.length > 0) {
      return res.json(
        result.map((row) => ({
          id: row.location_key,
          text: row.loc_name,
        })),
      );
    } else {
      return res.json({
        success: true,
        status: "success",
        data: [],
      });
    }
  } catch (err) {
    return res.json({
      success: false,
      status: "error",
      message: "Something went wrong. Please try again.",
    });
  }
});

module.exports = router;

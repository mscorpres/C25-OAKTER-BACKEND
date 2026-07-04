const Validator = require("validatorjs");
const express = require("express");
const router = express.Router();
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const { invtDB, otherDB } = require("../../../config/db/connection");
const multer = require("multer");
const XLSX = require("xlsx");
const { default: axios } = require("axios");

router.post("/pologs", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    po_id: "required",
  });
  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }
  try {
    const po_id = req.body.po_id;
    let poLog_Data = await invtDB.query(
      "SELECT po_id, min_no, po_log_status, po_log_remark, DATE_FORMAT(po_status_log.insert_dt, '%d/%m/%y') AS date, insert_time as time, user_name FROM `po_status_log` LEFT JOIN `admin_login` ON po_status_log.insert_by = admin_login.CustID WHERE `po_id` = :po_id ORDER BY DATE_FORMAT(po_status_log.insert_dt, 'yyyy-mm-dd' ),DATE_FORMAT(po_status_log.insert_time, 'hh:mm:ss' ) DESC",
      {
        replacements: { po_id: po_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (poLog_Data.length > 0) {
      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: poLog_Data,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Sorry.. there are no data found",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./temp");
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + "-" + Date.now() + file.originalname);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1000000 },
});

// UPLOAD PO FILE
router.post(
  "/uploadPoFile",
  [/*auth.isAuthorized, */ upload.single("file")],
  async (req, res) => {
    try {
      if (!req.file) {
        return res.json({
          status: "error",
          success: false,
          message: "Please upload a file",
        });
      }

      const validPyload = new Validator(req.body, {
        po_id: "required",
      });
      if (validPyload.fails()) {
        return res.json({
          status: "error",
          success: false,
          message: helper.firstErrorValidatorjs(validPyload),
        });
      }

      const file = req.file;
      const filePath = "./temp/" + file.filename;
      const fileData = XLSX.readFile(filePath);
      const sheetName = fileData.SheetNames[0];
      const sheetData = XLSX.utils.sheet_to_json(fileData.Sheets[sheetName]);

      const Headers = [
        "Part",
        "HSN",
        "UoM",
        "Order Qty",
        "Import Rate",
        "Exchange Rate",
        "Taxable Value",
        "Foreign Value",
        "Freight Value",
        "Custom Duty",
        "Total",
        "Final Rate",
      ];

      const worksheet = fileData.Sheets[sheetName];
      const range = XLSX.utils.decode_range(worksheet["!ref"]);

      // Extract headers explicitly (from the first row)
      const sheetHeaders = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_col(col) + "1"; // Example: "A1", "B1", etc.
        const cell = worksheet[cellAddress];
        sheetHeaders.push(cell ? cell.v : ""); // If cell is empty, keep it as an empty string
      }

      // VALIADATE HEADERS
      for (let i = 0; i < Headers.length; i++) {
        if (sheetHeaders[i] != Headers[i]) {
          return res.json({
            status: "error",
            success: false,
            message: `${Headers[i]} column not found at ${i + 1} column`,
          });
        }
      }

      // CHECK IF DATA IS EMPTY
      if (sheetData.length <= 0) {
        return res.json({
          status: "error",
          success: false,
          message: "Data is empty",
        });
      }

      // CHECK DUPLICATE PART CODE
      const seen = new Set();
      const duplicateElement = sheetData
        .filter((item) => {
          const trimmedPart = item.Part ? item.Part.trim() : "";
          if (seen.has(trimmedPart)) return true;
          seen.add(trimmedPart);
          return false;
        })
        .map((item) => item.Part);

      if (duplicateElement.length > 0) {
        return res.json({
          status: "error",
          success: false,
          message: `Part code ${duplicateElement.join(", ")} is duplicate`,
        });
      }

      // Validate Data
      for (let i = 0; i < sheetData.length; i++) {
        const valid = new Validator(sheetData[i], {
          Part: "required",
          HSN: "required",
          "Order Qty": "required",
          "Import Rate": "required",
          "Exchange Rate": "required",
          "Taxable Value": "required",
          "Foreign Value": "required",
          "Freight Value": "required",
          "Custom Duty": "required",
          Total: "required",
          "Final Rate": "required",
        });

        if (valid.fails()) {
          return res.json({
            status: "error",
            success: false,
            message: `${helper.firstErrorValidatorjs(valid)} at row ${i + 1}`,
          });
        }
      }

      // CHECK VALID PART CODE
      const checkPartCode = await invtDB.query(
        "SELECT c_part_no , c_name , component_key , manufacturing_code FROM components WHERE c_part_no IN (:part_code) ",
        {
          replacements: {
            part_code: sheetData.map((item) => item.Part.trim()),
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (checkPartCode.length <= 0) {
        return res.json({
          status: "error",
          success: false,
          message: "Part code not found",
        });
      }

      if (checkPartCode.length != sheetData.length) {
        const notFoundPartInDb = sheetData
          .filter(
            (item) =>
              !checkPartCode
                .map((part) => part.c_part_no.trim())
                .includes(item.Part.trim())
          )
          .map((item) => item.Part);

        if (notFoundPartInDb.length > 0) {
          return res.json({
            status: "error",
            success: false,
            message:
              "Part code not found ( " + notFoundPartInDb.join(", ") + " )",
          });
        }
      }

      // PO VALIDATION /////////////////////////
      let result = await invtDB.query(
        "SELECT * FROM po_purchase_req WHERE po_transaction = :po",
        {
          replacements: { po: req.body.po_id },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (result.length <= 0) {
        res.json({
          status: "error",
          success: false,
          message: "no PO found that matching to your query",
        });
        return;
      }
      if (result[0].po_status == "C") {
        res.json({
          status: "error",
          success: false,
          message: "PO marked as cancelled, so cann't proceed for MIN",
        });
        return;
      }
      if (result[0].approval_status !== "A") {
        res.json({
          status: "error",
          success: false,
          message: "PO not approved yet for further transactions",
        });
        return;
      }

      // END PO VALIDATION /////////////////////

      const resData = [];
      for (let i = 0; i < sheetData.length; i++) {
        const item = sheetData[i];
        const matchingPart = checkPartCode.find(
          (part) => part.c_part_no.trim() == item.Part.trim()
        );
        if (!matchingPart) {
          return res.json({
            status: "error",
            success: false,
            message: `Part code ${item.Part} not found in database`,
          });
        }

        const checkComponentInPo = await invtDB.query(
          "SELECT * FROM po_purchase_req WHERE po_part_no = :part_code AND po_purchase_req.po_transaction = :transaction AND po_purchase_req.po_part_status = :part_status",
          {
            replacements: {
              transaction: req.body.po_id,
              part_status: "ACTIVE",
              part_code: matchingPart.component_key,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (checkComponentInPo.length <= 0) {
          return res.json({
            status: "error",
            success: false,
            message: `No component found in PO ${item.Part}`,
          });
        }

        let getQty = await invtDB.query(
          "SELECT *, COALESCE(SUM(`qty`+`other_qty`),0) `totalIN_Qty` FROM `rm_location` WHERE `in_po_transaction_id` = :poid AND `components_id` = :partno AND `trans_type` = 'INWARD'",
          {
            replacements: {
              poid: req.body.po_id,
              partno: matchingPart.component_key,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        resData.push({
          part: {
            part_code: item.Part,
            part_name: matchingPart.c_name,
            component_key: matchingPart.component_key,
            manual_mfg_code: matchingPart.manufacturing_code,
          },
          hsn: item.HSN,
          uom: item["UoM"],
          order_qty: item["Order Qty"],
          po_order_qty: helper.number(checkComponentInPo[0].po_order_qty),
          pending_qty:
            helper.number(checkComponentInPo[0].po_order_qty) -
            getQty[0].totalIN_Qty,
          import_rate: item["Import Rate"],
          exchange_rate: item["Exchange Rate"],
          taxable_value: item["Taxable Value"],
          foreign_value: item["Foreign Value"],
          freight_value: item["Freight Value"],
          custom_duty: item["Custom Duty"],
          total: item.Total,
          final_rate: item["Final Rate"],
        });
      }

      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: resData,
      });
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

router.post(
  "/poMINImport",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const validation = new Validator(req.body, {
      poid: "required",
      invoice: "required",
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
    let itemLength = req.body.component.length;
    for (let i = 0; i < itemLength; i++) {
      let itemValidation = new Validator(
        {
          item: req.body.component[i],
          qty: req.body.qty[i],
          rate: req.body.rate[i],
          finalRate: req.body.finalRate[i],
          exchangeCurr: req.body.currency,
          customDuty: req.body.customDuty[i],
          freight: req.body.freight[i],
        },
        {
          item: "required",
          qty: "required|not_in:0",
          rate: "required",
          finalRate: "required",
          exchangeCurr: "required",
          customDuty: "required",
          freight: "required",
        }
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
    let out_txn_no = helper.getUniqueNumber(); //Transaction OUT ID
    try {
      // CHECK COMPONENTs
      const checkPartCode = await invtDB.query(
        "SELECT c_part_no , c_name , component_key FROM components WHERE component_key IN (:part_code) ",
        {
          replacements: { part_code: req.body.component },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (checkPartCode.length <= 0) {
        t.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Part code not found",
        });
      }

      if (checkPartCode.length != req.body.component.length) {
        const notFoundPartInDb = req.body.component.filter(
          (item) =>
            !checkPartCode.map((part) => part.component_key).includes(item)
        );

        if (notFoundPartInDb.length > 0) {
          t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "Part code not found ( " + notFoundPartInDb.join(", ") + " )",
          });
        }
      }

      let stmt1 = await invtDB.query(
        "SELECT `branch_code` FROM `branches` WHERE `branch_code` = :branchcode",
        {
          replacements: {
            branchcode: req.branch,
            status: "C",
          },
          type: invtDB.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (stmt1.length > 0 || 1) {
        let in_txn_no = await helper.genTransaction("MIN", t); //Transaction IN ID
        let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");

        let stmt3 = await invtDB.query(
          "SELECT * FROM `po_purchase_req` WHERE `po_transaction` = :po_transaction AND `company_branch` = :branch",
          {
            replacements: {
              po_transaction: req.body.poid,
              branch: req.branch,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt3.length > 0) {
          let checkVendor = await invtDB.query(
            "SELECT * FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor_id",
            {
              replacements: { vendor_id: stmt3[0].po_vendor_reg_id },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          if (checkVendor.length == 0) {
            t.rollback();
            res.json({
              status: "error",
              success: false,
              message: "Vendor not found",
            });
            return;
          }

          for (let i = 0; i < itemLength; i++) {
            if (req.body.invoice !== "") {
              if (
                req.body.invoiceDate == "" &&
                !helper.preg_match(
                  /^(0[1-9]|[1-2][0-9]|3[0-1])-(0[1-9]|1[0-2])-[0-9]{4}$/,
                  req.body.invoiceDate
                )
              ) {
                t.rollback();
                res.json({
                  status: "error",
                  success: false,
                  message:
                    "Pls recheck the invoice date, It should be in 'DD-MM-YYYY' format OR would not be empty",
                });
                return;
              }

              if (req.body.location == "0") {
                t.rollback();
                res.json({
                  message: "you might left some location to select",
                  status: "error",
                  success: false,
                });
                return;
              }

              let stmt6 = await invtDB.query(
                "SELECT `currency_id` FROM `ims_currency` WHERE `currency_id`  = :currency",
                {
                  replacements: { currency: req.body.currency },
                  type: invtDB.QueryTypes.SELECT,
                  transaction: t,
                }
              );
              if (stmt6.length > 0) {
                if (
                  req.body.qty[i] !== "" &&
                  req.body.qty[i] !== "0" &&
                  req.body.invoice[i] !== ""
                ) {
                  let stmt7 = await invtDB.query(
                    "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `totalIN_QTY` FROM `rm_location` WHERE `components_id` = :component AND `in_po_transaction_id` = :po_transaction_id AND `trans_type` = 'INWARD' AND `company_branch` = :branch",
                    {
                      replacements: {
                        component: req.body.component[i],
                        po_transaction_id: req.body.poid,
                        branch: req.branch,
                      },
                      type: invtDB.QueryTypes.SELECT,
                    }
                  );

                  let totalInward;
                  if (stmt7.length > 0) {
                    totalInward = helper.number(stmt7[0].totalIN_QTY);
                  } else {
                    totalInward = 0;
                  }

                  let stmt8 = await invtDB.query(
                    "SELECT * FROM `po_purchase_req` LEFT JOIN `components` ON `po_purchase_req`.`po_part_no` = `components`.`component_key` WHERE `po_purchase_req`.`po_part_status` = 'ACTIVE' AND `po_purchase_req`.`po_transaction` = :po_transaction_id AND `po_purchase_req`.`po_part_no` = :component AND `po_purchase_req`.`company_branch` = :branch",
                    {
                      replacements: {
                        po_transaction_id: req.body.poid,
                        component: req.body.component[i],
                        branch: req.branch,
                      },
                      type: invtDB.QueryTypes.SELECT,
                    }
                  );
                  if (stmt8.length > 0) {
                    if (
                      helper.number(stmt8[0].po_order_qty) >=
                      helper.number(
                        totalInward + helper.number(req.body.qty[i])
                      )
                    ) {
                      if (req.body.location == "") {
                        t.rollback();
                        res.json({
                          status: "error",
                          success: false,
                          message:
                            "supply the valid inwarding location for MIN partcode " +
                            stmt8[0].c_part_no,
                        });
                        return;
                      }
                      if (req.body.invoice[i] == "") {
                        t.rollback();
                        res.json({
                          status: "error",
                          success: false,
                          message:
                            "supply the valid Invoice ID for MIN partcode " +
                            stmt8[0].c_part_no,
                        });
                        return;
                      }
                      if (req.body.qty[i] < 0) {
                        t.rollback();
                        res.json({
                          status: "error",
                          success: false,
                          message:
                            "MIN quantity couldn't be in negative for MIN partcode " +
                            stmt8[0].c_part_no,
                        });
                        return;
                      }
                      if (req.body.hsncode[i] == "") {
                        t.rollback();
                        res.json({
                          status: "error",
                          success: false,
                          message:
                            "HSN code is mandatory to supply for MIN partcode " +
                            stmt8[0].c_part_no,
                        });
                        return;
                      }
                      let stmt9 = await invtDB.query(
                        "UPDATE `components` SET `c_hsn` = :hsncode WHERE `component_key` = :component_key",
                        {
                          replacements: {
                            hsncode: req.body.hsncode[i],
                            component_key: req.body.component[i],
                          },
                          type: invtDB.QueryTypes.UPDATE,
                          transaction: t,
                        }
                      );
                      let stmt10 = await invtDB.query(
                        "UPDATE `po_purchase_req` SET `po_pending_qty` = po_pending_qty - :outward_qty, `po_inward_qty`= po_inward_qty + :inward_qty WHERE `po_part_no` = :components AND `po_transaction` = :po_id",
                        {
                          replacements: {
                            outward_qty: req.body.qty[i],
                            inward_qty: req.body.qty[i],
                            components: req.body.component[i],
                            po_id: req.body.poid,
                          },
                          type: invtDB.QueryTypes.UPDATE,
                          transaction: t,
                        }
                      );
                    } else {
                      if (totalInward == 0) {
                        t.rollback();
                        res.json({
                          message:
                            totalInward +
                            " MIN quantity should be less than to the total PO order quantity & the PO order quantity for partcode " +
                            stmt8[0].c_part_no,
                          status: "error",
                          success: false,
                        });
                      } else {
                        t.rollback();
                        res.json({
                          message:
                            "MIN quantity should be less than to the total PO Order quantity & you have already inwarded [" +
                            totalInward +
                            "] QTY in partcode [" +
                            stmt8[0].c_part_no +
                            "]",

                          status: "error",
                          success: false,
                        });
                      }
                    }
                  }
                }
              } else {
                t.rollback();
                res.json({
                  status: "error",
                  success: false,
                  message: "currency either inactive or not exist with us",
                });
                return;
              }

              let stmt4 = await invtDB.query(
                "INSERT INTO  rm_location  (manual_mfg_code,  in_module , in_vendor_addr , in_vendor_branch , company_branch , currency_type , exchange_rate , in_gst_cgst , in_gst_sgst , in_gst_igst , in_hsn_code , vendor_type , components_id , in_po_rate, final_rate , qty, custom_duty, freight_charge , loc_in , any_remark , insert_date , insert_by , in_transaction_id , in_po_transaction_id , in_po_invoice_id, invoice_date , trans_type , in_vendor_name , in_gst_rate , in_gst_type , is_auto_cons , rm_loc_project_id , rm_loc_cost_center, eInv_applicability, ackwlg_irn, qr_status)VALUES (:manual_mfg_code,'IN-PO',:ven_address,:ven_branch,:branch,:currency,:exchange,:cgst,:sgst,:igst,:hsncode,:vendor_type,:component,:po_rate, :final_rate, :qty, :custom_duty, :freight, :location_in, :remark,:insertdate,:insertby,:in_transaction_id,:po_transaction_id,:po_invoice_id, :invoice_date,:in_type,:vendor_name,:gstrate,:gsttype,'N' , :rm_loc_project_id , :rm_loc_cost_center,  :einv_applicability, :ackwlg_irn, :qr_status)",
                {
                  replacements: {
                    manual_mfg_code: req.body.manual_mfg_code[i] ?? "--",
                    rm_loc_project_id: stmt3[0].po_project_name,
                    rm_loc_cost_center: stmt3[0].po_cost_center,
                    ven_address: stmt3[0].po_vendor_address,
                    ven_branch: stmt3[0].po_ven_add_id,
                    branch: req.branch,
                    currency: req.body.currency,
                    exchange:
                      req.body.currency == "364907247"
                        ? 1
                        : req.body.exchange[i],
                    cgst: 0,
                    sgst: 0,
                    igst: 0,
                    hsncode: req.body.hsncode[i],
                    vendor_type: stmt3[0].po_vendor_type,
                    component: req.body.component[i],
                    po_rate:
                      req.body.currency == "364907247"
                        ? Number(req.body.rate[i])
                        : Number(req.body.rate[i]),
                    final_rate: req.body.finalRate[i],
                    custom_duty: req.body.customDuty[i],
                    freight: req.body.freight[i],
                    qty: req.body.qty[i],
                    location_in: req.body.location,
                    remark:
                      req.body.remark[i] == "" ? "--" : req.body.remark[i],
                    insertdate: insert_dt,
                    insertby: req.logedINUser,
                    in_transaction_id: in_txn_no,
                    po_transaction_id: req.body.poid,
                    po_invoice_id: req.body.invoice,
                    invoice_date: req.body.invoiceDate,
                    in_type: "INWARD",
                    vendor_name: stmt3[0].po_vendor_reg_id,
                    gstrate: 0,
                    gsttype: 0,
                    einv_applicability: checkVendor[0].ven_einvoice_status,
                    ackwlg_irn: req.body.irn ?? "--",
                    qr_status: req.body.qrScan ?? "--",
                  },
                  type: invtDB.QueryTypes.INSERT,
                  transaction: t,
                }
              );
            }
          }
          let str = req.body.invoices;
          let arr = str.split(",");
          let fileLength = arr.length;
          for (let i = 0; i < fileLength; i++) {
            let insert_date = moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss");
            let insert_res_2 = await invtDB.query(
              "INSERT INTO `ims_min_invoices` (`min_inv_file`, `min_inv_by`, `min_inv_dt`, `min_min_id`) VALUES(:fileurl, :invby, :invdate, :minid)",
              {
                replacements: {
                  fileurl: arr[i],
                  invby: req.logedINUser,
                  invdate: insert_date,
                  minid: in_txn_no,
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: t,
              }
            );
          }

          let po_log = await invtDB.query(
            "INSERT INTO `po_status_log`(`po_id`, `min_no`, `po_log_status`, `insert_dt`, `insert_time`, `insert_by`) VALUES ( :poid, :minno, :status, :insert_dt, :insert_time, :insert_by )",
            {
              replacements: {
                poid: req.body.poid,
                minno: in_txn_no,
                status: "--",
                insert_dt: moment(new Date()).format("YYYY-MM-DD"),
                insert_time: moment(new Date()).format("HH:mm:ss"),
                insert_by: req.logedINUser,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: t,
            }
          );
          await t.commit();
          // Integrated API logic
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
                  }
                );
                partCodeName =
                  componentResult.length > 0
                    ? componentResult[0].c_part_no
                    : "";
                partname =
                  componentResult.length > 0 ? componentResult[0].c_name : "";
              }

              data.push({
                PARTCode: partCodeName,
                PARTCodeName: partname,
                VendorName: stmt3[0].po_vendor_reg_id || "--",
                InvoiceDate:
                  req.body.invoiceDate ||
                  moment(insert_dt).format("YYYY/MM/DD HH:mm:ss"),
                MinNumber: in_txn_no,
                UNIT: isNaN(parseInt(req.body.qty[i]))
                  ? 0
                  : parseInt(req.body.qty[i]),
                Rate: isNaN(parseFloat(req.body.rate[i]))
                  ? 0
                  : parseFloat(req.body.rate[i]),
                MINDate: moment(insert_dt).format("YYYY/MM/DD HH:mm:ss"),
              });
            }

            payload = { Data: data };

            const response = await axios.post(
              "http://dev.oakter.co:84/Oakter/Report/SaveComponentInwardData",
              payload,
              {
                headers: { "Content-Type": "application/json" },
              }
            );

            console.log("API Response:", response.data);

            apiStatus =
              response.data.OverAllStatus === "PASS" ? "PASS" : "FAIL";

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
                }
              );
            } catch (dbError) {
              // console.error(
              //   "Failed to log payload to api_payload_log:",
              //   dbError.message
              // );
            }

            externalResult = {
              status: apiStatus,
              message:
                apiStatus === "PASS"
                  ? "External API call successful"
                  : `External API call failed: ${response.data.Status.join(
                      ", "
                    )}`,
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
                }
              );
            } catch (dbError) {
              // console.error(
              //   "Failed to log payload to api_payload_log:",
              //   dbError.message
              // );
            }

            externalResult = {
              status: apiStatus,
              message: `Failed to call external API: ${error.message}`,
              details: error.response?.data || null,
            };
          }

          res.json({
            message: `PO Material-IN completed..!!! transaction ref ID. [#${in_txn_no}]`,
            status: "success",
            success: true,
            transaction_id: in_txn_no,
            data: {
              txn: in_txn_no,
              externalStatus: externalResult.status,
              externalDetails: externalResult.details,
            },
          });
          return;
          // } else {
          //   t.rollback();
          //   res.json({
          //     status: "error",
          //     success: false,
          //     message:
          //       "transaction route seems to be really busy - Please try again...",
          //   });
          //   return;
          // }
        } else {
          t.rollback();
          res.json({
            status: "error",
            success: false,
            message:
              "MIN operation cancelled bcz it seem PO ID not exist in our records",
          });
          return;
        }
        // }
      } else {
        t.rollback();
        res.json({
          status: "error",
          success: false,
          message: "You have selected an invalid company branch",
        });
        return;
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

module.exports = router;

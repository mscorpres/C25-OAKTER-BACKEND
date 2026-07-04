const express = require("express");
const router = express.Router();
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
const axios = require("axios");

let { invtDB, otherDB } = require("../../../config/db/connection");

//CREATE EWAY BILL

router.post("/fetch_challan_data", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    challan_no: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: "Something is missing in the form fields",
      data: validation.errors.all(),
    });
  }

  try {
    const stmt = await invtDB.query(
      `SELECT jw_material_challan.*, jw_material_challan.ID AS row_id, 
                components.component_key, components.c_name, components.c_part_no, components.c_specification, 
                units.units_name, ven_basic_detail.ven_name 
         FROM jw_material_challan 
         LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = jw_material_challan.jw_vendor_id 
         LEFT JOIN components ON jw_material_challan.jw_component_id = components.component_key 
         LEFT JOIN units ON components.c_uom = units.units_id 
         WHERE jw_material_challan.jw_challan_txn_id = :transaction AND jw_material_challan.company_branch = :branch 
         ORDER BY components.c_part_no`,
      {
        replacements: { transaction: req.body.challan_no, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length === 0) {
      return res.json({
        success: false,
        message: "Unable to fetch any challan transaction",
        status: "error",
      });
    }

    const challanData = stmt[0];

    const stmtVenDetail = await invtDB.query("SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor_id", {
      replacements: { vendor_id: challanData.jw_vendor_id },
      type: invtDB.QueryTypes.SELECT,
    });

    const stmtVenBranch = await invtDB.query("SELECT * FROM ven_address_detail WHERE ven_address_id = :address_id", {
      replacements: { address_id: challanData.jw_ven_add_id },
      type: invtDB.QueryTypes.SELECT,
    });

    let vendorAddress = challanData.jw_vendor_address || (stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_address : "");

    const stmtVenState = await invtDB.query("SELECT * FROM state_code WHERE state_code = :code", {
      replacements: { code: stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_state : "" },
      type: invtDB.QueryTypes.SELECT,
    });

    const billingAddr = await invtDB.query("SELECT * FROM billing_address WHERE billing_code = :billingcode", {
      replacements: { billingcode: challanData.jw_billing_id },
      type: invtDB.QueryTypes.SELECT,
    });

    const stmtBillingState = await invtDB.query("SELECT * FROM state_code WHERE state_code = :code", {
      replacements: { code: billingAddr.length > 0 ? billingAddr[0].billing_state : "" },
      type: invtDB.QueryTypes.SELECT,
    });

    const dispatchAddr = await invtDB.query("SELECT * FROM dispatch_address WHERE dispatch_code = :dispatchcode", {
      replacements: { dispatchcode: challanData.jw_dispatch_to_id },
      type: invtDB.QueryTypes.SELECT,
    });

    const stmtDispatchState = await invtDB.query("SELECT * FROM state_code WHERE state_code = :code", {
      replacements: { code: dispatchAddr.length > 0 ? dispatchAddr[0].dispatch_state_code : "" },
      type: invtDB.QueryTypes.SELECT,
    });

    const items = stmt.map((row) => ({
      ID: row.row_id,
      component_name: row.c_name,
      component_description: row.c_specification,
      part_no: row.c_part_no,
      qty: row.jw_order_qty,
      rate: row.jw_order_rate,
      unit_name: row.units_name,
      hsn_code: row.jw_hsncode,
      taxable_amount: (row.jw_order_rate * row.jw_order_qty).toFixed(3),
      remarks: row.jw_remark,
    }));

    const response = {

      success: true,
      data: {
        challan_id: challanData.jw_challan_txn_id,
        jw_id: challanData.jw_transaction,
        bill_from: {
          legalName: billingAddr.length > 0 ? billingAddr[0].billing_company : "",
          gstin: billingAddr.length > 0 ? billingAddr[0].billing_gstno : "",
          state: {
            state_code: stmtBillingState.length > 0 ? stmtBillingState[0].state_code : "",
            state_name: stmtBillingState.length > 0 ? stmtBillingState[0].state_name : "",
          },
          address1: billingAddr.length > 0 ? billingAddr[0].billing_address : "",
          address2: "",
          pincode:stmt[0].jw_dispatch_to_pincode,
        },
        bill_to: {
          client: stmtVenDetail.length > 0 ? stmtVenDetail[0].ven_name : "",
          gst: stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_add_gst : "",
          state: {
            state_code: stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_state : "",
            state_name: stmtVenState.length > 0 ? stmtVenState[0].state_name : "",
          },
          address1: vendorAddress,
          address2: "",
          pincode: stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_pincode : "",
        },
        ship_from: {
          legalName: dispatchAddr.length > 0 ? dispatchAddr[0].dispatch_company : "",
          gst: dispatchAddr.length > 0 ? dispatchAddr[0].dispatch_gstin : "",
          state: {
            state_code: dispatchAddr.length > 0 ? dispatchAddr[0].dispatch_state_code : "",
            state_name: stmtDispatchState.length > 0 ? stmtDispatchState[0].state_name : "",
          },
          address1: challanData.jw_dispatch_to__line1 || (dispatchAddr.length > 0 ? dispatchAddr[0].dispatch_address : ""),
          address2: challanData.jw_dispatch_to__line2 || "",
          pincode: dispatchAddr.length > 0 ? dispatchAddr[0].dispatch_pincode : "",
        },
        ship_to: {
          company: stmtVenDetail.length > 0 ? stmtVenDetail[0].ven_name : "",
          gst: stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_add_gst : "",
          state: {
            state_code: stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_state : "",
            state_name: stmtVenState.length > 0 ? stmtVenState[0].state_name : "",
          },
          address1: vendorAddress,
          address2: "",
          pincode: stmtVenBranch.length > 0 ? stmtVenBranch[0].ven_pincode : "",
        },
        vehicle: challanData.vehicle_no,
        total_amount: items.reduce((sum, item) => sum + Number(item.taxable_amount), 0).toFixed(3),
        jw_status: challanData.challan_status,
        jw_ewaybill_no: challanData.jw_ewaybill_no,
        jw_ewaybill_status: challanData.jw_ewaybill_status,
      },
      items: items,
      message: "Challan Details Fetched Successfully",
    };

    return res.json(response);
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.post("/createEwayBillJobWork", [auth.isAuthorized], async (req, res) => {
  try {
  
    const validheaders = new Validator(req.body.header, {
      documentType: "required",
      supplyType: "required",
      subSupplyType: "required",
      documentNo: "required",
      documentDate: "required",
      transactionType: "required|in:1,2,3,4",
    });
    if (validheaders.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validheaders) });
    }

    const validBillFrom = new Validator(req.body.billFrom, {
      gstin: "required",
      legalName: "required",
      addressLine1: "required",
      addressLine2: "required",
      location: "required",
      state: "required",
      pincode: "required",
    });
    if (validBillFrom.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validBillFrom) });
    }

    const validBillTo = new Validator(req.body.billTo, {
      gstin: "required",
      legalName: "required",
      addressLine1: "required",
      addressLine2: "required",
      location: "required",
      state: "required",
      pincode: "required",
    });
    if (validBillTo.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validBillTo) });
    }

    if (req.body.transactionType == 3 || req.body.transactionType == 4) {
      const validdispatchFrom = new Validator(req.body.dispatchFrom, {
        legalName: "required",
        addressLine1: "required",
        addressLine2: "required",
        location: "required",
        state: "required",
        pincode: "required",
      });
      if (validdispatchFrom.fails()) {
        return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validdispatchFrom) });
      }
    }

    if (req.body.transactionType == 2 || req.body.transactionType == 4) {
      const validdispatchTo = new Validator(req.body.shipTo, {
        gstin: "required",
        legalName: "required",
        addressLine1: "required",
        addressLine2: "required",
        location: "required",
        state: "required",
        pincode: "required",
      });
      if (validdispatchTo.fails()) {
        return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validdispatchTo) });
      }
    }

    const validEwaybillDetails = new Validator(req.body.ewaybillDetails || {}, {
      transMode: "required|in:1,2,3,4",
      transDistance: "required|numeric",
      vehicleNo: "required",
    });
    if (validEwaybillDetails.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validEwaybillDetails) });
    }

  } catch (e) {
      return helper.errorResponse(res, e);
  }

  const transaction = await invtDB.transaction();
  try {
    
    const stmtCheck = await invtDB.query(
      "SELECT * FROM jw_material_challan WHERE jw_challan_txn_id = :challan_id AND jw_ewaybill_status = 'Y'",
      {
        replacements: { challan_id: req.body.header.documentNo },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmtCheck.length > 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "E-Way Bill Already Generated!!!" });
    }

    // Fetch pending challan data
    const pendingChallan = await invtDB.query(
      `SELECT jwmc.*, c.c_name, c.c_specification, u.units_name 
       FROM jw_material_challan jwmc 
       LEFT JOIN components c ON jwmc.jw_component_id = c.component_key 
       LEFT JOIN units u ON c.c_uom = u.units_id 
       WHERE jwmc.jw_challan_txn_id = :challan_id AND jwmc.jw_ewaybill_status = '--'`,
      {
        replacements: { challan_id: req.body.header.documentNo },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (pendingChallan.length === 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "No Pending Challan Found" });
    }

    const vehicleNo = req.body.ewaybillDetails?.vehicleNo || pendingChallan[0].jw_vehicle;
    if (!vehicleNo) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Vehicle number is required" });
    }

    
    const invalidChallan = pendingChallan.some((row) => !row.jw_order_qty || !row.jw_order_rate || !row.jw_hsncode || !row.c_name);
    if (invalidChallan) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Missing required fields: quantity, rate, HSN code, or component details",
      });
    }

    
    const itemList = pendingChallan.map((row) => ({
      productName: row.c_name || "",
      productDesc: row.c_specification || "",
      hsnCode: row.jw_hsncode && /^[0-9]{4,8}$/.test(row.jw_hsncode) ? row.jw_hsncode : "9988", 
      quantity: Number(row.jw_order_qty) || 1,
      qtyUnit: row.units_name ? row.units_name.toUpperCase() : "NOS",
      taxableAmount: Number(row.jw_order_rate) * Number(row.jw_order_qty) || 0,
      cgstRate: 0, 
      sgstRate: 0,
      igstRate: 0,
      cessRate: 0,
    }));

    const totalValue = Number(pendingChallan.reduce((sum, row) => sum + Number(row.jw_order_rate) * Number(row.jw_order_qty), 0).toFixed(2));

    // Construct e-way bill payload
    const ewayBillPayload = {
      supplyType: req.body.header.supplyType,
      subSupplyType: req.body.header.subSupplyType,
      subSupplyDesc: null,
      docType: req.body.header.documentType,
      docNo: req.body.header.documentNo,
      docDate: moment(req.body.header.documentDate, "DD-MM-YYYY hh:mm:ss").format("DD/MM/YYYY"),
      transactionType: req.body.header.transactionType,
      otherValue: 0, 
      totalValue: totalValue,
      cgstValue: 0, 
      sgstValue: 0,
      igstValue: 0,
      cessValue: 0,
      cessNonAdvolValue: 0,
      totInvValue: totalValue,
      transporterId: req.body.ewaybillDetails?.transporterId || "",
      transporterName: req.body.ewaybillDetails?.transporterName || "",
      transDocNo: req.body.ewaybillDetails?.transporterDocNo || "",
      transMode: req.body.ewaybillDetails?.transMode || "",
      transDistance: Number(req.body.ewaybillDetails?.transDistance) || 0,
      transDocDate: req.body.ewaybillDetails?.transporterDate
        ? moment(req.body.ewaybillDetails.transporterDate, "DD-MM-YYYY").format("DD/MM/YYYY")
        : null,
      vehicleNo: vehicleNo,
      vehicleType: req.body.ewaybillDetails?.vehicleType || "",
      itemList: itemList, 
    };

    
    if (req.body.header.transactionType == 3 || req.body.header.transactionType == 4) {
      ewayBillPayload.fromGstin = req.body.billFrom.gstin;
      ewayBillPayload.fromTrdName = req.body.dispatchFrom.legalName;
      ewayBillPayload.fromAddr1 = req.body.dispatchFrom.addressLine1;
      ewayBillPayload.fromAddr2 = req.body.dispatchFrom.addressLine2;
      ewayBillPayload.fromPlace = req.body.dispatchFrom.location;
      ewayBillPayload.fromPincode = Number(req.body.dispatchFrom.pincode);
      ewayBillPayload.actFromStateCode = Number(req.body.dispatchFrom.state);
      ewayBillPayload.fromStateCode = Number(req.body.dispatchFrom.state);
    } else {
      ewayBillPayload.fromGstin = req.body.billFrom.gstin;
      ewayBillPayload.fromTrdName = req.body.billFrom.legalName;
      ewayBillPayload.fromAddr1 = req.body.billFrom.addressLine1;
      ewayBillPayload.fromAddr2 = req.body.billFrom.addressLine2;
      ewayBillPayload.fromPlace = req.body.billFrom.location;
      ewayBillPayload.fromPincode = Number(req.body.billFrom.pincode);
      ewayBillPayload.actFromStateCode = Number(req.body.billFrom.state);
      ewayBillPayload.fromStateCode = Number(req.body.billFrom.state);
    }

    
    if (req.body.header.transactionType == 2 || req.body.header.transactionType == 4) {
      ewayBillPayload.toGstin = req.body.shipTo.gstin;
      ewayBillPayload.toTrdName = req.body.shipTo.legalName;
      ewayBillPayload.toAddr1 = req.body.shipTo.addressLine1;
      ewayBillPayload.toAddr2 = req.body.shipTo.addressLine2;
      ewayBillPayload.toPlace = req.body.shipTo.location;
      ewayBillPayload.toPincode = Number(req.body.shipTo.pincode);
      ewayBillPayload.actToStateCode = Number(req.body.shipTo.state);
      ewayBillPayload.toStateCode = Number(req.body.shipTo.state);
    } else {
      ewayBillPayload.toGstin = req.body.billTo.gstin; 
      ewayBillPayload.toTrdName = req.body.billTo.legalName;
      ewayBillPayload.toAddr1 = req.body.billTo.addressLine1;
      ewayBillPayload.toAddr2 = req.body.billTo.addressLine2;
      ewayBillPayload.toPlace = req.body.billTo.location;
      ewayBillPayload.toPincode = Number(req.body.billTo.pincode);
      ewayBillPayload.actToStateCode = Number(req.body.billTo.state);
      ewayBillPayload.toStateCode = Number(req.body.billTo.state);
    }

    helper.trimObjectValueStartEnd(ewayBillPayload);

    console.log("E-Way Bill Payload:", JSON.stringify(ewayBillPayload, null, 2));

    // Call NIC portal without timeout
    let generateEWB;
    try {
      generateEWB = await require("../../../controller/fynGateway/fynGatewayEwayBill").ewayBillGenerate(ewayBillPayload, req.body.billFrom.gstin || "");
    } catch (apiError) {
      await transaction.rollback();
      console.error("API Call Failed:", apiError.message);
      return res.status(503).json({
        status: "error",
        success: false,
        status: "error",
        message: "Something went wrong from NIC portal: " + apiError.message,
      });
    }

    console.log("E-Way Bill Response:", JSON.stringify(generateEWB, null, 2));

    if (!generateEWB || generateEWB.status == 0 || !generateEWB?.ewayBillNo) {
      await transaction.rollback();
      if (generateEWB?.status == 0 && generateEWB?.error) {
        const getEwaybillError = await invtDB.query(
          `SELECT * FROM ewaybill_errors WHERE errorCodes = '${generateEWB?.error?.errorCodes}'`,
          { type: invtDB.QueryTypes.SELECT }
        );
        if (getEwaybillError.length > 0) {
          return res.json({

            success: false,
            message: getEwaybillError[0].errorDescription,
          });
        }
      }
      return res.json({

        success: false,
        status: "error",
        message: generateEWB?.errorMessage ?? "Something went wrong from NIC portal: Invalid or no response received",
        res: generateEWB,
      });
    }

    // Save e-way bill data
    const ewabillReplacement = {
      challanID: req.body.header.documentNo,
      eway_type: 'jobwork',
      TxnID: pendingChallan[0].jw_challan_ref_id || "",
      supply_type: req.body.header.supplyType,
      sub_supply_type: req.body.header.subSupplyType,
      document_type: req.body.header.documentType,
      transaction_type: req.body.header.transactionType,
      transporter_id: req.body.ewaybillDetails?.transporterId || "",
      transporter_name: req.body.ewaybillDetails?.transporterName || "",
      trans_doc_no: req.body.ewaybillDetails?.transporterDocNo || "",
      trans_doc_date: req.body.ewaybillDetails?.transporterDate
        ? moment(req.body.ewaybillDetails.transporterDate, "DD-MM-YYYY").format("YYYY-MM-DD HH:mm:ss")
        : moment(req.body.header.documentDate, "DD-MM-YYYY hh:mm:ss").format("YYYY-MM-DD HH:mm:ss"),
      trans_mode: req.body.ewaybillDetails?.transMode || "",
      vehicle_no: req.body.ewaybillDetails.vehicleNo,
      eway_bill_no: generateEWB.ewayBillNo,
      generated_by: req.logedINUser,
      generated_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
      BuyerDtls: JSON.stringify(req.body.billTo),
      SellerDtls: JSON.stringify(req.body.billFrom),
    };
    if (req.body.header.transactionType == 2 || req.body.header.transactionType == 4) {
      ewabillReplacement.DispDtls = JSON.stringify(req.body.dispatchFrom);
    } else {
      ewabillReplacement.DispDtls = JSON.stringify({});
    }

    if (req.body.header.transactionType == 3 || req.body.header.transactionType == 4) {
      ewabillReplacement.ShipDtls = JSON.stringify(req.body.shipTo);
    } else {
      ewabillReplacement.ShipDtls = JSON.stringify({});
    }

    await invtDB.query(
      `INSERT INTO tbl_ewaybill (eway_type,challanID, TxnID, supply_type, sub_supply_type, document_type, transaction_type, transporter_id, transporter_name, trans_doc_no, trans_doc_date, SellerDtls, BuyerDtls, DispDtls,ShipTo, trans_mode, vehicle_no, eway_bill_no, generated_by, generated_dt)
       VALUES (:eway_type,:challanID, :TxnID, :supply_type, :sub_supply_type, :document_type, :transaction_type, :transporter_id, :transporter_name, :trans_doc_no, :trans_doc_date, :SellerDtls, :BuyerDtls, :DispDtls, :ShipDtls, :trans_mode, :vehicle_no, :eway_bill_no, :generated_by, :generated_dt)`,
      {
        replacements: ewabillReplacement,
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      }
    );

    await invtDB.query(
      "UPDATE jw_material_challan SET jw_ewaybill_no = :ewayBillNo, jw_ewaybill_status = 'GENERATED' WHERE jw_challan_txn_id = :challan_id",
      {
        replacements: {
          ewayBillNo: generateEWB.ewayBillNo,
          challan_id: req.body.header.documentNo,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      }
    );

    await transaction.commit();
    return res.json({

      success: true,
      data: generateEWB,
      message: "E-Waybill Generated successfully",
    });
  } catch (e) {
      return helper.errorResponse(res, e);
  }
});

//eway bill create fro delivery challan
router.post("/createEwayBillDc", [auth.isAuthorized], async (req, res) => {
  try {
    const validheaders = new Validator(req.body.header, {
      documentType: "required",
      supplyType: "required",
      subSupplyType: "required",
      documentNo: "required",
      documentDate: "required",
      transactionType: "required|in:1,2,3,4",
    });
    if (validheaders.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(validheaders) });
    }

    const validBillFrom = new Validator(req.body.billFrom, {
      gstin: "required",
      legalName: "required",
      addressLine1: "required",
      addressLine2: "required",
      location: "required",
      state: "required",
      pincode: "required",
    });
    if (validBillFrom.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(validBillFrom) });
    }

    const validBillTo = new Validator(req.body.billTo, {
      gstin: "required",
      legalName: "required",
      addressLine1: "required",
      addressLine2: "required",
      location: "required",
      state: "required",
      pincode: "required",
    });
    if (validBillTo.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(validBillTo) });
    }

    if (req.body.transactionType == 3 || req.body.transactionType == 4) {
      const validdispatchFrom = new Validator(req.body.dispatchFrom, {
        legalName: "required",
        addressLine1: "required",
        addressLine2: "required",
        location: "required",
        state: "required",
        pincode: "required",
      });
      if (validdispatchFrom.fails()) {
        return res.json({ success: false, message: helper.firstErrorValidatorjs(validdispatchFrom) });
      }
    }

    if (req.body.transactionType == 2 || req.body.transactionType == 4) {
      const validdispatchTo = new Validator(req.body.shipTo, {
        gstin: "required",
        legalName: "required",
        addressLine1: "required",
        addressLine2: "required",
        location: "required",
        state: "required",
        pincode: "required",
      });
      if (validdispatchTo.fails()) {
        return res.json({ success: false, message: helper.firstErrorValidatorjs(validdispatchTo) });
      }
    }

    const validEwaybillDetails = new Validator(req.body.ewaybillDetails || {}, {
      transMode: "required|in:1,2,3,4",
      transDistance: "required|numeric",
      vehicleNo: "required",
    });
    if (validEwaybillDetails.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validEwaybillDetails) });
    }
  } catch (e) {
      return helper.errorResponse(res, e);
  }

  const transaction = await invtDB.transaction();
  try {
    const stmtCheck = await invtDB.query(
      "SELECT * FROM ims_dc_challan WHERE dc_transaction = :challan_id AND ewaybill_status = 'Y'",
      {
        replacements: { challan_id: req.body.header.documentNo },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmtCheck.length > 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "E-Way Bill Already Generated!!!" });
    }

    const pendingChallan = await invtDB.query(
      "SELECT * FROM ims_dc_challan WHERE dc_transaction = :challan_id AND ewaybill_status = '--'",
      {
        replacements: { challan_id: req.body.header.documentNo },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (pendingChallan.length === 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "No Pending Challan Found" });
    }

    const challanData = pendingChallan;
    const vehicleNo = req.body.ewaybillDetails?.vehicleNo || challanData[0].dc_vehicle || "";

    const componentDetails = await invtDB.query(
      "SELECT c.*, u.units_name, ch.dc_qty, ch.dc_rate, ch.dc_hsn " +
      "FROM ims_dc_challan ch " +
      "LEFT JOIN components c ON c.component_key = ch.component " +
      "LEFT JOIN units u ON c.c_uom = u.units_id " +
      "WHERE ch.dc_transaction = :challan_id AND ch.ewaybill_status = '--'",
      {
        replacements: { challan_id: req.body.header.documentNo },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (componentDetails.length === 0) {
      await transaction.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Component details not found for this challan",
      });
    }

    const items = componentDetails.map((comp) => {
      const uqcCode = comp.units_name ? comp.units_name.toUpperCase() : "PCS";
      return {
        productName: comp.c_name ,
        productDesc: comp.c_specification ,
        hsnCode: comp.dc_hsn ,
        quantity: Number(comp.dc_qty) || 1,
        qtyUnit: uqcCode,
        taxableAmount: Number(comp.dc_rate) * Number(comp.dc_qty) || 0,
        cgstRate: 0,
        sgstRate: 0,
        igstRate: 0,
        cessRate: 0,
      };
    });

    const totalValue = componentDetails.reduce((sum, comp) => 
      sum + (Number(comp.dc_rate) * Number(comp.dc_qty) || 0), 0).toFixed(2);

    const ewayBillPayload = {
      supplyType: req.body.header.supplyType,
      subSupplyType: req.body.header.subSupplyType,
      subSupplyDesc: req.body.header.subSupplyType === "8" ? req.body.header?.subSupplyDesc : null,
      docType: req.body.header.documentType,
      docNo: req.body.header.documentNo,
      docDate: moment(req.body.header.documentDate, "DD-MM-YYYY hh:mm:ss").format("DD/MM/YYYY"),
      transactionType: req.body.header.transactionType,
      otherValue: 0,
      totalValue: Number(totalValue),
      cgstValue: 0,
      sgstValue: 0,
      igstValue: 0,
      cessValue: 0,
      cessNonAdvolValue: 0,
      totInvValue: Number(totalValue),
      transporterId: req.body.ewaybillDetails?.transporterId || "",
      transporterName: req.body.ewaybillDetails?.transporterName || "",
      transDocNo: req.body.ewaybillDetails?.transporterDocNo || "",
      transMode: req.body.ewaybillDetails?.transMode || "",
      transDistance: Number(req.body.ewaybillDetails?.transDistance) || 0,
      transDocDate: req.body.ewaybillDetails?.transporterDate
        ? moment(req.body.ewaybillDetails.transporterDate, "DD-MM-YYYY").format("DD/MM/YYYY")
        : null,
      vehicleNo: vehicleNo,
      vehicleType: req.body.ewaybillDetails?.vehicleType || "",
      ItemList: items,
    };

    if (req.body.header.transactionType == 3 || req.body.header.transactionType == 4) {
      ewayBillPayload.fromGstin = req.body.billFrom.gstin;
      ewayBillPayload.fromTrdName = req.body.dispatchFrom.legalName;
      ewayBillPayload.fromAddr1 = req.body.dispatchFrom.addressLine1;
      ewayBillPayload.fromAddr2 = req.body.dispatchFrom.addressLine2;
      ewayBillPayload.fromPlace = req.body.dispatchFrom.location;
      ewayBillPayload.fromPincode = Number(req.body.dispatchFrom.pincode);
      ewayBillPayload.actFromStateCode = Number(req.body.dispatchFrom.state);
      ewayBillPayload.fromStateCode = Number(req.body.dispatchFrom.state);
    } else {
      ewayBillPayload.fromGstin = req.body.billFrom.gstin;
      ewayBillPayload.fromTrdName = req.body.billFrom.legalName;
      ewayBillPayload.fromAddr1 = req.body.billFrom.addressLine1;
      ewayBillPayload.fromAddr2 = req.body.billFrom.addressLine2;
      ewayBillPayload.fromPlace = req.body.billFrom.location;
      ewayBillPayload.fromPincode = Number(req.body.billFrom.pincode);
      ewayBillPayload.actFromStateCode = Number(req.body.billFrom.state);
      ewayBillPayload.fromStateCode = Number(req.body.billFrom.state);
    }

    if (req.body.header.transactionType == 2 || req.body.header.transactionType == 4) {
      ewayBillPayload.toGstin = req.body.shipTo.gstin;
      ewayBillPayload.toTrdName = req.body.shipTo.legalName;
      ewayBillPayload.toAddr1 = req.body.shipTo.addressLine1;
      ewayBillPayload.toAddr2 = req.body.shipTo.addressLine2;
      ewayBillPayload.toPlace = req.body.shipTo.location;
      ewayBillPayload.toPincode = Number(req.body.shipTo.pincode);
      ewayBillPayload.actToStateCode = Number(req.body.shipTo.state);
      ewayBillPayload.toStateCode = Number(req.body.shipTo.state);
    } else {
      ewayBillPayload.toGstin = req.body.billTo.gstin;
      ewayBillPayload.toTrdName = req.body.billTo.legalName;
      ewayBillPayload.toAddr1 = req.body.billTo.addressLine1;
      ewayBillPayload.toAddr2 = req.body.billTo.addressLine2;
      ewayBillPayload.toPlace = req.body.billTo.location;
      ewayBillPayload.toPincode = Number(req.body.billTo.pincode);
      ewayBillPayload.actToStateCode = Number(req.body.billTo.state);
      ewayBillPayload.toStateCode = Number(req.body.billTo.state);
    }

    helper.trimObjectValueStartEnd(ewayBillPayload);

    console.log("E-Way Bill Payload:", JSON.stringify(ewayBillPayload, null, 2));

    const timeoutPromise = (promise, timeoutMs, errorMessage) => {
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
    };

    let generateEWB;
    try {
      generateEWB = await timeoutPromise(
        require("../../../controller/fynGateway/fynGatewayEwayBill").ewayBillGenerate(ewayBillPayload, req.body.billFrom.gstin || ""),
        60000,
        "Timeout: No response from NIC portal"
      );
    } catch (apiError) {
      await transaction.rollback();
      console.error("API Call Failed:", apiError.message);
      return res.status(503).json({
        status: "error",
        success: false,
        message: "Something went wrong from NIC portal: " + apiError.message,
      });
    }

    console.log("E-Way Bill Response:", JSON.stringify(generateEWB, null, 2));

    if (!generateEWB || generateEWB.status == 0 || !generateEWB?.ewayBillNo) {
      await transaction.rollback();
      if (generateEWB?.status == 0 && generateEWB?.error) {
        const getEwaybillError = await invtDB.query(
          `SELECT * FROM ewaybill_errors WHERE errorCodes = '${generateEWB?.error?.errorCodes}'`,
          { type: invtDB.QueryTypes.SELECT }
        );
        if (getEwaybillError.length > 0) {
          return res.json({

            success: false,
            message: getEwaybillError[0].errorDescription,
          });
        }
      }
      return res.json({

        success: false,
        status: "error",
        message: generateEWB?.errorMessage ?? "Something went wrong from NIC portal: Invalid or no response received",
        res: generateEWB,
      });
    }

    const ewabillReplacement = {
      challanID: req.body.header.documentNo,
      TxnID: challanData[0].dc_transaction || "",
      supply_type: req.body.header.supplyType,
      sub_supply_type: req.body.header.subSupplyType,
      document_type: req.body.header.documentType,
      transaction_type: req.body.header.transactionType,
      transporter_id: req.body.ewaybillDetails?.transporterId || "",
      transporter_name: req.body.ewaybillDetails?.transporterName || "",
      trans_doc_no: req.body.ewaybillDetails?.transporterDocNo || "",
      trans_doc_date: req.body.ewaybillDetails?.transporterDate
        ? moment(req.body.ewaybillDetails.transporterDate, "DD-MM-YYYY").format("YYYY-MM-DD HH:mm:ss")
        : moment(req.body.header.documentDate, "DD-MM-YYYY hh:mm:ss").format("YYYY-MM-DD HH:mm:ss"),
      trans_mode: req.body.ewaybillDetails?.transMode || "",
      vehicle_no: req.body.ewaybillDetails.vehicleNo,
      eway_bill_no: generateEWB.ewayBillNo,
      generated_by: req.logedINUser,
      generated_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
      BuyerDtls: JSON.stringify(req.body.billTo),
      SellerDtls: JSON.stringify(req.body.billFrom),
    };
    if (req.body.header.transactionType == 2 || req.body.header.transactionType == 4) {
      ewabillReplacement.DispDtls = JSON.stringify(req.body.dispatchFrom);
    } else {
      ewabillReplacement.DispDtls = JSON.stringify({});
    }

    if (req.body.header.transactionType == 3 || req.body.header.transactionType == 4) {
      ewabillReplacement.ShipDtls = JSON.stringify(req.body.shipTo);
    } else {
      ewabillReplacement.ShipDtls = JSON.stringify({});
    }

    console.log("ewabillReplacement-->", JSON.stringify(ewabillReplacement, null, 2));

    await invtDB.query(
      `INSERT INTO tbl_ewaybill (eway_type, challanID, TxnID, supply_type, sub_supply_type, document_type, transaction_type, transporter_id, transporter_name, trans_doc_no, trans_doc_date, SellerDtls, BuyerDtls, DispDtls, ShipTo, trans_mode, vehicle_no, eway_bill_no, generated_by, generated_dt)
       VALUES (:eway_type, :challanID, :TxnID, :supply_type, :sub_supply_type, :document_type, :transaction_type, :transporter_id, :transporter_name, :trans_doc_no, :trans_doc_date, :SellerDtls, :BuyerDtls, :DispDtls, :ShipDtls, :trans_mode, :vehicle_no, :eway_bill_no, :generated_by, :generated_dt)`,
      {
        replacements: ewabillReplacement,
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      }
    );

    await invtDB.query(
      "UPDATE ims_dc_challan SET ewaybill_no = :ewayBillNo, ewaybill_status = 'GENERATED' WHERE dc_transaction = :challan_id",
      {
        replacements: {
          ewayBillNo: generateEWB.ewayBillNo,
          challan_id: req.body.header.documentNo,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      }
    );

    await transaction.commit();
    return res.json({

      success: true,
      data: generateEWB,
      message: "E-Waybill Generated successfully",
    });
  } catch (e) {
      return helper.errorResponse(res, e);
  }
});

router.post("/createEwayforScrapeWo", [auth.isAuthorized], async (req, res) => {
  try {
  
   const validheaders = new Validator(req.body.header, {
      documentType: "required",
      supplyType: "required",
      subSupplyType: "required",
      documentNo: "required",
      documentDate: "required",
      transactionType: "required|in:1,2,3,4",
    });
    if (validheaders.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(validheaders) });
    }

    const validBillFrom = new Validator(req.body.billFrom, {
      gstin: "required",
      legalName: "required",
      addressLine1: "required",
      addressLine2: "required",
      location: "required",
      state: "required",
      pincode: "required",
    });
    if (validBillFrom.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(validBillFrom) });
    }

    const validBillTo = new Validator(req.body.billTo, {
      gstin: "required",
      legalName: "required",
      addressLine1: "required",
      addressLine2: "required",
      location: "required",
      state: "required",
      pincode: "required",
    });
    if (validBillTo.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(validBillTo) });
    }

    if (req.body.transactionType == 3 || req.body.transactionType == 4) {
      const validdispatchFrom = new Validator(req.body.dispatchFrom, {
        legalName: "required",
        addressLine1: "required",
        addressLine2: "required",
        location: "required",
        state: "required",
        pincode: "required",
      });
      if (validdispatchFrom.fails()) {
        return res.json({ success: false, message: helper.firstErrorValidatorjs(validdispatchFrom) });
      }
    }

    if (req.body.transactionType == 2 || req.body.transactionType == 4) {
      const validdispatchTo = new Validator(req.body.shipTo, {
        gstin: "required",
        legalName: "required",
        addressLine1: "required",
        addressLine2: "required",
        location: "required",
        state: "required",
        pincode: "required",
      });
      if (validdispatchTo.fails()) {
        return res.json({ success: false, message: helper.firstErrorValidatorjs(validdispatchTo) });
      }
    }

    const validEwaybillDetails = new Validator(req.body.ewaybillDetails || {}, {
      transMode: "required|in:1,2,3,4",
      transDistance: "required|numeric",
      vehicleNo: "required",
    });
    if (validEwaybillDetails.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validEwaybillDetails) });
    }

  } catch (e) {
      return helper.errorResponse(res, e);
  }
  const transaction = await invtDB.transaction();
  try {
    const stmtCheck = await invtDB.query(
      "SELECT * FROM wo_scrap_challan WHERE wo_challan_id = :challan_id AND wo_challan_status = 'GENERATED'",
      {
        replacements: { challan_id: req.body.header.documentNo },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (stmtCheck.length > 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "E-Way Bill Already Generated!!!" });
    }

    const pendingChallan = await invtDB.query(
      "SELECT * FROM wo_scrap_challan WHERE wo_challan_id = :challan_id AND wo_challan_status = 'N'",
      {
        replacements: { challan_id: req.body.header.documentNo },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (pendingChallan.length === 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "No Pending Scrap Work Order Challan Found" });
    }

    const challanData = pendingChallan[0];
    const vehicleNo = req.body.ewaybillDetails.vehicleNo || challanData.wo_vehicle;

    const componentDetails = await invtDB.query(
      "SELECT c.c_name, c.c_specification, u.units_name FROM components c LEFT JOIN units u ON c.c_uom = u.units_id WHERE c.component_key = :component_key",
      {
        replacements: { component_key: challanData.wo_component_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (componentDetails.length === 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Component details not found for this challan" });
    }

    if (!challanData.wo_order_qty || !challanData.wo_order_rate || !challanData.wo_hsn_code) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Missing required fields: quantity, rate, or HSN code" });
    }

    const items = componentDetails.map((comp) => ({
      productName: comp.c_name,
      productDesc: comp.c_specification || "--",
      hsnCode: challanData.wo_hsn_code,
      quantity: Number(challanData.wo_order_qty),
      qtyUnit: comp.units_name.toUpperCase(),
      taxableAmount: Number(challanData.wo_order_rate) * Number(challanData.wo_order_qty),
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
      cessRate: 0,
    }));

    const totalValue = Number((challanData.wo_order_rate * challanData.wo_order_qty).toFixed(2));

    const ewayBillPayload = {
      supplyType: req.body.header.supplyType,
      subSupplyType: req.body.header.subSupplyType,
      subSupplyDesc: null,
      docType: req.body.header.documentType,
      docNo: req.body.header.documentNo,
      docDate: moment(req.body.header.documentDate, "DD-MM-YYYY hh:mm:ss").format("DD/MM/YYYY"),
      transactionType: req.body.header.transactionType,
      otherValue: 0,
      totalValue: totalValue,
      cgstValue: 0,
      sgstValue: 0,
      igstValue: 0,
      cessValue: 0,
      cessNonAdvolValue: 0,
      totInvValue: totalValue,
      transporterId: req.body.ewaybillDetails?.transporterId || "",
      transporterName: req.body.ewaybillDetails?.transporterName || "",
      transDocNo: req.body.ewaybillDetails?.transporterDocNo || "",
      transMode: req.body.ewaybillDetails.transMode,
      transDistance: Number(req.body.ewaybillDetails.transDistance),
      transDocDate: req.body.ewaybillDetails?.transporterDate
        ? moment(req.body.ewaybillDetails.transporterDate, "DD-MM-YYYY").format("DD/MM/YYYY")
        : null,
      vehicleNo: vehicleNo,
      vehicleType: req.body.ewaybillDetails?.vehicleType || "R", // Default to Regular
      ItemList: items,
    };

    if (req.body.header.transactionType == 3 || req.body.header.transactionType == 4) {
      ewayBillPayload.fromGstin = req.body.billFrom.gstin;
      ewayBillPayload.fromTrdName = req.body.dispatchFrom.legalName;
      ewayBillPayload.fromAddr1 = req.body.dispatchFrom.addressLine1;
      ewayBillPayload.fromAddr2 = req.body.dispatchFrom.addressLine2;
      ewayBillPayload.fromPlace = req.body.dispatchFrom.location;
      ewayBillPayload.fromPincode = Number(req.body.dispatchFrom.pincode);
      ewayBillPayload.actFromStateCode = Number(req.body.dispatchFrom.state);
      ewayBillPayload.fromStateCode = Number(req.body.dispatchFrom.state);
    } else {
      ewayBillPayload.fromGstin = req.body.billFrom.gstin;
      ewayBillPayload.fromTrdName = req.body.billFrom.legalName;
      ewayBillPayload.fromAddr1 = req.body.billFrom.addressLine1;
      ewayBillPayload.fromAddr2 = req.body.billFrom.addressLine2;
      ewayBillPayload.fromPlace = req.body.billFrom.location;
      ewayBillPayload.fromPincode = Number(req.body.billFrom.pincode);
      ewayBillPayload.actFromStateCode = Number(req.body.billFrom.state);
      ewayBillPayload.fromStateCode = Number(req.body.billFrom.state);
    }

    
    if (req.body.header.transactionType == 2 || req.body.header.transactionType == 4) {
      ewayBillPayload.toGstin = req.body.shipTo.gstin;
      ewayBillPayload.toTrdName = req.body.shipTo.legalName;
      ewayBillPayload.toAddr1 = req.body.shipTo.addressLine1;
      ewayBillPayload.toAddr2 = req.body.shipTo.addressLine2;
      ewayBillPayload.toPlace = req.body.shipTo.location;
      ewayBillPayload.toPincode = Number(req.body.shipTo.pincode);
      ewayBillPayload.actToStateCode = Number(req.body.shipTo.state);
      ewayBillPayload.toStateCode = Number(req.body.shipTo.state);
    } else {
      ewayBillPayload.toGstin = req.body.billTo.gstin; 
      ewayBillPayload.toTrdName = req.body.billTo.legalName;
      ewayBillPayload.toAddr1 = req.body.billTo.addressLine1;
      ewayBillPayload.toAddr2 = req.body.billTo.addressLine2;
      ewayBillPayload.toPlace = req.body.billTo.location;
      ewayBillPayload.toPincode = Number(req.body.billTo.pincode);
      ewayBillPayload.actToStateCode = Number(req.body.billTo.state);
      ewayBillPayload.toStateCode = Number(req.body.billTo.state);
    }


    helper.trimObjectValueStartEnd(ewayBillPayload);
    console.log("E-Way Bill Payload:", JSON.stringify(ewayBillPayload, null, 2));

    const timeoutPromise = (promise, timeoutMs, errorMessage) => {
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
    };

    let generateEWB;
    try {
      generateEWB = await timeoutPromise(
        require("../../../controller/fynGateway/fynGatewayEwayBill").ewayBillGenerate(ewayBillPayload, req.body.billFrom.gstin),
        60000, // Increased timeout to 60 seconds
        "Timeout: No response from NIC portal"
      );
    } catch (apiError) {
      await transaction.rollback();
      console.error("API Call Failed:", apiError.message);
      return res.status(503).json({
        status: "error",
        success: false,
        status: "error",
        message: "Something went wrong from NIC portal: " + apiError.message,
        error: apiError.stack,
      });
    }

    console.log("E-Way Bill Response:", JSON.stringify(generateEWB, null, 2));

    if (!generateEWB || generateEWB.status == 0 || !generateEWB?.ewayBillNo) {
      await transaction.rollback();
      if (generateEWB?.status == 0 && generateEWB?.error) {
        const getEwaybillError = await invtDB.query(
          `SELECT * FROM ewaybill_errors WHERE errorCodes = :errorCode`,
          {
            replacements: { errorCode: generateEWB?.error?.errorCodes },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (getEwaybillError.length > 0) {
          return res.json({
            status: "error",
            success: false,
            message: `E-Way Bill generation failed: ${getEwaybillError[0].errorDescription}`,
            errorCode: generateEWB.error.errorCodes,
          });
        }
      }
      return res.json({

        success: false,
        status: "error",
        message: generateEWB?.errorMessage ?? "Something went wrong from NIC portal: Invalid or no response received",
        response: generateEWB,
      });
    }

    const ewabillReplacement = {
      challanID: req.body.header.documentNo,
      eway_type: 'scrape',
      TxnID: challanData.wo_challan_id,
      supply_type: req.body.header.supplyType,
      sub_supply_type: req.body.header.subSupplyType,
      document_type: req.body.header.documentType,
      transaction_type: req.body.header.transactionType,
      transporter_id: req.body.ewaybillDetails?.transporterId || "",
      transporter_name: req.body.ewaybillDetails?.transporterName || "",
      trans_doc_no: req.body.ewaybillDetails?.transporterDocNo || "",
      trans_doc_date: req.body.ewaybillDetails?.transporterDate
        ? moment(req.body.ewaybillDetails.transporterDate, "DD-MM-YYYY").format("YYYY-MM-DD HH:mm:ss")
        : moment(req.body.header.documentDate, "DD-MM-YYYY HH:mm:ss").format("YYYY-MM-DD HH:mm:ss"),
        trans_mode: req.body.ewaybillDetails?.transMode || "",
        vehicle_no: req.body.ewaybillDetails.vehicleNo,
        eway_bill_no: generateEWB.ewayBillNo,
        generated_by: req.logedINUser,
        generated_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
        BuyerDtls: JSON.stringify(req.body.billTo),
        SellerDtls: JSON.stringify(req.body.billFrom),
    };

    if (req.body.header.transactionType == 2 || req.body.header.transactionType == 4) {
      ewabillReplacement.DispDtls = JSON.stringify(req.body.dispatchFrom);
    } else {
      ewabillReplacement.DispDtls = JSON.stringify({});
    }

    if (req.body.header.transactionType == 3 || req.body.header.transactionType == 4) {
      ewabillReplacement.ShipDtls = JSON.stringify(req.body.shipTo);
    } else {
      ewabillReplacement.ShipDtls = JSON.stringify({});
    }

    await invtDB.query(
      `INSERT INTO tbl_ewaybill (eway_type,challanID, TxnID, supply_type, sub_supply_type, document_type, transaction_type, transporter_id, transporter_name, trans_doc_no, trans_doc_date, SellerDtls, BuyerDtls, DispDtls,ShipTo, trans_mode, vehicle_no, eway_bill_no, generated_by, generated_dt)
       VALUES (:eway_type,:challanID, :TxnID, :supply_type, :sub_supply_type, :document_type, :transaction_type, :transporter_id, :transporter_name, :trans_doc_no, :trans_doc_date, :SellerDtls, :BuyerDtls, :DispDtls, :ShipDtls, :trans_mode, :vehicle_no, :eway_bill_no, :generated_by, :generated_dt)`,
      {
        replacements: ewabillReplacement,
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      }
    );

    await invtDB.query(
      "UPDATE wo_scrap_challan SET wo_eway_no = :ewayBillNo, wo_challan_status = 'GENERATED', wo_ewaybill_status = 'generated' WHERE wo_challan_id = :challan_id",
      {
        replacements: {
          ewayBillNo: generateEWB.ewayBillNo,
          challan_id: req.body.header.documentNo,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      }
    );

    await transaction.commit();
    return res.json({

      success: true,
      data: generateEWB,
      message: "E-Waybill Generated successfully",
    });
  } catch (e) {
      return helper.errorResponse(res, e);
  }
});


router.post("/createEwayBillWorkOrder", [auth.isAuthorized], async (req, res) => {
  try {
    const validheaders = new Validator(req.body.header, {
      documentType: "required",
      supplyType: "required",
      subSupplyType: "required",
      documentNo: "required",
      documentDate: "required",
      transactionType: "required|in:1,2,3,4",
    });
    if (validheaders.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(validheaders) });
    }

    const validBillFrom = new Validator(req.body.billFrom, {
      gstin: "required",
      legalName: "required",
      addressLine1: "required",
      addressLine2: "required",
      location: "required",
      state: "required",
      pincode: "required",
    });
    if (validBillFrom.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(validBillFrom) });
    }

    const validBillTo = new Validator(req.body.billTo, {
      gstin: "required",
      legalName: "required",
      addressLine1: "required",
      addressLine2: "required",
      location: "required",
      state: "required",
      pincode: "required",
    });
    if (validBillTo.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(validBillTo) });
    }

    if (req.body.transactionType == 3 || req.body.transactionType == 4) {
      const validdispatchFrom = new Validator(req.body.dispatchFrom, {
        legalName: "required",
        addressLine1: "required",
        addressLine2: "required",
        location: "required",
        state: "required",
        pincode: "required",
      });
      if (validdispatchFrom.fails()) {
        return res.json({ success: false, message: helper.firstErrorValidatorjs(validdispatchFrom) });
      }
    }

    if (req.body.transactionType == 2 || req.body.transactionType == 4) {
      const validdispatchTo = new Validator(req.body.shipTo, {
        gstin: "required",
        legalName: "required",
        addressLine1: "required",
        addressLine2: "required",
        location: "required",
        state: "required",
        pincode: "required",
      });
      if (validdispatchTo.fails()) {
        return res.json({ success: false, message: helper.firstErrorValidatorjs(validdispatchTo) });
      }
    }

    const validEwaybillDetails = new Validator(req.body.ewaybillDetails || {}, {
      transMode: "required|in:1,2,3,4",
      transDistance: "required|numeric",
      vehicleNo: "required",
    });
    if (validEwaybillDetails.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validEwaybillDetails) });
    }

  } catch (e) {
      return helper.errorResponse(res, e);
  }

  const transaction = await invtDB.transaction();
  try {
    const stmtCheck = await invtDB.query(
      "SELECT * FROM wo_delivery_challan WHERE wo_transaction = :challan_no AND wo_ewaybill_status = 'GENERATED'",
      {
        replacements: { challan_no: req.body.header.documentNo },
        type: invtDB.QueryTypes.SELECT,
        transaction,
      }
    );
    if (stmtCheck.length > 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "E-Way Bill Already Generated!!!" });
    }

    // Updated query to get all records without grouping initially
    const pendingChallan = await invtDB.query(
      `SELECT wdc.*, 
        pp.product_key AS primary_product_key, pp.p_name AS primary_product_name, pp.p_sku AS primary_product_sku, pp.p_description AS primary_product_desc, ppu.units_name AS primary_product_unit,
        sp.product_key AS secondary_product_key, sp.p_name AS secondary_product_name, sp.p_sku AS secondary_product_sku, sp.p_description AS secondary_product_desc, spu.units_name AS secondary_product_unit
      FROM wo_delivery_challan wdc 
      LEFT JOIN products pp ON wdc.wo_product_id = pp.product_key 
      LEFT JOIN units ppu ON pp.p_uom = ppu.units_id 
      LEFT JOIN products sp ON wdc.wo_secondary_product_id = sp.product_key 
      LEFT JOIN units spu ON sp.p_uom = spu.units_id 
      WHERE wdc.wo_challan_txn_id = :challan_no AND wdc.wo_ewaybill_status = '--'`,
      {
        replacements: { challan_no: req.body.header.documentNo },
        type: invtDB.QueryTypes.SELECT,
        transaction,
      }
    );
    
    if (pendingChallan.length === 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "No Pending Work Order Challan Found" });
    }

    const challanData = pendingChallan[0];
    const vehicleNo = req.body.ewaybillDetails?.vehicleNo || challanData.wo_vehicle;
    if (!vehicleNo) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Vehicle number is required" });
    }

    // Group items by product (either secondary or primary) and combine quantities
    const productMap = new Map();
    
    pendingChallan.forEach((row) => {
      if (!row.wo_order_qty || !row.wo_order_rate || !row.wo_hsncode) {
        return; // Skip rows with missing required fields
      }

      // Determine which product to use (secondary takes priority if available)
      const productId = row.wo_secondary_product_id || row.wo_product_id;
      const productName = row.secondary_product_name || row.primary_product_name;
      const productDesc = row.secondary_product_desc || row.primary_product_desc;
      const productUnit = (row.secondary_product_unit || row.primary_product_unit || "NOS").toUpperCase();
      
      const key = `${productId}_${row.wo_hsncode}_${row.wo_order_rate}`;
      
      if (productMap.has(key)) {
        // If product already exists, add the quantities
        const existingItem = productMap.get(key);
        existingItem.quantity += Number(row.wo_order_qty);
        existingItem.taxableAmount += Number(row.wo_order_rate) * Number(row.wo_order_qty);
      } else {
        // New product entry
        productMap.set(key, {
          productName: productName,
          productDesc: productDesc,
          hsnCode: row.wo_hsncode,
          quantity: Number(row.wo_order_qty),
          qtyUnit: productUnit,
          rate: Number(row.wo_order_rate),
          taxableAmount: Number(row.wo_order_rate) * Number(row.wo_order_qty),
          cgstRate: 0,
          sgstRate: 0,
          igstRate: 0,
          cessRate: 0,
        });
      }
    });

    // Check if we have any valid items after processing
    if (productMap.size === 0) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "No valid items found with required fields: quantity, rate, or HSN code" });
    }

    // Convert map to array for E-way bill
    const items = Array.from(productMap.values());
    
    // Calculate total value from combined items
    const totalValue = Number(
      items.reduce((sum, item) => sum + item.taxableAmount, 0).toFixed(2)
    );

    // Prepare E-Way Bill payload
    const ewayBillPayload = {
      supplyType: req.body.header.supplyType,
      subSupplyType: req.body.header.subSupplyType,
      subSupplyDesc: null,
      docType: req.body.header.documentType,
      docNo: req.body.header.documentNo,
      docDate: moment(req.body.header.documentDate, "DD-MM-YYYY HH:mm:ss").format("DD/MM/YYYY"),
      transactionType: req.body.header.transactionType,
      otherValue: 0,
      totalValue: totalValue,
      cgstValue: 0,
      sgstValue: 0,
      igstValue: 0,
      cessValue: 0,
      cessNonAdvolValue: 0,
      totInvValue: totalValue,
      transporterId: req.body.ewaybillDetails?.transporterId || "",
      transporterName: req.body.ewaybillDetails?.transporterName || "",
      transDocNo: req.body.ewaybillDetails?.transporterDocNo || "",
      transMode: req.body.ewaybillDetails?.transMode || "1",
      transDistance: Number(req.body.ewaybillDetails.transDistance),
      transDocDate: req.body.ewaybillDetails?.transporterDate
        ? moment(req.body.ewaybillDetails.transporterDate, "DD-MM-YYYY").format("DD/MM/YYYY")
        : null,
      vehicleNo: vehicleNo,
      vehicleType: req.body.ewaybillDetails?.vehicleType || "R",
      ItemList: items,
    };

    if (req.body.header.transactionType == 3 || req.body.header.transactionType == 4) {
      ewayBillPayload.fromGstin = req.body.billFrom.gstin;
      ewayBillPayload.fromTrdName = req.body.dispatchFrom.legalName;
      ewayBillPayload.fromAddr1 = req.body.dispatchFrom.addressLine1;
      ewayBillPayload.fromAddr2 = req.body.dispatchFrom.addressLine2;
      ewayBillPayload.fromPlace = req.body.dispatchFrom.location;
      ewayBillPayload.fromPincode = Number(req.body.dispatchFrom.pincode);
      ewayBillPayload.actFromStateCode = Number(req.body.dispatchFrom.state);
      ewayBillPayload.fromStateCode = Number(req.body.dispatchFrom.state);
    } else {
      ewayBillPayload.fromGstin = req.body.billFrom.gstin;
      ewayBillPayload.fromTrdName = req.body.billFrom.legalName;
      ewayBillPayload.fromAddr1 = req.body.billFrom.addressLine1;
      ewayBillPayload.fromAddr2 = req.body.billFrom.addressLine2;
      ewayBillPayload.fromPlace = req.body.billFrom.location;
      ewayBillPayload.fromPincode = Number(req.body.billFrom.pincode);
      ewayBillPayload.actFromStateCode = Number(req.body.billFrom.state);
      ewayBillPayload.fromStateCode = Number(req.body.billFrom.state);
    }

    if (req.body.header.transactionType == 2 || req.body.header.transactionType == 4) {
      ewayBillPayload.toGstin = req.body.shipTo.gstin;
      ewayBillPayload.toTrdName = req.body.shipTo.legalName;
      ewayBillPayload.toAddr1 = req.body.shipTo.addressLine1;
      ewayBillPayload.toAddr2 = req.body.shipTo.addressLine2;
      ewayBillPayload.toPlace = req.body.shipTo.location;
      ewayBillPayload.toPincode = Number(req.body.shipTo.pincode);
      ewayBillPayload.actToStateCode = Number(req.body.shipTo.state);
      ewayBillPayload.toStateCode = Number(req.body.shipTo.state);
    } else {
      ewayBillPayload.toGstin = req.body.billTo.gstin; 
      ewayBillPayload.toTrdName = req.body.billTo.legalName;
      ewayBillPayload.toAddr1 = req.body.billTo.addressLine1;
      ewayBillPayload.toAddr2 = req.body.billTo.addressLine2;
      ewayBillPayload.toPlace = req.body.billTo.location;
      ewayBillPayload.toPincode = Number(req.body.billTo.pincode);
      ewayBillPayload.actToStateCode = Number(req.body.billTo.state);
      ewayBillPayload.toStateCode = Number(req.body.billTo.state);
    }

    helper.trimObjectValueStartEnd(ewayBillPayload);

    console.log("E-Way Bill Payload:", JSON.stringify(ewayBillPayload, null, 2));
    console.log("Combined Items Count:", items.length);
    console.log("Original Records Count:", pendingChallan.length);

    const timeoutPromise = (promise, timeoutMs, errorMessage) => {
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
    };

    let generateEWB;
    try {
      generateEWB = await timeoutPromise(
        require("../../../controller/fynGateway/fynGatewayEwayBill").ewayBillGenerate(ewayBillPayload, req.body.billFrom.gstin),
        60000,
        "Timeout: No response from NIC portal"
      );
    } catch (apiError) {
      await transaction.rollback();
      console.error("API Call Failed:", apiError.message);
      return res.status(503).json({
        status: "error",
        success: false,
        message: "Something went wrong from NIC portal: " + apiError.message,
      });
    }

    console.log("E-Way Bill Response:", JSON.stringify(generateEWB, null, 2)); // DON'T REMOVE THIS CONSOLE LOG

    if (!generateEWB || generateEWB.status == 0 || !generateEWB?.ewayBillNo) {
      // FIXED: Check if transaction is still active before rollback
      if (!transaction.finished) {
        await transaction.rollback();
      }
      
      if (generateEWB?.status == 0 && generateEWB?.error) {
        // FIXED: Use a new transaction for error lookup since previous one is rolled back
        const getEwaybillError = await invtDB.query(
          `SELECT * FROM ewaybill_errors WHERE errorCodes = :errorCode`,
          {
            replacements: { errorCode: generateEWB?.error?.errorCodes },
            type: invtDB.QueryTypes.SELECT,
            // FIXED: Removed transaction parameter
          }
        );
        if (getEwaybillError.length > 0) {
          return res.json({

            success: false,
            message: getEwaybillError[0].errorDescription,
          });
        }
      }
      return res.json({

        success: false,
        status: "error",
        message: generateEWB?.errorMessage ?? "Something went wrong from NIC portal: Invalid or no response received",
        res: generateEWB,
      });
    }

    const ewabillReplacement = {
      challanID: req.body.header.documentNo,
      eway_type: 'delivery',
      TxnID: challanData.wo_transaction,
      supply_type: req.body.header.supplyType,
      sub_supply_type: req.body.header.subSupplyType,
      document_type: req.body.header.documentType,
      transaction_type: req.body.header.transactionType,
      transporter_id: req.body.ewaybillDetails?.transporterId || "",
      transporter_name: req.body.ewaybillDetails?.transporterName || "",
      trans_doc_no: req.body.ewaybillDetails?.transporterDocNo || "",
      trans_doc_date: req.body.ewaybillDetails?.transporterDate
        ? moment(req.body.ewaybillDetails.transporterDate, "DD-MM-YYYY").format("YYYY-MM-DD HH:mm:ss")
        : moment(req.body.header.documentDate, "DD-MM-YYYY HH:mm:ss").format("YYYY-MM-DD HH:mm:ss"),
        trans_mode: req.body.ewaybillDetails?.transMode || "",
        vehicle_no: req.body.ewaybillDetails.vehicleNo,
        eway_bill_no: generateEWB.ewayBillNo,
        generated_by: req.logedINUser,
        generated_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
        BuyerDtls: JSON.stringify(req.body.billTo),
        SellerDtls: JSON.stringify(req.body.billFrom),
    };

    if (req.body.header.transactionType == 2 || req.body.header.transactionType == 4) {
      ewabillReplacement.DispDtls = JSON.stringify(req.body.dispatchFrom);
    } else {
      ewabillReplacement.DispDtls = JSON.stringify({});
    }

    if (req.body.header.transactionType == 3 || req.body.header.transactionType == 4) {
      ewabillReplacement.ShipDtls = JSON.stringify(req.body.shipTo);
    } else {
      ewabillReplacement.ShipDtls = JSON.stringify({});
    }
    
    console.log("ewabillReplacement-->", JSON.stringify(ewabillReplacement, null, 2));

    await invtDB.query(
      `INSERT INTO tbl_ewaybill (eway_type,challanID, TxnID, supply_type, sub_supply_type, document_type, transaction_type, transporter_id, transporter_name, trans_doc_no, trans_doc_date, SellerDtls, BuyerDtls, DispDtls,ShipTo, trans_mode, vehicle_no, eway_bill_no, generated_by, generated_dt)
       VALUES (:eway_type,:challanID, :TxnID, :supply_type, :sub_supply_type, :document_type, :transaction_type, :transporter_id, :transporter_name, :trans_doc_no, :trans_doc_date, :SellerDtls, :BuyerDtls, :DispDtls, :ShipDtls, :trans_mode, :vehicle_no, :eway_bill_no, :generated_by, :generated_dt)`,
      {
        replacements: ewabillReplacement,
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      }
    );

    // Update all records with the same challan_txn_id
    await invtDB.query(
      "UPDATE wo_delivery_challan SET wo_eway_no = :ewayBillNo, wo_ewaybill_status = 'GENERATED' WHERE wo_challan_txn_id = :challan_no",
      {
        replacements: {
          ewayBillNo: generateEWB.ewayBillNo,
          challan_no: req.body.header.documentNo,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction,
      }
    );

    await transaction.commit();
    return res.json({

      success: true,
      status: "success",
      data: {
        ...generateEWB,
        itemsProcessed: items.length,
        totalRecords: pendingChallan.length
      },
      message: "E-Way Bill Generated Successfully",
    });
  } catch (e) {
      return helper.errorResponse(res, e);
  }
});
module.exports = router;

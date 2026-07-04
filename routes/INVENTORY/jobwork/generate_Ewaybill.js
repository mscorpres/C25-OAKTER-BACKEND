const express = require("express");
const router = express.Router();
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");
const axios = require("axios");

let { invtDB, otherDB } = require("../../../config/db/connection");

//GET JW Challan data
router.post("/fetch_challan_data", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    challan_no: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "something you missing in form field to supply", data: validation.errors.all() });
  }

  try {
    let stmt = await invtDB.query(
      "SELECT jw_material_challan.*, jw_material_challan.ID AS row_id, components.component_key, components.c_name, components.c_part_no, components.c_specification, units.units_name, ven_basic_detail.ven_name FROM jw_material_challan LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = jw_material_challan.jw_vendor_id LEFT JOIN components ON jw_material_challan.jw_component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE jw_material_challan.jw_challan_txn_id = :transaction AND jw_material_challan.company_branch =:branch ORDER BY components.c_part_no",
      {
        replacements: { transaction: req.body.challan_no, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      const stmtVenDetail = await invtDB.query("SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor_id", {
        replacements: { vendor_id: stmt[0].jw_vendor_id },
        type: invtDB.QueryTypes.SELECT,
      });

      let vendorAddress;

      const stmtVenBranch = await invtDB.query("SELECT * FROM ven_address_detail WHERE ven_address_id = :address_id", {
        replacements: { address_id: stmt[0].jw_ven_add_id },
        type: invtDB.QueryTypes.SELECT,
      });

      if (stmtVenBranch.length > 0) {
        vendorAddress = stmt[0].jw_vendor_address !== "" ? stmt[0].jw_vendor_address : stmtVenBranch[0].ven_address;
      }

      const stmtVenState = await invtDB.query("SELECT * FROM state_code WHERE state_code = :code", {
        replacements: { code: stmtVenBranch[0].ven_state },
        type: invtDB.QueryTypes.SELECT,
      });

      const billingAddr = await invtDB.query("SELECT * FROM billing_address WHERE billing_code = :billingcode", {
        replacements: { billingcode: stmt[0].jw_billing_id },
        type: invtDB.QueryTypes.SELECT,
      });

      const dispatchAddr = await invtDB.query("SELECT * FROM dispatch_address WHERE dispatch_code = :dispatchcode", {
        replacements: { dispatchcode: stmt[0].jw_dispatch_to_id },
        type: invtDB.QueryTypes.SELECT,
      });

      const stmtDispatchState = await invtDB.query("SELECT * FROM state_code WHERE state_code = :code", {
        replacements: { code: dispatchAddr[0].dispatch_state_code },
        type: invtDB.QueryTypes.SELECT,
      });

      let item = [];

      for (let i = 0; i < stmt.length; i++) {
        item.push({
          component_name: stmt[i].c_name,
          component_description: stmt[i].c_specification,
          part_rate: stmt[i].jw_order_rate,
          hsn_code: stmt[i].jw_hsncode,
          unit_name: stmt[i].units_name,
          issue_qty: stmt[i].jw_order_qty,
          taxable_amount: (stmt[i].jw_order_rate * stmt[i].jw_order_qty).toFixed(3),
          remarks: stmt[i].jw_remark,
        });
      }

      return res.json({

        status: "success", success: true,
        data: {
          supplyType : "Outward",
          subSupplyType : "Job Work",
          docType : "Delivery Challan",
          items: item,
          header: {
            vendorName: stmtVenDetail[0].ven_name,
            vendorCity: stmtVenBranch[0].ven_add_label,
            vendorState: stmtVenBranch[0].ven_state,
            vendorStateName: stmtVenState[0].state_name,
            vendorPinCode: stmtVenBranch[0].ven_pincode,
            vendorGstin: stmtVenBranch[0].ven_add_gst,
            vendor_address: vendorAddress,

            vehicle: stmt[0].jw_vehicle,

            dispatch_label: dispatchAddr[0].dispatch_label,
            dispatch_company: dispatchAddr[0].dispatch_company,
            dispatch_pincode: dispatchAddr[0].dispatch_pincode,
            dispatch_state: dispatchAddr[0].dispatch_state_code,
            dispatch_state_name: stmtDispatchState[0].state_name,
            dispatch_gst: dispatchAddr[0].dispatch_gstin,
            dispatch_address: stmt[0].jw_dispatch_to__line1,

            jw_id: stmt[0].jw_transaction,
            jw_date: moment(stmt[0].jw_insert_dt).format("DD-MM-YYYY"),
            challan_id: stmt[0].jw_challan_txn_id,
          },
        },
      });
    } else {
      return res.json({ status: "error", success: false, message: "unable to fetch any challan transaction" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

//Fetch Transaction type
router.post("/transaction_type", [auth.isAuthorized], async (req, res) => {
  try {
    let trans_type = [
      { value: "1", text: "Regular" },
      { value: "2", text: "Ship to" },
      { value: "3", text: "Dispatch from" },
      { value: "4", text: "Ship to and Dispatch from" }
    ];
    
    return res.json({ 
 
    status: "success", success: true, 
    data: trans_type 
  });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

//Fetch Transaction mode
router.post("/trans_mode", [auth.isAuthorized], async (req, res) => {
  try {
    let trans_mode = [
      { value: "1", text: "Road" },
      { value: "2", text: "Rail" },
      { value: "3", text: "Air" },
      { value: "4", text: "Ship" }
    ];
    
    return res.json({ 
 
    status: "success", success: true, 
    data: trans_mode
  });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

async function authToken(data, company_details) {
  try {
    const payload = {
      username: "erp1@perennialsys.com",
      password: "einv12345",
      client_id: "testerpclient",
      grant_type: "password",
      scope: "ewbauth",
    };
    const url = "http://35.154.208.8:8080/auth-server/oauth/token";
    const config = {
      headers: {
        authorization: "Basic dGVzdGVycGNsaWVudDpBZG1pbkAxMjM=",
        accept: "application/json",
        gstin: "05AAACG5408K1ZR",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };

    let findUser = await invtDB.query("SELECT * FROM admin_login WHERE CustID = :user", {
      replacements: { user: data },
      type: invtDB.QueryTypes.SELECT,
    });
    if (findUser.length <= 0) {
      throw new Error("No user found.");
    }
    let tokenExpiry = findUser[0].temp_token_expiry ? findUser[0].temp_token_expiry : 0;
    let currTime = moment();
    let difference = moment(tokenExpiry).diff(currTime, "seconds");
    if (difference <= 0) {
      const result = await axios.post(url, payload, config);
      let expiry = moment().add(result.data.expires_in, "seconds");
      let updateUser = await invtDB.query("UPDATE admin_login SET temp_token = :token, temp_token_expiry = :expiry WHERE CustID = :user", {
        replacements: {
          token: result.data.access_token,
          expiry: expiry.format("YYYY-MM-DD HH:mm:ss"),
          user: data,
        },
        type: invtDB.QueryTypes.UPDATE,
      });
      if (updateUser.length <= 0) {
        throw new Error("Issue while updating token.");
      }
      return result.data.access_token;
    } else {
      return findUser[0].temp_token;
    }
  } catch (error) {
    throw new Error(error.message);
  }
}

async function ewbAuth(data, company_details) {
  try {
    const payload = {
      action: "ACCESSTOKEN",
      username: "05AAACG5408K1ZR",
      password: "abc123@@",
    };
    const url = "http://35.154.208.8:8080/ewb/enc/v1.03/authentication";
    let findUser = await invtDB.query("SELECT * FROM admin_login WHERE CustID = :user", {
      replacements: { user: data },
      type: invtDB.QueryTypes.SELECT,
    });
    if (findUser.length <= 0) {
      throw new Error("No user found.");
    }
    let tokenExpiry = findUser[0].ewb_token_expiry ? findUser[0].ewb_token_expiry : 0;
    let currTime = new Date();
    let difference = moment(tokenExpiry).diff(currTime, "seconds");
    if (difference <= 0) {
      const authToken1 = await authToken(data, company_details);
      
      const result = await axios.post(url, payload, {
        headers: {
          Authorization: "bearer " + `${authToken1}`,
          "X-Connector-Auth-Token": "testerpclient",
          Action: "ACCESSTOKEN",
          Accept: "application/json",
          "Content-Type": "application/json",
          Gstin: "05AAACG5408K1ZR",
        },
      });
    
      let expiry = moment().add(result.data.expires_in, "seconds");
      let updateUser = await invtDB.query("UPDATE admin_login SET ewb_token = :token, ewb_token_expiry = :expiry WHERE CustID = :user", {
        replacements: {
          token: result.data.access_token,
          expiry: expiry.format("YYYY-MM-DD HH:mm:ss"),
          user: data,
        },
        type: invtDB.QueryTypes.UPDATE,
      });
      if (updateUser.length <= 0) {
        throw new Error("Issue while updating token.");
      }
      return result.data.access_token;
    } else {
      return findUser[0].ewb_token;
    }
  } catch (err) {
    throw new Error("Internal error");
  }
}

async function jw_chalan_data(challanNo, branch) {
  try {
    const stmt = await invtDB.query(
      "SELECT jw_material_challan.*, jw_material_challan.ID AS row_id, components.component_key, components.c_name, components.c_part_no, units.units_name, ven_basic_detail.ven_name FROM jw_material_challan LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = jw_material_challan.jw_vendor_id LEFT JOIN components ON jw_material_challan.jw_component_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE jw_material_challan.jw_challan_txn_id = :transaction AND jw_material_challan.company_branch = :branch ORDER BY components.c_part_no",
      {
        replacements: { transaction: challanNo, branch: branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      const stmtVenDetail = await invtDB.query("SELECT * FROM ven_basic_detail WHERE ven_register_id = :vendor_id", {
        replacements: { vendor_id: stmt[0].jw_vendor_id },
        type: invtDB.QueryTypes.SELECT,
      });

      let vendorAddress;

      const stmtVenBranch = await invtDB.query("SELECT * FROM ven_address_detail WHERE ven_address_id = :address_id", {
        replacements: { address_id: stmt[0].jw_ven_add_id },
        type: invtDB.QueryTypes.SELECT,
      });

      if (stmtVenBranch.length > 0) {
        vendorAddress = stmt[0].jw_vendor_address !== "" ? stmt[0].jw_vendor_address : stmtVenBranch[0].ven_address;
      }
		
	 const stmtVenState = await invtDB.query("SELECT * FROM state_code WHERE state_code = :code", {
        replacements: { code: stmtVenBranch[0].ven_state },
        type: invtDB.QueryTypes.SELECT,
      });

     const billingAddr = await invtDB.query("SELECT * FROM billing_address WHERE billing_code = :billingcode", {
        replacements: { billingcode: stmt[0].jw_billing_id },
        type: invtDB.QueryTypes.SELECT,
      });

     const dispatchAddr = await invtDB.query("SELECT * FROM dispatch_address WHERE dispatch_code = :dispatchcode", {
        replacements: { dispatchcode: stmt[0].jw_dispatch_to_id },
        type: invtDB.QueryTypes.SELECT,
      });
		
	 const stmtDispatchState = await invtDB.query("SELECT * FROM state_code WHERE state_code = :code", {
        replacements: { code: dispatchAddr[0].dispatch_state_code },
        type: invtDB.QueryTypes.SELECT,
      });

      let item = [];

      for (let i = 0; i < stmt.length; i++) {
        item.push({
          component_name: stmt[i].c_name,
          component_description: stmt[i].c_specification,
          part_rate: stmt[i].jw_order_rate,
          hsn_code: stmt[i].jw_hsncode,
          unit_name: stmt[i].units_name,
          issue_qty: stmt[i].jw_order_qty,
		  taxable_amount: (stmt[i].jw_order_rate * stmt[i].jw_order_qty).toFixed(3),
          remarks: stmt[i].jw_remark,
        });
      }

      return {
        items: item,
        header: {
          vendorName: stmtVenDetail[0].ven_name,
          vendorCity: stmtVenBranch[0].ven_add_label,
          vendorState: stmtVenBranch[0].ven_state,
		  vendorStateName: stmtVenState[0].state_name,
          vendorPinCode: stmtVenBranch[0].ven_pincode,
          vendorGstin: stmtVenBranch[0].ven_add_gst,
          vendor_address: vendorAddress,


          vehicle: stmt[0].jw_vehicle,

          dispatch_label: dispatchAddr[0].dispatch_label,
          dispatch_company: dispatchAddr[0].dispatch_company,
          dispatch_pincode: dispatchAddr[0].dispatch_pincode,
          dispatch_state: dispatchAddr[0].dispatch_state_code,
		  dispatch_state_name: stmtDispatchState[0].state_name,
          dispatch_gst: dispatchAddr[0].dispatch_gstin,
          dispatch_address: stmt[0].jw_dispatch_to__line1,

          jw_id: stmt[0].jw_transaction,
          jw_date: stmt[0].jw_insert_dt,
          challan_id: stmt[0].jw_challan_txn_id,
        },
      };
    } else {
      throw { message: "unable to fetch any challan transaction" };
    }
  } catch (error) {
    throw error;
  }
}

async function generateEWB(jw_data, jw_items, company_details, logedINUser, transactionType, transporterId, transporterName, transporterDocNo, transporterDate, transMode, transDistance, vehicleNo) {
  let finalResult = [];
  let items = [];

  let supplyType = "O";
  let subSupplyType = "4";
  let docType = "CHL";
  let docNo = jw_data.challan_id;
  let docDate = moment(jw_data.jw_date, "YYYY-MM-DD").format("DD/MM/YYYY");

  let fromGstin = "05AAACG5408K1ZR";
  let fromPincode = "244713";
  let fromTrdName = "M/S GALWALIA ISPAT UDYOG PVT LTD"
  let actFromStateCode = "05";
  let fromStateCode = "05";
  let toGstin = jw_data.vendorGstin;
  let toPincode = jw_data.vendorPinCode;
  let toTrdName = jw_data.vendorName;
  let actToStateCode = jw_data.vendorState;
  let toStateCode = jw_data.vendorState;

  let dispatchFromGSTIN = "05AAACG5408K1ZR";
  let dispatchFromTradeName = "M/S GALWALIA ISPAT UDYOG PVT LTD";
  let shipToGSTIN = jw_data.vendorGstin;
  let shipToTradeName = jw_data.vendorName;

  let totInvValue = "0";

  for (let i = 0; i < jw_items.length; i++) {
    
    
    totInvValue = parseInt(totInvValue) + jw_items[i].issue_qty * jw_items[i].part_rate;
    
    items.push({
      productName: jw_items[i].component_name,
      productDesc: jw_items[i].component_description,
      hsnCode: jw_items[i].hsn_code,
      quantity: jw_items[i].issue_qty,
      qtyUnit: jw_items[i].unit_name.toUpperCase(),
      taxableAmount: (jw_items[i].issue_qty * jw_items[i].part_rate).toFixed(3),
    });
  }

  const payload = {
    action: "GENEWAYBILL",
    data: {
      supplyType: supplyType,
      subSupplyType: subSupplyType,
      docType: docType,
      docNo: docNo,
      docDate: docDate,

      fromGstin: fromGstin,
      fromPincode: fromPincode,
      fromTrdName: fromTrdName,
      actFromStateCode: actFromStateCode,
      fromStateCode: fromStateCode,

      toGstin: toGstin,
      toPincode: toPincode,
      toTrdName: toTrdName,
      actToStateCode: actToStateCode,
      toStateCode: toStateCode,

      transactionType: transactionType,
      dispatchFromGSTIN: dispatchFromGSTIN,
      dispatchFromTradeName: dispatchFromTradeName,
      shipToGSTIN: shipToGSTIN,
      shipToTradeName: shipToTradeName,
      totInvValue: totInvValue,

      transporterId: transporterId,
      transporterName: transporterName,
      transDocNo: transporterDocNo,
      transDocDate: transporterDate,
      transMode: transMode,
      transDistance: transDistance,
      vehicleNo: vehicleNo,
      vehicleType: "R",

      itemList: items,
    },
  };

  const url = "http://35.154.208.8:8080/ewb/enc/v1.03/ewayapi";

  const accessToken = await ewbAuth(logedINUser, company_details);

  const config = {
    headers: {
      Authorization: "Bearer " + `${accessToken}`,
      action: "GENEWAYBILL",
      Accept: "application/json",
      gstin: "05AAACG5408K1ZR",
      "Content-Type": "application/json",
      "X-Connector-Auth-Token": "testerpclient",
    },
  };

  const result = await axios.post(url, payload, config);
  
  finalResult.push({
    url: url,
    headers: config,
    payload: payload,
    result: result.data,
  });
  
  return finalResult;
}

//CREATE EWAY BILL
router.post("/create", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    challan_ID: "required",
    transactionType: "required",
    transMode: "required",
    transDistance: "required",
    vehicleNo: "required",
  });

  if (validation.fails()) {
    return res.status(403).send(Object.values(validation.errors.all())[0].join());
  }

  try {

    const challan_data = await jw_chalan_data(req.body.challan_ID, req.branch);

    const transactionType = req.body.transactionType;
    const transporterId = req.body.transporterId == null ? "" : req.body.transporterId;
    const transporterName = req.body.transporterName == null ? "" : req.body.transporterName;
    const transporterDocNo = req.body.transporterDocNo == null ? "" : req.body.transporterDocNo;
    const transporterDate = req.body.transporterDate == null ? "" : req.body.transporterDate;
    const transMode = req.body.transMode;
    const transDistance = req.body.transDistance;
    const vehicleNo = req.body.vehicleNo;

    if (!challan_data) {
      return res.json({ status: "error", success: false, message: "JW challan not Found" });
    }

    const { items: challanItems, header: challanHeader } = challan_data;

    let transactionTypeLabel;
    switch (transactionType) {
      case "1":
        transactionTypeLabel = "Regular";
        break;
      case "2":
        transactionTypeLabel = "Ship to";
        break;
      case "3":
        transactionTypeLabel = "Dispatch from";
        break;
      case "4":
        transactionTypeLabel = "Ship to and Dispatch from";
    }

    let transModeLabel;
    switch (transMode) {
      case "1":
        transModeLabel = "Road";
        break;
      case "2":
        transModeLabel = "Rail";
        break;
      case "3":
        transModeLabel = "Air";
        break;
      case "4":
        transModeLabel = "Ship";
    }

    // Boolean from user
    const showDetails = req.body.showDetails === true;

    if (showDetails) {
      return res.json({

        status: "success", success: true,
        data: {
          challan_data,
          transactionType: {
            transactionType,
            transactionTypeLabel,
          },
          transporterId,
          transporterName,
          transporterDocNo,
          transporterDate,
          transMode: {
            transMode,
            transModeLabel,
          },
          transDistance,
          vehicleNo,
        },
      });
    }

    let companyDetails = await otherDB.query(`SELECT ${global.other_db_name}.ims_company.* FROM ${global.ims_db_name}.admin_login LEFT JOIN ${global.other_db_name}.ims_company ON ${global.other_db_name}.ims_company.company_id = ${global.ims_db_name}.admin_login.company_id WHERE ${global.ims_db_name}.admin_login.CustID = :user`, {
      replacements: { user: req.logedINUser },
      type: otherDB.QueryTypes.SELECT,
    });
    if (companyDetails.length <= 0) {
      return res.json({ status: "error", success: false, message: "You don't have any registered company." });
    }

    const stmt = await generateEWB(challanHeader, challanItems, companyDetails, req.logedINUser, transactionType, transporterId, transporterName, transporterDocNo, transporterDate, transMode, transDistance, vehicleNo);

    let result = stmt[0].result;

    if (result.status == 0) {

      if(result.error[0].errorCodes == 702){
          result.error[0].errorMsg = "The distance between the pincodes given is too high";
        }

      return res.json({ status: "error", success: false, message: result.error[0].errorMsg, errorCodes: result.error[0].errorCodes  });
    }

    let insert_eway = await invtDB.query("INSERT INTO jw_challan_ewaybill (`jw_challan_id`, `jw_challan_date`, `supply_type`, `sub_supply_type`, `document_type`, `transaction_type`, `dispatchfrom_name`, `dispatchfrom_address`, `dispatchfrom_gstin`, `dispatchfrom_place`, `dispatchfrom_state`, `dispatchfrom_pincode`, `shipto_name`, `shipto_address`, `shipto_gstin`, `shipto_place`, `shipto_state`, `shipto_pincode`, `transporter_id`, `transporter_name`, `trans_doc_no`, `trans_doc_date`, `trans_mode`, `vehicle_no`, `eway_bill_no`, `generated_by`, `generated_dt`, `ewaybill_status`) VALUES (:challan_id, :challan_date, :supply_type, :sub_supply_type, :document_type, :transaction_type, :dispatch_name, :dispatch_address, :dispatch_gstin, :dispatch_place, :dispatch_state, :dispatch_pincode, :shipto_name, :shipto_address, :shipto_gstin, :shipto_place, :shipto_state, :shipto_pincode, :trans_id, :trans_name, :trans_doc_no, :trans_doc_date, :trans_mode, :vehicle_no, :eway_bill_no, :generated_by, :generated_dt, 'GENERATED')", {
      replacements: {
        challan_id: req.body.challan_ID,
        challan_date: req.body.challan_dt,
        supply_type: req.body.supply_type,
        sub_supply_type: req.body.sub_supply_type,
        document_type: req.body.document_type,
        transaction_type: transactionType,
        dispatch_name: req.body.dispatch_name,
        dispatch_address: req.body.dispatch_address == null ? "" : req.body.dispatch_address,
        dispatch_gstin: req.body.dispatch_gstin,
        dispatch_place: req.body.dispatch_place == null ? "" : req.body.dispatch_place,
        dispatch_state: req.body.dispatch_state,
        dispatch_pincode: req.body.dispatch_pincode,
        shipto_name: req.body.shipto_name,
        shipto_address: req.body.shipto_address == null ? "" : req.body.shipto_address,
        shipto_gstin: req.body.shipto_gstin,
        shipto_place: req.body.shipto_place == null ? "" : req.body.shipto_place,
        shipto_state: req.body.shipto_state,
        shipto_pincode: req.body.shipto_pincode,
        trans_id: transporterId,
        trans_name: transporterName,
        trans_doc_no: transporterDocNo,
        trans_doc_date: transporterDate,
        trans_mode: transMode,
        vehicle_no: vehicleNo,
        eway_bill_no: result.data.ewayBillNo,
        generated_by: req.logedINUser,
        generated_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      },
      type: invtDB.QueryTypes.INSERT,
    });
    if (insert_eway.length <= 0) {
      return res.json({ status: "error", success: false, message: "Error while insert data." });
    }

    let update_jwchallan = await invtDB.query("UPDATE jw_material_challan SET jw_ewaybill_no = :eway_bill, jw_ewaybill_status = 'GENERATED' WHERE jw_challan_txn_id = :challan_id", {
      replacements: {
        challan_id: req.body.challan_ID,
        eway_bill: result.data.ewayBillNo,
      },
      type: invtDB.QueryTypes.UPDATE,
    });
    if (update_jwchallan.length <= 0) {
      return res.json({ status: "error", success: false, message: "Error while updating data." });
    }

    return res.json({ status: "success", success: true, message: "Eway Bill Generated Successfully", data: result.data });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

async function cancelEWB(eway_bill, cancelRsnCode, cancelRemark, company_details, logedINUser) {
  let finalResult = [];

  const payload = {
    action: "CANEWB ",
    data: {
      ewbNo: eway_bill,
      cancelRsnCode: cancelRsnCode,
      cancelRmrk: cancelRemark,
    },
  };

  const url = "http://35.154.208.8:8080/ewb/enc/v1.03/ewayapi";

  const accessToken = await ewbAuth(logedINUser, company_details);

  const config = {
    headers: {
      Authorization: "Bearer " + `${accessToken}`,
      action: "CANEWB",
      Accept: "application/json",
      gstin: "05AAACG5408K1ZR",
      "Content-Type": "application/json",
      "X-Connector-Auth-Token": "testerpclient",
    },
  };

  const result = await axios.post(url, payload, config);
  
  finalResult.push({
    url: url,
    headers: config,
    payload: payload,
    result: result.data,
  });
  
  return finalResult;
}

//CANCEL EWAY BILL
router.post("/cancel", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    challan_ID: "required",
    eway_billno: "required",
    cancelRsnCode: "required",
    cancelRemark: "required",
  });

  if (validation.fails()) {
    return res.status(403).send(Object.values(validation.errors.all())[0].join());
  }

  try {
    const challan_ID = req.body.challan_ID;
    const eway_billno = req.body.eway_billno;
    const cancelRsnCode = req.body.cancelRsnCode;
    const cancelRemark = req.body.cancelRemark;

    let companyDetails = await otherDB.query(`SELECT ${global.other_db_name}.ims_company.* FROM ${global.ims_db_name}.admin_login LEFT JOIN ${global.other_db_name}.ims_company ON ${global.other_db_name}.ims_company.company_id = ${global.ims_db_name}.admin_login.company_id WHERE ${global.ims_db_name}.admin_login.CustID = :user`, {
      replacements: { user: req.logedINUser },
      type: otherDB.QueryTypes.SELECT,
    });
    if (companyDetails.length <= 0) {
      return res.status(404).send("You don't have any registered company.");
    }

    const stmt = await cancelEWB(eway_billno, cancelRsnCode, cancelRemark, companyDetails, req.logedINUser);

    let result = stmt[0].result;

    if (result.status == 0) {
      return res.json({ status: "error", success: false, message: result.error[0].errorMsg, errorCodes: result.error[0].errorCodes  });
    }

    let update_eway = await invtDB.query("UPDATE jw_challan_ewaybill SET ewaybill_status = 'CANCELLED', cancelled_by = :by, cancel_reason = :cancel_rsn, cancel_remark = :cancel_remark WHERE jw_challan_id = :challan_id AND eway_bill_no = :ewaybill", {
      replacements: {
        challan_id: challan_ID,
        ewaybill: result.data.ewayBillNo,
        by: req.logedINUser,
        cancel_rsn: req.body.cancelRsnCode,
        cancel_remark: req.body.cancelRemark,
      },
      type: invtDB.QueryTypes.UPDATE,
    });
    if (update_eway.length <= 0) {
      return res.json({ status: "error", success: false, message: "Error while updating data." });
    }

    let update_jwchallan = await invtDB.query("UPDATE jw_material_challan SET jw_ewaybill_status = 'CANCELLED' WHERE jw_challan_txn_id = :challan_id", {
      replacements: {
        challan_id: challan_ID,
      },
      type: invtDB.QueryTypes.UPDATE,
    });
    if (update_jwchallan.length <= 0) {
      return res.json({ status: "error", success: false, message: "Error while updating data." });
    }
	  
    return res.json({ status: "success", success: true, message: "Eway Bill Cancelled Successfully", data: result.data });
  
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

async function printEWB(eway_bill, company_details, logedINUser) {
  let finalResult = [];

  const url = `http://35.154.208.8:8080/ewb/enc/v1.03/generateEwayBillPrintPdf?ewbNo=${eway_bill}`;

  const accessToken = await ewbAuth(logedINUser, company_details);

  const config = {
    headers: {
      Authorization: "Bearer " + `${accessToken}`,
      action: "GENERATEEWAYBILLPRINT",
      Accept: "application/json",
      gstin: "05AAACG5408K1ZR",
      generatePdf: "DETAILED",
      "Content-Type": "application/json",
      "X-Connector-Auth-Token": "testerpclient",
    },
  };

  const result = await axios.get(url, config);
  
  finalResult.push({
    url: url,
    headers: config,
    result: result.data,
  });
  
  return finalResult;
}

//PRINT EWAY BILL
router.post("/print", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    challan_ID: "required",
    eway_billno: "required",
  });

  if (validation.fails()) {
    return res.status(403).send(Object.values(validation.errors.all())[0].join());
  }

  try {
    const challan_ID = req.body.challan_ID;
    const eway_billno = req.body.eway_billno;

    let companyDetails = await otherDB.query(`SELECT ${global.other_db_name}.ims_company.* FROM ${global.ims_db_name}.admin_login LEFT JOIN ${global.other_db_name}.ims_company ON ${global.other_db_name}.ims_company.company_id = ${global.ims_db_name}.admin_login.company_id WHERE ${global.ims_db_name}.admin_login.CustID = :user`, {
      replacements: { user: req.logedINUser },
      type: otherDB.QueryTypes.SELECT,
    });
    if (companyDetails.length <= 0) {
      return res.status(404).send("You don't have any registered company.");
    }

    const stmt = await printEWB(eway_billno, companyDetails, req.logedINUser);

    let result = stmt[0].result;

    if (result.status == 0) {
      return res.json({ status: "error", success: false, message: result.error[0].errorMsg  });
    }

    return res.json({ status: "success", success: true, message: "Data fetched successfully", data: result });

  } catch (error) {
      return helper.errorResponse(res, error);
  }
});


router.get("/getGstinDetails", [auth.isAuthorized], async (req, res) => {

  try {

      let validation = new Validator(req.query, {
          gstin: "required",
      });

      if (validation.fails()) {
          return res.status(403).send(Object.values(validation.errors.all())[0].join());
      }

      let companyDetails = await invtDB.query(`SELECT ${global.other_db_name}.ims_company.* FROM ${global.ims_db_name}.admin_login LEFT JOIN ${global.other_db_name}.ims_company ON ${global.other_db_name}.ims_company.company_id = ${global.ims_db_name}.admin_login.company_id WHERE ${global.ims_db_name}.admin_login.CustID = :user`, {
          replacements: { user: req.logedINUser },
          type: invtDB.QueryTypes.SELECT,
      })
      if (companyDetails.length <= 0) {
          return res.status(404).send("You don't have any registered company.")
      }

      const url = `http://35.154.208.8:8080/ewb/enc/v1.03/Master/getGstinDetails?gstin=${req.query.gstin}`;

      const accessToken = await ewbAuth(req.logedINUser, companyDetails[0]);

      const config = {
          headers: {
              Authorization: "Bearer " + `${accessToken}`,
              action: "GETGSTINDETAILS",
              Accept: "application/json",
              gstin: "05AAACG5408K1ZR",       //companyDetails[0].company_gst_no
              "Content-Type": "application/json",
              "X-Connector-Auth-Token": "testerpclient"
          }
      };

      const result = await axios.get(url, config);

      if (result.data.status == 0) {
          return res.status(403).send(result.data.error[0].errorMsg);
      }

      return res.status(200).send(result.data.data);

  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.get("/getTransporterDetails", [auth.isAuthorized], async (req, res) => {

  try {

      let validation = new Validator(req.query, {
          trnNo: "required",
      });

      if (validation.fails()) {
          return res.status(403).send(Object.values(validation.errors.all())[0].join());
      }

      let companyDetails = await invtDB.query(`SELECT ${global.other_db_name}.ims_company.* FROM ${global.ims_db_name}.admin_login LEFT JOIN ${global.other_db_name}.ims_company ON ${global.other_db_name}.ims_company.company_id = ${global.ims_db_name}.admin_login.company_id WHERE ${global.ims_db_name}.admin_login.CustID = :user`, {
          replacements: { user: req.logedINUser },
          type: invtDB.QueryTypes.SELECT,
      })
      if (companyDetails.length <= 0) {
          return res.status(404).send("You don't have any registered company.")
      }

      const url = `http://35.154.208.8:8080/ewb/enc/v1.03/Master/getTransporterDetails?trn_no=${req.query.trnNo}`;

      const accessToken = await ewbAuth(req.logedINUser, companyDetails[0]);

      const config = {
          headers: {
              Authorization: "Bearer " + `${accessToken}`,
              action: "GETTRANSPORTERDETAILS",
              Accept: "application/json",
              gstin: "05AAACG5408K1ZR",       //companyDetails[0].company_gst_no
              "Content-Type": "application/json",
              "X-Connector-Auth-Token": "testerpclient"
          }
      };

      const result = await axios.get(url, config);

      if (result.data.status == 0) {
          return res.status(403).send(result.data.error[0].errorMsg);
      }

      return res.status(200).send(result.data.data);

  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;

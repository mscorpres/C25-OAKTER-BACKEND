const { getAccessToken } = require("./fynGatewayAuth");
const { apiUrl, getCredentials } = require("./fynGatewayConfig");

const axios = require("axios");

const ewayBillAuth = async (gstin) => {
  try {
    const accessTokenRes = await getAccessToken(gstin);
    if (accessTokenRes?.status == 0) {
      throw new Error(accessTokenRes.errorMessage);
    }
    const accessToken = accessTokenRes.data.accessToken;

    //
    const credential = await getCredentials(gstin);
    if (credential.length == 0) {
      return res.status(403).send({ success: false, message: "Credentials not found!!!" });
    }
    const credential_data = function (column) {
      return credential.filter((item) => item.field_code == column)[0].value;
    };
    //

    const config = {
      method: "post",
      url: `${apiUrl}eway/enhanced/authentication`,
      headers: {
        accept: "application/json",
        gstin: credential_data("76756064"),
        ref1: credential_data("76756064"),
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      data: {
        action: "ACCESSTOKEN",
        username: credential_data("76756545"),
        password: credential_data("76756092"),
      },
    };

    const res = await axios(config);

    if (res.data.Status == 0) {
      throw new Error(res.data.ErrorDetails[0].ErrorMessage);
    }

    res.data.accessToken = accessToken;
    return res.data;
  } catch (err) {
    throw new Error(err);
  }
};

const ewayBillGenerate = async (data, gstin) => {
  try {
    const ewayBillAuthDate = await ewayBillAuth(gstin);

    const url = `${apiUrl}/eway/enhanced/generate`;

    //
    const credential = await getCredentials(gstin);
    if (credential.length == 0) {
      return res.status(403).send({ success: false, message: "Credentials not found!!!" });
    }
    const credential_data = function (column) {
      return credential.filter((item) => item.field_code == column)[0].value;
    };
    //

    console.log(ewayBillAuthDate , "DONT REMOVE THIS CONSOLE LOG");

    const headers = {
      accept: "application/json",
      gstin: credential_data("76756064"),
      username: credential_data("76756545"),
      ref1: credential_data("76756064"),
      authtoken: ewayBillAuthDate.Data.AuthToken, // Replace with your auth token
      sek: ewayBillAuthDate.Data.Sek, // Replace with your sek
      Authorization: `Bearer ${ewayBillAuthDate.accessToken}`, // Replace with your access token
      "Content-Type": "application/json",
    };

    // const data = {
    //   supplyType: "O",
    //   subSupplyType: "1",
    //   subSupplyDesc: null,
    //   docType: "INV",
    //   docNo: "2410295856AE3",
    //   docDate: "05/04/2022",
    //   fromGstin: "29AAACH1925Q1Z6",
    //   fromTrdName: "welton",
    //   fromAddr1: "2ND CROSS NO 59  19  A",
    //   fromAddr2: "GROUND FLOOR OSBORNE ROAD",
    //   fromPlace: "FRAZER TOWN",
    //   fromPincode: 560090,
    //   actFromStateCode: 29,
    //   fromStateCode: 29,
    //   toGstin: "33AAACH1925Q1ZH",
    //   toTrdName: "sthuthya",
    //   toAddr1: "Shree Nilaya",
    //   toAddr2: "Dasarahosahalli",
    //   toPlace: "Beml Nagar",
    //   toPincode: 602105,
    //   actToStateCode: 33,
    //   toStateCode: 33,
    //   transactionType: 2,
    //   otherValue: "0",
    //   totalValue: 7541,
    //   cgstValue: 0,
    //   sgstValue: 0,
    //   igstValue: 1357.38,
    //   cessValue: 0,
    //   cessNonAdvolValue: 0,
    //   totInvValue: 8898.38,
    //   transporterId: "33AAACY2873L2Z0",
    //   transporterName: "YCH LOGISTICS INDIA PRIVATE LIMITED",
    //   transDocNo: "WE-564411",
    //   transMode: "1",
    //   transDistance: "0",
    //   transDocDate: "05/04/2022",
    //   vehicleNo: "TS08FT5655",
    //   vehicleType: "R",
    //   itemList: [
    //     {
    //       productName: "Wheat",
    //       productDesc: "Wheat is good for health but millets are best in their place",
    //       hsnCode: 851770,
    //       quantity: 20,
    //       qtyUnit: "BOX",
    //       cgstRate: 0,
    //       sgstRate: 0,
    //       igstRate: 18,
    //       cessRate: 0,
    //       cessNonadvol: 0,
    //       taxableAmount: 7541,
    //     },
    //   ],
    // };

    const res = await axios.post(url, data, { headers });

    return res.data;

    // SUCCESSFULL
    // {
    //     "ewayBillNo": 123456789012,
    //     "ewayBillDate": "25/09/2018 11:17:00",
    //     "validUpto": "26/09/2018 12.00:00",
    //     "alert": ""
    //   }
  } catch (err) {
    // console.log(err.stack);
    // console.log(err.response.data);
    throw new Error(err);
  }
};

// CANCEL EWAY BILL
const ewayBillCancel = async (data, gstin) => {
  try {
    const ewayBillAuthDate = await ewayBillAuth(gstin);

    //
    const credential = await getCredentials(gstin);
    if (credential.length == 0) {
      return res.status(403).send({ success: false, message: "Credentials not found!!!" });
    }
    const credential_data = function (column) {
      return credential.filter((item) => item.field_code == column)[0].value;
    };
    //

    console.log(ewayBillAuthDate, "DONT REMOVE THIS CONSOLE LOG");

    const url = `${apiUrl}eway/enhanced/cancel`;
    const headers = {
      accept: "application/json",
      gstin: credential_data("76756064"),
      username: credential_data("76756545"),
      ref1: credential_data("76756064"),
      sek: ewayBillAuthDate.Data.Sek,
      authtoken: ewayBillAuthDate.Data.AuthToken,
      Authorization: `Bearer ${ewayBillAuthDate.accessToken}`,
      "Content-Type": "application/json",
    };
    // const data = {
    //   ewbNo: 111000609282,
    //   cancelRsnCode: 2,
    //   cancelRmrk: "Cancelled the order",
    // };

    const res = await axios.post(url, data, { headers });

    return res.data;
  } catch (err) {
    throw new Error(err);
  }
};

// ewayBillAuth().then((data) => {
//   console.log(data);
// });

module.exports = { ewayBillGenerate, ewayBillCancel };

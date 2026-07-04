// https://einv-apisandbox.nic.in/master-codes-list.html
const { getAccessToken } = require("./fynGatewayAuth");
const { apiUrl, getCredentials } = require("./fynGatewayConfig");

const axios = require("axios");
const jwt = require("jsonwebtoken");

const eInvoiceAuth = async (gstin) => {
  try {
    const accessTokenRes = await getAccessToken(gstin);
    if (accessTokenRes.status == 0) {
      throw new Error(accessTokenRes.errorMessage);
    }

    //
    const credential = await getCredentials(gstin);
    if (credential.length == 0) {
      return res.status(403).send({ success: false, message: "Credentials not found!!!" });
    }
    const credential_data = function (column) {
      return credential.filter((item) => item.field_code == column)[0].value;
    };
    //

    const accessToken = accessTokenRes.data.accessToken;

    const url = `${apiUrl}einvoice/enhanced/authentication`;

    const headers = {
      accept: "application/json",
      gstin: credential_data("76756064"),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const data = {
      Username: credential_data("76756545"),
      Password: credential_data("76756092"),
      ForceRefreshAccessToken: false,
    };

    const res = await axios.post(url, data, { headers });
    // console.log("fyn cred",res)

    // SUCCESS
    // {
    //     "status": 1,
    //     "Data": {
    //       "ClientId": "testclientid",
    //       "UserName": "testuser",
    //       "AuthToken": "5GGo3hKqPSvbHwRImTjIxeMKQ",
    //       "Sek": "EmLpFzYohZLstcXCSX9C9XIHVLb+QcsjMO1mk+qAjW8hyXmEBQnCAYsmbluFFu+Z",
    //       "TokenExpiry": "2019-11-30 14:18:00"
    //     },
    //     "ErrorDetails": null,
    //     "InfoDtls": "<alert message>"
    //   }

    // ERROR
    // {
    //     "Status": 0,
    //     "ErrorDetails": [
    //       {
    //         "ErrorCode": "1019",
    //         "ErrorMessage": "Incorrect Password"
    //       }
    //     ],
    //     "Data": null,
    //     "InfoDtls": null
    //   }

    res.data.accessToken = accessToken;
    return res.data;
  } catch (err) {
    throw new Error(err);
  }
};

const eInvoiceGenerate = async (data, gstin) => {
  try {
    const eInvoiceAuthDate = await eInvoiceAuth(gstin);

    if (eInvoiceAuthDate.Status == 0) {
      throw new Error(eInvoiceAuthDate.ErrorDetails[0].ErrorMessage + " REFLINE[ fynE.js: 86 ] " ?? "Something went wrong!! Einvoice Auth failed");
    }

    const url = `${apiUrl}einvoice/enhanced/generate-irn`;
    //
    const credential = await getCredentials(gstin);
    if (credential.length == 0) {
      return res.status(403).send({ success: false, message: "Credentials not found!!!" });
    }
    const credential_data = function (column) {
      return credential.filter((item) => item.field_code == column)[0].value;
    };  
    //
    // const data = {
    //   Version: "1.1",
    //   Irn: null,
    //   TranDtls: {
    //     TaxSch: "GST",
    //     SupTyp: "B2B",
    //     RegRev: "Y",
    //     EcmGstin: null,
    //     IgstOnIntra: "N",
    //   },
    //   DocDtls: {
    //     Typ: "INV",
    //     No: "test1cc24696",
    //     Dt: "18/12/2022",
    //   },
    //   SellerDtls: {
    //     Gstin: "37ARZPT4384Q1MT",
    //     LglNm: "NIC company pvt ltd",
    //     TrdNm: "NIC Industries",
    //     Addr1: "5th block, kuvempu layout",
    //     Addr2: "kuvempu layout",
    //     Loc: "GANDHINAGAR",
    //     Pin: 518001,
    //     Stcd: "37",
    //     Ph: "9000000000",
    //     Em: "abc@gmail.com",
    //   },
    //   BuyerDtls: {
    //     Gstin: "29AWGPV7107B1Z1",
    //     LglNm: "XYZ company pvt ltd",
    //     TrdNm: "XYZ Industries",
    //     Pos: "12",
    //     Addr1: "7th block, kuvempu layout",
    //     Addr2: "kuvempu layout",
    //     Loc: "GANDHINAGAR",
    //     Pin: 562160,
    //     Stcd: "29",
    //     Ph: "91111111111",
    //     Em: "xyz@yahoo.com",
    //   },
    //   DispDtls: {
    //     Nm: "ABC company pvt ltd",
    //     Addr1: "7th block, kuvempu layout",
    //     Addr2: "kuvempu layout",
    //     Loc: "Banagalore",
    //     Pin: 562160,
    //     Stcd: "29",
    //   },
    //   ShipDtls: {
    //     Gstin: "29AWGPV7107B1Z1",
    //     LglNm: "CBE company pvt ltd",
    //     TrdNm: "XYZ Industries",
    //     Addr1: "7th block, kuvempu layout",
    //     Addr2: "kuvempu layout",
    //     Loc: "Banagalore",
    //     Pin: 562160,
    //     Stcd: "29",
    //   },
    //   ItemList: [
    //     {
    //       SlNo: "1",
    //       PrdDesc: "Rice",
    //       IsServc: "N",
    //       HsnCd: "1001",
    //       Barcde: "123456",
    //       Qty: 4,
    //       FreeQty: 10,
    //       Unit: "BAG",
    //       UnitPrice: 99.545,
    //       TotAmt: 9988.84,
    //       Discount: 10,
    //       PreTaxVal: 1,
    //       AssAmt: 9978.84,
    //       GstRt: 12,
    //       IgstAmt: 1197.46,
    //       CgstAmt: 0,
    //       SgstAmt: 0,
    //       CesRt: 5,
    //       CesAmt: 498.94,
    //       CesNonAdvlAmt: 10,
    //       StateCesRt: 12,
    //       StateCesAmt: 1197.46,
    //       StateCesNonAdvlAmt: 5,
    //       OthChrg: 10,
    //       TotItemVal: 12897.7,
    //       OrdLineRef: "3256",
    //       OrgCntry: "AG",
    //       PrdSlNo: "12345",
    //       BchDtls: {
    //         Nm: "123456",
    //         ExpDt: "01/08/2020",
    //         WrDt: "01/09/2020",
    //       },
    //       AttribDtls: [
    //         {
    //           Nm: "Rice",
    //           Val: "10000",
    //         },
    //       ],
    //     },
    //   ],
    //   ValDtls: {
    //     AssVal: 9978.84,
    //     CgstVal: 0,
    //     SgstVal: 0,
    //     IgstVal: 1197.46,
    //     CesVal: 508.94,
    //     StCesVal: 1202.46,
    //     Discount: 10,
    //     OthChrg: 20,
    //     RndOffAmt: 0.3,
    //     TotInvVal: 12908,
    //     TotInvValFc: 12897.7,
    //   },
    //   PayDtls: {
    //     Nm: "ABCDE",
    //     AccDet: "5697389713210",
    //     Mode: "Cash",
    //     FinInsBr: "SBIN11000",
    //     PayTerm: "100",
    //     PayInstr: "Gift",
    //     CrTrn: "test",
    //     DirDr: "test",
    //     CrDay: 100,
    //     PaidAmt: 10000,
    //     PaymtDue: 5000,
    //   },
    //   RefDtls: {
    //     InvRm: "TEST",
    //     DocPerdDtls: {
    //       InvStDt: "01/08/2020",
    //       InvEndDt: "01/09/2020",
    //     },
    //   },
    //   PrecDocDtls: [
    //     {
    //       InvNo: "DOC/002",
    //       InvDt: "01/08/2020",
    //       OthRefNo: "123456",
    //     },
    //   ],
    //   ContrDtls: [
    //     {
    //       RecAdvRefr: "AB12340",
    //       RecAdvDt: null,
    //       TendRefr: "D/10",
    //       ContrRefr: "CRs",
    //       ExtRefr: "Yo456",
    //       ProjRefr: "Doc-456",
    //       PORefr: "Doc-789",
    //       PORefDt: "01/08/2020",
    //     },
    //   ],
    //   AddlDocDtls: [
    //     {
    //       Url: "https://einv-apisandbox.nic.in",
    //       Docs: "Test Doc",
    //       Info: "Document Test",
    //     },
    //   ],
    //   ExpDtls: {
    //     ShipBNo: null,
    //     ShipBDt: null,
    //     Port: null,
    //     RefClm: null,
    //     ForCur: null,
    //     CntCode: null,
    //     ExpDuty: null,
    //   },
    //   EwbDtls: {
    //     TransId: "12AWGPV7107B1Z1",
    //     TransName: "XYZ EXPORTS",
    //     TransMode: "1",
    //     Distance: 100,
    //     TransDocNo: "DOC01",
    //     TransDocDt: "18/08/2020",
    //     VehNo: "ka123456",
    //     VehType: "R",
    //   },
    // };

    // const fs = require("fs");
    // fs.writeFileSync("data.json", JSON.stringify(data));

    // DONT REMOVE THIS CONSOLE LOG
    console.log(eInvoiceAuthDate, "DONT REMOVE THIS CONSOLE LOG 123");

    const config = {
      method: "post",
      url: url,
      headers: {
        accept: "application/json",
        gstin: credential_data("76756064"),
        AuthToken: `${eInvoiceAuthDate.Data.AuthToken}`,
        user_name: credential_data("76756545"),
        ref1: credential_data("76756064"),
        sek: `${eInvoiceAuthDate.Data.Sek}`,
        Authorization: `Bearer ${eInvoiceAuthDate.accessToken}`,
        "Content-Type": "application/json",
      },
      data: data,
    };

    const res = await axios(config);
    return res.data;
  } catch (err) {
    throw new Error(err);
  }
};

// CANCEL INVOICE
const eInvoiceCancel = async (data, gstin) => {
  try {
    const eInvoiceAuthDate = await eInvoiceAuth(gstin);

    const url = `${apiUrl}einvoice/enhanced/cancel-irn`;

    //
    const credential = await getCredentials(gstin);
    if (credential.length == 0) {
      return res.status(403).send({ success: false, message: "Credentials not found!!!" });
    }
    const credential_data = function (column) {
      return credential.filter((item) => item.field_code == column)[0].value;
    };
    //

    // DONT REMOVE THIS CONSOLE LOG
    console.log(eInvoiceAuthDate, "DONT REMOVE THIS CONSOLE LOG");
    const headers = {
      accept: "application/json",
      gstin: credential_data("76756064"),
      user_name: credential_data("76756545"),
      ref1: credential_data("76756064"),
      sek: `${eInvoiceAuthDate.Data.Sek}`,
      AuthToken: `${eInvoiceAuthDate.Data.AuthToken}`,
      Authorization: `Bearer ${eInvoiceAuthDate.accessToken}`,
      "Content-Type": "application/json",
    };

    // const data =  {
    //     "Irn": "a5c12dca80e743321740b001fd70953e8738d109865d28ba4013750f2046f229",
    //     "CnlRsn": "1",
    //     "CnlRem": "Wrong entry"
    //   }

    // const data = {
    //   Data: "cwMtQmlx/upJuEqKfTMTQ6RH1s6SOQwm9SknTMBvHm9CFeJCCs4otZZbdf76sP/xpR4K3H5qvf1FmSrIFw1kmcPG1fSrE+AhZXjicr07dFsFmngugxwcTu 4BScdA75FgIolVbvDnDgvzJyg9mDWxMIM3Mkbtt7by5XC9CqVqqhnPSri9R5UE3PJgVKcMsM3aBewBdNGiQ/2Z9fITZwCp1l/z6h6pMDd93GT30I8nxMsn3",
    // };

    const cancelPayload = data;
    // const encData = jwt.sign(data, eInvoiceAuthDate.Data.Sek, {
    //   algorithm: "HS256",
    // });
    // const cancelPayload = {
    //   Data: encData,
    // };

    console.log(cancelPayload);

    const res = await axios.post(url, cancelPayload, { headers });

    return res.data;
  } catch (err) {
    throw new Error(err);
  }
};

module.exports = { eInvoiceGenerate, eInvoiceCancel };

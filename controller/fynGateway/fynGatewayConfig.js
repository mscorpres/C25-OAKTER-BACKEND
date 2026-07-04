require("dotenv").config();
const apiUrl = process.env.FYN_API_URL + "/api/"; // Production

const { otherDB, invtDB } = require("../../config/db/connection");
const jwt = require("jsonwebtoken");

const supplytype = [
  { code: "O", desc: "Outward" },
  { code: "I", desc: "Inward" },
];

const subsupplytype = [
  { code: "1", desc: "Supply" },
  { code: "2", desc: "Import" },
  { code: "3", desc: "Export" },
  { code: "4", desc: "Job Work" },
  { code: "5", desc: "For Own Use" },
  { code: "6", desc: "Job Work Return" },
  { code: "7", desc: "Sale Return" },
  { code: "8", desc: "Others" },
  { code: "9", desc: "SKD/CKD/Lots" },
  { code: "10", desc: "Line Sales" },
  { code: "11", desc: "Recipient Not Known" },
  { code: "12", desc: "Exhibition or Fairs" },
];

const subType = [
  { code: "B2B", desc: "Business to Business" },
  { code: "SEZWP", desc: "SEZ with payment" },
  { code: "SEZWOP", desc: "SEZ without payment" },
  { code: "EXPWP", desc: "Export with Payment" },
  { code: "EXPWOP", desc: "Export without payment" },
  { code: "DEXP", desc: "Deemed Export" },
];

const docType = [
  { code: "INV", desc: "Tax Invoice" },
  { code: "BIL", desc: "Bill of Supply" },
  { code: "BOE", desc: "Bill of Entry" },
  { code: "CHL", desc: "Delivery Challan" },
  { code: "OTH", desc: "Others" },
];

const transportationMode = [
  { code: "1", desc: "Road" },
  { code: "2", desc: "Rail" },
  { code: "3", desc: "Air" },
  { code: "4", desc: "Ship" },
  { code: "5", desc: "inTransit" },
];

const ewayBillCancel = [
  { code: "1", desc: "Duplicate" },
  { code: "2", desc: "Order Cancelled" },
  { code: "3", desc: "Data Entry mistake" },
  { code: "4", desc: "Others" },
];

const vehicalType = [
  { code: "R", desc: "Regular" },
  { code: "O", desc: "ODC(Over Dimentional Cargo)" },
];

const transactionType = [
  { code: "1", desc: "Regular" },
  { code: "2", desc: "Bill To - Ship To" },
  { code: "3", desc: "Bill From - Dispatch From" },
  { code: "4", desc: "Combination of 2 and 3" },
];

const getCredentials = async (credential_key) => {
  try {
    const result = await invtDB.query(`SELECT * FROM credentials WHERE credential_key = :credential_key`, {
      replacements: { credential_key: credential_key },
      type: otherDB.QueryTypes.SELECT,
    });

    if (result.length == 0) return null;

    let credential_data = JSON.parse(result[0].credential_data);

    for (let i = 0; i < credential_data.length; i++) {
      let cValue = credential_data[i].value;
      credential_data[i].value = await jwt.verify(cValue, process.env.CREDENTIAL_TOKEN);
    }
    

    // console.log(credential_data);

    return credential_data;
  } catch (err) {
    console.log(err);
    throw err;
  }
};

module.exports = {
  apiUrl,
  supplytype,
  subsupplytype,
  subType,
  docType,
  transportationMode,
  ewayBillCancel,
  vehicalType,
  transactionType,
  getCredentials,
};

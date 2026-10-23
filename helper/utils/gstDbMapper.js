const { invtDB, tallyDB, invtOakterDB, tallyOakterDB } = require("../../config/db/connection");

// Validates the GST against MAIN_BRANCH_GST (C25) and throws if it does not match
function assertMainBranchGst(gst) {
  if (!gst || gst.trim() === "") {
    throw new Error("GST parameter is required");
  }

  const mainGst = String(process.env.MAIN_BRANCH_GST || "").trim().toUpperCase();
  if (!mainGst) {
    throw new Error("MAIN_BRANCH_GST is not configured");
  }

  if (gst.trim().toUpperCase() !== mainGst) {
    throw new Error(`Invalid GST: ${gst}. Only GST number ${mainGst} is allowed.`);
  }
}

function getDatabaseByGST(gst) {
  assertMainBranchGst(gst);
  return invtDB;
}




function getDbContextByGST(gst) {
  if (!gst || String(gst).trim() === "") {
    throw new Error("GST parameter is required");
  }

  const MAIN_BRANCH_GST = String(process.env.MAIN_BRANCH_GST || "").trim().toUpperCase();
  const ALWAR_BRANCH_GST = String(process.env.ALWAR_BRANCH_GST || "").trim().toUpperCase();

  const normalizedGst = String(gst).trim().toUpperCase();

  if (ALWAR_BRANCH_GST && normalizedGst === ALWAR_BRANCH_GST) {
    return {
      branch: "Alwar",
      inventoryDb: invtOakterDB,
      tallyDb: tallyOakterDB,
      inventoryDbName: invtOakterDB.config.database,
    };
  }

  if (MAIN_BRANCH_GST && normalizedGst === MAIN_BRANCH_GST) {
    return {
      branch: "C25",
      inventoryDb: invtDB,
      tallyDb: tallyDB,
      inventoryDbName: invtDB.config.database,
    };
  }

  throw new Error(
    `Invalid GST: ${gst}. Only GST numbers ${MAIN_BRANCH_GST} and ${ALWAR_BRANCH_GST} are allowed.`
  );
}



module.exports = {
  getDatabaseByGST,
  getDbContextByGST
};

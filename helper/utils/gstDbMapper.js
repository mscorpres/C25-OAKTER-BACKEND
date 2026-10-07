const { invtDB, tallyDB } = require("../../config/db/connection");

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
  assertMainBranchGst(gst);
  return {
    inventoryDb: invtDB,
    tallyDb: tallyDB,
    inventoryDbName: invtDB.config.database,
  };
}

module.exports = {
  getDatabaseByGST,
  getDbContextByGST
};

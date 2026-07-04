module.exports = function (app) {
  // API
  app.use("/tally", require("./TALLYSYNC/tally"));

  // TALLYSYNC
  app.use("/tallysync/v1/json", require("./TALLYSYNC/sf-cons"));

  app.use("/api/v1/", require("./INVENTORY/API/retriveMIN"));
  app.use("/version", require("./VERSION/version"));
  app.use("/api/v1", require("./INVENTORY/API/locationStock"));
  app.use("/api/v1", require("./INVENTORY/API/fgStock"));
  app.use("/api/v1", require("./INVENTORY/API/r2API"));
  app.use("/api/v1", require("./INVENTORY/API/r15API"));
  app.use("/api/v1", require("./INVENTORY/API/componentsApi"));
  app.use("/api/v1", require("./INVENTORY/API/r3Manufacturing"));
  app.use("/api/v1", require("./INVENTORY/API/closingQtyApi"));
  app.use("/api/v1", require("./INVENTORY/API/jwChallanApi"));
  app.use("/api/v1", require("./INVENTORY/API/sfgBom"));
  app.use("/api/v1", require("./INVENTORY/API/r37Api"));

  //INVENTORY
  app.use("/", require("./index"));
  app.use("/auth", require("./login/login"));
  app.use("/uom", require("./INVENTORY/master/inventory/uom"));
  app.use(
    "/production/line",
    require("./INVENTORY/master/inventory/assemblingLine")
  );
  app.use("/component", require("./INVENTORY/master/inventory/component"));
  app.use("/vendor", require("./INVENTORY/master/inventory/vendor"));
  app.use("/master/subgroup", require("./INVENTORY/master/inventory/subgroups"));
  app.use("/products", require("./INVENTORY/master/inventory/products"));
  app.use("/bom", require("./INVENTORY/master/inventory/bom"));
  app.use("/bomRnd", require("./INVENTORY/master/inventory/rndBom"));
  app.use("/location", require("./INVENTORY/master/inventory/location"));
  app.use("/groups", require("./INVENTORY/master/inventory/groups"));
  app.use(
    "/billingAddress",
    require("./INVENTORY/master/inventory/billingAddress")
  );
  app.use(
    "/shippingAddress",
    require("./INVENTORY/master/inventory/shippingAddress")
  );
  app.use("/qaProcessmaster", require("./INVENTORY/master/qa_process/process"));
  app.use("/monthAudit", require("./INVENTORY/master/inventory/month_audit"));
  app.use("/backend", require("./INVENTORY/others/backend"));
  app.use("/qrLabel", require("./INVENTORY/printing/qr_label"));
  app.use("/qcalable", require("./INVENTORY/printing/qcaLable"));
  app.use("/printDoc", require("./INVENTORY/printing/downloadAttachment"));
  app.use("/minPrint", require("./INVENTORY/printing/minPrint"));
  app.use("/FGMinPrint", require("./INVENTORY/printing/fgMinPrint"));
  app.use("/minPrint", require("./INVENTORY/printing/boxLableQr"));
  app.use("/minBoxLablePrint", require("./INVENTORY/printing/boxLablePrint"));
  app.use("/purchaseOrder", require("./INVENTORY/purchaseOrder/po"));
  app.use("/purchaseOthers", require("./INVENTORY/purchaseOrder/poOthers"));
  app.use("/transaction", require("./INVENTORY/store/transaction"));
  app.use("/qc", require("./INVENTORY/production/qc/qc"));
  app.use("/storeApproval", require("./INVENTORY/store/materialApproval"));
  app.use("/rejection", require("./INVENTORY/store/rejectionOut"));
  app.use("/godown", require("./INVENTORY/store/godownTransfer/movement"));
  app.use("/godown/transfer", require("./INVENTORY/store/godownTransfer/jw-jw"));
  app.use("/audit", require("./INVENTORY/store/rmAudit"));
  app.use("/conversion", require("./INVENTORY/store/conversion_part"));
  app.use("/fgMIN", require("./INVENTORY/store/fg_MIN"));
  app.use("/tranCount", require("./INVENTORY/store/ims_dashboard"));
  app.use("/part_rate", require("./INVENTORY/store/jw_rate"));
  app.use("/fg_return", require("./INVENTORY/store/fg_reversal/fg_return"));
  app.use("/report1", require("./INVENTORY/report/r1"));
  app.use("/report2", require("./INVENTORY/report/r2"));
  app.use("/report3", require("./INVENTORY/report/r3"));
  app.use("/report4", require("./INVENTORY/report/r4"));
  app.use("/report5", require("./INVENTORY/report/r5"));
  app.use("/report6", require("./INVENTORY/report/r6"));
  app.use("/report7", require("./INVENTORY/report/r7"));
  app.use("/report8", require("./INVENTORY/report/r8"));
  app.use("/report9", require("./INVENTORY/report/r9"));
  app.use("/report10", require("./INVENTORY/report/r10"));
  app.use("/report11", require("./INVENTORY/report/r11"));
  app.use("/report12", require("./INVENTORY/report/r12"));
  app.use("/report17", require("./INVENTORY/report/r17"));
  app.use("/report18", require("./INVENTORY/report/r18"));
  app.use("/report19", require("./INVENTORY/report/r19"));
  app.use("/report20", require("./INVENTORY/report/r20"));
  app.use("/report21", require("./INVENTORY/report/r21"));
  app.use("/report22", require("./INVENTORY/report/r22"));
  app.use("/report24", require("./INVENTORY/report/r24"));
  app.use("/report25", require("./INVENTORY/report/r25"));
  app.use("/report", require("./INVENTORY/report/r26"));
  app.use("/report27", require("./INVENTORY/report/r27"));
  app.use("/report28", require("./INVENTORY/report/r28"));
  app.use("/report29", require("./INVENTORY/report/r29"));
  app.use("/report30", require("./INVENTORY/report/r30"));
  app.use("/report31", require("./INVENTORY/report/r31"));
  app.use("/report32", require("./INVENTORY/report/r32"));
  app.use("/report33", require("./INVENTORY/report/r33"));
  app.use("/report34", require("./INVENTORY/report/r34"));
  app.use("/report35", require("./INVENTORY/report/r35"));
  app.use("/report36", require("./INVENTORY/report/r36"));
  app.use("/report37", require("./INVENTORY/report/r37"));
  app.use("/JWReport", require("./INVENTORY/report/jwReport"));

  app.use("/dateBook", require("./INVENTORY/report/dateBook"));
  app.use("/itemLedger", require("./INVENTORY/report/itemLedger"));
  app.use("/q1", require("./INVENTORY/report/q1"));
  app.use("/q2", require("./INVENTORY/report/q2"));
  app.use("/q3", require("./INVENTORY/report/q3"));
  app.use("/q5", require("./INVENTORY/report/q5"));
  app.use("/SKUCosting", require("./INVENTORY/report/skuCosting"));
  app.use("/fgIN", require("./INVENTORY/store/fgin"));
  app.use("/fgOUT", require("./INVENTORY/store/fgout"));
  app.use("/permission", require("./INVENTORY/others/permission"));
  app.use("/gatepass", require("./INVENTORY/store/GatePass/gatepass"));
  app.use("/regatepass", require("./INVENTORY/store/GatePass/regatepass"));
  app.use("/production", require("./INVENTORY/production/production"));
  app.use("/ppr", require("./INVENTORY/production/create_ppr"));
  app.use("/poPrint", require("./INVENTORY/purchaseOrder/printPo"));
  app.use("/jobwork", require("./INVENTORY/jobwork/jobwork"));
  app.use("/jobwork", require("./INVENTORY/jobwork/jwPrint"));
  app.use("/jobwork", require("./INVENTORY/jobwork/jwChallan"));
  app.use("/jwEwaybill", require("./INVENTORY/jobwork/generate_Ewaybill"));
  app.use("/JWSupplementary", require("./INVENTORY/jobwork/jw_supplementary"));
 
  app.use("/console", require("./INVENTORY/production/consolePpr"));
  app.use("/boxMarkup", require("./INVENTORY/store/box_markup"));
  app.use(
    "/createqca",
    require("./INVENTORY/production/processqca/create_qca_process")
  );
  app.use("/createwo", require("./INVENTORY/work_order/create_work_order"));
  app.use("/wo_challan", require("./INVENTORY/work_order/wo_challan"));
  app.use(
    "/branchTransfer",
    require("./INVENTORY/store/branchTransfer/branchTransfer")
  );
  app.use("/mfgcategory", require("./INVENTORY/production/mfg_category"));
  app.use("/sellRequest", require("./INVENTORY/store/sell_request"));
  app.use("/so_challan_shipment", require("./INVENTORY/store/so_challan"));
  app.use("/sfMin", require("./INVENTORY/store/sf_rm_inward"));
  app.use("/report/common", require("./INVENTORY/report/common/partPoMin"));
  app.use(
    "/report/common",
    require("./INVENTORY/report/common/altpartDetails")
  );
  app.use("/report", require("./INVENTORY/report/common/minMasterComp"));
  app.use("/closing_stock", require("./INVENTORY/report/closing_stock"));
  app.use("/production/mis", require("./INVENTORY/production/mis/createMis"));
  app.use(
    "/sfPhysical",
    require("./INVENTORY/production/sf_physical/sf_physical")
  );
  //########

  //ewaybiil
  app.use("/ewaybill", require("./INVENTORY/ewaybill/ewaybill"));

  app.use("/api", require("./INVENTORY/others/api"));

  // ###########################
  //JOWBWORK VENDOR
  //app.use("/jwtransfer", require("./INVENTORY/jobwork/vendor/transfer"));
  app.use("/jwvendor", require("./INVENTORY/jobwork/vendor/challan"));
  app.use("/jwreject", require("./INVENTORY/jobwork/vendor/reject"));
  app.use("/jwreport", require("./INVENTORY/jobwork/vendor/report"));
  app.use("/vr01", require("./INVENTORY/report/vendor/vr01"));
  app.use("/vr02", require("./INVENTORY/report/vendor/vr02"));
  app.use("/vr03", require("./INVENTORY/report/vendor/vr03"));
  app.use("/vr04", require("./INVENTORY/report/vendor/vr04"));
  app.use(
    "/vendor_mails",
    require("./INVENTORY/report/vendor/transaction_mail")
  );

  // VENDOR PHYSICAL STOCK
  app.use(
    "/vendor/rmAudit",
    require("./INVENTORY/jobwork/vendor/store/physical")
  );

  // ###########################
  // PROFILE
  app.use("/profile", require("./PROFILE/userProfile/mypage"));

  // ###########################
  // Finance
  app.use("/tally", require("./FINANCE/master/groups"));
  app.use("/tally/ledger", require("./FINANCE/master/ledger"));
  app.use("/tally/tds", require("./FINANCE/master/nature_of_tds"));
  app.use("/tally/tcs", require("./FINANCE/master/tcs"));
  app.use("/tally/vbt", require("./FINANCE/master/vbt"));
  app.use("/tally/invoice", require("./FINANCE/master/invoice"));
  app.use("/client", require("./FINANCE/master/client"));
  app.use("/tally/vbt01", require("./FINANCE/vbt/vbt01"));
  app.use("/tally/vbt02", require("./FINANCE/vbt/vbt02"));
  app.use("/tally/vbt03", require("./FINANCE/vbt/vbt03"));
  app.use("/tally/vbt04", require("./FINANCE/vbt/vbt04"));
  app.use("/tally/vbt05", require("./FINANCE/vbt/vbt05"));
  app.use("/tally/vbt06", require("./FINANCE/vbt/vbt06"));
  app.use("/tally/vbt07", require("./FINANCE/vbt/vbt07"));
  app.use("/tally/vbt_report", require("./FINANCE/vbt/vbt_report"));
  app.use("/tally/voucher", require("./FINANCE/vouchers/vouchers"));
  app.use("/tally/jv", require("./FINANCE/vouchers/journal_posting"));
  app.use("/tally/contra", require("./FINANCE/vouchers/contra"));
  app.use("/tally/cash", require("./FINANCE/vouchers/cash"));
  app.use("/tally/ap", require("./FINANCE/others/ap"));
  app.use("/tally/backend", require("./FINANCE/others/backend"));
  app.use("/tally/reports", require("./FINANCE/reports/trialbalance"));
  app.use("/tally/reports", require("./FINANCE/reports/cpm"));
  app.use("/tally/reports", require("./FINANCE/reports/balancesheet"));
  app.use("/tally/reports", require("./FINANCE/reports/pl"));
  app.use("/tally/reports", require("./FINANCE/reports/dayBook"));
  app.use("/tally/reports", require("./FINANCE/reports/cpm"));
  app.use("/tally/reports", require("./FINANCE/reports/vbtappreport"));
  app.use("/tally/dv", require("./FINANCE/vouchers/debitVoucher"));
  app.use("/tally/cn", require("./FINANCE/vouchers/creditVoucher"));

  app.use("/far", require("./FINANCE/master/far"));

  // ##############################
    // ADMIN
    app.use("/org", require("./ADMIN/company"));
    app.use("/admin/po_mail", require("./ADMIN/poTeam"));
    app.use("/changelog", require("./ADMIN/changelog"));

  // SOP
  app.use("/drive", require("./SOP/sop"));

  // ##############################
  // REVERSAL
  app.use("/reversal", require("./FINANCE/reversal/reversal"));
  
  //#######################################
  app.use("/mis", require("./FINANCE/reports/mis"));

  // ##################################################
  app.use(
    "/vendorReconciliation",
    require("./FINANCE/vendorReconciliation/vendorreconciliation")
  );

  //#######################################
  app.use("/gstr", require("./FINANCE/reports/gstr1"));

  // ###########################
  // TICKET
  app.use("/ticket", require("./TICKET/ticket"));
};

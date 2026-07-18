const express = require("express");
const router = express.Router();

let { invtDB, refbDB } = require("../../../../config/db/connection");

const fs = require("fs");
const xmlFormatter = require("xml-formatter");
const crypto = require("crypto");

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
const Validator = require("validatorjs");

const uniqueFileName = () => {
  const uniqueId = crypto.randomBytes(8).toString("hex");
  const timestamp = Date.now();
  return `${uniqueId}_${timestamp}.xml`;
};
//RM - RM AND SF - SF Transactions List
router.post("/xml_report_rmsf_same", async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }

  try {
    let stmt1 = [];
    if (searchBy == "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months"
      );
      if (durationInMonths > 3) {
        return res.json({
          status: "error",
          success: false,
          success: false,
          message:
            "On the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only.",
        });
      }

      stmt1 = await invtDB.query(
        "SELECT *, `rm_location`.`insert_date`, `rm_location`.`insert_by` AS `insertedByPersonName` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND DATE_FORMAT(`rm_location`.`insert_date`,'%Y-%m-%d') BETWEEN :datefrom AND :dateto AND `rm_location`.`trans_type` = 'TRANSFER' ORDER BY `rm_location`.`transfer_transaction_id` DESC",
        {
          replacements: {
            datefrom: fromdate,
            dateto: todate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt1.length > 0) {
      var data = [];
      const fileName = uniqueFileName();
      stmt1.map(async (item) => {
        let stmt2 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :loc_in",
          {
            replacements: { loc_in: item.loc_in },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let loc_in;
        if (stmt2.length > 0) {
          loc_in = stmt2[0].loc_name;
        } else {
          loc_in = "N/A";
        }

        let stmt3 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :loc_out",
          {
            replacements: { loc_out: item.loc_out },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let loc_out;
        if (stmt3.length > 0) {
          loc_out = stmt3[0].loc_name;
        } else {
          loc_out = "N/A";
        }

        //LAST COMPONENT PURCHASE RATE
        let last_purchase = 0;

        let stmt4 = await invtDB.query(
          "SELECT `ID`, COALESCE(SUM(`in_po_rate`), 0) AS `last_rate`, `components_id` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD') AND `ID` = (SELECT MAX(`ID`) FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD'))",
          {
            replacements: { component: item.component_key },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt4.length > 0) {
          last_purchase = stmt4[0].last_rate;
        } else {
          last_purchase = 0;
        }

        const inventoryEntries_1 = [],
          inventoryEntries_2 = [];
        for (let i = 0; i < stmt1.length; i++) {
          const inventoryEntry_1 = `
					<INVENTORYENTRIESIN.LIST>
						<STOCKITEMNAME>${stmt1[i].c_part_no}</STOCKITEMNAME>
						<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
						<ISGSTASSESSABLEVALUEOVERRIDDEN>No</ISGSTASSESSABLEVALUEOVERRIDDEN>
						<STRDISGSTAPPLICABLE>No</STRDISGSTAPPLICABLE>
						<CONTENTNEGISPOS>No</CONTENTNEGISPOS>
						<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
						<ISAUTONEGATE>No</ISAUTONEGATE>
						<ISCUSTOMSCLEARANCE>No</ISCUSTOMSCLEARANCE>
						<ISTRACKCOMPONENT>No</ISTRACKCOMPONENT>
						<ISTRACKPRODUCTION>No</ISTRACKPRODUCTION>
						<ISPRIMARYITEM>No</ISPRIMARYITEM>
						<ISSCRAP>No</ISSCRAP>
						<RATE></RATE>
						<AMOUNT></AMOUNT>
						<ACTUALQTY> ${helper.number(stmt1[i].qty) + helper.number(stmt1[i].other_qty)
            } ${stmt1[i].units_name}</ACTUALQTY>
						<BILLEDQTY> ${helper.number(stmt1[i].qty) + helper.number(stmt1[i].other_qty)
            } ${stmt1[i].units_name}</BILLEDQTY>
						<BATCHALLOCATIONS.LIST>
							<GODOWNNAME>GDWP001_A21</GODOWNNAME>
							<BATCHNAME>Primary Batch</BATCHNAME>
							<INDENTNO>&#4; Not Applicable</INDENTNO>
							<ORDERNO>&#4; Not Applicable</ORDERNO>
							<TRACKINGNUMBER>&#4; Not Applicable</TRACKINGNUMBER>
							<DYNAMICCSTISCLEARED>No</DYNAMICCSTISCLEARED>
							<AMOUNT></AMOUNT>
							<ACTUALQTY> ${helper.number(stmt1[i].qty) + helper.number(stmt1[i].other_qty)
            } ${stmt1[i].units_name}</ACTUALQTY>
							<BILLEDQTY> ${helper.number(stmt1[i].qty) + helper.number(stmt1[i].other_qty)
            } ${stmt1[i].units_name}</BILLEDQTY>
							<ADDITIONALDETAILS.LIST></ADDITIONALDETAILS.LIST>
							<VOUCHERCOMPONENTLIST.LIST></VOUCHERCOMPONENTLIST.LIST>
						</BATCHALLOCATIONS.LIST>
						<DUTYHEADDETAILS.LIST></DUTYHEADDETAILS.LIST>
						<RATEDETAILS.LIST></RATEDETAILS.LIST>
						<SUPPLEMENTARYDUTYHEADDETAILS.LIST></SUPPLEMENTARYDUTYHEADDETAILS.LIST>
						<TAXOBJECTALLOCATIONS.LIST></TAXOBJECTALLOCATIONS.LIST>
						<COSTTRACKALLOCATIONS.LIST></COSTTRACKALLOCATIONS.LIST>
						<REFVOUCHERDETAILS.LIST></REFVOUCHERDETAILS.LIST>
						<EXCISEALLOCATIONS.LIST></EXCISEALLOCATIONS.LIST>
						<EXPENSEALLOCATIONS.LIST></EXPENSEALLOCATIONS.LIST>
					</INVENTORYENTRIESIN.LIST>
					`;
          inventoryEntries_1.push(inventoryEntry_1);
        }

        const inventoryEntriesXML_1 = inventoryEntries_1.join("");

        for (let j = 0; j < stmt1.length; j++) {
          const inventoryEntry_2 = `
					<INVENTORYENTRIESOUT.LIST>
						<STOCKITEMNAME>${stmt1[j].c_part_no}</STOCKITEMNAME>
						<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
						<ISGSTASSESSABLEVALUEOVERRIDDEN>No</ISGSTASSESSABLEVALUEOVERRIDDEN>
						<STRDISGSTAPPLICABLE>No</STRDISGSTAPPLICABLE>
						<CONTENTNEGISPOS>No</CONTENTNEGISPOS>
						<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
						<ISAUTONEGATE>No</ISAUTONEGATE>
						<ISCUSTOMSCLEARANCE>No</ISCUSTOMSCLEARANCE>
						<ISTRACKCOMPONENT>No</ISTRACKCOMPONENT>
						<ISTRACKPRODUCTION>No</ISTRACKPRODUCTION>
						<ISPRIMARYITEM>No</ISPRIMARYITEM>
						<ISSCRAP>No</ISSCRAP>
						<RATE></RATE>
						<AMOUNT></AMOUNT>
						<ACTUALQTY> ${helper.number(stmt1[j].qty) + helper.number(stmt1[j].other_qty)
            } ${stmt1[j].units_name}</ACTUALQTY>
						<BILLEDQTY> ${helper.number(stmt1[j].qty) + helper.number(stmt1[j].other_qty)
            } ${stmt1[j].units_name}</BILLEDQTY>
						<BATCHALLOCATIONS.LIST>
							<GODOWNNAME>GDRM001</GODOWNNAME>
							<BATCHNAME>Primary Batch</BATCHNAME>
							<INDENTNO>&#4; Not Applicable</INDENTNO>
							<ORDERNO>&#4; Not Applicable</ORDERNO>
							<TRACKINGNUMBER>&#4; Not Applicable</TRACKINGNUMBER>
							<DYNAMICCSTISCLEARED>No</DYNAMICCSTISCLEARED>
							<AMOUNT></AMOUNT>
							<ACTUALQTY> ${helper.number(stmt1[j].qty) + helper.number(stmt1[j].other_qty)
            } ${stmt1[j].units_name}</ACTUALQTY>
							<BILLEDQTY> ${helper.number(stmt1[j].qty) + helper.number(stmt1[j].other_qty)
            } ${stmt1[j].units_name}</BILLEDQTY>
							<ADDITIONALDETAILS.LIST></ADDITIONALDETAILS.LIST>
							<VOUCHERCOMPONENTLIST.LIST></VOUCHERCOMPONENTLIST.LIST>
						</BATCHALLOCATIONS.LIST>
						<DUTYHEADDETAILS.LIST></DUTYHEADDETAILS.LIST>
						<RATEDETAILS.LIST></RATEDETAILS.LIST>
						<SUPPLEMENTARYDUTYHEADDETAILS.LIST></SUPPLEMENTARYDUTYHEADDETAILS.LIST>
						<TAXOBJECTALLOCATIONS.LIST></TAXOBJECTALLOCATIONS.LIST>
						<COSTTRACKALLOCATIONS.LIST></COSTTRACKALLOCATIONS.LIST>
						<REFVOUCHERDETAILS.LIST></REFVOUCHERDETAILS.LIST>
						<EXCISEALLOCATIONS.LIST></EXCISEALLOCATIONS.LIST>
						<EXPENSEALLOCATIONS.LIST></EXPENSEALLOCATIONS.LIST>
					</INVENTORYENTRIESOUT.LIST>
					`;
          inventoryEntries_2.push(inventoryEntry_2);
        }

        const inventoryEntriesXML_2 = inventoryEntries_2.join("");

        const xmlData = `
				<ENVELOPE>
				<HEADER>
					<TALLYREQUEST>Import Data</TALLYREQUEST>
				</HEADER>
				<BODY>
					<IMPORTDATA>
						<REQUESTDESC>
							<REPORTNAME>Vouchers</REPORTNAME>
							<STATICVARIABLES>
								<SVCURRENTCOMPANY>Riot Invoice Sync</SVCURRENTCOMPANY>
							</STATICVARIABLES>
						</REQUESTDESC>
						<REQUESTDATA>
							<TALLYMESSAGE xmlns:UDF="TallyUDF">
								<VOUCHER REMOTEID="ec615b4b-8ed4-4821-a7aa-d8424c778c25-0001f9c1"
									VCHKEY="ec615b4b-8ed4-4821-a7aa-d8424c778c25-0000b09b:00000318"
									VCHTYPE="InterGodownTrfr" ACTION="Create" OBJVIEW="Consumption Voucher View">
									<OLDAUDITENTRYIDS.LIST TYPE="Number">
										<OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
									</OLDAUDITENTRYIDS.LIST>
									<DATE>${moment(item.insert_date).format("YYYYMMDD")}</DATE>
									<VCHSTATUSDATE>${moment(item.insert_date).format("YYYYMMDD")}</VCHSTATUSDATE>
									<GUID>ec615b4b-8ed4-4821-a7aa-d8424c778c25-0001f9c1</GUID>
									<NARRATION>${item.any_remark}</NARRATION>
									<ENTEREDBY>${item.user_name}</ENTEREDBY>
									<OBJECTUPDATEACTION>Create</OBJECTUPDATEACTION>
									<CLASSNAME>InterGodown</CLASSNAME>
									<GSTREGISTRATION>&#4; Not Applicable</GSTREGISTRATION>
									<VOUCHERTYPENAME>InterGodownTrfr</VOUCHERTYPENAME>
									<VOUCHERNUMBER>1</VOUCHERNUMBER>
									<NUMBERINGSTYLE>Automatic (Manual Override)</NUMBERINGSTYLE>
									<CSTFORMISSUETYPE>&#4; Not Applicable</CSTFORMISSUETYPE>
									<CSTFORMRECVTYPE>&#4; Not Applicable</CSTFORMRECVTYPE>
									<FBTPAYMENTTYPE>Default</FBTPAYMENTTYPE>
									<PERSISTEDVIEW>Consumption Voucher View</PERSISTEDVIEW>
									<VCHSTATUSTAXADJUSTMENT>Default</VCHSTATUSTAXADJUSTMENT>
									<VCHSTATUSVOUCHERTYPE>InterGodownTrfr</VCHSTATUSVOUCHERTYPE>
									<VCHGSTCLASS>&#4; Not Applicable</VCHGSTCLASS>
									<DESTINATIONGODOWN>GDWP001_A21</DESTINATIONGODOWN>
									<DIFFACTUALQTY>No</DIFFACTUALQTY>
									<ISMSTFROMSYNC>No</ISMSTFROMSYNC>
									<ISDELETED>No</ISDELETED>
									<ISSECURITYONWHENENTERED>Yes</ISSECURITYONWHENENTERED>
									<ASORIGINAL>No</ASORIGINAL>
									<AUDITED>No</AUDITED>
									<ISCOMMONPARTY>No</ISCOMMONPARTY>
									<FORJOBCOSTING>No</FORJOBCOSTING>
									<ISOPTIONAL>No</ISOPTIONAL>
									<EFFECTIVEDATE>${moment(item.insert_date).format("YYYYMMDD")}</EFFECTIVEDATE>
									<USEFOREXCISE>No</USEFOREXCISE>
									<ISFORJOBWORKIN>No</ISFORJOBWORKIN>
									<ALLOWCONSUMPTION>No</ALLOWCONSUMPTION>
									<USEFORINTEREST>No</USEFORINTEREST>
									<USEFORGAINLOSS>No</USEFORGAINLOSS>
									<USEFORGODOWNTRANSFER>Yes</USEFORGODOWNTRANSFER>
									<USEFORCOMPOUND>No</USEFORCOMPOUND>
									<USEFORSERVICETAX>No</USEFORSERVICETAX>
									<ISREVERSECHARGEAPPLICABLE>No</ISREVERSECHARGEAPPLICABLE>
									<ISSYSTEM>No</ISSYSTEM>
									<ISFETCHEDONLY>No</ISFETCHEDONLY>
									<ISGSTOVERRIDDEN>No</ISGSTOVERRIDDEN>
									<ISCANCELLED>No</ISCANCELLED>
									<ISONHOLD>No</ISONHOLD>
									<ISSUMMARY>No</ISSUMMARY>
									<ISECOMMERCESUPPLY>No</ISECOMMERCESUPPLY>
									<ISBOENOTAPPLICABLE>No</ISBOENOTAPPLICABLE>
									<ISGSTSECSEVENAPPLICABLE>No</ISGSTSECSEVENAPPLICABLE>
									<IGNOREEINVVALIDATION>No</IGNOREEINVVALIDATION>
									<CMPGSTISOTHTERRITORYASSESSEE>No</CMPGSTISOTHTERRITORYASSESSEE>
									<PARTYGSTISOTHTERRITORYASSESSEE>No</PARTYGSTISOTHTERRITORYASSESSEE>
									<IRNJSONEXPORTED>No</IRNJSONEXPORTED>
									<IRNCANCELLED>No</IRNCANCELLED>
									<IGNOREGSTCONFLICTINMIG>No</IGNOREGSTCONFLICTINMIG>
									<ISOPBALTRANSACTION>No</ISOPBALTRANSACTION>
									<IGNOREGSTFORMATVALIDATION>No</IGNOREGSTFORMATVALIDATION>
									<ISELIGIBLEFORITC>Yes</ISELIGIBLEFORITC>
									<UPDATESUMMARYVALUES>No</UPDATESUMMARYVALUES>
									<ISEWAYBILLAPPLICABLE>No</ISEWAYBILLAPPLICABLE>
									<ISDELETEDRETAINED>No</ISDELETEDRETAINED>
									<ISNULL>No</ISNULL>
									<ISEXCISEVOUCHER>No</ISEXCISEVOUCHER>
									<EXCISETAXOVERRIDE>No</EXCISETAXOVERRIDE>
									<USEFORTAXUNITTRANSFER>No</USEFORTAXUNITTRANSFER>
									<ISEXER1NOPOVERWRITE>No</ISEXER1NOPOVERWRITE>
									<ISEXF2NOPOVERWRITE>No</ISEXF2NOPOVERWRITE>
									<ISEXER3NOPOVERWRITE>No</ISEXER3NOPOVERWRITE>
									<IGNOREPOSVALIDATION>No</IGNOREPOSVALIDATION>
									<EXCISEOPENING>No</EXCISEOPENING>
									<USEFORFINALPRODUCTION>No</USEFORFINALPRODUCTION>
									<ISTDSOVERRIDDEN>No</ISTDSOVERRIDDEN>
									<ISTCSOVERRIDDEN>No</ISTCSOVERRIDDEN>
									<ISTDSTCSCASHVCH>No</ISTDSTCSCASHVCH>
									<INCLUDEADVPYMTVCH>No</INCLUDEADVPYMTVCH>
									<ISSUBWORKSCONTRACT>No</ISSUBWORKSCONTRACT>
									<ISVATOVERRIDDEN>No</ISVATOVERRIDDEN>
									<IGNOREORIGVCHDATE>No</IGNOREORIGVCHDATE>
									<ISVATPAIDATCUSTOMS>No</ISVATPAIDATCUSTOMS>
									<ISDECLAREDTOCUSTOMS>No</ISDECLAREDTOCUSTOMS>
									<VATADVANCEPAYMENT>No</VATADVANCEPAYMENT>
									<VATADVPAY>No</VATADVPAY>
									<ISCSTDELCAREDGOODSSALES>No</ISCSTDELCAREDGOODSSALES>
									<ISVATRESTAXINV>No</ISVATRESTAXINV>
									<ISSERVICETAXOVERRIDDEN>No</ISSERVICETAXOVERRIDDEN>
									<ISISDVOUCHER>No</ISISDVOUCHER>
									<ISEXCISEOVERRIDDEN>No</ISEXCISEOVERRIDDEN>
									<ISEXCISESUPPLYVCH>No</ISEXCISESUPPLYVCH>
									<GSTNOTEXPORTED>No</GSTNOTEXPORTED>
									<IGNOREGSTINVALIDATION>No</IGNOREGSTINVALIDATION>
									<ISGSTREFUND>No</ISGSTREFUND>
									<OVRDNEWAYBILLAPPLICABILITY>No</OVRDNEWAYBILLAPPLICABILITY>
									<ISVATPRINCIPALACCOUNT>No</ISVATPRINCIPALACCOUNT>
									<VCHSTATUSISVCHNUMUSED>No</VCHSTATUSISVCHNUMUSED>
									<VCHGSTSTATUSISINCLUDED>No</VCHGSTSTATUSISINCLUDED>
									<VCHGSTSTATUSISUNCERTAIN>No</VCHGSTSTATUSISUNCERTAIN>
									<VCHGSTSTATUSISEXCLUDED>No</VCHGSTSTATUSISEXCLUDED>
									<VCHGSTSTATUSISAPPLICABLE>No</VCHGSTSTATUSISAPPLICABLE>
									<VCHGSTSTATUSISGSTR2BRECONCILED>No</VCHGSTSTATUSISGSTR2BRECONCILED>
									<VCHGSTSTATUSISGSTR2BONLYINPORTAL>No</VCHGSTSTATUSISGSTR2BONLYINPORTAL>
									<VCHGSTSTATUSISGSTR2BONLYINBOOKS>No</VCHGSTSTATUSISGSTR2BONLYINBOOKS>
									<VCHGSTSTATUSISGSTR2BMISMATCH>No</VCHGSTSTATUSISGSTR2BMISMATCH>
									<VCHGSTSTATUSISGSTR2BINDIFFPERIOD>No</VCHGSTSTATUSISGSTR2BINDIFFPERIOD>
									<VCHGSTSTATUSISRETEFFDATEOVERRDN>No</VCHGSTSTATUSISRETEFFDATEOVERRDN>
									<VCHGSTSTATUSISOVERRDN>No</VCHGSTSTATUSISOVERRDN>
									<VCHGSTSTATUSISSTATINDIFFDATE>No</VCHGSTSTATUSISSTATINDIFFDATE>
									<VCHGSTSTATUSISRETINDIFFDATE>No</VCHGSTSTATUSISRETINDIFFDATE>
									<VCHGSTSTATUSMAINSECTIONEXCLUDED>No</VCHGSTSTATUSMAINSECTIONEXCLUDED>
									<VCHGSTSTATUSISBRANCHTRANSFEROUT>No</VCHGSTSTATUSISBRANCHTRANSFEROUT>
									<VCHGSTSTATUSISSYSTEMSUMMARY>No</VCHGSTSTATUSISSYSTEMSUMMARY>
									<VCHSTATUSISUNREGISTEREDRCM>No</VCHSTATUSISUNREGISTEREDRCM>
									<VCHSTATUSISOPTIONAL>No</VCHSTATUSISOPTIONAL>
									<VCHSTATUSISCANCELLED>No</VCHSTATUSISCANCELLED>
									<VCHSTATUSISDELETED>No</VCHSTATUSISDELETED>
									<VCHSTATUSISOPENINGBALANCE>No</VCHSTATUSISOPENINGBALANCE>
									<VCHSTATUSISFETCHEDONLY>No</VCHSTATUSISFETCHEDONLY>
									<PAYMENTLINKHASMULTIREF>No</PAYMENTLINKHASMULTIREF>
									<ISSHIPPINGWITHINSTATE>No</ISSHIPPINGWITHINSTATE>
									<ISOVERSEASTOURISTTRANS>No</ISOVERSEASTOURISTTRANS>
									<ISDESIGNATEDZONEPARTY>No</ISDESIGNATEDZONEPARTY>
									<HASCASHFLOW>No</HASCASHFLOW>
									<ISPOSTDATED>No</ISPOSTDATED>
									<USETRACKINGNUMBER>No</USETRACKINGNUMBER>
									<ISINVOICE>No</ISINVOICE>
									<MFGJOURNAL>No</MFGJOURNAL>
									<HASDISCOUNTS>No</HASDISCOUNTS>
									<ASPAYSLIP>No</ASPAYSLIP>
									<ISCOSTCENTRE>No</ISCOSTCENTRE>
									<ISSTXNONREALIZEDVCH>No</ISSTXNONREALIZEDVCH>
									<ISEXCISEMANUFACTURERON>No</ISEXCISEMANUFACTURERON>
									<ISBLANKCHEQUE>No</ISBLANKCHEQUE>
									<ISVOID>No</ISVOID>
									<ORDERLINESTATUS>No</ORDERLINESTATUS>
									<VATISAGNSTCANCSALES>No</VATISAGNSTCANCSALES>
									<VATISPURCEXEMPTED>No</VATISPURCEXEMPTED>
									<ISVATRESTAXINVOICE>No</ISVATRESTAXINVOICE>
									<VATISASSESABLECALCVCH>No</VATISASSESABLECALCVCH>
									<ISVATDUTYPAID>Yes</ISVATDUTYPAID>
									<ISDELIVERYSAMEASCONSIGNEE>No</ISDELIVERYSAMEASCONSIGNEE>
									<ISDISPATCHSAMEASCONSIGNOR>No</ISDISPATCHSAMEASCONSIGNOR>
									<ISDELETEDVCHRETAINED>No</ISDELETEDVCHRETAINED>
									<CHANGEVCHMODE>No</CHANGEVCHMODE>
									<RESETIRNQRCODE>No</RESETIRNQRCODE>
									<ALTERID> 161164</ALTERID>
									<MASTERID> 129473</MASTERID>
									<VOUCHERKEY>194179766420248</VOUCHERKEY>
									<VOUCHERRETAINKEY>1</VOUCHERRETAINKEY>
									<VOUCHERNUMBERSERIES>Default</VOUCHERNUMBERSERIES>
									<UPDATEDDATETIME>20231016113628000</UPDATEDDATETIME>
									<EWAYBILLDETAILS.LIST> </EWAYBILLDETAILS.LIST>
									<EXCLUDEDTAXATIONS.LIST> </EXCLUDEDTAXATIONS.LIST>
									<OLDAUDITENTRIES.LIST> </OLDAUDITENTRIES.LIST>
									<ACCOUNTAUDITENTRIES.LIST> </ACCOUNTAUDITENTRIES.LIST>
									<AUDITENTRIES.LIST> </AUDITENTRIES.LIST>
									<DUTYHEADDETAILS.LIST> </DUTYHEADDETAILS.LIST>
									<GSTADVADJDETAILS.LIST> </GSTADVADJDETAILS.LIST>
									<CONTRITRANS.LIST> </CONTRITRANS.LIST>
									<EWAYBILLERRORLIST.LIST> </EWAYBILLERRORLIST.LIST>
									<IRNERRORLIST.LIST> </IRNERRORLIST.LIST>
									<HARYANAVAT.LIST> </HARYANAVAT.LIST>
									<SUPPLEMENTARYDUTYHEADDETAILS.LIST> </SUPPLEMENTARYDUTYHEADDETAILS.LIST>
									<INVOICEDELNOTES.LIST> </INVOICEDELNOTES.LIST>
									<INVOICEORDERLIST.LIST> </INVOICEORDERLIST.LIST>
									<INVOICEINDENTLIST.LIST> </INVOICEINDENTLIST.LIST>
									<ATTENDANCEENTRIES.LIST> </ATTENDANCEENTRIES.LIST>
									<ORIGINVOICEDETAILS.LIST> </ORIGINVOICEDETAILS.LIST>
									<INVOICEEXPORTLIST.LIST> </INVOICEEXPORTLIST.LIST>
									${inventoryEntriesXML_1}
									${inventoryEntriesXML_2}
									<GST.LIST> </GST.LIST>
									<PAYROLLMODEOFPAYMENT.LIST> </PAYROLLMODEOFPAYMENT.LIST>
									<ATTDRECORDS.LIST> </ATTDRECORDS.LIST>
									<GSTEWAYCONSIGNORADDRESS.LIST> </GSTEWAYCONSIGNORADDRESS.LIST>
									<GSTEWAYCONSIGNEEADDRESS.LIST> </GSTEWAYCONSIGNEEADDRESS.LIST>
									<TEMPGSTRATEDETAILS.LIST> </TEMPGSTRATEDETAILS.LIST>
									<TEMPGSTADVADJUSTED.LIST> </TEMPGSTADVADJUSTED.LIST>
								</VOUCHER>
							</TALLYMESSAGE>
							<TALLYMESSAGE xmlns:UDF="TallyUDF">
								<COMPANY>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>ec615b4b-8ed4-4821-a7aa-d8424c778c25</NAME>
										<REMOTECMPNAME>Riot Invoice Sync</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>29eb3569-6eb7-4cbd-a8d6-52d28cb783fd</NAME>
										<REMOTECMPNAME>DataRiotSYNC</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>d8d94e8c-ad22-40d9-b88e-8e570bac417c</NAME>
										<REMOTECMPNAME>Riot Labz Private Limited - (from 1-Apr-2020)</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>49e3b8e2-e6fe-45a6-9f2c-9c1afa6e35f2</NAME>
										<REMOTECMPNAME>RiotUni</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>7e089186-4416-4712-8fdd-f738aafafb54</NAME>
										<REMOTECMPNAME>MsCorpres Automation</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>d5a27a67-b312-42d5-9004-57001d47dac0</NAME>
										<REMOTECMPNAME>MsCorpres Automation</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>7e557474-baa2-4c0d-bf00-1616e21973cd</NAME>
										<REMOTECMPNAME>Dsdad</REMOTECMPNAME>
										<REMOTECMPSTATE>Haryana</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
								</COMPANY>
							</TALLYMESSAGE>
							<TALLYMESSAGE xmlns:UDF="TallyUDF">
								<COMPANY>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>ec615b4b-8ed4-4821-a7aa-d8424c778c25</NAME>
										<REMOTECMPNAME>Riot Invoice Sync</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>29eb3569-6eb7-4cbd-a8d6-52d28cb783fd</NAME>
										<REMOTECMPNAME>DataRiotSYNC</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>d8d94e8c-ad22-40d9-b88e-8e570bac417c</NAME>
										<REMOTECMPNAME>Riot Labz Private Limited - (from 1-Apr-2020)</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>49e3b8e2-e6fe-45a6-9f2c-9c1afa6e35f2</NAME>
										<REMOTECMPNAME>RiotUni</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>7e089186-4416-4712-8fdd-f738aafafb54</NAME>
										<REMOTECMPNAME>MsCorpres Automation</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>d5a27a67-b312-42d5-9004-57001d47dac0</NAME>
										<REMOTECMPNAME>MsCorpres Automation</REMOTECMPNAME>
										<REMOTECMPSTATE>Uttar Pradesh</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
									<REMOTECMPINFO.LIST MERGE="Yes">
										<NAME>7e557474-baa2-4c0d-bf00-1616e21973cd</NAME>
										<REMOTECMPNAME>Dsdad</REMOTECMPNAME>
										<REMOTECMPSTATE>Haryana</REMOTECMPSTATE>
									</REMOTECMPINFO.LIST>
								</COMPANY>
							</TALLYMESSAGE>
						</REQUESTDATA>
					</IMPORTDATA>
				</BODY>
			</ENVELOPE>
				`;

        data.push({
          part: item.c_part_no,
          name: item.c_name,
          remark: item.any_remark,
          in_location: loc_in,
          out_location: loc_out,
          qty: helper.number(item.qty) + helper.number(item.other_qty),
          uom: item.units_name,
          transaction: item.transfer_transaction_id,
          completed_by: item.user_name,
          date: moment(item.insert_date)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY HH:mm:ss"),
        });

        const filePath = "./files/" + fileName;
        const xmlDataWithBackticks = xmlData.replace(/&grave;/g, "`");

        if (data.length === stmt1.length) {
          // const formattedXML = xmlFormatter(xmlDataWithBackticks);

          fs.writeFile(filePath, xmlDataWithBackticks, (err) => {
            if (err) {
              return res.json({
                status: "error",
                success: false,
                message: "Failed to create the XML file.",
              });
            }
            const bufferFile = fs.readFileSync(filePath);

            // Return a JSON response with data and the XML file buffer
            return res.json({
              status: "success",
              success: true,
              data: data,
              file: bufferFile,
              filename: fileName,
            });
          });
        }
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No data found.",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//UTILITY FUNCTIONS
router.post(
  "/fetchLocationForRM2RM_from",
  [auth.isAuthorized],
  async (req, res) => {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: "20220212172006" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    for (let i = 0; i < loc_ids.length; i++) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: loc_ids[i] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      stmt2.forEach((element) => {
        locations.push({ id: element.location_key, text: element.loc_name });
      });

      if (i == loc_ids.length - 1) {
        return res.json({ status: "success", success: true, data: locations });
      }
    }
  }
);

router.post(
  "/fetchLocationForSF2SF_from",
  [auth.isAuthorized],
  async (req, res) => {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: "20220212172855" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    for (let i = 0; i < loc_ids.length; i++) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: loc_ids[i] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      stmt2.forEach((element) => {
        locations.push({ id: element.location_key, text: element.loc_name });
      });

      if (i == loc_ids.length - 1) {
        return res.json({ status: "success", success: true, data: locations });
      }
    }
  }
);

router.post(
  "/fetchLocationForRM2REJ_from",
  [auth.isAuthorized],
  async (req, res) => {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: "20220212174357" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    for (let i = 0; i < loc_ids.length; i++) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: loc_ids[i] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      stmt2.forEach((element) => {
        locations.push({ id: element.location_key, text: element.loc_name });
      });

      if (i == loc_ids.length - 1) {
        return res.json({ status: "success", success: true, data: locations });
      }
    }
  }
);

router.post(
  "/fetchLocationForSF2REJ_from",
  [auth.isAuthorized],
  async (req, res) => {
    let stmt1 = await invtDB.query(
      "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
      {
        replacements: { location_key: "20220212173214" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    for (let i = 0; i < loc_ids.length; i++) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
        {
          replacements: { location_defined: loc_ids[i] },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      stmt2.forEach((element) => {
        locations.push({ id: element.location_key, text: element.loc_name });
      });

      if (i == loc_ids.length - 1) {
        return res.json({ status: "success", success: true, data: locations });
      }
    }
  }
);

router.post(
  "/fetchLocationForRM2RM_to",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let stmt1 = await invtDB.query(
        "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
        {
          replacements: { location_key: "20220212173548" },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      // string to array
      let loc_ids = stmt1[0].locations.split(",");
      let locations = [];
      for (let i = 0; i < loc_ids.length; i++) {
        let stmt2 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
          {
            replacements: { location_defined: loc_ids[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        stmt2.forEach((element) => {
          locations.push({ id: element.location_key, text: element.loc_name });
        });

        if (i == loc_ids.length - 1) {
          return res.json({
            status: "success",
            success: true,
            data: locations,
          });
        }
      }
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

router.post(
  "/fetchLocationForSF2SF_to",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let stmt1 = await invtDB.query(
        "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
        {
          replacements: { location_key: "20220212173611" },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      // string to array
      let loc_ids = stmt1[0].locations.split(",");
      let locations = [];
      for (let i = 0; i < loc_ids.length; i++) {
        let stmt2 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
          {
            replacements: { location_defined: loc_ids[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        stmt2.forEach((element) => {
          locations.push({ id: element.location_key, text: element.loc_name });
        });

        if (i == loc_ids.length - 1) {
          return res.json({
            status: "success",
            success: true,
            data: locations,
          });
        }
      }
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

router.post(
  "/fetchLocationForRM2REJ_to",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let stmt1 = await invtDB.query(
        "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
        {
          replacements: { location_key: "20220212174545" },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      // string to array
      let loc_ids = stmt1[0].locations.split(",");
      let locations = [];
      for (let i = 0; i < loc_ids.length; i++) {
        let stmt2 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
          {
            replacements: { location_defined: loc_ids[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        stmt2.forEach((element) => {
          locations.push({ id: element.location_key, text: element.loc_name });
        });

        if (i == loc_ids.length - 1) {
          return res.json({
            status: "success",
            success: true,
            data: locations,
          });
        }
      }
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

router.post(
  "/fetchLocationForSF2REJ_to",
  [auth.isAuthorized],
  async (req, res) => {
    try {
      let stmt1 = await invtDB.query(
        "SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key",
        {
          replacements: { location_key: "20220212173633" },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      // string to array
      let loc_ids = stmt1[0].locations.split(",");
      let locations = [];
      for (let i = 0; i < loc_ids.length; i++) {
        let stmt2 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ",
          {
            replacements: { location_defined: loc_ids[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        stmt2.forEach((element) => {
          locations.push({ id: element.location_key, text: element.loc_name });
        });

        if (i == loc_ids.length - 1) {
          return res.json({
            status: "success",
            success: true,
            data: locations,
          });
        }
      }
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

//LOCATION DETAILS
router.post(
  "/fetchLocationDetail_from",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      location_key: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "Please select valid location.",
      });
    }

    try {
      let stmt1 = await invtDB.query(
        "SELECT loc_address FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
        {
          replacements: { location: req.body.location_key },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt1.length == 0) {
        return res.json({
          status: "error",
          success: false,
          message: "Please select valid location.",
        });
      } else {
        return res.json({
          status: "success",
          success: true,
          data: stmt1[0].loc_address,
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

router.post(
  "/fetchLocationDetail_to",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      location_key: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "Please select valid location.",
      });
    }

    try {
      let stmt1 = await invtDB.query(
        "SELECT loc_address FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
        {
          replacements: { location: req.body.location_key },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt1.length == 0) {
        return res.json({
          status: "error",
          success: false,
          message: "Please select valid location.",
        });
      } else {
        return res.json({
          status: "success",
          success: true,
          data: stmt1[0].loc_address,
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

//LOCATION STOCK CHECK
// router.post("/godownStocks", [auth.isAuthorized], async (req, res) => {
//   const validation = new Validator(req.body, {
//     component: "required",
//     location: "required",
//   });

//   if (validation.fails()) {
//     return res.json({
//       status: "error",
//       success: false,
//       message: "Something you missing in form field to supply.",
//       data: validation.errors.all(),
//     });
//   }
//   try {
//     let stmt3 = await invtDB.query(
//       "SELECT * FROM `components` LEFT JOIN `units`ON `components`.`c_uom` = `units`.`units_id` WHERE `components`.`component_key` = :key AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y'",
//       {
//         replacements: { key: req.body.component },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );
//     if (stmt3.length <= 0) {
//       return res.json({
//         status: "error",
//         success: false,
//         message: "Unregistered component found.",
//       });
//     }

//     // ALL INWARD AT LOCATION
//     let stmt1 = await invtDB.query(
//       "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_in` = :location",
//       {
//         replacements: {
//           component: req.body.component,
//           location: req.body.location,
//         },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );
//     let inward_all_qty;
//     if (stmt1.length > 0) {
//       inward_all_qty = helper.number(stmt1[0].Inward);
//     } else {
//       inward_all_qty = 0;
//     }

//     // ALL OUTWARD AT LOCATION
//     let stmt2 = await invtDB.query(
//       "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_out` = :location",
//       {
//         replacements: {
//           component: req.body.component,
//           location: req.body.location,
//         },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );
//     let outward_all_qty = 0;
//     if (stmt2.length > 0) {
//       outward_all_qty = helper.number(stmt2[0].Outward);
//     }

//     if (
//       stmt3[0].c_name === 0 ||
//       stmt3[0].units_name === 0 ||
//       stmt3[0].ID === 0
//     ) {
//       return res.json({
//         status: "error",
//         success: false,
//         message:
//           "Material cannot be transferred because it seems it is not available in stock yet.",
//       });
//     }

//     const avr_rate =
//       await require("../../../../helper/utils/avgRate").getWeightedPurchaseRate(
//         req.body.component,
//         moment(new Date()).format("YYYY-MM-DD HH:mm:ss")
//       );

//     return res.json({
//       status: "success",
//       success: true,
//       data: {
//         name: stmt3[0].c_name,
//         key: stmt3[0].component_key,
//         unit: stmt3[0].units_name,
//         available_qty: helper.number(inward_all_qty - outward_all_qty),
//         avr_rate: avr_rate,
//       },
//     });
//   } catch (err) {
//     return helper.errorResponse(res, err);
//   }
// });

router.post("/godownStocks", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    component: "required",
    location: "required",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
  }

  try {
    const [stmt3, stmt1, stmt2, avgRateRows] = await Promise.all([
      // Component + unit info with avg rate
      invtDB.query(
        `SELECT components.*, units.units_name
         FROM components
         LEFT JOIN units ON components.c_uom = units.units_id
         LEFT JOIN rm_location rl
           ON rl.ID = (
             SELECT ID FROM rm_location
             WHERE components_id = components.component_key
               AND trans_type NOT IN ('CANCELLED') AND (trans_type  != 'INWARD' OR in_module   != 'IN-WO')
             ORDER BY ID DESC
             LIMIT 1
           )
         WHERE components.component_key = :key
           AND components.c_type        = 'R'
           AND components.c_is_enabled  = 'Y'`,
        {
          replacements: { key: req.body.component },
          type: invtDB.QueryTypes.SELECT,
        },
      ),

      // ALL INWARD AT LOCATION
      invtDB.query(
        `SELECT COALESCE(SUM(qty + other_qty), 0) AS Inward
         FROM rm_location
         WHERE components_id = :component
           AND trans_type IN ('INWARD','ISSUE','JOBWORK','REJECTION','TRANSFER')
           AND loc_in = :location`,
        {
          replacements: {
            component: req.body.component,
            location: req.body.location,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      ),

      // ALL OUTWARD AT LOCATION
      invtDB.query(
        `SELECT COALESCE(SUM(qty + other_qty), 0) AS Outward
         FROM rm_location
         WHERE components_id = :component
           AND trans_type IN ('CONSUMPTION','ISSUE','JOBWORK','REJECTION','TRANSFER')
           AND loc_out = :location`,
        {
          replacements: {
            component: req.body.component,
            location: req.body.location,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      ),

      // Avg rate — last INWARD from IN-WO module, non-cancelled
      // invtDB.query(
      //   `SELECT COALESCE( ( SELECT w_avr_rate FROM rm_location WHERE components_id = :component_id AND trans_type IN ('INWARD', 'TRANSFER') AND in_module != 'IN-WO' AND DATE_FORMAT(insert_date, '%Y-%m-%d %H:%i:%s') >= '2026-05-28 06:00:00' ORDER BY ID DESC LIMIT 1 ), ( SELECT last_rate FROM tbl_average_rate_2026 WHERE component_key = :component_id LIMIT 1 ) ) AS w_avr_rate`,
      //   {
      //     replacements: { component_id: req.body.component },
      //     type: invtDB.QueryTypes.SELECT,
      //   },
      // ),
      await require("../../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(
        req.body.component,
      ),
    ]);

    if (stmt3.length <= 0) {
      return res.json({
        success: false,
        message: "unregistered component found",
        status: "error",
      });
    }

    if (
      stmt3[0].c_name === 0 ||
      stmt3[0].units_name === 0 ||
      stmt3[0].ID === 0
    ) {
      return res.json({
        success: false,
        message: "material can not be tranfered bcz seems it is not available in stock yet",
        status: "error",
      });
    }

    const inward_all_qty = stmt1.length ? helper.number(stmt1[0].Inward) : 0;
    const outward_all_qty = stmt2.length ? helper.number(stmt2[0].Outward) : 0;

    return res.json({
      success: true,
      status: "success",
      data: {
        name: stmt3[0].c_name,
        key: stmt3[0].component_key,
        unit: stmt3[0].units_name,
        available_qty: helper.number(inward_all_qty - outward_all_qty),
        avr_rate: avgRateRows, //         avgRateRows[0].w_avr_rate == "--" ? 0 : (Number(avgRateRows[0].w_avr_rate).toFixed(4) ?? ""),
      },
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});


// PRODUCT STOCK AT LOCATION (FG - same as godownStocks but for product + location via mfg_production_3)
router.post("/godownStocksProduct", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    product: "required",
    location: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
    return;
  }
  try {
    console.log("[godownStocksProduct] request:", { product: req.body.product, location: req.body.location, branch: req.branch });

    let stmt0 = await invtDB.query(
      "SELECT * FROM `products` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE `products`.`product_key` = :key ORDER BY `products`.`p_name` ASC",
      {
        replacements: { key: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    console.log("[godownStocksProduct] product fetch stmt0 length:", stmt0.length, "row:", stmt0[0] ? { p_sku: stmt0[0].p_sku, product_key: stmt0[0].product_key, p_name: stmt0[0].p_name } : null);
    if (stmt0.length <= 0) {
      return res.json({
        success: false,
        message: "unregistered product found",
        status: "error",
      });
    }

    // STOCK CALCULATION: match fetchSKU_logs (global product stock, r5-style IN-OUT)
    // DEBIT (OUT) balance: all OUT for this product, any location
    const debitStmt = await invtDB.query(
      "SELECT COALESCE(SUM(`fgout_approve_out_qty`),0) AS `DebitBalance` FROM `mfg_production_3` WHERE `fgout_pro_apr_sku` = :product_key AND `type` = 'OUT' AND `fg_status` = 'ACTIVE'",
      {
        replacements: { product_key: req.body.product },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    let debitBal = 0;
    if (debitStmt.length > 0) {
      debitBal = helper.number(debitStmt[0].DebitBalance || 0);
    }

    // CREDIT (IN) balance: all IN/FGMIN for this SKU, any location
    const creditStmt = await invtDB.query(
      "SELECT COALESCE(SUM(`mfg_approve_in_qty`),0) AS `totalQTYin` FROM `mfg_production_3` WHERE `mfg_pro_apr_sku` = :sku AND `type` IN('IN', 'FGMIN') AND `fg_status` = 'ACTIVE'",
      {
        replacements: { sku: stmt0[0].p_sku },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    let creditBal = 0;
    if (creditStmt.length > 0) {
      creditBal = helper.number(creditStmt[0].totalQTYin || 0);
    }

    const available_qty = helper.number(creditBal - debitBal);
    console.log(
      "[godownStocksProduct] stock calc (global, fetchSKU_logs style): creditBal - debitBal =",
      creditBal,
      "-",
      debitBal,
      "= available_qty",
      available_qty
    );

    if (
      !stmt0[0].p_name ||
      !stmt0[0].units_name
    ) {
      return res.json({
        success: false,
        message: "product can not be transferred bcz seems it is not available in stock yet",
        status: "error",
      });
    }

    const avgRate = require("../../../../helper/utils/avgRate");
    const avr_rate = await avgRate.getWeightedSKURate(
      req.body.product,
      moment(new Date()).format("YYYY-MM-DD HH:mm:ss")
    );

    return res.json({
      success: true,
      status: "success",
      data: {
        name: stmt0[0].p_name,
        key: stmt0[0].product_key,
        unit: stmt0[0].units_name,
        available_qty: available_qty < 0 ? 0 : helper.number(available_qty),
        avr_rate: avr_rate,
      },
    });
  } catch (err) {
    return res.json({
      success: false,
      message: "API Error: contact system administrator",
      status: "error",
      error: err.stack,
    });
  }
});

//RM - RM AND SF - SF Transactions List
// router.post("/report_rmsf_same", [auth.isAuthorized], async (req, res) => {
//   const searchBy = req.body.wise;
//   const searchValue = req.body.data;

//   const validation = new Validator(req.body, {
//     wise: "required",
//     data: "required",
//   });

//   if (validation.fails()) {
//     return res.json({
//       status: "error",
//       success: false,
//       message: "Something you missing in form field to supply.",
//       data: validation.errors.all(),
//     });
//   }

//   try {
//     let stmt1 = [];
//     if (searchBy == "datewise") {
//       const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

//       const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
//       const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
//       const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
//         moment(date[0], "DD-MM-YYYY"),
//         "months"
//       );
//       if (durationInMonths > 3) {
//         return res.json({
//           status: "error",
//           success: false,
//           success: false,
//           message:
//             "On the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only.",
//         });
//       }

//       stmt1 = await invtDB.query(
//         "SELECT *, `rm_location`.`insert_date`, `rm_location`.`insert_by` AS `insertedByPersonName`, `components`.`component_key` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND DATE_FORMAT(`rm_location`.`insert_date`,'%Y-%m-%d') BETWEEN :datefrom AND :dateto AND `rm_location`.`trans_type` = 'TRANSFER' ORDER BY `rm_location`.`transfer_transaction_id` DESC",
//         {
//           replacements: {
//             datefrom: fromdate,
//             dateto: todate,
//           },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );
//     }

//     if (stmt1.length > 0) {
//       var data = [];
//       stmt1.map(async (item) => {
//         let stmt2 = await invtDB.query(
//           "SELECT * FROM `location_main` WHERE `location_key` = :loc_in",
//           {
//             replacements: { loc_in: item.loc_in },
//             type: invtDB.QueryTypes.SELECT,
//           }
//         );
//         let loc_in;
//         if (stmt2.length > 0) {
//           loc_in = stmt2[0].loc_name;
//         } else {
//           loc_in = "N/A";
//         }

//         let stmt3 = await invtDB.query(
//           "SELECT * FROM `location_main` WHERE `location_key` = :loc_out",
//           {
//             replacements: { loc_out: item.loc_out },
//             type: invtDB.QueryTypes.SELECT,
//           }
//         );
//         let loc_out;
//         if (stmt3.length > 0) {
//           loc_out = stmt3[0].loc_name;
//         } else {
//           loc_out = "N/A";
//         }
//         // CHANGE: Calculate weighted average rate as in getMfgConsumptionComponent
//         let weightedPurchaseRate =
//           await require("../../../../helper/utils/avgRate").getWeightedPurchaseRate(
//             item.component_key,
//             moment(item.insert_date)
//               .tz("Asia/Kolkata")
//               .format("YYYY-MM-DD HH:mm:ss")
//           );

//         data.push({
//           part: item.c_part_no,
//           cat_part: item.c_new_part_no,
//           name: item.c_name,
//           remark: item.any_remark,
//           in_location: loc_in,
//           out_location: loc_out,
//           qty: helper.number(item.qty) + helper.number(item.other_qty),
//           uom: item.units_name,
//           transaction: item.transfer_transaction_id,
//           completed_by: item.user_name,
//           date: moment(item.insert_date)
//             .tz("Asia/Kolkata")
//             .format("DD-MM-YYYY HH:mm:ss"),
//           weightedPurchaseRate: weightedPurchaseRate,
//           weightedTotalCost: helper.number(
//             (Number(item.qty) + Number(item.other_qty)) * weightedPurchaseRate
//           ),
//         });

//         if (data.length === stmt1.length) {
//           return res.json({ status: "success", success: true, data: data });
//         }
//       });
//     } else {
//       return res.json({
//         status: "error",
//         success: false,
//         message: "No data found.",
//       });
//     }
//   } catch (err) {
//     return helper.errorResponse(res, err);
//   }
// });

router.post("/report_rmsf_same", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
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
    return;
  }

  try {
    let stmt1 = [];
    let todate;
    if (searchBy == "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months",
      );
      if (durationInMonths > 3) {
        return res.json({
          status: "error",
          message:
            "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          success: false
        });
      }

      stmt1 = await invtDB.query(
        "SELECT *, `rm_location`.`insert_date`, `rm_location`.`insert_by` AS `insertedByPersonName`, `components`.`component_key` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND DATE_FORMAT(`rm_location`.`insert_date`,'%Y-%m-%d') BETWEEN :datefrom AND :dateto AND `rm_location`.`trans_type` = 'TRANSFER' ORDER BY `rm_location`.`transfer_transaction_id` DESC",
        {
          replacements: {
            datefrom: fromdate,
            dateto: todate,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    }

    if (stmt1.length > 0) {
      var data = [];
      stmt1.map(async (item) => {
        let stmt2 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :loc_in",
          {
            replacements: { loc_in: item.loc_in },
            type: invtDB.QueryTypes.SELECT,
          },
        );
        let loc_in;
        if (stmt2.length > 0) {
          loc_in = stmt2[0].loc_name;
        } else {
          loc_in = "N/A";
        }

        let stmt3 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :loc_out",
          {
            replacements: { loc_out: item.loc_out },
            type: invtDB.QueryTypes.SELECT,
          },
        );
        let loc_out;
        if (stmt3.length > 0) {
          loc_out = stmt3[0].loc_name;
        } else {
          loc_out = "N/A";
        }
        // CHANGE: Calculate weighted average rate as in getMfgConsumptionComponent
        // let weightedPurchaseRate =
        // await require("../../../../helper/utils/avgRate").getWeightedPurchaseRate(
        //   item.component_key,
        //   moment(item.insert_date)
        //     .tz("Asia/Kolkata")
        //     .format("YYYY-MM-DD HH:mm:ss")
        // );
        //
        let weightedPurchaseRate =
          await require("../../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(
            item.component_key,
            todate,
          );

        data.push({
          part: item.c_part_no,
          cat_part: item.c_new_part_no,
          name: item.c_name,
          remark: item.any_remark,
          in_location: loc_in,
          out_location: loc_out,
          qty: helper.number(item.qty) + helper.number(item.other_qty),
          uom: item.units_name,
          transaction: item.transfer_transaction_id,
          completed_by: item.user_name,
          date: moment(item.insert_date)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY HH:mm:ss"),
          weightedPurchaseRate: weightedPurchaseRate,
          weightedTotalCost: helper.number(
            (Number(item.qty) + Number(item.other_qty)) * weightedPurchaseRate,
          ),
        });

        if (data.length === stmt1.length) {
          return res.json({ success: true, status: "success", data: data });
        }
      });
    } else {
      return res.json({
        success: false,
        message: "No data found",
        status: "error",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FG - FG Transfer Transactions List (same pattern as report_rmsf_same)
router.post("/report_fg2fg_same", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      code: 500,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
    return;
  }

  try {
    let stmt1 = [];
    if (searchBy == "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      if (!date || date.length < 2) {
        return res.json({
          success: false,
          code: 500,
          message: "Invalid date range format (use DD-MM-YYYY to DD-MM-YYYY)",
          status: "error",
        });
      }
      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months"
      );
      if (durationInMonths > 3) {
        return res.json({
          success: false,
          status: "error",
          message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          code: "500",
        });
      }

      const branch = req.branch || null;
      stmt1 = await invtDB.query(
        `SELECT mfg_production_3.ID, mfg_production_3.mfg_pro_apr_sku, mfg_production_3.mfg_approve_in_qty,
         mfg_production_3.mfg_pro_location_in, mfg_production_3.fgout_pro_location_out,
         mfg_production_3.mfg_pro_apr_transaction, mfg_production_3.mfg_pro_apr_by, mfg_production_3.mfg_pro_apr_fulldate,
         mfg_production_3.fg_out_remark, mfg_production_3.company_branch,
         products.p_sku, products.p_name, products.product_key, units.units_name,
         loc_in.loc_name AS loc_in_name, loc_out.loc_name AS loc_out_name,
         admin_login.user_name
         FROM mfg_production_3
         LEFT JOIN products ON products.p_sku = mfg_production_3.mfg_pro_apr_sku
         LEFT JOIN units ON products.p_uom = units.units_id
         LEFT JOIN location_main AS loc_in ON loc_in.location_key = mfg_production_3.mfg_pro_location_in
         LEFT JOIN location_main AS loc_out ON loc_out.location_key = mfg_production_3.fgout_pro_location_out
         LEFT JOIN admin_login ON admin_login.CustID = mfg_production_3.mfg_pro_apr_by
         WHERE mfg_production_3.type = 'TRANSFER'
         AND DATE_FORMAT(mfg_production_3.mfg_pro_apr_fulldate,'%Y-%m-%d') BETWEEN :datefrom AND :dateto
         AND (mfg_production_3.company_branch = :branch OR :branch IS NULL)
         ORDER BY mfg_production_3.mfg_pro_apr_fulldate DESC, mfg_production_3.ID DESC`,
        {
          replacements: { datefrom: fromdate, dateto: todate, branch: branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt1.length > 0) {
      const avgRate = require("../../../../helper/utils/avgRate");
      const data = [];
      for (let i = 0; i < stmt1.length; i++) {
        const item = stmt1[i];
        const txDate = item.mfg_pro_apr_fulldate
          ? moment(item.mfg_pro_apr_fulldate).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")
          : moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
        let weightedSKURate = 0;
        if (item.product_key) {
          try {
            weightedSKURate = await avgRate.getWeightedSKURate(item.product_key, txDate);
          } catch (e) {
            weightedSKURate = 0;
          }
        }
        const qty = helper.number(item.mfg_approve_in_qty) || 0;
        data.push({
          part: item.p_sku || "--",
          name: item.p_name || "--",
          product_key: item.product_key || "--",
          remark: item.fg_out_remark || "--",
          in_location: item.loc_in_name || "N/A",
          out_location: item.loc_out_name || "N/A",
          qty: qty,
          uom: item.units_name || "--",
          transaction: item.mfg_pro_apr_transaction || "--",
          completed_by: item.user_name || "N/A",
          date: item.mfg_pro_apr_fulldate
            ? moment(item.mfg_pro_apr_fulldate).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss")
            : "N/A",
          weightedSKURate: weightedSKURate,
          weightedTotalCost: helper.number(Number(qty) * Number(weightedSKURate)),
        });
      }
      return res.json({ success: true, status: "success", data: data });
    } else {
      return res.json({
        success: false,
        message: "No data found",
        status: "error",
      });
    }
  } catch (err) {
    return res.json({
      success: false,
      message: "API Error: contact system administrator",
      status: "error",
      error: err.stack,
    });
  }
});


//SF - REJ Transactions List
router.post("/report_sf_rej", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }

  try {
    let stmt1 = [];
    if (searchBy == "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months"
      );
      if (durationInMonths > 3) {
        return res.json({
          status: "error",
          success: false,
          success: false,
          message:
            "On the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only.",
        });
      }

      stmt1 = await invtDB.query(
        "SELECT *, `rm_location`.`insert_date`, `rm_location`.`insert_by` AS `insertedByPersonName` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND DATE_FORMAT(`rm_location`.`insert_date`,'%Y-%m-%d') BETWEEN :datefrom AND :dateto AND `rm_location`.`trans_type` = 'TRANSFER' ORDER BY `components`.`c_name` ASC",
        {
          replacements: {
            datefrom: fromdate,
            dateto: todate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }
    if (stmt1.length > 0) {
      var data = [];
      stmt1.map(async (item) => {
        let stmt2 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :loc_in",
          {
            replacements: { loc_in: item.loc_in },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let loc_in;
        if (stmt2.length > 0) {
          loc_in = stmt2[0].loc_name;
        } else {
          loc_in = "N/A";
        }

        let stmt3 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :loc_out",
          {
            replacements: { loc_out: item.loc_out },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let loc_out;
        if (stmt3.length > 0) {
          loc_out = stmt3[0].loc_name;
        } else {
          loc_out = "N/A";
        }

        data.push({
          part: item.c_part_no,
          cat_part: item.c_new_part_no,
          name: item.c_name,
          remark: item.any_remark,
          in_location: loc_in,
          out_location: loc_out,
          qty: helper.number(item.qty) + helper.number(item.other_qty),
          uom: item.units_name,
          transaction: item.transfer_transaction_id,
          completed_by: item.user_name,
          date: moment(item.insert_date)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY HH:mm:ss"),
        });

        if (data.length === stmt1.length) {
          return res.json({ status: "success", success: true, data: data });
        }
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No data found.",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//RM - REJ Transactions List
router.post("/report_rm_rej", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }

  try {
    let stmt1 = [];
    if (searchBy == "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months"
      );
      if (durationInMonths > 3) {
        return res.json({
          status: "error",
          success: false,
          message:
            "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
        });
      }

      stmt1 = await invtDB.query(
        "SELECT *, `rm_location`.`insert_date`, `rm_location`.`insert_by` AS `insertedByPersonName` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `admin_login` ON `rm_location`.`insert_by` = `admin_login`.`CustID` WHERE `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND DATE_FORMAT(`rm_location`.`insert_date`,'%Y-%m-%d') BETWEEN :datefrom AND :dateto AND `rm_location`.`trans_type` = 'REJECTION' ORDER BY `components`.`c_name` ASC",
        {
          replacements: {
            datefrom: fromdate,
            dateto: todate,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }
    if (stmt1.length > 0) {
      var data = [];
      stmt1.map(async (item) => {
        let stmt2 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :loc_in",
          {
            replacements: { loc_in: item.loc_in },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let loc_in;
        if (stmt2.length > 0) {
          loc_in = stmt2[0].loc_name;
        } else {
          loc_in = "N/A";
        }

        let stmt3 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :loc_out",
          {
            replacements: { loc_out: item.loc_out },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let loc_out;
        if (stmt3.length > 0) {
          loc_out = stmt3[0].loc_name;
        } else {
          loc_out = "N/A";
        }

        data.push({
          part: item.c_part_no,
          cat_part: item.c_new_part_no,
          name: item.c_name,
          remark: item.any_remark,
          in_location: loc_in,
          out_location: loc_out,
          qty: helper.number(item.qty) + helper.number(item.other_qty),
          uom: item.units_name,
          transaction: item.transfer_transaction_id,
          completed_by: item.user_name,
          date: moment(item.insert_date)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY HH:mm:ss"),
        });

        if (data.length === stmt1.length) {
          return res.json({ status: "success", success: true, data: data });
        }
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No data found.",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//INSERT RM - RM

router.post("/transferRM2RM", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    fromlocation: "required",
    component: "required|array",
    tolocation: "required|array",
    qty: "required|array",
    rate: "required|array",
  });

  if (validation.fails()) {
    res.json({
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
      success: false,
    });
    return;
  }

  const toFindDublicates = (arry) =>
    arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(req.body.component);
  if (dubliEle.length > 0) {
    res.json({
      success: false,
      message:
        "You have entered a same component twice of time in a single request",
      status: "error",
    });
    return;
  }

  let component_length = req.body.component.length;
  if (
    req.body.tolocation.length !== component_length ||
    req.body.qty.length !== component_length
  ) {
    return res.json({
      success: false,
      status: "error",
      message:
        "Component, tolocation, and qty arrays must have the same length",
    });
  }
  const t = await invtDB.transaction();

  try {
    let transactionID = await helper.genTransaction("GODOWN_TRANSFER", t);
    let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");
    let processedComponents = 0;

    for (let i = 0; i < component_length; i++) {
      if (helper.number(req.body.qty[i]) > 0) {
        processedComponents += 1;
        if (req.body.fromlocation == req.body.tolocation[i]) {
          await t.rollback();
          return res.json({
            success: false,
            status: "error",
            message:
              "pick and drop location can't be similiar - in row number (" +
              [i + 1] +
              ")",
          });
        }
        let item_validation = new Validator(
          { component: req.body.component[i] },
          { component: "required" }
        );
        if (item_validation.fails()) {
          await t.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "select component firstly..",
          });
        }

        let qty_validation = new Validator(
          { qty: helper.number(req.body.qty[i]) },
          { qty: "required|min:1" }
        );
        if (qty_validation.fails()) {
          await t.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "Quantity should not be less than zero.",
          });
        }

        let to_location_validation = new Validator(
          { tolocation: helper.number(req.body.tolocation[i]) },
          { tolocation: "required" }
        );
        if (to_location_validation.fails()) {
          await t.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "select valid drop location",
          });
        }


        let rawRemark = "--";
        if (Array.isArray(req.body.comments)) {
          rawRemark = req.body.comments[i] ?? req.body.comments[0] ?? "--";
        } else if (Array.isArray(req.body.comment)) {
          rawRemark =
            req.body.comment[i] ?? req.body.comment[0] ?? "--";
        } else {
          rawRemark = req.body.comment ?? req.body.comments ?? "--";
        }
        const remark =
          typeof rawRemark === "string" && rawRemark.trim() !== ""
            ? rawRemark
            : "--";

        let stmt1 = await invtDB.query(
          "INSERT INTO `rm_location` (`in_module`,`company_branch`,`trans_type`,`components_id`,`qty`,`loc_in`,`loc_out`,`any_remark`,`insert_date`,`insert_by`,`transfer_transaction_id`,in_po_rate)VALUES ('IN-TRN',:branch,'TRANSFER',:component,:qty,:loc_in,:loc_out,:remark,:insert_date,:insert_by,:transfer_transaction_id,:rate)",
          {
            replacements: {
              branch: req.branch,
              component: req.body.component[i],
              qty: helper.number(req.body.qty[i]),
              loc_in: req.body.tolocation[i],
              loc_out: req.body.fromlocation,
              remark,
              insert_date: insert_dt,
              insert_by: req.logedINUser,
              transfer_transaction_id: transactionID,
              rate: req.body.rate[i],
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: t,
          }
        );
        if (stmt1.length > 0) {
          let stmt2 = await invtDB.query(
            "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
            {
              replacements: { location: req.body.fromlocation },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt2.length > 0) {
            let stmt3 = await invtDB.query(
              "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
              {
                replacements: { location: req.body.tolocation[i] },
                type: invtDB.QueryTypes.SELECT,
              }
            );
            if (stmt3.length > 0) {
              let stmt4 = await invtDB.query(
                "SELECT * FROM `components` WHERE `component_key` = :component_key",
                {
                  replacements: { component_key: req.body.component[i] },
                  type: invtDB.QueryTypes.SELECT,
                }
              );
              if (stmt4.length > 0) {
                if (stmt4[0].c_is_enabled == "N") {
                  await t.rollback();
                  return res.json({
                    success: false,
                    status: "error",
                    message: {
                      msg:
                        "component part code (" +
                        stmt4[0].c_part_no +
                        " / " +
                        stmt4[0].c_name +
                        ") can not be execute bcz it has been disabled for transaction",
                    },
                  });
                } else if (stmt4[0].c_type == "S") {
                  await t.rollback();
                  return res.json({
                    success: false,
                    status: "error",
                    message: {
                      msg:
                        "component part code (" +
                        stmt4[0].c_part_no +
                        " / " +
                        stmt4[0].c_name +
                        ") can not be execute bcz it is a service part",
                    },
                  });
                } else {
                  // ALL INWARD AT LOCATION (RM TO RM)
                  let stmt5 = await invtDB.query(
                    "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'ISSUE' OR `trans_type` = 'TRANSFER') AND `loc_in` = :location",
                    {
                      replacements: {
                        component: req.body.component[i],
                        location: req.body.fromlocation,
                      },
                      type: invtDB.QueryTypes.SELECT,
                    }
                  );
                  let inward_all_qty;
                  if (stmt5.length > 0) {
                    inward_all_qty = helper.number(stmt5[0].Inward);
                  } else {
                    inward_all_qty = 0;
                  }

                  // ALL OUTWARD AT LOCATION
                  let stmt6 = await invtDB.query(
                    "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'ISSUE' OR `trans_type` = 'TRANSFER') AND `loc_out` = :location",
                    {
                      replacements: {
                        component: req.body.component[i],
                        location: req.body.fromlocation,
                      },
                      type: invtDB.QueryTypes.SELECT,
                    }
                  );
                  let outward_all_qty;
                  if (stmt6.length > 0) {
                    outward_all_qty = helper.number(stmt6[0].Outward);
                  } else {
                    outward_all_qty = 0;
                  }

                  if (
                    inward_all_qty - outward_all_qty >=
                    helper.number(req.body.qty[i])
                  ) {
                    // Quantity is sufficient for this row; keep processing.
                  } else {
                    await t.rollback();
                    return res.json({
                      success: false,
                      status: "error",
                      message:
                        "Component part code (" +
                        stmt4[0].c_part_no +
                        " / " +
                        stmt4[0].c_name +
                        ") can not be execute bcz it has not enough quantity at location",
                    });
                  }
                }
              } else {
                await t.rollback();
                return res.json({
                  success: false,
                  status: "error",
                  message: "select valid component",
                });
              }
            } else {
              await t.rollback();
              return res.json({
                success: false,
                status: "error",
                message: "select valid drop location",
              });
            }
          } else {
            await t.rollback();
            return res.json({
              success: false,
              status: "error",
              message: "select valid pick location",
            });
          }
        } else {
          await t.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "an error occured by exectuing your request",
          });
        }
      }
    }

    if (processedComponents === 0) {
      await t.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "No valid quantity found for any component",
      });
    }

    await t.commit();
    return res.json({
      success: true,
      status: "success",
      message:
        "Godown migration from RM to RM has been successfully completed..<br/>transaction ID: #" +
        transactionID,
    });
  } catch (err) {
    console.log(err);
    await t.rollback();
    return res.json({
      success: false,
      message: "API Error: contact system administrator",
      status: "error",
      error: err.stack,
    });
  }
});

//INSERT SF - SF
router.post("/transferSF2SF", [auth.isAuthorized], async (req, res) => {
  // Validate the request body
  const validation = new Validator(req.body, {
    fromlocation: "required",
    component: "required|array",
    tolocation: "required|array",
    qty: "required|array",
    comments: "required|array",
    rate: "required|array",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      message: "Missing required fields in form",
      data: validation.errors.all(),
      status: "error",
    });
  }

  const componentLength = req.body.component.length;
  if (
    req.body.tolocation.length !== componentLength ||
    req.body.qty.length !== componentLength ||
    req.body.comments.length !== componentLength
  ) {
    return res.json({
      success: false,
      message:
        "Component, tolocation, qty, and comments arrays must have the same length",
      status: "error",
    });
  }

  const toFindDuplicates = (arry) =>
    arry.filter((item, index) => arry.indexOf(item) !== index);
  const duplicateElements = toFindDuplicates(req.body.component);
  if (duplicateElements.length > 0) {
    return res.json({
      success: false,
      message: "Duplicate components detected in the request",
      status: "error",
    });
  }

  const t = await invtDB.transaction();
  let errors = [];

  try {
    let transactionID = await helper.genTransaction("GODOWN_TRANSFER", t);

    let insertDt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");

    for (let i = 0; i < componentLength; i++) {
      const qty = helper.number(req.body.qty[i]);
      if (!qty || qty <= 0) {
        errors.push({
          message: `Quantity should not be less than or equal to zero at row ${i + 1
            }`,
        });
        continue;
      }

      if (!req.body.tolocation[i]) {
        errors.push({
          message: `Invalid drop location at row ${i + 1}`,
        });
        continue;
      }

      const comment =
        req.body.comments[i] && req.body.comments[i].trim() !== ""
          ? req.body.comments[i]
          : "--";

      let stmt1 = await invtDB.query(
        "INSERT INTO `rm_location` (`in_module`,`company_branch`,`trans_type`,`components_id`,`qty`,`loc_in`,`loc_out`,`any_remark`,`insert_date`,`insert_by`,`transfer_transaction_id`,in_po_rate) VALUES ('IN-TRN',:branch,'TRANSFER',:component,:qty,:loc_in,:loc_out,:remark,:insert_date,:insert_by,:transfer_transaction_id, :rate)",
        {
          replacements: {
            branch: req.branch,
            component: req.body.component[i],
            qty: qty,
            loc_in: req.body.tolocation[i],
            loc_out: req.body.fromlocation,
            remark: comment,
            insert_date: insertDt,
            insert_by: req.logedINUser,
            transfer_transaction_id: transactionID,
            rate: req.body.rate[i],
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        }
      );

      // Handle special case for SF to SF999
      if (req.body.tolocation[i] === "1762327049191") {
        await invtDB.query(
          "INSERT INTO sf_rm_inward (company_branch, components_id, qty, loc_in, loc_out, any_remark, insert_date, insert_by, transaction_id) VALUES (:branch, :component, :qty, :loc_in, :loc_out, :remark, :insert_date, :insert_by, :transaction_id)",
          {
            replacements: {
              branch: req.branch,
              component: req.body.component[i],
              qty: qty,
              loc_out: req.body.fromlocation,
              loc_in: req.body.tolocation[i],
              remark: comment,
              insert_date: insertDt,
              insert_by: req.logedINUser,
              transaction_id: transactionID,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: t,
          }
        );
      }

      if (stmt1.length > 0) {
        let stmt2 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE'",
          {
            replacements: { location: req.body.fromlocation },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt2.length === 0) {
          errors.push({
            message: `Invalid pick location at row ${i + 1}`,
          });
          continue;
        }

        let stmt3 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE'",
          {
            replacements: { location: req.body.tolocation[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt3.length === 0) {
          errors.push({
            message: `Invalid drop location at row ${i + 1}`,
          });
          continue;
        }

        let stmt4 = await invtDB.query(
          "SELECT * FROM `components` WHERE `component_key` = :component_key",
          {
            replacements: { component_key: req.body.component[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt4.length === 0) {
          errors.push({
            message: `Invalid component at row ${i + 1}`,
          });
          continue;
        }

        if (stmt4[0].c_is_enabled === "N") {
          errors.push({
            message: `Component part code (${stmt4[0].c_part_no} / ${stmt4[0].c_name
              }) is disabled for transaction at row ${i + 1}`,
          });
          continue;
        }

        if (stmt4[0].c_type === "S") {
          errors.push({
            message: `Component part code (${stmt4[0].c_part_no} / ${stmt4[0].c_name
              }) is a service part at row ${i + 1}`,
          });
          continue;
        }

        // Check inward quantity
        let stmt5 = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER') AND `loc_in` = :location",
          {
            replacements: {
              component: req.body.component[i],
              location: req.body.fromlocation,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        const inwardAllQty =
          stmt5.length > 0 ? helper.number(stmt5[0].Inward) : 0;

        // Check outward quantity
        let stmt6 = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'CONSUMPTION' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER') AND `loc_out` = :location",
          {
            replacements: {
              component: req.body.component[i],
              location: req.body.fromlocation,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        const outwardAllQty =
          stmt6.length > 0 ? helper.number(stmt6[0].Outward) : 0;

        // Validate available quantity
        if (inwardAllQty - outwardAllQty < qty) {
          errors.push({
            message: `Component part code (${stmt4[0].c_part_no} / ${stmt4[0].c_name
              }) has insufficient quantity [${inwardAllQty - outwardAllQty
              }] at location for row ${i + 1}`,
          });
          continue;
        }
      } else {
        errors.push({
          message: `Failed to insert component at row ${i + 1}`,
        });
      }
    }


    // Check if there were any errors
    if (errors.length > 0) {
      await t.rollback();
      return res.json({ success: false, status: "error", message: errors[0].message, });
    }

    await t.commit();
    return res.json({
      success: true,
      status: "success",
      message: `Godown migration from SF to SF completed successfully. Transaction ID: #${transactionID}`,
    });
  } catch (err) {
    await t.rollback();
    return res.json({
      success: false,
      status: "error",
      message: "API Error: Contact system administrator",
      error: err.stack,
    });
  }
});


// FG - FG LOCATION TRANSFER
router.post("/transferFG2FG", [auth.isAuthorized], async (req, res) => {
  const { pickLocation, dropLocation, product, qty, remark } = req.body;

  const validation = new Validator(req.body, {
    pickLocation: "required",
    dropLocation: "required",
    product: "required|array",
    qty: "required|array",
    remark: "required|array",
  });

  if (validation.fails()) {
    return res.json({
      success: false,
      status: "error",
      message: "Missing required fields in form",
      data: validation.errors.all(),
    });
  }

  if (product.length !== qty.length || product.length !== remark.length) {
    return res.json({
      success: false,
      status: "error",
      message: "Product, Qty and Remark length mismatch",
    });
  }

  const duplicate = product.filter((v, i) => product.indexOf(v) !== i);
  if (duplicate.length) {
    return res.json({
      success: false,
      status: "error",
      message: "Duplicate products detected",
    });
  }

  if (pickLocation === dropLocation) {
    return res.json({
      success: false,
      status: "error",
      message: "Pick and drop location cannot be same",
    });
  }

  const fromBranch = req.branch;
  const t = await invtDB.transaction();

  try {
    // Validate locations against current branch
    const pickLoc = await invtDB.query(
      `SELECT 1 FROM location_main
       WHERE location_key = :loc
       AND company_branch = :br
       AND loc_status = 'ACTIVE'`,
      {
        replacements: { loc: pickLocation, br: fromBranch },
        type: invtDB.QueryTypes.SELECT,
        transaction: t,
      }
    );

    if (!pickLoc.length) {
      await t.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "Invalid pick location",
      });
    }

    const dropLoc = await invtDB.query(
      `SELECT 1 FROM location_main
       WHERE location_key = :loc
       AND company_branch = :br
       AND loc_status = 'ACTIVE'`,
      {
        replacements: { loc: dropLocation, br: fromBranch },
        type: invtDB.QueryTypes.SELECT,
        transaction: t,
      }
    );

    if (!dropLoc.length) {
      await t.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "Invalid drop location",
      });
    }

    // Generate transaction ID (reuse GODOWN_TRANSFER series)
    const numbering = await invtDB.query(
      "SELECT * FROM ims_numbering WHERE for_number='GODOWN_TRANSFER' FOR UPDATE",
      { transaction: t, type: invtDB.QueryTypes.SELECT }
    );

    let transactionID;
    if (numbering.length) {
      const n = numbering[0];
      const next = (helper.number(n.suffix) + 1)
        .toString()
        .padStart(helper.number(n.number_length_limit), "0");
      transactionID = `${n.prefix}/${n.session}/${next}`;
    } else {
      const y = new Date().getFullYear().toString().slice(-2);
      transactionID = `FGT/${y}-${+y + 1}/0001`;
    }

    const nowDate = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
    const nowFull = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    for (let i = 0; i < product.length; i++) {
      const transferQty = helper.number(qty[i]);
      // const lineRemark = (remark[i] || "").toString().trim() || "--";
      const lineRemark = remark[i] != null ? String(remark[i]).trim() || "--" : "--";

      if (transferQty <= 0) {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: `Invalid quantity at row ${i + 1}`,
        });
      }

      // Fetch product (for sku)
      const prodRows = await invtDB.query(
        "SELECT * FROM `products` WHERE `product_key` = :key",
        {
          replacements: { key: product[i] },
          type: invtDB.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (!prodRows.length) {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: `Invalid product at row ${i + 1}`,
        });
      }

      const prod = prodRows[0];

      // LOCATION STOCK AT PICK LOCATION (same logic as godownStocksProduct)
      const inStmt = await invtDB.query(
        "SELECT COALESCE(SUM(`mfg_approve_in_qty`), 0) AS `Inward` FROM `mfg_production_3` WHERE `mfg_pro_apr_sku` = :sku AND `type` IN ('IN', 'FGMIN') AND `fg_status` = 'ACTIVE' AND `mfg_pro_location_in` = :location",
        {
          replacements: { sku: prod.p_sku, location: pickLocation },
          type: invtDB.QueryTypes.SELECT,
          transaction: t,
        }
      );

      const outStmt = await invtDB.query(
        "SELECT COALESCE(SUM(`fgout_approve_out_qty`), 0) AS `Outward` FROM `mfg_production_3` WHERE `fgout_pro_apr_sku` = :product_key AND `type` = 'OUT' AND `fg_status` = 'ACTIVE' AND `fgout_pro_location_out` = :location",
        {
          replacements: { product_key: product[i], location: pickLocation },
          type: invtDB.QueryTypes.SELECT,
          transaction: t,
        }
      );

      const inward = inStmt.length ? helper.number(inStmt[0].Inward) : 0;
      const outward = outStmt.length ? helper.number(outStmt[0].Outward) : 0;
      const availableQty = inward - outward;

      if (transferQty > availableQty) {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: `Insufficient FG stock for product ${prod.p_name} (${prod.p_sku}) at pick location. Current Stock [${availableQty}]`,
        });
      }

      // Weighted rate at this moment (for IN entry)
      let fgRate = 0;
      try {
        fgRate = await avgRate.getWeightedSKURate(product[i], nowFull);
      } catch (e) {
        fgRate = 0;
      }

      // OUT from pick location (mfg_production_3 + fg_location) - fg_out_type kept neutral ('--') for pure transfer
      const outInsert = await invtDB.query(
        "INSERT INTO `mfg_production_3` (`company_branch`,`fgout_pro_apr_sku`,`fgout_approve_out_qty`,`fgout_pro_apr_by`,`fgout_pro_apr_date`,`fgout_pro_apr_fulldate`, `fgout_pro_location_out`,`mfg_pro_FGout_transaction`,`type`,`fg_out_type`,`fg_out_remark`)VALUES (:branch,:sku,:aproutqty,:outby,:outdate,:outfulldate, :fgout_pro_location_out,:transactioncode,:type, :fg_out_type,:remark)",
        {
          replacements: {
            branch: fromBranch,
            sku: product[i],
            aproutqty: transferQty,
            outby: req.logedINUser,
            outdate: nowDate,
            outfulldate: nowFull,
            fgout_pro_location_out: pickLocation,
            transactioncode: transactionID,
            type: "OUT",
            fg_out_type: "--",
            remark: lineRemark,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        }
      );

      if (!outInsert.length) {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: `Failed to create FG OUT entry at row ${i + 1}`,
        });
      }

      const fgOutLocInsert = await invtDB.query(
        "INSERT INTO `fg_location` (`fg_type`,`sku_code`, `fg_loc_out`,`qty`,`insert_dt`,`insert_by`,`fg_out_transaction`) VALUES ('OUT',:sku_code, :fg_loc_out,:fg_qty, :fg_insert_dt,:fg_insert_by,:out_id)",
        {
          replacements: {
            sku_code: product[i],
            fg_qty: transferQty,
            fg_loc_out: pickLocation,
            fg_insert_dt: nowFull,
            fg_insert_by: req.logedINUser,
            out_id: transactionID,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        }
      );

      if (!fgOutLocInsert.length) {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: `Failed to create FG OUT location entry at row ${i + 1}`,
        });
      }

      // IN to drop location (mfg_production_3 + fg_location) — store drop in mfg_pro_location_in, pick (source) in fgout_pro_location_out
      const inInsert = await invtDB.query(
        "INSERT INTO `mfg_production_3` (`company_branch`,`mfg_pro_apr_sku`,`mfg_approve_in_qty`,`mfg_pro_apr_by`,`mfg_pro_apr_fulldate`,`mfg_pro_apr_transaction`,`mfg_ref_transid_1`,`mfg_ref_transid_2`,`mfg_pro_location_in`,`fgout_pro_location_out`,`mfgphase2_insert_date`,`type`,`ppr_created_by`,`mfg_created_by`,`in_fg_rate`) VALUES (:branch,:sku, :totalIn, :by, :fulldate, :transaction, :ppr_id, :mfg_id, :loc_in, :fgout_loc_out, :insertdate,'TRANSFER', :pprcreatedby, :mfgcreatedby, :rate)",
        {
          replacements: {
            branch: fromBranch,
            sku: prod.p_sku,
            totalIn: transferQty,
            by: req.logedINUser,
            fulldate: nowFull,
            transaction: transactionID,
            ppr_id: "--",
            mfg_id: "--",
            loc_in: dropLocation,
            fgout_loc_out: pickLocation,
            insertdate: nowFull,
            pprcreatedby: req.logedINUser,
            mfgcreatedby: req.logedINUser,
            rate: fgRate || 0,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        }
      );

      if (!inInsert.length) {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: `Failed to create FG IN entry at row ${i + 1}`,
        });
      }

      const fgInLocInsert = await invtDB.query(
        "INSERT INTO `fg_location` (`fg_type`,`sku_code`,`fg_loc_in`,`qty`,`ppr_id`,`mfg_id`,`fg_in_transaction`,`ppr_created_by`,`mfg_created_by`,`insert_by`,`mfg_created_dt`,`insert_dt`) VALUES ('IN', :sku, :loc_in, :qty, :ppr_id, :mfg_id, :transaction_id, :ppr_created_by, :mfg_created_by, :insert_by, :mfg_created_dt, :insert_dt)",
        {
          replacements: {
            sku: prod.p_sku,
            loc_in: dropLocation,
            qty: transferQty,
            ppr_id: "--",
            mfg_id: "--",
            transaction_id: transactionID,
            ppr_created_by: req.logedINUser,
            mfg_created_by: req.logedINUser,
            insert_by: req.logedINUser,
            mfg_created_dt: nowFull,
            insert_dt: nowFull,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        }
      );

      if (!fgInLocInsert.length) {
        await t.rollback();
        return res.json({
          success: false,
          status: "error",
          message: `Failed to create FG IN location entry at row ${i + 1}`,
        });
      }
    }

    await invtDB.query(
      "UPDATE ims_numbering SET suffix = suffix + 1 WHERE for_number='GODOWN_TRANSFER'",
      { transaction: t }
    );

    await t.commit();

    return res.json({
      success: true,
      status: "success",
      message: `FG to FG godown transfer completed.\nTransaction ID #${transactionID}`,
      data: { transactionID },
    });
  } catch (err) {
    console.error(err);
    await t.rollback();
    return res.json({
      success: false,
      status: "error",
      message:
        "An error occurred while processing your request. Please contact system administrator",
      error: err.message,
    });
  }
});


//INSERT RM - REJ
router.post("/transferRM2REJ", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    fromlocation: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }

  const toFindDublicates = (arry) =>
    arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(req.body.component);
  if (dubliEle.length > 0) {
    return res.json({
      status: "error",
      success: false,
      message: "You have entered the same component twice in a single request.",
    });
  }

  let component_length = req.body.component.length;
  const t = await invtDB.transaction();

  try {
    let transactionID;

    let stmt = await invtDB.query(
      "SELECT * FROM `ims_numbering` WHERE `for_number` = 'GODOWN_TRANSFER' FOR UPDATE",
      { type: invtDB.QueryTypes.SELECT, transaction: t }
    );

    if (stmt.length > 0) {
      var suffix = stmt[0].suffix;
      suffix = helper.number(suffix) + 1;
      suffix = suffix.toString();
      suffix = suffix.padStart(helper.number(stmt[0].number_length_limit), "0");
      transactionID = stmt[0].prefix + "/" + stmt[0].session + "/" + suffix;
    } else {
      let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
      transactionID = "IGA/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");

    for (let i = 0; i < component_length; i++) {
      if (helper.number(req.body.qty[i]) > 0) {
        if (req.body.fromlocation == req.body.tolocation[i]) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "Pick and drop location can't be similar - in row number (" +
              [i + 1] +
              ").",
          });
        }
        let item_validation = new Validator(
          { component: req.body.component[i] },
          { component: "required" }
        );
        if (item_validation.fails()) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Select component first.",
          });
        }

        let qty_validation = new Validator(
          { qty: helper.number(req.body.qty[i]) },
          { qty: "required|min:1" }
        );
        if (qty_validation.fails()) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Quantity should not be less than zero.",
          });
        }

        let to_location_validation = new Validator(
          { tolocation: helper.number(req.body.tolocation[i]) },
          { tolocation: "required" }
        );
        if (to_location_validation.fails()) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Select valid drop location.",
          });
        }

        let stmt1 = await invtDB.query(
          "INSERT INTO `rm_location` (`in_module`,`company_branch`,`trans_type`,`components_id`,`qty`,`loc_in`,`loc_out`,`any_remark`,`insert_date`,`insert_by`,`transfer_transaction_id`)VALUES ('IN-TRN',:branch, 'REJECTION',:component,:qty,:loc_in,:loc_out,:remark,:insert_date,:insert_by,:transfer_transaction_id)",
          {
            replacements: {
              branch: req.branch,
              component: req.body.component[i],
              qty: helper.number(req.body.qty[i]),
              loc_in: req.body.tolocation[i],
              loc_out: req.body.fromlocation,
              remark: (req.body.comment && req.body.comment[i]) ? req.body.comment[i] : "--",
              insert_date: insert_dt,
              insert_by: req.logedINUser,
              transfer_transaction_id: transactionID,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: t,
          }
        );

        if (stmt1.length <= 0) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "An error occurred while executing your request.",
          });
        }

        let stmt2 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
          {
            replacements: { location: req.body.fromlocation },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt2.length <= 0) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Select valid pick location.",
          });
        }

        let stmt3 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
          {
            replacements: { location: req.body.tolocation[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt3.length <= 0) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Select valid drop location.",
          });
        }

        let stmt4 = await invtDB.query(
          "SELECT * FROM `components` WHERE `component_key` = :component_key",
          {
            replacements: { component_key: req.body.component[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        if (stmt4.length <= 0) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Select valid component.",
          });
        }

        if (stmt4[0].c_is_enabled == "N") {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "component part code (" +
              stmt4[0].c_part_no +
              " / " +
              stmt4[0].c_name +
              ") can not be execute bcz it has been disabled for transaction",
          });
        }

        if (stmt4[0].c_type == "S") {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "component part code (" +
              stmt4[0].c_part_no +
              " / " +
              stmt4[0].c_name +
              ") can not be execute bcz it is a service part",
          });
        }

        // ALL INWARD AT LOCATION
        let stmt5 = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :location AND (`trans_type` != 'CONSUMPTION' AND `trans_type` != 'CANCELLED')",
          {
            replacements: {
              component: req.body.component[i],
              location: req.body.fromlocation,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let inward_all_qty = stmt5.length > 0 ? helper.number(stmt5[0].Inward) : 0;

        // ALL OUTWARD AT LOCATION
        let stmt6 = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND `loc_out` = :location AND (`trans_type` != 'CONSUMPTION' OR `trans_type` != 'CANCELLED')",
          {
            replacements: {
              component: req.body.component[i],
              location: req.body.fromlocation,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        let outward_all_qty = stmt6.length > 0 ? helper.number(stmt6[0].Outward) : 0;

        if (inward_all_qty - outward_all_qty < helper.number(req.body.qty[i])) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "Component part code (" +
              stmt4[0].c_part_no +
              " / " +
              stmt4[0].c_name +
              ") can not be execute bcz it has not enough quantity at location",
          });
        }
      }
    }

    // All components processed successfully, now update the numbering and commit
    let stmt7 = await invtDB.query(
      "UPDATE `ims_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'GODOWN_TRANSFER'",
      { type: invtDB.QueryTypes.UPDATE, transaction: t }
    );

    if (stmt7.length > 0) {
      await t.commit();
      return res.json({
        status: "success",
        success: true,
        message:
          "Godown migration from RM to REJ has been successfully completed. Transaction ID: #" +
          transactionID,
      });
    } else {
      await t.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "an operation for updation in transfer ID has failed, while creating transfer..",
      });
    }
  } catch (err) {
    console.log(err);
    await t.rollback();
    return res.json({
      status: "error",
      success: false,
      message: "Internal Error!!! If this condition persists, contact your system administrator",
      debug: process.env.NODE_ENV === "development" ? err.stack : undefined,
    })
  }
});

//INSERT SF - REJ

router.post("/transferSF2REJ", [auth.isAuthorized], async (req, res) => {
  // Validate the request body
  const validation = new Validator(req.body, {
    fromlocation: "required",
    component: "required|array",
    tolocation: "required|array",
    qty: "required|array",
    rate: "required|array",
    comments: "required|array", // Added validation for comments array
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Missing required fields in form.",
      data: validation.errors.all(),
    });
  }

  // Validate that all arrays have the same length
  const componentLength = req.body.component.length;
  if (
    req.body.tolocation.length !== componentLength ||
    req.body.qty.length !== componentLength ||
    req.body.rate.length !== componentLength ||
    req.body.comments.length !== componentLength
  ) {
    return res.json({
      status: "error",
      success: false,
      message:
        "Component, tolocation, qty, rate, and comments arrays must have the same length.",
    });
  }

  // Check for duplicate components
  const toFindDuplicates = (arry) =>
    arry.filter((item, index) => arry.indexOf(item) !== index);
  const duplicateElements = toFindDuplicates(req.body.component);
  if (duplicateElements.length > 0) {
    return res.json({
      status: "error",
      success: false,
      message: "Duplicate components detected in the request.",
    });
  }

  const t = await invtDB.transaction();
  let errors = []; // Array to collect errors for all components

  try {
    // Generate transaction ID
    let transactionID = await helper.genTransaction("GODOWN_TRANSFER", t);

    let insertDt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");

    // Process each component in the loop
    for (let i = 0; i < componentLength; i++) {
      // Validate quantity
      const qty = helper.number(req.body.qty[i]);
      if (!qty || qty <= 0) {
        errors.push({
          msg: `Quantity should not be less than or equal to zero at row ${i + 1
            }`,
        });
        continue; // Skip to next component
      }

      // Validate tolocation
      if (!req.body.tolocation[i]) {
        errors.push({ msg: `Invalid drop location at row ${i + 1}` });
        continue; // Skip to next component
      }

      // Validate that pick and drop locations are not the same
      if (req.body.fromlocation === req.body.tolocation[i]) {
        errors.push({
          msg: `Pick and drop location cannot be the same at row ${i + 1}`,
        });
        continue; // Skip to next component
      }

      // Validate component
      const itemValidation = new Validator(
        { component: req.body.component[i] },
        { component: "required" }
      );
      if (itemValidation.fails()) {
        errors.push({ msg: `Invalid component at row ${i + 1}` });
        continue; // Skip to next component
      }

      // Use individual comment for each component, default to "--" if empty
      const comment =
        req.body.comments[i] && req.body.comments[i].trim() !== ""
          ? req.body.comments[i]
          : "--";

      // Insert into rm_location with individual comment
      let stmt1 = await invtDB.query(
        "INSERT INTO `rm_location` (`in_module`,`company_branch`,`trans_type`,`components_id`,`qty`,`loc_in`,`loc_out`,`any_remark`,`insert_date`,`insert_by`,`transfer_transaction_id`, in_po_rate) VALUES ('IN-TRN',:branch,'TRANSFER',:component,:qty,:loc_in,:loc_out,:remark,:insert_date,:insert_by,:transfer_transaction_id, :rate)",
        {
          replacements: {
            branch: req.branch,
            component: req.body.component[i],
            qty: qty,
            loc_in: req.body.tolocation[i],
            loc_out: req.body.fromlocation,
            remark: comment, // Use individual comment
            insert_date: insertDt,
            insert_by: req.logedINUser,
            transfer_transaction_id: transactionID,
            rate: req.body.rate[i],
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: t,
        }
      );

      if (stmt1.length > 0) {
        // Validate from location
        let stmt2 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE'",
          {
            replacements: { location: req.body.fromlocation },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt2.length === 0) {
          errors.push({ msg: `Invalid pick location at row ${i + 1}` });
          continue;
        }

        // Validate to location
        let stmt3 = await invtDB.query(
          "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE'",
          {
            replacements: { location: req.body.tolocation[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt3.length === 0) {
          errors.push({ msg: `Invalid drop location at row ${i + 1}` });
          continue;
        }

        // Validate component
        let stmt4 = await invtDB.query(
          "SELECT * FROM `components` WHERE `component_key` = :component_key",
          {
            replacements: { component_key: req.body.component[i] },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt4.length === 0) {
          errors.push({ msg: `Invalid component at row ${i + 1}` });
          continue;
        }

        if (stmt4[0].c_is_enabled === "N") {
          errors.push({
            msg: `Component part code (${stmt4[0].c_part_no} / ${stmt4[0].c_name
              }) is disabled for transaction at row ${i + 1}`,
          });
          continue;
        }

        if (stmt4[0].c_type === "S") {
          errors.push({
            msg: `Component part code (${stmt4[0].c_part_no} / ${stmt4[0].c_name
              }) is a service part at row ${i + 1}`,
          });
          continue;
        }

        // Check inward quantity
        let stmt5 = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'INWARD' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER') AND `loc_in` = :location",
          {
            replacements: {
              component: req.body.component[i],
              location: req.body.fromlocation,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        const inwardAllQty =
          stmt5.length > 0 ? helper.number(stmt5[0].Inward) : 0;

        // Check outward quantity
        let stmt6 = await invtDB.query(
          "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` = 'CONSUMPTION' OR `trans_type` = 'ISSUE' OR `trans_type` = 'JOBWORK' OR `trans_type` = 'REJECTION' OR `trans_type` = 'TRANSFER') AND `loc_out` = :location",
          {
            replacements: {
              component: req.body.component[i],
              location: req.body.fromlocation,
            },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        const outwardAllQty =
          stmt6.length > 0 ? helper.number(stmt6[0].Outward) : 0;

        // Validate available quantity
        if (inwardAllQty - outwardAllQty < qty) {
          errors.push({
            msg: `Component part code (${stmt4[0].c_part_no} / ${stmt4[0].c_name
              }) has insufficient quantity [${inwardAllQty - outwardAllQty
              }] at location for row ${i + 1}`,
          });
          continue;
        }
      } else {
        errors.push({ msg: `Failed to insert component at row ${i + 1}` });
      }
    }

    // Check if there were any errors
    if (errors.length > 0) {
      await t.rollback();
      return res.json({ status: "error", success: false, message: errors[0].msg });
    }

    await t.commit();
    return res.json({
      status: "success",
      success: true,
      message: `Godown migration from SF to REJ completed successfully. Transaction ID: #${transactionID}`,
    });
  } catch (err) {
    await t.rollback();
    return res.json({ status: "error", success: false, message: "Something went wrong ! Contact the system administrator" });
  }
});

// SUBMIT TRANSFER REQUEST
router.post("/requestTransfer", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    fromlocation: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }

  let component_length = req.body.component.length;
  const t = await invtDB.transaction();

  try {
    let stmt = await invtDB.query(
      "SELECT `transfer_txn_p_id` FROM `ims_godowntransfer` GROUP BY `transfer_txn_p_id` ORDER BY `ID` DESC LIMIT 1",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );
    let transactionCode;
    if (stmt.length > 0) {
      stmt.map((item) => {
        transactionCode = item.transfer_txn_p_id;
        let strings = transactionCode.replace(/[0-9]/g, "");
        let digits = (
          helper.number(transactionCode.replace(/[^0-9]/g, "")) + 1
        ).toString();
        if (digits.length < 2) digits = ("000" + digits).substr(-3);
        transactionCode = strings + digits;
      });
    } else {
      transactionCode = "GDTR001";
    }

    for (let i = 0; i < component_length; i++) {
      if (helper.number(req.body.qty[i]) > 0) {
        if (req.body.fromlocation == req.body.tolocation[i]) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message:
              "Pick and drop location can't be similar - in row number (" +
              [i + 1] +
              ").",
          });
        }
        let item_validation = new Validator(
          { component: req.body.component[i] },
          { component: "required" }
        );
        if (item_validation.fails()) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Select component first.",
          });
        }

        let qty_validation = new Validator(
          { qty: helper.number(req.body.qty[i]) },
          { qty: "required|min:1" }
        );
        if (qty_validation.fails()) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Quantity should not be less than zero.",
          });
        }

        let to_location_validation = new Validator(
          { tolocation: helper.number(req.body.tolocation[i]) },
          { tolocation: "required" }
        );
        if (to_location_validation.fails()) {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "Select valid drop location.",
          });
        }

        let stmt1 = await invtDB.query(
          "INSERT INTO `ims_godowntransfer` (`company_branch`,`transfer_component`,`transfer_qty`,`transfer_from`,`transfer_to`,`transfer_logs`,`transfer_txn_p_id`,`status`)VALUES (:branch,:component,:qty,:loc_from,:loc_in,:logs,:transaction_id,'P')",
          {
            replacements: {
              branch: req.branch,
              component: req.body.component[i],
              qty: helper.number(req.body.qty[i]),
              loc_from: req.body.fromlocation,
              loc_in: req.body.tolocation[i],
              logs: JSON.stringify({
                create_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
                create_by: req.logedINUser,
                approve_date: "--",
                approve_by: "--",
                create_remark: req.body.comment,
                approve_remark: "--",
                transaction_type: req.body.type,
              }),
              insert_by: req.logedINUser,
              transaction_id: transactionCode,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: t,
          }
        );
        if (stmt1.length > 0) {
          let stmt2 = await invtDB.query(
            "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
            {
              replacements: { location: req.body.fromlocation },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt2.length > 0) {
            let stmt3 = await invtDB.query(
              "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
              {
                replacements: { location: req.body.tolocation[i] },
                type: invtDB.QueryTypes.SELECT,
              }
            );
            if (stmt3.length > 0) {
              let stmt4 = await invtDB.query(
                "SELECT * FROM `components` WHERE `component_key` = :component_key",
                {
                  replacements: { component_key: req.body.component[i] },
                  type: invtDB.QueryTypes.SELECT,
                }
              );
              if (stmt4.length > 0) {
                if (stmt4[0].c_is_enabled == "N") {
                  await t.rollback();
                  return res.json({
                    status: "error",
                    success: false,
                    message:
                      "Component part code (" +
                      stmt4[0].c_part_no +
                      " / " +
                      stmt4[0].c_name +
                      ") can not be execute bcz it has been disabled for transaction",
                  });
                } else if (stmt4[0].c_type == "S") {
                  await t.rollback();
                  return res.json({
                    status: "error",
                    success: false,
                    message:
                      "Component part code (" +
                      stmt4[0].c_part_no +
                      " / " +
                      stmt4[0].c_name +
                      ") can not be execute bcz it is a service part",
                  });
                } else {
                  // ALL INWARD AT LOCATION (RM TO RM)
                  let stmt5 = await invtDB.query(
                    "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :location AND (`trans_type` != 'CONSUMPTION' AND `trans_type` != 'CANCELLED') AND `company_branch` = :branch",
                    {
                      replacements: {
                        component: req.body.component[i],
                        location: req.body.fromlocation,
                        branch: req.branch,
                      },
                      type: invtDB.QueryTypes.SELECT,
                    }
                  );
                  let inward_all_qty;
                  if (stmt5.length > 0) {
                    inward_all_qty = helper.number(stmt5[0].Inward);
                  } else {
                    inward_all_qty = 0;
                  }

                  // ALL OUTWARD AT LOCATION
                  let stmt6 = await invtDB.query(
                    "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND `loc_out` = :location AND (`trans_type` != 'CONSUMPTION' OR `trans_type` != 'CANCELLED') AND `company_branch` = :branch",
                    {
                      replacements: {
                        component: req.body.component[i],
                        location: req.body.fromlocation,
                        branch: req.branch,
                      },
                      type: invtDB.QueryTypes.SELECT,
                    }
                  );
                  let outward_all_qty;
                  if (stmt6.length > 0) {
                    outward_all_qty = helper.number(stmt6[0].Outward);
                  } else {
                    outward_all_qty = 0;
                  }

                  if (
                    inward_all_qty - outward_all_qty >=
                    helper.number(req.body.qty[i])
                  ) {
                    await t.commit();
                    return res.json({
                      status: "success",
                      success: true,
                      message:
                        "Godown migration request from RM to RM has been successfully completed. Transaction ID: #" +
                        transactionCode,
                    });
                  } else {
                    await t.rollback();
                    return res.json({
                      status: "error",
                      success: false,
                      message:
                        "Component part code (" +
                        stmt4[0].c_part_no +
                        " / " +
                        stmt4[0].c_name +
                        ") can not be execute bcz it has not enough quantity at location",
                    });
                  }
                }
              } else {
                await t.rollback();
                return res.json({
                  status: "error",
                  success: false,
                  message: "Select valid component.",
                });
              }
            } else {
              await t.rollback();
              return res.json({
                status: "error",
                success: false,
                message: "Select valid drop location.",
              });
            }
          } else {
            await t.rollback();
            return res.json({
              status: "error",
              success: false,
              message: "Select valid pick location.",
            });
          }
        } else {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "An error occurred while executing your request.",
          });
        }
      }
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH PENDING GODOWN TRANSFER (DATATABLE)
router.post("/fetchPending_tranfers", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.wise;
  const searchValue = req.body.data;

  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }

  try {
    let stmt = [];
    if (searchBy == "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      stmt = await invtDB.query(
        "SELECT `ims_godowntransfer`.*, `admin_login`.`user_name`, `components`.`c_part_no`, `components`.`c_name`, `loc_from`.`loc_name` AS `location_from`, `loc_to`.`loc_name` AS `location_to` FROM `ims_godowntransfer` LEFT JOIN `components` ON `components`.`component_key` = `ims_godowntransfer`.`transfer_component` LEFT JOIN `location_main` AS `loc_from` ON `ims_godowntransfer`.`transfer_from` = `loc_from`.`location_key` LEFT JOIN `location_main` AS `loc_to` ON `ims_godowntransfer`.`transfer_to` = `loc_to`.`location_key` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = JSON_UNQUOTE(JSON_EXTRACT(`ims_godowntransfer`.`transfer_logs`,'$[0].create_by')) WHERE STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(`ims_godowntransfer`.`transfer_logs`,'$[0].create_date')), '%Y-%m-%d') BETWEEN :datefrom AND :dateto AND `ims_godowntransfer`.`status` = 'P' AND `ims_godowntransfer`.`company_branch` = :branch",
        {
          replacements: {
            datefrom: fromdate,
            dateto: todate,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "transactionwise") {
      stmt = await invtDB.query(
        "SELECT `ims_godowntransfer`.*, `admin_login`.`user_name`, `components`.`c_part_no`, `components`.`c_name`, `loc_from`.`loc_name` AS `location_from`, `loc_to`.`loc_name` AS `location_to` FROM `ims_godowntransfer` LEFT JOIN `components` ON `components`.`component_key` = `ims_godowntransfer`.`transfer_component` LEFT JOIN `location_main` AS `loc_from` ON `ims_godowntransfer`.`transfer_from` = `loc_from`.`location_key` LEFT JOIN `location_main` AS `loc_to` ON `ims_godowntransfer`.`transfer_to` = `loc_to`.`location_key` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = JSON_UNQUOTE(JSON_EXTRACT(`ims_godowntransfer`.`transfer_logs`,'$[0].create_by')) WHERE `ims_godowntransfer`.`transfer_txn_p_id` LIKE CONCAT('%', :transactioncode, '%') AND `ims_godowntransfer`.`status` = 'P' AND `ims_godowntransfer`.`company_branch` = :branch",
        {
          replacements: {
            transactioncode: searchValue,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (searchBy == "locationwise") {
      stmt = await invtDB.query(
        "SELECT `ims_godowntransfer`.*, `admin_login`.`user_name`, `components`.`c_part_no`, `components`.`c_name`, `loc_from`.`loc_name` AS `location_from`, `loc_to`.`loc_name` AS `location_to` FROM `ims_godowntransfer` LEFT JOIN `components` ON `components`.`component_key` = `ims_godowntransfer`.`transfer_component` LEFT JOIN `location_main` AS `loc_from` ON `ims_godowntransfer`.`transfer_from` = `loc_from`.`location_key` LEFT JOIN `location_main` AS `loc_to` ON `ims_godowntransfer`.`transfer_to` = `loc_to`.`location_key` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = JSON_UNQUOTE(JSON_EXTRACT(`ims_godowntransfer`.`transfer_logs`,'$[0].create_by')) WHERE `ims_godowntransfer`.`transfer_to` = :inlocation AND `ims_godowntransfer`.`status` = 'P' AND `ims_godowntransfer`.`company_branch` = :branch",
        {
          replacements: {
            inlocation: searchValue,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "Please select valid filter method.",
      });
      return;
    }

    if (stmt.length > 0) {
      let finalResult = [];
      stmt.forEach((element) => {
        let jsonData_log = JSON.parse(element.transfer_logs);
        finalResult.push({
          insert_date: moment(jsonData_log.create_date)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY hh:mm:ss"),
          transaction_id: element.transfer_txn_p_id,
          component_name: element.c_name,
          request_qty: helper.number(element.transfer_qty),
          required_qty: helper.number(element.approved_qty),
          transfer_from: element.location_from,
          transfer_to: element.location_to,
          component_part: element.c_part_no,
          request_by: element.user_name,
        });
      });

      if (stmt.length == finalResult.length) {
        return res.json({
          status: "success",
          success: true,
          data: finalResult,
        });
        return;
      }
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No data found.",
      });
      return;
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//FETCH PENDING GODOWN TRANSFER (MODAL)
router.post(
  "/fetchTransactionForApproval",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      transaction: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "Something you missing in form field to supply.",
        data: validation.errors.all(),
      });
    }
    try {
      let stmt1 = await invtDB.query(
        "SELECT `ims_godowntransfer`.*, `admin_login`.`user_name`, `components`.`c_part_no`, `components`.`c_name`, `loc_from`.`loc_name` AS `location_from`, `loc_to`.`loc_name` AS `location_to` FROM `ims_godowntransfer` LEFT JOIN `components` ON `components`.`component_key` = `ims_godowntransfer`.`transfer_component` LEFT JOIN `location_main` AS `loc_from` ON `ims_godowntransfer`.`transfer_from` = `loc_from`.`location_key` LEFT JOIN `location_main` AS `loc_to` ON `ims_godowntransfer`.`transfer_to` = `loc_to`.`location_key` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = JSON_UNQUOTE(JSON_EXTRACT(`ims_godowntransfer`.`transfer_logs`,'$[0].create_by')) WHERE `ims_godowntransfer`.`transfer_txn_p_id` = :transactioncode AND `ims_godowntransfer`.`status` = 'P' AND `company_branch` = :branch",
        {
          replacements: {
            transactioncode: req.body.transaction,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt1.length > 0) {
        let finalResult = [];
        stmt1.forEach((element) => {
          let jsonData_log = JSON.parse(element.transfer_logs);
          finalResult.push({
            transaction_id: element.transfer_txn_p_id,
            c_name: element.c_name,
            request_qty: helper.number(element.transfer_qty),
            required_qty: helper.number(element.approved_qty),
            c_part: element.c_part_no,
          });
        });

        if (stmt1.length == finalResult.length) {
          return res.json({
            status: "success",
            success: true,
            data: finalResult,
          });
          return;
        }
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "No transaction found.",
        });
      }
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

//APPROVE THE GODOWN TRANSFER
router.post("/ApproveTransfer", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    qty: "required|integer|min:1",
    transaction: "required",
  });
  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "Something you missing in form field to supply.",
      data: validation.errors.all(),
    });
  }

  const t = await invtDB.transaction();

  try {
    let stmt = await invtDB.query(
      "SELECT * FROM `ims_godowntransfer` WHERE `transfer_txn_p_id` = :transactioncode AND `status` = 'P' AND `company_branch` = :branch",
      {
        replacements: {
          transactioncode: req.body.transaction,
          branch: req.branch,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let jsonData_log = JSON.parse(stmt[0].transfer_logs);
      let transaction_type, transaction_label;

      if (jsonData_log.transaction_type == "RM2RM") {
        transaction_label = "RM to RM";
        transaction_type = "TRANSFER";
      } else if (jsonData_log.transaction_type == "SF2SF") {
        transaction_label = "SF to SF";
        transaction_type = "TRANSFER";
      } else if (jsonData_log.transaction_type == "RM2REJ") {
        transaction_label = "RM to REF";
        transaction_type = "REJECTION";
      } else if (jsonData_log.transaction_type == "SF2REJ") {
        transaction_label = "SF to REJ";
        transaction_type = "TRANSFER";
      } else {
        return json.res({
          message: "transaction transfer type was not valid",
          status: "error",
          success: false,
        });
      }

      let transactionID = await helper.genTransaction("GODOWN_TRANSFER", t);

      if (stmt[0].status == "C") {
        await t.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Transaction on this request has been marked as closed.",
        });
      }
      if (
        helper.number(stmt[0].transfer_qty) ==
        helper.number(stmt[0].approved_qty) ||
        stmt[0].status == "D"
      ) {
        await t.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "There is no quantity left to approve.",
        });
      }

      if (
        helper.number(stmt[0].transfer_qty) >=
        helper.number(req.body.qty) + helper.number(stmt[0].approved_qty)
      ) {
        let stmt2 = await invtDB.query(
          "INSERT INTO `rm_location` (`in_module`,`company_branch`, `trans_type`,`components_id`,`qty`,`loc_in`,`loc_out`,`any_remark`,`insert_date`,`insert_by`,`transfer_transaction_id`)VALUES ('IN-TRN',:branch,:type,:component,:qty,:loc_in,:loc_out,:remark,:insert_date,:insert_by,:transfer_transaction_id)",
          {
            replacements: {
              branch: req.branch,
              type: transaction_type,
              component: stmt[0].transfer_component,
              qty: helper.number(req.body.qty),
              loc_in: stmt[0].transfer_to,
              loc_out: stmt[0].transfer_from,
              remark:
                jsonData_log.create_remark == ""
                  ? "--"
                  : jsonData_log.create_remark,
              insert_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
              insert_by: req.logedINUser,
              transfer_transaction_id: transactionID,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: t,
          }
        );
        if (stmt2.length > 0) {
          let stmt3 = await invtDB.query(
            "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
            {
              replacements: { location: stmt[0].transfer_from },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt3.length > 0) {
            let stmt4 = await invtDB.query(
              "SELECT * FROM `location_main` WHERE `location_key` = :location AND loc_status = 'ACTIVE' ",
              {
                replacements: { location: stmt[0].transfer_to },
                type: invtDB.QueryTypes.SELECT,
              }
            );
            if (stmt4.length > 0) {
              let stmt5 = await invtDB.query(
                "SELECT * FROM `components` WHERE `component_key` = :component_key",
                {
                  replacements: { component_key: stmt[0].transfer_component },
                  type: invtDB.QueryTypes.SELECT,
                }
              );
              if (stmt5.length > 0) {
                if (stmt5[0].c_is_enabled == "N") {
                  await t.rollback();
                  return res.json({
                    status: "error",
                    success: false,
                    message:
                      "Component part code (" +
                      stmt5[0].c_part_no +
                      " / " +
                      stmt5[0].c_name +
                      ") can not be execute bcz it has been disabled for transaction",
                  });
                } else if (stmt5[0].c_type == "S") {
                  await t.rollback();
                  return res.json({
                    status: "error",
                    success: false,
                    message:
                      "Component part code (" +
                      stmt5[0].c_part_no +
                      " / " +
                      stmt5[0].c_name +
                      ") can not be execute bcz it is a service part",
                  });
                } else {
                  // ALL INWARD AT LOCATION
                  let stmt6 = await invtDB.query(
                    "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :location AND (`trans_type` != 'CONSUMPTION' AND `trans_type` != 'CANCELLED') AND `company_branch` = :branch",
                    {
                      replacements: {
                        component: stmt[0].transfer_component,
                        location: stmt[0].transfer_from,
                        branch: req.branch,
                      },
                      type: invtDB.QueryTypes.SELECT,
                    }
                  );
                  let inward_all_qty;
                  if (stmt6.length > 0) {
                    inward_all_qty = helper.number(stmt6[0].Inward);
                  } else {
                    inward_all_qty = 0;
                  }

                  // ALL OUTWARD AT LOCATION
                  let stmt7 = await invtDB.query(
                    "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND `loc_out` = :location AND (`trans_type` != 'CONSUMPTION' OR `trans_type` != 'CANCELLED') AND `company_branch` = :branch",
                    {
                      replacements: {
                        component: stmt[0].transfer_component,
                        location: stmt[0].transfer_from,
                        branch: req.branch,
                      },
                      type: invtDB.QueryTypes.SELECT,
                    }
                  );
                  let outward_all_qty;
                  if (stmt7.length > 0) {
                    outward_all_qty = helper.number(stmt7[0].Outward);
                  } else {
                    outward_all_qty = 0;
                  }

                  let current_status;
                  if (
                    helper.number(req.body.qty) +
                    helper.number(stmt[0].approved_qty) ==
                    helper.number(stmt[0].transfer_qty)
                  ) {
                    current_status = "D";
                  } else {
                    current_status = "P";
                  }

                  if (
                    inward_all_qty - outward_all_qty >=
                    helper.number(req.body.qty)
                  ) {
                    let stmt7 = await invtDB.query(
                      "UPDATE `ims_godowntransfer` SET `approved_qty` = `approved_qty`+" +
                      helper.number(req.body.qty) +
                      ", `status` = :status WHERE `transfer_txn_p_id`= :transaction_old AND `company_branch` = :branch",
                      {
                        replacements: {
                          transaction_old: stmt[0].transfer_txn_p_id,
                          status: current_status,
                          branch: req.branch,
                        },
                        type: invtDB.QueryTypes.UPDATE,
                        transaction: t,
                      }
                    );
                    if (stmt7.length > 0) {
                      let stmt8 = await invtDB.query(
                        "INSERT INTO `ims_godowntransfer_logs` (`req_trans_id`, `approve_qty`, `approve_trans_id`, `approve_by`,  `approve_dt`) VALUES(:transaction_old, :qty, :transaction_new, :insert_by, :insert_dt)",
                        {
                          replacements: {
                            transaction_new: transactionID,
                            transaction_old: stmt[0].transfer_txn_p_id,
                            qty: helper.number(req.body.qty),
                            insert_by: req.logedINUser,
                            insert_dt: moment(new Date()).format(
                              "YYYY-MM-DD HH:mm:ss"
                            ),
                          },
                          type: invtDB.QueryTypes.INSERT,
                          transaction: t,
                        }
                      );
                      if (stmt8.length > 0) {
                        await t.commit();
                        return res.json({
                          status: "success",
                          success: true,
                          message:
                            "Godown migration from " +
                            transaction_label +
                            " has been successfully completed..<br/>transaction ID: #" +
                            transactionID,
                          data: {
                            executed_qty:
                              helper.number(req.body.qty) +
                              helper.number(stmt[0].approved_qty),
                          },
                        });
                      } else {
                        await t.rollback();
                        return res.json({
                          status: "error",
                          success: false,
                          message:
                            "An operation for saving logs for transfer has failed.",
                        });
                      }
                    } else {
                      await t.rollback();
                      return res.json({
                        status: "error",
                        success: false,
                        message:
                          "An operation for saving logs for transfer has failed.",
                      });
                    }
                  } else {
                    await t.rollback();
                    return res.json({
                      status: "error",
                      success: false,
                      message:
                        "component part code (" +
                        stmt5[0].c_part_no +
                        " / " +
                        stmt5[0].c_name +
                        ") can not be execute bcz it has not enough quantity at location",
                    });
                  }
                }
              } else {
                await t.rollback();
                return res.json({
                  status: "error",
                  success: false,
                  message: "Valid component was not provided.",
                });
              }
            } else {
              await t.rollback();
              return res.json({
                status: "error",
                success: false,
                message: "Valid drop location was not provided.",
              });
            }
          } else {
            await t.rollback();
            return res.json({
              status: "error",
              success: false,
              message: "Valid pick location was not provided.",
            });
          }
        } else {
          await t.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "An error occurred while executing your request.",
          });
        }
      } else {
        await t.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Receiving qty must be less than transfer qty.",
        });
      }
    } else {
      await t.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "No transaction found.",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;

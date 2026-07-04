var express = require("express");
var router = express.Router();
var html_to_pdf = require("html-pdf-node");

const Validator = require("validatorjs");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const { invtDB } = require("../../../config/db/connection");

router.post("/", [auth.isAuthorized], async (req, res) => {
	let validation = new Validator(req.body, {
		poid: "required",
	});
	try {
		let checkApprovalSatatus=await invtDB.query(
			"SELECT approval_status From po_purchase_req WHERE po_transaction =:poid",{
				replacements:{poid:req.body.poid},
				type:invtDB.QueryTypes.SELECT
			}
		);
		let approvalStatus=checkApprovalSatatus[0].approval_status;
			if (approvalStatus !== 'A') {
			let statusMessage = "";
			switch(approvalStatus) {
				case 'P':
					statusMessage = "PDF download not allowed. Purchase Order is pending approval.";
					break;
				case 'D':
					statusMessage = "PDF download not allowed. Purchase Order is in draft status.";
					break;
				case 'R':
					statusMessage = "PDF download not allowed. Purchase Order has been rejected.";
					break;
				default:
					statusMessage = "PDF download not allowed. Purchase Order is not approved.";
			}
			
			return res.json({ status: "error", success: false, message: statusMessage });
		}

		let file = { url: `${process.env.API_URL}/helper/PRINT/PHP/PO/alwar-printReceipt.php?invoice=${Buffer.from(req.body.poid).toString("base64")}` };
		let options = { format: "A4" };
		await html_to_pdf
			.generatePdf(file, options)
			.then((pdfBuffer) => {
				let filename = req.body.poid.replace(/[/]/g, "_") + ".pdf";
				return res.json({ status: "success", success: true, message: "file generated successfully...", data: { buffer: pdfBuffer, filename: filename } });
			})
			.catch((err) => {
				return res.json({ status: "error", success: false, message: "error while generating file...", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
			});
	} catch (err) {
	    return helper.errorResponse(res, err);
	}
});

module.exports = router;

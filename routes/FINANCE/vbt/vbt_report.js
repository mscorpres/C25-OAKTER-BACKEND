const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");
const htmlToPdf = require("html-pdf-node");

// Fetch VBT REPORT
router.post("/vbt_report", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    wise: "required",
    data: "required",
    vbt_type: "required",
  });

  if (validation.fails()) {
    return res.json({ message: validation.errors.all(), status: "error", success: false });
  }

  try {
    let main_stmt;
    let { wise, data } = req.body;

    if (wise == "effectivewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      if (req.body.vbt_type == "ALL") {
        main_stmt = await tallyDB.query(
          `SELECT tally_vbt.*, DATE_FORMAT(tally_vbt.insert_date,'%d-%m-%Y') AS insert_date, ven_basic_detail.ven_name, components.c_name,components.c_part_no, gl.ladger_name AS gl_name, COALESCE(cgst_join.ladger_name, '--') AS cgst_gl_name, COALESCE(sgst_join.ladger_name, '--') AS sgst_gl_name, COALESCE(igst_join.ladger_name, '--') AS igst_join_name, COALESCE(tds_join.ladger_name, '--') AS tds_join_name,  po_table.payment_terms_day , adminTableInsert.user_name AS insertBy , adminTableUpdate.user_name AS updateBy , adminTableVerify.user_name AS verifiedBy FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code = ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code = ${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code = gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code = fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl = cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl = sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl = igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl = tds_join.ledger_key LEFT JOIN ${global.ims_db_name}.po_purchase_req po_table ON po_table.po_transaction = tally_vbt.po_number AND po_table.po_part_no = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableInsert ON adminTableInsert.CustID = tally_vbt.insert_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableUpdate ON adminTableUpdate.CustID = tally_vbt.update_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableVerify ON adminTableVerify.CustID = tally_vbt.verifiedBy WHERE (DATE_FORMAT(tally_vbt.effective_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND tally_vbt.vbt_status != 'DE' ORDER BY tally_vbt.effective_date DESC`,
          {
            replacements: { date1: date1, date2: date2 },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      } else {
        main_stmt = await tallyDB.query(
          `SELECT tally_vbt.*, DATE_FORMAT(tally_vbt.insert_date,'%d-%m-%Y') AS insert_date, ven_basic_detail.ven_name, components.c_name,components.c_part_no, gl.ladger_name AS gl_name, COALESCE(cgst_join.ladger_name, '--') AS cgst_gl_name, COALESCE(sgst_join.ladger_name, '--') AS sgst_gl_name, COALESCE(igst_join.ladger_name, '--') AS igst_join_name, COALESCE(tds_join.ladger_name, '--') AS tds_join_name,  po_table.payment_terms_day , adminTableInsert.user_name AS insertBy , adminTableUpdate.user_name AS updateBy , adminTableVerify.user_name AS verifiedBy FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code = ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code = ${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code = gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code = fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl = cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl = sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl = igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl = tds_join.ledger_key LEFT JOIN ${global.ims_db_name}.po_purchase_req po_table ON po_table.po_transaction = tally_vbt.po_number AND po_table.po_part_no = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableInsert ON adminTableInsert.CustID = tally_vbt.insert_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableUpdate ON adminTableUpdate.CustID = tally_vbt.update_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableVerify ON adminTableVerify.CustID = tally_vbt.verifiedBy WHERE (DATE_FORMAT(tally_vbt.effective_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND tally_vbt.vbt_type = :vbt_type AND tally_vbt.vbt_status != 'DE' ORDER BY tally_vbt.effective_date DESC`,
          {
            replacements: { date1: date1, date2: date2, vbt_type: req.body.vbt_type },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      }
    } else if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      if (req.body.vbt_type == "ALL") {
        main_stmt = await tallyDB.query(
          `SELECT tally_vbt.*, DATE_FORMAT(tally_vbt.insert_date,'%d-%m-%Y') AS insert_date, ven_basic_detail.ven_name, components.c_name,components.c_part_no, gl.ladger_name AS gl_name, COALESCE(cgst_join.ladger_name, '--') AS cgst_gl_name, COALESCE(sgst_join.ladger_name, '--') AS sgst_gl_name, COALESCE(igst_join.ladger_name, '--') AS igst_join_name, COALESCE(tds_join.ladger_name, '--') AS tds_join_name, po_table.payment_terms_day , adminTableInsert.user_name AS insertBy , adminTableUpdate.user_name AS updateBy , adminTableVerify.user_name AS verifiedBy FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code = ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code = ${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code = gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code = fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl = cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl = sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl = igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl = tds_join.ledger_key LEFT JOIN ${global.ims_db_name}.po_purchase_req po_table ON po_table.po_transaction = tally_vbt.po_number AND po_table.po_part_no = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableInsert ON adminTableInsert.CustID = tally_vbt.insert_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableUpdate ON adminTableUpdate.CustID = tally_vbt.update_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableVerify ON adminTableVerify.CustID = tally_vbt.verifiedBy WHERE (DATE_FORMAT(tally_vbt.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND tally_vbt.vbt_status != 'DE' ORDER BY tally_vbt.effective_date DESC`,
          {
            replacements: { date1: date1, date2: date2 },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      } else {
        main_stmt = await tallyDB.query(
          `SELECT tally_vbt.*, DATE_FORMAT(tally_vbt.insert_date,'%d-%m-%Y') AS insert_date, ven_basic_detail.ven_name, components.c_name,components.c_part_no, gl.ladger_name AS gl_name, COALESCE(cgst_join.ladger_name, '--') AS cgst_gl_name, COALESCE(sgst_join.ladger_name, '--') AS sgst_gl_name, COALESCE(igst_join.ladger_name, '--') AS igst_join_name, COALESCE(tds_join.ladger_name, '--') AS tds_join_name,  po_table.payment_terms_day , adminTableInsert.user_name AS insertBy , adminTableUpdate.user_name AS updateBy , adminTableVerify.user_name AS verifiedBy FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code = ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code = ${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code = gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code = fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl = cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl = sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl = igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl = tds_join.ledger_key LEFT JOIN ${global.ims_db_name}.po_purchase_req po_table ON po_table.po_transaction = tally_vbt.po_number AND po_table.po_part_no = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableInsert ON adminTableInsert.CustID = tally_vbt.insert_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableUpdate ON adminTableUpdate.CustID = tally_vbt.update_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableVerify ON adminTableVerify.CustID = tally_vbt.verifiedBy WHERE (DATE_FORMAT(tally_vbt.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND tally_vbt.vbt_type = :vbt_type AND tally_vbt.vbt_status != 'DE' ORDER BY tally_vbt.effective_date DESC`,
          {
            replacements: { date1: date1, date2: date2, vbt_type: req.body.vbt_type },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      }
    } else if (wise == "vendorwise") {
      if (req.body.vbt_type == "ALL") {
        main_stmt = await tallyDB.query(
          `SELECT tally_vbt.*, DATE_FORMAT(tally_vbt.insert_date,'%d-%m-%Y') AS insert_date, ven_basic_detail.ven_name, components.c_name,components.c_part_no, gl.ladger_name AS gl_name, COALESCE(cgst_join.ladger_name, '--') AS cgst_gl_name, COALESCE(sgst_join.ladger_name, '--') AS sgst_gl_name, COALESCE(igst_join.ladger_name, '--') AS igst_join_name, COALESCE(tds_join.ladger_name, '--') AS tds_join_name,  po_table.payment_terms_day , adminTableInsert.user_name AS insertBy , adminTableUpdate.user_name AS updateBy , adminTableVerify.user_name AS verifiedBy FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code = ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code = ${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code = gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code = fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl = cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl = sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl = igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl = tds_join.ledger_key LEFT JOIN ${global.ims_db_name}.po_purchase_req po_table ON po_table.po_transaction = tally_vbt.po_number AND po_table.po_part_no = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableInsert ON adminTableInsert.CustID = tally_vbt.insert_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableUpdate ON adminTableUpdate.CustID = tally_vbt.update_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableVerify ON adminTableVerify.CustID = tally_vbt.verifiedBy WHERE tally_vbt.ven_code = :venid AND tally_vbt.vbt_status != 'DE' ORDER BY tally_vbt.effective_date DESC `,
          {
            replacements: { venid: data },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      } else {
        main_stmt = await tallyDB.query(
          `SELECT tally_vbt.*, DATE_FORMAT(tally_vbt.insert_date,'%d-%m-%Y') AS insert_date, ven_basic_detail.ven_name, components.c_name,components.c_part_no, gl.ladger_name AS gl_name, COALESCE(cgst_join.ladger_name, '--') AS cgst_gl_name, COALESCE(sgst_join.ladger_name, '--') AS sgst_gl_name, COALESCE(igst_join.ladger_name, '--') AS igst_join_name, COALESCE(tds_join.ladger_name, '--') AS tds_join_name,  po_table.payment_terms_day , adminTableInsert.user_name AS insertBy , adminTableUpdate.user_name AS updateBy , adminTableVerify.user_name AS verifiedBy FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code = ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code = ${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code = gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code = fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl = cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl = sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl = igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl = tds_join.ledger_key LEFT JOIN ${global.ims_db_name}.po_purchase_req po_table ON po_table.po_transaction = tally_vbt.po_number AND po_table.po_part_no = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableInsert ON adminTableInsert.CustID = tally_vbt.insert_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableUpdate ON adminTableUpdate.CustID = tally_vbt.update_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableVerify ON adminTableVerify.CustID = tally_vbt.verifiedBy WHERE tally_vbt.ven_code = :venid AND  tally_vbt.vbt_type = :vbt_type AND tally_vbt.vbt_status != 'DE' ORDER BY tally_vbt.effective_date DESC `,
          {
            replacements: { venid: data, vbt_type: req.body.vbt_type },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      }
    } else if (wise == "minwise") {
      if (req.body.vbt_type == "ALL") {
        main_stmt = await tallyDB.query(
          `SELECT tally_vbt.*,DATE_FORMAT( tally_vbt.insert_date, '%d-%m-%Y') AS insert_date, ven_basic_detail.ven_name, components.c_name, components.c_part_no, gl.ladger_name AS gl_name, COALESCE(cgst_join.ladger_name, '--') AS cgst_gl_name, COALESCE(sgst_join.ladger_name, '--') AS sgst_gl_name, COALESCE(igst_join.ladger_name, '--') AS igst_join_name, COALESCE(tds_join.ladger_name, '--') AS tds_join_name, po_table.payment_terms_day , adminTableInsert.user_name AS insertBy , adminTableUpdate.user_name AS updateBy , adminTableVerify.user_name AS verifiedBy FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code = ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code = ${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code = gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code = fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl = cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl = sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl = igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl = tds_join.ledger_key LEFT JOIN ${global.ims_db_name}.po_purchase_req po_table ON po_table.po_transaction = tally_vbt.po_number AND po_table.po_part_no = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableInsert ON adminTableInsert.CustID = tally_vbt.insert_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableUpdate ON adminTableUpdate.CustID = tally_vbt.update_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableVerify ON adminTableVerify.CustID = tally_vbt.verifiedBy WHERE tally_vbt.min_id = :minno AND tally_vbt.vbt_status != 'DE' ORDER BY tally_vbt.effective_date DESC `,
          {
            replacements: { minno: data },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      } else {
        main_stmt = await tallyDB.query(
          `SELECT tally_vbt.*,DATE_FORMAT( tally_vbt.insert_date, '%d-%m-%Y') AS insert_date, ven_basic_detail.ven_name, components.c_name, components.c_part_no, gl.ladger_name AS gl_name, COALESCE(cgst_join.ladger_name, '--') AS cgst_gl_name, COALESCE(sgst_join.ladger_name, '--') AS sgst_gl_name, COALESCE(igst_join.ladger_name, '--') AS igst_join_name, COALESCE(tds_join.ladger_name, '--') AS tds_join_name, po_table.payment_terms_day , adminTableInsert.user_name AS insertBy , adminTableUpdate.user_name AS updateBy , adminTableVerify.user_name AS verifiedBy FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code = ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code = ${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code = gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code = fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl = cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl = sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl = igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl = tds_join.ledger_key LEFT JOIN ${global.ims_db_name}.po_purchase_req po_table ON po_table.po_transaction = tally_vbt.po_number AND po_table.po_part_no = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableInsert ON adminTableInsert.CustID = tally_vbt.insert_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableUpdate ON adminTableUpdate.CustID = tally_vbt.update_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableVerify ON adminTableVerify.CustID = tally_vbt.verifiedBy WHERE tally_vbt.min_id = :minno AND tally_vbt.vbt_type = :vbt_type AND tally_vbt.vbt_status != 'DE' ORDER BY tally_vbt.effective_date DESC`,
          {
            replacements: { minno: data, vbt_type: req.body.vbt_type },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      }
    } else if (wise == "vbtwise") {
      if (req.body.vbt_type == "ALL") {
        main_stmt = await tallyDB.query(
          `SELECT tally_vbt.*, DATE_FORMAT(tally_vbt.insert_date,'%d-%m-%Y') AS insert_date, ven_basic_detail.ven_name, components.c_name,components.c_part_no, gl.ladger_name AS gl_name, COALESCE(cgst_join.ladger_name, '--') AS cgst_gl_name, COALESCE(sgst_join.ladger_name, '--') AS sgst_gl_name, COALESCE(igst_join.ladger_name, '--') AS igst_join_name, COALESCE(tds_join.ladger_name, '--') AS tds_join_name,  po_table.payment_terms_day , adminTableInsert.user_name AS insertBy , adminTableUpdate.user_name AS updateBy , adminTableVerify.user_name AS verifiedBy FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code = ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code = ${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code = gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code = fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl = cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl = sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl = igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl = tds_join.ledger_key LEFT JOIN ${global.ims_db_name}.po_purchase_req po_table ON po_table.po_transaction = tally_vbt.po_number AND po_table.po_part_no = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableInsert ON adminTableInsert.CustID = tally_vbt.insert_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableUpdate ON adminTableUpdate.CustID = tally_vbt.update_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableVerify ON adminTableVerify.CustID = tally_vbt.verifiedBy WHERE tally_vbt.vbt_key = :vbtno AND tally_vbt.vbt_status != 'DE' ORDER BY tally_vbt.effective_date DESC`,
          {
            replacements: { vbtno: data },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      } else {
        main_stmt = await tallyDB.query(
          `SELECT tally_vbt.*, DATE_FORMAT(tally_vbt.insert_date,'%d-%m-%Y') AS insert_date, ven_basic_detail.ven_name, components.c_name,components.c_part_no, gl.ladger_name AS gl_name, COALESCE(cgst_join.ladger_name, '--') AS cgst_gl_name, COALESCE(sgst_join.ladger_name, '--') AS sgst_gl_name, COALESCE(igst_join.ladger_name, '--') AS igst_join_name, COALESCE(tds_join.ladger_name, '--') AS tds_join_name,  po_table.payment_terms_day , adminTableInsert.user_name AS insertBy , adminTableUpdate.user_name AS updateBy , adminTableVerify.user_name AS verifiedBy FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code = ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code = ${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code = gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code = fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl = cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl = sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl = igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl = tds_join.ledger_key LEFT JOIN ${global.ims_db_name}.po_purchase_req po_table ON po_table.po_transaction = tally_vbt.po_number AND po_table.po_part_no = tally_vbt.part_code LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableInsert ON adminTableInsert.CustID = tally_vbt.insert_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableUpdate ON adminTableUpdate.CustID = tally_vbt.update_by LEFT JOIN ${global.ims_db_name}.admin_login AS adminTableVerify ON adminTableVerify.CustID = tally_vbt.verifiedBy WHERE tally_vbt.vbt_key = :vbtno AND tally_vbt.vbt_type = :vbt_type AND tally_vbt.vbt_status != 'DE' ORDER BY tally_vbt.effective_date DESC`,
          {
            replacements: { vbtno: data, vbt_type: req.body.vbt_type },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      }
    } else {
      return res.json({ status: "error", success: false, message: "Please select valid filter method" });
    }

    if (main_stmt.length > 0) {
      let final = [];

      for (let i = 0; i < main_stmt.length; i++) {
        final.push({
          po_id: main_stmt[i].po_number,
          project_name: main_stmt[i].project_id,
          vbt_code: main_stmt[i].vbt_key,
          min_id: main_stmt[i].min_id,
          status: main_stmt[i].vbt_status,
          type: main_stmt[i].vbt_type,
          invoice_no: main_stmt[i].vbt_invoice_no,
          vendor: main_stmt[i].ven_name,
          ven_code: main_stmt[i].ven_code,
          part: main_stmt[i].c_name,
          part_code: main_stmt[i].c_part_no,
          act_qty: main_stmt[i].vbt_bill_qty,
          rate: main_stmt[i].vbt_inrate,
          taxable_value: main_stmt[i].vbt_taxable_value,
          cgst: main_stmt[i].vbt_cgst,
          sgst: main_stmt[i].vbt_sgst,
          igst: main_stmt[i].vbt_igst,
          custum: main_stmt[i].custom_duty,
          freight: main_stmt[i].freight,
          ven_bill_amm: main_stmt[i].vbt_ven_ammount,
          vbt_gl: main_stmt[i].gl_name,
          cgst_gl: main_stmt[i].cgst_gl_name,
          sgst_gl: main_stmt[i].sgst_gl_name,
          igst_gl: main_stmt[i].igst_join_name,
          tds_gl: main_stmt[i].tds_join_name,
          tds_amm: main_stmt[i].vbt_tds_amount,
          invoice_dt: main_stmt[i].vbt_invoice_date,
          eff_date: moment(main_stmt[i].effective_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
          due_dt: moment(main_stmt[i].effective_date, "YYYY-MM-DD").add(main_stmt[i].payment_terms_day, "days").format("DD-MM-YYYY"),
          days: main_stmt[i].payment_terms_day,
          insertBy: main_stmt[i].insertBy,
          insertedAt: main_stmt[i].insert_date,
          isVerified: main_stmt[i].verificationStatus,
          verifiedBy: main_stmt[i].verifiedBy ?? "--",
          verifiedAt: main_stmt[i].verifiedAt ? moment(main_stmt[i].verifiedAt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY") : "--",
          updatedBy: main_stmt[i].updateBy ?? "--",
          updatedAt: main_stmt[i].update_date != "--" ? moment(main_stmt[i].update_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY") : "--",
        });
      }
      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

router.post("/vbt_report_data", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    vbt_key: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.errors.fails() });
  }

  try {
    let stmt = await tallyDB.query(
      `SELECT tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name , COALESCE(freight_join.ladger_name,'--') as freight_gl_name FROM tally_vbt LEFT JOIN  ${global.ims_db_name}.components ON tally_vbt.part_code= ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key LEFT JOIN tally_ledger freight_join ON  tally_vbt.vbt_freight_gl = freight_join.ledger_key WHERE vbt_key= :vbt_key ORDER BY ID DESC`,
      {
        replacements: { vbt_key: req.body.vbt_key },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        let gst_type = "";

        if (stmt[i].vbt_gst_type == "L") {
          gst_type = "Local";
        }

        if (stmt[i].vbt_gst_type == "I") {
          gst_type = "Inter State";
        }

        final.push({
          part_code: stmt[i].c_part_no,
          part: stmt[i].c_name,
          qty: stmt[i].vbt_inqty,
          bill_qty: stmt[i].vbt_bill_qty,
          unit: "",
          in_rate: stmt[i].vbt_inrate,
          value: (Number(stmt[i].vbt_inrate) * Number(stmt[i].vbt_bill_qty)).toFixed(2),
          hsn_sac: stmt[i].hsn_code,
          gst_type: gst_type,
          gst_rate: stmt[i].vbt_gst_rate,
          custom_duty: stmt[i].custom_duty,
          freight: stmt[i].freight,
          freight_gl: stmt[i].freight_gl_name,
          other_charges: stmt[i].other_charges,
          gst_ass_val: stmt[i].vbp_gst_ass_value,
          cgst: stmt[i].vbt_cgst,
          cgst_gl: stmt[i].cgst_gl_name,
          sgst: stmt[i].vbt_sgst,
          sgst_gl: stmt[i].sgst_gl_name,
          igst: stmt[i].vbt_igst,
          igst_gl: stmt[i].igst_join_name,
          vbt_gl: stmt[i].gl_code,
          tds_code: stmt[i].tds_code,
          tds_gl: stmt[i].tds_join_name,
          tds_ass_val: stmt[i].vbt_tds_ass_val,
          tds_amm: stmt[i].vbt_tds_amount,
          ven_amm: stmt[i].vbt_ven_ammount,
          min_id: stmt[i].min_id,
          invoice_no: stmt[i].vbt_invoice_no,
          invoice_dt: stmt[i].vbt_invoice_date,
          vendor: stmt[i].ven_name,
          ven_code: stmt[i].ven_code,
          ven_address: stmt[i].ven_address,
          gst_in_no: stmt[i].vbt_gstin,
          comment: stmt[i].vbt_comment,
          glName: stmt[i].gl_name,
        });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "Somethig Wrong!!! Please try again" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// PRINT VBT REPORT
router.post("/print_vbt_report", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    vbt_key: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let main_stmt = await tallyDB.query(
      `SELECT tally_vbt.*,c_part_no,c_name,units_name,tally_ledger.ladger_name,tally_ledger.code as ladger_code ,tds_name,ven_basic_detail.ven_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=components.component_key LEFT JOIN ${global.ims_db_name}.units ON components.c_uom=units.units_id LEFT JOIN tally_ledger ON tally_vbt.gl_code=tally_ledger.ledger_key LEFT JOIN tally_tds ON tally_vbt.tds_code=tally_tds.tds_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=ven_basic_detail.ven_register_id WHERE vbt_key= :vbt_key`,
      {
        replacements: { vbt_key: req.body.vbt_key },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    let header;

    if (main_stmt.length > 0) {
      let ven_address = main_stmt[0].ven_address;

      header = {
        ven_code: main_stmt[0].ven_code,
        ven_name: main_stmt[0].ven_name,
        ven_address: ven_address,
        vbt_comment: main_stmt[0].vbt_comment,
        vbt_invoice_no: main_stmt[0].vbt_invoice_no,
        vbt_invoice_date: main_stmt[0].vbt_invoice_date,
        gstin: main_stmt[0].vbt_gstin,
        vbt_code: req.body.vbt_key,
        minno: main_stmt[0].min_id,
        effective_date: main_stmt[0].effective_date,
        vbt_date: moment(main_stmt[0].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
      };

      // ITEMS
      let items_data = "";
      let sum_norm_amt = (totalQTY = total_tax = total_tds = total_ven_amount = total_cust_duty = total_freight = total_other_charge = 0);

      let total_cgst = (total_igst = total_sgst = 0);

      for (let i = 0; i < main_stmt.length; i++) {
        items_data += `
              <tr>
                <td>${i + 1}</th>
                <td>${main_stmt[i].c_part_no}</th>
                <td style="word-wrap: break-word;">${main_stmt[i].c_name}<br/><strong>HSN: ${main_stmt[i].hsn_code}</strong></th>
                <td>${main_stmt[i].units_name}</th>
                <td>${main_stmt[i].vbt_bill_qty}</th>
                <td>${Number(main_stmt[i].vbt_taxable_value).toFixed(2)}</th>
                <td>${main_stmt[i].vbt_gst_rate}</th>
                <td>${main_stmt[i].custom_duty}</th>
                <td>${main_stmt[i].freight}</th>
                <td>${main_stmt[i].other_charges}</th>
                <td>${Number(main_stmt[i].vbt_cgst) + Number(main_stmt[i].vbt_sgst) + Number(main_stmt[i].vbt_igst)}</th>
                <td>${main_stmt[i].vbt_tds_amount}</th>
                <td>${main_stmt[i].vbt_ven_ammount}</th>
              </tr>
        `;

        totalQTY += Number(main_stmt[i].vbt_bill_qty);
        sum_norm_amt += Number(Number(main_stmt[i].vbt_bill_qty) * Number(main_stmt[i].vbt_inrate));
        total_cust_duty += Number(main_stmt[i].custom_duty);
        total_freight += Number(main_stmt[i].freight);
        total_other_charge += Number(main_stmt[i].other_charges);
        sum_tax_amt = total_tax += Number(main_stmt[i].vbt_cgst) + Number(main_stmt[i].vbt_sgst) + Number(main_stmt[i].vbt_igst);
        total_cgst += Number(main_stmt[i].vbt_cgst);
        total_igst += Number(main_stmt[i].vbt_igst);
        total_sgst += Number(main_stmt[i].vbt_sgst);
        total_tds += Number(main_stmt[i].vbt_tds_amount);
        total_ven_amount += Number(main_stmt[i].vbt_ven_ammount);
      }

      let total_part = `
              <tr>
                <td style="text-align: end;" colspan="4"><strong>TOTAL PRICE</strong></th>
                <td><strong>${totalQTY}</strong></th>
                <td><strong>${Number(sum_norm_amt).toFixed(2)}</strong></th>
                <td><strong></strong></th>
                <td><strong>${total_cust_duty}</strong></th>
                <td><strong>${total_freight}</strong></th>
                <td><strong>${total_other_charge}</strong></th>
                <td><strong>${Number(sum_tax_amt).toFixed(2)}</strong></th>
                <td><strong>${total_tds}</strong></th>
                <td><strong>${total_ven_amount}</strong></th>
              </tr>
      `;

      // Summery Table
      let summary_table = "";
      let summary_table2 = "";
      let toatl_debit = 0,
        toatl_creadit = 0;
      
      // Get ledger data from tally_ledger_data table
      let stmt = await tallyDB.query("SELECT `tally_ledger_data`.`ladger_key` FROM `tally_ledger_data` WHERE `module_used` = :vbt_key GROUP BY `tally_ledger_data`.`ladger_key` ", {
        replacements: { vbt_key: req.body.vbt_key },
        type: tallyDB.QueryTypes.SELECT,
      });

      // Collect all ledger keys that exist in database
      let existing_ledger_keys = stmt.map(s => s.ladger_key);
      
      // Build summary from VBT data if ledger entries are missing
      let ledger_entries_map = {};
      
      // First, get existing ledger entries from database
      if (stmt.length > 0) {
        for (let i = 0; i < stmt.length; i++) {
          let is_vendor = stmt[i].ladger_key && stmt[i].ladger_key.toString().startsWith('VEN');
          
          let ledger_query;
          if (is_vendor) {
            // For vendor, join with ven_basic_detail
            ledger_query = `SELECT SUM( tally_ledger_data.debit ) AS total_debit , SUM( tally_ledger_data.credit ) AS total_credit, 
              COALESCE(tally_ledger.ladger_name, CONCAT('(', ${global.ims_db_name}.ven_basic_detail.ven_register_id, ') ', ${global.ims_db_name}.ven_basic_detail.ven_name)) as gl_name, 
              COALESCE(tally_ledger.code, ${global.ims_db_name}.ven_basic_detail.ven_register_id) as code 
              FROM tally_ledger_data 
              LEFT JOIN tally_ledger ON tally_ledger_data.ladger_key=tally_ledger.ledger_key 
              LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_ledger_data.ladger_key = ${global.ims_db_name}.ven_basic_detail.ven_register_id
              WHERE module_used = :vbt_key AND tally_ledger_data.ladger_key = :ladger_key`;
          } else {
            ledger_query = `SELECT SUM( tally_ledger_data.debit ) AS total_debit , SUM( tally_ledger_data.credit ) AS total_credit, 
              tally_ledger.ladger_name as gl_name, tally_ledger.code as code 
              FROM tally_ledger_data 
              LEFT JOIN tally_ledger ON tally_ledger_data.ladger_key=tally_ledger.ledger_key 
              WHERE module_used = :vbt_key AND tally_ledger_data.ladger_key = :ladger_key`;
          }
          
          let ledger_stmt = await tallyDB.query(ledger_query, {
            replacements: { vbt_key: req.body.vbt_key, ladger_key: stmt[i].ladger_key },
            type: tallyDB.QueryTypes.SELECT,
          });
          
          for (let j = 0; j < ledger_stmt.length; j++) {
            if (ledger_stmt[j].total_debit != 0 || ledger_stmt[j].total_credit != 0) {
              ledger_entries_map[stmt[i].ladger_key] = {
                gl_name: ledger_stmt[j].gl_name,
                code: ledger_stmt[j].code,
                debit: Number(ledger_stmt[j].total_debit),
                credit: Number(ledger_stmt[j].total_credit)
              };
            }
          }
        }
      }
      
      // Add missing entries from VBT data
      let gst_type = main_stmt[0].vbt_gst_type;
      
      // Purchase GL (if not in ledger data)
      if (main_stmt[0].gl_code && !existing_ledger_keys.includes(main_stmt[0].gl_code)) {
        let gl_name_stmt = await tallyDB.query("SELECT ladger_name, code FROM tally_ledger WHERE ledger_key = :ledger_key", {
          replacements: { ledger_key: main_stmt[0].gl_code },
          type: tallyDB.QueryTypes.SELECT,
        });
        if (gl_name_stmt.length > 0) {
          ledger_entries_map[main_stmt[0].gl_code] = {
            gl_name: gl_name_stmt[0].ladger_name,
            code: gl_name_stmt[0].code,
            debit: Number(sum_norm_amt),
            credit: 0
          };
        }
      }
      
      // IGST GL (if Inter State and not in ledger data)
      if (gst_type === "I" && main_stmt[0].vbt_igst_gl && Number(total_igst) > 0 && !existing_ledger_keys.includes(main_stmt[0].vbt_igst_gl)) {
        let igst_name_stmt = await tallyDB.query("SELECT ladger_name, code FROM tally_ledger WHERE ledger_key = :ledger_key", {
          replacements: { ledger_key: main_stmt[0].vbt_igst_gl },
          type: tallyDB.QueryTypes.SELECT,
        });
        if (igst_name_stmt.length > 0) {
          ledger_entries_map[main_stmt[0].vbt_igst_gl] = {
            gl_name: igst_name_stmt[0].ladger_name,
            code: igst_name_stmt[0].code,
            debit: Number(total_igst),
            credit: 0
          };
        }
      }
      
      // CGST GL (if Local and not in ledger data)
      if (gst_type === "L" && main_stmt[0].vbt_cgst_gl && Number(total_cgst) > 0 && !existing_ledger_keys.includes(main_stmt[0].vbt_cgst_gl)) {
        let cgst_name_stmt = await tallyDB.query("SELECT ladger_name, code FROM tally_ledger WHERE ledger_key = :ledger_key", {
          replacements: { ledger_key: main_stmt[0].vbt_cgst_gl },
          type: tallyDB.QueryTypes.SELECT,
        });
        if (cgst_name_stmt.length > 0) {
          ledger_entries_map[main_stmt[0].vbt_cgst_gl] = {
            gl_name: cgst_name_stmt[0].ladger_name,
            code: cgst_name_stmt[0].code,
            debit: Number(total_cgst),
            credit: 0
          };
        }
      }
      
      // SGST GL (if Local and not in ledger data)
      if (gst_type === "L" && main_stmt[0].vbt_sgst_gl && Number(total_sgst) > 0 && !existing_ledger_keys.includes(main_stmt[0].vbt_sgst_gl)) {
        let sgst_name_stmt = await tallyDB.query("SELECT ladger_name, code FROM tally_ledger WHERE ledger_key = :ledger_key", {
          replacements: { ledger_key: main_stmt[0].vbt_sgst_gl },
          type: tallyDB.QueryTypes.SELECT,
        });
        if (sgst_name_stmt.length > 0) {
          ledger_entries_map[main_stmt[0].vbt_sgst_gl] = {
            gl_name: sgst_name_stmt[0].ladger_name,
            code: sgst_name_stmt[0].code,
            debit: Number(total_sgst),
            credit: 0
          };
        }
      }
      
      // TDS GL (if TDS > 0 and not in ledger data)
      if (Number(total_tds) > 0 && main_stmt[0].tds_gl && !existing_ledger_keys.includes(main_stmt[0].tds_gl)) {
        let tds_name_stmt = await tallyDB.query("SELECT ladger_name, code FROM tally_ledger WHERE ledger_key = :ledger_key", {
          replacements: { ledger_key: main_stmt[0].tds_gl },
          type: tallyDB.QueryTypes.SELECT,
        });
        if (tds_name_stmt.length > 0) {
          ledger_entries_map[main_stmt[0].tds_gl] = {
            gl_name: tds_name_stmt[0].ladger_name,
            code: tds_name_stmt[0].code,
            debit: 0,
            credit: Number(total_tds)
          };
        }
      }
      
      // Vendor entry (if not in ledger data, calculate from total amount)
      if (main_stmt[0].ven_code && !existing_ledger_keys.includes(main_stmt[0].ven_code)) {
        let ven_name_stmt = await tallyDB.query(`SELECT ven_name, ven_register_id FROM ${global.ims_db_name}.ven_basic_detail WHERE ven_register_id = :ven_code`, {
          replacements: { ven_code: main_stmt[0].ven_code },
          type: tallyDB.QueryTypes.SELECT,
        });
        if (ven_name_stmt.length > 0) {
          ledger_entries_map[main_stmt[0].ven_code] = {
            gl_name: `(${ven_name_stmt[0].ven_register_id}) ${ven_name_stmt[0].ven_name}`,
            code: ven_name_stmt[0].ven_register_id,
            debit: 0,
            credit: Number(total_ven_amount)
          };
        }
      }
      
      // Display all entries
      for (let ledger_key in ledger_entries_map) {
        let entry = ledger_entries_map[ledger_key];
        
        // Import Insurance Adjustment AND MISC
        if (ledger_key == "TP230213105740" || ledger_key == "TP230214145235") {
          summary_table2 += `<tr>
            <td>${entry.gl_name}${entry.code ? `(${entry.code})` : ''} </td>
            <td>${entry.debit.toFixed(2)}</td>
            <td>${entry.credit.toFixed(2)}</td>
            </tr>`;
        } else {
          summary_table += `<tr>
            <td>${entry.gl_name}${entry.code ? `(${entry.code})` : ''} </td>
            <td>${entry.debit.toFixed(2)}</td>
            <td>${entry.credit.toFixed(2)}</td>
            </tr>`;

          if (entry.code == "800907") {
            // Round Off
            if (entry.debit == 0) {
              toatl_debit -= entry.credit;
              toatl_creadit -= entry.credit;
            }
            if (entry.credit == 0) {
              toatl_debit += entry.debit;
              toatl_creadit += entry.debit;
            }
          } else {
            toatl_debit += entry.debit;
            toatl_creadit += entry.credit;
          }
        }
      }
      
      summary_table += `<tr> 
                          <td>Total</td> 
                          <td>${Number(toatl_debit).toFixed(2)}</td>
                          <td>${Number(toatl_creadit).toFixed(2)}</td>
                        </tr>`;

      // PRINT LOGIS

      let options = { format: "A4", margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" } };
      let file = { content: require("./vbtPrintHtml").printHtml(header, items_data + total_part, summary_table, summary_table2) };
      await htmlToPdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          res.json({ buffer: pdfBuffer });
        })
        .catch((err) => {
          return res.json({ message: "an error while generating file", status: "error", success: false});
        });
    } else {
      return res.json({ status: "error", success: false, message: "VBT Not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// Fetch VBT DEBIT REPORT
router.post("/vbt_debit_report", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let main_stmt;
    let { wise, data } = req.body;

    if (wise == "effectivewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      main_stmt = await tallyDB.query(
        `SELECT tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key WHERE (DATE_FORMAT(tally_vbt.effective_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND tally_vbt.vbt_status = 'DE'  ORDER BY ID DESC`,
        {
          replacements: { date1: date1, date2: date2 },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      main_stmt = await tallyDB.query(
        `SELECT tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key WHERE (DATE_FORMAT(tally_vbt.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND tally_vbt.vbt_status = 'DE'  ORDER BY ID DESC`,
        {
          replacements: { date1: date1, date2: date2 },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "vendorwise") {
      main_stmt = await tallyDB.query(
        `SELECT tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key WHERE tally_vbt.ven_code = :venid AND tally_vbt.vbt_status = 'DE' ORDER BY ID DESC`,
        {
          replacements: { venid: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "minwise") {
      main_stmt = await tallyDB.query(
        `SELECT tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key WHERE tally_vbt.min_id = :minno AND tally_vbt.vbt_status = 'DE'  ORDER BY ID DESC`,
        {
          replacements: { minno: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "vbtwise") {
      main_stmt = await tallyDB.query(
        `SELECT tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no ,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key WHERE tally_vbt.vbt_key = :vbtno AND tally_vbt.vbt_status = 'DE'  ORDER BY ID DESC`,
        {
          replacements: { vbtno: data },
          type: tallyDB.QueryTypes.SELECT,
        }
      );
    } else {
      return res.json({ status: "error", success: false, message: "Please select valid filter method" });
    }

    if (main_stmt.length > 0) {
      let final = [];

      for (let i = 0; i < main_stmt.length; i++) {
        final.push({
          po_id: main_stmt[i].po_number,
          project_id: main_stmt[i].project_id,
          vbt_code: main_stmt[i].vbt_key,
          debitNo: main_stmt[i].vbt_debit_key,
          min_id: main_stmt[i].min_id,
          status: main_stmt[i].vbt_status,
          type: main_stmt[i].vbt_type,
          invoice_no: main_stmt[i].vbt_invoice_no,
          vendor: main_stmt[i].ven_name,
          ven_code: main_stmt[i].ven_code,
          part: main_stmt[i].c_name,
          part_code: main_stmt[i].c_part_no,
          act_qty: main_stmt[i].vbt_bill_qty,
          rate: main_stmt[i].vbt_inrate,
          taxable_value: main_stmt[i].vbt_taxable_value,
          cgst: main_stmt[i].vbt_cgst,
          sgst: main_stmt[i].vbt_sgst,
          igst: main_stmt[i].vbt_igst,
          custum: main_stmt[i].custom_duty,
          freight: main_stmt[i].freight,
          ven_bill_amm: main_stmt[i].vbt_ven_ammount,
          vbt_gl: main_stmt[i].gl_name,
          cgst_gl: main_stmt[i].cgst_gl_name,
          sgst_gl: main_stmt[i].sgst_gl_name,
          igst_gl: main_stmt[i].igst_join_name,
          tds_gl: main_stmt[i].tds_join_name,
          tds_amm: main_stmt[i].vbt_tds_amount,
          invoice_dt: main_stmt[i].vbt_invoice_date,
          eff_dt: main_stmt[i].effective_date,
          create_dt: moment(main_stmt[i].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
        });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH DEBIT REPORT
router.post("/vbt_debit_report_data", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    vbt_key: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: validation.errors.fails() });
  }

  try {
    let stmt = await tallyDB.query(
      `SELECT tally_vbt.*,DATE_FORMAT(tally_vbt.insert_date, '%d-%m-%Y') as insert_date,ven_basic_detail.ven_name,components.c_name, components.c_part_no,gl.ladger_name as gl_name ,COALESCE(cgst_join.ladger_name,'--') as cgst_gl_name,COALESCE(sgst_join.ladger_name,'--') as sgst_gl_name,COALESCE(igst_join.ladger_name,'--') as igst_join_name, COALESCE(tds_join.ladger_name,'--') as tds_join_name , COALESCE(freight_join.ladger_name,'--') as freight_gl_name FROM tally_vbt LEFT JOIN  ${global.ims_db_name}.components ON tally_vbt.part_code= ${global.ims_db_name}.components.component_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=${global.ims_db_name}.ven_basic_detail.ven_register_id LEFT JOIN tally_ledger gl ON tally_vbt.gl_code=gl.ledger_key LEFT JOIN tally_ledger fr ON tally_vbt.gl_code=fr.ledger_key LEFT JOIN tally_ledger cgst_join ON tally_vbt.vbt_cgst_gl=cgst_join.ledger_key LEFT JOIN tally_ledger sgst_join ON tally_vbt.vbt_sgst_gl=sgst_join.ledger_key LEFT JOIN tally_ledger igst_join ON tally_vbt.vbt_igst_gl=igst_join.ledger_key LEFT JOIN tally_ledger tds_join ON tally_vbt.tds_gl= tds_join.ledger_key LEFT JOIN tally_ledger freight_join ON  tally_vbt.vbt_freight_gl = freight_join.ledger_key WHERE vbt_key= :vbt_key AND tally_vbt.vbt_status = 'DE'  ORDER BY ID DESC`,
      {
        replacements: { vbt_key: req.body.vbt_key },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let final = [];
      for (let i = 0; i < stmt.length; i++) {
        let gst_type = "";

        if (stmt[i].vbt_gst_type == "L") {
          gst_type = "Local";
        }

        if (stmt[i].vbt_gst_type == "I") {
          gst_type = "Inter State";
        }

        final.push({
          part_code: stmt[i].c_part_no,
          part: stmt[i].c_name,
          qty: stmt[i].vbt_inqty,
          bill_qty: stmt[i].vbt_bill_qty,
          unit: "",
          in_rate: stmt[i].vbt_inrate,
          value: (Number(stmt[i].vbt_inrate) * Number(stmt[i].vbt_bill_qty)).toFixed(2),
          hsn_sac: stmt[i].hsn_code,
          gst_type: gst_type,
          gst_rate: stmt[i].vbt_gst_rate,
          custom_duty: stmt[i].custom_duty,
          freight: stmt[i].freight,
          freight_gl: stmt[i].freight_gl_name,
          other_charges: stmt[i].other_charges,
          gst_ass_val: stmt[i].vbp_gst_ass_value,
          cgst: stmt[i].vbt_cgst,
          cgst_gl: stmt[i].cgst_gl_name,
          sgst: stmt[i].vbt_sgst,
          sgst_gl: stmt[i].sgst_gl_name,
          igst: stmt[i].vbt_igst,
          igst_gl: stmt[i].igst_join_name,
          vbt_gl: stmt[i].gl_code,
          tds_code: stmt[i].tds_code,
          tds_gl: stmt[i].tds_join_name,
          tds_ass_val: stmt[i].vbt_tds_ass_val,
          tds_amm: stmt[i].vbt_tds_amount,
          ven_amm: stmt[i].vbt_ven_ammount,
          min_id: stmt[i].min_id,
          invoice_no: stmt[i].vbt_invoice_no,
          invoice_dt: stmt[i].vbt_invoice_date,
          vendor: stmt[i].ven_name,
          ven_code: stmt[i].ven_code,
          ven_address: stmt[i].ven_address,
          gst_in_no: stmt[i].vbt_gstin,
          comment: stmt[i].vbt_comment,
        });
      }

      return res.json({ status: "success", success: true, data: final });
    } else {
      return res.json({ status: "error", success: false, message: "Somethig Wrong!!! Please try again" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// PRINT VBT DEBIT REPORT
router.post("/print_vbt_debit_report", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    debit_code: "required",
  });
  if (validation.fails()) {
    res.json({ message: "something you missing in form field to supply", data: validation.errors.all(), status: "error", success: false });
  }

  try {
    let main_stmt = await tallyDB.query(
      `SELECT tally_vbt.*,c_part_no,c_name,units_name,tally_ledger.ladger_name,tally_ledger.code as ladger_code ,tds_name,ven_basic_detail.ven_name,ven_basic_detail.ven_pan_no FROM tally_vbt LEFT JOIN ${global.ims_db_name}.components ON tally_vbt.part_code=components.component_key LEFT JOIN ${global.ims_db_name}.units ON components.c_uom=units.units_id LEFT JOIN tally_ledger ON tally_vbt.gl_code=tally_ledger.ledger_key LEFT JOIN tally_tds ON tally_vbt.tds_code=tally_tds.tds_key LEFT JOIN ${global.ims_db_name}.ven_basic_detail ON tally_vbt.ven_code=ven_basic_detail.ven_register_id WHERE vbt_debit_key= :debit_code AND tally_vbt.vbt_status = 'DE' `,
      {
        replacements: { debit_code: req.body.debit_code },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    let header;

    if (main_stmt.length > 0) {
      let ven_address = main_stmt[0].ven_address;

      header = {
        ven_code: main_stmt[0].ven_code,
        ven_name: main_stmt[0].ven_name,
        ven_address: ven_address,
        vbt_comment: main_stmt[0].vbt_comment,
        gstin: main_stmt[0].vbt_gstin,
        panNo: main_stmt[0].ven_pan_no,
        debitNo: main_stmt[0].vbt_debit_key,
        vbt_code: req.body.vbt_key,
        minno: main_stmt[0].min_id,
        effective_date: moment(main_stmt[0].effective_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
        vbt_date: moment(main_stmt[0].insert_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
      };

      // ITEMS
      let items_data = "";
      let totalQTY = 0;
      let totalAmount = 0;
      let total_summry_table = 0;

      for (let i = 0; i < main_stmt.length; i++) {
        items_data += `
              <tr>
                <td>${i + 1}</th>
                <td style="word-wrap: break-word;">${main_stmt[i].c_name}<br/></th>
                <td>${main_stmt[i].hsn_code}</th>
                <td>${main_stmt[i].c_part_no}</th>
                <td>${main_stmt[i].vbt_bill_qty}</th>
                <td>${main_stmt[i].vbt_inrate}</th>
                <td>${main_stmt[i].units_name}</th>
                <td>${Number(main_stmt[i].vbt_taxable_value).toFixed(2)}</th>
              </tr>
        `;

        totalQTY += Number(main_stmt[i].vbt_bill_qty);
        totalAmount += Number(main_stmt[i].vbt_taxable_value);
      }

      //
      let total_part = `
            <tr>
              <td style="text-align: end;" colspan="4"><strong>TOTAL</strong></th>
              <td><strong>${totalQTY}</strong></th>
              <td><strong></strong></th>
              <td><strong></strong></th>
              <td><strong>${Number(Number(totalAmount).toFixed(2)).toLocaleString("hi-IN")}</strong></th>
            </tr>
    `;

      let summary = "";
      let totalCredit = 0;
      let totalDebit = 0;

      let getDebitNoteLedgers = await tallyDB.query("SELECT SUM(tally_ledger_data.debit) AS debit , SUM(tally_ledger_data.credit) AS credit , tally_ledger.ladger_name FROM tally_ledger_data LEFT JOIN tally_ledger ON tally_ledger_data.ladger_key = tally_ledger.ledger_key WHERE tally_ledger_data.debit_key = :debit_key GROUP BY tally_ledger_data.ladger_key", {
        replacements: { debit_key: req.body.debit_code },
        type: tallyDB.QueryTypes.SELECT
      })

      getDebitNoteLedgers.map(async (elem) => {
        summary += `<tr>
          <td>${elem.ladger_name}</td>
          <td>${Number(elem.debit).toFixed(2)}</td>
          <td>${Number(elem.credit).toFixed(2)}</td>
          </tr>`;

        if (Number(elem.credit) > 0) {
          totalCredit += Number(elem.credit);
        }
        if (Number(elem.debit) > 0) {
          totalDebit += Number(elem.debit);
        }
      })

      let summary2 = `<tr>
      <td>Total</td>
      <td>${Number(totalDebit).toFixed(2)}</td>
      <td>${Number(totalCredit).toFixed(2)}</td>
      </tr>`;

      // PRINT LOGIS

      let options = { format: "A4", margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" } };
      let file = { content: require("./vbtDebitHtml").vbtDebitPrint(header, items_data, total_part, summary, summary2, totalAmount) };
      await htmlToPdf
        .generatePdf(file, options)
        .then((pdfBuffer) => {
          // res.setHeader("Content-disposition", 'inline; filename="vbt.pdf"');
          // res.setHeader("Content-type", "application/pdf");
          // res.send(pdfBuffer);
          return res.json({ buffer: pdfBuffer });
        })
        .catch((err) => {
          return res.json({ message: "an error while generating file", status: "error", success: false});
        });
    } else {
      return res.json({ status: "error", success: false, message: "VBT Not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;

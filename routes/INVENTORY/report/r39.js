let { invtDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();
const auth = require("../../../middleware/auth");
const helper = require("../../../helper/helper");

function monthLabel(value) {
  const raw = String(value || "").trim();
  return raw === "" ? "NA" : raw;
}

router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    const projectFilter =
      req.body.project_name != null && String(req.body.project_name).trim() !== ""
        ? String(req.body.project_name).trim()
        : null;

    let whereClause =
      "WHERE m.prod_branch = :branch AND m.prod_transaction IS NOT NULL AND m.prod_transaction != ''";
    let replacements = { branch: req.branch };

    if (projectFilter) {
      whereClause += " AND m.prod_project = :project_name";
      replacements.project_name = projectFilter;
    }

    const stmt = await invtDB.query(
      `SELECT
         m.prod_project,
         COALESCE(pm.project_description, '--') AS project_description,
         m.prod_bom_subject,
         m.prod_product_sku,
         m.prod_transaction,
         COALESCE(m.prod_planned_month, '--') AS prod_planned_month,
         COALESCE(m.prod_planned_qty, 0) AS prod_planned_qty
       FROM mfg_production_1 m
       LEFT JOIN project_master pm ON pm.project_name = m.prod_project
       ${whereClause}
       ORDER BY m.ID DESC`,
      { replacements, type: invtDB.QueryTypes.SELECT }
    );

    if (stmt.length === 0) {
      return res.json({
        success: false,
        status: "error",
        message:"No Data Found",
      });
    }

   
    const pprList = stmt
      .map((row) => String(row.prod_transaction || "").trim())
      .filter((val) => val !== "");

    let executedMap = {};
    let execByPpr = {};
    // component + month execution: key `${ppr}__${component_id}` -> [{month, qty}]
    let execByPprCompMonth = {};
    let execByPprComp = {};
    if (pprList.length > 0) {
      const poExecRows = await invtDB.query(
        `SELECT 
           po_ppr_no,
           DATE_FORMAT(po_full_date, '%M-%Y') AS exec_month,
           COALESCE(SUM(po_order_qty), 0) AS executed_qty
         FROM po_purchase_req
         WHERE po_ppr_no IN (:pprs)
           AND po_status = 'A'
           AND po_part_status = 'ACTIVE'
           AND company_branch = :branch
         GROUP BY po_ppr_no, exec_month`,
        {
          replacements: { pprs: pprList, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      for (let i = 0; i < poExecRows.length; i++) {
        const row = poExecRows[i];
        const ppr = String(row.po_ppr_no);
        const qty = helper.number(row.executed_qty || 0);
        executedMap[ppr] = (executedMap[ppr] || 0) + qty;

        if (!execByPpr[ppr]) {
          execByPpr[ppr] = [];
        }
        execByPpr[ppr].push({
          month: row.exec_month,
          qty,
        });
      }

      // PPR credit from SF->REJ / RM->REJ linked transfers
      const rejCreditRows = await invtDB.query(
        `SELECT 
           rm_ppr_credit_no AS ppr_no,
           COALESCE(SUM(qty + COALESCE(other_qty, 0)), 0) AS credit_qty
         FROM rm_location
         WHERE rm_ppr_credit_no IN (:pprs)
           AND rm_ppr_credit_no != '--'
           AND trans_type = 'REJECTION'
           AND in_module = 'IN-TRN'
           AND company_branch = :branch
         GROUP BY rm_ppr_credit_no`,
        {
          replacements: { pprs: pprList, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      for (let i = 0; i < rejCreditRows.length; i++) {
        const row = rejCreditRows[i];
        const ppr = String(row.ppr_no);
        const credit = helper.number(row.credit_qty || 0);
        executedMap[ppr] = Math.max(
          0,
          helper.number((executedMap[ppr] || 0) - credit)
        );
      }

      // Component wise execution for all these PPRs
      const poExecCompRows = await invtDB.query(
        `SELECT 
           po_ppr_no,
           po_part_no,
           COALESCE(SUM(po_order_qty), 0) AS executed_qty
         FROM po_purchase_req
         WHERE po_ppr_no IN (:pprs)
           AND po_status = 'A'
           AND po_part_status = 'ACTIVE'
           AND company_branch = :branch
         GROUP BY po_ppr_no, po_part_no`,
        {
          replacements: { pprs: pprList, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      for (let i = 0; i < poExecCompRows.length; i++) {
        const row = poExecCompRows[i];
        const key = `${String(row.po_ppr_no)}__${String(row.po_part_no)}`;
        execByPprComp[key] = helper.number(row.executed_qty || 0);
      }

      const poExecCompMonthRows = await invtDB.query(
        `SELECT
           po_ppr_no,
           po_part_no,
           DATE_FORMAT(po_full_date, '%M-%Y') AS exec_month,
           COALESCE(SUM(po_order_qty), 0) AS executed_qty
         FROM po_purchase_req
         WHERE po_ppr_no IN (:pprs)
           AND po_status = 'A'
           AND po_part_status = 'ACTIVE'
           AND company_branch = :branch
         GROUP BY po_ppr_no, po_part_no, exec_month`,
        {
          replacements: { pprs: pprList, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      for (let i = 0; i < poExecCompMonthRows.length; i++) {
        const row = poExecCompMonthRows[i];
        const key = `${String(row.po_ppr_no)}__${String(row.po_part_no)}`;
        if (!execByPprCompMonth[key]) execByPprCompMonth[key] = [];
        execByPprCompMonth[key].push({
          month: row.exec_month,
          qty: helper.number(row.executed_qty || 0),
        });
      }

      // Component-wise PPR credit reverse
      const rejCreditCompRows = await invtDB.query(
        `SELECT
           rm_ppr_credit_no AS ppr_no,
           components_id AS component_id,
           COALESCE(SUM(qty + COALESCE(other_qty, 0)), 0) AS credit_qty
         FROM rm_location
         WHERE rm_ppr_credit_no IN (:pprs)
           AND rm_ppr_credit_no != '--'
           AND trans_type = 'REJECTION'
           AND in_module = 'IN-TRN'
           AND company_branch = :branch
         GROUP BY rm_ppr_credit_no, components_id`,
        {
          replacements: { pprs: pprList, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      for (let i = 0; i < rejCreditCompRows.length; i++) {
        const row = rejCreditCompRows[i];
        const key = `${String(row.ppr_no)}__${String(row.component_id)}`;
        const credit = helper.number(row.credit_qty || 0);
        execByPprComp[key] = Math.max(
          0,
          helper.number((execByPprComp[key] || 0) - credit)
        );
      }
    }

    // Preload BOM components for all used subjects
    const bomSubjects = [
      ...new Set(
        stmt
          .map((row) => row.prod_bom_subject)
          .filter((v) => v != null && String(v).trim() !== "")
      ),
    ];

    let bomCompMap = {};
    if (bomSubjects.length > 0) {
      const bomRows = await invtDB.query(
        `SELECT 
           bq.subject_under,
           bq.component_id,
           bq.qty,
           c.c_part_no,
           c.c_name,
           u.units_name
         FROM bom_quantity bq
         INNER JOIN bom_recipe br ON bq.subject_under = br.subject_id
         LEFT JOIN components c ON bq.component_id = c.component_key
         LEFT JOIN units u ON c.c_uom = u.units_id
         WHERE bq.subject_under IN (:subjects)
           AND br.bom_status = 'ENABLE'`,
        {
          replacements: { subjects: bomSubjects },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      for (let i = 0; i < bomRows.length; i++) {
        const row = bomRows[i];
        const subj = row.subject_under;
        if (!bomCompMap[subj]) bomCompMap[subj] = [];
        bomCompMap[subj].push({
          component_id: row.component_id,
          bom_qty: helper.number(row.qty || 0),
          part_no: row.c_part_no || "",
          name: row.c_name || "",
          unit: row.units_name || "",
        });
      }
    }

    const data = [];
    for (let i = 0; i < stmt.length; i++) {
      const item = stmt[i];
      const planned = helper.number(item.prod_planned_qty);
      const executed = helper.number(
        executedMap[String(item.prod_transaction)] || 0
      );
      const pending = planned - executed < 0 ? 0 : planned - executed;

      const monthExec =
        execByPpr[String(item.prod_transaction)]?.filter((m) => m.qty > 0) || [];

      // BOM components for this PPR's BOM, with PPR-based plan/executed/pending
      const bomComponents = (bomCompMap[item.prod_bom_subject] || []).map(
        (comp) => {
          const compPlanQty = helper.number(planned * comp.bom_qty);
          const compExecKey = `${String(
            item.prod_transaction
          )}__${String(comp.component_id)}`;
          const compExecuted = helper.number(
            execByPprComp[compExecKey] || 0
          );
          const compMonthExecRaw = execByPprCompMonth[compExecKey] || [];
          const compMonthExec = compMonthExecRaw.filter((m) => m.qty > 0);
          const compPending =
            compPlanQty - compExecuted < 0 ? 0 : compPlanQty - compExecuted;

          return {
            component_id: comp.component_id,
            part_no: comp.part_no,
            name: comp.name,
            unit: comp.unit,
            bom_qty: comp.bom_qty,
            month_exec: compMonthExec,
            ppr_plan_qty: compPlanQty,
            ppr_executed_qty: compExecuted,
            ppr_pending_qty: compPending,
          };
        }
      );

      data.push({
        project_id: item.prod_project,
        project_name: item.project_description || "--",
        ppr_no: item.prod_transaction,
        product_sku_code: item.prod_product_sku,
        planned_month: item.prod_planned_month,
        bom: item.prod_bom_subject || "--",
        bom_qty: 1,
        month_exec: [], 
        components: bomComponents,
        project_plan_qty: planned,
        project_executed_qty: executed,
        project_pending_qty: pending,
      });
    }

    return res.json({
      success: true,
      status: "success",
      data:data,
    });
  } catch (error) {
    return res.json({
     success: false,
      status: "error",
      message: "Internal Error!!! If this condition persists, contact your system administrator",
      error: error.stack,
    });
  }
});

module.exports = router;

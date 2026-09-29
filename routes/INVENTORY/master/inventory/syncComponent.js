const express = require("express");
const router = express.Router();


router.post("/syncComponentsOakterToC25", [auth.isAuthorized], async (req, res) => {
  let tx;

  try {
    const { sync_date } = req.body;

    if (!sync_date) {
      return res.json({ status: "error", success: false, message: "Please provide a sync_date (YYYY-MM-DD)" });
    }

    // 1. Fetch data from BOTH databases for the given date simultaneously
    // Source = invtOakterDB (Oakter) | Target = invtDB (C25)
    const [sourceComponents, targetComponents] = await Promise.all([
      invtOakterDB.query(
        "SELECT * FROM components WHERE DATE(insert_date) = :sync_date", 
        { replacements: { sync_date }, type: invtOakterDB.QueryTypes.SELECT }
      ),
      invtDB.query(
        "SELECT component_key FROM components WHERE DATE(insert_date) = :sync_date", 
        { replacements: { sync_date }, type: invtDB.QueryTypes.SELECT }
      )
    ]);

    // 2. Find missing components in C25 (Target)
    const targetKeysSet = new Set(targetComponents.map(c => c.component_key));
    const componentsToSync = sourceComponents.filter(c => !targetKeysSet.has(c.component_key));

    if (componentsToSync.length === 0) {
      return res.json({
        status: "success", success: true,
        message: `C25 is already in sync with Oakter for date: ${sync_date}.`,
        data: { syncedCount: 0 }
      });
    }

    // 3. Fetch HSN data from Oakter ONLY for the missing components
    const missingKeysArray = componentsToSync.map(c => c.component_key);
    const sourceHsns = await invtOakterDB.query(
      "SELECT * FROM tbl_rm_hsn WHERE component_key IN (:keys)", 
      { replacements: { keys: missingKeysArray }, type: invtOakterDB.QueryTypes.SELECT }
    );

    // 4. Begin Transaction on C25 (invtDB)
    tx = await invtDB.transaction();

    // 5. Insert Missing Components into C25
    const componentSQL = `
      INSERT INTO components 
      (c_group, c_sub_group, attribute_raw, attribute_code, c_part_no, c_new_part_no,
       c_name, c_uom, c_type, c_specification, c_attr_category, component_key,
       inserted_by, insert_date)
      VALUES
      (:c_group, :c_sub_group, :attribute_raw, :attribute_code, :c_part_no, :c_new_part_no,
       :c_name, :c_uom, :c_type, :c_specification, :c_attr_category, :component_key,
       :inserted_by, :insert_date)
    `;

    for (const comp of componentsToSync) {
      await invtDB.query(componentSQL, {
        replacements: {
          c_group: comp.c_group, c_sub_group: comp.c_sub_group, attribute_raw: comp.attribute_raw,
          attribute_code: comp.attribute_code, c_part_no: comp.c_part_no, c_new_part_no: comp.c_new_part_no,
          c_name: comp.c_name, c_uom: comp.c_uom, c_type: comp.c_type, c_specification: comp.c_specification,
          c_attr_category: comp.c_attr_category, component_key: comp.component_key,
          inserted_by: comp.inserted_by, insert_date: comp.insert_date
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: tx
      });
    }

    // 6. Insert associated HSNs into C25
    const hsnSQL = `
      INSERT INTO tbl_rm_hsn (component_key, hsn_code, tax_percent)
      VALUES (:component_key, :hsn_code, :tax_percent)
    `;

    for (const hsn of sourceHsns) {
      await invtDB.query(hsnSQL, {
        replacements: {
          component_key: hsn.component_key, hsn_code: hsn.hsn_code, tax_percent: hsn.tax_percent
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: tx
      });
    }

    // 7. Commit changes safely
    await tx.commit();

    return res.json({
      status: "success", success: true,
      message: `Data synced successfully from Oakter to C25 for date: ${sync_date}`,
      data: { syncedComponentsCount: componentsToSync.length, syncedHsnCount: sourceHsns.length },
    });

  } catch (err) {
    if (tx) await tx.rollback();
    return helper.errorResponse(res, err);
  }
});



router.post("/syncBomOakterToC25", [auth.isAuthorized], async (req, res) => {
  let tx;

  try {
    const { sync_date } = req.body;

    if (!sync_date) {
      return res.json({ status: "error", success: false, message: "Please provide a sync_date (YYYY-MM-DD)" });
    }

    // 1. Fetch BOM Recipes from BOTH databases simultaneously
    // Source = invtOakterDB (Oakter) | Target = invtDB (C25)
    const [sourceBoms, targetBoms] = await Promise.all([
      invtOakterDB.query(
        "SELECT * FROM bom_recipe WHERE DATE(insert_date) = :sync_date", 
        { replacements: { sync_date }, type: invtOakterDB.QueryTypes.SELECT }
      ),
      invtDB.query(
        "SELECT subject_id FROM bom_recipe WHERE DATE(insert_date) = :sync_date", 
        { replacements: { sync_date }, type: invtDB.QueryTypes.SELECT }
      )
    ]);

    // 2. Find missing BOM Recipes in C25
    const targetKeysSet = new Set(targetBoms.map(b => b.subject_id));
    const bomsToSync = sourceBoms.filter(b => !targetKeysSet.has(b.subject_id));

    if (bomsToSync.length === 0) {
      return res.json({
        status: "success", success: true,
        message: `C25 is already in sync with Oakter BOMs for date: ${sync_date}.`,
        data: { syncedCount: 0 }
      });
    }

    // 3. Fetch BOM Quantities from Oakter ONLY for the missing BOMs
    const missingSubjectIds = bomsToSync.map(b => b.subject_id);
    const sourceQuantities = await invtOakterDB.query(
      "SELECT * FROM bom_quantity WHERE subject_under IN (:subject_ids)", 
      { replacements: { subject_ids: missingSubjectIds }, type: invtOakterDB.QueryTypes.SELECT }
    );

    // 4. Begin Transaction on C25 (invtDB)
    tx = await invtDB.transaction();

    // 5. Insert Missing BOM Recipes into C25
    const insertBOMSQL = `
      INSERT INTO bom_recipe 
      (bom_project, sfg_mapped_rm, bom_recipe_type, subject_name, bom_level, subject_id, insert_date, inserted_by, bom_product_sku)
      VALUES 
      (:bom_project, :sfg_mapped_rm, :bom_recipe_type, :subject_name, :bom_level, :subject_id, :insert_date, :inserted_by, :bom_product_sku)
    `;

    for (const bom of bomsToSync) {
      await invtDB.query(insertBOMSQL, {
        replacements: {
          bom_project: bom.bom_project || "", sfg_mapped_rm: bom.sfg_mapped_rm, bom_recipe_type: bom.bom_recipe_type,
          subject_name: bom.subject_name, bom_level: bom.bom_level, subject_id: bom.subject_id,
          insert_date: bom.insert_date, inserted_by: bom.inserted_by, bom_product_sku: bom.bom_product_sku
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: tx
      });
    }

    // 6. Insert missing BOM Quantities (Components) into C25
    const insertQtySQL = `
      INSERT INTO bom_quantity 
      (bom_quantity_type, subject_under, product_sku, component_id, qty, insert_date, inserted_by)
      VALUES 
      (:bom_quantity_type, :subject_under, :product_sku, :component_id, :qty, :insert_date, :inserted_by)
    `;

    for (const qty of sourceQuantities) {
      await invtDB.query(insertQtySQL, {
        replacements: {
          bom_quantity_type: qty.bom_quantity_type, subject_under: qty.subject_under, product_sku: qty.product_sku,
          component_id: qty.component_id, qty: qty.qty, insert_date: qty.insert_date, inserted_by: qty.inserted_by
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: tx
      });
    }

    // 7. Commit changes
    await tx.commit();

    return res.json({
      status: "success", success: true,
      message: `BOM data synced successfully from Oakter to C25 for date: ${sync_date}`,
      data: { syncedBOMsCount: bomsToSync.length, syncedComponentsCount: sourceQuantities.length },
    });

  } catch (err) {
    if (tx) await tx.rollback();
    console.error(err);
    return helper.errorResponse(res, err);
  }
});


module.exports = router;